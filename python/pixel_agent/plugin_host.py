"""Controlled subprocess Plugin Host for Pixel third-party Python plugins.

Adapted from Hermes `hermes_cli/plugin_host.py` and `plugin_host_child.py`:
  - Runs third-party plugin code in a dedicated Python subprocess communicating
    over private NDJSON stdio so a crashing or hanging plugin never brings down
    Pixel's primary `agent_service.py` runtime.
  - Note on trust boundary: a separate process provides crash/timeout isolation
    and clean termination, NOT an OS-level filesystem sandbox. Every privileged
    tool invocation still passes through Electron's PermissionBroker.
"""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import threading
import uuid
from pathlib import Path
from typing import Any, Optional

from .plugin_manifest import load_manifest_from_dir
from .plugin_sdk import PluginContext


def _load_plugin_module(plugin_dir: Path, entry: str, plugin_id: str) -> Any:
    entry_path = (plugin_dir / entry).resolve()
    if not entry_path.is_file():
        raise FileNotFoundError(f"Plugin entry file not found: {entry_path}")
    try:
        entry_path.relative_to(plugin_dir.resolve())
    except ValueError as exc:
        raise ValueError(f"Plugin entry '{entry}' escapes plugin directory.") from exc

    mod_name = f"pixel_plugin_{plugin_id.replace('-', '_').replace('.', '_')}_{uuid.uuid4().hex[:6]}"
    spec = importlib.util.spec_from_file_location(mod_name, str(entry_path))
    if spec is None or spec.loader is None:
        raise ImportError(f"Could not create module spec for {entry_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run_child_server() -> int:
    """Entry point when executed as `python -m pixel_agent.plugin_host`."""
    ctx: Optional[PluginContext] = None

    def send(payload: dict[str, Any]) -> None:
        sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
        sys.stdout.flush()

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            send({"id": None, "ok": False, "error": "invalid-json"})
            continue

        req_id = msg.get("id")
        method = str(msg.get("method") or "")
        params = msg.get("params") if isinstance(msg.get("params"), dict) else {}

        try:
            if method == "load":
                plugin_dir = Path(str(params.get("pluginDir") or ""))
                config = params.get("config") if isinstance(params.get("config"), dict) else {}
                manifest, errors = load_manifest_from_dir(plugin_dir)
                if not manifest or errors:
                    send({"id": req_id, "ok": False, "error": "; ".join(errors) or "Invalid manifest."})
                    continue
                if ctx is not None:
                    ctx.release_all()
                ctx = PluginContext(manifest, config=config)
                module = _load_plugin_module(plugin_dir, manifest.entry, manifest.id)
                register_fn = getattr(module, "register", None)
                if not callable(register_fn):
                    send({"id": req_id, "ok": False, "error": f"Plugin '{manifest.id}' entry must define register(ctx)."})
                    continue
                register_fn(ctx)
                # Dispatch on_load hooks
                for h in sorted(ctx.hooks, key=lambda x: x.priority):
                    if h.event == "on_load":
                        h.handler({"pluginId": manifest.id, "config": dict(config)})
                send({
                    "id": req_id,
                    "ok": True,
                    "result": {
                        "pluginId": manifest.id,
                        "tools": [t.to_schema() for t in ctx.tools.values()],
                        "hooks": [{"event": h.event, "priority": h.priority} for h in ctx.hooks],
                        "providers": [{"kind": p.kind, "name": p.name, "metadata": p.metadata} for p in ctx.providers],
                        "skills": [{"name": s.name, "description": s.description, "markdown": s.markdown} for s in ctx.skills],
                    },
                })

            elif method == "invoke_tool":
                if ctx is None:
                    send({"id": req_id, "ok": False, "error": "No plugin loaded in host."})
                    continue
                tool_name = str(params.get("name") or "")
                args = params.get("args") if isinstance(params.get("args"), dict) else {}
                tool = ctx.tools.get(tool_name)
                if tool is None:
                    send({"id": req_id, "ok": False, "error": f"Plugin tool '{tool_name}' not found."})
                    continue
                res = tool.handler(args)
                if isinstance(res, dict):
                    send({"id": req_id, "ok": True, "result": res})
                else:
                    send({"id": req_id, "ok": True, "result": {"ok": True, "content": str(res)}})

            elif method == "dispatch_hook":
                if ctx is None:
                    send({"id": req_id, "ok": True, "result": {"handled": 0}})
                    continue
                event = str(params.get("event") or "")
                payload = params.get("payload") if isinstance(params.get("payload"), dict) else {}
                outputs: list[Any] = []
                for h in sorted(ctx.hooks, key=lambda x: x.priority):
                    if h.event == event:
                        outputs.append(h.handler(payload))
                send({"id": req_id, "ok": True, "result": {"handled": len(outputs), "outputs": outputs}})

            elif method == "update_config":
                if ctx is None:
                    send({"id": req_id, "ok": False, "error": "No plugin loaded in host."})
                    continue
                new_cfg = params.get("config") if isinstance(params.get("config"), dict) else {}
                ctx.update_config(new_cfg)
                for h in sorted(ctx.hooks, key=lambda x: x.priority):
                    if h.event == "on_config_change":
                        h.handler({"pluginId": ctx.plugin_id, "config": dict(new_cfg)})
                send({"id": req_id, "ok": True, "result": {"updated": True}})

            elif method == "unload":
                if ctx is not None:
                    for h in sorted(ctx.hooks, key=lambda x: x.priority):
                        if h.event == "on_unload":
                            try:
                                h.handler({"pluginId": ctx.plugin_id})
                            except Exception:
                                pass
                    ctx.release_all()
                    ctx = None
                send({"id": req_id, "ok": True, "result": {"unloaded": True}})

            elif method == "shutdown":
                if ctx is not None:
                    ctx.release_all()
                    ctx = None
                send({"id": req_id, "ok": True, "result": {"shuttingDown": True}})
                return 0

            else:
                send({"id": req_id, "ok": False, "error": f"unknown-host-method:{method}"})
        except Exception as exc:
            send({"id": req_id, "ok": False, "error": f"{type(exc).__name__}: {exc}"})
    return 0


class PluginHostClient:
    """Supervisor managing one isolated Python plugin host subprocess."""

    def __init__(self, plugin_id: str, *, timeout_s: float = 15.0) -> None:
        self.plugin_id = plugin_id
        self.timeout_s = timeout_s
        self._proc: Optional[subprocess.Popen[str]] = None
        self._lock = threading.Lock()
        self._pending: dict[str, tuple[threading.Event, dict[str, Any]]] = {}
        self._reader_thread: Optional[threading.Thread] = None
        self.crashed = False

    def is_running(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    def start(self) -> None:
        if self.is_running():
            return
        self.crashed = False
        py_root = str(Path(__file__).resolve().parent.parent)
        env = dict(os.environ)
        env["PYTHONUTF8"] = "1"
        existing_pp = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = f"{py_root}{os.pathsep}{existing_pp}" if existing_pp else py_root

        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
        self._proc = subprocess.Popen(
            [sys.executable, "-u", "-m", "pixel_agent.plugin_host"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            env=env,
            creationflags=creationflags,
        )
        self._reader_thread = threading.Thread(
            target=self._read_loop,
            name=f"plugin-host-{self.plugin_id}",
            daemon=True,
        )
        self._reader_thread.start()

    def _read_loop(self) -> None:
        proc = self._proc
        if proc is None or proc.stdout is None:
            return
        try:
            for raw_line in proc.stdout:
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    frame = json.loads(line)
                except json.JSONDecodeError:
                    continue
                req_id = frame.get("id")
                with self._lock:
                    slot = self._pending.pop(req_id, None)
                if slot is not None:
                    ev, holder = slot
                    holder["frame"] = frame
                    ev.set()
        finally:
            self.crashed = True
            with self._lock:
                for _req_id, (ev, holder) in list(self._pending.items()):
                    holder["frame"] = {"ok": False, "error": f"Plugin host '{self.plugin_id}' exited unexpectedly."}
                    ev.set()
                self._pending.clear()

    def request(self, method: str, params: Optional[dict[str, Any]] = None, timeout_s: Optional[float] = None) -> dict[str, Any]:
        if not self.is_running():
            self.start()
        assert self._proc is not None and self._proc.stdin is not None
        req_id = uuid.uuid4().hex[:12]
        ev = threading.Event()
        holder: dict[str, Any] = {}
        with self._lock:
            self._pending[req_id] = (ev, holder)
        frame = json.dumps({"id": req_id, "method": method, "params": params or {}}, ensure_ascii=False) + "\n"
        try:
            self._proc.stdin.write(frame)
            self._proc.stdin.flush()
        except Exception as exc:
            with self._lock:
                self._pending.pop(req_id, None)
            return {"ok": False, "error": f"Failed to send RPC to plugin host '{self.plugin_id}': {exc}"}

        if not ev.wait(timeout=timeout_s or self.timeout_s):
            with self._lock:
                self._pending.pop(req_id, None)
            self.stop()
            return {"ok": False, "error": f"Plugin host '{self.plugin_id}' timed out on '{method}'."}
        return holder.get("frame", {"ok": False, "error": "Empty plugin host response."})

    def stop(self) -> None:
        proc = self._proc
        self._proc = None
        if proc is None:
            return
        try:
            if proc.poll() is None and proc.stdin is not None:
                proc.stdin.write(json.dumps({"id": "stop", "method": "shutdown", "params": {}}) + "\n")
                proc.stdin.flush()
                proc.wait(timeout=1.5)
        except Exception:
            pass
        try:
            if proc.poll() is None:
                proc.kill()
                proc.wait(timeout=1.5)
        except Exception:
            pass
        for stream in (proc.stdin, proc.stdout, proc.stderr):
            if stream is not None:
                try:
                    stream.close()
                except Exception:
                    pass


if __name__ == "__main__":
    raise SystemExit(_run_child_server())
