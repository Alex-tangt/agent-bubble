$ErrorActionPreference = 'Stop'
$taskConfig = Join-Path (Split-Path $PSScriptRoot -Parent) '.env'
$taskLine = Get-Content -LiteralPath $taskConfig | Where-Object { $_ -match '^AGENT_BUBBLE_TOKEN=' } | Select-Object -First 1
if (-not $taskLine) { throw 'Missing AGENT_BUBBLE_TOKEN in .env' }
$taskToken = $taskLine.Substring('AGENT_BUBBLE_TOKEN='.Length).Trim().Trim('"').Trim("'")
if ($taskToken.Length -lt 24) { throw 'Connection token must have at least 24 characters' }
Set-Clipboard -Value $taskToken
Write-Output 'Connection token copied. Paste it into the Android connection settings.'
