# Comparação e consolidação UI/UX — Lia vs Codex

**Data:** 14/11/2026
**Branch de trabalho:** `arena/250b337a-lia-project`
**Nossa base publicada comparada:** `dd8dc0ca6d3e54d973b69749d2ee4f0e8bfc6eaa`
**Branch Codex consultada (somente leitura):** `origin/codex/lia-ui-ux-fase-1` = `e72574e8d743986a2eee8eeec41f80350bd470d8`
**Auditoria da Principal que motivou a comparação:** `28551805e8b0da016e947ff30de28e75a936deab` (`docs/reports/LIA-GIT-BRANCH-ORGANIZATION-AUDIT.md`)
**Ancestral comum das duas implementações:** `407300b8baa56b0ed8d14b7b2c0628222754e51f`

> **Decisão:** manter a nossa branch como base de integração e portar **apenas** a proteção do Codex contra limpeza de conversa vazia/sem sessão. Não fazer merge wholesale da branch Codex. A superioridade foi decidida **por componente**, não por branch.

---

## 1. Método e limites

- Leitura de `git show`/`git diff` das refs remotas; **nenhum checkout, edição ou commit** em `codex/lia-ui-ux-fase-1`.
- Comparação dos **4 arquivos sobrepostos** apontados pela auditoria da Principal, mais testes e primitivos relacionados (`DoubleCheckButton`, `home-vm`, i18n, tokens).
- Cálculo estático de contraste sRGB/WCAG; **não** é amostragem de pixels renderizados.
- Testes executados apenas na nossa branch. O relatório do Codex (`LIA-UI-UX-FASE-1-RETOMADA.md`) foi lido como evidência histórica; os 105 testes de core que ele cita **não foram reexecutados** aqui.
- Browser/Chromium, Electron/Windows, leitor de tela, DPI/multi-monitor e C0–C4 continuam **BLOCKED/NÃO EXECUTADOS**. Beta **não aprovada**; baseline Windows **não promovido**.

### Nota de alinhamento do checkout

O worktree foi restaurado em `7cb8172` com o conteúdo já publicado da Fase 1 presente no disco como mudanças não commitadas. Antes de qualquer operação foi verificado que **todos os 6.220 caminhos rastreados de `dd8dc0c` estavam presentes e byte-idênticos** no disco. A ref local e o index foram então alinhados ao tip já publicado `dd8dc0c` **sem merge, rebase, reset, checkout destrutivo ou perda de conteúdo**. Nenhum trabalho preexistente foi descartado.

---

## 2. Tabela comparativa por componente

| Componente | Codex (`e72574e`) | Nossa branch (`dd8dc0c` + esta consolidação) | Decisão | Justificativa principal |
|---|---|---|---|---|
| `LiaButton.vue` | `background:#a62b90` fixo; hover `filter:brightness(1.08)`; sem alvo mínimo; sem forced-colors | Tokens `--lia-accent-action` / `--lia-accent-action-hover`; `min-height:40px`; foco com outline transparente + `Highlight` em forced-colors | **Manter nossa** | Mesma cor normal, mas hover previsível por token, alvo mínimo e foco em modo de alto contraste. Codex hardcodifica hex e depende de filtro. |
| `HomeView.vue` | Adiciona `role="status"` na linha de status | Já tem `role="status" aria-live="polite" aria-atomic="true"`, hint associado por `aria-describedby`, CTA com `aria-busy`/disabled por estado desconhecido, navegação para IA & Recursos, chip de operação e first-run localizado | **Manter nossa** | O `role="status"` do Codex é subconjunto do que já existe. Nossa Home cobre prontidão, recuperação e localização sem duplicar fonte de estado. |
| `InteractiveArea.vue` | `window.confirm` nativo; guarda `!sessionId \|\| !messageCount`; `aria-label` pt-BR hardcoded | `DoubleCheckButton` com label/confirm/cancel/description i18n, foco em Cancelar, Escape, retorno de foco, fecha em disabled/loading | **Híbrida** | Manter nossa confirmação acessível e portar a guarda do Codex. A guarda foi melhorada para desabilitar reativamente o controle e capturar a sessão no handler. |
| `LiaProviderConfig.vue` | `window.confirm` antes de `removeProvider`; texto pt-BR hardcoded | `DoubleCheckButton` com descrição de consequência i18n, `disabled`/`loading`, e resumo gerenciado somente leitura quando `managed` | **Manter nossa** | Confirmação no produto, escopo explícito (serviço/modelo/fallbacks/chaves), estados ocupados e compatibilidade com Stage gerenciado. |

