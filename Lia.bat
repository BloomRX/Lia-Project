@echo off
setlocal EnableExtensions
title Lia
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0lia\Start-LiaPreview.ps1" %*
exit /b %ERRORLEVEL%
