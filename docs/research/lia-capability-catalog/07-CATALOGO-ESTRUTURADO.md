# 7. Os registros estruturados — rastreabilidade e o que falta

**Data:** 11/11/2026 · **Base:** `29999aff` · **Fonte:** `catalog.data.json`

## 7.1 A resposta curta

> **Revisão 2:** eram **39**. A revisão do Dev mostrou que agrupar Fish Audio e
> esconder a variante `Base` produzia informação errada. Criei **5 registros
> novos** para separar licença por versão e variante — os 39 originais
> **continuam todos**, nenhum foi removido. Total: **44**.

| Grupo | Quantidade | O que significa |
|---|---|---|
| **Catalogados** | **44** (39 originais + 5 da revisão) | têm identificador, capacidade, licença de código e de pesos, fonte e data |
| **Descobertos** | **~131** | aparecem na pesquisa (documento 02), mas **não** têm registro completo |
| **Validados** | **0** | nenhum passou por teste próprio com evidência registrada |

### Os 5 acrescentados pela revisão

| ID | Por que foi separado |
|---|---|
| `speech.tts-clone.f5-tts` | código MIT ≠ pesos CC-BY-NC-4.0 (confirmado) |
| `speech.tts-clone.fishaudio-s2-pro` | Research License com gate "non-commercial use ONLY" |
| `speech.tts-clone.fishaudio-fish-speech-1.5` | CC-BY-NC-SA-4.0 — licença diferente da do s2-pro |
| `speech.tts-clone.fishaudio-code` | Community License, comercial sob US$ 500k de receita |
| `chat.conversation.qwen3.5-4b-base` | variante `base`: não segue instruções, nunca selecionável |

> **A interface futura não deve mostrar os 175 como opções instaláveis.** Um
> modelo descoberto não é compatível, executável nem seguro por existir numa
> tabela. O grupo de descobertos serve para priorizar pesquisa; o de catalogados
> para popular a UI; o de validados, e só ele, para dizer "isto funciona".

## 7.2 Os 44 catalogados, por capacidade

| Capacidade | # | Identificadores |
|---|---|---|
| `chat.conversation` | 9 | `qwen3.5-4b`, `qwen3.5-9b`, `qwen3.5-4b-base`, `gemma-3-12b`, `gemma-3-270m`, `runtime.llama-cpp`, `runtime.ollama`, `provider.groq`, `provider.openrouter` |
| `speech.tts` | 3 | `kokoro-82m`, `piper`, `provider.elevenlabs` |
| `speech.tts-clone` | 7 | `cosyvoice2`, `xtts-v2`, `reference.voicestudio`, `f5-tts`, `fishaudio-s2-pro`, `fishaudio-fish-speech-1.5`, `fishaudio-code` |
| `speech.stt` | 2 | `faster-whisper`, `sherpa-onnx` |
| `speech.realtime` | 3 | `qwen3-omni`, `moshi`, `reference.shizuku-duplex` |
| `vision.understand` | 2 | `qwen3-vl-8b`, `florence-2` |
| `vision.ocr` | 1 | `paddleocr` |
| `vision.grounding` | 1 | `ui-tars` |
| `memory.embed` | 1 | `bge-m3` |
| `memory.retrieve` | 1 | `sqlite-vec` |
| `chat.reasoning` | 1 | `qwen3.8-27b` |
| `chat.structured-output` | 1 | `outlines` |
| `agents.orchestrate` | 2 | `lia-native`, `promptfoo` |
| `computer.control` | 2 | `playwright`, `skyvern` |
| `image.generate` | 1 | `flux1-schnell` |
| `image.edit` | 1 | `comfyui` |
| `video.generate` | 1 | `wan2.2` |
| `video.lipsync` | 1 | `musetalk` |
| `audio.separate` | 1 | `demucs` |
| `audio.diarize` | 1 | `pyannote` |
| `motion.pose` | 1 | `mediapipe` |
| `safety.classify` | 1 | `llama-guard` |
| **Total** | **44** | |

### Distribuição por estado de ciclo de vida

| Estado | # | Quais |
|---|---|---|
| `in-use` | 3 | Kokoro (engine registrada na Lia), Groq e OpenRouter (já curados no Main) |
| `catalogued` | 41 | todo o resto |

### Distribuição por bloqueio

| Bloqueio | # | Quais |
|---|---|---|
| `unverified` | 29 | nenhum teste próprio |
| `license-pending` | 9 | XTTS-v2, Skyvern, ComfyUI, MuseTalk, Shizuku, F5-TTS, Fish S2-Pro, Fish 1.5, Fish código* |
| `not-a-chat-model` | 1 | `qwen3.5-4b-base` — pré-treinado, nunca conversacional |
| `deprecated` | 3 | Piper, UI-TARS, Demucs |
| `unavailable` | 1 | Shizuku (sem pesos) |

## 7.3 Os ~131 descobertos — o que são e por que não têm registro

São os candidatos que aparecem no documento 02 mas **não** foram promovidos. Três
motivos, sempre um deles:

