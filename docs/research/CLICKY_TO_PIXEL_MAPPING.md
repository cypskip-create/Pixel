# Original Clicky to Pixel mapping

This maps concepts from the original open-source Clicky repository to Pixel's Windows implementation. It does not compare Pixel to the separate commercial HeyClicky product. Clicky is a macOS SwiftUI/AppKit application; its platform-specific code is not a drop-in Windows implementation.

Sources: [original Clicky repository](https://github.com/farzaa/clicky), [README](https://github.com/farzaa/clicky/blob/main/README.md), and [MIT license](https://github.com/farzaa/clicky/blob/main/LICENSE). No substantial Clicky source was copied into Pixel in this work. If code is adapted later, preserve the license and copyright notice.

| Clicky source area | Concept | Pixel counterpart | Status |
| --- | --- | --- | --- |
| `OverlayWindow.swift` | Transparent companion overlay with carefully controlled window interaction | `src/main/window.ts`, Electron `BrowserWindow`, `src/renderer/App.tsx` | The main bar is anchored to a selected display. A separate transparent cursor window is non-focusable and click-through; its native behavior remains unverified on Windows. |
| `CompanionManager.swift` | Companion state, lifecycle and presentation coordination | `src/shared/companion-state.ts`, `src/shared/companion/stateMachine.ts`, `src/renderer/lib/orbVisuals.ts`, `src/main/window.ts` | The cursor companion uses spring motion and DIP work-area clamping independently of the pinned bar. It pauses while active panels are open; native edge and mixed-DPI behavior still needs acceptance. |
| `CompanionPanelView.swift` | Compact conversation surface | `src/renderer/components/InputBar.tsx`, `ResponseBubble.tsx`, `SettingsPanel.tsx` | Pixel has an independent React conversation and settings UI. |
| `CompanionScreenCaptureUtility.swift` | On-demand capture of displays/windows, excluding the companion where possible | `src/main/screen.ts`, `analyze_screen` executor | Capture/vision path exists but live Windows, multi-monitor and DPI behavior remains unverified. |
| `ElementLocationDetector.swift` | Find interface elements for visual guidance | Browser DOM snapshots; compiled `native/PixelNative/PixelNative.cs`; shared pointing geometry | UIA foreground/window search, exact approved InvokePattern action and matching presence/absence postcondition check are connected. No end-to-end point/highlight workflow is connected; target application coverage remains limited. |
| `BuddyDictationManager.swift` | Local speech input/output lifecycle | `src/main/voice/voice.ts`, voice IPC, companion state | Windows System.Speech process integration exists. Microphone and desktop UI behavior were not validated here. |
| `GlobalPushToTalkShortcutMonitor.swift` | Global press/release voice gesture | `src/shared/companion/pushToTalk.ts`, shortcut and voice controls | State transitions and races are tested. Key-release capture is not a full native hook, so true hold-to-talk parity is not claimed. |
| `WindowPositionManager.swift` | Keep companion positioned and recover from display changes | `src/main/window.ts`, settings, `src/shared/presentationLayout.ts` | Pixel persists the selected display id and top offset, anchors the main bar at top center, and falls back when a monitor is removed. Live mixed-DPI behavior is unverified. |

## Independent design choices

- Keep Electron + React and add Windows-native support only behind typed IPC.
- Preserve on-demand, user-authorized capture; do not introduce continuous transmission.
- Prefer browser DOM and UI Automation identifiers to raw coordinates.
- Keep cursor companionship independent from Guide/Hybrid/Agent authorization modes.
- The independent cursor companion is implemented but remains GUI-unverified until click-through safety, multi-monitor mapping and Windows acceptance tests pass on a normal desktop.
