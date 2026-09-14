@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem ==== Lia / AIRI — DevKit menu (Windows) ====================================
rem Runs the real scripts declared in this pnpm workspace's package.json.
rem Does NOT rely on / reuse the generic Python DevKit.bat at the repo root.
rem Works from double-click, a terminal, or PowerShell invoking this .bat.
rem ============================================================================

cd /d "%~dp0"
chcp 65001 >nul 2>nul

:menu
cls
echo ============================================
echo         Lia - DevKit  (pnpm workspace)
echo   raiz: %~dp0
echo ============================================
echo.
echo   [1] QA completo        (test:run + typecheck + build:web)
echo   [2] Iniciar Tamagotchi (pnpm dev:tamagotchi)
echo   [3] Typecheck          (pnpm typecheck)
echo   [4] Build web          (pnpm build:web)
echo   [5] Testes             (pnpm test:run)
echo   [6] Git status
echo   [0] Sair
echo.
set "OP="
set /p "OP=Escolha uma opcao e pressione Enter: "

if "%OP%"=="0" exit /b 0
if "%OP%"=="1" goto opt_qa
if "%OP%"=="2" goto opt_dev
if "%OP%"=="3" goto opt_tc
if "%OP%"=="4" goto opt_build
if "%OP%"=="5" goto opt_test
if "%OP%"=="6" goto opt_git
echo Opcao invalida: "%OP%"
echo.
pause
goto menu

:opt_qa
call "%~dp0QA.bat"
goto menu

:opt_dev
call "%~dp0DevTamagotchi.bat"
goto menu

:opt_tc
echo.
echo [Typecheck] Executando: pnpm typecheck
call pnpm typecheck
if errorlevel 1 ( echo [ERRO] Typecheck ) else ( echo [OK] Typecheck )
echo.
pause
goto menu

:opt_build
echo.
echo [Build web] Executando: pnpm build:web
call pnpm build:web
if errorlevel 1 ( echo [ERRO] Build web ) else ( echo [OK] Build web )
echo.
pause
goto menu

:opt_test
echo.
echo [Testes] Executando: pnpm test:run
call pnpm test:run
if errorlevel 1 ( echo [ERRO] Testes ) else ( echo [OK] Testes )
echo.
pause
goto menu

:opt_git
echo.
git status
echo.
pause
goto menu
