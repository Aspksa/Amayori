@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title Amayori
cd /d "%~dp0" || (echo [ERROR] Cannot open project folder.& pause& exit /b 1)
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
