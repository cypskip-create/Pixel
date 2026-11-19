# Pixel Voice Engine 4.0 readiness

Updated 2026-11-19. This is a working-tree report, not a release sign-off.

## Implemented

- Existing Pixel microphone capture, PTT chord, 20-second cap, manual draft,
  waveform, temporary WAV cleanup, emergency stop and typed shell bridge are
  retained.
- Pixel-managed, allowlisted, optional `tiny.en`, `base.en`, `small.en` and
  Kokoro int8 downloads with partial resume, cancellation, progress, controlled
  user-data paths, file-size bounds, atomic install, weight SHA-256 checks,
  metadata validation and corruption status.
- faster-whisper inference uses the selected Pixel-managed model and CPU int8.
  Missing selected models use Windows System.Speech only as the existing
  explicitly described fallback. An installed model failure is returned as a
  failure rather than silently changing recognizers. No confidence is invented.
- Optional Kokoro ONNX worker synthesis, fixed voice selection, rate control,
  WAV playback, stop/cancel and no overlapping speech. Windows System.Speech
  remains a separately selected local engine; Pixel does not silently switch
  engines after a synthesis failure.
- Packaged app resolves a frozen worker under `resources/voice-runtime` and
  does not fall back to a global Python interpreter. Model data remains in
  `app.getPath('userData')` and is not packaged.
- Build requirements, packaging script, runtime notices, acceptance steps and
  architecture/licensing limits are recorded.

## Partially implemented or blocked

- The Windows release pipeline is wired to build and package an isolated
  `PixelVoiceWorker`, but the worker artifact was not produced on this host.
  The packaged-runtime behavior must be treated as incomplete until the Python
  3.12 x64 build, unpacked package and installer launch pass.
- Recognition is English-only and retains Pixel's existing 20-second capture
  limit. Voice-activity segmentation, longer dictation, custom vocabulary and
  exact-string correction are not implemented.
- Kokoro output is whole-response local synthesis/playback with cancellation;
  sentence streaming and output-device selection are not implemented.
- There is no measured comparison against Handy's transcribe.cpp, Pocket TTS,
  Piper or a manually verified speech corpus. The current engine selection is
  an integration decision, not a demonstrated quality/performance win.

## Automated evidence from this host

The completed focused TypeScript suite:

- `tests/voice.test.ts`, `tests/voice-models.test.ts`, and
  `tests/presentation-settings.test.tsx`: **31 passed, 0 failed, 0 skipped**.
- Python worker boundary suite (`python -m unittest discover -s python/tests
  -v`): **4 passed, 0 failed, 0 skipped** on Python 3.15.2.
- `python -m compileall -q python/pixel_worker python/tests`: passed.
- `npm run typecheck`: passed.
- Full Vitest suite: **793 passed, 0 failed, 27 skipped (820 total; 49 files
  passed, 1 skipped)**. Skips: 17 browser cases (Playwright Chromium absent), 7
  NSIS cases (`makensis` absent), and 3 opt-in native foreground tests.
- `npm run build`: passed (main/preload, renderer and icon).
- `npm run build:native`: passed (PixelNative.exe compiled).
- `npm run build:voice-worker`: blocked before environment creation because
  Python 3.12 x64 is required but this host only provides Python 3.15.2. This
  means the packaged worker, unpacked application, portable executable and
  installer were not produced or inspected for this tree.

The focused TypeScript run reports current machine capabilities
`stt=false`, `tts=true`; that is only the operating-system probe, not evidence
that Kokoro or a Whisper model is installed or has run.

## Unverified on Windows hardware

- No current-tree Windows CI result exists because these changes are
  uncommitted. The local full tests/build above are not CI evidence.
- The bundled worker could not be built on this host because installed Python
  is 3.15.2 and the build script requires Python 3.12 x64. Thus no unpacked
  Windows artifact, installer, portable executable or worker DLL discovery
  result was produced.
- No real Whisper/Kokoro model download, transcription, synthesis, microphone,
  speaker, disconnected-network test, Windows GUI check, benchmark or clean
  machine installation was run.
- No GitHub Actions run exists for this uncommitted tree. The workflow now
  contains a Python worker test step and packages the bundled runtime on Windows
  CI, but CI status is not claimed.
- Kokoro inference has not been exercised against version 0.6.1 in the worker.
  GPL phonemizer/eSpeak NG distribution obligations and per-voice attribution
  need review before commercial/closed distribution.
- Native `transcribe.cpp`, Pocket TTS and Piper were reviewed but not benchmarked
  in this environment. Accuracy, quality, CPU/RAM and installer-size
  comparisons are unmeasured.

## Not implemented

- Parakeet or multilingual models, application-specific vocabulary controls,
  long-form segmentation, streamed neural playback, and output-device choice.
- Reproducible STT accuracy/real-time-factor/memory benchmarks and TTS
  latency/quality benchmarks on an identified Windows laptop. No real-device
  success claim should be made until the documented procedure is run and its
  measurements recorded.

See [`PIXEL_VOICE_ACCEPTANCE.md`](PIXEL_VOICE_ACCEPTANCE.md) for the exact
Windows procedure and [`../architecture/PIXEL_VOICE_ENGINE.md`](../architecture/PIXEL_VOICE_ENGINE.md)
for design and scope.
