# Bancada STT — primeira execução real

Transcreve **no máximo 10 amostras locais** com **faster-whisper small**, em
**CPU**, **int8**, **português (`pt`)**, e grava um JSON que pode virar evidência
do catálogo de capacidades.

Este diretório executa o que o documento 08 da série
`docs/research/lia-capability-catalog/` especificou. É pequeno de propósito.

> **Nada aqui foi executado em Windows, PowerShell 5.1 ou na RX 580.** O que
> existe é código revisado, testes em Linux e instruções verificáveis. O primeiro
> resultado real é o que o usuário produz.

## Primeira execução — comandos copiáveis

Pré-requisito: **Python 3.12 x64**. Com o Python Install Manager do Windows
(`py.exe`), o comando é:

```powershell
py install 3.12
py -3.12 --version
```

Sem o install manager, instale de python.org marcando "Add python.exe to PATH".

```powershell
cd <raiz-do-repo>\tools\stt-bench

.\run-stt-bench.bat -Setup
.\run-stt-bench.bat -Doctor
```

O launcher **testa cada candidato** (`py -3.12`, `py -3`, `python.exe`, `.venv`)
e usa o primeiro que executa e informa 3.12+. Se nenhum servir, ele diz o que
fazer em vez de falhar com mensagem genérica.

Grave **uma** amostra de 10–20 s em `samples\first-run-01.wav` (fala clara, sem
música). Se preferir `.m4a` do Gravador de Voz do Windows, troque o campo
`audio` do manifesto para o nome do arquivo — o PyAV decodifica.

```powershell
# 1. valida o manifesto SEM executar modelo
.\run-stt-bench.bat -Manifest .\samples.first-run.json -SamplesDir .\samples -DryRun

# 2. baixa os pesos UMA vez (etapa explícita: ~486 MB)
.\run-stt-bench.bat -Manifest .\samples.first-run.json -SamplesDir .\samples -AllowModelDownload
```

O JSON sai em `out\stt-bench-<UTC>-windows-reference-machine.json`.

**Resultado esperado da primeira execução:** `status: completed`,
`verdict: inconclusive`, com o motivo `amostras insuficientes: 1 < 5`. Isso é
**correto**: uma amostra prova o fluxo e produz os primeiros números, mas não
valida o modelo. Nenhum modelo é promovido por ela.

Para a execução completa (5–10 amostras), use `samples.example.json` como molde.

## O que mede

| Medida | Como | Campo |
|---|---|---|
| download dos pesos | cronômetro só em volta do `download_model` | `summary.downloadMs` |
| carga do modelo | cronômetro em volta de `WhisperModel(...)` | `summary.modelLoadMs` |
| tempo por amostra | cronômetro em volta do consumo dos segmentos | `samples[].transcribeMs` |
| RTF | tempo ÷ duração do áudio | `samples[].rtf`, `summary.rtfMedian` |
| RAM antes / após carga / final / pico | `VmHWM` (Linux) ou `PeakWorkingSetSize` (Windows) | `summary.memory*`, `summary.peakRssMib` |
| qualidade | WER e CER contra transcrição de referência | `summary.corpusWer`, `summary.corpusCer` |

**Unidades:** `peakRssMib` e `totalRamGib` são **binários** (1024², 1024³).
`dataset.totalMb` é decimal (10⁶). A distinção está no nome de propósito: antes,
`peakRssMb` usava 10⁶ e `totalRamGb` usava 1024³ sob nomes que pareciam iguais.

WER é **de corpus** (total de edições ÷ total de palavras de referência), não
média de WERs. WER e CER usam a **mesma normalização**: minúsculas, pontuação
removida, hífen como separador, acentos preservados. `strip_accents` só existe
na métrica secundária.

## O que não mede

- GPU. É CPU pura, `int8`. A RX 580 não entra aqui — ela é tema da bancada de LLM.
- Qualidade percebida por humano.
- Desempenho da Lia em produção (Electron, IPC, microfone, VAD do app).
- Windows: **nada foi executado lá**.

