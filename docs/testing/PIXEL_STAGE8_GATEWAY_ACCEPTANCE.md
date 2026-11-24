# Pixel — Stage 8 Gateway & Stage 7 Security Acceptance Evidence

## Verified Production Acceptance Suites
1. **Python Security & Gateway Suite (`python/tests/test_stage8_gateway.py`):**
   - Verifies `_build_minimal_plugin_env()` strips `OPENAI_API_KEY`.
   - Verifies `type: "secret"` plugin settings never appear in `plugins-state.json`.
   - Verifies Skills Hub rejects `../escape` path traversal.
   - Verifies disabled toolset (`browser`) and empty allowlist `[]` block tool execution inside `run_agent_turn`.
   - Verifies full Gateway lifecycle: start on `127.0.0.1`, Telegram default-deny pairing → owner approval → message deduplication → scoped tool projection (no `process_start`), bound remote approval actor check, HTTP `/v1/sessions` 401 without token → paired device Bearer token 200 on `/v1/chat/completions`, HMAC-SHA256 webhook 401/200/409 replay rejection, and Emergency Stop blocking inbound.
2. **Electron Bridge & Live Loopback HTTP Integration (`tests/stage8-gateway-security-integration.test.ts`):**
   - Spawns real `python/agent_service.py` via `PythonAgentBridge`, starts real HTTP server on loopback, verifies `/v1/health`, 401/200 remote API auth, HMAC webhook 401/200/409, Telegram pairing → authorized reply, and Emergency Stop.
