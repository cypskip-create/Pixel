# Pixel Core Tools 6.1 research notes

Research date: 2026-11-20. Repository metadata and source revisions were read
from the upstream GitHub API. Source checkout was not possible from this
workspace because outbound DNS/network access is blocked; no third-party source
was copied into Pixel.

## Speech and productivity project comparison

| Project | Source revision (default branch) | Code license | Relevant findings | Pixel decision |
|---|---|---|---|---|
| [OpenWhispr](https://github.com/OpenWhispr/openwhispr) | `007826d936af15e89291c1106042f1b280a75933` (`main`) | MIT | Electron dictation app; uses whisper.cpp and local GGML models; documents Windows CPU/GPU fallback, bundled FFmpeg, verified runtime downloads and push-to-talk patterns. It also bundles a large number of unrelated subsystems. | Reuse workflow ideas only. Do not import its app/runtime wholesale. It is a plausible native STT comparator, not evidence of better accuracy. |
| [OpenWhisper](https://github.com/malukenho/OpenWhisper) | `59dd2d4f9a2226efe19f9e895ca8f07c2993fde6` (`main`) | No SPDX license advertised by repository metadata | Its README describes a macOS menu-bar dictation client using local Whisper. No direct Windows implementation or checked-in license grant was established in this review. | Do not copy or ship it. Treat as a macOS UX reference only. |
| [Handy](https://github.com/cjpais/Handy) | `4807c21a7bb9a3bf2d52578a9b541e165b6bc8b9` (`main`) | MIT | Cross-platform offline dictation product with Windows distribution and extensible transcription hooks. Product-level dictation flow is relevant; it is not Pixel’s agent or conversation architecture. | No port. Reuse only general push-to-talk/dictation UX patterns. |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) | `5eaee0cc9024eb9e9a99469199920c8b7f5cb9ec` (`master`) | MIT | C/C++ Whisper inference, quantized GGML models, multiple backends, benchmark executable, Windows build paths. Model/license and packaging must be assessed separately from engine code. | Candidate for a future same-corpus comparison against Pixel’s current engine. No performance claim made without a benchmark run. |
| [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) | `b05fb0c214d70233f1d9decb5d519bb3188074c0` (`master`) | Apache-2.0 | Windows x64 support and a broad offline speech stack (streaming/offline ASR, VAD and TTS). Each model still needs its own provenance/license review; native runtime and model packaging are additional costs. | Strong candidate if streaming endpointing becomes a measured requirement. No new runtime added without model/quality/package benchmarks. |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) | `6cb639e70786aea42b9233006ae60eaf07190bdb` (`master`) | MIT | CTranslate2 inference with CPU int8 support; this is Pixel’s current optional local recognizer and Kokoro worker already shares the Python runtime. | Keep as baseline. It is operationally integrated but this workspace has no supported Python 3.12 runtime or installed model/audio fixture, so live inference is unverified here. |
| [VoiceStudio](https://github.com/debpalash/VoiceStudio) | `1ceb6d73285d8cf984156d0cf6fb42ff5e4ea6a2` (`main`) | AGPL-3.0 | The application covers desktop UI, backend, native helper and packaging; model/engine integrations carry separate licenses and provenance. | Do not embed its app code. A clean-room connector to a separately reviewed local engine may be considered later. No voice cloning shipped in this checkpoint. |
| [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx) | `3596b26764286a7de9d90c363e988d50578918e5` (`main`) | MIT | Python ONNX inference wrapper, Windows-compatible CPU ONNX Runtime, eSpeak phonemizer. | Already integrated as an explicitly selected local TTS engine. The model/voice assets have independent terms; use Pixel’s pinned hashes and user-controlled downloads. |
| [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) | Model card checked 2026-11-20 | Apache-2.0 shown by model card | Model weights are not the same license object as the ONNX wrapper or voice pack. | Existing Pixel download pins its ONNX export/voice pack hashes. Recheck provenance when changing assets. |
| [Pocket TTS](https://github.com/kyutai-labs/pocket-tts) | `a4a6054db281f0f34f3d44d626a972a44560dc83` (`main`) | MIT code | CPU-oriented streaming synthesis and optional voice cloning. The upstream `kyutai/pocket-tts` model card is CC-BY-4.0 and access-gated; voice samples/embeddings have separate provenance and consent concerns. | Do not add now: model/weight licensing, user data gate, runtime size and Windows latency require separate acceptance. The code license alone does not clear the model or cloned voice. |
| [Piper](https://github.com/OHF-Voice/piper1-gpl) | `39ac0a04ff01120b1cb7867d21723fa320305b03` (`main`) | GPL-3.0-or-later | Piper engine is GPL; project explicitly says voice models have separate licenses and the project does not grant model rights. | Do not embed in the distributable Pixel runtime without a deliberate GPL distribution review and per-voice license audit. |
| [AppFlowy](https://github.com/AppFlowy-IO/AppFlowy) | `8fcee27d9bd93aad4ee0191d5d8d915d6a9a4e93` (`main`) | AGPL-3.0 | Large Flutter/Rust collaborative workspace; useful product patterns for local pages, tasks and knowledge but unrelated to Pixel’s existing SQLite/project and Board implementation. | Study behavior only; do not copy code or add a second workspace application. Improve existing Pixel Library/Tasks/Board services instead. |

## Current Pixel voice boundary

The current implementation already has one supervised JSONL worker, pinned
Python packages, a separate `.venv-voice-dev`, optional local faster-whisper
STT, optional Kokoro ONNX TTS, user-triggered model downloads with hashes,
cancellation/timeouts, and Windows System.Speech as an explicit alternative.
No neural-engine fallback is silently reported as Kokoro.

On this development machine, `py -0p` reports Python 3.15 x64 only. Pixel pins
Python 3.12 for its native speech dependency set. The exact development setup
was run and correctly refused to create an environment, reporting the
available interpreter. The frozen worker is not present in this checkout and
there is no selected downloaded model or verified test WAV available to this
workspace. Therefore no transcription benchmark, WER/CER result, neural voice
quality result, or offline acceptance is claimed.

The required next measurement is a user-approved, licensed, fixed audio corpus
transcribed by Pixel faster-whisper, whisper.cpp and a Windows-compatible
sherpa-onnx model under equivalent CPU/model conditions. Compare WER/CER,
real-time factor, load time, peak memory, silence false positives, first/last
word retention and cancellation. Keep the integrated engine until that
measurement justifies a change.

## Reproducibility and licensing notes

The upstream commit identifiers above were resolved on 2026-11-20 and are
provided so later source research can be repeated. They are not vendored
dependencies and do not constitute legal advice. Code licenses, model weights,
voice samples, fonts, native binaries and generated outputs require independent
review. No research checkout or new runtime package was added to Pixel.
