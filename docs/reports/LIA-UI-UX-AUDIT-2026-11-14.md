# Auditoria UI/UX e proposta de produto — Lia

**Para:** Agente Principal / revisão e planejamento
**Data:** 14/11/2026
**Repositório:** `BloomRX/Lia-Project`
**Branch de origem:** `arena/01a10290-lia-project`
**SHA de referência solicitado:** `5ec464edf410008e390e2da4aff32d32537eb69d`
**Branch isolada desta sessão:** `arena/250b337a-lia-project`
**Checkout local usado para inspeção:** `7cb81720552a822a03f36ac6ce5f2e20b009f84c`
**Equivalência verificada:** `git diff --name-only 7cb8172..5ec464e -- airi/apps/lia-app airi/apps/stage-tamagotchi airi/packages/ui airi/packages/stage-ui airi/packages/i18n lia/core lia/assets docs/design docs/product/UX.md docs/BRAND-STANDARDS.md` retornou vazio. O delta completo entre os dois SHAs é apenas documental: `docs/project/CURRENT-STATE.md` e `docs/reports/LIA-BRANCH-AUDIT-2026-11-14.md`. Portanto, os achados de UI/código abaixo valem para o SHA de referência `5ec464e`.
**Natureza:** auditoria e proposta. Nenhuma implementação, arquitetura, IPC, componente existente ou tecnologia foi alterada.

**Entregáveis visuais:** [`evidence/lia-ui-ux-audit-2026-11-14/WIREFRAMES-LIA.html`](evidence/lia-ui-ux-audit-2026-11-14/WIREFRAMES-LIA.html) e [`evidence/lia-ui-ux-audit-2026-11-14/manifest.json`](evidence/lia-ui-ux-audit-2026-11-14/manifest.json).

> **Decisão pedida:** revisar esta proposta e autorizar, em rodada separada, a Fase 0/1 do plano. Este documento não autoriza mudança de código, IPC, Persona, segredos, TTS runtime, fallback, discovery, `Lia.bat` ou `DevKit.bat`.

---

## 0. Método, limites e legenda

Método: leitura do código real de Launcher/Stage; leitura de specs internas; inspeção de conceitos PNG e capturas de cenário commitadas; cálculos estáticos de contraste; checagem pura de view-model; pesquisa de referências externas; comparação do checkout local com o SHA de referência remoto.

| Marcador | Significado |
|---|---|
| **CODE-PRESENT** | Código/artefato existe no SHA auditado; não prova execução. |
| **STATIC-PASS** | Checagem estática/função pura executada nesta auditoria. |
| **HISTORICAL-PASS** | Relatório anterior afirma PASS em ambiente declarado; não é reexecução aqui. |
| **HEURÍSTICA** | Risco inferido do código/fluxo; exige validação runtime/usuários. |
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
- O caminho de chat envia referências de ferramentas mesmo quando registradas com `defaultActive: false`; isso afeta a promessa de “capacidades habilitadas” e precisa de decisão de produto antes de qualquer painel de extensões.

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
| Capacidades | Não há painel normal de capacidades; ferramentas do Stage são enviadas por referência fixa. | `stores/tools/built-in.ts`, `stores/chat.ts` | Alto |
| Visual | CTA primário tem extremo claro com contraste insuficiente; nav usa glifos Unicode heterogêneos. | `styles.css`, `LiaButton.vue`, `App.vue`; cálculo estático | Médio/alto |
| Diagnósticos | Bom isolamento, ainda mostra estados crus e contrato em `<pre>`. | `DiagnosticsView.vue` | Médio |
| Janela | 1320×860 solicitado; rail colapsa em ≤640px; falta prova em DPI/work area pequena. | `main/index.ts`, `App.vue` | Médio |

**Veredito:** bom esqueleto, mas duas gerações de UI sobrepostas. Prioridade: unificar prontidão, IA, voz e capacidades; não adicionar mais páginas.

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
| Capacidades | `image_journal`, `stage_widgets`, `get_weather` registrados com `defaultActive:false`, mas enviados por `artistryToolReferences` e resolvidos por `getToolsByNames`. | `built-in.ts`, `tools.ts`, `chat.ts`; auditoria de branch A-1 | Alto |

