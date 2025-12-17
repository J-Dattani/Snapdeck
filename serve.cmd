@echo off
setlocal

REM Tiny static server for local testing (no installs).
REM Usage: double-click serve.cmd OR run from cmd.

cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
  echo Starting server at http://localhost:8000/
  echo Close this window to stop.
  py -m http.server 8000
  exit /b %errorlevel%
)

where python >nul 2>nul
if %errorlevel%==0 (
  echo Starting server at http://localhost:8000/
  echo Close this window to stop.
  python -m http.server 8000
  exit /b %errorlevel%
)

echo Python not found. Install Python 3, then re-run.
echo https://www.python.org/downloads/
exit /b 1
