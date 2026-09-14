# LIA-INTEGRATION-PLAN — Análise real do AIRI + plano de integração da camada Lia

> **M1 · Lia Shell / Product Foundation · Análise + plano de integração**
> **Data:** 07/09/2026 · **Branch:** `arena/01a07b6d-lia-project`
> **Objetivo:** a pedido da M1, **nova análise específica do AIRI real** — agora que o source
> está fisicamente em `airi/` dentro do repositório — classificando **exatamente** o que será
> (1) reutilizado, (2) estendido, (3) encapsulado, (4) substituído ou (5) deixado intocado,
> para encontrar o **menor caminho** até a "Lia App" **sem duplicar** o que já existe.
> **Companheiros:** UX de produto em `docs/product/UX.md`; recorte de M1 em `docs/product/M1-SCOPE.md`.

---

## 0. Proveniência e método

O AIRI **agora está físico** em `airi/` (esta análise foi feita por **inspeção direta** desses
arquivos no working tree, não por estudo indireto).

| Nível | Marcação | Como foi obtido |
|---|---|---|
| Verificado no código real (pasta `airi/`) | `[V]` | lido/inspecionado diretamente neste working tree |
| Planejado/proposto para a Lia | `[P]` | decisão de desenho da camada Lia (não existe no AIRI) |
| A validar durante a M1 | `[?]` | depende de decisão ou de teste futuro |

**Regras vigentes (memória de M0/M1):**
- **NÃO** refatorar o AIRI; **NÃO** portar/backport `d8e62f12` (falha do typecheck); **NÃO** fazer
  correções no AIRI agora. A camada Lia é **aditiva**.
- Reutilizar > adaptar/encapsular > estender > implementar do zero (> trocar). Deixar intocado
  tudo que já resolve (princípio de `LIA-ARCHITECTURE.md` e `AGENTS.md §94`).

---

## 1. Visão de conjunto do monorepo real (`airi/`) `[V]`

O monorepo AIRI (pnpm + Turborepo) tem estas áreas (verificadas):

| Área | Conteúdo principal | Papel p/ Lia |
|---|---|---|
| `apps/stage-tamagotchi` | **Desktop Electron** (`src/main`, `src/preload`, `src/renderer`, `src/shared`) — o "tamagotchi" validado na M0 | **Shell do produto Lia** (origem; será emoldurada/skin-da-Lia) |
| `apps/stage-web` | App web | reuso indireto (web) |
| `apps/stage-pocket`, `component-calling`, `ui-server-auth` | outros alvos | intocados |
| `packages/stage-ui` | **Biblioteca de UI Vue/Pinia do stage** — stores (chat/character/providers/settings/speech/módulos=órgãos) + componentes | **maior fonte de reuso/estender** |
| `packages/stage-pages`, `stage-layouts`, `stage-shared`, `ui`, `ui-*` | páginas/layouts/compartilhado/componentes base | reuso/estender |
| `packages/i18n` | dicionários por idioma + utils de locale | **estender** (pt-BR) |
| `packages/core-agent`, `core-character`, `ccc` | agent/core/runtime; character (CCv3 em `ccc`) | reuso/estender (character data) |
| `packages/server-runtime`, `server-sdk`, `server-shared` | servidor embutido + websocket ("server channel") | reuso/encapsular (canal auxiliar) |
| `packages/memory-pgvector`, `drizzle-duckdb-wasm`, `duckdb-wasm` | memória local/remota | reuso/encapsular |
| `packages/audio`, `pipelines-audio`, `stream-kit` | áudio/streaming | reuso |
| `packages/stage-ui-live2d/-mmd/-spine/-tachie/-three`, `model-driver-*` | renderizadores de avatar | reuso |
| `packages/electron-eventa`, `electron-vueuse`, `electron-screen-capture` | ponte IPC Electron | reuso |
| `packages/plugin-*` | sistema de plugins/MCP | intocado (M1) |
| `plugins/` (externos), `server/apps` (API), `engines/`, `integrations/` | backend web + integrações externas | intocados |
| `apps/stage-tamagotchi` já depende de quase todos os pacotes `@proj-airi/*` (package.json verificado) | — | confirma que o desktop é o "hub" de integração |

