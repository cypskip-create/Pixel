<#
.SYNOPSIS
    Capture exactly what happens when Pixel starts on Windows.

.DESCRIPTION
    Launches Pixel (or the portable build), waits, and records the evidence that
    a silent startup failure normally destroys:

      * the process exit code;
      * whether any top-level window was created, and its bounds;
      * the startup log, from every location it can be written to;
      * the last-exit marker;
      * self-check output, which needs no window at all.

    It then prints a short verdict saying where the failure happened, so the
    result can be read without interpreting the log by hand.

    Read-only apart from writing the report and reading logs. It never kills
    unrelated processes and never changes the registry.

.PARAMETER Exe
    Path to Pixel.exe. Defaults to release\win-unpacked\Pixel.exe.

.PARAMETER Seconds
    How long to let Pixel run before inspecting it. Default 12.

.PARAMETER SelfCheck
    Only run `--pixel-selfcheck` and report; do not start the GUI.

.PARAMETER Report
    Optional path for a text report.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\capture-startup.ps1 -SelfCheck
    powershell -ExecutionPolicy Bypass -File scripts\capture-startup.ps1 -Exe "$env:LOCALAPPDATA\Programs\Pixel\Pixel.exe"
#>
[CmdletBinding()]
param(
    [string]$Exe = '',
    [int]$Seconds = 12,
    [switch]$SelfCheck,
    [string]$Report = ''
)

$ErrorActionPreference = 'Continue'
$lines = New-Object System.Collections.Generic.List[string]

function W {
    param([string]$Text = '')
    $lines.Add($Text)
    Write-Host $Text
}

function Head {
    param([string]$Title)
    W ''
    W $Title
    W ('-' * $Title.Length)
}

if ([string]::IsNullOrWhiteSpace($Exe)) {
    $repoRoot = Split-Path -Parent $PSScriptRoot
    $Exe = Join-Path $repoRoot 'release\win-unpacked\Pixel.exe'
}

Head 'Pixel startup capture'
W ("Time      : {0}" -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))
W ("Executable: {0}" -f $Exe)

if (-not (Test-Path -LiteralPath $Exe)) {
    W ''
    W "FAIL: Pixel.exe not found at $Exe"
    W 'Build it first:  npm run dist'
    exit 1
}

# A globally set ELECTRON_RUN_AS_NODE makes Electron behave as plain Node: no
# Chromium, no window. Clear it for the child process only.
if ($env:ELECTRON_RUN_AS_NODE) {
    W ''
    W 'NOTE: ELECTRON_RUN_AS_NODE was set. Unsetting it for this run only -'
    W '      with it set, no Electron application can show a window.'
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
}

function Find-Logs {
    $candidates = @(
        (Join-Path $env:APPDATA 'Pixel\pixel-startup.log'),
        (Join-Path $env:APPDATA 'cyps\pixel-startup.log'),
        (Join-Path $env:TEMP 'Pixel\pixel-startup.log'),
        (Join-Path $env:USERPROFILE 'Pixel-logs\pixel-startup.log'),
        (Join-Path (Get-Location) 'pixel-startup.log')
    )
    return $candidates | Where-Object { Test-Path -LiteralPath $_ }
}

function Find-Markers {
    $candidates = @(
        (Join-Path $env:APPDATA 'Pixel\pixel-last-exit.json'),
        (Join-Path $env:APPDATA 'cyps\pixel-last-exit.json'),
        (Join-Path $env:TEMP 'Pixel\pixel-last-exit.json')
    )
    return $candidates | Where-Object { Test-Path -LiteralPath $_ }
}

# ---------------------------------------------------------------------------
Head '1. Self-check (no window required)'

# A GUI-subsystem executable is not attached to this console, so stdout can be
# discarded. The self-check also writes a JSON report next to its log; read that
# file first and use stdout only as a fallback.
$selfCheckOutput = & $Exe --pixel-selfcheck 2>&1 | Out-String
if ($selfCheckOutput.Trim().Length -gt 0) { W $selfCheckOutput.Trim() }

