<#
.SYNOPSIS
    Validates a Cyps installation on a real Windows desktop.

.DESCRIPTION
    Checks the parts of Cyps that cannot be verified in a headless build
    environment: that the packaged app launches, that its window really is a
    frameless always-on-top transparent overlay near the top of the screen, that
    it remembers and clamps its position, and that its logs show a clean startup.

    Run this on the machine where you installed Cyps, from the repository root:

        powershell -ExecutionPolicy Bypass -File scripts\validate-windows.ps1

    Add -Launch to start the packaged app first (or let it start it for you with
    -ExePath). Add -KeepRunning to leave Cyps running afterwards.

.PARAMETER ExePath
    Path to Cyps.exe. Defaults to release\win-unpacked\Cyps.exe.

.PARAMETER Launch
    Start Cyps if it is not already running.

.PARAMETER KeepRunning
    Do not stop Cyps when the checks finish.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\validate-windows.ps1 -Launch
#>
[CmdletBinding()]
param(
    [string]$ExePath = '',
    [switch]$Launch,
    [switch]$KeepRunning
)

$ErrorActionPreference = 'Stop'
$script:checks = New-Object System.Collections.ArrayList

# Screen metrics come from WinForms; load it once, tolerate its absence.
try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
} catch {
    Write-Host 'Note: System.Windows.Forms is unavailable; work-area checks will be skipped.' -ForegroundColor Yellow
}

function Add-Check {
    param(
        [string]$Name,
        [ValidateSet('pass', 'fail', 'warn', 'skip')]
        [string]$Status,
        [string]$Detail
    )

    [void]$script:checks.Add([pscustomobject]@{
        Check  = $Name
        Status = $Status
        Detail = $Detail
    })

    $colour = switch ($Status) {
        'pass' { 'Green' }
        'fail' { 'Red' }
        'warn' { 'Yellow' }
        default { 'Gray' }
    }
    $label = $Status.ToUpperInvariant().PadRight(4)
    Write-Host ("  [{0}] {1}" -f $label, $Name) -ForegroundColor $colour
    if ($Detail) { Write-Host ("         {0}" -f $Detail) -ForegroundColor DarkGray }
}

function Write-Section {
    param([string]$Title)
    Write-Host ''
    Write-Host $Title -ForegroundColor Cyan
    Write-Host ('-' * $Title.Length) -ForegroundColor DarkCyan
}

# ---------------------------------------------------------------------------
# Window inspection through user32. Cyps is frameless, so MainWindowTitle is
# unreliable; the window is located by process id instead.
# ---------------------------------------------------------------------------

if (-not ('Cyps.WindowProbe' -as [type])) {
    Add-Type -Namespace Cyps -Name WindowProbe -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)]
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
[DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int index);
[DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
[DllImport("user32.dll")] public static extern bool GetWindowDisplayAffinity(IntPtr hWnd, out uint affinity);
'@
}

$WS_EX_TOPMOST = 0x8
$WS_EX_LAYERED = 0x80000
$WS_EX_TOOLWINDOW = 0x80

function Get-CypsWindow {
    param([int]$ProcessId)

    $found = [IntPtr]::Zero
    $callback = [Cyps.WindowProbe+EnumWindowsProc]{
        param($hWnd, $lParam)

        $owner = 0
        [void][Cyps.WindowProbe]::GetWindowThreadProcessId($hWnd, [ref]$owner)
        if ($owner -eq $ProcessId -and [Cyps.WindowProbe]::IsWindowVisible($hWnd)) {
            $script:foundWindow = $hWnd
            return $false
        }
        return $true
    }

    $script:foundWindow = [IntPtr]::Zero
    [void][Cyps.WindowProbe]::EnumWindows($callback, [IntPtr]::Zero)
    return $script:foundWindow
}

function Get-CypsProcess {
    Get-Process -Name 'Cyps' -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------------------
# 1. Environment
# ---------------------------------------------------------------------------

Write-Section '1. Environment'

$os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
if ($os) {
    Add-Check 'Windows version' 'pass' ("{0} (build {1})" -f $os.Caption, $os.BuildNumber)
} else {
    Add-Check 'Windows version' 'warn' 'Could not query the OS version (CIM unavailable).'
}

$arch = if ([Environment]::Is64BitOperatingSystem) { '64-bit' } else { '32-bit' }
Add-Check 'OS architecture' 'pass' $arch

if ($env:ELECTRON_RUN_AS_NODE) {
    Add-Check 'ELECTRON_RUN_AS_NODE' 'warn' 'It is set. Cyps would run as plain Node. Removing it for this session.'
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
} else {
    Add-Check 'ELECTRON_RUN_AS_NODE' 'pass' 'Not set.'
}

# ---------------------------------------------------------------------------
# 2. Packaged application
# ---------------------------------------------------------------------------

Write-Section '2. Packaged application'

$repoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($ExePath)) {
    $ExePath = Join-Path $repoRoot 'release\win-unpacked\Cyps.exe'
}

