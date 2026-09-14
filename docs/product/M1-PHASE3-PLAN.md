# M1 Phase 3 — Navigation (Home ↔ Stage) + Audição de runtime / preparação de domínio

> **M1 · Lia — Plano de auditoria e planejamento da Phase 3**
> **Data:** 07/09/2026 · **Branch:** `arena/01a07b6d-lia-project`
> **Base:** M1 Phase 1 (identity) e Phase 2 (shell/Home) **aprovadas e validadas** na máquina real.
> **Natureza deste documento:** **AUDITORIA + PLANO**. Nenhuma implementação é feita nesta etapa —
> após a aprovação deste plano, a implementação acontece em commits pequenos/atômicos.
> **Contexto normativo:** `AGENTS.md`, `docs/product/UX.md`, `docs/product/M1-SCOPE.md`,
> `docs/architecture/LIA-INTEGRATION-PLAN.md`, `docs/architecture/LIA-ARCHITECTURE.md`.

---

## 0. Objetivo da Phase 3

Fechar o ciclo de **navegação entre os dois modos do produto na mesma main window** — a transição
**Home → Stage** já existe (Fase 2) e precisa de um retorno **Stage → Home** de produto, com
transições robustas (window sizing contextual + lifecycle da janela) e **sem** destruir/recriar o
runtime desnecessariamente. Em paralelo, a Phase 3 é uma **auditoria aprofundada dos domínios** que a
Phase 4+ vai consumir (modelo/avatar, personagem, voz/áudio, provider/LLM, configuração da Lia,
identidade/distribuição), deixando **decidido** o que é `REUTILIZAR / ESTENDER / ENCAPSULAR /
SUBSTITUIR / INTACTO` para cada necessidade futura — sem criar features novas nesta rodada.

Regras de trabalho seguidas nesta auditoria:
- Auditoria + plano primeiro; **não** implementar ainda.
- Reusar mecanismos AIRI; preservar internals `@proj-airi/*` quando adequados.
- Não criar packages `@lia/*` por organização nominal; não duplicar runtime/renderer/chat/persistência.
- Lia = produto/UX/orquestração/política; AIRI = runtime/órgãos/infra.

---

## 1. Problemas de UX que a Phase 3 resolve

1. **Não dá para voltar à Home a partir do Stage.** Hoje o Stage não oferece affordance de retorno; o
   usuário que abriu o Stage via CONVERSAR fica "preso" até reabrir/recarregar a janela. UX.md §4 pede
   "voltar claro".
2. **Transição com tamanho correto (já parcial em Fase 2).** Ao ir Home→Stage o tamanho muda
   (460×640 → 800×1000) e persiste por contexto; falta garantir o **retorno** restaura o modo Home de
   forma simétrica (o `setContext('home')` já existe e ficou pronto na Fase 2 para este ponto).
3. **Riscos de lifecycle ao navegar.** O Stage é inicializado a partir do `initialRoutePath` em
   `App.vue`; entrar no Stage **depois** de abrir na Home pode diferir de abrir direto em `/` (ver
   §2.1) — precisa ser validado/normalizado para não "parecer quebrado" ou perder comportamento.
4. **Preparação dos domínios** (personagem, voz, provider) para as próximas fases **sem** forçar UX
   de painel administrativo — o usuário leigo continua vendo produto, não dev-tools.

---

## 2. Estado atual encontrado no código

### 2.1 Navegação e lifecycle (domínio principal da Phase 3)
- Roteamento: um único renderer na main window com `createWebHashHistory` + auto-routes + layouts
  (`apps/stage-tamagotchi/src/renderer/main.ts`). Home = `pages/home.vue` (`/home`, sem `<route>` meta
  → cai no layout `default`; a Home renderiza a própria TitleBar e conteúdo). Stage = `pages/index.vue`
  (`/`, `<route meta layout: stage>`, monta `WidgetStage` + `ControlsIsland` + `ResourceStatusIsland`).
