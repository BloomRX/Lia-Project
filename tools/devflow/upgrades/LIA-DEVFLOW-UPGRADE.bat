@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "PYTHONUTF8=1"
chcp 65001 >nul 2>nul

rem ==========================================================================
rem  LIA-DEVFLOW-UPGRADE.bat - bootstrap de transicao, USO UNICO.
rem
rem  POR QUE ESTE ARQUIVO EXISTE
rem  ---------------------------
rem  O DevKit.bat que esta no seu checkout hoje e a versao ANTERIOR ao piloto
rem  automatico. Um recurso introduzido no DevKit NOVO nao pode rodar dentro do
rem  DevKit ANTIGO antes de ser baixado. Portanto este arquivo NAO depende de
rem  nenhum arquivo novo existir: ele so precisa do git.
rem
rem  COMO ELE E ENTREGUE
rem  -------------------
rem  FORA do checkout (anexo da conversa ou download). Coloca-lo apenas no Git
rem  nao resolveria o problema: voce nao teria como executa-lo antes do update
rem  que ele proprio faz.
rem
rem  COMO USAR (zero escolha, zero digitacao)
rem  ----------------------------------------
rem  Arraste a pasta do repositorio Lia para cima deste arquivo.
rem  Ou copie este arquivo para a raiz do repositorio e de dois cliques.
rem
rem  O QUE ELE FAZ
rem  -------------
rem  Confere repositorio, remote fixado e branch; recusa se houver alteracao nao
rem  commitada; faz fetch e avanca SOMENTE por fast-forward ate o commit
rem  revisado; depois chama o DevKit.bat novo. Nada e forcado, nada e descartado.
rem ==========================================================================

set "LIA_EXPECTED_OWNER_REPO=BloomRX/Lia-Project"
set "LIA_EXPECTED_BRANCH=arena/01a10290-lia-project"
rem O commit revisado. Trocado a cada nova revisao do DevFlow.
set "LIA_TARGET_SHA=PLACEHOLDER-REVIEWED-SHA"

rem ---- raiz do repositorio: argumento, senao o diretorio atual --------------
if not "%~1"=="" (
    set "LIA_REPO=%~1"
) else (
    set "LIA_REPO=%CD%"
)

if not exist "%LIA_REPO%\.git" (
    echo ERRO: "%LIA_REPO%" nao parece ser um repositorio Git.
    echo Arraste a pasta do repositorio Lia para cima deste arquivo.
    goto :fail
)
if not exist "%LIA_REPO%\Lia.bat" (
    echo ERRO: Lia.bat nao encontrado em "%LIA_REPO%".
    echo Este bootstrap so roda na raiz do repositorio Lia.
    goto :fail
)

where git >nul 2>nul
if errorlevel 1 (
    echo ERRO: git nao encontrado no PATH.
    goto :fail
)

rem ---- remote fixado: mesmo dono, mesmo repositorio, mesmo host -------------
git -C "%LIA_REPO%" remote get-url origin > "%TEMP%\lia-upgrade-url.txt" 2>nul
if errorlevel 1 (
    echo ERRO: o repositorio nao tem remote 'origin'.
    goto :fail
)
findstr /I /C:"github.com" "%TEMP%\lia-upgrade-url.txt" >nul
if errorlevel 1 (
    echo ERRO: o remote 'origin' nao aponta para github.com.
    type "%TEMP%\lia-upgrade-url.txt"
    goto :fail
)
findstr /I /C:"%LIA_EXPECTED_OWNER_REPO%" "%TEMP%\lia-upgrade-url.txt" >nul
if errorlevel 1 (
    echo ERRO: o remote 'origin' nao e %LIA_EXPECTED_OWNER_REPO%.
    type "%TEMP%\lia-upgrade-url.txt"
    goto :fail
)
del "%TEMP%\lia-upgrade-url.txt" >nul 2>nul

rem ---- branch esperado; o main nunca e tocado -------------------------------
for /f "usebackq delims=" %%B in (`git -C "%LIA_REPO%" rev-parse --abbrev-ref HEAD`) do set "LIA_BRANCH=%%B"
if not "%LIA_BRANCH%"=="%LIA_EXPECTED_BRANCH%" (
    echo ERRO: o branch atual e "%LIA_BRANCH%", esperado "%LIA_EXPECTED_BRANCH%".
    echo Este bootstrap nunca troca de branch nem atualiza o main.
    goto :fail
)

rem ---- checkout limpo, sem adivinhacao --------------------------------------
git -C "%LIA_REPO%" status --porcelain -z > "%TEMP%\lia-upgrade-dirty.txt" 2>nul
for %%S in ("%TEMP%\lia-upgrade-dirty.txt") do set "LIA_DIRTY_BYTES=%%~zS"
del "%TEMP%\lia-upgrade-dirty.txt" >nul 2>nul
if not "%LIA_DIRTY_BYTES%"=="0" (
    echo ERRO: ha alteracoes nao commitadas em "%LIA_REPO%".
    echo FAIL CLOSED: nada sera descartado, escondido ou commitado por voce.
    echo Faca commit ou reverta o que estiver pendente e rode de novo.
    goto :fail
)

rem ---- fetch e avanco SOMENTE por fast-forward ------------------------------
git -C "%LIA_REPO%" fetch origin "%LIA_EXPECTED_BRANCH%"
if errorlevel 1 (
    echo ERRO: nao consegui alcancar o remote. Nenhuma alteracao foi feita.
    goto :fail
)
git -C "%LIA_REPO%" merge --ff-only "%LIA_TARGET_SHA%"
if errorlevel 1 (
    echo ERRO: nao foi possivel avancar por fast-forward ate %LIA_TARGET_SHA%.
    echo FAIL CLOSED: nada foi forcado, mesclado ou descartado.
    goto :fail
)

echo Checkout atualizado para %LIA_TARGET_SHA%.
echo Chamando o DevKit.bat novo...
echo.
call "%LIA_REPO%\DevKit.bat"
exit /b %ERRORLEVEL%

:fail
echo.
echo O bootstrap terminou sem alterar o checkout.
pause
exit /b 1
