# Pixel voice acceptance

This procedure checks Pixel Voice Engine 4.1 on a supported Windows x64 laptop.
Automated unit tests do not replace microphone, speaker or installer testing.

## Build and automated checks

From the Pixel repository in PowerShell:

```powershell
npm ci
npm run typecheck
$env:USERPROFILE = (Get-Location).Path
npm test -- --reporter=default
python -m unittest discover -s python/tests -v
npm run build
npm run build:native
npm run build:voice-worker
npm run pack
```

`build:voice-worker` requires the Python 3.12 x64 build toolchain and network
access to install the pinned packages. It creates an isolated
`.venv-voice-build` for development and packaging. No Python installation is
required on end-user machines. `npm run pack` creates an unpacked directory;
`npm run dist` creates the NSIS installer, portable executable and ZIP without
publishing a release. Inspect `release/win-unpacked/resources/voice-runtime/`
for `PixelVoiceWorker.exe`, its dependent files, `THIRD_PARTY_NOTICES.md` and
`DEPENDENCY_VERSIONS.txt`. Optional model files must not be in the installer.

## Development and settings

1. Start Pixel with `npm run dev`. Open Settings → Voice. Select the microphone,
   run Test microphone and confirm its level meter changes only while testing.
   Then select **Test recognition**, speak a known sentence and select **Stop &
   transcribe test**. Compare the displayed result with what you said. Confirm
   the reported backend/model and timing, and confirm the test text was not
   submitted to chat.
2. To inspect audio metadata, enable **Show capture diagnostics for the next
   voice test** and repeat with a short sentence. Review the actual device,
   input/stream/output sample rates, timestamps, duration, RMS/peak, clipping
   and quiet-sample percentage. The metrics are not logged.
3. To keep a diagnostic clip, separately enable **Keep the next 30-second test
   recording in memory so I can save it**. Use **Save diagnostic WAV…**, choose
   a local path, listen to it locally and delete it when finished. Otherwise
   leave the checkbox off or use **Discard recording**; no raw audio is saved
   by default.
4. Select Balanced (`base.en`) and choose Download model. Wait for download
   completion, then run Voice Test to verify the model actually loads and
   transcribes. Download Fast (`tiny.en`) or High accuracy (`small.en`) only
   when desired; those labels identify model sizes, not measured accuracy.
   Cancel one download and confirm the next download resumes; test with the
   larger `small.en` only if there is adequate disk space. Remove a downloaded
   model and confirm the selected preference remains but the readiness status
   changes to not downloaded.
5. Hold `Ctrl+Shift+Space` over Notepad, speak “Pixel, tell me the current
   time,” and release. Confirm the Notepad window remains focused, the orb
   waveform is live only during capture, the transcript is submitted once, and
   Pixel responds. Confirm no screenshot or transcript text appears in logs.
6. Use Workspace's manual microphone control for longer than 20 seconds but
   less than two minutes. Confirm a transcript appears in the draft, can be
   edited, and is not sent until the Send button is pressed. Stop and restart
   capture; confirm no earlier samples are appended.
7. With the Windows system voice selected, choose an installed voice, adjust the
   rate, press Test voice, then Stop voice. Repeat with rapid Test voice clicks;
   a second reply must be rejected while playback is active.
8. Download Kokoro and its voice pack, choose Kokoro, select each voice and
   rate, and test a harmless sentence. Confirm sound comes from the Windows
   default output device. Confirm cancellation and emergency stop end synthesis
   or playback and remove the temporary WAV. A selected Kokoro engine with
   missing assets must show an error, never a false success or silent fallback.
9. Disconnect the network after models are installed. Retest dictation and
   Kokoro playback. This checks speech only; Pixel's DeepSeek conversations
   still require network access.
10. Restart Pixel. Confirm model downloads and settings persist, model weights
   are reused without re-download, and the worker does not launch until voice
   work/settings probing requires it. Confirm PTT, manual capture, stop,
   emergency stop and app shutdown all cancel correctly.

For a local STT comparison, prepare a private manifest of manually verified
mono PCM16 16 kHz recordings, then run the aggregate-only harness described in
[`PIXEL_VOICE_READINESS.md`](PIXEL_VOICE_READINESS.md). It compares installed
models at beam sizes 1/3/5 and reports WER/CER, omission/repetition/silence
metrics, load/warm latency, RTF, CPU and working set. Keep the manifest, audio
and manually reviewed transcripts private. Record machine CPU/RAM, Windows
version and microphone/speaker alongside results. Do not report accuracy or
latency as passed without these measurements and a listening review.

## Packaged acceptance

1. Build with `npm run dist`, install the generated `Pixel-Setup-0.2.1.exe`,
   and repeat the settings/STT/TTS checks above. Confirm Pixel works on a clean
   supported account with no Python, Rust, C++ compiler, Handy or separate
   voice app installed.
2. Inspect `resources/voice-runtime` in the installed app. Start transcription
   and verify the child image is PixelVoiceWorker.exe, not `python.exe` or
   `py.exe`. Temporarily rename the worker in an unpacked test copy; Pixel must
   report the voice runtime missing rather than use global Python.
3. Confirm models are under the existing Pixel Electron user-data directory,
   survive app updates/reinstall, and remain after uninstall according to the
   existing `deleteAppDataOnUninstall: false` policy. Confirm Remove Model only
   removes its allowlisted model and partial files.
4. Inspect the NSIS, portable and ZIP outputs to ensure the runtime is present,
   model assets are absent, existing appId/GUID are unchanged, and no release
   was automatically published.

## Status for the Voice 4.1 working-tree checkpoint

- Automated model-manager, voice-boundary, settings and worker-safety tests are
  documented in the Voice Engine section of `docs/validation/PIXEL_VOICE_READINESS.md`.
- Real microphone/speaker, inference, offline, installer and clean-machine
  acceptance remain unverified until run on the target Windows laptop.
