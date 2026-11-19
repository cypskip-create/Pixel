[CmdletBinding()]
param(
  [string]$Python = $env:PIXEL_VOICE_BUILD_PYTHON
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $root '.venv-voice-build'
$pythonExe = Join-Path $venv 'Scripts\python.exe'
$requirements = Join-Path $root 'python\requirements-voice.txt'
$worker = Join-Path $root 'python\pixel_worker\worker.py'
$dist = Join-Path $root 'python\dist'
$work = Join-Path $root 'python\build'
$target = Join-Path $dist 'PixelVoiceWorker'

if (-not $Python) {
  if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
    throw 'Packaging the local voice runtime requires the Python 3.12 x64 build toolchain. Install Python 3.12 or set PIXEL_VOICE_BUILD_PYTHON.'
  }
  & py -3.12 -c 'import sys; assert sys.version_info[:2] == (3, 12), sys.version'
  if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 is required to build the packaged voice worker.' }
  if (-not (Test-Path $pythonExe)) { & py -3.12 -m venv $venv }
} else {
  if (-not (Test-Path $Python)) { throw "Configured voice build Python does not exist: $Python" }
  if (-not (Test-Path $pythonExe)) { & $Python -m venv $venv }
}

if (-not (Test-Path $pythonExe)) { throw "The isolated build environment was not created: $pythonExe" }
$version = & $pythonExe -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")'
if ($LASTEXITCODE -ne 0 -or $version.Trim() -ne '3.12') { throw "Voice runtime build requires Python 3.12, found $version." }

& $pythonExe -m pip install --disable-pip-version-check -r $requirements
if ($LASTEXITCODE -ne 0) { throw 'Could not install the pinned voice build dependencies.' }

& $pythonExe -m PyInstaller --noconfirm --clean --onedir --console --name PixelVoiceWorker `
  --distpath $dist --workpath $work `
  --collect-all faster_whisper --collect-all ctranslate2 --collect-all av `
  --collect-all onnxruntime --collect-all kokoro_onnx --collect-all phonemizer `
  --collect-all espeakng_loader `
  --hidden-import faster_whisper --hidden-import kokoro_onnx `
  $worker
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller failed to build PixelVoiceWorker.' }

$exe = Join-Path $target 'PixelVoiceWorker.exe'
if (-not (Test-Path $exe)) { throw "PyInstaller did not produce $exe" }
& $pythonExe -m pip freeze --all | Set-Content -Encoding utf8 (Join-Path $target 'DEPENDENCY_VERSIONS.txt')
Copy-Item -LiteralPath (Join-Path $root 'python\VOICE_RUNTIME_NOTICES.md') -Destination (Join-Path $target 'THIRD_PARTY_NOTICES.md') -Force
Write-Host "Built bundled voice worker: $exe" -ForegroundColor Green
