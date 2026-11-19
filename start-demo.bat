@echo off
rem Starts LabOS and adds the demo lab with demo users (safe to run again).
rem Sign in as owner@demo-lab.test with password Demo@12345.
cd /d "%~dp0"
title LabOS (demo)
if not exist node_modules (
  echo Run setup.bat first.
  pause
  exit /b 1
)
call npm run start:local -- --demo
pause
