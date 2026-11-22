[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$wpf = Join-Path $framework 'WPF'
$csc = Join-Path $framework 'csc.exe'
if (-not (Test-Path $csc)) { throw "csc.exe not found at $csc." }
$source = Join-Path $root 'native\PixelNative\UiAutomationFixture.cs'
$outDir = Join-Path $root 'native\bin'
$out = Join-Path $outDir 'PixelNativeUiAutomationFixture.exe'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
& $csc /nologo /target:winexe /platform:x64 /optimize+ "/out:$out" `
  "/reference:$wpf\PresentationFramework.dll" "/reference:$wpf\PresentationCore.dll" `
  "/reference:$wpf\WindowsBase.dll" "/reference:$framework\System.Xaml.dll" $source
if ($LASTEXITCODE -ne 0) { throw "Fixture compilation failed (exit $LASTEXITCODE)." }
Write-Host "Built disposable UI Automation fixture: $out" -ForegroundColor Green
