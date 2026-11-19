@echo off
rem LabOS analyzer interface: receives results from lab machines and sends them to LabOS.
rem First time: interface.bat --url http://localhost:4000 --key lif_... (from Settings > Analyzers)
cd /d "%~dp0"
title LabOS analyzer interface
node tools\interface\interface.mjs %*
pause