**Modelo de janelas do desktop (verificado):** `apps/stage-tamagotchi/src/main/windows/` contém
`main, chat, settings, onboarding, widgets, editor, caption, notice, spotlight, dashboard,
desktop-overlay, beat-sync, devtools, about, inlay`. O renderer é **um SPA** roteado por hash
(vue-router file-based, `renderer/main.ts` → `App.vue`) onde cada janela carrega uma rota/hash
com um `window-context` (`synced-leader`, `stage-runtime`) — `main` é a janela raiz `#/` e é quem
orquestra a composição (monta as stores dos órgãos no `App.vue`).

---

## 2. Classificação por área (o cerne pedido)

Convenção de colunas: **Decisão** = o que a Lia fará com aquela parte do AIRI
(Reutilizar / Estender / Encapsular / Substituir / Intocada).

### 2.1 stage-tamagotchi (a app desktop) — **REUTILIZAR (origem) + ENCAPSULAR (casca Lia)**
| Sub-área (caminho real) | Decisão | Como a Lia usa |
|---|---|---|
| `src/main` (Electron main, bootkit DI `injeca`, lifecycle) | **Reutilizar / Encapsular** | espinha dorsal do processo; a Lia adiciona a "casca de produto" sem reescrever o boot |
| `src/main/windows/*` (main/chat/settings/onboarding/…) | **Reutilizar** | gerenciadores de janela já prontos; Lia troca *conteúdo/rota* e aparência |
| `src/main/configs/global.ts` | **Encapsular (não editar core)** | Lia cria config própria em **namespace Lia** (ver §7) — não altera o schema do AIRI |
| `src/main/libs/electron/persistence.ts` (`createConfig` + schema valibot, auto-heal, userData) | **Reutilizar + Estender** | base da configuração persistente versionada da Lia (aditiva) |
| `src/main/services/airi/*` (channel-server, godot, mcp, plugins, onboarding, auth…) | **Reutilizar** | serviços já DI-injetados; Lia consome via IPC |
| `src/preload` + `src/shared/eventa` (contratos IPC) | **Reutilizar + Estender** | contratos tipados `@moeru/eventa`; Lia adiciona os seus contratos ao lado |
| `src/renderer` (SPA vue-router por hash + `App.vue`) | **Reutilizar + Estender** | a Home/identidade Lia é nova rota/camada; conversa existente é emoldurada |
| `electron-builder.config.ts` (appId `ai.moeru.airi`, productName `AIRI`, NSIS/win/mac/linux, auto-update) | **Substituir (identidade)** + encapsular | M1 troca **appId/productName/ícone** p/ Lia (patch pontual documentado); mecanismo permanece |
| `package.json`/scripts | Reutilizar | `dev`, `build`, etc. permanecem |

> **Conclusão:** `stage-tamagotchi` é a **origem** do "Lia App". Não se reescreve; a Lia é a
> mesma Electron shell **re-identificada** + novas camadas de produto (Home/settings/status/logs/
> diagnostics) em rota/UI própria, reusando janelas e pipeline.

### 2.2 stage-ui (biblioteca de UI + stores = "órgãos") — **REUTILIZAR + ESTENDER** `[V]`
Maior e mais reutilizável. Exemplos verificados:

| Parte real | Decisão |
|---|---|
| `src/stores/modules/{consciousness,speech,hearing,vision,artistry,web-search,airi-card,default}.ts` | **Reutilizar/encapsular** (órgãos do runtime) — a Lia não reimplementa |
| `src/stores/chat`, `character/`, `characters.ts`, `providers/`, `settings/`, `onboarding.ts`, `modules` | **Reutilizar + estender** |
| `src/components`, `src/composables`, `src/libs/{providers,speech,audio,analytics,pinia}` | **Reutilizar** — base do kit/design system Lia |
| `src/stores/display-models.ts`, `src/stores/modules/airi-card.ts` | **Reutilizar** (personagem = card) |

