# REA reference analysis workflow

Updated: 2026-11-21. This is the reusable workflow used for the Workspace references supplied on 2026-11-21. Findings and limitations: `PIXEL_REFERENCE_RESEARCH_6_3.md`.

## Establish scope

Record the supplied URL, app/build identity, target state, viewport and the
specific flows to inspect. Confirm that the user is authorized to inspect the
target. Do not bypass authentication, access controls or technical protections.
Use a disposable account or public/reference-only view where applicable.

## Collect evidence

1. Choose the REA route from the target: browser targets for an already-open
   authorized page; browser scenario capture for requested interactions; static
   JavaScript/Electron analysis for a supplied local app/ASAR; binary and
   resource inspection for a supplied package; desktop tools only for an
   authorized accessible app.
2. Capture matching viewport screenshots for each state. Inspect page structure,
   headings, landmarks, control labels, navigation, responsive breakpoints,
   focus/hover/disabled/error/empty/loading states and relevant transitions.
3. Record direct observations separately from inference and unknowns. Attach
   evidence IDs, source paths or screenshot dimensions where available.
4. Keep only Pixel-owned analysis notes, screenshots and small metadata needed
   to explain the implementation in a named `docs/research/references/<slug>/`
   directory. Do not commit third-party proprietary source, secrets or
   unlicensed media.

## Map to Pixel before coding

Map reference patterns to Pixel's current `Workspace`, sidebar, composer,
settings and shared UI tokens. Identify duplicated components, state behavior,
responsive constraints, accessibility impact and existing behaviors that must
continue working. Write an implementation specification with observed values,
estimated values, component mapping and open questions.

### Current Workspace source audit

- `src/renderer/Workspace.tsx` owns view state and assembles chat, projects,
  tasks/activity, notes/planning, skills/routines, memory, tools, Plugins,
  Pixel Board and Settings.
- `WorkspaceSidebar.tsx` owns Chats/Library navigation, recent conversation
  search/actions, active project selector and settings entry. Several Library
  views also contain their own back-to-Workspace controls; inspect those flows
  alongside the Settings return-view behavior before changing navigation.
- `SettingsPanel`, `ProductivityPanel`, `MemoryPanel`, `PixelBoard`,
  `WorkspaceConversationHeader`, `WorkspaceComposer`, `WorkspacePixPlay` and
  task activity components are existing functional boundaries to preserve.
- `src/renderer/index.css` contains Workspace layout, shared CSS variables and
  responsive rules. The code also uses utility classes and component-local
  state; avoid introducing another styling system. Audit repeated cards,
  headings, return controls and status badges before consolidating them.
- The reference set now includes the 1170×789 Ostrand dashboard screenshot and
  public Inspora folders and ASCII Sharks pages. See the reference research
  report for measured screenshot geometry and source evidence. The separately
  supplied 962×274 Pix play-area screenshot remains evidence only for that chat
  region, not for complete navigation or responsive behavior.

## Implement and compare

Only implement the direction authorized by the user. Prefer existing Pixel
components and tokens. Capture Pixel and reference at the same viewport and
state, then compare panel geometry, typography, spacing, colors, control sizes,
menus, transitions and interaction behavior. Report measured differences and
correct them in iterations. Do not claim pixel parity without comparable
screenshots and measurements.

## REA environment in this checkout

- Installed separately from Pixel: `rea-agents@6.10.1`, Node `26.13.0`, npm
  `11.20.0`.
- `codex mcp list` shows the setup-owned stdio registration enabled, and the
  installed `rea doctor --client codex --skill --json` reports that registration
  and skill identity aligned. Its `environment_healthy` flag is false because
  optional Hopper, Ghidra, IDA, JADX and Kuna analysis engines are not configured.
- The current Codex tool catalog does not expose REA, and server-scoped MCP
  discovery returns `unknown MCP server`. The doctor's `live_server` value is
  unknown. A Codex restart/reconnect is required to load the tools and a real
  call must confirm connectivity. Public source inspection in this checkpoint
  used direct visual/browser reading. A standalone stdio MCP client later
  verified REA 6.10.1 with a disposable fixture, but the Ostrand, Inspora and
  ASCII Sharks references have not yet been analyzed with REA. Codex still marks
  the registration `Unsupported`, and no REA tool namespace is exposed in this
  session.
- Codex's setup-owned stdio registration points at the exact installed package
  entry under the user's npm cache. `rea doctor --client codex --skill --json`
  reports the Codex registration and skill identity healthy. Restart Codex to
  reload tools; tool connectivity must be confirmed in the active session.
- No Ghidra, IDA, JADX, Kuna or Hopper engine was installed. Static JavaScript
  analysis does not need those native engines.
- Run `codex mcp list` to inspect configured servers. Run
  `node scripts/probe-rea-mcp.mjs --entry <installed-rea.mjs>` to test stdio
  initialization without package-registry access. Use the pinned CLI fallback
  from outside the target directory if MCP tools are unavailable.
- The repo's `docs/debug/REA_INTEGRATION.md` records this machine's current
  installation and verification evidence.
