<#
.SYNOPSIS
  Finds and (with -Apply) clears stale Pixel/Cyps installer state that makes the
  NSIS installer fail with "Pixel cannot be closed" or
  "Error opening file for writing: ...\Uninstall Pixel.exe".

.DESCRIPTION
  Why this exists
  ---------------
  On an upgrade, electron-builder's installer does NOT use the folder you pick.
  It reads the previous install location and uninstaller from the registry, runs
  the old uninstaller silently, and treats any non-zero exit code as "cannot be
  closed". A half-finished earlier install leaves exactly that registration
  behind, so every later install fails the same way no matter which folder you
  choose. A process (or antivirus scan) holding "Uninstall Pixel.exe" open
  produces the second error.

  Default run is READ-ONLY: it only reports.

  With -Apply it will, after you type YES:
    1. stop only Pixel/Cyps installer and uninstaller processes that belong to you
    2. back up the two installer registry keys to a .reg file
    3. rename the install folder to Pixel.stale-<timestamp> (a rename fails if a
       file is locked, and the script then names the process holding it)
    4. delete the two installer registry keys

  It NEVER touches %APPDATA%\Pixel, %APPDATA%\Cyps, %LOCALAPPDATA%\Pixel
  (conversations, settings, API keys, memory, logs).

  Run in a normal (non-admin) PowerShell window, as the same user that installs.

.EXAMPLE
  .\scripts\repair-install-state.ps1            # report only
  .\scripts\repair-install-state.ps1 -Apply     # report, then clean up after YES
#>
[CmdletBinding()]
param(
  [switch]$Apply,
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\Pixel')
)

$ErrorActionPreference = 'Continue'

$InstallDirs = @(
  $InstallDir,
  'C:\Program Files\Pixel',
  'C:\Program Files (x86)\Pixel',
  'C:\Program Files\Cyps',
  'C:\Program Files (x86)\Cyps'
) | Select-Object -Unique

# Pinned in electron-builder.yml (nsis.guid). Used for both registry keys.
$Guid = 'a5745318-c98a-51f9-87f5-f1c32713b276'
$UninstKeys = @(
  "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$Guid",
  "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$Guid",
  "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\$Guid"
)
$InstallKeys = @(
  "HKCU:\Software\$Guid",
  "HKLM:\Software\$Guid",
  "HKLM:\Software\WOW6432Node\$Guid"
)
$AllKeys = @($UninstKeys + $InstallKeys) | Select-Object -Unique

function Write-Section($text) { Write-Host ""; Write-Host "== $text" -ForegroundColor Cyan }
function Write-Fact($label, $value) { Write-Host ("  {0,-34} {1}" -f $label, $value) }

# --------------------------------------------------------------------------
# Windows Restart Manager: ask Windows which processes hold a file open.
# --------------------------------------------------------------------------
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class PixelFileLocks
{
    [StructLayout(LayoutKind.Sequential)]
    struct RM_UNIQUE_PROCESS { public int dwProcessId; public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime; }

    const int CCH_RM_MAX_APP_NAME = 255;
    const int CCH_RM_MAX_SVC_NAME = 63;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct RM_PROCESS_INFO
    {
        public RM_UNIQUE_PROCESS Process;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_APP_NAME + 1)] public string strAppName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_SVC_NAME + 1)] public string strServiceShortName;
        public int ApplicationType;
        public uint AppStatus;
        public uint TSSessionId;
        [MarshalAs(UnmanagedType.Bool)] public bool bRestartable;
    }

    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    static extern int RmStartSession(out uint handle, int flags, string key);
    [DllImport("rstrtmgr.dll")]
    static extern int RmEndSession(uint handle);
    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    static extern int RmRegisterResources(uint handle, uint nFiles, string[] files, uint nApps, RM_UNIQUE_PROCESS[] apps, uint nSvcs, string[] svcs);
    [DllImport("rstrtmgr.dll")]
    static extern int RmGetList(uint handle, out uint needed, ref uint count, [In, Out] RM_PROCESS_INFO[] info, out uint reasons);

    // Returns "pid:name" for each process holding any of the files.
    public static List<string> Who(string[] files)
    {
        var result = new List<string>();
        uint handle;
        if (RmStartSession(out handle, 0, Guid.NewGuid().ToString()) != 0) return result;
        try
        {
            if (RmRegisterResources(handle, (uint)files.Length, files, 0, null, 0, null) != 0) return result;
            uint needed = 0, count = 0, reasons;
            int rc = RmGetList(handle, out needed, ref count, null, out reasons);
            if (rc == 234 /* ERROR_MORE_DATA */ && needed > 0)
            {
                var info = new RM_PROCESS_INFO[needed];
                count = needed;
                if (RmGetList(handle, out needed, ref count, info, out reasons) == 0)
                    for (int i = 0; i < count; i++)
                        result.Add(info[i].Process.dwProcessId + ":" + info[i].strAppName);
            }
        }
        finally { RmEndSession(handle); }
        return result;
    }
}
'@ -ErrorAction Stop

