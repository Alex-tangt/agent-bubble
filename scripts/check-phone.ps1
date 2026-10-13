param([string]$DeviceSerial)
$ErrorActionPreference = 'Stop'
$taskAdb = Join-Path (Split-Path $PSScriptRoot -Parent) '.tools/android-sdk/platform-tools/adb.exe'
$taskOutput = & $taskAdb devices -l
if ($LASTEXITCODE -ne 0) { throw 'ADB device discovery failed' }
$taskRows = @($taskOutput | Where-Object { $_ -match '^\S+\s+(device|unauthorized|offline)(\s|$)' -and $_ -notmatch '^emulator-' })
if ($DeviceSerial) { $taskRows = @($taskRows | Where-Object { ($_ -split '\s+')[0] -eq $DeviceSerial }) }
if ($taskRows.Count -eq 0) { throw 'No physical phone in ADB. Enable USB debugging and authorize this computer on the phone.' }
if ($taskRows.Count -gt 1) { throw 'Multiple phones connected. Pass -DeviceSerial to choose one.' }
$taskFields = $taskRows[0] -split '\s+'
if ($taskFields[1] -ne 'device') { throw ('Phone is ' + $taskFields[1] + '. Confirm the authorization prompt and keep the phone unlocked.') }
Write-Output ('ADB phone ready: ' + $taskFields[0])
& $taskAdb -s $taskFields[0] shell getprop ro.product.model
& $taskAdb -s $taskFields[0] shell getprop ro.build.version.release
