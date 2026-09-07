# AIRI-ANALYSIS — Análise da base atual e do runtime AIRI

> **Fase 0 · Repository + AIRI Architecture Audit**
> **Data:** 07/09/2026 · **Branch:** `arena/01a07b6d-lia-project`
> **Objetivo:** entender 100% da base atual e propor a transformação em **Lia**, usando o Project AIRI como runtime/foundation quando apropriado.
> **Fonte de verdade do AIRI:** inspeção completa do código da tag `v0.12.0-beta.5` já realizada e documentada em [`docs/estudo-airi.md`](../estudo-airi.md). Ver nota de proveniência (§0).

---

## 0. Proveniência e método (leia primeiro — evita que se invente)

Para não violar as regras *"não inventar APIs/packages/capabilities"* e *"nunca assumir"*, este documento distingue explicitamente três níveis de certeza:

| Nível | Marcação usada | Significado |
|---|---|---|
| **Verificado na base atual** | `[VERIFICADO]` | Constatado diretamente nos arquivos do repositório `Lia-Project`. |
| **Documentado (fork pendente)** | `[ESTUDO]` | Fatos sobre o código do AIRI retirados de `docs/estudo-airi.md`, produzido por inspeção direta da tag `v0.12.0-beta.5` (5.332 arquivos). Não está ainda *checkoutado* neste repositório. |
| **Incerto / a validar** | `[UNKNOWN]` / `?` | Não pôde ser determinado com as evidências atuais (ver §Riscos e §Unknowns). |

**Fato central e honesto:** o repositório atual **ainda não contém o fork do AIRI**. O que existe é a *camada de produto/planejamento* (`AGENTS.md`, README, DevKit, estudo). Portanto, toda seção que descreve o interior do AIRI é baseada no **estudo já concluído** e deve ser **revalidada contra o código real** no momento em que o fork for adicionado (próximo passo de Fase 0). Isto não enfraquece a análise — o estudo foi feito sobre a tag exata que será usada — mas é importante registrar que **as APIs internas ainda não são observáveis neste working tree**.

---

## Repository Overview

### O que é hoje o `Lia-Project` `[VERIFICADO]`

É um repositório **de planejamento e ferramentas**, não (ainda) o código da aplicação. Estado do working tree:

| Arquivo/Pasta | Função |
|---|---|
| `AGENTS.md` (2.438 linhas) | **Master Agent Prompt** do produto Lia: visão, regras de UX, arquitetura conceitual, restrições, terminologia, Definition of Done. É a especificação de produto e a carta de princípios técnicos. |
| `README.md` | Resumo do projeto, decisão de fork do AIRI `v0.12.0-beta.5`, roadmap em fases e índice de docs. |
| `docs/estudo-airi.md` | Estudo técnico completo do AIRI (apps, 48 pacotes, backend, integrações, plugins, engines, stack, providers, riscos, estratégia). **É a fonte de verdade do AIRI na base atual.** |
| `devkit.json` | Config do DevKit (nome `Lia-Project` + descrição). |
| `DevKit.bat` + `tools/` | **DevKit** (git seguro/universal): `project_cli.py` (~63 KB), testes `test_project_cli.py`/`test_creation.py`, README, exemplo de config. Não é parte do produto Lia — é ferramenta de dev/colaboração. |
| `docs/` | Hoje só contém `estudo-airi.md`. Ainda não existem `architecture/`, `product/`, `compatibility/`, `security/`, `upstream/`, `licenses/`, `licenses/THIRD-PARTY-NOTICES.md` etc. citados no AGENTS.md. |

### Estrutura do monorepo — conclusão `[VERIFICADO]`

**Não existe monorepo de código neste repositório.** Não há `apps/`, `packages/`, `plugins/`, `services/`, `integrations/`, `engines/`, `server/`, `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.tool-versions` ou `electron-builder.config.ts`.

O *monorepo* de código pertence ao **AIRI upstream** e será trazido para dentro deste repositório quando o fork for adicionado (Fase 0 pendente, confirmado no `README.md`).

### Decisões já fixadas pelo estudo/AGENTS `[VERIFICADO]`

