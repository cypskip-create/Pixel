# Pixel MCP & Plugin Security Architecture

## 1. Trust Tiers (Honest Isolation Boundaries)

Pixel enforces two explicitly distinguished trust tiers:

| Tier | Examples | Execution Boundary | Permission Model |
| :--- | :--- | :--- | :--- |
| **Tier 1 — Bundled & Reviewed** | `pixel.github-public`, `pixel.google-calendar` | Declarative TypeScript adapters inside Electron main; DNS-pinned public HTTPS APIs only. | `ToolRegistry` schema validation + `PermissionBroker` + per-project availability. |
| **Tier 2 — External Untrusted MCP** | User-configured local `stdio` or remote `https://` MCP servers | Separate OS child process (restricted env, `shell: false`) or remote HTTPS service. | Collision-safe `mcp.<id>.<tool>` namespace; always `requiresApproval: true`; untrusted output framing. |

**Important Honesty Guarantee:** A local OS child process is **not** a kernel sandbox. Pixel explicitly displays this warning in Settings before enabling any external local MCP server and requires explicit user trust confirmation.

## 2. Supply-Chain & Transport Hardening

1. **Command Preflight (`osv_preflight.py` & `mcpManager.ts`):**
   - Rejects shell interpreters (`cmd.exe`, `powershell.exe`, `pwsh`, `sh`, `bash`, `wscript`, `mshta`).
   - Rejects unpinned auto-installers (`npx`, `uvx`, `pipx`).
   - Supports bounded 12-second OSV vulnerability lookups (`https://api.osv.dev/v1/query`) for pinned packages (advisory; a clean OSV check does not guarantee safety).
2. **Environment Isolation:** Local stdio MCP processes inherit only minimal OS variables (`PATH`, `SYSTEMROOT`, `TEMP`, `TMP`, `PYTHONUTF8`, etc.) — parent API keys (`DEEPSEEK_API_KEY`, etc.) are never inherited.
3. **Remote HTTP Hardening:**
   - Remote endpoints must use `https://` (`http://` allowed only on `127.0.0.1` / `localhost`).
   - Embedded URL credentials (`https://user:pass@...`) are rejected.
   - HTTP 3xx redirects are blocked so Bearer tokens are never forwarded to another host.
   - Non-localhost hostnames are DNS-checked via `isPrivateHost()` to block SSRF to loopback/RFC1918/link-local addresses.
4. **Credential & Grant Lifecycle:**
   - All tokens are encrypted via Electron `safeStorage` (Windows DPAPI); zero raw secrets in SQLite or renderer IPC.
   - `assertTokenAudience()` prevents OAuth token passthrough across hosts.
   - Disabling, removing, or narrowing project scope of any plugin or MCP server immediately revokes all active grants via `PermissionBroker.revokeForTool(...)`.
