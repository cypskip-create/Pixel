"""Model-driven multi-step conversation loop for Pixel (pixel-agent-v2).

Security invariant:
  Python NEVER executes privileged OS, file, Git, browser, or UIA actions.
  Every tool call is emitted as a `tool.request` frame to Electron main, which
  validates arguments, enforces PermissionBroker, runs the approved executor,
  and replies with a correlated `tool.response` frame.
"""

from __future__ import annotations

import json
import threading
import uuid
from typing import Any, Callable, Optional

from .budgets import IterationBudget, RUN_BUDGET_WRAPUP_NOTICE, RepetitionGuard
from .compressor import compress_messages, context_limit_for_model
from .errors import AgentError, bound_error_text
from .providers import ProviderConfig, ProviderTurnResult, stream_provider, stream_with_fallback

ProviderCallFn = Callable[
    [ProviderConfig, list[dict[str, Any]], list[dict[str, Any]], threading.Event, Callable[[str], None], Callable[[str], None]],
    ProviderTurnResult,
]


def _default_provider_call(
    config: ProviderConfig,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    cancel_event: threading.Event,
    on_delta: Callable[[str], None],
    on_reasoning: Callable[[str], None],
) -> ProviderTurnResult:
    return stream_provider(
        config,
        messages,
        tools,
        cancel_event=cancel_event,
        on_delta=on_delta,
        on_reasoning=on_reasoning,
    )


