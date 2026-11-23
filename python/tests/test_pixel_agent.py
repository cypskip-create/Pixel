"""Comprehensive unit & integration tests for Pixel's Python Agent Engine (pixel-agent-v2)."""

from __future__ import annotations

import http.server
import json
import os
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from typing import Any

PYTHON_DIR = Path(__file__).resolve().parent.parent
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))

from pixel_agent import PROTOCOL_VERSION  # noqa: E402
from pixel_agent.budgets import (  # noqa: E402
    RUN_BUDGET_WRAPUP_NOTICE,
    IterationBudget,
    RepetitionGuard,
)
from pixel_agent.compressor import (  # noqa: E402
    compress_messages,
    prune_old_tool_outputs,
)
from pixel_agent.crash_log import record_crash  # noqa: E402
from pixel_agent.errors import bound_error_text, redact_secrets  # noqa: E402
from pixel_agent.loop import run_agent_turn  # noqa: E402
from pixel_agent.providers import ProviderConfig, stream_openai_compatible  # noqa: E402


class _MockSSEServer:
    """Local HTTP server serving scripted OpenAI-compatible SSE / JSON responses."""

    def __init__(self, handler_fn):
        self.handler_fn = handler_fn
        self.requests: list[dict[str, Any]] = []
        server_ref = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802
                length = int(self.headers.get("Content-Length", "0"))
                raw = self.rfile.read(length).decode("utf-8") if length else "{}"
                body = json.loads(raw)
                server_ref.requests.append(body)
                server_ref.handler_fn(self, body, len(server_ref.requests))

            def log_message(self, format, *args):  # noqa: A002
                pass

        class ThreadedServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
            daemon_threads = True

        self._httpd = ThreadedServer(("127.0.0.1", 0), Handler)
        self.port = self._httpd.server_address[1]
        self.base_url = f"http://127.0.0.1:{self.port}/v1"
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)

    def __enter__(self):
        self._thread.start()
        return self

    def __exit__(self, exc_type, exc, tb):
        self._httpd.shutdown()
        self._httpd.server_close()


def _send_sse(handler: http.server.BaseHTTPRequestHandler, events: list[dict[str, Any]], delay: float = 0.0) -> None:
    handler.send_response(200)
    handler.send_header("Content-Type", "text/event-stream")
    handler.send_header("Cache-Control", "no-cache")
    handler.end_headers()
    for ev in events:
        chunk = f"data: {json.dumps(ev)}\n\n".encode("utf-8")
        try:
            handler.wfile.write(chunk)
            handler.wfile.flush()
        except OSError:
            return
        if delay > 0:
            time.sleep(delay)
    try:
        handler.wfile.write(b"data: [DONE]\n\n")
        handler.wfile.flush()
    except OSError:
        pass


class TestSecurityAndRedaction(unittest.TestCase):
    def test_redact_secrets_scrubs_keys_and_tokens(self) -> None:
        raw = "Bearer sk-1234567890abcdef1234567890 ghp_abcdefghijklmnopqrstuvwxyz1234 api_key=supersecretvalue123"
        redacted = redact_secrets(raw)
        self.assertNotIn("sk-1234567890", redacted)
        self.assertNotIn("ghp_abcdef", redacted)
        self.assertNotIn("supersecretvalue123", redacted)
        self.assertIn("[REDACTED]", redacted)

    def test_bound_error_text_caps_length(self) -> None:
        huge = "x" * 5000 + " sk-secretkey1234567890123456"
        bounded = bound_error_text(huge)
        self.assertLessEqual(len(bounded), 2100)
        self.assertNotIn("sk-secretkey", bounded)

    def test_crash_log_redacts_and_writes_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / "crash.log"
            old_env = os.environ.get("PIXEL_AGENT_CRASH_LOG")
            os.environ["PIXEL_AGENT_CRASH_LOG"] = str(log_path)
            try:
                try:
                    raise RuntimeError("Failed with Bearer sk-9999999999999999999999")
                except RuntimeError:
                    exc_type, exc_value, exc_tb = sys.exc_info()
                    assert exc_type is not None and exc_value is not None
                    record_crash("test-context", exc_type, exc_value, exc_tb)
                text = log_path.read_text(encoding="utf-8")
                self.assertIn("test-context", text)
                self.assertNotIn("sk-9999999999999999999999", text)
                self.assertIn("[REDACTED]", text)
            finally:
                if old_env is None:
                    os.environ.pop("PIXEL_AGENT_CRASH_LOG", None)
                else:
                    os.environ["PIXEL_AGENT_CRASH_LOG"] = old_env


