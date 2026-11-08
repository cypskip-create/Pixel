<#
.SYNOPSIS
  Builds native\bin\PixelNative.exe with the C# compiler that ships with Windows.
  No .NET SDK or Visual Studio is needed.

.EXAMPLE
  .\scripts\build-native.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root   = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'native\PixelNative\PixelNative.cs'
$outDir = Join-Path $root 'native\bin'
$out    = Join-Path $outDir 'PixelNative.exe'

$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$csc = Join-Path $framework 'csc.exe'
if (-not (Test-Path $csc)) { throw "csc.exe not found at $csc. This needs 64-bit Windows with .NET Framework 4.x." }

$wpf = Join-Path $framework 'WPF'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

& $csc /nologo /target:exe /platform:x64 /optimize+ "/out:$out" "/lib:$wpf" `
  /reference:UIAutomationClient.dll /reference:UIAutomationTypes.dll `
  /reference:WindowsBase.dll /reference:System.Web.Extensions.dll `
  $source
if ($LASTEXITCODE -ne 0) { throw "Compilation failed (exit $LASTEXITCODE)." }

Write-Host "Built $out" -ForegroundColor Green
Write-Host 'Smoke test:'
Write-Host '  ''{"id":1,"cmd":"ping","args":{}}'' | .\native\bin\PixelNative.exe'