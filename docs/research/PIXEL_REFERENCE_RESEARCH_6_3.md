# Pixel Workspace reference research — 6.3

Updated: 2026-11-22. This report separates visible facts, implementation
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
chat history is not duplicated elsewhere. The attached JPEG was raster-sampled
at representative points: outer background (60,104) `#0C0B09`, raised card
(800,450) `#191410`, and orange chart bar (845,536) `#F18A4F`. The rounded CSS
tokens adapt those observations; original source design tokens remain unknown.
Ostrand’s name, labels, data, photography and workflows are not reused.

**Unknown:** original design tokens, responsive breakpoints, hover/animation
rules, actual typography files and behavior outside this screenshot cannot be
established from the static image.

## Target B — Inspora Folders UI

**Evidence:** REA `capture_browser_scenario` on
`https://www.inspora.design/posts/folders-ui` succeeded using Chromium 157,
screenshot and accessibility capture (parent Evidence
`ev_8e576b1151534912f3cbd9570ca79a36254c79823a66b051a50975e94aa833ed`).
The screenshot SHA-256 is
`ce7633506a979a520f2e6334c5afe9c00b5198794307411c22e7cc37bae1801b`; the
accessibility snapshot SHA-256 is
`23db0ee871fa147d6f1e6a765dcb4338dc53716c67c3bf4801f87e5695549c76`. An
initial DOM+accessibility capture timed out before initial state; reducing the
capture to screenshot+accessibility completed. This is the accessible article
and its embedded reference image, not the original product runtime.

**Observed:** the article screenshot shows a narrow product rail and nested
knowledge tree, a breadcrumb, three dimensional folder cards, and a dense file
table. Folder depth comes from offset front/back shapes and subtle shadows;
labels and file metadata are compact. The embedded reference uses cool glossy
surfaces. Pixel explicitly excludes glass-like materials and adapts depth using
opaque matte fills, a fine warm border and a restrained shadow. The article's
“View Original” X link returned HTTP 403; no sign-in or access control was
bypassed.

**Unknown:** the browser text extraction does not preserve all interactive
hover states, exact responsive transitions, or full source geometry. Those
details remain unverified. Pixel’s current project browser consumes actual
`ProjectView` records; it does not invent sample projects. The existing Library
continues to use its actual notes/tasks and file flows rather than mock rows.

## Target C — ASCII Sharks