> **Regra:** componentes novos da Lia entram **por cima** (estender/pacote Lia), importando
> `@proj-airi/stage-ui` — sem editar o package.

### 2.3 onboarding — **REUTILIZAR + ESTENDER** (não é o mesmo que o Setup Wizard futuro) `[V]`
- AIRI tem onboarding **técnico de providers/auth**: store `stage-ui/src/stores/onboarding.ts`
  (gate por provider "essencial" + auth), janela `onboarding`, serviço
  `main/services/airi/onboarding`. Ele decide "configurar fornecedores para começar a conversar".
- **Decisão Lia:** o onboarding AIRI de provider permanece **reutilizado** como etapa interna de
  configuração; a Lia adiciona (M1, leve) um **primeiro-lançamento de produto** (boas-vindas +
  idioma + "usar padrão"), **sem reescrever** o wizard técnico nem criar um segundo pipeline de
  provider. Em M2 esse primeiro-lançamento evolui para o Setup Wizard com perfis/hardware.
- **Intocado** em M1: o fluxo AIRI de escolha de providers/modelo em si.

### 2.4 settings — **REUTILIZAR + REORGANIZAR** (linguagem de produto) `[V]`
- Base rica: janela `settings`, páginas em `renderer/pages/settings/`
  (`account/connection/data/models/modules/system`), mais seções prontas em
  `packages/stage-pages/src/pages/settings/` e `v2/settings/` (`providers, airi-card, models,
  memory, modules, connection, data, scene, system, account`).
- Store `stage-ui/src/stores/settings/` (general/theme/audio/developer/…).
- **Decisão:** reusar o framework de settings/rotas; em M1 reorganizar a **apresentação** com
  linguagem de produto (`UX.md §4/§8`, `§84`), movendo a parte técnica para **Advanced** —
  **não recriar** configurações que já existem (providers, modelos, memória, módulos).

### 2.5 stores — **REUTILIZAR como a espinha de estado** `[V]`
- Padrão do AIRI: **Pinia** + stores em `stage-ui/src/stores/**` e synced entre janelas
  (`stage-ui/libs/pinia`, `setupSynced`, liderança leader/follower via window-context).
- Estado de UI específico do desktop também em `renderer/stores/**`.
- **Decisão:** toda a infra de estado (pinia, synced, colada/pinia) é **reusada**; as stores **Lia**
  novas seguem o mesmo padrão e o mesmo diretório de *leader* (janela main). Nada de store engine novo.

### 2.6 i18n — **ESTENDER (adicionar pt-BR); reusar mecanismo** `[V]`
- `packages/i18n/src/index.ts`: tabela `all`, `localeRemap`, `resolveSupportedLocale`; locais
  atuais **não têm pt-BR** (en, es, fr, ja, ko, ru, vi, zh-Hans, zh-Hant).
- Estrutura: cada locale é uma pasta `src/locales/<lang>/` (ex.: `en/` com `base.yaml`,
  `settings.yaml`, `stage.yaml`, `tamagotchi/*`, `server/*`, `docs/*`) registrada em
  `src/locales/index.ts`.
- Consumo: renderer `vue-i18n` (`renderer/modules/i18n.ts` lê `localStorage 'settings/language'`
  ou `navigator.language` → `resolveSupportedLocale`); main `@intlify/core` (`main/libs/i18n`).
  Composables `use-language.ts` sincronizam renderer↔main.
- **Decisão M1 (`[P]`):**
  1. Adicionar pasta `src/locales/pt-BR/` com os mesmos arquivos (base/settings/stage/tamagotchi/
     server/docs) traduzidos;
  2. Registrar `pt-BR` em `src/locales/index.ts` e em `src/index.ts` (`all`, `localeRemap`:
     `pt-BR`, `pt`, `pt-PT` → `pt-BR`);
  3. Como renderer/main derivam supportedLocales de `Object.keys(messages)`, a detecção automática
     passa a funcionar **sem novo sistema**.
- **Não criar** framework de tradução novo; **não remover** en-US.

