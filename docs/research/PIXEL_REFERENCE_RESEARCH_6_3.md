# Pixel Workspace reference research — 6.3

Updated: 2026-11-21. This report separates visible facts, implementation
choices and unavailable evidence. No third-party source code or visual assets
were copied into Pixel.

## Target A — Ostrand dashboard screenshot

**Evidence:** the user-supplied `Photo 1.jpg`, viewed directly at 1170×789. The
image contains a 49 px toolbar and a three-column content area: left
navigation about 188 px, a results/list column about 302 px, and a main detail
column about 586 px. Visible surface colors are close to black with subdued
warm dividers and orange imagery/accent states. Dense labels, metadata and
rounded opaque cards create hierarchy without large empty regions.

**Observed:** the left rail groups product destinations and a current
production selector; the middle panel has a list heading, filter chips and
rows with thumbnails, title, compact metadata and a right-aligned score. The
main panel combines a large image, overlay metadata and a chart/detail cards.
The top bar aligns project/context, search, date/status and one primary action.

**Adaptation:** Pixel uses a 190 px section rail and a 258 px conversation
history pane at standard desktop widths, with the chat as the primary canvas.
Project browsing uses the second-column/list pattern only on its own screen;
chat history is not duplicated elsewhere. Colors in `index.css` are estimated
visual tokens, not sampled source values. Ostrand’s name, labels, data,
photography and workflows are not reused.

**Unknown:** original design tokens, responsive breakpoints, hover/animation
rules, actual typography files and behavior outside this screenshot cannot be
established from the static image.

## Target B — Inspora Folders UI

**Evidence:** the publicly accessible article at
https://www.inspora.design/posts/folders-ui was inspected through the browser
reader. It describes grouped folder browsing with large folder-card artwork,
navigation hierarchy and associated content listings.

**Observed:** folder forms use a layered front/back silhouette; content is
grouped under folder context, and a file list provides a denser browsing mode.
The article presents glass-like materials. Pixel explicitly excludes those
materials and uses opaque matte fills, a fine warm border and a small shadow.

**Unknown:** the browser text extraction does not preserve all interactive
hover states, exact responsive transitions, or full source geometry. Those
details remain unverified. Pixel’s current project browser consumes actual
`ProjectView` records; it does not invent sample projects. The existing Library
continues to use its actual notes/tasks and file flows rather than mock rows.

## Target C — ASCII Sharks

**Evidence:** public upstream README, package metadata, license, `src/engine.ts`
and `src/renderer.ts` were inspected at
https://github.com/stackedlol/ascii-sharks and the raw `main` sources. The
repository declares MIT. `OceanEngine` composes `World`, `AsciiRenderer`, and
optional `Life`; the engine uses a fixed 1/60 second simulation step, a capped
four-step accumulator and `requestAnimationFrame`. It observes canvas size and
intersection visibility, handles reduced motion, bounds device pixel ratio to
2, and disposes its frame, observers and event listeners in `destroy()`.
Pointer listeners are optional. `still` and reduced-motion preferences render
a settled single frame. Renderer output is a character cell grid on canvas;
stage and theme options select detail and palette. The renderer source contains
configurable palettes, glyph density and cell shading.

**Adaptation:** Pixel adds only three small decorative `·+·` glyphs beside
the existing Pix composer presence. It does not import the engine, canvas,
shark shapes, third-party colors, or an additional runtime dependency. This
CSS-only effect is hidden during non-idle states, while the window is hidden,
and under either reduced-motion preference; it is pointer-inert and aria
hidden. Existing Pix remains the recognizable character.

**Unknown:** no source-level performance benchmark or desktop GPU/CPU
measurement was possible for the upstream demo or Pixel. The source repository
could not be acquired with shell tooling because DNS lookup for
`codeload.github.com` failed in this environment; source facts above were
verified with the public raw source reader, not a local REA analysis. Pixel’s
actual animation appearance/performance still needs a real application
capture.

## Target D — Pixel Workspace

**Source inspection:** `Workspace.tsx`, `WorkspaceSidebar.tsx`,
`WorkspaceComposer.tsx`, `WorkspacePixPlay.tsx`, `WorkspaceTaskActivity.tsx`,
`PixelBoard.tsx`, `ProductivityPanel.tsx`, plugin components and renderer CSS
were inspected. The application already had working route/view state for chat,
projects, notes/planning, memory, tools, plugins, settings and Board; recent chat
search/rename/delete; task details; mode selection; and the Pix idle behavior
scheduler. Existing project switching is through the local memory bridge.

**Changes in this checkpoint:** a warm matte semantic palette, a two-pane
sidebar (section rail plus existing chat history), compact dense navigation,
centered chat/composer sizing, and a searchable project grid/list over the
existing local project records. A reduced-motion/visibility-aware decorative
glyph accent sits beside Pix. Shared focus styles and responsive sidebar
breakpoints are in `src/renderer/workspace-design-system.css`.

**Visual limitation:** after the user accepted native UI access, the running
Pixel window was captured at `http://localhost:5199`. Its process path was
`C:\dev\Pixel\node_modules\electron\dist\electron.exe`, so it belongs to a
separate checkout and was left untouched. Its accessibility tree showed the
older Chats/Library navigation, recent conversations, Agent mode and the chat
composer. It does not run the source changes in this repository. A diagnostic
launch attempt from this checkout exited without opening a targetable window;
the cause was not established. Therefore no current-tree before/after
comparison, visual parity claim, or UI acceptance is made. Required screenshots
at standard, narrow and minimum window sizes remain open.

## REA evidence status

REA `6.10.1` is configured as a Codex stdio server. `codex mcp list` shows it
enabled with status `Unsupported`; this current agent tool catalog has no REA
namespace and server-scoped resource discovery reports `unknown MCP server`.
A standalone stdio MCP fallback negotiated protocol `2024-11-05`, listed 263
tools, and successfully called `analyze_javascript_application` on a disposable
Electron fixture (Evidence `ev_8dab99644a9753790a6514321e92cb0d50d076cc4439cc51005c98dbc163759f`).
The packaged Pixel `app.asar` analysis timed out without Evidence. The reference
inspection of the screenshot and public Inspora/ASCII sources used direct
visual/browser reading, not REA. REA's attempted Inspora capture could not start
Chrome in the host sandbox; crashpad exited and the provider reported incomplete
cleanup with no retained resources. The reported browser PID was absent on a
follow-up check. No sandbox override was applied, and no page Evidence was
produced. Therefore these references have not yet been
reverse-engineered through REA, and its tools are still unavailable as native
calls in this Codex session. Restart/reconnect Codex and repeat the reference
analyses through the exposed tool surface.

## Workspace issues still to review

- Real screenshot comparison and keyboard/screen-reader inspection.
- Sidebar density and collapse behavior at actual 1366×768, narrow-window and
  minimum supported dimensions.
- Whether the conversations pane should collapse automatically at narrow
  desktop width without hiding history controls.
- Library’s real file/folder navigation and file metadata/filter needs; the
  reference alone is insufficient to add speculative file operations.
- Plugin Manager cards/details/permissions in the actual running application.
- Pixel Board and secondary panels at minimum supported dimensions.
