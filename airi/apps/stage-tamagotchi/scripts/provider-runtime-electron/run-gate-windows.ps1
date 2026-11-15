<#
.SYNOPSIS
    Runs the real Electron gate for the Lia native provider runtime (Corte B)
    on Windows, in the documented order, and preserves the evidence.

.DESCRIPTION
    This is a thin RUNNER. It executes the commands the repository already
    declares - it does not reimplement, weaken or replace the gate, and it does
    not touch Git.

    The gate itself is `scripts/provider-runtime-electron/gate.test.mjs`, which
    is Windows-only (`skip: process.platform !== 'win32'`) because its teardown
    proof enumerates processes with `Get-CimInstance` and launches
    `dist/electron.exe`. Its own header documents the same three steps this
    script runs:

        1. install the Electron runtime from the OFFICIAL package installer
           (downloads the asset matching the locked version and verifies it
           against the package's own checksums.json);
        2. build the Stage, which produces out/preload/index.cjs - the gate
           reads that file before doing anything else;
        3. run `node --test` on the gate.

    Before that it checks, and refuses to continue when wrong: git branch, HEAD
    and working tree, Node and pnpm versions, whether the Electron runtime is
    already installed, whether playwright and vite resolve from the app, and
    whether out/preload/index.cjs exists after the build.

    It records one console transcript plus the gate's own artifacts under
    Tests/artifacts/provider-runtime-electron/<timestamp>/, with the exit code
    of every step and an independent re-check of the "no synthetic secret in the
    logs" assertion (report.json -> logSecretsAbsent, plus a scan of electron.log
    for the synthetic PREFIXES the gate uses - never the values).

    It never prints a credential. It creates no commit, no branch and no push:
    `git status` is printed at the end only so the operator can confirm that.

.PARAMETER SkipBuild
    Reuse an existing `out/preload/index.cjs` instead of rebuilding the Stage.
    Only valid when the preload was built from the current working tree.

.PARAMETER ElectronZip
    Path to an ALREADY DOWNLOADED `electron-v43.4.1-win32-x64.zip` obtained from
    the official GitHub release. Otherwise the runner downloads that asset.
    The pinned SHA-256 and each runtime file are verified before execution.

.PARAMETER ExportRoot
    Directory the exportable evidence package is written to. Defaults to
    $env:LIA_GATE_EXPORT_ROOT when set, otherwise
    <repo>\Tests\exports\provider-runtime-electron. The package contains
    report.json, electron.log, environment.json and manifest.json (plus
    electron.png when the gate produced one) and is meant to be copied off this
    machine - it is not committed, and it does not depend on the workspace
    surviving.

.EXAMPLE
    # Keep the evidence somewhere that is not the clone.
    .\run-gate-windows.ps1 -ExportRoot D:\lia-evidence

.EXAMPLE
    cd J:\Lia-Project\airi\apps\stage-tamagotchi
    .\scripts\provider-runtime-electron\run-gate-windows.ps1

.EXAMPLE
    # Verify a zip you downloaded yourself from the official release page.
    .\run-gate-windows.ps1 -ElectronZip C:\Users\me\Downloads\electron-v43.4.1-win32-x64.zip

.NOTES
    Exit code 0 = the gate ran and PASSED. 1 = a step failed, the gate FAILED,
    or the environment check refused to continue. A skipped gate is never a
    pass: `# skipped 1` from the test runner makes this script exit 1.
#>

[CmdletBinding()]
param(
    [switch] $SkipBuild,
    [string] $ElectronZip,

    # Where the exportable package is written. Defaults to the environment
    # variable when set, otherwise `<repo>\Tests\exports\provider-runtime-electron`.
    # Deliberately NOT under Tests/artifacts: that folder is disposable (and
    # git-ignored), and the whole point of the package is to survive it.
    [string] $ExportRoot
)

$ErrorActionPreference = 'Stop'

# Everything is resolved from this file, so the script works from any clone.
$GateDir = $PSScriptRoot
$StageDir = Split-Path -Parent (Split-Path -Parent $GateDir)
$AiriDir = Split-Path -Parent (Split-Path -Parent $StageDir)
$RepoDir = Split-Path -Parent $AiriDir

