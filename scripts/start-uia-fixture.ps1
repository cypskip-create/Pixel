[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
if ([Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') {
    throw 'Start this fixture with powershell.exe -STA.'
}

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Pixel UIA Harmless Fixture'
$form.ClientSize = New-Object System.Drawing.Size(460, 190)
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
$form.MaximizeBox = $false

$status = New-Object System.Windows.Forms.Label
$status.Name = 'PixelUiaResult'
$status.AccessibleName = 'Pixel harmless action: pending'
$status.AccessibleRole = [System.Windows.Forms.AccessibleRole]::StaticText
$status.AutoSize = $true
$status.Location = New-Object System.Drawing.Point(24, 24)
$status.Text = 'Pixel harmless action: pending'

$run = New-Object System.Windows.Forms.Button
$run.Name = 'RunHarmlessAction'
$run.Text = 'Run harmless UIA action'
$run.AccessibleName = 'Run harmless UIA action'
$run.AccessibleRole = [System.Windows.Forms.AccessibleRole]::PushButton
$run.UseMnemonic = $false
$run.Size = New-Object System.Drawing.Size(190, 36)
$run.Location = New-Object System.Drawing.Point(24, 74)
$run.Add_Click({
    $status.Text = 'Pixel harmless action: completed'
    $status.AccessibleName = $status.Text
}.GetNewClosure())

$reset = New-Object System.Windows.Forms.Button
$reset.Name = 'ResetHarmlessAction'
$reset.Text = 'Reset fixture'
$reset.AccessibleName = 'Reset fixture'
$reset.AccessibleRole = [System.Windows.Forms.AccessibleRole]::PushButton
$reset.UseMnemonic = $false
$reset.Size = New-Object System.Drawing.Size(140, 36)
$reset.Location = New-Object System.Drawing.Point(224, 74)
$reset.Add_Click({
    $status.Text = 'Pixel harmless action: pending'
    $status.AccessibleName = $status.Text
}.GetNewClosure())

$form.Controls.AddRange(@($status, $run, $reset))
Write-Host 'Pixel UIA Harmless Fixture is ready. Run Pixel separately and close this window when finished.'
[System.Windows.Forms.Application]::Run($form)
