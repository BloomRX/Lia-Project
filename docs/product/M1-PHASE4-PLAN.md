# M1-PHASE4-PLAN — Auditoria e plano de implementação da M1 Phase 4

> **Estado:** documento de **auditoria + planejamento**. **Nenhuma implementação.**
> **Base:** código real em `airi/` na branch `arena/01a07b6d-lia-project` (fork `stage-tamagotchi`, `v0.12.0-beta.5`), com M1 Phase 1–3 concluídas e validadas em máquina real.
> **Decisões normativas anteriores:** `docs/architecture/LIA-ARCHITECTURE.md`, `docs/architecture/M1-IMPLEMENTATION-PLAN.md`, `docs/product/M1-SCOPE.md`, `docs/product/UX.md`, `docs/upstream/LIA-IDENTITY-PATCH.md`.

---

## 0. Leituras principais (arquivos investigados)

**Domínio 1/8 — Identidade & distribuição**
- `airi/apps/stage-tamagotchi/package.json`, `electron-builder.config.ts`, `docs/upstream/LIA-IDENTITY-PATCH.md`
- `resources/` e `build/` (ícones), `ai.moeru.airi.metainfo.xml`, `ai.moeru.airi.flatpak.yml`
- `main/windows/main/index.ts` (título `AIRI`), `libs/bootkit/lifecycle.ts`, tray/about/onboarding

**Domínio 2 — Personagem/persona**
- `packages/core-character/src/index.ts` (vazio), `packages/ccc/src/**` (codec/define/export CCv3)
- `packages/stage-ui/src/types/character.ts` (schema agregado "server-style")
- `packages/stage-ui/src/stores/modules/airi-card.ts` (persona/card ativa), `stores/characters.ts`, `stores/character/{index,notebook,orchestrator}`
- `packages/stage-ui/src/constants/prompts/{system-v2,character-defaults,artistry-instruction}.ts`
- `packages/i18n/src/locales/en/base.yaml` (prompt da persona AIRI default)
- `packages/stage-pages/src/pages/settings/airi-card/**` (biblioteca de cards/edição)

**Domínio 3 — LLM/providers**
- `packages/stage-ui/src/stores/providers/{provider,config}.ts`
- `packages/stage-ui/src/libs/providers/{types,registry,metadata,index}.ts`, `providers/providers/*` (53 providers)
- `packages/stage-ui/src/stores/modules/consciousness.ts`, `consciousness-settings.ts`
- `packages/stage-ui/src/stores/chat/session-store.ts`, `stores/chat.ts`, `stores/chat/context-prompt.ts`
- `packages/core-agent/src/runtime/*`, `packages/core-agent/src/contracts/*`

**Domínio 4 — Voz/áudio**
- `packages/stage-ui/src/stores/modules/{speech,hearing}.ts`, `stores/speech-runtime.ts`, `stores/audio.ts`, `stores/speech-output-control.ts`, `stores/voice-packs.ts`, `stores/system-audio-lipsync.ts`
- `packages/pipelines-audio/src/**`, `packages/audio/src/**`, `packages/stage-ui/src/libs/inference/adapters/{kokoro,whisper}.ts`
- providers de fala/STT em `libs/providers/providers/`

**Domínio 5 — Memória**
- `packages/memory-pgvector/src/index.ts` (stub standalone)
- `packages/duckdb-wasm`, `drizzle-duckdb-wasm`
- `packages/stage-ui/src/stores/chat/session-store.ts` (persistência de sessão/chat), `stores/character/notebook.ts`

**Domínio 6 — Configuração**
- `main/libs/electron/persistence.ts` (`createConfig`), `main/configs/{global,artistry}.ts`
- call-sites de `createConfig` em `main/` (app/artistry/server-channel/extensions/windows-caption/windows-widgets/lia main-window/dashboard app-config)
- `packages/stage-ui/src/stores/settings/*` (stores localStorage)
- `packages/stage-shared/src/composables/use-local-storage-manual-reset`