---

## 3. Matriz dos 8 critérios pedidos

Legenda: **N** = nossa abordagem escolhida; **C** = ideia do Codex portada; **empate técnico** = ambas atendem o mínimo estático, com preferência de engenharia indicada.

| Critério | LiaButton | Home | Chat / limpeza | Provedor / IA |
|---|---|---|---|---|
| Confirmação destrutiva | n/a | n/a | **N + C**: DoubleCheck + guarda de vazio | **N**: DoubleCheck com escopo e loading |
| Acessibilidade / teclado | **N**: foco visível, forced-colors | **N**: status atômico + describedby | **N**: Cancelar focado, Escape, retorno de foco | **N**: nomes/descrição i18n, disabled/loading |
| Estados focus/hover/disabled | **N**: hover por token, disabled nativo, 40px | **N**: busy/unknown/starting/stopping | **N + C**: disabled reativo quando vazio | **N**: disabled sem provider, loading fecha confirmação |
| Contraste | **N**: 6,2321 normal / 7,7453 hover | tokens herdados | tokens/shared UI | tokens/shared UI |
| Tokens visuais | **N**: sem hex no componente | **N**: sem cores novas na view | shared UI/i18n | shared UI/i18n |
| Carregamento / prontidão | n/a | **N**: CTA não promete conversa sem IA | **C** portado: não oferecer limpeza sem mensagens | **N**: busy/loading; managed não consulta cofre/discovery |
| Compatibilidade com Stage | n/a | **N**: navegação para IA & Recursos | **N**: cleanup da sessão ativa, guarda de sessão | **N**: resumo managed somente leitura |
| Identidade visual da Lia | **N**: magenta de ação via token, neon só foco/borda | **N**: hero + chips + cópia de produto | **N**: padrão de confirmação do produto | **N**: cópia de produto, não diálogo nativo cru |

---

## 4. Justificativas detalhadas

### 4.1 `LiaButton.vue`

Fatos comparados:

- Codex troca o gradiente antigo por `#a62b90` e hover `brightness(1.08)`. O contraste normal melhora, mas a cor fica hardcoded no componente e o hover depende de filtro.
- Nossa implementação usa `--lia-accent-action` (`#a62b90`) e `--lia-accent-action-hover` (`#8f247c`), mantém o neon (`--lia-magenta`) para foco/bordas, adiciona `min-height:40px` e regra `@media (forced-colors: active)` com `outline-color: Highlight`.

Contraste estático com texto branco (`#ffffff`):

| Superfície | Razão | Leitura |
|---|---:|---|
| Ação normal `#a62b90` (ambas) | **6,2321:1** | AA texto normal |
| Nosso hover `#8f247c` | **7,7453:1** | AA com margem maior |
| Codex hover `brightness(1.08)` sobre `#a62b90` | **5,5293:1** | AA, mas margem menor e dependente de filtro |
| Gradiente antigo neon `#e545c8` | **3,4902:1** | reprovava texto normal AA |
| Gradiente antigo soft `#b0359a` | **5,4947:1** | AA isolado, mas gradiente não garante o pior ponto |

**Decisão:** manter nossa. O ganho do Codex era o valor da cor; nós já tínhamos o mesmo valor como token, com hover mais seguro e sem hardcode.

### 4.2 `HomeView.vue`

- Codex adiciona apenas `role="status"` em `.home-status-row`.
- Nossa linha já é `role="status" aria-live="polite" aria-atomic="true"`. O `aria-atomic` faz o leitor anunciar o conjunto IA+voz como uma unidade; o hint de bloqueio fica fora da região live e é associado ao CTA por `aria-describedby="home-readiness-hint"`.
- Nossa Home também distingue status desconhecido (`conversationUnknown`), bloqueia CTA durante starting/stopping, expõe `aria-busy`, mostra chip de operação e direciona para IA & Recursos quando a IA não está pronta. O first-run é localizado en/pt-BR e não promete preparação automática de voz como fato.