### 2.7 character system — **REUTILIZAR + ESTENDER (sem hardcode)** `[V]`
- Dados: CCv3 em `packages/ccc` (`codec/characterCardV3.ts`, parse/validação/export) — **runtime-agnostic**.
- Estado: `stage-ui/src/stores/modules/airi-card.ts` (card ativo/settings), `stores/character/`
  (reactions/notebook/orchestrator), `stores/characters.ts` (biblioteca/service).
- **Decisão:** a **personagem padrão "Lia"** entra como **pack/card** (dados CCv3 + assets), não
  hardcoded (`AGENTS §5/§33`). Biblioteca multi-personagem reusa o mecanismo existente. Nada de
  acoplar identidade do produto a um único personagem.

### 2.8 provider system — **REUTILIZAR + ESTENDER (aditivo)** `[V]`
- Catálogo assíncrono: `stage-ui/src/libs/providers/providers/<provider>` (40+; incl. openai-compatible,
  ollama, openrouter, kokoro-local, voicevox, openai-audio…), `registry.ts`, `provider-definitions`.
- Config: `stage-ui/src/stores/providers/{config,config-defaults,provider}.ts`.
- **Decisão:** reusar o catálogo/registro; providers futuros da Lia entram como **definições**
  aditivas no mesmo padrão — sem tocar no core nem hardcodar modelos (task routing é fase futura).

### 2.9 speech (TTS/STT/voice) — **REUTILIZAR + ENCAPSULAR** `[V]`
- Órgãos em `stage-ui/src/stores/modules/speech.ts` e `hearing.ts`; runtime `stores/speech-runtime.ts`;
  providers speech em `libs/providers/providers/speech-*`; libs `libs/speech`, `libs/audio`,
  `services/speech`; áudio/streaming em `packages/{audio,pipelines-audio,stream-kit}`.
- **Decisão:** o pipeline de voz do AIRI é **reusado** (TTS/STT/VAD/barge-in existentes). A Lia,
  **mais tarde**, adiciona **abstração de voz de produto** (`VoiceEngine`/converter para RVC/XTTS/
  AllTalk) como camada **encapsulada** em cima — **não em M1**. Voice Studio continua **fora**.
- Em M1 a Home apenas expõe estado/atalho de voz usando o que já existe.

### 2.10 memory — **REUTILIZAR + ENCAPSULAR** `[V]`
- Memória local: `@proj-airi/drizzle-duckdb-wasm`/`duckdb-wasm` + `composables/use-duck-db.ts`;
  remota: `packages/memory-pgvector`. Server/API em `server/`.
- **Decisão:** reusar os backends de memória do AIRI; os **controles de usuário** (ativar/ver/apagar/
  limpar; tipos short/episodic/semantic) entram como **camada de produto (encapsular)** — M1 não
  implementa, só prepara o limite de UI no settings.

### 2.11 server channel — **REUTILIZAR + ENCAPSULAR** `[V]`
- Canal auxiliar: `packages/server-runtime` + `server-sdk` + `server-shared`; no desktop,
  serviço `main/services/airi/channel-server` expõe `ws://127.0.0.1:6121` (visto na M0).
- **Decisão:** reutilizar como espinha dorsal para apps auxiliares futuros (ex.: Voice Studio)
  e para o modo "web". A Lia **encapsula** o acesso (não expõe porta na Home). M1 **intocado**.

### 2.12 Electron — **REUTILIZAR (encapsular)** `[V]`
- `apps/stage-tamagotchi/src/main` (bootkit DI/lifecycle, windows, tray, services), pacotes
  `electron-eventa`, `electron-vueuse`, `electron-screen-capture`, single-instance, auto-updater.
- **Decisão:** reaproveitar o app Electron AIRI como a base do Lia App; mudanças de identidade/
  shell são **aditivas/pontuais**, sem refatorar o boot. `app.getPath`/diretórios reusados.

### 2.13 IPC — **REUTILIZAR + ESTENDER** `[V]`
- Contratos tipados `@moeru/eventa` em `src/shared/eventa` + `defineInvokeHandler` no main +
  preload minimalista (`index.ts`).
