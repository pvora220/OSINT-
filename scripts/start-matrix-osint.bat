@echo off
setlocal
cd /d "%~dp0"
cd /d ".."

REM Optional: Set a custom admin password (leave empty to auto-generate)
REM set ADMIN_PASSWORD=your-secure-password-here

REM Optional: Enable richer phone intelligence (carrier/region when available)
REM set VERIPHONE_API_KEY=your-veriphone-api-key-here

if exist ".env.local" (
    for /f "usebackq tokens=1,* delims==" %%A in (".env.local") do (
        if not "%%~A"=="" if /i not "%%~A"=="REM" set "%%~A=%%~B"
    )
)

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js not found. Install Node.js and try again.
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo npm not found. Reinstall Node.js and try again.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Installing dependencies for first run...
    npm install
    if errorlevel 1 (
        echo Failed to install dependencies.
        pause
        exit /b 1
    )
)

start "" powershell -NoProfile -Command "Start-Sleep -Seconds 3; Start-Process 'http://localhost:3000'"
echo Starting Matrix OSINT server...
npm start

endlocal
