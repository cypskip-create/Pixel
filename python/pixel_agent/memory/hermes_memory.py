"""Hermes-exact curated persistent memory store for Pixel (MEMORY.md + USER.md).

Distilled directly from NousResearch/hermes-agent `tools/memory_tool.py`:
- Two bounded, human-readable markdown files per profile (`MEMORY.md` = agent notes,
  max 2,200 chars; `USER.md` = user profile facts like name & preferences, max 1,375 chars).
- Entries separated by `§` (`ENTRY_DELIMITER`), curated strictly (never dumps raw chat logs).
- Scans every write for prompt-injection payloads, invisible Unicode characters, and secrets.
- Single `memory` tool interface (`add`, `replace`, `patch`, `remove`, `read`).
- Formats clean system-prompt blocks (`USER PROFILE` + `MEMORY`) injected on every turn.
"""

from __future__ import annotations

import os
import re
import threading
from pathlib import Path
from typing import Any, Optional

from .store import looks_like_credential

ENTRY_DELIMITER = "\n§\n"
DEFAULT_MEMORY_CHAR_LIMIT = 2200
DEFAULT_USER_CHAR_LIMIT = 1375

_INJECTION_PATTERNS = (
    re.compile(r"ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions", re.IGNORECASE),
    re.compile(r"<\s*/?\s*system\s*>", re.IGNORECASE),
    re.compile(r"you\s+are\s+now\s+(?:in\s+)?developer\s+mode", re.IGNORECASE),
    re.compile(r"[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]"),
)


def scan_memory_content(text: str) -> Optional[str]:
    """Return an error string if content contains credentials or injection payloads."""
    if looks_like_credential(text):
        return "Refused: credential-like secrets cannot be stored in persistent memory."
    for pat in _INJECTION_PATTERNS:
        if pat.search(text):
            return "Refused: memory content failed prompt-injection / invisible-character safety scan."
    return None


def _safe_profile_id(profile_id: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]", "_", (profile_id or "default").strip())
    return cleaned or "default"


