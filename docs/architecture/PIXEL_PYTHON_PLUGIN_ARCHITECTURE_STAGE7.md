# Pixel — Stage 7 Python-First Plugin & Capabilities Architecture

**Hermes Reference Revision:** `352b249f67fb6a4a7d7904acaca9dd410db229e0` (external checkout at `C:\dev\pixel-research\hermes-agent`)  
**Stage 8 Status:** Not started (per directive).

---

## 1. Python-First Plugin Engine (`python/pixel_agent/`)
- **[plugin_manifest.py](../../python/pixel_agent/plugin_manifest.py):** Parses Hermes-compatible `plugin.yaml` and `plugin.json` manifests (v1/v2), validates `config_schema`, and performs topological dependency resolution with cycle detection.
- **[plugin_sdk.py](../../python/pixel_agent/plugin_sdk.py):** Narrow, versioned `PluginContext` (`register_tool`, `unregister_tool`, `register_hook`, `register_provider`, `register_skill`, `get_config`, `has_plugin`, `on_unload`) with host-owned cleanup ledger.
- **[plugin_host.py](../../python/pixel_agent/plugin_host.py):** Isolated subprocess plugin host (`python -m pixel_agent.plugin_host`) communicating over private NDJSON stdio with per-call timeouts, crash recovery, and clean teardown on disable/Emergency Stop.
- **[plugin_manager.py](../../python/pixel_agent/plugin_manager.py):** Authoritative manager for discovery, transactional install/update with automatic rollback on failure, enable/disable, uninstall, schema-validated live configuration, hook dispatch, live Toolsets, and Skills Hub.

## 2. Electron & Capabilities Integration
- **Dynamic Tool Registration (`src/main/ipc.ts`, `src/main/agent/executors.ts`):** `syncPythonPluginTools()` projects active Python plugin tools into `ToolRegistry` (enforcing `PermissionBroker` approvals and revoking grants on disable/uninstall). `ToolExecutors` routes `plugin_*` tool calls directly through `PythonAgentBridge.pluginInvokeTool()`.
- **Capabilities Workspace (`src/renderer/components/WorkspacePluginManager.tsx`):** Preserves bundled plugins, GitHub/Google Calendar connectors, and MCP servers while adding the monochrome **Capabilities Hub** with `Python Plugins` (local install/enable/disable/uninstall), `Skills Hub` (catalog install/remove), and `Toolsets` (live tool counts & enable/disable toggles) + search.
- **Stage 4–6 Preload Closure:** Exposed `terminal.openShell/write/resize/read/close`, `browser.sessions`, `voiceContinuousStart/Stop/Frame/State`, and `voiceGptLiveOffer` in `src/preload/index.ts`, plus `GptLiveWebRtcSession` & `ContinuousVoiceClient` in `src/renderer/lib/voiceSession.ts`.