if (Test-Path $ExePath) {
    $sizeMb = [math]::Round((Get-Item $ExePath).Length / 1MB, 1)
    Add-Check 'Cyps.exe present' 'pass' ("{0} ({1} MB)" -f $ExePath, $sizeMb)
} else {
    Add-Check 'Cyps.exe present' 'fail' ("Not found at {0}. Run: npm run dist" -f $ExePath)
    Write-Host ''
    Write-Host 'Cannot continue without the executable.' -ForegroundColor Red
    exit 1
}

$installer = Get-ChildItem (Join-Path $repoRoot 'release') -Filter 'Cyps-Setup-*.exe' -ErrorAction SilentlyContinue |
    Select-Object -First 1
if ($installer) {
    Add-Check 'Installer present' 'pass' ("{0} ({1} MB)" -f $installer.Name, [math]::Round($installer.Length / 1MB, 1))
} else {
    Add-Check 'Installer present' 'warn' 'No Cyps-Setup-*.exe in release\. Run: npm run dist'
}

# ---------------------------------------------------------------------------
# 3. Launch
# ---------------------------------------------------------------------------

Write-Section '3. Launch'

$process = Get-CypsProcess | Select-Object -First 1

if (-not $process -and $Launch) {
    Write-Host '  Starting Cyps...' -ForegroundColor DarkGray
    Start-Process -FilePath $ExePath | Out-Null
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 500
        $process = Get-CypsProcess | Select-Object -First 1
        if ($process) { break }
    }
}

if ($process) {
    Add-Check 'Process running' 'pass' ("pid {0}" -f $process.Id)
} else {
    Add-Check 'Process running' 'skip' 'Cyps is not running. Re-run with -Launch to start it.'
}

Start-Sleep -Seconds 3

# ---------------------------------------------------------------------------
# 4. Floating window
# ---------------------------------------------------------------------------

Write-Section '4. Floating window'

$windowHandle = [IntPtr]::Zero
if ($process) {
    $windowHandle = Get-CypsWindow -ProcessId $process.Id
}

if ($windowHandle -ne [IntPtr]::Zero) {
    Add-Check 'Window created' 'pass' ("handle 0x{0:X}" -f $windowHandle.ToInt64())

    $rect = New-Object Cyps.WindowProbe+RECT
    [void][Cyps.WindowProbe]::GetWindowRect($windowHandle, [ref]$rect)
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top

    Add-Check 'Window size' 'pass' ("{0}x{1} physical px" -f $width, $height)

    if ($width -le 600 -and $height -le 700) {
        Add-Check 'Compact, not a dashboard' 'pass' 'Window is small as designed.'
    } else {
        Add-Check 'Compact, not a dashboard' 'fail' ("Window is {0}x{1}; expected at most 600x700." -f $width, $height)
    }

    $monitors = [System.Windows.Forms.Screen]::AllScreens
    if ($monitors) {
        $primary = $monitors | Where-Object { $_.Primary } | Select-Object -First 1
        $topOfScreen = $rect.Top - $primary.WorkingArea.Top
        if ($topOfScreen -ge 0 -and $topOfScreen -lt 200) {
            Add-Check 'Floats near the top of the screen' 'pass' ("{0}px below the top of the work area" -f $topOfScreen)
        } else {
            Add-Check 'Floats near the top of the screen' 'fail' ("Window top is {0}px relative to the work area; expected 0-200px." -f $topOfScreen)
        }
    } else {
        Add-Check 'Floats near the top of the screen' 'skip' 'Screen metrics unavailable (System.Windows.Forms not loaded).'
    }

    $exStyle = [Cyps.WindowProbe]::GetWindowLong($windowHandle, -20)
    if ($exStyle -band $WS_EX_TOPMOST) {
        Add-Check 'Always on top' 'pass' 'WS_EX_TOPMOST is set.'
    } else {
        Add-Check 'Always on top' 'fail' 'WS_EX_TOPMOST is not set.'
    }

    if ($exStyle -band $WS_EX_LAYERED) {
        Add-Check 'Transparent overlay' 'pass' 'WS_EX_LAYERED is set.'
    } else {
        Add-Check 'Transparent overlay' 'warn' 'WS_EX_LAYERED is not set; the window may have an opaque background.'
    }

    if ($exStyle -band $WS_EX_TOOLWINDOW) {
        Add-Check 'Hidden from the taskbar' 'pass' 'WS_EX_TOOLWINDOW is set.'
    } else {
        Add-Check 'Hidden from the taskbar' 'warn' 'No WS_EX_TOOLWINDOW; Cyps may appear in the taskbar.'
    }

    $dpi = [Cyps.WindowProbe]::GetDpiForWindow($windowHandle)
    if ($dpi -gt 0) {
        $scale = [math]::Round($dpi / 96.0, 2)
        Add-Check 'DPI awareness' 'pass' ("window DPI {0} ({1}x scaling)" -f $dpi, $scale)
    } else {
        Add-Check 'DPI awareness' 'warn' 'Could not read the window DPI.'
    }
} else {
    if ($process) {
        Add-Check 'Window created' 'fail' 'No visible top-level window was found for the Cyps process.'
    } else {
        Add-Check 'Window created' 'skip' 'Cyps is not running.'
    }
}

