@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js not found. Install Node.js and try again.
    pause
    exit /b 1
)

start "Matrix OSINT Server" cmd /k "cd /d ""%~dp0"" && node server.js"
timeout /t 2 /nobreak >nul
start "" "http://localhost:3000"

echo Matrix OSINT started. Use the server window to stop it (Ctrl+C).
endlocal
