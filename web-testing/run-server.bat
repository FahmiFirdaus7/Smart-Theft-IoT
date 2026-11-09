@echo off
cd /d D:\3_Coding\6_IoT\projectAkhir_IoT\Smart-Theft-IoT\web-testing
taskkill /F /IM node.exe >nul 2>&1
timeout /t 1 /nobreak >nul
node server.js