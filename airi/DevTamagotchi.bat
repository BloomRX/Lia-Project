@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem ==== Lia / AIRI — Launch Stage Tamagotchi (desktop) ========================
rem Runs the real repo script: pnpm dev:tamagotchi
rem Works from double-click, a terminal, or PowerShell invoking this .bat.
rem The window is kept open on error so the log can be read.
rem ============================================================================

rem Move to the directory where this script lives (the pnpm workspace root).
cd /d "%~dp0"
chcp 65001 >nul 2>nul

echo.
echo ============================================
echo  Lia - Stage Tamagotchi (dev)
echo  pnpm dev:tamagotchi
echo ============================================
echo.
echo Pressione Ctrl+C no terminal para encerrar o servidor de desenvolvimento.
echo.

call pnpm dev:tamagotchi
set "RC=%ERRORLEVEL%"

echo.
if not "%RC%"=="0" (
  echo [ERRO] "pnpm dev:tamagotchi" falhou com codigo %RC%.
  echo Confira a mensagem acima e mantenha esta janela aberta.
  echo.
  pause
  exit /b %RC%
)

echo [OK] Stage Tamagotchi encerrou normalmente.
echo.
pause
exit /b 0
