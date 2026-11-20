[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$HubCli,
    [Parameter(Mandatory)][string]$PackagePath
)

$ErrorActionPreference = 'Stop'
$runner = (Resolve-Path -LiteralPath $HubCli).Path
$package = (Resolve-Path -LiteralPath $PackagePath).Path
$lock = Join-Path $PSScriptRoot 'hub-eventa-skill.lock.json'
$pin = Get-Content -LiteralPath $lock -Raw | ConvertFrom-Json
if ($pin.profile -cne 'lia-project' -or $pin.capabilityId -cnotmatch '^lia-eventa-ipc-[a-f0-9]{8}$') {
    throw 'O manifesto precisa fixar lia-eventa-ipc para Lia-Project.'
}
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root '.agents/skills/lia-eventa-ipc'
& $runner skill materialize $lock $package $target
if ($LASTEXITCODE -ne 0) {
    throw "Materialização recusada (código $LASTEXITCODE)."
}
