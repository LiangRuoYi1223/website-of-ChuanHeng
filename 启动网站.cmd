@echo off
cd /d "%~dp0"
echo Chuanheng website preview
echo Website: http://127.0.0.1:5173/
echo Keep this window open while using the preview.
call npm run dev
pause
