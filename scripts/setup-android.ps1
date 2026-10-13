$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskTools = Join-Path $taskRoot '.tools'
$taskSdk = Join-Path $taskTools 'android-sdk'
$taskDownloads = Join-Path $taskTools 'downloads'
New-Item -ItemType Directory -Force -Path $taskDownloads,$taskSdk | Out-Null

function Get-TaskArchive([string]$Url, [string]$Path, [string]$Sha256) {
    & node (Join-Path $PSScriptRoot 'download.mjs') $Url $Path $Sha256
    if ($LASTEXITCODE -ne 0) { throw "Download failed: $Url" }
    $taskActual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($taskActual -ne $Sha256.ToLowerInvariant()) { throw "Checksum mismatch: $Path" }
}

$taskCmdZip = Join-Path $taskDownloads 'commandlinetools-win-15859902.zip'
Get-TaskArchive 'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip' $taskCmdZip '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a'
$taskManager = Join-Path $taskSdk 'cmdline-tools\latest\bin\sdkmanager.bat'
if (-not (Test-Path -LiteralPath $taskManager)) {
    $taskExtract = Join-Path $taskTools 'sdk-extract'
    Expand-Archive -LiteralPath $taskCmdZip -DestinationPath $taskExtract -Force
    $taskMoveFrom = [System.IO.Path]::GetFullPath((Join-Path $taskExtract 'cmdline-tools'))
    $taskMoveTo = [System.IO.Path]::GetFullPath((Join-Path $taskSdk 'cmdline-tools\latest'))
    if (-not $taskMoveFrom.StartsWith($taskTools + '\') -or -not $taskMoveTo.StartsWith($taskTools + '\')) { throw 'SDK path outside tool directory' }
    New-Item -ItemType Directory -Force -Path (Split-Path $taskMoveTo) | Out-Null
    Move-Item -LiteralPath $taskMoveFrom -Destination $taskMoveTo
}
Push-Location $taskRoot
try { & node (Join-Path $PSScriptRoot 'install-sdk.mjs') } finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { throw 'Android SDK installation failed' }

$taskGradleZip = Join-Path $taskDownloads 'gradle-8.11.1-bin.zip'
$taskGradleSha = (& node --input-type=module -e 'const r=await fetch("https://downloads.gradle.org/distributions/gradle-8.11.1-bin.zip.sha256"); if(!r.ok)throw new Error(String(r.status)); console.log((await r.text()).trim());').Trim()
Get-TaskArchive 'https://downloads.gradle.org/distributions/gradle-8.11.1-bin.zip' $taskGradleZip $taskGradleSha
if (-not (Test-Path -LiteralPath (Join-Path $taskTools 'gradle-8.11.1\bin\gradle.bat'))) {
    Expand-Archive -LiteralPath $taskGradleZip -DestinationPath $taskTools -Force
}
New-Item -ItemType Directory -Force -Path (Join-Path $taskRoot 'android') | Out-Null
$taskSdkProperty = $taskSdk.Replace('\','/')
[System.IO.File]::WriteAllText((Join-Path $taskRoot 'android\local.properties'), "sdk.dir=$taskSdkProperty`n")
Write-Output 'Android toolchain is ready in .tools.'
