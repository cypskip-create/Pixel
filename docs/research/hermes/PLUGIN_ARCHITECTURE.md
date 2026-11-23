# Plugin & MCP Architecture

Source authority: `hermes_cli/plugins.py`, `hermes_cli/plugins_manifest.py`, `hermes_cli/plugins_discovery.py`, `hermes_cli/plugins_loader.py`, `hermes_cli/plugins_dispatch.py`, `tools/mcp_tool.py`, `plugin-catalog/` (2,579 YAML manifests), `plugins/` (553 files).

## 1. Hermes Plugin Discovery & Lifecycle
- **Four Precedence Tiers** (later overrides earlier on key collision):
  1. Bundled `<repo>/plugins/<name>/`
  2. User `~/.hermes/plugins/<name>/`
  3. Project `./.hermes/plugins/<name>/` (**opt-in only** via `HERMES_ENABLE_PROJECT_PLUGINS`)
  4. Pip entry points (`hermes_agent.plugins` group)
- **Plugin Contract:** Directory containing `plugin.yaml` (versioned manifest + typed `config_schema`) and `__init__.py` exposing `register(ctx: PluginContext)`.
- **Capabilities Exposed to Plugins:**
  - `ctx.register_tool(...)` — cannot override built-in tools unless `plugins.entries.<id>.allow_tool_override` is explicitly set (else raises `PluginToolOverrideError`).
  - `VALID_HOOKS` / `invoke_hook(...)` — bounded by `_HOOK_CALLBACK_TIMEOUT_SECS` and `_HOOK_TIMEOUT_SUPPRESSION_SECONDS` so a slow hook cannot hang the agent; `pre_tool_call` timeout fails closed (`_PRE_TOOL_CALL_TIMEOUT_BLOCK_MESSAGE`).
  - Bounded system-prompt sections (`MAX_SYSTEM_PROMPT_SECTION_CHARS`, `MAX_SYSTEM_PROMPT_SECTIONS_TOTAL_CHARS`).
  - Middleware, slash commands, skills, and scoped provider registrars (memory/context_engine/platforms).

## 2. Hermes MCP Client (`tools/mcp_tool.py`)
- Supports **Stdio**, **Streamable HTTP** (`2025-03-26`), and legacy **SSE** servers configured in `config.yaml`.
- Runs a single daemon background event loop (`_mcp_loop`) where each server is a long-lived `MCPServerTask` (keeping `anyio` cancel scopes task-affine).
- **Supply-Chain Preflight (`_preflight_stdio_command`):** Before spawning `npx`/`uvx`/`pipx` MCP servers, runs a 12-second bounded **OSV malware check** (`tools/osv_check.py`) against the real package name, and bypasses resident `npx` parent wrappers when cached (~48 MB RAM saved per server).

## 3. Trust Boundary Assessment for Pixel (Windows Desktop)
> **Critical Security Finding:** Hermes loads Python plugins **in-process** into the agent Python interpreter. For a privileged Windows desktop app like Pixel (which holds DPAPI secrets, Windows UIA control, and local file access), loading arbitrary third-party Python code in-process with Electron main or with credential access is **unsafe**.

**Recommended Pixel Evolution:**
1. **Tier 1 (Bundled / Reviewed Python Plugins):** Run inside Pixel's Python Agent Service with declarative manifest capabilities and zero direct Electron/DPAPI/UIA access — all privileged tool calls still cross IPC to Electron main's `PermissionBroker`.
2. **Tier 2 (MCP Servers — Preferred Third-Party Extension Model):** Adopt Hermes's MCP client model (`stdio` + `Streamable HTTP` + OSV preflight + per-server tool allowlists) so third-party integrations (GitHub, Google Drive, Calendar, Email, etc.) run in isolated OS child processes with least-privilege env vars and per-project enablement.
3. **Git & GitHub First:** Expand Pixel's existing `github` plugin + `src/main/git/toolset.ts` into the reference Tier-1 plugin with OAuth/PAT stored strictly in Electron `safeStorage` (DPAPI) and injected per-request only for approved hosts.