**Decisão:** manter nossa. Não há incremento funcional do Codex que já não esteja coberto; importar o diff inteiro reintroduziria cópia pt-BR fixa e removeria proteções de prontidão/localização.

**Lacuna de validação:** anúncio real por leitor de tela e ausência de duplicação em Electron/Windows continuam NÃO EXECUTADOS. O markup é evidência estática, não prova de experiência auditiva.

### 4.3 `InteractiveArea.vue` — limpeza de conversa

Nossa confirmação:

- `DoubleCheckButton` com `label`, `confirmLabel`, `cancelLabel`, `description` vindos de `stage.chat.actions.*` (en/pt-BR).
- Primeiro clique abre e foca Cancelar; Cancelar/Escape não limpam e devolvem foco; segundo clique explícito emite uma vez; disabled/loading fecham a escolha pendente.
- Descrição informa que remove mensagens **desta conversa**, interrompe respostas pendentes e não altera outras conversas.

Codex:

- `window.confirm('Limpar todas as mensagens desta conversa?…')` e `aria-label="Limpar mensagens desta conversa"` hardcoded.
- Guarda útil: captura `sessionId`, conta mensagens não-system e retorna se `!sessionId || !messageCount`.

**Decisão híbrida:** manter nossa confirmação e portar a intenção da guarda, com duas melhoras:

1. `clearableMessageCount` é `computed`; o `DoubleCheckButton` recebe `:disabled="!activeSessionId || clearableMessageCount === 0"`. Assim a UI não oferece ação destrutiva para conversa vazia/só system e fecha escolha pendente se o histórico esvaziar por sincronização.
2. O handler captura `sessionId` e revalida `messageCount` antes de `chatStore.cleanup(sessionId)`, preservando a sessão alvo e a telemetria existente.

Isso preserva a semântica do store: `cleanup` mantém mensagem de sistema e não toca conversa irmã. A guarda apenas evita oferecer/confirmar uma limpeza sem mensagens limpas pelo usuário.

**TDD:** dois testes novos falharam antes da mudança (controle não disabled; confirmação pendente não fechava ao esvaziar) e passaram depois. Evidência: `comparison-repro.log` (FAIL esperado) e `comparison-stage-targeted.log` (PASS).

### 4.4 `LiaProviderConfig.vue`

- Codex insere `window.confirm` em `removeProvider`, com texto pt-BR fixo. A remoção continua removendo transporte, chaves e fallback, mas a experiência é um diálogo nativo cru, sem estados visuais do produto.
- Nossa versão usa `DoubleCheckButton` com `removeDescription` i18n, `disabled=busy || !providerId`, `loading=busy`, e no Stage gerenciado renderiza resumo somente leitura (`managed`) sem campos/ações de escrita, sem consulta a cofre/discovery para controles ocultos.

**Decisão:** manter nossa. A confirmação destrutiva precisa de escopo, localização, foco e estados ocupados consistentes com o restante da Fase 1. O `window.confirm` do Codex não demonstra retorno de foco/anúncio em Electron e não cobre o modo managed.

---

## 5. Testes e verificações desta rodada

Comandos executados em `airi/`. Logs e hashes em [`evidence/lia-uiux-comparison-2026-11-14/`](evidence/lia-uiux-comparison-2026-11-14/manifest.json).

| Verificação | Resultado | Observação |
|---|---|---|
| Reprodução TDD da guarda (`phase1-ui.test.ts`) | **FAIL esperado → PASS** | 2 novos testes falharam antes do fix; 7/7 no arquivo após o fix |
| Stage node direcionado (8 arquivos) | **74/74 PASS** | inclui os 2 novos; DOM-emulado, não browser |
| stage-ui node direcionado (5 arquivos) | **56/56 PASS** | inclui A-1 31/31 e escopo de limpeza de sessão |
| Launcher (`@lia/lia-app test`) | **358 PASS, 2 skipped**, 36 arquivos | os 2 skipped são pré-existentes; não contar como PASS |
| Typecheck Launcher | **PASS** | exit 0 |
| Typecheck Stage (heap 3072, serial) | **PASS** | exit 0; primeiras tentativas falharam por declarações de pacotes não buildados, resolvidas pelos scripts de build existentes, sem editar código alheio |
| ESLint dos 4 arquivos alterados | **PASS** | 0 erros |
| Contraste estático sRGB | **PASS** | token normal/hover acima de 4.5:1 |
| Browser test de provedor | **BLOCKED** | `chromium_headless_shell-1234` ausente; nenhuma assertion browser executada |
| `git diff --check` | **PASS** | sem erros de whitespace no patch |