**Veredito:** presence é o diferencial; confiança depende de controles previsíveis, confirmação destrutiva, foco visível, estado honesto e autorização de capacidades coerente.

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
| X-03 | **P1** | Capacidades prometidas/habilitadas não correspondem ao envio real de ferramentas. | CODE + auditoria de branch | Confiança/autorização quebradas; painel futuro nasceria falso. | Decisão de produto: respeitar ativação ou documentar referências fixas; UI só mostra estado efetivo. |
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

| Tela | Fluxo | Demonstra |
|---|---|---|
| W1 | Primeiro uso | Prontidão separada de preferência; CTA contextual; voz não bloqueante. |
| W2 | IA & Recursos | Disponível vs indisponível; custo/hospedagem; chave protegida; teste; avançado. |
| W3 | Voz | Preparando/pronta/erro/indisponível; pronta vs personalizada; retry. |
| W4 | Stage + conversa | Personagem protagonista; ilha nomeada; chat com rascunho preservado; parar fala. |
| W5 | Configurar Lia | Tabs acessíveis; personalidade/memória/presença reais; aparência honesta; IA gerenciada. |
| W6 | Confiança | Confirmação destrutiva; conflito; erro; diagnóstico sem segredo. |
| W7 | Futuro | Multi-monitor/jogos/extensões como direção, sem toggles disponíveis. |
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
| Painel de capacidades/extensões | Decisão X-03, permissões, rollback, auditoria | Não nascer com toggle falso. |
| Deep-links/voltar estáveis | Contrato de navegação aprovado | Não ressuscitar `/home`; não criar IPC por conveniência. |
| Presença futura/jogos/multi-monitor contínuo | Detecção real, orçamento, gate físico | Desempenho e interrupção de jogos. |

---

## 10. Plano de evolução por etapas

Estimativas relativas: **P** ≤2 dias úteis, **M** 3–7, **G** 1–3 semanas. Não são compromissos de data.

| Fase | Objetivo | Escopo | Gate | Esforço |
|---|---|---|---|---|
| **0. Linha de base** | Decidir com evidência | Autorizar ferramentas; gate Windows oficial; capturas nos tamanhos reais; matriz teclado/leitor/contraste; C0–C4 baseline. | Manifesto com SHA/ambiente/comando/resultado. | M |
| **1. Confiança e verdade** | Corrigir riscos P1 | L-01, S-01, S-02, L-02, L-03, X-03, A-01, A-02. | AC-01…AC-08, AC-21; testes + Windows; sem IPC por conveniência. | G |
| **2. Design system consolidado** | Uma linguagem | Tokens/temas/primitivos/status/campos/i18n/reduced-motion; Launcher primeiro, Stage depois. | AC-09…AC-13; exemplos claro/escuro. | G |
| **3. Navegação e recuperação** | Fluxos previsíveis | Destinos/deep-links aprovados, voltar, Configurações × Configurar Lia, diagnósticos humanos, conflitos/drafts. | AC-14…AC-17; teste com leigos. | M/G |
| **4. Identidade e personagem** | Lia reconhecível sem custo extra | Asset/licença, expressões capability-driven, preview estático, movimento com orçamento. | AC-18…AC-20; visual + desempenho + licença. | G |
| **5. Futuro separado** | Não prometer o que não existe | Caminhada contínua, jogos, extensões, roupas, proatividade. | Spec por capability, permissões, rollback, métricas, gate próprio. | G/item |

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
| AC-21 | UI de capacidades reflete o conjunto efetivamente enviado/executável; nenhuma ferramenta com efeito real é apresentada como desativada se ainda é enviada. | Teste do caminho de chat + fixture de payload + decisão de produto registrada. | F1/F5 |

**Release:** nenhum P1 aberto; AC-01…AC-16 e AC-21 aprovados no SHA candidato; gate Windows oficial executado; evidências manifestadas; limitações declaradas. AC-17…AC-20 podem ter gate por fase, mas não viram PASS por captura estática.

---

## Apêndice A — Evidências locais

