[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$HubCli,
    [Parameter(Mandatory)][string]$BundleDirectory
)

$ErrorActionPreference = 'Stop'
$runner = (Resolve-Path -LiteralPath $HubCli).Path
$bundle = (Resolve-Path -LiteralPath $BundleDirectory).Path
$root = Split-Path -Parent $PSScriptRoot
$names = @(
    'agent-browser', 'eventa', 'pinia', 'pnpm', 'simple-english', 'unocss',
    'vue', 'vue-best-practices', 'vue-testing-best-practices', 'web-design-guidelines', 'xsai'
)
$destination = $root
foreach ($part in @('airi', '.agents', 'skills')) {
    $destination = Join-Path $destination $part
    if (!(Test-Path -LiteralPath $destination)) {
        New-Item -ItemType Directory -Path $destination | Out-Null
    }
    $directory = Get-Item -LiteralPath $destination -Force
    if (!$directory.PSIsContainer -or ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "Diretório de Skills inválido: $destination"
    }
}

$entries = foreach ($name in $names) {
    if (Test-Path -LiteralPath (Join-Path $destination $name)) {
        throw "Destino já existe: $name"
    }
    $lock = Join-Path $PSScriptRoot "hub-airi-skills/$name.json"
    $pin = Get-Content -LiteralPath $lock -Raw | ConvertFrom-Json
    $prefix = '^' + [regex]::Escape($name) + '-[a-f0-9]{8}$'
    if ($pin.profile -cne 'lia-project' -or $pin.capabilityId -cnotmatch $prefix) {
        throw "Manifesto incompatível: $name"
    }
    $packages = @(Get-ChildItem -LiteralPath (Join-Path $bundle $name) -File -Filter '*.lia-capability')
    if ($packages.Count -ne 1 -or (Get-FileHash -LiteralPath $packages[0].FullName).Hash -ine $pin.packageSha256) {
        throw "Pacote incompatível: $name"
    }
    @{ Name = $name; Lock = $lock; Package = $packages[0].FullName }
}

$stage = Join-Path $destination ('.hub-stage-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $stage | Out-Null
$moved = [Collections.Generic.List[string]]::new()
try {
    foreach ($entry in $entries) {
        & $runner skill materialize $entry.Lock $entry.Package (Join-Path $stage $entry.Name) | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Materialização recusada: $($entry.Name) ($LASTEXITCODE)."
        }
    }
    foreach ($name in $names) {
        [IO.Directory]::Move((Join-Path $stage $name), (Join-Path $destination $name))
        $moved.Add($name)
    }
} catch {
    foreach ($name in $moved) {
        [IO.Directory]::Move((Join-Path $destination $name), (Join-Path $stage $name))
    }
    Write-Warning "Preparação preservada em $stage."
    throw
}
[IO.Directory]::Delete($stage)
$names
