# Pixel Phase A — Python Agent Engine (`pixel-agent-v2`)

**Status:** Implemented & verified locally (uncommitted)  
**Base Commit:** `0d21e5c6ef7c04a604893fb1835298300e65bd89`  
**Protocol:** `pixel-agent-v2` (NDJSON over stdio; backward-compatible with `pixel-agent-v1` helpers)  
**Default Runtime:** `typescript` (`settings.agent.runtimeEngine = 'typescript'`) with opt-in `python` and `PIXEL_AGENT_RUNTIME=python` dev override.

---

## 1. Architecture Overview

Phase A upgrades Pixel's advisory-only `python/agent_service.py` prototype into a real, Hermes-inspired, model-driven streaming Python agent runtime (`python/pixel_agent/`) while preserving **Electron main's `PermissionBroker`, `ToolRegistry`, `TaskManager`, and `AuditLog`** as the sole privileged execution authority.

```
Renderer (Workspace / Settings)
   │  IPC: chat:send / chat:cancel / chat:stream / permissions:*
   ▼
Electron Main (src/main/ipc.ts)
   ├── runtimeEngine === 'typescript' (default) ──► AgentExecutor (TypeScript)
   └── runtimeEngine === 'python'               ──► PythonAgentRunner (src/main/agent/pythonRunner.ts)
                                                         │  Pre-turn ping check; auto-fallback to TS if unavailable
                                                         ▼
                                                    PythonAgentBridge (src/main/services/pythonAgentBridge.ts)
                                                         │  Private stdio NDJSON (pixel-agent-v2, 4 MiB cap)
                                                         │  Ownership file + .corrupt quarantine + crash log
                                                         ▼
                                                    python/agent_service.py → pixel_agent.protocol
                                                         ├── providers.py (SSE streaming: DeepSeek, OpenAI-compat, Ollama)
                                                         ├── loop.py (multi-step model/tool loop)
                                                         ├── compressor.py (2-stage pruning + middle summary)
                                                         ├── budgets.py (80% wrap-up notice + RepetitionGuard)
                                                         ├── errors.py (secret redaction + 2048-char bounding)
                                                         └── crash_log.py (stderr + redacted crash log file)
```

### Zero-Dependency Windows Portability
`python/pyproject.toml` declares zero mandatory third-party runtime dependencies for Phase A: `providers.py` uses Python 3 standard-library `urllib.request`, `ssl`, `json`, and `threading` for SSE streaming, which runs immediately on Windows Python `3.11–3.15` (verified on `3.15.2`) without native wheel friction.

---

## 2. `pixel-agent-v2` NDJSON Protocol

All frames are newline-delimited JSON over UTF-8 stdio (`PYTHONUTF8=1`). `stdout` is strictly reserved for protocol frames; diagnostics and redacted crash summaries go to `stderr` and an optional crash log file (`PIXEL_AGENT_CRASH_LOG`).

| Direction | Frame `type` / `method` | Purpose |
| :--- | :--- | :--- |
| Electron → Python | `ping` | Health handshake; returns `protocol: "pixel-agent-v2"`, `supportedProtocols`, `pid`, `python`, `authority: "main-process-broker"`. |
| Electron → Python | `turn.start` | Starts a model-driven turn on a background worker thread with `requestId`, `messages`, `tools`, `provider` (ephemeral in-memory `apiKey`), and `budgets`. |
| Python → Electron | `turn.delta` / `turn.reasoning` | Live streamed text and reasoning deltas mapped directly to Pixel `StreamEvent`s. |
| Python → Electron | `task.step` | Live step status notifications. |
| Python → Electron | `tool.request` | Requests Electron main to authorize and execute a tool (`callId`, `name`, `args`). Python blocks only that turn worker until `tool.response` arrives or cancels. |
| Electron → Python | `tool.response` | Returns correlated `{ callId, ok, content, denied }` after `ToolRegistry.validateArgs`, `ToolRegistry.evaluate`, `PermissionBroker.ask`, and `ToolExecutors.run`. |
| Electron → Python | `turn.cancel` | Signals the turn's `threading.Event`, aborts active HTTP streaming, and unblocks any pending tool waiter. |
| Python → Electron | `turn.complete` / `turn.error` | Finalizes the turn with `content`, `reasoning`, `finishReason`, `usage`, `steps`, and `compression` stats (or structured redacted error). |
| Electron → Python | `plan_turn`, `score_memory`, `shutdown` | Backward-compatible v1 helper RPCs and graceful exit. |

Protocol hardening:
- Unsupported `protocol` values are rejected with a structured error (`ok: false`).
- Malformed JSON lines return a structured error without crashing the event loop.
- Stdout frame buffers are capped at **4 MiB** on both sides.

---

## 3. Security & Trust Boundaries