$ExpectedElectron = '43.4.1'
$ExpectedSha256 = 'c2ef9a5f65472c34d14bd3e67b7d14e66b0c01f124aba45263d6a4232160e13a'
$ExpectedPnpm = '11.24.0'
$GateRelative = 'scripts/provider-runtime-electron/gate.test.mjs'
$ElectronDir = Join-Path $StageDir 'node_modules\electron'
$ElectronExe = Join-Path $ElectronDir 'dist\electron.exe'
$PreloadFile = Join-Path $StageDir 'out\preload\index.mjs'
$ChecksumsFile = Join-Path $ElectronDir 'checksums.json'
$ArtifactsRoot = Join-Path $RepoDir 'Tests\artifacts\provider-runtime-electron'

# The exportable package. Kept outside Tests/artifacts on purpose: that folder is
# git-ignored and disposable, which is exactly how the previous evidence was lost.
if (-not $ExportRoot) {
    if ($env:LIA_GATE_EXPORT_ROOT) { $ExportRoot = $env:LIA_GATE_EXPORT_ROOT }
    else { $ExportRoot = Join-Path $RepoDir 'Tests\exports\provider-runtime-electron' }
}

# A run id that does not depend on a folder name, a clock format or the locale.
$RunId = [guid]::NewGuid().ToString()
$RunStartedAt = Get-Date

$script:Results = New-Object System.Collections.ArrayList
$script:OriginalLocation = (Get-Location).Path

function Write-Step {
    param([string] $Text)
    Write-Host ''
    Write-Host "=== $Text" -ForegroundColor Cyan
}

function Add-Result {
    param([string] $Step, [string] $Status, [string] $Detail = '')
    [void]$script:Results.Add([pscustomobject]@{ Step = $Step; Status = $Status; Detail = $Detail })
    $color = 'Gray'
    if ($Status -eq 'PASS') { $color = 'Green' }
    if ($Status -eq 'FAIL') { $color = 'Red' }
    if ($Status -eq 'SKIP') { $color = 'Yellow' }
    Write-Host ("  [{0}] {1}{2}" -f $Status, $Step, $(if ($Detail) { " - $Detail" } else { '' })) -ForegroundColor $color
}

function Stop-With {
    param([string] $Message)
    Write-Host ''
    Write-Host "ABORTADO: $Message" -ForegroundColor Red
    Write-Host 'O gate NAO foi executado. Nada foi alterado no Git.' -ForegroundColor Red
    exit 1
}

# Reads a property that may be missing, without throwing. (`ConvertFrom-Json`
# objects do not respond to plain property access for absent members in every
# PowerShell version.)
function Get-Prop {
    param($Object, [string] $Name)
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

# First line of a native command's stdout, or $null. Never throws, and never
# mixes stderr into the result: with $ErrorActionPreference='Stop', PowerShell
# 7.3+ can turn redirected native stderr into a terminating error, which would
# make a healthy `electron.exe --version` look like a failure.
function Get-ExeVersion {
    param([string] $Exe, [string[]] $Arguments)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $line = (& $Exe @Arguments 2>$null | Select-Object -First 1)
        if ($null -eq $line) { return $null }
        return $line.ToString().Trim()
    }
    catch { return $null }
    finally { $ErrorActionPreference = $previous }
}

# Git writes progress and warnings to stderr; capture both streams without
# letting 'Stop' promote stderr to a terminating error.
function Invoke-Git {
    param([string[]] $Arguments)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { return (& git -C $RepoDir @Arguments 2>&1) }
    finally { $ErrorActionPreference = $previous }
}

# ---------------------------------------------------------------------------
# 0. Header
# ---------------------------------------------------------------------------
Write-Host 'Lia / Corte B - gate Electron de provedores nativos (Windows)' -ForegroundColor White
Write-Host "Repositorio : $RepoDir"
Write-Host "App         : $StageDir"

# ---------------------------------------------------------------------------
# 1. Git: branch, HEAD, working tree. Nothing is modified here.
# ---------------------------------------------------------------------------
Write-Step '1. Git - branch, HEAD e working tree (somente leitura)'

if (-not (Test-Path (Join-Path $RepoDir '.git'))) {
    Stop-With "nao encontrei um repositorio Git em $RepoDir"
}

$branchLine = Invoke-Git @('rev-parse', '--abbrev-ref', 'HEAD') | Select-Object -First 1
$headLine = Invoke-Git @('rev-parse', 'HEAD') | Select-Object -First 1
if (-not $branchLine -or -not $headLine) {
    Stop-With "git nao respondeu em $RepoDir (repositorio ausente ou corrompido)"
}
$branch = $branchLine.ToString().Trim()
$head = $headLine.ToString().Trim()
$dirty = @(Invoke-Git @('status', '--porcelain') | Where-Object { $_ -ne '' -and $_.Trim() -ne '' })

