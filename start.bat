@echo off
chcp 65001 >nul
echo Đang khởi động Web App Quản lí & Nhắc hẹn Google Sheet + Public Web Tunnel...
start "Public Web Tunnel (Cloudflare)" cmd /k "node "%~dp0tunnel.js""
start "" "http://127.0.0.1:3456"
node "%~dp0server.js"
