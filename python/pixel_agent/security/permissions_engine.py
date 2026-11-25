"""Authoritative Python Permissions Engine for Pixel (Hermes-exact 3-tier mode policy).

Policy rules:
- `agent` mode: Auto-approves ALL risk levels (`safe`, `low`, `medium`, `high`, `critical`)
  by default — zero approval popups during autonomous execution.
- `hybrid` mode: Auto-approves `safe`, `low`, and `medium`; only asks approval for `high` / `critical`.
- `guide` mode: Auto-approves `safe` and `low`; asks approval for `medium`, `high`, and `critical`.
- `Always Allow`: Always available and persisted to disk (`permissions.json`) so future
  matching tool/command actions are automatically approved across restarts.
"""

from __future__ import annotations

import json
import os
import secrets
import threading
import time
from pathlib import Path
from typing import Any, Optional


class PermissionsEngine:
    """Thread-safe persistent Python permission & Always Allow policy engine."""

    def __init__(self, store_path: Optional[str] = None) -> None:
        if store_path is None:
            base = os.environ.get("PIXEL_WORKSPACE_DATA_DIR") or str(Path.home() / ".pixel")
            Path(base).mkdir(parents=True, exist_ok=True)
            self._path = Path(base) / "permissions_grants.json"
        else:
            self._path = Path(store_path)
            self._path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._grants: list[dict[str, Any]] = []
        self._load()

    def _load(self) -> None:
        with self._lock:
            if not self._path.exists():
                self._grants = []
                return
            try:
                data = json.loads(self._path.read_text(encoding="utf-8"))
                self._grants = data if isinstance(data, list) else []
            except Exception:
                self._grants = []

    def _save(self) -> None:
        tmp = self._path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._grants, indent=2), encoding="utf-8")
        os.replace(tmp, self._path)

    def _matches_grant(
        self,
        grant: dict[str, Any],
        tool_name: str,
        target: str,
        command: str,
    ) -> bool:
        g_tool = str(grant.get("toolName") or "").strip().lower()
        if g_tool != "*" and g_tool != (tool_name or "").strip().lower():
            return False
        g_prefix = str(grant.get("commandPrefix") or "").strip().lower()
        if g_prefix:
            cmd_l = (command or "").strip().lower()
            if not cmd_l.startswith(g_prefix):
                return False
        g_target = str(grant.get("target") or "*").strip().lower()
        if g_target and g_target != "*":
            if g_target not in (target or "").strip().lower():
                return False
        return True

    def evaluate(
        self,
        *,
        mode: str,
        tool_name: str,
        risk: str = "medium",
        target: str = "",
        command: str = "",
    ) -> dict[str, Any]:
        clean_mode = (mode or "agent").strip().lower()
        clean_risk = (risk or "medium").strip().lower()

        # 1. Agentic mode: ALL permissions granted automatically by default.
        if clean_mode == "agent":
            return {
                "allowed": True,
                "needsApproval": False,
                "alwaysAllowed": True,
                "reason": "agent_mode_auto_approve",
            }

        # 2. Persistent Always Allow grant check.
        with self._lock:
            for g in self._grants:
                if self._matches_grant(g, tool_name, target, command):
                    return {
                        "allowed": True,
                        "needsApproval": False,
                        "alwaysAllowed": True,
                        "grantId": g.get("id"),
                        "reason": "always_allow_grant",
                    }

        # 3. Hybrid mode: auto-approve safe/low/medium; ask ONLY for high/critical.
        if clean_mode == "hybrid":
            if clean_risk in ("safe", "low", "medium"):
                return {
                    "allowed": True,
                    "needsApproval": False,
                    "alwaysAllowed": True,
                    "reason": "hybrid_mode_auto_approve",
                }
            return {
                "allowed": False,
                "needsApproval": True,
                "alwaysAllowed": True,
                "reason": "hybrid_requires_high_risk_approval",
            }

        # 4. Guide mode: auto-approve safe/low; ask for medium/high/critical.
        if clean_risk in ("safe", "low"):
            return {
                "allowed": True,
                "needsApproval": False,
                "alwaysAllowed": True,
                "reason": "guide_mode_auto_approve",
            }
        return {
            "allowed": False,
            "needsApproval": True,
            "alwaysAllowed": True,
            "reason": "guide_requires_medium_or_high_approval",
        }

    def grant_always(
        self,
        *,
        tool_name: str,
        target: str = "*",
        command_prefix: str = "",
        label: str = "",
    ) -> dict[str, Any]:
        with self._lock:
            t_name = (tool_name or "").strip() or "*"
            t_target = (target or "*").strip() or "*"
            c_prefix = (command_prefix or "").strip()
            for existing in self._grants:
                if (
                    existing.get("toolName") == t_name
                    and existing.get("target") == t_target
                    and existing.get("commandPrefix") == c_prefix
                ):
                    return {"ok": True, "duplicate": True, "grant": existing}
            grant = {
                "id": f"grant_{secrets.token_hex(6)}",
                "toolName": t_name,
                "target": t_target,
                "commandPrefix": c_prefix,
                "label": label or f"Always allow {t_name}",
                "createdAt": int(time.time() * 1000),
            }
            self._grants.append(grant)
            self._save()
            return {"ok": True, "duplicate": False, "grant": grant}

    def list_grants(self) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(g) for g in self._grants]

    def revoke_grant(self, grant_id: str) -> dict[str, Any]:
        with self._lock:
            before = len(self._grants)
            self._grants = [g for g in self._grants if g.get("id") != grant_id]
            changed = len(self._grants) != before
            if changed:
                self._save()
            return {"ok": True, "revoked": changed, "remaining": len(self._grants)}

    def clear_grants(self) -> dict[str, Any]:
        with self._lock:
            count = len(self._grants)
            self._grants.clear()
            self._save()
            return {"ok": True, "cleared": count}
