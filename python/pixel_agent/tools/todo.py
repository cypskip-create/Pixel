"""Phase 3: Per-Session Structured Todo Tool (Hermes `tools/todo_tool.py` parity)."""

from __future__ import annotations

import time
from typing import Any

VALID_TODO_STATUSES = ("pending", "in_progress", "completed", "cancelled")


class TodoManager:
    """Stores bounded per-session task checklists for agentic planning."""

    def __init__(self, *, max_items: int = 50) -> None:
        self._lists: dict[str, list[dict[str, Any]]] = {}
        self._max_items = max_items

    def write(self, session_id: str, items: list[dict[str, Any]]) -> dict[str, Any]:
        sid = (session_id or "default").strip()
        cleaned: list[dict[str, Any]] = []
        now = int(time.time() * 1000)
        for idx, raw in enumerate(items[: self._max_items]):
            if not isinstance(raw, dict):
                continue
            title = str(raw.get("title") or raw.get("content") or "").strip()[:240]
            if not title:
                continue
            status = str(raw.get("status") or "pending").strip().lower()
            if status not in VALID_TODO_STATUSES:
                status = "pending"
            cleaned.append({
                "id": str(raw.get("id") or f"todo_{idx + 1}"),
                "title": title,
                "status": status,
                "updatedAt": now,
            })
        self._lists[sid] = cleaned
        return {"ok": True, "sessionId": sid, "items": list(cleaned)}

    def read(self, session_id: str) -> list[dict[str, Any]]:
        return list(self._lists.get((session_id or "default").strip(), []))
