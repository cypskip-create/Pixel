# Clicky to Pixel: Architecture Comparison

**Date:** 2026-11-07  
**Pixel branch at initial inspection:** `feature/pixel-companion-experience`, based on `25870a9`  
**Reference:** [farzaa/clicky](https://github.com/farzaa/clicky) at `e71105ce091d71dff4d89cf5d8d37ea1df460961`

## Scope and cautions

This comparison reads the public Clicky repository's implementation, not the private/current HeyClicky product. Clicky is a macOS SwiftUI/AppKit application; its windowing, input monitoring, capture permissions, audio APIs, coordinate conventions, and worker providers cannot be copied as Windows implementation instructions. Pixel remains an independent Electron/TypeScript/React application with DeepSeek. No Clicky source code was copied or adapted in this work. The repository's MIT license is in its root `LICENSE`; any future copied or substantially adapted portion must retain its copyright and license notice.

### Executive assessment

Pixel already has a compact floating Electron window, mode-specific conversation surfaces, persisted placement, a tray/main-process bridge, authorized screenshot capture, browser automation, local Windows speech, and an established agent permission gateway. The clearest incremental opportunity is not to replace these pieces, but to add a visual companion mode and one authoritative visual state model while keeping passive overlay rendering separate from interactive controls. The strongest safety gaps to close before adding desktop autonomy are network-level browser destination validation, durable audit storage, approvals bound to more than a tool name, and propagation of cancellation to every operation that can cause effects.

### Comparison at a glance

| Capability | Clicky design | Pixel today | Priority |
|---|---|---|---|
| Stationary orb | Floating menu-bar panel | Existing floating Electron surfaces | Preserve and polish |
| Cursor companion | Per-display transparent overlay | No cursor-following visual mode | New opt-in feature |
| Screen capture | ScreenCaptureKit, display-aware | Authorized Electron capture | Improve coordinates and validation |
| UI target finding | Screenshot vision coordinates | Existing screen-analysis tools | Prefer UI Automation first |
| Voice | PTT, provider abstraction, live levels | Windows System.Speech path | Improve hotkey and feedback |
| Agent safety | Not the main Clicky reference | Permission and task runtime | Close safety gaps first |

## Feature-by-feature findings

Each entry records the reference source, what it does and how, Pixel's nearest equivalent, the recommended Windows adaptation, the principal risk, and a verification method. “Not present” means not found in the audited implementation, rather than a claim about future or private products.

### 1. Transparent desktop overlays

- **Clicky source:** `leanring-buddy/OverlayWindow.swift`; `leanring-buddy/CompanionResponseOverlay.swift`.
- **What/how:** Creates transparent, non-activating AppKit panels for the cursor visual and response bubble. The cursor surface is placed above ordinary windows and is configured to ignore mouse events; the response panel is also non-activating so it can appear beside the cursor without taking focus.
- **Pixel equivalent:** `src/main/window.ts` manages the existing floating assistant window. It can enable `setIgnoreMouseEvents(..., { forward: true })`, but that applies to the managed window rather than a separate per-monitor cursor overlay.
- **Need and Windows approach:** Needed only for optional Cursor Companion/Guide visualization. Keep the existing 480-pixel interaction surface. Add small transparent, non-focusable overlay windows, with a separate hit-testable control surface; do not use a transparent full-screen window that captures input.
- **Risk / verification:** Electron window flags differ by Windows version and compositor. Verify focus remains with the underlying app and ordinary clicks pass through on the actual Windows desktop, not just in a mocked test.

### 2. Floating companion positioning

- **Clicky source:** `leanring-buddy/WindowPositionManager.swift`; `leanring-buddy/CompanionManager.swift`; `leanring-buddy/CompanionPanelView.swift`.
- **What/how:** A dedicated manager chooses a display and a location for the panel; the central manager owns the companion lifecycle. The panel is a separate surface from the full-screen cursor overlay.
- **Pixel equivalent:** `src/main/window.ts` chooses an initial top-centered position, persists placement through app settings, clamps/reclamps when display metrics or topology change, and keeps the window above normal windows. `src/shared/types.ts` has companion position and monitor settings.
- **Need and Windows approach:** Preserve Pixel's implementation for Stationary mode. Make monitor identity and re-clamping explicit for saved coordinates; use Electron `screen` display bounds and work areas, including negative origins.
- **Risk / verification:** Monitor IDs can change after dock/undock. Test moving a saved orb between monitors, resolution changes, unplugging the saved monitor, and restart persistence.

### 3. Mouse-following animation

- **Clicky source:** `leanring-buddy/OverlayWindow.swift`; `leanring-buddy/CompanionResponseOverlay.swift`.
- **What/how:** A passive cursor buddy follows the pointer with animated movement. The response overlay tracks the cursor and offsets its bubble so the pointer does not cover the text; it adjusts placement near screen edges.
- **Pixel equivalent:** No optional cursor-following orb was found in the audited Pixel renderer or window manager. Pixel's current orb is stationary/draggable.
- **Need and Windows approach:** Add an optional visual mode, separate from Guide/Agent/Hybrid operating modes. Drive animation from pointer updates, interpolate toward the cursor with bounded frame updates, and stop work while idle. Provide a follow-speed setting and reduced-motion/disable-animation behavior.
- **Risk / verification:** High-frequency polling or CSS animation can raise idle CPU/GPU use; mouse tracking may be inaccurate at mixed DPI. Measure idle and moving performance and test crossing monitors at 100%, 125%, 150%, and 200% scaling.

### 4. Multi-monitor overlays

- **Clicky source:** `leanring-buddy/OverlayWindow.swift`; `leanring-buddy/WindowPositionManager.swift`.
- **What/how:** The overlay manager creates one overlay for each attached screen and maps the cursor/target to the display frame that contains it. This lets the animation continue across displays.
- **Pixel equivalent:** `src/main/window.ts` responds to display add/remove/metrics changes and reclamps the existing window. `src/main/screen.ts` enumerates displays and captures a selected display, but the audit did not establish an equivalent per-monitor overlay manager.
- **Need and Windows approach:** Required for Cursor Companion and guidance. Use Electron `screen.getAllDisplays()` and per-display bounds; normalize points to a single physical-pixel/global coordinate model, preserving negative origins and each display's scale factor.
- **Risk / verification:** Electron DIP bounds and screenshot bitmap coordinates are not interchangeable. Test multi-monitor arrangements with a left/above primary display, mixed DPI, monitor removal during movement, and displays with different sizes.

### 5. Click-through behavior

- **Clicky source:** `leanring-buddy/OverlayWindow.swift`; `leanring-buddy/CompanionResponseOverlay.swift`.
- **What/how:** Passive overlay panels ignore mouse events and their SwiftUI visuals disable hit testing. The menu/companion panel remains a distinct interactive surface.
- **Pixel equivalent:** `src/main/window.ts` toggles Electron `setIgnoreMouseEvents` and forwards mouse events. This mechanism is window-wide and needs careful separation if a future overlay contains buttons.
- **Need and Windows approach:** Retain this as a core safety property. Make the passive overlay mouse-transparent at the native window level. Put close/cancel/interactive controls in a small independent window that accepts input only over its actual controls.
- **Risk / verification:** Accidental focus activation or hit-test gaps can block clicks. Test left/right click, drag, wheel, keyboard focus and UI Automation against multiple underlying applications; verify the emergency stop still receives input.

### 6. Companion interaction states

- **Clicky source:** `leanring-buddy/CompanionManager.swift`; `leanring-buddy/OverlayWindow.swift`; `leanring-buddy/CompanionPanelView.swift`.
- **What/how:** `CompanionManager` centralizes voice/session state and owns dictation, the global shortcut monitor, and overlay coordination. The overlay has behavior modes for following, flying to, and pointing at a target. Panel and visual feedback follow that shared state.
- **Pixel equivalent:** `src/shared/types.ts` defines assistant states (`idle`, `listening`, `thinking`, `speaking`, `working`, `success`, `error`, `paused`); `src/renderer/App.tsx` derives visible state. The requested full set (notably `pointing`, `executing`, `waiting for approval`, `stopped`) is not represented as one authoritative companion state.
- **Need and Windows approach:** Extend one typed state model and have agent, voice, approval, pointing and renderer events transition through it. Keep visual mode (Stationary/Cursor) orthogonal to Guide/Agent/Hybrid permissions.
- **Risk / verification:** Separate booleans can report contradictory states, e.g. speaking while idle or pending approval displayed as listening. Add transition tests and verify each state has a visible label/accessible name and safe cancellation path.

### 7. Screen capture

- **Clicky source:** `leanring-buddy/CompanionScreenCaptureUtility.swift`; `leanring-buddy/WindowPositionManager.swift`.
- **What/how:** Captures connected screens with ScreenCaptureKit and returns display-associated image data plus dimensions/frame metadata. The capture helper excludes the app's own windows where possible; permission handling is explicit in the macOS application.
- **Pixel equivalent:** `src/main/screen.ts` requires authorization and supports display, active-window, and region capture. It filters Pixel's own windows when matching sources. Active-window selection is best-effort, and display-source fallback/coordinate conversions need additional mixed-DPI verification.
- **Need and Windows approach:** Reuse Pixel's existing screen-analysis tools; do not create a competing capture pipeline. Add capture intent feedback, explicit display/active-window/region metadata, origin/scale/bitmap dimensions, and cancellation. Keep capture user-authorized and non-continuous by default.
- **Risk / verification:** Capture APIs can return a different source ordering or size than expected; window capture may be unavailable. Verify authorization denial, source matching, overlay exclusion, selected target, physical/logical conversion, negative origins, and no background capture.

### 8. UI element identification

- **Clicky source:** `leanring-buddy/ElementLocationDetector.swift`.
- **What/how:** Sends a screenshot and question to a vision model, requests a location, and maps the image/display dimensions into display-local coordinates. This is visual estimation, not native Windows accessibility enumeration.
- **Pixel equivalent:** Pixel has existing screen-analysis tools and a browser DOM snapshot route (`src/main/screen.ts`, `src/main/agent/browser.ts`). No Windows UI Automation element tree or typed native element result was found in the audited sources.
- **Need and Windows approach:** Add native Windows UI Automation as the first stage for accessible controls, with typed role/name/bounds/window data. Fall back to configured vision only when native data is missing; report ambiguity instead of treating a visual estimate as verified.
- **Risk / verification:** Accessibility providers can return stale, incomplete, or protected-window data. Test buttons, fields, menus, links, app windows, inaccessible/custom-drawn controls, ambiguity and stale elements. Keep UIA access read-only until a separate approved action.

### 9. Visual pointing

- **Clicky source:** `leanring-buddy/OverlayWindow.swift`; `leanring-buddy/ElementLocationDetector.swift`; `leanring-buddy/CompanionManager.swift`.
- **What/how:** A recognized target is mapped to a display and the cursor companion animates toward it, then presents a short label/bubble. The Clicky reference uses response markers such as `[POINT:x,y:label:screenN]` and overlay motion; pointing is visual guidance, not an automatic click.
- **Pixel equivalent:** Pixel can capture/analyze screen content, but a reusable target-to-overlay pointing flow was not identified in the audited code.
- **Need and Windows approach:** Implement a Guide Mode operation that accepts a typed target rectangle and display identity, highlights and labels it, watches for movement/disappearance, and returns the companion to its previous position. Never click as part of pointing.
- **Risk / verification:** Model-generated coordinates can be wrong or stale. Verify target identity/bounds before presenting, abort when it disappears/moves, support immediate cancel, and test multiple monitors. Show candidate locations or ask when ambiguous.

### 10. Push-to-talk

- **Clicky source:** `leanring-buddy/GlobalPushToTalkShortcutMonitor.swift`; `leanring-buddy/BuddyDictationManager.swift`.
- **What/how:** A listen-only global event tap observes key-down/key-up and modifier transitions without consuming ordinary keystrokes; the dictation manager treats shortcut press and release as a bounded recording session.
- **Pixel equivalent:** `src/main/voice/voice.ts` provides Windows speech operations, but the audited files do not show an equivalent configurable global press/release hotkey pipeline.
- **Need and Windows approach:** Add a configurable hotkey in the main process, with explicit press/release and focus-change cleanup. Use a supported Windows/Electron mechanism or a narrowly scoped native helper only if the existing stack cannot reliably capture release.
- **Risk / verification:** OS hotkey permissions, stuck keys, focus loss, and key conflicts can leave recording active. Test key press/release, focus changes, key repeat, cancellation, permission denial and emergency-stop precedence.

### 11. Transcription

- **Clicky source:** `leanring-buddy/BuddyDictationManager.swift`; `leanring-buddy/GlobalPushToTalkShortcutMonitor.swift`; provider implementations listed by `AGENTS.md`.
- **What/how:** Audio is captured through AVAudioEngine and sent to an abstraction over streaming AssemblyAI and alternatives; partial/final transcripts and audio-level values feed the UI. The manager finalizes on shortcut release.
- **Pixel equivalent:** `src/main/voice/voice.ts` uses Windows System.Speech through a child PowerShell process and accepts an `AbortSignal`; it is a local Windows path, not the same streaming provider architecture.
- **Need and Windows approach:** Preserve the working local provider. Add an interface for optional providers and progressive/final transcript events only where configured; no credentials in source and no Python requirement for basic microphone/hotkey orchestration.
- **Risk / verification:** Provider availability, network access, privacy and microphone denial. Test local fallback, partial/final result handling, cancellation, timeout, no microphone, and no capture before user activation.

### 12. Streaming AI responses

- **Clicky source:** `leanring-buddy/CompanionManager.swift`; `worker/src/index.ts`; `AGENTS.md`.
- **What/how:** The manager coordinates a request through a Cloudflare Worker; the worker proxies chat to Anthropic and returns the streamed response body. The public reference keeps provider secrets in worker secrets and uses SSE for streamed chat.
- **Pixel equivalent:** Pixel has its own provider/runtime and DeepSeek integration. Its model/provider choice must remain independent; Clicky's Claude worker is a reference pattern, not a reason to replace Pixel's model.
- **Need and Windows approach:** Reuse Pixel's existing stream orchestration and render incremental text in its compact conversation surface and optional companion bubble. Keep provider adapters capability-aware and keep secrets outside the app package.
- **Risk / verification:** Stream interruption, stale responses, rate limits and prompt injection in returned content. Test a new request interrupting an old stream, renderer teardown, malformed chunks, provider errors and no trust expansion from model output.

### 13. Voice playback

- **Clicky source:** `leanring-buddy/CompanionManager.swift`; `worker/src/index.ts`; `AGENTS.md`.
- **What/how:** Clicky proxies text-to-speech to ElevenLabs and plays returned audio; `CompanionManager` coordinates playback with visual/temporary companion state.
- **Pixel equivalent:** `src/main/voice/voice.ts` invokes local Windows System.Speech and tracks speaking status. This avoids making a paid voice provider mandatory.
- **Need and Windows approach:** Retain local playback and add a provider adapter only if users choose one. Expose mute/cancel and coordinate playback with transient visibility so the companion does not disappear mid-speech.
- **Risk / verification:** Audio device changes, playback cancellation and privacy. Test mute, stop, provider failure, device unavailable, interruption and visibility while speaking.

### 14. Temporary companion visibility

- **Clicky source:** `leanring-buddy/CompanionManager.swift`; `leanring-buddy/OverlayWindow.swift`; `leanring-buddy/CompanionResponseOverlay.swift`; described in `AGENTS.md` as Transient Cursor Mode.
- **What/how:** When the persistent companion is hidden, a hotkey brings the overlay back for recording, response, TTS and optional pointing; it fades after about one second of inactivity after the interaction.
- **Pixel equivalent:** Pixel has `autoCollapse`/surface behavior but no verified transient hotkey-to-show-and-hide lifecycle that protects active tasks, approval waits and speech playback.
- **Need and Windows approach:** Add disabled-by-default transient preference with explicit lifecycle ownership. Fade only after the task, approval, speech and cancellation state are all terminal; do not enable background microphone capture.
- **Risk / verification:** Premature fade can hide an approval or ongoing action. Test hidden→hotkey→listen→respond→speak→hide, approval wait, long-running task, cancellation, timeout and restart persistence.

### 15. Application lifecycle

- **Clicky source:** `leanring-buddy/CompanionManager.swift`; `leanring-buddy/WindowPositionManager.swift`; `AGENTS.md`.
- **What/how:** A menu-bar app delegate starts the central companion manager; that manager owns voice and overlay components and coordinates stop/cancel; the menu panel has its own lifecycle manager.
- **Pixel equivalent:** Pixel uses Electron main-process lifecycle, tray/window manager, IPC handlers and service classes. The app is not the same menu-bar-only architecture and should not be reshaped to match it.
- **Need and Windows approach:** Keep services lazy and avoid new resident runtimes. Centralize creation/disposal for any new companion window and tear down pointer listeners, hotkeys, browser sessions, capture and child processes on stop/quit.
- **Risk / verification:** Duplicate listeners, orphaned windows/processes, or stale IPC after reload. Test startup/shutdown repeatedly, renderer reload, display topology change, emergency stop and process exit.

## Recommended implementation order

1. **Baseline/release gate:** preserve the existing installer branch and uncommitted work; run typecheck/tests/build, build `win-unpacked`, then execute actual Windows GUI/portable/NSIS validation. A successful build is not proof of installation.
2. **Safety before control:** enforce real cancellation across side-effecting executors; persist privacy-safe audit events; scope approvals by tool and operation/context; harden browser networking at the actual destination/redirect boundary.
3. **Companion state and visual mode:** extend the existing assistant state source and add opt-in cursor visuals as a separate passive overlay; preserve stationary mode and existing Guide/Agent/Hybrid modes.
4. **Guidance/voice:** add UI Automation as a read-only target source, use vision fallback with confidence/ambiguity handling, and improve PTT/provider feedback without replacing local speech.
5. **Release evidence:** record real Windows results separately from unit/browser tests, including monitor/DPI behavior and installer upgrades.

## Verification status recorded for this comparison

- Reference: public Clicky repository cloned separately at the commit shown above; requested `leanring-buddy` sources, README, AGENTS, LICENSE and worker entry point were inspected.
- `npm run verify` on 2026-11-07: typecheck passed; Vitest passed **439 tests across 19 files**, including 22 Chromium-backed browser tests; production main/renderer build passed; icon generation passed.
- The Chromium runtime was already available under the repository's `.pw-browsers` cache; no Chromium download was needed for this run.
- Windows GUI, unpacked-app launch, portable executable and NSIS install/upgrade: not verified in this comparison. This environment's documented GUI limitation still applies.
- Installer repair mode: not run. The documented modifying mode must remain backed up and explicitly approved.
- Pixel source edits: none made by producing this comparison. Pre-existing uncommitted file/memory/document edits were preserved. The branch read as `feature/pixel-companion-experience` initially and `main` at the final status check; no branch switch was performed by this work, so inspect the current VS Code/Git branch before continuing.
