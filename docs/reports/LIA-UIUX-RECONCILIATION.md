# Lia — Reconciliação de UI/UX (Fase 1)

**Data:** 16/11/2026
**Versões comparadas:**

| Rótulo | Ref | HEAD | Base | Δ |
|---|---|---|---|---|
| **P** (Principal) | `origin/arena/7fa837f0-lia-project` | `971d309074` | — | — |
| **L** (Lia Fase 1) | `origin/arena/250b337a-lia-project` | `ad802efe84` | `407300b` | 9 commits; **91 arquivos de código/config** + 6 docs |
| **C** (Codex Fase 1) | `origin/codex/lia-ui-ux-fase-1` | `e72574e8d7` | `da3a150` | 1 commit; 4 arquivos de UI + 1 doc |

**Documento de comparação de origem preservado:** [`LIA-UIUX-IMPLEMENTATION-COMPARISON.md`](LIA-UIUX-IMPLEMENTATION-COMPARISON.md) — usado como **ponto de partida, não como verdade**. As afirmações abaixo foram verificadas por `git diff`/`git show` nesta rodada.
**Natureza:** documental. Nenhum componente foi integrado; nenhum teste foi executado.

---

## 0. Veredicto

1. **A Principal está na base** (`407300b`) em todos os arquivos de UI da Fase 1: `LiaButton`, `HomeView`, `DoubleCheckButton`, `LiaProviderConfig` → **byte-idênticos** a `407300b`. Nada da Fase 1 está integrado.
2. **L é superconjunto de C** em quase tudo: C tem 4 arquivos; L tem 57, incluindo os mesmos componentes com solução mais completa.
3. **C trouxe 1 ideia superior**: a **guarda de chat vazio/sem sessão** antes de limpar mensagens. Deve ser portada (adaptada).
4. **C trouxe 2 regressões**: `background:#a62b90` hardcoded e `role="status"` redundante.
5. **L-02 permanece BLOQUEADO** até SEC-04/05 (T-07/T-08). Os componentes que dependem de editar provedor/segredo no Launcher **não integram**.
6. **Nenhum redesenho de Home** com telas Stitch não aprovadas — L não redesenha; refina estados e acessibilidade sobre o hero existente.

---

## 1. Método e limites

- Comparação **por componente e por blob** (`git show <ref>:<path>`), não por branch.
- Cálculo de contraste **estático sRGB/WCAG**; **não** é amostragem de pixels renderizados.
- Nenhum browser/Electron executado. **Browser, leitor de tela, teclado real, DPI/multi-monitor e Windows = NOT RUN** em P, L e C.
- O relatório de L marca browser BLOCKED; o de C marca Windows NOT RUN (clone sem dependências). Nenhum dos dois é prova de runtime.

---

## 2. Comparação por componente

| Componente | P (Principal) | L (`250b337a`) | C (`e72574e8`) | Decisão |
|---|---|---|---|---|
| `LiaButton.vue` | gradiente `--lia-accent`→`--lia-accent-soft`; hover `brightness(1.08)`; sem alvo mínimo | `--lia-accent-action` / `--lia-accent-action-hover`; `min-height:40px`; `outline` transparente + `Highlight` em forced-colors | `#a62b90` fixo; hover `brightness(1.08)` | **PORTAR L**; **REJEITAR C** |
| `HomeView.vue` | status row sem `role`; CTA sem `aria-busy` explícito | `role="status" aria-live="polite" aria-atomic="true"` (l. 300); `aria-describedby` do blocker (l. 245); `aria-busy` (l. 246); feedback com `role=status` (l. 262); chip de operação; first-run localizado | `role="status"` simples (l. 270) | **PORTAR L**; **REJEITAR C** (subconjunto) |
| `DoubleCheckButton.vue` | sem `label/confirmLabel/cancelLabel/description`; sem foco programático | `useId`, `descripbedBy`, foco em Cancelar, Escape, retorno de foco ao gatilho, fecha em `disabled`/`loading` | não toca | **PORTAR L** |
| `BasicButton` | `transition-all`; sem `motion-reduce`; sem `focus-visible` explícito | `min-h-8` no `sm`; `motion-reduce:transition-none`/`active:scale-100`; `focus-visible:outline-*`; spinner `motion-reduce:animate-none` | não toca | **PORTAR L** |
| `InteractiveArea.vue` (limpeza de chat) | `cleanup(activeSessionId)` sem confirmação | `DoubleCheckButton` i18n + sessão capturada no handler + desabilitado quando vazio | `window.confirm` + guarda `!sessionId \|\| !messageCount` + `aria-label` pt-BR | **PORTAR L + guarda de C** |
| `LiaProviderConfig.vue` | editor completo; consulta cofre/discovery | resumo **managed** somente leitura; `disabled`/`loading`; descrição de consequência i18n | `window.confirm` antes de remover | **BLOQUEADO** (L-02) |
| `delete-confirmation.vue` | não existe | **novo** AlertDialog (reka-ui) acessível, foco/Escape | não toca | **PORTAR L** (é genérico, sem segredo) |
| `sessions-dialog.vue` / `sessions-drawer` | sem `DoubleCheck` | `DoubleCheckButton` + `motion-reduce` | não toca | **PORTAR L** |
| `basic-text-area.vue` | Enter envia mesmo durante IME | `!e.isComposing && e.keyCode !== 229` | não toca | **PORTAR L** (correção real p/ pt-BR/IME) |
| `menu-items.ts` | `'Copy'`/`'Delete'` hardcoded | `copyLabel`/`deleteLabel` injetáveis | não toca | **PORTAR L** |
| `VoiceView`/`voice-engine-strings`/`VoiceSection`/`CustomVoicePanel` | strings e estados parciais | VM de capability + strings localizadas + estados de erro/loading | não toca | **PORTAR L** (sem cofre) |
| `App.vue` / `ConfigView.vue` (navegação "IA & Recursos") | sem navegação | adiciona navegação + disclosure técnico legado | não toca | **BLOQUEADO** (L-02) |
| i18n (`pt-BR`/`en` home/stage/tamagotchi) | chaves parciais | ~6 arquivos de locale | não toca | **PORTAR L** (junto dos componentes) |

