# Pixel — Python-First Architecture

**Repository:** `https://github.com/cypskip-create/Pixel`  
**Hermes Reference Checkout (external):** `C:\dev\pixel-research\hermes-agent` (`352b249f67fb6a4a7d7904acaca9dd410db229e0`)  
**Default Runtime:** `python` (`DEFAULT_SETTINGS.agent.runtimeEngine = 'python'`)

---

## 1. Authoritative Language Responsibilities

| Layer | Language | Responsibilities |
|---|---|---|
| Core Intelligence & Multimodal | **Python** (`python/pixel_agent/`) | Default agent loop (`loop.py`), multi-provider streaming & fallbacks (`providers.py`), context compression (`compressor.py`), iteration/repetition budgets (`budgets.py`), multimodal tool image forwarding + vision capability checks + image history budget + pure-Python Set-of-Marks PNG annotation + image generation (`multimodal.py`), cloud STT/TTS routing + GPT-Live SDP negotiation (`voice.py`), MCP client (`mcp_client.py`), concurrent NDJSON stdio protocol server (`protocol.py`) |
| Desktop Shell & Trust Boundary | **TypeScript / Electron** (`src/main/`, `src/renderer/`, `src/preload/`) | Electron main lifecycle, windowing, React monochrome UI, preload bridge, `PermissionBroker` & `ToolRegistry` authorization boundary, `TerminalService` process/shell lifecycle, `BrowserSessionManager` Playwright/CDP lifecycle, `ComputerUseController` session-scoped snapshot routing, `VoiceService` local Windows/Kokoro playback, SQLite persistence & DPAPI `safeStorage` |
| Native Windows Platform | **C#** (`native/PixelNative/PixelNative.cs`) | Windows UI Automation tree inspection, `PrintWindow` HWND-revalidated screenshots, `InvokePattern`/`ValuePattern`/`ScrollPattern` background controls, and explicit foreground-approved Win32 `focus_window`, `mouse_action`, and `send_keys` |

## 2. Security & Trust Boundaries
- Python **never** executes privileged OS, file, Git, browser, or UIA mutations directly.
- Every `tool.request` frame from `python/pixel_agent/protocol.py` passes through `PythonAgentRunner` → `ToolRegistry.validateArgs` → `ToolRegistry.evaluate` → `PermissionBroker.ask` → `ToolExecutors.run` with a **trusted runtime `ownerId`** (never model-supplied arguments).
- API keys are stored encrypted via Electron `safeStorage` (Windows DPAPI), transmitted strictly in-memory over private stdio per request, and never written to disk, argv, logs, or renderer state.
- `PythonAgentRunner` supports **true concurrent sessions** (`Map<string, { controller, ownerId }>`) so independent Workspace tabs and split panes run in parallel without blocking or colliding.

## 3. Database Ownership
- Electron main (`src/main/data/database.ts`, SQLite) remains the single authoritative owner of persisted user settings, projects, conversation history, memory, skills, tasks, permissions, and audit logs. No second competing database was created.