- Landing em `/home`: `main/windows/main/index.ts` → `load(..., withHashRoute(...,'/home',{query:{
  'synced-leader':'true'}}))`.
- Transição Home→Stage: `home.vue::goConversar()` chama `setMainWindowContext({mode:'stage'})`
  (eventa) e depois `router.push('/')`. Resize contextual em `main/windows/main/window-sizing.ts`
  (presets `HOME_WINDOW_PRESET=460×640`, `STAGE_WINDOW_PRESET=800×1000`, persistência por modo em
  namespace `lia`/`main-window.json`). `setContext('home', {recenter})` já existe e está **pronto**
  para o retorno (Phase 2 deixou conectado só o Stage; o Home aguarda a navegação de retorno).
- **Sem affordance de retorno no Stage** (confirmado: nenhum `push('/home')` em `pages/index.vue`;
  o `controls-island` tem settings/refresh/recenter/tema/always-on-top/quit e um chat dev-only).
- **Nuance de lifecycle (achado importante):** em `renderer/App.vue` os flags derivam de
  `initialRoutePath` (resolvido uma vez no setup): `usesGodotStage = initialRoutePath==='/' || starts
  '/settings'`, `isWidgetsWindow`, etc. Como a landing é `/home`, ao entrar no Stage via rota o
  `usesGodotStage` continua **false** (não busca status do Godot em `initialize()`), diferentemente de
  quem abre direto em `/`. O `fullStageRuntime` é criado para o leader independentemente da rota e o
  `WidgetStage` monta/desmonta por troca de rota — ou seja, **navegar não recria o runtime** (fica no
  App.vue), mas há lógica **one-time baseada na rota inicial** que precisa de auditoria/validação.
- `window-context.ts`: leadership = `synced-leader` (`true` → `leader-only`); `stage-runtime=minimal`
  (usado pelas outras janelas). Home é leader.

### 2.2 Modelo / avatar
- `packages/stage-ui/src/stores/display-models.ts`: modelos de exibição com presets embutidos
  (Live2D Hiyori, VRM AvatarSample A/B) + **importação de arquivo do usuário** persistida em
  IndexedDB via `localforage` (formato `DisplayModel`, campos `format/type/url|file/previewImage`).
- Seleção ativa persistida em `useSettingsStageModel` (`stores/settings/stage-model.ts`): localStorage
  `settings/stage/model` (default `preset-live2d-1`), sincronizado cross-window via pinia-synced.
  `stageModelSelectedDisplayModel` resolve o modelo; `previewImage` alimenta a Home (fallback Lia em
  `home.vue`). Renderer: `StageModelRenderer` (`live2d|vrm|spine|tachie|mmd|godot|disabled`).
- Render no Stage via `WidgetStage` (`packages/stage-ui/src/components/scenes/Stage.vue`), models em
  `stage-ui-three` (`VRMModel.vue`, Live2D, etc.).
- **Framing:** `modelOffset` (x,y,z) + view-control em `stage-ui-three/src/stores/model-store.ts` /
  `view-control.ts` (persistido em `settings/stage-ui-three/*`); cada cena/modelo define um default.
  **Não existe hoje** um conceito "preset de framing da Lia" (não há abstração de presets de câmera
  por personagem/modo). Enquadramento é controlado pelo renderer/scene.

### 2.3 Personagem / persona / CCC
- `packages/stage-ui/src/stores/character/index.ts` (`useCharacterStore`) — reações/streaming; ligado a
  `useAiriCardStore` (nome/persona/system prompt). `character/orchestrator/` = orquestração de ações;
  `character/notebook.ts` = memória/notebook. **CCC** em `packages/ccc`.
- Persona atual vem do **active "airi-card"** (`useAiriCardStore`, em `stores/modules/airi-card.ts`):
  `activeCard.name/systemPrompt/...`. **Não existe** persona "Lia" por default configurada no produto
  (a identidade visual "Lia" existe, mas o personagem ativo/CCC usa o mecanismo AIRI genérico).

