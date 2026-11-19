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
$pythonCommand = $Python
$pythonCommandArguments = @()

if (-not $Python) {
  if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
    throw 'Packaging the local voice runtime requires the Python 3.12 x64 build toolchain. Install Python 3.12 or set PIXEL_VOICE_BUILD_PYTHON.'
  }
  $pythonCommand = 'py'
  $pythonCommandArguments = @('-3.12')
} else {
  if (-not (Test-Path $Python)) { throw "Configured voice build Python does not exist: $Python" }
}

function Get-PythonRuntimeInfo {
  param(
    [string]$Command,
    [string[]]$CommandArguments = @()
  )

  # Keep this command free of nested quote characters. PowerShell 5.1 and 7
  # serialize strings passed to native commands differently; a nested Python
  # f-string was previously changed from `f"..."` to `f...` on CI.
  $versionProbe = 'import sys; print(sys.version_info[0] * 100 + sys.version_info[1])'
  $versionOutput = & $Command @CommandArguments -c $versionProbe 2>&1
  $versionExitCode = $LASTEXITCODE
  $versionText = ($versionOutput -join '').Trim()
  if ($versionExitCode -ne 0 -or $versionText -notmatch '^\d{3}$') {
    throw "Could not query the Python runtime through '$Command'. Install Python 3.12 x64 or set PIXEL_VOICE_BUILD_PYTHON to its python.exe. Details: $versionText"
  }

  $architectureProbe = 'import struct; print(struct.calcsize(chr(80)) * 8)'
  $architectureOutput = & $Command @CommandArguments -c $architectureProbe 2>&1
  $architectureExitCode = $LASTEXITCODE
  $architectureText = ($architectureOutput -join '').Trim()
  if ($architectureExitCode -ne 0 -or $architectureText -notmatch '^\d+$') {
    throw "Could not determine the Python runtime architecture. Details: $architectureText"
  }

  return [PSCustomObject]@{
    VersionCode = [int]$versionText
    Version = '{0}.{1}' -f ([int]($versionText / 100)), ([int]($versionText % 100))
    Bits = [int]$architectureText
  }
}

$runtime = Get-PythonRuntimeInfo -Command $pythonCommand -CommandArguments $pythonCommandArguments
if ($runtime.VersionCode -ne 312 -or $runtime.Bits -ne 64) {
  throw "Voice worker packaging requires Python 3.12 x64; configured interpreter is Python $($runtime.Version) $($runtime.Bits)-bit."
}

if (-not (Test-Path $pythonExe)) {
  & $pythonCommand @pythonCommandArguments -m venv $venv
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the isolated Python 3.12 voice build environment.' }
}
if (-not (Test-Path $pythonExe)) { throw "The isolated build environment was not created: $pythonExe" }
$venvRuntime = Get-PythonRuntimeInfo -Command $pythonExe
if ($venvRuntime.VersionCode -ne 312 -or $venvRuntime.Bits -ne 64) {
  throw "The isolated voice build environment must be Python 3.12 x64; found Python $($venvRuntime.Version) $($venvRuntime.Bits)-bit."
}

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

# Exercise the frozen worker with a deterministic Node-owned JSONL pipe. Avoid
# Windows PowerShell's native stdin pipeline/encoding conversions at this
# protocol boundary, and verify both runtime and capability response shapes.
$smokeHarness = Join-Path $root 'scripts\smoke-frozen-voice-worker.mjs'
& node $smokeHarness $exe
if ($LASTEXITCODE -ne 0) { throw "Packaged voice worker protocol/native dependency smoke test failed with exit code $LASTEXITCODE." }
Write-Host "Built bundled voice worker: $exe" -ForegroundColor Green
