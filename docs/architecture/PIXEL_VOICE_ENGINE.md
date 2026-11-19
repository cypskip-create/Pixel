# Pixel local voice engine

Updated 2026-11-19. This describes the current Voice Engine 4.0 implementation;
it separates code paths that exist from inference and device checks that still
need a real Windows run.

## Architecture

Pixel keeps ownership of microphone permission, the 20-second recording
session, selected input device, waveform, manual-dictation draft, PTT release,
submission and emergency stop. Captured audio remains a transient mono 16 kHz
PCM WAV. The main process validates its RIFF fields and size, writes it to a
short-lived Pixel-named temp file, submits it to the supervised Python worker,
and deletes it in `finally`.

The worker is the existing newline-JSON process supervised by
`PythonWorker`. It starts on demand, keeps at most one Whisper model and one
Kokoro session loaded, runs CPU inference, handles one operation at a time,
and is terminated on cancellation or timeout. Loaded voice models are cleared
after ten minutes without a voice request and on app shutdown. A failed
packaged worker reports unavailable; packaged Pixel does not fall back to a
user-installed Python or a Python launcher.

### Speech recognition

- Supported optional English models: `tiny.en` (~79 MB), `base.en` (~152 MB),
  and `small.en` (~507 MB). They are Systran faster-whisper CTranslate2 model
  conversions, loaded CPU/int8. The default selection remains `base.en`.
- Pixel downloads the four allowlisted files from a pinned Hugging Face commit
  path into `<Electron userData>/voice-models/<model-id>`. The renderer passes
  only a fixed model ID; it cannot pass a URL, directory or model path.
- Downloads are single-flight, resumable via HTTP Range, cancellable, staged,
  size-limited and atomically installed after verification. Model weights have
  pinned SHA-256 checks. JSON metadata is parsed, vocabulary must be non-empty,
  and installed files are rechecked on status/load. Corrupt models are reported
  as not ready; no model download happens automatically.
- If the selected Whisper model is absent, Pixel uses the existing Windows
  System.Speech recognition fallback if available. If the selected downloaded
  model fails to load or transcribe, Pixel reports that failure instead of
  silently substituting a different recognizer. System.Speech confidence is
  returned only when it is actually supplied; Whisper results carry no invented
  confidence value.
- The result boundary can include transcript, language, model, backend, audio
  duration, processing time, no-speech and cancellation/error information.
  Audio is not sent to DeepSeek or another provider by the speech worker.

### Speech synthesis

- `system` uses Windows System.Speech. Installed Windows voices can be selected,
  speech rate is mapped to its -10..10 scale, and the Windows default output
  device is used.
- `kokoro` uses the Kokoro v1.0 int8 ONNX export and upstream v1.0 voice pack.
  Users can select Heart, Sarah, Adam or Michael and a 0.7×–1.3× rate. Assets
  are downloaded only after the user requests them and are SHA-256 checked.
- Kokoro generates temporary 24 kHz-style PCM WAV output through the same
  worker. `System.Media.SoundPlayer` performs local playback; cancellation kills
  the synthesis worker or playback process and the generated file is removed.
  Pixel rejects overlapping speech. Playback uses Windows' default output
  device. Sentence streaming, a selectable output device and a real-device
  Kokoro quality/latency result are not implemented or verified.
- Selecting Kokoro without its model, or with a missing runtime, returns a
  specific failure. It does not silently switch to Windows Speech. The system
  engine remains an explicit fallback choice.

## Process and package boundaries

`npm run build:voice-worker` creates a PyInstaller onedir executable from
`python/pixel_worker/worker.py`. It uses an isolated Python 3.12 x64 build
environment, pins the direct voice dependencies in
`python/requirements-voice.txt`, writes resolved package versions beside the
output and copies `python/VOICE_RUNTIME_NOTICES.md`. `pack` and `dist` require
this build and copy the runtime to `resources/voice-runtime`. Models are never
inside the installer; they live under user data and therefore are not removed
by the existing per-user installer/uninstaller policy.

Development uses `.venv-voice-build` when present. Otherwise the pre-existing
developer Python discovery path is retained for local development/document
tools. Packaged applications require `resources/voice-runtime/PixelVoiceWorker.exe`
and never use that development fallback.