Write-Host "  branch: $branch"
Write-Host "  HEAD  : $head"
Write-Host "  entradas na working tree: $($dirty.Count)"

if ($branch -ne 'arena/01a10290-lia-project') {
    Write-Host "  AVISO: a branch esperada pela missao e 'arena/01a10290-lia-project'." -ForegroundColor Yellow
}
if ($dirty.Count -eq 0) {
    Write-Host '  AVISO: a working tree esta limpa. O trabalho dos PROMPT-25..27 nao esta' -ForegroundColor Yellow
    Write-Host '         commitado, entao 0 aqui significa que esse trabalho NAO esta presente.' -ForegroundColor Yellow
}

foreach ($required in @((Join-Path $GateDir 'gate.test.mjs'), (Join-Path $StageDir 'package.json'))) {
    if (-not (Test-Path $required)) { Stop-With "arquivo esperado nao encontrado: $required" }
}
$headShort = if ($head.Length -ge 7) { $head.Substring(0, 7) } else { $head }
Add-Result 'git' 'PASS' ("branch={0} head={1} entradas={2}" -f $branch, $headShort, $dirty.Count)

# ---------------------------------------------------------------------------
# 2. Node and pnpm
# ---------------------------------------------------------------------------
Write-Step '2. Node e pnpm'

$nodeVersion = Get-ExeVersion 'node' @('--version')
if (-not $nodeVersion) { Stop-With 'node nao esta no PATH' }
Write-Host "  node: $nodeVersion"

$pnpmVersion = Get-ExeVersion 'pnpm' @('--version')
if (-not $pnpmVersion) {
    Write-Host '  pnpm nao esta no PATH. Habilite com: corepack enable' -ForegroundColor Red
    Stop-With 'pnpm ausente'
}
Write-Host "  pnpm: $pnpmVersion (o repositorio declara packageManager=$ExpectedPnpm)"
if ($pnpmVersion -ne $ExpectedPnpm) {
    Write-Host '  AVISO: pnpm diferente da declarada. corepack respeita packageManager;' -ForegroundColor Yellow
    Write-Host '         se o lockfile reclamar, rode via corepack.' -ForegroundColor Yellow
}

$nodeMajor = [int](($nodeVersion.TrimStart('v') -split '\.')[0])
if ($nodeMajor -lt 22) {
    Stop-With "node $nodeVersion e anterior ao minimo observado (22.x); .tool-versions declara 26.7.0"
}
Add-Result 'node/pnpm' 'PASS' ("node={0} pnpm={1}" -f $nodeVersion, $pnpmVersion)

# ---------------------------------------------------------------------------
# 3. What the gate imports: playwright and vite must resolve from the app
# ---------------------------------------------------------------------------
Write-Step '3. Dependencias que o gate importa (playwright, vite)'

Push-Location $StageDir
try {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & node -e "require.resolve('playwright');require.resolve('vite')" 2>$null
    $resolveExit = $LASTEXITCODE
    $ErrorActionPreference = $previous
    if ($resolveExit -ne 0) {
        Write-Host '  playwright e/ou vite nao resolvem a partir de apps/stage-tamagotchi.' -ForegroundColor Red
        Write-Host '  Rode `pnpm install --frozen-lockfile` na raiz do workspace (airi/) e repita.' -ForegroundColor Red
        Add-Result 'deps do gate' 'FAIL' 'playwright/vite nao resolvem'
        Stop-With 'dependencias do gate ausentes'
    }
    $playwrightVersion = (& node -e "console.log(require('playwright/package.json').version)").ToString().Trim()
    $viteVersion = (& node -e "console.log(require('vite/package.json').version)").ToString().Trim()
    Write-Host "  playwright: $playwrightVersion"
    Write-Host "  vite      : $viteVersion"
    Add-Result 'deps do gate' 'PASS' ("playwright={0} vite={1}" -f $playwrightVersion, $viteVersion)
}
finally {
    Pop-Location
}

# ---------------------------------------------------------------------------
# 4. Electron: declared version, existing install, published hash
# ---------------------------------------------------------------------------
Write-Step "4. Electron $ExpectedElectron"

if (-not (Test-Path $ElectronDir)) {
    Stop-With "pacote electron ausente em $ElectronDir - rode 'pnpm install --frozen-lockfile' na raiz (airi/)"
}

