# Estudo completo do Project AIRI — base para o Lia-Project

> **Data do estudo:** 07/09/2026 · **Versão analisada:** `v0.12.0-beta.5` (release mais recente, publicada em 29/08/2026)
> **Fonte:** [github.com/moeru-ai/airi](https://github.com/moeru-ai/airi) · Código-fonte clonado e inspecionado integralmente (tag `v0.12.0-beta.5`, 5.332 arquivos)

---

## 1. Resumo executivo

O **Project AIRI** é um companheiro virtual ("AI waifu") **self-hosted e open-source**, fortemente inspirado na **Neuro-sama**. É, na prática, um "container de almas": um personagem virtual (Live2D/VRM/MMD/Spine/Tachie) que vive no seu desktop, navegador ou celular, conversa por voz em tempo real (STT → LLM → TTS com lip-sync), enxerga a tela, joga (Minecraft, Factorio, xadrez), usa ferramentas (plugins/MCP) e lembra de você (memória local com embeddings).

**Conclusão para o Lia-Project:** o AIRI é uma base excelente e **licenciada MIT** — podemos legalmente bifurcá-la (fork), renomear, personalizar a personagem ("Lia"), traduzir para pt-BR e redistribuir. A estratégia recomendada é um **fork da tag `v0.12.0-beta.5`** (a versão mais nova existente, mesmo sendo beta — exatamente o que o projeto pediu), mantendo o upstream configurado para absorver correções.

---

## 2. Identidade e saúde do projeto

| Aspecto | Dado |
|---|---|
| Repositório | `moeru-ai/airi` (organização Moeru AI + org satélite `@proj-airi`) |
| Estrelas / Forks | **~48,9 mil** stars / ~4,8 mil forks |
| Commits no `main` | 4.358 (atividade diária; último commit horas antes deste estudo) |
| Tags publicadas | 153 |
| Licença | **MIT** (© 2024-PRESENT Neko Ayaka) — uso, cópia, modificação e redistribuição livres |
| Comunidade | Discord, Telegram, WeChat, QQ, X (`@proj_airi`), tradução via **Crowdin** |
| Documentação | [airi.moeru.ai](https://airi.moeru.ai) (VitePress) + DeepWiki |
| Idiomas da UI | en, es, fr, ja, ko, ru, vi, zh-Hans, zh-Hant — **não existe pt-BR (oportunidade para nós!)** |
| Aviso oficial | Não existe criptomoeda/token oficial associado ao projeto |

---

## 3. Linha do tempo de versões (releases)

Histórico completo via API do GitHub (datas de publicação):

| Versão | Data | Status / Destaques |
|---|---|---|
| **v0.12.0-beta.5** | **29/08/2026** | **← "Latest" (versão que usaremos)** |
| v0.12.0-beta.4 | 27/08/2026 | Live2D estável em sessões longas (memória); teclado Safari mobile |
| v0.12.0-beta.3 | 27/08/2026 | Apple Speech on-device (macOS 26+); login via navegador do sistema; requer **Node 26.7.0 + pnpm 11.24.0** |
| v0.12.0-beta.1 | 24/08/2026 | **Grande release:** modelos MMD, Tachie, Spine, VRM clicável, playground de audição, mute de voz, correção de transcrição, providers assíncronos |
| v0.11.3 | 18/07/2026 | Última estável da linha 0.11 — voz no desktop, cards .zip, export/import de personagem |
| v0.11.1 / v0.11.0 | 17/07 e 08/07/2026 | Gemini TTS, Spine 2D, retry de tool-calls, Godot sidecar com VRM, stop de fala manual |
| v0.10.2 / 0.10.1 / 0.10.0 | 03–07/05/2026 | Login por e-mail, OIDC/JWT, exclusão de conta, computer-use MCP |
| v0.9.0 (+ betas/rcs/alphas) | mar–abr/2026 | Enxurrada de alphas/betas; APK Android; onboarding de providers |
| v0.8.x | dez/2025–jan/2026 | "Thank you 2025!"; série 0.8 com múltiplos betas |
| v0.7.x | jul–set/2025 | Nova era do app desktop Electron (antes Tauri, hoje legado) |
| v0.6.x / v0.5.0 / v0.4.x | abr–jun/2025 | Stage UI consolidada, VKVRM, memória |
| v0.3.x / v0.1.x | jan–fev/2025 | Primeiras versões públicas (início: dez/2024) |

**Destaques específicos da `v0.12.0-beta.5`** (notas oficiais):
- **Live2D: driver "MAGIC"** gera movimento estilo Neuro-sama ("Neuro bump"), com perfis Idle/calm e Speaking/excited, preservando lip-sync; relatório detalhado na importação de modelos; ZIPs criados no macOS agora importam corretamente.
- **Fala: VOICEVOX Engine e AivisSpeech Engine** como providers locais de TTS.
- Correções: sessão de chat restaurada no startup (multi-janela), comportamento de chat mobile, permissão de microfone no iOS, servidor local do desktop no Windows/macOS (sem `reusePort`), barra de título.
- Para desenvolvedores: `@proj-airi/server-runtime` agora dedica cada porta a um único listener.
- Para contribuidores: novos pacotes internos de gamepad (incl. DualSense PS5 USB/Bluetooth), workbench de Live2D Motion Control, Electron 42+ exige `install-electron` antes do dev.

**Observação importante:** o branch `main` já está ~1 semana à frente da tag (ex.: `feat(stage-layouts): add mobile view adjustment mode`). Builds **nightly** são gerados do `main` (marcados como experimentais). Nossa política: **fixar no release `v0.12.0-beta.5`** e rebasar quando os próximos releases saírem — é a forma "mais nova possível" sem aceitar o risco nightly.

---

## 4. Arquitetura do monorepo (nada ficou de fora)

O AIRI é um **monorepo pnpm + Turborepo** com 9 áreas de workspace: `packages/**`, `plugins/**`, `integrations/**`, `services/**`, `examples/**`, `docs/**`, `engines/**`, `apps/**`, `server/**`.

### 4.1 Aplicativos (`apps/`)

| App | Pacote | O que é |
|---|---|---|
| **stage-tamagotchi** | `@proj-airi/stage-tamagotchi` | **O app desktop principal** (Electron 43 + electron-vite 5). Companion de mesa com janelas múltiplas, tray, widgets, click-through, overlay, captura de tela, servidor local embutido. Estrutura `src/main` (processo Electron, DI via `injeca`), `src/preload`, `src/renderer` (Vue), `src/shared` (contratos IPC via `@moeru/eventa`). |
| **stage-web** | `@proj-airi/stage-web` | App web (Vue 3 + Vite, PWA via `vite-plugin-pwa`) rodando em [airi.moeru.ai](https://airi.moeru.ai). Mesma base `stage-ui`. |
| **stage-pocket** | `@proj-airi/stage-pocket` | App mobile **experimental** (Capacitor 8; iOS em Swift, Android em Kotlin). `pnpm dev:pocket:ios` / `dev:pocket:android`. |
| **ui-server-auth** | `@proj-airi/ui-server-auth` | UI de autenticação do backend hospedado (sem Stage/renderer/modelos). |
| **component-calling** | `@proj-airi/component-calling` | Áudio em tempo real (chamada de voz). |

### 4.2 Pacotes compartilhados (`packages/` — 48 pacotes)

**Núcleo do produto (o coração):**
- `stage-ui` — **o pacote mais importante**: componentes, composables e stores compartilhados por todos os "stages". Dentro de `src/stores/` ficam: `airi-card` (cards de personagem), `characters`, `chat`, `modules/` (orquestração da AIRI), `providers/` (catálogo padronizado de providers), `settings/`, `live2d`, `three`, `speech-runtime`, `voice-packs`, `mcp` + `mcp-tool-bridge`, `onboarding`, etc.
- `modules/` (em stage-ui) — os "órgãos" da AIRI: **consciousness** (LLM), **hearing** (STT + streaming), **speech** (TTS), **vision** (visão), **artistry** (geração de imagem: widget/canvas, image_journal inline/bg), **web-search**, **discord**, **twitter**, **gaming-minecraft**, **gaming-factorio**, `airi-card`.
- `core-agent` (`@proj-airi/core-agent`) — orquestração de runtime do agente (agents, contracts, messages, runtime, session).
- `core-character` (`@proj-airi/core-character`) — pipeline do personagem: segmentação de fala, emoção, delay, TTS opcional.
- `ccc` (`@proj-airi/ccc`) — tipos de **Character Card V3 (CCv3)** — o formato de personagem (compatível com o ecossistema SillyTavern/character.ai).

**Renderização de avatares ("skins"):**
- `stage-ui-live2d` — cena Live2D (componentes, stores, tools) sobre PixiJS 6 + `pixi-live2d-display` (patchado no repo).
- `stage-ui-three` — Three.js 0.185 + `@pixiv/three-vrm` (VRM), via TresJS.
- `stage-ui-mmd` — modelos MMD (com física ammo).
- `stage-ui-spine` — Spine 2D (`@esotericsoftware/spine-webgl`).
- `stage-ui-tachie` — "tachie" (troca de imagem completa por emoção).
- `stage-pages`, `stage-shared`, `stage-layouts` — bases de páginas, lógica e layouts compartilhados.

**Drivers de modelo/movimento (novidade da 0.12):**
- `model-driver-magic-live2d` + `motion-driver-magic` — o driver **MAGIC** (movimento estilo Neuro-sama).
- `model-driver-mediapipe` (face/tracking), `model-driver-lipsync` (lip-sync).

**Áudio:**
- `audio`, `pipelines-audio` (pipelines de áudio do produto), `testing-audio`, `stream-kit` (queues/streams).

**Canal de servidor (server channel) — a espinha dorsal das integrações:**
- `server-runtime` — runtime local (roda embutido no desktop; WS/HTTP).
- `server-sdk` — SDK cliente para conectar ao runtime.
- `server-shared` — contratos compartilhados.
- `better-ws` — WebSocket próprio.

**Plugins:**
- `plugin-protocol`, `plugin-sdk`, `plugin-sdk-tamagotchi` — SDK para escrever plugins/gamelets (widgets interativos, ferramentas do agente).

**Memória/dados:**
- `memory-pgvector` — memória de longo prazo com pgvector (backend hospedado).
- `duckdb-wasm`, `drizzle-duckdb-wasm` — DuckDB-WASM local (histórico/dados no navegador/Electron) com Drizzle ORM.

**Outros:**
- `i18n` (traduções), fontes (chillroundm, cjkfonts-allseto, departure-mono, xiaolai), `ui` (primitivas sobre reka-ui), `ui-loading-screens`, `ui-transitions`, `electron-eventa`, `electron-screen-capture`, `electron-vueuse`, `input-gamepad(-vueuse)`, `input-playstation-dualsense-5`, `cap-vite`, `unocss-preset-fonts`, `vitest-plugin-fakemic`, cenários de teste `scenarios-*`.

### 4.3 Backend hospedado (`server/`) — opcional para nós

- `server/apps/api` — API de recursos (Hono), domínios de negócio, migrações (donos do banco).
- `server/apps/auth` — serviço de autenticação **Better Auth + OIDC**.
- `server/packages/auth-shared` e `server-sdk-shared` (contratos Eventa do WebSocket de chat hospedado).
- `server/dev/caddy` — edge local; `docker-compose.yaml` sobe **Caddy + API + Auth + PostgreSQL + Redis** (`pnpm dev:backend`, edge em `localhost:6112`).
- Deploy de produção em Railway (`proj-airi/airi-railway`), OpenTelemetry em toda a stack.
- **Tudo funciona local-first sem este backend** — conta/nuvem é opcional (sync, catálogo de providers oficiais).

### 4.4 Integrações (`integrations/`)

- `discord-bot` — bot de Discord (discord.js + @discordjs/voice).
- `minecraft` — bot Mineflayer com stack cognitiva própria (`src/cognitive`)… **em caminho de deprecação** em favor de um runtime como **mod Fabric**. Aviso de segurança: não conectar em servidores públicos não confiáveis.
- `telegram-bot` (grammy), `satori-bot`, `twitter-services`, `vscode` (extensão).
- Todas conversam com o Stage via **server channel** (`server-sdk` ↔ `server-runtime` no desktop).

### 4.5 Plugins (`plugins/`) — exemplos vivos de extensão

- `airi-plugin-game-chess` — xadrez (chess.js + Stockfish) como gamelet/widget com aval (`vieval`).
- `airi-plugin-claude-code` — integração com Claude Code (!).
- `airi-plugin-homeassistant`, `airi-plugin-bilibili-laplace`, `airi-plugin-web-extension`.

### 4.6 Motores e serviços

- `engines/stage-tamagotchi-godot` — **experimental**: sidecar em Godot com import VRM, câmera, glow e rim light.
- `services/computer-use-mcp` — servidor **MCP** de "computer use" (controle do computador pelo agente).

### 4.7 Fluxo geral (diagrama oficial simplificado)

```
[stage-web] [stage-tamagotchi] [stage-pocket]        (apps)
      └────────────┬──────────────┘
              [stage-ui]  ← núcleo compartilhado
       ┌───────────┼─────────────┬──────────────┐
  core-agent  core-character  pipelines-audio  renderers(Live2D/VRM/MMD/Spine/Tachie)
       │
  server-sdk ⇄ (server channel) ⇄ server-runtime (desktop) ⇄ integrações/plugins
       │
  (opcional) backend hospedado: Caddy → api(Hono) + auth(BetterAuth) → PostgreSQL/Redis
```

---

## 5. Stack tecnológica (versões exatas da tag analisada)

| Camada | Tecnologia |
|---|---|
| Runtime | **Node.js 26.7.0** (`.tool-versions`; docs de contribuição ainda citam 24.13.0 — **prevalece o `.tool-versions`**), **pnpm 11.24.0** (via Corepack), `minimumReleaseAge: 4320min` (deps precisam de 3 dias publicadas — proteção supply-chain) |
| Frontend | **Vue 3.5**, Vue Router 5, **Pinia 4** (+ `pinia-plugin-synced` p/ sync entre janelas Electron, `@pinia/colada` p/ queries), VueUse 14, **UnoCSS 66.7** (não Tailwind), reka-ui (headless), vue-i18n 11 |
| Build | **Vite 8.2**, electron-vite 5, Turbo 2.10, tsdown, unplugin-* , vite-plugin-pwa |
| Linguagem | **TypeScript 6.0** |
| Desktop | **Electron 43.4** + electron-builder 26 (Nota do release: Electron ≥42 removeu o `postinstall`; scripts `dev`/`start` rodam `install-electron` antes) |
| Mobile | Capacitor 8 (Kotlin/Swift) |
| IA/LLM | **xsai 0.5.0-beta.8** (SDK próprio do Moeru AI — "Vercel AI SDK, só que minúsculo"), `@xsai-ext/providers`, Valibot, zod, MCP SDK |
| Local/WebAI | `@huggingface/transformers` 3.8.1 + onnxruntime-web 1.27 (embeddings/transcrição locais), VAD `@ricky0123/vad-web`, Apple Speech nativo (macOS 26+) |
| Renderers | PixiJS 6 + pixi-live2d-display 0.4 (patched), Three.js 0.185 + three-vrm 3.5, Spine 4.x, wlipsync, Rive, MediaPipe tasks-vision |
| Dados | DuckDB-WASM + Drizzle, PGlite + pgvector, PostgreSQL + Redis (backend), localforage/idb-keyval, localStorage (settings) |
| Backend | Hono 4.13, Better Auth 1.6, Caddy, OpenTelemetry, Resend, Stripe |
| Qualidade | Vitest 4 (+ browser mode/Playwright), histoire, ESLint (antfu) + oxlint, `moeru-lint`, publint/attw, cspell, knip |
| Testes E2E/visual | Playwright, `vishot` (capturas), cenários tamagotchi |

**Patches mantidos no repo:** `mineflayer-pathfinder`, `pixi-live2d-display`, `sponsorkit`, `tab-election`, `uiohook-napi`.

---

## 6. Como funciona o "cérebro" da personagem (o que vamos customizar)

1. **Card de personagem (Airi Card)** — baseado na especificação aberta **Character Card V3** (`chara_card_v3`). Campos usados: `name`, `nickname`, `description`, `personality`, `scenario`, `first_mes`, `alternate_greetings`, `system_prompt`, `post_history_instructions` + extensão `airi` (módulos: consciousness/speech/hearing/artistry/settings). Vários cards coexistem (perfil ativo), guardados em localStorage; **import/export como `.zip`** (`manifest.json` + `card.json` + `models/` opcionais).
2. **Prompt de sistema montado em runtime** (`packages/stage-ui/src/stores/modules/airi-card.ts` → `resolveSystemPrompt`): concatena `systemPrompt + description + personality + scenario + artistry.widgetInstruction`. O prompt base do sistema vive em `packages/stage-ui/src/constants/prompts/system-v2.ts` e injeta a **tabela de emoções** (`EMOTION_VALUES`) que o parser de saída converte em expressões/movimentos do modelo Live2D/VRM.
3. **Módulos** (consciousness, hearing, speech, vision, artistry, web-search, gaming…) — cada um com store de configurações e provider ativo; a UI de settings/onboarding é gerada a partir das definições de provider (`stores/providers/`), que na 0.12 carregam schemas/onboarding/validadores **assincronamente**.
4. **Pipeline de conversa:** áudio do mic → VAD → STT (streaming, com correção de transcrição) → contexto (card + memória + ferramentas) → LLM (stream via xsai) → segmentação/emoção (`core-character`) → TTS → lip-sync + emoção/motion no avatar. Fala pode ser interrompida; a AIRI não "ouve a si mesma" (eco cancelado no desktop).
5. **Memória:** DuckDB-WASM local; diário/imagens (`image_journal`); pgvector no backend hospedado; embeddings locais via transformers.js.
6. **Tools:** gamelets/plugins (xadrez, Home Assistant…), MCP (`mcp` store + `mcp-tool-bridge`), computer-use, web-search, artistry (ComfyUI/NanoBanana/Replicate).

---

## 7. Provedores suportados (docs oficiais da tag)

- **LLM ("consciousness") — 40+** : OpenAI, Azure OpenAI, Anthropic Claude, Google Gemini, DeepSeek, Qwen, **Ollama**, **LM Studio**, vLLM, SGLang, OpenRouter, AIHubMix, 302.AI, CometAPI, xAI, Groq, Mistral, Cerebras, NVIDIA, Together, Fireworks, Novita, Featherless, Perplexity, Zhipu, SiliconFlow, StepFun, Baichuan, Minimax, Moonshot, ModelScope, Player2, Tencent, Xiaomi MiMo, BytePlus/Volcengine, AtlasCloud, n1n, OpenPaths, Amazon Bedrock, Azure AI Foundry, provedores "oficiais" com conta…
- **TTS ("speech")** : OpenAI, ElevenLabs, Google Gemini TTS, Azure Speech, Alibaba Model Studio, Minimax, Index-TTS, **Kokoro (local, no navegador!)**, Player2, Volcengine, CometAPI, MiMo, **browser-local / desktop-local**, **VOICEVOX** e **AivisSpeech** (novos na beta.5); Voice Packs com previews e recomendações.
- **STT ("transcription")** : OpenAI, Deepgram, Aliyun NLS, Web Speech API, **browser-local / desktop-local** (transformers.js), **Apple Speech on-device** (macOS 26+).
- **Visão:** provedores OpenAI-compatíveis, Ollama, LM Studio, Cloudflare Workers AI, Azure AI Foundry, Amazon Bedrock, Gemini…
- **Imagem (artistry):** ComfyUI, NanoBanana, Replicate.

---

## 8. Ambiente de desenvolvimento (verificado no código)

```bash
# Pré-requisitos: git, mise (lê .tool-versions), Corepack
git clone https://github.com/moeru-ai/airi && cd airi
mise install                       # instala Node 26.7.0
corepack enable                    # ativa pnpm 11.24.0
pnpm install                       # postinstall: simple-git-hooks + build:packages

# Desenvolvimento (escolha o alvo)
pnpm dev                 # stage-web (navegador)
pnpm dev:tamagotchi      # desktop Electron (app principal)
pnpm dev:pocket:ios      # mobile iOS (Xcode)   | dev:pocket:android
pnpm dev:docs            # site de documentação
pnpm dev:backend         # backend hospedado via docker-compose (opcional)
pnpm dev:ui              # Histoire do design system

# Qualidade
pnpm typecheck && pnpm lint && pnpm test:run
```

Builds de distribuição: `build:web`, `build:tamagotchi` (`build:win|mac|linux`, flatpak, deb, rpm, apk/android). Identidade do app desktop: `electron-builder.config.ts` → `appId: 'ai.moeru.airi'`, `productName: 'AIRI'` (→ mudaremos para LIA).

**Regras internas do repo (AGENTS.md, 345 linhas) que devemos respeitar no fork:** inglês simples em código/PRs; UnoCSS (nunca Tailwind); Valibot p/ schemas; `@moeru/eventa` p/ IPC/RPC tipado; `injeca` p/ DI; kebab-case em arquivos; sem guards de retrocompatibilidade; comentários explicam "porquê"; padrões rígidos de watchers/Pinia sync entre janelas; skills de agentes em `.agents/skills/`.

---

## 9. Riscos e considerações (beta!)

1. **É beta**: a linha 0.12 ainda tem betas saindo (beta.1→5 em uma semana). Manter a **v0.11.3 como fallback estável** se algo quebrar.
2. **Upstream muito rápido** (commits diários, 4.358 no main): fork exige disciplina de rebase; customizações devem ficar **concentradas e marcadas** para minimizar conflitos.
3. **Monorepo pesado**: clone de ~919 MB; `node_modules` de vários GB; binários Electron/FFmpeg grandes; builds de desktop ~800+ MB por plataforma. No CI do Lia, cachear pnpm store.
4. **Node 26.7.0 + pnpm 11.24.0 obrigatórios** (pinados). Documentação de contribuição pode citar versões antigas — sempre conferir `.tool-versions` e `packageManager`.
5. **Ativos de personagem**: modelos Live2D têm licença própria (Cubism SDK + licença do modelo). Para a Lia precisaremos de um modelo Live2D/VRM com licença que permita redistribuição (ou importação pelo usuário, sem bundling).
6. **Integrações em migração** (Minecraft Mineflayer → Fabric) e apps experimentais (stage-pocket, Godot engine) — não apostar o produto nisso ainda.
7. **i18n**: pt-BR não existe — teremos que criar o locale (e idealmente subir upstream via Crowdin/PR).

---

## 10. Estratégia recomendada para o Lia-Project

**Modelo: fork customizado ("white-label") da tag `v0.12.0-beta.5`, com remotes `upstream` → `moeru-ai/airi`.**

| Fase | Escopo | Pontos de mudança no código |
|---|---|---|
| **0. Base** | Fork da tag `v0.12.0-beta.5`, toolchain (mise/pnpm), build verde de `stage-web` e `stage-tamagotchi` | `git remote add upstream …`; nada de código |
| **1. Identidade "Lia"** | Nome, ícones, appId, card padrão (nome Lia, personalidade, saudações em pt-BR), prompt base, locale pt-BR | `electron-builder.config.ts` (appId/productName), `packages/i18n/src/locales/pt-BR/`, default card em `stage-ui`, prompts em `constants/prompts/` |
| **2. Corpo e voz** | Skin (Live2D/VRM da Lia), mapeamento emoção→motion, TTS escolhido (OpenAI/ElevenLabs/Kokoro local), STT pt-BR | UI de import de modelo + `stage-ui-live2d` stores; providers já prontos |
| **3. Habilidades** | Plugins/gamelets próprios, memória/diário, MCP, integrações (Discord/Telegram) | `packages/plugin-sdk`, `plugins/lia-plugin-*`, `integrations/` via server channel |
| **4. Distribuição** | Instaladores Win/macOS/Linux (+ Android), auto-update próprio | `build:win|mac|linux`, `electron-updater`, CI GitHub Actions |

**Decisões já tomadas neste estudo:**
- ✅ Base: **fork** (não uso como biblioteca — os pacotes `@proj-airi/*` não são publicados no npm de forma estável para consumo externo; o fork é o caminho oficial de contribuição/customização profunda).
- ✅ Versão: **`v0.12.0-beta.5`** (mais nova existente; betas mais novos que a estável v0.11.3 — conforme o pedido do projeto).
- ✅ Licença MIT mantida nos arquivos originais (obrigação) + créditos ao Project AIRI.

---

## 11. Ecossistema satélite (subprojetos que nasceram do AIRI)

`xsai` (SDK LLM mínimo), `unspeech` (proxy universal ASR/TTS), `hfup`, `xsai-transformers`, WebAI realtime voice chat, `drizzle-duckdb-wasm`, **airi-factorio** (+ `factorio-rcon-api`, `autorio`), Dome Keeper AI, `velin` (prompts como Vue SFC), `demodel`, `inventory` (catálogo de modelos), `mcp-launcher`, SAD (docs LLM self-host), awesome-ai-vtuber. Org dedicada: [@proj-airi](https://github.com/proj-airi).

---

## 12. Checklist do próximo passo (quando formos começar a desenvolver)

- [ ] Clonar/forkar `moeru-ai/airi` na tag `v0.12.0-beta.5` para o repositório do Lia-Project
- [ ] Instalar Node 26.7.0 (mise/nvm) + Corepack/pnpm 11.24.0
- [ ] `pnpm install` + `pnpm dev:tamagotchi` (desktop) e `pnpm dev` (web) — validar ambiente
- [ ] Definir a personalidade da Lia (preencher card CCv3: name/description/personality/scenario/first_mes em pt-BR)
- [ ] Escolher/produzir o modelo do avatar (Live2D recomendado — melhor suporte, incl. driver MAGIC)
- [ ] Criar locale `pt-BR` no `packages/i18n`
- [ ] Renomear identidade (productName AIRI → LIA, appId, ícones, tray)
- [ ] Configurar providers (LLM + TTS + STT) para teste
- [ ] Plano de CI (cache pnpm, lint/typecheck/test) e de rebase upstream

---

*Documento gerado a partir da inspeção direta do código-fonte da tag `v0.12.0-beta.5`, notas de release oficiais (API GitHub) e documentação do repositório. Nada essencial ficou de fora: apps, 48 pacotes, backend, integrações, plugins, engines, serviços, stack, providers, versões e riscos.*