### 2.4 Voz / áudio
- **Speech (TTS):** `packages/stage-ui/src/stores/modules/speech.ts` → `@xsai/generate-speech`; estado
  persistido em `settings/speech/*` (active-provider default `speech-noop`, model, voice, pitch, rate,
  ssml). Providers speech/streaming oficiais via `libs/providers/providers/official`. Voice packs.
- **Hearing/STT/VAD:** `stores/modules/hearing.ts` → `@xsai/generate-transcription`,
  `stream-transcription`, VAD worklet (`workers/vad`), `vad-streaming-session`,
  `streaming-transcription-consumers` (consumidores/barge-in/auto-turn), providers apple-speech,
  browser-web-speech-api, oficial. `@proj-airi/pipelines-audio` / `@proj-airi/audio` (encoding).
- **Speech runtime:** `stores/speech-runtime.ts` (citado pelo character store). Barge-in/pausa no
  `speech-runtime`/consumidores.
- **Configuração de áudio/dispositivos:** `useSettingsAudioDevice` (settings audio device).
- **Provider efetivamente configurado:** default TTS = `speech-noop`, sem provider de voz chaveado —
  infraestrutura **pronta**, provider **não configurado** (mesma classificação UNKNOWN da QA de M1).

### 2.5 LLM / providers
- `packages/stage-ui/src/stores/providers/provider.ts` (`useProviderStore`) e `providers/config.ts`
  (`useProviderConfigStore`): representam providers de chat/embed/speech/transcription; metadados em
  `libs/providers` (definitions, metadata, validators). Config persistida em localStorage
  `settings/providers/configured` + `settings/providers/added` (+ migração de
  `settings/credentials/providers`), sincronizada com **servidor remoto** (`composables/api` /
  `service.createRemote`).
- Modelos: `@xsai/*` (generate-chat via `useChatStore`/`chat.ts`, stream-store, session-store).
  Validação de provider em `libs/providers/validators`.
- **OpenAI-compatible / custom provider:** a infra de providers do xsai já modela provider genérico
  com `baseURL`/apiKey na camada de config; **exposição simples** de um endpoint OpenAI-compatible é
  um ponto a estender futuramente (definição de provider + tela de produto), **não** criar integração
  Groq/Cerebras específica agora.

### 2.6 Configuração da Lia / persistência
- Namespaces `createConfig` existentes: `app` (`options.json`, global: language, shortcut, updateChannel),
  `artistry`, `extensions`, `lia` (**só `main-window.json` hoje** — adicionado na Fase 2),
  `server-channel`, `windows-caption`, `windows-widgets`.
- Config persistente do renderer = `useLocalStorage*` (namespaces `settings/*`) + pinia-synced.
- **Não existe hoje** `schemaVersion` em nenhum schema de config da Lia; o mecanismo `createConfig`
  (`libs/electron/persistence.ts`) tem `setup/get/update` + autoHeal, mas **sem migrações versionadas**.
- i18n: `packages/i18n/src/locales/{en,pt-BR}/...`; pt-BR mínimo (Home) + en-US. `app` `options.json`
  `language` é a fonte do main; renderer `settings/general.ts` `language` (localStorage).

### 2.7 UX da Home (o que precisa entrar nesta Phase)
- Home hoje: personagem (preview), greeting, status de apresentação, CONVERSAR, atalhos (Personagem/
  Voz/Configurações/Diagnósticos), logs colapsáveis reais, pt-BR/en-US. Sizing Home/Stage.
- Nesta Phase, a Home **não** vira dashboard. Entram: affordance de retorno (lado Stage) e a garantia
  de transição limpa. O restante dos melhoramentos de Home são Phase 4+.

