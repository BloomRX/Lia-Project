@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem ==== Lia / AIRI — Full QA (Windows) =======================================
rem Runs the real repo QA scripts in a safe order (stops on the first failure):
rem   1) pnpm test:run     -> vitest run (browser + ui suites)
rem   2) pnpm typecheck    -> typecheck over packages/apps/server/docs
rem   3) pnpm build:web    -> turbo build of the Stage Web app
rem Uses only relative paths (%~dp0 -> this pnpm workspace root). It never runs
rem pnpm install and performs no destructive Git operation.
rem ============================================================================

cd /d "%~dp0"
chcp 65001 >nul 2>nul

echo.
echo ============================================
echo  Lia / AIRI - QA completo
echo ============================================
echo.

rem ---------------------------------------------------------------------------
echo [1/3] Testes ......... pnpm test:run
call pnpm test:run
if errorlevel 1 goto :fail_test

echo [OK] Testes
echo.
rem ---------------------------------------------------------------------------
echo [2/3] Typecheck ...... pnpm typecheck
call pnpm typecheck
if errorlevel 1 goto :fail_typecheck

echo [OK] Typecheck
echo.
rem ---------------------------------------------------------------------------
echo [3/3] Build web ...... pnpm build:web
call pnpm build:web
if errorlevel 1 goto :fail_build

echo [OK] Build web
echo.
echo ============================================
echo  QA concluido com sucesso.
echo ============================================
echo.
pause
exit /b 0

:fail_test
echo.
echo [ERRO] Falhou no passo 1 - comando: pnpm test:run
echo A janela permanece aberta para voce ler o log acima.
echo.
pause
exit /b 1

:fail_typecheck
echo.
echo [ERRO] Falhou no passo 2 - comando: pnpm typecheck
echo A janela permanece aberta para voce ler o log acima.
echo.
pause
exit /b 1

:fail_build
echo.
echo [ERRO] Falhou no passo 3 - comando: pnpm build:web
echo A janela permanece aberta para voce ler o log acima.
echo.
pause
exit /b 1
