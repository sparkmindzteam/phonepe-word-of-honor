@echo off
cd /d "%~dp0"
title Word of Honor Admin
echo Opening the Word of Honor admin page...
echo Press Ctrl+Shift+L for kiosk controls.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0kiosk-lock.ps1" -Admin
if errorlevel 1 pause
