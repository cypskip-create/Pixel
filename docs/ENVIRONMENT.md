# Cyps — Development Environment Findings

Recorded from live inspection of this machine on 2026-11-06. These findings drive
every architectural decision in the project. Re-verify before assuming they still hold.

## Verified present

| Component | Version | Path / Notes |
|---|---|---|
| Windows | Win10/11 build 26100-era | Windows SDK 10.0.26100.0 |
| Node.js | v24.16.0 | `C:\Program Files\nodejs\node.exe` |
| npm | 11.13.0 | works **only** with a workspace-local cache (see below) |
| Python | 3.12.14 | bundled at `C:\Users\cypri\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe` |
| Git | 2.54.0.windows.1 | |
| .NET SDK | 9.0.305 | |
| uv | 0.13.6 | |
| MSVC Build Tools | VS 2022 BuildTools, MSVC 14.44.35207 | `link.exe` present |
| WebView2 Runtime | 156.0.4314.58 | |
| pnpm | bundled | `...\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs` |

## Verified ABSENT / broken

### 1. Rust toolchain — MISSING (blocks Tauri)

No `cargo`, `rustc`, or `rustup` anywhere on the machine or in the DSH runtime.
Tauri 2 requires Rust. Installing rustup is **blocked**: its default target
`C:\Users\cypri\.rustup` is denied by the file sandbox (confirmed:
`New-Item $env:USERPROFILE\.rustup` → "Access to the path '.rustup' is denied").

### 2. curl and .NET HTTPS — BROKEN

```
curl: (35) schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS (0x8009030e)
Invoke-WebRequest → "The underlying connection was closed"
```
Any tool built on .NET `HttpClient` or schannel (including `Invoke-WebRequest`,
`Invoke-RestMethod`) **cannot make HTTPS calls**. This affects download steps and
must be worked around by using Node or Python for all network I/O.

### 3. npm default cache — outside sandbox

`C:\Users\cypri\AppData\Local\npm-cache` is not writable → `npm view`/`install`
fail with `EPERM`. **Fix: always pass `--cache=<workspace>\.npm-cache`**, or use
the `.npmrc` committed in the repo.

### 4. WMI / CIM — BLOCKED

`Get-CimInstance` → `Access denied (0x80041003)`. Consequently system diagnostics
via CIM (CPU, RAM, battery, disk) that the spec asks for in future modules will
fail from a sandboxed process and need a different source or an unsandboxed runner.

### 5. Disk free space — UNVERIFIED

`Get-PSDrive` reported `Free=0` for C:; `fsutil` was access-denied; CIM was
access-denied. Free space could not be confirmed by any working method.
A Rust + Tauri build needs roughly 3–6 GB, so this must be checked manually
before committing to the Tauri path.

## Network reachability (per-stack)

| Stack | Result |
|---|---|
| Node `https` | ✅ works (npm PONG 818 ms; rust dist 200; PyPI 200) |
| Python `urllib` | ✅ works (PyPI 200) |
| .NET / curl / schannel | ❌ broken (`SEC_E_NO_CREDENTIALS`) |
| `api.deepseek.com` via Node | ✅ reachable, HTTP 401 without key (expected) |

## Consequence: desktop shell choice

The requested stack (Tauri 2 + Rust) **cannot be compiled on this machine today**.

Decision taken (approved by the product owner): build on **Electron + React 19 +
TypeScript + Vite**, and keep the renderer, preload bridge, and backend contract
framework-neutral so the shell can migrate to Tauri later without rewriting the
UI or agent logic.

Migration readiness is maintained by:
- All native capability accessed only through a narrow `window.cyps` preload bridge.
- No Electron APIs called directly from React components.
- Renderer is a plain Vite web app (Tauri's webview could host it unchanged).
- Agent backend is an independent localhost HTTP/WebSocket service — identical
  under either shell.

## How to run anything in this environment

```powershell
$env:NPM_CONFIG_CACHE = "C:\Users\cypri\OneDrive\Desktop\cyps\.npm-cache"
npm install
```

Network calls from build scripts must use Node or Python, never .NET/curl.
