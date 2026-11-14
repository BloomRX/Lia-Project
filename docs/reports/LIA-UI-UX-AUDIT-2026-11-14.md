# Auditoria UI/UX e proposta de produto — Lia

**Para:** Agente Principal / revisão e planejamento
**Data:** 14/11/2026 · revisão 2 após correção A-1
**Repositório:** `BloomRX/Lia-Project`
**Branch principal:** `arena/01a10290-lia-project`
**SHA atual auditado:** `ae46c495d7da7cd33f4b4da8f4e8cc95b0a867b6`
**SHA da auditoria inicial:** `5ec464edf410008e390e2da4aff32d32537eb69d`
**Branch isolada desta sessão:** `arena/250b337a-lia-project`
**Integração:** merge normal de `ae46c49` nesta branch, commit de merge `1d802cc8229cb133710cb79601e8d58870b3fde8`; sem reset/rebase/force push e sem conflito.
**Equivalência verificada:** `7cb8172..5ec464e` foi apenas documental. `5ec464e..ae46c49` alterou `stage-ui` apenas no gate de ferramentas A-1 (`tools.ts`, `tool-resolver.ts`, `tool-name.ts`, `tool-call-rerun.ts` e testes) e documentação; o diff em `lia-app`, `stage-tamagotchi`, `packages/ui`, `i18n`, `lia/core`, assets e docs de design/UX/marca permaneceu vazio. Assim, os achados de Launcher/Stage continuam válidos; o achado A-1/X-03 foi corrigido e passa a histórico.
**Natureza:** auditoria, revisão documental e proposta. A branch isolada recebeu a implementação do Principal por merge autorizado; esta revisão não criou implementação, UI de ativação, IPC, dependência ou mudança de personalidade/voz/provedores.

**Entregáveis visuais:** [`evidence/lia-ui-ux-audit-2026-11-14/WIREFRAMES-LIA.html`](evidence/lia-ui-ux-audit-2026-11-14/WIREFRAMES-LIA.html) e [`evidence/lia-ui-ux-audit-2026-11-14/manifest.json`](evidence/lia-ui-ux-audit-2026-11-14/manifest.json).
**Evidência desta revisão:** [`evidence/lia-ui-ux-audit-2026-11-14/static-checks-revision-2.json`](evidence/lia-ui-ux-audit-2026-11-14/static-checks-revision-2.json). O HTML e `static-checks.json` original foram preservados byte a byte.

> **Decisão pedida:** revisar esta proposta e autorizar, em rodada separada, a Fase 0/1 do plano. Este documento não autoriza mudança de código, IPC, Persona, segredos, TTS runtime, fallback, discovery, `Lia.bat` ou `DevKit.bat`.

---

## Revisão 2 — sincronização com `ae46c49` e A-1 corrigido

**O que mudou desde a primeira auditoria:** a branch principal avançou três commits a partir de `7cb8172`: `5ec464e` (auditoria documental), `f3facdf` (gate real de habilitação de ferramentas) e `ae46c49` (decisão de produto/documentação). A branch isolada preservou o commit de auditoria `e183cba` e integrou o Principal por merge normal.

**Achado corrigido:** o antigo X-03/A-1 era a ausência de um interruptor real: ferramentas com `defaultActive:false` eram tratadas como desligadas, mas continuavam resolvidas por `getToolsByNames`. Esse defeito **não está presente no HEAD atual**. Em `ae46c49`, `enabledById` e `setToolEnabled` separam habilitação de inclusão ambiente; `activeTools` e `getToolsByNames` filtram habilitação; o executor lança `ToolDisabledError` para objeto capturado antes da desabilitação. Para as ferramentas desse store, envio, rerun e execução respeitam o gate. Resolver uma ferramenta habilitada por nome continua correto.

**Decisão registrada:** `ae46c49` mantém `get_weather`, `image_journal` e `stage_widgets` **habilitadas por padrão e disponíveis sob demanda**. `defaultActive` é apenas inclusão ambiente, não interruptor. A UI de ativação e a persistência entre reinícios **não** foram implementadas; `mcp()`, `debug()`, spark e web-search ainda ficam fora desse store.

**Prioridades ajustadas:** X-03 sai dos P1 abertos. Entra X-04 como melhoria estrutural futura (P2, não bloqueadora da Fase 1): tela de ativação + persistência + escopo honesto das capacidades. Permanecem prioritários onboarding/prontidão, AI Settings, voz/estados, acessibilidade, confirmações destrutivas, consistência Launcher/Stage, design system e experiência para iniciantes.

### Histórico e alcance da correção

| Commit | Papel | Consequência para esta auditoria |
|---|---|---|
| `5ec464edf410008e390e2da4aff32d32537eb69d` | Auditoria de branch; A-1 ainda aberto | Referência histórica, não estado atual do defeito. |
| `f3facdf8f4ec8873221fe70b67e34934e2631496` | Gate real de habilitação e testes | Corrige envio/rerun/execução; não cria UI nem persistência. |
| `ae46c495d7da7cd33f4b4da8f4e8cc95b0a867b6` | Decisão de produto e documentação | Mantém ferramentas sob demanda; adia a tela de ativação. |

O delta `5ec464e..ae46c49` contém nove arquivos: seis de código/testes em `stage-ui` e três documentais (`CURRENT-STATE.md`, relatório A-1 e nota no relatório de estabilização). Não houve mudança nos renderers Launcher/Stage, primitivos de UI, IPC, voz, personalidade ou provedores. A decisão e seus limites estão em [`LIA-A1-TOOL-ENABLEMENT-2026-11-14.md`](LIA-A1-TOOL-ENABLEMENT-2026-11-14.md), §6–8.

| Caminho no SHA atual | Comportamento confirmado por leitura | Limite |
|---|---|---|
| Registro | `enabledById` começa vazio; ausência de escolha significa habilitada (`?? true`). | Não significa que exista uma preferência salva pelo usuário. |
| Lista ambiente | `activeTools` exige `defaultActive !== false` **e** habilitação. | `defaultActive:false` continua não significando desabilitada. |
| Envio e rerun | Ambos passam por `getToolsByNames`, que omite ferramenta desabilitada. | Não foi feito teste de payload contra modelo real nesta revisão. |
| Execução | Wrapper consulta habilitação atual e lança `ToolDisabledError`, inclusive para objeto capturado antes. | CODE-PRESENT; testes de execução do Principal não foram reexecutados aqui. |
| Re-registro/remoção | Não apagam a escolha explícita no mapa por id. | O store está em memória; reinício volta ao padrão habilitado. |
| UI/persistência | Nenhum chamador de produção de `setToolEnabled` encontrado; nenhuma persistência de `enabledById` encontrada. | Não criar tela nesta rodada; decisão já a adia. |

O Principal reportou 31 testes PASS em `f3facdf` (13 store + 11 resolver + 7 rerun + 1 built-in), além de tipos/lint nos arquivos alterados. Isso é **HISTORICAL-PASS**, não uma execução desta revisão. `llm.test.ts` permanece NOT RUN/BLOCKED naquele relatório por falta de build de `stream-kit`. A sincronização entre janelas via `synced.state:true` não equivale a persistência entre reinícios.

