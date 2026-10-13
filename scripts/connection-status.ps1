$ErrorActionPreference = 'Stop'
$taskExe = Get-Command tailscale -ErrorAction SilentlyContinue
$taskTailscale = if ($taskExe) { $taskExe.Source } else { Join-Path $env:ProgramFiles 'Tailscale/tailscale.exe' }
if (-not (Test-Path -LiteralPath $taskTailscale)) { Write-Output 'Phone remote access: install and sign in to Tailscale on this computer and phone.'; return }
$taskState = (& $taskTailscale status --json | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0) { Write-Output 'Phone remote access: could not read Tailscale status.'; return }
Write-Output ("Tailscale on this computer: " + $taskState.BackendState)
if ($taskState.BackendState -ne 'Running') { Write-Output 'Turn on Tailscale before connecting the phone. Backend may still work locally.'; return }
$taskServe = (& $taskTailscale serve status --json | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0) { Write-Output 'Could not inspect private HTTPS settings.'; return }
$taskHost = $taskState.Self.DNSName.TrimEnd('.')
$taskSite = $taskServe.Web.PSObject.Properties | Where-Object { $_.Name -eq "${taskHost}:443" } | Select-Object -First 1
if ($taskSite -and $taskSite.Value.Handlers.PSObject.Properties.Name -contains '/') {
    Write-Output ("Phone server URL: https://" + $taskHost)
    Write-Output 'Phone needs Tailscale connected with the same account. USB is not required.'
} else { Write-Output 'Private HTTPS is not configured. Run scripts/remote-access.ps1 and complete account setup.' }
