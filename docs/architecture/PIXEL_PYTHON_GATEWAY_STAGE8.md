# Pixel — Stage 8 Python-First Gateway Architecture

**Hermes Reference Revision:** `352b249f67fb6a4a7d7904acaca9dd410db229e0` (external checkout at `C:\dev\pixel-research\hermes-agent`)  
**Stage 9 Status:** Not started (per directive).

---

## 1. Python Gateway Package (`python/pixel_agent/gateway/`)
- **[pairing.py](../../python/pixel_agent/gateway/pairing.py):** Default-deny user pairing (`secrets` 8-char codes, TTL expiry, rate limiting, failed-attempt lockout), verified `(platform, account_id)` authorization, minimal `read_only` default remote capability scopes, explicit `projectId` binding, and cross-device pairing with SHA-256 hashed bearer tokens.
- **[platforms.py](../../python/pixel_agent/gateway/platforms.py):** `BasePlatformAdapter`, `InboundMessage`, `OutboundMessage`, full Hermes 26-platform inventory (`PLATFORM_INVENTORY`), and real stdlib HTTPS adapters for **Telegram** (`getMe`, `getUpdates`, `sendMessage` with 4096-char segmentation, inbound text/photo/voice/document normalization), **Discord**, **Slack**, **WhatsApp Cloud**, **Matrix**, and extended webhook/API platforms.
- **[webhooks_and_api.py](../../python/pixel_agent/gateway/webhooks_and_api.py):** `WebhookRegistry` (HMAC-SHA256 verification via `hmac.compare_digest`, delivery-ID replay protection, per-route rate limiting, 1 MiB body cap, event filtering, untrusted payload framing) + loopback-first `GatewayHttpServer` (`/v1/health`, `/v1/sessions`, `/v1/chat/completions`, `/webhooks/<id>`).
- **[runtime.py](../../python/pixel_agent/gateway/runtime.py):** Single authoritative `GatewayService` lifecycle with message deduplication, isolated per-chat sessions (`gw:<platform>:<account_id>:<chat_id>`), explicit delivery ledger (`agentSucceeded`, `delivery_confirmed`, `delivery_failed`, `delivery_pending_adapter`), bound remote approval records, persistent state, and Emergency Stop integration.

## 2. Electron IPC & Desktop Interface
- Wired `gateway:*` IPC channels across `src/shared/channels.ts`, `src/shared/types.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, and `src/main/services/pythonAgentBridge.ts`.
- Added monochrome **Messaging Gateway, Webhooks & Cross-Device Access** panel inside `src/renderer/components/WorkspacePluginManager.tsx` (`Messaging`, `Webhooks`, `Devices` tabs + Start/Stop Gateway + Telegram setup + Pending Pairings Approve/Reject + Webhook CRUD + Device Pair/Revoke).