class TestBudgetsAndRepetition(unittest.TestCase):
    def test_iteration_budget_wrapup_and_exhaustion(self) -> None:
        budget = IterationBudget(max_iterations=5, max_tool_calls=10, max_wall_ms=60_000)
        wrapup_seen = False
        for _ in range(5):
            ok, _reason = budget.can_continue_iteration()
            self.assertTrue(ok)
            budget.record_iteration()
            if budget.should_inject_wrapup():
                wrapup_seen = True
        self.assertTrue(wrapup_seen)
        can_more, reason = budget.can_continue_iteration()
        self.assertFalse(can_more)
        self.assertIsNotNone(reason)
        self.assertIn("budget", RUN_BUDGET_WRAPUP_NOTICE.lower())

    def test_repetition_guard_detects_identical_tool_loop(self) -> None:
        guard = RepetitionGuard(max_identical_tool_calls=3)
        self.assertFalse(guard.record_and_check_tool("file_read", {"path": "a.txt"}))
        self.assertFalse(guard.record_and_check_tool("file_read", {"path": "a.txt"}))
        self.assertTrue(guard.record_and_check_tool("file_read", {"path": "a.txt"}))


class TestContextCompressor(unittest.TestCase):
    def test_stage1_prune_old_tool_outputs_preserves_recent(self) -> None:
        msgs: list[dict[str, Any]] = [
            {"role": "system", "content": "sys"},
            {"role": "user", "content": "q"},
        ]
        for i in range(6):
            msgs.append({"role": "tool", "tool_call_id": f"c{i}", "content": f"RESULT_{i}_" + ("A" * 1200)})
        pruned, count = prune_old_tool_outputs(msgs, keep_recent_messages=2, max_old_tool_chars=120)
        self.assertEqual(count, 4)
        self.assertIn("pruned", pruned[2]["content"].lower())
        self.assertEqual(len(pruned[-1]["content"]), len(msgs[-1]["content"]))

    def test_stage2_compress_keeps_tool_pairs_and_falls_back(self) -> None:
        msgs: list[dict[str, Any]] = [{"role": "system", "content": "You are Pixel."}]
        for i in range(10):
            msgs.append({"role": "user", "content": f"User turn {i}: " + ("word " * 120)})
            msgs.append({
                "role": "assistant",
                "content": "",
                "tool_calls": [{"id": f"call_{i}", "type": "function", "function": {"name": "file_list", "arguments": "{}"}}],
            })
            msgs.append({"role": "tool", "tool_call_id": f"call_{i}", "content": f"listing_{i} " + ("item " * 120)})
            msgs.append({"role": "assistant", "content": f"Answer {i}: " + ("ok " * 60)})

        def broken_summarizer(_middle: list[dict[str, Any]]) -> str:
            raise RuntimeError("aux model offline")

        compressed_msgs, stats = compress_messages(msgs, token_budget=1200, aux_summarizer=broken_summarizer)
        self.assertGreater(stats["compressedMiddle"], 0)
        self.assertFalse(stats["usedAuxSummary"])
        self.assertLess(len(compressed_msgs), len(msgs))
        for idx, m in enumerate(compressed_msgs):
            if m.get("role") == "tool":
                prev = compressed_msgs[idx - 1]
                self.assertIn(prev.get("role"), ("assistant", "tool"))


class TestProviderAndLoop(unittest.TestCase):
    def test_streaming_chat_deltas_and_reasoning(self) -> None:
        def handle(handler, _body, _n):
            _send_sse(handler, [
                {"choices": [{"delta": {"reasoning_content": "Thinking..."}, "finish_reason": None}]},
                {"choices": [{"delta": {"content": "Hello "}, "finish_reason": None}]},
                {"choices": [{"delta": {"content": "Pixel!"}, "finish_reason": "stop"}]},
                {"choices": [], "usage": {"prompt_tokens": 12, "completion_tokens": 4, "total_tokens": 16}},
            ])

        with _MockSSEServer(handle) as srv:
            deltas: list[str] = []
            reasonings: list[str] = []
            cfg = ProviderConfig(provider="openai-compatible", base_url=srv.base_url, api_key="test-key", model="mock-model")
            res = stream_openai_compatible(
                cfg,
                messages=[{"role": "user", "content": "Hi"}],
                tools=[],
                cancel_event=threading.Event(),
                on_delta=deltas.append,
                on_reasoning=reasonings.append,
            )
            self.assertEqual("".join(deltas), "Hello Pixel!")
            self.assertEqual("".join(reasonings), "Thinking...")
            self.assertEqual(res.usage["totalTokens"], 16)
            self.assertEqual(res.finish_reason, "stop")

    def test_multi_step_tool_loop_and_failure_recovery(self) -> None:
        def handle(handler, _body, call_num):
            if call_num == 1:
                _send_sse(handler, [
                    {
                        "choices": [{
                            "delta": {
                                "tool_calls": [{
                                    "index": 0,
                                    "id": "call_1",
                                    "type": "function",
                                    "function": {"name": "get_current_time", "arguments": "{"},
                                }]
                            },
                            "finish_reason": None,
                        }]
                    },
                    {
                        "choices": [{
                            "delta": {
                                "tool_calls": [{
                                    "index": 0,
                                    "function": {"arguments": "}"},
                                }]
                            },
                            "finish_reason": "tool_calls",
                        }]
                    },
                ])
            else:
                _send_sse(handler, [
                    {"choices": [{"delta": {"content": "The time is 12:00 UTC."}, "finish_reason": "stop"}]}
                ])

        with _MockSSEServer(handle) as srv:
            events: list[dict[str, Any]] = []
            tool_calls_seen: list[str] = []

            def request_tool(call_id: str, name: str, args: dict[str, Any], _timeout: float) -> dict[str, Any]:
                tool_calls_seen.append(name)
                return {"ok": True, "content": "12:00 UTC"}

            cfg = ProviderConfig(provider="openai-compatible", base_url=srv.base_url, api_key="test-key", model="mock-model")
            result = run_agent_turn(
                request_id="req_1",
                messages=[{"role": "user", "content": "What time is it?"}],
                tools=[{"name": "get_current_time", "description": "Get time", "parameters": {"type": "object"}}],
                provider_config=cfg,
                budget=IterationBudget(max_iterations=5, max_tool_calls=5, max_wall_ms=30_000),
                emit=events.append,
                request_tool_execution=request_tool,
                cancel_event=threading.Event(),
            )
            self.assertTrue(result["ok"])
            self.assertEqual(tool_calls_seen, ["get_current_time"])
            self.assertIn("12:00 UTC", result["content"])
            self.assertEqual(len(srv.requests), 2)

    def test_mid_stream_cancellation(self) -> None:
        def handle(handler, _body, _n):
            _send_sse(
                handler,
                [{"choices": [{"delta": {"content": f"tok{i} "}, "finish_reason": None}]} for i in range(40)],
                delay=0.05,
            )

        with _MockSSEServer(handle) as srv:
            cancel_event = threading.Event()
            cfg = ProviderConfig(provider="openai-compatible", base_url=srv.base_url, api_key="test-key", model="mock-model")

            def on_delta(_text: str) -> None:
                cancel_event.set()

            res = stream_openai_compatible(
                cfg,
                messages=[{"role": "user", "content": "Stream long"}],
                tools=[],
                cancel_event=cancel_event,
                on_delta=on_delta,
                on_reasoning=lambda _r: None,
            )
            self.assertTrue(res.aborted)


class TestSubprocessProtocol(unittest.TestCase):
    def test_stdio_protocol_ping_version_mismatch_and_malformed_json(self) -> None:
        proc = subprocess.Popen(
            [sys.executable, str(PYTHON_DIR / "agent_service.py")],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
        )
        assert proc.stdin and proc.stdout and proc.stderr
        try:
            # 1. Valid v2 ping
            proc.stdin.write(json.dumps({"id": "1", "protocol": PROTOCOL_VERSION, "method": "ping", "params": {}}) + "\n")
            proc.stdin.flush()
            line1 = json.loads(proc.stdout.readline())
            self.assertTrue(line1["ok"])
            self.assertEqual(line1["result"]["protocol"], PROTOCOL_VERSION)
            self.assertEqual(line1["result"]["authority"], "main-process-broker")

            # 2. Malformed JSON does not crash server
            proc.stdin.write("{not-valid-json\n")
            proc.stdin.flush()
            line2 = json.loads(proc.stdout.readline())
            self.assertFalse(line2["ok"])

            # 3. Protocol version mismatch
            proc.stdin.write(json.dumps({"id": "3", "protocol": "pixel-agent-v99", "method": "ping", "params": {}}) + "\n")
            proc.stdin.flush()
            line3 = json.loads(proc.stdout.readline())
            self.assertFalse(line3["ok"])
            self.assertIn("protocol", str(line3.get("error", "")).lower())

            # 4. Graceful shutdown
            proc.stdin.write(json.dumps({"id": "4", "protocol": PROTOCOL_VERSION, "method": "shutdown", "params": {}}) + "\n")
            proc.stdin.flush()
            line4 = json.loads(proc.stdout.readline())
            self.assertTrue(line4["ok"])
            proc.wait(timeout=5)
            self.assertEqual(proc.returncode, 0)
        finally:
            proc.stdin.close()
            proc.stdout.close()
            proc.stderr.close()
            if proc.poll() is None:
                proc.kill()
                proc.wait(timeout=5)


if __name__ == "__main__":
    unittest.main()
