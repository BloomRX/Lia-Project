@echo off
rem ======================================================================
rem  QA-Miniconda.bat  -  Phase 5 round 3, item D (manual diagnostic)
rem
rem  Runs ONLY the Miniconda installer that atsetup.bat already downloaded,
rem  with EXACTLY the same arguments atsetup.bat uses, outside the rest of
rem  the AllTalk setup. It answers one question:
rem
rem    Case 1: direct install works  -> the bug is upstream's start /wait line
rem    Case 2: direct install fails  -> the bug is NSIS/args/path/Windows
rem
rem  Nothing global is touched: JustMe, AddToPath=0, RegisterPython=0,
rem  NoRegistry=1, destination inside the Lia runtime tree only.
rem  Prerequisites: run "Instalar" in Lia once, so the installer file exists.
rem ======================================================================
setlocal
set "APPROOT=%APPDATA%\@proj-airi\stage-tamagotchi\runtimes\alltalk\app"
set "ENVDIR=%APPROOT%\alltalk_environment"
set "INSTALLER=%ENVDIR%\miniconda_installer.exe"
set "PREFIX=%ENVDIR%\conda"

echo [QA-MINICONDA] installer=%INSTALLER%
if not exist "%INSTALLER%" (
    echo [QA-MINICONDA] installer MISSING - click "Instalar" in Lia first, then re-run this file.
    exit /b 1
)
for %%A in ("%INSTALLER%") do echo [QA-MINICONDA] installer bytes=%%~zA
echo [QA-MINICONDA] prefix=%PREFIX%
echo [QA-MINICONDA] running installer directly with the pinned arguments...
"%INSTALLER%" /InstallationType=JustMe /NoShortcuts=1 /AddToPath=0 /RegisterPython=0 /NoRegistry=1 /S /D=%PREFIX%
echo [QA-MINICONDA] installer exit code=%ERRORLEVEL%

if exist "%PREFIX%\" (echo [QA-MINICONDA] conda prefix exists=true) else (echo [QA-MINICONDA] conda prefix exists=false)
if exist "%PREFIX%\_conda.exe" (
    echo [QA-MINICONDA] _conda.exe exists=true
    echo [QA-MINICONDA] CASE 1: direct install works - upstream's start /wait line is the broken part.
) else (
    echo [QA-MINICONDA] _conda.exe exists=false
    echo [QA-MINICONDA] CASE 2: direct install failed - the exit code above is the first real clue.
)
endlocal
exit /b 0
