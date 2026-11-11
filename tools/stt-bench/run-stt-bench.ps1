#requires -Version 5.1
<#
.SYNOPSIS
    Bancada STT da Lia: faster-whisper small, CPU, int8, portugues.

.DESCRIPTION
    Prepara e executa um unico experimento: transcrever no maximo 10 amostras
    locais e gravar um JSON de resultado que pode virar evidencia do catalogo.

    Esta bancada NAO:
      - envia audio para servico algum;
      - baixa pesos sem -AllowModelDownload;
      - instala servico residente;
      - altera a voz ou a transcricao da Lia;
      - declara validade para Windows a partir de medidas em Linux.

    ASCII apenas: o PowerShell 5.1 le arquivos sem BOM como ANSI. Texto
    acentuado neste arquivo corromperia a saida.

.PARAMETER SamplesDir
    Diretorio base dos audios citados no manifesto (caminhos relativos).

.PARAMETER Manifest
    JSON com as amostras e as transcricoes de referencia.

.PARAMETER OutputDir
    Diretorio do JSON de resultado. Padrao: .\out

.PARAMETER Setup
    Cria .venv e instala requirements-stt-bench.txt. Nao baixa pesos.

.PARAMETER AllowModelDownload
    Unico jeito de baixar pesos. Sem esta chave, o script para e explica.

.PARAMETER MachineId
    Rebaixa o rotulo do ambiente (ex.: linux-other). Nao promove: pedir
    windows-reference-machine sem os fatos detectados aborta.

.PARAMETER NoHash
    Nao recalcula o sha256 do model.bin. Mais rapido; o resultado registra
    hashChecked=false.

.PARAMETER Doctor
    Inspeciona ambiente, dependencias, cache de pesos e disco.

.PARAMETER DryRun
    Valida manifesto, limites e ambiente; nao importa modelo nem baixa nada.

.PARAMETER SelfTest
    Gera um tom sintetico e roda o encanamento. NAO mede qualidade.

.EXAMPLE
    .\run-stt-bench.ps1 -Setup

.EXAMPLE
    .\run-stt-bench.ps1 -Doctor

.EXAMPLE
    .\run-stt-bench.ps1 -Manifest .\samples.json -SamplesDir .\samples -DryRun

