"""Phase 2: Python SQLite FTS5 Session Search with Secret Redaction & Profile Scoping.

Adapted from Hermes `tools/session_search_tool.py`.
"""

from __future__ import annotations

import os
import re
import sqlite3
import time
from pathlib import Path
from typing import Any, Optional

from ..errors import redact_secrets


def _sanitize_fts_query(raw: str) -> str:
    tokens = re.findall(r"[A-Za-z0-9_]{2,40}", raw or "")
    if not tokens:
        return ""
    return " AND ".join(f'"{t}"' for t in tokens[:8])


class PythonSessionSearchIndex:
    """FTS5 full-text search index over persisted conversation transcripts."""

    def __init__(self, db_path: Optional[str] = None) -> None:
        if db_path is None:
            base = os.environ.get("PIXEL_WORKSPACE_DATA_DIR") or str(Path.home() / ".pixel" / "workspace")
            Path(base).mkdir(parents=True, exist_ok=True)
            db_path = str(Path(base) / "session_search.sqlite3")
        elif db_path != ":memory:":
            Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        self._conn.executescript(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS session_fts USING fts5(
                conversation_id UNINDEXED,
                profile_id UNINDEXED,
                project_id UNINDEXED,
                title,
                role UNINDEXED,
                content,
                created_at UNINDEXED
            );
            """
        )
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()

    def index_conversation(
        self,
        *,
        conversation_id: str,
        title: str,
        messages: list[dict[str, Any]],
        profile_id: str = "default",
        project_id: str = "default",
    ) -> int:
        self.delete_conversation(conversation_id)
        safe_title = redact_secrets(title or "Untitled")[:200]
        inserted = 0
        for m in messages:
            role = str(m.get("role") or "user")
            if role not in ("user", "assistant"):
                continue
            safe_content = redact_secrets(str(m.get("content") or ""))[:8000].strip()
            if not safe_content:
                continue
            created_at = int(m.get("createdAt") or time.time() * 1000)
            self._conn.execute(
                """INSERT INTO session_fts (conversation_id, profile_id, project_id, title, role, content, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (conversation_id, profile_id, project_id, safe_title, role, safe_content, created_at),
            )
            inserted += 1
        self._conn.commit()
        return inserted

    def delete_conversation(self, conversation_id: str) -> None:
        self._conn.execute("DELETE FROM session_fts WHERE conversation_id = ?", (conversation_id,))
        self._conn.commit()

    def clear_scope(self, *, profile_id: str, project_id: str) -> None:
        self._conn.execute(
            "DELETE FROM session_fts WHERE profile_id = ? AND project_id = ?",
            (profile_id, project_id),
        )
        self._conn.commit()

    def search(
        self,
        query: str,
        *,
        profile_id: str = "default",
        project_id: str = "default",
        limit: int = 15,
    ) -> list[dict[str, Any]]:
        fts_q = _sanitize_fts_query(query)
        if not fts_q:
            return []
        rows = self._conn.execute(
            """SELECT conversation_id, title, role,
                      snippet(session_fts, 5, '[', ']', '...', 24) AS excerpt,
                      created_at
               FROM session_fts
               WHERE session_fts MATCH ? AND profile_id = ? AND project_id = ?
               ORDER BY rank
               LIMIT ?""",
            (fts_q, profile_id, project_id, max(1, min(int(limit), 50))),
        ).fetchall()
        return [
            {
                "conversationId": r["conversation_id"],
                "title": r["title"],
                "role": r["role"],
                "excerpt": redact_secrets(str(r["excerpt"] or "")),
                "createdAt": r["created_at"],
            }
            for r in rows
        ]