1. **PermissionBroker Authority:** Python has zero direct access to Windows UIA, `PixelNative.exe`, filesystem writes, Git execution, or Playwright. Every `tool.request` passes through Electron main's `ToolRegistry.validateArgs`, `ToolRegistry.evaluate`, `PermissionBroker.ask` (including single-use `once` grant recheck), `TaskManager`, and `AuditLog`.
2. **Credential Handling:** API keys stay encrypted in Electron `safeStorage` (DPAPI). Keys are passed only in-memory inside `turn.start` over private stdio pipes—never written to disk, command-line arguments, environment variables, crash logs, renderer IPC, or audit records.
3. **Secret Redaction & Bounded Errors:** `pixel_agent/errors.py` scrubs `Bearer ...`, `sk-...`, `ghp_...`, and `api_key=...` patterns and caps tool errors at 2048 characters.
4. **Crash & Ownership Hardening:** `PythonAgentBridge` records `{ instanceId, pid, startMarker, parentPid, parentStartMarker }` in `<userData>/runtime/python-agent-owner.json`, quarantines corrupt files to `.corrupt` without touching unrelated processes, and attaches `child.on('error')` + `child.on('exit')`.
5. **No Blind Mutation Replay:** If Python fails pre-turn (`ping` / `ENOENT`), `PythonAgentRunner` automatically falls back to TypeScript `AgentExecutor`. If Python crashes **mid-turn** after one or more tools have run, the task is marked `failed` and already-executed tools are never replayed.

---

## 4. Context Compression, Budgets & Repetition Protection

- **IterationBudget (`budgets.py`):** Tracks `max_iterations`, `max_tool_calls`, `max_wall_ms`, and `max_context_tokens`. At 80% utilization, injects `RUN_BUDGET_WRAPUP_NOTICE` once so the model wraps up gracefully.
- **RepetitionGuard (`budgets.py`):** Detects repeated identical tool calls (default threshold: 3) and runaway repetitive text blocks.
- **Two-Stage Context Compressor (`compressor.py`):**
  1. *Stage 1:* Prunes bulky older `tool` messages into compact redacted stubs while protecting recent messages.
  2. *Stage 2:* Summarizes middle turns (optional auxiliary summarizer with deterministic fallback) wrapped in `[UNTRUSTED HISTORICAL CONTEXT SUMMARY]` framing, never splitting an assistant `tool_calls` message from its paired `tool` result messages.

---

## 5. Measured Verification & Benchmarks (Windows)

Measured on this Windows host (Python `3.15.2`, local HTTP SSE mock server, no external network):

| Metric | Measured Value |
| :--- | :--- |
| Cold Python spawn + `ping` handshake | **831.7 ms** |
| Python worker Working Set (RSS) | **23.59 MB** |
| First streamed token latency (local SSE) | **258.0 ms** |
| Tool round-trip latency (Python → Electron → Python → final SSE) | **38.9 ms** |
| Mid-stream cancellation responsiveness | **32.9 ms** |

Verification commands run:
- `npm run typecheck`: **PASS** (exit 0)
- `npm run build`: **PASS** (exit 0)
- `python -m unittest discover -s python\tests -v`: **23 passed, 0 failed** (11 `pixel_agent` + 12 voice worker tests)
- `npx vitest run tests/python-agent-bridge.test.ts tests/python-agent-parity.test.ts`: **12 passed, 0 failed** (all 10 parity scenarios + ownership/quarantine + mid-turn crash safety)
- `npm test`: **78 test files passed, 1 skipped (79 total); 1,004 tests passed, 27 skipped, 0 failed**

**Explicitly Unverified in This Environment:**
- Live cloud DeepSeek / OpenAI / Ollama provider API calls (no live API key / outbound provider test executed here).
- Live Windows Electron desktop GUI visual acceptance (Electron exits with `0x80000003` before entry in this sandboxed environment).

---

## 6. Windows Packaging Assessment (Future Phases)

| Option | Pros | Cons | Recommendation |
| :--- | :--- | :--- | :--- |
| **System Python (Phase A default)** | Zero installer bloat; works immediately with pure-stdlib `pixel_agent` on Python 3.11–3.15. | Requires Python on user's PATH; falls back to TypeScript if absent. | **Best for Phase A** (with automatic TS fallback). |
| **Bundled Embeddable Python + wheelhouse** | Deterministic version, fast startup (~300–800 ms), easy to add `mcp`, `croniter`, `tzdata` in Phases D/E, AV-friendly. | Adds ~25–40 MB to NSIS installer. | **Recommended for Phase D/E production packaging.** |
| **PyInstaller single-exe** | Single binary. | Slow cold unpack, frequent Windows Defender false positives, harder to update pure-Python modules. | Avoid unless signing + Defender submission pipeline is established. |

---

## 7. Rollback Procedure

`agent.runtimeEngine` defaults to `'typescript'`. To roll back immediately at any time:
1. In **Settings → Advanced → Diagnostics & Runtime**, set **Agent runtime engine** back to `TypeScript (default)`.
2. Ensure `PIXEL_AGENT_RUNTIME` environment variable is unset (or set to `typescript`).
3. No database schema or Workspace state migration is required for rollback.
