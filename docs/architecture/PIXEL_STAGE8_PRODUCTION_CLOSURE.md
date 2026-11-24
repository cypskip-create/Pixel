# Pixel Stage 8 Production Closure

## Overview

Stage 8 production closure upgrades Pixel's Python-first Gateway (`python/pixel_agent/gateway/`) from its initial foundation to a production-hardened remote messaging, webhook, and loopback HTTP execution service.

## Closed Production Gaps

1. **Real Primary Python Agent Turn Execution (`python/pixel_agent/protocol.py`)**
   - `GatewayService` is wired with `agent_dispatch=self._dispatch_gateway_turn`.
   - `gateway:start` in `src/main/ipc.ts` calls `gatewayConfigureAgent(...)` to push the active provider configuration and tool catalog into Python.
   - Authorized inbound messages and `/v1/chat` requests execute real `run_agent_turn(...)` turns with `PluginManager.filter_tools(...)` and Electron `PermissionBroker`-governed tool calls (`self._request_tool(...)`).
   - When no provider is configured, `_dispatch_gateway_turn` fails truthfully with an explicit message instead of echoing input.

2. **Gateway-Owned Telegram Background Polling (`python/pixel_agent/gateway/runtime.py`)**
   - Added `start_telegram_polling(...)` and `stop_telegram_polling()` backed by a daemon worker thread with exponential backoff on network errors.
   - Persists `telegramLastUpdateId` in `gateway-state.json` and stops cleanly on `gateway.stop()` and `emergency_stop()`.

3. **Honest 26-Platform Inventory & Stdlib Email Adapter (`python/pixel_agent/gateway/platforms.py`)**
   - Every entry in `PLATFORM_INVENTORY` declares an explicit `supportLevel`:
     - `full_adapter`: Telegram, Discord, Slack, WhatsApp Cloud, Matrix, Email (`EmailAdapter` using stdlib `smtplib` + TLS).
     - `outbound_webhook` / `external_dep_required`: extended platforms documented honestly without claiming live bidirectional adapters where credentials or external SDKs are absent.

4. **Webhook Security & Route-Scoped Replay (`python/pixel_agent/gateway/webhooks_and_api.py`)**
   - HMAC-SHA256 signature verification runs **before** per-route rate-limit accounting so spoofed invalid-signature floods cannot DoS valid routes.
   - Replay delivery IDs are scoped strictly per route (`<route_id>:<delivery_id>`).

5. **Device Isolation, Policy-Scoped Tools & Approval Binding (`runtime.py`, `webhooks_and_api.py`)**
   - `GET /v1/sessions` returns only sessions owned by the authenticated device's `(deviceId, projectId)`.
   - `/v1/chat` computes real `allowed_tools = pairing.allowed_tools_for_user(device, available_tools)` rather than `[]`.
   - `resolve_approval` verifies both `actor_account_id` and `actor_platform`.
   - Outbound delivery uses a 3-attempt retry loop with backoff and records status (`delivery_confirmed`, `delivery_failed`, `delivery_pending_adapter`) in a persisted ledger.
   - `gateway-state.json` stores route metadata and ledger state without plaintext signing secrets.

6. **One-Time Secret Reveal UX (`src/renderer/components/Stage9Destinations.tsx`)**
   - Dedicated Messaging and Webhooks pages display newly issued paired-device bearer tokens and HMAC webhook signing secrets once with copy and explicit acknowledge/dismiss controls.