$installedVersion = (& node -e "console.log(require(process.argv[1]).version)" (Join-Path $ElectronDir 'package.json')).ToString().Trim()
Write-Host "  versao do pacote: $installedVersion"
if ($installedVersion -ne $ExpectedElectron) {
    Stop-With "versao instalada ($installedVersion) difere da exigida ($ExpectedElectron). Nao altere versao nem lockfile."
}

$assetName = "electron-v$ExpectedElectron-win32-x64.zip"
$checksums = Get-Content -LiteralPath $ChecksumsFile -Raw | ConvertFrom-Json
if ((Get-Prop $checksums $assetName) -ne $ExpectedSha256) {
    Stop-With 'SHA-256 do pacote diverge do asset oficial.'
}
if ((& node -p "process.platform + '-' + process.arch") -ne 'win32-x64') {
    Stop-With 'este roteiro exige Node para Windows x64.'
}
if ($env:ELECTRON_OVERRIDE_DIST_PATH -or $env:ELECTRON_RUN_AS_NODE) {
    Stop-With 'remova overrides do Electron da sessao antes de executar.'
}
if (-not $ElectronZip) {
    $downloadDir = Join-Path $env:TEMP ("lia-electron-" + [guid]::NewGuid().ToString())
    [void](New-Item -ItemType Directory -Path $downloadDir)
    $ElectronZip = Join-Path $downloadDir $assetName
    $uri = "https://github.com/electron/electron/releases/download/v$ExpectedElectron/$assetName"
    Invoke-WebRequest -UseBasicParsing -Uri $uri -OutFile $ElectronZip
}
$ElectronZip = (Resolve-Path -LiteralPath $ElectronZip).ProviderPath
$actual = (Get-FileHash -LiteralPath $ElectronZip -Algorithm SHA256).Hash
if ($actual -ne $ExpectedSha256) {
    Stop-With 'SHA-256 do ZIP diverge do asset oficial.'
}
Add-Result 'SHA-256 do ZIP oficial' 'PASS' $ExpectedSha256

Write-Step '5. Preparacao e integridade do runtime'
$dist = Join-Path $ElectronDir 'dist'
$pathFile = Join-Path $ElectronDir 'path.txt'
if (-not (Test-Path -LiteralPath $ElectronExe)) {
    if ((Test-Path -LiteralPath $dist) -or (Test-Path -LiteralPath $pathFile)) {
        Stop-With 'instalacao parcial encontrada. Nenhum arquivo do runtime foi sobrescrito.'
    }
    Expand-Archive -LiteralPath $ElectronZip -DestinationPath $dist
    [IO.File]::WriteAllText($pathFile, 'electron.exe')
    Add-Result 'instalacao do runtime' 'PASS' 'ZIP oficial verificado'
}
else {
    Add-Result 'instalacao do runtime' 'SKIP' 'runtime existente'
}
if ((Get-Content -LiteralPath $pathFile -Raw).Trim() -ne 'electron.exe') {
    Stop-With 'path.txt nao aponta para electron.exe.'
}

# Check the entire extracted distribution before running any Electron binary.
# The official package installer moves electron.d.ts out of dist.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($ElectronZip)
$sha = [Security.Cryptography.SHA256]::Create()
$expectedFiles = @{}
try {
    foreach ($entry in $archive.Entries) {
        if (-not $entry.Name) { continue }
        $relative = $entry.FullName.Replace('/', '\')
        $target = Join-Path $dist $relative
        $expectedFiles[$relative] = $true
        if ($relative -eq 'electron.d.ts' -and -not (Test-Path -LiteralPath $target)) {
            $target = Join-Path $ElectronDir $relative
        }
        if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
            Stop-With "arquivo do runtime ausente: $relative"
        }
        $stream = $entry.Open()
        try { $entryHash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '') }
        finally { $stream.Dispose() }
        if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $entryHash) {
            Stop-With "arquivo do runtime diverge do ZIP oficial: $relative"
        }
    }
    foreach ($file in Get-ChildItem -LiteralPath $dist -Recurse -File -Force) {
        $relative = $file.FullName.Substring($dist.Length + 1)
        if (-not $expectedFiles.ContainsKey($relative)) {
            Stop-With "arquivo adicional no runtime: $relative"
        }
    }
}
finally {
    $sha.Dispose()
    $archive.Dispose()
}
Add-Result 'integridade do runtime' 'PASS' "$($expectedFiles.Count) arquivos conferidos"
$runtimeVersion = (Get-Content -LiteralPath (Join-Path $dist 'version') -Raw).Trim().TrimStart('v')
if ($runtimeVersion -ne $ExpectedElectron) {
    Stop-With "manifesto do runtime informa '$runtimeVersion', esperado $ExpectedElectron"
}
Add-Result 'versao do runtime' 'PASS' $runtimeVersion

