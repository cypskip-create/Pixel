# Experience 5.1 & Tools 5.2 readiness report

## Cursor Buddy IPC regression follow-up (2026-11-19)

Latest GitHub main is [`0a8f39f`](https://github.com/cypskip-create/Pixel/commit/0a8f39f68bf54bc10ac3274521ef348b8289080a). GitHub currently reports no check statuses for that commit. The cursor fix is local and uncommitted; it has not run in Actions or on the user's laptop.

The supplied log shows the cursor renderer calling `settings:get` and
`window:cursorRendererReady`, both rejected as untrusted. The common IPC guard
accepted only Island, Settings and Workspace, so the cursor's ready event never
reached `WindowManager`; after eight seconds the window stayed hidden. The
repair adds a two-channel cursor allow-list, validates the sender window/main
frame/trusted renderer URL, and replaces the full settings read with a
`reducedMotion`-only response. Other IPC remains blocked for Cursor Buddy.
Popup and non-Pixel navigation are blocked on that window.

Current local evidence: TypeScript and production build pass; cursor policy
tests pass **6/6**; full Vitest passes **842**, skips **27**, fails **0** (869
total; 57 test files passed, 1 skipped). The rebuilt sandbox preload smoke
could not reach renderer startup: Electron exited `0x80000003`. The Electron
GUI did not run in this host, so the real companion appearing beside the pointer
still needs laptop acceptance. The laptop test should show `renderer-ready` promptly followed by
`visible`, with no untrusted-renderer errors. The existing Windows acceptance
procedure has the exact steps.

Date: 2026-11-19
Reviewed base SHA: `47d1db1284c7860ec52ddf1f6dd50bf532a2f8b4` (`main`)
Current HEAD: same base SHA; changes are uncommitted.
CI state: latest supplied run `44542308139` is still failed; no new run was
triggered. No commit, push, installer publication or release was made.

The run was Windows CI run 29 on this base SHA. Its typecheck, worker-safety,
sandbox-preload, full-suite and native-helper steps passed; only the unpacked/
portable/NSIS packaging step failed. The artifact-upload step succeeded. The
packaging log reports `RUNTIME_SMOKE_FAILED` / `RuntimeError` but does not name
the failing import or native initialization call. [Run details and logs](https://github.com/cypskip-create/Pixel/actions/runs/44542308139).

## Current checkpoint evidence

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm test -- --reporter=dot` | **839 passed, 27 skipped, 0 failed (866 total; 57 files passed, 1 skipped)** |
| `tests/voice-playback-state.test.tsx` | **1/1 passed**; current playback event wins over a stale initial query |
| `npm run test:voice-worker` | **12/12 passed** on local Python 3.15; not the supported frozen Python 3.12 build |
| `npm run build:native` | Passed; helper compiled and its build-script protocol smoke completed |
| `npm run build` | Passed: main/preload, renderer and icon build |
| `npm run test:preload-sandbox` | **Failed** on repeat; rebuilt Electron sandbox smoke exited `2147483651` (`0x80000003`) before writing a report |
| `npm run build:voice-worker` | **Blocked**; `py -3.12` has no suitable runtime on this host |
| Workspace/Settings/Island screenshots | Not captured; visual acceptance unverified |
| Frozen voice worker / unpacked / portable / NSIS | Not built or verified |
| GitHub Actions after these changes | No run; commit/push is user-owned |

The full suite skipped 17 browser tests because Playwright Chromium is absent,
7 NSIS tests because `makensis` is absent, and 3 opt-in native foreground
integration tests. The renderer does not receive native GUI evidence from the
Vitest run.

The main-process voice service now broadcasts actual TTS playback start/stop
to all active app renderers, and the shared hook exposes this to Workspace Pix
as well as the Island. The live event takes precedence over its initial state
query. The focused regression test and full suite pass, but state timing against
real Windows audio and visible Pix expressions still needs laptop acceptance.

This working tree implements blue interactive charcoal tokens, Workspace
Settings category navigation, Pix in the compact Island and active transcript,
task-outcome expression priority, and an editable in-Workspace Pixel Board.
The board's `.pixelboard`, SVG and PNG exports are user initiated. It is not a
Windows desktop overlay. The requested risk-tier execution policy, per-task
screen-observation authorization, interactive desktop annotation, window
coordinate actions and save/reopen through the main process remain incomplete.

The latest GitHub failure's protocol frame is no longer the reported error;
the supplied run failed later in frozen runtime initialization with
`RUNTIME_SMOKE_FAILED` / `RuntimeError`. Source inspection found that the
worker did not explicitly configure phonemizer to use its bundled eSpeak
library/data. This is a plausible cause, not a verified root cause. The worker
now configures the paths, keeps the Windows DLL directory handle alive, and
reports a sanitized stage. Only a frozen Python 3.12 build and a new Windows
Actions run can verify the repair.

## Historical Experience Polish 5.0 record

The following section documents the prior checkpoint and is retained for
history. Its commit, test totals, CI result and feature statuses are not the
current 5.1 results above.

---

## Experience Polish 5.0 (historical)

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
| Blue switch semantics and visual states | Implemented and covered by component tests; Windows scaling/contrast screenshot review unverified |
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