### Achados ainda válidos e propostas mantidas

| Achados | Situação nesta revisão | Próxima prioridade proposta |
|---|---|---|
| L-01 | Código inalterado; checagem pura do view-model repetida. Preferência ainda não é prontidão de IA. | Fase 1: onboarding e CTA contextual. |
| S-01/S-02 | Código inalterado; confirmações destrutivas continuam necessárias. | Fase 1: reutilizar padrão de confirmação, sem novo sistema. |
| L-02 | Código inalterado; portas concorrentes de IA e superfície legada permanecem. | Fase 1: ownership e uma porta normal; aguardar decisão. |
| L-03 | Código inalterado; estados/cópias de voz ainda divergem. | Fase 1: estado por capacidade, sem alterar runtime de voz. |
| A-01/A-02 | Código inalterado; contraste recalculado, foco/teclado/nomes seguem como achados estáticos. | Fase 1: corrigir primitivos existentes; validar a11y real. |
| L-04/S-03/X-01/X-02 | Código inalterado; navegação, estados, tema/i18n e conceitos ainda exigem alinhamento. | Fases 2–3, após confiança; sem redesign amplo por estética. |
| X-03/A-1 | Corrigido; não permanece na lista de P1 abertos. | Regressão do gate existente, não novo interruptor. |
| X-04 | Pendência estrutural já registrada e adiada pelo Principal. | P2 de planejamento, execução futura condicionada à autorização. |

**Propostas mantidas:** uma Lia em Launcher/Stage com contrato de estado; preview estático leve; tokens semânticos e reuso de componentes; fluxos W1–W8; referências com “aprender/não copiar”; melhorias rápidas separadas das estruturais; plano por gates e AC-01…AC-21. Não foi repetida a pesquisa externa nem criado um redesign adicional. Para iniciantes, a ordem continua sendo prontidão → próximo passo → recuperação de erro → opções avançadas.

**Decisões ainda necessárias ao Principal:** autorizar Fase 0/1; confirmar ownership de AI Settings; confirmar verdade de voz pronta/personalizada; aprovar paleta AA e thresholds C0–C4; definir quando a UI de capacidades será autorizada, qual será o dono da persistência e como cobrir ferramentas fora do store antes de prometer controle total. A escolha “manter sob demanda, sem UI agora” já está registrada e não é reapresentada como pergunta em aberto.

---

## 0. Método, limites e legenda

Método: leitura do código real de Launcher/Stage; leitura de specs internas; inspeção de conceitos PNG e capturas de cenário commitadas; cálculos estáticos de contraste; checagem pura de view-model; pesquisa de referências externas na rodada inicial; comparação do checkout com a referência histórica e, nesta revisão, com `ae46c49` após merge normal.

| Marcador | Significado |
|---|---|
| **CODE-PRESENT** | Código/artefato existe no SHA auditado; não prova execução. |
| **STATIC-PASS** | Checagem estática/função pura executada nesta auditoria. |
| **HISTORICAL-PASS** | Relatório anterior afirma PASS em ambiente declarado; não é reexecução aqui. |
| **HEURÍSTICA** | Risco inferido do código/fluxo; exige validação runtime/usuários. |
| **NOT TESTED** | Não executado nesta rodada; não confundir com ausência de defeito. |
| **BLOCKED** | Não validado por falta de ferramenta, ambiente, acesso ou autorização. |

**Runtime, browser/a11y e desempenho nesta rodada: BLOCKED.** O sandbox não tem `agent-browser`, Chromium, `xvfb-run`, `pnpm` nem `node_modules` dos apps. A skill `lia-browser-automation` exige CDP/agent-browser e não autoriza instalar ferramentas. Não houve teste com usuários, leitor de tela, Electron real, captura nova do runtime ou medição C0–C4.

As capturas de cenário em `airi/packages/scenarios-stage-tamagotchi-browser/artifacts/raw/` são artefatos commitados, sem `manifest.json` próprio; não provam o runtime atual. Os conceitos em `docs/design/concepts/` são direção visual, não telas implementadas. O relatório de branch `LIA-BRANCH-AUDIT-2026-11-14.md` no SHA de referência reforça que o último baseline funcional ponta a ponta continua `3ef6d11`, que a beta segue bloqueada e que documentação não é prova.

---

## 1. Diagnóstico geral da experiência atual

A Lia já tem base própria de produto: Launcher com Home character-first, tokens/primitivos Lia, configuração de IA com catálogo/cofre, provisioning de voz, e Stage com personagem, chat, ilhas de controle e painéis reais de personalidade, memória e presença. O problema central não é “falta de tudo”; é **continuidade quebrada entre superfícies, estados, vocabulários e expectativas**.

Hoje coexistem três promessas:

1. **Launcher:** hub de preparação, IA, voz e diagnósticos.
2. **Stage gerenciado:** presença/conversa, mas ainda com linguagem, tema e controles herdados do AIRI.
3. **Conceitos:** produto magenta/neon completo, com roupas, extensões, ferramentas, múltiplos monitores e capacidades ainda não aprovadas.

A direção recomendada é **uma Lia, dois modos de uso, um contrato de estado**: Launcher prepara e dá confiança; Stage entrega presença e conversa. O design system deve unificar aparência, estados, foco, idioma e feedback sem reescrever chat, provedores, voz ou renderização de personagem.

### Pontos fortes reais

- Home usa preview estático `LiaHeroImage.png` e não inicia segundo renderer de personagem.
- Tokens semânticos e primitivos `LiaButton`, `LiaPanel`, `LiaStatusChip` já existem no Launcher.
- Preload/fachada IPC e serviço de IA preservam segredos fora do renderer/JSON comum; gravação fail-closed/rollback é requisito de confiança.
- Catálogo canônico é honesto: Groq `ready`; OpenAI-compatível `unavailable`.
- Stage tem personalidade, memória e presença implementadas em código; memória é opt-in/manual e tem confirmação para apagar tudo.
- Rota gerenciada bloqueia `/home` legado dentro do Stage.
- Log técnico do Launcher fica restrito a Diagnósticos.

### Riscos estruturais

- Primeiro uso pode concluir preferência sem deixar a conversa pronta.
- IA tem portas concorrentes e uma tela legada técnica.
- Voz tem estados/cópias divergentes entre Launcher e Stage.
- Ações destrutivas críticas nem sempre têm confirmação/nome acessível.
- Foco, tabs, composer e botões de ícone têm gaps de acessibilidade.
- Tokens Lia, Tailwind cru, hex hardcoded e três mecanismos de strings coexistem.
- Conceitos mostram capacidades futuras como se estivessem disponíveis.
- A-1 foi corrigido em `f3facdf`/`ae46c49`: existe gate real de habilitação. O risco remanescente de UX é não haver UI/persistência para esse gate e haver ferramentas fora do store; um painel futuro não pode prometer controle total antes disso.

---

## 2. Avaliação separada: Launcher e Stage

### 2.1 Launcher