# ---------------------------------------------------------------------------
# 6. Stage build (produces out/preload/index.cjs, read first by the gate)
# ---------------------------------------------------------------------------
Write-Step '6. Build do Stage (electron-vite build)'

if ($SkipBuild) {
    if (-not (Test-Path $PreloadFile)) { Stop-With "-SkipBuild foi pedido, mas $PreloadFile nao existe" }
    Write-Host '  -SkipBuild: reutilizando o preload existente.'
    Add-Result 'build do Stage' 'SKIP' 'reutilizado por -SkipBuild'
}
else {
    Push-Location $StageDir
    try {
        & pnpm run build
        $buildExit = $LASTEXITCODE
    }
    finally { Pop-Location }

    Write-Host "  exit code do build: $buildExit"
    if ($buildExit -ne 0) {
        Write-Host ''
        Write-Host '  O build FALHOU. Etapas conhecidas: main e preload costumam compilar; o' -ForegroundColor Yellow
        Write-Host '  renderer resolve plugins que baixam modelos Live2D/VRM de hosts externos' -ForegroundColor Yellow
        Write-Host '  (dist.ayaka.moe, cubism.live2d.com). Falha de download e infraestrutura,' -ForegroundColor Yellow
        Write-Host '  nao codigo - mas o gate depende do preload. Nao altere lockfile nem a' -ForegroundColor Yellow
        Write-Host '  configuracao do build para contornar.' -ForegroundColor Yellow
        Add-Result 'build do Stage' 'FAIL' ("exit={0}" -f $buildExit)
        Stop-With 'build do Stage falhou'
    }
    Add-Result 'build do Stage' 'PASS' ("exit={0}" -f $buildExit)
}

if (-not (Test-Path $PreloadFile)) {
    Stop-With "o gate le $PreloadFile antes de tudo e ele nao existe - rode sem -SkipBuild"
}
$preloadSize = (Get-Item $PreloadFile).Length
Write-Host "  preload: $PreloadFile ($preloadSize bytes)"
Add-Result 'preload' 'PASS' ("$preloadSize bytes")

# ---------------------------------------------------------------------------
# 7. The gate
# ---------------------------------------------------------------------------
Write-Step '7. Gate Electron (node --test)'
Write-Host "  arquivo : $GateRelative"
Write-Host '  requer  : sessao Windows com desktop (o cofre usa o keychain do SO).'
Write-Host '  escopo  : os dez provedores curados, sobre um servidor HTTP local.'
Write-Host ''

$previousRuns = @(Get-ChildItem -LiteralPath $ArtifactsRoot -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
Push-Location $StageDir
try {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $gateOutput = @(& node --test --test-reporter=tap $GateRelative 2>&1 | ForEach-Object { $_.ToString() })
        $gateExit = $LASTEXITCODE
    }
    finally { $ErrorActionPreference = $previous }
    $credentialPattern = 'synthetic-[a-z0-9-]+-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}'
    $tapContainsCredentials = [bool]($gateOutput -match $credentialPattern)
    $gateOutput = @($gateOutput -replace $credentialPattern, '[REDACTED]')
    $gateOutput | Write-Host
}
finally { Pop-Location }

Write-Host ''
Write-Host "  exit code do gate: $gateExit"

# ---------------------------------------------------------------------------
# 8. Evidence: this run's folder, plus an independent re-check
# ---------------------------------------------------------------------------
Write-Step '8. Evidencias'

