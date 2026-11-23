"""Streaming model provider adapters (DeepSeek, OpenAI-compatible, Ollama).

Uses Python 3 stdlib HTTP/TLS so Phase A works out of the box on Windows
without third-party wheels. Credentials arrive ONLY in-memory per turn and are
never written to disk, argv, environment variables, or logs.
"""

from __future__ import annotations

import json
import socket
import ssl
import threading
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from .errors import AgentError, bound_error_text

DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434"


@dataclass
class ProviderConfig:
    provider: str = "deepseek"
    model: str = "deepseek-flash"
    base_url: str = DEFAULT_DEEPSEEK_BASE_URL
    api_key: Optional[str] = None
    temperature: float = 1.0
    max_tokens: int = 4096
    timeout_ms: int = 60_000
    thinking: Optional[dict[str, Any]] = None


@dataclass
class ToolCallRecord:
    id: str
    name: str
    arguments_json: str

    def parsed_args(self) -> dict[str, Any]:
        try:
            parsed = json.loads(self.arguments_json or "{}")
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}


@dataclass
class ProviderTurnResult:
    content: str = ""
    reasoning: str = ""
    tool_calls: list[ToolCallRecord] = field(default_factory=list)
    finish_reason: str = "stop"
    usage: dict[str, int] = field(default_factory=dict)
    aborted: bool = False


def _resolve_chat_completions_url(config: ProviderConfig) -> str:
    base = (config.base_url or "").strip().rstrip("/")
    if not base:
        base = DEFAULT_OLLAMA_BASE_URL if config.provider == "ollama" else DEFAULT_DEEPSEEK_BASE_URL
    if base.endswith("/chat/completions"):
        return base
    if base.endswith("/v1"):
        return f"{base}/chat/completions"
    return f"{base}/v1/chat/completions"


def _classify_http_error(status: int, body: str) -> AgentError:
    snippet = bound_error_text(body, 300)
    if status == 401:
        return AgentError("UNAUTHORIZED", "Model provider rejected the API key.", retryable=False, detail=snippet)
    if status == 402:
        return AgentError("INSUFFICIENT_BALANCE", "Model provider reported insufficient balance.", retryable=False, detail=snippet)
    if status == 429:
        return AgentError("RATE_LIMITED", "Model provider rate limited this request.", retryable=True, detail=snippet)
    if 400 <= status < 500:
        return AgentError("BAD_REQUEST", f"Model provider rejected the request (HTTP {status}).", retryable=False, detail=snippet)
    return AgentError("SERVER", f"Model provider returned HTTP {status}.", retryable=True, detail=snippet)


