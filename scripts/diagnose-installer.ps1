<#
.SYNOPSIS
    Read-only diagnostics for Pixel (formerly Cyps) on Windows.

.DESCRIPTION
    Collects everything needed to explain a failed install or a failed launch:
    architecture, running processes, installation locations, uninstall registry
    entries, executable presence, startup logs, relevant event-log entries,
    configuration conflicts and available installer logs.

    This script is strictly read-only. It does not:
      * modify the registry,
      * delete or move any file,
      * terminate any process,
      * require administrator rights.

    Run it from anywhere:

        powershell -NoProfile -ExecutionPolicy Bypass -File scripts\diagnose-installer.ps1

    Add -Report <path> to write the report to a file as well as the console.

.PARAMETER Report
    Optional path for a text report copy.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\diagnose-installer.ps1 -Report "$env:USERPROFILE\Desktop\pixel-report.txt"
#>
[CmdletBinding()]
param(
    [string]$Report = ''
)

$ErrorActionPreference = 'Continue'

# Everything is collected into this buffer so it can be printed and saved once.
$script:lines = New-Object System.Collections.Generic.List[string]

function Write-Line {
    param([string]$Text = '')
    $script:lines.Add($Text)
    Write-Host $Text
}

function Write-Head {
    param([string]$Title)
    Write-Line ''
    Write-Line $Title
    Write-Line ('=' * $Title.Length)
}

function Write-Item {
    param([string]$Label, [string]$Value)
    Write-Line ("  {0,-34} {1}" -f $Label, $Value)
}

function Write-Missing {
    param([string]$Message)
    Write-Line ("  ! {0}" -f $Message)
}

function Format-Bytes {
    param([Nullable[long]]$Bytes)
    if ($null -eq $Bytes) { return 'unknown' }
    return ('{0:N1} MB' -f ($Bytes / 1MB))
}

$productNames = @('Pixel', 'Cyps')
$exeNames = @('Pixel.exe', 'Cyps.exe')

Write-Line 'Pixel diagnostics'
Write-Line ("Generated {0}" -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))
Write-Line 'Read-only: nothing on this computer will be changed.'

# ---------------------------------------------------------------------------
Write-Head '1. Windows'

Write-Item 'Computer' $env:COMPUTERNAME
Write-Item 'User' $env:USERNAME
Write-Item 'PowerShell' $PSVersionTable.PSVersion.ToString()

try {
    $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
    Write-Item 'Windows' ("{0} (build {1})" -f $os.Caption, $os.BuildNumber)
    Write-Item 'Architecture' $os.OSArchitecture
    Write-Item 'Last boot' $os.LastBootUpTime
} catch {
    Write-Item 'Windows' ("$env:OS (CIM unavailable: {0})" -f $_.Exception.Message)
    Write-Item 'Architecture' $(if ([Environment]::Is64BitOperatingSystem) { '64-bit' } else { '32-bit' })
}

$isAdmin = $false
try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    $isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
} catch {
    # Leave as false.
}
Write-Item 'Elevated' $isAdmin

if ($env:ELECTRON_RUN_AS_NODE) {
    Write-Missing 'ELECTRON_RUN_AS_NODE is set. Electron will run as plain Node and no window can appear. Clear it before launching Pixel.'
} else {
    Write-Item 'ELECTRON_RUN_AS_NODE' 'not set (good)'
}

# ---------------------------------------------------------------------------
Write-Head '2. Running processes'

$foundAny = $false
foreach ($name in $exeNames) {
    $procs = Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($name)) -ErrorAction SilentlyContinue
    if ($procs) {
        $foundAny = $true
        foreach ($proc in $procs) {
            $path = 'unknown'
            try { if ($proc.Path) { $path = $proc.Path } } catch { }
            Write-Item $name ("pid {0}  started {1}" -f $proc.Id, $proc.StartTime)
            Write-Item '  path' $path
        }
    }
}

foreach ($name in @('Un_A.exe', 'Uninstall.exe', 'AU_.exe')) {
    $procs = Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($name)) -ErrorAction SilentlyContinue
    foreach ($proc in $procs) {
        $foundAny = $true
        Write-Item $name ("pid {0} (installer/uninstaller helper still running)" -f $proc.Id)
    }
}

# Processes that share our executable name are what an installer's process check
# reacts to. Report anything that merely contains it, so a name collision is
# visible.
$similar = Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ProcessName -match 'pixel|cyps'
} | Select-Object -First 10
if ($similar) {
    Write-Line '  Processes whose name contains pixel/cyps:'
    foreach ($proc in $similar) {
        Write-Line ("    - {0} (pid {1})" -f $proc.ProcessName, $proc.Id)
    }
}