$secretFailures = 0
if (-not (Test-Path $ArtifactsRoot)) {
    Write-Host "  AVISO: $ArtifactsRoot nao existe - o gate nao escreveu artefatos." -ForegroundColor Yellow
    Add-Result 'artefatos' 'FAIL' 'diretorio nao criado'
}
else {
    $newRuns = @(Get-ChildItem -LiteralPath $ArtifactsRoot -Directory |
        Where-Object { $_.Name -notin $previousRuns })
    $run = if ($newRuns.Count -eq 1) { $newRuns[0] }

    if (-not $run) {
        Write-Host '  AVISO: nenhuma pasta de artefatos desta execucao encontrada.' -ForegroundColor Yellow
        Add-Result 'artefatos' 'FAIL' 'pasta desta execucao ausente'
    }
    else {
        Write-Host "  artefatos desta execucao: $($run.FullName)"
        foreach ($name in @('report.json', 'electron.log', 'electron.png')) {
            $file = Join-Path $run.FullName $name
            if (Test-Path $file) {
                Write-Host ("    {0}: presente ({1} bytes)" -f $name, (Get-Item $file).Length)
            }
            else {
                Write-Host ("    {0}: ausente" -f $name) -ForegroundColor Yellow
            }
        }

        $reportFile = Join-Path $run.FullName 'report.json'
        if (-not (Test-Path $reportFile)) {
            Add-Result 'report.json' 'FAIL' 'ausente - o gate falhou antes do finally'
            $secretFailures++
        }
        else {
            $report = Get-Content $reportFile -Raw | ConvertFrom-Json
            if ($gateExit -eq 0 -and (
                $report.result -ne 'PASS Electron components with local HTTP fixture' -or
                $report.versions.electron -ne $ExpectedElectron -or
                $report.exitCode -ne 0 -or $report.groups.complete -ne $true -or
                -not (Test-Path -LiteralPath (Join-Path $run.FullName 'electron.png')) -or
                -not ($gateOutput -match '^# pass 1$') -or -not ($gateOutput -match '^# skipped 0$'))) {
                Add-Result 'resultado do gate' 'FAIL' 'TAP ou report.json nao confirmou aprovacao'
            }
            $requests = @(Get-Prop $report 'requests')
            $checks = @(Get-Prop $report 'checks')
            Write-Host ("    report.result           : {0}" -f (Get-Prop $report 'result'))
            Write-Host ("    report.exitCode         : {0}" -f (Get-Prop $report 'exitCode'))
            Write-Host ("    report.logSecretsAbsent : {0}" -f (Get-Prop $report 'logSecretsAbsent'))
            Write-Host ("    report.requests         : {0}" -f $requests.Count)
            Write-Host ("    report.checks           : {0}" -f $checks.Count)

            # Independent scan for the synthetic PREFIXES the gate generates.
            # The values are never read or printed.
            $logFile = Join-Path $run.FullName 'electron.log'
            $leaked = @()
            if (Test-Path $logFile) {
                $content = Get-Content $logFile -Raw
                foreach ($prefix in @('synthetic-', 'synthetic-A-', 'synthetic-B-')) {
                    if ($content -and $content.Contains($prefix)) { $leaked += $prefix }
                }
            }
            if ($leaked.Count -gt 0) {
                Write-Host ("  CREDENCIAL SINTETICA no electron.log (prefixos: {0})." -f ($leaked -join ', ')) -ForegroundColor Red
                Write-Host '  O arquivo NAO foi impresso. Trate como FALHA e reporte o caminho.' -ForegroundColor Red
                Add-Result 'credencial nos logs' 'FAIL' ("prefixos: " + ($leaked -join ', '))
                $secretFailures++
            }
            else {
                Add-Result 'credencial nos logs' 'PASS' 'nenhum prefixo sintetico no electron.log'
            }

            if ((Get-Prop $report 'logSecretsAbsent') -ne $true -or $tapContainsCredentials -or -not (Test-Path -LiteralPath $logFile)) {
                Add-Result 'logSecretsAbsent' 'FAIL' 'relatorio do gate acusa credencial nos logs'
                $secretFailures++
            }
            else {
                Add-Result 'logSecretsAbsent' 'PASS' 'relatorio do gate: ausente'
            }
        }
    }
}

if ($gateExit -eq 0 -and $secretFailures -gt 0) {
    Write-Host ''
    Write-Host '  O runner saiu 0 mas a re-checagem de credencial falhou. Trate como REPROVADO.' -ForegroundColor Red
    $gateExit = 1
}


# ---------------------------------------------------------------------------
# 9. Environment: what this run actually ran on
# ---------------------------------------------------------------------------
Write-Step '9. Ambiente de execucao'

# The version a report cannot be trusted without: 5.1 (Desktop) and 7 (Core) do
# not serialize dates, errors or native output the same way, and the gate has to
# be read in the light of one of them. Recorded here, in a file, so the answer
# does not depend on the name of a folder.
$psVersion = $PSVersionTable.PSVersion
$gatePsEdition = 'unknown'
if ($PSVersionTable.PSEdition) { $gatePsEdition = $PSVersionTable.PSEdition }
elseif ($psVersion.Major -ge 6) { $gatePsEdition = 'Core' }
else { $gatePsEdition = 'Desktop' }

