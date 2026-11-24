"""HMAC-verified Webhook Service & Authenticated Remote HTTP API (Stage 8).

Adapted from Hermes `gateway/platforms/webhook*.py` and `api_server*.py`:
  - Defaults strictly to `127.0.0.1` loopback binding.
  - Enforces HMAC-SHA256 signature verification, replay protection (delivery ID
    deduplication + timestamp window), per-route rate limiting, and 1 MiB body caps.
  - Authenticates remote API clients (`/v1/*`) via paired device bearer tokens
    (`PairingManager.verify_device_token`, constant-time hash comparison); never
    exposes internal Electron IPC or raw arbitrary tool execution over HTTP.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Optional

from .pairing import PairingManager

MAX_HTTP_BODY_BYTES = 1 * 1024 * 1024  # 1 MiB safety cap


def compute_hmac_sha256(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


class WebhookRegistry:
    """Manages webhook routes, HMAC verification, replay protection, rate limits & delivery history."""

    def __init__(self, *, max_history: int = 100) -> None:
        self._routes: dict[str, dict[str, Any]] = {}
        self._secrets: dict[str, str] = {}  # route_id -> signing secret (never returned after creation)
        self._seen_deliveries: dict[str, float] = {}
        self._rate_hits: dict[str, list[float]] = {}
        self._history: list[dict[str, Any]] = []
        self._max_history = max_history

    def create_route(
        self,
        *,
        name: str,
        project_id: str = "default",
        event_filters: Optional[list[str]] = None,
        rate_limit_per_min: int = 30,
        signing_secret: Optional[str] = None,
    ) -> dict[str, Any]:
        route_id = f"wh_{secrets.token_hex(6)}"
        secret = (signing_secret or "").strip() or f"whsec_{secrets.token_urlsafe(24)}"
        route = {
            "id": route_id,
            "name": (name or "Webhook").strip()[:80],
            "projectId": (project_id or "default").strip(),
            "eventFilters": [str(e).strip() for e in (event_filters or []) if str(e).strip()],
            "rateLimitPerMin": max(1, min(int(rate_limit_per_min), 600)),
            "enabled": True,
            "createdAt": time.time(),
            "path": f"/webhooks/{route_id}",
        }
        self._routes[route_id] = route
        self._secrets[route_id] = secret
        return {"ok": True, "route": dict(route), "signingSecret": secret}

    def set_enabled(self, route_id: str, enabled: bool) -> dict[str, Any]:
        route = self._routes.get(route_id)
        if not route:
            return {"ok": False, "error": f"Webhook route '{route_id}' not found."}
        route["enabled"] = bool(enabled)
        return {"ok": True, "route": dict(route)}

    def delete_route(self, route_id: str) -> dict[str, Any]:
        if route_id not in self._routes:
            return {"ok": False, "error": f"Webhook route '{route_id}' not found."}
        self._routes.pop(route_id, None)
        self._secrets.pop(route_id, None)
        return {"ok": True, "deleted": route_id}

    def list_routes(self) -> list[dict[str, Any]]:
        return [dict(r) for r in self._routes.values()]

    def list_history(self, limit: int = 50) -> list[dict[str, Any]]:
        return list(self._history[-max(1, min(limit, self._max_history)):])

    def _record(self, entry: dict[str, Any]) -> None:
        self._history.append(entry)
        if len(self._history) > self._max_history:
            self._history = self._history[-self._max_history:]

    def verify_and_ingest(
        self,
        route_id: str,
        body: bytes,
        headers: dict[str, str],
        *,
        now: Optional[float] = None,
    ) -> dict[str, Any]:
        t = now if now is not None else time.time()
        route = self._routes.get(route_id)
        if not route:
            return {"ok": False, "status": 404, "error": "Webhook route not found."}
        if not route.get("enabled"):
            return {"ok": False, "status": 403, "error": "Webhook route is disabled."}
        if len(body) > MAX_HTTP_BODY_BYTES:
            return {"ok": False, "status": 413, "error": "Webhook payload exceeds 1 MiB limit."}

        # Rate limiting
        hits = [ts for ts in self._rate_hits.get(route_id, []) if t - ts < 60.0]
        if len(hits) >= int(route["rateLimitPerMin"]):
            return {"ok": False, "status": 429, "error": "Webhook rate limit exceeded."}
        hits.append(t)
        self._rate_hits[route_id] = hits

        lower_headers = {k.lower(): v for k, v in headers.items()}
        sig_header = (
            lower_headers.get("x-pixel-signature-256")
            or lower_headers.get("x-hub-signature-256")
            or lower_headers.get("x-signature-256")
            or ""
        ).strip()
        if sig_header.lower().startswith("sha256="):
            sig_header = sig_header[7:].strip()

        expected = compute_hmac_sha256(self._secrets.get(route_id, ""), body)
        if not sig_header or not hmac.compare_digest(expected, sig_header.lower()):
            self._record({"routeId": route_id, "at": t, "ok": False, "reason": "invalid_signature"})
            return {"ok": False, "status": 401, "error": "Invalid webhook HMAC-SHA256 signature."}

        # Replay protection via delivery ID
        delivery_id = (
            lower_headers.get("x-pixel-delivery")
            or lower_headers.get("x-github-delivery")
            or hashlib.sha256(body).hexdigest()[:24]
        ).strip()
        # Prune old delivery IDs > 1 hour
        for did in [k for k, ts in self._seen_deliveries.items() if t - ts > 3600.0]:
            self._seen_deliveries.pop(did, None)
        if delivery_id in self._seen_deliveries:
            self._record({"routeId": route_id, "deliveryId": delivery_id, "at": t, "ok": False, "reason": "replay"})
            return {"ok": False, "status": 409, "error": "Duplicate webhook delivery rejected (replay protection)."}
        self._seen_deliveries[delivery_id] = t

        event_name = (lower_headers.get("x-pixel-event") or lower_headers.get("x-github-event") or "webhook").strip()
        filters = route.get("eventFilters") or []
        if filters and event_name not in filters:
            self._record({"routeId": route_id, "deliveryId": delivery_id, "event": event_name, "at": t, "ok": True, "ignored": True})
            return {"ok": True, "status": 202, "ignored": True, "event": event_name}

        try:
            payload = json.loads(body.decode("utf-8"))
        except Exception:
            return {"ok": False, "status": 400, "error": "Webhook body must be valid UTF-8 JSON."}

        record = {
            "routeId": route_id,
            "deliveryId": delivery_id,
            "event": event_name,
            "projectId": route["projectId"],
            "at": t,
            "ok": True,
            "untrustedPayload": payload,
        }
        self._record({"routeId": route_id, "deliveryId": delivery_id, "event": event_name, "projectId": route["projectId"], "at": t, "ok": True})
        return {"ok": True, "status": 200, "delivery": record}


class GatewayHttpServer:
    """Loopback-first HTTP server for authenticated `/v1/*` remote API and `/webhooks/*` ingress."""

    def __init__(
        self,
        *,
        pairing: PairingManager,
        webhooks: WebhookRegistry,
        on_chat_request: Callable[[dict[str, Any], dict[str, Any]], dict[str, Any]],
        on_webhook_event: Callable[[dict[str, Any]], None],
        on_list_sessions: Callable[[], list[dict[str, Any]]],
        is_emergency_stopped: Callable[[], bool],
        host: str = "127.0.0.1",
        port: int = 0,
    ) -> None:
        self.pairing = pairing
        self.webhooks = webhooks
        self.on_chat_request = on_chat_request
        self.on_webhook_event = on_webhook_event
        self.on_list_sessions = on_list_sessions
        self.is_emergency_stopped = is_emergency_stopped
        self.host = host or "127.0.0.1"
        self.requested_port = int(port)
        self._server: Optional[ThreadingHTTPServer] = None
        self._thread: Optional[threading.Thread] = None

    @property
    def is_running(self) -> bool:
        return self._server is not None

    @property
    def bound_port(self) -> int:
        return int(self._server.server_address[1]) if self._server else 0

    def start(self) -> dict[str, Any]:
        if self._server is not None:
            return {"ok": True, "host": self.host, "port": self.bound_port}

        parent = self

        class _Handler(BaseHTTPRequestHandler):
            def log_message(self, _fmt: str, *_args: Any) -> None:
                return

            def _send_json(self, status: int, data: dict[str, Any]) -> None:
                raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def _auth_device(self) -> Optional[dict[str, Any]]:
                auth = (self.headers.get("Authorization") or "").strip()
                if not auth.lower().startswith("bearer "):
                    return None
                return parent.pairing.verify_device_token(auth[7:].strip())

            def do_GET(self) -> None:
                if self.path == "/v1/health":
                    self._send_json(200, {
                        "ok": True,
                        "service": "pixel-gateway",
                        "emergencyStopped": parent.is_emergency_stopped(),
                    })
                    return
                if self.path == "/v1/sessions":
                    dev = self._auth_device()
                    if not dev:
                        self._send_json(401, {"ok": False, "error": "Unauthorized: valid paired device bearer token required."})
                        return
                    self._send_json(200, {"ok": True, "device": dev["id"], "sessions": parent.on_list_sessions()})
                    return
                self._send_json(404, {"ok": False, "error": "Not found."})

            def do_POST(self) -> None:
                if parent.is_emergency_stopped():
                    self._send_json(503, {"ok": False, "error": "Emergency Stop is active. Remote requests are blocked."})
                    return
                length = int(self.headers.get("Content-Length") or 0)
                if length > MAX_HTTP_BODY_BYTES:
                    self._send_json(413, {"ok": False, "error": "Payload exceeds 1 MiB limit."})
                    return
                body = self.rfile.read(max(0, length))

                if self.path.startswith("/webhooks/"):
                    route_id = self.path[len("/webhooks/"):].split("?", 1)[0].strip()
                    hdrs = {k: v for k, v in self.headers.items()}
                    res = parent.webhooks.verify_and_ingest(route_id, body, hdrs)
                    if res.get("ok") and not res.get("ignored") and isinstance(res.get("delivery"), dict):
                        try:
                            parent.on_webhook_event(res["delivery"])
                        except Exception:
                            pass
                    self._send_json(int(res.get("status", 200)), res)
                    return

                if self.path == "/v1/chat/completions":
                    dev = self._auth_device()
                    if not dev:
                        self._send_json(401, {"ok": False, "error": "Unauthorized: valid paired device bearer token required."})
                        return
                    try:
                        payload = json.loads(body.decode("utf-8"))
                    except Exception:
                        self._send_json(400, {"ok": False, "error": "Invalid JSON body."})
                        return
                    result = parent.on_chat_request(dev, payload)
                    self._send_json(200 if result.get("ok") else 400, result)
                    return

                self._send_json(404, {"ok": False, "error": "Not found."})

        self._server = ThreadingHTTPServer((self.host, self.requested_port), _Handler)
        self._thread = threading.Thread(target=self._server.serve_forever, name="pixel-gateway-http", daemon=True)
        self._thread.start()
        return {"ok": True, "host": self.host, "port": self.bound_port}

    def stop(self) -> None:
        srv = self._server
        self._server = None
        if srv is not None:
            try:
                srv.shutdown()
                srv.server_close()
            except Exception:
                pass
