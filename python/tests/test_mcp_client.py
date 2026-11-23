"""Tests for Pixel's Python MCP Client (Stdio + Streamable HTTP) and OSV Preflight."""

from __future__ import annotations

import http.server
import io
import json
import socketserver
import sys
import threading
import time
import unittest
from pathlib import Path
from typing import Any

PYTHON_DIR = Path(__file__).resolve().parent.parent
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))

from pixel_agent.mcp_client import (  # noqa: E402
    McpClientError,
    McpClientSession,
    StdioMcpTransport,
    StreamableHttpMcpTransport,
    build_restricted_env,
    validate_http_mcp_url,
)
from pixel_agent.osv_preflight import check_osv_advisories, validate_stdio_command  # noqa: E402

# Minimal disposable stdio MCP server script run in a child Python process
_STDIO_MCP_SERVER_CODE = r"""
import json, sys, time
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    msg = json.loads(line)
    method = msg.get("method")
    req_id = msg.get("id")
    if method == "initialize":
        resp = {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": "2025-03-26",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "disposable-stdio-mcp", "version": "1.0.0"},
            },
        }
        sys.stdout.write(json.dumps(resp) + "\n")
        sys.stdout.flush()
    elif method == "tools/list":
        resp = {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "tools": [
                    {
                        "name": "echo_note",
                        "description": "Echoes a note safely.",
                        "inputSchema": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]},
                    },
                    {
                        "name": "slow_op",
                        "description": "Sleeps briefly for cancellation tests.",
                        "inputSchema": {"type": "object", "properties": {}},
                    },
                ]
            },
        }
        sys.stdout.write(json.dumps(resp) + "\n")
        sys.stdout.flush()
    elif method == "tools/call":
        params = msg.get("params") or {}
        name = params.get("name")
        args = params.get("arguments") or {}
        if name == "slow_op":
            time.sleep(2.0)
        resp = {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"content": [{"type": "text", "text": f"ECHO:{args.get('text', '')}"}]},
        }
        sys.stdout.write(json.dumps(resp) + "\n")
        sys.stdout.flush()
"""


class _MockStreamableHttpMcp:
    def __init__(self, protocol_version: str = "2025-03-26", sse_mode: bool = False) -> None:
        self.protocol_version = protocol_version
        self.sse_mode = sse_mode
        self.deleted_sessions: list[str] = []
        ref = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802
                length = int(self.headers.get("Content-Length", "0"))
                body = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
                method = body.get("method")
                req_id = body.get("id")
                if method == "notifications/initialized":
                    self.send_response(202)
                    self.end_headers()
                    return
                if method == "initialize":
                    payload = {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": {
                            "protocolVersion": ref.protocol_version,
                            "capabilities": {"tools": {}},
                            "serverInfo": {"name": "mock-http-mcp", "version": "1.0.0"},
                        },
                    }
                elif method == "tools/list":
                    payload = {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": {"tools": [{"name": "ping_remote", "description": "Remote ping", "inputSchema": {"type": "object"}}]},
                    }
                else:
                    payload = {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": {"content": [{"type": "text", "text": "PONG_REMOTE"}]},
                    }

                self.send_response(200)
                self.send_header("Mcp-Session-Id", "sess-123")
                if ref.sse_mode:
                    self.send_header("Content-Type", "text/event-stream")
                    self.end_headers()
                    self.wfile.write(f"data: {json.dumps(payload)}\n\n".encode("utf-8"))
                else:
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps(payload).encode("utf-8"))

            def do_DELETE(self):  # noqa: N802
                sid = self.headers.get("Mcp-Session-Id", "")
                ref.deleted_sessions.append(sid)
                self.send_response(204)
                self.end_headers()

            def log_message(self, format, *args):  # noqa: A002
                pass

        class Threaded(socketserver.ThreadingMixIn, http.server.HTTPServer):
            daemon_threads = True

        self._httpd = Threaded(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self._httpd.server_address[1]}/mcp"
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)

    def __enter__(self):
        self._thread.start()
        return self

    def __exit__(self, *args):
        self._httpd.shutdown()
        self._httpd.server_close()


