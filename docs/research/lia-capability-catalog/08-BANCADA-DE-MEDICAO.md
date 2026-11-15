# 8. Bancada de medição — como validar sem baixar 175 modelos

**Data:** 11/11/2026 · **Base:** `29999aff`

> Esta bancada **não executa nada**. É o instrumento que a próxima fase usa.
> Nenhum peso é baixado, nenhuma API é chamada. O que existe aqui são fichas,
> comandos e critérios — para que o primeiro número medido seja confiável.

## 8.1 A máquina de referência — e o dado que muda tudo

O repositório já fixa o perfil de compatibilidade:

> **Ryzen 5 5500 · AMD RX 580 8 GB · 16 GB RAM**
> — `docs/architecture/LIA-ARCHITECTURE.md` §249 e `docs/project/CURRENT-STATE.md` §782

E um documento anterior do próprio projeto já registrou a consequência:

> "Sobre a RX 580: GCN4 (**gfx803**) está abaixo do piso do ROCm/PyTorch moderno,
> então **GPU local está fora** para qualquer uma."
> — `docs/product/M1-PERSONAL-VOICE-ARCHITECTURE.md` §113

**Portanto, para a máquina de referência:**

| Backend | Situação na RX 580 | Consequência |
|---|---|---|
| CUDA | **impossível** | — |
| ROCm | **fora** (gfx803 abaixo do piso) | não planejar |
| HIP/PyTorch GPU | **fora** | exclui F5-TTS, CosyVoice em GPU, Demucs GPU, a maioria dos TTS PyTorch |
| **Vulkan** | **caminho viável** para llama.cpp | sujeito às issues de §8.5 |
| DirectML | viável em ONNX Runtime no Windows | testar com Kokoro/Piper/PaddleOCR |
| **CPU** | **sempre viável** | o piso real de todo perfil |

**Consequência de produto:** na máquina de referência, o perfil `local-private`
significa **CPU + Vulkan**, não "GPU". Qualquer promessa de "roda local na GPU"
precisa passar por Vulkan ou DirectML — nunca por ROCm.

> Isso não invalida os outros perfis: uma RTX 4090 continua sendo `S` em CUDA. O
> catálogo precisa das duas colunas. Mas a **máquina em que testamos** é a RX 580,
> e é ela que aparece na ficha.

## 8.2 Ficha de execução (obrigatória, sem exceção)

Um resultado sem esta ficha **não entra** em `validation.evidence`.

```yaml
# ficha v1 — copiar para docs/research/lia-capability-catalog/evidence/<id>.yaml
id: speech.stt.faster-whisper          # id do catálogo
capability: speech.stt
date: 2026-11-11T00:00:00Z

machine:
  id: ref-rx580                       # identificador da máquina, não do modelo
  cpu: AMD Ryzen 5 5500
  gpu: AMD RX 580 8 GB
  gpu_arch: gfx803                    # GCN4 — sem ROCm
  ram_gb: 16
  os: Windows 11 26200
  driver: ""                           # versão exata do driver AMD

runtime:
  id: llama.cpp
  version: ""                          # tag/commit exato
  backend: vulkan                      # cpu | vulkan | directml | cuda | rocm
  flags: ""                            # -ngl, -b, -ub, -c, --no-mmap...
  build: ""                            # cmake flags ou release baixada

weights:
  model_id: ""
  revision: ""                         # commit/tag do repo de pesos
  file: ""                             # nome do arquivo
  quantization: Q4_K_M
  size_bytes: 0
  sha256: ""                           # do arquivo baixado

measurement:
  warmup_runs: 3
  runs: 5
  first_token_ms: []                   # lista, não média
  tokens_per_second: []
  peak_ram_mb: 0
  peak_vram_mb: 0
  cpu_percent_peak: 0
  exit_code: 0

quality:                               # depende da capacidade
  metric: ""                           # wer | mos | grounding_iou | json_valid_rate
  value: 0
  dataset: ""                          # qual conjunto, quantos itens

notes: ""
verdict: ""                            # validated | rejected | inconclusive
```

**Regras da ficha:**

1. Listas, não médias. Média esconde o pior caso, que é o que o usuário sente.
2. `sha256` do arquivo baixado, não do repositório.
3. `version` do runtime **e** `revision` dos pesos — sem os dois, não reproduz.
4. `driver` faz parte do resultado em Vulkan. Driver diferente, resultado diferente.
5. `verdict: inconclusive` é resultado legítimo e deve ser registrado.

