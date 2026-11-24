"""Production-integration tests for Pixel's Python-first runtime & Stage 4-6 capabilities."""

from __future__ import annotations

import base64
import io
import json
import threading
import unittest

from pixel_agent.budgets import IterationBudget
from pixel_agent.loop import run_agent_turn
from pixel_agent.multimodal import (
    annotate_som_png_base64,
    assert_vision_capable_model,
    decode_png_rgba,
    encode_png_rgba,
    enforce_image_history_budget,
)
from pixel_agent.protocol import PixelAgentProtocolServer
from pixel_agent.providers import ProviderConfig, ProviderTurnResult, ToolCallRecord
from pixel_agent.voice import (
    exchange_gpt_live_sdp_offer,
    split_into_speech_segments,
    synthesize_cloud,
    transcribe_cloud,
)


def _make_blank_png_b64(width: int = 80, height: int = 60) -> str:
    rgba = bytearray([240, 240, 240, 255] * (width * height))
    return base64.b64encode(encode_png_rgba(width, height, rgba)).decode("ascii")


class TestPythonFirstStage4To6(unittest.TestCase):
    def test_som_png_annotation_draws_visible_boxes_and_badges(self) -> None:
        raw_b64 = _make_blank_png_b64(100, 80)
        res = annotate_som_png_base64(
            raw_b64,
            elements=[
                {"index": 1, "bounds": {"x": 10, "y": 20, "width": 40, "height": 20}},
                {"index": 12, "bounds": {"x": 55, "y": 25, "width": 35, "height": 20}},
            ],
            window_bounds={"x": 0, "y": 0, "width": 100, "height": 80},
        )
        self.assertTrue(res["ok"])
        self.assertEqual(res["width"], 100)
        self.assertEqual(res["height"], 80)
        self.assertEqual(res["annotatedCount"], 2)
        self.assertNotEqual(res["annotatedBase64"], raw_b64)

        out_bytes = base64.b64decode(res["annotatedBase64"])
        w, h, rgba = decode_png_rgba(out_bytes)
        self.assertEqual((w, h), (100, 80))
        # Verify crimson box outline drawn on element #1 top edge (35, 20)
        outline_idx = (20 * 100 + 35) * 4
        self.assertEqual((rgba[outline_idx], rgba[outline_idx + 1], rgba[outline_idx + 2]), (220, 38, 38))
        # Verify white-bordered numbered badge drawn above element #1 at (10, 20)
        badge_border_idx = (20 * 100 + 10) * 4
        self.assertEqual((rgba[badge_border_idx], rgba[badge_border_idx + 1], rgba[badge_border_idx + 2]), (255, 255, 255))

    def test_vision_capability_and_image_history_budget(self) -> None:
        self.assertTrue(assert_vision_capable_model("gpt-4o")["ok"])
        self.assertTrue(assert_vision_capable_model("claude-sonnet-4")["ok"])
        self.assertFalse(assert_vision_capable_model("deepseek-chat")["ok"])

        msgs = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": f"shot {i}"},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,AAA{i}"}},
                ],
            }
            for i in range(6)
        ]
        pruned, dropped = enforce_image_history_budget(msgs, max_images=2)
        self.assertEqual(dropped, 4)
        remaining_images = [
            p
            for m in pruned
            if isinstance(m.get("content"), list)
            for p in m["content"]
            if isinstance(p, dict) and p.get("type") == "image_url"
        ]
        self.assertEqual(len(remaining_images), 2)
        self.assertIn("AAA5", remaining_images[-1]["image_url"]["url"])

    def test_loop_forwards_multimodal_tool_image_to_vision_model_only(self) -> None:
        raw_b64 = _make_blank_png_b64(32, 24)
        seen_payloads: list[list[dict]] = []

        def fake_provider(cfg, messages, _tools, _cancel, _on_delta, _on_reasoning):
            seen_payloads.append(list(messages))
            if len(seen_payloads) == 1:
                return ProviderTurnResult(
                    tool_calls=[ToolCallRecord(id="call_1", name="computer_use", arguments_json='{"action":"capture"}')],
                    finish_reason="tool_calls",
                )
            return ProviderTurnResult(content="I see the annotated window.", finish_reason="stop")

        def fake_tool(_cid, _name, _args, _timeout):
            return {
                "ok": True,
                "content": "Captured Notepad in som mode",
                "image": {"mediaType": "image/png", "dataBase64": raw_b64, "label": "Notepad (som annotated)"},
            }

        # 1. Vision-capable model receives the actual image_url payload
        res = run_agent_turn(
            request_id="req_vis",
            messages=[{"role": "user", "content": "Inspect the screen"}],
            tools=[],
            provider_config=ProviderConfig(provider="openai", model="gpt-4o", api_key="sk-test"),
            budget=IterationBudget(max_iterations=4),
            cancel_event=threading.Event(),
            emit=lambda _e: None,
            request_tool_execution=fake_tool,
            provider_call=fake_provider,
        )
        self.assertTrue(res["ok"])
        second_call_msgs = seen_payloads[1]
        has_image = any(
            isinstance(m.get("content"), list)
            and any(isinstance(p, dict) and p.get("type") == "image_url" and raw_b64 in p["image_url"]["url"] for p in m["content"])
            for m in second_call_msgs
        )
        self.assertTrue(has_image, "Expected vision model request to include multimodal image_url block")

        # 2. Text-only model receives an honest text notice instead of crashing
        seen_payloads.clear()
        run_agent_turn(
            request_id="req_txt",
            messages=[{"role": "user", "content": "Inspect the screen"}],
            tools=[],
            provider_config=ProviderConfig(provider="deepseek", model="deepseek-chat", api_key="sk-test"),
            budget=IterationBudget(max_iterations=4),
            cancel_event=threading.Event(),
            emit=lambda _e: None,
            request_tool_execution=fake_tool,
            provider_call=fake_provider,
        )
        second_txt_msgs = seen_payloads[1]
        self.assertTrue(
            any(isinstance(m.get("content"), str) and "does not advertise vision" in m["content"] for m in second_txt_msgs)
        )

    def test_python_voice_privacy_and_protocol_rpcs(self) -> None:
        blocked_stt = transcribe_cloud(provider="openai", wav_base64="", api_key="sk-x", local_only=True)
        self.assertFalse(blocked_stt["ok"])
        self.assertIn("local-only", blocked_stt["error"])

        blocked_tts = synthesize_cloud(provider="elevenlabs", text="Hello", api_key="sk-x", local_only=True)
        self.assertFalse(blocked_tts["ok"])
        self.assertIn("local-only", blocked_tts["error"])

        blocked_live = exchange_gpt_live_sdp_offer(sdp_offer="v=0\r\n", api_key="sk-x", local_only=True)
        self.assertFalse(blocked_live["ok"])
        self.assertIn("local-only", blocked_live["error"])

        segs = split_into_speech_segments("First sentence. Second sentence! Third sentence?", max_chars=30)
        self.assertEqual(len(segs), 3)

        out = io.StringIO()
        srv = PixelAgentProtocolServer(stdin=io.StringIO(), stdout=out)
        srv.handle_message({"id": "diag1", "method": "runtime.diagnostics"})
        frame = json.loads(out.getvalue().strip())
        self.assertTrue(frame["ok"])
        self.assertEqual(frame["result"]["runtime"], "python")
        self.assertTrue(frame["result"]["capabilities"]["somPngAnnotation"])
        self.assertTrue(frame["result"]["capabilities"]["concurrentTurns"])


if __name__ == "__main__":
    unittest.main()
