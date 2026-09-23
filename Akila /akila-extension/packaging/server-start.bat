@echo off
rem ===========================================================================
rem AKILA Privilege Guard — Local Sanitization Server (Windows)
rem ===========================================================================
rem Double-click this file to install (once) and start the AKILA local server.
rem First run downloads the ~600 MB language model — normal and one-time.
rem Requires Python 3.10+ from https://www.python.org/downloads/ (tick
rem "Add python.exe to PATH" during installation).
rem ===========================================================================

setlocal
set PATH=%PATH%;%LOCALAPPDATA%\Programs\Python
cd /d "%~dp0"

echo.
echo AKILA Privilege Guard — local server (Windows)
echo.

rem --- 1. Find Python 3 ---
where python >nul 2>nul
if errorlevel 1 (
    echo Python 3.10+ was not found.
    echo Install it from https://www.python.org/downloads/ and re-run this file.
    start "" https://www.python.org/downloads/
    pause
    exit /b 1
)
python --version

rem --- 2. Create venv ---
if not exist venv python -m venv venv
if errorlevel 1 (
    echo Could not create the Python environment. Re-run after installing Python.
    pause
    exit /b 1
)

rem --- 3. Dependencies ---
echo Installing/checking dependencies (first time can take a few minutes)...
venv\Scripts\python.exe -m pip install --quiet --upgrade pip
venv\Scripts\python.exe -m pip install --quiet -r server\requirements.txt
if errorlevel 1 (
    echo Dependency installation failed. Check your internet connection and re-run.
    pause
    exit /b 1
)

rem --- 4. Language model (one-time) ---
venv\Scripts\python.exe -c "import en_core_web_lg" >nul 2>nul
if errorlevel 1 (
    echo Downloading the language model (~600 MB) — first run only.
    venv\Scripts\python.exe -m spacy download en_core_web_lg
    if errorlevel 1 (
        echo Language model download failed. Re-run this file.
        pause
        exit /b 1
    )
)

rem --- 5. Start ---
echo.
echo Starting the AKILA server on http://127.0.0.1:5001
echo Keep this window open — closing it stops the server.
venv\Scripts\python.exe server\presidio_server.py
pause