# Language Distribution & Dependency Analysis

Source authority: `pyproject.toml`, `apps/desktop/package.json`, and `git ls-files` scan of `NousResearch/hermes-agent@0f602c5f`.

## 1. Language Split & Architectural Roles
- **Python (12,851 files — 46.8%):** Entire agent runtime (`run_agent.py`, `agent/`), tool registry & toolsets (`tools/`, `model_tools.py`, `toolsets.py`), memory, skills, plugins (`hermes_cli/plugins.py`, `plugins/`), cron scheduler (`cron/`), SQLite persistence (`persistence/`), local RPC gateway (`tui_gateway/`), messaging gateway (`gateway/`), and 9,241 Python tests.
- **TypeScript & TSX (5,703 files — 20.8%):** Electron desktop shell (`apps/desktop/electron`, `apps/desktop/src`), shared contracts, TUI (`ui-tui`), and Vitest/Playwright tests.
- **YAML & Markdown (4,432 files — 16.1%):** Declarative plugin catalog (2,579 YAML), skills, docs.

## 2. Dependency Hygiene Lessons from Hermes `pyproject.toml`
1. **Exact Version Pinning (`==X.Y.Z`):** Every core Python dependency is exact-pinned (citing a real 2026 supply-chain incident) with `uv.lock` reproducibility.
2. **Minimal Core Blast Radius:** Core dependencies include only packages needed by every session (`openai`, `httpx`, `pydantic`, `ruamel.yaml`, `truststore`, `croniter`, `snowballstemmer`, `firecrawl-anydoc`, `tzdata`, `cryptography`). Provider-specific SDKs (`anthropic`, `exa-py`, `edge-tts`, `mcp`, etc.) live in optional extras.
3. **Windows-Specific Pins:** `tzdata` is mandatory on Windows for Python `zoneinfo` (cron schedules); `truststore` bridges Windows OS root certs; `ruamel.yaml.clib` has explicit Windows AMD64 wheel markers.

## 3. Recommended Language Split for Pixel (Incremental, No Big-Bang Rewrite)
- **Keep in TypeScript / Electron:** Main-process `PermissionBroker`, DPAPI `SettingsStore`, `WindowManager` (Dynamic Island, Cursor Buddy, Guidance Overlay, Workspace), `PixelBoardService`, React 19 UI, IPC bridge.
- **Keep in C#/.NET (`PixelNative.exe`):** Windows UI Automation (`find_elements`, `invoke`, `control`, foreground tracking, power status) — already native, fast, and battle-tested.
- **Evolve in Python (`python/`):** Core AI agent loop (`pixel-agent-v2`), provider adapters, context compression, selective memory & `session_search`, procedural `SKILL.md` engine, cron scheduler, MCP client, and developer/document extraction tools — packaged reproducibly for Windows with pinned `pyproject.toml` + `uv.lock` and a TypeScript fallback rollback switch.
