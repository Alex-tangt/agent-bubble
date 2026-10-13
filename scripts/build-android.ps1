$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskSdk = Join-Path $taskRoot '.tools/android-sdk'
$taskGradle = Join-Path $taskRoot '.tools/gradle-8.11.1/bin/gradle.bat'
if (-not (Test-Path -LiteralPath $taskSdk)) { throw 'Run scripts/setup-android.ps1 first, or configure your own SDK in android/local.properties.' }
Push-Location $taskRoot
try {
    & $taskGradle -p android assembleDebug testDebugUnitTest lintDebug --no-daemon
    if ($LASTEXITCODE -ne 0) { throw 'Android build or checks failed' }
    New-Item -ItemType Directory -Force -Path artifacts | Out-Null
    Copy-Item -LiteralPath 'android/app/build/outputs/apk/debug/app-debug.apk' -Destination 'artifacts/agent-bubble-0.1.0-debug.apk'
    Write-Output 'APK: artifacts/agent-bubble-0.1.0-debug.apk'
} finally { Pop-Location }