def stream_openai_compatible(
    config: ProviderConfig,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    *,
    cancel_event: threading.Event,
    on_delta: Callable[[str], None],
    on_reasoning: Callable[[str], None],
) -> ProviderTurnResult:
    """Execute one streaming OpenAI-compatible chat completion request (DeepSeek / Ollama / local)."""
    if cancel_event.is_set():
        return ProviderTurnResult(aborted=True, finish_reason="cancelled")

    if config.provider != "ollama" and not (config.api_key or "").strip():
        raise AgentError("NO_API_KEY", f"Pixel needs an API key for provider '{config.provider}'.", retryable=False)

    url = _resolve_chat_completions_url(config)
    payload: dict[str, Any] = {
        "model": config.model,
        "messages": messages,
        "stream": True,
        "temperature": config.temperature,
        "max_tokens": config.max_tokens,
    }
    if tools:
        payload["tools"] = [
            {
                "type": "function",
                "function": {
                    "name": t["name"],
                    "description": t.get("description", ""),
                    "parameters": t.get("parameters", {"type": "object", "properties": {}}),
                },
            }
            for t in tools
            if isinstance(t, dict) and t.get("name")
        ]

    body_bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "User-Agent": "Pixel-Agent/0.2.1",
    }
    if (config.api_key or "").strip():
        headers["Authorization"] = f"Bearer {config.api_key.strip()}"

    req = urllib.request.Request(url, data=body_bytes, headers=headers, method="POST")
    timeout_s = max(2.0, config.timeout_ms / 1000.0)
    ssl_ctx = ssl.create_default_context() if url.startswith("https://") else None

    result = ProviderTurnResult()
    pending_calls: dict[int, dict[str, str]] = {}

    try:
        with urllib.request.urlopen(req, timeout=timeout_s, context=ssl_ctx) as resp:
            content_type = (resp.headers.get("Content-Type") or "").lower()
            if "text/event-stream" not in content_type:
                raw = resp.read(4_000_000).decode("utf-8", errors="replace")
                data = json.loads(raw)
                choice = (data.get("choices") or [{}])[0]
                msg = choice.get("message") or {}
                text = msg.get("content") or ""
                reasoning = msg.get("reasoning_content") or ""
                if reasoning:
                    result.reasoning = reasoning
                    on_reasoning(reasoning)
                if text:
                    result.content = text
                    on_delta(text)
                for tc in msg.get("tool_calls") or []:
                    fn = tc.get("function") or {}
                    result.tool_calls.append(
                        ToolCallRecord(
                            id=str(tc.get("id") or f"call_{len(result.tool_calls)}"),
                            name=str(fn.get("name") or ""),
                            arguments_json=str(fn.get("arguments") or "{}"),
                        )
                    )
                result.finish_reason = str(choice.get("finish_reason") or "stop")
                usage = data.get("usage") or {}
                if isinstance(usage, dict):
                    result.usage = {
                        "promptTokens": int(usage.get("prompt_tokens") or 0),
                        "completionTokens": int(usage.get("completion_tokens") or 0),
                        "totalTokens": int(usage.get("total_tokens") or 0),
                    }
                return result

            for raw_line in resp:
                if cancel_event.is_set():
                    result.aborted = True
                    result.finish_reason = "cancelled"
                    return result

                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line or line.startswith(":"):
                    continue
                if not line.startswith("data:"):
                    continue
                data_str = line[5:].strip()
                if data_str == "[DONE]":
                    break
                try:
                    chunk = json.loads(data_str)
                except json.JSONDecodeError:
                    continue

                usage = chunk.get("usage")
                if isinstance(usage, dict):
                    result.usage = {
                        "promptTokens": int(usage.get("prompt_tokens") or 0),
                        "completionTokens": int(usage.get("completion_tokens") or 0),
                        "totalTokens": int(usage.get("total_tokens") or 0),
                    }

                choices = chunk.get("choices") or []
                if not choices:
                    continue
                choice = choices[0]
                if choice.get("finish_reason"):
                    result.finish_reason = str(choice["finish_reason"])
                delta = choice.get("delta") or {}

                reasoning_piece = delta.get("reasoning_content")
                if isinstance(reasoning_piece, str) and reasoning_piece:
                    result.reasoning += reasoning_piece
                    on_reasoning(reasoning_piece)

                text_piece = delta.get("content")
                if isinstance(text_piece, str) and text_piece:
                    result.content += text_piece
                    on_delta(text_piece)

                for tc_delta in delta.get("tool_calls") or []:
                    idx = int(tc_delta.get("index", 0))
                    slot = pending_calls.setdefault(idx, {"id": "", "name": "", "arguments": ""})
                    if tc_delta.get("id"):
                        slot["id"] = str(tc_delta["id"])
                    fn = tc_delta.get("function") or {}
                    if fn.get("name"):
                        slot["name"] += str(fn["name"])
                    if fn.get("arguments"):
                        slot["arguments"] += str(fn["arguments"])

    except urllib.error.HTTPError as exc:
        body = ""
        try:
            body = exc.read(16_384).decode("utf-8", errors="replace")
        except Exception:
            pass
        raise _classify_http_error(exc.code, body) from exc
    except (TimeoutError, socket.timeout) as exc:
        raise AgentError("TIMEOUT", "Model provider request timed out.", retryable=True, detail=str(exc)) from exc
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, (TimeoutError, socket.timeout)):
            raise AgentError("TIMEOUT", "Model provider request timed out.", retryable=True, detail=str(exc)) from exc
        raise AgentError("NETWORK", "Could not reach the model provider.", retryable=True, detail=str(exc.reason)) from exc
    except Exception as exc:
        raise AgentError("UNKNOWN", "Model provider call failed.", retryable=False, detail=str(exc)) from exc

    for idx in sorted(pending_calls):
        slot = pending_calls[idx]
        if slot["name"]:
            result.tool_calls.append(
                ToolCallRecord(
                    id=slot["id"] or f"call_{idx}",
                    name=slot["name"],
                    arguments_json=slot["arguments"] or "{}",
                )
            )
    return result