if (-not $foundAny -and -not $similar) {
    Write-Item 'Result' 'no Pixel or Cyps process is running'
}

# ---------------------------------------------------------------------------
Write-Head '3. Installation locations'

$candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Pixel'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Cyps'),
    (Join-Path $env:PROGRAMFILES 'Pixel'),
    (Join-Path $env:PROGRAMFILES 'Cyps'),
    (Join-Path ${env:ProgramFiles(x86)} 'Pixel'),
    (Join-Path ${env:ProgramFiles(x86)} 'Cyps')
) | Where-Object { $_ -and $_ -notmatch '^\s*$' }

foreach ($dir in $candidates) {
    if (Test-Path -LiteralPath $dir) {
        Write-Item 'Found' $dir
        foreach ($exe in $exeNames) {
            $exePath = Join-Path $dir $exe
            if (Test-Path -LiteralPath $exePath) {
                $item = Get-Item -LiteralPath $exePath
                Write-Item ("  $exe") ("{0}  modified {1}" -f (Format-Bytes $item.Length), $item.LastWriteTime)
            }
        }
        foreach ($name in @('resources\app.asar', 'Uninstall Pixel.exe', 'Uninstall Cyps.exe')) {
            $file = Join-Path $dir $name
            if (Test-Path -LiteralPath $file) {
                Write-Item ("  $name") ((Get-Item -LiteralPath $file).LastWriteTime)
            }
        }
    }
}

# A partial install is the most common reason a repair loops: files present,
# uninstaller missing.
foreach ($dir in $candidates) {
    if (-not (Test-Path -LiteralPath $dir)) { continue }
    $hasExe = $false
    foreach ($exe in $exeNames) { if (Test-Path -LiteralPath (Join-Path $dir $exe)) { $hasExe = $true } }
    $hasUninstaller = (Test-Path -LiteralPath (Join-Path $dir 'Uninstall Pixel.exe')) -or (Test-Path -LiteralPath (Join-Path $dir 'Uninstall Cyps.exe'))
    if ($hasExe -and -not $hasUninstaller) {
        Write-Missing "Partial installation detected in $dir : the app is there but its uninstaller is missing. An upgrade will try to run that missing uninstaller and fail with a misleading 'cannot be closed' message."
    }
}

# ---------------------------------------------------------------------------
Write-Head '4. Uninstall registry entries'

$uninstallRoots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)

$registryFound = $false
foreach ($rootKey in $uninstallRoots) {
    if (-not (Test-Path $rootKey)) { continue }
    foreach ($key in Get-ChildItem $rootKey -ErrorAction SilentlyContinue) {
        $props = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
        if (-not $props) { continue }
        $displayName = [string]$props.DisplayName
        if ($displayName -notmatch 'Pixel|Cyps') { continue }

        $registryFound = $true
        Write-Line ''
        Write-Line ("  Key: {0}\{1}" -f $rootKey, $key.PSChildName)
        Write-Item 'DisplayName' $displayName
        Write-Item 'DisplayVersion' ([string]$props.DisplayVersion)
        Write-Item 'InstallLocation' ([string]$props.InstallLocation)
        Write-Item 'UninstallString' ([string]$props.UninstallString)
        Write-Item 'QuietUninstallString' ([string]$props.QuietUninstallString)
        Write-Item 'Publisher' ([string]$props.Publisher)

        # A registered product whose files are gone is the classic "repair
        # loops forever" state.
        $location = [string]$props.InstallLocation
        if ($location -and -not (Test-Path -LiteralPath $location)) {
            Write-Missing "The registered install location does not exist: $location"
        }
        $uninstallString = [string]$props.UninstallString
        if ($uninstallString -match '"([^"]+\.exe)"') {
            $uninstallerPath = $Matches[1]
            if (-not (Test-Path -LiteralPath $uninstallerPath)) {
                Write-Missing "The registered uninstaller is missing: $uninstallerPath"
                Write-Line '      This alone makes an upgrade fail after five retries with the misleading "cannot be closed" dialog.'
            }
        }
    }
}

if (-not $registryFound) {
    Write-Item 'Result' 'no Pixel or Cyps uninstall entry found (clean or never installed)'
}

# The installer's own identity, for reference: the uninstall key is a GUID
# derived from the appId. Both the Cyps and Pixel builds use
# com.cyps.companion => a5745318-c98a-51f9-87f5-f1c32713b276.
Write-Item 'Expected install GUID' 'a5745318-c98a-51f9-87f5-f1c32713b276'

# ---------------------------------------------------------------------------
Write-Head '5. Start menu and desktop shortcuts'

$shortcutDirs = @(
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
    (Join-Path $env:PROGRAMDATA 'Microsoft\Windows\Start Menu\Programs'),
    ([Environment]::GetFolderPath('Desktop')),
    ([Environment]::GetFolderPath('CommonDesktopDirectory'))
) | Where-Object { $_ }