### 2.8 Distribuição / App identity
- `electron-builder.config.ts`: `appId: 'ai.lia.app'`, `productName: 'Lia'`; `executableName:
  'airi'` **mantido**; mac/win/linux `publish` feed + `extraMetadata.name` **deixados como upstream
  AIRI** (comentário explícito: adiar identidade de distribuição). `electronApp.setAppUserModelId('ai.lia.app')`
  no main; single-instance/cache/updater = upstream AIRI.
- Gap mapeado (não alterar agora): separar feed de update/canais, executável, assinatura/notarização,
  ícones por plataforma e identidade de *installer* para futuras builds "Lia" (fases de distribuição).

---

## 3. Classificação AIRI × Lia (componentes a reutilizar / estender / etc.)

Legenda: **REUTILIZAR** = usar como está · **ESTENDER** = adicionar ponto de encaixe sem tocar no
núcleo · **ENCAPSULAR** = envolver com camada fina de produto · **SUBSTITUIR** = trocar (evitar,
justificar) · **INTACTO** = não tocar.

### 3.1 Navegação / window (Phase 3 — implementável)
| Item | Classificação | Observação |
|---|---|---|
| Hash router + auto-routes + layouts AIRI | **REUTILIZAR** | Transições Home↔Stage por `router.push` na mesma janela. |
| `main/windows/main/window-sizing.ts` (setContext home/stage + presets + persistência por modo) | **REUTILIZAR / ESTENDER (leve)** | Já tem `setContext('home',{recenter})`; adicionar o disparo de retorno é a única extensão de uso (não mexer na lógica/presets). |
| Eventa `electronSetMainWindowContext` + IPC | **REUTILIZAR** | Reusar no retorno; só chamar `mode:'home'`. |
| `fullStageRuntime` (App.vue) permanece no topo (não recriar por rota) | **REUTILIZAR** | Evita destroy/recreate. Auditoria de flags `initialRoutePath`-dependentes (2.1) para normalizar entrada tardia no Stage. |
| `controls-island` (Stage) — ponto de inserir ação "Home"/voltar | **ESTENDER (UX)** | Adicionar controle de produto de retorno na UI do Stage (camada Lia) sem refatorar o island. |
| Resize manual `ResizeHandler.vue` / `useElectronWindowResize` | **INTACTO** | Não alterar. |

### 3.2 Modelo / avatar
| Item | Classificação | Observação |
|---|---|---|
| `useSettingsStageModel` + `stageModelSelectedDisplayModel` | **REUTILIZAR** | Fonte da seleção/preview; nada a duplicar. |
| `display-models.ts` (presets + import IndexedDB + previewImage) | **REUTILIZAR** | Adicionar um **default de identidade "Lia"** (se aprovado) é **ESTENDER** (novo preset), não duplicar renderer. |
| `WidgetStage`/`stage-ui-three` (render) | **INTACTO** (Phase 3) | Não implementar presets de framing agora; apenas mapear. |
| Preset de framing da Lia | **ESTENDER (futuro, não nesta Phase)** | Reusar `modelOffset`/view-control; propor abstração de preset só numa fase própria, sem duplicar renderer. |

### 3.3 Personagem
| Item | Classificação | Observação |
|---|---|---|
| `useCharacterStore` + `character/notebook` + `character/orchestrator` | **REUTILIZAR** | Órgãos de personagem. |
| `useAiriCardStore` (active card → persona/system prompt/nome) | **REUTILIZAR / ENCAPSULAR (futuro)** | Persona "Lia" = um **default/active airi-card** do produto; encapsular defaults numa camada Lia de configuração, **sem** sistema paralelo de persona. |
| Personalização futura pelo usuário | **INTACTO** (fora da Phase 3) | Só planejar ponto de encaixe. |

