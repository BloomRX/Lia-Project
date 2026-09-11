<#
.SYNOPSIS
    Read-only diagnosis of the Lia chat provider credential chain.

.DESCRIPTION
    Traces where the API credential stops flowing:

        lia-product.json -> vault -> credential resolver -> provider runtime
        -> createProvider -> outgoing request (Authorization header)

    It prints only booleans, ids, endpoint paths and lengths. It never prints an
    API key, an Authorization value, a full header map or the vault contents.

    It does not modify anything: no write to the persisted config, no change to
    provider/model, no chat message, and the runtime probe intercepts
    globalThis.fetch so no request reaches the network. The probe always uses a
    deliberately fake credential, never a real one.

    Exit code 0 means the chain is structurally sound, 1 means an inconsistency
    was found. Paste the whole output back when reporting.

.EXAMPLE
    cd J:\Lia-Project\airi
    .\DiagnoseLiaProvider.ps1

.EXAMPLE
    # Point at a non-default Electron userData directory:
    $env:LIA_DIAG_USER_DATA = 'C:\Users\me\AppData\Roaming\Lia'
    .\DiagnoseLiaProvider.ps1
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

# Resolve everything relative to this file, so the script works from any drive
# and any clone location.
$RepoAiri = $PSScriptRoot
Set-Location $RepoAiri

$NodeExe = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $NodeExe) {
    Write-Host 'node was not found on PATH. Install Node.js (or open the shell your dev kit uses) and retry.' -ForegroundColor Red
    exit 1
}

$TsxCli = Join-Path $RepoAiri 'node_modules\tsx\dist\cli.mjs'
if (-not (Test-Path $TsxCli)) {
    Write-Host "tsx was not found at $TsxCli" -ForegroundColor Red
    Write-Host 'Run the usual dependency install for this repository first; this script does not install anything itself.'
    exit 1
}

$Diagnostic = Join-Path $RepoAiri 'apps\stage-tamagotchi\scripts\diagnose-lia-provider.ts'
if (-not (Test-Path $Diagnostic)) {
    Write-Host "Diagnostic entrypoint not found at $Diagnostic" -ForegroundColor Red
    exit 1
}

# A non-zero exit from the diagnostic is a RESULT, not an error to throw on, so
# the native call runs with a relaxed preference even under PowerShell 7.4+
# where $PSNativeCommandUseErrorActionPreference can be enabled.
$previousPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& $NodeExe.Source $TsxCli $Diagnostic
$Code = $LASTEXITCODE
$ErrorActionPreference = $previousPreference

Write-Host ''
if ($Code -eq 0) {
    Write-Host 'DIAGNOSTIC EXIT=0 (chain structurally sound)' -ForegroundColor Green
}
else {
    Write-Host "DIAGNOSTIC EXIT=$Code (inconsistency found - see FIRST_FAILURE above)" -ForegroundColor Yellow
}

exit $Code
