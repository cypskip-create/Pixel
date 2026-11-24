"""Phase 3: Interactive Clarify Tool (Hermes `tools/clarify_tool.py` parity)."""

from __future__ import annotations

import secrets
import threading
from typing import Any, Callable, Optional


class ClarifyManager:
    """Pauses an agent turn to ask a structured clarification question and awaits user reply."""

    def __init__(self, *, emit: Optional[Callable[[dict[str, Any]], None]] = None) -> None:
        self._emit = emit or (lambda _: None)
        self._lock = threading.Lock()
        self._waiters: dict[str, tuple[threading.Event, dict[str, Any]]] = {}

    def ask(
        self,
        *,
        question: str,
        choices: Optional[list[str]] = None,
        timeout_s: float = 120.0,
        cancel_event: Optional[threading.Event] = None,
    ) -> dict[str, Any]:
        q = (question or "").strip()[:1000]
        if not q:
            return {"ok": False, "error": "Clarification question cannot be empty."}
        cid = f"clr_{secrets.token_hex(5)}"
        ev = threading.Event()
        box: dict[str, Any] = {}
        with self._lock:
            self._waiters[cid] = (ev, box)
        self._emit({
            "type": "clarify.request",
            "clarifyId": cid,
            "question": q,
            "choices": [str(c).strip()[:120] for c in (choices or []) if str(c).strip()][:6],
        })

        remaining = max(0.1, float(timeout_s))
        while remaining > 0 and not ev.is_set():
            if cancel_event is not None and cancel_event.is_set():
                with self._lock:
                    self._waiters.pop(cid, None)
                return {"ok": False, "cancelled": True, "error": "Clarification cancelled."}
            step = min(0.05, remaining)
            ev.wait(timeout=step)
            remaining -= step

        with self._lock:
            self._waiters.pop(cid, None)
        if not ev.is_set():
            return {"ok": False, "timeout": True, "error": "Timed out waiting for user clarification."}
        return {"ok": True, "clarifyId": cid, "answer": str(box.get("answer") or "")}

    def respond(self, clarify_id: str, answer: str) -> dict[str, Any]:
        with self._lock:
            entry = self._waiters.get(clarify_id)
            if not entry:
                return {"ok": False, "error": f"No pending clarification '{clarify_id}'."}
            ev, box = entry
            box["answer"] = (answer or "").strip()[:4000]
            ev.set()
            return {"ok": True, "clarifyId": clarify_id}
