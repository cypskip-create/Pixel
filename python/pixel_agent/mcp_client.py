"""Real Model Context Protocol (MCP) client for Pixel's Python runtime.

Supports both official MCP transports over JSON-RPC 2.0 using Python 3 stdlib:
  1. Stdio (`StdioMcpTransport`): safe argument-vector subprocess execution
     (shell=False), restricted environment inheritance, NDJSON framing, stderr
     diagnostics, timeouts, cancellation, and clean termination.
  2. Streamable HTTP (`StreamableHttpMcpTransport`): HTTPS (or localhost dev),
     `MCP-Protocol-Version` header, `Mcp-Session-Id` tracking, JSON + SSE
     response parsing, redirect-credential protection, and clean DELETE teardown.

Supported MCP protocol versions: 2025-03-26 (primary), 2024-11-05 (fallback).
"""

from __future__ import annotations

import json
import os
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Optional

from .errors import redact_secrets

SUPPORTED_MCP_PROTOCOL_VERSIONS = ("2025-03-26", "2024-11-05")
DEFAULT_MCP_PROTOCOL_VERSION = "2025-03-26"
MAX_MCP_FRAME_BYTES = 2 * 1024 * 1024
SAFE_ENV_KEYS = ("PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "COMSPEC", "PYTHONUTF8", "LANG", "HOME", "USERPROFILE")


class McpClientError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = False) -> None:
        super().__init__(redact_secrets(message))
        self.code = code
        self.message = redact_secrets(message)
        self.retryable = retryable


@dataclass
class McpToolDescriptor:
    name: str
    description: str
    input_schema: dict[str, Any]
    annotations: dict[str, Any] = field(default_factory=dict)


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Refuses HTTP redirects so credentials are never forwarded to another host."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[override]
        raise McpClientError("REDIRECT_BLOCKED", f"Blocked HTTP {code} redirect to prevent credential leakage.")


def build_restricted_env(extra_env: Optional[dict[str, str]] = None) -> dict[str, str]:
    """Constructs a minimal child environment without leaking parent API keys."""
    env: dict[str, str] = {}
    for key in SAFE_ENV_KEYS:
        val = os.environ.get(key)
        if val is not None:
            env[key] = val
    env["PYTHONUTF8"] = "1"
    if extra_env:
        for k, v in extra_env.items():
            if isinstance(k, str) and isinstance(v, str) and k.strip():
                env[k.strip()] = v
    return env


def validate_http_mcp_url(url: str) -> str:
    """Enforces HTTPS for remote MCP servers; permits http:// only on loopback."""
    parsed = urllib.parse.urlparse(url.strip())
    if parsed.scheme not in ("https", "http"):
        raise McpClientError("INVALID_URL", "MCP server URL must use https:// (or http://localhost for local dev).")
    host = (parsed.hostname or "").lower()
    if not host:
        raise McpClientError("INVALID_URL", "MCP server URL is missing a hostname.")
    if parsed.scheme == "http" and host not in ("127.0.0.1", "localhost", "::1"):
        raise McpClientError("INSECURE_URL", "Remote MCP servers must use https://; plaintext http:// is only allowed on localhost.")
    if parsed.username or parsed.password:
        raise McpClientError("INVALID_URL", "Do not embed credentials directly in the MCP server URL.")
    return url.strip()


