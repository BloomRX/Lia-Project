@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
chcp 65001 >nul 2>nul
title Lia Benchmark

where node >nul 2>nul
if errorlevel 1 (
    echo [LiaBenchmark] Node.js was not found on PATH. Install Node LTS first.
    exit /b 1
)

if not exist "Tests\tools\qa-benchmark.mjs" (
    echo [LiaBenchmark] Tests\tools\qa-benchmark.mjs is missing. Run from repository checkout.
    exit /b 1
)

node "Tests\tools\qa-benchmark.mjs" %*
set "RC=%ERRORLEVEL%"
exit /b %RC%
