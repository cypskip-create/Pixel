# Pixel installer root cause

Two distinct failures were reported from the laptop, plus a third found while
investigating. Each is separated into **verified**, **probable**, and **unknown**.

## Failure 1: "cannot be closed" with no process running

**Verified (source of the pinned electron-builder 26.18.0):** that dialog text
`$(appCannotBeClosed)` is emitted from three unrelated paths — a process that
cannot be terminated (`allowOnlyOneInstallerInstance.nsh:156`), a failed
`CopyFiles` into `$INSTDIR` (`extractAppPackage.nsh:116`), and a failed old
uninstaller during upgrade (`installUtil.nsh:219`). The message is therefore not
evidence of a running application. Our version already carries the exact-name
`findstr` fix, so the known substring false positive is not the cause.

**Verified (reasoning from the shipped config):** the "cannot be closed" probe in
this version matches by `$_.Path.StartsWith($INSTDIR)` when PowerShell is
available, and cannot see elevated processes. A partial prior installation whose
uninstaller is missing reproduces the symptom exactly: retries run the same
missing uninstaller and never succeed.

**Unknown:** which of those paths fired on the laptop. No trace was captured, and
the GUI installer cannot run in this environment.

**Action taken:** the custom `customCheckAppRunning` override is **removed**, per
the requirement to restore maintained behaviour. electron-builder's own detection
is used. Legacy Cyps cleanup remains.

## Failure 2: "Windows cannot write into this directory" (self-inflicted)

**Verified from our own history:** 0.2.0 introduced a directory preflight in
`.onVerifyInstDir`. That callback belongs to MUI's directory page and is invoked
while the path is being edited; it raised a modal dialog from inside the page,
called `Abort` (which can leave a valid directory permanently rejected) and
clobbered `$0` without saving it.

**Verified by experiment:** the write-test logic itself passes for existing,
not-yet-existing and trailing-separator paths, and rejects a nonexistent drive
(`tests/nsis.test.ts`, compiled with makensis). So the *test* was sound and the
*callback* was wrong.

**Verified from the user's report:** directory creation, writing and deletion all
succeed in PowerShell, and changing the destination did not help — consistent
with a rejection that does not depend on the chosen path.

**Action taken:** `.onVerifyInstDir` removed in 0.2.1, and the replacement
`customInit` preflight also **removed** in this branch. A check that runs before
the directory page has a trustworthy `$INSTDIR` can only produce false negatives;
the maintained NSIS flow already reports a real write failure.

## Failure 3: portable executable shows no window, no log

**Verified with REA on the shipped 0.2.1 binary** (`ev_1d1ce82f…`,
`inspect_electron_fuses`, SHA-256 `95adca69…25b5`):

| Fuse | State |
| --- | --- |
| `RunAsNode` | **enabled** |
| `EnableNodeOptionsEnvironmentVariable` | enabled |
| `EnableNodeCliInspectArguments` | enabled |
| `EnableEmbeddedAsarIntegrityValidation` | disabled |
| `OnlyLoadAppFromAsar` | disabled |

`RunAsNode` enabled means a global `ELECTRON_RUN_AS_NODE=1` turns `Pixel.exe` into
a plain Node interpreter: no Chromium, no window, and our JavaScript still runs —
but as Node, where `require('electron')` is not the application API. That matches
the reported symptom precisely, and this machine demonstrably has the variable set
(REA's own `doctor` and our diagnostics both flag it).

**Verified after the repair:** the rebuilt `Pixel.exe` no longer behaves as Node
under `ELECTRON_RUN_AS_NODE=1` (it no longer prints an Electron version as a Node
interpreter would), and the build log shows `@electron/fuses` rewriting the binary.

**Action taken:** `electronFuses` added to `electron-builder.yml`, disabling
`runAsNode`, `enableNodeOptionsEnvironmentVariable` and
`enableNodeCliInspectArguments`. This removes the failure mode rather than
documenting a workaround, and does not weaken Defender, SmartScreen, UAC or the
Electron sandbox — those are untouched.

**Unknown:** whether the laptop also has `ELECTRON_RUN_AS_NODE=1` set. The user
can confirm with `echo %ELECTRON_RUN_AS_NODE%`; if it is empty, the portable
failure has another cause and `scripts\capture-startup.ps1` will identify where
startup stops (it records exit code, window presence, startup log, Chromium log
and the last-exit marker).

## Also found and fixed while investigating

- **`customInit` preflight removal** (see Failure 2) — it was introduced in 0.2.1
  and had the same false-negative shape as the callback it replaced.
- **YAML indentation defect** introduced while adding fuses: `nsis:` was emitted
  as `nsis:  oneClick: false`, which electron-builder rejected with a parse error.
  Caught before packaging.

## Application identity preserved

`appId` (`com.cyps.companion`) and the pinned NSIS GUID
(`a5745318-c98a-51f9-87f5-f1c32713b276`) are unchanged, so this remains an
in-place upgrade over both 0.1.0 (Cyps) and 0.2.x (Pixel). No user data path,
migration rule, or uninstall registration was modified.
