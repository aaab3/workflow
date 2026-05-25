@echo off
title OpenClaw Workflow
cd /d "%~dp0"

echo.
echo  ========================================
echo   OpenClaw Workflow - Starting...
echo  ========================================
echo.

:: Start backend server
start /b "" cmd /c "pnpm --filter @openclaw/workflow-server dev > nul 2>&1"

:: Wait for server to be ready
echo  [1/2] Starting backend server...
timeout /t 3 /nobreak > nul

:: Start frontend dev server
start /b "" cmd /c "pnpm --filter @openclaw/workflow-ui dev > nul 2>&1"

echo  [2/2] Starting frontend...
timeout /t 3 /nobreak > nul

echo.
echo  ========================================
echo   OpenClaw Workflow is ready!
echo   Opening browser...
echo  ========================================
echo.
echo   Frontend: http://localhost:3200
echo   Backend:  http://localhost:3100
echo.
echo   Press any key to stop all services.
echo.

:: Open browser
start http://localhost:3200

:: Wait for user to press a key
pause > nul

:: Kill node processes started by this script
taskkill /f /im node.exe > nul 2>&1
echo  Services stopped.