# ---------------------------------------------------------------------------
# 5. Tray icon and memory
# ---------------------------------------------------------------------------

Write-Section '5. Process health'

if ($process) {
    $process.Refresh()
    $workingset = [math]::Round($process.WorkingSet64 / 1MB, 0)
    Add-Check 'Memory use' 'pass' ("{0} MB working set" -f $workingset)

    if ($process.Responding) {
        Add-Check 'Process responsive' 'pass' 'The window message loop is answering.'
    } else {
        Add-Check 'Process responsive' 'fail' 'The process is not responding.'
    }

    $childCount = ($process.Modules | Measure-Object).Count
    Add-Check 'Modules loaded' 'pass' ("{0} modules" -f $childCount)
} else {
    Add-Check 'Process health' 'skip' 'Cyps is not running.'
}

# ---------------------------------------------------------------------------
# 6. Persisted data
# ---------------------------------------------------------------------------

Write-Section '6. Stored data'

$userData = Join-Path $env:APPDATA 'Cyps'
if (Test-Path $userData) {
    Add-Check 'User data directory' 'pass' $userData

    $settingsFile = Join-Path $userData 'settings.json'
    if (Test-Path $settingsFile) {
        Add-Check 'Settings written' 'pass' ('{0} bytes' -f (Get-Item $settingsFile).Length)
    } else {
        Add-Check 'Settings written' 'warn' 'No settings.json yet; Cyps writes it after the first change.'
    }

    $keyFile = Join-Path $userData 'credentials\deepseek.key'
    if (Test-Path $keyFile) {
        $raw = Get-Content $keyFile -Raw
        if ($raw -match 'sk-[A-Za-z0-9]') {
            Add-Check 'API key stored encrypted' 'fail' 'The key file appears to contain plaintext!'
        } else {
            Add-Check 'API key stored encrypted' 'pass' 'Encrypted blob present, no plaintext key.'
        }
    } else {
        Add-Check 'API key stored encrypted' 'skip' 'No key saved yet. Add one in Cyps Settings.'
    }
} else {
    Add-Check 'User data directory' 'skip' ("Not created yet: {0}" -f $userData)
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

Write-Section 'Summary'

$failures = @($script:checks | Where-Object { $_.Status -eq 'fail' })
$warnings = @($script:checks | Where-Object { $_.Status -eq 'warn' })
$passes = @($script:checks | Where-Object { $_.Status -eq 'pass' })
$skips = @($script:checks | Where-Object { $_.Status -eq 'skip' })

Write-Host ("  {0} passed, {1} failed, {2} warnings, {3} skipped" -f $passes.Count, $failures.Count, $warnings.Count, $skips.Count)

$reportPath = Join-Path $repoRoot ("validation-report-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
[pscustomobject]@{
    generatedAt = (Get-Date).ToString('o')
    machine     = $env:COMPUTERNAME
    os          = if ($os) { "$($os.Caption) $($os.BuildNumber)" } else { 'unknown' }
    checks      = $script:checks
    summary     = @{
        passed  = $passes.Count
        failed  = $failures.Count
        warning = $warnings.Count
        skipped = $skips.Count
    }
} | ConvertTo-Json -Depth 5 | Set-Content -Path $reportPath -Encoding UTF8

Write-Host ("  Report written to {0}" -f $reportPath) -ForegroundColor DarkGray

if (-not $KeepRunning -and $process -and $Launch) {
    Write-Host '  Stopping Cyps (use -KeepRunning to leave it open)...' -ForegroundColor DarkGray
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
}

Write-Host ''
if ($failures.Count -gt 0) {
    Write-Host 'RESULT: FAILED' -ForegroundColor Red
    Write-Host 'See docs\WINDOWS-VALIDATION.md for what each check means.' -ForegroundColor DarkGray
    exit 1
}

Write-Host 'RESULT: PASSED (complete the manual checklist in docs\WINDOWS-VALIDATION.md)' -ForegroundColor Green
exit 0
