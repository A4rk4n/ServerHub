@echo off
REM ---------------------------------------------------------------------------
REM Server Hub - one-command launcher for Windows.
REM   run.bat           start the panel at http://localhost:4321
REM   run.bat --build   rebuild first
REM ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"

if not defined SERVERHUB_PORT set SERVERHUB_PORT=4321
set PORT=%SERVERHUB_PORT%
set HOSTNAME=127.0.0.1
set NODE_ENV=production
if not defined SERVERHUB_APPDATA set SERVERHUB_APPDATA=%CD%\data
if not defined SERVERHUB_DB set SERVERHUB_DB=%CD%\data\serverhub.db

if not exist build\server\server.js goto build
if "%~1"=="--build" goto build
goto start

:build
echo ==^> Building the production server bundle
call npm run build
if errorlevel 1 exit /b 1
node scripts\prepare-standalone.mjs
if errorlevel 1 exit /b 1

:start
if not exist "%SERVERHUB_APPDATA%" mkdir "%SERVERHUB_APPDATA%"
echo ==^> Server Hub starting on http://localhost:%PORT%
echo ==^> Database: %SERVERHUB_DB%
echo.
echo     Press Ctrl+C to stop.
echo.
node build\server\start.mjs
