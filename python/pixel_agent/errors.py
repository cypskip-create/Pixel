"""Typed error codes and secret redaction for Pixel's Python agent runtime."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

_SECRET_PATTERNS = (
    re.compile(r"\bsk-[A-Za-z0-9_-]{10,}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{16,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bBearer\s+[A-Za-z0-9._~+/-]{12,}", re.IGNORECASE),
    re.compile(r"(?i)(api[_-]?key|authorization|token|password|secret)\s*[:=]\s*['\"]?[^\s'\",}]+"),
)

MAX_TOOL_ERROR_CHARS = 2048


def redact_secrets(text: str) -> str:
    """Scrub API keys, bearer tokens, and secret assignments before logging or surfacing errors."""
    if not text:
        return ""
    cleaned = text
    for pattern in _SECRET_PATTERNS:
        cleaned = pattern.sub("[REDACTED]", cleaned)
    return cleaned


def bound_error_text(text: str, limit: int = MAX_TOOL_ERROR_CHARS) -> str:
    """Redact and cap error bodies so huge tracebacks never bloat model context."""
    safe = redact_secrets(text or "")
    if len(safe) <= limit:
        return safe
    return safe[:limit] + "… [truncated]"


@dataclass
class AgentError(Exception):
    """Structured error normalized across provider, protocol, and budget layers."""

    code: str
    message: str
    retryable: bool = False
    detail: str | None = None

    def __post_init__(self) -> None:
        self.message = redact_secrets(self.message)
        if self.detail is not None:
            self.detail = bound_error_text(self.detail, 512)
        super().__init__(self.message)

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
        }
        if self.detail:
            payload["detail"] = self.detail
        return payload
