"""Phase 2: Procedural SKILL.md Engine — Parser, Threat Scanner, Index & Lifecycle.

Adapted from Hermes `tools/skills_tool*.py` and `tools/skill_manager_tool.py`.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import time
from pathlib import Path
from typing import Any, Optional

THREAT_RULES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("prompt_injection_override", re.compile(r"ignore\s+(?:all\s+)?previous\s+instructions", re.IGNORECASE)),
    ("exfiltration_curl", re.compile(r"\b(?:curl|wget|Invoke-WebRequest)\b.*(?:\$ENV:|OPENAI_API_KEY|DEEPSEEK_API_KEY|id_rsa)", re.IGNORECASE)),
    ("destructive_rm", re.compile(r"\brm\s+-rf\s+/(?:\s|$)", re.IGNORECASE)),
    ("powershell_encoded", re.compile(r"powershell(?:\.exe)?\s+.*(?:-enc|-encodedcommand)\b", re.IGNORECASE)),
)


def scan_skill_markdown(markdown: str) -> dict[str, Any]:
    findings: list[str] = []
    for rule_name, pattern in THREAT_RULES:
        if pattern.search(markdown or ""):
            findings.append(rule_name)
    return {
        "safe": len(findings) == 0,
        "status": "clean" if not findings else "blocked",
        "findings": findings,
    }


def _parse_frontmatter(markdown: str) -> tuple[dict[str, str], str]:
    text = (markdown or "").strip()
    meta: dict[str, str] = {}
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 3:
            for line in parts[1].splitlines():
                if ":" in line:
                    k, v = line.split(":", 1)
                    meta[k.strip().lower()] = v.strip().strip('"\'')
            return meta, parts[2].strip()
    return meta, text


class PythonSkillsEngine:
    """Manages profile/project-scoped procedural SKILL.md playbooks."""

    def __init__(self, data_dir: Optional[str] = None) -> None:
        base = data_dir or os.environ.get("PIXEL_WORKSPACE_DATA_DIR") or str(Path.home() / ".pixel" / "workspace")
        self._root = Path(base)
        self._root.mkdir(parents=True, exist_ok=True)
        self._path = self._root / "procedural-skills.json"
        self._skills: dict[str, dict[str, Any]] = self._load()

    def _load(self) -> dict[str, dict[str, Any]]:
        if self._path.exists():
            try:
                raw = json.loads(self._path.read_text(encoding="utf-8"))
                if isinstance(raw, dict):
                    return raw
            except Exception:
                pass
        return {}

    def _save(self) -> None:
        tmp = self._path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._skills, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self._path)

    def create_draft(
        self,
        markdown: str,
        *,
        profile_id: str = "default",
        project_id: str = "default",
        source: str = "user",
    ) -> dict[str, Any]:
        scan = scan_skill_markdown(markdown)
        meta, body = _parse_frontmatter(markdown)
        name = meta.get("name") or (body.splitlines()[0].lstrip("# ").strip() if body else "Untitled Skill")
        description = meta.get("description") or (body[:140].replace("\n", " "))
        digest = hashlib.sha256(f"{profile_id}:{project_id}:{markdown.strip()}".encode("utf-8")).hexdigest()[:16]

        for existing in self._skills.values():
            if existing.get("digest") == digest:
                return {"ok": True, "duplicate": True, "skill": dict(existing)}

        sid = f"pskill_{secrets.token_hex(5)}"
        now = int(time.time() * 1000)
        rec = {
            "id": sid,
            "name": name[:80],
            "description": description[:240],
            "markdown": markdown[:24_000],
            "profileId": profile_id,
            "projectId": project_id,
            "status": "draft",
            "pinned": False,
            "scanStatus": scan["status"],
            "scanFindings": scan["findings"],
            "digest": digest,
            "source": source,
            "createdAt": now,
            "updatedAt": now,
        }
        self._skills[sid] = rec
        self._save()
        return {"ok": True, "duplicate": False, "skill": dict(rec)}

    def activate(self, skill_id: str) -> dict[str, Any]:
        rec = self._skills.get(skill_id)
        if not rec:
            return {"ok": False, "error": f"Skill '{skill_id}' not found."}
        if rec.get("scanStatus") != "clean":
            return {"ok": False, "error": f"Skill blocked by threat scan: {', '.join(rec.get('scanFindings') or [])}"}
        rec["status"] = "active"
        rec["updatedAt"] = int(time.time() * 1000)
        self._save()
        return {"ok": True, "skill": dict(rec)}

    def list(self, *, profile_id: str = "default", project_id: str = "default") -> list[dict[str, Any]]:
        return [
            dict(s)
            for s in self._skills.values()
            if s.get("profileId") == profile_id and s.get("projectId") == project_id
        ]

    def view(self, skill_id: str) -> Optional[dict[str, Any]]:
        rec = self._skills.get(skill_id)
        return dict(rec) if rec else None

    def delete(self, skill_id: str) -> dict[str, Any]:
        removed = self._skills.pop(skill_id, None)
        if not removed:
            return {"ok": False, "error": f"Skill '{skill_id}' not found."}
        self._save()
        return {"ok": True, "deleted": skill_id}

    def build_index_prompt(self, *, profile_id: str = "default", project_id: str = "default") -> str:
        active = [
            s for s in self.list(profile_id=profile_id, project_id=project_id) if s.get("status") == "active"
        ]
        if not active:
            return ""
        lines = [f"- `{s['name']}` ({s['id']}): {s['description']}" for s in active[:25]]
        return "\n".join(lines)