$selfCheckJson = $null
$reportFile = @(
    (Join-Path $env:APPDATA 'Pixel\pixel-selfcheck.json'),
    (Join-Path $env:APPDATA 'cyps\pixel-selfcheck.json'),
    (Join-Path $env:TEMP 'Pixel\pixel-selfcheck.json')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if ($reportFile) {
    W ("(self-check report read from {0})" -f $reportFile)
    try { $selfCheckJson = Get-Content -LiteralPath $reportFile -Raw | ConvertFrom-Json } catch { }
}

$selfCheckOk = $false
if ($selfCheckJson) {
    $selfCheckOk = [bool]$selfCheckJson.ok
    W ("Self-check ok={0}, problems={1}" -f $selfCheckJson.ok, @($selfCheckJson.problems).Count)
    foreach ($problem in @($selfCheckJson.problems)) { W ("  - {0}" -f $problem) }
} else {
    $selfCheckOk = $selfCheckOutput -match '"ok"\s*:\s*true'
}

if ($SelfCheck) {
    Head 'Verdict'
    if ($selfCheckOk) {
        W 'Self-check PASSED: the bundle is complete and Electron initialises.'
        W 'If no window appears, run again without -SelfCheck to capture the GUI attempt.'
    } else {
        W 'Self-check FAILED: fix the problems listed above before testing the GUI.'
        if ($selfCheckJson -and $selfCheckJson.paths) {
            W ("Log file: {0}" -f $selfCheckJson.paths.log)
        }
    }
    if ($Report) { $lines -join "`r`n" | Set-Content -LiteralPath $Report -Encoding UTF8; W ''; W "Report: $Report" }
    exit $(if ($selfCheckOk) { 0 } else { 1 })
}

# ---------------------------------------------------------------------------
Head '2. Launching the GUI'

$startedAt = Get-Date
# --enable-logging writes Chromium's own diagnostics to a file. That captures a
# failure that happens BEFORE any of our JavaScript runs - the case where there
# is no application log and no event-log entry, which is the hardest to diagnose.
$chromiumLog = Join-Path $env:TEMP 'pixel-chromium.log'
Remove-Item -LiteralPath $chromiumLog -Force -ErrorAction SilentlyContinue
$process = Start-Process -FilePath $Exe -ArgumentList '--enable-logging', "--log-file=$chromiumLog" -PassThru -ErrorAction SilentlyContinue
if (-not $process) {
    W 'FAIL: Start-Process could not launch Pixel at all.'
    exit 1
}

W ("Started pid {0}" -f $process.Id)

$windowHandle = [IntPtr]::Zero
$deadline = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $process.Refresh()
    if ($process.HasExited) { break }

    $mainHandle = $process.MainWindowHandle
    if ($mainHandle -ne [IntPtr]::Zero) {
        $windowHandle = $mainHandle
        break
    }
}

Start-Sleep -Milliseconds 700
$process.Refresh()

Head '3. Result'

if ($process.HasExited) {
    W ("EXITED with code {0}" -f $process.ExitCode)
    W 'A nonzero code means the process died during startup. The startup log below'
    W 'records the last stage it reached; that is where the failure is.'
} else {
    W 'STILL RUNNING'
    if ($windowHandle -ne [IntPtr]::Zero) {
        W 'A top-level window exists - the avatar should be visible.'
    } else {
        W 'WARNING: running but no top-level window was reported.'
        W 'The process may be tray-only, or the renderer never painted.'
    }
}

