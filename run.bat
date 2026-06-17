@echo off
REM One-command launcher for Article B-roll Generator (Windows).
REM Installs dependencies on first run, then starts the app.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get it from https://nodejs.org ^(LTS^), then re-run.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies ^(first run^)...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Launching Article B-roll Generator...
call npm start