| Artefato | Uso | Limite |
|---|---|---|
| `docs/project/CURRENT-STATE.md` §0/§6 | Estado operacional/regras | Living doc; não substitui gate do candidato. |
| `docs/reports/LIA-BRANCH-AUDIT-2026-11-14.md` (em `5ec464e`) | Baseline distante, gates bloqueados, A-1 ferramentas | Documento de auditoria; não é runtime. |
| `docs/design/LIA-UI-DESIGN-SYSTEM.md` | Baseline visual/capability-driven/a11y | Conceitos não provam implementação. |
| `docs/product/UX.md`, `docs/BRAND-STANDARDS.md` | Linguagem/privacidade/estados/reuso | Partes históricas/planejadas. |
| `docs/architecture/LIA-STAGE-ARCHITECTURE.md` | Fronteira Stage/runtime; não duplicar chat | Decisão/contrato, não gate atual. |
| `docs/architecture/LIA-HOME-STAGE-VISUAL-INVESTIGATION.md` | Home leve com preview estático | Investigação anterior. |
| `docs/product/evidence/2026-11-08-completion-runtime.json` | HISTORICAL-PASS Windows sintético | Não aprova provider externo, voz física, jogos, DPI/unplug. |
| `docs/design/concepts/01…07` | Direção visual | Contêm capacidades/branding a revisar. |
| `airi/packages/scenarios-stage-tamagotchi-browser/artifacts/raw/*.avif` | Capturas de cenário commitadas | Sem manifest.json; identidade upstream; não runtime atual. |
| `lia/assets/character/LiaHeroImage.png` | Preview estático da Home | Licença/identidade final a confirmar. |

## Apêndice B — Checagens desta auditoria

1. Git: branch isolada `arena/250b337a-lia-project`, checkout `7cb8172`; referência `5ec464e` buscada do remoto; delta UI vazio; delta completo apenas documental.
2. Home VM: 5 asserts puros PASS: escolha texto marca setup/voz mas não provider; painel some; IA desconhecida = “IA a configurar”; CTA continua “Conversar com Lia”. Confirma gap de view-model, não runtime.
3. Contraste estático sRGB/WCAG na seção 4.1; não é auditoria de pixels renderizados.
4. HTML dos wireframes: âncoras internas válidas, sem recursos externos/CDN/script.
5. Runtime/browser/a11y/desempenho: BLOCKED; nenhuma ferramenta instalada.

## Apêndice C — Perguntas ao Agente Principal

1. Autoriza Fase 0 com ferramentas e gate Windows oficial?
2. Confirma ownership: edição normal de IA no Launcher; Stage gerenciado como resumo/retorno?
3. Qual é a verdade de voz pronta vs personalizada no SHA candidato?
4. Decide X-03: caminho de chat deve respeitar ativação de ferramentas ou documentar referências fixas? A UI não pode prometer o contrário.
5. Aprova paleta de ação AA e regra “conceito não liga controle”?
6. Quais thresholds C0–C4/animações/presença serão usados?
7. Há asset/licença oficial da Lia aprovado para substituir marcadores e referências upstream?

## Apêndice D — Âncoras exatas de código no checkout equivalente

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
| X-03 | `S/stores/tools/built-in.ts:11–19,39–43`; `S/components/InteractiveArea.vue:129`; `S/pages/index.vue:383`; `S/pages/spotlight.vue:55`; `SU/stores/ai/chat-llm/tools.ts:49–58`; `SU/stores/chat.ts:557–559` |
| Presença/janelas | `SM/services/lia/presence-service.ts:76–111`; `SM/windows/main/window-sizing.ts:31–38,71–101`; `SM/windows/settings/index.ts:55–56`; `SM/windows/chat/index.ts:29–30` |
| Catálogo IA | `lia/core/src/providers/catalog.ts:27–59,71–109` |
| Confirmação reutilizável | `UI/misc/double-check-button.vue:36–60,71–113`; `S/components/lia-config/sections/MemorySection.vue:154–168` |

**Enquanto essas decisões não forem registradas, esta entrega permanece proposta. Nenhuma implementação deve começar por conveniência visual.**