function Get-LockersForFolder([string]$folder) {
  if (-not (Test-Path -LiteralPath $folder)) { return @() }
  $files = @(Get-ChildItem -LiteralPath $folder -Recurse -File -Force -ErrorAction SilentlyContinue |
             Select-Object -ExpandProperty FullName)
  if ($files.Count -eq 0) { return @() }
  # Restart Manager copes poorly with very large lists; the executables matter most.
  $priority = @($files | Where-Object { $_ -match '\.(exe|dll|asar|pak|bin)$' } | Select-Object -First 400)
  return @([PixelFileLocks]::Who($priority) | Sort-Object -Unique)
}

# Only these image names are ever stopped. Nothing else is touched.
$StopNames = @('Pixel', 'Cyps', 'Uninstall Pixel', 'Uninstall Cyps', 'old-uninstaller')
function Get-PixelProcesses {
  $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $all = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
  foreach ($p in $all) {
    $base = [IO.Path]::GetFileNameWithoutExtension($p.Name)
    $isSetup = $base -like 'Pixel-Setup*' -or $base -like 'Pixel-Portable*' -or $base -like 'Pixel Setup*'
    if ($StopNames -contains $base -or $isSetup) {
      $owner = $null
      try { $owner = (Invoke-CimMethod -InputObject $p -MethodName GetOwnerSid -ErrorAction Stop).Sid } catch {}
      [pscustomobject]@{ Id = $p.ProcessId; Name = $p.Name; Path = $p.ExecutablePath; Mine = ($owner -eq $me) }
    }
  }
}

# --------------------------------------------------------------------------
# REPORT
# --------------------------------------------------------------------------
Write-Host "Pixel install-state report  ($(Get-Date -Format s))" -ForegroundColor White
Write-Host "Mode: $(if ($Apply) { 'APPLY (asks before changing anything)' } else { 'READ-ONLY' })"

Write-Section 'Running Pixel / installer processes'
$procs = @(Get-PixelProcesses)
if ($procs.Count -eq 0) { Write-Host '  none' }
else { $procs | ForEach-Object { Write-Fact "$($_.Name) (pid $($_.Id))" "$($_.Path)  mine=$($_.Mine)" } }

Write-Section 'Installer registration (this is what the upgrade path reads)'
$reg = $null
foreach ($k in $AllKeys) {
  if (Test-Path $k) {
    Write-Host "  PRESENT  $k" -ForegroundColor Yellow
    $props = Get-ItemProperty -Path $k
    foreach ($name in 'DisplayName','DisplayVersion','InstallLocation','UninstallString','QuietUninstallString','(default)') {
      $v = $props.$name; if ($null -ne $v -and $v -ne '') { Write-Fact "  $name" $v }
    }
    $reg = $props
  } else { Write-Host "  absent   $k" }
}
$registered = $null
if ($reg) { $registered = $reg.InstallLocation; if (-not $registered) { $registered = $reg.'(default)' } }

