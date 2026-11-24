"""Authoritative Python screen-drawing & live annotation engine for Pixel (Phase 9).

Architecture distilled from HeyClicky (`HeyClicky.Drawing.dll`, `HeyClicky.Drawing3D.dll`,
`HeyClicky.Platform.dll`) and Clicky (`OverlayWindow.swift`, `ElementLocationDetector.swift`):
- Python owns the canonical scene graph, Catmull-Rom stroke smoothing, aspect-ratio-matched
  coordinate normalization, TTL auto-expiration, undo/redo history, and agent tool schemas.
- Electron + React own strictly the transparent click-through overlay window, capture
  exclusion (`setContentProtection(true)`), and SVG rendering.
"""

from __future__ import annotations

import math
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

VALID_KINDS = frozenset({
    "freehand",
    "arrow",
    "box",
    "circle",
    "callout",
    "spotlight",
    "pointer_flight",
})

DEFAULT_DURATION_MS = 10_000
MIN_DURATION_MS = 1_500
MAX_DURATION_MS = 120_000
MAX_ANNOTATIONS = 64
MAX_HISTORY = 50

# Aspect-ratio-matched Computer Use resolutions (Clicky ElementLocationDetector)
COMPUTER_USE_RESOLUTIONS: tuple[tuple[int, int], ...] = (
    (1024, 768),   # 4:3
    (1280, 800),   # 16:10
    (1366, 768),   # 16:9
)


def _now_ms() -> int:
    return int(time.time() * 1000)


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def choose_computer_use_resolution(display_width: float, display_height: float) -> tuple[int, int]:
    """Pick the closest aspect-ratio Computer Use resolution for a display."""
    if display_width <= 0 or display_height <= 0:
        return (1366, 768)
    target_ratio = display_width / display_height
    best = COMPUTER_USE_RESOLUTIONS[0]
    best_diff = float("inf")
    for w, h in COMPUTER_USE_RESOLUTIONS:
        diff = abs((w / h) - target_ratio)
        if diff < best_diff:
            best_diff = diff
            best = (w, h)
    return best


def normalize_to_display(
    x: float,
    y: float,
    *,
    source_width: float,
    source_height: float,
    display_x: float = 0.0,
    display_y: float = 0.0,
    display_width: float = 1920.0,
    display_height: float = 1080.0,
    scale_factor: float = 1.0,
    input_is_physical_px: bool = False,
) -> dict[str, float]:
    """Map model/screenshot coordinates into clamped logical display DIP coordinates."""
    if source_width <= 0 or source_height <= 0 or display_width <= 0 or display_height <= 0:
        return {"x": round(display_x, 2), "y": round(display_y, 2)}

    safe_scale = scale_factor if scale_factor > 0 else 1.0
    eff_x = x / safe_scale if input_is_physical_px else x
    eff_y = y / safe_scale if input_is_physical_px else y
    eff_sw = source_width / safe_scale if input_is_physical_px else source_width
    eff_sh = source_height / safe_scale if input_is_physical_px else source_height

    nx = _clamp(eff_x, 0.0, eff_sw) / eff_sw
    ny = _clamp(eff_y, 0.0, eff_sh) / eff_sh

    out_x = display_x + nx * display_width
    out_y = display_y + ny * display_height
    return {
        "x": round(_clamp(out_x, display_x, display_x + display_width), 2),
        "y": round(_clamp(out_y, display_y, display_y + display_height), 2),
    }


def spring_progress(elapsed_s: float, stiffness: float = 180.0, damping: float = 20.0) -> float:
    """Critically/under-damped spring progress in [0, ~1.05] (HeyClicky ScreenPenMath)."""
    if elapsed_s <= 0:
        return 0.0
    omega = math.sqrt(max(1.0, stiffness))
    zeta = max(0.1, damping / (2.0 * omega))
    if zeta < 1.0:
        omega_d = omega * math.sqrt(1.0 - zeta * zeta)
        val = 1.0 - math.exp(-zeta * omega * elapsed_s) * (
            math.cos(omega_d * elapsed_s) + (zeta / math.sqrt(1.0 - zeta * zeta)) * math.sin(omega_d * elapsed_s)
        )
    else:
        val = 1.0 - math.exp(-omega * elapsed_s) * (1.0 + omega * elapsed_s)
    return round(val, 4)


