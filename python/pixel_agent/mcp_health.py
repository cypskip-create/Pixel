"""Phase 5: MCP Health Monitor, Exponential-Backoff Reconnect & Sampling Bridge.

Adapted from Hermes `tools/mcp_tool_health.py`, `tools/mcp_tool_lifecycle.py`,
and `tools/mcp_tool_sampling.py`.
"""

from __future__ import annotations

import time
from typing import Any, Callable, Optional

from .auxiliary import AuxiliaryClient


class McpHealthController:
    """Tracks MCP server liveness, failure counts, backoff windows, and sampling calls."""

    def __init__(
        self,
        *,
        auxiliary: Optional[AuxiliaryClient] = None,
        base_backoff_s: float = 2.0,
        max_backoff_s: float = 60.0,
    ) -> None:
        self._auxiliary = auxiliary or AuxiliaryClient()
        self._base_backoff_s = base_backoff_s
        self._max_backoff_s = max_backoff_s
        self._servers: dict[str, dict[str, Any]] = {}

    def record_ok(self, server_id: str, *, latency_ms: float = 0.0) -> dict[str, Any]:
        rec = {
            "serverId": server_id,
            "healthy": True,
            "failures": 0,
            "nextRetryAt": 0.0,
            "lastCheckedAt": time.time(),
            "latencyMs": round(latency_ms, 2),
            "lastError": None,
        }
        self._servers[server_id] = rec
        return dict(rec)

    def record_failure(self, server_id: str, error: str, *, now: Optional[float] = None) -> dict[str, Any]:
        t = now if now is not None else time.time()
        prev = self._servers.get(server_id, {})
        failures = int(prev.get("failures") or 0) + 1
        delay = min(self._max_backoff_s, self._base_backoff_s * (2 ** (failures - 1)))
        rec = {
            "serverId": server_id,
            "healthy": False,
            "failures": failures,
            "nextRetryAt": t + delay,
            "lastCheckedAt": t,
            "latencyMs": None,
            "lastError": str(error)[:240],
        }
        self._servers[server_id] = rec
        return dict(rec)

    def should_attempt_reconnect(self, server_id: str, *, now: Optional[float] = None) -> bool:
        t = now if now is not None else time.time()
        rec = self._servers.get(server_id)
        if not rec or rec.get("healthy"):
            return True
        return t >= float(rec.get("nextRetryAt") or 0.0)

    def probe(self, server_id: str, ping_fn: Callable[[], bool]) -> dict[str, Any]:
        t0 = time.monotonic()
        try:
            ok = bool(ping_fn())
            elapsed = (time.monotonic() - t0) * 1000.0
            if ok:
                return self.record_ok(server_id, latency_ms=elapsed)
            return self.record_failure(server_id, "MCP ping returned false.")
        except Exception as exc:
            return self.record_failure(server_id, str(exc))

    def handle_sampling_request(self, params: dict[str, Any]) -> dict[str, Any]:
        """Handle MCP `sampling/createMessage` via Pixel's bounded AuxiliaryClient."""
        messages = params.get("messages") if isinstance(params.get("messages"), list) else []
        user_parts: list[str] = []
        for m in messages:
            if not isinstance(m, dict):
                continue
            content = m.get("content")
            if isinstance(content, dict) and isinstance(content.get("text"), str):
                user_parts.append(content["text"])
            elif isinstance(content, str):
                user_parts.append(content)
        prompt = "\n".join(user_parts).strip()
        if not prompt:
            return {"ok": False, "error": "Empty MCP sampling prompt."}
        system = str(params.get("systemPrompt") or "Respond concisely to this MCP tool sampling request.")
        max_tokens = int(params.get("maxTokens") or 256)
        res = self._auxiliary.complete(system, prompt, max_tokens=max_tokens)
        if not res.get("ok"):
            return {"ok": False, "error": res.get("error") or "Sampling failed."}
        return {
            "ok": True,
            "role": "assistant",
            "model": res.get("model") or "pixel-auxiliary",
            "content": {"type": "text", "text": res.get("content") or ""},
        }

    def snapshot(self) -> list[dict[str, Any]]:
        return [dict(v) for v in self._servers.values()]