class StdioMcpTransport:
    """Long-lived stdio JSON-RPC 2.0 transport with argument-vector spawn."""

    def __init__(
        self,
        command: list[str],
        *,
        cwd: Optional[str] = None,
        extra_env: Optional[dict[str, str]] = None,
    ) -> None:
        if not command or not all(isinstance(arg, str) and arg.strip() for arg in command):
            raise McpClientError("INVALID_CONFIG", "Stdio MCP transport requires a non-empty argument array.")
        self.command = command
        self.cwd = cwd
        self.extra_env = extra_env
        self._proc: Optional[subprocess.Popen[str]] = None
        self._write_lock = threading.Lock()
        self._pending_lock = threading.Lock()
        self._pending: dict[int, tuple[threading.Event, dict[str, Any]]] = {}
        self._stderr_tail: list[str] = []
        self._reader_thread: Optional[threading.Thread] = None
        self._stderr_thread: Optional[threading.Thread] = None

    @property
    def pid(self) -> Optional[int]:
        return self._proc.pid if self._proc and self._proc.poll() is None else None

    @property
    def is_alive(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    def start(self) -> None:
        if self.is_alive:
            return
        env = build_restricted_env(self.extra_env)
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
        try:
            self._proc = subprocess.Popen(
                self.command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                cwd=self.cwd,
                env=env,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                shell=False,
                creationflags=creationflags,
            )
        except OSError as exc:
            raise McpClientError("SPAWN_FAILED", f"Failed to start MCP server: {exc}") from exc

        self._reader_thread = threading.Thread(target=self._read_stdout_loop, name="mcp-stdio-out", daemon=True)
        self._stderr_thread = threading.Thread(target=self._read_stderr_loop, name="mcp-stdio-err", daemon=True)
        self._reader_thread.start()
        self._stderr_thread.start()

    def _read_stdout_loop(self) -> None:
        assert self._proc and self._proc.stdout
        for raw_line in self._proc.stdout:
            if len(raw_line) > MAX_MCP_FRAME_BYTES:
                continue
            line = raw_line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(msg, dict):
                continue
            req_id = msg.get("id")
            if isinstance(req_id, int):
                with self._pending_lock:
                    slot = self._pending.pop(req_id, None)
                if slot is not None:
                    ev, holder = slot
                    holder["response"] = msg
                    ev.set()
        # Process exited: unblock any waiting RPCs
        with self._pending_lock:
            for req_id, (ev, holder) in list(self._pending.items()):
                holder["error"] = McpClientError("DISCONNECTED", "MCP stdio server process exited unexpectedly.", retryable=True)
                ev.set()
                self._pending.pop(req_id, None)

    def _read_stderr_loop(self) -> None:
        assert self._proc and self._proc.stderr
        for raw_line in self._proc.stderr:
            cleaned = redact_secrets(raw_line.strip())
            if cleaned:
                self._stderr_tail = (self._stderr_tail + [cleaned])[-15:]

    def send_notification(self, method: str, params: Optional[dict[str, Any]] = None) -> None:
        if not self.is_alive or not self._proc or not self._proc.stdin:
            raise McpClientError("DISCONNECTED", "MCP stdio server is not running.", retryable=True)
        frame: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            frame["params"] = params
        wire = json.dumps(frame, ensure_ascii=False) + "\n"
        with self._write_lock:
            self._proc.stdin.write(wire)
            self._proc.stdin.flush()

    def request(
        self,
        req_id: int,
        method: str,
        params: Optional[dict[str, Any]] = None,
        *,
        timeout_s: float = 15.0,
        cancel_event: Optional[threading.Event] = None,
    ) -> dict[str, Any]:
        if not self.is_alive or not self._proc or not self._proc.stdin:
            raise McpClientError("DISCONNECTED", "MCP stdio server is not running.", retryable=True)

        ev = threading.Event()
        holder: dict[str, Any] = {}
        with self._pending_lock:
            self._pending[req_id] = (ev, holder)

        frame: dict[str, Any] = {"jsonrpc": "2.0", "id": req_id, "method": method}
        if params is not None:
            frame["params"] = params
        wire = json.dumps(frame, ensure_ascii=False) + "\n"
        try:
            with self._write_lock:
                self._proc.stdin.write(wire)
                self._proc.stdin.flush()
        except OSError as exc:
            with self._pending_lock:
                self._pending.pop(req_id, None)
            raise McpClientError("WRITE_FAILED", f"Failed writing to MCP server: {exc}", retryable=True) from exc

        deadline = time.monotonic() + max(0.5, timeout_s)
        while not ev.is_set():
            if cancel_event and cancel_event.is_set():
                with self._pending_lock:
                    self._pending.pop(req_id, None)
                try:
                    self.send_notification("notifications/cancelled", {"requestId": req_id, "reason": "Cancelled by user"})
                except Exception:
                    pass
                raise McpClientError("CANCELLED", "MCP request was cancelled.")
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                with self._pending_lock:
                    self._pending.pop(req_id, None)
                raise McpClientError("TIMEOUT", f"MCP request '{method}' timed out after {timeout_s:.1f}s.", retryable=True)
            ev.wait(timeout=min(0.1, remaining))

        if "error" in holder:
            raise holder["error"]
        return holder["response"]

    def close(self) -> None:
        proc = self._proc
        self._proc = None
        if proc is None:
            return
        try:
            if proc.stdin:
                proc.stdin.close()
        except OSError:
            pass
        if proc.poll() is None:
            try:
                proc.terminate()
                proc.wait(timeout=2.0)
            except Exception:
                try:
                    proc.kill()
                    proc.wait(timeout=2.0)
                except Exception:
                    pass
        for stream in (proc.stdout, proc.stderr):
            try:
                if stream:
                    stream.close()
            except OSError:
                pass


class StreamableHttpMcpTransport:
    """MCP Streamable HTTP (2025-03-26) JSON-RPC 2.0 transport over HTTPS / localhost."""

    def __init__(
        self,
        url: str,
        *,
        bearer_token: Optional[str] = None,
        extra_headers: Optional[dict[str, str]] = None,
    ) -> None:
        self.url = validate_http_mcp_url(url)
        self.bearer_token = bearer_token
        self.extra_headers = extra_headers or {}
        self.session_id: Optional[str] = None
        self.protocol_version: str = DEFAULT_MCP_PROTOCOL_VERSION
        self._opener = urllib.request.build_opener(_NoRedirectHandler())

    def _headers(self) -> dict[str, str]:
        hdrs = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": self.protocol_version,
            "User-Agent": "Pixel-MCP-Client/1.0",
        }
        if self.session_id:
            hdrs["Mcp-Session-Id"] = self.session_id
        if self.bearer_token:
            hdrs["Authorization"] = f"Bearer {self.bearer_token}"
        for k, v in self.extra_headers.items():
            if k.lower() not in ("host", "content-length"):
                hdrs[k] = v
        return hdrs

    def send_notification(self, method: str, params: Optional[dict[str, Any]] = None) -> None:
        payload: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            payload["params"] = params
        req = urllib.request.Request(
            self.url,
            data=json.dumps(payload).encode("utf-8"),
            headers=self._headers(),
            method="POST",
        )
        try:
            with self._opener.open(req, timeout=8.0):
                pass
        except Exception:
            # Notifications are best-effort
            pass

    def request(
        self,
        req_id: int,
        method: str,
        params: Optional[dict[str, Any]] = None,
        *,
        timeout_s: float = 15.0,
        cancel_event: Optional[threading.Event] = None,
    ) -> dict[str, Any]:
        if cancel_event and cancel_event.is_set():
            raise McpClientError("CANCELLED", "MCP request was cancelled before sending.")
        payload: dict[str, Any] = {"jsonrpc": "2.0", "id": req_id, "method": method}
        if params is not None:
            payload["params"] = params
        req = urllib.request.Request(
            self.url,
            data=json.dumps(payload).encode("utf-8"),
            headers=self._headers(),
            method="POST",
        )
        try:
            with self._opener.open(req, timeout=max(1.0, timeout_s)) as resp:
                sid = resp.headers.get("Mcp-Session-Id")
                if sid:
                    self.session_id = sid.strip()
                ctype = (resp.headers.get("Content-Type") or "").lower()
                raw_bytes = resp.read(MAX_MCP_FRAME_BYTES + 1)
                if len(raw_bytes) > MAX_MCP_FRAME_BYTES:
                    raise McpClientError("RESPONSE_TOO_LARGE", "MCP HTTP response exceeded 2 MiB limit.")
                body_text = raw_bytes.decode("utf-8", errors="replace")
                if "text/event-stream" in ctype:
                    return self._parse_sse_rpc(body_text, req_id)
                parsed = json.loads(body_text)
                if not isinstance(parsed, dict):
                    raise McpClientError("INVALID_RESPONSE", "MCP HTTP response was not a JSON object.")
                return parsed
        except McpClientError:
            raise
        except urllib.error.HTTPError as exc:
            if exc.code == 401:
                raise McpClientError("AUTH_REQUIRED", "MCP server rejected credentials (HTTP 401).", retryable=False) from exc
            if exc.code == 403:
                raise McpClientError("FORBIDDEN", "MCP server denied access (HTTP 403).", retryable=False) from exc
            if exc.code == 429 or exc.code >= 500:
                raise McpClientError("HTTP_ERROR", f"MCP server returned HTTP {exc.code}.", retryable=True) from exc
            raise McpClientError("HTTP_ERROR", f"MCP server returned HTTP {exc.code}.", retryable=False) from exc
        except TimeoutError as exc:
            raise McpClientError("TIMEOUT", f"MCP HTTP request '{method}' timed out.", retryable=True) from exc
        except (urllib.error.URLError, OSError, json.JSONDecodeError) as exc:
            raise McpClientError("NETWORK_ERROR", f"MCP HTTP transport error: {exc}", retryable=True) from exc

    @staticmethod
    def _parse_sse_rpc(body_text: str, expected_id: int) -> dict[str, Any]:
        last_msg: Optional[dict[str, Any]] = None
        for line in body_text.splitlines():
            if not line.startswith("data:"):
                continue
            data_str = line[5:].strip()
            if not data_str or data_str == "[DONE]":
                continue
            try:
                parsed = json.loads(data_str)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, dict):
                last_msg = parsed
                if parsed.get("id") == expected_id:
                    return parsed
        if last_msg is not None:
            return last_msg
        raise McpClientError("INVALID_RESPONSE", "No JSON-RPC response frame found in MCP SSE stream.")

    def close(self) -> None:
        if not self.session_id:
            return
        try:
            req = urllib.request.Request(self.url, headers=self._headers(), method="DELETE")
            with self._opener.open(req, timeout=3.0):
                pass
        except Exception:
            pass
        finally:
            self.session_id = None