The Electron renderer sees only typed model IDs, status, progress and existing
voice methods on `window.cypsShell`. It does not receive filesystem paths,
`ipcRenderer`, shell execution, or worker handles. Model root and executable
path are owned by the main process.

## Handy and candidate review

The Handy source reviewed was pinned at
[`aca8985190c3ad7f361d8a80cb30f179513ed690`](https://github.com/cjpais/Handy/tree/aca8985190c3ad7f361d8a80cb30f179513ed690)
(MIT). Pixel reuses its architectural lessons—persistent supervised inference,
explicit cancellation/model lifecycle, file-model management and integrity
checks—but does not copy Handy code, interface, branding, Tauri app or tray
behavior. Pixel retains its own capture and PTT workflows. Handy's native
transcribe.cpp option was not built or benchmarked in this workspace, so this
implementation does not claim it is inferior or superior to faster-whisper.

### Handy architecture map reviewed

At that pinned Handy snapshot, the voice path is divided into these layers:

1. CLI and shortcut/input events feed a serialized transcription coordinator,
   which owns recording/start/stop/cancel transitions and avoids overlapping
   jobs.
2. `AudioRecordingManager` owns microphone stream/device state. Its frame path
   feeds `StreamRouter`; VAD and streaming transcription receive audio while a
   session is active.
3. `TranscriptionManager` chooses streaming or batch work, chunks long audio at
   pauses, applies language/output normalization and produces the transcript.
   Model metadata/download and selected-model state live in `ModelManager`.
4. `EngineSupervisor` owns a separate child process for native transcribe.cpp.
   It uses a framed JSON/audio protocol, enforces bounded calls, cancels work,
   unloads model memory, and recovers from worker crashes/hangs (including a
   CPU-only retry after GPU failure).
5. `--transcribe-file <WAV> --json` enters Handy's batch path without opening
   the microphone. It expects 16 kHz mono signed 16-bit PCM and an installed
   model, and reports model/device/backend, audio duration, load time,
   transcription times, real-time factor and text.

Pixel does not reuse these source modules: adopting the manager and engine
would pull in Handy's Tauri lifecycle and a second native model catalog. This
checkpoint ports the relevant process supervision and model-lifecycle ideas
into Pixel's existing Python worker boundary. The official
[transcribe.cpp project](https://github.com/handy-computer/transcribe.cpp)
describes its own source as MIT-licensed; that source and its dependencies are
not included in Pixel's current worker package.

Kokoro ONNX was chosen as the first optional neural TTS path. Its inference
wrapper is MIT and the v1.0 model is Apache-2.0, but the wrapper depends on
`phonemizer` (GPL-3.0-or-later) and an eSpeak NG runtime. Those components are
isolated in the worker and listed in its shipped notices. A Windows distribution
must retain those notices and make the corresponding worker/dependency source
available under the applicable licenses. The voice pack is fetched from the
upstream release rather than redistributed in Pixel; its per-voice training
data terms must be checked before commercial redistribution claims are made.

Pocket TTS was not selected: although its source is MIT, the reviewed weight
release is CC BY 4.0 and gated behind Hugging Face access/acceptance. Piper was
not selected because the current implementation is GPL-3.0 and each voice has
separate terms. The current dependency notice and build-resolved version list
are `python/VOICE_RUNTIME_NOTICES.md` and
`python/dist/PixelVoiceWorker/DEPENDENCY_VERSIONS.txt`.

## Known scope limits

- English-only faster-whisper models are offered; no Parakeet, multilingual
  model, custom vocabulary or exact-string correction path has been integrated.
- Pixel's existing recorder has a hard 20-second limit. Long dictation,
  punctuation accuracy and recognition quality have not been benchmarked.
- No real microphone, speaker, offline-network, Windows install/upgrade or
  on-device latency/memory measurement was possible for this implementation
  turn. The host has Python 3.15.2 only; Kokoro ONNX 0.6.1 requires Python
  below 3.14, so the pinned Python 3.12 bundled worker could not be built here.
- No Whisper or Kokoro model was downloaded or run during automated tests.
  The default Whisper model is not ready until explicitly downloaded.
- The package's GPL worker dependencies require distribution/source review for
  any future closed-source or commercial redistribution. This implementation
  records the dependencies; it is not legal advice or a release approval.
