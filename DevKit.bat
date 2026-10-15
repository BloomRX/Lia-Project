@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "PYTHONUTF8=1"
chcp 65001 >nul 2>nul

rem ==========================================================================
rem  DevKit.bat - UNICO entrypoint de desenvolvimento da Lia.
rem
rem  CONTRATO: duplo clique = AUTO. Sem menu, sem numero, sem submenu Git,
rem  sem pull manual, sem build manual, sem clique em Conversar, sem S/N.
rem
rem  Comandos avancados (somente com argumento explicito):
rem      DevKit.bat auto|menu|round|status|open|diagnose|rounds
rem      DevKit.bat git <subcomando do DevKit universal>
rem
rem  Este arquivo e fino de proposito. Ele se COPIA para %TEMP% e reexecuta a
rem  copia, porque o cmd.exe le um .bat por deslocamento de byte: se o checkout
rem  for atualizado por cima dele no meio da execucao, o script em andamento se
rem  corrompe.
rem
rem  PONTO CRITICO: dentro da copia, %~dp0 e o %TEMP%, NAO o repositorio. A raiz
rem  ORIGINAL e verificada aqui e exportada em LIA_DEVKIT_ROOT antes da copia;
rem  a copia so usa essa variavel. Nenhum caminho de maquina e embutido.
rem ==========================================================================

if defined LIA_DEVKIT_BOOTSTRAP_COPY goto :body

rem ---- raiz original, capturada e verificada ANTES de qualquer copia --------
set "LIA_DEVKIT_ROOT=%~dp0"
if not exist "%LIA_DEVKIT_ROOT%tools\lia_dev.py" (
    echo ERRO: tools\lia_dev.py nao encontrado em "%LIA_DEVKIT_ROOT%".
    echo Rode o DevKit.bat que esta na raiz do repositorio Lia.
    goto :fail
)

rem ---- copia temporaria com nome unico por execucao -------------------------
rem Nome unico de proposito: duas sessoes simultaneas nao podem compartilhar um
rem arquivo, e uma copia antiga nunca pode ser confundida com a desta execucao.
set "LIA_DEVKIT_COPY=%TEMP%\lia-devkit-%RANDOM%-%RANDOM%.bat"
if exist "%LIA_DEVKIT_COPY%" (
    echo ERRO: a copia temporaria "%LIA_DEVKIT_COPY%" ja existe.
    echo Nada sera executado a partir de uma copia de origem desconhecida.
    goto :fail
)
copy /y "%~f0" "%LIA_DEVKIT_COPY%" >nul 2>nul
if errorlevel 1 (
    echo ERRO: nao consegui copiar o DevKit.bat para "%LIA_DEVKIT_COPY%".
    echo FAIL CLOSED: nada sera executado a partir do arquivo original, que
    echo pode ser sobrescrito durante a atualizacao.
    goto :fail
)
if not exist "%LIA_DEVKIT_COPY%" (
    echo ERRO: a copia temporaria nao foi criada.
    goto :fail
)

set "LIA_DEVKIT_BOOTSTRAP_COPY=%LIA_DEVKIT_COPY%"
"%LIA_DEVKIT_COPY%" %*
set "LIA_DEVKIT_RC=%ERRORLEVEL%"
del "%LIA_DEVKIT_COPY%" >nul 2>nul
exit /b %LIA_DEVKIT_RC%

:body
rem ---- a partir daqui roda a COPIA; a raiz vem de LIA_DEVKIT_ROOT -----------
if not defined LIA_DEVKIT_ROOT (
    echo ERRO: LIA_DEVKIT_ROOT ausente; a raiz do repositorio nao foi herdada.
    goto :fail
)
if not exist "%LIA_DEVKIT_ROOT%tools\lia_dev.py" (
    echo ERRO: tools\lia_dev.py nao encontrado em "%LIA_DEVKIT_ROOT%".
    goto :fail
)

rem ---- descoberta do Python (>= 3.10) ---------------------------------------
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
goto :fail

:dispatch
rem ---- duplo clique / sem argumentos = BOOTSTRAP + AUTO ---------------------
rem Nao ha SHIFT aqui. No cmd.exe o SHIFT nao reescreve %*, entao "DevKit.bat
rem git publish" repassaria o token "git" junto. Quem descarta o primeiro token
rem e o proprio Python, com a linha de comando original intacta.
rem Fluxo por rotulo, NAO por bloco parentetizado. O cmd.exe expande
rem %ERRORLEVEL% quando o bloco inteiro e lido, antes de o Python rodar, entao
rem `if ... ( cmd & set RC=%ERRORLEVEL% )` gravaria o codigo ANTERIOR e um
rem bootstrap com falha seria reportado como sucesso.
if not "%~1"=="" goto :with_args

%RUNPY% "%LIA_DEVKIT_ROOT%tools\lia_dev.py" bootstrap
set "LIA_DEVKIT_RC=%ERRORLEVEL%"
goto :finish

:with_args
%RUNPY% "%LIA_DEVKIT_ROOT%tools\lia_dev.py" %*
set "LIA_DEVKIT_RC=%ERRORLEVEL%"
goto :finish

:fail
set "LIA_DEVKIT_RC=1"

:finish
if not "%LIA_DEVKIT_RC%"=="0" echo O DevKit terminou com erro. Leia a mensagem acima.
if "%LIA_DEVKIT_NO_PAUSE%"=="" (
    echo.
    echo Pressione qualquer tecla para fechar.
    pause >nul
)
rem A COPIA NAO SE REMOVE. O cmd.exe le um .bat por deslocamento de byte,
rem entao apagar "%~f0" aqui deixaria a linha seguinte - justamente o
rem "exit /b" que devolve o codigo real - sem arquivo de onde ser lida, e o
rem DevKit reportaria 1 em vez do codigo do Python. Quem remove a copia e o
rem dono, depois de capturar o ERRORLEVEL. O nome e unico por execucao, entao
rem uma sobra nunca e reutilizada.
exit /b %LIA_DEVKIT_RC%
