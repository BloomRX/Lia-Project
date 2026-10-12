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
rem  revisado; confere o SHA resultante; depois chama o DevKit.bat novo.
rem  Nada e forcado, nada e descartado, nada e escondido.
rem
rem  DISCIPLINA DE SEGURANCA
rem  -----------------------
rem  1. A identidade do remote e conferida por IGUALDADE EXATA contra formas
rem     canonicas completas, nunca por substring. "github.com.evil.com" ou
rem     "BloomRX/Lia-Project-evil" nao passam.
rem  2. A URL do remote NUNCA e impressa. Uma URL pode carregar credencial
rem     embutida; este script nao ecoa, nao "type"-a e nao grava em arquivo.
rem  3. Nenhum arquivo temporario e criado, entao nenhum sobra em caminho de
rem     erro e nenhum nome previsivel fica aberto a colisao.
rem  4. Qualquer duvida encerra sem tocar no checkout.
rem ==========================================================================

set "LIA_EXPECTED_OWNER_REPO=BloomRX/Lia-Project"
set "LIA_EXPECTED_BRANCH=arena/01a10290-lia-project"
rem O commit revisado. Trocado a cada nova revisao do DevFlow.
set "LIA_TARGET_SHA=PLACEHOLDER-REVIEWED-SHA"

rem ---- o placeholder nunca pode ser usado --------------------------------
if /I "%LIA_TARGET_SHA%"=="PLACEHOLDER-REVIEWED-SHA" (
    echo "ERRO: este bootstrap ainda nao tem um commit revisado gravado."
    echo "Recusei rodar em vez de avancar para um alvo desconhecido."
    goto :fail
)

rem ---- raiz do repositorio: argumento, senao o diretorio atual ------------
if not "%~1"=="" (set "LIA_REPO=%~1") else (set "LIA_REPO=%CD%")

if not exist "%LIA_REPO%\.git" (
    echo "ERRO: "%LIA_REPO%" nao parece ser um repositorio Git."
    echo "Arraste a pasta do repositorio Lia para cima deste arquivo."
    goto :fail
)
if not exist "%LIA_REPO%\Lia.bat" (
    echo "ERRO: Lia.bat nao encontrado em "%LIA_REPO%"."
    echo "Este bootstrap so roda na raiz do repositorio Lia."
    goto :fail
)

where git >nul 2>nul
if errorlevel 1 (
    echo ERRO: git nao encontrado no PATH.
    goto :fail
)

rem ---- identidade exata do remote ----------------------------------------
rem Capturado em variavel, nunca em arquivo. "delims=" preserva a linha toda e
rem descarta o final de linha; a URL nunca sai daqui.
set "LIA_URL="
for /f "usebackq delims=" %%U in (`git -C "%LIA_REPO%" remote get-url origin 2^>nul`) do set "LIA_URL=%%U"
if "%LIA_URL%"=="" (
    echo "ERRO: o repositorio nao tem remote 'origin' legivel."
    goto :fail
)

rem Igualdade exata contra as formas canonicas aceitas. De proposito nao ha
rem aqui nenhuma comparacao por substring: ela aceitaria host soslao.
set "LIA_URL_OK="
for %%F in (
    "https://github.com/%LIA_EXPECTED_OWNER_REPO%.git"
    "https://github.com/%LIA_EXPECTED_OWNER_REPO%"
    "ssh://git@github.com/%LIA_EXPECTED_OWNER_REPO%.git"
    "ssh://git@github.com/%LIA_EXPECTED_OWNER_REPO%"
    "git@github.com:%LIA_EXPECTED_OWNER_REPO%.git"
    "git@github.com:%LIA_EXPECTED_OWNER_REPO%"
) do if "%LIA_URL%"=="%%~F" set "LIA_URL_OK=1"

if not "%LIA_URL_OK%"=="1" (
    echo "ERRO: o remote 'origin' nao e %LIA_EXPECTED_OWNER_REPO% em github.com."
    echo "A URL nao sera impressa: ela pode conter credencial embutida."
    echo "Para conferir voce mesmo: git -C "%LIA_REPO%" remote get-url origin"
    goto :fail
)