**Papel recomendado:** hub de confiança, preparação, recursos e diagnóstico. Deve responder: “Está pronto? O que falta? Onde roda? Quanto pode custar? Como corrijo?”

| Área | Achado | Evidência | Impacto |
|---|---|---|---|
| Onboarding | “Somente texto” grava `setup.completed=true` e `voice.enabled=false`, mas não configura IA; CTA segue “Conversar com Lia”. | `views/home-vm.ts`, `HomeView.vue`; STATIC-PASS puro | Alto |
| Navegação | Shell troca página por `ref`; hint manda para “aba Configuração”, mas nav tem “IA & Recursos” e gear “Configuração”. | `App.vue`, `home-vm.ts` | Alto |
| IA | Central nova coexiste com `ConfigView` legada: caminho de arquivo, IDs crus, chave; Stage tem outro editor. | `ConfigView.vue`, `AiResourcesView.vue`, `LiaProviderConfig.vue` | Alto |
| Custo/hospedagem | Catálogo não expõe preço/cota; UI atual não diferencia claramente gratuito/local/pago. | `lia/core/src/providers/catalog.ts`, `AiResourcesView.vue` | Alto |
| Voz | Provisioning/retry são bons; página tem pt-BR hardcoded, feedback sem live region, avançado sem `aria-expanded`. | `VoiceView.vue`, `voice-engine-card.vm.ts` | Médio/alto |
| Memória/personalidade | Launcher só expõe `activeCardId` legado; edição real está no Stage. | `ConfigView.vue`, seções Stage | Médio |
| Capacidades | Não há painel normal de capacidades. O gate real existe no store (`enabledById`/`setToolEnabled`), mas sem UI/persistência; a decisão atual mantém as built-ins habilitadas sob demanda. | `stage-ui/.../tools.ts`, `LIA-A1-TOOL-ENABLEMENT-2026-11-14.md` | Médio |
| Visual | CTA primário tem extremo claro com contraste insuficiente; nav usa glifos Unicode heterogêneos. | `styles.css`, `LiaButton.vue`, `App.vue`; cálculo estático | Médio/alto |
| Diagnósticos | Bom isolamento, ainda mostra estados crus e contrato em `<pre>`. | `DiagnosticsView.vue` | Médio |
| Janela | 1320×860 solicitado; rail colapsa em ≤640px; falta prova em DPI/work area pequena. | `main/index.ts`, `App.vue` | Médio |

**Veredito:** bom esqueleto, mas duas gerações de UI sobrepostas. Prioridade: unificar prontidão, IA e voz; capacidades ficam como evolução estrutural honesta, não como nova página imediata.

### 2.2 Stage

**Papel recomendado:** presença da personagem, conversa, controles contextuais e personalização. Não deve virar segundo launcher nem painel administrativo completo.

| Área | Achado | Evidência | Impacto |
|---|---|---|---|
| Presença | Estático/Livre, escala, monitores, pausa, hover-hide e Home existem. Troca entre monitores é posicionamento atômico; não é caminhada contínua. Fullscreen de outros apps/jogos não é detectado. | `presence-service.ts`, `PresenceSection.vue` | Alto |
| Conversa/histórico | Chat reutiliza store/componentes; erros têm humanização; limpar sessão ativa substitui mensagens e persiste, sem confirmação no botão. | `InteractiveArea.vue`, `session-store.ts` | Alto |
| Configurar Lia | Seis seções reais; aparência é contrato vazio; IA pode ser recusada no modo gerenciado. | `LiaConfigPanel.vue`, `sections-contract.ts`, `AppearanceSection.vue` | Alto |
| Acessibilidade | Tabs sem painel/teclado completo; composer com `outline-none`; ícones sem nome acessível ou só `title`. | `LiaConfigPanel.vue`, `InteractiveArea.vue`, `basic-text-area.vue` | Alto |
| Estados | “Loading...” em inglês com flash infinito; hint de drag morto; flash de borda; auto-collapse por tempo/ponteiro. | `pages/index.vue`, `controls-island/index.vue` | Médio/alto |
| Identidade | Superfícies herdadas ainda parecem AIRI light/inglês; painéis Lia misturam neutral/primary e hex. | PNGs de cenário; `PresenceSection.vue` | Médio/alto |
| Janelas | Home 460×640, Stage 800×1000, mínimo 360×480; settings/chat 600×800; clamp existe, prova física pendente. | `window-sizing.ts`, janelas settings/chat | Médio |
| Capacidades | `image_journal`, `stage_widgets`, `get_weather` continuam com `defaultActive:false` apenas como inclusão ambiente e são referenciados sob demanda por `artistryToolReferences`. No HEAD atual, `getToolsByNames` não resolve ferramenta desabilitada; envio/rerun/execução respeitam `enabledById`. Falta UI de ativação e persistência. | `built-in.ts`, `tools.ts:82–137`, `chat.ts:557–559,851–856`, decisão `ae46c49` | Médio |

**Veredito:** presence é o diferencial; confiança depende de controles previsíveis, confirmação destrutiva, foco visível, estado honesto e comunicação correta do gate de capacidades já existente.

### 2.3 Desempenho, arquitetura e Windows

| Área | Achado | Evidência | Direção/guardrail |
|---|---|---|---|
| Processos | Launcher Main concentra cofre/IPC; Stage Main concentra janelas/presença; renderers consomem estado. | `lia-app/src/main`, `stage-tamagotchi/src/main`, preloads | Não mudar contratos IPC por conveniência visual; proposta não migra runtime. |
| Presença Livre | Tick de 100 ms; passo de até 3 px; `setOpacity` a cada tick; janela base 240×360×escala; troca cross-monitor atômica. | `presence-service.ts:76–111` | HEURÍSTICA: pode custar CPU/compositor/GPU; medir antes de adicionar animação/blur/glow. |
| Jogos/fullscreen | `pauseOnFullscreen` consulta `win.isFullScreen()` da própria Lia; UI avisa que outros apps/jogos não são detectados. | `presence-service.ts:87`, `PresenceSection.vue:26–27` | Não prometer “modo jogo” até detecção real, pausa/ocultação e atalho de emergência. |
| Janelas/DPI | Launcher pede 1320×860; Stage Home 460×640, Stage 800×1000, mínimo 360×480; settings/chat 600×800; clamp por work area existe. | `main/index.ts`, `window-sizing.ts`, janelas settings/chat | Prova física pendente: 100/125/150/200%, work area pequena, multi-monitor, unplug, jogo aberto. |
| Dois runtimes | Decisão interna retém Electron/híbrido; segundo runtime `LiaStage.exe` é custo conhecido; gate de arquitetura aberto. | `LIA-DESKTOP-RUNTIME-ARCHITECTURE-DECISION.md`, auditoria de branch | Não propor migração por estética; C0–C4 comparáveis antes de decisão. |
| Launcher leve | Home usa preview estático e não inicia segundo renderer de personagem. | `HomeView.vue`, investigação Home/Stage | Preservar; não trocar por canvas/animação contínua sem medição. |
| Acessibilidade | Tabs sem painel/teclado completo; foco removido em composer/select-tab; ícones sem nome; contraste insuficiente no CTA. | `LiaConfigPanel.vue`, `InteractiveArea.vue`, `select-tab.vue`, cálculo estático | Corrigir primitivos existentes; matriz teclado/leitor/contraste/alvos. |

