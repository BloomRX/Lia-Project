@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
chcp 65001 >nul 2>nul
title Lia QA Harness

rem ============================================================
rem  LiaTests.bat - Lia QA harness (Phase 7.9G-QA)
rem
rem  Thin menu only: every real operation (run folders, config
rem  backup/restore, log metrics, deletion, inventory) runs in
rem  the guarded Node helpers under Tests\tools. This file
rem  contains NO destructive command of its own.
rem ============================================================

set "REPO=%~dp0"
set "TOOLS=%REPO%Tests\tools"

where node >nul 2>nul
if errorlevel 1 (
    echo [LiaTests] Node.js was not found on PATH. Install Node LTS first.
    goto :end
)

if not exist "%TOOLS%\qa-run.mjs" (
    echo [LiaTests] Tests\tools is missing. Run this file from the repository checkout.
    goto :end
)

:menu
cls
echo ============================================================
echo  Lia QA Harness
echo ============================================================
echo   1. Voice QA - existing runtime smoke
echo   2. Voice QA - isolated clean install
echo   3. Open latest test folder
echo   4. Restore normal Lia configuration
echo   5. Exit
echo   6. Storage / cleanup
echo ============================================================
node "%TOOLS%\qa-config.mjs" status-banner
echo ------------------------------------------------------------
set "CHOICE="
set /p "CHOICE=Choose an option: "
if "%CHOICE%"=="1" goto :smoke
if "%CHOICE%"=="2" goto :isolated
if "%CHOICE%"=="3" goto :open_latest
if "%CHOICE%"=="4" goto :restore
if "%CHOICE%"=="5" goto :end
if "%CHOICE%"=="6" goto :storage
echo Invalid option.
timeout /t 2 >nul
goto :menu

rem ------------------------------------------------------------
rem  1. Existing runtime smoke (production runtime home)
rem ------------------------------------------------------------
:smoke
echo.
echo Starting an existing-runtime smoke run. The PRODUCTION runtime
echo home is exercised; nothing is installed or moved.
set "RUN_DIR="
for /f "usebackq delims=" %%R in (`node "%TOOLS%\qa-run.mjs" create smoke`) do set "RUN_DIR=%%R"
if not defined RUN_DIR (
    echo [LiaTests] Could not create the run folder.
    goto :menu
)
echo [LiaTests] Run folder: %RUN_DIR%
echo [LiaTests] Running tools\kokoro-smoke.mjs (console captured to logs\lia-console.log)...
echo [LiaTests] Smoke artifacts go to: %RUN_DIR%\artifacts\smoke
node "%REPO%tools\kokoro-smoke.mjs" "%RUN_DIR%\artifacts\smoke" > "%RUN_DIR%\logs\lia-console.log" 2>&1
set "SMOKE_RC=%ERRORLEVEL%"
node "%TOOLS%\qa-voice-metrics.mjs" finalize "%RUN_DIR%"
echo.
echo [LiaTests] Smoke exit code: %SMOKE_RC%
echo [LiaTests] Logs and metrics: %RUN_DIR%
echo [LiaTests] Checklist:        %RUN_DIR%\QA-CHECKLIST.txt
pause
goto :menu

rem ------------------------------------------------------------
rem  2. Isolated clean-install run
rem ------------------------------------------------------------
:isolated
echo.
echo Creating an ISOLATED clean-install run. Your normal runtime is
echo never touched; Lia is pointed at the run folder via the supported
echo voice.runtime.installDir key, with a backup taken FIRST.
set "RUN_DIR="
for /f "usebackq delims=" %%R in (`node "%TOOLS%\qa-run.mjs" create clean-install`) do set "RUN_DIR=%%R"
if not defined RUN_DIR (
    echo [LiaTests] Could not create the run folder.
    goto :menu
)
node "%TOOLS%\qa-config.mjs" activate "%RUN_DIR%"
if errorlevel 1 (
    echo [LiaTests] Activation failed. Nothing was launched.
    pause
    goto :menu
)
echo [LiaTests] Run folder: %RUN_DIR%
echo ============================================================
echo   QA CONFIG ACTIVE
echo   Lia now installs/uses the isolated runtime:
echo     %RUN_DIR%\runtime
echo   When finished: close Lia, then choose option 4 to restore.
echo ============================================================
echo.
echo Starting Lia (console is also captured to logs\lia-console.log)...
start "Lia QA" powershell -NoProfile -ExecutionPolicy Bypass -Command "& '%REPO%Lia.bat' *>&1 | Tee-Object -FilePath '%RUN_DIR%\logs\lia-console.log'"
echo [LiaTests] Work through: %RUN_DIR%\QA-CHECKLIST.txt
echo [LiaTests] Type notes in: %RUN_DIR%\USER-NOTES.txt
pause
goto :menu

rem ------------------------------------------------------------
rem  3. Open latest test folder
rem ------------------------------------------------------------
:open_latest
set "RUN_DIR="
for /f "usebackq delims=" %%R in (`node "%TOOLS%\qa-run.mjs" latest 2^>nul`) do set "RUN_DIR=%%R"
if not defined RUN_DIR (
    echo No test runs yet - use option 1 or 2 first.
    pause
    goto :menu
)
echo Latest run: %RUN_DIR%
explorer "%RUN_DIR%"
goto :menu

