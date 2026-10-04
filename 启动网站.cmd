@echo off
cd /d "%~dp0"
echo Chuanheng website preview
echo Website: http://127.0.0.1:5173/
echo Login: http://127.0.0.1:5173/login
echo Starts the website and API together.
echo Keep this window open while using the preview.
call npm run dev
pause
