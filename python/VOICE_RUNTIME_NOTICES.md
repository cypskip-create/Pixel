# Pixel voice runtime third-party notices

The packaged `PixelVoiceWorker` is an isolated Python executable built from
`python/pixel_worker/worker.py`. The exact resolved build environment is
recorded in `DEPENDENCY_VERSIONS.txt` alongside the executable.

| Component | Version | License | Source |
| --- | --- | --- | --- |
| faster-whisper | 1.2.1 | MIT | https://github.com/SYSTRAN/faster-whisper |
| CTranslate2 | resolved at build time | MIT | https://github.com/OpenNMT/CTranslate2 |
| Kokoro ONNX | 0.6.1 | MIT | https://github.com/thewh1teagle/kokoro-onnx |
| ONNX Runtime | 1.23.2 | MIT | https://github.com/microsoft/onnxruntime |
| NumPy | 2.2.6 | BSD-3-Clause | https://github.com/numpy/numpy |
| phonemizer | 3.4.1 | GPL-3.0-or-later | https://github.com/bootphon/phonemizer |
| eSpeak NG loader | 0.2.4 | GPL-covered eSpeak NG runtime assets; see package and upstream notices | https://github.com/thewh1teagle/espeakng-loader |
| PyInstaller | 6.22.3 | GPL-2.0-or-later with bootloader exception | https://github.com/pyinstaller/pyinstaller |

The MIT Pixel application remains separately identifiable from its worker. The
worker is a separate process. When distributing this executable, retain this
notice and make the corresponding source and the exact pinned dependency source
available under their respective licenses. PyInstaller's exception does not
remove obligations from phonemizer/eSpeak NG. Pixel's source repository
provides the worker source; model and voice files are downloaded separately and
are governed by their upstream model/voice notices.

The optional faster-whisper English model files are MIT-licensed Systran
conversions. The optional Kokoro model is Apache-2.0. The voice pack is from
the Kokoro upstream release and remains subject to its upstream model-card
attribution and voice information. Pixel does not bundle model weights in the
installer.
