param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskStartup = [Environment]::GetFolderPath('Startup')
$taskShortcut = Join-Path $taskStartup 'Agent Bubble Backend.lnk'
if ($Remove) {
    if (Test-Path -LiteralPath $taskShortcut) { Remove-Item -LiteralPath $taskShortcut }
    Write-Output 'Login startup removed.'
    return
}
$taskNode = (Get-Command node -ErrorAction Stop).Source
$taskShell = New-Object -ComObject WScript.Shell
$taskLink = $taskShell.CreateShortcut($taskShortcut)
$taskLink.TargetPath = $taskNode
$taskLink.Arguments = '"' + (Join-Path $taskRoot 'scripts/local-backend.mjs') + '" start'
$taskLink.WorkingDirectory = $taskRoot
$taskLink.WindowStyle = 7
$taskLink.Description = 'Start Agent Bubble after Windows login; use the current user website sessions.'
$taskLink.Save()
Write-Output 'Agent Bubble will start after this Windows user logs in. It does not run before login.'
