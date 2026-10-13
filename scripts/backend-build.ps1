$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
Push-Location $taskRoot
try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed; the running backend was not stopped.' }
    Write-Output 'Build complete. Normal daily use only requires Backend start.'
    Write-Output 'To load an update: wait for active tasks, then Backend stop and Backend start.'
} finally { Pop-Location }