class McpClientSession:
    """High-level MCP session handling handshake, discovery, invocation, and health."""

    def __init__(self, server_id: str, transport: StdioMcpTransport | StreamableHttpMcpTransport) -> None:
        self.server_id = server_id
        self.transport = transport
        self.state: str = "disconnected"
        self.negotiated_protocol: Optional[str] = None
        self.server_info: dict[str, Any] = {}
        self.capabilities: dict[str, Any] = {}
        self.last_error: Optional[str] = None
        self.last_health_ms: Optional[int] = None
        self._next_id = 0
        self._id_lock = threading.Lock()

    def _alloc_id(self) -> int:
        with self._id_lock:
            self._next_id += 1
            return self._next_id

    def connect(self, *, timeout_s: float = 12.0) -> dict[str, Any]:
        self.state = "connecting"
        self.last_error = None
        try:
            if isinstance(self.transport, StdioMcpTransport):
                self.transport.start()
            resp = self.transport.request(
                self._alloc_id(),
                "initialize",
                {
                    "protocolVersion": DEFAULT_MCP_PROTOCOL_VERSION,
                    "capabilities": {"tools": {}},
                    "clientInfo": {"name": "Pixel", "version": "0.2.1"},
                },
                timeout_s=timeout_s,
            )
            if "error" in resp:
                err = resp["error"]
                raise McpClientError("INIT_FAILED", str(err.get("message") if isinstance(err, dict) else err))
            result = resp.get("result")
            if not isinstance(result, dict):
                raise McpClientError("INIT_FAILED", "MCP initialize response missing result object.")
            version = str(result.get("protocolVersion") or "")
            if version not in SUPPORTED_MCP_PROTOCOL_VERSIONS:
                raise McpClientError(
                    "PROTOCOL_MISMATCH",
                    f"Unsupported MCP protocol version '{version}'. Supported: {', '.join(SUPPORTED_MCP_PROTOCOL_VERSIONS)}",
                )
            self.negotiated_protocol = version
            if isinstance(self.transport, StreamableHttpMcpTransport):
                self.transport.protocol_version = version
            self.server_info = result.get("serverInfo") if isinstance(result.get("serverInfo"), dict) else {}
            self.capabilities = result.get("capabilities") if isinstance(result.get("capabilities"), dict) else {}
            self.transport.send_notification("notifications/initialized", {})
            self.state = "connected"
            self.last_health_ms = int(time.time() * 1000)
            return result
        except Exception as exc:
            self.state = "auth_required" if isinstance(exc, McpClientError) and exc.code == "AUTH_REQUIRED" else "error"
            self.last_error = redact_secrets(str(exc))
            raise

    def list_tools(self, *, timeout_s: float = 10.0) -> list[McpToolDescriptor]:
        resp = self.transport.request(self._alloc_id(), "tools/list", {}, timeout_s=timeout_s)
        if "error" in resp:
            err = resp["error"]
            raise McpClientError("LIST_TOOLS_FAILED", str(err.get("message") if isinstance(err, dict) else err))
        result = resp.get("result") if isinstance(resp.get("result"), dict) else {}
        raw_tools = result.get("tools") if isinstance(result.get("tools"), list) else []
        tools: list[McpToolDescriptor] = []
        for item in raw_tools:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            if not name:
                continue
            desc = str(item.get("description") or "").strip()[:500]
            schema = item.get("inputSchema") if isinstance(item.get("inputSchema"), dict) else {"type": "object", "properties": {}}
            ann = item.get("annotations") if isinstance(item.get("annotations"), dict) else {}
            tools.append(McpToolDescriptor(name=name, description=desc, input_schema=schema, annotations=ann))
        self.last_health_ms = int(time.time() * 1000)
        return tools

    def call_tool(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        *,
        timeout_s: float = 30.0,
        cancel_event: Optional[threading.Event] = None,
    ) -> dict[str, Any]:
        resp = self.transport.request(
            self._alloc_id(),
            "tools/call",
            {"name": tool_name, "arguments": arguments},
            timeout_s=timeout_s,
            cancel_event=cancel_event,
        )
        if "error" in resp:
            err = resp["error"]
            raise McpClientError("TOOL_CALL_FAILED", str(err.get("message") if isinstance(err, dict) else err))
        result = resp.get("result") if isinstance(resp.get("result"), dict) else {}
        self.last_health_ms = int(time.time() * 1000)
        return result

    def close(self) -> None:
        self.transport.close()
        self.state = "disconnected"