def catmull_rom_to_svg_path(points: list[dict[str, float]], tension: float = 0.5) -> str:
    """Convert raw freehand stroke points into a smooth cubic Bezier SVG path string."""
    if not points:
        return ""
    if len(points) == 1:
        p = points[0]
        return f"M {p['x']:.1f} {p['y']:.1f} L {p['x'] + 0.5:.1f} {p['y'] + 0.5:.1f}"
    if len(points) == 2:
        p0, p1 = points[0], points[1]
        return f"M {p0['x']:.1f} {p0['y']:.1f} L {p1['x']:.1f} {p1['y']:.1f}"

    parts = [f"M {points[0]['x']:.1f} {points[0]['y']:.1f}"]
    n = len(points)
    for i in range(n - 1):
        p0 = points[i - 1] if i > 0 else points[i]
        p1 = points[i]
        p2 = points[i + 1]
        p3 = points[i + 2] if i + 2 < n else p2

        c1x = p1["x"] + (p2["x"] - p0["x"]) * tension / 3.0
        c1y = p1["y"] + (p2["y"] - p0["y"]) * tension / 3.0
        c2x = p2["x"] - (p3["x"] - p1["x"]) * tension / 3.0
        c2y = p2["y"] - (p3["y"] - p1["y"]) * tension / 3.0
        parts.append(f"C {c1x:.1f} {c1y:.1f}, {c2x:.1f} {c2y:.1f}, {p2['x']:.1f} {p2['y']:.1f}")
    return " ".join(parts)


def compute_arc_path(
    start: dict[str, float],
    end: dict[str, float],
    arc_height: float = 48.0,
) -> str:
    """Compute a quadratic Bezier arc path (used by curved arrows & pointer_flight)."""
    mx = (start["x"] + end["x"]) / 2.0
    my = (start["y"] + end["y"]) / 2.0 - arc_height
    return f"M {start['x']:.1f} {start['y']:.1f} Q {mx:.1f} {my:.1f}, {end['x']:.1f} {end['y']:.1f}"


def _clean_point(raw: Any) -> Optional[dict[str, float]]:
    if not isinstance(raw, dict):
        return None
    try:
        x = float(raw["x"])
        y = float(raw["y"])
    except (KeyError, TypeError, ValueError):
        return None
    if not (math.isfinite(x) and math.isfinite(y)):
        return None
    return {"x": round(x, 2), "y": round(y, 2)}


def _clean_bounds(raw: Any) -> Optional[dict[str, float]]:
    if not isinstance(raw, dict):
        return None
    try:
        x = float(raw["x"])
        y = float(raw["y"])
        w = float(raw["width"])
        h = float(raw["height"])
    except (KeyError, TypeError, ValueError):
        return None
    if not all(math.isfinite(v) for v in (x, y, w, h)) or w <= 0 or h <= 0:
        return None
    return {"x": round(x, 2), "y": round(y, 2), "width": round(w, 2), "height": round(h, 2)}


@dataclass
class ScreenDrawingAnnotation:
    id: str
    kind: str
    created_at: int
    expires_at: Optional[int]
    stroke_width: float = 3.0
    opacity: float = 1.0
    dashed: bool = False
    pinned: bool = False
    label: Optional[str] = None
    step: Optional[int] = None
    bounds: Optional[dict[str, float]] = None
    start: Optional[dict[str, float]] = None
    end: Optional[dict[str, float]] = None
    anchor: Optional[dict[str, float]] = None
    points: list[dict[str, float]] = field(default_factory=list)
    svg_path: Optional[str] = None
    dim_opacity: float = 0.45
    arc_height: float = 48.0
    display_id: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "id": self.id,
            "kind": self.kind,
            "createdAt": self.created_at,
            "expiresAt": self.expires_at,
            "strokeWidth": self.stroke_width,
            "opacity": self.opacity,
            "dashed": self.dashed,
            "pinned": self.pinned,
        }
        if self.label:
            out["label"] = self.label
        if self.step is not None:
            out["step"] = self.step
        if self.bounds is not None:
            out["bounds"] = dict(self.bounds)
        if self.start is not None:
            out["start"] = dict(self.start)
        if self.end is not None:
            out["end"] = dict(self.end)
        if self.anchor is not None:
            out["anchor"] = dict(self.anchor)
        if self.points:
            out["points"] = [dict(p) for p in self.points]
        if self.svg_path:
            out["svgPath"] = self.svg_path
        if self.kind == "spotlight":
            out["dimOpacity"] = self.dim_opacity
        if self.kind in ("arrow", "pointer_flight"):
            out["arcHeight"] = self.arc_height
        if self.display_id:
            out["displayId"] = self.display_id
        return out


