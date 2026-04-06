@echo off
setlocal
cd /d "%~dp0"
cd /d ".."

REM Optional: Set a custom admin password (leave empty to auto-generate)
REM set ADMIN_PASSWORD=your-secure-password-here

REM Optional: Enable richer phone intelligence (carrier/region when available)
REM set VERIPHONE_API_KEY=your-veriphone-api-key-here

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js not found. Install Node.js and try again.
    pause
    exit /b 1
)

start "Matrix OSINT Server" cmd /k "cd /d ""%cd%"" && node backend\server.js"
timeout /t 2 /nobreak >nul
start "" "http://localhost:3000"

echo Matrix OSINT started. Use the server window to stop it (Ctrl+C).
endlocal
