@echo off
setlocal
rem ---------------------------------------------------------------
rem  Abrir-Lia.bat
rem  Abre a Lia empacotada (stage-tamagotchi) direto da raiz do repo,
rem  sem precisar procurar dentro da pasta airi.
rem
rem  Ordem de preferencia:
rem    1) Instalador NSIS nao faz parte da abertura; o .bat abre o app
rem       portavel em win-unpacked\Lia.exe.
rem    2) Se o app ainda nao estiver empacotado, mostra o instalador
rem       disponivel (dist\Lia-*-setup.exe) ou o comando para gerar.
rem ---------------------------------------------------------------

set "APP_ROOT=%~dp0airi\apps\stage-tamagotchi"
set "EXE=%APP_ROOT%\dist\win-unpacked\Lia.exe"

if exist "%EXE%" (
  echo Abrindo a Lia em %EXE% ...
  start "" "%EXE%"
  exit /b 0
)

echo [Lia] A Lia empacotada ainda nao foi encontrada:
echo       %EXE%
echo.

set "SETUP="
for %%F in ("%~dp0airi\apps\stage-tamagotchi\dist\Lia-*-windows-*-setup.exe") do set "SETUP=%%~fF"

if defined SETUP (
  echo Foi encontrado o instalador:
  echo   %SETUP%
  echo Instale por ele ou gere o app portavel com o comando abaixo.
) else (
  echo Nenhum instalador foi encontrado na pasta dist.
)
echo.
echo Para empacotar o app portavel, rode (a partir da pasta airi):
echo   cd /d "%~dp0airi"
echo   pnpm --filter @proj-airi/stage-tamagotchi run build:unpack
echo.
echo Depois rode este .bat de novo e a Lia abre direto.
echo.
pause
exit /b 1
