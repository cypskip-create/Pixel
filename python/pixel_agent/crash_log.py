"""Crash forensics logger (stderr + optional redacted log file; never touches stdout)."""

from __future__ import annotations

import os
import sys
import time
import traceback
from typing import Optional

from .errors import redact_secrets


def _crash_log_path() -> Optional[str]:
    path = os.environ.get("PIXEL_AGENT_CRASH_LOG", "").strip()
    return path or None


def record_crash(kind: str, exc_type: type[BaseException], exc_value: BaseException, exc_tb: object) -> None:
    trace = redact_secrets("".join(traceback.format_exception(exc_type, exc_value, exc_tb)))
    summary = redact_secrets(str(exc_value).strip().splitlines()[0] if str(exc_value).strip() else exc_type.__name__)
    log_path = _crash_log_path()
    if log_path:
        try:
            os.makedirs(os.path.dirname(log_path), exist_ok=True)
            with open(log_path, "a", encoding="utf-8") as handle:
                handle.write(f"\n=== {kind} · {time.strftime('%Y-%m-%d %H:%M:%S')} ===\n{trace}\n")
        except OSError:
            pass
    try:
        sys.stderr.write(f"[pixel-agent-crash] {exc_type.__name__}: {summary}\n")
        sys.stderr.flush()
    except OSError:
        pass


def install_panic_hook() -> None:
    def _hook(exc_type: type[BaseException], exc_value: BaseException, exc_tb: object) -> None:
        record_crash("unhandled exception", exc_type, exc_value, exc_tb)
        sys.__excepthook__(exc_type, exc_value, exc_tb)

    sys.excepthook = _hook
