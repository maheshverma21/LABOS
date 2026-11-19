@echo off
rem Starts LabOS on this PC. Keep the window open while you use it; close it (or Ctrl+C) to stop.
cd /d "%~dp0"
title LabOS
if not exist node_modules (
  echo Run setup.bat first.
  pause
  exit /b 1
)
call npm run start:local
pause
