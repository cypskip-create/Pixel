#!/usr/bin/env python3
"""
Pixel Python Agent Service prototype (protocol: pixel-agent-v1).

Incremental Hermes-inspired Python agent boundary over stdio JSONL:
  - Owns stateless/bounded reasoning helpers, planning metadata, and selective
    memory scoring in Python.
  - NEVER executes shell commands, filesystem mutations, credential reads, or
    Windows UI Automation directly. All tool authorization and execution remain
    strictly inside Electron's main-process PermissionBroker.
"""

from __future__ import annotations

import json
import os
import sys
import time
from typing import Any

PROTOCOL_VERSION = "pixel-agent-v1"
CANCELLED_IDS: set[str] = set()


def _send(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _handle_ping(req_id: str) -> dict[str, Any]:
    return {
        "id": req_id,
        "ok": True,
        "result": {
            "protocol": PROTOCOL_VERSION,
            "pid": os.getpid(),
            "python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
            "timestampMs": int(time.time() * 1000),
            "authority": "advisory-only",
        },
    }


def _handle_plan_turn(req_id: str, params: dict[str, Any]) -> dict[str, Any]:
    if req_id in CANCELLED_IDS:
        return {"id": req_id, "ok": False, "error": "cancelled"}
    prompt = str(params.get("prompt", "")).strip()
    mode = str(params.get("mode", "hybrid"))
    allowed_tools = [str(t) for t in params.get("allowedTools", []) if isinstance(t, str)]
    if not prompt:
        return {"id": req_id, "ok": False, "error": "Prompt is required."}

    lower = prompt.lower()
    suggested_tools: list[str] = []
    if any(k in lower for k in ("git ", "repository", "commit", "branch", "diff", "clone")):
        suggested_tools = [t for t in allowed_tools if t.startswith("git_") or "github" in t][:6]
    elif any(k in lower for k in ("file", "folder", "read ", "search ")):
        suggested_tools = [t for t in allowed_tools if t.startswith("file_") or t.startswith("documents_")][:6]

    return {
        "id": req_id,
        "ok": True,
        "result": {
            "protocol": PROTOCOL_VERSION,
            "mode": mode,
            "suggestedTools": suggested_tools,
            "requiresMainProcessAuthorization": True,
        },
    }


def _handle_score_memory(req_id: str, params: dict[str, Any]) -> dict[str, Any]:
    text = str(params.get("text", "")).strip()
    existing = [str(x).lower().strip() for x in params.get("existing", []) if isinstance(x, str)]
    if not text or text.endswith("?"):
        return {"id": req_id, "ok": True, "result": {"keep": False, "score": 0.1, "reason": "question-or-empty"}}
    norm = text.lower().strip()
    if norm in existing:
        return {"id": req_id, "ok": True, "result": {"keep": False, "score": 0.0, "reason": "duplicate"}}
    has_durable_signal = any(
        kw in norm for kw in ("prefer", "always use", "project uses", "remember", "workflow", "correction")
    )
    score = 0.88 if has_durable_signal else 0.35
    return {
        "id": req_id,
        "ok": True,
        "result": {"keep": score >= 0.65, "score": score, "reason": "durable-signal" if has_durable_signal else "low-relevance"},
    }


def main() -> int:
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            _send({"id": None, "ok": False, "error": "invalid-json"})
            continue

        req_id = str(msg.get("id", ""))
        method = str(msg.get("method", ""))
        params = msg.get("params") if isinstance(msg.get("params"), dict) else {}

        if method == "ping":
            _send(_handle_ping(req_id))
        elif method == "plan_turn":
            _send(_handle_plan_turn(req_id, params))
        elif method == "score_memory":
            _send(_handle_score_memory(req_id, params))
        elif method == "cancel":
            target_id = str(params.get("targetId", ""))
            if target_id:
                CANCELLED_IDS.add(target_id)
            _send({"id": req_id, "ok": True, "result": {"cancelled": target_id}})
        elif method == "shutdown":
            _send({"id": req_id, "ok": True, "result": {"shuttingDown": True}})
            break
        else:
            _send({"id": req_id, "ok": False, "error": f"unknown-method:{method}"})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
