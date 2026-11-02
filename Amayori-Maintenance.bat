@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0" || exit /b 1
echo ====================================
echo  Amayori - Maintenance
echo ====================================
echo 1. Start Amayori
echo 2. Backup local data
echo 3. List backups
echo 4. Download Project Golem source (no agents)
echo 5. Run Node tests
echo 0. Exit
set /p "CHOICE=Select: "
if "%CHOICE%"=="1" call "%~dp0Amayori.bat"
if "%CHOICE%"=="2" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\backup.ps1" -Action backup
if "%CHOICE%"=="3" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\backup.ps1" -Action list
if "%CHOICE%"=="4" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-golem.ps1"
if "%CHOICE%"=="5" (where npm.cmd >nul 2>&1 && npm.cmd test || echo npm.cmd not found or tests failed)
pause