Write-Section 'Install folder'
Write-Fact 'Chosen / default folder' $InstallDir
foreach ($dir in $InstallDirs) {
  if ($dir) { Write-Fact "Exists: $dir" (Test-Path -LiteralPath $dir) }
}
if ($registered) { Write-Fact 'Registered folder' $registered }
foreach ($dir in $InstallDirs) {
  if (-not (Test-Path -LiteralPath $dir)) { continue }
  Write-Host "  FOLDER  $dir" -ForegroundColor Yellow
  Get-ChildItem -LiteralPath $dir -Force -ErrorAction SilentlyContinue | Select-Object -First 12 |
    ForEach-Object { Write-Fact '  entry' $_.Name }
  $uninst = Join-Path $dir 'Uninstall Pixel.exe'
  if (Test-Path -LiteralPath $uninst) { Write-Fact 'Uninstall Pixel.exe present' 'yes' }
}

Write-Section 'Who is holding files in the install folder (Restart Manager)'
$lockers = @()
foreach ($dir in $InstallDirs) {
  if (Test-Path -LiteralPath $dir) { $lockers += @(Get-LockersForFolder $dir) }
}
$lockers = @($lockers | Sort-Object -Unique)
if ($lockers.Count -eq 0) { Write-Host '  no process reports a lock on the executables' }
else { $lockers | ForEach-Object { Write-Host "  LOCKED BY  $_" -ForegroundColor Yellow } }

Write-Section 'Windows protections that can block or lock an unsigned app'
try {
  $sac = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' -ErrorAction Stop).VerifiedAndReputablePolicyState
  $sacText = switch ($sac) { 0 {'Off'} 1 {'ON (enforcing: unsigned apps can be blocked outright)'} 2 {'Evaluation mode'} default {"unknown ($sac)"} }
  Write-Fact 'Smart App Control' $sacText
} catch { Write-Fact 'Smart App Control' 'not present / not readable' }
try {
  $mp = Get-MpPreference -ErrorAction Stop
  $cfa = switch ($mp.EnableControlledFolderAccess) { 0 {'Off'} 1 {'ON (blocks writes by unrecognised apps)'} 2 {'Audit'} default {"$($mp.EnableControlledFolderAccess)"} }
  Write-Fact 'Controlled Folder Access' $cfa
} catch { Write-Fact 'Controlled Folder Access' 'not readable' }
try {
  $threats = @(Get-MpThreatDetection -ErrorAction Stop | Where-Object { $_.Resources -match 'Pixel|Cyps' })
  Write-Fact 'Defender detections for Pixel' $threats.Count
  $threats | Select-Object -First 5 | ForEach-Object { Write-Fact '  detection' "$($_.InitialDetectionTime) $($_.Resources -join ';')" }
} catch { Write-Fact 'Defender detections' 'not readable' }
try {
  $ci = @(Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-CodeIntegrity/Operational'; StartTime = (Get-Date).AddDays(-3) } -ErrorAction Stop |
          Where-Object { $_.Message -match 'Pixel|Cyps' } | Select-Object -First 5)
  Write-Fact 'Code Integrity blocks for Pixel (3d)' $ci.Count
  $ci | ForEach-Object { Write-Fact "  event $($_.Id)" ($_.Message -split "`n")[0] }
} catch { Write-Fact 'Code Integrity log' 'nothing found / not readable' }

Write-Section 'User data (never modified by this script)'
foreach ($d in @((Join-Path $env:APPDATA 'Pixel'), (Join-Path $env:APPDATA 'Cyps'), (Join-Path $env:LOCALAPPDATA 'Pixel'))) {
  Write-Fact $d (Test-Path -LiteralPath $d)
}

