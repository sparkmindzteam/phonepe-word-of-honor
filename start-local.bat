@echo off
cd /d "%~dp0"
title Word of Honor Kiosk
echo Starting Word of Honor...
echo   Ctrl+Shift+L  admin panel
echo   Esc           close admin, or exit kiosk
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0kiosk-lock.ps1"
echo.
if errorlevel 1 (
  echo The kiosk stopped with an error.
  pause
)
