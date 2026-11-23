# Hermes Desktop Architecture (Electron, TypeScript, React & Python Gateway)

Source authority: `apps/desktop/DESIGN.md`, `apps/desktop/docs/canonical-gateway-protocol.md`, `apps/desktop/electron/backend-ownership.ts`, `apps/desktop/package.json`, `tui_gateway/server.py`, plus **REA MCP static analysis**:
- Electron slice (`api-transport.ts`, `backend-child.ts`, `backend-health.ts`, `backend-ownership.ts`, `window-open-policy.ts`, `window-controls.ts`): parent Evidence `ev_845b4b88b06113608ed413514591952f5137e8f2658c76e58331b87405e534de`, view `ev_a1dd461517ef623229ab5ea3a60355fd5ea98c94a3f490cf28cfb6858bfdd939` (6/6 parsed, 3,809 AST nodes, 23 boundary relations, 22 promise relations).
- Renderer slice (`hermes.ts`, `entry.ts`, `main.tsx`): parent Evidence `ev_07250be5667d16cb33969a3a7bb250b5968018183af58c8bd73a6b246ced4d05`, view `ev_9a9c678827f3b621ee945a9bf9eafb7b453a7d0676e92ec52e1e81ecca4cc904` (3/3 parsed, 751 AST nodes, 206 findings).

## 1. Electron-to-Python Transport & Lifecycle
1. **Independent Gateway Ownership (`canonical-gateway-protocol.md` & `backend-ownership.ts`):**
   - Electron does not blindly kill or orphan its Python backend. `BackendOwnershipEntry` records `{ pid, startMarker, nonce, profile, parentPid, parentStartMarker }` so PID reuse on Windows is never mistaken for a live Hermes process.
   - `REAP_ORPHANS_DEADLINE_MS = 5_000` caps orphan cleanup at startup (critical on Windows where PowerShell process probes are slow), preserving unprocessed entries for the next boot.
   - Corrupt ownership files are **quarantined** (renamed to `.corrupt`), never treated as empty `[]` (prevents leaked processes).
2. **Per-Request Ephemeral Session Tickets:**
   - `gateway ensure --json` returns a credential-free local endpoint.
   - Electron main mints scoped `session-ticket` grants (`interactive` for WS, `native-http` for HTTP) sent exclusively in `X-Hermes-Gateway-Ticket` header — never exposed to renderer URLs or public descriptors.
3. **Crash Forensics (`tui_gateway/server.py`):**
   - Installs a global `_panic_hook` writing full tracebacks to `~/.hermes/logs/tui_gateway_crash.log` plus a single-line `[gateway-crash]` summary on stderr (because stdout is the JSON-RPC pipe).
4. **Windows-Specific Engineering in `apps/desktop/electron/`:**
   - Dedicated modules for `windows-child-options.ts`, `windows-sandbox-fallback.ts`, `windows-stack-cookie-fallback.ts`, `windows-backdrop.ts`, `window-open-policy.ts`, `window-controls.ts`, and `msix` packaging.

## 2. Comparison with Pixel's Current Python Bridge
- Pixel's current `python/agent_service.py` + `src/main/services/pythonAgentBridge.ts` is an **advisory-only** `pixel-agent-v1` stdio JSONL prototype (`ping`, `plan_turn`, `score_memory`, `shutdown`).
- To evolve it into Pixel's real agent runtime (`pixel-agent-v2`) in Phase A:
  - Add streaming NDJSON event frames (`turn.delta`, `turn.reasoning`, `tool.request`, `tool.result`, `task.step`, `turn.complete`, `turn.error`).
  - Keep **bidirectional tool authorization**: Python emits `tool.request` -> Electron main evaluates `PermissionBroker` (and prompts user if needed) -> Electron executes or authorizes -> returns `tool.response` to Python.
  - Adopt Hermes's **ownership file + PID/startMarker verification + quarantine + crash log** pattern so Pixel never leaks orphan Python workers on Windows.
  - **Preserve Pixel's approved UI & Settings design:** Do NOT adopt Hermes branding or replace Pixel's approved 11-category flat Settings, Pix mascot, Pixel Board, or blue `#4299F5` matte theme.
