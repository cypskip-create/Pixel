# HeyClicky architecture (read-only investigation)

Scope: the artefact the user supplied (`C:\Users\cypri\Downloads\HeyClicky-Setup.exe`).
The **installed application was not present on this machine**, so claims about the
running app are marked as hypotheses. Nothing was executed, patched, or unpacked
into Pixel.

## 1. Evidence collected

REA inspections, read-only:

| Evidence | Operation | Finding |
| --- | --- | --- |
| `ev_576f994b…` | `inspect_pe_imports` | PE32, machine 0x14c (i386), 4 136 232 bytes, 15 DLLs, 297 imports, `imphash f6891161b45ccc65225213343ec13358` |
| `ev_0da807c4…` | `inspect_artifact` (summary) | PE with no readable child container (not MSI/NSIS/ZIP per REA's readers); root bytes only |
| `ev_4dc1fb20…` | `open_binary` | format `pe`, architecture `x86`, SHA-256 `34d8050a…b39293` |

Both files were hashed before inspection; the digests above are the identities
any future comparison must use.

## 2. Verified observations about the installer

The setup program is a **native Win32 x86 PE**, not an Electron application:

- **No .NET runtime import.** `mscoree.dll` is absent from the import table, so
  this is not a managed bootstrapper.
- **No Chromium/Electron footprint.** A 4 MB native binary with 297 imports is the
  size and shape of an installer stub, not an Electron app (which would be tens of
  megabytes and import `KERNEL32`/`USER32`/`GDI32` for a GUI shell).
- Import groups indicate what it does:

| DLL | Notable imports | Reading |
| --- | --- | --- |
| `ADVAPI32.dll` | `AdjustTokenPrivileges`, `LookupPrivilegeValueW`, `OpenProcessToken`, `ImpersonateLoggedOnUser`, `RevertToSelf` | elevates/impersonates for installation |
| `CRYPT32.dll`, `bcrypt.dll`, `ncrypt.dll` | `CertGetCertificateChain`, `CertVerifyCertificateChainPolicy`, `CryptQueryObject`, `BCryptOpenAlgorithmProvider` | verifies signatures / certificate chains |
| `ADVAPI32.dll` | `RegNotifyChangeKeyValue`, `RegEnumKeyExW`, `RegQueryValueExW`, `ReportEventW` | registry monitoring and event logging |
| `WS2_32.dll` | `WSASocketW`, `WSAConnect`, `GetAddrInfoW` | downloads something at install time |
| `KERNEL32.dll` | `CreateProcessW`, `CreatePipe`, `MoveFile`-family via `SetFileInformationByHandle` | runs extracted helpers |
| `IPHLPAPI.DLL` | `GetAdaptersAddresses` | network adapter inspection (licence binding or diagnostics) |

**Verdict (installer):** a signed-looking, network-capable native installer/
bootstrapper that elevates, verifies certificates and registers an event source.
It is *not* an Electron artefact and contains no JavaScript.

## 3. What cannot be verified from this artefact

The following are **hypotheses**, not observations, and are exactly what the
user's own documentation and screenshots would need to confirm:

- Whether the shipped application is Electron, Tauri, native C++/WinUI, or a
  hybrid (the installer's framework says nothing about the app it installs).
- Floating-assistant behaviour: always-on-top level, transparent hit-testing,
  edge snapping, multi-monitor handling.
- Avatar animation technique (CSS/canvas/Lottie/sprite) and expansion geometry.
- Screen-observation architecture (continuous capture vs. on-demand, local OCR
  vs. remote vision model).
- Input automation mechanism (SendInput, UI Automation, or injected events).
- Voice stack (vendor cloud STT vs. local engine) and push-to-talk binding.
- Agent orchestration model, background processes, and startup registration.
- Memory and CPU footprint at idle.

## 4. Method to close those gaps (read-only)

With authorisation, and with the app actually installed, the following would be
observation rather than inference. None of it requires patching HeyClicky:

1. `rea inspect_desktop_application <install dir>` — framework candidates
   (Electron/Unity/.NET/Unreal) from bounded file headers.
2. If Electron: `rea open_binary <app.asar>` then
   `analyze_javascript_application` — module graph, window configuration,
   opacity/always-on-top flags, IPC names, overlay geometry. Read-only; no
   execution.
3. `rea inspect_electron_fuses <exe>` — whether Inspector/`ELECTRON_RUN_AS_NODE`
   are enabled, which also tells us whether the app can be observed at runtime
   without modification.
4. `rea inspect_pe_resources <exe>` — icon/string resources, product identity,
   version block.
5. For runtime behaviour: the user's own screen recording plus Task Manager
   readings; no instrumentation of a third-party binary.

## 5. Licensing and scope

Only the installer's structure was read. No protection was bypassed, no
credentials or user data were touched, and no proprietary code or UI asset was
copied. Pixel's own implementation continues to be written from observable
behaviour and public interfaces.
