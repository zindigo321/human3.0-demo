@echo off
setlocal
cd /d "%~dp0"
title Human 3.0 Workbench
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22.12 or newer, then run this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm ci
  if errorlevel 1 goto failed
)
if not exist dist\server.mjs (
  call npm run build
  if errorlevel 1 goto failed
)
echo Open http://127.0.0.1:4310 in your browser. Keep this window open.
call npm start
pause
exit /b
:failed
echo Setup failed. See the message above and README.md.
pause
exit /b 1