- **Decisão:** a camada Lia adiciona os **próprios contratos** (`shared/eventa` da Lia) no mesmo
  padrão — sem novo mecanismo de IPC. UI nunca acessa runtime direto (regra do AGENTS).

### 2.14 packaging — **REUTILIZAR + SUBSTITUIR identidade** `[V]`
- `electron-builder.config.ts`: `appId: 'ai.moeru.airi'`, `productName: 'AIRI'`, saídas
  NSIS/win/mac/linux, auto-update `electron-updater` + `github-release-lane`.
- **Decisão M1:** manter o mecanismo; **substituir** identidade de distribuição (appId/productName/
  ícones/metainfo/flatpak) para Lia — como patch de identidade **documentado**, aditivo, sem
  refatorar o config. Instalador/assinatura/notarização só na fase de distribuição (não M1).

---

## 3. Resumo executivo das 5 classificações

| | Itens (real, `[V]`) |
|---|---|
| **1 · Reutilizar diretamente** | todo o runtime/órgãos (`stores/modules/*`, chat, speech/hearing, vision, artistry, providers 40+, memória duckdb/pgvector, CCv3 `ccc`, server channel, renderers de avatar, pinia/synced, IPC eventa, janelas Electron, persistence `createConfig`, roteamento vue-router, kits `stage-ui`/`ui`/`stage-layouts`) |
| **2 · Estender (aditivo)** | i18n → **+pt-BR** (en-US mantido); catálogo de providers (definições novas); character → pack padrão Lia; `createConfig` → schema versionado em namespace Lia; contratos IPC próprios da Lia |
| **3 · Encapsular (wrapper Lia)** | abstração de voz de produto (futura); controle de memória de produto; acesso a server channel; status amigável sobre estado real dos órgãos; Diagnostics/Repair (básico em M1) |
| **4 · Substituir (identidade)** | appId/productName/ícone/metainfo; apresentação da Home/nav/settings (linguagem de produto); a estética do produto (tema/logo Lia) por cima do motor visual |
| **5 · Deixar intocado** | core-agent/core-character internals; plugins externos; `server/apps` (API web); `engines` (godot); `integrations/*`; memory-pgvector/server internos; testes upstream (incl. o que a falha `d8e62f12` tocava — não portar) |

---

## 4. Limites da camada Lia (boundaries)

Princípios que **definem o que é "Lia"** vs "AIRI":

1. **AIRI = runtime/órgão.** Lógica de conversa, voz, memória, providers, avatar permanece nele.
2. **Lia = produto/orquestrador fino.** Identidade, shell/Home, navegação, configuração versionada,
   status amigável, logs, diagnostics, políticas de produto.
3. **Aditivo, não intrusivo.** Código Lia novo em **suas próprias rotas/páginas/pacotes/stores/
   contratos IPC**; importa `@proj-airi/*` e conversa por IPC — não edita o núcleo AIRI.
4. **Dois "idiomas" de configuração:** config do AIRI (schema existente, intocado) + **config Lia**
   versionada em **namespace próprio** (ex.: persistência `createConfig('lia', …)`), que agrega/
   espelha e não colide em rebase.
5. **Documentar patches de identidade** (rebrand appId/nome/ícone) em `docs/upstream/PATCHES` como
   mudanças pontuais rastreadas, para sobreviver a rebases sem virar refactor.
6. **DoD** por feature (`AGENTS.md §79`): typecheck/lint/testes/estados de UI/erros amigáveis/docs.

---

## 5. Menor caminho até a "Lia App" (sem duplicar)

Leitura concreta e sequenciada (detalhe em `M1-SCOPE.md §4`):

1. **Rebrand da shell** (substituir identidade, §2.14/§2.1) + manter a mesma Electron app que roda.
2. **pt-BR/en-US** via estender i18n (§2.6) — barato e imediato, destrava toda UI.
3. **Home/launcher** como **nova rota/destino** que abre a conversa **existente** (chat/janela),
   sem duplicar pipeline. Personagem/card padrão Lia como dados (§2.7).