**Domínio 7 — Settings/UX**
- `apps/stage-tamagotchi/src/renderer/pages/settings/**` (hub + system: general/color-scheme/window-shortcuts/developer/window)
- `packages/stage-pages/src/pages/settings/**` (airi-card, models, modules/{consciousness,speech,hearing,vision,artistry}, providers/*, account, data)
- `packages/stage-ui/src/stores/settings/*`, i18n `settings.yaml` / `tamagotchi/settings.yaml`

**Domínio 8 — Distribuição** (mesma base do Domínio 1) + scripts de release (`scripts/*`), updater (`services/electron/auto-updater`), `stage-web` build

---

## 1. Objetivo da Phase 4

Levar a Lia de "shell/HOME funcional sobre o runtime AIRI" (Phase 1–3) para um **produto conversável**:
deixar o usuário leigo (a) escolher/editar a **persona Lia**, (b) ter **IA/providers e voz** que funcionam "out of the box" com escolha e fallback, e (c) gerenciar tudo por **configurações em linguagem de produto**, sem dashboard administrativo e sem duplicar o runtime do AIRI.

Princípios inegociáveis (herdados):
- **AIRI = runtime/órgãos; Lia = produto/UX/config/orquestração/políticas.**
- Reutilizar AIRI sempre; **não** duplicar runtime/renderer/memória/provider/áudio/persistência.
- **Não** criar `@lia/*` sem necessidade arquitetural provada.
- **Não** refatorar internals do AIRI só por branding.
- Com base no que a auditoria encontrou, a maior parte do "sistema" da persona, dos providers e da voz **já existe no AIRI** — a Lia deve **selecionar, configurar, encapsular e traduzir**, não reconstruir.

---

## 2. Escopo (Phase 4)

1. **Persona:** card default "Lia" (nome + personalidade default **Tsundere** + comportamento), edição de nome/personalidade pelo usuário, arquitetura preparada para futura edição completa. Persona = **dados**, nunca hardcode.
2. **LLM/provider:** configuração de provider OpenAI-compatible e outros já catalogados; seleção de modelo; **seleção default recomendada** e **política de fallback** quando o provider principal falhar. (Groq/Cerebras e outros **já existem** no catálogo — integração é "config + default", não novo provider.)
3. **Voz/áudio:** fazer a Lia **falar** com um provider TTS default configurável + **fallback**; entrada por microfone (STT), VAD e **barge-in** já existentes → torná-los utilizáveis por configuração de produto; base para futura customização de voz e Edge/RVC/AllTalk/Voice Studio (fora daqui).
4. **Config:** desenhar o modelo de configuração de **produto** da Lia que evolui sem segundo sistema (namespace `lia` + `schemaVersion`/migração quando provado necessário).
5. **Settings/UX:** apresentar Personagem / Voz / IA·Provider / Janela / Idioma / Diagnóstico em linguagem de usuário, encapsulando/escondendo telas técnicas do AIRI.

## 3. Fora do escopo (Phase 4) — não implementar aqui

- Persona completa/editor CCv3 "de produto" rico; sistemas de assets/estúdio de voz.
- Integração de **novo** provider (nenhum); Voice Studio; AllTalk/RVC/XTTS/F5/Edge propriamente; clonagem de voz.
- Novo memory system/semântico/embeddings; pgvector funcional.
- **Updater/feed/distribuição** (apenas auditado; só mudança se houver necessidade explícita/independente).
- Redesign do Stage/general, identidade visual ampla, portas `d8e62f12`, correções upstream.
- Criação de packages `@lia/*`.

---

## 4. Arquitetura atual encontrada (resumo auditado)

### 4.1 Modelo de execução (desktop)
Electron multi-janela em `apps/stage-tamagotchi`: janela **main** (HOME `/home` + Stage `/`), janela **chat** (`/chat`, `chat-page-shell.vue`), janela **settings**, mais janelas utilitárias. Estado compartilhado entre janelas via **Pinia `synced`** + **localStorage** no renderer. Processo `main` é dono de janelas, `createConfig`, auth, updater, single-instance, server-channel, extensões/plugins, e da configuração de **janela** (lia `main-window.json`). O LLM/STT/TTS roda no **renderer** (stores/modules chamando providers via XSai/fetch), exceto providers "official"/auth via server-channel.

> **Implicação central:** hoje a "configuração de produto" da Lia está **fragmentada** entre (a) localStorage do renderer (persona/providers/módulos/settings) e (b) arquivos `createConfig` no main (janela). Não há um dono único de preferências de produto. Fase 4 precisa introduzir esse dono **sem migrar tudo de uma vez**.

### 4.2 Órgãos (módulos AIRI) — `packages/stage-ui/src/stores/modules/`
`airi-card` (persona) · `consciousness` (LLM) · `consciousness-settings` · `speech` (TTS) · `hearing` (STT) · `vision` · `artistry` · `discord` · `web-search` · `twitter` · `gaming-*` · `default`. Cada um com `activeProvider`/`activeModel` persistidos em localStorage e conectados a um **catálogo de providers**.

### 4.3 Persona (já existe, rico)
`useAiriCardStore` mantém `cards` (mapa de `AiriCard`/CCv3) e `activeCardId` em localStorage (`airi-cards`, `airi-card-active-id`). Cada card carrega **extensão AIRI** com seleções por módulo (`consciousness/speech/vision` provider+model, `displayModelId`, `artistry`) e é aplicado ao runtime ao ativar (`applyActiveCardSettings`). O **default** é semeado como card `'default'` chamado **ReLU**, cuja descrição é gerada de `base.yaml → prompt.prefix` (persona "AIRI") + `SystemPromptV2` (emotions/actions) — ou seja, **a persona default hoje está em i18n (código), não como um card de produto**. `systemPrompt` derivado (card fields) alimenta a mensagem `system` da sessão (`chat/session-store.ts`), per-`activeCardId`.

> **Gap 2A:** persona default não é "pack de produto"; está como string i18n + card 'ReLU'. Para a Lia precisamos de um **card padrão "Lia" (dados)**, com nome/personalidade próprios, mantendo o mecanismo de card.

### 4.4 LLM/providers (catálogo amplo já presente)
`stores/providers/` (provider + provider-config) com `libs/providers/registry.ts` (registro assíncrono) e `providers/providers/*` — **53 providers** incluindo `openai-compatible`, `openai`, `openrouter-ai`, `groq`, `cerebras-ai`, `ollama`, `lm-studio`, `cloudflare-workers-ai`, `anthropic`, `xai`, `mistral-ai`, etc. Cada definição declara `tasks`, schema de config, `createProvider → ProviderInstance`, capabilities (chat reasoning / transcription / speech transport rest ou bidirectional-ws), validators (config + runtime) e `isAvailableBy`. Persistência de config em localStorage `settings/providers/configured` (inclui `apiKey`). `consciousness` seleciona provider/model ativo. Sessões/chat em `stores/chat/session-store.ts` (constrói mensagem `system` por card + histórico; compacção existe).

> **Gap 3A:** **fallback** entre providers não é resolvido como política de produto — apenas troca manual de provider ativo. **Gap 3B:** **API keys vivem em localStorage** do renderer (gravável em disco em claro) — risco de segurança; precisa de armazenamento seguro no main (`safeStorage`). **Gap 3C:** "default recomendado" não existe (usuário configura tudo manualmente / onboarding).

### 4.5 Voz/áudio (infraestrutura ampla já presente)
- **TTS (`speech.ts`):** `activeSpeechProvider` default `'speech-noop'` (mudo até configurar). Catálogo de TTS: `elevenlabs`, `kokoro-local`, `voicevox`, `minimax-speech`, `google-gemini-audio-speech`, `openrouter-audio-speech`, `apple-speech`, `browser-web-speech-api`, `index-tts-vllm`, `local-audio`, `mimo-audio`, `unspeech`, `player2-speech`, `speech-noop`, etc.
- **STT (`hearing.ts`):** `activeTranscriptionProvider` default `''`; providers `aliyun-nls`, `browser-web-speech-api`, `google-gemini-audio`, adaptador local `whisper`; **VAD** (worklet) e **streaming transcription** presentes; `auto-send`, `confidence-threshold`.
- **Fala/lip/runtime:** `stores/speech-runtime.ts` (intents queue/interrupt), `stores/audio.ts`, `speech-output-control`, `system-audio-lipsync`; `libs/speech/tts-session` escolhe transporte por `capabilities.speech.transport`.
- **Barge-in / interrupt:** suportado pelo `speech-runtime` (`behavior: 'interrupt'` etc.) e hearing streaming.
- **Permissões:** mac plist descreve mic/speech/camera/bluetooth.

> **Gap 4A:** voz **default desligada** (`speech-noop`) e STT off — nada fala nem ouve até o usuário configurar um provider. **Gap 4B:** não há "voz default da Lia" + **fallback** (ex.: nuvem → kokoro-local). **Gap 4C:** falta exposição de produto (escolher voz sem entender "provider TTS"). Nada de Edge/RVC/AllTalk ainda (não existem).

### 4.6 Memória (imaturidade real)
- **`core-character`** é **vazio** (`export {}`). **`memory-pgvector`** é um **stub standalone** (server module sem lógica). `duckdb-wasm`/`drizzle-duckdb-wasm` existem como dependências, mas **não** há store de memória de longa duração integrada ao runtime desktop.
- O que existe: **persistência de sessão/chat** (`session-store.ts`, histórico + compacção por card/sessão) e um **notebook por personagem** (`stores/character/notebook.ts` — entries `note/diary/focus` + tasks, **em memória**, sem persistência vista). Nada de embeddings/vector retrieval ativo.

> **Gap 5A:** não há memória de longa duração/persistente de produto. A memória "curta" real é o histórico de sessão de chat. Definir escopo e **não** criar sistema novo nesta Phase.

### 4.7 Configuração (`createConfig`)
`createConfig(namespace, filename, schema, opts)` → arquivo JSON em `userData/{namespace}-{filename}` (ex.: `lia-main-window.json`, `app-options.json`, `artistry-options.json`, `server-channel-config.json`, `extensions-v1.json`, `windows-caption-config.json`, `windows-widgets-config.json`, `app-config.json` legacy). Com validação valibot, `autoHeal` (default + backup `.bak`), throttled write. **Não há `schemaVersion`/migração.** Namespace **`lia`** já é usado apenas para janela (`main-window.json`). Preferências de produto estão majoritariamente no **renderer localStorage** (`settings/*`, `airi-*`, `providers/*`).

### 4.8 Settings/UX (muita coisa técnica já existe)
`stage-pages/pages/settings/**`: `airi-card` (biblioteca+edição de persona), `models`, `modules/{consciousness,speech,hearing,vision,artistry}`, `providers/{chat/*,speech/*,transcription?,vision?,artistry/*}`, `account`, `connection`, `data`. App: hub `settings` + `system/{general,color-scheme,window-shortcuts,developer,window}`. Linguagem é **técnica** (provider/model). Navegação complexa para leigo.

---

## 5. Matriz REUTILIZAR / ESTENDER / ENCAPSULAR / SUBSTITUIR / INTACTO

> Legenda: **R**=reutilizar · **E**=estender (aditivo) · **C**=encapsular (camada de produto sobre AIRI) · **S**=substituir/migrar · **I**=intacto nesta Phase.

### 5.1 Identidade (Domínio 1/8)
| Item | Class | Nota |
|---|---|---|
| `appId` `ai.lia.app` / `productName` `Lia` (electron-builder) | **R (pronto)** | já aplicado (M1 Phase 1) |
| `executableName` = `airi` (win/mac/linux) | **I** | identidade de distribuição adiada (ver LIA-IDENTITY-PATCH) |
| `extraMetadata.name/homepage/repo` `ai.moeru.airi` / moeru-ai | **I** | feed/updater/repo upstream; manter até distribuição |
| `publish` feed `moeru-ai/airi` (win/mac/linux) | **I** | updater — não alterar sem necessidade |
| ícones `resources/*`,`build/*` | **C/E (parcial)** | alguns já Lia (Fase 1); revisar restantes |
| `metainfo.xml`/`flatpak.yml` (id ai.moeru.airi) | **I** | distribuição linux adiada |
| textos visíveis "AIRI" (about/tray/window title/mac plist/linux synopsis) | **E (i18n)** | traduzir/encapsular em i18n; plist só em distribuição |
| caminhos de dados/config (userData derivado de name) | **I/decidir** | depende de renomear `name` (distribuição); manter |
| developer/debug surfaces | **I/C** | encapsular, não esconder totalmente (Advanced) |
| core runtime/main lifecycle/DI/IPC | **I** | não tocar |

### 5.2 Persona (Domínio 2)
| Item | Class | Nota |
|---|---|---|
| Mecanismo card CCv3/AiriCard + store `airi-card` | **R** | reutilizar totalmente |
| Edição de persona/cards existente (`stage-pages/settings/airi-card`, profile picker, `airi-card-editor`) | **R** | já há UI de criar/importar/duplicar/editar |
| **Card default 'ReLU' / persona "AIRI" (base.yaml)** | **S** | substituir por **card default Lia** (dados), mantendo mecanismo |
| `ccc` codec/import-export `.zip` | **R** | pronto |
| `core-character` (vazio) | **I** | placeholder; decidir se é o lar futuro dos tipos; hoje n/a |
| `systemPrompt` assembly (sessão) | **R** | já consome persona como dados |
| Seletor de persona ativa (ativa card + aplica módulos) | **R/C** | expor em produto |

### 5.3 LLM/provider (Domínio 3)
| Item | Class | Nota |
|---|---|---|
| Catálogo/registry de providers (53) | **R** | inclui openai-compatible/groq/cerebras/ollama/etc. |
| Config de provider (schema, validators, onboardingFields) | **R** | reutilizar |
| Store `provider`/`provider-config` + seleção `consciousness` | **R/C** | encapsular em produto |
| Fallback entre providers | **E (novo, fino)** | política de produto sobre módulos; sem novo provider |
| Default recomendado (1º run) | **E (novo, fino)** | onboarding recomenda provider/model |
| **API keys em localStorage** | **S/E** | mover p/ armazenamento seguro no main (`safeStorage`) — ver §Segurança |
| Endpoint/baseURL/model por provider | **R** | já no schema de config |

### 5.4 Voz/áudio (Domínio 4)
| Item | Class | Nota |
|---|---|---|
| TTS providers + `speech.ts` | **R/C** | reutilizar; default configurável |
| STT providers + `hearing.ts` | **R/C** | reutilizar; default configurável |
| VAD / streaming / barge-in / speech-runtime | **R** | prontos |
| `pipelines-audio` / `speech-runtime` | **R** | prontos |
| Voz default + **fallback** TTS de produto | **E (novo, fino)** | sobre `speech.ts` |
| Edge/RVC/AllTalk/Voice Studio | **I** | futuro (fora) |
| Permissões (mic) | **R/C** | expor estados amigáveis |

### 5.5 Memória (Domínio 5)
| Item | Class | Nota |
|---|---|---|
| Sessão/histórico de chat (`session-store`) | **R** | memória curta real |
| Notebook por personagem | **E? (persistir)** | hoje em memória; candidato a persistir |
| `memory-pgvector` / vector retrieval | **I** | fora desta Phase |
| `core-character` vazio | **I** | fora |
| Sistema novo de memória | **não criar** | decidir escopo (ver §Memória) |

### 5.6 Configuração (Domínio 6)
| Item | Class | Nota |
|---|---|---|
| `createConfig` | **R** | já pronto, per-file JSON + autoHeal |
| Namespace `lia` (`main-window.json`) | **E** | expandir para preferências de produto |
| `schemaVersion`/migração | **E (adiado)** | só quando necessário (ver decisão) |
| localStorage renderer (`settings/*`,`airi-*`,`providers/*`) | **I** | não migrar tudo agora |

### 5.7 Settings/UX (Domínio 7)
| Item | Class | Nota |
|---|---|---|
| Telas técnicas `stage-pages` (providers/modules/models/airi-card) | **C** | encapsular; manter como camada avançada |
| Rotas/telas de produto (Personagem/Voz/IA/Janela/Idioma/Diagnóstico) | **E (novo)** | camada Lia sobre as rotas existentes |
| `window` (janela) | **R** | já criado em Phase 3 |
| stores de settings | **R** | reutilizar |

### 5.8 Distribuição (Domínio 8)
| Item | Class | Nota |
|---|---|---|
| updater/feed/`publish` | **I** | não alterar nesta Phase (sem necessidade) |
| executável/artifacts/assinatura/notarização | **I** | adiada |
| scripts de release | **I** | não tocar |

---

## 6. Persona architecture (proposta)

### 6.1 Descobertas
Persona **= dados** (card) e o AIRI já orquestra "card ativo ↔ módulos (provider/model/display/artistry)" e injeta o `systemPrompt` na sessão. Edição/import/duplicação **já existem**.

### 6.2 Proposta
1. **Card default Lia (pack de dados)**: criar/seed o card `'default'` como **Lia** (nome "Lia", personalidade default **Tsundere**, comportamentos/regras de fala) em formato `AiriCard`/CCv3, **não** em string i18n. A persona default deixa de ser `base.yaml→"AIRI"`.
   - Conteúdo da persona (nome, `personality`, `description`, `scenario`, `greetings`, exemplos, idioma pt-BR/en) viverá como **dados** num arquivo de **preset/default** da Lia (ex.: `packages/stage-ui` constants de card default OU novo local de dados), consumido por `airi-card.initialize()` ao semear `'default'`.
   - `SystemPromptV2`/emotions/actions permanecem como **instruções de runtime** (separados da persona), reutilizados.
2. **Onde vive a config da persona**: em **`airi-card`** (já persistido), com a **escolha "ativa"** registrada também na **config de produto Lia** (`lia`), para a Lia saber qual persona usar por perfil sem depender só de localStorage renderer.
3. **Como persistir**: manter `airi-cards`/`activeCardId` (renderer) como a fonte duradoura **do dado da persona**; config de produto aponta o id ativo. **Não** duplicar o storage do card.
4. **Como separar dados Lia de dados genéricos AIRI**: personas da Lia são apenas cards; se houver dados de "perfil do usuário Lia" (nome preferido, idioma, preferências de voz/IA por persona), vão para o namespace **`lia`** no main. Card fica em seu mecanismo.
5. **Evitar prompt hardcoded espalhado**: consolidar as strings de instrução de runtime em constantes tipadas já existentes (`constants/prompts/*`) e a persona default em **um** arquivo de preset de dados. Proibir prompts ad-hoc espalhados (regra de lint/CR).
6. **Futura UI de edição**: já existe editor de card (`airi-card`); para a Lia, expor uma tela **Personagem** de produto (nome/personalidade/idioma/comportamento) que edita os campos do card ativo via `updateCard`/`updateActiveCardModules`, ocultando detalhes CCv3.

### 6.3 Pontos de decisão (usuário)
- Onde fica o preset default da Lia (novo arquivo em `stage-ui` de dados vs constante local vs i18n pt-BR)? (recomendo: **arquivo de dados/preset** + i18n para descrição localizada quando houver pt-BR)
- Perfil: um card "Lia" único editável vs multi-card por perfil? (recomendo: **um card default "Lia"** editável nesta Phase; multi já existe no AIRI se quiser)

---

## 7. LLM/provider architecture (proposta)

### 7.1 Descobertas
Catálogo amplo e seleção manual já existentes; fallback e default recomendado ausentes; API key em localStorage.

### 7.2 Proposta
1. **Seleção default recomendada**: config de produto `lia.provider` = `{ chat: { providerId, modelId }, strategy }`. Um **resolver** fino, no renderer sobre `useConsciousnessStore`/`useProviderStore`, aplica: (a) se usuário configurou → usar; (b) senão → recomendações por disponibilidade/ordem (`openai`→`openai-compatible`→`groq`/`cerebras`/`ollama` local). Sem tocar no catálogo.
2. **Fallback (política)**: `lia.provider.fallback` define ordem e regras (ex.: `onError`, `afterRetries`, `scopes: chat`). Encapsular em uma pequena camada `LiaProviderPolicy` que: tenta provider principal → detecta falha de requisição/`model_not_found`/401 → repete ou troca para fallback → **informa ao usuário** qual provider/model está ativo. **Não** novo provider; usa `createProvider` do AIRI.
3. **OpenAI-compatible custom**: já é um provider do catálogo (`openai-compatible`) — apenas UI de produto para baseURL/model/key, reutilizando schema/validators.
4. **Runtime/server bridge**: LLM roda no renderer via XSai; alguns "official" via auth/server-channel — preservar; fallback de produto opera sobre o provider selecionado independentemente do transporte.
5. **Secrets/API keys** (ver §Segurança): guardar segredo no main (`safeStorage`), entregar ao renderer só quando montar `createProvider`; nunca exportar em config.

### 7.3 Pontos de decisão (usuário)
- Estratégia de fallback default: `manual` (usuário escolhe) vs `auto` (recomendado: auto com aviso) — recomendo **auto com opt-out manual**.
- Local first vs cloud first no default? (recomendo: **cloud/OpenAI-compatible se houver key; senão sugerir onboarding**; não forçar local nesta Phase).

---

## 8. Voice/audio architecture (proposta)

### 8.1 Descobertas
TTS/STT/VAD/barge-in/infra amplos prontos; **default mudo/off** (`speech-noop`, STT `''`); sem "voz de produto" nem fallback.

### 8.2 Proposta
1. **Voz default da Lia** em config `lia.voice = { tts: { providerId, modelId, voiceId }, stt: {...} }` + **fallback** `lia.voice.fallback.tts` (ex.: provider nuvem principal → `kokoro-local`). Resolver fino sobre `useSpeechStore`/`useHearingStore` + catálogo, igual ao §7.
2. **Fazer falar/ouvir por config**: escolha de voz apresentada em linguagem de produto; `activeSpeechProvider` deixa de ser `speech-noop` quando configurado (persistir também no card via `persistActiveCardModuleSelections`/`updateActiveCardSpeech`).
3. **barge-in / entrada**: já funcionam; expor toggles de produto (VAD sensibilidade, auto-send, mic) e estado "falando/ouvindo".
4. **Permissões**: centralizar estados de permissão de mic (main `media-permissions`) → status amigável na Lia.
5. **Futuro (fora)**: Edge como fallback online (não existe hoje), AllTalk/RVC/Voice Studio — a interface é **só escolher provider**; quando existirem, entram como definições.

### 8.3 Pontos de decisão
- Fallback de TTS default da Lia: qual dupla? (sugestão: um TTS cloud configurável → **`kokoro-local`** quando houver e for testado em hardware). Necessita teste real de `kokoro-local` antes de marcar Supported.
- STT default: nenhum (opt-in) vs `browser-web-speech-api` como fallback barato. (recomendo: **opt-in**, com onboarding.)

---

## 9. Memory architecture (proposta)

### 9.1 Descobertas
Sem memória de longa duração integrada; só histórico de sessão de chat e notebook em memória.

### 9.2 Proposta (escopo desta Phase = **não criar sistema novo**)
1. **Reutilizar**: histórico de sessão/chat como memória "curta" (já persiste por sessão/card). Garantir que seja visível/apagável pelo usuário.
2. **Escopo de memória curta (Lia)**: uma camada de **controles de usuário** (ver/limpar histórico, por personagem) — sem novo armazenamento.
3. **Notebook por personagem**: **persistir** o notebook existente (`note/diary/focus`, tasks) como passo pequeno e opcional — define onde (namespace `lia`? vs session) — recomendado postergar se não for pré-requisito de persona.
4. **Longa duração/semântica**: **fora** desta Phase. Definir critério de entrada (ex.: quando UX exigir "lembrar coisas entre sessões") e só então avaliar DuckDB/pgvector — **não** implementar.
5. **Privacidade/riscos**: chat/memória local só; nenhuma transmissão; export sem segredos; limpeza explícita.

### 9.3 Ponto de decisão
- Entra memória nesta Phase? Recomendo: **apenas** "controles de histórico curto + persistir notebook (opcional)"; **sem** memória de longa duração.

---

## 10. Config architecture (proposta)

### 10.1 Descobertas
`createConfig` per-file JSON com validação/autoHeal/backup; **sem schemaVersion/migração**; namespace `lia` já usado só p/ janela.

### 10.2 Proposta — modelo conceitual
Evoluir **dentro do mecanismo existente** (`createConfig`), arquivo **`lia` + `product.json`** (novo namespace-dono de preferências de produto), com schema valibot versionado de forma aditiva:

```
lia: main-window.json   (já existe — janela)
lia: product.json        (NOVO — preferências de produto)
  └ { schemaVersion: 1,
      persona:    { activeCardId } | null        // aponta p/ card; dados do card continuam em airi-card
      provider:   { chat: {default,fixed,fallback[],strategy}, vision?... }  // + modelo
      voice:      { tts:{provider,model,voice,fallback[]}, stt:{provider,model}, enabled }
      preferences:{ language, theme?, window? }
    }
```
> Recomendação: **estrutura sugerida** `product / persona / voice / provider / preferences` como sub-objetos do **mesmo** arquivo/schema `lia:product.json`, e **não** vários arquivos — para evoluir junto. Se a auditoria de implementação indicar melhor (ex.: separar por domínio com migração), ajustar. A persona **não** migra seu card (fica em airi-card); o `lia` guarda só a **escolha/política**.

### 10.3 Interação com estado AIRI (evitar dois donos)
- `lia:product.json` é o **contrato de preferência de produto** (o que o usuário escolheu); as **stores AIRI** continuam donas do estado de execução (provider/model ativos, config de provider).
- Um **sincronizador/leitor** fino aplica `lia:product` → stores no boot (leader) e grava de volta escolhas persistentes quando mudam — **unidirecional, sem segundo persistence system**. Este é o ponto mais delicado: desenhar para **não** duplicar nem competir com localStorage.

### 10.4 schemaVersion/migrations
Avaliação: **não é necessário nesta Phase se** o schema novo nascer "versionado do início" (campo `schemaVersion`) e **sem** dados legados a migrar (novo arquivo). Implementar **agora** apenas: (a) campo `schemaVersion` + escrita idempotente + `autoHeal`; (b) **framework leve de migração ad-hoc** quando houver 2ª versão. **Não** criar engine de migração genérica ainda. (Decisão recomendada: SIM `schemaVersion` campo, NÃO engine de migração nesta Phase.)

---

## 11. Settings UX architecture (proposta)

Transformar técnicas em produto — **encapsular rotas existentes**, não recriar telas:

- Hub Lia de Settings com grupos de produto (i18n pt-BR/en):
  - **Personagem** → card ativo (nome/personalidade/comportamento) → edita card via `airi-card`; atalho p/ biblioteca/cards.
  - **Voz** → provider de fala/mic, voz default, fallback, toggles de produto (VAD/auto-send/barge-in) → encapsula `speech`/`hearing`.
  - **IA / Provider** → provider/model de conversa, fallback, chave (entrada segura) → encapsula `consciousness` + provider config.
  - **Janela** (já existe, Phase 3).
  - **Idioma** → store `language` + i18n.
  - **Diagnóstico** → Advanced/Diagnostics/logs existentes encapsulados (sem dashboard administrativo na superfície).
- Manter telas técnicas (`stage-pages` providers/modules/models, `system/developer`) **acessíveis mas escondidas** (ex.: Advanced) — **reutilizar**, não apagar.
- Reusar stores de settings existentes; novo layout/rotas de produto em `apps/stage-tamagotchi` seguindo o padrão da Home.

---

## 12. Identity/distribution gaps (auditado — sem alterar agora)

- `appId`/`productName` Lia aplicados; **`executableName`=airi**, `extraMetadata.name=ai.moeru.airi`, repo/feed `moeru-ai/airi`, plist/linux/metainfo/flatpak citam "AIRI"/`ai.moeru.airi`. Textos "AIRI" aparecem em: window title, tray/about (i18n), mac usage descriptions, linux synopsis/description, `base.yaml` persona.
- **Decisão pendente (distribuição, fora desta Phase):** renomear `name`/`executableName`/feed → muda `userData`, single-instance e updater. Manter e registrar em `LIA-IDENTITY-PATCH.md` (já adiado).

---

## 13. Segurança de secrets/API keys

- **Hoje:** API keys de providers persistidas em **localStorage** do renderer (`settings/providers/configured`) → gravação em disco **em claro** (partição Electron) e expostas ao renderer (qualquer bug XSS/plugin). Alguns tokens (auth/server-channel) já usam `safeStorage` no main.
- **Proposta (Phase 4):** mover segredos para o **main** com `safeStorage` (criptografia por usuário/OS) num arquivo/namespace seguro separado (`lia:secrets.json` ou extensão do `app`), expostos ao renderer **somente** no momento de montar `createProvider`, via RPC controlado; **nunca** em config exportada; rotação/revogação; "offboard" para provider `official` mantém fluxo de auth atual. Scope mínimo nesta Phase: **não** refatorar todos os providers — apenas introduzir o canal seguro para o(s) provider(s) usado(s) e manter retrocompatibilidade de leitura.
- Regras: export/import sem segredos; logs sem segredos; lint para impedir segredo em localStorage em código novo.

---

## 14. Persistência

- **Mecanismo:** `createConfig` (main, JSON versionado) + localStorage do renderer (estado duradouro de UI/órgãos).
- **Objetivo desta Phase:** introduzir **`lia:product.json`** como contrato de preferência de produto (main), mantendo os demais storage intocados; **um** sincronizador unidirecional produto→stores; persistir escolha de persona/voz/provider/fallback; janela já persistida.
- **Não migrar** os demais localStorage agora; evolução aditiva.

---

## 15. Dependências

- Nenhuma biblioteca nova obrigatória para persona/provider/voz (tudo reutilizado).
- Para secrets: `safeStorage` (Electron, já disponível — sem dep nova).
- Para testes de voz local: asset/modelo `kokoro-local` e runtime (fora do escopo de código; teste real em hardware antes de marcar Supported).
- Sem dependências de updater/feed nesta Phase.

---

## 16. Riscos

1. **Persona default movida de i18n p/ card de dados** pode "perder" instruções de runtime (emotions/actions) → manter separação (instruções ≠ persona) e testar fala/ações.
2. **Fallback provider** complexidade de estados (troca de modelo a meio de sessão) → fallback só em **início de request** ou após limite; avisar usuário.
3. **Config produto × localStorage** podem dessincronizar (duplo dono) → sincronizador **unidirecional** + testes de convergência; nenhum dado de execução duplicado.
4. **Secrets no main** mudam fluxo de `createProvider` → manter retrocompat; rolar por provider usado primeiro.
5. **Voz default** (kokoro/local) requer teste em hardware antes de "Supported".
6. Multi-window/synced pinia: tocar store de persona/provider pode gerar loops → mudanças via `synced.actions` (padrão já usado).
7. Rebase upstream / não-portar `d8e62f12`; typecheck com baseline live2d conhecido.
8. Escopo correr para distribuição/memória/updater → barreiras explícitas nas subfases.

---

## 17. Sequência recomendada de implementação (subfases)

> Divisão por dependências reais (config = fundação; depois persona/provider/voz que a referenciam; UX sobre tudo; memória de escopo curto):

- **4A — Config de produto (fundação):** criar `lia:product.json` (schemaVersion) + contrato `product/{persona,provider,voice,preferences}` + sincronizador unidirecional + RPC `liaGetConfig/UpdateConfig` + testes. *(Sem isso, persona/provider/voz não têm onde registrar "default/política".)*
- **4B — Persona/persona:** card default "Lia" (nome/personalidade Tsundere) como **dados**; edição nome/personalidade via tela Personagem (reusa airi-card); integra `4A.persona`.
- **4C — LLM/provider:** default recomendado + fallback + UI IA/Provider + onboarding de 1º provider; secrets no main (`safeStorage`) para o fluxo usado.
- **4D — Voz:** default + fallback de TTS/STT + toggles produto (VAD/auto-send/barge-in); testar TTS local escolhido em hardware.
- **4E — Settings UX (superfície de produto):** hub Personagem/Voz/IA/Janela/Idioma/Diagnóstico encapsulando as telas/rotas existentes.
- **4F — Memória de escopo curto (opcional/pequena):** controles de histórico curto + persistir notebook; nenhum sistema novo.

> Cada subfase fecha com: typecheck (baseline conhecido), lint no escopo, testes unitários novos, docs, commit atômico revisável. Gate de revisão entre subfases.

---

## 18. Testes automatizados (planejados)

- **Config (`lia:product`)**: schema/autoHeal/schemaVersion; aplicar→stores; gravar escolhas; convergência (sem loop) e sem duplicação.
- **Persona**: seed do card default "Lia"; edição de nome/personalidade reflete no `systemPrompt` da sessão; `activeCardId` sincronizado; import/export CCv3 intacto (regressão).
- **Provider/fallback**: resolver de default (sem config → recomendação; com config → usa); política de fallback (falha→fallback→aviso; não trocar a meio de stream).
- **Voz**: resolver de default; troca de provider mantém `speech`/`hearing`; toggles.
- **Secrets**: `safeStorage` round-trip; renderer recebe só sob demanda; export não contém segredo.
- **Settings/rotas**: navegação de produto abre telas encapsuladas corretas.
- Regressão: suites existentes de `window-sizing`, `window-size-settings`, stores afetadas; `pnpm typecheck` (baseline live2d) e `pnpm build:web` no escopo.

---

## 19. QA manual

1. Primeira execução: default persona **Lia** (Tsundere) presente; nome/personalidade editáveis e persistidos.
2. Configurar provider (OpenAI-compatible) → conversa funciona; modelo trocável; fallback dispara e avisa quando principal falha.
3. Voz: configurar TTS → Lia fala; falha no TTS principal → fallback fala; STT/mic com VAD e barge-in interrompe fala; permissão de mic com estado amigável.
4. Personagem/Voz/IA/Janela/Idioma/Diagnóstico em linguagem de usuário; telas técnicas acessíveis só via Avançado.
5. Janela: tamanhos Home/Stage independentes, presets + Restore, resize manual (Model A) — sem regressão.
6. Memória curta: histórico visível/apagável; sem vazamento entre personagens.
7. API key não vazada em logs/export; reinício mantém config sem pedir de novo.
8. Multi-janela: troca de persona/provider reflete em stage/chat (synced) sem duplicar runtime.
9. `pnpm typecheck` (só baseline live2d), testes, `build:web`.
10. Runtime não duplicado; sem nova janela/segundo renderer; App.vue lifecycle intacto.

---

## 20. Critérios objetivos de aprovação

1. `lia:product.json` existe com `schemaVersion`, validado, **sem** segundo persistence system e **sem** duplicar estado de execução (testes de convergência verdes).
2. Persona default = **card de dados "Lia" (Tsundere)**; `systemPrompt` da sessão deriva do card; edição de nome/personalidade persiste e aplica.
3. Provider/LLM configurável (OpenAI-compatible p/ quem tiver; catálogo preservado); **fallback** funciona e avisa usuário; modelo selecionável.
4. Lia fala (TTS default) e ouve (STT opt-in) com barge-in; fallback de voz funciona.
5. Settings de produto (Personagem/Voz/IA/Janela/Idioma/Diagnóstico) navegáveis por leigo; técnicas encapsuladas em Avançado.
6. Secrets em `safeStorage` no main para o fluxo usado; ausentes de logs/export.
7. Memória: apenas escopo curto acordado; nenhum sistema novo.
8. Sem regressão nas fases 1–3 (janela/presets/restore/manual, Home↔Stage, Stage→Home 1º botão dock).
9. `pnpm typecheck` = baseline live2d conhecido apenas; testes novos verdes; `build:web` ok.
10. Nenhum package `@lia/*`; nenhuma duplicação de runtime/provider/áudio/persistência; Phase 4 só concluída após validação real + sua aprovação.

---

## Apêndice — Decisões que exijo de você (resumo)

1. **Preset default da Lia**: onde vive (arquivo de dados em `stage-ui`/preset vs i18n) — recomendo **dados + preset**.
2. **Subfase 4A primeiro** (config de produto como fundação) — você prefere ordem alternativa (persona antes)?
3. **Persona**: um card único "Lia" editável vs multi-card por perfil.
4. **Fallback**: `auto` com aviso (recomendo) vs `manual`.
5. **Voz default/fallback**: escolha do par principal/fallback a **testar em hardware** antes de "Supported".
6. **schemaVersion**: campo sim; **engine de migração** apenas quando 2ª versão existir (confirma?).
7. **Memória**: entra só escopo curto (histórico+notebook) nesta Phase, ou fica 100% fora?
8. **Secrets**: escopo mínimo (provider usado) — ok, ou refatorar mais providers já nesta Phase?

*Fim do documento `M1-PHASE4-PLAN.md`.*
