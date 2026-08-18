@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set PYTHONUNBUFFERED=1
title Word of Honor

echo.
echo Starting Word of Honor locally...
echo   Player: http://127.0.0.1:5173
echo   Admin:  http://127.0.0.1:5173/admin
echo.

where py >nul 2>&1
if not errorlevel 1 (
  set "PYEXE=py"
  set "PYARGS=-3 -u"
  goto startserver
)
where python >nul 2>&1
if not errorlevel 1 (
  set "PYEXE=python"
  set "PYARGS=-u"
  goto startserver
)

echo Python 3 is required.
echo Install it from https://www.python.org/downloads/
echo Tick "Add python.exe to PATH".
echo.
pause
exit /b 1

:startserver
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:5173/ & start http://127.0.0.1:5173/admin"
echo Leave this window open while you play. Close it to stop the server.
echo.
if defined PYARGS (
  "%PYEXE%" %PYARGS% local-server.py
) else (
  "%PYEXE%" -u local-server.py
)
if errorlevel 1 (
  echo.
  echo Server stopped with an error. If the site did not open, port 5173 may already be in use.
  pause
)
endlocal
