# Pixel — Python Runtime Production Acceptance

## Runtime Identity & Default Promotion
- `DEFAULT_SETTINGS.agent.runtimeEngine` is `'python'` (`src/shared/types.ts`).
- `resolveRuntimeEngine()` in `src/main/ipc.ts` defaults to `'python'` unless explicitly overridden to `'typescript'`.
- `PythonAgentBridge.diagnostics()` returns live Python process metadata (`runtime: 'python'`, `protocol: 'pixel-agent-v2'`, `pid`, `python` version, `activeTurnIds`, and capability flags).
- `PythonAgentRunner` supports concurrent sessions keyed by `requestId` (`activeRuns` map) and forwards trusted runtime `ownerId` and multimodal `image` tool attachments over NDJSON stdio.

## Verification
- Verified via real subprocess spawn (`python/agent_service.py`) in `tests/python-first-stage4-6-integration.test.ts` and `python/tests/test_python_first_stage4_6.py` (30/30 Python tests + 141/141 Vitest tests PASS).
- Full Windows CI packaging and runtime suite verified on GitHub Actions after push.
