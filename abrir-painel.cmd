@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    echo Instale as dependencias conforme o README.
    pause
    exit /b 1
)
if not exist ".tmp" mkdir ".tmp"
set "TEMP=%CD%\.tmp"
set "TMP=%TEMP%"
set "PYTHONUTF8=1"
".venv\Scripts\python.exe" -B -m streamlit run app.py --server.address 127.0.0.1
exit /b %errorlevel%