rem ---- branch esperado; o main nunca e tocado ----------------------------
set "LIA_BRANCH="
for /f "usebackq delims=" %%B in (`git -C "%LIA_REPO%" rev-parse --abbrev-ref HEAD`) do set "LIA_BRANCH=%%B"
if not "%LIA_BRANCH%"=="%LIA_EXPECTED_BRANCH%" (
    echo "ERRO: o branch atual e "%LIA_BRANCH%", esperado "%LIA_EXPECTED_BRANCH%"."
    echo "Este bootstrap nunca troca de branch nem atualiza o main."
    goto :fail
)

rem ---- checkout limpo, sem adivinhacao -----------------------------------
rem Sem arquivo temporario: basta saber se EXISTE alguma linha. -uall impede
rem que um diretorio novo inteiro apareca colapsado em uma entrada so.
set "LIA_DIRTY="
for /f "usebackq delims=" %%L in (`git -C "%LIA_REPO%" status --porcelain -uall`) do set "LIA_DIRTY=1"
if "%LIA_DIRTY%"=="1" (
    echo "ERRO: ha alteracoes nao commitadas em "%LIA_REPO%"."
    echo "FAIL CLOSED: nada sera descartado, escondido ou commitado por voce."
    echo "Faca commit ou reverta o que estiver pendente e rode de novo."
    goto :fail
)

rem ---- alvo revisado precisa resolver para um commit ---------------------
set "LIA_TARGET_RESOLVED="
for /f "usebackq delims=" %%S in (`git -C "%LIA_REPO%" rev-list -n 1 "%LIA_TARGET_SHA%" 2^>nul`) do set "LIA_TARGET_RESOLVED=%%S"
if "%LIA_TARGET_RESOLVED%"=="" (
    echo "ERRO: %LIA_TARGET_SHA% nao resolve para um commit conhecido."
    goto :fail
)

rem ---- fetch e avanco SOMENTE por fast-forward ---------------------------
git -C "%LIA_REPO%" fetch origin "%LIA_EXPECTED_BRANCH%"
if errorlevel 1 (
    echo ERRO: nao consegui alcancar o remote. Nenhuma alteracao foi feita.
    goto :fail
)
git -C "%LIA_REPO%" merge --ff-only "%LIA_TARGET_SHA%"
if errorlevel 1 (
    echo "ERRO: nao foi possivel avancar por fast-forward ate %LIA_TARGET_SHA%."
    echo "FAIL CLOSED: nada foi forcado, mesclado ou descartado."
    goto :fail
)

rem ---- o SHA resultante e conferido, nao presumido -----------------------
rem "merge --ff-only" sair com 0 nao basta: o checkout pode ter parado em outro
rem commit (por exemplo um alvo ja presente). A afirmacao que o DevKit novo vai
rem carregar e sobre UM SHA, entao ele e lido de volta e comparado.
set "LIA_HEAD_NOW="
for /f "usebackq delims=" %%S in (`git -C "%LIA_REPO%" rev-parse HEAD`) do set "LIA_HEAD_NOW=%%S"
if not "%LIA_HEAD_NOW%"=="%LIA_TARGET_RESOLVED%" (
    echo "ERRO: o checkout terminou em %LIA_HEAD_NOW%, esperado %LIA_TARGET_RESOLVED%."
    echo "FAIL CLOSED: nenhum ajuste foi tentado. Verifique o estado do repositorio."
    goto :fail
)

echo "Checkout atualizado para %LIA_HEAD_NOW%."
echo Chamando o DevKit.bat novo...
echo.
rem O codigo de saida do DevKit novo e propagado; ele nao e engolido aqui.
call "%LIA_REPO%\DevKit.bat"
set "LIA_DEVKIT_RC=%ERRORLEVEL%"
exit /b %LIA_DEVKIT_RC%

:fail
echo.
echo O bootstrap terminou sem alterar o checkout.
pause
exit /b 1
