@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo 천군교회 예배 출석체크를 시작합니다...
echo 브라우저가 열리지 않으면 http://localhost:8080 으로 접속하세요.
start "" "http://localhost:8080"
python -m http.server 8080
