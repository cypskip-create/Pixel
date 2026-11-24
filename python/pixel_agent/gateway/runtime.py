"""Authoritative Python-First Gateway Runtime (Stage 8).

Adapted from Hermes `gateway/run.py`, `run_inbound.py`, `delivery_ledger.py`,
`session.py`, and `approval_actor.py`.

Connects messaging platforms, webhooks, and authenticated remote clients to
Pixel's primary Python agent with:
  - Strict default-deny pairing & verified `(platform, account_id)` authz.
  - Explicit per-user `projectId` binding & minimal `read_only` default scopes.
  - Message deduplication / replay protection.
  - Isolated per-chat sessions (`(platform, account_id, chat_id)`).
  - Explicit delivery ledger (`agent_succeeded` vs `delivery_attempted` vs
    `delivery_confirmed` vs `delivery_failed`) with retries.
  - Bound remote approval records (never accepting unverified chat "yes").
  - Emergency Stop blocking all inbound, webhook, and remote API activity.
"""

from __future__ import annotations

import json
import os
import secrets
import time
from pathlib import Path
from typing import Any, Callable, Optional

from .pairing import PairingManager
from .platforms import (
    BasePlatformAdapter,
    InboundMessage,
    OutboundMessage,
    PLATFORM_INVENTORY,
    create_platform_adapter,
)
from .webhooks_and_api import GatewayHttpServer, WebhookRegistry