$windows = @{ version = 'unknown'; build = 'unknown'; caption = 'unknown'; arch = 'unknown' }
try {
    $os = Get-CimInstance Win32_OperatingSystem
    if ($os.Version) { $windows.version = [string]$os.Version }
    if ($os.BuildNumber) { $windows.build = [string]$os.BuildNumber }
    if ($os.Caption) { $windows.caption = [string]$os.Caption }
}
catch {
    Write-Host '  AVISO: Win32_OperatingSystem nao respondeu; versao do Windows = unknown.' -ForegroundColor Yellow
}
if ($env:PROCESSOR_ARCHITECTURE) { $windows.arch = $env:PROCESSOR_ARCHITECTURE }

$pnpmVersion = 'unknown'
try {
    $probe = & pnpm --version 2>$null
    if ($LASTEXITCODE -eq 0 -and $probe) { $pnpmVersion = ($probe | Select-Object -First 1).ToString().Trim() }
}
catch {
    Write-Host '  AVISO: pnpm nao respondeu --version; registrado como unknown.' -ForegroundColor Yellow
}

$environment = [ordered]@{
    runId      = $RunId
    powershell = [ordered]@{
        version = $psVersion.ToString()
        edition = $gatePsEdition
        major   = $psVersion.Major
        host    = 'unknown'
    }
    windows    = $windows
    node       = $nodeVersion
    electron   = $ExpectedElectron
    pnpm       = $pnpmVersion
    git        = [ordered]@{ branch = $branch; commit = $head; dirtyEntries = $dirty.Count }
    startedAt  = $RunStartedAt.ToUniversalTime().ToString('o')
}

if ($PSVersionTable.PSHostName) { $environment.powershell.host = 'powershell' }
if (Get-Command pwsh -ErrorAction SilentlyContinue) {
    if ($PSVersionTable.PSEdition -eq 'Core') { $environment.powershell.host = 'pwsh' }
}
if ($environment.powershell.host -eq 'unknown') {
    if ($PSVersionTable.PSEdition -eq 'Core') { $environment.powershell.host = 'pwsh' } else { $environment.powershell.host = 'powershell' }
}

Write-Host ("  PowerShell : {0} ({1})" -f $environment.powershell.version, $environment.powershell.edition)
Write-Host ("  Windows    : {0} build {1}" -f $windows.version, $windows.build)
Write-Host ("  node       : {0}" -f $environment.node)
Write-Host ("  electron   : {0}" -f $environment.electron)
Write-Host ("  pnpm       : {0}" -f $environment.pnpm)
Write-Host ("  runId      : {0}" -f $RunId)

$environmentFile = $null
if ($run) {
    $environmentFile = Join-Path $run.FullName 'environment.json'
    # UTF-8 without BOM: `Set-Content -Encoding UTF8` on 5.1 prepends one, and a
    # consumer parsing this as JSON would then fail on the first character.
    [System.IO.File]::WriteAllText($environmentFile, ($environment | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding $false))
    Write-Host ("  gravado    : {0}" -f $environmentFile)
}

# A version string is the thing that makes the report falsifiable; if it is
# missing, say so loudly instead of shipping a nameless run.
if ($psVersion.Major -lt 5) {
    Add-Result 'ambiente' 'FAIL' 'versao do PowerShell nao identificada'
}
else {
    Add-Result 'ambiente' 'PASS' ("PS {0} {1}; Windows {2}; node {3}" -f $psVersion.ToString(), $gatePsEdition, $windows.build, $environment.node)
}

# ---------------------------------------------------------------------------
# 10. Export: a package that survives this workspace
# ---------------------------------------------------------------------------
Write-Step '10. Exportacao do pacote de evidencias'

<#
    The gate writes into Tests/artifacts, which is git-ignored and disposable.
    The previous evidence died exactly that way. This step COPIES (never moves)
    the artifacts into $ExportRoot/<runId>/, together with environment.json and a
    manifest carrying a SHA-256 per file, the branch, the commit and the result.

    Nothing secret goes in: the gate already redacted its artifacts, and the
    manifest holds only names, sizes, hashes and version strings.
