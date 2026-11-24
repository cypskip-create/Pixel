# HeyClicky Screen Drawing & Overlay Technical Reference (Phase 9)

**Extracted via:** REA MCP (`inspect_managed_members` + `inspect_analysis_view`) on shipped Windows HeyClicky v1.1.5.0 assemblies (`HeyClicky.Drawing.dll`, `HeyClicky.Drawing3D.dll`, `HeyClicky.Platform.dll`) plus macOS Clicky Swift reference (`OverlayWindow.swift`, `ElementLocationDetector.swift`).

**Target Architecture:** Python-first (`python/pixel_agent/screen_drawing.py`) for scene state, coordinate normalization, curve smoothing, TTL/animation timing, undo/redo, and agent tools; Electron + React (`src/main/window.ts`, `src/renderer/components/VisualGuidanceOverlay.tsx`) strictly for transparent click-through windowing, capture exclusion, IPC, and SVG/Canvas rendering.

---

## 1. Extracted HeyClicky Windows Architecture

### 1.1 Overlay Windowing & Win32 Interop (`HeyClicky.Drawing.Overlay.OverlayWindow`, `Interop.NativeMethods`)
- **Transparent Click-Through Window:** Created via `CreateWindowExW` with `WS_EX_LAYERED`, `WS_EX_TRANSPARENT`, `WS_EX_TOPMOST`, `WS_EX_NOACTIVATE`, and `SetLayeredWindowAttributes`.
- **Self-Capture Exclusion (`SetWindowDisplayAffinity`):** `OverlayWindow.SetHiddenFromOwnCaptureAsync` / `ApplyCapturePolicy` sets `WDA_EXCLUDEFROMCAPTURE` when `ShowInScreenRecordings == false` so AI screenshots never capture the agent's own annotations.
  - **Pixel Mapping:** `BrowserWindow.setContentProtection(true)` on Electron Windows sets `WDA_EXCLUDEFROMCAPTURE` natively without extra Win32 P/Invoke!
- **Interactive vs. Passive Click-Through Toggle:** `GetWindowLongW` / `SetWindowLongW` toggles `WS_EX_TRANSPARENT` when interactive drawing or overlay action buttons are active, and restores click-through immediately when idle or dismissed.
  - **Pixel Mapping:** `win.setIgnoreMouseEvents(true, { forward: true })` in passive/AI mode; `win.setIgnoreMouseEvents(false)` only when the user explicitly toggles interactive screen-drawing mode, with `Escape` / Emergency Stop immediately clearing and restoring click-through.
- **Per-Monitor DPI & Bounds:** Tracks `BoundsPx` and `RasterizationScale` per display; never guesses mixed-DPI coordinates across monitors.

### 1.2 Scene Graph, Primitives & Animation (`HeyClicky.Drawing.ScreenDrawingCanvas`, `Painter.*`, `Drawing3D.*`)
- **Canvas & Events (`ScreenDrawingCanvas`):** Manages live strokes (`PenStrokes`), `Cleared`, `UserActedOnScreen`, `CaptionChanged`, and `ActionRequested`.
- **Scene Graph (`ScreenPainter`, `Node`, `NodeKind`, `PenStroke`, `PenMask`, `RectShape`, `MarqueeBox`):**
  - Freehand ink strokes (`PenStroke` + `CatmullRomCurve` / `PathFlattener` smoothing).
  - Geometric highlights (`RectShape`, `MarqueeBox`, circles/ellipses, curved/straight arrows with arrowheads).
  - Spotlight / dimming mask (`PenMask`) that dims surrounding desktop area while leaving target regions clear.
  - Anchored callout captions (`LiveCaption`, `DrawingCaption`) with smart clamping inside viewport bounds and smooth fade/rise entrance.
  - Timed animation beats (`AnimationSpec`, `RunningAnimation`, `MarkTiming` with `BeginTime`, `EndTime`, and spring easing via `ScreenPenMath.SpringProgress`).

