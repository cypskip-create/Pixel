# Pixel Voice Engine 4.1 readiness

## Development setup follow-up (2026-11-19)

The development main process now uses `.venv-voice-dev` rather than the
PyInstaller-only `.venv-voice-build`. Run `npm run setup:voice-dev` to install
the pinned local inference runtime after an explicit user action. The script
accepts `PIXEL_VOICE_DEV_PYTHON` or `-Python` for the Python 3.12 x64
interpreter (separate from the packaging-only `PIXEL_VOICE_BUILD_PYTHON`),
checks package imports, CTranslate2 CPU compute types, ONNX Runtime CPU provider
and JSONL capabilities. To check an existing model, pass
`-ModelPath <selected-model-directory>`; to prove inference, also pass
`-AudioPath <local-wav>`. This is code-path implementation only: the setup and
inference were not executed here, so model readiness and recognition remain
unverified.

Updated 2026-11-19. Latest reviewed `main` is
`8ed850fbb3b2f1d550e7f246d916a99491da3fc9`. A follow-up corrected the setup
interpreter override and removed duplicate Workspace navigation locally; these
changes are uncommitted and have no CI run. Current automated evidence after
those changes: TypeScript and production build passed; Vitest **858 passed, 0
failed, 27 skipped (885 total)**; Python worker tests **12/12 passed**; native
helper build passed. The setup diagnostic was checked with an invalid
`PIXEL_VOICE_DEV_PYTHON` path and reported the correct remediation. No Python
dependency installation, downloaded model inference, microphone/speaker test,
or live Electron voice test was performed. These results verify the existing
automated voice boundaries, not real-device recognition quality or TTS quality.

## Implemented

- Fixed the confirmed Windows PowerShell quoting defect in
  `scripts/build-voice-worker.ps1`. It now uses a numeric Python version probe,
  requires Python 3.12 x64 before creating a build environment, verifies the
  venv architecture/version and starts the frozen worker for a JSON/native
  dependency smoke test. CI passes the `setup-python` executable explicitly.
- Replaced the MediaRecorder/Opus/decode path with explicit AudioWorklet Float32
  capture and WebAudio resampling to mono PCM16 WAV at 16 kHz. Manual dictation
  supports up to 120 seconds with fixed memory bounds. PTT keeps its existing
  20-second bound. Stop closes the input track and flushes the worklet before
  the captured data is resampled.
- Added an opt-in 30-second Settings Voice Test. It displays the actual backend,
  model and processing duration; its transcript is not sent to chat. Optional
  signal metadata includes input/capture/output sample rates, duration, count,
  RMS, peak, clipping, low-energy share and start/stop time. Raw recording stays
  in memory only and can be saved only after a separate opt-in and native save
  dialog; the user can discard it.
- Added Fast (`tiny.en`), Balanced (`base.en`) and High accuracy (`small.en`)
  labels to the existing model selector. The existing decoder is unchanged
  (beam size 1 and existing VAD/conditioning parameters) until real recordings
  demonstrate a better choice. Backend probe results are no longer presented
  as proof that a model loaded; Voice Test reports the real inference backend.
- Increased validated WAV and worker bounds to 120 seconds; local Whisper
  timeout is 180 seconds. The existing Windows fallback is tagged and timed.
- Kokoro replies up to 20,000 characters are stripped of fenced code, URLs and
  basic Markdown and split into bounded requests. Synthesis and playback are
  serial and cancellable. Settings' test voice reports the selected backend
  and measured generation/playback time when the engine provides it. Serial
  chunking can have gaps and is not described as streaming.
- Added `python/tools/benchmark_voice.py` for manually verified local WAV
  manifests. It compares selected installed model paths at beam sizes 1/3/5 and
  records model load time, warm inference, RTF, CPU, working set, WER/CER,
  omissions, repetitions and false speech on explicitly marked silence. The
  report omits recordings, file paths and transcripts.
- Extended the actual Electron sandbox smoke to load and instantiate the
  production AudioWorklet module without microphone permission. This runs only
  after the renderer build.

## Partially implemented

- Capture diagnostics currently measure output-signal levels and timing. There
  is no built-in raw-vs-processed listening comparison or UI toggle for Windows
  noise suppression/automatic gain control; these need real recordings before
  changing those defaults.
- Long dictation is one continuous bounded recording, not VAD-based segmented
  dictation. Kokoro text is chunked, but each chunk must finish synthesis before
  its playback starts; transitions can pause.
- Voice Settings can show a selected mic and last test result. Device labels
  are surfaced only after microphone access. Runtime/module/file probes do not
  prove the model loaded; a successful Voice Test does.
