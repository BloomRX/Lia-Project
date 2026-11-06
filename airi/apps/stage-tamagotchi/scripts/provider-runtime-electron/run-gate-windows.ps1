<#
.SYNOPSIS
    Runs the real Electron gate for the Lia native provider runtime (Corte B)
    on Windows, in the documented order, and preserves the evidence.

.DESCRIPTION
    This is a thin RUNNER. It executes the commands the repository already
    declares — it does not reimplement, weaken or replace the gate, and it does
    not touch Git.

    The gate itself is `scripts/provider-runtime-electron/gate.test.mjs`, which
    is Windows-only (`skip: process.platform !== 'win32'`) because its teardown
    proof enumerates processes with `Get-CimInstance` and launches
    `dist/electron.exe`. Its own header documents the same three steps this
    script runs:

        1. install the Electron runtime from the OFFICIAL package installer
           (downloads the asset matching the locked version and verifies it
           against the package's own checksums.json);
        2. build the Stage, which produces out/preload/index.mjs — the gate
           reads that file before doing anything else;
        3. run `node --test` on the gate.

    Before that it checks, and refuses to continue when wrong: git branch, HEAD
    and working tree, Node and pnpm versions, whether the Electron runtime is
    already installed, whether playwright and vite resolve from the app, and
    whether out/preload/index.mjs exists after the build.

    It records one console transcript plus the gate's own artifacts under
    Tests/artifacts/provider-runtime-electron/<timestamp>/, with the exit code
    of every step and an independent re-check of the "no synthetic secret in the
    logs" assertion (report.json -> logSecretsAbsent, plus a scan of electron.log
    for the synthetic PREFIXES the gate uses — never the values).

    It never prints a credential. It creates no commit, no branch and no push:
    `git status` is printed at the end only so the operator can confirm that.

.PARAMETER SkipBuild
    Reuse an existing `out/preload/index.mjs` instead of rebuilding the Stage.
    Only valid when the preload was built from the current working tree.

.PARAMETER ElectronZip
    Path to an ALREADY DOWNLOADED `electron-v43.4.1-win32-x64.zip` obtained from
    the official GitHub release. When given, the script verifies its SHA-256
    against the expected value before handing it to the official installer.
    When omitted, the official installer downloads it itself.

.PARAMETER ExpectedSha256
    Expected hash of the win32-x64 asset. Defaults to the value published in
    the locked package's own checksums.json (cross-checked at runtime).

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
    [string] $ExpectedSha256 = 'c2ef9a5f65472c34d14bd3e67b7d14e66b0c01f124aba45263d6a4232160e13a'
)

$ErrorActionPreference = 'Stop'

# Everything is resolved from this file, so the script works from any clone.
$GateDir = $PSScriptRoot
$StageDir = Split-Path -Parent (Split-Path -Parent $GateDir)
$AiriDir = Split-Path -Parent (Split-Path -Parent $StageDir)
$RepoDir = Split-Path -Parent $AiriDir

$ExpectedElectron = '43.4.1'
$ExpectedPnpm = '11.24.0'
$GateRelative = 'scripts/provider-runtime-electron/gate.test.mjs'
$ElectronDir = Join-Path $StageDir 'node_modules\electron'
$ElectronExe = Join-Path $ElectronDir 'dist\electron.exe'
$PreloadFile = Join-Path $StageDir 'out\preload\index.mjs'
$ChecksumsFile = Join-Path $ElectronDir 'checksums.json'
$ArtifactsRoot = Join-Path $RepoDir 'Tests\artifacts\provider-runtime-electron'

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
    Stop-With "pacote electron ausente em $ElectronDir — rode 'pnpm install --frozen-lockfile' na raiz (airi/)"
}

$installedVersion = (& node -e "console.log(require(process.argv[1]).version)" (Join-Path $ElectronDir 'package.json')).ToString().Trim()
Write-Host "  versao do pacote: $installedVersion"
if ($installedVersion -ne $ExpectedElectron) {
    Stop-With "versao instalada ($installedVersion) difere da exigida ($ExpectedElectron). Nao altere versao nem lockfile."
}