**Orçamento proposto, não medido:** baseline C0–C4 em repouso, conversa, voz, presença Livre e jogo aberto; mediana/pico por processo/árvore; nenhum efeito contínuo novo sem comparar antes/depois no mesmo host. Movimento essencial da presença tem controle separado de movimento decorativo.

---

## 3. Problemas priorizados por impacto

“Confirmado” significa confirmado no código/cálculo/documento, não em runtime.

| ID | Pri | Problema | Confiança | Impacto | Direção |
|---|---|---|---|---|---|
| G-00 | **P0 gate** | Runtime Windows/a11y/desempenho atual não provado; beta bloqueada. | BLOCKED + docs | Não prometer produto pronto. | Gate oficial e matriz a11y antes de release. |
| L-01 | **P1** | Setup inicial conclui sem IA pronta; CTA promete conversa. | CODE + STATIC-PASS | Clique falha; usuário não sabe corrigir. | Separar preferência de prontidão; CTA contextual. |
| S-01 | **P1** | Limpar chat destrutivo sem confirmação/nome acessível. | CODE-PRESENT | Perda de contexto por acidente. | Confirmação de escopo, cancelar padrão, foco/feedback. |
| S-02 | **P1** | Remover provedor apaga transporte/chaves sem confirmação. | CODE-PRESENT | Perda de configuração/credencial. | Confirmação explícita reutilizando padrão existente. |
| L-02 | **P1** | IA editável em superfícies concorrentes; legada técnica. | CODE-PRESENT | Confusão e edição recusada. | Uma porta normal; legado em Avançado; Stage gerenciado como resumo. |
| L-03 | **P1** | Voz com estado/cópia divergentes. | CODE; runtime BLOCKED | Usuário não sabe se voz funciona. | Projeção única por capacidade; distinguir pronta/personalizada. |
| X-03 | **Corrigido** | Antigo gap: não havia interruptor real; `defaultActive:false` foi confundido com desabilitação. Gate criado em `f3facdf`; decisão em `ae46c49`. | CODE-PRESENT + HISTORICAL-PASS do Principal | Não é P1 aberto. | Manter `enabledById`/`setToolEnabled`; regressão de envio/rerun/execução. |
| X-04 | **P2 estrutural** | Sem UI de ativação nem persistência entre reinícios; `mcp()`, `debug()` e spark/web-search ficam fora do store e não são alcançadas pelo gate. | CODE + decisão `ae46c49` | Painel futuro pode prometer controle que não existe. | Adiar por decisão; quando autorizado, usar o gate existente, dono único de persistência e escopo honesto. |
| A-01 | **P1** | CTA primário: branco sobre `#e545c8` ≈ 3,49:1. | STATIC-PASS | Texto normal abaixo de 4,5:1 AA. | Fundo de ação mais escuro ou texto escuro; neon como acento. |
| A-02 | **P1** | Foco/teclado/nome acessível inconsistentes. | CODE-PRESENT | Usuário de teclado/leitor perde controle. | Corrigir primitivos existentes; matriz accname/teclado. |
| L-04 | **P2** | Navegação sem deep-link/voltar; “Configuração” ambíguo. | CODE-PRESENT | Usuário se perde. | Destinos estáveis, `aria-current`, voltar claro, glossário. |
| S-03 | **P2** | Loading/flash/drag hint/auto-collapse por tempo. | CODE + HEURÍSTICA | Ansiedade e controle some durante uso. | Loading localizado, reduced-motion, não recolher com foco. |
| X-01 | **P2** | Tokens/temas/i18n fragmentados; Stage parece AIRI em superfícies herdadas. | CODE-PRESENT | Produto inconsistente/inacabado. | Tema Lia sobre primitivos existentes; catálogo único de strings. |
| X-02 | **P2** | Conceitos mostram capacidades/branding não aprovados. | CODE-PRESENT | Expectativa falsa e retrabalho. | Conceito como direção; UI production capability-driven. |
| F-01 | **P3** | Caminhada contínua, jogos, extensões, roupas são direção futura. | CODE/docs | Promessa prematura vira suporte. | Specs futuras separadas, sem toggles falsos. |

---

## 4. Proposta de identidade visual

**Objetivo:** Lia reconhecível, calma e premium; anime/cyber/magenta como acento, não como ruído permanente.

### 4.1 Paleta

Manter família escura Lia, mas separar **acento neon** de **fundo de ação/texto**. Proposta estática, não aplicada:

| Papel | Escuro | Claro | Observação |
|---|---|---|---|
| Fundo app | `#0d0a12` | `#f7f4fa` | Base atual escura preservada |
| Superfície | `#17111f` | `#ffffff` | Cards/painéis |
| Superfície elevada | `#1f1629` | `#f2edf6` | Campos/linhas/hover |
| Texto primário | `#f2ecf7` | `#211726` | 15,94:1 no surface escuro; 17,28:1 no branco |
| Texto secundário | `#baadca` | `#5e526b` | 8,23:1 no raised escuro; 6,29:1 no raised claro |
| Ação primária | `#a62b90` | `#a62b90` | Branco 6,23:1 |
| Acento/seleção | `#f58bdf` | `#a62b90` | Neon controlado |
| Foco | `#f58bdf` + gap | `#a62b90` + gap | Anel duplo, não glow |
| Pronto/atenção/erro | `#4ade80` / `#facc15` / `#f87171` | versões escuras a validar | Sempre com texto |

Cálculo atual: branco sobre `#e545c8` = **3,49:1**; branco sobre `#b0359a` = **5,49:1**. O gradiente atual tem região clara insuficiente para texto normal AA. Texto secundário atual `#9b8db0` sobre `#17111f` = **6,01:1**; não deve ser alterado por gosto. Borda `#32244a` sobre `#17111f` = **1,31:1**; decorativa, não única borda de input.

### 4.2 Tipografia

- Windows: `Segoe UI, system-ui, sans-serif`; sem webfont obrigatória.
- Escala: 12 meta/status, 13 ajuda, 14 corpo/controle, 16 card, 20 seção, 24–32 página.
- Entrelinha 1,4–1,5 em corpo. Fonte decorativa só em hero/quote, nunca em erro/campo/label.

### 4.3 Ícones

- Um conjunto SVG local, peso consistente, 16/20/24 com alvo separado do desenho.
- Substituir glifos `● ✦  ◧ ⚙` da nav por ícones nomeados.
- Ícone decorativo `aria-hidden`; nome no botão/link. Verificar licença antes de redistribuir.

### 4.4 Espaçamento, superfícies e geometria

- Escala atual 4/8/12/16/24/32/48; raio 8/10/14/18/pill.
- Página respira; linha de configuração é densa sem perder alvo.
- Evitar card dentro de card dentro de card. Glow só em hero/CTA/seleção rara.