4. **Config persistente Lia** sobre `createConfig` (namespace Lia, §2.1/§7) — versionada.
5. **Status amigável** = tradutor produto→estado sobre os órgãos existentes (§2.2).
6. **Logs colapsáveis + Diagnostics básico** = UI/Advanced que lê o que o runtime já emite.

> Em nenhum passo há reescrita de chat/LLM/voz/memória/provider. A "transformação" é
> **re-identificação + nova camada de apresentação/orquestração**, mantendo o motor AIRI.

---

## 6. Onde vive o código Lia (DECISÃO aprovada) `[V→P, decidido]`

**Decisão (aprovada):** a Lia vive **dentro** do monorepo AIRI incorporado em `airi/`, usando os
**workspaces existentes** do AIRI. **Não** se cria camada externa ao redor de `airi/`, **não** se
cria `apps/lia-shell`, e **não** se criam dezenas de `packages/lia-*`.

Regra de criação de pacote (aprovada):
```
reusar package AIRI  >  estender package AIRI  >  criar package Lia SÓ quando justificado
```
Antes de criar `packages/lia-*`, responder: (1) a responsabilidade já existe no AIRI? (2) pode ser
reutilizada? (3) pode ser estendida? (4) precisa mesmo ser package separado? (5) há dependentes que
justificam a separação? (6) risco de abstração duplicada?

**Implicação prática:** a camada Lia em M1 concentra-se majoritariamente **dentro de
`apps/stage-tamagotchi`** (a mesma Electron app, re-identificada) usando os diretórios que o AIRI já
estabeleceu para esse padrão:
- UI nova em `apps/stage-tamagotchi/src/renderer/` (pages/components/stores Lia);
- contratos IPC da Lia em `apps/stage-tamagotchi/src/shared/` + `preload` (mesmo padrão `eventa`);
- configuração/estado do produto em `apps/stage-tamagotchi/src/main/` (namespace `lia`, reuso de
  `createConfig`);
- i18n pt-BR **estendendo** `packages/i18n` (o único estender de package previsto para M1).

> A árvore final concreta e a lista exata de arquivos criados/modificados estão no documento de
> implementação: `docs/architecture/M1-IMPLEMENTATION-PLAN.md`.

---

## 7. Configuração persistente versionada (reuso + estender) `[V→P]`

- **Reuso:** `main/libs/electron/persistence.ts` provê `createConfig(ns, {default, schema(valibot),
  autoHeal, …})`, persiste em `app.getPath('userData')`, valida e dá diagnostics
  (`ok|missing|invalid|read-error`, `healed`). Hoje não há `schemaVersion` explícito nem migrações.
- **Lia (`[P]`):** novo config em **namespace `lia`** com `schemaVersion` + registro de migrações,
  agregando identidade/idioma/preferências de UI/estado do onboarding. Mantém o schema AIRI intocado.
- Separação de diretórios (config/secrets/userData/models/cache/logs) segue os `app.getPath` do AIRI.

---

## 8. i18n — plano concreto pt-BR (`[P]`, detalhe de §2.6)

Etapas de implementação (pós-aprovação), tudo **dentro** do mecanismo AIRI:
1. `packages/i18n/src/locales/pt-BR/` — espelho dos arquivos de `en/` (`base/settings/stage` +
   `tamagotchi/`, `server/`, `docs/`) traduzidos.
2. Registrar no barrel `src/locales/index.ts`.
3. `src/index.ts`: adicionar `'pt-BR': 'Português (Brasil)'` em `all` e mapeamentos
   `pt-BR`, `pt`, `pt-PT` → `pt-BR` em `localeRemap`.
4. Renderer e main passam a detectar pt-BR automaticamente (`Object.keys(messages)`, `use-language.ts`).
5. `UI Language` default: pt-BR quando o SO for `pt*`, senão en-US (fallback `en` mantido).
- **Não** criar tradutor novo; **não** quebrar `en`.

---

## 9. Decisões de arquitetura — RESOLVIDAS (M1 Part 1 aprovada)

As decisões em aberto foram fechadas. Resumo normativo (fonte: revisão de aprovação da M1 Part 1):

