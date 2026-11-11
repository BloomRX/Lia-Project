# Bancada STT — primeiro experimento executável

Transcreve **no máximo 10 amostras locais** com **faster-whisper small**, em
**CPU**, **int8**, **português (`pt`)**, e grava um JSON que pode virar evidência
do catálogo de capacidades (`docs/research/lia-capability-catalog/`).

Este diretório é a **execução** do que o documento 08 daquela série especificou.
Ele é pequeno de propósito: um script Python, um launcher PowerShell, um
manifesto de amostras e um schema.

## O que esta bancada mede

| Medida | Como | Campo no JSON |
|---|---|---|
| tempo de carga do modelo | `perf_counter` em volta de `WhisperModel(...)` | `summary.modelLoadMs` |
| tempo por amostra | `perf_counter` em volta do consumo dos segmentos | `samples[].transcribeMs` |
| RTF (tempo / duração do áudio) | por amostra e mediana | `samples[].rtf`, `summary.rtfMedian` |
| RAM de pico do processo | `VmHWM` (Linux) ou `PeakWorkingSetSize` (Windows) | `summary.peakRssMb` |
| qualidade | WER e CER contra transcrição de referência | `summary.corpusWer`, `summary.corpusCer` |

WER é **de corpus** (total de edições ÷ total de palavras de referência), não
média de WERs. Média de razões superestima amostras curtas.

## O que esta bancada **não** mede

- GPU. É CPU pura, `compute_type=int8`. A RX 580 não entra aqui — ela é tema da
  bancada de LLM, não de STT.
- Qualidade percebida por humano. WER não mede inteligibilidade nem pontuação.
- Desempenho da Lia em produção (Electron, IPC, microfone, VAD do app).
- Qualquer coisa em Windows: **nada neste diretório foi executado em Windows**.
  O que existe é instrução verificável, não resultado.

## Requisitos

- Windows 10/11 x64.
- Python **3.12 x64** com "Add to PATH" (3.10+ deve funcionar; 3.12 é o alvo
  para o qual existem as wheels fixadas).
- ~600 MB livres em disco para o ambiente virtual + pesos.
- Nenhum ffmpeg: o PyAV traz o FFmpeg embutido.
- **Sem GPU.** Não instale CUDA nem ROCm para este teste.

## Passo a passo

### 1. Entrar na pasta

```powershell
cd <raiz-do-repo>\tools\stt-bench
```

### 2. Criar o ambiente e instalar dependências fixadas

```powershell
.\run-stt-bench.bat -Setup
```

O `.bat` existe só para não depender da política de execução: ele chama o
PowerShell com `-ExecutionPolicy Bypass` **naquela invocação**, sem alterar
nada na máquina. Se preferir, chame o `.ps1` direto.

Isso cria `.venv\` e instala `requirements-stt-bench.txt`. **Não baixa pesos.**

### 3. Conferir o ambiente

```powershell
.\run-stt-bench.bat -Doctor
```

Saída esperada: JSON com `"ready": false` enquanto faltar o modelo, e os fatos
da máquina (`machine`), as dependências instaladas (`runtime.dependencies`) e o
estado do cache (`weights`). O campo `environment` será:

- `windows-reference-machine` **somente** se o CPU declarar "Ryzen 5 5500" **e**
  houver ~16 GB de RAM;
- `windows-other` em qualquer outro Windows.

O rótulo é detectado, não escolhido. `-MachineId` só troca o rótulo, nunca os
fatos. Em Linux o padrão é `arena-linux`; se você rodar na sua própria máquina
Linux, use `-MachineId linux-other` para não confundir os registros.

### 4. Preparar as amostras

Copie `samples.example.json` para `samples.json` e coloque os áudios em
`samples\`. O exemplo cita arquivos que **não existem** — ele é um molde, e o
`-DryRun` vai acusar isso de propósito até você fornecer os áudios.

Requisitos de cada amostra:

| Requisito | Valor |
|---|---|
| formato | `.wav`, `.mp3`, `.flac`, `.m4a`, `.ogg`, `.opus`, `.webm` |
| quantidade | 5 a 10 (menos que 5 nunca valida) |
| tamanho total | até 100 MB (o script recusa acima) |
| referência | transcrição literal do que foi falado |
| licença | própria (gravada por você) ou domínio público/CC0 |

**Não use áudio de terceiros sem licença clara.** Se a gravação tiver outras
pessoas, registre o consentimento. O campo `license` do manifesto é gravado no
resultado e não é verificado pelo script — ele é uma declaração do operador.

### 5. Validar sem executar

```powershell
.\run-stt-bench.bat -Manifest .\samples.json -SamplesDir .\samples -DryRun
```

Isso confere arquivos, limites e ambiente, imprime o plano e **não importa o
modelo nem baixa nada**. Se houver erro, corrija antes de seguir.

### 6. Baixar os pesos (etapa explícita)

O download é **um só** e é seu:

| Arquivo | Bytes | Tamanho |
|---|---|---|
| `model.bin` | 483.546.902 | ~483,5 MB |
| `tokenizer.json` | 2.203.239 | ~2,2 MB |
| `vocabulary.txt` | 459.861 | ~0,46 MB |
| `config.json` | 2.370 | ~2,4 KB |
| **total** | **~486,2 MB** | |

- Modelo: `Systran/faster-whisper-small`
- Revisão fixada: `536b0662742c02347bc0e980a01041f333bce120`
- Licença: **MIT**
- SHA-256 do `model.bin` (LFS): `3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671`

Sem `-AllowModelDownload`, o script **para** e explica. Com a chave, o Hugging
Face é o único destino de rede:

```powershell
.\run-stt-bench.bat -Manifest .\samples.json -SamplesDir .\samples `
    -AllowModelDownload -OutputDir "$env:USERPROFILE\lia-evidence\stt"
```