class HermesMemoryStore:
    """Thread-safe Hermes-exact persistent two-file memory (`MEMORY.md` + `USER.md`)."""

    def __init__(
        self,
        base_dir: Optional[str] = None,
        *,
        memory_char_limit: int = DEFAULT_MEMORY_CHAR_LIMIT,
        user_char_limit: int = DEFAULT_USER_CHAR_LIMIT,
    ) -> None:
        if base_dir is None:
            env_dir = os.environ.get("PIXEL_MEMORY_DIR") or os.environ.get("PIXEL_WORKSPACE_DATA_DIR")
            if env_dir:
                self._base_dir = Path(env_dir) / "memories"
            else:
                self._base_dir = Path.home() / ".pixel" / "memories"
        else:
            self._base_dir = Path(base_dir)
        self._memory_limit = max(400, int(memory_char_limit))
        self._user_limit = max(300, int(user_char_limit))
        self._lock = threading.RLock()

    def _file_path(self, profile_id: str, target: str) -> Path:
        prof = _safe_profile_id(profile_id)
        folder = self._base_dir / prof
        folder.mkdir(parents=True, exist_ok=True)
        filename = "USER.md" if target == "user" else "MEMORY.md"
        return folder / filename

    def _char_limit(self, target: str) -> int:
        return self._user_limit if target == "user" else self._memory_limit

    def _read_entries(self, profile_id: str, target: str) -> list[str]:
        path = self._file_path(profile_id, target)
        if not path.exists():
            return []
        raw = path.read_text(encoding="utf-8").strip()
        if not raw:
            return []
        return [part.strip() for part in raw.split("§") if part.strip()]

    def _write_entries(self, profile_id: str, target: str, entries: list[str]) -> None:
        path = self._file_path(profile_id, target)
        tmp = path.with_suffix(".tmp")
        text = ENTRY_DELIMITER.join(entries)
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, path)

    def _usage(self, entries: list[str], limit: int) -> dict[str, Any]:
        used = len(ENTRY_DELIMITER.join(entries)) if entries else 0
        pct = round((used / limit) * 100, 1) if limit > 0 else 0.0
        return {"usedChars": used, "limitChars": limit, "percent": pct, "count": len(entries)}

    def execute_tool(
        self,
        *,
        action: str,
        target: str = "memory",
        content: str = "",
        old_text: str = "",
        profile_id: str = "default",
    ) -> dict[str, Any]:
        act = (action or "").strip().lower()
        tgt = "user" if (target or "").strip().lower() == "user" else "memory"
        limit = self._char_limit(tgt)

        with self._lock:
            entries = self._read_entries(profile_id, tgt)

            if act == "read":
                return {
                    "ok": True,
                    "target": tgt,
                    "entries": entries,
                    "usage": self._usage(entries, limit),
                }

            if act == "add":
                clean = " ".join((content or "").split()).strip()
                if not clean:
                    return {"ok": False, "error": "Memory content cannot be empty."}
                err = scan_memory_content(clean)
                if err:
                    return {"ok": False, "error": err}
                # Deduplicate case-insensitively
                if any(e.lower() == clean.lower() for e in entries):
                    return {
                        "ok": True,
                        "duplicate": True,
                        "target": tgt,
                        "message": f"Already stored in {tgt} memory.",
                        "entries": entries,
                        "usage": self._usage(entries, limit),
                    }
                candidate = [*entries, clean]
                if len(ENTRY_DELIMITER.join(candidate)) > limit:
                    return {
                        "ok": False,
                        "error": f"Adding this entry exceeds the {limit}-char budget for {tgt} memory. Use action='replace' or action='remove' to curate space first.",
                        "usage": self._usage(entries, limit),
                    }
                self._write_entries(profile_id, tgt, candidate)
                return {
                    "ok": True,
                    "target": tgt,
                    "message": f"Saved to persistent {tgt} memory.",
                    "entries": candidate,
                    "usage": self._usage(candidate, limit),
                }

            if act in ("replace", "patch"):
                needle = (old_text or "").strip()
                clean = " ".join((content or "").split()).strip()
                if not needle:
                    return {"ok": False, "error": "old_text is required for replace/patch."}
                if not clean:
                    return {"ok": False, "error": "Replacement content cannot be empty."}
                err = scan_memory_content(clean)
                if err:
                    return {"ok": False, "error": err}
                matches = [i for i, e in enumerate(entries) if needle.lower() in e.lower()]
                if not matches:
                    return {"ok": False, "error": f"No {tgt} memory entry matched '{needle}'."}
                if len(matches) > 1:
                    return {"ok": False, "error": f"Multiple {tgt} entries matched '{needle}'; provide a more specific old_text."}
                idx = matches[0]
                updated_entry = clean if act == "replace" else entries[idx].replace(needle, clean, 1)
                candidate = list(entries)
                candidate[idx] = updated_entry
                if len(ENTRY_DELIMITER.join(candidate)) > limit:
                    return {"ok": False, "error": f"Updated entry exceeds {limit}-char budget for {tgt} memory."}
                self._write_entries(profile_id, tgt, candidate)
                return {
                    "ok": True,
                    "target": tgt,
                    "message": f"Updated persistent {tgt} memory.",
                    "entries": candidate,
                    "usage": self._usage(candidate, limit),
                }

            if act == "remove":
                needle = (old_text or content or "").strip()
                if not needle:
                    return {"ok": False, "error": "old_text is required to remove a memory entry."}
                matches = [i for i, e in enumerate(entries) if needle.lower() in e.lower()]
                if not matches:
                    return {"ok": False, "error": f"No {tgt} memory entry matched '{needle}'."}
                idx = matches[0]
                removed = entries[idx]
                candidate = [e for i, e in enumerate(entries) if i != idx]
                self._write_entries(profile_id, tgt, candidate)
                return {
                    "ok": True,
                    "target": tgt,
                    "removed": removed,
                    "message": f"Removed entry from persistent {tgt} memory.",
                    "entries": candidate,
                    "usage": self._usage(candidate, limit),
                }

            return {"ok": False, "error": f"Unsupported memory action: {action!r}. Use add, replace, patch, remove, or read."}

    def snapshot_prompt_block(self, profile_id: str = "default") -> str:
        """Format curated USER.md + MEMORY.md blocks for system prompt injection."""
        with self._lock:
            user_entries = self._read_entries(profile_id, "user")
            mem_entries = self._read_entries(profile_id, "memory")

        sections: list[str] = []
        if user_entries:
            u_usage = self._usage(user_entries, self._user_limit)
            body = "\n".join(f"- {e}" for e in user_entries)
            sections.append(
                f"══════════════════════════════════════════════\n"
                f"USER PROFILE [{u_usage['percent']}% — {u_usage['usedChars']}/{u_usage['limitChars']} chars]\n"
                f"══════════════════════════════════════════════\n"
                f"{body}"
            )
        if mem_entries:
            m_usage = self._usage(mem_entries, self._memory_limit)
            body = "\n".join(f"- {e}" for e in mem_entries)
            sections.append(
                f"══════════════════════════════════════════════\n"
                f"MEMORY (your personal notes) [{m_usage['percent']}% — {m_usage['usedChars']}/{m_usage['limitChars']} chars]\n"
                f"══════════════════════════════════════════════\n"
                f"{body}"
            )
        return "\n\n".join(sections)

    def list_all(self, profile_id: str = "default") -> dict[str, Any]:
        with self._lock:
            user_entries = self._read_entries(profile_id, "user")
            mem_entries = self._read_entries(profile_id, "memory")
            return {
                "profileId": _safe_profile_id(profile_id),
                "user": {
                    "entries": user_entries,
                    "usage": self._usage(user_entries, self._user_limit),
                },
                "memory": {
                    "entries": mem_entries,
                    "usage": self._usage(mem_entries, self._memory_limit),
                },
                "promptBlock": self.snapshot_prompt_block(profile_id),
            }