class GatewayService:
    """Single authoritative gateway lifecycle inside Pixel's Python runtime."""

    def __init__(
        self,
        data_dir: Optional[str | Path] = None,
        *,
        agent_dispatch: Optional[Callable[[dict[str, Any]], dict[str, Any]]] = None,
    ) -> None:
        default_root = Path(os.environ.get("PIXEL_GATEWAY_DATA_DIR") or (Path.home() / ".pixel" / "gateway"))
        self.data_dir = Path(data_dir) if data_dir else default_root
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.state_path = self.data_dir / "gateway-state.json"

        self.pairing = PairingManager()
        self.webhooks = WebhookRegistry()
        self._adapters: dict[str, BasePlatformAdapter] = {}
        self._sessions: dict[str, dict[str, Any]] = {}  # session_key -> session metadata
        self._seen_messages: dict[str, float] = {}
        self._delivery_ledger: list[dict[str, Any]] = []
        self._approvals: dict[str, dict[str, Any]] = {}
        self._webhook_events: list[dict[str, Any]] = []
        self._http_server: Optional[GatewayHttpServer] = None
        self._running = False
        self._emergency_stopped = False
        self._agent_dispatch = agent_dispatch
        self._load_state()

    def _load_state(self) -> None:
        if not self.state_path.is_file():
            return
        try:
            data = json.loads(self.state_path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                self.pairing.load_state(data.get("pairing") or {})
        except Exception:
            pass

    def _save_state(self) -> None:
        payload = {
            "version": 1,
            "pairing": self.pairing.export_state(),
        }
        tmp = self.state_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self.state_path)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self, *, host: str = "127.0.0.1", port: int = 0) -> dict[str, Any]:
        self._emergency_stopped = False
        if self._http_server is None:
            self._http_server = GatewayHttpServer(
                pairing=self.pairing,
                webhooks=self.webhooks,
                on_chat_request=self._handle_remote_api_chat,
                on_webhook_event=self._handle_webhook_delivery,
                on_list_sessions=lambda: list(self._sessions.values()),
                is_emergency_stopped=lambda: self._emergency_stopped,
                host=host,
                port=port,
            )
        http_res = self._http_server.start()
        self._running = True
        return {"ok": True, "running": True, "http": http_res}

    def stop(self) -> dict[str, Any]:
        self._running = False
        if self._http_server is not None:
            self._http_server.stop()
            self._http_server = None
        for adapter in self._adapters.values():
            adapter.disconnect()
        return {"ok": True, "running": False}

    def emergency_stop(self) -> dict[str, Any]:
        self._emergency_stopped = True
        for ap in self._approvals.values():
            if ap["status"] == "pending":
                ap["status"] = "cancelled"
        self.stop()
        return {"ok": True, "emergencyStopped": True}

    def status(self) -> dict[str, Any]:
        return {
            "running": self._running,
            "emergencyStopped": self._emergency_stopped,
            "http": {
                "running": bool(self._http_server and self._http_server.is_running),
                "host": self._http_server.host if self._http_server else "127.0.0.1",
                "port": self._http_server.bound_port if self._http_server else 0,
            },
            "platforms": [
                {
                    **meta,
                    "configured": meta["id"] in self._adapters,
                    "connected": bool(self._adapters[meta["id"]].connected) if meta["id"] in self._adapters else False,
                    "lastError": self._adapters[meta["id"]].last_error if meta["id"] in self._adapters else None,
                }
                for meta in PLATFORM_INVENTORY
            ],
            "authorizedUsers": self.pairing.list_authorized(),
            "pendingPairings": self.pairing.list_pending(),
            "pairedDevices": self.pairing.list_devices(),
            "webhooks": self.webhooks.list_routes(),
            "activeSessions": len(self._sessions),
            "deliveries": len(self._delivery_ledger),
        }

    # ------------------------------------------------------------------
    # Platform Adapters
    # ------------------------------------------------------------------

    def configure_platform(self, platform_id: str, config: dict[str, Any], *, connect: bool = False) -> dict[str, Any]:
        adapter = create_platform_adapter(platform_id, config)
        ok, err = adapter.validate_config()
        if not ok:
            return {"ok": False, "platform": platform_id, "error": err}
        self._adapters[adapter.platform_id] = adapter
        if connect:
            return adapter.connect()
        return {"ok": True, "platform": adapter.platform_id, "configured": True, "connected": False}

    def disconnect_platform(self, platform_id: str) -> dict[str, Any]:
        adapter = self._adapters.get(platform_id)
        if not adapter:
            return {"ok": False, "error": f"Platform '{platform_id}' is not configured."}
        adapter.disconnect()
        return {"ok": True, "platform": platform_id, "connected": False}

    # ------------------------------------------------------------------
    # Inbound Pipeline, Deduplication, Session Isolation & Delivery
    # ------------------------------------------------------------------

    def _session_key(self, platform: str, account_id: str, chat_id: str) -> str:
        return f"gw:{platform}:{account_id}:{chat_id}"

    def ingest_inbound(
        self,
        platform_id: str,
        raw_payload: dict[str, Any],
        *,
        available_tools: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        if self._emergency_stopped:
            return {"ok": False, "denied": True, "error": "Emergency Stop is active."}

        adapter = self._adapters.get(platform_id) or create_platform_adapter(platform_id)
        msg = adapter.parse_inbound(raw_payload)
        if msg is None:
            return {"ok": False, "error": "Could not parse inbound message payload."}

        # Deduplication & replay protection
        if msg.message_id in self._seen_messages:
            return {"ok": False, "duplicate": True, "error": f"Duplicate message '{msg.message_id}' ignored."}
        self._seen_messages[msg.message_id] = time.time()

        # Default-deny authorization check keyed by verified (platform, account_id)
        authorized, user = self.pairing.is_authorized(msg.platform, msg.account_id, is_group=msg.is_group)
        if not authorized or user is None:
            pairing_res = self.pairing.request_pairing(
                msg.platform,
                msg.account_id,
                display_name=msg.display_name,
                chat_id=msg.chat_id,
            )
            return {
                "ok": False,
                "unauthorized": True,
                "pairingCode": pairing_res.get("code"),
                "error": pairing_res.get("error") or "User is not paired. Approve pairing code in Pixel Messaging settings.",
            }

        session_id = self._session_key(msg.platform, msg.account_id, msg.chat_id)
        allowed_tools = self.pairing.allowed_tools_for_user(user, available_tools or [])
        session_record = {
            "sessionId": session_id,
            "platform": msg.platform,
            "accountId": msg.account_id,
            "chatId": msg.chat_id,
            "projectId": user["projectId"],
            "scopes": list(user["scopes"]),
            "allowedTools": allowed_tools,
            "lastMessageAt": time.time(),
        }
        self._sessions[session_id] = session_record

        # Dispatch to Pixel's primary Python agent (or structured acknowledgement in dry-run)
        turn_input = {
            "sessionId": session_id,
            "ownerId": session_id,
            "projectId": user["projectId"],
            "allowedTools": allowed_tools,
            "message": msg.to_dict(),
        }
        if self._agent_dispatch:
            agent_out = self._agent_dispatch(turn_input)
        else:
            agent_out = {
                "ok": True,
                "content": f"[Pixel Gateway · project={user['projectId']}] Received: {msg.text}",
            }

        reply_text = str(agent_out.get("content") or "")
        delivery_record: dict[str, Any] = {
            "id": f"dlv_{secrets.token_hex(6)}",
            "messageId": msg.message_id,
            "sessionId": session_id,
            "platform": msg.platform,
            "chatId": msg.chat_id,
            "agentSucceeded": bool(agent_out.get("ok")),
            "status": "delivery_attempted",
            "at": time.time(),
        }

        if msg.platform in self._adapters and self._adapters[msg.platform].connected and reply_text:
            send_res = self._adapters[msg.platform].send_message(
                OutboundMessage(platform=msg.platform, chat_id=msg.chat_id, text=reply_text, reply_to=msg.message_id)
            )
            delivery_record["status"] = "delivery_confirmed" if send_res.get("ok") else "delivery_failed"
            delivery_record["detail"] = send_res
        else:
            delivery_record["status"] = "delivery_pending_adapter"

        self._delivery_ledger.append(delivery_record)
        return {
            "ok": True,
            "session": session_record,
            "reply": reply_text,
            "delivery": delivery_record,
        }

    # ------------------------------------------------------------------
    # Bound Remote Approvals (never accepting unverified chat "yes")
    # ------------------------------------------------------------------

    def create_approval(
        self,
        *,
        session_id: str,
        platform: str,
        account_id: str,
        tool_name: str,
        target: str,
        ttl_s: float = 300.0,
    ) -> dict[str, Any]:
        aid = f"apr_{secrets.token_hex(6)}"
        rec = {
            "id": aid,
            "sessionId": session_id,
            "platform": platform,
            "accountId": account_id,
            "toolName": tool_name,
            "target": target,
            "status": "pending",
            "createdAt": time.time(),
            "expiresAt": time.time() + ttl_s,
        }
        self._approvals[aid] = rec
        return dict(rec)

    def resolve_approval(self, approval_id: str, *, approved: bool, actor_account_id: str) -> dict[str, Any]:
        rec = self._approvals.get(approval_id)
        if not rec:
            return {"ok": False, "error": "Approval request not found."}
        if rec["status"] != "pending":
            return {"ok": False, "error": f"Approval already {rec['status']}."}
        if time.time() > rec["expiresAt"]:
            rec["status"] = "expired"
            return {"ok": False, "error": "Approval request expired."}
        if actor_account_id != "local-owner" and actor_account_id != rec["accountId"]:
            return {"ok": False, "error": "Actor identity does not match authorized approval owner."}
        rec["status"] = "approved" if approved else "rejected"
        return {"ok": True, "approval": dict(rec)}

    # ------------------------------------------------------------------
    # Remote API & Webhook Handlers
    # ------------------------------------------------------------------

    def _handle_remote_api_chat(self, device: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
        messages = payload.get("messages") if isinstance(payload.get("messages"), list) else []
        last_text = ""
        for m in reversed(messages):
            if isinstance(m, dict) and m.get("role") == "user":
                last_text = str(m.get("content") or "")
                break
        session_id = f"dev:{device['id']}:{device['projectId']}"
        self._sessions[session_id] = {
            "sessionId": session_id,
            "platform": "remote_api",
            "accountId": device["id"],
            "projectId": device["projectId"],
            "scopes": list(device["scopes"]),
            "lastMessageAt": time.time(),
        }
        if self._agent_dispatch:
            out = self._agent_dispatch({
                "sessionId": session_id,
                "ownerId": session_id,
                "projectId": device["projectId"],
                "allowedTools": [],
                "message": {"text": last_text, "platform": "remote_api", "accountId": device["id"]},
            })
            reply = str(out.get("content") or "")
        else:
            reply = f"[Pixel Remote API · project={device['projectId']}] {last_text}"
        return {
            "ok": True,
            "id": f"chatcmpl_{secrets.token_hex(6)}",
            "object": "chat.completion",
            "choices": [{"index": 0, "message": {"role": "assistant", "content": reply}, "finish_reason": "stop"}],
        }

    def _handle_webhook_delivery(self, delivery: dict[str, Any]) -> None:
        self._webhook_events.append(delivery)
        if len(self._webhook_events) > 100:
            self._webhook_events = self._webhook_events[-100:]
        if self._agent_dispatch:
            self._agent_dispatch({
                "sessionId": f"webhook:{delivery['routeId']}:{delivery['deliveryId']}",
                "ownerId": f"webhook:{delivery['routeId']}",
                "projectId": delivery["projectId"],
                "allowedTools": [],
                "message": {
                    "text": f"[Untrusted Webhook Event '{delivery['event']}' for project '{delivery['projectId']}']",
                    "untrustedPayload": delivery.get("untrustedPayload"),
                },
            })

    # Convenience persistence wrappers for Pairing
    def approve_pairing(self, code: str, *, project_id: str = "default", scopes: Optional[list[str]] = None, allow_groups: bool = False) -> dict[str, Any]:
        res = self.pairing.approve_pairing(code, project_id=project_id, scopes=scopes, allow_groups=allow_groups)
        if res.get("ok"):
            self._save_state()
        return res

    def revoke_user(self, platform: str, account_id: str) -> dict[str, Any]:
        res = self.pairing.revoke_user(platform, account_id)
        if res.get("ok"):
            self._save_state()
        return res

    def pair_device(self, device_name: str, *, project_id: str = "default", scopes: Optional[list[str]] = None) -> dict[str, Any]:
        res = self.pairing.pair_device(device_name, project_id=project_id, scopes=scopes)
        if res.get("ok"):
            self._save_state()
        return res

    def revoke_device(self, device_id: str) -> dict[str, Any]:
        res = self.pairing.revoke_device(device_id)
        if res.get("ok"):
            self._save_state()
        return res
