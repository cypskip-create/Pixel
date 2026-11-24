"""Phase 3: Bounded Minimal-Env Python Code Execution Tool (Hermes `tools/code_execution_tool.py`).

Security invariants:
  - Spawns isolated subprocess with strictly allowlisted minimal environment
    (NEVER inherits API keys, tokens, or secrets).
  - Enforces wall-clock timeout and output byte caps.
  - Intended to run ONLY after Electron's `PermissionBroker` approves the call.
"""

from __future__ import annotations

import os
import subprocess
import sys
from typing import Any, Optional

MINIMAL_ENV_KEYS = ("PATH", "PATHEXT", "SYSTEMROOT", "COMSPEC", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "LANG", "LC_ALL")
MAX_OUTPUT_CHARS = 16_000


def _minimal_env() -> dict[str, str]:
    env = {k: os.environ[k] for k in MINIMAL_ENV_KEYS if k in os.environ}
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    return env


def run_bounded_python(
    code: str,
    *,
    cwd: Optional[str] = None,
    timeout_s: float = 15.0,
) -> dict[str, Any]:
    script = (code or "").strip()
    if not script:
        return {"ok": False, "error": "Python code cannot be empty."}
    bounded_timeout = max(0.5, min(float(timeout_s), 60.0))
    try:
        proc = subprocess.run(
            [sys.executable, "-I", "-c", script],
            cwd=cwd,
            env=_minimal_env(),
            capture_output=True,
            text=True,
            timeout=bounded_timeout,
        )
        stdout = (proc.stdout or "")[:MAX_OUTPUT_CHARS]
        stderr = (proc.stderr or "")[:MAX_OUTPUT_CHARS]
        return {
            "ok": proc.returncode == 0,
            "exitCode": proc.returncode,
            "stdout": stdout,
            "stderr": stderr,
        }
    except subprocess.TimeoutExpired as exc:
        return {
            "ok": False,
            "timeout": True,
            "exitCode": None,
            "stdout": (exc.stdout.decode("utf-8", errors="replace") if isinstance(exc.stdout, bytes) else (exc.stdout or ""))[:MAX_OUTPUT_CHARS],
            "stderr": f"Timed out after {bounded_timeout}s.",
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
