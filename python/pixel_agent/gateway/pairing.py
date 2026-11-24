"""Secure user pairing, remote capability scopes & cross-device auth (Hermes gateway/pairing.py parity).

Security invariants:
  - Unknown remote users are DENIED by default until explicitly paired & approved by the Pixel owner.
  - Authorization is keyed by verified `(platform, account_id)` — never display names.
  - Pairing codes use `secrets`, expire automatically, rate-limit requests, and lock out after failed attempts.
  - Remote users default to minimal `["read_only"]` capability scope and require explicit `projectId` binding.
  - Cross-device access uses cryptographically random bearer tokens stored as SHA-256 hashes (never plaintext).
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from typing import Any, Optional

REMOTE_CAPABILITY_SCOPES: dict[str, tuple[str, ...]] = {
    "read_only": ("time_", "system_", "documents_list", "documents_search", "documents_read", "memory_search", "session_search"),
    "project_files": ("file_list", "file_read", "file_search", "file_metadata", "git_status", "git_diff", "git_log"),
    "web_research": ("web_", "browser_inspect", "browser_navigate", "browser_screenshot"),
    "browser": ("browser_",),
    "terminal": ("process_", "terminal_"),
    "computer_use": ("computer_use", "analyze_screen"),
    "scheduled_tasks": ("routine_", "skill_"),
    "integrations": ("github_", "google_calendar_", "mcp__", "plugin_"),
}

DEFAULT_REMOTE_SCOPES: tuple[str, ...] = ("read_only",)

_PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # Unambiguous uppercase alphanumeric


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class PairingManager:
    """Manages one-time user pairing, authorized remote accounts, scopes, and paired devices."""

    def __init__(
        self,
        *,
        code_ttl_s: float = 600.0,
        max_failed_attempts: int = 5,
        rate_limit_window_s: float = 60.0,
        max_requests_per_window: int = 3,
    ) -> None:
        self.code_ttl_s = code_ttl_s
        self.max_failed_attempts = max_failed_attempts
        self.rate_limit_window_s = rate_limit_window_s
        self.max_requests_per_window = max_requests_per_window

        self._pending: dict[str, dict[str, Any]] = {}  # code -> record
        self._authorized: dict[str, dict[str, Any]] = {}  # "platform:account_id" -> record
        self._devices: dict[str, dict[str, Any]] = {}  # device_id -> {id, name, tokenHash, projectId, scopes, createdAt}
        self._rate_hits: dict[str, list[float]] = {}
        self._failed_attempts: dict[str, int] = {}

    @staticmethod
    def account_key(platform: str, account_id: str) -> str:
        return f"{platform.strip().lower()}:{account_id.strip()}"

    def _prune_expired(self, now: Optional[float] = None) -> None:
        t = now if now is not None else time.time()
        for code in [c for c, rec in self._pending.items() if rec["expiresAt"] <= t]:
            self._pending.pop(code, None)

    def request_pairing(
        self,
        platform: str,
        account_id: str,
        *,
        display_name: str = "",
        chat_id: str = "",
        now: Optional[float] = None,
    ) -> dict[str, Any]:
        t = now if now is not None else time.time()
        self._prune_expired(t)
        key = self.account_key(platform, account_id)

        if self._failed_attempts.get(key, 0) >= self.max_failed_attempts:
            return {"ok": False, "error": "Too many failed pairing attempts; account is temporarily locked."}

        hits = [ts for ts in self._rate_hits.get(key, []) if t - ts < self.rate_limit_window_s]
        if len(hits) >= self.max_requests_per_window:
            return {"ok": False, "error": "Pairing rate limit exceeded. Wait before requesting another code."}
        hits.append(t)
        self._rate_hits[key] = hits

        code = "".join(secrets.choice(_PAIRING_ALPHABET) for _ in range(8))
        rec = {
            "code": code,
            "platform": platform.strip().lower(),
            "accountId": account_id.strip(),
            "displayName": display_name.strip()[:80],
            "chatId": chat_id.strip(),
            "createdAt": t,
            "expiresAt": t + self.code_ttl_s,
        }
        self._pending[code] = rec
        return {"ok": True, "code": code, "expiresAt": rec["expiresAt"]}

    def approve_pairing(
        self,
        code: str,
        *,
        project_id: str = "default",
        scopes: Optional[list[str]] = None,
        allow_groups: bool = False,
        now: Optional[float] = None,
    ) -> dict[str, Any]:
        t = now if now is not None else time.time()
        self._prune_expired(t)
        clean_code = (code or "").strip().upper()
        rec = self._pending.pop(clean_code, None)
        if not rec:
            return {"ok": False, "error": "Invalid or expired pairing code."}

        valid_scopes = [s for s in (scopes or list(DEFAULT_REMOTE_SCOPES)) if s in REMOTE_CAPABILITY_SCOPES]
        if not valid_scopes:
            valid_scopes = list(DEFAULT_REMOTE_SCOPES)

        key = self.account_key(rec["platform"], rec["accountId"])
        auth_entry = {
            "key": key,
            "platform": rec["platform"],
            "accountId": rec["accountId"],
            "displayName": rec["displayName"],
            "projectId": (project_id or "default").strip(),
            "scopes": valid_scopes,
            "allowGroups": bool(allow_groups),
            "approvedAt": t,
        }
        self._authorized[key] = auth_entry
        self._failed_attempts.pop(key, None)
        return {"ok": True, "user": dict(auth_entry)}

    def reject_pairing(self, code: str) -> dict[str, Any]:
        clean_code = (code or "").strip().upper()
        rec = self._pending.pop(clean_code, None)
        if not rec:
            return {"ok": False, "error": "Pairing request not found."}
        key = self.account_key(rec["platform"], rec["accountId"])
        self._failed_attempts[key] = self._failed_attempts.get(key, 0) + 1
        return {"ok": True, "rejected": key}

    def revoke_user(self, platform: str, account_id: str) -> dict[str, Any]:
        key = self.account_key(platform, account_id)
        removed = self._authorized.pop(key, None)
        if not removed:
            return {"ok": False, "error": f"Authorized user '{key}' not found."}
        return {"ok": True, "revoked": key}

    def is_authorized(self, platform: str, account_id: str, *, is_group: bool = False) -> tuple[bool, Optional[dict[str, Any]]]:
        key = self.account_key(platform, account_id)
        entry = self._authorized.get(key)
        if not entry:
            return False, None
        if is_group and not entry.get("allowGroups"):
            return False, None
        return True, dict(entry)

    def allowed_tools_for_user(self, user_entry: dict[str, Any], available_tools: list[str]) -> list[str]:
        """Compute the exact allowed tool names for an authorized remote user's scopes."""
        scopes = user_entry.get("scopes") or list(DEFAULT_REMOTE_SCOPES)
        prefixes: list[str] = []
        for sc in scopes:
            prefixes.extend(REMOTE_CAPABILITY_SCOPES.get(sc, ()))
        return sorted({t for t in available_tools if any(t.startswith(p) or t == p for p in prefixes)})

    def list_pending(self, now: Optional[float] = None) -> list[dict[str, Any]]:
        self._prune_expired(now)
        return [
            {
                "code": rec["code"],
                "platform": rec["platform"],
                "accountId": rec["accountId"],
                "displayName": rec["displayName"],
                "expiresAt": rec["expiresAt"],
            }
            for rec in self._pending.values()
        ]

    def list_authorized(self) -> list[dict[str, Any]]:
        return [dict(v) for v in self._authorized.values()]

    # ------------------------------------------------------------------
    # Cross-Device Pairing & Bearer Token Verification
    # ------------------------------------------------------------------

    def pair_device(
        self,
        device_name: str,
        *,
        project_id: str = "default",
        scopes: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        device_id = f"dev_{secrets.token_hex(6)}"
        raw_token = f"pxd_{secrets.token_urlsafe(24)}"
        valid_scopes = [s for s in (scopes or list(DEFAULT_REMOTE_SCOPES)) if s in REMOTE_CAPABILITY_SCOPES] or list(DEFAULT_REMOTE_SCOPES)
        record = {
            "id": device_id,
            "name": (device_name or "Paired Device").strip()[:80],
            "tokenHash": _hash_token(raw_token),
            "projectId": (project_id or "default").strip(),
            "scopes": valid_scopes,
            "createdAt": time.time(),
        }
        self._devices[device_id] = record
        return {
            "ok": True,
            "device": {k: v for k, v in record.items() if k != "tokenHash"},
            "token": raw_token,  # Shown once on pairing; never stored in plaintext!
        }

    def verify_device_token(self, token: str) -> Optional[dict[str, Any]]:
        if not token or not token.strip():
            return None
        candidate_hash = _hash_token(token.strip())
        for dev in self._devices.values():
            if hmac.compare_digest(dev["tokenHash"], candidate_hash):
                return {k: v for k, v in dev.items() if k != "tokenHash"}
        return None

    def revoke_device(self, device_id: str) -> dict[str, Any]:
        removed = self._devices.pop(device_id, None)
        if not removed:
            return {"ok": False, "error": f"Device '{device_id}' not found."}
        return {"ok": True, "revoked": device_id}

    def list_devices(self) -> list[dict[str, Any]]:
        return [{k: v for k, v in dev.items() if k != "tokenHash"} for dev in self._devices.values()]

    def export_state(self) -> dict[str, Any]:
        return {
            "authorized": dict(self._authorized),
            "devices": dict(self._devices),
        }

    def load_state(self, data: dict[str, Any]) -> None:
        if isinstance(data.get("authorized"), dict):
            self._authorized = dict(data["authorized"])
        if isinstance(data.get("devices"), dict):
            self._devices = dict(data["devices"])