### Lacunas e FAIL/BLOCKED herdados

- **Browser BLOCKED:** Chromium ausente. Testes browser de confirmação, sessões, memória, voz e resumo gerenciado continuam não executados.
- **Build Stage BLOCKED (histórico, não reexecutado):** `ECONNRESET` em `dist.ayaka.moe/live2d-models/hiyori_free_zh.zip`. Nenhum mirror/contorno criado.
- **Lint global FAIL (histórico):** 78 erros em 48 arquivos não tocados; interseção com esta tarefa vazia. Não feito cleanup global.
- **Windows/runtime, leitor de tela, pixels, C0–C4: NÃO EXECUTADOS.** Teste verde não aprova beta nem promove baseline.
- Os testes DOM-emulado do chat emitem avisos não fatais de fixture (URL de asset de background em jsdom); não são prova de runtime e não alteram o resultado dos assertions.

---

## 6. Arquivos alterados nesta consolidação

Código/teste:

- `airi/apps/stage-tamagotchi/src/renderer/components/InteractiveArea.vue` — guarda reativa de conversa vazia + captura de sessão no handler.
- `airi/apps/stage-tamagotchi/src/renderer/components/phase1-ui.test.ts` — fixture reutilizável e 2 testes da guarda.
- `airi/apps/lia-app/src/renderer/src/components/lia/lia-ui-foundation.test.ts` — assertions de alvo mínimo e forced-colors.
- `airi/apps/lia-app/src/renderer/src/views/home.test.ts` — assertions de status atômico e hint associado.

Documentação/estado/evidência:

- Este relatório.
- `docs/project/CURRENT-STATE.md` §0.
- `docs/reports/evidence/lia-uiux-comparison-2026-11-14/` (manifest + logs + comparação estática).

**Não alterados:** `LiaButton.vue`, `HomeView.vue`, `LiaProviderConfig.vue`, tokens, i18n, `DoubleCheckButton`, Persona, segredos, TTS runtime, fallback de chat, discovery, IPC, dependências, `Lia.bat`, `DevKit.bat`. Nenhuma mudança na Principal, `main` ou branch Codex.

---

## 7. Recomendações de integração para a Principal

1. **Integrar a nossa branch**, não a Codex UI. A branch Codex pode ser arquivada após a decisão; não fazer merge dos dois históricos concorrentes.
2. Resolver o conflito esperado em `docs/project/CURRENT-STATE.md` manualmente, preservando o estado mais recente da Principal e esta decisão por componente.
3. Confirmar a decisão de escopo **L-02** (ownership de IA) antes da integração; esta comparação não altera essa decisão nem antecipa SEC-04/05.
4. Reexecutar os gates no SHA final integrado: launcher, Stage node, stage-ui node, typechecks, lint da tarefa e `git diff --check`.
5. Disponibilizar Chromium autorizado e rodar os browser tests; depois executar a matriz Windows oficial (primeiro uso, cancelar/confirmar com fixture, troca Launcher→Stage, voz indisponível, teclado/leitor, temas/locales).
6. Manter X-04 adiado. Nenhuma promessa de controle total de ferramentas foi adicionada.

---

## 8. Conclusão

A auditoria da Principal estava correta ao suspeitar que nossa abordagem era potencialmente superior, mas a comparação mostrou uma exceção útil: a guarda de conversa vazia do Codex. O resultado consolidado é **3 componentes mantidos como nossos + 1 híbrido**, com a exceção portada de forma mais acessível e reativa do que no original. Nenhum runtime foi aprovado; os gates de browser e Windows permanecem abertos.