---

## 3. Matriz dos oito critérios

| Critério | P | L | C | Melhor |
|---|---|---|---|---|
| **Acessibilidade / teclado** | básica; sem foco programático no confirm | foco em Cancelar, Escape, retorno de foco, `aria-atomic`, `aria-describedby` | `role="status"`; `aria-label` | **L** |
| **Confirmação destrutiva** | ausente na limpeza de chat | DoubleCheck i18n com descrição de consequência | `window.confirm` nativo | **L** (+ guarda de C) |
| **Contraste** | 6,2321:1 no normal; 5,53:1 no hover (filtro) | 6,2321:1 normal; **7,7453:1** hover | 6,23:1 normal; hover por filtro | **L** |
| **Tokens visuais** | gradiente + filter | tokens de ação; neon só foco/borda | hex hardcoded | **L** |
| **Loading / erro / prontidão** | CTA sem estado desconhecido explícito | `aria-busy`, disabled por estado desconhecido, chip de operação | não altera | **L** |
| **Localização** | strings parciais, `'Copy'`/`'Delete'` fixos | labels injetáveis + 6 locales | texto pt-BR hardcoded | **L** |
| **Responsividade** | dialogs desktop/mobile | `motion-reduce`, `max-h-[80dvh]`, `92dvw` preservados | não altera | **L** |
| **Identidade visual** | base | magenta de ação via token; hero preservado | magenta hardcoded | **L** |

---

## 4. O que portar, rejeitar e bloquear

### 4.1 PORTAR (sem dependência de segurança)

| ID | Arquivos | Por quê | Teste exigido |
|---|---|---|---|
| UI-R-01 | `LiaButton.vue`, `lia-tokens.css`, `basic-button.vue`, `double-check-button.vue` | acessibilidade, contraste, alvo mínimo, forced-colors | `lia-ui-foundation.test.ts`, `app-shell.test.ts` |
| UI-R-02 | `HomeView.vue`, `home-vm.ts`, `styles.css`, locales de home | status atômico, `aria-busy`, first-run | `home.test.ts` |
| UI-R-03 | `InteractiveArea.vue` + guarda de C | confirmação acessível + não limpar vazio | testes de chat + `lia-config.test.ts` |
| UI-R-06 | `delete-confirmation.vue`, `sessions-dialog.vue`, `sessions-drawer.vue`, `action-menu/*` | AlertDialog acessível, `motion-reduce` | browser tests (BLOCKED) + node |
| UI-R-10 | `basic-text-area.vue` (IME), `VoiceView`, `voice-engine-strings`, `VoiceSection`, `CustomVoicePanel`, `voice-capability-vm.ts` | IME pt-BR, estados de voz | `voice.test.ts`, `voice-capability-vm.test.ts` |

### 4.2 REJEITAR

| ID | Item | Justificativa técnica |
|---|---|---|
| UI-R-08 | `role="status"` do Codex em Home | Redundante: L já tem `role="status" aria-live="polite" aria-atomic="true"`; criaria anúncio duplicado |
| UI-R-09 | `background:#a62b90` + `filter:brightness(1.08)` | Hex hardcoded no componente; hover imprevisível em forced-colors; contraste de hover inferior (5,53:1 vs 7,7453:1) |
| UI-R-11 | `window.confirm` do Codex | Bloqueia a thread, sem foco controlado, sem i18n, sem descrição de consequência |

