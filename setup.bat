@echo off
rem Sets up dependencies and builds dist\ani-cli GUI <version>.exe (portable).
rem   setup.bat          install deps + build
rem   setup.bat run      install deps + launch in dev mode
setlocal
cd /d "%~dp0"

where winget >nul 2>&1 || (echo winget not found. Install "App Installer" from the Microsoft Store. & exit /b 1)

where node >nul 2>&1 || (
  echo Installing Node.js LTS...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements || exit /b 1
  echo Node.js installed. Open a new terminal and run setup.bat again so PATH picks it up.
  exit /b 0
)

rem Runtime tools: ffmpeg downloads (and ffplay fallback), mpv plays. New PATH entries apply to new terminals.
where ffmpeg >nul 2>&1 || winget install -e --id Gyan.FFmpeg --accept-source-agreements --accept-package-agreements
where mpv >nul 2>&1 || winget install -e --id shinchiro.mpv --accept-source-agreements --accept-package-agreements

echo Installing npm packages...
call npm ci || exit /b 1

if /i "%~1"=="run" (
  call npm start
  exit /b
)

echo Building...
call npm run build || exit /b 1
echo.
echo Done. App is in dist\
dir /b dist\*.exe
