param([ValidateSet('start','stop','status','logs')][string]$Action = 'start')
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskNode = (Get-Command node -ErrorAction Stop).Source
& $taskNode (Join-Path $taskRoot 'scripts/local-backend.mjs') $Action
if ($LASTEXITCODE -ne 0) { throw 'Backend command failed. Check status and logs.' }
if ($Action -eq 'start') {
    Write-Output 'Backend is running in the background. Closing this window will not stop it.'
    Write-Output 'Phone access requires Tailscale on both devices and the private HTTPS server URL.'
}
if ($Action -in @('start','status')) { & (Join-Path $PSScriptRoot 'connection-status.ps1') }