### 4.3 BLOQUEAR (L-02 / SEC-04/05)

| ID | Item | Dependência |
|---|---|---|
| UI-R-04 | `LiaProviderConfig.vue` modo managed; `AiSection.vue` (`liaManaged`); `ConfigView.vue` "IA & Recursos"; `App.vue` disclosure | SEC-R-07 (T-07/T-08) |
| UI-R-05 | Qualquer parte de `MemorySection`/`Secrets` que exiba/edite credencial | SEC-04 |

**Por que bloquear:** a auditoria de `c6b02f64` mostra que `cb2f418` (L-02) foi implementado **antes** de T-07/T-08, fora da ordem do plano rev.2. Ocultar UI **não é autorização**; `transport-config-service.ts:85–95` e `secrets-service.ts:139–145` continuam acessíveis conforme suas próprias políticas. Integrar a UI antes do contrato cria a aparência de segurança sem a garantia.

---

## 5. Contraste (cálculo estático, texto branco `#ffffff`)

| Superfície | Razão | Leitura |
|---|---:|---|
| Ação normal `#a62b90` (L e C) | **6,2321:1** | AA texto normal |
| Hover `#8f247c` (L) | **7,7453:1** | AA com margem |
| Hover por filtro `brightness(1.08)` (C) | **5,53:1** (estimado) | AA no limite |
| Fundo de página + texto de status | herdado dos tokens | não medido em runtime |

**Limite:** cálculo estático **não** substitui medição em tela real (DPI, gamma, forced-colors).

---

## 6. Riscos

| ID | Risco | Mitigação |
|---|---|---|
| UI-RISK-01 | Port de 91 arquivos de uma vez quebra o Launcher | Portar por grupo (UI-R-01 → 02 → 03 → 06 → 10), rodando a suíte a cada grupo |
| UI-RISK-02 | `DoubleCheckButton` muda comportamento de consumidores existentes | Props novas são opcionais; rodar todos os consumidores |
| UI-RISK-03 | Dialogs (`delete-confirmation`, `sessions-dialog`) dependem de `reka-ui` e browser tests BLOCKED | Validar em node + Windows; não declarar PASS de browser |
| UI-RISK-04 | Integrar L-02 por "não escrever" | Bloqueio formal mantido; só libera com SEC-04/05 |
| UI-RISK-05 | Redesenhar Home com Stitch | **Proibido** nesta rodada; L não redesenha |
| UI-RISK-06 | Misturar locale en/pt-BR parcial | Rodar checagem de chaves; não adicionar string hardcoded |

---

## 7. Plano de integração seletiva

| Ordem | Grupo | Arquivos | Depende de | Critério de aceite |
|---:|---|---|---|---|
| 1 | Primitivos | `LiaButton`, tokens, `basic-button`, `double-check-button` | — | testes de fundação PASS; contraste ≥4,5:1; foco/Escape cobertos |
| 2 | Home | `HomeView`, `home-vm`, `styles.css`, locales home | 1 | `home.test.ts` PASS; nenhum anúncio duplicado |
| 3 | Chat / confirmação | `InteractiveArea`, `delete-confirmation`, `sessions-dialog`, `sessions-drawer`, `action-menu` | 1 | cancelar preserva conversa; guarda de vazio ativa |
| 4 | Voz (UI) | `VoiceView`, `voice-engine-strings`, `VoiceSection`, `CustomVoicePanel`, `voice-capability-vm` | 1 | `voice.test.ts` PASS; sem cofre |
| 5 | IME/entrada | `basic-text-area` | — | Enter não envia durante composição |
| 6 | **BLOQUEADO** | `LiaProviderConfig` managed, `AiSection`, `ConfigView`, `App.vue` | SEC-04/05 | só após T-07/T-08 + browser/Windows |

**Fora de escopo:** design system completo (Fase 2), AC-09…AC-14/AC-16, redesenho de Home, Stitch.

---

## 8. Estado de evidência (honesto)

| Verificação | L | C | P |
|---|---|---|---|
| Testes de UI executados nesta rodada | **NÃO** | **NÃO** | **NÃO** |
| Browser/Chromium | BLOCKED (relatório de L) | NOT RUN | NOT RUN |
| Electron/Windows | NOT RUN | NOT RUN | NOT RUN |
| Leitor de tela / teclado real | NOT RUN | NOT RUN | NOT RUN |
| Contraste | estático | estático (no relatório) | estático |

**Nenhuma aprovação de UI foi declarada.** O que existe é uma decisão de engenharia sobre qual implementação preservar, com base em código e cálculo estático.