#>
$exportFolder = $null
if (-not $run) {
    Add-Result 'exportacao' 'FAIL' 'sem pasta de artefatos para exportar'
}
else {
    try {
        $exportFolder = Join-Path $ExportRoot $RunId
        New-Item -ItemType Directory -Path $exportFolder -Force | Out-Null

        $exported = @()
        foreach ($name in @('report.json', 'electron.log', 'environment.json', 'electron.png')) {
            $source = Join-Path $run.FullName $name
            if (Test-Path $source) {
                Copy-Item -Path $source -Destination (Join-Path $exportFolder $name) -Force
                $exported += $name
            }
        }

        $hashEntries = @()
        foreach ($name in $exported) {
            $file = Join-Path $exportFolder $name
            $hash = Get-FileHash -Path $file -Algorithm SHA256
            $hashEntries += [ordered]@{
                name   = $name
                bytes  = (Get-Item $file).Length
                sha256 = $hash.Hash.ToLowerInvariant()
            }
        }

        $reportResult = 'unknown'
        $groupsInfo = $null
        if ($report) {
            if ($report.result) { $reportResult = [string]$report.result }
            if ($report.groups) { $groupsInfo = $report.groups }
        }

        $manifest = [ordered]@{
            formatVersion = 1
            runId         = $RunId
            git           = [ordered]@{ branch = $branch; commit = $head; dirtyEntries = $dirty.Count }
            environment   = $environment
            startedAt     = $RunStartedAt.ToUniversalTime().ToString('o')
            finishedAt    = (Get-Date).ToUniversalTime().ToString('o')
            result        = $reportResult
            groups        = $groupsInfo
            gateExit      = $gateExit
            files         = $hashEntries
            verification  = "Get-FileHash -Algorithm SHA256 <arquivo>; compare com files[].sha256 deste manifesto"
        }
        $manifestPath = Join-Path $exportFolder 'manifest.json'
        [System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 8), (New-Object System.Text.UTF8Encoding $false))

        Write-Host ("  pacote     : {0}" -f $exportFolder)
        foreach ($entry in $hashEntries) {
            Write-Host ("    {0,-16} {1,10} bytes  {2}" -f $entry.name, $entry.bytes, $entry.sha256)
        }
        Write-Host '  Copie essa pasta para fora do clone. Ela nao e versionada.'

        $required = @('report.json', 'electron.log', 'environment.json', 'manifest.json')
        $missing = @($required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $exportFolder $_) -PathType Leaf) })
        if ($missing.Count -gt 0) {
            Add-Result 'exportacao' 'FAIL' ("faltando: " + ($missing -join ', '))
        }
        else {
            Add-Result 'exportacao' 'PASS' ("{0} arquivos + manifest em {1}" -f $exported.Count, $exportFolder)
        }
    }
    catch {
        Add-Result 'exportacao' 'FAIL' ("falhou: " + $_.Exception.Message)
        Write-Host ("  AVISO: a exportacao falhou: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
    }
}

# ---------------------------------------------------------------------------
# 11. Summary. No Git operation was performed.
# ---------------------------------------------------------------------------
Write-Step '11. Resumo'

$script:Results | Format-Table -AutoSize | Out-String | Write-Host

Write-Host 'Git: nenhuma operacao foi feita por este script (sem add, commit, push, checkout).'
$after = @(Invoke-Git @('status', '--porcelain') | Where-Object { $_ -ne '' -and $_.Trim() -ne '' })
Write-Host ("  entradas na working tree agora: {0} (antes: {1})" -f $after.Count, $dirty.Count)
if ($after.Count -ne $dirty.Count) {
    Write-Host '  AVISO: a contagem mudou. Investigue antes de qualquer outra coisa.' -ForegroundColor Yellow
}

Set-Location $script:OriginalLocation

$failed = @($script:Results | Where-Object { $_.Status -eq 'FAIL' })
$exportHint = if ($exportFolder) { $exportFolder } else { '(exportacao indisponivel - ver as etapas com FAIL acima)' }

Write-Host ''
Write-Host ("runId: {0}" -f $RunId)
Write-Host ("pacote de evidencias: {0}" -f $exportHint)

if ($gateExit -eq 0 -and $failed.Count -eq 0) {
    Write-Host ''
    Write-Host 'GATE EXECUTADO E APROVADO.' -ForegroundColor Green
    Write-Host '  Isto cobre os dez provedores curados de chat sobre HTTP local, neste Windows,' -ForegroundColor Green
    Write-Host '  com esta versao de PowerShell. NAO cobre voz remota, instalador nem servico externo.' -ForegroundColor Green
    Write-Host '  Copie a pasta acima para fora do clone e anexe o caminho ao relatorio.' -ForegroundColor Green
    exit 0
}

Write-Host ''
Write-Host ("GATE NAO APROVADO (exit do gate: {0}; etapas com FAIL: {1})." -f $gateExit, $failed.Count) -ForegroundColor Red
Write-Host 'Nao declare o Corte B validado. Anexe report.json e electron.log desta execucao.' -ForegroundColor Red
exit 1
