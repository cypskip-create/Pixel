# Pixel Phase G — Windows Runtime, Packaging & Parity Architecture

**Status:** Verified Locally (on top of `0a01a14`; Windows CI run `45223028456` PASSED)  
**Parity Companion:** [HERMES_SETTINGS_INVENTORY.md](../parity/HERMES_SETTINGS_INVENTORY.md) · [HERMES_PIXEL_SETTINGS_MATRIX.md](../parity/HERMES_PIXEL_SETTINGS_MATRIX.md) · [HERMES_FUNCTIONAL_PARITY_ROADMAP.md](../parity/HERMES_FUNCTIONAL_PARITY_ROADMAP.md)

---

## 1. Windows Electron Runtime Diagnostic (`0x80000003`)

Reproduced directly against the bare Electron 45.2.3 binary before any Pixel code executes:

```powershell
.\node_modules\electron\dist\electron.exe --version
# ExitCode: -2147483645 (0x80000003 / STATUS_BREAKPOINT)
```

### Root-Cause Evidence
- Exiting `0x80000003` on `--version` (zero Pixel JS loaded) proves the breakpoint occurs inside Chromium/Electron's native binary initialization in this sandboxed host environment — **not** in Pixel's main process, preload, or renderer code.
- No security-disabling flags (`--no-sandbox`, `webSecurity: false`, etc.) were introduced.
- Live interactive GUI launch and desktop screenshot capture remain open for execution on an unsandboxed Windows desktop host.

---

## 2. Windows Packaging & Distribution Inventory

Verified existing Windows distributions in `release/` (validated by `tests/artifacts.test.ts` 11/11 PASS and `tests/nsis.test.ts` 9/9 PASS):

| Artifact | Size | Verification |
| :--- | ---: | :--- |
| `release/Pixel-Setup-0.2.1.exe` | 124.6 MB | NSIS installer preflight & directory validation (`tests/nsis.test.ts`) |
| `release/Pixel-Portable-0.2.1.exe` | 113.1 MB | Portable single-file distribution verified in `tests/artifacts.test.ts` |
| `release/Pixel-Windows-Unpacked-0.2.1.zip` | 157.5 MB | Unpacked distribution archive containing executable & resources |
| `release/win-unpacked/` | Directory | Unpacked Electron app + native helper + renderer resources |

---

## 3. Python Agent & Local Voice Runtime Verification

- **Python `pixel-agent-v2`:** Zero third-party runtime dependencies (pure Python 3 stdlib). Verified via `python/tests/test_pixel_agent.py`, `python/tests/test_mcp_client.py`, `tests/python-agent-bridge.test.ts`, `tests/python-agent-parity.test.ts`, `tests/phase-b-git-files-github.test.ts`, `tests/phase-c-memory-skills.test.ts`, and `tests/phase-d-mcp-plugins.test.ts`. Automatic pre-turn fallback to TypeScript `AgentExecutor` verified on spawn/crash.
- **Voice Worker (STT + TTS):** Verified via `python/tests/test_voice_worker.py`, `python/tests/test_voice_benchmark.py`, `tests/voice.test.ts` (25/25 PASS, reporting real `stt=true tts=true`), and `tests/voice-models.test.ts` (7/7 PASS). Offline Whisper (`tiny.en`/`base.en`/`small.en`) and Kokoro ONNX models use explicit Pixel-managed downloads (never silent Hugging Face auto-downloads).

---

## 4. Phase G Settings Parity Additions

Wired two high-priority Hermes parity settings end-to-end (UI → `AppSettings` → `mergeSettings` validation/clamping → `SettingsStore` persistence → backend behavior):
- `agent.maxTurns` (Hermes `agent.max_turns`, range `4–40`, default `12`)
- `agent.maxConcurrentSpecialists` (Hermes `delegation.max_concurrent_children`, range `1–3`, default `3`, enforced in `SpecialistCoordinator.delegateParallel`)

Automated inventory-to-test reconciliation (`tests/phase-g-settings-parity.test.ts`) continuously verifies that every `Implemented and verified` entry in `docs/parity/HERMES_SETTINGS_SOURCE_MAP.json` maps to real existing implementation and test files.
