# Pixel — Stage 4B & Stage 5B Completion Architecture

**Repository:** `https://github.com/cypskip-create/Pixel`  
**Base commit:** `9101295cef196af5fd5392e255bb92ff68419db7`  
**Completion commit:** `5964993` (plus `fba1eeb` for `netGuard` CI regression)  
**Hermes reference checkout (external):** `C:\dev\pixel-research\hermes-agent` (`352b249f67fb6a4a7d7904acaca9dd410db229e0`)

---

## 1. Windows CI & Packaging Reliability

### 1.1 `tests/safety.test.ts` Regression (`fba1eeb`)
- `src/main/agent/netGuard.ts` now preserves the exact wording expected by the safety test suite (`private-network address` and `unconditionally blocked`) while retaining the Stage 5 security floor ordering:
  1. Unconditional cloud IMDS / link-local block (`169.254.169.254`, `fd00:ec2::254`, `metadata.google.internal`, etc.)
  2. Credentialed URL rejection (`user:pass@host`)
  3. Non-HTTP(S) scheme blocking
  4. Domain deny-list / allow-list enforcement
  5. Private/loopback network guard (`allowLocalhost` toggleable)
- Verified green on GitHub Actions Windows CI run `45335934223` (`completed / success`).

### 1.2 SourceForge NSIS 3.11 Fallback Fix (`5964993`)
- `.github/workflows/windows-ci.yml` adds `-UserAgent 'curl/8.0.0'` to the SourceForge fallback `Invoke-WebRequest` for `nsis-3.11-setup.exe`.
- Without a curl-style User-Agent, SourceForge `/download` can return an HTML interstitial page instead of the binary installer, triggering a SHA-256 mismatch.
- The pinned SHA-256 checksum (`38d49f8fe09b1c332b01d0940e57b7258f4447733643273a01c59959ad9d3b0a`) remains strictly enforced.

---

## 2. Stage 4B — Interactive Process Management (`TerminalService` & Tools)

### 2.1 `src/main/services/terminalService.ts`
- **Owner Isolation (`ownerId`):** Sessions accept an optional `ownerId` so callers only read, write, wait on, list, or kill processes within their scope.
- **Interactive Stdin:** Spawned child processes use `stdio: ['pipe', 'pipe', 'pipe']`. `writeStdin(sessionId, data, ownerId)` writes directly to `child.stdin` with bounds/state checks.
- **Bounded Wait (`wait`):** `wait(sessionId, timeoutMs, ownerId)` resolves immediately if the process has already exited or settles on `close` / timeout without busy-polling.
- **Execution Timeout (`timeoutMs`):** Enforces per-process wall-clock limits and terminates runaway child trees cleanly.
- **Explicit Lifecycle (`close`):** Releases listeners and kills active children cleanly on teardown.

### 2.2 Agent Tool Surface (`src/main/agent/tools.ts`, `src/main/agent/executors.ts`)
- Added and wired `process_write_stdin` and `process_wait` alongside `process_start`, `process_poll`, `process_kill`, and `process_list`.

---

## 3. Stage 5B — Live Browser Runtime, Honest Profiles & Windows Computer Use

### 3.1 Live Browser Settings & CDP Attachment (`src/main/agent/browser.ts`, `src/main/ipc.ts`)
- Replaced hardcoded `{ headless: true }` instantiation in `src/main/ipc.ts` with live `getSettings: () => settings.get().browser`.
- `BrowserSession.getEffectiveGuard()` evaluates live `NetworkGuard` rules (domain allow/deny, localhost toggle, IMDS floor) on every navigation.
- Implemented real `connectOverCDP(cdpUrl)` attachment (`attachedViaCdp = true`, `ownedByPixel = false`) so Pixel can attach to an existing user Chromium instance over Chrome DevTools Protocol and `close()` disconnects without terminating the user's browser process.

### 3.2 Honest Browser Profile Semantics (`src/main/agent/browserProfiles.ts`)
- Removed the misleading `'signed_in_profile_copy'` mode label that implied Chromium DPAPI-encrypted cookies could be decrypted/cloned across profiles.
- Replaced with honest modes:
  - `'ephemeral'` — isolated temporary context.
  - `'pixel_persistent_profile'` — Pixel-owned persistent `userDataDir` where users can sign in directly.
  - `'profile_preferences_copy'` (`authenticated: false`) — copies non-encrypted preferences/bookmarks only, explicitly reporting that encrypted cookies/sessions are not transferred.
  - `'cdp_attach'` — attaches to an existing user-launched Chromium session via CDP.

### 3.3 Persistent `ComputerUseController` & Distinct Windows Actions (`src/main/agent/computerUse.ts`, `src/main/ipc.ts`)
- Instantiated a persistent `ComputerUseController` in `src/main/ipc.ts` (cleared/invalidated on Emergency Stop) so observation snapshots and target resolution persist across turns.
- **Real PNG Screenshots (`vision` / `som`):** Uses `helper.call('capture_window', ...)` and reads `NativeWindowCapture.base64`, `width`, and `height` to return actual PNG captures rather than stub payloads.
- **Distinct Action Semantics:**
  - `click`: UIA invoke / click semantics.
  - `scroll`: UIA `ScrollPattern` scrolling.
  - `verify`: UIA `verify_element_state` assertion.
  - `double_click`, `right_click`, `key`, `drag`: explicitly refuse with `foreground_required` when background-only execution cannot safely perform foreground input, rather than silently falling back to a single click.

---

## 4. Verification Summary (Stage 4B + Stage 5B)
- `npm run check:scope`: `SCOPE_GUARD_OK`
- `npm run typecheck`: 0 errors
- Vitest targeted suite (5 files, **127/127 PASS**):
  - `tests/architecture.test.ts`
  - `tests/safety.test.ts`
  - `tests/hermes-stage5-browser-computer-use.test.ts`
  - `tests/hermes-stage3-stage4-functional.test.ts`
  - `tests/browser.test.ts` (**30/30** live Chromium Playwright tests)
