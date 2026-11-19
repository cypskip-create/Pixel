# Experience Polish 5.0 readiness report

Date: 2026-11-19  
Base commit reviewed: `6ac637e2149872e112b78177b3dcda41c2c8c764`  
Current local `HEAD`: `6ac637e2149872e112b78177b3dcda41c2c8c764`  
Branch: `codex/interaction-engine-3`  
Delivery state: uncommitted working-tree changes; no push or release.

## Implemented in this working tree

- The frozen voice-worker packaging smoke is now a Node JSONL harness. It
  encodes UTF-8 explicitly without BOM, appends a newline, writes the raw
  frame to stdin, keeps stdout/stderr separate, checks response ID, protocol
  and capability shape, bounds execution time, and terminates the child. A
  non-ASCII probe is included. `npm run dist` first builds the unpacked app and
  then runs Windows distribution targets with `--publish never`; releases are
  not automatically published.
- `src/renderer/components/PixMascot.tsx` is the canonical application Pix
  artwork: silver rounded shell, near-black face, mint folded top-right corner,
  mint eyes, small arms and feet. It maps existing assistant states to idle,
  listening, thinking, working, speaking, success, concerned and stopped
  expressions. It appears in the Workspace header, new-conversation state,
  current assistant messages and expanded Island response. Historic assistant
  avatars stay static. The approved P brand mark remains separate.
- `src/renderer/hooks/useCompanionAnimation.ts` schedules bounded idle blinks,
  pauses while hidden, respects Pixel and Windows reduced-motion preferences,
  and cleans up its timers. Assistant state drives the other expression and
  CSS motion. No synthetic agent events are introduced.
- Cursor Buddy remains its own pointer-shaped character and native window;
  Pix never follows the pointer. Settings has separate, explicitly labeled Pix
  and Cursor Buddy previews. The actual Cursor Buddy is no longer gated on
  Island-idle or Workspace-closed state. A typed renderer-ready acknowledgement
  and bounded native-window diagnostics replace sole reliance on
  `ready-to-show`.
- Settings switches are keyboard-operable `role="switch"` controls with
  `aria-checked`, visible focus and clear sage-enabled/charcoal-disabled
  appearances. The application still uses black/charcoal surfaces; Pix uses
  its approved silver/mint character palette.
- New filesystem tools are bounded to home scope: name/extension search,
  metadata, one-level directory creation, exclusive copy and verify-before-
  delete rename. Search caps traversal and skips hidden/sensitive-name/symlink
  entries. Mutations use existing approval and verify postconditions. Clipboard
  tools and broader new app/browser orchestration are not implemented.

## Automated and native evidence

The final local Vitest run used a temporary writable `USERPROFILE`, because
the managed environment denies tests writing to `C:\Users\cypri`. Results:

- `npm run typecheck` — passed.
- `npm test -- --reporter=dot` — **834 passed, 27 skipped, 0 failed (861
  total; 54 test files passed, 1 skipped)**.
- The 27 skips were 17 Playwright browser tests (Chromium unavailable), 7
  NSIS checks (`makensis` unavailable), and 3 opt-in Windows foreground
  integration checks.
- `npm run build` — passed, including TypeScript main/preload, bundled preload,
  Vite renderer and icon generation.
- `npm run test:voice-worker` — Python unit tests **11/11 passed** on local
  Python 3.15. This is not the required Python 3.12 x64 frozen-worker test.
- `npm run build:native` — passed; native helper compiled and protocol ping
  succeeded.
- `npm run test:native-uia-fixture` — passed against a harmless WinForms
  fixture; text entry/read-back, invoke, toggle and postcondition verification
  succeeded. The report is
  `artifacts/windows-acceptance/pixel-native-uia-e2e-2026-11-19T13-45-14-496Z.json`
  and records 3 verification records and 61 durable events. Its test driver
  auto-approves one-time calls, so this is not proof of Pixel's visible
  permission UI.

The first unprefixed local test invocation failed 13 filesystem fixture tests
because its default home directory is outside the writable workspace. No
source change was needed; rerunning with a temporary in-workspace
`USERPROFILE` produced the passing totals above.

`npm run test:preload-sandbox` exited `2147483651` (`0x80000003`) without
smoke output. This is a failed/unavailable check, not a pass. A development
GUI attempt also could not launch a changed-code Pixel window: port 5199 was
already owned by a separate checkout. No existing Pixel window from that
checkout was used as evidence.

## CI packaging failure and current status