- **Modelo:** fork customizado (white-label) da tag `v0.12.0-beta.5` do `moeru-ai/airi`, com remote `upstream` (licença MIT).
- **Roadmap:** Fase 0 (base/toolchain) → 1 (identidade Lia + pt-BR) → 2 (corpo/voz) → 3 (habilidades) → 4 (distribuição).
- **Não** usar o AIRI como biblioteca via npm: os pacotes `@proj-airi/*` não são publicados de forma estável para consumo externo → o **fork é o caminho oficial** de contribuição/customização profunda.

---

## AIRI Architecture

> Nesta seção o conteúdo é `[ESTUDO]` (extraído de `docs/estudo-airi.md`). Será `[VERIFICADO]` quando o fork entrar na base.

### 1. Monorepo e áreas de workspace

O AIRI é um **monorepo pnpm + Turborepo** com 9 áreas de workspace:

```
apps/  packages/  plugins/  integrations/  services/
examples/  docs/  engines/  server/
```

### 2. Fluxo arquitetural geral (diagrama do estudo)

```
[stage-web] [stage-tamagotchi] [stage-pocket]        (apps)
      └────────────┬──────────────┘
              [stage-ui]  ← núcleo compartilhado (stores/modules/providers/onboarding…)
       ┌───────────┼─────────────┬──────────────┐
  core-agent  core-character  pipelines-audio  renderers (Live2D/VRM/MMD/Spine/Tachie)
       │
  server-sdk ⇄ (server channel) ⇄ server-runtime (desktop) ⇄ integrações/plugins
       │
  (opcional) backend hospedado: Caddy → api(Hono) + auth(BetterAuth) → PostgreSQL/Redis
```

### 3. Os "apps" (frontends/consumidores)

| App | O que é |
|---|---|
| `stage-tamagotchi` | **App desktop principal** — Electron 43 + electron-vite 5. Estrutura `src/main` (processo Electron, DI via `injeca`), `src/preload`, `src/renderer` (Vue), `src/shared` (contratos IPC via `@moeru/eventa`). Companion de mesa com múltiplas janelas, tray, widgets, click-through, overlay, screen capture e servidor local embutido. |
| `stage-web` | Web (Vue 3 + Vite, PWA), mesmo core `stage-ui`. |
| `stage-pocket` | Mobile **experimental** (Capacitor 8; iOS Swift / Android Kotlin). |
| `ui-server-auth` | UI de auth do backend hospedado (sem stage/renderer/modelos). |
| `component-calling` | Áudio em tempo real (chamada de voz). |

### 4. O núcleo compartilhado (`stage-ui`) e os "órgãos" (`modules/`)

O **stage-ui** é o pacote mais importante: componentes, composables e stores compartilhados por todos os stages. Dentro de `src/stores/`:

- **`airi-card`** — cards de personagem (Character Card V3); **`characters`**, **`chat`**, **`modules/`** (orquestração da AIRI), **`providers/`** (catálogo padronizado), **`settings/`**, **`live2d`**, **`three`**, **`speech-runtime`**, **`voice-packs`**, **`mcp` + `mcp-tool-bridge`**, **`onboarding`**, etc.

Os **módulos/"órgãos"** (em `modules/`) são as capacidades da personagem:

- `consciousness` → **LLM**
- `hearing` → **STT + streaming**
- `speech` → **TTS**
- `vision` → visão
- `artistry` → geração de imagem (widget/canvas, `image_journal`)
- `web-search`, `discord`, `twitter`, `gaming-minecraft`, `gaming-factorio`, `airi-card`

Cada módulo tem **store de configuração + provider ativo**; a UI de settings/onboarding é gerada a partir das definições de provider (`stores/providers/`), que na 0.12 carregam schemas/onboarding/validadores **assincronamente**.

### 5. Runtimes e orquestração

- **`core-agent`** — orquestração de runtime do agente (agents, contracts, messages, runtime, session).
- **`core-character`** — pipeline do personagem: segmentação de fala, emoção, delay, TTS opcional.
- **`ccc`** — tipos de **Character Card V3 (CCv3)** (compatível com SillyTavern/character.ai).
- **Server channel** (espinha dorsal das integrações): `server-runtime` (roda embutido no desktop; WS/HTTP), `server-sdk` (cliente), `server-shared` (contratos), `better-ws`.

