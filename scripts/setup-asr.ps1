param([string]$Python, [ValidateSet('small','base','medium')][string]$Model = 'small')
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
if (-not $Python) { $Python = Join-Path $taskRoot '.tools\python\Scripts\python.exe' }
if (-not (Test-Path -LiteralPath $Python)) { throw 'Prepare the project Python environment with setup-media.ps1 first, or pass -Python.' }
& $Python -m pip install --disable-pip-version-check -r (Join-Path $PSScriptRoot 'requirements-asr.txt')
if ($LASTEXITCODE -ne 0) { throw 'ASR dependency installation failed' }
& $Python (Join-Path $PSScriptRoot 'check-asr-runtime.py')
if ($LASTEXITCODE -ne 0) { throw 'Installed audio decoder is incompatible with the ASR runtime' }
$taskModelDir = Join-Path $taskRoot ('.tools\asr-models\' + $Model)
$env:PYTHONUTF8 = '1'
& $Python (Join-Path $PSScriptRoot 'transcribe-audio.py') --prepare-model $Model --model-dir $taskModelDir
if ($LASTEXITCODE -ne 0) { throw 'Model preparation failed. Retry or configure ASR_MODEL_DIR to an existing local model.' }
Write-Output ('Local ASR ready. Model directory: ' + $taskModelDir)
