@echo off
title Coin Flip Simulator
cd /d "%~dp0.."

if not exist ".venv\Scripts\python.exe" (
    echo Setting up for the first time, please wait...
    python -m venv .venv
    ".venv\Scripts\python.exe" -m pip install -r requirements.txt
)

echo Starting Coin Flip Simulator at http://127.0.0.1:5000
echo Close this window to stop the app.
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://127.0.0.1:5000"
".venv\Scripts\python.exe" app.py