### 6. Backend hospedado (opcional, `server/`)

`apps/api` (Hono) + `apps/auth` (Better Auth + OIDC) + Caddy + PostgreSQL + Redis (`docker-compose`), deploy Railway, OpenTelemetry. **Tudo funciona local-first sem este backend** — conta/nuvem é opcional (sync + catálogo de providers oficiais).

### 7. Pipeline de conversa por voz (como a personagem "funciona")

```
microfone → VAD → STT (streaming + correção de transcrição)
   → contexto (card + memória + tools)
   → LLM (stream via xsai)
   → segmentação/emoção (core-character)
   → TTS → lip-sync + emoção/motion no avatar
```
- A fala pode ser interrompida; a AIRI não "ouve a si mesma" (eco cancelado no desktop).
- O **prompt de sistema** é montado em runtime (`resolveSystemPrompt`): concatena `systemPrompt + description + personality + scenario + artistry.widgetInstruction`; o prompt-base vive em `system-v2.ts` e injeta a tabela de **emoções** (`EMOTION_VALUES`) que o parser converte em expressões/movimentos do modelo.

### 8. Renderização de avatares ("skins")

`stage-ui-live2d` (PixiJS 6 + `pixi-live2d-display` patched), `stage-ui-three` (Three.js 0.185 + `three-vrm`, via TresJS), `stage-ui-mmd`, `stage-ui-spine`, `stage-ui-tachie`. Drivers de modelo/movimento novos na 0.12: **MAGIC** (estilo Neuro-sama), MediaPipe (face/tracking), lipsync.

### 9. Plugins, integrações e serviços

- **Plugins** (exemplos vivos de extensão): `airi-plugin-game-chess`, `airi-plugin-claude-code`, `airi-plugin-homeassistant`, `airi-plugin-bilibili-laplace`, `airi-plugin-web-extension`. SDKs: `plugin-protocol`, `plugin-sdk`, `plugin-sdk-tamagotchi`.
- **Integrações** (`integrations/`): `discord-bot`, `minecraft` (Mineflayer, em deprecação), `telegram-bot`, `satori-bot`, `twitter-services`, `vscode`. Todas conversam com o Stage via **server channel**.
- **Engines:** `stage-tamagotchi-godot` (experimental, sidecar Godot/VRM).
- **Services:** `computer-use-mcp` (servidor MCP de computer use).

---

## Existing Capabilities

O que **já existe no AIRI** e pode ser diretamente reutilizado (`[ESTUDO]`).

### LLM ("consciousness") — 40+ providers
OpenAI, Azure OpenAI, Anthropic Claude, Google Gemini, DeepSeek, Qwen, **Ollama**, **LM Studio**, vLLM, SGLang, **OpenRouter**, AIHubMix, 302.AI, CometAPI, xAI, **Groq**, Mistral, **Cerebras**, NVIDIA, Together, Fireworks, Novita, Featherless, Perplexity, Zhipu, SiliconFlow, StepFun, Baichuan, Minimax, Moonshot, ModelScope, Player2, Tencent, Xiaomi MiMo, BytePlus/Volcengine, AtlasCloud, n1n, OpenPaths, Amazon Bedrock, Azure AI Foundry, "oficiais" com conta…

### TTS ("speech")
OpenAI, ElevenLabs, Google Gemini TTS, Azure Speech, Alibaba Model Studio, Minimax, Index-TTS, **Kokoro (local, no navegador!)**, Player2, Volcengine, CometAPI, MiMo, browser/desktop-local, **VOICEVOX**, **AivisSpeech** (novos na beta.5); Voice Packs com previews/recomendações.

### STT ("transcription")
OpenAI, Deepgram, Aliyun NLS, Web Speech API, browser/desktop-local (transformers.js), Apple Speech on-device (macOS 26+).

### Visão
OpenAI-compatible, Ollama, LM Studio, Cloudflare Workers AI, Azure AI Foundry, Amazon Bedrock, Gemini…

### Imagem ("artistry")
ComfyUI, NanoBanana, Replicate.

### Avatar / skins
Live2D, VRM, MMD, Spine, Tachie — import/export de modelo, cenas prontas, drivers de movimento (MAGIC, MediaPipe, lipsync), lip-sync.