### 3.4 Voz / áudio
| Item | Classificação | Observação |
|---|---|---|
| `speech.ts` (TTS) + `@xsai/generate-speech` | **REUTILIZAR** | Infra pronta. |
| `hearing.ts` (STT/stream/VAD) + worklet + `pipelines-audio` | **REUTILIZAR** | Infra pronta (VAD/barge-in no `streaming-transcription-consumers`/`speech-runtime`). |
| `useSettingsAudioDevice` (áudio/device) | **REUTILIZAR** | |
| Provider efetivo de voz (noop hoje) | **INTACTO** (configuração em fase futura) | Não clonar voz/RVC/AllTalk/Voice Studio agora; só mapear o ponto correto (config de provider de speech + voice) para quando houver provider chaveado. |

### 3.5 LLM / providers
| Item | Classificação | Observação |
|---|---|---|
| `useProviderStore` / `useProviderConfigStore` / `libs/providers` | **REUTILIZAR** | Arquitetura de providers (chat/embed/speech/transcription) é a base. |
| `chat.ts`/`useChatStore` + session/stream stores | **REUTILIZAR** | Não duplicar sistema de chat. |
| Exposição simples de um provider OpenAI-compatible (futuro) | **ESTENDER (futuro)** | Adicionar definição + tela de produto sobre a camada existente; **não** hardcodar Groq/Cerebras. |
| Validação/metadados de provider | **REUTILIZAR** | |

### 3.6 Configuração da Lia
| Item | Classificação | Observação |
|---|---|---|
| `createConfig` (`libs/electron/persistence.ts`) | **REUTILIZAR** | Base de persistência. |
| Namespace `lia` | **ESTENDER** | Hoje só `main-window.json`. Evoluir para um namespace `lia` versionado (config de produto) **sem** colidir com `app`/`artistry` etc. |
| `schemaVersion` + migrações | **ESTENDER (novo)** | Adicionar `schemaVersion` e uma migração simples ao mecanismo da Lia (camada fina), preservando o AIRI. |
| i18n (pt-BR/en-US) | **REUTILIZAR** | Usar `packages/i18n` existente; nada de framework novo. |

### 3.7 UX da Home
| Item | Classificação | Observação |
|---|---|---|
| Layout da Home já aprovado | **INTACTO** | Não re-redesenhar; só garantir transição/voltar. |
| Home como produto (não dashboard) | **REUTILIZAR (política)** | Manter princípio `UX.md §1/§42`. |
| Diagnostics/Advanced | **INTACTO** (acesso já existe via settings) | Continua secundário/colapsado. |

### 3.8 Distribuição / identity
| Item | Classificação | Observação |
|---|---|---|
| appId/productName atuais (`ai.lia.app` / `Lia`) | **INTACTO** | Não mudar agora. |
| executableName / publish feed / extraMetadata | **INTACTO** | Continua AIRI até fase de distribuição; só mapear gap (2.8). |
| Updater/canais | **INTACTO** | Não alterar sem decisão explícita. |

---

## 4. Decisões de arquitetura (propostas para aprovação)

1. **Transições na mesma janela** — Home↔Stage via `router.push` + `setMainWindowContext` (mesma
   webContents; runtime fica no App.vue e **não** é recriado). **Sem** segunda janela/renderer.
2. **Retorno Stage→Home** é o item implementável central: affordance de produto no Stage que chama
   `setMainWindowContext({mode:'home'})` + `router.push('/home')`; restaurar a Home e o tamanho do
   modo Home (já persistido). **Não** alterar presets nem a lógica de persistência por modo.
3. **Normalizar flags de lifecycle** derivados de `initialRoutePath` em `App.vue` somente se a
   validação na máquina real mostrar diferença real entre "abrir direto em `/`" e "entrar via Home"
   (ex.: status Godot). Alteração mínima, com teste, sem mexer no Stage internals.
4. **Persona "Lia"** = um **default active airi-card** (configuração de produto no namespace `lia`),
   não um sistema paralelo de persona/CCC. **Fica** para a fase de personagem (não nesta Phase).
5. **Voz/LLM**: nesta Phase, **apenas mapear e não implementar**. Toda configuração de provider
   futura reusa `useProviderStore`/`config` + tela de produto.