$shortcutFound = $false
foreach ($dir in $shortcutDirs) {
    if (-not (Test-Path -LiteralPath $dir)) { continue }
    $links = Get-ChildItem -LiteralPath $dir -Filter '*.lnk' -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match 'Pixel|Cyps' }
    foreach ($link in $links) {
        $shortcutFound = $true
        Write-Item 'Shortcut' $link.FullName
        try {
            $shell = New-Object -ComObject WScript.Shell
            $target = $shell.CreateShortcut($link.FullName).TargetPath
            Write-Item '  target' $target
            if ($target -and -not (Test-Path -LiteralPath $target)) {
                Write-Missing "This shortcut points at a file that no longer exists: $target"
            }
        } catch {
            Write-Item '  target' 'unreadable'
        }
    }
}

if (-not $shortcutFound) { Write-Item 'Result' 'no Pixel or Cyps shortcuts found' }

# ---------------------------------------------------------------------------
Write-Head '6. User data (never modified by this script)'

foreach ($name in @('Pixel', 'cyps', 'Cyps')) {
    $dir = Join-Path $env:APPDATA $name
    if (Test-Path -LiteralPath $dir) {
        Write-Item 'Data directory' $dir
        $settings = Join-Path $dir 'settings.json'
        if (Test-Path -LiteralPath $settings) {
            Write-Item '  settings.json' ('{0} bytes' -f (Get-Item -LiteralPath $settings).Length)
        } else {
            Write-Item '  settings.json' 'missing'
        }
        $keyFile = Join-Path $dir 'credentials\deepseek.key'
        if (Test-Path -LiteralPath $keyFile) {
            $raw = Get-Content -LiteralPath $keyFile -Raw -ErrorAction SilentlyContinue
            if ($raw -match 'sk-[A-Za-z0-9]{8,}') {
                Write-Missing 'The API key file appears to contain PLAINTEXT. Remove it and re-enter the key in Settings.'
            } else {
                Write-Item '  API key' 'present and encrypted'
            }
        }
        $logFile = Join-Path $dir 'pixel-startup.log'
        if (Test-Path -LiteralPath $logFile) {
            Write-Item '  startup log' ('{0} bytes' -f (Get-Item -LiteralPath $logFile).Length)
        }
    }
}

if ((Test-Path -LiteralPath (Join-Path $env:APPDATA 'cyps')) -and (Test-Path -LiteralPath (Join-Path $env:APPDATA 'Pixel'))) {
    Write-Item 'Migration' 'both legacy and new data directories exist; the legacy one is kept as a backup'
}

# ---------------------------------------------------------------------------
Write-Head '7. Startup log (last 40 lines)'

$logPaths = @(
    (Join-Path $env:APPDATA 'Pixel\pixel-startup.log'),
    (Join-Path $env:APPDATA 'cyps\pixel-startup.log')
) | Where-Object { Test-Path -LiteralPath $_ }

if ($logPaths.Count -eq 0) {
    Write-Item 'Result' 'no startup log found (Pixel has not run yet, or failed before logging)'
} else {
    foreach ($logPath in $logPaths) {
        Write-Line ''
        Write-Line ("  --- {0} ---" -f $logPath)
        Get-Content -LiteralPath $logPath -Tail 40 | ForEach-Object { Write-Line ("  {0}" -f $_) }
    }
}

# ---------------------------------------------------------------------------
Write-Head '8. Application event log (last 7 days)'

try {
    $since = (Get-Date).AddDays(-7)
    $events = Get-WinEvent -FilterHashtable @{
        LogName   = 'Application'
        StartTime = $since
    } -MaxEvents 400 -ErrorAction Stop |
        Where-Object { $_.ProviderName -match 'Application Error|Application Hang|.NET Runtime|Windows Error Reporting' -and $_.Message -match 'Pixel|Cyps' } |
        Select-Object -First 10

    if (-not $events) {
        Write-Item 'Result' 'no crash entries mentioning Pixel or Cyps'
    } else {
        foreach ($event in $events) {
            Write-Line ''
            Write-Line ("  {0}  {1}  id={2}" -f $event.TimeCreated, $event.ProviderName, $event.Id)
            $message = ($event.Message -split "`n" | Select-Object -First 4) -join ' '
            Write-Line ("    {0}" -f $message.Trim())
        }
    }
} catch {
    Write-Item 'Result' ("event log unavailable: {0}" -f $_.Exception.Message)
}

# ---------------------------------------------------------------------------
Write-Head '9. Existing installer logs and temp files'