Nada de áudio é enviado a lugar algum: o `faster-whisper` roda local e o único
tráfego é o download dos pesos.

### 7. Ler o resultado

O JSON é gravado em `out\` (ou no `-OutputDir`). Os campos que importam:

```json
{
  "environment": "windows-reference-machine",
  "verdict": "validated",
  "summary": {
    "modelLoadMs": 0.0,
    "transcribeMsMedian": 0.0,
    "rtfMedian": 0.0,
    "peakRssMb": 0.0,
    "corpusWer": 0.0,
    "corpusCer": 0.0
  },
  "catalogPromotion": { "eligible": true, "reason": "..." }
}
```

Os zeros acima são **placeholder do exemplo**: não há número medido nesta
entrega. O primeiro resultado real é o que o usuário produz.

### 8. Repetir

Rodar de novo **sobrescreve**? Não: `--output` é explícito e o nome padrão
inclui data/hora UTC, então execuções coexistem. Para comparar, rode duas vezes
e compare `summary.*` — a variância entre execuções é parte do resultado.

## Critérios objetivos do veredito

| Condição | Efeito |
|---|---|
| < 5 amostras | `inconclusive` |
| < 30 s de áudio total | `inconclusive` |
| sem referência | `inconclusive` |
| WER de corpus ≤ 0,15 **e** RTF ≤ 1,0 | `validated` |
| WER entre 0,15 e 0,30, ou RTF > 1,0 | `inconclusive` |
| WER > 0,30 ou pico de RAM > 4096 MB | `rejected` |

**Promoção ao catálogo** (`catalogPromotion.eligible`) só é `true` quando:

1. `environment == "windows-reference-machine"`, **e**
2. `verdict == "validated"`.

Resultado em `arena-linux` pode ser `validated` para Linux e **nunca** promove.
Isso é o que impede confundir medição de sandbox com a RX 580 do usuário.

## Códigos de saída

| Código | Significado |
|---|---|
| 0 | executou; veja o JSON |
| 1 | entrada inválida; nada executado |
| 2 | argumento inválido (uso do script) |
| 3 | pesos ausentes; repita com `-AllowModelDownload` |
| 4 | veredito `rejected` |
| 5 | ambiente incompleto (rode `-Setup`) |

## Se algo der errado

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `python nao encontrado` | Python fora do PATH | instale 3.12 x64 marcando "Add to PATH" |
| `pip install falhou` / `requires-python` | Python < 3.12: `av==19` e `numpy==2.5` não instalam | instale Python 3.12 x64 e apague `.venv` |
| `python X e anterior ao exigido` | o launcher detectou < 3.12 | idem |
| `no module named faster_whisper` | rodou fora do venv | use `run-stt-bench.bat`, que prefere `.venv\Scripts\python.exe` |
| `pesos ausentes` | cache vazio | repita com `-AllowModelDownload` |
| WER altíssimo com áudio bom | referência com pontuação/números escritos de forma diferente do falado | compare `hypothesis` e `reference` da amostra no JSON |
| RTF > 1 | CPU limitada ou `--beam-size` alto | registre como está; não "corrija" aumentando timeout |

## Arquivos

| Arquivo | Papel |
|---|---|
| `stt_bench.py` | medição, WER/CER, detecção de ambiente, JSON |
| `run-stt-bench.ps1` | entrada Windows (PowerShell 5.1, ASCII) |
| `run-stt-bench.bat` | launcher que evita bloqueio de política de execução |
| `requirements-stt-bench.txt` | dependências fixadas |
| `samples.example.json` | modelo de manifesto |
| `results.schema.json` | schema do JSON de saída |
| `tests/` | 33 testes sem rede, sem pesos, com stub do faster-whisper |

## Rodar os testes da própria bancada

```powershell
python -m unittest discover -s tests -v
```

Não requer o modelo, não acessa a rede. Verifica normalização, WER/CER,
detecção de ambiente, limites de 10 amostras/100 MB, veredito e o caminho de
ponta a ponta com um `faster_whisper` falso.

## Limites declarados

- Nada aqui foi executado em Windows. O script foi escrito para PowerShell 5.1
  (sem `?.`, `??`, ternário; ASCII puro), mas **a primeira execução real é do
  usuário**.
- O PowerShell não pôde ser executado no ambiente de preparação (Linux, sem
  `pwsh`). Revisão foi manual e por leitura, não por parser.
- As versões fixadas foram verificadas como **existentes** na PyPI para
  cp312/win_amd64. A instalação **não foi feita aqui**: o ambiente de preparação
  tem Python 3.11 e as versões fixadas exigem 3.12. O que foi verificado é a
  existência das wheels e a resolução declarada pelo próprio faster-whisper
  (`snapshot_download`, estável entre versões do hub).
- O resultado vale para a máquina medida. Não é transferível.
