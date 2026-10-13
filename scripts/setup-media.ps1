param([string]$Python)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
if (-not $Python) { $Python = (Get-Command python -ErrorAction SilentlyContinue).Source }
if (-not $Python) { throw 'Pass -Python with a Python 3.10+ executable.' }
& $Python -m venv (Join-Path $taskRoot '.tools\python')
if ($LASTEXITCODE -ne 0) { throw 'Python environment creation failed' }
& (Join-Path $taskRoot '.tools\python\Scripts\python.exe') -m pip install --disable-pip-version-check yt-dlp
if ($LASTEXITCODE -ne 0) { throw 'yt-dlp installation failed' }
