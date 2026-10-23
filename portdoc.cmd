@echo off
setlocal

where node.exe >nul 2>nul
if errorlevel 1 (
  echo.
  echo  PORTDOC needs Node.js 18 or newer.
  echo  Install Node.js, then run this launcher again.
  echo.
  pause
  exit /b 2
)

node.exe "%~dp0bin\portdoc.js" %*
exit /b %errorlevel%
