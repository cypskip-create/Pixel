<#
.SYNOPSIS
  Builds native\bin\PixelNative.exe with the C# compiler that ships with Windows.
  No .NET SDK or Visual Studio is needed.

.EXAMPLE
  .\scripts\build-native.ps1
#>
[CmdletBinding()]
param(
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$root   = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'native\PixelNative\PixelNative.cs'
$outDir = Join-Path $root 'native\bin'
$out    = Join-Path $outDir 'PixelNative.exe'
if (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
  $out = [System.IO.Path]::GetFullPath($OutputPath)
  $outDir = Split-Path -Parent $out
  if (Test-Path -LiteralPath $out) { throw "Refusing to overwrite existing helper output: $out" }
}

$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$csc = Join-Path $framework 'csc.exe'
if (-not (Test-Path $csc)) { throw "csc.exe not found at $csc. This needs 64-bit Windows with .NET Framework 4.x." }

$wpf = Join-Path $framework 'WPF'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

& $csc /nologo /target:exe /platform:x64 /optimize+ "/out:$out" "/lib:$wpf" `
  /reference:UIAutomationClient.dll /reference:UIAutomationTypes.dll `
  /reference:WindowsBase.dll /reference:System.Web.Extensions.dll /reference:System.Drawing.dll `
  $source
if ($LASTEXITCODE -ne 0) { throw "Compilation failed (exit $LASTEXITCODE)." }

Write-Host "Built $out" -ForegroundColor Green
$smokeOutput = @(
  '{"id":1,"cmd":"ping","args":{}}'
  '{"id":2,"cmd":"system_power_status","args":{}}'
) | & $out
if ($LASTEXITCODE -ne 0) { throw "PixelNative protocol smoke failed (exit $LASTEXITCODE)." }
if ($smokeOutput.Count -ne 2) { throw 'PixelNative did not answer both protocol smoke requests.' }
$ping = $smokeOutput[0] | ConvertFrom-Json
$power = $smokeOutput[1] | ConvertFrom-Json
if ($ping.ok -ne $true -or $ping.result.version -ne '1.1.0') { throw 'PixelNative ping smoke returned an invalid response.' }
if ($power.ok -ne $true -or $null -eq $power.result.PSObject.Properties['present']) { throw 'PixelNative system power status smoke returned an invalid response.' }
if ($null -ne $power.result.present -and $power.result.present -isnot [bool]) { throw 'PixelNative returned an invalid battery presence state.' }
if ($null -ne $power.result.percent -and ($power.result.percent -lt 0 -or $power.result.percent -gt 100)) { throw 'PixelNative returned an invalid battery percentage.' }
Write-Host 'PixelNative protocol smoke passed (ping and system power status; battery values omitted).' -ForegroundColor Green
