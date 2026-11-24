# Pixel — Stage 7 Capabilities Acceptance Evidence

## Verified Production Acceptance Flows
1. **Python Unit & Subprocess Host Acceptance (`python/tests/test_stage7_plugins.py`):**
   - Local `plugin.yaml` discovery & schema validation
   - Invalid manifest version rejection & dependency cycle detection
   - Install → enable → subprocess `plugin_host` load → live `invoke_tool`
   - Live `configure` setting update affecting tool output immediately
   - Subprocess crash recovery (automatic host restart on next call)
   - Restart persistence (`PluginManager` re-instantiation preserves enabled plugins & settings)
   - Transactional update (v1.0.0 → v1.1.0) & automatic rollback on broken v2.0.0 update
   - Disable removes tools; uninstall removes plugin completely
   - Toolsets enable/disable + Skills Hub install/remove + Emergency Stop
2. **Electron Bridge & ToolExecutors Integration (`tests/stage7-python-plugins-capabilities.test.ts`):**
   - Real `PythonAgentBridge` (`python/agent_service.py`) over NDJSON stdio
   - Dynamic `plugin_calc_ext_scale` tool invoked end-to-end through `ToolExecutors.run()`
   - Live setting update, Toolsets, Skills Hub, disable & uninstall
   - Renderer `GptLiveWebRtcSession` and `ContinuousVoiceClient` error/lifecycle handling
