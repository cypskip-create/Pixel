"""Production acceptance tests for Stage 7 security hardening & Stage 8 Python Gateway."""

from __future__ import annotations

import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from pixel_agent.budgets import IterationBudget
from pixel_agent.gateway import GatewayService, PLATFORM_INVENTORY, TelegramAdapter
from pixel_agent.gateway.webhooks_and_api import compute_hmac_sha256
from pixel_agent.loop import run_agent_turn
from pixel_agent.plugin_host import _build_minimal_plugin_env
from pixel_agent.plugin_manager import PluginManager
from pixel_agent.providers import ProviderConfig, ProviderTurnResult, ToolCallRecord


class TestStage7SecurityAndStage8Gateway(unittest.TestCase):
    def test_stage7_minimal_plugin_env_secret_redaction_toolset_enforcement_and_skill_traversal(self) -> None:
        # 1. Minimal allowlisted plugin subprocess environment excludes provider secrets
        os.environ["OPENAI_API_KEY"] = "sk-super-secret-do-not-leak"
        try:
            env = _build_minimal_plugin_env("/tmp/pyroot")
            self.assertNotIn("OPENAI_API_KEY", env)
            self.assertEqual(env["PYTHONUTF8"], "1")
        finally:
            os.environ.pop("OPENAI_API_KEY", None)

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pdir = root / "sec-plugin"
            pdir.mkdir()
            (pdir / "plugin.json").write_text(
                json.dumps({
                    "id": "secplug",
                    "name": "Secret Plugin",
                    "version": "1.0.0",
                    "entry": "plugin.py",
                    "config_schema": {
                        "api_token": {"type": "secret"},
                        "mode": {"type": "string", "default": "safe"},
                    },
                }),
                encoding="utf-8",
            )
            (pdir / "plugin.py").write_text("def register(ctx):\n    pass\n", encoding="utf-8")

            mgr = PluginManager(data_dir=root / "data")
            try:
                mgr.install(pdir, enable=True)
                mgr.configure("secplug", {"api_token": "tok-plain-999", "mode": "strict"})
                # Verify secret is NOT stored in plaintext in plugins-state.json
                raw_state = (root / "data" / "plugins-state.json").read_text(encoding="utf-8")
                self.assertNotIn("tok-plain-999", raw_state)

                # 2. Skills Hub rejects directory traversal IDs
                bad_sk = mgr.skills_hub_install("../escape", markdown="# bad")
                self.assertFalse(bad_sk["ok"])

                # 3. Real Toolset enforcement & empty allowlist [] denies all tools inside run_agent_turn
                mgr.set_toolset_enabled("browser", False)
                self.assertFalse(mgr.is_tool_allowed("browser_navigate")[0])
                self.assertFalse(mgr.is_tool_allowed("file_read", explicit_allowlist=[])[0])

                executed_in_electron: list[str] = []
                calls = [0]

                def fake_provider(_cfg, _msgs, _tls, _cancel, _d, _r):
                    calls[0] += 1
                    if calls[0] == 1:
                        return ProviderTurnResult(
                            tool_calls=[ToolCallRecord(id="c1", name="browser_navigate", arguments_json='{"url":"https://example.com"}')],
                            finish_reason="tool_calls",
                        )
                    return ProviderTurnResult(content="Blocked cleanly.", finish_reason="stop")

                res = run_agent_turn(
                    request_id="req_ts",
                    messages=[{"role": "user", "content": "Open example.com"}],
                    tools=[],
                    provider_config=ProviderConfig(provider="openai", model="gpt-4o", api_key="sk-test"),
                    budget=IterationBudget(max_iterations=3),
                    cancel_event=threading.Event(),
                    emit=lambda _e: None,
                    request_tool_execution=lambda _cid, nm, _a, _t: (executed_in_electron.append(nm), {"ok": True, "content": "ran"})[1],
                    provider_call=fake_provider,
                    tool_policy_check=lambda nm: mgr.is_tool_allowed(nm),
                )
                self.assertTrue(res["ok"])
                self.assertEqual(executed_in_electron, [])
            finally:
                mgr.emergency_stop()

    def test_stage8_gateway_pairing_telegram_webhooks_remote_api_and_emergency_stop(self) -> None:
        self.assertGreaterEqual(len(PLATFORM_INVENTORY), 25)

        with tempfile.TemporaryDirectory() as tmp:
            dispatched: list[dict] = []
            gw = GatewayService(
                data_dir=tmp,
                agent_dispatch=lambda req: (dispatched.append(req), {"ok": True, "content": f"Ack:{req['projectId']}"})[1],
            )
            try:
                started = gw.start(host="127.0.0.1", port=0)
                self.assertTrue(started["ok"])
                port = started["http"]["port"]
                self.assertGreater(port, 0)

                # 1. Telegram inbound from unknown user -> default-deny + pairing code issued
                tg_payload = {
                    "update_id": 1001,
                    "message": {
                        "message_id": 42,
                        "from": {"id": 99001, "username": "alice"},
                        "chat": {"id": 99001, "type": "private"},
                        "text": "Check project status",
                    },
                }
                denied = gw.ingest_inbound("telegram", tg_payload, available_tools=["file_read", "process_start"])
                self.assertFalse(denied["ok"])
                self.assertTrue(denied.get("unauthorized"))
                code = denied["pairingCode"]
                self.assertEqual(len(code), 8)

                # 2. Approve pairing bound to project "alpha" with read_only + project_files scopes
                approved = gw.approve_pairing(code, project_id="alpha", scopes=["read_only", "project_files"])
                self.assertTrue(approved["ok"])

                # 3. Replay of same message_id is deduplicated; new message succeeds with scoped tools (no process_start!)
                dup = gw.ingest_inbound("telegram", tg_payload, available_tools=["file_read", "process_start"])
                self.assertTrue(dup.get("duplicate"))

                tg_payload2 = {
                    "update_id": 1002,
                    "message": {
                        "message_id": 43,
                        "from": {"id": 99001, "username": "alice"},
                        "chat": {"id": 99001, "type": "private"},
                        "text": "Run status check",
                    },
                }
                ok_in = gw.ingest_inbound("telegram", tg_payload2, available_tools=["file_read", "process_start"])
                self.assertTrue(ok_in["ok"])
                self.assertEqual(ok_in["session"]["projectId"], "alpha")
                self.assertIn("file_read", ok_in["session"]["allowedTools"])
                self.assertNotIn("process_start", ok_in["session"]["allowedTools"])
                self.assertEqual(ok_in["reply"], "Ack:alpha")

                # 4. Bound remote approval rejects wrong actor, approves matching owner
                apr = gw.create_approval(session_id="s1", platform="telegram", account_id="99001", tool_name="file_write", target="a.txt")
                wrong = gw.resolve_approval(apr["id"], approved=True, actor_account_id="evil-user")
                self.assertFalse(wrong["ok"])
                right = gw.resolve_approval(apr["id"], approved=True, actor_account_id="99001")
                self.assertTrue(right["ok"])

                # 5. Authenticated Remote HTTP API (/v1/sessions & /v1/chat/completions)
                # Unauthenticated -> 401
                with self.assertRaises(urllib.error.HTTPError) as ctx401:
                    urllib.request.urlopen(f"http://127.0.0.1:{port}/v1/sessions", timeout=5)
                self.assertEqual(ctx401.exception.code, 401)

                # Pair device -> 200 with Bearer token
                paired = gw.pair_device("Work Laptop", project_id="beta")
                token = paired["token"]
                req_chat = urllib.request.Request(
                    f"http://127.0.0.1:{port}/v1/chat/completions",
                    data=json.dumps({"messages": [{"role": "user", "content": "hi"}]}).encode("utf-8"),
                    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(req_chat, timeout=5) as resp:
                    chat_data = json.loads(resp.read().decode("utf-8"))
                self.assertTrue(chat_data["ok"])
                self.assertEqual(chat_data["choices"][0]["message"]["content"], "Ack:beta")

                # 6. Webhook HMAC-SHA256 verification + invalid sig (401) + replay protection (409)
                wh = gw.webhooks.create_route(name="GH Hook", project_id="gamma", event_filters=["push"])
                wh_path = wh["route"]["path"]
                wh_secret = wh["signingSecret"]
                wh_body = json.dumps({"ref": "refs/heads/main"}).encode("utf-8")
                sig = compute_hmac_sha256(wh_secret, wh_body)

                # Invalid signature -> 401
                bad_req = urllib.request.Request(
                    f"http://127.0.0.1:{port}{wh_path}",
                    data=wh_body,
                    headers={"Content-Type": "application/json", "X-Pixel-Signature-256": "sha256=deadbeef", "X-Pixel-Event": "push"},
                    method="POST",
                )
                with self.assertRaises(urllib.error.HTTPError) as wh401:
                    urllib.request.urlopen(bad_req, timeout=5)
                self.assertEqual(wh401.exception.code, 401)

                # Valid signature -> 200
                good_req = urllib.request.Request(
                    f"http://127.0.0.1:{port}{wh_path}",
                    data=wh_body,
                    headers={"Content-Type": "application/json", "X-Pixel-Signature-256": f"sha256={sig}", "X-Pixel-Delivery": "deliv-1", "X-Pixel-Event": "push"},
                    method="POST",
                )
                with urllib.request.urlopen(good_req, timeout=5) as resp:
                    self.assertEqual(resp.status, 200)

                # Replayed delivery -> 409
                with self.assertRaises(urllib.error.HTTPError) as wh409:
                    urllib.request.urlopen(good_req, timeout=5)
                self.assertEqual(wh409.exception.code, 409)

                # 7. Emergency Stop blocks inbound & stops gateway
                gw.emergency_stop()
                blocked = gw.ingest_inbound("telegram", {"message": {"message_id": 99, "from": {"id": 99001}, "chat": {"id": 99001}, "text": "after stop"}})
                self.assertFalse(blocked["ok"])
                self.assertTrue(blocked.get("denied"))
            finally:
                gw.stop()


if __name__ == "__main__":
    unittest.main()
