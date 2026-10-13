$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskDirectory = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Agent Bubble'
New-Item -ItemType Directory -Path $taskDirectory -Force | Out-Null
$taskShell = New-Object -ComObject WScript.Shell
foreach ($taskAction in @('start', 'status', 'stop', 'build')) {
    $taskLink = $taskShell.CreateShortcut((Join-Path $taskDirectory ("Backend $taskAction.lnk")))
    $taskLink.TargetPath = Join-Path $PSScriptRoot ("backend-$taskAction.cmd")
    $taskLink.WorkingDirectory = $taskRoot
    $taskLink.Description = "Agent Bubble backend: $taskAction"
    $taskLink.Save()
}
$taskGuide = $taskShell.CreateShortcut((Join-Path $taskDirectory 'Deployment guide.lnk'))
$taskGuide.TargetPath = Join-Path $taskRoot 'docs/local-deployment.md'
$taskGuide.Save()
$taskPhoneGuide = $taskShell.CreateShortcut((Join-Path $taskDirectory 'Phone connection guide.lnk'))
$taskPhoneGuide.TargetPath = Join-Path $taskRoot 'docs/phone-wireless-setup.md'
$taskPhoneGuide.Save()
Copy-Item -LiteralPath (Join-Path $taskRoot 'docs/desktop-readme.txt') -Destination (Join-Path $taskDirectory 'Readme.txt')
$taskProject = $taskShell.CreateShortcut((Join-Path $taskDirectory 'Open project folder.lnk'))
$taskProject.TargetPath = Join-Path $env:WINDIR 'explorer.exe'
$taskProject.Arguments = '"' + $taskRoot + '"'
$taskProject.Save()
# Forward desktop npm commands to the actual project; no source/dependency copy.
$taskScripts = [ordered]@{build = 'npm --prefix "' + $taskRoot + '" run build'}
foreach ($taskAction in @('start','status','stop','logs')) {
    $taskScripts[$taskAction] = 'node "' + (Join-Path $taskRoot 'scripts/local-backend.mjs') + '" ' + $taskAction
}
$taskManifest = [ordered]@{name='agent-bubble-desktop-controls';private=$true;scripts=$taskScripts}
[IO.File]::WriteAllText((Join-Path $taskDirectory 'package.json'), ($taskManifest | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
Write-Output "Backend shortcuts saved to $taskDirectory"
