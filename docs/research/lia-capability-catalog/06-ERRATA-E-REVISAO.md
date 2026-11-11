# 6. Errata e revisão — resposta ponto a ponto

**Data:** 11/11/2026 · **Revisa:** commit `cf1d9ce` · **Base:** `29999aff`

> Esta é a segunda etapa pedida: pequena, específica, sem nova pesquisa
> abrangente. Cada item abaixo foi **verificado na fonte primária** — não aceito
> por concordância, nem descartado por divergência. Onde a revisão estava certa,
> o catálogo muda. Onde estava parcialmente certa, registro a nuance.

## 6.1 Sumário das correções

| # | Ponto | Veredito | Mudança no catálogo |
|---|---|---|---|
| 1 | Fish Speech não é "CC-BY-NC" genérico | **Correto, e mais grave do que eu escrevi** | licença separada por versão: código ≠ pesos antigos ≠ pesos novos |
| 2 | Qwen3.5-4B vs Base | **Correto** | campo `variant` obrigatório; Base nunca apresentado como assistente |
| 3 | Qwen3.8-27B em Vulkan | **Correto** | tamanho real medido; Vulkan rebaixado a `unverified` |
| 4 | Kokoro PT-BR | **Correto** | vozes PT nomeadas; qualidade em PT = não validada |
| 5 | VoiceStudio AGPL | **Parcialmente correto** | "AGPL ≠ proibido comercial"; obrigação depende da forma de integração |
| 6 | 175 vs 39 | **Correto** | documento 07 com rastreabilidade e três grupos |
| 7 | Bancada com RX 580 | **Correto, e o repo tem um dado decisivo** | documento 08 com ficha de execução |
| 8 | Orquestração ≠ modelo | **Correto** | separação explícita no schema (`kind` + `role`) |

---

## 6.2 Fish Audio / Fish Speech — licença em três camadas

**O que eu escrevi:** "código Apache / pesos CC-BY-NC-SA (verificar)" para toda a
família.

**O que é de fato**, verificado em 11/11/2026:

| Camada | Instrumento | Efeito |
|---|---|---|
| **Código** (`fishaudio/fish-speech` LICENSE) | **FISH AUDIO COMMUNITY LICENSE AGREEMENT v1.0**, última atualização **13/out/2026** | uso comercial permitido **enquanto a receita anual < US$ 500.000**; acima disso, licença escrita separada |
| **Pesos antigos** (`fish-speech-1.2/1.4/1.5`, `s1-mini`) | **CC-BY-NC-SA-4.0** (tag do HF) | não comercial, compartilha igual |
| **Pesos novos** (`s2-pro`, `drama-3`) | **`fish-audio-research-license`** (tag `license:other` + `license_name`) | **gate com checkbox "I agree to use this model for non-commercial use ONLY"** |

**Duas nuances que importam para a Lia:**

1. O *código* é mais permissivo do que eu disse — não é NC. É uma licença
   comunitária com teto de receita.
2. Os *pesos novos* são **mais restritivos** do que eu disse — não é "NC com
   dúvida", é NC explícito, aceito em gate.

E um detalhe que muda a leitura de produto: a própria Community License define
que **não** é "Hosted Service" o caso de *"gerar fala para conteúdo que você cria
ou que seu próprio produto gera (por exemplo… **as respostas faladas de um
assistente**)"* e entregar essa fala no seu produto. Ou seja, o uso que a Lia
faria do **código** está explicitamente fora da obrigação de licença de Hosted
Service. Mas os **pesos** que a Lia usaria (s2-pro) continuam não comerciais.

**Conclusão operacional:** Fish Audio sai de `license-pending` genérico e entra
como **três entradas distintas**, cada uma com sua licença. Nenhuma delas é
instalável hoje.

---

## 6.3 Qwen3.5-4B — Base não é Instruct

**O que eu escrevi:** `Qwen/Qwen3.5-4B` como "assistente local padrão".

**Verificação:** existem **dois** repositórios distintos:

| Repositório | Papel | Evidência |
|---|---|---|
| `Qwen/Qwen3.5-4B` | **pós-treinado (instruct/chat)** | `base_model:finetune:Qwen/Qwen3.5-4B-Base`, tag `conversational` |
| `Qwen/Qwen3.5-4B-Base` | **pré-treinado puro** | sem tag `conversational`; é o *base model* do anterior |

Meu registro apontava para o instruct — então **não estava errado no alvo**, mas
estava errado por **omissão**: o schema não tinha campo para dizer qual variante,
e a tabela não distinguia. Um `Base` num catálogo de produto é uma armadilha real:
ele não segue instruções.

**Correção:** `variant` passa a ser **obrigatório** e com semântica:

```json
"variant": { "enum": ["base", "instruct", "reasoning", "coder", "vision", "quantized", "finetuned"] }
```

Regra: `variant = base` **nunca** pode ser `selected` para uma capacidade
conversacional. O validador do catálogo rejeita.

---

## 6.4 Qwen3.8-27B — tamanho real e Vulkan

**O que eu escrevi:** "GPU 16–24 GB → Qwen3.8-27B Q4" e "llama.cpp: cuda, rocm,
vulkan".

**O que o repositório de GGUF mostra** (`unsloth/Qwen3.8-27B-GGUF`, tamanhos de
arquivo, 11/11/2026):

| Variante | Bytes | GB (decimal) |
|---|---|---|
| `UD-Q4_K_S` | 15.358.213.024 | **15,36** |
| `Q4_0` | 16.056.478.688 | **16,06** |
| `UD-Q4_K_M` | 16.564.259.744 | **16,56** |
| `Q8_0` | 29.047.086.048 | 29,05 |
| `UD-IQ2_XXS` | 7.206.043.648 | 7,21 |

A revisão citou ~16,8 GB; o valor exato do Q4_K_M é **16,56 GB**. Não cabe em 8 GB
de VRAM — nem perto. Rodar exigiria *offload* parcial para CPU, com queda forte
de velocidade.

**Sobre Vulkan:** a revisão está certa e o levantamento de issues do `llama.cpp`
mostra o padrão — não é "não funciona", é **sensível a versão e configuração**:

| Issue | Estado | O que mostra |
|---|---|---|
| [#19957](https://github.com/ggml-org/llama.cpp/issues/19957) | fechada | kernels `ggml_ssm_conv`/`ggml_ssm_scan` ausentes no Vulkan → Qwen3.5-35B-A3B **só CPU** |
| [#27237](https://github.com/ggml-org/llama.cpp/issues/27237) | fechada | Qwen3.5-27B (hybrid DeltaNet) **lixo em batch 512**, ok em 1024/4096 |
| [#26945](https://github.com/ggml-org/llama.cpp/issues/26945) | fechada | crash ao offloadar 2+ camadas repetidas com `qwen35moe` |
| [#27556](https://github.com/ggml-org/llama.cpp/issues/27556) | fechada | HIP corrompe Qwen3.5-27B em gfx1151; **Vulkan correto no mesmo commit** |
| [#30906](https://github.com/ggml-org/llama.cpp/issues/30906) | **aberta** (out/2026) | CPU gera lixo na família qwen35 híbrida, **Vulkan correto** |
| [#28807](https://github.com/ggml-org/llama.cpp/issues/28807) / [#28808](https://github.com/ggml-org/llama.cpp/issues/28808) | fechadas | travamento do anel da GPU em **gfx1010 / Navi 10** (classe RX 5700) com SSM |

**Correção:** a matriz deixa de dizer "S" para Vulkan em modelos híbridos. Passa a
`p` com nota obrigatória: *"verificar versão do llama.cpp; ajustar `-ub`/`-b`; testar
em gfx específico"*. Nenhum modelo híbrido vira padrão sem medição.

---

## 6.5 Kokoro e português brasileiro

**O que eu escrevi:** `portugueseBr: "declared"`.

**Verificação:** o repositório `hexgrad/Kokoro-82M` **tem** arquivos de voz
portugueses:

```
voices/pf_dora.pt
voices/pm_alex.pt
voices/pm_santa.pt
```

mas o `cardData.language` declara **`["en"]`**. Ou seja: existem vozes PT, mas o
model card não as declara como suportadas oficialmente.

**Correção:** o estado de PT-BR para Kokoro passa a ser **`unverified`**, não
`declared`. E o registro nomeia as três variantes com um campo `voiceId`, porque
"Kokoro em português" não é uma coisa só — é `pf_dora`, `pm_alex` ou `pm_santa`,
com fonemização diferente conforme o G2P usado.

**Consequência para o plano:** o teste de TTS em PT-BR precisa de uma linha por
voz, não uma linha por modelo.

---

## 6.6 VoiceStudio — AGPL não é proibição comercial

**O que eu escrevi:** "Não recomendado — AGPL-3.0 contaminaria o produto."

**O que a AGPL-3.0 de fato faz** (texto integral confirmado no repositório):

- **Permite** uso comercial, inclusive cobrar pelo software.
- Exige disponibilização do *Corresponding Source* quando há **conveying**
  (distribuir cópias).
- Exige o código da versão modificada quando ela é oferecida por **rede**
  (a cláusula Affero, que a GPL não tem).
- Não impõe nada sobre *executar* o programa ou sobre a saída que ele produz,
  a menos que a saída seja, ela mesma, obra derivada.

**Portanto a decisão depende da forma de integração**, e o catálogo precisa
carregar isso em vez de um veredito binário:

| Forma de integração | Efeito |
|---|---|
| Lia **fala HTTP** com VoiceStudio instalado pelo usuário | Lia não é obra derivada; VoiceStudio permanece separado. Nenhuma obrigação recai sobre o código da Lia |
| Lia **distribui** o binário do VoiceStudio junto | obrigação de fornecer o *Corresponding Source* do VoiceStudio (não do resto da Lia) |
| Lia **incorpora ou modifica** código do VoiceStudio | a obra combinada entra sob AGPL — aí sim contamina |
| Lia **oferece versão modificada por rede** | obrigação Affero de publicar o código da versão em rede |

**Correção:** o campo `copyleft` passa a ter `network`, e a classificação vira
**`integration-dependent`** em vez de "não recomendado". A nota no catálogo diz:
*"AGPL permite uso comercial; a obrigação nasce da distribuição ou da
modificação, não do uso. Decidir pela forma de integração."*

O mesmo raciocínio se aplica a **Skyvern**, **ChatTTS**, **Ultralytics** e
**ComfyUI** — que continuam fora do *embarcado*, mas não são "proibidos".

---

## 6.7 Os 175 candidatos e os 39 registros

Ver documento dedicado: [`07-CATALOGO-ESTRUTURADO.md`](07-CATALOGO-ESTRUTURADO.md).

Resumo: **39 catalogados**, ~136 **descobertos** (citados, sem registro), **0
validados**. Nenhum dos 175 deve aparecer como instalável na interface.

---

## 6.8 Orquestração não é modelo

**Correto e já era a intenção, mas o schema não obrigava.** A correção torna
explícito que uma arquitetura de agentes tem **nove componentes selecionáveis
separadamente**:

| Componente | Campo no schema |
|---|---|
| Modelo planejador | `agent.modelPlannerId` |
| Modelos trabalhadores | `agent.modelWorkerIds[]` |
| Orquestrador | `agent.orchestratorId` |
| Runtime de execução | `agent.runtimeId` |
| Ferramentas | `agent.toolIds[]` |
| Memória | `agent.memoryId` |
| Controle de orçamento | `agent.budget` |
| Aprovação humana | `agent.approvalPolicy` |
| Revisão e validação | `agent.reviewPolicy` |

O `kind` do catálogo separa `model` de `framework` de `runtime` de `provider`.
Nunca mais "o modelo de orquestração".

---

## 6.9 O que **não** mudou

| Item | Por quê |
|---|---|
| Não criar segunda arquitetura de providers | continua correto e foi elogiado na revisão |
| `LiaBrainCapabilities` como base | continua sendo o encaixe |
| Licença de pesos separada da de código | reforçado — Fish Audio provou que era necessário |
| Adiar `computer.control` | reforçado pela revisão |
| Qwen3.5-4B/9B como melhor local | mantido, agora com `variant: instruct` explícito |
| BGE-M3 + sqlite-vec como melhor memória | mantido |
| faster-whisper / sherpa-onnx como STT | mantido |

## 6.10 Fonte de cada verificação

| Item | Fonte | Data |
|---|---|---|
| Fish Audio Community License v1.0 | `raw.githubusercontent.com/fishaudio/fish-speech/main/LICENSE` | 11/11/2026 |
| Pesos antigos CC-BY-NC-SA | tags do HF `fishaudio/fish-speech-1.5`, `s1-mini` | 11/11/2026 |
| S2-Pro research license + gate NC | API do HF `fishaudio/s2-pro` → `cardData.license_name` e `extra_gated_fields` | 11/11/2026 |
| F5-TTS código MIT | `raw.githubusercontent.com/SWivid/F5-TTS/main/LICENSE` | 11/11/2026 |
| F5-TTS pesos CC-BY-NC-4.0 | tag `license:cc-by-nc-4.0` em `SWivid/F5-TTS` | 11/11/2026 |
| Qwen3.5-4B vs Base | API do HF, campo `base_model` e tags | 11/11/2026 |
| Tamanhos GGUF Qwen3.8-27B | `huggingface.co/api/models/unsloth/Qwen3.8-27B-GGUF/tree/main` | 11/11/2026 |
| Issues Vulkan/SSM | `gh search issues --repo ggml-org/llama.cpp` | 11/11/2026 |
| Vozes PT do Kokoro | lista de `siblings` em `hexgrad/Kokoro-82M` | 11/11/2026 |
| AGPL-3.0 do VoiceStudio | `raw.githubusercontent.com/debpalash/VoiceStudio/main/LICENSE` | 11/11/2026 |
| RX 580 = gfx803 | `docs/product/M1-PERSONAL-VOICE-ARCHITECTURE.md` (repo) | — |