- The quality mode labels map model sizes and are not benchmark results.
  `small.en` is available only after a user downloads its larger model.

## Automated evidence on this host

- `npm run typecheck`: passed (renderer and main TypeScript projects).
- `npm test -- --reporter=default`: **801 passed, 0 failed, 27 skipped**
  (**828 total; 50 test files passed, 1 skipped**). The skips are 17 browser
  cases because Playwright Chromium is absent, 7 NSIS cases because `makensis`
  is absent, and 3 opt-in native foreground integration tests.
- `python -m unittest discover -s python/tests -v`: **11 passed, 0 failed**.
- `python -m compileall -q python/pixel_worker python/tests python/tools`:
  passed.
- `npm run build`: passed (main, esbuild preload, Vite renderer, worklet public
  asset and icon).
- Playwright Chromium installation was attempted, but DNS to
  `cdn.playwright.dev` is blocked in this environment. Browser tests remain
  skipped.
- Python 3.15 x64 rejection check passed: `build:voice-worker` exited with the
  clear Python 3.12 x64 requirement before creating `.venv-voice-build`.
- Electron sandbox/AudioWorklet smoke was attempted. Electron 45.2.3 exited
  with `2147483651` before writing app/preload smoke output. This host therefore
  did not verify actual Electron AudioWorklet execution.

## Unverified or blocked

- The actual Python 3.12 x64 worker build, dependency installation, PyInstaller
  native-DLL smoke, unpacked app, portable executable and NSIS installer were
  not produced. Only Python 3.15 is available locally. A new Windows CI run
  cannot be produced from this uncommitted tree; the previous GitHub run
  `44485597153` failed in package construction on the PowerShell quoting bug
  fixed here. It must be rerun after the user pushes.
- No real microphone, speaker, Whisper/Kokoro inference, model comparison,
  accuracy score, latency score, TTS naturalness comparison, offline device
  test, or Windows app/settings visual acceptance was run. No speech quality
  improvement is claimed.
- Handy/transcribe.cpp and other STT/TTS alternatives were not built or
  benchmarked. No verified reference WAV corpus was supplied. Use the harness
  below with manually verified speech before changing decoding defaults or
  claiming an accuracy win.
- Kokoro's current Windows `SoundPlayer` path still starts a playback process
  per segment, does not select an output device and is not seamless streaming.
  Generated audio duration does not equal a subjective naturalness score.
- Speech distribution licenses/model terms still require review before a
  closed-source commercial release.

## Not implemented

- VAD-based long-dictation segmentation, language selection beyond English,
  custom vocabulary, Parakeet or multilingual models.
- Live audio streaming, gapless Kokoro queue playback, a persistent Windows
  playback engine and output-device selection. Kokoro still uses serial
  synthesis and PowerShell/`SoundPlayer` playback per segment.
- A review-before-send control for push-to-talk. PTT continues to submit one
  transcript automatically; potentially state-changing agent actions remain
  subject to Pixel's existing permission broker.
- A/B evaluation of Windows noise suppression/automatic gain control and
  original-vs-processed audio listening.
- A separate voice worker or measured voice/document contention policy. The
  current supervised worker is shared and serial; actual contention and memory
  impact require a real model/load test.
- Measured TTS voice naturalness comparison or a confirmed accuracy/latency
  advantage over Handy/transcribe.cpp or other engines.

## Benchmark procedure

1. Create a local JSON manifest with manually verified references and WAV paths
   relative to it. Use mono signed PCM16 at 16 kHz. Mark silence examples with
   `"silence": true`. Keep this data local/private.
2. In the Python 3.12 voice environment, run for each installed model:

   ```powershell
   python python/tools/benchmark_voice.py --manifest C:\private\voice-set.json `
     --model tiny.en=C:\private\models\tiny.en `
     --model base.en=C:\private\models\base.en `
     --model small.en=C:\private\models\small.en `
     --beam 1 --beam 3 --beam 5 --output C:\private\voice-results.json
   ```

3. Review aggregate-only WER/CER and latency; listen to the recordings and
   inspect the manually checked transcript privately. Do not place transcript
   text, API keys or audio in logs, task history or source control.

See [`PIXEL_VOICE_ACCEPTANCE.md`](PIXEL_VOICE_ACCEPTANCE.md) for laptop-side
steps and [`../architecture/PIXEL_VOICE_ENGINE.md`](../architecture/PIXEL_VOICE_ENGINE.md)
for architecture, actual status and limits.
