@echo off
rem ======================================================================
rem  QA-Miniconda.bat  -  Phase 5 rounds 3-4, item D (manual diagnostic)
rem
rem  Runs ONLY the Miniconda installer that atsetup.bat already downloaded,
rem  outside the rest of the AllTalk setup.
rem
rem  Default mode uses EXACTLY the officially documented silent switches -
rem  the same set the app itself now passes (Phase 5 round 4, items A/D):
rem
rem    /InstallationType=JustMe /AddToPath=0 /RegisterPython=0 /S /D=<prefix>
rem
rem  Isolation modes append ONE constructor-level switch at a time, so the
rem  answer to "was exit 2 an argument problem?" is measurable, never guessed:
rem
rem    QA-Miniconda.bat shortcuts   -> adds /NoShortcuts=1
rem    QA-Miniconda.bat registry    -> adds /NoRegistry=1
rem
rem  Nothing global is touched: JustMe, AddToPath=0, RegisterPython=0,
rem  destination inside the Lia runtime tree only.
rem  Prerequisites: run "Instalar" in Lia once, so the installer file exists.
rem ======================================================================
setlocal
set "APPROOT=%APPDATA%\@proj-airi\stage-tamagotchi\runtimes\alltalk\app"
set "ENVDIR=%APPROOT%\alltalk_environment"
set "INSTALLER=%ENVDIR%\miniconda_installer.exe"
set "PREFIX=%ENVDIR%\conda"

set "EXTRA="
if /I "%~1"=="shortcuts" set "EXTRA=/NoShortcuts=1"
if /I "%~1"=="registry" set "EXTRA=/NoRegistry=1"

echo [QA-MINICONDA] installer=%INSTALLER%
if not exist "%INSTALLER%" (
    echo [QA-MINICONDA] installer MISSING - click "Instalar" in Lia first, then re-run this file.
    exit /b 1
)
for %%A in ("%INSTALLER%") do echo [QA-MINICONDA] installer bytes=%%~zA
echo [QA-MINICONDA] prefix=%PREFIX%
if defined EXTRA (echo [QA-MINICONDA] isolation mode: %EXTRA%) else (echo [QA-MINICONDA] isolation mode: official arguments only)
echo [QA-MINICONDA] running installer directly...
"%INSTALLER%" /InstallationType=JustMe /AddToPath=0 /RegisterPython=0 /S %EXTRA% /D=%PREFIX%
echo [QA-MINICONDA] installer exit code=%ERRORLEVEL%

if exist "%PREFIX%\" (echo [QA-MINICONDA] conda prefix exists=true) else (echo [QA-MINICONDA] conda prefix exists=false)
if exist "%PREFIX%\_conda.exe" (
    echo [QA-MINICONDA] _conda.exe exists=true
    echo [QA-MINICONDA] direct install WORKS with these arguments.
) else (
    echo [QA-MINICONDA] _conda.exe exists=false
    echo [QA-MINICONDA] direct install failed with these arguments - the exit code above is the clue.
)
endlocal
exit /b 0