.EXAMPLE
    .\run-stt-bench.ps1 -Manifest .\samples.json -SamplesDir .\samples `
        -AllowModelDownload -OutputDir "$env:USERPROFILE\lia-evidence\stt"
#>
[CmdletBinding()]
param(
    [string] $SamplesDir = '',
    [string] $Manifest = '',
    [string] $OutputDir = '',
    [string] $PythonExe = '',
    [string] $Model = '',
    [string] $CpuName = '',
    [string] $GpuName = '',
    [string] $MachineId = '',
    [switch] $Setup,
    [switch] $AllowModelDownload,
    [switch] $NoHash,
    [switch] $Doctor,
    [switch] $DryRun,
    [switch] $SelfTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Sem isto, Python em console redirecionado usa cp1252 no Windows e quebra ao
# imprimir acento. Vale apenas para este processo.
$env:PYTHONUTF8 = '1'

$scriptDir = $PSScriptRoot
$benchPy = Join-Path $scriptDir 'stt_bench.py'
$requirements = Join-Path $scriptDir 'requirements-stt-bench.txt'
$venvDir = Join-Path $scriptDir '.venv'
$venvPython = Join-Path $venvDir 'Scripts\python.exe'

function Write-Step([string] $text) {
    Write-Host ''
    Write-Host "== $text" -ForegroundColor Cyan
}

function Write-Note([string] $text) {
    Write-Host "   $text"
}

function Fail([string] $text) {
    Write-Host ''
    Write-Host "[erro] $text" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path -LiteralPath $benchPy)) {
    Fail "stt_bench.py nao encontrado em $scriptDir"
}

# --------------------------------------------------------------------------
# 1. Interpretador Python
# --------------------------------------------------------------------------
function Get-PythonProbe {
    # Sonda um candidato executando -c. O codigo Python NAO pode ter aspas
    # duplas: o PowerShell 5.1 as remove ao passar argumento para executavel
    # nativo, e o codigo chega quebrado (foi o erro do primeiro teste real).
    param([hashtable] $Candidate)
    $probeArgs = @()
    $probeArgs += $Candidate.Args
    $probeArgs += @('-c', 'import sys; print(sys.version_info[0], sys.version_info[1])')
    $out = & $Candidate.Exe @probeArgs 2>&1
    if ($LASTEXITCODE -ne 0) { return $null }
    if ($null -eq $out) { return $null }
    $major = -1
    $minor = -1
    foreach ($line in @($out)) {
        $text = ([string]$line).Trim()
        if ($text -match '^(\d+)\s+(\d+)$') {
            $major = [int]$Matches[1]
            $minor = [int]$Matches[2]
        }
    }
    if ($major -lt 0) { return $null }
    return @{ Major = $major; Minor = $minor; Text = "$major.$minor" }
}

function Resolve-Python {
    # Tenta candidatos em ordem e escolhe o primeiro que executa E tem 3.12+.
    # Antes, "py.exe existe" era tratado como "py -3.12 existe", e o erro
    # aparecia como falha generica.
    $candidates = @()
    if ($PythonExe -ne '') {
        if (-not (Test-Path -LiteralPath $PythonExe)) {
            Fail "PythonExe nao existe: $PythonExe"
        }
        $candidates += ,@{ Exe = $PythonExe; Args = @(); Label = $PythonExe }
    }
    if (Test-Path -LiteralPath $venvPython) {
        $candidates += ,@{ Exe = $venvPython; Args = @(); Label = '.venv' }
    }
    $launcher = Get-Command 'py.exe' -ErrorAction SilentlyContinue
    if ($null -ne $launcher) {
        $candidates += ,@{ Exe = $launcher.Source; Args = @('-3.12'); Label = 'py -3.12' }
        $candidates += ,@{ Exe = $launcher.Source; Args = @('-3'); Label = 'py -3' }
    }
    $python = Get-Command 'python.exe' -ErrorAction SilentlyContinue
    if ($null -ne $python) {
        $candidates += ,@{ Exe = $python.Source; Args = @(); Label = 'python.exe' }
    }
    if ($candidates.Count -eq 0) {
        Fail 'Python nao encontrado. Instale Python 3.12 x64 ou rode: py install 3.12'
    }
    $fallback = $null
    foreach ($candidate in $candidates) {
        $probe = Get-PythonProbe -Candidate $candidate
        if ($null -eq $probe) {
            Write-Note ("descartado: " + $candidate.Label + " (nao executa)")
            continue
        }
        if (($probe.Major -gt 3) -or (($probe.Major -eq 3) -and ($probe.Minor -ge 12))) {
            $candidate['Version'] = $probe.Text
            return $candidate
        }
        Write-Note ("descartado: " + $candidate.Label + " (Python " + $probe.Text + ", precisa 3.12+)")
        if ($null -eq $fallback) {
            $candidate['Version'] = $probe.Text
            $fallback = $candidate
        }
    }
    if ($null -ne $fallback) {
        Write-Warning ("Nenhum Python 3.12+ utilizavel. Usando " + $fallback.Label + " (Python " + $fallback.Version + ") apenas para -Doctor e -DryRun.")
        return $fallback
    }
    Fail 'Nenhum Python executavel encontrado. Instale Python 3.12 x64 ou rode: py install 3.12'
}

function Invoke-Python {
    param(
        [hashtable] $Py,
        [string[]] $PyArgs
    )
    # Splatting exige uma variavel de array; @(...) inline seria passado como
    # UM argumento. Out-Host evita que a saida contamine o valor de retorno.
    $all = @()
    $all += $Py.Args
    $all += $PyArgs
    & $Py.Exe @all | Out-Host
    return $LASTEXITCODE
}

$py = Resolve-Python
Write-Step 'Interpretador'
Write-Note ("comando: " + $py.Exe + " " + ($py.Args -join ' '))
Write-Note ("versao: " + $py.Version)

$versionParts = ([string]$py.Version).Split('.')
$pyMajor = [int]$versionParts[0]
$pyMinor = [int]$versionParts[1]
$pythonIsNewEnough = ($pyMajor -gt 3) -or (($pyMajor -eq 3) -and ($pyMinor -ge 12))

# av==19 e numpy==2.5 pedem 3.12. Para diagnosticar (-Doctor) ou so validar
# entrada (-DryRun) uma versao antiga serve; para instalar ou medir, nao.
$needRuntime = $Setup -or $SelfTest -or (($Manifest -ne '') -and (-not $DryRun) -and (-not $Doctor))
if (-not $pythonIsNewEnough) {
    if ($needRuntime) {
        Fail ("Python " + $py.Version + " e anterior ao exigido (3.12). Rode: py install 3.12")
    }
    Write-Warning ("Python " + $py.Version + " fora do alvo (3.12). -Doctor e -DryRun funcionam; instalar e medir nao.")
}

$validMachineIds = @('arena-linux', 'windows-reference-machine', 'windows-other', 'macos-other', 'linux-other')
if ($MachineId -ne '' -and $validMachineIds -notcontains $MachineId) {
    Fail "MachineId invalido: $MachineId. Use um de: $($validMachineIds -join ', ')"
}

# --------------------------------------------------------------------------
# 2. Setup opcional (nao baixa pesos)
# --------------------------------------------------------------------------
if ($Setup) {
    Write-Step 'Criando ambiente virtual'
    $venvExists = Test-Path -LiteralPath $venvPython
    if ($venvExists -and ($py.Exe -ne $venvPython) -and ($PythonExe -eq '')) {
        Fail ("O .venv existente foi criado com outro Python (menor que 3.12) e nao serve. Apague a pasta " + $venvDir + " e repita.")
    }
    if (-not (Test-Path -LiteralPath $venvDir)) {
        $rc = Invoke-Python -Py $py -PyArgs @('-m', 'venv', $venvDir)
        if ($rc -ne 0) { Fail "falha ao criar venv (exit $rc)" }
    } else {
        Write-Note "venv ja existe: $venvDir"
    }
    $venvPy = @{ Exe = $venvPython; Args = @(); Label = '.venv'; Version = $py.Version }
    Write-Step 'Instalando dependencias fixadas'
    $rc = Invoke-Python -Py $venvPy -PyArgs @('-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '-r', $requirements)
    if ($rc -ne 0) { Fail "pip install falhou (exit $rc). Nada foi executado." }
    Write-Step 'Instalado'
    $rc = Invoke-Python -Py $venvPy -PyArgs @('-m', 'pip', 'freeze')
    if ($rc -ne 0) { Write-Warning 'pip freeze falhou; siga sem ele.' }
    $py = $venvPy
    if (-not $Doctor -and -not $DryRun -and -not $SelfTest -and $Manifest -eq '') {
        Write-Host ''
        Write-Host 'Ambiente pronto. Proximo passo: -Doctor; depois -Manifest <arquivo> -DryRun.'
        exit 0
    }
}

# --------------------------------------------------------------------------
# 3. fatos da maquina (repassados ao Python; nada e inferido aqui)
# --------------------------------------------------------------------------
if ($env:OS -eq 'Windows_NT') {
    if ($CpuName -eq '') {
        try {
            $CpuName = (Get-CimInstance -ClassName Win32_Processor -ErrorAction Stop |
                        Select-Object -First 1).Name
        } catch {
            $CpuName = ''
        }
    }
    if ($GpuName -eq '') {
        try {
            $gpus = @(Get-CimInstance -ClassName Win32_VideoController -ErrorAction Stop |
                      ForEach-Object { $_.Name })
            if ($gpus.Count -gt 0) { $GpuName = ($gpus -join ' | ') }
        } catch {
            $GpuName = ''
        }
    }
}

# --------------------------------------------------------------------------
# 4. argumentos
# --------------------------------------------------------------------------
# Saida previsivel dentro da pasta da ferramenta, que o .gitignore cobre.
if ($OutputDir -eq '') { $OutputDir = Join-Path $scriptDir 'out' }

$benchArgs = @($benchPy)
if ($SamplesDir -ne '') { $benchArgs += @('--samples-dir', $SamplesDir) }
if ($Manifest -ne '') { $benchArgs += @('--manifest', $Manifest) }
if ($OutputDir -ne '') { $benchArgs += @('--output-dir', $OutputDir) }
if ($Model -ne '') { $benchArgs += @('--model', $Model) }
if ($CpuName -ne '') { $benchArgs += @('--cpu-name', $CpuName) }
if ($GpuName -ne '') { $benchArgs += @('--gpu-name', $GpuName) }
if ($MachineId -ne '') { $benchArgs += @('--machine-id', $MachineId) }
if ($NoHash) { $benchArgs += @('--no-hash') }
if ($AllowModelDownload) { $benchArgs += @('--allow-download') }
if ($Doctor) { $benchArgs += @('--doctor') }
if ($DryRun) { $benchArgs += @('--dry-run') }
if ($SelfTest) { $benchArgs += @('--self-test') }

if (-not $Doctor -and -not $DryRun -and -not $SelfTest -and $Manifest -eq '') {
    Write-Host ''
    Write-Host 'Nada a executar. Use -Setup, -Doctor, -DryRun ou -Manifest <arquivo>.' -ForegroundColor Yellow
    exit 1
}

if (-not $AllowModelDownload -and -not $Doctor -and -not $DryRun) {
    Write-Step 'Aviso de download'
    Write-Note 'Pesos do modelo (Systran/faster-whisper-small, MIT):'
    Write-Note '  model.bin = 483.546.902 bytes (~483,5 MB)'
    Write-Note '  total do repositorio ~486 MB'
    Write-Note 'Sem -AllowModelDownload o script para se o cache estiver vazio.'
}

Write-Step 'Executando'
$rc = Invoke-Python -Py $py -PyArgs $benchArgs
Write-Host ''
switch ($rc) {
    0 { Write-Host 'saida 0: executado. Veja o JSON de resultado.' -ForegroundColor Green }
    1 { Write-Host 'saida 1: entrada invalida. Nada foi executado.' -ForegroundColor Yellow }
    2 { Write-Host 'saida 2: argumento invalido (uso do script).' -ForegroundColor Yellow }
    3 { Write-Host 'saida 3: pesos ausentes. Repita com -AllowModelDownload.' -ForegroundColor Yellow }
    4 { Write-Host 'saida 4: veredito rejected pelos criterios.' -ForegroundColor Red }
    5 { Write-Host 'saida 5: ambiente incompleto. Rode -Setup.' -ForegroundColor Yellow }
    default { Write-Host "saida ${rc}: falha inesperada." -ForegroundColor Red }
}
exit $rc