## Requisitos

- Windows 10/11 x64.
- Python **3.12 x64** (as versões fixadas exigem 3.12; o launcher aborta antes
  de o `pip` falhar no meio).
- ~600 MB livres: venv (~200 MB) + pesos (~486 MB) + áudio.
- Nenhum ffmpeg: o PyAV traz o FFmpeg embutido.
- **Sem GPU.** Não instale CUDA nem ROCm.

## Comandos, um por um

| Passo | Comando | O que acontece |
|---|---|---|
| 1 | `cd <raiz>\tools\stt-bench` | entra na ferramenta |
| 2 | `.\run-stt-bench.bat -Setup` | cria `.venv` e instala as 7 versões fixadas; **não baixa pesos** |
| 3 | `.\run-stt-bench.bat -Doctor` | JSON com máquina, dependências, cache, hash e disco; não executa modelo |
| 4 | gravar `samples\first-run-01.wav` | áudio próprio, 10–20 s |
| 5 | `.\run-stt-bench.bat -Manifest .\samples.first-run.json -SamplesDir .\samples -DryRun` | valida arquivos e limites; não baixa nada |
| 6 | `.\run-stt-bench.bat -Manifest .\samples.first-run.json -SamplesDir .\samples -AllowModelDownload` | baixa ~486 MB, confere o sha256 e roda |
| 7 | abrir `out\*.json` | resultado |

O `.bat` existe só para não depender da política de execução: ele chama o
PowerShell com `-ExecutionPolicy Bypass` **naquela invocação**, sem alterar nada
na máquina.

## Pesos: revisão fixada, hash e arquivos auxiliares

| Arquivo | Bytes | SHA-256 |
|---|---|---|
| `model.bin` | 483.546.902 | `3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671` |
| `tokenizer.json` | 2.203.239 | — |
| `vocabulary.txt` | 459.861 | — |
| `config.json` | 2.370 | — |
| **total** | **486.212.372** | |

- Modelo: `Systran/faster-whisper-small`
- Revisão: `536b0662742c02347bc0e980a01041f333bce120` — passada ao
  `WhisperModel(revision=...)` e usada para localizar o snapshot
- Licença: **MIT**

O inspetor **não aceita outro snapshot** quando a revisão não está presente:
antes, ele caía para "qualquer snapshot" e podia declarar presente um peso que
não era o fixado. O sha256 do `model.bin` é recalculado a cada execução
(`--no-hash` desliga). Os quatro arquivos são exigidos; `model.bin` sozinho não
carrega.

Se o download for interrompido, o Hugging Face retoma pelo cache
(`blobs/*.incomplete`). O campo `weights.incompleteDownloads` mostra se sobrou
arquivo pela metade.

## Resultado

```json
{
  "status": "completed",
  "environment": "windows-reference-machine",
  "verdict": "inconclusive",
  "summary": {
    "downloadMs": null,
    "modelLoadMs": 0.0,
    "transcribeMsMedian": 0.0,
    "rtfMedian": 0.0,
    "memoryBeforeLoad": { "currentRssBytes": 0, "peakRssBytes": 0, "method": "windows-peak-working-set" },
    "memoryAfterLoad": { "currentRssBytes": 0, "peakRssBytes": 0, "method": "windows-peak-working-set" },
    "memoryAfterLastSample": { "currentRssBytes": 0, "peakRssBytes": 0, "method": "windows-peak-working-set" },
    "peakRssMib": 0.0,
    "corpusWer": 0.0,
    "corpusCer": 0.0
  },
  "catalogPromotion": { "eligible": false, "reason": "veredito 'inconclusive' nao promove" }
}
```

Os zeros são **placeholder**: nenhum número foi medido nesta entrega.

### JSON em caso de erro

Toda falha depois que o caminho de saída é resolvido gera um JSON com
`status: "error"`, `error.stage` (`manifest`, `python`, `weights`, `download`,
`runtime`) e `catalogPromotion.eligible: false`. Um resultado de erro **nunca**
é evidência — o schema força `samples: []` e `eligible: false`.