### 4.5 Temas e movimento

- Escuro padrão; claro e alto contraste como temas de primeira classe.
- `prefers-reduced-motion` + opção in-app para movimento não essencial.
- Loading não pisca infinitamente; presença Livre é funcionalidade, não enfeite, e tem orçamento próprio.

### 4.6 Personagem

- Launcher: preview estático leve, asset oficial/licenciado; não iniciar segundo renderer.
- Stage: personagem é protagonista; controles não cobrem rosto/corpo em tamanhos suportados.
- Expressões/roupas só aparecem se o asset/runtime expõe capacidade.

---

## 5. Proposta de design system

### 5.1 Princípios

1. Reutilizar antes de criar; não duplicar chat, select, toast, modal ou avatar.
2. Tokens semânticos; hex fica na camada de tema.
3. Estados são contrato: texto + ícone + ação, não só cor.
4. Normal × Avançado: leigo vê nome/estado/custo/próximo passo; avançado vê endpoint/IDs/caminhos/logs.
5. Capability-driven: conceito não liga toggle.
6. Acessibilidade independe de tema.
7. Nenhuma dependência nova por estética.

### 5.2 Camadas

```text
lia/core / contratos: catálogo, capabilities, lifecycle, presença, memória
Main: segredos, persistência, permissões, janelas, transporte
Renderer Launcher: shell, onboarding, IA & Recursos, Voz, Configurações, Diagnósticos
Renderer Stage: personagem, chat, ilhas, Configurar Lia, presença
Design system Lia: tokens, temas, primitives, estados/cópia, adapters sobre @proj-airi/ui
```

Nenhuma mudança visual justifica novo canal IPC. Deep-link Launcher→Stage, se aprovado, usa contrato existente ou proposta aditiva separada.

### 5.3 Inventário de componentes

| Necessidade | Base existente | Ação proposta |
|---|---|---|
| Botão/CTA | `LiaButton`, `BasicButton` | Manter API; loading/erro/contraste; não criar paralelo. |
| Superfície | `LiaPanel`, cards AIRI | Níveis 0/1/2 e densidade. |
| Status | `LiaStatusChip`, VMs de voz | Vocabulário único; texto + ícone. |
| Campos | `FieldInput/Select/Checkbox/Range` | Wrapper Lia com label/ajuda/erro/foco. |
| Escolha segmentada | `SelectTab` | Usar para modos; corrigir foco; não usar como tabs de navegação. |
| Tabs | `LiaConfigPanel` | Semântica/teclado corretos ou primitivo acessível existente. |
| Confirmação | `DoubleCheckButton`, confirmação de memória | Escopo explícito, cancelar padrão, gestão de foco. |
| Feedback | `vue-sonner`, `role=status/alert` | Toast transitório; inline para campo; página para blocker. |
| Empty/error/loading | Esparsos | Criar só onde falta, sobre tokens. |
| Chat/avatar | `stage-ui`, `core-agent`, renderers | Não duplicar; tema/cópia/controles por adapter. |

### 5.4 Estados e microcopy

Vocabulário mínimo: `Pronto`, `Precisa de configuração`, `Preparando`, `Salvando`, `Erro`, `Indisponível nesta versão`, `Desativado`, `Offline`.

Erro humano: o que aconteceu + o que foi preservado + próximo passo. Exemplo: “Não foi possível salvar a conexão. Sua chave anterior foi mantida. Tentar novamente / Ver detalhes.”

Custo/hospedagem: todo serviço diz “na nuvem”, “no seu computador” ou “no seu servidor”, e se exige chave/custo conhecido. Não prometer cota grátis ilimitada. Enquanto o catálogo não tiver metadata de preço, a UI deve dizer “custo conforme serviço” em vez de inventar “grátis”.

### 5.5 i18n

Um catálogo por domínio com `pt-BR` e `en-US`; migrar gradualmente mapas hardcoded. Glossário: “IA & Recursos”, “Configurações”, “Configurar Lia”, “Modelo de IA”, “Serviço de IA”, “Voz pronta”, “Voz personalizada”.

### 5.6 Complexidade mínima

Não criar biblioteca genérica enorme. Entregar: tokens, temas, 8–12 primitivos/adapter, estados, exemplos claro/escuro e testes de foco/contraste. Qualquer coisa além disso precisa justificar reuso real.

---

## 6. Fluxos de navegação recomendados

### 6.1 Mapa

```text
Launcher
├─ Início
│  ├─ Conversar com Lia → Stage gerenciado (caminho existente)
│  ├─ Configurar IA para conversar → IA & Recursos (quando não pronto)
│  └─ Voz / Diagnósticos conforme estado
├─ IA & Recursos
├─ Voz
├─ Diagnósticos
└─ Configurações (gear): idioma, tema, inicialização, privacidade, dados, sobre, avançado

Stage gerenciado
├─ Personagem / presença
├─ Ilha: conversar, ouvir, parar, centralizar, fixar, modo, fechar
└─ Configurar Lia: IA (resumo), Personalidade, Voz, Aparência, Presença, Memória
```

### 6.2 Primeiro uso

```text
Abrir Launcher → escolher texto/voz → verificar IA canônica
  ├─ pronta → Conversar com Lia
  └─ não pronta → Configurar IA para conversar
       → serviço disponível → chave se exigida → modelo → testar → pronto
Voz prepara em paralelo; não bloqueia texto.
```

### 6.3 Uso recorrente

```text
Home → Conversar → Stage → ilha → Chat/Ouvir/Parar/Configurar Lia
Launcher → IA & Recursos → alterar/testar → próxima conversa usa seleção
```

Voltar não ressuscita `/home` legado; fechar Stage não apaga config; erro mantém rascunho/anexos; configurações não somem por timer com foco/interação.

### 6.4 Recuperação e capacidades

```text
Erro IA → mensagem humana + preservar rascunho + retry/conferir IA/detalhes
Erro voz → estado da capacidade + retry seguro + continuar por texto
Conflito → recarregar estado + explicar outra janela mudou
Destrutivo → confirmar escopo → cancelar padrão → feedback
Capacidade → mostrar estado efetivo, permissão e destino; nunca toggle falso
```

---

## 7. Wireframes dos principais fluxos

Arquivo: [`evidence/lia-ui-ux-audit-2026-11-14/WIREFRAMES-LIA.html`](evidence/lia-ui-ux-audit-2026-11-14/WIREFRAMES-LIA.html). HTML estático, autocontido, sem CDN/script e sem conexão com runtime. Dados sintéticos; silhueta SVG é marcador de posição, não asset final.

**Preservação:** o arquivo é exatamente o entregue em `e183cba`; seu cabeçalho conserva `5ec464e` como SHA da proposta original. Não foi regerado nem apresentado como captura de `ae46c49`. W7 é direção futura, não descrição do antigo defeito X-03 como atual; o estado vigente do gate está na Revisão 2. Os oito quadros e o `static-checks.json` original permanecem intactos.

