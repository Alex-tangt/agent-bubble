@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0backend.ps1" -Action status
pause
