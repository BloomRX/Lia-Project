# Protocolo de benchmark C0–C8 — Windows 11

**Decisão associada:** [D-07](DECISION-RECORD-2026-11-16.md#d-07--gatilhos-provisórios-para-reavaliar-abc)
**Hardware de referência:** Ryzen 5 5500 · 16 GB RAM · Radeon RX 580 8 GB (gfx803) · Windows 11
**Data:** 16/11/2026 · **Status:** protocolo pronto para execução. **Nada foi medido.**

> Este documento **substitui o §9.4 da auditoria** (`LIA-DESKTOP-ARCHITECTURE-AUDIT-2026-11-16`).
> O mapeamento entre as duas numerações está no Anexo A. Os números de referência citados na
> auditoria (1.997,5 MiB; 8,49% de CPU; +95/+152/+483/+1311 ms) continuam válidos **como
> história** — não são baseline deste protocolo, porque foram coletados com outro build, outros
> serviços e outras janelas abertas.

---

## 1. Regra de ouro

**Nada neste protocolo pode ser preenchido por analogia.** Um número de outro computador, de outro
build ou de outro sistema operacional não é "aproximado": é inválido. Se uma medida não puder ser
feita, o campo recebe `N/A` e o motivo — nunca uma estimativa disfarçada.

| Etiqueta | Uso no relatório final |
|---|---|
| **MEDIDO** | Coletado com este protocolo, na máquina de referência, com o build identificado |
| **ESTIMADO** | Derivado de MEDIDO com a base declarada (ex.: "projeção a partir de C0") |
| **HIPÓTESE** | Não medido; explicitamente uma pergunta a responder |
| **N/A** | Não aplicável ou não executável, com motivo |

**Dados de Linux deste repositório não são benchmark Windows.** O sandbox onde esta documentação
foi escrita não tem display, não tem GTK e não abre Electron; nenhum número dele entra aqui.

---

## 2. Cenários

| ID | Cenário | Estado do Launcher | Estado do Runtime | O que responde |
|---|---|---|---|---|
| **C0** | Launcher sozinho | aberto, tela inicial, ocioso | **parado** | quão caro é o controle puro (gate D-07) |
| **C1** | Runtime sozinho | **fechado** | `LiaStage.exe` direto, avatar em repouso | custo da personagem sem controle |
| **C2** | Ambos ociosos | aberto | iniciado pelo Launcher, repouso | custo do conjunto em repouso |
| **C3** | Inicialização | — | — | boot a frio, boot a quente e **reabertura** com adoção |
| **C4** | Atividade | aberto | conversa (STT→LLM→TTS), 10 turnos | custo e latência sob uso |
| **C5** | CPU por atividade | aberto | repouso vs. animação ativa vs. fala | onde a CPU é gasta |
| **C6** | Processos e threads | aberto | repouso | composição da árvore (gate D-07) |
| **C7** | Jogo em primeiro plano | aberto, minimizado | ativo | impacto em FPS e frame time |
| **C8** | Encerramento | aberto | ativo | parada cooperativa vs. forçada; órfãos |

**C0 é o cenário do gate.** Os demais descrevem o produto; nenhum deles decide framework.

---

## 3. Preparação da máquina (uma vez por sessão)

```powershell
# 1. Identidade do build — vai para o cabeçalho de TODO arquivo de evidência
$env:LIA_BENCH_COMMIT   = (git -C C:\dev\Lia-Project rev-parse HEAD)
$env:LIA_BENCH_BUILD    = 'win-x64'          # + data/hora do pacote
$env:LIA_BENCH_DRIVER   = (Get-CimInstance Win32_VideoController -Filter "Name like '%Radeon%'").DriverVersion
$env:LIA_BENCH_OS       = (Get-CimInstance Win32_OperatingSystem).Version + ' build ' + (Get-CimInstance Win32_OperatingSystem).BuildNumber
$env:LIA_BENCH_MONITORS = (Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorBasicDisplayParams | Measure-Object).Count
$env:LIA_BENCH_DPI      = (Get-ItemProperty 'HKCU:\Control Panel\Desktop\WindowMetrics' -Name AppliedDPI).AppliedDPI
$env:LIA_BENCH_POWER    = (powercfg /getactivescheme) -join ' '
$env:LIA_BENCH_ELECTRON = '43.4.1'

# 2. Estado limpo
powercfg /setactive SCHEME_MIN          # alto desempenho
Get-Process Lia,LiaStage -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process msedge,chrome,Discord,Steam -ErrorAction SilentlyContinue | Stop-Process -Force  # ruído
# aguardar 60 s de estabilização e confirmar que não há Windows Update em curso
Get-Service wuauserv | Select-Object Status
```

**Invalidam a execução:** atualização do Windows em andamento, varredura de antivírus, driver
diferente do registrado, monitor/DPI diferente, plano de energia diferente, qualquer jogo ou
navegador aberto fora do cenário, ou temperatura ambiente/thermal throttling visível.

---

## 4. Coleta

### 4.1 Amostrador (vale para C0, C1, C2, C5, C6, C8)

```powershell
# uso: .\sample-tree.ps1 -RootPid 1234 -Label C0 -Reps 5 -Warmup 60 -Window 180
param(
  [Parameter(Mandatory)][int]$RootPid,
  [Parameter(Mandatory)][string]$Label,
  [int]$Reps = 5, [int]$Warmup = 60, [int]$Window = 180
)

function Get-Tree([int]$root) {
  $all = Get-CimInstance Win32_Process
  $ids = [System.Collections.Generic.HashSet[int]]::new()
  [void]$ids.Add($root)
  do {
    $added = $false
    foreach ($p in $all) {
      if ($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)) {
        [void]$ids.Add([int]$p.ProcessId); $added = $true
      }
    }
  } while ($added)
  $all | Where-Object { $ids.Contains([int]$_.ProcessId) }
}

$rows = foreach ($rep in 1..$Reps) {
  Start-Sleep -Seconds $Warmup
  $t0 = Get-Date
  $prevCpu = @{}
  while (((Get-Date) - $t0).TotalSeconds -lt $Window) {
    $procs = Get-Tree $RootPid
    $cpuTotal = 0.0; $priv = 0L; $ws = 0L; $thr = 0
    $isCrashpad = $false
    foreach ($p in $procs) {
      $gp = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
      if (-not $gp) { continue }
      $priv += $gp.PrivateMemorySize64
      $ws   += $gp.WorkingSet64
      $thr  += $gp.Threads.Count
      if ($gp.TotalProcessorTime) {
        if ($prevCpu.ContainsKey($p.ProcessId)) {
          $cpuTotal += ($gp.TotalProcessorTime - $prevCpu[$p.ProcessId]).TotalSeconds
        }
        $prevCpu[$p.ProcessId] = $gp.TotalProcessorTime
      }
      if ($p.Name -like 'crashpad*') { $isCrashpad = $true }
    }
    [pscustomobject]@{
      label = $Label; rep = $rep; t = [math]::Round(((Get-Date) - $t0).TotalSeconds,1)
      privateMB = [math]::Round($priv/1MB,1); wsMB = [math]::Round($ws/1MB,1)
      processes = $procs.Count; processesNoCrashpad = $procs.Count - (@($procs | Where-Object Name -like 'crashpad*').Count)
      threads = $thr; cpuPctMachine = $null
    } | ForEach-Object { $_.cpuPctMachine = [math]::Round(100.0*$cpuTotal/5.0/ (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors,2); $_ }
    Start-Sleep -Seconds 5
  }
}
$rows | Export-Csv -NoTypeInformation -Append -Path ".\evidence\$Label.csv"
```

**Regras de cálculo**

| Métrica | Definição |
|---|---|
| `privateMB` | soma de `PrivateMemorySize64` de **cada processo da árvore**, em MB |
| `wsMB` | soma de `WorkingSet64`; **reportada, nunca usada como gate** (conta páginas compartilhadas N vezes) |
| `processes` | árvore completa, deduplicada por PID |
| `processesNoCrashpad` | idem, excluindo `crashpad*` — **é o número do gate D-07** |
| `cpuPctMachine` | Δ(CPU total) / Δ(tempo × núcleos lógicos) × 100 |
| Estatística | **mediana** e p95 das amostras por repetição; reportar as 5 repetições, não só a média |

### 4.2 Boot e reabertura (C3)

Proxy externo, sempre possível:

```powershell
$t0 = Get-Date
$p  = Start-Process 'C:\Program Files\Lia\Lia.exe' -PassThru
$win = $null
while (-not $win -and ((Get-Date)-$t0).TotalSeconds -lt 30) {
  Start-Sleep -Milliseconds 50
  $win = (Get-Process -Id $p.Id -ErrorAction SilentlyContinue | Where-Object MainWindowHandle -ne 0)
}
"t_window_visible_ms = $([math]::Round(((Get-Date)-$t0).TotalMilliseconds))"
```

Marcas internas (quando o build as oferece, pela tela de diagnóstico): `lia-app.start`,
`lia-core.ready`, `lia-app.window-created`, `lia-app.renderer-ready` (`lia:timings`).

**Reabertura:** só é medível **depois de D-04**. Sem D-04, fechar o Launcher mata o Runtime e o
cenário é `N/A` — registrado, não inventado. Quando existir: medir o tempo entre `Start-Process`
e a adoção concluída (status `running` do Runtime exibido).

### 4.3 Atividade (C4)

Roteiro fixo, mesma voz, mesmo texto, mesmo provider **local** (para não medir rede):

1. 10 turnos "pergunta curta → resposta curta" com TTS habilitado.
2. Registrar por turno: STT final → primeiro token; primeiro token → primeiro áudio; duração do áudio.
3. Registrar pico de `privateMB` e `cpuPctMachine` durante a janela.

Se o provider exigir rede, registrar latência de rede separadamente e **não** somá-la à latência
do produto.

### 4.4 Jogo (C7)

| Item | Regra |
|---|---|
| Título | um único jogo DX11/DX12, fixo para toda a campanha |
| Cena | save/benchmark embutido, fixo, 180 s |
| Configuração | preset fixo, resolução fixa, VSync **off**, sem mods |
| Condições | (a) sem Lia; (b) Lia em C2 (Runtime ativo, Launcher minimizado); (c) Lia em C4 (conversa durante o jogo) |
| Repetições | 5 por condição, ordem alternada |
| Captura | PresentMon |

```powershell
PresentMon64.exe --process_name <jogo>.exe --output_file ".\evidence\C7_<cond>.csv" `
                 --terminate_after_timed 180 --no_top --stop_existing_session
```

Reportar **p50, p95, p99 e 1% low de frame time** — média esconde stutter.

---

## 5. Métricas obrigatórias por cenário

| Métrica | C0 | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Private bytes (mediana/p95) | ● | ● | ● | | ● | ● | ● | | |
| Working set (informativo) | ● | ● | ● | | ● | ● | ● | | |
| CPU % máquina | ● | ● | ● | | ● | ● | ● | ● | |
| Processos / threads | ● | ● | ● | | | | ● | | ● |
| Tempo de boot / adoção | | | | ● | | | | | |
| Latência por etapa | | | | | ● | | | | |
| FPS / frame time | | | | | | | | ● | |
| Órfãos após encerrar | | | | | | | | | ● |

---

## 6. Gate D-07

| Condição (C0) | Resultado |
|---|---|
| `privateMB` mediana **> 350 MiB** | **reabrir A/B/C** |
| `processesNoCrashpad` mediana **> 6** | **reabrir A/B/C** |
| ambos dentro | manter Electron; reavaliar só com gatilho novo |
| não medido | **gate fechado por ausência de dado** — não se decide nada |

**Por que excluir o crashpad:** um Electron de uma janela já tem main + GPU + utility + renderer +
crashpad ≈ 5. Contar o crashpad faria o limite de 6 disparar por composição, não por peso. A
contagem completa continua sendo publicada ao lado.

---

## 7. Modelo de evidência

Cada execução gera um arquivo por cenário, com cabeçalho obrigatório:

```json
{
  "schema": 1,
  "label": "C0",
  "commit": "<sha>",
  "package": { "path": "LiaSetup-0.12.0-x64.exe", "sha256": "…", "builtAt": "…" },
  "runtime": { "electron": "43.4.1", "chromium": "150.0.7871.224", "node": "24.18.1" },
  "machine": { "cpu": "Ryzen 5 5500", "gpu": "RX 580 8GB", "ramGB": 16, "os": "…", "driver": "…" },
  "display": { "monitors": 2, "dpi": 96, "resolution": "1920x1080" },
  "power": "SCHEME_MIN",
  "protocol": { "warmupS": 60, "windowS": 180, "reps": 5, "sampleS": 5 },
  "results": { "privateMB": { "median": null, "p95": null }, "processes": null, "processesNoCrashpad": null, "cpuPctMachine": null },
  "notes": "o que fugiu do protocolo — sempre declarado"
}
```

**Regra de publicação:** um número sem esse cabeçalho não entra em relatório. Um cenário sem as 5
repetições é declarado "parcial", nunca "MEDIDO".

---

## 8. Critérios de aceitação do protocolo

| # | Critério | Status |
|---|---|---|
| 1 | C0–C8 cobrem todas as medidas pedidas | **PASS** (§5) |
| 2 | C0 e contagem de processos definidos sem ambiguidade | **PASS** (§6) |
| 3 | Separação MEDIDO/ESTIMADO/HIPÓTESE/N/A | **PASS** (§1) |
| 4 | Nenhum dado de Linux usado como benchmark | **PASS** |
| 5 | Reabertura marcada N/A enquanto D-04 não existir | **PASS** (§4.2) |
| 6 | Execução reproduzível por terceiro | **PASS** (§3–§4) |

---

## Anexo A — Mapeamento com a auditoria §9.4

| Auditoria (16/11) | Este protocolo |
|---|---|
| C0 Launcher sozinho | **C0** (idêntico) |
| C1 Launcher + Runtime ociosos | **C2** |
| C2 Runtime ativo (avatar) | **C5** (animação ativa) + **C1** (repouso) |
| C3 conversa + TTS | **C4** |
| C4 jogo em primeiro plano | **C7** |
| C5 encerrar/reabrir | **C8** + **C3** (reabertura) |
| — | **C6** processos (novo, exigido por D-07) |

A numeração deste documento é a canônica a partir de 16/11.