6. **Config da Lia versionada**: evoluir o namespace `lia` para guardar produto (identity display,
   persona default id, framing default, preferências de UX), adicionar `schemaVersion` e migração —
   como adição fina, sem refatorar o AIRI.
7. **Distribuição**: manter `executableName`/feed/updater AIRI; apenas registrar o gap em doc.

> As decisões 1–3 formam o **escopo implementável imediato da Phase 3 (navegação)**. As decisões 4–7
> preparam domínios e ficam como planos de fases seguintes (não implementar nesta rodada), exceto se a
> sua aprovação escalar alguma delas.

---

## 5. Proposta de fluxo Home → Stage → Home (Phase 3 imediata)

```
HOME (/home)                          STAGE (/)
  presets 460×640                       presets 800×1000 (persist. própria)
  TitleBar Lia                          personagem imersiva (WidgetStage)
  [CONVERSAR] ----------------------->  [retornar à Home]  ← NOVO (affordance)
      setMainWindowContext('stage')        setMainWindowContext('home')
      router.push('/')                     router.push('/home')
```

- **Home→Stage:** já implementado (não alterar o caminho).
- **Stage→Home (novo):** adicionar uma **ação de produto** visível mas não intrusiva no Stage
  (pequeno controle no `controls-island` do Stage ou overlay próprio da Lia) que execute:
  1. `setMainWindowContext({ mode: 'home' })` (restaura tamanho/posição do modo Home — pronto na Fase 2);
  2. `router.push('/home')` (mesma janela; runtime permanece vivo; Stage desmonta via troca de rota).
- **Confirmações:** sem recriar runtime; `WidgetStage` monta/desmonta limpo; ao voltar ao Stage depois
  o tamanho Stage é restaurado (override persistido) — simétrico ao que já acontece na ida.
- **Anti-objetivos:** não redesenhar o Stage; não mover para outra janela; não alterar window-sizing
  presets/persistência; não mexer no runtime.

---

## 6. Proposta de evolução de personagem (fora do escopo imediato — planejamento)

- **Reusar** CCC/notebook/orchestrator/airi-card.
- Persona default "Lia": persistir como **active airi-card** de produto no namespace `lia`
  (ENCAPSULAR defaults), permitindo futura troca/personalização pelo usuário na tela de produto.
- **Não** criar pipeline paralelo de persona nem "Character System" novo.

## 7. Proposta de evolução de voice/audio (fora do escopo imediato)

- Reusar infra (speech/hearing/VAD/barge-in/pipelines). Manter a **política** (product rules) de que
  voz fica "UNKNOWN" até haver provider configurado.
- Quando entrar provider de voz: adicionar voz/voices ao provider config + UI de produto; clonagem/
  RVC/AllTalk/Voice Studio ficam em fases posteriores (encaminhamento correto, não implementado).

## 8. Proposta de evolução de provider/LLM (fora do escopo imediato)

- Reusar provider store/config. Exposição de provider **OpenAI-compatible**: definição de provider +
  tela de produto "modelo de IA" (conectar modelo/endpoint) — camada Lia sobre a infra.
- **Não** criar integração Groq/Cerebras nem hardcodar provider futuro sem aprovação.

## 9. Persistência / config (evolução)

- Namespace `lia` → guardar config de produto (ex.: `{ schemaVersion, defaults: { activeCardId,
  displayModelDefaultId, ui: {...} } }`). `schemaVersion` presente desde o início.
- Migração: camada fina da Lia sobre `createConfig` (não tocar o core).
- Manter i18n no sistema existente; manter separação config/secrets/userData já existente.

---

## 10. Riscos

1. **Flags one-time por `initialRoutePath`** (`usesGodotStage`, etc.) podem tornar o Stage entrado via
   Home diferente do aberto direto. → Mitigar: validar na máquina real antes de decidir normalizar.