| Motivo | Exemplo | O que falta para catalogar |
|---|---|---|
| Licença dos pesos não confirmada | modelos PT-BR (Sabiá, Tucano, Amália), InternVL por tamanho, OmniParser | ler LICENSE do repositório de pesos |
| Não é modelo nem runtime — é plataforma | WeKnora, Letta, Graphiti, Mem0, Open-LLM-VTuber, VoiceStudio | decidir se entra como `framework` e em que capacidade |
| Pertence a capacidade fora do escopo imediato | Kling, Veo, Sora, Spleeter, MusicGen, RTMPose, LivePortrait | registrar capacidade e licença |

Distribuição aproximada por categoria (do total de ~175 citações):

| Categoria | Citados | Catalogados | Descobertos |
|---|---|---|---|
| A. LLM e raciocínio | 24 | 5 | 19 |
| B. Voz (TTS+STT+duplex) | 30 | 11 | 19 |
| C. Visão | 19 | 3 | 16 |
| D. Percepção de tela | 6 | 1 | 5 |
| E. Controle de computador | 9 | 2 | 7 |
| F. Memória | 19 | 2 | 17 |
| G. Orquestração | 13 | 2 | 11 |
| H. Embeddings/busca | 8 | 2 | 6 |
| I. Imagem | 12 | 2 | 10 |
| J. Vídeo/lip sync | 10 | 2 | 8 |
| K. Áudio | 9 | 2 | 7 |
| L. Movimento | 7 | 1 | 6 |
| M. Segurança | 9 | 1 | 8 |
| Runtimes e providers | (transversal) | 3 | — |
| **Total** | **~175** | **44** | **~131** |

> Os números de "citados" contam entradas de tabela, não modelos únicos: o mesmo
> modelo pode aparecer em duas tabelas. A contagem serve para dimensionar
> trabalho, não como inventário exato.

## 7.4 O que falta normalizar nos 44

Nenhum dos 39 está completo segundo o schema de `03-ESQUEMA-E-DADOS.md` §3.4
(revisado). O que falta, por campo:

| Campo | Quantos têm | Observação |
|---|---|---|
| `id`, `capability`, `kind`, `displayName`, `vendor` | 44/44 | base mínima |
| `licenseScope.code` e `.weights` | 44/44 | separados; `integrationDependency` marca AGPL/GPL |
| `model.modelId` | 17/44 | runtimes, providers e frameworks não têm |
| `model.revision` | **0/44** | **novo campo** — commit/tag exata dos pesos; campo existe e está `null` em todos |
| `weights[]` com `sha256` | **0/44** | **novo campo** — hash do arquivo |
| `weights[].quantization` | 2/44 | só onde eu já sabia a variante |
| `runtime.version` | **0/44** | **novo campo** |
| `runtime.backend` por execução | 44/44 (declarativo) | falta a versão medida |
| `hardwareConstraints` | 24/44 | estimativa, não medição |
| `languages.portugueseBr` | 19/44 | hoje: `declared` ou `unknown` |
| `validation.evidence` | **0/44** | **novo campo** — nenhum teste |
| `lastVerifiedAt` | 44/44 | todos 11/11/2026 |

**Meta da próxima fase:** levar de 0 para **5** registros com `validation.evidence`
preenchido — os cinco da bancada (documento 08), não os 39.

## 7.5 Como um descoberto se torna catalogado

Regra objetiva, para não promover por entusiasmo:

```
descoberto → catalogado  exige:
  1. LICENSE de código lida          → license.code
  2. LICENSE/model card dos pesos lido → license.weights + commercialUse
  3. modelId e revision identificados  → model.revision
  4. ao menos um runtime declarado     → runtime[]
  5. fonte oficial com data            → sources[]

catalogado → installable  exige:
  6. tamanho e hash do arquivo de pesos → weights[].sizeBytes + sha256
  7. hardware mínimo declarado          → hardware

installable → validated  exige:
  8. execução registrada na ficha       → validation.evidence
  9. resultado dentro do critério       → performance.source = "self-measured"
```

Nada pula etapa. Em particular, **não existe caminho de `descoberto` direto para
`validated`**.

## 7.6 Por que 44 e não 175

Porque dos 175:

- **~40** são plataformas, não modelos (WeKnora, Letta, Mem0, ComfyUI…) — exigem
  decisão de arquitetura antes de virarem registro;
- **~30** têm licença de pesos desconhecida — não podem passar de `catalogued`
  mesmo com registro;
- **~60** pertencem a capacidades que a Lia não vai tocar nos próximos ciclos
  (vídeo generativo, música, mocap 3D);
- **~6** estão arquivados ou sem pesos (UI-TARS, Piper, Demucs, Shizuku…).

Os 44 são os que **cruzam** três filtros: capacidade relevante, licença legível e
runtime plausível no parque instalado.

## 7.7 O que o usuário verá na interface (proposta)

| Grupo na UI | Fonte | Pode selecionar? |
|---|---|---|
| "Recomendados" | catalogados + `validated` + `portugueseBr != unknown` | sim |
| "Disponíveis" | catalogados + `installable` | sim, com download explícito |
| "Experimentais" | catalogados + `unverified` | sim, com aviso |
| "Pesquisados, não verificados" | descobertos | **não** — só leitura |
| "Indisponíveis" | `deprecated`/`unavailable`/`license-pending` | não |

O grupo de descobertos é **transparência**, não oferta.
