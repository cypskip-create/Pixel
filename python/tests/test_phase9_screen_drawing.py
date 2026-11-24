"""Unit & protocol tests for Phase 9 Python-first screen drawing engine."""

from __future__ import annotations

import io
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from pixel_agent.protocol import PixelAgentProtocolServer
from pixel_agent.screen_drawing import (
    SCREEN_DRAWING_TOOL_SPECS,
    ScreenDrawingEngine,
    catmull_rom_to_svg_path,
    choose_computer_use_resolution,
    compute_arc_path,
    normalize_to_display,
    spring_progress,
)


class ScreenDrawingEngineTests(unittest.TestCase):
    def test_all_seven_primitives_and_svg_paths(self) -> None:
        now = [1000]
        engine = ScreenDrawingEngine(clock_ms=lambda: now[0])

        snap = engine.add({
            "kind": "freehand",
            "points": [{"x": 10, "y": 10}, {"x": 50, "y": 30}, {"x": 100, "y": 20}],
            "strokeWidth": 4,
            "durationMs": 5000,
        })
        self.assertTrue(snap["visible"])
        self.assertEqual(len(snap["annotations"]), 1)
        self.assertIn("C ", snap["annotations"][0]["svgPath"])

        engine.add({"kind": "arrow", "start": {"x": 20, "y": 20}, "end": {"x": 200, "y": 120}, "curved": True, "label": "Click here", "step": 1})
        engine.add({"kind": "box", "bounds": {"x": 100, "y": 100, "width": 160, "height": 48}, "dashed": True, "label": "Save"})
        engine.add({"kind": "circle", "bounds": {"x": 300, "y": 200, "width": 64, "height": 64}})
        engine.add({"kind": "callout", "anchor": {"x": 400, "y": 250}, "label": "Settings button"})
        engine.add({"kind": "spotlight", "bounds": {"x": 50, "y": 50, "width": 300, "height": 200}, "dimOpacity": 0.55})
        snap = engine.add({"kind": "pointer_flight", "start": {"x": 10, "y": 10}, "end": {"x": 500, "y": 300}, "arcHeight": 64})

        self.assertEqual(len(snap["annotations"]), 7)
        kinds = [a["kind"] for a in snap["annotations"]]
        self.assertEqual(kinds, ["freehand", "arrow", "box", "circle", "callout", "spotlight", "pointer_flight"])
        self.assertIn("Q ", snap["annotations"][-1]["svgPath"])

    def test_ttl_expiration_and_pinned_annotations(self) -> None:
        now = [10_000]
        engine = ScreenDrawingEngine(clock_ms=lambda: now[0])
        engine.add({"id": "temp", "kind": "box", "bounds": {"x": 0, "y": 0, "width": 50, "height": 50}, "durationMs": 3000})
        engine.add({"id": "stay", "kind": "box", "bounds": {"x": 60, "y": 0, "width": 50, "height": 50}, "pinned": True})

        now[0] = 12_999
        self.assertEqual(len(engine.snapshot()["annotations"]), 2)

        now[0] = 13_001
        snap = engine.snapshot()
        self.assertEqual([a["id"] for a in snap["annotations"]], ["stay"])

    def test_undo_redo_clear_and_emergency_stop(self) -> None:
        engine = ScreenDrawingEngine(clock_ms=lambda: 1000)
        engine.add({"id": "a1", "kind": "box", "bounds": {"x": 1, "y": 1, "width": 40, "height": 40}})
        engine.add({"id": "a2", "kind": "circle", "bounds": {"x": 10, "y": 10, "width": 40, "height": 40}})
        snap = engine.undo()
        self.assertEqual([a["id"] for a in snap["annotations"]], ["a1"])
        self.assertTrue(snap["canRedo"])

        snap = engine.redo()
        self.assertEqual([a["id"] for a in snap["annotations"]], ["a1", "a2"])

        engine.set_interactive(True)
        snap = engine.emergency_stop()
        self.assertFalse(snap["visible"])
        self.assertFalse(snap["interactive"])
        self.assertEqual(snap["annotations"], [])
        self.assertFalse(snap["canUndo"])
        self.assertFalse(snap["canRedo"])

    def test_coordinate_normalization_and_helpers(self) -> None:
        self.assertEqual(choose_computer_use_resolution(1920, 1080), (1366, 768))
        self.assertEqual(choose_computer_use_resolution(1440, 900), (1280, 800))
        self.assertEqual(choose_computer_use_resolution(1600, 1200), (1024, 768))

        mapped = normalize_to_display(
            683, 384,
            source_width=1366, source_height=768,
            display_x=1920, display_y=0,
            display_width=1920, display_height=1080,
        )
        self.assertAlmostEqual(mapped["x"], 2880.0, delta=1.0)
        self.assertAlmostEqual(mapped["y"], 540.0, delta=1.0)

        # Clamping out-of-bounds points
        clamped = normalize_to_display(
            5000, -100,
            source_width=1366, source_height=768,
            display_x=0, display_y=0,
            display_width=1920, display_height=1080,
        )
        self.assertEqual(clamped, {"x": 1920.0, "y": 0.0})
        self.assertGreater(spring_progress(0.25), 0.5)
        self.assertIn("Q ", compute_arc_path({"x": 0, "y": 0}, {"x": 100, "y": 0}))
        self.assertIn("L ", catmull_rom_to_svg_path([{"x": 0, "y": 0}, {"x": 10, "y": 10}]))

    def test_execute_tool_and_protocol_rpcs(self) -> None:
        engine = ScreenDrawingEngine(clock_ms=lambda: 5000)
        snap = engine.execute_tool("screen_draw_callout", {"anchor": {"x": 200, "y": 150}, "label": "Click Submit"})
        self.assertEqual(len(snap["annotations"]), 1)
        self.assertEqual(len(SCREEN_DRAWING_TOOL_SPECS), 9)

        # Full NDJSON protocol roundtrip
        reqs = [
            {"id": "1", "type": "drawing.add", "params": {"kind": "box", "bounds": {"x": 10, "y": 20, "width": 100, "height": 50}, "label": "Target"}},
            {"id": "2", "type": "drawing.set_interactive", "params": {"interactive": True}},
            {"id": "3", "type": "drawing.map_coord", "params": {"x": 683, "y": 384, "sourceWidth": 1366, "sourceHeight": 768, "displayWidth": 1920, "displayHeight": 1080}},
            {"id": "4", "type": "drawing.tools", "params": {}},
            {"id": "5", "type": "drawing.undo", "params": {}},
            {"id": "6", "type": "drawing.emergency_stop", "params": {}},
        ]
        stdin = io.StringIO("\n".join(json.dumps(r) for r in reqs) + "\n")
        stdout = io.StringIO()
        server = PixelAgentProtocolServer(stdin=stdin, stdout=stdout)
        server.serve_forever()
        responses = [json.loads(line) for line in stdout.getvalue().splitlines() if line.strip()]
        self.assertEqual(len(responses), 6)
        self.assertTrue(all(r["ok"] for r in responses))
        self.assertEqual(len(responses[0]["result"]["annotations"]), 1)
        self.assertTrue(responses[1]["result"]["interactive"])
        self.assertEqual(responses[2]["result"]["computerUseResolution"], {"width": 1366, "height": 768})
        self.assertEqual(len(responses[3]["result"]["tools"]), 9)
        self.assertEqual(responses[4]["result"]["annotations"], [])
        self.assertFalse(responses[5]["result"]["interactive"])


if __name__ == "__main__":
    unittest.main()
