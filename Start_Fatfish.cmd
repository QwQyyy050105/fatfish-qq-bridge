@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22.13 or newer, then open this launcher again.
  pause
  exit /b 1
)
node -e "const v=process.versions.node.split('.').map(Number);if(v[0]<22||(v[0]===22&&v[1]<13)){console.error('Node.js 22.13 or newer is required');process.exit(1)}"
if errorlevel 1 (
  pause
  exit /b 1
)
if not exist node_modules\ws\package.json (
  echo Open a terminal in this folder and run npm ci first.
  pause
  exit /b 1
)
node --env-file-if-exists=.env src/main.mjs start
pause