# The expected hash is cross-checked against the LOCKED PACKAGE's own
# checksums.json — not taken on faith from any document.
if (Test-Path $ChecksumsFile) {
    $checksums = Get-Content $ChecksumsFile -Raw | ConvertFrom-Json
    $assetName = "electron-v$ExpectedElectron-win32-x64.zip"
    $published = Get-Prop $checksums $assetName
    if ($published) {
        Write-Host "  SHA-256 publicado (checksums.json do pacote): $published"
        if ($published.ToLowerInvariant() -ne $ExpectedSha256.ToLowerInvariant()) {
            Stop-With "o hash do pacote difere do esperado. Nao prossiga sem entender por que."
        }
        Add-Result 'sha256 publicado' 'PASS' 'confere com checksums.json do pacote'
    }
    else {
        Write-Host "  AVISO: checksums.json sem entrada para $assetName" -ForegroundColor Yellow
        Add-Result 'sha256 publicado' 'SKIP' 'entrada ausente no checksums.json'
    }
}
else {
    Write-Host '  AVISO: checksums.json ausente no pacote electron.' -ForegroundColor Yellow
    Add-Result 'sha256 publicado' 'SKIP' 'checksums.json ausente'
}

$runtimeReady = (Test-Path $ElectronExe) -and (Test-Path (Join-Path $ElectronDir 'path.txt'))
if ($runtimeReady) {
    $runtimeVersion = Get-ExeVersion $ElectronExe @('--version')
    Write-Host "  runtime presente: $ElectronExe"
    Write-Host "  versao reportada: $runtimeVersion"
    if (-not $runtimeVersion -or $runtimeVersion -notmatch [regex]::Escape($ExpectedElectron)) {
        Stop-With "o runtime respondeu '$runtimeVersion', que nao e $ExpectedElectron"
    }
    Add-Result 'runtime Electron' 'PASS' ("ja instalado, {0}" -f $runtimeVersion)
}
else {
    Write-Host '  runtime ausente (sem dist/electron.exe). Sera instalado no passo 5.' -ForegroundColor Yellow
    Add-Result 'runtime Electron' 'SKIP' 'ausente antes do passo 5'
}

# ---------------------------------------------------------------------------
# 5. Install the runtime from the OFFICIAL source only
# ---------------------------------------------------------------------------
Write-Step '5. Instalacao do runtime (origem oficial, hash publicado)'

if ($runtimeReady) {
    Write-Host '  nada a fazer: runtime ja presente e conferido.'
}
else {
    $overrodeDist = $false
    if ($ElectronZip) {
        if (-not (Test-Path $ElectronZip)) { Stop-With "zip informado nao existe: $ElectronZip" }
        $actual = (Get-FileHash -Path $ElectronZip -Algorithm SHA256).Hash.ToLowerInvariant()
        Write-Host "  zip local     : $ElectronZip"
        Write-Host "  SHA-256 obtido: $actual"
        if ($actual -ne $ExpectedSha256.ToLowerInvariant()) {
            Stop-With 'SHA-256 do zip NAO confere. Nao instale este arquivo.'
        }
        Write-Host '  SHA-256 confere.' -ForegroundColor Green
        # @electron/get honours ELECTRON_OVERRIDE_DIST_PATH: point it at the
        # unpacked zip so the official installer uses this exact artifact.
        $extract = Join-Path $env:TEMP "electron-$ExpectedElectron-win32-x64"
        if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
        Expand-Archive -Path $ElectronZip -DestinationPath $extract -Force
        $env:ELECTRON_OVERRIDE_DIST_PATH = $extract
        $overrodeDist = $true
        Write-Host "  ELECTRON_OVERRIDE_DIST_PATH=$extract"
    }

    Write-Host '  executando o instalador do proprio pacote (asset da versao travada,'
    Write-Host '  conferido contra checksums.json, extraido em node_modules/electron/dist).'
    Write-Host '  Nenhum host de terceiros: ELECTRON_MIRROR, se existir no ambiente, deve'
    Write-Host '  apontar para espelho OFICIAL — este script nao define essa variavel.'

    & pnpm --filter '@proj-airi/stage-tamagotchi' exec node 'node_modules/electron/install.js'
    $installExit = $LASTEXITCODE
    Write-Host "  exit code do instalador: $installExit"

    if ($overrodeDist) {
        Remove-Item Env:\ELECTRON_OVERRIDE_DIST_PATH -ErrorAction SilentlyContinue
    }

    if ($installExit -ne 0 -or -not (Test-Path $ElectronExe)) {
        Write-Host ''
        Write-Host '  FALHA na instalacao do runtime.' -ForegroundColor Red
        Write-Host '  Causas tipicas: rede/proxy bloqueando a release oficial do GitHub, ou o' -ForegroundColor Yellow
        Write-Host '  host que entrega o asset inacessivel. Nesse caso o gate NAO pode rodar.' -ForegroundColor Yellow
        Write-Host '  NAO use binario de origem nao oficial e NAO altere versao nem lockfile.' -ForegroundColor Yellow
        Add-Result 'instalacao do runtime' 'FAIL' ("exit={0}" -f $installExit)
        Stop-With 'runtime do Electron indisponivel'
    }
    Add-Result 'instalacao do runtime' 'PASS' ("exit={0}" -f $installExit)
}