The latest reviewed run is
[GitHub Actions run 44522917967](https://github.com/cypskip-create/Pixel/actions/runs/44522917967)
on base SHA `6ac637e2149872e112b78177b3dcda41c2c8c764`. Its Windows job passed
dependency setup, Chromium/NSIS installation, typechecking, worker safety
tests, Electron sandbox preload smoke, full tests and native helper compilation.
Only **Build unpacked app, portable executable and NSIS installer** failed.
PyInstaller built the Python 3.12 worker, but the packaging smoke got
`BAD_JSON: Expecting value: line 1 column 1 (char 0)` followed by stdin closed.
The demonstrated failure is at the request framing/stdin boundary: the frozen
worker had no decodable JSON document at byte zero. The old smoke sent a string
through PowerShell's redirected-process stdin path; the new harness bypasses
PowerShell text encoding and writes a captured UTF-8 byte frame. The original
run did not preserve a raw stdin capture, so it does not establish whether its
exact input was empty, BOM-prefixed, or otherwise transformed. The new harness
will report frame bytes on any repeat failure.

There is **no new Actions run** for these uncommitted edits. Python 3.12 x64 is
not installed locally, `makensis` is absent, and the frozen worker smoke has
not been run on the built executable. CI is **not green or release-ready**.
The existing `.github/workflows/windows-ci.yml` already runs the Windows type
check, Python worker tests, sandbox preload smoke, complete test suite, native
helper compilation and unpacked/portable/NSIS packaging; its `always()` upload
step retains logs, JUnit output, reports and distributions for 14 days. It
does not publish GitHub releases.
The GitHub run log contains no GPU-specific failure evidence; separate earlier
local notes mention Electron/Chromium child-process or Crashpad startup
failures, but no target-laptop GPU/driver capture establishes their root cause.
Keep `--disable-gpu` as a development diagnostic and test `npm run dev:gpu`
and the packaged default-GPU app separately on Windows.

Chromium installation was attempted with `PLAYWRIGHT_BROWSERS_PATH=0`, but
failed at `cdn.playwright.dev` with DNS `ENOTFOUND`. No browser-test pass is
claimed for this machine. No unpacked app, portable executable or NSIS
installer was built in this turn.

## Visual and capability status

| Area | Status |
| --- | --- |
| Pix canonical geometry and application placements | Implemented; component tests/build pass; visual screenshot comparison is unverified |
| Pix assistant-state mapping and idle scheduler | Implemented and unit-tested; real timing/performance/hidden-window visual checks unverified |
| Cursor Buddy separation and ready acknowledgement | Implemented and unit-tested; native appearance, focus, click-through, display edges and lifecycle unverified |
| Sage switch semantics and visual states | Implemented and covered by component tests; Windows scaling/contrast screenshot review unverified |
| Bounded file search/metadata/create/copy/rename | Implemented with permission checks and postcondition tests |
| Expanded clipboard workflows | Missing |
| New broad app-control or multi-step daily orchestration | Missing in this checkpoint; existing allowlisted launch/browser/UIA/document tools remain |
| CI protocol smoke repair | Implemented; built Python 3.12 worker and GitHub rerun still unverified |
| Packaged GPU/renderer child-process cause | Unverified; separate from the JSONL failure and Pix implementation |
| Screenshots at 1366×768, 1920×1080, 100% and 125% | Not captured |
| Electron sandbox smoke on this current tree | Failed before report output; not passed |
| DeepSeek, permissions and emergency stop through live changed-code UI | Not re-tested here |

## Laptop-side validation

From a fresh PowerShell session at the repository root, with the harmless
test fixture available:

```powershell
npm ci
npx playwright install chromium
npm run typecheck
npm test -- --reporter=dot
npm run test:voice-worker
npm run build
npm run build:native
npm run test:preload-sandbox
npm run test:native-uia-fixture
npm run build:voice-worker
npm run pack
npm run dist
```

If local fixture tests cannot write to the Windows profile, use a temporary
directory and restore the environment afterward:

```powershell
$oldUserProfile = $env:USERPROFILE
$env:USERPROFILE = Join-Path $env:TEMP 'pixel-test-profile'
New-Item -ItemType Directory -Force $env:USERPROFILE | Out-Null
try { npm test -- --reporter=dot } finally { $env:USERPROFILE = $oldUserProfile }
```

Then verify the installed/unpacked build and collect logs/screenshots:

1. Launch Pixel from source and from `release\win-unpacked\Pixel.exe`.
2. Confirm the sandboxed renderer has `window.cyps` and `window.cypsShell`,
   settings loads, and the normal conversation, permissions and emergency stop
   behave.
3. In Workspace, capture Pix at 140, 96, 64, 40, 32 and message-avatar sizes;
   inspect idle blink, listening, thinking, working, speaking, success, error,
   reduced motion and hidden-window pause. Confirm Cursor Buddy remains a
   separate pointer-following character.
4. Toggle Cursor Buddy on/off from Settings; preview it, close Settings, then
   test visible follower, click-through, no keyboard focus, screen edges,
   Workspace, Island expansion, lock/resume and another monitor.
5. Capture Workspace, Settings, Island and permission views at 1366×768 and
   1920×1080 and 100%/125% scaling where available. Confirm charcoal remains
   dominant, Pix matches the reference and switches are distinct.
6. Run `npm run dev:gpu` separately and preserve both normal diagnostic and
   GPU-enabled logs. Capture packaged app startup with the existing
   `scripts/capture-startup.ps1` procedure. Do not attribute either outcome to
   the preload or CI JSON protocol fix without direct evidence.
7. Exercise safe file fixtures and the actual Pixel approval UI. Verify file
   state independently; test denial, cancellation, emergency stop and restart
   recovery. Do not use private files or real consequential browser actions.

Save logs and images under `artifacts/windows-acceptance/`. Do not include API
keys, private titles, transcript text or sensitive file names. Compare the
result to the attached approved Pix concept before describing visual fidelity
as accepted.

## Current Git identity

`git rev-parse HEAD` remains
`6ac637e2149872e112b78177b3dcda41c2c8c764`. The working tree contains the
implementation and documentation changes listed by `git status`; no commit,
push or release has been created.
