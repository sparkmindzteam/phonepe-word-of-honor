@echo off
cd /d "%~dp0"
title Word of Honor Kiosk
echo Starting Word of Honor in locked kiosk mode...
echo Press ESC to unlock and exit.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0kiosk-lock.ps1"
echo.
if errorlevel 1 (
  echo The kiosk stopped with an error.
  pause
)
