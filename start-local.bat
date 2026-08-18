@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>&1
if %errorlevel%==0 (
  set "PY=py -3"
) else (
  where python >nul 2>&1
  if %errorlevel%==0 (
    set "PY=python"
  ) else (
    echo Python 3 is required to run this game locally.
    echo Install Python from https://www.python.org/downloads/
    echo Make sure "Add Python to PATH" is checked.
    pause
    exit /b 1
  )
)

echo.
echo Starting Word of Honor locally (no Vercel needed)...
echo   Player: http://127.0.0.1:5173
echo   Admin:  http://127.0.0.1:5173/admin
echo   Scores: data\scores.json  and  data\scores.csv
echo   Online backup: https://phonepe-word-of-honor.vercel.app
echo.
start "" "http://127.0.0.1:5173"
%PY% local-server.py
if errorlevel 1 pause
endlocal
