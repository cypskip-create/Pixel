# Pixel project handoff

Updated: 2026-11-21. This file is the short recovery point for future Codex sessions.

## Repository state

- Existing checkout: `C:\Users\cypri\OneDrive\Desktop\cyps`, branch `main`.
- Committed baseline when this checkpoint began: `e5ee482fd57ca666871e03be2dfc9b2be1b6de18`, equal to `origin/main`; working tree was clean.
- GitHub Windows CI run [44876889424](https://github.com/cypskip-create/Pixel/actions/runs/44876889424) passed for that exact baseline. Local edits described below are not committed and are not covered by that run.
- Do not commit or push for the user.

## Current checkpoint

Core Tools 6.2 remains open. Local edits add a centralized five-tier
consequence policy with dynamic `critical` risk for `browser_type` when
`submit: true`, one-action approval, and rejection of session/Always grants.
They also add the Improvement 6.3 bundled plugin foundation and a public
GitHub metadata plugin. Read `docs/validation/PIXEL_CORE_TOOLS_6_2_CHECKLIST.md`
and `docs/validation/PIXEL_6_3_PLUGIN_FOUNDATION.md` before continuing.

Automated plugin tests use a fixture adapter; they do not establish live GitHub
network success. Chromium-dependent browser tests skip if Playwright Chromium
is missing. Do not represent source tests as real Windows UI acceptance.
Latest full run: 901 passed, 28 skipped, 0 failed (929 total); typecheck and
production build passed. A live unauthenticated GitHub read was blocked before
connection by DNS `ENOTFOUND api.github.com`.

## REA development tool

- `rea-agents@6.10.1` is installed outside the Pixel dependency tree.
- Node `26.13.0`; npm `11.20.0`.
- User approved Codex MCP registration at `C:\Users\cypri\.codex\config.toml`
  and the shared skill at
  `C:\Users\cypri\.agents\skills\reverse-engineer-anything`.
- `codex mcp list` shows `rea` enabled. `rea doctor --client codex --skill
  --json` confirms registration and skill identity. The active Codex process
  may need restart to load tools; do not claim current-session MCP connectivity
  without an actual handshake/tool call.
- Optional Ghidra/IDA/JADX/Kuna/Hopper engines are absent by design; static JS
  analysis does not require them. Previous DeepSeek REA config was left intact.
- Workflow: `docs/research/REA_REFERENCE_WORKFLOW.md`; installation history:
  `docs/debug/REA_INTEGRATION.md`.

## Product direction

Priority order: finish 6.2; qualify Plugin System 6.3 and initial integrations;
then implement Workspace visuals using the user's reference; only then progress
to Pixel Code. The supplied small screenshot depicts a proposed Pix play area;
do not replace Workspace based on a different invented design. Preserve Pixel
branding, current Pix behavior, accessibility and working features.

Plugin architecture notes are in `docs/architecture/PIXEL_PLUGINS.md`. Current
catalog is bundled-only and declarative. No arbitrary plugin code executes.
GitHub public metadata requires per-call approval and no account connection.
OAuth, generic credential vault, external MCP lifecycle, remote marketplace,
project-specific installation and third-party executable isolation are not
implemented.

## Windows and 6.2 acceptance limits

Before reporting acceptance, recheck current source, CI and this machine. The
recorded host previously lacked Playwright Chromium and Python 3.12 x64; local
Electron launch hit port 5199 conflict and exit `0x80000003`; target-machine
UIA, clipboard, installer/portable builds, voice inference/playback, browser
flows, file Recycle Bin, documents and actual Workspace interactions remain
unverified unless new evidence is recorded. Never kill another checkout's
Pixel process. Do not overwrite user data or encrypted secrets.

## First commands

```powershell
git status --short --branch
git log -5 --oneline --decorate
npm run typecheck
npm test
npm run build
codex mcp list
```

Read the README, this handoff, PROGRESS, the 6.2 checklist, Windows acceptance
guide, plugin report and relevant subsystem docs before touching an open item.
