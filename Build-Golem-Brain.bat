@echo off
cd /d "%~dp0"
py -3 -m pip install -r integrations/golem/requirements.txt
if errorlevel 1 exit /b 1
py -3 integrations/golem/build.py
pause
