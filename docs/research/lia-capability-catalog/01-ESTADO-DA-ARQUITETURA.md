# 1. Estado da arquitetura da Lia — o que já existe

**Data:** 11/11/2026 · **Base:** `29999aff` · **Método:** leitura de código e
documentos do repositório. Nenhuma suposição por nome de arquivo.

## 1.1 Por que este documento existe

Antes de propor catálogo, é preciso saber o que já está de pé. A regra do
PROMPT é explícita: **não duplicar abstrações**. A Lia já tem um contrato de
capacidades, um registro de engines e uma política de rota — o catálogo novo
entra *dentro* disso, não ao lado.

Escala usada:

| # | Estado | Critério |
|---|---|---|
| 1 | **Implementado e funcional** | código + teste, exercitado no caminho real |
| 2 | **Implementado parcialmente** | código existe, cobre parte do escopo |
| 3 | **Apenas interface ou contrato** | tipos/funções puras, sem execução |
| 4 | **Documentado, não implementado** | só documento |
| 5 | **Ainda não projetado** | não existe |

## 1.2 Núcleo da Lia (`lia/core` e `airi/packages/lia-core`)

| Recurso | Onde | Estado | Observação |
|---|---|---|---|
| Contrato de capacidades do Brain | `brain/types.ts` → `LiaBrainCapabilities` | **1** | 9 booleanos: `audioInput`, `audioOutput`, `imageInput`, `realtime`, `reasoning`, `textInput`, `textOutput`, `toolCalling`, `videoInput` |
| Elegibilidade por capacidade | `brain/capabilities.ts` | **1** | `satisfiesBrainCapabilities`, `eligibleBrainModels`; puro, sem I/O |
| Registro de engines | `brain/engine-registry.ts` | **1** | `createBrainEngineRegistry`, `modelsForEngine` |
| Catálogo de produção | `brain/catalog.ts` | **1** | **Um** adapter: `groqBrainDescriptors` |
| Decisão de rota | `brain/decision.ts`, `runtime.ts` | **1** | decide a rota a partir do estado do produto |
| Seleção automática por política | `brain/selection.ts` | **1** | `selectBrainRouteByPolicy` |
| Resolução de preferência do usuário | `brain/resolver.ts` | **1** | `resolvePreferredBrainSelection` |
| Readiness | `brain/readiness.ts` | **1** | engine/modelo pronto ou não |
| Transporte de chat no Main | `main/services/lia/transport-execution-service.ts` | **1** | 10 provedores curados executam no processo main |
| Lista curada de provedores de chat | `shared/lia/provider-catalog.ts` | **1** | `openai`, `groq`, `cerebras-ai`, `anthropic`, `xai`, `mistral-ai`, `openrouter-ai`, `openai-compatible`, `lm-studio`, `ollama` |
| Cofre de credenciais | `secrets/vault.ts` + `credential-owner` | **1** | lease privada do processo dono; renderer não recebe chave |
| Backups e escrita do cofre | `secrets/vault-backup.ts`, `vault-write.ts` | **1** | sem teste Windows nesta leitura |

**Leitura importante:** o contrato de capacidades **já é exatamente o que um
catálogo precisa** para decidir "este modelo serve para esta tarefa?". O que
falta não é mecanismo — é **conteúdo**: hoje o catálogo de produção tem um
engine (Groq) e os descritores dele.

## 1.3 Voz

| Recurso | Estado | Observação |
|---|---|---|
| Registro de engines de voz | **1** | `voice/engines/registry.ts` |
| Engine Kokoro | **1** | `voice/engines/kokoro/` com install, layout, manifest, worker, smoke test |
| Outras engines de TTS | **5** | não há segunda engine registrada |
| Configuração de voz | **1** | `voice/config.ts`, `voice-service.ts` |
| Perfis de voz | **2** | `voices/profiles.ts`, `types.ts` |
| STT | **2** | `transcription-service.ts` + `lia-transcription.ts`; transporte existe, catálogo de modelos não |
| Conversa full-duplex / barge-in | **5** | não existe no núcleo da Lia |

## 1.4 Memória

| Recurso | Estado | Observação |
|---|---|---|
| Memória persistida | **1** | `eventa/lia-memory.ts`; `LIA_MEMORY_LIMITS = { entries: 100, text: 500, query: 4000, context: 2000, retrieved: 4 }` |
| Recuperação | **2** | **lexical apenas** (`memory-context.ts`): normaliza, remove stopwords, conta termos em comum. O próprio comentário declara "no chat history, extraction, embeddings or network" |
| Embeddings / vetores | **5** | nenhum |
| Grafo de conhecimento | **5** | nenhum |
| Consolidação / resumo | **5** | nenhum |
| Contradição / esquecimento seletivo | **5** | há `remove` e `clear` por entrada, não há detecção de contradição |

## 1.5 Agentes, ferramentas e orquestração

| Recurso | Estado | Observação |
|---|---|---|
| Tool calling no contrato | **3** | `toolCalling` é um booleano do descritor; não há executor de ferramentas da Lia |
| MCP | **2** | existe em `main/services/airi/mcp-servers/` — herança do AIRI, não contrato da Lia |
| Orquestração multiagente | **4** | `docs/project/AGENT-ORCHESTRATION.md` descreve **política de trabalho entre agentes de código**, não runtime de agentes da Lia |
| Fila, orçamento, timeout, cancelamento | **5** | não existe no produto |
| Aprovação humana de ação | **5** | não existe |

## 1.6 Percepção de tela, visão e controle

| Recurso | Estado |
|---|---|
| Entrada de imagem no contrato (`imageInput`) | **3** |
| Captura de tela | **5** |
| OCR / GUI parsing | **5** |
| Grounding de elemento | **5** |
| Controle de mouse/teclado | **5** |
| Verificação visual de ação | **5** |

Herança AIRI pode conter alguma captura de tela; **não foi confirmada como
capacidade da Lia** e não deve ser contada como tal.

## 1.7 O que isso significa para o catálogo

1. **Não criar segundo contrato de capacidades.** Os 9 booleanos existentes são
   o alicerce. O catálogo precisa de um vocabulário **mais fino** (por exemplo
   `speech.tts`, `vision.screen-understanding`), mas ele deve **mapear** para os
   booleanos, não substituí-los.
2. **Não criar segundo registro de engines.** `engine-registry.ts` já faz isso.
   O catálogo é uma **fonte de descritores** para ele.
3. **Memória é a lacuna mais barata de atacar.** Hoje é lexical com 4 entradas
   recuperadas; um embedding local pequeno muda a qualidade sem tocar em nada
   mais.
4. **Percepção de tela é a lacuna mais cara.** Não existe nada — e ela exige
   captura, interpretação, grounding, plano, execução e verificação, seis
   problemas distintos (ver `02-CATALOGO-MESTRE.md` §D).
5. **O usuário já escolhe modelo por capacidade** — `resolver.ts` e
   `selection.ts` fazem isso para o Brain. O catálogo amplia o mesmo padrão para
   voz, visão, memória e imagem.
