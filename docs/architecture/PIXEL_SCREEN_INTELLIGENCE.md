# Pixel screen intelligence and visual guidance

Updated: 2026-11-19

## Tools 4.2 interaction status

The agent can read UI Automation elements in a selected external window and
can request state-changing operations using exact selectors. Text entry uses
`ValuePattern` with in-helper read-back; semantic controls use SelectionItem,
Toggle, Scroll, and ExpandCollapse patterns with a state read-back. `InvokePattern`
still uses an explicit expected postcondition, which is checked separately.
The main process revalidates the opaque window reference, title and process
identity around state changes; it never activates a background target. All
state-changing UIA operations remain high-risk and require fresh approval.
Desktop input stays leased until native-helper process termination is
confirmed after timeout or cancellation.

Current verification: `npm run build:native` and native protocol ping passed.
The latest disposable fixture run enumerated the fixture and verified
ValuePattern entry/read-back, InvokePattern, a separate postcondition query,
and TogglePattern state read-back. It restored a completed task from SQLite
with verification evidence. Earlier runs failed at the provider boundary. A
direct rerun exited zero after cleanup confirmed helper/fixture termination;
the npm build-and-test wrapper needs its final rerun. See the tracked result at
[`PIXEL_TOOLS_4_2_UIA_FIXTURE_RESULT.md`](../validation/PIXEL_TOOLS_4_2_UIA_FIXTURE_RESULT.md).
The fixture pass is single-run evidence; repeatability and the Pixel desktop
approval-card flow are still unverified. See
[`PIXEL_SECURITY_MODEL.md`](PIXEL_SECURITY_MODEL.md) and the current Tools 4.2
section of the Windows acceptance procedure.

## Current state

Pixel now uses the existing Windows foreground observer and UI Automation helper as the identity authority for application windows. Window captures no longer choose the first named \`desktopCapturer\` result. The helper captures only the exact opaque window reference, process ID/name and title supplied by the caller, and rechecks that identity and bounds before returning an in-memory PNG.

Display and region captures use Electron display IDs. A region is expressed in global virtual-desktop Electron DIP, including negative monitor coordinates. Pixel locates the one display intersecting the region, maps DIP coordinates to the returned thumbnail's actual pixel dimensions, clips a partial out-of-bounds region to that display, and rejects a region spanning multiple displays. If a monitor is removed, moved, resized or changes scale during capture, the result is discarded and the caller is asked to retry.

Every successful capture returns a fresh capture ID, capture time, target type and identity, DIP bounds, display ID, scale factor, measured pixel scale, actual capture method and \`cached: false\`. Images stay in memory and are not added to history or written to disk by this service.

The agent's \`analyze_screen\` tool can target the actual foreground window, the last external foreground window after native validation, one exact selected window, or a selected display. Capture errors are returned as failures. An empty vision response is a failure, not a successful observation. Screen text is labeled as vision-model interpretation and is not presented as UI Automation verification.

UI Automation remains the precise source for controls exposed in the Windows accessibility tree. \`find_ui_elements\` records the source and observed timestamp. \`screen_highlight_control\` requires a complete, recent window identity and one exact unique accessible name or AutomationId match. A separate transparent overlay can draw a rectangle, circle, arrow, short label or step number around that exact control. The overlay re-queries the control's bounds while active, appears only while its selected application is foreground, and closes when the target becomes stale, the annotation expires, the session locks, or emergency stop is triggered. It is limited to eight annotations and 3–30 seconds per annotation.

## Safety boundaries

- Screen capture is still behind the existing explicit UI action or approved agent tool.
- The native helper keeps HWNDs inside its process. Renderer and model contracts receive opaque target IDs only.
- No window is activated or switched to. A selected background window may be read through UI Automation; the overlay waits until the user makes that exact app foreground.
- The guidance window is focusless, transparent and click-through. It has sandboxed preload settings (\`contextIsolation\`, \`sandbox\`, \`webSecurity\` enabled; \`nodeIntegration\` disabled). It receives only main-process guidance updates; invoke IPC calls from the overlay are rejected by the existing trusted-window check.
- Highlighting is a separate approved, read-only tool. It cannot click, type or alter the target app. Clearing guidance is safe and does not require approval.
- Emergency stop and screen lock clear the overlay.
- Pixel never substitutes a different capture source when a window/display cannot be correlated.

## Coordinate handling

| Boundary | Coordinate space |
| --- | --- |
| Screen region IPC | Global virtual-desktop Electron DIP |
| Electron display bounds | Electron DIP |
| UI Automation element/window rectangles | Physical pixels from the per-monitor-aware C# helper |
| Guidance overlay and renderer SVG | Global Electron DIP, translated to the overlay window's local viewBox |
| Display screenshot/crop | Returned image pixel coordinates, scaled from the actual image size divided by the display's DIP bounds |

Region crops must be contained by, or intersect only, one monitor. Pixel clips a partially off-screen selection to that monitor and reports the actual clipped bounds. A cross-monitor selection fails with an actionable error instead of silently choosing a coordinate origin.

## Known limitations

- \`PrintWindow(PW_RENDERFULLCONTENT)\` is the exact-window capture path. Some GPU-accelerated, protected, elevated, minimized or custom-rendered windows may refuse capture or return incomplete pixels. Pixel fails closed when Windows refuses the capture and does not fall back to another window. An API success cannot prove that every returned pixel reflects the app's complete visual state.
- Electron desktop capture is used for monitor and single-monitor-region images. Multi-monitor stitching is not supported; a cross-display region is rejected.
- Visual analysis is model-inferred and marked as such. The current highlight tool only accepts exact UI Automation controls; it does not turn model-guessed coordinates into verified targets.
- UI Automation only sees controls exposed by the target app. An inaccessible control is reported as not found or ambiguous; Pixel will not draw a guessed highlight.
- A real Pixel GUI startup, overlay click-through, emergency-stop cleanup and Notepad/Windows Settings end-to-end run have not passed in this environment. See \`docs/validation/PIXEL_WINDOWS_ACCEPTANCE.md\`.

## References

- [Electron desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer/)
- [Electron screen](https://www.electronjs.org/docs/latest/api/screen/)
- [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window/)
- [Windows screen capture overview](https://learn.microsoft.com/en-us/windows/apps/develop/media-authoring-processing/screen-capture)
- [UI Automation Control Patterns Overview](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-control-patterns-overview)
