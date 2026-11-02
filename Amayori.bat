@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title Amayori
cd /d "%~dp0" || (echo [ERROR] Cannot open project folder.& pause& exit /b 1)
if /i "%~1"=="build-brain" goto build_brain
if /i "%~1"=="help" goto usage
if not "%~1"=="" goto usage
if not exist "logs" mkdir "logs"
set "LOG=%CD%\logs\start.log"
where node.exe >nul 2>&1 || (echo [ERROR] Install Node.js LTS.& pause& exit /b 1)
if not exist "package.json" (echo [ERROR] package.json missing.& pause& exit /b 1)
powershell.exe -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:57474/api/health' -TimeoutSec 2; if($r.StatusCode -eq 200 -and $r.Content -match 'Amayori'){exit 0}else{exit 2} } catch {exit 1}" >nul 2>&1
if not errorlevel 1 (
 echo [INFO] Amayori is already running. Opening existing instance.
 start "" "http://127.0.0.1:57474/"
 exit /b 0
)
node.exe scripts\check-dependencies.mjs
if errorlevel 2 (echo [ERROR] Node.js 22 or newer is required.& pause& exit /b 1)
if errorlevel 1 (
 where npm.cmd >nul 2>&1 || (echo [ERROR] npm.cmd is missing. Reinstall Node.js LTS.& pause& exit /b 1)
 echo [INFO] Installing required packages. Internet is needed on the first run.
 call npm.cmd ci --ignore-scripts --no-audit --no-fund
 if errorlevel 1 (echo [ERROR] Package installation failed. Check the internet connection and retry.& pause& exit /b 1)
 node.exe scripts\check-dependencies.mjs
 if errorlevel 1 (echo [ERROR] Dependencies are incomplete. Check the installation output.& pause& exit /b 1)
)
echo [INFO] Starting Amayori at http://127.0.0.1:57474/
start "" /min cmd /c "node.exe server.mjs 1>>logs\start.log 2>&1"
set "READY="
for /l %%I in (1,1,30) do (
 if not defined READY (
  powershell.exe -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:57474/api/health' -TimeoutSec 1; if($r.StatusCode -eq 200){exit 0}else{exit 1} } catch {exit 1}" >nul 2>&1
  if not errorlevel 1 set "READY=1"
  if not defined READY timeout /t 1 /nobreak >nul
 )
)
if not defined READY (echo [ERROR] Server did not start. Check logs\start.log& pause& exit /b 1)
start "" "http://127.0.0.1:57474/"
echo [OK] Browser opened. Server runs locally.
exit /b 0

:build_brain
where py.exe >nul 2>&1 || (echo [ERROR] Python 3 is required to build the semantic brain.& pause& exit /b 1)
echo [INFO] Installing optional Golem Python dependencies...
py -3 -m pip install -r "integrations\golem\requirements.txt"
if errorlevel 1 (echo [ERROR] Dependency installation failed.& pause& exit /b 1)
echo [INFO] Building semantic memory cortex...
py -3 "integrations\golem\build.py"
if errorlevel 1 (echo [ERROR] Brain build failed. Create chats first, then retry.& pause& exit /b 1)
echo [OK] Semantic brain is ready. Run Amayori.bat to open the app.
pause
exit /b 0

:usage
echo Usage:
echo   Amayori.bat              - start the application
echo   Amayori.bat build-brain  - install Python dependencies and build semantic brain
echo   Amayori.bat help         - show this help
exit /b 2

