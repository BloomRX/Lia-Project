@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem ==========================================================================
rem  run-stt-bench.bat - lancador fino da bancada STT.
rem
rem  Existe para nao depender da politica de execucao do sistema: o Bypass
rem  vale apenas para ESTA invocacao; nada e alterado na maquina.
rem  Sem acentos: arquivo .bat em ANSI/UTF-8 confunde o console.
rem ==========================================================================

set "PS_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS_EXE%" set "PS_EXE=powershell.exe"

"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-stt-bench.ps1" %*
exit /b %ERRORLEVEL%
