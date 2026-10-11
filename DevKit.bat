@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
set "PYTHONUTF8=1"
chcp 65001 >nul 2>nul

rem ==========================================================================
rem  DevKit.bat - unico entrypoint de desenvolvimento Windows da Lia.
rem
rem  Fina de proposito: descobre o Python e delega. Sem orquestracao em batch.
rem    sem argumentos -> tools\lia_dev.py menu  (rodada atual, estado, diagnostico)
rem    com argumentos -> tools\project_cli.py    (DevKit universal / Git)
rem ==========================================================================

if not exist "%~dp0tools\lia_dev.py" (
    echo ERRO: tools\lia_dev.py nao encontrado ao lado do DevKit.bat.
    set "RC=1"
    goto :finish
)

where py >nul 2>nul
if not errorlevel 1 (
    py -3 -c "import sys; raise SystemExit(sys.version_info < (3, 10))" >nul 2>nul
    if not errorlevel 1 goto :use_py
)

where python >nul 2>nul
if not errorlevel 1 (
    python -c "import sys; raise SystemExit(sys.version_info < (3, 10))" >nul 2>nul
    if not errorlevel 1 goto :use_python
)

echo ERRO: Python 3.10 ou superior nao encontrado.
echo Instale o Python com o launcher py ou marque Add Python to PATH.
set "RC=1"
goto :finish

:use_py
set "RUNPY=py -3"
goto :dispatch

:use_python
set "RUNPY=python"
goto :dispatch

:dispatch
if "%~1"=="" goto :lia_menu
%RUNPY% "%~dp0tools\project_cli.py" %*
set "RC=%ERRORLEVEL%"
goto :finish

:lia_menu
%RUNPY% "%~dp0tools\lia_dev.py" menu
set "RC=%ERRORLEVEL%"

:finish
if not "%RC%"=="0" echo O DevKit terminou com erro. Leia a mensagem acima.
if "%~1"=="" (
    echo.
    pause
)
exit /b %RC%
