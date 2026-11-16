@echo off
cd /d "%~dp0"
call "%APPDATA%\npm\pnpm.cmd" dev:desktop
if errorlevel 1 pause
