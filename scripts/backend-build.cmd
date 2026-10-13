@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0backend-build.ps1"
set "BUBBLE_EXIT=%ERRORLEVEL%"
pause
exit /b %BUBBLE_EXIT%
