# Pixel Phase D — Plugin System, MCP Client & External Integrations

**Status:** Implemented & verified locally (uncommitted)  
**Base Commit:** `6b73bbd75ae5366a8afc756a0a528ec743bef6e3` (Windows CI `45195758066` green)  
**Schema Version:** SQLite Migration `15` (`mcp-servers-registry`)

---

## 1. Architecture Overview

Phase D upgrades Pixel's plugin foundation into an extensible **Model Context Protocol (MCP)** and **OAuth 2.0 PKCE** integration platform while keeping Electron main's `PermissionBroker` as the sole authorization authority:

```
Model (TS AgentExecutor OR Python pixel-agent-v2)
   │  tool call (e.g., mcp.demo.echo_note / gcal_list_events / github_repo_summary)
   ▼
Electron Main — ToolRegistry + PermissionBroker (SINGLE AUTHORITY)
   │  Validates schema, enforces mode/project availability, prompts user if required
   ▼
ToolExecutors
   ├── Bundled Tier-1 Plugins (reviewed adapters)
   │     ├── pixel.github-public    ──► src/main/plugins/github.ts (13 tools, DPAPI PAT)
   │     └── pixel.google-calendar  ──► src/main/plugins/googleCalendar.ts (7 tools, DPAPI OAuth PKCE)
   └── External Tier-2 MCP Servers
         └── McpServerManager (src/main/plugins/mcpManager.ts)
               ├── Stdio transport (argument-vector spawn, shell=False, restricted env)
               └── Streamable HTTP (2025-03-26 / 2024-11-05, HTTPS, Mcp-Session-Id, JSON + SSE)
```

A matching zero-dependency Python MCP client (`python/pixel_agent/mcp_client.py`) and supply-chain preflight (`python/pixel_agent/osv_preflight.py`) are also implemented and tested under `python/tests/test_mcp_client.py`.

---

## 2. Supported MCP Transports & Protocol Versions

- **Protocol versions tested:** `2025-03-26` (primary) and `2024-11-05` (backward-compatible). Unsupported protocol versions are rejected cleanly with `PROTOCOL_MISMATCH`.
- **Stdio (`StdioMcpTransport` / `McpServerManager`):** Argument-vector spawn (`shell: false`, `windowsHide: true`), restricted environment inheritance (`SAFE_ENV_KEYS` only), 2 MiB NDJSON frame cap, request timeouts, `notifications/cancelled`, and clean process termination on disable/shutdown.
- **Streamable HTTP (`StreamableHttpMcpTransport` / `McpServerManager`):** HTTPS required for all remote servers (`http://` permitted only for loopback `127.0.0.1` / `localhost`), `MCP-Protocol-Version` & `Mcp-Session-Id` headers, JSON and `text/event-stream` SSE response parsing, redirect blocking (3xx refused to prevent credential leakage), SSRF private-IP DNS check, and `DELETE` session teardown.

---

## 3. Dynamic Tool Registration & Per-Project Scoping

- Discovered MCP tools are namespaced as `mcp.<serverId>.<toolName>` so external servers can **never** overwrite built-in Pixel tools.
- Remote tool descriptions and annotations are treated as untrusted metadata and **never** bypass `PermissionBroker` (`requiresApproval: true` always).
- Per-project availability (`allowed_projects_json` on `mcp_servers` and `plugin_project_availability` on bundled plugins) is enforced directly in `ToolRegistry`'s availability predicate. Disabling, removing, or narrowing project scope immediately unregisters tools and calls `permissions.revokeForTool(...)`.

---

## 4. OAuth 2.0 PKCE & Google Calendar Integration

- **`src/main/plugins/oauth.ts`:** Standards-based Authorization Code + PKCE (`S256`), loopback-only redirect URI validation, timing-safe `state` verification, token expiry/refresh helpers, and `assertTokenAudience()` preventing token passthrough to unintended hosts.
- **`src/main/plugins/googleCalendar.ts` & `GOOGLE_CALENDAR_PLUGIN`:** Official Google Calendar REST v3 adapter (`gcal_list_calendars`, `gcal_list_events`, `gcal_search_events`, `gcal_get_event`, `gcal_create_event`, `gcal_update_event`, `gcal_delete_event`). Starts with `calendar.readonly`; write operations require `calendar.events` scope AND `PermissionBroker` approval.
- **Credentials:** Stored encrypted via Electron `safeStorage` (Windows DPAPI) in `SettingsStore` (`credentials/oauth-google-calendar.key`). Never written to SQLite, renderer state, or logs.
- **Live Acceptance Note:** Live Google Calendar OAuth requires setting a user-owned Google Cloud Desktop OAuth Client ID (`PIXEL_GOOGLE_OAUTH_CLIENT_ID`). All OAuth PKCE, refresh, scope, and Calendar API flows are verified deterministically against fixtures in `tests/phase-d-mcp-plugins.test.ts`.

---

## 5. Measured Performance Benchmarks (Windows)

Measured against a real disposable local Python stdio MCP server via `McpServerManager`:
- Cold stdio MCP startup + `initialize` (`2025-03-26`) + `tools/list` discovery: **314.8 ms**
- Warm MCP `tools/call` round-trip latency: **2.6 ms**
- Clean child process teardown (`disposeAll`): **0.9 ms**
- Lazy startup: MCP servers are **never** auto-started at Pixel launch unless explicitly enabled.

---

## 6. Adding a Custom MCP Server or Bundled Plugin

- **Custom MCP Server:** Open **Settings → Plugins & Connections → Connections & MCP Servers → Add MCP server**, enter a slug ID, display name, transport (`stdio` command vector or `https://` Streamable HTTP URL), review the trust warning, and click **Enable**.
- **New Bundled Provider Adapter:** Implement a provider client in `src/main/plugins/<provider>.ts` using `src/main/plugins/oauth.ts` and `SettingsStore.setProviderSecret('<providerId>', ...)`, declare its manifest in `src/main/plugins/manifest.ts`, and add dispatch cases in `src/main/agent/executors.ts`.
