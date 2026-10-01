@echo off
chcp 65001 > nul
echo ================================================
echo    7942 학급 독서 미션 웹 서버를 시작합니다
echo ================================================
echo.
echo 브라우저에서 아래 주소로 접속하세요:
echo http://localhost:3000
echo.
start http://localhost:3000
"C:\Program Files\nodejs\node.exe" server.js
pause