### Memória
DuckDB-WASM local (com Drizzle), diário/`image_journal`, `pgvector` (backend hospedado), embeddings locais via transformers.js.

### Tools / agentes
Gamelets/plugins, MCP (`mcp` store + `mcp-tool-bridge`), computer-use (MCP), web-search, artistry.

### Integrações
Discord (text + voz via `@discordjs/voice`), Telegram, Satori, Twitter, extensão VS Code, Minecraft, chess.

### Personagem
Character Card V3 (CCv3) + extensão `airi` (módulos); import/export `.zip`; múltiplos cards coexistem.

---

## Existing Extension Points

Onde a **Lia pode se integrar sem modificar o core** (`[ESTUDO]`, a confirmar no código).

1. **Card de personagem / preset padrão** — a Lia entra como *um card* CCv3 (nome/personalidade/saudações/pt-BR), não como lógica hardcoded. O sistema já é multi-character.
2. **Módulos (`modules/`)** — cada capacidade (consciousness, speech, hearing, vision, artistry, discord…) é uma store + provider ativo; é o ponto natural para o *Orchestrator* da Lia conectar/selecionar providers sem tocar no core.
3. **Catálogo de providers (`stores/providers/`)** — definições assíncronas (schema/onboarding/validator). Novo provider → nova definição de provider, sem alterar módulos.
4. **Server channel (`server-sdk` ⇄ `server-runtime`)** — o mecanismo oficial para serviços externos/integrações conversarem com o desktop. Ideal para o Lia Orquestrador como serviço e para apps auxiliares (ex.: Voice Studio) conversarem com o runtime.
5. **Plugin SDK** — gamelets/widgets/ferramentas do agente; novos plugins `lia-plugin-*`.
6. **Integrações** — Discord/Telegram etc. via server channel.
7. **Prompt base e emoções** — `constants/prompts/` e `EMOTION_VALUES` permitem ajustar comportamento/personalidade sem reescrever o parser.
8. **i18n** — criação de locale `pt-BR` (inexistente hoje).
9. **electron-builder identity** — `appId`/`productName`/ícones trocáveis.
10. **`speech-runtime` / `pipelines-audio` / `stream-kit`** — pontos para injetar/encapsular audio pipeline (VAD/STT/TTS/barge-in).

> **Advertência (AGENTS.md §7):** a Lia deve ficar acima do AIRI via *adapter/wrapper/integration layer*. Onde o core precisar mudar, o diff deve ser mínimo, marcado e documentado em `docs/upstream/`.

---

## Current Limitations

1. **É beta.** A linha 0.12 está lançando betas rapidamente (beta.1→5 em ~1 semana). O estudo recomenda manter **v0.11.3 como fallback estável**.
2. **Upstream muito rápido** (commits diários; 4.358 no `main`; nightly do `main` marcado experimental). Fork exige disciplina de rebase; customizações devem ser concentradas/marcadas.
3. **Ainda não há fork neste repositório** — nada de código observável para validar; toda a análise AIRI é re-derivada do estudo. `[VERIFICADO]`
4. **Repositório pesado** (clone ~919 MB; node_modules de vários GB; Electron/FFmpeg grandes; builds desktop ~800+ MB/plataforma).
5. **Toolchain pinada e específica**: Node 26.7.0 + pnpm 11.24.0 (`.tool-versions`); docs de contribuição podem citar versões antigas (24.13.0) — divergência conhecida.
6. **Sem pt-BR** (UI e personagem). i18n inexistente para o idioma.
7. **Licenças de assets**: modelos Live2D têm licença própria (Cubism + modelo). Para a Lia precisa de modelo redistribuível **ou** importação pelo usuário (sem bundling). RVC/XTTS/AllTalk têm licenças/atributos próprios a rastrear.
8. **Integrações em migração/experimental**: Minecraft (Mineflayer → Fabric), `stage-pocket`, engine Godot — não apostar o produto nisso.
9. **Não é "launcher/UX leiga" por natureza** — o AIRI é um produto voltado a entusiastas; a camada de produto/UX simples (wizard, progresso, erros amigáveis, launcher) é responsabilidade da **Lia** (não existe no AIRI).
10. **Distribuição/auto-update do produto Lia** não está resolvida (é fase 4 do roadmap; upstream gera nightly, mas o modelo de *auto-update do Lia* é decisão nossa).