# --------------------------------------------------------------------------
# DIAGNOSIS
# --------------------------------------------------------------------------
Write-Section 'Reading of the results'
$hasStaleState = ($null -ne $reg) -or ($InstallDirs | Where-Object { Test-Path -LiteralPath $_ }).Count -gt 0
if ($lockers.Count -gt 0) {
  Write-Host '  A process is holding Pixel files open. That alone explains "Error opening file for writing".' -ForegroundColor Yellow
}
if ($reg) {
  Write-Host '  An earlier install left its uninstaller registered. The installer runs it on every install and' -ForegroundColor Yellow
  Write-Host '  treats a failing exit code as "cannot be closed", regardless of the folder you choose.' -ForegroundColor Yellow
}
if (-not $hasStaleState -and $lockers.Count -eq 0) {
  Write-Host '  No stale registration or lock found. Check the protections section above and run the installer again.'
}

if (-not $Apply) {
  Write-Host ""
  Write-Host 'Read-only run finished. To clean up, run again with -Apply.' -ForegroundColor Green
  return
}

# --------------------------------------------------------------------------
# APPLY (user-approved cleanup of installer state only)
# --------------------------------------------------------------------------
Write-Section 'Cleanup plan'
Write-Host '  1. Stop your own Pixel/Cyps installer + uninstaller processes listed above'
Write-Host '  2. Back up the installer registry keys to a .reg file'
Write-Host "  3. Rename any stale install folder(s) to Pixel.stale-<timestamp>"
Write-Host '  4. Delete the stale installer registry keys (HKCU + HKLM)'
Write-Host '  Your conversations, settings, keys and memory are not touched.'
$answer = Read-Host 'Type YES to continue'
if ($answer -ne 'YES') { Write-Host 'Cancelled. Nothing was changed.'; return }

$stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
$staleDir = $null
$backup = Join-Path $env:USERPROFILE "Pixel-installer-registry-backup-$stamp"
New-Item -ItemType Directory -Force -Path $backup | Out-Null

foreach ($p in @(Get-PixelProcesses | Where-Object { $_.Mine })) {
  try { Stop-Process -Id $p.Id -Force -ErrorAction Stop; Write-Host "  stopped $($p.Name) (pid $($p.Id))" }
  catch { Write-Host "  could not stop $($p.Name) (pid $($p.Id)): $($_.Exception.Message)" -ForegroundColor Yellow }
}
Start-Sleep -Seconds 1

foreach ($k in $AllKeys) {
  if (Test-Path $k) {
    $native = $k -replace '^HKCU:\\', 'HKCU\' -replace '^HKLM:\\', 'HKLM\'
    $file = Join-Path $backup (($native -replace '[\\/:]', '_') + '.reg')
    & reg.exe export $native $file /y | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Host "  backed up  $native" } else { Write-Host "  BACKUP FAILED for $native - stopping." -ForegroundColor Red; return }
  }
}

foreach ($dir in $InstallDirs) {
  if (-not (Test-Path -LiteralPath $dir)) { continue }
  $staleDir = "$dir.stale-$stamp"
  try {
    Rename-Item -LiteralPath $dir -NewName (Split-Path $staleDir -Leaf) -ErrorAction Stop
    Write-Host "  renamed    $dir -> $staleDir"
  } catch {
    Write-Host "  Could not rename the install folder: $($_.Exception.Message)" -ForegroundColor Red
    $again = @(Get-LockersForFolder $dir)
    if ($again.Count) { Write-Host '  Still held by:'; $again | ForEach-Object { Write-Host "    $_" } }
    Write-Host '  Close those, or sign out and back in, then run this again. Registry was NOT changed.' -ForegroundColor Yellow
    return
  }
}

foreach ($k in $AllKeys) {
  if (Test-Path $k) { Remove-Item -Path $k -Recurse -Force; Write-Host "  removed    $k" }
}

Write-Host ""
Write-Host 'Done. Run the Pixel installer again.' -ForegroundColor Green
Write-Host "Registry backup: $backup"
if ($staleDir) { Write-Host "You can delete the old folder later: $staleDir" }