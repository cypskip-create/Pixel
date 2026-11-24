"""Authoritative Python-First Stage 9 Workspace Services:
Profiles, Persistent Artifacts, Grounded Starmap Graph, and Session Import.

Adapted from Hermes `apps/desktop/electron/desktop-profile.ts`, `artifacts/`,
`starmap/`, and `session-import/`:
  - Isolated per-profile directories & settings with default-profile protection.
  - Persistent artifact index scoped by `(profileId, projectId)`.
  - Grounded Starmap graph built strictly from real memory/skills/sessions/artifacts
    (never fabricating synthetic nodes or relationships).
  - Safe conversation import with format validation, preview, and duplicate detection.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import shutil
import time
from pathlib import Path
from typing import Any, Optional

PROFILE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,47}$")


class WorkspaceServices:
    """Persistent Stage 9 Python backend for Profiles, Artifacts, Starmap, and Session Import."""

    def __init__(self, data_dir: Optional[str | Path] = None) -> None:
        default_root = Path(os.environ.get("PIXEL_WORKSPACE_DATA_DIR") or (Path.home() / ".pixel" / "workspace"))
        self.data_dir = Path(data_dir) if data_dir else default_root
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.profiles_dir = self.data_dir / "profiles"
        self.profiles_dir.mkdir(parents=True, exist_ok=True)
        self.state_path = self.data_dir / "workspace-state.json"

        self._state: dict[str, Any] = self._load_state()
        self._ensure_default_profile()

    def _load_state(self) -> dict[str, Any]:
        if self.state_path.is_file():
            try:
                parsed = json.loads(self.state_path.read_text(encoding="utf-8"))
                if isinstance(parsed, dict):
                    parsed.setdefault("activeProfileId", "default")
                    parsed.setdefault("profiles", {})
                    parsed.setdefault("artifacts", [])
                    parsed.setdefault("importedSessionHashes", [])
                    return parsed
            except Exception:
                pass
        return {
            "version": 1,
            "activeProfileId": "default",
            "profiles": {},
            "artifacts": [],
            "importedSessionHashes": [],
        }

    def _save_state(self) -> None:
        tmp = self.state_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._state, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self.state_path)

    def _ensure_default_profile(self) -> None:
        profiles = self._state.setdefault("profiles", {})
        if "default" not in profiles:
            (self.profiles_dir / "default").mkdir(parents=True, exist_ok=True)
            profiles["default"] = {
                "id": "default",
                "name": "Default",
                "description": "Primary Pixel desktop profile.",
                "instructions": "",
                "providerOverride": "",
                "modelOverride": "",
                "isDefault": True,
                "createdAt": int(time.time() * 1000),
                "updatedAt": int(time.time() * 1000),
            }
            self._save_state()

    # ------------------------------------------------------------------
    # Profiles (Isolated, Atomic Switch, Default Protected)
    # ------------------------------------------------------------------

    def list_profiles(self) -> dict[str, Any]:
        active = str(self._state.get("activeProfileId") or "default")
        items = [
            {**p, "active": p["id"] == active, "dataDir": str(self.profiles_dir / p["id"])}
            for p in self._state.get("profiles", {}).values()
        ]
        items.sort(key=lambda x: (not x.get("isDefault", False), x.get("name", "").lower()))
        return {"ok": True, "activeProfileId": active, "profiles": items}

    def create_profile(
        self,
        name: str,
        *,
        description: str = "",
        instructions: str = "",
        provider_override: str = "",
        model_override: str = "",
    ) -> dict[str, Any]:
        clean_name = (name or "").strip()[:60]
        if not clean_name:
            return {"ok": False, "error": "Profile name cannot be empty."}
        slug = re.sub(r"[^a-z0-9_-]+", "-", clean_name.lower()).strip("-_") or f"profile-{secrets.token_hex(3)}"
        if not PROFILE_ID_RE.match(slug):
            slug = f"p-{secrets.token_hex(4)}"
        if slug in self._state["profiles"]:
            slug = f"{slug[:38]}-{secrets.token_hex(3)}"

        (self.profiles_dir / slug).mkdir(parents=True, exist_ok=True)
        now = int(time.time() * 1000)
        rec = {
            "id": slug,
            "name": clean_name,
            "description": (description or "").strip()[:240],
            "instructions": (instructions or "").strip()[:4000],
            "providerOverride": (provider_override or "").strip(),
            "modelOverride": (model_override or "").strip(),
            "isDefault": False,
            "createdAt": now,
            "updatedAt": now,
        }
        self._state["profiles"][slug] = rec
        self._save_state()
        return {"ok": True, "profile": {**rec, "active": False, "dataDir": str(self.profiles_dir / slug)}}

    def switch_profile(self, profile_id: str) -> dict[str, Any]:
        pid = (profile_id or "").strip()
        if pid not in self._state["profiles"]:
            return {"ok": False, "error": f"Profile '{pid}' not found."}
        self._state["activeProfileId"] = pid
        self._save_state()
        return {"ok": True, "activeProfileId": pid, "profile": self._state["profiles"][pid]}

    def update_profile(self, profile_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        pid = (profile_id or "").strip()
        rec = self._state["profiles"].get(pid)
        if not rec:
            return {"ok": False, "error": f"Profile '{pid}' not found."}
        if isinstance(patch.get("name"), str) and patch["name"].strip():
            rec["name"] = patch["name"].strip()[:60]
        if isinstance(patch.get("description"), str):
            rec["description"] = patch["description"].strip()[:240]
        if isinstance(patch.get("instructions"), str):
            rec["instructions"] = patch["instructions"].strip()[:4000]
        if isinstance(patch.get("providerOverride"), str):
            rec["providerOverride"] = patch["providerOverride"].strip()
        if isinstance(patch.get("modelOverride"), str):
            rec["modelOverride"] = patch["modelOverride"].strip()
        rec["updatedAt"] = int(time.time() * 1000)
        self._save_state()
        return {"ok": True, "profile": dict(rec)}

    def delete_profile(self, profile_id: str) -> dict[str, Any]:
        pid = (profile_id or "").strip()
        if pid == "default":
            return {"ok": False, "error": "The default profile is protected and cannot be deleted."}
        if pid not in self._state["profiles"]:
            return {"ok": False, "error": f"Profile '{pid}' not found."}
        if self._state.get("activeProfileId") == pid:
            self._state["activeProfileId"] = "default"
        self._state["profiles"].pop(pid, None)
        # Remove profile-scoped artifacts
        self._state["artifacts"] = [a for a in self._state.get("artifacts", []) if a.get("profileId") != pid]
        pdir = self.profiles_dir / pid
        if pdir.exists():
            shutil.rmtree(pdir, ignore_errors=True)
        self._save_state()
        return {"ok": True, "deleted": pid, "activeProfileId": self._state["activeProfileId"]}

    # ------------------------------------------------------------------
    # Persistent Artifacts Registry (Profile + Project Scoped)
    # ------------------------------------------------------------------

    def register_artifact(
        self,
        *,
        kind: str,
        name: str,
        mime_type: str = "application/octet-stream",
        file_path: str = "",
        project_id: str = "default",
        profile_id: Optional[str] = None,
        session_id: str = "",
        task_id: str = "",
        size_bytes: int = 0,
        preview_text: str = "",
    ) -> dict[str, Any]:
        pid = profile_id or str(self._state.get("activeProfileId") or "default")
        art = {
            "id": f"art_{secrets.token_hex(6)}",
            "kind": (kind or "file").strip().lower(),
            "name": (name or "Untitled Artifact").strip()[:160],
            "mimeType": (mime_type or "application/octet-stream").strip(),
            "filePath": file_path,
            "projectId": (project_id or "default").strip(),
            "profileId": pid,
            "sessionId": session_id,
            "taskId": task_id,
            "sizeBytes": max(0, int(size_bytes)),
            "previewText": (preview_text or "")[:1000],
            "createdAt": int(time.time() * 1000),
            "version": 1,
        }
        self._state.setdefault("artifacts", []).append(art)
        if len(self._state["artifacts"]) > 500:
            self._state["artifacts"] = self._state["artifacts"][-500:]
        self._save_state()
        return {"ok": True, "artifact": dict(art)}

    def list_artifacts(
        self,
        *,
        profile_id: Optional[str] = None,
        project_id: Optional[str] = None,
        kind: Optional[str] = None,
        query: str = "",
    ) -> list[dict[str, Any]]:
        pid = profile_id or str(self._state.get("activeProfileId") or "default")
        q = (query or "").strip().lower()
        out: list[dict[str, Any]] = []
        for art in reversed(self._state.get("artifacts", [])):
            if art.get("profileId") != pid:
                continue
            if project_id and art.get("projectId") != project_id:
                continue
            if kind and kind != "all" and art.get("kind") != kind:
                continue
            if q and q not in str(art.get("name", "")).lower() and q not in str(art.get("previewText", "")).lower():
                continue
            exists = bool(art.get("filePath") and Path(str(art["filePath"])).exists())
            out.append({**art, "fileExists": exists})
        return out

    def delete_artifact(self, artifact_id: str) -> dict[str, Any]:
        before = len(self._state.get("artifacts", []))
        self._state["artifacts"] = [a for a in self._state.get("artifacts", []) if a.get("id") != artifact_id]
        if len(self._state["artifacts"]) == before:
            return {"ok": False, "error": f"Artifact '{artifact_id}' not found."}
        self._save_state()
        return {"ok": True, "deleted": artifact_id}

    # ------------------------------------------------------------------
    # Grounded Starmap Graph (Strictly Real Data, Zero Fabrication)
    # ------------------------------------------------------------------

    def build_starmap(
        self,
        *,
        memories: list[dict[str, Any]],
        skills: list[dict[str, Any]],
        sessions: list[dict[str, Any]],
        profile_id: Optional[str] = None,
        project_id: Optional[str] = None,
    ) -> dict[str, Any]:
        pid = profile_id or str(self._state.get("activeProfileId") or "default")
        nodes: list[dict[str, Any]] = []
        edges: list[dict[str, Any]] = []
        tag_owners: dict[str, list[str]] = {}

        for m in memories[:120]:
            nid = f"mem:{m.get('id', secrets.token_hex(4))}"
            nodes.append({
                "id": nid,
                "kind": "memory",
                "label": str(m.get("content") or "")[:64],
                "timestamp": int(m.get("updatedAt") or m.get("createdAt") or 0),
                "meta": {"kind": m.get("kind"), "tags": m.get("tags") or []},
            })
            for tag in m.get("tags") or []:
                t = str(tag).strip().lower()
                if t:
                    tag_owners.setdefault(t, []).append(nid)

        for s in skills[:60]:
            nid = f"skill:{s.get('id', secrets.token_hex(4))}"
            nodes.append({
                "id": nid,
                "kind": "skill",
                "label": str(s.get("name") or s.get("id") or "Skill")[:64],
                "timestamp": int(s.get("updatedAt") or s.get("createdAt") or 0),
                "meta": {"status": s.get("status")},
            })

        for conv in sessions[:80]:
            nid = f"session:{conv.get('id', secrets.token_hex(4))}"
            nodes.append({
                "id": nid,
                "kind": "session",
                "label": str(conv.get("title") or "Conversation")[:64],
                "timestamp": int(conv.get("updatedAt") or conv.get("createdAt") or 0),
                "meta": {"messageCount": conv.get("messageCount", 0)},
            })

        for art in self.list_artifacts(profile_id=pid, project_id=project_id)[:60]:
            nid = f"artifact:{art['id']}"
            nodes.append({
                "id": nid,
                "kind": "artifact",
                "label": art["name"][:64],
                "timestamp": art["createdAt"],
                "meta": {"mimeType": art["mimeType"], "kind": art["kind"]},
            })
            if art.get("sessionId"):
                edges.append({"source": f"session:{art['sessionId']}", "target": nid, "relation": "produced"})

        # Connect memory nodes sharing an explicit user/system tag (grounded relationship)
        for tag, owners in tag_owners.items():
            for idx in range(len(owners) - 1):
                edges.append({"source": owners[idx], "target": owners[idx + 1], "relation": f"tag:{tag}"})

        timeline = sorted(
            [{"id": n["id"], "kind": n["kind"], "label": n["label"], "timestamp": n["timestamp"]} for n in nodes if n["timestamp"] > 0],
            key=lambda x: x["timestamp"],
        )
        return {
            "ok": True,
            "profileId": pid,
            "projectId": project_id or "default",
            "nodes": nodes,
            "edges": edges,
            "timeline": timeline,
        }

    # ------------------------------------------------------------------
    # Session Import (Validation, Preview, Duplicate Detection)
    # ------------------------------------------------------------------

    def preview_session_import(self, raw_text: str, *, format_hint: str = "json") -> dict[str, Any]:
        text = (raw_text or "").strip()
        if not text:
            return {"ok": False, "error": "Import content is empty."}
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:24]
        duplicate = digest in set(self._state.get("importedSessionHashes", []))

        sessions: list[dict[str, Any]] = []
        if format_hint == "json" or text.startswith("{") or text.startswith("["):
            try:
                parsed = json.loads(text)
            except Exception as exc:
                return {"ok": False, "error": f"Invalid JSON session export: {exc}"}
            raw_list = parsed if isinstance(parsed, list) else (parsed.get("conversations") if isinstance(parsed, dict) and isinstance(parsed.get("conversations"), list) else [parsed])
            for item in raw_list:
                if not isinstance(item, dict):
                    continue
                msgs = item.get("messages") if isinstance(item.get("messages"), list) else []
                clean_msgs = [
                    {"role": str(m.get("role") or "user"), "content": str(m.get("content") or "")}
                    for m in msgs
                    if isinstance(m, dict) and str(m.get("content") or "").strip()
                ]
                if clean_msgs:
                    sessions.append({
                        "title": str(item.get("title") or "Imported Conversation")[:100],
                        "messages": clean_msgs,
                    })
        else:
            # Markdown transcript import (`User:` / `Assistant:` blocks)
            blocks = re.split(r"(?m)^(User|Assistant):\s*", text)
            msgs: list[dict[str, str]] = []
            for i in range(1, len(blocks) - 1, 2):
                role = "user" if blocks[i].lower() == "user" else "assistant"
                content = blocks[i + 1].strip()
                if content:
                    msgs.append({"role": role, "content": content})
            if msgs:
                sessions.append({"title": "Imported Markdown Session", "messages": msgs})

        if not sessions:
            return {"ok": False, "error": "No valid conversation messages found in import payload."}
        return {
            "ok": True,
            "digest": digest,
            "duplicate": duplicate,
            "sessionCount": len(sessions),
            "messageCount": sum(len(s["messages"]) for s in sessions),
            "sessions": sessions,
        }

    def commit_session_import(self, raw_text: str, *, format_hint: str = "json") -> dict[str, Any]:
        preview = self.preview_session_import(raw_text, format_hint=format_hint)
        if not preview.get("ok"):
            return preview
        if preview.get("duplicate"):
            return {"ok": False, "duplicate": True, "error": "This session export was already imported."}
        self._state.setdefault("importedSessionHashes", []).append(preview["digest"])
        self._save_state()
        return {"ok": True, "imported": preview["sessionCount"], "messages": preview["messageCount"], "sessions": preview["sessions"]}
