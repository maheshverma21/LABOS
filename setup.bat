@echo off
rem One-time setup on a Windows PC: installs the app's packages and builds it.
rem Needs Node.js 20 or newer (https://nodejs.org, the LTS version) and internet.
cd /d "%~dp0"
title LabOS setup

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed.
  echo Install the LTS version from https://nodejs.org, then run setup.bat again.
  echo.
  pause
  exit /b 1
)
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 20 (
  echo.
  echo Node.js 20 or newer is needed. This PC has version %NODE_MAJOR%.
  echo Install the LTS version from https://nodejs.org, then run setup.bat again.
  echo.
  pause
  exit /b 1
)

echo.
echo [1/2] Installing packages (needs internet, a few minutes)...
call npm ci --no-audit --no-fund
if errorlevel 1 goto fail

echo.
echo [2/2] Building the app (a few minutes)...
call npm run build
if errorlevel 1 goto fail

echo.
echo Setup finished.
echo   start.bat       runs LabOS with your own data (create your lab on first open)
echo   start-demo.bat  runs it with a demo lab and demo users added
echo.
pause
exit /b 0

:fail
echo.
echo Setup failed. Check the messages above (often: no internet, or antivirus blocking).
echo Fix the problem and run setup.bat again.
echo.
pause
exit /b 1
