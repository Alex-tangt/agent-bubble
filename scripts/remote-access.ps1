param([switch]$Disable)
$ErrorActionPreference = 'Stop'
$taskExe = Get-Command tailscale -ErrorAction SilentlyContinue
$taskTailscale = if ($taskExe) { $taskExe.Source } else { Join-Path $env:ProgramFiles 'Tailscale/tailscale.exe' }
if (-not (Test-Path -LiteralPath $taskTailscale)) { throw 'Install Tailscale from https://tailscale.com/download/windows and sign in first.' }
$taskState = (& $taskTailscale status --json | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0) { throw 'Could not read Tailscale state.' }
if ($taskState.BackendState -eq 'Stopped') { throw 'Tailscale is signed in but switched off. Turn it on and retry.' }
if ($taskState.BackendState -ne 'Running') { throw 'Sign in to Tailscale on this computer first.' }
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskPortLine = Get-Content -LiteralPath (Join-Path $taskRoot '.env') | Where-Object { $_ -match '^PORT=' } | Select-Object -First 1
$taskPort = if ($taskPortLine) { [int]$taskPortLine.Substring(5).Trim() } else { 8787 }
if ($taskPort -lt 1 -or $taskPort -gt 65535) { throw 'Invalid backend PORT.' }
$taskServe = (& $taskTailscale serve status --json | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect existing Tailscale Serve settings.' }
foreach ($taskSite in $taskServe.Web.PSObject.Properties) {
    if ($taskSite.Name -match ':443$') {
        $taskHandler = $taskSite.Value.Handlers.PSObject.Properties | Where-Object { $_.Name -eq '/' } | Select-Object -First 1
        if ($taskHandler -and $taskHandler.Value.Proxy -ne "http://127.0.0.1:$taskPort") {
            throw 'HTTPS 443 already serves another app. Choose a different Serve port before configuring Agent Bubble.'
        }
    }
}
if ($Disable) {
    & $taskTailscale serve --https=443 --set-path=/ off
    if ($LASTEXITCODE -ne 0) { throw 'Tailscale could not disable HTTPS serving.' }
    return
}
$taskHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$taskPort/health" -TimeoutSec 5
if ($taskHealth.status -ne 'ok') { throw 'Start the local backend first.' }
& node (Join-Path $PSScriptRoot 'tailscale-command.mjs') $taskTailscale serve --bg --https=443 "http://127.0.0.1:$taskPort"
if ($LASTEXITCODE -ne 0) { throw 'Follow the Tailscale HTTPS setup link shown above, then retry this script.' }
Write-Output 'Private HTTPS endpoint configured. Use the displayed HTTPS address in Android connection settings.'
& $taskTailscale serve status