class TestPythonMcpClient(unittest.TestCase):
    def test_stdio_handshake_discovery_call_and_cancel(self) -> None:
        transport = StdioMcpTransport([sys.executable, "-u", "-c", _STDIO_MCP_SERVER_CODE])
        session = McpClientSession("local-test", transport)
        try:
            init = session.connect()
            self.assertEqual(session.state, "connected")
            self.assertEqual(session.negotiated_protocol, "2025-03-26")
            self.assertEqual(init["serverInfo"]["name"], "disposable-stdio-mcp")

            tools = session.list_tools()
            self.assertEqual([t.name for t in tools], ["echo_note", "slow_op"])

            res = session.call_tool("echo_note", {"text": "hello-mcp"})
            self.assertEqual(res["content"][0]["text"], "ECHO:hello-mcp")

            # Cancellation aborts promptly
            cancel = threading.Event()
            threading.Timer(0.15, cancel.set).start()
            with self.assertRaises(McpClientError) as ctx:
                session.call_tool("slow_op", {}, timeout_s=5.0, cancel_event=cancel)
            self.assertEqual(ctx.exception.code, "CANCELLED")
        finally:
            session.close()
            self.assertEqual(session.state, "disconnected")

    def test_streamable_http_json_and_sse_and_protocol_mismatch(self) -> None:
        with _MockStreamableHttpMcp(protocol_version="2024-11-05", sse_mode=True) as srv:
            transport = StreamableHttpMcpTransport(srv.url, bearer_token="tok_abc")
            session = McpClientSession("remote-sse", transport)
            try:
                session.connect()
                self.assertEqual(session.negotiated_protocol, "2024-11-05")
                self.assertEqual(transport.session_id, "sess-123")
                tools = session.list_tools()
                self.assertEqual([t.name for t in tools], ["ping_remote"])
                res = session.call_tool("ping_remote", {})
                self.assertEqual(res["content"][0]["text"], "PONG_REMOTE")
            finally:
                session.close()
            self.assertEqual(srv.deleted_sessions, ["sess-123"])

        # Unsupported protocol version rejected
        with _MockStreamableHttpMcp(protocol_version="1999-01-01") as bad_srv:
            session = McpClientSession("bad-ver", StreamableHttpMcpTransport(bad_srv.url))
            with self.assertRaises(McpClientError) as ctx:
                session.connect()
            self.assertEqual(ctx.exception.code, "PROTOCOL_MISMATCH")

    def test_security_env_url_and_osv_preflight(self) -> None:
        # Restricted env never leaks arbitrary secret env vars
        import os
        os.environ["DEEPSEEK_API_KEY"] = "sk-should-not-leak"
        try:
            env = build_restricted_env({"MCP_SAFE_FLAG": "1"})
            self.assertNotIn("DEEPSEEK_API_KEY", env)
            self.assertEqual(env["MCP_SAFE_FLAG"], "1")
        finally:
            os.environ.pop("DEEPSEEK_API_KEY", None)

        # Plaintext remote HTTP refused; embedded creds refused
        with self.assertRaises(McpClientError):
            validate_http_mcp_url("http://example.com/mcp")
        with self.assertRaises(McpClientError):
            validate_http_mcp_url("https://user:pass@example.com/mcp")
        self.assertTrue(validate_http_mcp_url("https://mcp.example.com/v1").startswith("https://"))

        # Preflight blocks shell interpreters and unpinned npx/uvx
        self.assertFalse(validate_stdio_command(["powershell.exe", "-c", "whoami"]).allowed)
        self.assertFalse(validate_stdio_command(["npx", "-y", "unreviewed-pkg"]).allowed)
        self.assertTrue(validate_stdio_command([sys.executable, "server.py"]).allowed)

        # Mock OSV check returning a vulnerability blocks installation
        class _FakeResp:
            def __enter__(self): return self
            def __exit__(self, *a): pass
            def read(self, _n=-1):
                return json.dumps({"vulns": [{"id": "GHSA-1234", "summary": "Critical RCE"}]}).encode("utf-8")

        osv = check_osv_advisories("bad-pkg", "1.0.0", "PyPI", opener=lambda _req, timeout=12: _FakeResp())
        self.assertFalse(osv.allowed)
        self.assertTrue(osv.osv_checked)
        self.assertEqual(osv.vulnerabilities[0]["id"], "GHSA-1234")


if __name__ == "__main__":
    unittest.main()
