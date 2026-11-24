"""Phase 2: Authoritative Python SQLite Memory Store & Frozen Session Snapshots.

Adapted from Hermes `agent/memory_manager.py`, `agent/memory_context.py`,
and `agent/memory_caller_scope.py`.

Invariants:
  - Strictly scoped by `(profile_id, project_id)` so profiles never leak memory.
  - Rejects credential-like strings (`sk-...`, Bearer tokens, private keys, AWS keys).
  - Deduplicates per `(profile_id, project_id, content_hash)`.
  - Maintains append-only revision history on updates.
  - Freezes a bounded session snapshot per conversation (`memory_char_limit`,
    `user_char_limit`) so system-prompt caching stays warm during a session.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import sqlite3
import time
from pathlib import Path
from typing import Any, Optional

CREDENTIAL_PATTERNS = (
    re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"\bBearer\s+[A-Za-z0-9._-]{20,}\b", re.IGNORECASE),
    re.compile(r"\b(?:whsec_|pxd_|xox[baprs]-)[A-Za-z0-9_-]{12,}\b"),
)

VALID_MEMORY_KINDS = ("fact", "preference", "decision", "user_profile", "outcome")


def looks_like_credential(text: str) -> bool:
    return any(p.search(text or "") for p in CREDENTIAL_PATTERNS)


class PythonMemoryStore:
    """SQLite-backed profile/project-scoped memory engine with frozen session snapshots."""

    def __init__(self, db_path: Optional[str] = None) -> None:
        if db_path is None:
            base = os.environ.get("PIXEL_WORKSPACE_DATA_DIR") or str(Path.home() / ".pixel" / "workspace")
            Path(base).mkdir(parents=True, exist_ok=True)
            db_path = str(Path(base) / "memory.sqlite3")
        elif db_path != ":memory:":
            Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._db_path = db_path
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._frozen_snapshots: dict[str, str] = {}
        self._init_schema()

    def _init_schema(self) -> None:
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY,
                profile_id TEXT NOT NULL,
                project_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                content TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                tags_json TEXT NOT NULL DEFAULT '[]',
                source TEXT NOT NULL DEFAULT 'user',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                UNIQUE(profile_id, project_id, content_hash)
            );
            CREATE TABLE IF NOT EXISTS memory_revisions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                memory_id TEXT NOT NULL,
                previous_content TEXT NOT NULL,
                reason TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(profile_id, project_id, updated_at DESC);
            """
        )
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()

    def save(
        self,
        *,
        content: str,
        kind: str = "fact",
        profile_id: str = "default",
        project_id: str = "default",
        tags: Optional[list[str]] = None,
        source: str = "user",
    ) -> dict[str, Any]:
        clean = " ".join((content or "").split()).strip()
        if not clean:
            return {"ok": False, "error": "Memory content cannot be empty."}
        if looks_like_credential(clean):
            return {"ok": False, "error": "Credential-like secrets cannot be stored in memory."}
        clean_kind = kind if kind in VALID_MEMORY_KINDS else "fact"
        clean_tags = [str(t).strip()[:48] for t in (tags or []) if str(t).strip()][:8]
        h = hashlib.sha256(clean.lower().encode("utf-8")).hexdigest()
        now = int(time.time() * 1000)

        existing = self._conn.execute(
            "SELECT * FROM memories WHERE profile_id = ? AND project_id = ? AND content_hash = ?",
            (profile_id, project_id, h),
        ).fetchone()
        if existing:
            return {"ok": True, "duplicate": True, "memory": self._row_to_dict(existing)}

        mid = f"mem_{secrets.token_hex(6)}"
        self._conn.execute(
            """INSERT INTO memories (id, profile_id, project_id, kind, content, content_hash, tags_json, source, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (mid, profile_id, project_id, clean_kind, clean[:1000], h, json.dumps(clean_tags), source[:80], now, now),
        )
        self._conn.commit()
        row = self._conn.execute("SELECT * FROM memories WHERE id = ?", (mid,)).fetchone()
        return {"ok": True, "duplicate": False, "memory": self._row_to_dict(row)}

    def update(
        self,
        memory_id: str,
        *,
        content: Optional[str] = None,
        tags: Optional[list[str]] = None,
        reason: str = "user_edit",
        profile_id: Optional[str] = None,
    ) -> dict[str, Any]:
        row = self._conn.execute("SELECT * FROM memories WHERE id = ?", (memory_id,)).fetchone()
        if not row:
            return {"ok": False, "error": f"Memory '{memory_id}' not found."}
        if profile_id is not None and row["profile_id"] != profile_id:
            return {"ok": False, "error": "Memory belongs to a different profile."}
        new_content = " ".join((content if content is not None else row["content"]).split()).strip()
        if not new_content:
            return {"ok": False, "error": "Memory content cannot be empty."}
        if looks_like_credential(new_content):
            return {"ok": False, "error": "Credential-like secrets cannot be stored in memory."}
        new_tags = json.dumps([str(t).strip()[:48] for t in tags if str(t).strip()][:8]) if tags is not None else row["tags_json"]
        now = int(time.time() * 1000)
        new_hash = hashlib.sha256(new_content.lower().encode("utf-8")).hexdigest()
        self._conn.execute(
            "INSERT INTO memory_revisions (memory_id, previous_content, reason, updated_at) VALUES (?, ?, ?, ?)",
            (memory_id, row["content"], reason[:120], now),
        )
        self._conn.execute(
            "UPDATE memories SET content = ?, content_hash = ?, tags_json = ?, updated_at = ? WHERE id = ?",
            (new_content[:1000], new_hash, new_tags, now, memory_id),
        )
        self._conn.commit()
        updated = self._conn.execute("SELECT * FROM memories WHERE id = ?", (memory_id,)).fetchone()
        return {"ok": True, "memory": self._row_to_dict(updated)}

    def delete(self, memory_id: str, *, profile_id: Optional[str] = None) -> dict[str, Any]:
        if profile_id is not None:
            cur = self._conn.execute("DELETE FROM memories WHERE id = ? AND profile_id = ?", (memory_id, profile_id))
        else:
            cur = self._conn.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
        self._conn.commit()
        return {"ok": cur.rowcount > 0, "deleted": memory_id if cur.rowcount > 0 else None}

    def list(
        self,
        *,
        profile_id: str = "default",
        project_id: str = "default",
        query: str = "",
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        q = (query or "").strip().lower()
        rows = self._conn.execute(
            "SELECT * FROM memories WHERE profile_id = ? AND project_id = ? ORDER BY updated_at DESC LIMIT ?",
            (profile_id, project_id, max(1, min(int(limit), 200))),
        ).fetchall()
        items = [self._row_to_dict(r) for r in rows]
        if q:
            items = [m for m in items if q in m["content"].lower() or any(q in t.lower() for t in m["tags"])]
        return items

    def revisions(self, memory_id: str) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            "SELECT previous_content, reason, updated_at FROM memory_revisions WHERE memory_id = ? ORDER BY updated_at DESC LIMIT 20",
            (memory_id,),
        ).fetchall()
        return [{"previousContent": r["previous_content"], "reason": r["reason"], "updatedAt": r["updated_at"]} for r in rows]

    def get_frozen_snapshot(
        self,
        *,
        conversation_id: str,
        profile_id: str = "default",
        project_id: str = "default",
        memory_char_limit: int = 2200,
        user_char_limit: int = 1375,
    ) -> str:
        """Return a session-frozen memory snapshot so prompt prefixes stay cacheable."""
        key = f"{profile_id}:{project_id}:{conversation_id}"
        if key in self._frozen_snapshots:
            return self._frozen_snapshots[key]

        items = self.list(profile_id=profile_id, project_id=project_id, limit=100)
        user_lines: list[str] = []
        mem_lines: list[str] = []
        user_chars = 0
        mem_chars = 0
        for item in items:
            line = f"- [{item['kind']}] {item['content']}"
            if item["kind"] == "user_profile":
                if user_chars + len(line) + 1 <= user_char_limit:
                    user_lines.append(line)
                    user_chars += len(line) + 1
            else:
                if mem_chars + len(line) + 1 <= memory_char_limit:
                    mem_lines.append(line)
                    mem_chars += len(line) + 1

        parts: list[str] = []
        if user_lines:
            parts.append("### User Profile\n" + "\n".join(user_lines))
        if mem_lines:
            parts.append("### Project Memory\n" + "\n".join(mem_lines))
        snapshot = "\n\n".join(parts)
        self._frozen_snapshots[key] = snapshot
        return snapshot

    def invalidate_snapshot(self, conversation_id: str) -> None:
        for k in [k for k in self._frozen_snapshots if k.endswith(f":{conversation_id}")]:
            self._frozen_snapshots.pop(k, None)

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "profileId": row["profile_id"],
            "projectId": row["project_id"],
            "kind": row["kind"],
            "content": row["content"],
            "tags": json.loads(row["tags_json"] or "[]"),
            "source": row["source"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }
