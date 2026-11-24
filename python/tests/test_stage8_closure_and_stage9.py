"""Production acceptance tests for Stage 8 Closure and Stage 9 Desktop Services."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest import mock

from pixel_agent.gateway.platforms import (
    DiscordAdapter,
    EmailAdapter,
    InboundMessage,
    MatrixAdapter,
    OutboundMessage,
    PLATFORM_INVENTORY,
    SlackAdapter,
    TelegramAdapter,
    WhatsAppCloudAdapter,
)
from pixel_agent.gateway.runtime import GatewayService
from pixel_agent.gateway.webhooks_and_api import WebhookRegistry
from pixel_agent.protocol import PixelAgentProtocolServer
from pixel_agent.workspace_services import WorkspaceServices


class _MockOpenAIHandler(BaseHTTPRequestHandler):
    """Minimal local OpenAI-compatible HTTP server for real run_agent_turn tests."""

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        return

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8", errors="replace")
        body = json.loads(raw or "{}")
        messages = body.get("messages") or []
        last_user = next(
            (m.get("content", "") for m in reversed(messages) if m.get("role") == "user"),
            "",
        )
        payload = {
            "id": "chatcmpl-test-gw",
            "object": "chat.completion",
            "model": body.get("model", "test-model"),
            "choices": [
                {
                    "index": 0,
                    "finish_reason": "stop",
                    "message": {
                        "role": "assistant",
                        "content": f"Real Python turn reply for: {last_user}",
                    },
                }
            ],
            "usage": {"prompt_tokens": 12, "completion_tokens": 9, "total_tokens": 21},
        }
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


class Stage8ClosureTests(unittest.TestCase):
    def test_platform_inventory_honest_support_levels(self) -> None:
        self.assertEqual(len(PLATFORM_INVENTORY), 26)
        full = [p["id"] for p in PLATFORM_INVENTORY if p.get("supportLevel") == "full_adapter"]
        partial = [p["id"] for p in PLATFORM_INVENTORY if p.get("supportLevel") == "partial"]
        self.assertCountEqual(full, ["telegram", "slack", "matrix", "email"])
        self.assertCountEqual(partial, ["discord", "whatsapp_cloud"])
        email_entry = next(p for p in PLATFORM_INVENTORY if p["id"] == "email")
        self.assertEqual(email_entry.get("supportLevel"), "full_adapter")
        self.assertTrue(email_entry.get("supportsPolling"))
        for entry in PLATFORM_INVENTORY:
            self.assertIn(
                entry.get("supportLevel"),
                {"full_adapter", "partial", "outbound_only", "outbound_webhook", "external_dep_required"},
            )

    def test_platform_native_inbound_parsing_and_slack_signature(self) -> None:
        dc = DiscordAdapter({"botToken": "dc-tok"})
        dc_msg = dc.parse_inbound({
            "d": {
                "id": "999",
                "channel_id": "chan-1",
                "guild_id": "guild-1",
                "content": "hello discord",
                "author": {"id": "user-42", "username": "alice"},
            }
        })
        self.assertIsNotNone(dc_msg)
        self.assertEqual(dc_msg.account_id, "user-42")
        self.assertEqual(dc_msg.chat_id, "chan-1")
        self.assertTrue(dc_msg.is_group)

        sl = SlackAdapter({"botToken": "xoxb-test", "signingSecret": "sec-123"})
        sl_msg = sl.parse_inbound({
            "event_id": "Ev1",
            "event": {"user": "U100", "channel": "C200", "text": "hello slack", "ts": "1700000.1", "channel_type": "channel"},
        })
        self.assertIsNotNone(sl_msg)
        self.assertEqual(sl_msg.account_id, "U100")
        self.assertEqual(sl_msg.chat_id, "C200")
        body = b'{"event":{"text":"hello slack"}}'
        ts = "1700000000"
        sig = "v0=" + hmac.new(b"sec-123", f"v0:{ts}:".encode() + body, hashlib.sha256).hexdigest()
        self.assertTrue(sl.verify_signature(body, ts, sig))
        self.assertFalse(sl.verify_signature(body, ts, "v0=bad"))

        wa = WhatsAppCloudAdapter({"accessToken": "wa-tok", "phoneNumberId": "12345"})
        wa_msg = wa.parse_inbound({
            "entry": [{"changes": [{"value": {"messages": [{"id": "wamid.1", "from": "15550001111", "text": {"body": "hello wa"}}]}}]}]
        })
        self.assertIsNotNone(wa_msg)
        self.assertEqual(wa_msg.account_id, "15550001111")
        self.assertEqual(wa_msg.text, "hello wa")

        mx = MatrixAdapter({"homeserverUrl": "https://matrix.example.org", "accessToken": "mx-tok"})
        mx_msg = mx.parse_inbound({
            "type": "m.room.message",
            "event_id": "$ev1",
            "room_id": "!room1:example.org",
            "sender": "@bob:example.org",
            "content": {"msgtype": "m.text", "body": "hello matrix"},
        })
        self.assertIsNotNone(mx_msg)
        self.assertEqual(mx_msg.account_id, "@bob:example.org")
        self.assertEqual(mx_msg.chat_id, "!room1:example.org")

    def test_email_adapter_validation(self) -> None:
        bad_adapter = EmailAdapter({"smtpHost": ""})
        ok, err = bad_adapter.validate_config()
        self.assertFalse(ok)
        self.assertIn("smtpHost", err or "")

        adapter = EmailAdapter({"smtpHost": "smtp.example.com", "fromAddress": "pixel@example.com"})
        ok2, err2 = adapter.validate_config()
        self.assertTrue(ok2)
        self.assertIsNone(err2)
        missing_recipient = adapter.send_message(OutboundMessage(platform="email", chat_id="", text="Hello"))
        self.assertFalse(missing_recipient["ok"])

    def test_webhook_signature_checked_before_rate_limit_and_route_scoped_replay(self) -> None:
        mgr = WebhookRegistry()
        created_a = mgr.create_route(name="deploy-a", project_id="proj-a", rate_limit_per_min=2)
        created_b = mgr.create_route(name="deploy-b", project_id="proj-b", rate_limit_per_min=5)
        route_a = created_a["route"]
        route_b = created_b["route"]
        body = b'{"event":"build"}'
        secret_a = created_a["signingSecret"]
        secret_b = created_b["signingSecret"]
        good_sig_a = "sha256=" + hmac.new(secret_a.encode(), body, hashlib.sha256).hexdigest()
        good_sig_b = "sha256=" + hmac.new(secret_b.encode(), body, hashlib.sha256).hexdigest()

        # Flood with invalid signatures: must NEVER exhaust the route's rate limit.
        for _ in range(5):
            bad = mgr.verify_and_ingest(
                route_a["id"],
                body,
                {"X-Pixel-Signature-256": "sha256=deadbeef", "X-Delivery-Id": "bad-1"},
            )
            self.assertFalse(bad["ok"])
            self.assertEqual(bad["status"], 401)

        # Valid request still succeeds despite invalid-signature flood.
        ok1 = mgr.verify_and_ingest(
            route_a["id"],
            body,
            {"X-Pixel-Signature-256": good_sig_a, "X-Delivery-Id": "shared-id"},
        )
        self.assertTrue(ok1["ok"])

        # Same delivery_id on route A is blocked as replay.
        replay = mgr.verify_and_ingest(
            route_a["id"],
            body,
            {"X-Pixel-Signature-256": good_sig_a, "X-Delivery-Id": "shared-id"},
        )
        self.assertFalse(replay["ok"])
        self.assertEqual(replay["status"], 409)

        # Same delivery_id on route B is allowed (route-scoped replay table).
        ok_b = mgr.verify_and_ingest(
            route_b["id"],
            body,
            {"X-Pixel-Signature-256": good_sig_b, "X-Delivery-Id": "shared-id"},
        )
        self.assertTrue(ok_b["ok"])

    def test_approval_requires_matching_actor_and_platform(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            gw = GatewayService(data_dir=tmp)
            req = gw.create_approval(
                session_id="s1",
                platform="telegram",
                account_id="user-1",
                tool_name="file_write",
                target="notes.md",
            )
            wrong_plat = gw.resolve_approval(req["id"], approved=True, actor_account_id="user-1", actor_platform="discord")
            self.assertFalse(wrong_plat["ok"])

            wrong_actor = gw.resolve_approval(req["id"], approved=True, actor_account_id="user-2", actor_platform="telegram")
            self.assertFalse(wrong_actor["ok"])

            ok = gw.resolve_approval(req["id"], approved=True, actor_account_id="user-1", actor_platform="telegram")
            self.assertTrue(ok["ok"])
            self.assertEqual(ok["approval"]["status"], "approved")

    def test_remote_sessions_isolated_by_device_and_tools_computed_from_policy(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            seen_tools: list[list[str]] = []

            def fake_dispatch(turn: dict) -> dict:
                seen_tools.append(list(turn.get("allowedTools") or []))
                return {"ok": True, "content": f"ok:{turn['projectId']}"}

            gw = GatewayService(data_dir=tmp, agent_dispatch=fake_dispatch)
            gw.set_available_tools(["documents_read", "terminal_exec"])
            gw.start(port=0)
            try:
                p1 = gw.pair_device("Phone 1", project_id="proj-1", scopes=["read_only"])
                p2 = gw.pair_device("Phone 2", project_id="proj-2", scopes=["read_only"])
                dev1 = p1["device"]
                dev2 = p2["device"]

                res1 = gw._handle_remote_api_chat(dev1, {"messages": [{"role": "user", "content": "Hello from dev1"}]})
                self.assertTrue(res1["ok"])
                self.assertEqual(len(seen_tools), 1)
                self.assertIn("documents_read", seen_tools[0])
                self.assertNotIn("terminal_exec", seen_tools[0])

                # Verify /v1/sessions isolation via real HTTP call on bound loopback port
                import urllib.request

                port = gw.status()["http"]["port"]
                req1 = urllib.request.Request(
                    f"http://127.0.0.1:{port}/v1/sessions",
                    headers={"Authorization": f"Bearer {p1['token']}"},
                )
                with urllib.request.urlopen(req1, timeout=5) as r1:
                    s1 = json.loads(r1.read().decode("utf-8"))
                req2 = urllib.request.Request(
                    f"http://127.0.0.1:{port}/v1/sessions",
                    headers={"Authorization": f"Bearer {p2['token']}"},
                )
                with urllib.request.urlopen(req2, timeout=5) as r2:
                    s2 = json.loads(r2.read().decode("utf-8"))
                self.assertEqual(len(s1["sessions"]), 1)
                self.assertEqual(len(s2["sessions"]), 0)
            finally:
                gw.stop()

    def test_telegram_polling_worker_persists_offset_and_stops_cleanly(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            gw = GatewayService(data_dir=tmp, agent_dispatch=lambda t: {"ok": True, "content": "pong"})
            gw.start(port=0)
            try:
                pair_req = gw.pairing.request_pairing("telegram", "tg-42", display_name="Alice", chat_id="chat-42")
                gw.approve_pairing(pair_req["code"], project_id="proj-tg")

                tg = TelegramAdapter({"botToken": "123:test"})
                tg.connected = True
                gw._adapters["telegram"] = tg

                calls = {"n": 0}

                def fake_poll(self_adapter, timeout_s=0):
                    calls["n"] += 1
                    if calls["n"] == 1:
                        self_adapter._last_update_id = 777
                        return [
                            InboundMessage(
                                platform="telegram",
                                account_id="tg-42",
                                chat_id="chat-42",
                                message_id="tg-msg-777",
                                text="ping",
                                display_name="Alice",
                            )
                        ]
                    return []

                with mock.patch.object(TelegramAdapter, "poll_updates", fake_poll), mock.patch.object(
                    TelegramAdapter, "send_message", return_value={"ok": True, "delivered": True}
                ):
                    started = gw.start_telegram_polling(interval_s=0.05)
                    self.assertTrue(started["ok"])
                    deadline = time.time() + 3.0
                    while time.time() < deadline and gw._telegram_last_update_id < 777:
                        time.sleep(0.05)
                    self.assertEqual(gw._telegram_last_update_id, 777)
                    gw.stop_telegram_polling()
                    state_path = os.path.join(tmp, "gateway-state.json")
                    with open(state_path, "r", encoding="utf-8") as fh:
                        persisted = json.load(fh)
                    self.assertEqual(persisted.get("telegramLastUpdateId"), 777)
            finally:
                gw.stop()

    def test_protocol_production_gateway_dispatch_executes_real_agent_turn(self) -> None:
        server = HTTPServer(("127.0.0.1", 0), _MockOpenAIHandler)
        port = server.server_address[1]
        t = threading.Thread(target=server.serve_forever, daemon=True)
        t.start()
        try:
            with tempfile.TemporaryDirectory() as tmp:
                emitted: list[dict] = []

                class _CaptureOut:
                    def write(self, data: str) -> int:
                        for line in data.splitlines():
                            if line.strip():
                                emitted.append(json.loads(line))
                        return len(data)

                    def flush(self) -> None:
                        return

                old_gw_dir = os.environ.get("PIXEL_GATEWAY_DATA_DIR")
                os.environ["PIXEL_GATEWAY_DATA_DIR"] = tmp
                try:
                    proto = PixelAgentProtocolServer(stdout=_CaptureOut())
                    proto.handle_message({
                        "id": "cfg-1",
                        "type": "gateway.configure_agent",
                        "params": {
                            "provider": {
                                "provider": "openai",
                                "model": "gpt-4o-mini",
                                "baseUrl": f"http://127.0.0.1:{port}/v1",
                                "apiKey": "test-key",
                            },
                            "tools": [],
                        },
                    })
                    res = proto._dispatch_gateway_turn({
                        "projectId": "proj-real",
                        "allowedTools": [],
                        "message": {"text": "status check"},
                    })
                    self.assertTrue(res["ok"])
                    self.assertIn("Real Python turn reply for: status check", res["content"])
                finally:
                    if old_gw_dir is None:
                        os.environ.pop("PIXEL_GATEWAY_DATA_DIR", None)
                    else:
                        os.environ["PIXEL_GATEWAY_DATA_DIR"] = old_gw_dir
        finally:
            server.shutdown()
            server.server_close()


class Stage9WorkspaceServicesTests(unittest.TestCase):
    def test_profiles_lifecycle_and_default_protection(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            svc = WorkspaceServices(data_dir=tmp)
            listed = svc.list_profiles()
            self.assertTrue(listed["ok"])
            self.assertEqual(listed["activeProfileId"], "default")

            created = svc.create_profile("Research", description="Isolated research")
            self.assertTrue(created["ok"])
            pid = created["profile"]["id"]
            self.assertTrue(os.path.isdir(created["profile"]["dataDir"]))

            switched = svc.switch_profile(pid)
            self.assertTrue(switched["ok"])
            self.assertEqual(switched["activeProfileId"], pid)

            updated = svc.update_profile(pid, {"description": "Updated desc"})
            self.assertTrue(updated["ok"])
            self.assertEqual(updated["profile"]["description"], "Updated desc")

            # Cannot delete default profile
            del_default = svc.delete_profile("default")
            self.assertFalse(del_default["ok"])
            self.assertIn("protected", del_default.get("error", "").lower())

            deleted = svc.delete_profile(pid)
            self.assertTrue(deleted["ok"])
            self.assertEqual(svc.list_profiles()["activeProfileId"], "default")

    def test_artifacts_isolation_by_profile_and_project(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            svc = WorkspaceServices(data_dir=tmp)
            a1 = svc.register_artifact(name="Spec.md", kind="markdown", project_id="proj-1", preview_text="Spec")
            self.assertTrue(a1["ok"])
            p2 = svc.create_profile("Work")["profile"]["id"]
            svc.switch_profile(p2)
            a2 = svc.register_artifact(name="Report.csv", kind="data", project_id="proj-2")
            self.assertTrue(a2["ok"])

            work_list = svc.list_artifacts()
            self.assertEqual(len(work_list), 1)
            self.assertEqual(work_list[0]["name"], "Report.csv")

            svc.switch_profile("default")
            default_list = svc.list_artifacts(project_id="proj-1")
            self.assertEqual(len(default_list), 1)
            self.assertEqual(default_list[0]["name"], "Spec.md")

            deleted = svc.delete_artifact(a1["artifact"]["id"])
            self.assertTrue(deleted["ok"])
            self.assertEqual(len(svc.list_artifacts()), 0)

    def test_starmap_builds_grounded_graph_without_fabrication(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            svc = WorkspaceServices(data_dir=tmp)
            svc.register_artifact(name="Design Doc", kind="document", project_id="proj-alpha", session_id="s1")
            graph = svc.build_starmap(
                memories=[{"id": "m1", "content": "Use Python runtime", "tags": ["arch"], "createdAt": 1000}],
                skills=[{"id": "sk1", "name": "Deploy Check", "createdAt": 1500}],
                sessions=[{"id": "s1", "title": "Release Prep", "updatedAt": 2000}],
                project_id="proj-alpha",
            )
            self.assertTrue(graph["ok"])
            kinds = {n["kind"] for n in graph["nodes"]}
            self.assertTrue({"memory", "skill", "session", "artifact"}.issubset(kinds))
            self.assertGreaterEqual(len(graph["edges"]), 1)

    def test_session_import_json_and_markdown_with_duplicate_detection(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            svc = WorkspaceServices(data_dir=tmp)
            md = "User: What shipped?\n\nAssistant: Stage 8 and Stage 9.\n"
            preview = svc.preview_session_import(md, format_hint="markdown")
            self.assertTrue(preview["ok"])
            self.assertEqual(preview["messageCount"], 2)
            self.assertFalse(preview["duplicate"])

            committed = svc.commit_session_import(md, format_hint="markdown")
            self.assertTrue(committed["ok"])
            self.assertEqual(committed["messages"], 2)

            dup = svc.commit_session_import(md, format_hint="markdown")
            self.assertFalse(dup["ok"])
            self.assertTrue(dup.get("duplicate"))

            json_raw = json.dumps({
                "title": "JSON Export",
                "messages": [
                    {"role": "user", "content": "Hi"},
                    {"role": "assistant", "content": "Hello!"},
                ],
            })
            j_commit = svc.commit_session_import(json_raw, format_hint="json")
            self.assertTrue(j_commit["ok"])
            self.assertEqual(j_commit["imported"], 1)

            # 2-phase safe commit: preview never persists digest until confirm_session_import is called
            md2 = "User: Deferred?\n\nAssistant: Confirmed only after persistence.\n"
            p1 = svc.preview_session_import(md2, format_hint="markdown")
            self.assertTrue(p1["ok"])
            self.assertFalse(p1["duplicate"])
            p2 = svc.preview_session_import(md2, format_hint="markdown")
            self.assertFalse(p2["duplicate"])
            svc.confirm_session_import(str(p1["digest"]))
            p3 = svc.preview_session_import(md2, format_hint="markdown")
            self.assertTrue(p3["duplicate"])


if __name__ == "__main__":
    unittest.main()