class ScreenDrawingEngine:
    """Thread-safe authoritative scene graph for live on-screen annotations."""

    def __init__(self, clock_ms: Callable[[], int] = _now_ms) -> None:
        self._lock = threading.Lock()
        self._clock_ms = clock_ms
        self._annotations: list[ScreenDrawingAnnotation] = []
        self._undo_stack: list[list[ScreenDrawingAnnotation]] = []
        self._redo_stack: list[list[ScreenDrawingAnnotation]] = []
        self._interactive = False
        self._generation = 0

    def _clone_state(self) -> list[ScreenDrawingAnnotation]:
        return [
            ScreenDrawingAnnotation(
                id=a.id,
                kind=a.kind,
                created_at=a.created_at,
                expires_at=a.expires_at,
                stroke_width=a.stroke_width,
                opacity=a.opacity,
                dashed=a.dashed,
                pinned=a.pinned,
                label=a.label,
                step=a.step,
                bounds=dict(a.bounds) if a.bounds else None,
                start=dict(a.start) if a.start else None,
                end=dict(a.end) if a.end else None,
                anchor=dict(a.anchor) if a.anchor else None,
                points=[dict(p) for p in a.points],
                svg_path=a.svg_path,
                dim_opacity=a.dim_opacity,
                arc_height=a.arc_height,
                display_id=a.display_id,
            )
            for a in self._annotations
        ]

    def _push_undo(self) -> None:
        self._undo_stack.append(self._clone_state())
        if len(self._undo_stack) > MAX_HISTORY:
            self._undo_stack.pop(0)
        self._redo_stack.clear()

    def _prune_locked(self, now_ms: int) -> bool:
        before = len(self._annotations)
        self._annotations = [
            a for a in self._annotations
            if a.pinned or a.expires_at is None or a.expires_at > now_ms
        ]
        changed = len(self._annotations) != before
        if changed:
            self._generation += 1
        return changed

    def add(self, payload: dict[str, Any]) -> dict[str, Any]:
        kind = str(payload.get("kind") or "").strip().lower()
        if kind not in VALID_KINDS:
            raise ValueError(f"Unsupported drawing primitive kind: {kind!r}")

        now = self._clock_ms()
        pinned = bool(payload.get("pinned", False))
        raw_dur = payload.get("durationMs", DEFAULT_DURATION_MS)
        try:
            dur = int(raw_dur)
        except (TypeError, ValueError):
            dur = DEFAULT_DURATION_MS
        dur = int(_clamp(dur, MIN_DURATION_MS, MAX_DURATION_MS))
        expires_at = None if pinned else now + dur

        stroke_width = float(_clamp(float(payload.get("strokeWidth") or 3.0), 1.0, 24.0))
        opacity = float(_clamp(float(payload.get("opacity", 1.0)), 0.1, 1.0))
        dashed = bool(payload.get("dashed", False))
        label = str(payload["label"]).strip()[:140] if payload.get("label") else None
        step_raw = payload.get("step")
        step = int(step_raw) if isinstance(step_raw, int) and step_raw > 0 else None
        display_id = str(payload["displayId"]).strip() if payload.get("displayId") else None

        ann_id = str(payload.get("id") or f"draw_{uuid.uuid4().hex[:10]}")
        bounds = _clean_bounds(payload.get("bounds"))
        start = _clean_point(payload.get("start"))
        end = _clean_point(payload.get("end"))
        anchor = _clean_point(payload.get("anchor"))
        raw_points = payload.get("points") if isinstance(payload.get("points"), list) else []
        points = [p for p in (_clean_point(item) for item in raw_points[:512]) if p is not None]
        arc_height = float(_clamp(float(payload.get("arcHeight", 48.0)), -240.0, 240.0))
        dim_opacity = float(_clamp(float(payload.get("dimOpacity", 0.45)), 0.05, 0.85))
        svg_path: Optional[str] = None

        if kind == "freehand":
            if len(points) < 2:
                raise ValueError("freehand primitive requires at least 2 valid points")
            svg_path = catmull_rom_to_svg_path(points)
        elif kind in ("arrow", "pointer_flight"):
            if start is None or end is None:
                raise ValueError(f"{kind} primitive requires valid start and end points")
            curved = bool(payload.get("curved", kind == "pointer_flight"))
            if curved:
                svg_path = compute_arc_path(start, end, arc_height=arc_height)
            else:
                svg_path = f"M {start['x']:.1f} {start['y']:.1f} L {end['x']:.1f} {end['y']:.1f}"
        elif kind in ("box", "circle", "spotlight"):
            if bounds is None:
                raise ValueError(f"{kind} primitive requires valid bounds {{x, y, width, height}}")
        elif kind == "callout":
            if anchor is None:
                raise ValueError("callout primitive requires valid anchor {x, y}")
            if not label:
                raise ValueError("callout primitive requires non-empty label text")

        ann = ScreenDrawingAnnotation(
            id=ann_id,
            kind=kind,
            created_at=now,
            expires_at=expires_at,
            stroke_width=stroke_width,
            opacity=opacity,
            dashed=dashed,
            pinned=pinned,
            label=label,
            step=step,
            bounds=bounds,
            start=start,
            end=end,
            anchor=anchor,
            points=points,
            svg_path=svg_path,
            dim_opacity=dim_opacity,
            arc_height=arc_height,
            display_id=display_id,
        )

        with self._lock:
            self._prune_locked(now)
            self._push_undo()
            self._annotations = [a for a in self._annotations if a.id != ann.id]
            self._annotations.append(ann)
            if len(self._annotations) > MAX_ANNOTATIONS:
                self._annotations = self._annotations[-MAX_ANNOTATIONS:]
            self._generation += 1
            return self._snapshot_locked(now)

    def remove(self, annotation_id: str) -> dict[str, Any]:
        now = self._clock_ms()
        with self._lock:
            self._prune_locked(now)
            if any(a.id == annotation_id for a in self._annotations):
                self._push_undo()
                self._annotations = [a for a in self._annotations if a.id != annotation_id]
                self._generation += 1
            return self._snapshot_locked(now)

    def undo(self) -> dict[str, Any]:
        now = self._clock_ms()
        with self._lock:
            if self._undo_stack:
                self._redo_stack.append(self._clone_state())
                self._annotations = self._undo_stack.pop()
                self._generation += 1
            return self._snapshot_locked(now)

    def redo(self) -> dict[str, Any]:
        now = self._clock_ms()
        with self._lock:
            if self._redo_stack:
                self._undo_stack.append(self._clone_state())
                self._annotations = self._redo_stack.pop()
                self._generation += 1
            return self._snapshot_locked(now)

    def clear(self) -> dict[str, Any]:
        now = self._clock_ms()
        with self._lock:
            if self._annotations:
                self._push_undo()
                self._annotations.clear()
                self._generation += 1
            return self._snapshot_locked(now)

    def emergency_stop(self) -> dict[str, Any]:
        """Immediately clear all drawings, history, and exit interactive mode."""
        now = self._clock_ms()
        with self._lock:
            self._annotations.clear()
            self._undo_stack.clear()
            self._redo_stack.clear()
            self._interactive = False
            self._generation += 1
            return self._snapshot_locked(now)

    def set_interactive(self, enabled: bool) -> dict[str, Any]:
        now = self._clock_ms()
        with self._lock:
            self._prune_locked(now)
            if self._interactive != bool(enabled):
                self._interactive = bool(enabled)
                self._generation += 1
            return self._snapshot_locked(now)

    def snapshot(self, now_ms: Optional[int] = None) -> dict[str, Any]:
        now = self._clock_ms() if now_ms is None else now_ms
        with self._lock:
            self._prune_locked(now)
            return self._snapshot_locked(now)

    def _snapshot_locked(self, now_ms: int) -> dict[str, Any]:
        return {
            "visible": bool(self._annotations) or self._interactive,
            "interactive": self._interactive,
            "generation": self._generation,
            "annotations": [a.to_dict() for a in self._annotations],
            "canUndo": len(self._undo_stack) > 0,
            "canRedo": len(self._redo_stack) > 0,
            "updatedAt": now_ms,
        }

    def execute_tool(self, tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
        """Execute an agent-facing screen drawing tool directly against this engine."""
        if tool_name == "screen_draw_stroke":
            return self.add({**args, "kind": "freehand"})
        if tool_name == "screen_draw_arrow":
            return self.add({**args, "kind": "arrow"})
        if tool_name == "screen_draw_box":
            return self.add({**args, "kind": "box"})
        if tool_name == "screen_draw_circle":
            return self.add({**args, "kind": "circle"})
        if tool_name == "screen_draw_callout":
            return self.add({**args, "kind": "callout"})
        if tool_name == "screen_draw_spotlight":
            return self.add({**args, "kind": "spotlight"})
        if tool_name == "screen_draw_pointer_flight":
            return self.add({**args, "kind": "pointer_flight"})
        if tool_name == "screen_draw_undo":
            return self.undo()
        if tool_name == "screen_draw_clear":
            return self.clear()
        raise ValueError(f"Unknown screen drawing tool: {tool_name!r}")


SCREEN_DRAWING_TOOL_SPECS: list[dict[str, Any]] = [
    {
        "name": "screen_draw_stroke",
        "description": "Draw a smooth freehand ink stroke on the user's transparent screen overlay.",
        "parameters": {
            "type": "object",
            "properties": {
                "points": {"type": "array", "items": {"type": "object"}},
                "strokeWidth": {"type": "number"},
                "label": {"type": "string"},
                "durationMs": {"type": "integer"},
            },
            "required": ["points"],
        },
    },
    {
        "name": "screen_draw_arrow",
        "description": "Draw a straight or curved pointer arrow between two screen coordinates.",
        "parameters": {
            "type": "object",
            "properties": {
                "start": {"type": "object"},
                "end": {"type": "object"},
                "curved": {"type": "boolean"},
                "label": {"type": "string"},
                "step": {"type": "integer"},
                "durationMs": {"type": "integer"},
            },
            "required": ["start", "end"],
        },
    },
    {
        "name": "screen_draw_box",
        "description": "Draw a highlight box around a target region on screen.",
        "parameters": {
            "type": "object",
            "properties": {
                "bounds": {"type": "object"},
                "label": {"type": "string"},
                "step": {"type": "integer"},
                "dashed": {"type": "boolean"},
                "durationMs": {"type": "integer"},
            },
            "required": ["bounds"],
        },
    },
    {
        "name": "screen_draw_circle",
        "description": "Draw a circular or elliptical highlight around a target element.",
        "parameters": {
            "type": "object",
            "properties": {
                "bounds": {"type": "object"},
                "label": {"type": "string"},
                "step": {"type": "integer"},
                "durationMs": {"type": "integer"},
            },
            "required": ["bounds"],
        },
    },
    {
        "name": "screen_draw_callout",
        "description": "Place a floating text callout anchored to a screen point.",
        "parameters": {
            "type": "object",
            "properties": {
                "anchor": {"type": "object"},
                "label": {"type": "string"},
                "step": {"type": "integer"},
                "durationMs": {"type": "integer"},
            },
            "required": ["anchor", "label"],
        },
    },
    {
        "name": "screen_draw_spotlight",
        "description": "Dim the surrounding screen while spotlighting a target rectangle.",
        "parameters": {
            "type": "object",
            "properties": {
                "bounds": {"type": "object"},
                "dimOpacity": {"type": "number"},
                "label": {"type": "string"},
                "durationMs": {"type": "integer"},
            },
            "required": ["bounds"],
        },
    },
    {
        "name": "screen_draw_pointer_flight",
        "description": "Animate a Bezier arc flight from a starting point to a target point on screen.",
        "parameters": {
            "type": "object",
            "properties": {
                "start": {"type": "object"},
                "end": {"type": "object"},
                "arcHeight": {"type": "number"},
                "label": {"type": "string"},
                "durationMs": {"type": "integer"},
            },
            "required": ["start", "end"],
        },
    },
    {
        "name": "screen_draw_undo",
        "description": "Undo the most recent screen drawing annotation.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "screen_draw_clear",
        "description": "Clear all active annotations from the transparent screen overlay.",
        "parameters": {"type": "object", "properties": {}},
    },
]
