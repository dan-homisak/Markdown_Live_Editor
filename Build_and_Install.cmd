@echo off
setlocal
cd /d "%~dp0"
node scripts\build-and-install.mjs
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" (
  echo.
  echo Build and install failed with exit code %RESULT%.
) else (
  echo.
  echo Build and install completed. Reload VS Code to activate the extension.
)
if "%MLRT_NO_PAUSE%"=="1" exit /b %RESULT%
pause
exit /b %RESULT%
