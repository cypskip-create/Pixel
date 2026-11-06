<#
.SYNOPSIS
    One-shot Windows diagnostic for Pixel: environment, installation and startup.

.DESCRIPTION
    Runs the two focused diagnostics in order and prints a single verdict, so a
    support request only needs one command. Both underlying scripts are read-only;
    this wrapper is read-only too. It never modifies the registry, never deletes
    files, and never terminates a process.

.PARAMETER Exe
    Path to Pixel.exe. Defaults to release\win-unpacked\Pixel.exe.

.PARAMETER Report
    Optional directory or file for the combined report.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\diagnose-pixel.ps1
#>
[CmdletBinding()]
param(
    [string]$Exe = '',
    [string]$Report = ''
)

$ErrorActionPreference = 'Continue'
$repoRoot = Split-Path -Parent $PSScriptRoot

if ([string]::IsNullOrWhiteSpace($Exe)) {
    $Exe = Join-Path $repoRoot 'release\win-unpacked\Pixel.exe'
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if ([string]::IsNullOrWhiteSpace($Report)) {
    $Report = Join-Path $repoRoot "pixel-diagnostic-$stamp.txt"
}

Write-Host ''
Write-Host 'Pixel combined diagnostic' -ForegroundColor Cyan
Write-Host '=========================' -ForegroundColor Cyan
Write-Host ("Executable : {0}" -f $Exe)
Write-Host ("Report     : {0}" -f $Report)
Write-Host 'Read-only. Nothing on this computer will be changed.' -ForegroundColor DarkGray

$output = New-Object System.Collections.Generic.List[string]
$output.Add("Pixel diagnostic $stamp")
$output.Add("Executable: $Exe")

function Invoke-Step {
    param([string]$Title, [string]$Script, [string[]]$Arguments)

    Write-Host ''
    Write-Host $Title -ForegroundColor Cyan
    Write-Host ('-' * $Title.Length) -ForegroundColor DarkCyan

    if (-not (Test-Path -LiteralPath $Script)) {
        Write-Host ("  skipped: {0} not found" -f $Script) -ForegroundColor Yellow
        $output.Add("[skipped] $Title ($Script missing)")
        return $null
    }

    $result = & powershell -NoProfile -ExecutionPolicy Bypass -File $Script @Arguments 2>&1
    $result | ForEach-Object { Write-Host ("  {0}" -f $_) }
    $output.Add("")
    $output.Add("=== $Title ===")
    $result | ForEach-Object { $output.Add([string]$_) }
    return ($result -join "`n")
}

# 1. Installation and environment.
Invoke-Step -Title 'Installation and environment' `
    -Script (Join-Path $PSScriptRoot 'diagnose-installer.ps1') `
    -Arguments @() | Out-Null

# 2. Startup behaviour (self-check first; it needs no window).
if (Test-Path -LiteralPath $Exe) {
    Invoke-Step -Title 'Startup self-check' `
        -Script (Join-Path $PSScriptRoot 'capture-startup.ps1') `
        -Arguments @('-Exe', $Exe, '-SelfCheck') | Out-Null
} else {
    Write-Host ''
    Write-Host ("Executable not found: {0}" -f $Exe) -ForegroundColor Yellow
    $output.Add("[skipped] startup: executable not found at $Exe")
}

$output -join "`r`n" | Set-Content -LiteralPath $Report -Encoding UTF8

Write-Host ''
Write-Host 'Verdict' -ForegroundColor Cyan
Write-Host '-------' -ForegroundColor Cyan
Write-Host '  1. If the self-check failed, the message names the missing piece.'
Write-Host '  2. If it passed, run: capture-startup.ps1 (without -SelfCheck) to test the GUI.'
Write-Host '  3. If an installer dialog appears, attach this report before changing anything.'
Write-Host ''
Write-Host ("Report written to {0}" -f $Report) -ForegroundColor Green
Write-Host 'Diagnostic complete. No changes were made.' -ForegroundColor Green
exit 0
