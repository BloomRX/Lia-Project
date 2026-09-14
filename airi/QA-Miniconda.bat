@echo off
rem ======================================================================
rem  QA-Miniconda.bat  -  Phase 5 rounds 3-5, item D (manual diagnostic)
rem
rem  Runs ONLY the Miniconda installer that atsetup.bat already downloaded,
rem  outside the rest of the AllTalk setup.
rem
rem  ROUND 5 FACTS (do not edit):
rem  The pinned atsetup.bat downloads exactly:
rem    https://repo.anaconda.com/miniconda/Miniconda3-py311_24.4.0-0-Windows-x86_64.exe
rem  Official record (repo.anaconda.com index, file dated 2024-05-20):
rem    size   ~81.7M  (expected exact bytes: 85,690,400)
rem    sha256 fb6aaeaf92907b8e7598aac0f7b29793a00b27641dc074a961eeb86ff86d0268
rem  Round 5 already proved: with the official silent switches and a clean
rem  win32 /D path the installer STILL exits 2 with empty stdout/stderr.
rem  So remaining hypotheses are: (h1) special character "@" in the real
rem  destination path (...Roaming\@proj-airi\...), (h2) the downloaded
rem  file was corrupted in place after a good download, (h3) local
rem  AV / SmartScreen / Controlled Folder Access blocking the write.
rem
rem  MODES (one per run, first argument):
rem    QA-Miniconda.bat              default: facts + sha256 + official-args
rem                                  silent install into the REAL prefix
rem    QA-Miniconda.bat cleanpath    SAME official-args install, but with
rem                                  /D=%TEMP%\lia-qa-conda (no "@", short).
rem                                  exit 0 here => h1 (path) confirmed.
rem                                  exit 2 here => h3 (environment) leads.
rem    QA-Miniconda.bat redownload   deletes the cached installer, downloads
rem                                  the EXACT pinned URL again, re-verifies
rem                                  size+sha256, then runs the default install
rem                                  => isolates h2 (in-place corruption).
rem    QA-Miniconda.bat shortcuts    adds /NoShortcuts=1 (round-4 isolation)
rem    QA-Miniconda.bat registry     adds /NoRegistry=1  (round-4 isolation)
rem
rem  Nothing global is touched: JustMe, AddToPath=0, RegisterPython=0,
rem  destinations only under the Lia runtime tree or %TEMP%\lia-qa-conda.
rem  Prerequisites: run "Instalar" in Lia once, so the installer file
rem  exists (not needed for the "redownload" mode).
rem ======================================================================
setlocal
set "APPROOT=%APPDATA%\@proj-airi\stage-tamagotchi\runtimes\alltalk\app"
set "ENVDIR=%APPROOT%\alltalk_environment"
set "INSTALLER=%ENVDIR%\miniconda_installer.exe"
set "PREFIX=%ENVDIR%\conda"
set "DOWNLOAD_URL=https://repo.anaconda.com/miniconda/Miniconda3-py311_24.4.0-0-Windows-x86_64.exe"
set "EXPECTED_BYTES=85690400"
set "EXPECTED_SHA256=fb6aaeaf92907b8e7598aac0f7b29793a00b27641dc074a961eeb86ff86d0268"

set "EXTRA="
set "MODE=%~1"
if /I "%MODE%"==""          set "MODE=default"
if /I "%MODE%"=="cleanpath" set "PREFIX=%TEMP%\lia-qa-conda"
if /I "%MODE%"=="shortcuts" set "EXTRA=/NoShortcuts=1"
if /I "%MODE%"=="registry"  set "EXTRA=/NoRegistry=1"

echo [QA-MINICONDA] mode=%MODE%
if /I "%MODE%"=="redownload" goto Redownload

:Facts
echo [QA-MINICONDA] installer=%INSTALLER%
if not exist "%INSTALLER%" (
    echo [QA-MINICONDA] installer MISSING - click "Instalar" in Lia first, or run: QA-Miniconda.bat redownload
    exit /b 1
)
for %%A in ("%INSTALLER%") do echo [QA-MINICONDA] installer bytes=%%~zA (expected %EXPECTED_BYTES%)
echo [QA-MINICONDA] installer sha256 (expected %EXPECTED_SHA256%):
certutil -hashfile "%INSTALLER%" SHA256 | findstr /R /C:"[0-9a-f][0-9a-f]"
echo [QA-MINICONDA] prefix=%PREFIX%
if defined EXTRA (echo [QA-MINICONDA] isolation mode: %EXTRA%) else (echo [QA-MINICONDA] arguments: official set only)
echo [QA-MINICONDA] running installer directly (silent)...
"%INSTALLER%" /InstallationType=JustMe /AddToPath=0 /RegisterPython=0 /S %EXTRA% /D=%PREFIX%
set "EXITCODE=%ERRORLEVEL%"
echo [QA-MINICONDA] installer exit code=%EXITCODE%

if exist "%PREFIX%\" (echo [QA-MINICONDA] conda prefix exists=true) else (echo [QA-MINICONDA] conda prefix exists=false)
if exist "%PREFIX%\_conda.exe" (
    echo [QA-MINICONDA] _conda.exe exists=true
    echo [QA-MINICONDA] direct install WORKS with these arguments.
) else (
    echo [QA-MINICONDA] _conda.exe exists=false
    echo [QA-MINICONDA] direct install failed with these arguments.
)
echo [QA-MINICONDA] ---- how to read this run (round 5) ----
if /I "%MODE%"=="cleanpath" (
    if "%EXITCODE%"=="0" (
        echo   exit 0 on a clean path =^> the "@" in the real path was the cause. Report back.
    ) else (
        echo   exit %EXITCODE% even on a clean path =^> environment leads: check Windows Security -^> Protection history
        echo   around the run time, Controlled Folder Access, and any third-party AV. Report back.
    )
) else (
    echo   1^) if the sha256 above differs from expected =^> file corrupted: run QA-Miniconda.bat redownload
    echo   2^) if sha256 matches and exit is not 0 =^> run QA-Miniconda.bat cleanpath
)
endlocal
exit /b 0

:Redownload
echo [QA-MINICONDA] redownload mode: refreshing the cached installer from the pinned URL
if exist "%INSTALLER%" del /f /q "%INSTALLER%"
if not exist "%ENVDIR%\" mkdir "%ENVDIR%"
echo [QA-MINICONDA] downloading %DOWNLOAD_URL%
curl -fLk "%DOWNLOAD_URL%" -o "%INSTALLER%"
if errorlevel 1 (
    echo [QA-MINICONDA] download FAILED - check connection/proxy and try again.
    endlocal
    exit /b 1
)
echo [QA-MINICONDA] download finished; verifying before install...
goto Facts
