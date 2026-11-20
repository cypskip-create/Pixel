[CmdletBinding()]
param(
  [string]$Python = $env:PIXEL_VOICE_DEV_PYTHON,
  [string]$ModelPath,
  [string]$AudioPath
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $root '.venv-voice-dev'
$pythonExe = Join-Path $venv 'Scripts\python.exe'
$requirements = Join-Path $root 'python\requirements-voice-dev.txt'
$worker = Join-Path $root 'python\pixel_worker\worker.py'

if (-not $Python) {
  $launcher = Get-Command py -ErrorAction SilentlyContinue
  if (-not $launcher) { throw 'Python 3.12 x64 is required. Install it, then rerun npm run setup:voice-dev.' }
  try {
    $resolvedPython = @(& $launcher.Source -3.12 -c 'import sys; print(sys.executable)' 2>$null)
    if ($LASTEXITCODE -eq 0 -and $resolvedPython.Count -gt 0) { $Python = $resolvedPython[0].Trim() }
  } catch {
    # PowerShell 7 can promote stderr from a missing `py -3.12` runtime to a
    # terminating error when PSNativeCommandUseErrorActionPreference is set.
    # Fall through to an explicit installed-runtime diagnostic below.
  }
  if (-not $Python) {
    $installed = @()
    try { $installed = @(& $launcher.Source -0p 2>$null) } catch { }
    $runtimeList = if ($installed.Count -gt 0) { $installed -join '; ' } else { 'no Python launcher runtimes detected' }
    throw "Python 3.12 x64 is required for Pixel's pinned speech dependencies; $runtimeList. Install Python 3.12 x64, then rerun npm run setup:voice-dev."
  }
}
if (-not $Python -or -not (Test-Path -LiteralPath $Python)) { throw 'Could not locate Python 3.12. Set PIXEL_VOICE_DEV_PYTHON or pass -Python <python.exe>.' }

$info = & $Python -c 'import platform,struct,sys; print(f"{sys.version_info.major}.{sys.version_info.minor}.{struct.calcsize(chr(80))*8}")'
if ($LASTEXITCODE -ne 0 -or $info -ne '3.12.64') { throw "Voice development requires Python 3.12 x64; found $info." }
if (-not (Test-Path -LiteralPath $pythonExe)) {
  & $Python -m venv $venv
  if ($LASTEXITCODE -ne 0) { throw 'Could not create .venv-voice-dev.' }
}
& $pythonExe -m pip install --disable-pip-version-check -r $requirements
if ($LASTEXITCODE -ne 0) { throw 'Voice dependencies failed to install. Check the pip output above and rerun setup.' }

$probe = @'
import ctranslate2, onnxruntime, faster_whisper, kokoro_onnx, phonemizer, espeakng_loader
assert ctranslate2.get_supported_compute_types("cpu")
assert "CPUExecutionProvider" in onnxruntime.get_available_providers()
print("CTranslate2 CPU:", ", ".join(sorted(ctranslate2.get_supported_compute_types("cpu"))))
print("ONNX providers:", ", ".join(onnxruntime.get_available_providers()))
print("faster-whisper, Kokoro, phonemizer, eSpeak loader: import OK")
'@
& $pythonExe -c $probe
if ($LASTEXITCODE -ne 0) { throw 'A speech dependency or native runtime failed to initialize. See the import probe output above.' }

& node (Join-Path $root 'scripts\smoke-voice-dev-worker.mjs') $pythonExe $worker
if ($LASTEXITCODE -ne 0) { throw 'The development voice worker protocol check failed.' }

if ($ModelPath) {
  if (-not (Test-Path -LiteralPath $ModelPath -PathType Container)) { throw "Model directory not found: $ModelPath" }
  foreach ($file in @('model.bin','config.json','tokenizer.json','vocabulary.txt')) {
    if (-not (Test-Path -LiteralPath (Join-Path $ModelPath $file) -PathType Leaf)) { throw "Selected model is incomplete; missing $file in $ModelPath" }
  }
  if ($AudioPath) {
    if (-not (Test-Path -LiteralPath $AudioPath -PathType Leaf)) { throw "Inference smoke audio not found: $AudioPath" }
    $env:PIXEL_VOICE_SMOKE_MODEL = $ModelPath
    $env:PIXEL_VOICE_SMOKE_AUDIO = $AudioPath
    & $pythonExe -c 'import os; from faster_whisper import WhisperModel; m=WhisperModel(os.environ["PIXEL_VOICE_SMOKE_MODEL"],device="cpu",compute_type="int8",local_files_only=True); s,_=m.transcribe(os.environ["PIXEL_VOICE_SMOKE_AUDIO"],language="en",beam_size=3,vad_filter=True); print("Inference transcript:", " ".join(x.text.strip() for x in s))'
    $code = $LASTEXITCODE
    Remove-Item Env:\PIXEL_VOICE_SMOKE_MODEL,Env:\PIXEL_VOICE_SMOKE_AUDIO -ErrorAction SilentlyContinue
    if ($code -ne 0) { throw 'The selected model failed its local inference smoke test.' }
  } else {
    Write-Host 'Model files are complete. Pass -AudioPath <wav> to verify an actual inference.' -ForegroundColor Yellow
  }
} else {
  Write-Host 'No model directory checked. Pass -ModelPath <selected-model-dir> and optionally -AudioPath <wav> for model and inference validation.' -ForegroundColor Yellow
}

Write-Host "Voice development runtime is ready: $pythonExe" -ForegroundColor Green