rem ------------------------------------------------------------
rem  4. Restore normal Lia configuration
rem ------------------------------------------------------------
:restore
echo.
node "%TOOLS%\qa-config.mjs" restore
node "%TOOLS%\qa-voice-metrics.mjs" finalize-latest
echo.
pause
goto :menu

rem ------------------------------------------------------------
rem  6. Storage / cleanup
rem ------------------------------------------------------------
:storage
cls
echo ============================================================
echo  Storage / cleanup
echo ============================================================
echo   a. Show test storage usage
echo   b. Delete selected managed test run
echo   c. Delete ALL managed test runs
echo   d. Inventory possible legacy Lia test artifacts
echo   e. Retention policy (dry-run by default)
echo   f. Prune logs/metrics of a run (keeps notes and checklist)
echo   g. Back
echo ============================================================
set "SCHOICE="
set /p "SCHOICE=Storage option: "
if /i "%SCHOICE%"=="a" goto :st_usage
if /i "%SCHOICE%"=="b" goto :st_delete_one
if /i "%SCHOICE%"=="c" goto :st_delete_all
if /i "%SCHOICE%"=="d" goto :st_inventory
if /i "%SCHOICE%"=="e" goto :st_retention
if /i "%SCHOICE%"=="f" goto :st_prune
if /i "%SCHOICE%"=="g" goto :menu
goto :storage

:st_usage
echo.
node "%TOOLS%\qa-storage.mjs" usage
pause
goto :storage

:st_delete_one
echo.
echo Managed runs:
node "%TOOLS%\qa-storage.mjs" usage
echo.
set "DEL_ID="
set /p "DEL_ID=Type the run id to delete (empty = cancel): "
if not defined DEL_ID goto :storage
echo.
node "%TOOLS%\qa-storage.mjs" show-run "%DEL_ID%"
if errorlevel 1 (
    pause
    goto :storage
)
echo.
set "CONFIRM="
set /p "CONFIRM=Type the run id AGAIN to confirm deletion: "
if not "%CONFIRM%"=="%DEL_ID%" (
    echo Confirmation did not match - nothing deleted.
    pause
    goto :storage
)
node "%TOOLS%\qa-storage.mjs" delete-run "%DEL_ID%"
pause
goto :storage

:st_delete_all
echo.
echo This deletes EVERY managed test run EXCEPT the active one.
node "%TOOLS%\qa-storage.mjs" usage
echo.
set "CONFIRM="
set /p "CONFIRM=Type DELETE to confirm: "
if not "%CONFIRM%"=="DELETE" (
    echo Nothing deleted.
    pause
    goto :storage
)
node "%TOOLS%\qa-storage.mjs" delete-all
pause
goto :storage

:st_inventory
echo.
echo Scanning likely legacy artifact locations (NON-DESTRUCTIVE)...
node "%TOOLS%\qa-storage.mjs" inventory
echo.
echo Review the report, then plan any cleanup separately.
pause
goto :storage

:st_retention
echo.
set "KEEP_LAST=3"
set /p "KEEP_LAST=Keep last N runs [3]: "
set "OLDER_DAYS="
set /p "OLDER_DAYS=Also only remove runs older than D days (empty = no age filter): "
if defined OLDER_DAYS (
    node "%TOOLS%\qa-storage.mjs" retention --keep-last %KEEP_LAST% --older-than-days %OLDER_DAYS%
) else (
    node "%TOOLS%\qa-storage.mjs" retention --keep-last %KEEP_LAST%
)
echo.
set "APPLY="
set /p "APPLY=Apply this plan? (y/N): "
if /i not "%APPLY%"=="y" (
    echo Dry-run only - nothing deleted.
    pause
    goto :storage
)
if defined OLDER_DAYS (
    node "%TOOLS%\qa-storage.mjs" retention --keep-last %KEEP_LAST% --older-than-days %OLDER_DAYS% --apply
) else (
    node "%TOOLS%\qa-storage.mjs" retention --keep-last %KEEP_LAST% --apply
)
pause
goto :storage

:st_prune
echo.
echo Pruning removes ONLY logs\ and metrics\ files of one run.
echo USER-NOTES.txt, QA-CHECKLIST.txt and snapshots\ are kept.
set "PRUNE_ID="
set /p "PRUNE_ID=Run id to prune (empty = cancel): "
if not defined PRUNE_ID goto :storage
node "%TOOLS%\qa-storage.mjs" prune-logs "%PRUNE_ID%"
if errorlevel 1 (
    pause
    goto :storage
)
set "APPLY="
set /p "APPLY=Apply? (y/N): "
if /i not "%APPLY%"=="y" (
    echo Dry-run only - nothing deleted.
    pause
    goto :storage
)
node "%TOOLS%\qa-storage.mjs" prune-logs "%PRUNE_ID%" --apply
pause
goto :storage

:end
echo Bye.
endlocal
exit /b 0