$logCandidates = @(
    (Join-Path $env:TEMP 'Pixel*.log'),
    (Join-Path $env:TEMP 'Cyps*.log'),
    (Join-Path $env:TEMP 'nsis*.log')
)
$logFound = $false
foreach ($pattern in $logCandidates) {
    $files = Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue | Select-Object -First 5
    foreach ($file in $files) {
        $logFound = $true
        Write-Item 'Log' ("{0}  ({1}, modified {2})" -f $file.FullName, (Format-Bytes $file.Length), $file.LastWriteTime)
    }
}
if (-not $logFound) {
    Write-Item 'Result' 'no installer logs found'
    Write-Line '  Tip: to capture one, run the installer with logging:'
    Write-Line '       Pixel-Setup-0.2.1.exe /S /D=C:\Temp\PixelTest   (silent)'
    Write-Line '       or use: msiexec-style logging is not available for NSIS; instead set'
    Write-Line '       $env:DEBUG="electron-builder" before building to keep the temp script.'
}

# Look for NSIS leftovers that indicate an interrupted run.
$nsisTemp = Get-ChildItem -Path $env:TEMP -Directory -Filter 'ns*.tmp' -ErrorAction SilentlyContinue |
    Select-Object -First 5
if ($nsisTemp) {
    Write-Line ''
    Write-Line '  NSIS temporary directories (normal if empty, suspicious if large):'
    foreach ($dir in $nsisTemp) {
        Write-Line ("    {0}  modified {1}" -f $dir.Name, $dir.LastWriteTime)
    }
}

# ---------------------------------------------------------------------------
Write-Head '10. Potential configuration conflicts'

$conflicts = 0

# Several installs at once.
$existingDirs = @()
foreach ($dir in $candidates) { if (Test-Path -LiteralPath $dir) { $existingDirs += $dir } }
if ($existingDirs.Count -gt 1) {
    $conflicts++
    Write-Missing ("More than one installation directory exists: {0}" -f ($existingDirs -join '; '))
}
if ($existingDirs.Count -eq 0) {
    Write-Item 'Installation directories' 'none found'
}

# Multiple uninstall entries for the same product.
$entryCount = ($script:lines | Where-Object { $_ -match '^\s+DisplayName\s+(Pixel|Cyps)' } | Measure-Object).Count
if ($entryCount -gt 1) {
    $conflicts++
    Write-Missing ("{0} uninstall entries found. A duplicate entry usually means a previous install was not removed." -f $entryCount)
}

# A running instance while installation is attempted.
$running = @()
foreach ($name in $exeNames) {
    $procs = Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($name)) -ErrorAction SilentlyContinue
    if ($procs) { $running += $name }
}
if ($running.Count -gt 0) {
    $conflicts++
    Write-Missing ("Running now: {0}. An installer needs these closed; a hidden tray instance counts." -f ($running -join ', '))
}

# Portable/unpacked copies lying around can be launched by accident and then
# hold the process check open.
$looseExes = Get-ChildItem -Path (Join-Path $env:USERPROFILE 'Downloads') -Filter 'Pixel*.exe' -ErrorAction SilentlyContinue |
    Select-Object -First 5
foreach ($exe in $looseExes) {
    Write-Item 'Loose copy' $exe.FullName
}

if ($conflicts -eq 0) {
    Write-Item 'Result' 'no configuration conflicts detected'
}

# ---------------------------------------------------------------------------
Write-Head 'Summary'

$warnings = ($script:lines | Where-Object { $_ -match '^\s+! ' } | Measure-Object).Count
Write-Item 'Attention items' $warnings
Write-Line ''
Write-Line 'Safe next steps (nothing here requires a reboot):'
Write-Line '  1. If a Pixel or Cyps process is listed above, end it from Task Manager > Details.'
Write-Line '  2. Prefer the ZIP or Portable build to confirm the app itself works:'
Write-Line '       Pixel-Windows-Unpacked-0.2.1.zip  -> extract, run Pixel.exe'
Write-Line '       Pixel-Portable-0.2.1.exe          -> run directly, nothing installed'
Write-Line '  3. If the uninstall entry is broken, remove it through Settings > Apps'
Write-Line '     (Installed apps) rather than editing the registry by hand.'
Write-Line '  4. Your data in %APPDATA%\Pixel (and the older %APPDATA%\cyps) is never'
Write-Line '     deleted by the installer. Copy it somewhere safe before experimenting.'

if ($Report) {
    try {
        $script:lines -join "`r`n" | Set-Content -LiteralPath $Report -Encoding UTF8
        Write-Host ''
        Write-Host ("Report written to {0}" -f $Report) -ForegroundColor Green
    } catch {
        Write-Host ("Could not write the report: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
    }
}

Write-Host ''
Write-Host 'Diagnostics complete. No changes were made.' -ForegroundColor Green
exit 0
