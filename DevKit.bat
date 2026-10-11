@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
set "PYTHONUTF8=1"
chcp 65001 >nul 2>nul

rem ==========================================================================
rem  DevKit.bat - UNICO entrypoint de desenvolvimento da Lia.
rem
rem  CONTRATO: duplo clique = AUTO. Sem menu, sem numero, sem submenu Git,
rem  sem pull manual, sem build manual, sem clique em Conversar, sem S/N.
rem
rem  Comandos avancados (explicitos):
rem      DevKit.bat auto|menu|round|status|open|diagnose|rounds
rem      DevKit.bat git <subcomando do DevKit universal>
rem
rem  Este arquivo e fino de proposito. Ele se COPIA para %TEMP% e reexecuta a
rem  copia: o checkout pode ser atualizado por cima sem que o cmd.exe continue
rem  lendo um .bat que mudou de tamanho no meio da execucao.
rem ==========================================================================

if not defined LIA_DEVKIT_BOOTSTRAP_COPY (
    set "LIA_DEVKIT_BOOTSTRAP_COPY=1"
    set "LIA_DEVKIT_COPY=%TEMP%\lia-devkit-bootstrap.bat"
    copy /y "%~f0" "%LIA_DEVKIT_COPY%" >nul 2>nul
    if exist "%LIA_DEVKIT_COPY%" "%LIA_DEVKIT_COPY%" %*
    if exist "%LIA_DEVKIT_COPY%" exit /b %ERRORLEVEL%
)

if not exist "%~dp0tools\lia_dev.py" (
    echo ERRO: tools\lia_dev.py nao encontrado ao lado do DevKit.bat.
    set "RC=1"
    goto :finish
)

rem ---- descoberta do Python (>= 3.10) -------------------------------------
where py >nul 2>nul
if not errorlevel 1 (
    py -3 -c "import sys; raise SystemExit(sys.version_info < (3, 10))" >nul 2>nul
    if not errorlevel 1 (
        set "RUNPY=py -3"
        goto :dispatch
    )
)
where python >nul 2>nul
if not errorlevel 1 (
    python -c "import sys; raise SystemExit(sys.version_info < (3, 10))" >nul 2>nul
    if not errorlevel 1 (
        set "RUNPY=python"
        goto :dispatch
    )
)
echo ERRO: Python 3.10 ou superior nao encontrado.
echo Instale o Python com o launcher py ou marque Add Python to PATH.
set "RC=1"
goto :finish

:dispatch
rem ---- DevKit universal (Git) apenas com argumento explicito --------------
if /I "%~1"=="git" (
    shift
    %RUNPY% "%~dp0tools\project_cli.py" %*
    set "RC=%ERRORLEVEL%"
    goto :finish
)

rem ---- duplo clique / sem argumentos = BOOTSTRAP + AUTO -------------------
if "%~1"=="" (
    %RUNPY% "%~dp0tools\lia_dev.py" bootstrap
    set "RC=%ERRORLEVEL%"
    goto :finish
)

%RUNPY% "%~dp0tools\lia_dev.py" %*
set "RC=%ERRORLEVEL%"

:finish
if not "%RC%"=="0" echo O DevKit terminou com erro. Leia a mensagem acima.
if "%LIA_DEVKIT_NO_PAUSE%"=="" (
    echo.
    echo Pressione qualquer tecla para fechar.
    pause >nul
)
exit /b %RC%