if (-not (Test-Path $ElectronExe)) { Stop-With "dist/electron.exe continua ausente em $ElectronDir" }
$runtimeVersion = Get-ExeVersion $ElectronExe @('--version')
Write-Host "  runtime: $runtimeVersion"
if (-not $runtimeVersion -or $runtimeVersion -notmatch [regex]::Escape($ExpectedElectron)) {
    Stop-With "runtime respondeu '$runtimeVersion', esperado $ExpectedElectron"
}
Add-Result 'versao do runtime' 'PASS' $runtimeVersion

# ---------------------------------------------------------------------------
# 6. Stage build (produces out/preload/index.mjs, read first by the gate)
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
        Write-Host '  nao codigo — mas o gate depende do preload. Nao altere lockfile nem a' -ForegroundColor Yellow
        Write-Host '  configuracao do build para contornar.' -ForegroundColor Yellow
        Add-Result 'build do Stage' 'FAIL' ("exit={0}" -f $buildExit)
        Stop-With 'build do Stage falhou'
    }
    Add-Result 'build do Stage' 'PASS' ("exit={0}" -f $buildExit)
}

if (-not (Test-Path $PreloadFile)) {
    Stop-With "o gate le $PreloadFile antes de tudo e ele nao existe — rode sem -SkipBuild"
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

$startedAt = Get-Date
Push-Location $StageDir
try {
    & node --test $GateRelative
    $gateExit = $LASTEXITCODE
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
    Write-Host "  AVISO: $ArtifactsRoot nao existe — o gate nao escreveu artefatos." -ForegroundColor Yellow
    Add-Result 'artefatos' 'FAIL' 'diretorio nao criado'
}
else {
    $run = Get-ChildItem $ArtifactsRoot -Directory |
        Where-Object { $_.CreationTime -ge $startedAt.AddMinutes(-1) } |
        Sort-Object Name -Descending | Select-Object -First 1

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
            Add-Result 'report.json' 'FAIL' 'ausente — o gate falhou antes do finally'
            $secretFailures++
        }
        else {
            $report = Get-Content $reportFile -Raw | ConvertFrom-Json
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

            if ((Get-Prop $report 'logSecretsAbsent') -eq $false) {
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
# 9. Summary. No Git operation was performed.
# ---------------------------------------------------------------------------
Write-Step '9. Resumo'

$script:Results | Format-Table -AutoSize | Out-String | Write-Host

Write-Host 'Git: nenhuma operacao foi feita por este script (sem add, commit, push, checkout).'
$after = @(Invoke-Git @('status', '--porcelain') | Where-Object { $_ -ne '' -and $_.Trim() -ne '' })
Write-Host ("  entradas na working tree agora: {0} (antes: {1})" -f $after.Count, $dirty.Count)
if ($after.Count -ne $dirty.Count) {
    Write-Host '  AVISO: a contagem mudou. Investigue antes de qualquer outra coisa.' -ForegroundColor Yellow
}

Set-Location $script:OriginalLocation

$failed = @($script:Results | Where-Object { $_.Status -eq 'FAIL' })
if ($gateExit -eq 0 -and $failed.Count -eq 0) {
    Write-Host ''
    Write-Host 'GATE EXECUTADO E APROVADO. Anexe o caminho da pasta de artefatos ao relatorio.' -ForegroundColor Green
    exit 0
}

Write-Host ''
Write-Host ("GATE NAO APROVADO (exit do gate: {0}; etapas com FAIL: {1})." -f $gateExit, $failed.Count) -ForegroundColor Red
Write-Host 'Nao declare o Corte B validado. Anexe report.json e electron.log desta execucao.' -ForegroundColor Red
exit 1