| Tela | Fluxo | Demonstra |
|---|---|---|
| W1 | Primeiro uso | Prontidão separada de preferência; CTA contextual; voz não bloqueante. |
| W2 | IA & Recursos | Disponível vs indisponível; custo/hospedagem; chave protegida; teste; avançado. |
| W3 | Voz | Preparando/pronta/erro/indisponível; pronta vs personalizada; retry. |
| W4 | Stage + conversa | Personagem protagonista; ilha nomeada; chat com rascunho preservado; parar fala. |
| W5 | Configurar Lia | Tabs acessíveis; personalidade/memória/presença reais; aparência honesta; IA gerenciada. |
| W6 | Confiança | Confirmação destrutiva; conflito; erro; diagnóstico sem segredo. |
| W7 | Futuro | Multi-monitor/jogos/extensões como direção; UI de ativação de ferramentas ainda não implementada. |
| W8 | Design system | Temas, tokens, botões, campos, status, foco, alvos. |

---

## 8. Referências e justificativas

| Referência | Aprender | Não copiar |
|---|---|---|
| ChatGPT Windows Companion | Superfície rápida, posição lembrada, reset claro, atalho configurável/conflito. [1](https://help.openai.com/en/articles/9982051-using-the-chatgpt-windows-app) | Identidade, conta obrigatória, promessas de capacidade. |
| Raycast | Preferências/credenciais no fluxo, `required` bloqueia até configurar, ajuda inline, ícone claro/escuro. [1](https://developers.raycast.com/basics/prepare-an-extension-for-store) | Virar launcher genérico; copiar UI/código. |
| LM Studio | Modos User/Power User/Developer; divulgação progressiva. [1](https://lmstudio.ai/docs/modes) | Expor técnico demais na Home; assumir que todo modelo local cabe no PC. |
| Ollama app | Download/conversa com modelos locais, drag-and-drop de arquivos e aviso de que contexto maior exige mais memória. [1](https://ollama.com/blog/new-app) | Depender de CLI na UX normal; assumir que todo modelo local cabe no PC; esconder custo de memória. |
| Desktop Mate | Presença que não atrapalha; requisitos deixam claro custo de mais personagens. [1](https://store.steampowered.com/app/3301060/?snr=1_5_9__413) | Personagem/assets; prometer caminhada entre monitores antes de existir. |
| Fluent UI tokens | Tokens semânticos; hardcoded quebra tema/alto contraste; foco por token. [1](https://github.com/microsoft/fluentui/blob/master/docs/architecture/design-tokens.md) | Trocar stack; copiar identidade Microsoft. |
| WCAG 2.2 | Contraste 4,5:1; alvo mínimo 24×24 com exceções; movimento desligável; 2.3.3 é AAA, adotado como política Lia. [1](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) [1](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) [1](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) | Tratar 24px como ideal; declarar conformidade sem auditoria. |
| WAI-ARIA APG Tabs | Painel, seleção, relação e teclado; nav/link quando muda URL. [1](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/examples/tabs-manual/) | ARIA decorativo sem comportamento. |
| AIRI upstream | Base viva com Live2D/VRM/voz/integrações; reutilizar por adapter. [1](https://github.com/moeru-ai/airi) | Branding AIRI na UI Lia; sobrescrever correções locais; assets sem licença. |
| Néctar/ALFRED (interno) | Continuidade/contexto e loop percepção→ação com permissões/cancelamento. | Super-app genérico; captura contínua padrão; ação externa sem autorização. |

Consultadas em 14/11/2026; revalidar antes de decisão de implementação/licença. Benchmark interno: `docs/product/EXTERNAL-BENCHMARKS-NECTAR-ALFRED.md`.

---

## 9. Melhorias rápidas × melhorias estruturais

### 9.1 Rápidas, baixo risco, alta qualidade percebida

| Melhoria | Por que é rápida | Guardrail |
|---|---|---|
| CTA/hint contextual quando IA não pronta | View-model puro já existe; mudar rótulo/destino | Não alterar contrato de start; teste unitário + Windows. |
| Nome acessível em botões de ícone do chat/ilha | Atributos/labels localizados | Não mudar layout/IPC; teste accname. |
| Foco visível no composer/tabs onde falta | Corrigir primitivo/local | Regressão em consumidores AIRI. |
| Contraste do CTA primário | Token de ação/fundo | Não mudar identidade neon; cálculo + captura. |
| Loading pt-BR sem flash infinito | Cópia/animação local | Reduced-motion; não esconder erro real. |
| Não auto-collapse com foco/interação | Guarda de estado na ilha | Teste teclado/ponteiro. |
| Feedback de voz com live region | `role=status/alert` | Não criar novo sistema de toast. |
| Esconder caminho/IDs da ConfigView normal | Mover para Avançado/Diagnósticos | Preservar função legada até decisão. |

### 9.2 Estruturais, exigem decisão/gate

| Melhoria | Dependência | Risco |
|---|---|---|
| Uma porta normal de IA e resumo gerenciado no Stage | Ownership aprovado; política de escrita já existe | Migração sem quebrar standalone. |
| Projeção única de prontidão IA/voz/capacidades | Contrato de estado não secreto | Cross-process; testes fixture + Windows. |
| Confirmação destrutiva reutilizável | Padrão existente; gestão de foco | Não bloquear fluxo com modal excessivo. |
| Tema Lia claro/escuro/alto contraste no Stage | Tokens + adapters sobre UI herdada | Consumidores upstream; licença de assets. |
| i18n unificado pt-BR/en-US | Catálogo por domínio | Strings hardcoded espalhadas. |
| Painel de capacidades/extensões | Gate A-1 já existente; decisão `ae46c49` adia UI; persistência e cobertura de `mcp()`/`debug()`/spark/web-search | Não criar segundo dono da preferência; não prometer controle total. |
| Deep-links/voltar estáveis | Contrato de navegação aprovado | Não ressuscitar `/home`; não criar IPC por conveniência. |
| Presença futura/jogos/multi-monitor contínuo | Detecção real, orçamento, gate físico | Desempenho e interrupção de jogos. |

---

## 10. Plano de evolução por etapas

Estimativas relativas: **P** ≤2 dias úteis, **M** 3–7, **G** 1–3 semanas. Não são compromissos de data.

| Fase | Objetivo | Escopo | Gate | Esforço |
|---|---|---|---|---|
| **0. Linha de base** | Decidir com evidência | Autorizar ferramentas; gate Windows oficial; capturas nos tamanhos reais; matriz teclado/leitor/contraste; C0–C4 baseline. | Manifesto com SHA/ambiente/comando/resultado. | M |
| **1. Confiança e verdade** | Corrigir riscos P1 | L-01, S-01, S-02, L-02, L-03, A-01, A-02; regressão do gate A-1 já corrigido. | AC-01…AC-08, AC-21; testes + Windows; sem IPC por conveniência. | G |
| **2. Design system consolidado** | Uma linguagem | Tokens/temas/primitivos/status/campos/i18n/reduced-motion; Launcher primeiro, Stage depois. | AC-09…AC-13; exemplos claro/escuro. | G |
| **3. Navegação e recuperação** | Fluxos previsíveis | Destinos/deep-links aprovados, voltar, Configurações × Configurar Lia, diagnósticos humanos, conflitos/drafts. | AC-14…AC-17; teste com leigos. | M/G |
| **4. Identidade e personagem** | Lia reconhecível sem custo extra | Asset/licença, expressões capability-driven, preview estático, movimento com orçamento. | AC-18…AC-20; visual + desempenho + licença. | G |
| **5. Futuro separado** | Não prometer o que não existe | Caminhada contínua, jogos, extensões, roupas, proatividade; UI de ativação/persistência de capacidades (X-04) somente quando autorizada. | Spec por capability, permissões, rollback, métricas, gate próprio. | G/item |

Ordem: 0 → 1 → 2 → 3. Fases 4/5 depois dos gates. Não implementar conceitos 04–07 como backlog aprovado. Mudanças em `stage-ui/ui/i18n` exigem regressão de consumidores AIRI. Voz não se “conserta” só com texto: confirmar capacidade pronta vs indisponível. Novo ícone/fonte/avatar exige licença. Nenhuma fase aumenta consumo por glow/blur/animação contínua sem medição.

---

## 11. Critérios objetivos de aceitação

Status atual: runtime **NOT-TESTED/BLOCKED**, salvo STATIC-PASS indicado. Aprovação exige evidência com SHA, ambiente, comando, captura/manifesto e resultado.

| ID | Critério | Método | Gate |
|---|---|---|---|
| AC-01 | Primeiro uso sem IA não promete conversa pronta; mostra próximo passo/destino. | VM + browser/Windows perfil vazio. | F1 |
| AC-02 | Ação destrutiva de chat/provedor/memória exige confirmação de escopo; cancelar não altera dados. | Automatizado + Windows fixture; writes antes/depois. | F1 |
| AC-03 | Texto normal ≥4,5:1; grande ≥3:1 nos temas/estados normais. | Cálculo por token + amostragem de pixels; sem arredondar para cima. | F1/F2 |
| AC-04 | Todo controle tem nome acessível; campo tem label/ajuda/erro associados. | Accname/leitor + DOM. | F1 |
| AC-05 | Foco visível em 100% dos navegáveis; tabs com teclado/painel ou nav/link. | Tab/Shift+Tab/setas/Home/End/Esc/Enter; captura. | F1 |
| AC-06 | Alvo ≥24×24 CSS px ou exceção documentada; meta ≥32 frequente, ≥40 CTA/ilha. | Bounding boxes nos tamanhos suportados. | F1/F2 |
| AC-07 | Segredo não aparece em DOM/log/toast/URL/diagnóstico/screenshot/armazenamento comum. | Inspeção + mascaramento + chave sintética. | Todas |
| AC-08 | IA/voz têm mesmo estado por capacidade no Launcher/Stage; indisponível não selecionável. | Fixture cross-surface + Windows local sintético. | F1 |
| AC-09 | Componentes Lia sem hex esparso; temas renderizam sem perder estado. | Lint/grep + screenshots comparáveis. | F2 |
| AC-10 | Strings novas têm pt-BR/en-US; tela normal não mistura idiomas. | Catálogo + captura por locale. | F2 |
| AC-11 | Reduced-motion remove movimento não essencial; loading não pisca infinitamente. | Preferência simulada + inspeção. | F2 |
| AC-12 | Sem dependência nova sem justificativa/licença; sem duplicar chat/select/toast/avatar. | Diff/manifest + inventário. | Todas |
| AC-13 | Main/Renderer/IPC preservados; renderer sem segredo/Node. | Testes de fronteira + preload. | Todas |
| AC-14 | Voltar/deep-link não ressuscita `/home`; config não some por timer com foco. | Rota + browser/Windows. | F3 |
| AC-15 | Falha de envio/save preserva rascunho/anexos e mostra erro humano. | Fixtures 401/429/rede/conflito. | F1/F3 |
| AC-16 | Diagnósticos: resumo humano primeiro; técnico colapsado; sem segredo. | Inspeção + expansão. | F3 |
| AC-17 | Leigo conclui primeiro uso, troca modelo e recupera erro sem ajuda externa. | 5–8 participantes; meta proposta ≥80% sucesso crítico. | F3 |
| AC-18 | Expressões/roupas só com capacidade; Launcher sem segundo renderer. | Capability + profiler/processos. | F4 |
| AC-19 | Livre cabe na work area, pausa/Home; troca de monitor sem gap; jogos/fullscreen só com detecção real. | Windows multi-monitor/DPI/unplug/jogo fixture. | F4/F5 |
| AC-20 | Sem regressão relevante de recursos vs baseline no mesmo host; thresholds aprovados antes. | C0–C4 + ensaio prolongado; mediana/pico/ambiente. | Todas |
| AC-21 | Gate de habilitação: ferramenta do store desabilitada não é apresentada ao modelo nem executada em envio, rerun ou objeto capturado; UI futura só mostra estado efetivo e persiste a escolha sem segundo dono. Ferramentas fora do store exigem escopo explícito, não falso controle global. | Testes de store/resolver/rerun + fixture de payload; quando a UI existir, teste entre reinícios e escopo declarado. | F1 regressão / F5 UI |

**Release:** nenhum P1 aberto; AC-01…AC-16 e a regressão de AC-21 aprovadas no SHA candidato; gate Windows oficial executado; evidências manifestadas; limitações declaradas. A parte de UI/persistência de AC-21 só se aplica quando essa funcionalidade for autorizada e entregue. AC-17…AC-20 podem ter gate por fase, mas não viram PASS por captura estática.

---

## Apêndice A — Evidências locais

| Artefato | Uso | Limite |
|---|---|---|
| `docs/project/CURRENT-STATE.md` §0/§6 | Estado operacional/regras | Living doc; não substitui gate do candidato. |
| `docs/reports/LIA-BRANCH-AUDIT-2026-11-14.md` | Baseline distante, gates bloqueados; A-1 era aberto em `5ec464e` | Documento histórico; A-1 foi corrigido depois. |
| `docs/reports/LIA-A1-TOOL-ENABLEMENT-2026-11-14.md` | Correção A-1, testes reportados e decisão de produto `ae46c49` | HISTORICAL-PASS do Principal; não reexecutado nesta revisão. |
| `evidence/lia-ui-ux-audit-2026-11-14/static-checks.json` | Primeira rodada, referência histórica `5ec464e` | Preservado; não é evidência de execução no SHA atual. |
| `evidence/lia-ui-ux-audit-2026-11-14/static-checks-revision-2.json` | Revisão em `ae46c49`: Git, gate, documentos, artefatos, VM e contraste | Estático/puro; não prova runtime, a11y ou desempenho. |
| `docs/design/LIA-UI-DESIGN-SYSTEM.md` | Baseline visual/capability-driven/a11y | Conceitos não provam implementação. |
| `docs/product/UX.md`, `docs/BRAND-STANDARDS.md` | Linguagem/privacidade/estados/reuso | Partes históricas/planejadas. |
| `docs/architecture/LIA-STAGE-ARCHITECTURE.md` | Fronteira Stage/runtime; não duplicar chat | Decisão/contrato, não gate atual. |
| `docs/architecture/LIA-HOME-STAGE-VISUAL-INVESTIGATION.md` | Home leve com preview estático | Investigação anterior. |
| `docs/product/evidence/2026-11-08-completion-runtime.json` | HISTORICAL-PASS Windows sintético | Não aprova provider externo, voz física, jogos, DPI/unplug. |
| `docs/design/concepts/01…07` | Direção visual | Contêm capacidades/branding a revisar. |
| `airi/packages/scenarios-stage-tamagotchi-browser/artifacts/raw/*.avif` | Capturas de cenário commitadas | Sem manifest.json; identidade upstream; não runtime atual. |
| `lia/assets/character/LiaHeroImage.png` | Preview estático da Home | Licença/identidade final a confirmar. |

## Apêndice B — Checagens desta auditoria

1. Git: branch isolada `arena/250b337a-lia-project`; auditoria inicial `e183cba` preservada; merge normal do Principal `ae46c49` em `1d802cc`; três commits analisados (`5ec464e`, `f3facdf`, `ae46c49`).
2. Equivalência: delta de UI do Launcher/Stage vazio desde `5ec464e`; delta de `stage-ui` restrito ao gate A-1 e testes. Achados de UI permanecem; X-03 foi corrigido.
3. Home VM: 6 asserts puros PASS: escolha texto/completa marca setup/voz sem provider; painel some apenas com `completed:true`; IA desconhecida = “IA a configurar”; CTA continua “Conversar com Lia”; hint aponta “aba Configuração”. Confirma gap de view-model, não runtime.
4. A-1 no código atual: `enabledById`, `isToolEnabled`, `setToolEnabled`, filtro em `activeTools`/`getToolsByNames` e wrapper `ToolDisabledError` presentes; nenhum chamador de produção de `setToolEnabled` encontrado. Testes do Principal são HISTORICAL-PASS, não reexecutados aqui.
5. Contraste estático sRGB/WCAG na seção 4.1; não é auditoria de pixels renderizados.
6. HTML dos wireframes: W1–W8 preservados, âncoras internas válidas, sem recursos externos/CDN/script.
7. Preservação: HTML W1–W8 e `static-checks.json` original comparados byte a byte com `e183cba`; nova rodada registrada em `static-checks-revision-2.json`: 11 PASS estáticos/puros, 1 HISTORICAL-PASS, 1 BLOCKED, 0 FAIL.
8. Runtime/browser/a11y/desempenho: BLOCKED/NOT TESTED; nenhuma ferramenta instalada.

## Apêndice C — Perguntas ao Agente Principal

1. Autoriza Fase 0 com ferramentas e gate Windows oficial?
2. Confirma ownership: edição normal de IA no Launcher; Stage gerenciado como resumo/retorno?
3. Qual é a verdade de voz pronta vs personalizada no SHA candidato?
4. A-1 já foi decidido em `ae46c49` (manter sob demanda, sem UI agora). Quando a UI de ativação/persistência for autorizada, qual será o dono da preferência e como cobrir ferramentas fora do store antes de prometer controle total?
5. Aprova paleta de ação AA e regra “conceito não liga controle”?
6. Quais thresholds C0–C4/animações/presença serão usados?
7. Há asset/licença oficial da Lia aprovado para substituir marcadores e referências upstream?

## Apêndice D — Âncoras exatas de código no checkout sincronizado (`ae46c49`)

Prefixos: `L = airi/apps/lia-app/src/renderer/src`, `S = airi/apps/stage-tamagotchi/src/renderer`, `SM = airi/apps/stage-tamagotchi/src/main`, `UI = airi/packages/ui/src/components`, `SU = airi/packages/stage-ui/src`.

| Achado | Arquivo/linhas |
|---|---|
| L-01 | `L/views/home-vm.ts:27–43,79–99`; `L/views/HomeView.vue:135–174,219–226,281–283` |
| L-02 | `L/views/ConfigView.vue:15–24,140–180`; `L/views/AiResourcesView.vue`; `S/components/LiaProviderConfig.vue`; `S/components/lia-config/sections/AiSection.vue:14` |
| L-03 | `L/components/voice-engine-card.vm.ts:113–175`; `L/views/VoiceView.vue:155–184`; `S/components/lia-config/sections/VoiceSection.vue:16–29,46–58` |
| L-04 | `L/App.vue:30–47,103–108,149–175`; `L/views/home-vm.ts:33` |
| S-01 | `S/components/InteractiveArea.vue:355–362,513–525`; `SU/stores/chat.ts:862–867`; `SU/stores/chat/session-store.ts:1418–1422` |
| S-02 | `S/components/LiaProviderConfig.vue:323–362,637–639` |
| S-03 | `S/pages/index.vue:948–968,1012–1016`; `S/components/stage-islands/controls-island/index.vue:87–109` |
| A-01 | `L/styles.css:1–14`; `L/components/lia/LiaButton.vue:56–60`; `L/styles/lia-tokens.css:26–30` |
| A-02 | `S/components/lia-config/LiaConfigPanel.vue:76–112`; `S/components/InteractiveArea.vue:434–442,495–572`; `UI/form/select-tab/select-tab.vue:90`; `UI/form/textarea/basic-text-area.vue:66–73` |
| X-01 | `L/styles/lia-tokens.css`; `S/components/lia-config/sections/PresenceSection.vue:148–158`; `S/components/lia-config/LiaConfigPanel.vue:33–41,61–91`; `S/components/lia-config/sections/PersonalitySection.vue:9–61` |
| X-02 | `S/components/lia-config/sections/AppearanceSection.vue:19–47`; `docs/design/concepts/01–07` |
| X-03 histórico/corrigido | `S/stores/tools/built-in.ts:11–19,39–43`; `S/components/InteractiveArea.vue:129`; `S/pages/index.vue:383`; `S/pages/spotlight.vue:55`; `SU/stores/ai/chat-llm/tools.ts:82–137,181–195`; `SU/stores/chat.ts:557–559,851–856`; `SU/stores/tool-call-rerun.ts:97–105`; `docs/reports/LIA-A1-TOOL-ENABLEMENT-2026-11-14.md` |
| X-04 | `SU/stores/ai/chat-llm/tools.ts:82–96,192–195` (store em memória/synced); decisão `ae46c49` §7–8; sem chamador de produção de `setToolEnabled` |
| Presença/janelas | `SM/services/lia/presence-service.ts:76–111`; `SM/windows/main/window-sizing.ts:31–38,71–101`; `SM/windows/settings/index.ts:55–56`; `SM/windows/chat/index.ts:29–30` |
| Catálogo IA | `lia/core/src/providers/catalog.ts:27–59,71–109` |
| Confirmação reutilizável | `UI/misc/double-check-button.vue:36–60,71–113`; `S/components/lia-config/sections/MemorySection.vue:154–168` |

**Enquanto essas decisões não forem registradas, esta entrega permanece proposta. Nenhuma implementação deve começar por conveniência visual.**
