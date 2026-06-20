@echo off
cd /d "%~dp0"
echo STAR WING を起動しています...
start "" http://localhost:5173
npm run dev
pause