**Evidence:** REA captured
`https://www.inspora.design/posts/shark-ascii-animation` (parent Evidence
`ev_c25a18c3681c605efc2abdd405d5ecde37e1fa35f610fee6ca02134ab15d09ac`). Its
screenshot SHA-256 is
`339c4cacb0f60be7eaf41a2dd5a918748206b950ef834743902f32715e70dd13`; the
accessibility snapshot SHA-256 is
`28ddef39016c11fb47b2e60db2df710057c22d887c123aacc1ef9f9253d89710`. The
gallery screenshot shows gray ASCII sharks around a centered prompt on a pale
dotted page; it is a static article/gallery capture, not a runtime animation
test. REA also captured the public upstream repo README and accessibility tree
(parent Evidence `ev_68f0a9ff2530cefc56254fd42cd1d115fd0ef244396cb41721f228c347d5f4b1`,
accessibility SHA-256
`f8bac4a2f365bdf2953d75fea7168827614dd43c5ccbe8b41f5b7570d6b3d427`). Public
upstream README, package metadata, license, `src/engine.ts`,
`src/renderer.ts`, and `src/world.ts` were inspected at the
[repository](https://github.com/stackedlol/ascii-sharks) and its
[engine](https://raw.githubusercontent.com/stackedlol/ascii-sharks/main/src/engine.ts),
[renderer](https://raw.githubusercontent.com/stackedlol/ascii-sharks/main/src/renderer.ts),
[world](https://raw.githubusercontent.com/stackedlol/ascii-sharks/main/src/world.ts),
and [MIT license](https://github.com/stackedlol/ascii-sharks/blob/main/LICENSE).
The repository declares MIT. `OceanEngine` composes `World`, `AsciiRenderer`, and
optional `Life`; the engine uses a fixed 1/60 second simulation step, a capped
four-step accumulator and `requestAnimationFrame`. It observes canvas size and
intersection visibility, handles reduced motion, bounds device pixel ratio to
2, and disposes its frame, observers and event listeners in `destroy()`.
Pointer listeners are optional. `still` and reduced-motion preferences render
a settled single frame. Renderer output is a character cell grid on canvas;
stage and theme options select detail and palette. The renderer source contains
configurable palettes, glyph density and cell shading.

**Adaptation:** Pixel adds only three small decorative `·+·` glyphs beside
the existing Pix composer presence. In `WorkspacePixPlay.tsx`, they render only
in idle state when page visibility is visible, activity is idle, and reduced
motion is not requested. The CSS animation is an 8-second opacity/1–2 px drift,
pointer-inert and `aria-hidden`; it is hidden in all other states. Existing Pix
remains the recognizable character. Focused tests cover hidden and
reduced-motion behavior. No canvas, imported shark shapes or runtime dependency
was added.

**Unknown:** no CPU/GPU performance measurement was made for the Pixel effect
or upstream runtime. REA captured the public repo page but did not execute its
demo. Pixel’s actual animation appearance and performance still need a real
application capture.

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
existing local project records. The new Library route groups the active
project's already-indexed documents into real folder cards and file rows;
search, type filtering, refresh, folder selection and bounded preview read from
the SQLite index. The type filter constrains both folder cards and file rows.
Its narrow IPC exposes display metadata rather than absolute source
paths, and preview reads recheck active-project scope and source freshness.
The preview also offers an explicit “Open original” action: main-process logic
checks active-project scope, source freshness and a reviewed document/text
extension allowlist (excluding source code and macro-enabled spreadsheets)
before calling the OS, and does not return the path to React. A keyboard
accessible folder menu opens the actual indexed directory through the main
process, scoped to the active project's folder IDs and rejecting symlinked or
missing directories. An empty Library explains how user-approved indexing
populates it. A
reduced-motion/visibility-aware decorative glyph accent sits beside Pix.
Shared focus styles and responsive sidebar/library rules are in
`src/renderer/workspace-design-system.css`.

**Visual limitation:** after the user accepted native UI access, the running
Pixel window was captured at `http://localhost:5199`. Its process path was
`C:\dev\Pixel\node_modules\electron\dist\electron.exe`, so it belongs to a
separate checkout and was left untouched. Its accessibility tree showed the
older Chats/Library navigation, recent conversations, Agent mode and the chat
composer. It does not run the source changes in this repository. A later
current-session check found two windows from that same separate checkout, but
`getApp` returned `Accessibility state unavailable` for both; they were left
untouched. A diagnostic launch attempt from this checkout exited without
opening a targetable window; the cause was not established. Therefore no current-tree before/after
comparison, visual parity claim, or UI acceptance is made. Required screenshots
at standard, narrow and minimum window sizes remain open.

## REA evidence status

REA `6.10.1` remains configured as a Codex stdio server. `codex mcp list` has
historically labeled it enabled / Unsupported, but this current Codex session
now exposes callable REA tools. A safe `analyze_javascript_application` call
on a disposable two-file JavaScript fixture succeeded (parent Evidence
`ev_62f449ddb32f13112e2960adbf6aea9c7ce9e4e72285e473532bdd1e07a8e234`,
result `ev_80b54c96763dacd6de4d766149c0fe3384760b86909060c67d4e59f92ba64c60`);
the fixture was removed and was not executed. The two Inspora browser captures
above and the ASCII Sharks repository capture also succeeded. An initial
Inspora Folders capture timed out; the reduced screenshot+accessibility capture
completed. The packaged Pixel `app.asar` analysis timed out without Evidence.
The Ostrand screenshot was visually inspected as a user attachment, not passed
through REA. No current Pixel source or live desktop was analyzed by REA. REA
results are evidence of accessible page/source structure, not proof of runtime
behavior, and screenshots remain in REA evidence storage rather than this
repository.

## Workspace issues still to review

- Real screenshot comparison and keyboard/screen-reader inspection.
- Sidebar density and collapse behavior at actual 1366×768, narrow-window and
  minimum supported dimensions.
- Whether the conversations pane should collapse automatically at narrow
  desktop width without hiding history controls.
- Actual screenshot and interaction review of the new Library at standard,
  narrow and minimum supported window sizes; tests cover its data flow but do
  not replace desktop visual acceptance.
- Plugin Manager cards/details/permissions in the actual running application.
- Pixel Board and secondary panels at minimum supported dimensions.