| # | Decisão | Resolução |
|---|---|---|
| Layout da Lia | dentro do monorepo AIRI (`airi/`), workspaces existentes, **sem** camada externa, **sem** `apps/lia-shell`, **sem** dezenas de `packages/lia-*`; reusar/estender primeiro (§6). |
| Desktop app | `apps/stage-tamagotchi` é a **base direta** da Lia; transformação `stage-tamagotchi → reidentificado como Lia`; shell/lifecycle/windows/IPC/runtime reutilizados; **não** duplicar nem renomear diretórios por estética. |
| Electron rebrand | autorizado apenas o necessário: `appId`, `productName`, ícones, metadados de distribuição, identifiers de branding. **Não** alterar boot/lifecycle/DI/arquitetura IPC/window architecture/runtime AIRI. Tratar como **"Lia identity patch"** documentado em `docs/upstream/`. |
| Lia boundary | AIRI = runtime/órgãos/engines; Lia = produto/UX/config/orquestração/políticas. Camada **aditiva**. Não modificar core-agent/core-character para a Home. Não duplicar chat/consciousness/speech/hearing/memory/vision/providers/avatar/MCP. |
| i18n | reutilizar o sistema AIRI; **sem** framework novo; adicionar **pt-BR**, manter en/en-US fallback. Prioridade de tradução: Lia Home/onboarding/settings/dialogs/errors/status/navigation. Advanced pode usar en-US inicialmente. Não quebrar idiomas existentes. |
| Home | camada de produto **sobre** o stage-tamagotchi; **não** substituir o chat. Home apresenta Lia + avatar + status amigável + ação de conversa + fala (quando disponível) + entretenimento/atalhos futuros + settings + diagnostics + mostrar/ocultar logs. Chat AIRI permanece reutilizado. |
| Status (M1) | **só apresentação** de status (ex.: ● IA pronta · ● Voz pronta · ● Memória pronta · ○ Discord desligado · 🔒 Controle do PC bloqueado). Detecção detalhada (CPU/GPU/VRAM/RAM/Vulkan/CUDA/ROCm) é **M2**. |
| Config | reusar `createConfig(...)`; **não** modificar `configs/global.ts`; **namespace Lia** separado; `schemaVersion` + migrações **só se necessário**; Lia config contém apenas estado/config específica do produto Lia (não duplicar todas as configs do AIRI). |
| Logging | M1 cria base de log **display** + apresentação de erro amigável + status. **Não** criar segunda infra de logging se o AIRI já tiver adequada — **investigar e reutilizar primeiro**. Home tem "[ Mostrar logs ]"; log técnico segue disponível. |

> Micro-decisões restantes (a fechar no início de cada fase de implementação, **não bloqueiam**):
> ponto exato de montagem da Home no main window (landing padrão vs destino acionável), escopo do
> reuso do auto-updater feed/single-instance key (não mexer em M1), e grau de pt-BR das telas
> técnicas (Advanced en-US inicial). Ver `docs/architecture/M1-IMPLEMENTATION-PLAN.md`.

**Ordem de implementação da M1 (aprovada):** Fase 1 Electron identity · 2 Lia shell/Home ·
3 Navigation · 4 pt-BR+en-US · 5 Lia config · 6 status abstraction · 7 logs/friendly errors ·
8 settings reorganization · 9 tests · 10 documentation.

---

## 10. Riscos de integração

1. **Escopo de rebrand** que escorre para refactor do AIRI → manter pontual/documentado (rules M0/M1).
2. **Config Lia** que colida com schema AIRI em rebase → usar namespace próprio (mitigado §7).
3. **Duplicação de estado/UI** ao criar Home/settings sem reusar stores → usar pinia/stores AIRI.
4. **i18n parcial** deixando UI "mista" pt-BR/en-US → fallback `en` do AIRI evita quebra, mas a
   tradução de telas técnicas é trabalho de M1 a calibrar.
5. **Diagnostics básico** virar M2 (hardware/profiles) → conter o escopo (§2.9 M1-SCOPE).
6. **Distância do upstream** — camada Lia aditiva + patches de identidade documentados reduzem fricção.

*Fim do documento `LIA-INTEGRATION-PLAN.md`.*