def run_agent_turn(
    *,
    request_id: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    provider_config: ProviderConfig,
    budget: IterationBudget,
    cancel_event: threading.Event,
    emit: Callable[[dict[str, Any]], None],
    request_tool_execution: Callable[[str, str, dict[str, Any], float], dict[str, Any]],
    tool_timeout_s: float = 35.0,
    provider_call: Optional[ProviderCallFn] = None,
    fallback_configs: Optional[list[ProviderConfig]] = None,
) -> dict[str, Any]:
    """Execute one complete multi-step model/tool turn and emit pixel-agent-v2 events."""
    call_model = provider_call or _default_provider_call
    repetition = RepetitionGuard(max_identical_tool_calls=3)
    working_messages: list[dict[str, Any]] = [dict(m) for m in messages]
    model_limit = min(budget.max_context_tokens, context_limit_for_model(provider_config.model))

    final_content = ""
    final_reasoning = ""
    total_usage = {"promptTokens": 0, "completionTokens": 0, "totalTokens": 0}
    finish_reason = "stop"
    compression_stats = {"prunedTools": 0, "compressedMiddle": 0, "usedAuxSummary": False}
    executed_steps: list[dict[str, Any]] = []

    while True:
        if cancel_event.is_set():
            finish_reason = "cancelled"
            break

        allowed, reason = budget.can_continue_iteration()
        if not allowed:
            emit({
                "type": "turn.error",
                "requestId": request_id,
                "error": AgentError("BUDGET_EXHAUSTED", reason or "Turn budget exhausted.").to_dict(),
            })
            return {
                "ok": False,
                "finishReason": "budget_exhausted",
                "content": final_content,
                "reasoning": final_reasoning,
                "usage": total_usage,
                "steps": executed_steps,
                "compression": compression_stats,
            }

        working_messages, stats = compress_messages(working_messages, token_budget=model_limit)
        compression_stats["prunedTools"] += stats["prunedTools"]
        compression_stats["compressedMiddle"] += stats["compressedMiddle"]

        if budget.should_inject_wrapup():
            working_messages.append({"role": "system", "content": RUN_BUDGET_WRAPUP_NOTICE})

        budget.record_iteration()
        turn_text_parts: list[str] = []

        def _on_delta(chunk: str) -> None:
            turn_text_parts.append(chunk)
            emit({"type": "turn.delta", "requestId": request_id, "delta": chunk})

        def _on_reasoning(chunk: str) -> None:
            emit({"type": "turn.reasoning", "requestId": request_id, "delta": chunk})

        def _on_fallback(failed: ProviderConfig, nxt: ProviderConfig, _err: AgentError) -> None:
            emit({
                "type": "turn.reasoning",
                "requestId": request_id,
                "delta": f"Provider fallback: {failed.provider}/{failed.model} unavailable; using {nxt.provider}/{nxt.model} for this response.\n",
            })

        try:
            if fallback_configs:
                def _wrapped_stream(
                    cfg: ProviderConfig,
                    msgs: list[dict[str, Any]],
                    tls: list[dict[str, Any]],
                    *,
                    cancel_event: threading.Event,
                    on_delta: Callable[[str], None],
                    on_reasoning: Callable[[str], None],
                ) -> ProviderTurnResult:
                    return call_model(cfg, msgs, tls, cancel_event, on_delta, on_reasoning)

                outcome, active_cfg = stream_with_fallback(
                    provider_config,
                    fallback_configs,
                    working_messages,
                    tools,
                    cancel_event=cancel_event,
                    on_delta=_on_delta,
                    on_reasoning=_on_reasoning,
                    on_fallback=_on_fallback,
                    stream_fn=_wrapped_stream,
                )
                provider_config = active_cfg
            else:
                outcome = call_model(provider_config, working_messages, tools, cancel_event, _on_delta, _on_reasoning)
        except AgentError as err:
            emit({"type": "turn.error", "requestId": request_id, "error": err.to_dict()})
            return {
                "ok": False,
                "finishReason": "error",
                "content": final_content,
                "reasoning": final_reasoning,
                "usage": total_usage,
                "steps": executed_steps,
                "compression": compression_stats,
            }

        for k in ("promptTokens", "completionTokens", "totalTokens"):
            total_usage[k] += int(outcome.usage.get(k, 0))
        if outcome.reasoning:
            final_reasoning += outcome.reasoning

        if outcome.aborted or cancel_event.is_set():
            finish_reason = "cancelled"
            break

        if outcome.content and RepetitionGuard.is_runaway_text(outcome.content):
            emit({
                "type": "turn.error",
                "requestId": request_id,
                "error": AgentError(
                    "REPETITION_LOOP",
                    "Model entered a repetitive output loop; stopped safely.",
                    retryable=False,
                ).to_dict(),
            })
            return {
                "ok": False,
                "finishReason": "repetition_loop",
                "content": outcome.content[:600],
                "reasoning": final_reasoning,
                "usage": total_usage,
                "steps": executed_steps,
                "compression": compression_stats,
            }

        if not outcome.tool_calls:
            final_content = outcome.content
            finish_reason = outcome.finish_reason or "stop"
            break

        # Append assistant message with tool_calls for the next iteration
        working_messages.append({
            "role": "assistant",
            "content": outcome.content or "",
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.name, "arguments": tc.arguments_json},
                }
                for tc in outcome.tool_calls
            ],
        })

        for tc in outcome.tool_calls:
            if cancel_event.is_set():
                finish_reason = "cancelled"
                break

            can_tool, tool_reason = budget.can_run_tool()
            if not can_tool:
                working_messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": json.dumps({"ok": False, "error": tool_reason}),
                })
                continue

            parsed_args = tc.parsed_args()
            if repetition.record_and_check_tool(tc.name, parsed_args):
                err_msg = f"Blocked repeated identical call to '{tc.name}'. Try a different approach or summarize."
                working_messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": json.dumps({"ok": False, "error": err_msg}),
                })
                executed_steps.append({"tool": tc.name, "status": "blocked", "detail": err_msg})
                continue

            budget.record_tool_call()
            call_id = tc.id or f"call_{uuid.uuid4().hex[:10]}"
            emit({
                "type": "task.step",
                "requestId": request_id,
                "step": {"id": call_id, "title": f"Request {tc.name}", "status": "running", "toolName": tc.name},
            })

            tool_resp = request_tool_execution(call_id, tc.name, parsed_args, tool_timeout_s)
            if cancel_event.is_set():
                finish_reason = "cancelled"
                break

            ok = bool(tool_resp.get("ok", False))
            raw_content = str(tool_resp.get("content", ""))
            safe_content = bound_error_text(raw_content, 12_000 if ok else 2_048)
            status_label = "verified" if ok else ("denied" if tool_resp.get("denied") else "failed")
            executed_steps.append({"id": call_id, "tool": tc.name, "status": status_label, "detail": safe_content[:180]})
            emit({
                "type": "task.step",
                "requestId": request_id,
                "step": {"id": call_id, "title": f"Completed {tc.name}", "status": status_label, "toolName": tc.name},
            })
            working_messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": json.dumps({
                    "ok": ok,
                    "untrustedToolOutput": safe_content,
                    **({"denied": True} if tool_resp.get("denied") else {}),
                }, ensure_ascii=False),
            })

        if finish_reason == "cancelled":
            break

    emit({
        "type": "turn.complete",
        "requestId": request_id,
        "content": final_content,
        "reasoning": final_reasoning,
        "finishReason": finish_reason,
        "usage": total_usage,
        "steps": executed_steps,
        "compression": compression_stats,
    })
    return {
        "ok": finish_reason != "cancelled",
        "finishReason": finish_reason,
        "content": final_content,
        "reasoning": final_reasoning,
        "usage": total_usage,
        "steps": executed_steps,
        "compression": compression_stats,
    }
