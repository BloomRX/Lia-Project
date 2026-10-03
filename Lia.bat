@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem ==========================================================================
rem  Lia.bat - start the Lia Launcher (dev) from the repository root.
rem
rem  Double-click target. It locates the repo reliably, runs ONLY the
rem  independent Lia App (airi/apps/lia-app), keeps console logging visible,
rem  and exits cleanly on Ctrl+C. It NEVER launches AIRI - the stage only
rem  rises from the "Conversar com Lia" button inside the launcher.
rem ==========================================================================

set "SCRIPT_DIR=%~dp0"
set "REPO_ROOT=%SCRIPT_DIR%"
set "AIRI_DIR=%REPO_ROOT%airi"

title Lia

if not exist "%AIRI_DIR%\pnpm-workspace.yaml" (
  echo [Lia] Could not find the workspace at "%AIRI_DIR%".
  echo [Lia] Make sure Lia.bat sits at the repository root next to the airi folder.
  exit /b 1
)

where pnpm >nul 2>nul
if errorlevel 1 (
  echo [Lia] pnpm was not found on PATH.
  echo [Lia] Install Node.js ^(LTS^) and enable pnpm with:  corepack enable
  exit /b 1
)

if not exist "%AIRI_DIR%\node_modules" (
  echo [Lia] Dependencies are missing. Install them once from "%AIRI_DIR%":
  echo         pnpm install
  exit /b 1
)

echo [Lia] Starting the Lia Launcher ^(dev^)...
echo [Lia] This window only runs the launcher - AIRI starts when YOU click "Conversar com Lia".
echo.

pushd "%AIRI_DIR%"
call pnpm dev:lia
set "EXIT_CODE=%ERRORLEVEL%"
popd

echo.
if "%EXIT_CODE%"=="0" (
  echo [Lia] Closed cleanly.
) else (
  echo [Lia] Exited with code %EXIT_CODE%.
)
endlocal & exit /b %EXIT_CODE%