2. **Destruir/recriar runtime** ao navegar — já mitigado por arquitetura (runtime no App.vue), mas
   deve ser confirmado em QA (sem piscadas/recarregamentos indevidos; sem duplicar WebGL/audio).
3. **Regressão do window-sizing** (persistência por modo restaurada na Fase 2). → Não mexer na lógica;
   testar Stage→Home→Stage preserva tamanhos independentes.
4. **"Dashboard-ificação"** da Home — manter política produto; nada de tabelas/endpoints na Home.
5. **Over-engineering de config** — começar `schemaVersion`/migração mínimo; não refatorar AIRI.
6. **Escopo creep** — domínios (voz/provider/persona) entram só como plano; não implementar.

---

## 11. Dependências

- M1 Phase 2 aprovada (base atual). `window-sizing.ts` já expõe `setContext('home')`.
- Existência de affordance de Stage está no `controls-island`/`index.vue` (UI do Stage) — requer apenas
  inserir a ação Lia, sem refatorar o island.
- Para a validação de lifecycle, dependerá da máquina real (Godot/live2d asset flow).
- Config versionada depende só de `createConfig` (existente).

---

## 12. Testes necessários (Phase 3 imediata)

- Unitários onde houver lógica nova (ex.: se houver helper de "navegação de retorno", testar como puro).
- Testes direcionados stage-tamagotchi (Home, window sizing, i18n) — separar **BASELINE** de **LIA
  REGRESSIONS** (baseline conhecido: `live2d-zip-loader.test.ts`, não portar/alterar).
- `pnpm typecheck` (esperado 56/57 baseline), `pnpm build:web`, `pnpm dev:tamagotchi`.

## 13. QA manual

Home→Stage:
- [ ] Home abre 460×640; CONVERSAR → Stage 800×1000; personagem visível; sem espaço absurdo.
- [ ] Stage→Home (novo controle) volta à Home no tamanho persistido do modo Home.
- [ ] Stage→Home→Stage preserva tamanhos **independentes** (persistência por modo intacta).
- [ ] Sem recriação visível de runtime/piscada; sem duplicar áudio/WebGL.
- [ ] Stage entrado via Home == Stage direto (ou diferença documentada/validada — Godot/status).
- [ ] Resoluções 1280×720 · 1366×768 · 1920×1080 · janela pequena; logs colapsáveis continuam ok.

## 14. Critérios objetivos de aprovação (Phase 3)

1. Retorno Stage→Home funciona (produto, não reload) e restaura o modo Home/tamanho.
2. Home→Stage→Home→Stage preserva presets e overrides por modo, sem contaminação.
3. Runtime não é destruído/recriado ao alternar rotas; Stage sem regressão visível.
4. Nenhuma duplicação de chat/runtime/avatar/persistência; nenhum core AIRI refatorado.
5. typecheck/build/testes relevantes ok (baseline separado de regressões Lia).
6. Config `lia` evoluída só quando o item de config for aprovado; nada de feature de domínio
   implementada nesta rodada sem escalonamento.
7. Docs atualizadas.

## 15. Itens explicitamente FORA da Phase 3

- Persona default "Lia"/CCC/personalização (fase própria).
- Qualquer provider de voz/LLM configurado, clonagem de voz/RVC/AllTalk/Voice Studio.
- Integração OpenAI-compatible / Groq / Cerebras.
- Presets de framing da Lia (renderer) / alterar Stage internals/câmera/VRM/Live2D/avatar.
- Resize/persistência de janela além de conectar o retorno (não mexer nos presets).
- Distribuição/updater/executableName/assinatura/notarização.
- Melhoramentos de UX da Home (dashboard) e nova feature geral.
- Alterar baseline AIRI (`d8e62f12` / `live2d-zip-loader`), refatorar AIRI, criar packages `@lia/*`.

---

*Fim do plano de auditoria da Phase 3 — aguardando aprovação para implementação (escopo imediato:
navegação Stage→Home + validação de lifecycle).*
