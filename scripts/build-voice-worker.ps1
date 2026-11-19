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

# Import native runtime dependencies inside the frozen executable. This catches
# missing CTranslate2/ONNX/eSpeak DLLs before electron-builder packages Pixel.
$smoke = New-Object System.Diagnostics.ProcessStartInfo
$smoke.FileName = $exe
$smoke.UseShellExecute = $false
$smoke.CreateNoWindow = $true
$smoke.RedirectStandardInput = $true
$smoke.RedirectStandardOutput = $true
$smoke.RedirectStandardError = $true
$smokeProcess = New-Object System.Diagnostics.Process
$smokeProcess.StartInfo = $smoke
if (-not $smokeProcess.Start()) { throw 'Could not start the packaged voice worker smoke test.' }
$stdoutTask = $smokeProcess.StandardOutput.ReadToEndAsync()
$stderrTask = $smokeProcess.StandardError.ReadToEndAsync()
$request = @{ id = 'pixel-runtime-smoke'; op = 'runtime_smoke_test'; protocol = 1; params = @{} } | ConvertTo-Json -Compress
# Write UTF-8 bytes without a BOM. StreamWriter's default input encoding differs
# between Windows PowerShell and PowerShell Core; a frozen CPython stdin parser
# must receive the same exact protocol bytes on both runtimes and GitHub runners.
if ($request -notmatch '^\s*\{.*\}\s*$') { throw "The packaged worker smoke request was not serialized as a JSON object: $request" }
$utf8NoBom = New-Object System.Text.UTF8Encoding -ArgumentList $false
$requestBytes = $utf8NoBom.GetBytes($request + "`n")
$smokeProcess.StandardInput.BaseStream.Write($requestBytes, 0, $requestBytes.Length)
$smokeProcess.StandardInput.BaseStream.Flush()
$smokeProcess.StandardInput.Close()
if (-not $smokeProcess.WaitForExit(30000)) {
  $smokeProcess.Kill()
  throw 'Packaged voice worker protocol/native dependency smoke test timed out.'
}
$smokeOutput = $stdoutTask.GetAwaiter().GetResult().Trim()
$smokeError = $stderrTask.GetAwaiter().GetResult().Trim()
if ($smokeProcess.ExitCode -ne 0) { throw "Packaged voice worker exited with $($smokeProcess.ExitCode): $smokeError" }
try { $smokeResult = $smokeOutput | ConvertFrom-Json }
catch { throw "Packaged voice worker returned invalid protocol JSON: $smokeOutput`n$smokeError" }
if ($smokeResult.id -ne 'pixel-runtime-smoke' -or -not $smokeResult.ok -or -not $smokeResult.result.onnxCpuProvider -or -not $smokeResult.result.espeakReady) {
  throw "Packaged voice worker runtime smoke test failed: $smokeOutput`n$smokeError"
}
Write-Host 'Packaged worker protocol, CTranslate2, ONNX Runtime CPU and eSpeak imports passed.' -ForegroundColor Green
Write-Host "Built bundled voice worker: $exe" -ForegroundColor Green