---

## Dependencies

Stack verificada no estudo da tag (`[ESTUDO]`; confirmar no package.json do fork):

| Camada | Tecnologia |
|---|---|
| Runtime | Node 26.7.0, pnpm 11.24.0 (Corepack), `minimumReleaseAge: 4320min` (proteção supply-chain) |
| Frontend | Vue 3.5, Vue Router 5, Pinia 4 (`pinia-plugin-synced`, `@pinia/colada`), VueUse 14, UnoCSS 66.7, reka-ui, vue-i18n 11 |
| Build | Vite 8.2, electron-vite 5, Turbo 2.10, tsdown, unplugin-*, vite-plugin-pwa |
| Linguagem | TypeScript 6.0 |
| Desktop | Electron 43.4 + electron-builder 26 (Electron ≥42 removeu postinstall; scripts rodam `install-electron` antes) |
| Mobile | Capacitor 8 (Kotlin/Swift) |
| IA/LLM | **xsai** 0.5.0-beta.8 (+ `@xsai-ext/providers`), Valibot, zod, MCP SDK |
| Local/WebAI | `@huggingface/transformers` 3.8.1 + onnxruntime-web 1.27, VAD `@ricky0123/vad-web`, Apple Speech (macOS 26+) |
| Renderers | PixiJS 6 + pixi-live2d-display 0.4 (patched), Three.js 0.185 + three-vrm 3.5, Spine 4.x, wlipsync, Rive, MediaPipe tasks-vision |
| Dados | DuckDB-WASM + Drizzle, PGlite + pgvector, PostgreSQL + Redis (backend), localforage/idb-keyval, localStorage (settings) |
| Backend | Hono 4.13, Better Auth 1.6, Caddy, OpenTelemetry, Resend, Stripe |
| Qualidade | Vitest 4 (+ browser mode/Playwright), histoire, ESLint (antfu) + oxlint, `moeru-lint`, publint/attw, cspell, knip |
| Testes E2E/visual | Playwright, `vishot` (capturas), cenários tamagotchi |
| Patches mantidos | `mineflayer-pathfinder`, `pixi-live2d-display`, `sponsorkit`, `tab-election`, `uiohook-napi` |

**Ferramenta da base atual (Lia), fora do produto:** DevKit (`tools/project_cli.py`) — Python 3.10+, git; `node`/`gh` opcionais. Não é dependency do produto.

---

## Desktop/Packaging

Como a aplicação é empacotada hoje `[ESTUDO]`:

- **App desktop = `stage-tamagotchi`** (Electron 43.4 + electron-vite 5). Identidade definida em `electron-builder.config.ts`: `appId: 'ai.moeru.airi'`, `productName: 'AIRI'`.
- **Processos/estrutura:** `src/main` (processo principal, DI `injeca`), `src/preload` (ponte), `src/renderer` (Vue), `src/shared` (contratos IPC via `@moeru/eventa`).
- **Recursos desktop:** múltiplas janelas, tray, widgets, click-through, overlay, captura de tela, servidor local embutido (server-runtime).
- **Comandos de build:** `pnpm build:tamagotchi` (+ `build:win|mac|linux`, flatpak, deb, rpm, apk/android). Dev precisa `install-electron` antes (Electron ≥42).
- **Instaladores/auto-update:** o upstream gera builds por plataforma (inclusive **nightly** do `main`, experimental). O modelo de **instalador (`LiaSetup.exe`) e auto-update próprio do Lia** **não está resolvido** e é responsabilidade da fase 4 do roadmap — `[UNKNOWN]` quanto a detalhes de assinatura/notarização/auto-update atuais.

---

## Voice

Estado atual do TTS/STT/audio `[ESTUDO]`:

- **Arquitetura:** módulos separados `speech` (TTS) e `hearing` (STT); `pipelines-audio` e `stream-kit` para o pipeline; `speech-runtime` como runtime de fala.
- **TTS providers:** OpenAI, ElevenLabs, Gemini TTS, Azure Speech, Alibaba, Minimax, Index-TTS, Kokoro (local no browser), Player2, Volcengine, CometAPI, MiMo, browser/desktop-local, **VOICEVOX**, **AivisSpeech**. Há **Voice Packs** com preview/recomendação.
- **STT providers:** OpenAI, Deepgram, Aliyun NLS, Web Speech API, browser/desktop-local (transformers.js), Apple Speech on-device (macOS 26+).
- **Conversa por voz:** VAD (`@ricky0123/vad-web`), streaming com correção de transcrição, cancelamento de eco no desktop, fala interrompível. `pipelines-audio` cobre o pipeline de áudio.
- **Componentes de áudio:** pacotes `audio`, `pipelines-audio`, `testing-audio`, `stream-kit`.
- **Voz customizada/clone/conversão (RVC, XTTS, F5, AllTalk, Piper, Edge TTS):** **não é capacidade embutida do AIRI** que o estudo confirme como provider nativo. É **requisito futuro da Lia** (abstração + Voice Engine/Conversion substituíveis) — `[UNKNOWN]` quanto à maturidade de cada engine dentro do pipeline AIRI.

---

## LLM

Estado atual dos providers/modelos `[ESTUDO]`:

- Módulo **`consciousness`** é o cérebro; abstração via **xsai** (SDK próprio "estilo Vercel AI SDK, mínimo") + `@xsai-ext/providers` + Valibot/zod.
- **40+ providers** (lista na §Existing Capabilities), incluindo Groq, Cerebras, OpenRouter, Ollama, LM Studio, vLLM, SGLang, OpenAI-compatible etc.
- **Streaming** presente (via xsai); **tool calling** presente (MCP/tools/plugins); **multimodal/vision** presente (vision module + modelos de visão).
- Catálogo de providers padronizado em `stores/providers/`, carregado **assincronamente** com schemas/onboarding/validadores → boa base para catálogos dinâmicos (sem hardcode de modelos).
- Modelo/Backend/Provider/Hardware: o estudo não evidencia um **task router** multi-provedor (chat ≠ visão ≠ barato ≠ avançado ≠ offline) — isso é uma camada a avaliar para a Lia (AGENTS.md §18-19).

---

## Memory

Estado atual `[ESTUDO]`:

- **Local:** DuckDB-WASM + Drizzle; histórico/dados no browser/Electron; **diário e `image_journal`** (memória com imagens); embeddings locais via transformers.js.
- **Longo prazo (hospedado):** `memory-pgvector` com PostgreSQL/pgvector no backend.
- Memória é usada na construção de contexto de conversa; a personagem carrega contexto (card + memória + tools).
- Não há evidência no estudo de uma separação explícita curto/médio/longo prazo com controles de usuário (visualizar/apagar/limpar) no nível que o AGENTS.md pede — parte é expectativa da Lia.

---

## Vision

Estado atual `[ESTUDO]`:

- Módulo **`vision`** (visão); `electron-screen-capture` para captura de tela no desktop.
- Providers de visão: OpenAI-compatible, Ollama, LM Studio, Cloudflare Workers AI, Azure AI Foundry, Bedrock, Gemini.
- **Screen capture** existe no desktop (electron-screen-capture). Controles de permissão/perfis (OFF/ON DEMAND/PERIODIC/CONTINUOUS), default OFF e consentimento explícito são **política da Lia** a implementar por cima.

---

## Computer Use

Estado atual `[ESTUDO]`:

- **`services/computer-use-mcp`**: servidor **MCP** de computer use (o agente controla o computador).
- Há store **`mcp`** + **`mcp-tool-bridge`** conectando ferramentas MCP ao agente.
- Jogo usa "aval" (`vieval`) para ações (ex.: chess gamelet), sugerindo um mecanismo de confirmação.
- **Planner + permission layer + kill switch** (LLM → Planner → Permission → Tool → OS), permissões por risco, revogáveis — **não evidenciado no estudo como camada madura**; é requisito de produto da Lia (AGENTS.md §36-38) a ser projetado sobre o MCP do AIRI (reusar) + camada de política nossa.

---

## Discord

Estado atual `[ESTUDO]`:

- **`integrations/discord-bot`** (discord.js + `@discordjs/voice`) → suporta **texto e voz**.
- Fala com o Stage via **server channel** (`server-sdk` ⇄ `server-runtime`).
- É um adapter/integração — não amarra personalidade. Auth de conta hospedada usa OIDC/JWT/Better Auth no backend opcional.

---

## Risks

1. **[ALTO] Analisar com base no estudo, não no código local** — o fork ainda não está no working tree; qualquer afirmação sobre API interna do AIRI precisa revalidação no código real na Fase 0. `[VERIFICADO]`
2. **[ALTO] Beta + upstream veloz** — customizações devem ser isoladas para não gerar conflitos permanentes de rebase.
3. **[ALTO] Peso do toolchain/build** — Node 26.7.0 + pnpm 11.24.0 pinados; builds pesados; exigência de cache no CI; máquina de dev com **16 GB RAM** precisa de cautela com builds paralelos.
4. **[MÉDIO] Licenças de assets/modelos/voz** (Live2D/Cubism, VRM, RVC, XTTS…) — rastrear em `docs/licenses/`.
5. **[MÉDIO] Hardware AMD (RX 580 8 GB)** — backends locais (llama.cpp/ROCm/Vulkan/CPU) têm suporte variável; **não assumir ROCm/CUDA**; exigir fallback. (Ver §Hardware.)
6. **[MÉDIO] pt-BR inexistente** — precisa de locale + personagem + STT/TTS em pt-BR.
7. **[MÉDIO] Riscos de segurança** — secrets, captura de tela, computer use e ações do LLM exigem camada de permissão/kill switch da Lia.
8. **[BAIXO/MÉDIO] Integrações experimentais/deprecadas** não devem virar aposta de produto.
9. **[BAIXO] Divergência de docs de versão** (contribuição cita Node 24 vs `.tool-versions` 26).

---

## Unknowns

Itens que **não puderam ser determinados** na base atual (todos `[UNKNOWN]`, a fechar na revalidação sobre o fork):

1. Detalhes exatos de **IPC/`@moeru/eventa`** (canais, contratos) — não observáveis sem o código.
2. **Injeção de DI (`injeca`)** e pontos de registro de serviços no `src/main`.
3. API real de `stores/providers/` para **adicionar provider sem tocar core** (contrato de schema/onboarding).
4. Maturidade de **streaming/tool-calling/vision** no xsai na versão usada.
5. Existência/nível de **task router** multi-provedor.
6. Separação **curto/médio/longo prazo** da memória e seus controles de usuário.
7. Estado de **VAD/barge-in/eco** e de voz **streaming chunk** dentro do `speech-runtime`/`pipelines-audio`.
8. Como **`speech-runtime`** poderia receber um *Voice Engine* externo (AllTalk/RVC/XTTS/Piper/F5/Edge) substituível.
9. Modelo de **screen capture** (permissão por OS, janelas) e como expor visão de forma consentida.
10. Camada de **permissões computer use** do AIRI (se `vieval` é reusável/generalizável).
11. **Auto-update / assinatura / notarização / distribuição** atuais do desktop.
12. **Localização de dados/estado** (userData, models, cache, logs) no Electron — a confirmar para o layout de diretórios da Lia.
13. Ferramentas/API para **hardware detection** no processo principal (CPU/GPU/VRAM/RAM) — não evidenciadas.
14. Node **26.7.0 + pnpm 11.24.0** reais no ambiente de build/CI (disponibilidade, imagens).
15. Roadmap interno e ritmo de releases futuros do upstream além da beta.5.

---

## Anexo — Hardware de referência (perfil de compatibilidade)

Máquina inicial de dev/teste (do AGENTS.md §88):

- **CPU:** AMD Ryzen 5 5500 · **GPU:** AMD RX 580 8 GB · **RAM:** 16 GB

Uso: como **perfil importante de compatibilidade** para validar backends locais em GPU AMD antiga (RDNA-less / Polaris) e CPU-only, **sem** otimizar a arquitetura exclusivamente para AMD. A arquitetura alvo permanece agnóstica a NVIDIA/AMD/Intel/CPU-only (ver `LIA-ARCHITECTURE.md`).

*Fim do documento AIRI-ANALYSIS.md.*