## 8.3 Ordem de execução — 5 candidatos, não 175

| # | Capacidade | Candidato A | Candidato B | Métrica | Critério de aceite |
|---|---|---|---|---|---|
| 1 | `speech.stt` | faster-whisper large-v3-turbo (int8 CPU) | sherpa-onnx streaming | WER PT-BR, latência parcial | WER < 15 % limpo; < 35 % ruído |
| 2 | `speech.tts` | Kokoro `pf_dora` / `pm_alex` / `pm_santa` | CosyVoice 2 (CPU) | RTF, MOS próprio, pronúncia | RTF < 1; nenhuma falha em 30/30 |
| 3 | `chat.conversation` | Qwen3.5-4B **instruct** Q4_K_M | Qwen3.5-9B Q4_K_M | tok/s, 1º token, tool calling | resposta utilizável em < 3 s no 1º token |
| 4 | `memory.embed` | BGE-M3 + sqlite-vec | memória lexical atual | precisão@4, falsas lembranças | +20 % de acerto sem inventar memória |
| 5 | `vision.grounding` | Qwen3-VL-4B Q4 | Qwen3-VL-8B Q4 | grounding@0,5 em screenshots da Lia | > 80 % |

`computer.control` **não está nesta lista**. Entra só depois dos cinco, com
ambiente controlado e aprovação humana por ação.

### Por que nesta ordem

- **STT primeiro** porque é o que mais afeta a percepção de qualidade da Lia e o
  mais barato de medir (WER é objetivo).
- **TTS depois** porque RTF em CPU decide se voz local é viável na máquina de
  referência.
- **LLM em terceiro** porque 4B e 9B Q4 são o que roda; 27B fica para quando
  houver GPU de verdade.
- **Memória em quarto** porque o ganho é barato e não depende de GPU.
- **Visão por último** porque exige captura de tela funcionando.

### O que **não** entra na primeira rodada

Qwen3.8-27B (16,56 GB de pesos), Llama 4, DeepSeek-V3, FLUX, Wan, CosyVoice em
GPU, qualquer modelo que exija ROCm. Testá-los na RX 580 mede *offload*, não o
modelo.

## 8.4 Conjunto de teste PT-BR

Precisa ser nosso, versionado e pequeno o bastante para rodar sempre.

| Capacidade | Conjunto | Tamanho | Composição |
|---|---|---|---|
| STT | `ptbr-stt-v1` | ~20 min | 5 falantes × 4 condições (limpo, ruído, telefone, sotaque) |
| STT | `ptbr-stt-hard-v1` | ~5 min | nomes próprios, siglas, números, valores monetários, datas |
| TTS | `ptbr-tts-v1` | 30 frases | números, siglas, nomes, emoção (neutro, alegre, sério), pergunta |
| TTS clonagem | `ptbr-clone-v1` | 5 vozes sintéticas | consentimento registrado por voz |
| LLM | `ptbr-chat-v1` | 50 prompts | conversa, instrução, recusa, JSON, tool calling |
| Memória | `ptbr-memory-v1` | 100 fatos + 30 negativas | inclui perguntas cuja resposta correta é "não sei" |
| Visão | `lia-screens-v1` | 100 imagens | telas reais do app, com e sem overlay |

**Os 30 casos negativos de memória são o ponto mais importante do conjunto.** É
fácil medir acerto; o que protege o usuário é medir **invenção**.

## 8.5 Riscos conhecidos da bancada (Vulkan e AMD)

Registrados para que o teste não gaste uma semana redescobrindo:

| Risco | Evidência | Mitigação na ficha |
|---|---|---|
| Kernels SSM ausentes → modelo híbrido cai para CPU | llama.cpp [#19957](https://github.com/ggml-org/llama.cpp/issues/19957) | registrar `-ngl` efetivo e se houve fallback |
| Saída corrompida em batch específico | llama.cpp [#27237](https://github.com/ggml-org/llama.cpp/issues/27237) (512 vs 1024) | testar `-b`/`-ub` 256, 512, 1024 |
| Travamento do anel da GPU em gfx10 (Navi 10) | llama.cpp [#28807](https://github.com/ggml-org/llama.cpp/issues/28807), [#28808](https://github.com/ggml-org/llama.cpp/issues/28808) | timeout e watchdog no script |
| Crash ao offloadar camadas repetidas | llama.cpp [#26945](https://github.com/ggml-org/llama.cpp/issues/26945) | reduzir `-ngl` e repetir |
| CPU também tem defeito na família qwen35 | llama.cpp [#30906](https://github.com/ggml-org/llama.cpp/issues/30906) (aberta) | comparar CPU vs Vulkan no mesmo commit |

**Regra:** um resultado de Vulkan sem a versão do llama.cpp e do driver não é
comparável com nada.

## 8.6 Script mínimo

**O primeiro já existe:** [`tools/stt-bench/`](../../../tools/stt-bench/README.md)
— faster-whisper small, CPU, int8, `pt`, até 10 amostras e 100 MB, com JSON de
resultado validado por schema. Ele implementa o nível 1 desta bancada (STT) e
serve de molde para os demais:

```
tools/stt-bench/
  stt_bench.py                # mede, calcula WER/CER, decide o veredito
  run-stt-bench.ps1 / .bat    # entrada Windows, sem baixar pesos sem permissão
  requirements-stt-bench.txt  # versões fixadas
  samples.example.json        # manifesto de amostras (áudio fica fora do Git)
  results.schema.json         # contrato do JSON de saída
  tests/                      # 62 testes sem rede e sem pesos
```

Os demais ainda são especificação:

```
tools/bench/
  tts.mjs          # mede RTF e salva amostras para escuta
  llm.mjs          # mede tok/s e valida JSON/tool call
  memory.mjs       # precisão@k e taxa de invenção
  vision.mjs       # grounding@0,5 em lia-screens-v1
  report.mjs       # agrega em tabela markdown, marca inconclusive
```

Regras do script, para não repetir erros conhecidos do projeto:

- sem `PIPESTATUS` mascarando falha — cada etapa devolve código;
- `skip` nunca é "aprovado";
- timeout é resultado, não exceção;
- nada de credencial real;
- roda offline quando o candidato é local.

## 8.7 O que a bancada **não** resolve

| Pergunta | Por que não |
|---|---|
| "Qual modelo é melhor para o usuário X?" | depende do hardware dele; a bancada mede 1 máquina |
| "Quanto custa por mês em nuvem?" | exige preço oficial (não coletado) e perfil de uso |
| "A voz clonada é boa?" | subjetivo; precisa painel humano, não só MOS interno |
| "Funciona em RX 6600 / RTX 3060?" | precisa de outra máquina; o schema suporta, a bancada não cobre |

## 8.8 Próximo passo concreto

1. ~~Criar `evidence/` e a ficha modelo.~~ Feito: a bancada de STT gera o JSON
   no formato de evidência em `tools/stt-bench/`.
2. **Rodar na máquina de referência**, seguindo
   [`tools/stt-bench/README.md`](../../../tools/stt-bench/README.md): `-Setup`,
   `-Doctor`, `-DryRun`, depois `-AllowModelDownload`.
3. Salvar o JSON em `docs/research/lia-capability-catalog/evidence/` **somente
   se** `catalogPromotion.eligible` for `true`.
4. Só então repetir para TTS.

O primeiro resultado honesto vale mais que os 175 registros.

## 8.9 O que a primeira bancada ainda não prova

| Afirmação | Estado |
|---|---|
| "faster-whisper small roda em Windows" | **não verificado** — escrito para Windows, executado só em Linux |
| "a revisão dos pesos é a fixada" | **verificado no código** — `revision` passada ao `WhisperModel` e snapshot exigido exato |
| "o hash do model.bin confere" | **verificado por desenho** — sha256 recalculado; o primeiro valor real é da máquina do usuário |
| "as versões fixadas instalam" | **parcial** — as wheels existem para cp312/win_amd64; a instalação não foi feita aqui |
| "WER em PT-BR é X" | **não medido** — nenhuma amostra de áudio foi usada |
| "cabe em 16 GB de RAM" | **não medido** — a bancada mede; a expectativa não é evidência |
| "a RX 580 ajuda" | **não se aplica** — este teste é CPU pura, de propósito |

Nenhum desses vira `validated` por ausência de falha.
