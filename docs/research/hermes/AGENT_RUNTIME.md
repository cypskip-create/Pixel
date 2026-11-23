# Core Python Agent Runtime (`run_agent.py` & `agent/conversation_loop.py`)

Source authority: `run_agent.py`, `agent/conversation_loop.py`, `agent/turn_*.py`, `agent/prompt_builder.py`, `agent/iteration_budget.py`, `agent/repetition_guard.py`, `agent/tool_guardrails.py`.

## 1. Conversation Loop Lifecycle

`AIAgent.run_conversation(...)` delegates to `agent/conversation_loop.py::run_conversation(agent, ...)`, which binds its phase helpers at import time so an on-disk `hermes update` cannot load skewed phases mid-turn:

```mermaid
sequenceDiagram
  participant Caller as CLI / tui_gateway / Cron
  participant Agent as AIAgent (run_agent.py)
  participant Loop as conversation_loop.py
  participant Prompt as prompt_builder.py
  participant Comp as context_compressor.py
  participant LLM as Provider Adapter
  participant Tools as model_tools.py / registry.py
  participant Gate as tools/approval.py
  participant DB as persistence/ (SQLite WAL)

  Caller->>Agent: run_conversation(user_message)
  Agent->>Loop: build_turn_context() + begin_fast_mode_turn()
  Loop->>Prompt: Assemble system prompt (identity + frozen memory + skills index + threat-scanned AGENTS.md)
  Loop->>Comp: run_preflight_gate() (prune stale tool outputs / compress if near context limit)
  loop While IterationBudget remaining & not interrupted
    Loop->>Loop: prepare_iteration() + assemble_api_request()
    Loop->>LLM: perform_api_call() (streaming + stale-stream watchdog + rate-limit guard)
    LLM-->>Loop: normalize_model_response() (text, reasoning, tool_calls)
    Loop->>Loop: check_api_response() + is_runaway_repetition()
    alt Has tool_calls
      Loop->>Tools: run_tool_round() -> coerce_tool_args() -> ToolGuardrailDecision
      Tools->>Gate: check_all_command_guards() / request_tool_approval()
      Gate-->>Tools: allow / deny / staged
      Tools-->>Loop: bounded JSON tool result (errors capped at 2048 chars)
      Loop->>Loop: Check wall-clock budget (80% -> append RUN_BUDGET_WRAPUP_NOTICE)
    else Final text response
      Loop->>Loop: finish_text_response()
    end
  end
  Loop->>DB: finalize_turn() -> persist messages, usage, activity provenance
  Loop-->>Caller: Final response + session metadata
```

## 2. Deterministic Code vs. Model-Emergent Behavior

| Behavior | Implemented in Deterministic Code | Emergent from Model Prompt |
| --- | --- | --- |
| **Iteration & Wall-Clock Limits** | `IterationBudget`, `RUN_BUDGET_WRAPUP_NOTICE` at 80% budget | Model chooses how to wrap up cleanly |
| **Runaway Repetition Protection** | `agent/repetition_guard.py::is_runaway_repetition()` | — |
| **Tool Argument Coercion & Validation** | `tools/arg_coercion.py::coerce_tool_args()`, JSON schema validation | Model supplies arguments |
| **Tool Approval & Hardline Blocks** | `tools/approval.py`, `tools/approval_detection.py`, denial circuit breaker | Model explains why it needs a tool |
| **Context Compression & Pruning** | `agent/context_compressor.py` (deterministic pruning + aux LLM summary + deterministic fallback) | Aux model writes summary prose |
| **Task Decomposition & Replanning** | `tools/todo_tool.py` (`todo_list` state) + `delegate_task` child lifecycle | Model decides plan steps & when to delegate |
| **Prompt Injection Defense on Context Files** | `agent/prompt_builder.py::_scan_context_content()` via `tools/threat_patterns.py` | System prompt instructs treating external text as data |

## 3. Key Resilience Patterns Worth Adopting in Pixel
- **5-second threaded context-file read timeout** (`prompt_builder.py::_read_text_with_timeout`) prevents OneDrive/cloud-evicted files from stalling agent startup on Windows.
- **Dispatch-boundary error cap** (`_MAX_TOOL_ERROR_CHARS = 2048`) prevents huge stack traces from bloating context across retries.
- **Persistent event loops** (`model_tools.py::_get_tool_loop` / `_get_worker_loop`) prevent `Event loop is closed` crashes on cached `httpx`/`AsyncOpenAI` clients.
- **80% budget wrap-up notice** lets the model produce a clean summary instead of hard-failing mid-tool-chain.