if ($windowHandle -ne [IntPtr]::Zero) {
    try {
        Add-Type -Namespace PixelCapture -Name Win -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
[DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int index);
'@ -ErrorAction Stop
        $rect = New-Object PixelCapture.Win+RECT
        [void][PixelCapture.Win]::GetWindowRect($windowHandle, [ref]$rect)
        $w = $rect.Right - $rect.Left
        $h = $rect.Bottom - $rect.Top
        W ("Window: {0}x{1} at {2},{3}" -f $w, $h, $rect.Left, $rect.Top)
        $exStyle = [PixelCapture.Win]::GetWindowLong($windowHandle, -20)
        W ("Always on top: {0}" -f (($exStyle -band 0x8) -ne 0))
        W ("Transparent/layered: {0}" -f (($exStyle -band 0x80000) -ne 0))
    } catch {
        W ("Could not read window geometry: {0}" -f $_.Exception.Message)
    }
}

# ---------------------------------------------------------------------------
Head '4. Startup log'

$logs = Find-Logs
if (-not $logs) {
    W 'No startup log was written anywhere that was checked.'
    W 'This means the process failed before the boot logger could write - which'
    W 'points at the executable itself, the asar bundle, or Electron failing to'
    W 'initialise - or it never actually started.'
} else {
    foreach ($log in $logs) {
        W ''
        W ("--- {0} ---" -f $log)
        Get-Content -LiteralPath $log -Tail 60 | ForEach-Object { W ("  {0}" -f $_) }
    }
}

Head '4b. Chromium log (pre-JavaScript failures)'
if (Test-Path -LiteralPath $chromiumLog) {
    $chromiumContent = Get-Content -LiteralPath $chromiumLog -Tail 25
    if ($chromiumContent) { foreach ($entry in $chromiumContent) { W ("  {0}" -f $entry) } }
    else { W '(empty)' }
} else {
    W 'No Chromium log was produced. The executable did not reach Chromium startup,'
    W 'or the flag was ignored - which usually means the process never ran our code.'
}

Head '5. Last exit marker'

$markers = Find-Markers
if (-not $markers) {
    W 'No exit marker found (it is written when the process exits normally).'
} else {
    foreach ($marker in $markers) {
        W ("{0}: {1}" -f $marker, (Get-Content -LiteralPath $marker -Raw).Trim())
    }
}

# ---------------------------------------------------------------------------
Head '6. Processes still running'

$running = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^(Pixel|Cyps)$' }
if ($running) {
    foreach ($proc in $running) {
        $path = 'unknown'
        try { if ($proc.Path) { $path = $proc.Path } } catch { }
        W ("{0} pid {1}  {2}" -f $proc.ProcessName, $proc.Id, $path)
    }
} else {
    W 'none'
}

if (-not $process.HasExited) {
    W ''
    W ("Pixel is still running (pid {0}). Stop it with: Stop-Process -Id {0}" -f $process.Id)
}

# ---------------------------------------------------------------------------
Head 'Verdict'

if ($process.HasExited) {
    $code = $process.ExitCode
    if ($code -eq 0) {
        W 'Pixel exited cleanly (code 0).'
        W 'If a window flashed and closed, check whether window-all-closed is quitting:'
        W 'Pixel is tray-resident, so that would be a bug worth reporting.'
    } else {
        W ("Pixel exited with code {0} during startup." -f $code)
        W 'Read the last log line above: it names the stage that failed.'
        W 'Common causes: incomplete installation (missing asar), a missing'
        W 'renderer build, or Electron unable to initialise in this session.'
    }
} elseif ($windowHandle -ne [IntPtr]::Zero) {
    W 'Pixel started and created a window. If the avatar is still not visible,'
    W 'the window may be positioned off-screen: check the bounds above.'
} else {
    W 'Pixel is running but created no window.'
    W 'Open the log above and look for "ready-to-show" or "renderer failed to load".'
}

if ($Report) {
    $lines -join "`r`n" | Set-Content -LiteralPath $Report -Encoding UTF8
    W ''
    W "Report written to $Report"
}

W ''
W 'Capture complete.'
exit 0