### 1.3 Coordinate Normalization & Pointer Flight (Clicky `ElementLocationDetector.swift` + `OverlayWindow.swift`)
- **Aspect-Ratio-Matched Computer Use Scaling:** Vision models operate on normalized screenshot resolutions (`1024×768` for 4:3, `1280×800` for 16:10, `1366×768` for 16:9). Coordinates returned by vision/agent tools are scaled back to logical display DIPs and clamped within `[display.x, display.x + display.width]` × `[display.y, display.y + display.height]`.
- **Pointer Arc Flight:** Animated pointer/arrow flights trace a quadratic Bezier arc from origin `(startX, startY)` to target `(endX, endY)` with an elevated midpoint control point and subtle scale swoop.

---

## 2. Pixel Python-First Implementation Design

| Layer | File(s) | Responsibility |
| --- | --- | --- |
| **Python Drawing Engine (Authoritative)** | `python/pixel_agent/screen_drawing.py` | Scene graph (`ScreenDrawingEngine`), primitives (`freehand`, `arrow`, `box`, `circle`, `callout`, `spotlight`, `pointer_flight`), Catmull-Rom SVG path smoothing, aspect-ratio/DPI coordinate mapping (`normalize_to_display`), TTL auto-expiration, undo/redo stacks, Emergency Stop clear, and agent tool schemas/executors. |
| **Python JSON-RPC Bridge** | `python/pixel_agent/protocol.py` | Exposes `drawing.add`, `drawing.remove`, `drawing.undo`, `drawing.redo`, `drawing.clear`, `drawing.snapshot`, `drawing.map_coord`, and `drawing.set_interactive`. |
| **Shared IPC & Types** | `src/shared/channels.ts`, `src/shared/types.ts`, `src/preload/index.ts` | Canonical `ScreenDrawingAnnotation`, `ScreenDrawingSceneSnapshot`, and `drawing:*` IPC channels (`drawing:add`, `drawing:remove`, `drawing:undo`, `drawing:redo`, `drawing:clear`, `drawing:snapshot`, `drawing:setInteractive`, `drawing:update`). |
| **Electron Overlay Window** | `src/main/window.ts`, `src/main/ipc.ts`, `src/main/services/pythonAgentBridge.ts` | Extends Pixel's existing transparent `guidanceWindow` (`?window=guidance`) to render both legacy UIA `VisualGuidanceSnapshot` and Python-driven `ScreenDrawingSceneSnapshot` with `setContentProtection(true)` (capture exclusion), full-display bounds, passive click-through by default, and optional interactive drawing toggle. |
| **React SVG Overlay Renderer** | `src/renderer/components/VisualGuidanceOverlay.tsx`, `src/renderer/components/ScreenDrawingOverlay.tsx` | Crisp SVG rendering for all 7 primitives (`freehand`, `arrow`, `box`, `circle`, `callout`, `spotlight`, `pointer_flight`) using Pixel's blue accent tokens (`--color-accent`), plus a compact floating interactive drawing toolbar when interactive mode is active. |

---

## 3. Safety & UX Invariants
1. **Fail-Safe Click-Through:** Overlay starts and returns to `setIgnoreMouseEvents(true, { forward: true })` and `setFocusable(false)` whenever not explicitly in interactive draw mode.
2. **Self-Capture Exclusion:** Overlay sets `setContentProtection(true)` so Pixel's screen capture never feeds its own annotations back into the vision model.
3. **Emergency Stop & Session Lock:** Emergency Stop (`Escape` / kill switch) and OS session lock immediately clear the Python drawing engine and hide/close the overlay.
4. **TTL Auto-Cleanup:** Every annotation carries a bounded TTL (`durationMs`, default 10s, max 120s unless pinned) so stale drawings never linger on screen.
5. **Single Overlay Window:** Extends Pixel's existing `guidanceWindow` instead of spawning duplicate full-screen Electron windows.
