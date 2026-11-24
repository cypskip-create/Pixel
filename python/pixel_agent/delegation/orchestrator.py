"""Phase 3: Async Resumable Subagent Delegation Orchestrator.

Adapted from Hermes `tools/delegate_tool*.py`, `tools/async_delegation*.py`,
and `agent/delegation_context.py`.

Key invariants:
  - Enforces hard concurrency ceiling (`MAX_CONCURRENT_CHILDREN = 3`).
  - Strips delegation tools from child allowlists to prevent recursive delegation.
  - Propagates parent cancellation into all running child tasks.
  - Supports both synchronous (`delegate_sync`) and async background (`delegate_async`)
    child runs plus resumable continuation (`continue_child`) preserving child history.
"""

from __future__ import annotations

import secrets
import threading
import time
from typing import Any, Callable, Optional

MAX_CONCURRENT_CHILDREN = 3
DELEGATION_BLOCKED_TOOLS = frozenset({"delegate_task", "delegate_parallel", "delegate_to_specialist", "delegate_async"})


class DelegationOrchestrator:
    """Manages bounded parallel & resumable child agent runs in Python."""

    def __init__(
        self,
        *,
        run_child_fn: Callable[[dict[str, Any], threading.Event], dict[str, Any]],
        emit_progress: Optional[Callable[[dict[str, Any]], None]] = None,
        max_concurrent: int = MAX_CONCURRENT_CHILDREN,
    ) -> None:
        self._run_child_fn = run_child_fn
        self._emit = emit_progress or (lambda _: None)
        self._max_concurrent = max(1, min(int(max_concurrent), MAX_CONCURRENT_CHILDREN))
        self._sem = threading.Semaphore(self._max_concurrent)
        self._lock = threading.Lock()
        self._children: dict[str, dict[str, Any]] = {}
        self._cancels: dict[str, threading.Event] = {}

    def _filter_child_tools(self, allowed_tools: list[str]) -> list[str]:
        return [t for t in allowed_tools if t not in DELEGATION_BLOCKED_TOOLS]

    def spawn_async(
        self,
        *,
        parent_task_id: str,
        specialist_id: str,
        goal: str,
        allowed_tools: list[str],
        profile_id: str = "default",
        project_id: str = "default",
        parent_cancel: Optional[threading.Event] = None,
    ) -> dict[str, Any]:
        child_id = f"sub_{secrets.token_hex(5)}"
        cancel_ev = threading.Event()
        safe_tools = self._filter_child_tools(allowed_tools)
        now = int(time.time() * 1000)
        record = {
            "id": child_id,
            "parentTaskId": parent_task_id,
            "specialistId": specialist_id or "general",
            "goal": (goal or "").strip()[:2000],
            "allowedTools": safe_tools,
            "profileId": profile_id,
            "projectId": project_id,
            "status": "queued",
            "result": "",
            "error": None,
            "history": [{"role": "user", "content": (goal or "").strip()[:2000]}],
            "createdAt": now,
            "updatedAt": now,
        }
        with self._lock:
            self._children[child_id] = record
            self._cancels[child_id] = cancel_ev

        def _worker() -> None:
            if parent_cancel is not None and parent_cancel.is_set():
                cancel_ev.set()
            with self._sem:
                if cancel_ev.is_set() or (parent_cancel is not None and parent_cancel.is_set()):
                    self._finish(child_id, status="cancelled", error="Cancelled before start.")
                    return
                with self._lock:
                    self._children[child_id]["status"] = "running"
                    self._children[child_id]["updatedAt"] = int(time.time() * 1000)
                self._emit({"type": "delegation.progress", "childId": child_id, "parentTaskId": parent_task_id, "status": "running"})

                # Propagate parent cancel into child cancel event
                linked_cancel = cancel_ev
                if parent_cancel is not None:
                    def _watch_parent() -> None:
                        while not cancel_ev.is_set():
                            if parent_cancel.is_set():
                                cancel_ev.set()
                                return
                            time.sleep(0.05)
                    threading.Thread(target=_watch_parent, daemon=True).start()

                try:
                    out = self._run_child_fn(dict(self._children[child_id]), linked_cancel)
                    if linked_cancel.is_set():
                        self._finish(child_id, status="cancelled", error="Cancelled during execution.")
                    elif out.get("ok"):
                        content = str(out.get("content") or "")
                        with self._lock:
                            self._children[child_id]["history"].append({"role": "assistant", "content": content})
                        self._finish(child_id, status="completed", result=content)
                    else:
                        self._finish(child_id, status="failed", error=str(out.get("error") or "Child run failed."))
                except Exception as exc:
                    self._finish(child_id, status="failed", error=str(exc))

        threading.Thread(target=_worker, name=f"pixel-sub-{child_id}", daemon=True).start()
        return {"ok": True, "child": dict(record)}

    def _finish(self, child_id: str, *, status: str, result: str = "", error: Optional[str] = None) -> None:
        with self._lock:
            rec = self._children.get(child_id)
            if not rec:
                return
            rec["status"] = status
            if result:
                rec["result"] = result[:8000]
            rec["error"] = error
            rec["updatedAt"] = int(time.time() * 1000)
            snap = dict(rec)
        self._emit({"type": "delegation.progress", "childId": child_id, "parentTaskId": snap["parentTaskId"], "status": status})

    def continue_child(self, child_id: str, follow_up: str) -> dict[str, Any]:
        """Resume a completed/failed child session with a follow-up prompt preserving its history."""
        with self._lock:
            rec = self._children.get(child_id)
            if not rec:
                return {"ok": False, "error": f"Child run '{child_id}' not found."}
            if rec["status"] in ("queued", "running"):
                return {"ok": False, "error": "Child run is currently active."}
            rec["history"].append({"role": "user", "content": (follow_up or "").strip()[:2000]})
            rec["status"] = "running"
            rec["error"] = None
            rec["updatedAt"] = int(time.time() * 1000)
            cancel_ev = threading.Event()
            self._cancels[child_id] = cancel_ev
            snapshot = dict(rec)

        out = self._run_child_fn(snapshot, cancel_ev)
        if out.get("ok"):
            content = str(out.get("content") or "")
            with self._lock:
                self._children[child_id]["history"].append({"role": "assistant", "content": content})
            self._finish(child_id, status="completed", result=content)
        else:
            self._finish(child_id, status="failed", error=str(out.get("error") or "Continuation failed."))
        return {"ok": bool(out.get("ok")), "child": self.get_child(child_id)}

    def cancel_child(self, child_id: str) -> bool:
        with self._lock:
            ev = self._cancels.get(child_id)
            if ev is None:
                return False
            ev.set()
            return True

    def cancel_parent(self, parent_task_id: str) -> int:
        count = 0
        with self._lock:
            for cid, rec in self._children.items():
                if rec.get("parentTaskId") == parent_task_id:
                    ev = self._cancels.get(cid)
                    if ev is not None and not ev.is_set():
                        ev.set()
                        count += 1
        return count

    def get_child(self, child_id: str) -> Optional[dict[str, Any]]:
        with self._lock:
            rec = self._children.get(child_id)
            return dict(rec) if rec else None

    def list_children(self, *, parent_task_id: Optional[str] = None) -> list[dict[str, Any]]:
        with self._lock:
            items = [dict(r) for r in self._children.values()]
        if parent_task_id:
            items = [r for r in items if r.get("parentTaskId") == parent_task_id]
        return items

    def wait_for(self, child_id: str, timeout_s: float = 10.0) -> Optional[dict[str, Any]]:
        deadline = time.monotonic() + max(0.1, timeout_s)
        while time.monotonic() < deadline:
            rec = self.get_child(child_id)
            if rec is None or rec["status"] in ("completed", "failed", "cancelled"):
                return rec
            time.sleep(0.02)
        return self.get_child(child_id)
