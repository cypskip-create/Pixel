# Pixel Stage 5 Architecture — Advanced Browser Automation & Windows Computer Use

**Hermes Reference Revision:** `352b249f67fb6a4a7d7904acaca9dd410db229e0` (`C:\dev\pixel-research\hermes-agent`)

## 1. Stage 4 Security & CI Baseline Corrections (S5-0 / S5-1)
- **IPC Channel Convention (`src/shared/channels.ts`):** Renamed `workspaceFs:listDir` / `workspaceFs:readFile` to `workspacefs:listDir` / `workspacefs:readFile` so `tests/architecture.test.ts` passes cleanly.
- **Canonical Terminal Root Containment (`src/main/services/terminalService.ts`):** Added `authorizedRoot` / `getAuthorizedRoot` canonical `realpathSync` containment checks blocking `cwdOverride` escapes via `..`, symlinks, or junctions. Documented clearly that shell commands still require `PermissionBroker` approval because a shell command can reference external paths.
- **Active Project Folder Resolution (`src/main/ipc.ts`):** Connected `resolveWorkspaceRoot()` to the active project's authorized `DocumentIndex` folder instead of `process.cwd()`; returns a truthful unconfigured error when no project folder is authorized.
- **Filesystem Secret Hardening (`src/main/services/workspaceFs.ts`):** Re-checks canonical target basename and all path segments against secret-file patterns (`.env*`, `*.key`, `*.pem`, `*.pfx`, `*.p12`, `id_rsa`, `credentials.json`, `.npmrc`, `.netrc`).

## 2. Browser Architecture, Security, CDP & Real Profiles (S5-2 → S5-6)
- **Hermes Sources Analyzed:** `tools/browser_url_policy.py`, `tools/browser_session_real_profile.py`, `tools/browser_session_cdp.py`, `tools/browser_use_cli.py`.
- **Ordered Network Security Floors (`src/main/agent/netGuard.ts`):**
  1. Unconditional cloud metadata / IMDS block (`169.254.169.254`, `100.100.100.200`, `metadata.google.internal`, `fd00:ec2::254`) — enforced even when `allowPrivateNetwork` is enabled.
  2. Credential-bearing URL rejection (`user:pass@host`).
  3. Website `blockedDomains` and `allowedDomains` policies.
  4. Private/LAN/loopback + DNS resolution + `checkConnectedAddress` rebind detection.
- **Consented Browser Profiles & CDP (`src/main/agent/browserProfiles.ts`):**
  - Detects installed stable Windows Chromium browsers (Chrome, Edge, Brave — skipping Beta/Dev/Canary).
  - Never copies cookies or profiles without explicit `realProfileConsent: true`; detects lock files and falls back truthfully with a note; `revokeRealProfileSnapshots()` deletes Pixel-owned profile copies completely.
  - `validateCdpEndpoint()` restricts plaintext HTTP/WS CDP to loopback, blocks cloud metadata, and marks attached browsers `ownedByPixel: false` so user browsers are never killed on cleanup.
- **Extended Playwright Interactions (`src/main/agent/browser.ts`, `tools.ts`, `executors.ts`):** Added `doubleClick`, `hover`, `selectOption`, and `waitForElement` (`browser_hover`, `browser_select_option`, `browser_wait_for_element`) using unique semantic target verification.

## 3. Consolidated Windows Computer Use (S5-7 → S5-8)
- **Hermes Sources Analyzed:** `tools/computer_use/schema.py`, `tools/computer_use/tool.py`.
- **Implementation (`src/main/agent/computerUse.ts`, `tools.ts`, `executors.ts`):**
  - Consolidated `computer_use` tool supporting `list_windows`, `capture` (`som` / `vision` / `ax`), `click`, `double_click`, `right_click`, `type`, `set_value`, `key`, `scroll`, `wait`, and `verify`.
  - 1-based Set-of-Marks (`som`) element index table bound to `(windowId, processId, capturedAt)` with 30s TTL expiry, rejecting stale snapshots, cross-window mismatches, disabled controls, and password fields.
  - Explicit `background_uia` vs. `foreground_required` reporting and immediate Emergency Stop enforcement.

## 4. Settings Parity (S5-10)
- Added `BrowserAutomationSettings` and `ComputerUseSettings` to `src/shared/types.ts` (clamped and persisted in `mergeSettings`) and exposed real controls in `src/renderer/components/SettingsPanel.tsx`.

## 5. Known Limitations
- Live Electron GUI visual acceptance remains blocked on this sandboxed Windows host (`electron.exe` exits `0x80000003` before executing JS).
- Foreground coordinate-level mouse drag/key injection for legacy non-UIA apps remains gated behind explicit foreground driver approval.
- Cloud browser provider adapters (Browserbase/Stagehand) are deferred until user credentials are configured.
