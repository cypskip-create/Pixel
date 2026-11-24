# Pixel — Remote Access & Plugin Security Architecture

## Stage 7 Security Hardening (Prerequisite for Stage 8)
- **Minimal Allowlisted Plugin Environment (`python/pixel_agent/plugin_host.py`):** Replaced `dict(os.environ)` with `_build_minimal_plugin_env()` passing only OS runtime variables (`SYSTEMROOT`, `PATH`, `TEMP`, `PYTHONUTF8`, `PYTHONPATH`) — never leaking `OPENAI_API_KEY` or unrelated provider tokens to third-party plugins.
- **Secret Setting Protection (`python/pixel_agent/plugin_manager.py`):** Settings with `config_schema` `type: "secret"` are never written in plaintext to `plugins-state.json` or returned in plugin view projections.
- **Real Toolset Enforcement (`plugin_manager.py` + `loop.py` + `protocol.py`):** Disabled toolsets filter model tool schemas and reject execution inside `run_agent_turn`; explicit empty allowlists (`[]`) deny all tools rather than silently allowing all.
- **Skills Hub Path Containment:** Strict `SKILL_ID_RE` + canonical `resolve().relative_to(skills_dir.resolve())` prevents directory traversal.

## Stage 8 Gateway Security Boundaries
- **Default-Deny Remote Access:** Unknown remote accounts receive a one-time pairing code and cannot invoke the agent until approved by the Pixel owner.
- **Verified Identity & Project Binding:** Authorization is keyed by `(platform, account_id)` (never display name), defaults to `["read_only"]` scope, and binds explicitly to a `projectId` rather than inheriting whichever desktop project is open.
- **Loopback-First Binding & Authenticated APIs:** `GatewayHttpServer` binds strictly to `127.0.0.1` by default; `/v1/sessions` and `/v1/chat/completions` require a valid paired device bearer token (SHA-256 hashed, `hmac.compare_digest`, HTTP 401 otherwise).
- **Webhook Integrity:** HMAC-SHA256 signature verification (401 on invalid), delivery-ID replay rejection (409), 1 MiB body limit (413), per-route rate limit (429), and untrusted-payload framing.
- **Bound Remote Approvals & Emergency Stop:** Approvals verify actor identity and expiry (never accepting unverified `"yes"` chat messages); Emergency Stop shuts down the gateway, cancels pending approvals, and blocks all inbound/HTTP/webhook traffic.