## Critérios do veredito

| Condição | Efeito |
|---|---|
| < 5 amostras, < 30 s, sem referência ou sem RTF | `inconclusive` — evidência insuficiente vem antes de qualquer decisão |
| WER ≤ 0,15 **e** RTF ≤ 1,0, com evidência suficiente | `validated` |
| WER entre 0,15 e 0,30, ou RTF > 1,0 | `inconclusive` |
| WER > 0,30 ou pico de RAM > 4096 MiB | `rejected` |

**Promoção** (`catalogPromotion.eligible`) só é `true` com
`environment == "windows-reference-machine"` **e** `verdict == "validated"`.

O ambiente é **detectado** por três sinais (Windows, CPU contendo "Ryzen 5
5500", RAM entre 14 e 18 GiB). `--machine-id` pode **rebaixar** o rótulo, nunca
promover: pedir `windows-reference-machine` sem os fatos aborta com erro.

## Códigos de saída

| Código | Significado |
|---|---|
| 0 | executou; veja o JSON |
| 1 | entrada inválida; JSON de erro `manifest` |
| 2 | argumento inválido, Python < 3.12 ou ambiente forjado |
| 3 | pesos ausentes/divergentes; repita com `-AllowModelDownload` |
| 4 | veredito `rejected` |
| 5 | `-Doctor`: ambiente ainda não está pronto |
| 6 | falha de download, integridade ou runtime; JSON de erro |

## Se algo der errado

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `No runtime installed that matches 3.12` | `py.exe` existe, mas o 3.12 não | `py install 3.12` e repita `-Setup` |
| `Python X e anterior ao exigido (3.12)` | Python < 3.12 escolhido | `py install 3.12`; se houver `.venv` antigo, apague a pasta |
| `.venv existente foi criado com outro Python` | venv de 3.11 | apague `tools\stt-bench\.venv` e repita `-Setup` |
| `pip install falhou` | idem | idem |
| `pesos ausentes ou divergentes` | cache vazio ou hash errado | `-AllowModelDownload`; se persistir, apague `models--Systran--faster-whisper-small` do cache |
| `sha256 do model.bin diverge` | download corrompido ou cache adulterado | apague a pasta do modelo e baixe de novo |
| WER altíssimo com áudio bom | referência com números/pontuação escritos diferentes do falado | compare `hypothesis` e `reference` no JSON |
| RTF > 1 | CPU limitada ou `--beam-size` alto | registre como está; não "corrija" aumentando timeout |

## Arquivos

| Arquivo | Papel |
|---|---|
| `stt_bench.py` | medição, WER/CER, integridade, ambiente, JSON |
| `run-stt-bench.ps1` | entrada Windows (PowerShell 5.1, ASCII) |
| `run-stt-bench.bat` | launcher que evita bloqueio de política |
| `requirements-stt-bench.txt` | dependências fixadas |
| `samples.first-run.json` | manifesto de **1 amostra** para a primeira execução |
| `samples.example.json` | manifesto completo (5 amostras) |
| `results.schema.json` | contrato do JSON, incluindo erro |
| `tests/` | 62 testes sem rede e sem pesos, com stub do faster-whisper |
| `REVIEW-2026-11-11.md` | revisão independente e defeitos corrigidos |

## Testes da própria bancada

```powershell
python -m unittest discover -s tests -v
```

Não requer modelo nem rede. Com `jsonschema` instalado, valida também os JSONs
de sucesso e de erro contra `results.schema.json`.

## Limitações ainda não verificadas

- **PowerShell 5.1** nunca executou este script. Revisão manual e léxica.
- **`pip install` em Windows** não foi executado; as wheels foram verificadas
  como existentes na PyPI para cp312/win_amd64.
- **Nenhum número de WER, RTF ou RAM** foi medido.
- WER penaliza números escritos por extenso vs. dígitos ("4237" ≠ "quatro mil
  duzentos e trinta e sete"). É limitação conhecida do conjunto, não bug.
- O resultado vale para a máquina medida; não é transferível.
