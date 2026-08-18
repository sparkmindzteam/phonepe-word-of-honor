@echo off
cd /d "%~dp0"
echo Starting Word of Honor in locked kiosk mode...
echo Press ESC to unlock and exit.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0kiosk-lock.ps1"
if errorlevel 1 pause
