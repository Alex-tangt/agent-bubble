@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0backend.ps1" -Action stop
set "BUBBLE_EXIT=%ERRORLEVEL%"
pause
exit /b %BUBBLE_EXIT%
