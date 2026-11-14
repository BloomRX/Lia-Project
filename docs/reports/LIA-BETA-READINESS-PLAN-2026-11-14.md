# Lia — Consolidação pós-A-1 e plano de prontidão para beta

**Data:** 14/11/2026
**Branch:** `arena/01a10290-lia-project`
**SHA de referência:** `ae46c495d7da7cd33f4b4da8f4e8cc95b0a867b6` (`ae46c49`)
**Natureza desta rodada:** auditoria, análise e documentação. **Nenhuma correção de produto foi implementada**, nenhuma branch de especialista foi mergeada e A-1 não foi reaberto.

---

## 0. Sumário executivo

A Lia tem um núcleo automatizado saudável e um produto **sem prova de runtime no SHA candidato**.

- **Código e testes offline:** 5.664 PASS / 18 skipped / **0 teste falhando** no total consolidado do QA, com 5.651 herdados de `5ec464e` e o delta do A-1 re-executado em `ae46c49`. Isso convive com **dois portões vermelhos**: lint com 81 erros e stage-ui com `exit 1` por rejeição não tratada (nenhum teste falha). O gate de habilitação de ferramentas (`f3facdf`) está fechado em código e testes.
- **Runtime:** AI Settings **0/16** passos, conversa real, histórico, encerramento sem órfãos, sandbox na janela de produto, tool calling ponta a ponta, voz e hardware: **NOT RUN / BLOCKED**.
- **Segurança:** há uma exposição **demonstrada em código** de tokens OIDC no Renderer/`localStorage` (SEC-01) e uma corrida de refresh pós-logout **reproduzida em bancada sintética** (SEC-02). Não há prova de roubo, XSS ou exploração remota. Os demais achados são condicionais ou estáticos.
- **Distribuição:** build do renderer do Stage quebra sem `dist.ayaka.moe`; NSIS nunca foi executado; não há assinatura.

**Veredicto:** **beta não aprovada**. A distância não está no núcleo unitário; está em prova de runtime, decisão de escopo OIDC, higiene de CI, reprodutibilidade do build, distribuição e gates de segurança condicionais.

**Recomendação de sequência:** decidir escopo (Etapa 0) → fechar portões de qualidade e build (Etapas 1–2) → fechar segurança de OIDC/credenciais (Etapa 3) → política de ferramentas (Etapa 4) → validação Windows (Etapa 5) → distribuição (Etapa 6) → revalidação no SHA congelado (Etapa 7).

---

## 1. Estado real do projeto

### 1.1 O que está concluído

| Item | Evidência | Observação |
|---|---|---|
| A-1 corrigido (gate real de habilitação) | `f3facdf` + `ae46c49`; `tools.test.ts` 13/13, `tool-resolver.test.ts` 11/11, `tool-call-rerun.test.ts` 7/7, `built-in.test.ts` 1/1 | Re-executado nesta sessão sobre a árvore de código idêntica a `ae46c49` (a diferença entre `f3facdf` e `ae46c49` é documental). |
| Auditoria da branch | `docs/reports/LIA-BRANCH-AUDIT-2026-11-14.md`, commit `5ec464e` | Histórica; o A-1 dela já foi corrigido. |
| QA offline Linux no SHA candidato | `LIA-VALIDATION-MATRIX-AE46C49-2026-11-14.md` + 11 logs em `docs/reports/evidence/LIA-QA-VALIDATION-ae46c49-2026-11-14/` | Re-executado no delta A-1; o restante é carry-forward rotulado de `5ec464e`. |
| Launcher/core-agent/lia-core/DevKit | Matriz QA §2.A e §10 | PASS offline, carry-forward rotulado. |
| Stage node suite / typecheck | 2.498 PASS (204 arquivos, 1 skip); `vue-tsc` exit 0 | Re-executado em `ae46c49`. |
| Segurança estrutura (sandbox/IPC/vault) | `LIA-ARQUITETURA-SEGURANCA-AE46C4-2026-11-14.md` §3 | Controles positivos no harness; janela de produto NOT RUN. |
| Auditoria UI/UX e wireframes W1–W8 | `LIA-UI-UX-AUDIT-2026-11-14.md` + `WIREFRAMES-LIA.html` | Revisão 2 alinhada a `ae46c49`; estática, sem runtime. |

### 1.2 O que foi apenas auditado (sem correção)

| Área | Achados | Estado |
|---|---|---|
| OIDC/autenticação | SEC-01, SEC-02, SEC-03 | Exposição e corrida demonstradas; revogação remota não comprovada. Nenhuma correção aplicada. |
| Credenciais e transporte | SEC-04, SEC-05 | Exceções condicionais confirmadas em código; exploração Electron não demonstrada. |
| MCP/TLS/CSP | SEC-06, SEC-07, SEC-08 | Capacidades confirmadas estaticamente; MITM/injeção não demonstrados. |
| Concorrência e fontes de ferramentas | TOOL-01, TOOL-02, TOOL-03 | Reproduções sintéticas; nenhuma execução do ID desabilitado. |
| Cadeia de suprimentos/updater | DIST-01, DIST-02 | Riscos documentais/configuração; pacote atual não inspecionado. |
| UI/UX | L-01…F-01, AC-01…AC-21 | Auditoria estática; runtime/a11y BLOCKED. |

### 1.3 O que ainda não foi validado

| Fluxo | Estado em `ae46c49` | Fonte |
|---|---|---|
| Boot oficial por `Lia.bat` | NOT RUN | QA matriz W-01 |
| Stage integrado pelo Launcher | NOT RUN | W-02 |
| AI Settings (16 passos) | **0/16**; passo 2 BLOCKED | QA matriz §5.1 |
| Conversa real ≥5 turnos | NOT RUN | W-16 |
| Tool calling `get_weather` round-trip | NOT RUN | W-17 / B3 |
| Histórico/memória após reinício | NOT RUN | W-18 |
| Sandbox/preload na janela real | NOT RUN (harness PASS) | W-14 |
| Encerramento/zero órfãos | NOT RUN (unit PASS) | W-11 |
| Voz Kokoro/STT real | BLOCKED/NOT RUN | H-01/H-02 |
| Render RX 580/DPI/multi-monitor | NOT RUN | H-03/H-04 |
| NSIS instalação/upgrade/uninstall | NÃO EXECUTADO | W-08 |
| Assinatura Authenticode | NOT SIGNED | W-12 |
| C0–C4 (desempenho/arquitetura) | NOT RUN | W-20 |
| OIDC real contra issuer | NOT RUN; `scripts/oidc-electron/` ausente | W-07/W-19 |
| CI Windows | NOT RUN | W-09 |

> O último commit funcional validado ponta a ponta em Windows continua `3ef6d11618f787dae6d197645d440a5775a60ad6`. A branch está **muito à frente** dele; os resultados Windows de PROMPT-40/42/43/44 são históricos e não transferem para `ae46c49`.

### 1.4 Correspondência dos relatórios com os SHAs declarados

| Relatório | Branch de origem | Commit do relatório | SHA declarado | Verificação nesta rodada |
|---|---|---|---|---|
| `LIA-QA-VALIDATION-2026-11-14.md` | `arena/18f50ae7-lia-project` | `dc3f68f` (base da rodada) | `7cb8172` | **Histórico.** Não usar como estado atual. |
| `LIA-VALIDATION-MATRIX-AE46C49-2026-11-14.md` | `arena/18f50ae7-lia-project` | `012cec5` | `ae46c49` | **Confirmado.** `00-environment.txt` registra HEAD `ae46c495…` e `git status --porcelain` = 0. A branch não contém o commit `ae46c49`; a evidência foi coletada em worktree destacada. |
| `LIA-ARQUITETURA-SEGURANCA-AE46C4-2026-11-14.md` | `arena/c6b02f64-lia-project` | `e8a44c2` | `ae46c49` | **Confirmado por proveniência declarada.** Base da branch é `7cb8172`; a árvore foi obtida por `git fetch`/`git archive` do SHA. O README das bancadas registra os comandos e resultados. Não reexecutei os probes. |
| `LIA-UI-UX-AUDIT-2026-11-14.md` | `arena/250b337a-lia-project` | `bd43ded` (rev. 2; original `e183cba`) | `ae46c49` | **Confirmado.** A branch contém `ae46c49` por merge `1d802cc`; `static-checks-revision-2.json` registra `reference_sha: ae46c49…`, `merge_sha: 1d802cc…` e `post_merge_delta: []`. |

**Conteúdo das branches:** as três adicionam apenas `docs/**` nos próprios commits. As bases QA (`5ec464e`) e Arquitetura (`7cb8172`) são anteriores a `ae46c49`; por isso o diff direto contra a branch principal mostra arquivos de código “diferentes” — é diferença de base, não edição de produto.

### 1.5 Divergências e ressalvas encontradas

1. **QA matriz — lint:** o texto resume “81 erros / 10 warnings”; o log `06-lint.log` mostra `81 problems (81 errors, 0 warnings)` no eslint e 10 avisos na fase oxlint. O número que vale é **81 erros eslint**; a menção a 10 warnings é da outra ferramenta.
2. **QA matriz — total de 5.664:** só o delta A-1 foi re-executado em `ae46c49`; 5.651 vêm de carry-forward de `5ec464e`. A matriz rotula isso, mas o número não deve ser lido como “tudo re-executado no SHA”.
3. **QA matriz — stage-ui:** “PASS parcial” é 1.153/1.153 testes PASS com **exit 1** por 1 unhandled rejection. Não é suíte verde.
4. **Relatório de arquitetura:** o título/arquivo usa “AE46C4”, mas o conteúdo e as referências são de `ae46c495…`. É erro de digitação no nome, não SHA diferente.
5. **Relatório de arquitetura — SEC-04:** a descrição “permite escopos não catalogados sem proteção” corresponde ao código atual, mas depende de existir um provider legado não curado com segredo gravado. Não é leitura irrestrita.
6. **UI/UX:** o HTML W1–W8 preserva no cabeçalho o SHA original `5ec464e`; a revisão 2 está no relatório e no JSON. O HTML é direção visual, não captura de runtime.
7. **A-1 nos três relatórios:** QA, Arquitetura e UI/UX concordam que o gate existe e funciona nos caminhos testados. Nenhum reabre o defeito antigo.
8. **Branches com base antiga:** um merge “cego” das branches de especialistas traria `CURRENT-STATE.md` desatualizado. O correto é cherry-pick/cópia dos documentos, nunca substituir a árvore.
9. **Critério de release da UI/UX:** o relatório de UI/UX pede AC-01…AC-16 + regressão AC-21. Esta consolidação propõe para o beta apenas AC-01…AC-08, AC-15 e a regressão AC-21, adiando AC-09…AC-14 e AC-16 (design system/navegação/diagnósticos) — é a decisão D5, não uma discordância silenciosa. AC-17…AC-20 dependem de estudo com usuários/hardware e ficam por fase.

---

## 2. Matriz única de achados

**Legenda de estado:** `DEM` = demonstrado por execução/reprodução; `EST` = confirmado por leitura estática; `COND` = condicional a premissas; `TEOR` = teórico, sem reprodução.
**Gravidade:** CRÍTICO / ALTO / MÉDIO / BAIXO, para o escopo de beta.

### 2.1 Ferramentas e capacidades

| ID | Achado | Evidência | Estado | Gravidade | Impacto no beta | Depende de | Dono | Próximo passo |
|---|---|---|---|---|---|---|---|---|
| A1-FECHADO | `defaultActive:false` não desabilitava; gate real criado (`enabledById`, `setToolEnabled`, `ToolDisabledError`) | `f3facdf`; testes 31/31; `tools.ts:76-178` | DEM | — | Fechado em código; round-trip ainda não provado | — | Arena | Manter regressão; não reabrir |
| TOOL-01 | Schema de ferramenta capturado antes da desabilitação pode permanecer na resolução concorrente; executor é bloqueado | `tools-probe.ts`: `raceSchema=[synthetic_tool]`, `raceRejected=true`, `rawCalls=0`; `tool-resolver.ts:128-154` | DEM (bancada) | MÉDIO | Baixo: não executa; pode apresentar schema obsoleto em corrida | Correção do resolvedor | Arena | Revalidar habilitação no último ponto antes do envio; teste de barreira |
| TOOL-02 | Colisão de nome permite que outra fonte homônima seja executada em send/rerun quando o ID registrado está desabilitado | `tools-probe.ts`: `byName=0`, `altCalls=1`, `rawCalls=0`; `tool-resolver.ts` mescla por nome | DEM (bancada) | MÉDIO | Condicional: exige duas fontes com o mesmo nome | Política de identidade canônica | Arena | Definir precedência por ID/autorização; impedir fallback ambíguo; testes MCP real/fallback |
| TOOL-03 | O gate não é autorização global: `mcp()`, `debug()`, spark, web-search e chamadas diretas do Main ficam fora do store | `tool-resolver.ts:137-151`; relatório A-1 §7 | EST | MÉDIO | Não bloqueia hoje; impede prometer “controle total” | Decisão de escopo da UI futura | Arena/Produto | Declarar escopo do gate; cobrir ou excluir explicitamente na UI futura |
| X-04 | Sem UI de ativação e sem persistência de `enabledById`; estado em memória/sincronizado | `tools.ts:82,192-195`; nenhum chamador de produção de `setToolEnabled` | EST | BAIXO/MÉDIO | Não bloqueia (decisão `ae46c49`); dor futura | Autorização de produto | Produto/Arena | Adiar; quando autorizado, definir dono único da preferência |

### 2.2 Segurança e autenticação

| ID | Achado | Evidência | Estado | Gravidade | Impacto no beta | Depende de | Dono | Próximo passo |
|---|---|---|---|---|---|---|---|---|
| SEC-01 | Tokens OIDC (`access`, `refresh`, `id`) chegam ao Renderer e são gravados em `localStorage` | `stage-tamagotchi/.../auth.ts:27-32,115-164,193-223`; `stage-ui/stores/auth.ts:17-50,155-169,233-272` | DEM (código) | ALTO | **Bloqueia se OIDC estiver no escopo**; roubo não demonstrado | Decisão D1 | Arena | Main como dono da sessão; remover tokens do Renderer/storage legado; migração |
| SEC-02 | Refresh em voo concluído após logout repovoa tokens e `isAuthenticated=true` | `auth.ts:150-186,298-348`; `auth-probe.ts`: `clearedAfterLogout=true`, `restoredToken=true`, `authenticated=true` | DEM (bancada) | ALTO | **Bloqueia se OIDC estiver no escopo** | D1 | Arena | Geração de sessão/cancelamento; descartar respostas antigas; limpar local antes da rede |
| SEC-03 | Logout remoto sem checagem de `response.ok`, sem timeout explícito e sem revogação comprovada de refresh | `auth.ts:298-326` | EST | MÉDIO | Condicional; sessão remota pode sobreviver | D1 | Arena | Distinguir confirmado/timeout/falha; revogação conforme issuer; testes 4xx/5xx/offline |
| SEC-04 | Renderer pode ler credencial legada de provider não curado em condições específicas | `main/index.ts:450`; `transport-config-service.ts:49-64`; `secrets-service.ts:137-145` | EST | ALTO (se legado existir) | **Bloqueia beta externo** com providers legados; não afeta curados | Inventário de escopos | Arena | Migrar consumidores para o Main; remover leitura genérica; canários |
| SEC-05 | Mutação de endpoint pode reaproveitar credencial para destino diferente | `transport-config-service.ts:78-90`; `lia/core/.../validation.ts:16-22,60-68`; `repository.ts:133-153` | EST | ALTO (condicional) | **Bloqueia beta externo** se o bridge de config for alcançável | Autorização de destino | Arena | Vincular credencial↔host no owner; autorizar troca; HTTPS por padrão |
| SEC-06 | MCP permite spawn de processo e expõe stderr/env via configuração privilegiada | `mcp-servers/index.ts:166-184,340-413`; `stores/tools/mcp.ts:22-32` | EST | ALTO (cond.) / MÉDIO (logs) | Condicional a Renderer comprometido | SEC-01/05 | Arena | Autorização de sender/capacidade; confirmação; vault por referência; política de log |
| SEC-07 | Confiança TLS por campos textuais do certificado (CN/issuer), sem chave/fingerprint | `channel-server/index.ts:220-253` | EST | ALTO (cond.) | Condicional; MITM não demonstrado | — | Arena | Pinar CA/chave; hostname; ciclo de vida; testes com CA impostora |
| SEC-08 | CSP do Stage está comentada; não há prova de política efetiva em todas as distribuições | `renderer/index.html:6-17` | EST | MÉDIO | Defesa em profundidade; não bloqueia sozinho | — | Arena | Definir CSP restritiva compatível com assets; validar no build real |
| SEC-09 | Repositório de transportes não tem lock multiprocesso visível no módulo | `repository.ts:70-119,133-153`; Launcher e Stage criam instâncias | TEOR | MÉDIO | Baixo para beta; risco de lost update | Confirmar mesmo arquivo | Arena | Provar topologia; owner único ou CAS/lock entre processos; teste com barreira |

### 2.3 Qualidade, CI, distribuição e cadeia de suprimentos

| ID | Achado | Evidência | Estado | Gravidade | Impacto no beta | Depende de | Dono | Próximo passo |
|---|---|---|---|---|---|---|---|---|
| DIST-01 | Dependências/downloads/licenças sem SBOM e com hashes incompletos (Kokoro `soundfile`, notices Spine/Cubism) | `kokoro/manifest.ts:17-29,68-76`; `THIRD-PARTY-NOTICES.md` | EST | MÉDIO | **Bloqueia beta externo** (conformidade) | D8 (licenças/mirror) | Arena + Produto | Lock/hashes transitivos, SBOM, revisão de scripts e notices do artefato |
| DIST-02 | Updater upstream ativo em modos não gerenciados | `stage-tamagotchi/main/index.ts:262-266`; `auto-updater.ts:308-325` | EST | MÉDIO (cond.) | Condicional ao modo de distribuição | D3 | Arena | Política de feed por distribuição; fail-closed; testes de modo |
| QA-01 | `pnpm lint` falha com 81 erros eslint (59 auto-fixáveis) | `06-lint.log` no SHA `ae46c49` | DEM | MÉDIO | **Bloqueia CI verde** (C-2) | D7 (escopo do lint) | Arena | Escopar regras de QA/scripts; corrigir mecânicos; meta exit 0 |
| QA-02 | stage-ui termina exit 1 com 1.153 testes PASS por rejeição não tratada (`updateCredits` → `api.airi.build`) | `04-test-stage-ui.log` | DEM | MÉDIO | **Bloqueia CI verde** (C-16) | — | Arena | Stub do client nas suítes; exigir 0 unhandled rejections |
| QA-03 | Build do renderer do Stage falha sem rede (`dist.ayaka.moe`, ECONNRESET) | `09-build-stage.log` | DEM | ALTO | **Bloqueia build reproduzível e pacote** (C-4) | D8 | Arena + Produto | Inventariar assets; licenciar/espelhar com hash; build offline |
| QA-04 | Projeto browser (Stage/stage-ui) BLOCKED por ausência de Chromium/CDN | `25…`, `29…` | DEM (bloqueio) | BAIXO/MÉDIO | Cobertura, não funcionalidade | CI com Playwright | Arena | Job de CI com `playwright install --with-deps chromium` |
| QA-05 | Instalação documentada (`pnpm install` em `airi/`) cria `.git` falso via postinstall no layout subtree | `LIA-QA-VALIDATION` §3.5; inspeção estática | EST | MÉDIO | **Bloqueia instalação reproduzível** (C-1) | D7 | Arena | Documentar `--ignore-scripts` + ordem de build ou corrigir postinstall |
| QA-06 | Nenhum runtime Windows no SHA candidato (W-01…W-20) | Matriz QA §2.B | DEM (ausência) | CRÍTICO | **Bloqueia beta** | SHA congelado | Codex | Executar roteiro §7 (Partes 2–8) |
| QA-07 | Tool calling ponta a ponta nunca observado | W-17/B3; 0/1 round-trip | DEM (ausência) | CRÍTICO | **Bloqueia beta** | QA-06 | Codex | `get_weather` real com `tool-call`/`tool-result` |
| QA-08 | NSIS instalação/upgrade/uninstall nunca executado; sem assinatura | W-08/W-12 | DEM (ausência) | ALTO | **Bloqueia distribuição** | QA-03 | Codex + Produto | `package-windows.mjs --internal-test`; decisão de assinatura |
| QA-09 | Voz/STT/GPU/DPI/1h não validados | H-01…H-05 | DEM (ausência) | ALTO (se voz no escopo) | **Bloqueia se voz for beta** | D2 | Codex | Smoke Kokoro, STT, render, soak |
| QA-10 | Gate C0–C4 aberto; sem medições comparáveis | W-20; decisão de runtime | DEM (ausência) | MÉDIO/ALTO | **Bloqueia se arquitetura for gate de beta** | D4 | Codex mede; Arena analisa | Protocolo aprovado; C0–C4 no pacote |
| QA-11 | Gate `oidc-electron` e IPC/recursos OIDC ausentes do repositório | W-07; `scripts/oidc-electron/` inexistente | DEM | ALTO (se OIDC) | **Bloqueia OIDC** | D1 | Codex/Arena | Decidir entra (commit + gate) ou sai (remoção formal) |
| QA-12 | Evidências Windows de PROMPT-37/OIDC só existiam em worktree local | B6; relatório de branch | EST | MÉDIO | Processo/auditoria | Codex | Codex | Commitar evidência e limpar worktree |
| QA-13 | Baseline funcional `3ef6d11` está muito atrás do tip | `CURRENT-STATE.md` §1 | EST | MÉDIO | Nenhum resultado histórico transfere | QA-06 | Codex | Revalidar no SHA de beta |

### 2.4 UI/UX

| ID | Achado | Evidência | Estado | Gravidade | Impacto no beta | Depende de | Dono | Próximo passo |
|---|---|---|---|---|---|---|---|---|
| UI-L01 | Primeiro uso conclui “somente texto” sem configurar IA, mas mantém CTA “Conversar com Lia” | `home-vm.ts:27-43,79-99`; 6 asserts puros | EST/DEM (VM) | ALTO | **Bloqueia primeira experiência** | — | Arena | Separar prontidão de preferência; CTA contextual; teste |
| UI-S01 | Limpar chat é destrutivo sem confirmação nem nome acessível | `InteractiveArea.vue:355-362`; `chat.ts:862-867` | EST | ALTO | Risco de perda de contexto no beta | — | Arena | Confirmação de escopo, cancelar padrão, foco |
| UI-S02 | Remover provedor apaga transporte/chaves sem confirmação | `LiaProviderConfig.vue:323-362` | EST | ALTO | Risco de perda de configuração | — | Arena | Reutilizar padrão `DoubleCheckButton` |
| UI-L02 | IA editável em superfícies concorrentes (Launcher novo + `ConfigView` legada + Stage) | `ConfigView.vue`; `AiResourcesView.vue`; `LiaProviderConfig.vue` | EST | ALTO | Confusão e edição recusada | SEC-04/05 | Arena | Uma porta normal; legado em Avançado |
| UI-L03 | Estados/cópias de voz divergem entre Launcher e Stage | `voice-engine-card.vm.ts`; `VoiceSection.vue` | EST | MÉDIO | Usuário não sabe se voz funciona | D2 | Arena | Projeção única por capacidade |
| UI-A01 | CTA branco sobre `#e545c8` = 3,49:1 (abaixo de AA 4,5:1) | Cálculo WCAG refeito nesta rodada | DEM (cálculo) | MÉDIO | Qualidade/acessibilidade | — | Arena | Token de ação `#a62b90` (6,23:1) ou texto escuro |
| UI-A02 | Foco/teclado/nomes acessíveis inconsistentes (tabs, composer, ícones) | `LiaConfigPanel.vue`; `InteractiveArea.vue`; `select-tab.vue` | EST | MÉDIO | Acessibilidade | — | Arena | Corrigir primitivos; matriz accname/teclado |
| UI-L04 | Navegação sem deep-link/voltar; “Configuração” ambíguo | `App.vue`; `home-vm.ts:33` | EST | BAIXO/MÉDIO | Pós-beta | Fase 2/3 | Arena | Destinos estáveis; `aria-current` |
| UI-S03 | Loading em inglês com flash infinito; auto-collapse por tempo; drag hint morto | `pages/index.vue`; `controls-island/index.vue` | EST | BAIXO/MÉDIO | Pós-beta | — | Arena | Loading localizado; não recolher com foco |
| UI-X01 | Tokens, Tailwind cru, hex e três mecanismos de strings coexistem | `lia-tokens.css`; painéis Stage | EST | BAIXO/MÉDIO | Pós-beta | Fase 2 | Arena | Consolidar design system |
| UI-X02 | Conceitos mostram capacidades não aprovadas | `docs/design/concepts/01–07`; `AppearanceSection.vue` | EST | BAIXO | Expectativa falsa | D5 | Produto | Conceito como direção; UI capability-driven |
| UI-F01 | Caminhada contínua, jogos, extensões, roupas | docs/wireframes | EST | BAIXO | Fora do beta | D5 | Produto | Spec separada; sem toggles falsos |

---

## 3. Bloqueadores do beta

### 3.1 Bloqueadores comprovados (impedem declarar beta hoje)

| # | Bloqueador | Prova | Fecha com | Dono |
|---|---|---|---|---|
| **B-01** | **Nenhuma prova de runtime no SHA candidato** — boot, Stage, AI Settings, conversa, histórico, encerramento | QA matriz W-01…W-20; AI Settings 0/16 | Evidência Windows §7 Partes 2–8 no SHA congelado | Codex |
| **B-02** | **Tool calling sem round-trip real** | W-17/B3; nenhuma suíte observa `get_weather` ponta a ponta | Log `tool-call` + `tool-result` + resposta citando open-meteo | Codex |
| **B-03** | **Build do renderer não reproduzível** — depende de `dist.ayaka.moe` e quebra com ECONNRESET | `09-build-stage.log` | Build limpo sem rede, assets com hash (e licença) | Arena + Produto |
| **B-04** | **Distribuição não executada e sem assinatura** | W-08/W-12 nunca executados | NSIS clean/upgrade/uninstall + decisão de assinatura | Codex + Produto |
| **B-05** | **OIDC inseguro no estado atual, se estiver no escopo** — tokens no Renderer/`localStorage` + refresh pós-logout | SEC-01 (código) e SEC-02 (bancada) | Tokens só no Main; geração/cancelamento; testes; ou remoção formal de OIDC | Arena + Produto |
| **B-06** | **CI vermelho** — lint 81 erros; stage-ui exit 1 | `06-lint.log`; `04-test-stage-ui.log` | Lint 0; stage-ui exit 0; zero unhandled rejections | Arena |

### 3.2 Bloqueadores condicionais (dependem de decisão de escopo)

| # | Condição | Se a resposta for “sim” | Se for “não” |
|---|---|---|---|
| **C-B01** | Voz/STT faz parte do beta? | H-01/H-02/H-05 viram bloqueadores (Kokoro real, mic, soak) | Documentar “voz fora do beta”; UI não promete voz pronta |
| **C-B02** | Gate de arquitetura/desempenho (C0–C4) é critério de beta? | W-20 vira bloqueador; thresholds aprovados antes | Documentar adiamento e critério de aceitação |
| **C-B03** | Beta externo (usuários fora da equipe)? | SEC-04/05/06/07, DIST-01/02, assinatura e licenças entram como P0 | Beta interno pode aceitar riscos residuais documentados |
| **C-B04** | OIDC entra no beta? | B-05 (SEC-01/02/03/QA-11) precisa fechar | Remover/desabilitar todos os pontos de entrada e consumidores |

### 3.3 Riscos que exigem investigação (não são incidentes comprovados)

| Risco | Estado | O que falta para classificar | Prazo sugerido |
|---|---|---|---|
| SEC-03 — logout/revogação remota | EST | Issuer realista; 4xx/5xx/timeout; replay | Etapa 3 |
| SEC-04 — leitura legada | EST | Inventário de escopos legados; canário no Renderer | Etapa 3 |
| SEC-05 — destino de credencial | EST | IPC real; sender não autorizado; redirect/HTTP | Etapa 3 |
| SEC-06 — MCP spawn/logs | EST | Processo sintético; prompt injection; segredo em stderr | Etapa 3 |
| SEC-07 — TLS textual | EST | CA impostora com nomes iguais; hostname errado | Etapa 3 |
| SEC-08 — CSP | EST | Inspeção de CSP efetiva em build real | Etapa 3 |
| SEC-09 — concorrência de repositório | TEOR | Dois processos no mesmo arquivo; crash | Etapa 3/4 |
| TOOL-01/02 | DEM (bancada) | Payload real ao provider; colisão real MCP/plugin | Etapa 4 |
| DIST-01/02 | EST | Pacote real; SBOM; modo de distribuição | Etapa 6 |

### 3.4 P1 de produto/UX — corrigir antes do beta, sem impedir o build

| ID | Correção | Por que antes do beta | Tamanho |
|---|---|---|---|
| UI-L01 | Prontidão separada de preferência; CTA contextual | Primeiro uso hoje promete conversa que pode não existir | P |
| UI-S01 | Confirmação para limpar chat | Perda de contexto por acidente | P |
| UI-S02 | Confirmação para remover provedor | Perda de configuração/credencial | P |
| UI-L02 | Uma porta normal de IA; legado em Avançado | Evita edição concorrente e recusada | M (depende de SEC-04/05) |
| UI-L03 | Estado de voz único por capacidade | Só se D2 = voz no beta | M |
| UI-A01 | Contraste do CTA ≥ 4,5:1 | Barato e verificável | P |
| UI-A02 | Foco/teclado/nome acessível nos primitivos | Requisito de qualidade do beta | M |

### 3.5 Não bloqueadores (agendar depois)

UI-L04 (navegação/deep-link), UI-S03 (loading/flash), UI-X01 (design system), UI-X02 (conceitos), UI-F01 (futuro), X-04 (UI de ativação adiada por decisão) e QA-04 (browser) — este último vira gate de CI, não de produto.

---

## 4. Plano sequenciado

> Tamanho relativo: **P** ≤ 2 dias úteis; **M** 3–7; **G** 1–3 semanas. Não são datas comprometidas.
> Este plano reordena as Fases A–D propostas pelo QA para refletir duas dependências que o relatório não podia ver sozinho: segurança de sessão antes de consolidar a UI de IA e build reproduzível antes de empacotar. O conteúdo é compatível; a ordem é que muda.

### Etapa 0 — Decisões de escopo (P, produto)

| # | Decisão | Saída |
|---|---|---|
| D1 | OIDC entra ou sai do beta? | Registro em `CURRENT-STATE.md`; se sair, remoção formal dos pontos de entrada |
| D2 | Voz/STT entra ou sai? | Escopo de beta e critério de aceitação |
| D3 | Beta interno ou externo? Assinatura? | Política de distribuição e decisão sobre unsigned |
| D4 | C0–C4 é gate? Quais thresholds? | Protocolo e limites aprovados antes da coleta |
| D5 | Fase 0/1 de UI autorizada? | Lista de P1 autorizados; sem redesenho |
| D6 | Dono da preferência de ferramentas (futuro) | Decisão registrada; UI continua adiada |
| D7 | Escopo do lint (scripts de QA/.mjs) e caminho de instalação | Regra de CI e documentação |
| D8 | Licença/mirror dos assets Live2D/VRM/Cubism | Estratégia de cache/vendor com hash |

**Saída da etapa:** decisões registradas; nenhuma linha de código.

### Etapa 1 — Portões de qualidade (P/M, Arena)

1.1 Escopar lint para `scripts/provider-runtime-electron/**` e `.mjs` de QA; aplicar `--fix` nos 59 mecânicos; resolver os manuais.
1.2 Stubbar `updateCredits`/`api.airi.build`; exigir 0 unhandled rejections.
1.3 Corrigir/documentar instalação (`--ignore-scripts` + ordem `build:packages` antes de typecheck; evitar `.git` falso).
1.4 Job de CI Linux replicando a matriz (cache pnpm, `ELECTRON_OVERRIDE_DIST_PATH`, `build:packages`, vitest node, lint).

**Conclusão objetiva:** `pnpm lint` exit 0; stage-ui exit 0; clone limpo instala e builda; job CI verde.

### Etapa 2 — Build reproduzível (M, Arena + produto)

2.1 Inventariar todo download de build (Live2D/VRM/Cubism) e onde é usado.
2.2 Resolver licença (D8) e escolher cache/mirror/vendor com hash.
2.3 Implementar fallback fail-closed e build offline.
2.4 Job de browser com Chromium (onde a rede permitir) ou gate externo documentado.

**Conclusão objetiva:** `electron-vite build` do Stage completa sem rede, com hashes registrados; suíte browser verde em CI.

### Etapa 3 — OIDC e credenciais (G, Arena; Codex valida no Windows)

3.1 Se OIDC fica: Main dono de sessão/refresh; Renderer recebe apenas estado não secreto; remover `localStorage` e migrar/limpar o legado.
3.2 Geração de sessão e cancelamento; logout local imediato; revogação remota com timeout e resultado explícito.
3.3 SEC-04: eliminar leitura de segredo legado pelo Renderer; migrar consumidores.
3.4 SEC-05: vínculo credencial↔endpoint; autorização de troca no Main; HTTPS por padrão.
3.5 SEC-06/07/08: autorização de MCP, pinagem criptográfica de CA, CSP efetiva.
3.6 SEC-09: provar topologia; owner único ou CAS/lock multiprocesso.

**Conclusão objetiva:** canários não encontram tokens/segredos no Renderer, `localStorage`, DOM, logs ou perfil; corrida de logout teste passa; SEC-04/05 fechados ou aceitos por escrito; MITM com CA impostora falha.

### Etapa 4 — Política de ferramentas (P/M, Arena)

4.1 TOOL-01: revalidar habilitação no último ponto antes da apresentação; semântica de snapshot/revogação.
4.2 TOOL-02: identidade canônica e precedência; fonte homônima não ressuscita ID desabilitado.
4.3 TOOL-03: declarar escopo do gate; cobrir `mcp()`/`debug()`/spark/web-search ou excluí-los explicitamente da promessa.

**Conclusão objetiva:** testes de send/retry/rerun, colisão e concorrência passam; nenhum executor desabilitado roda; documentação de escopo atualizada.

### Etapa 5 — Validação Windows (M, Codex)

5.1 Partes 2–3: boot, Stage, sandbox/preload na janela real.
5.2 Parte 4: AI Settings 16/16, com recusas AF-1 e persistência.
5.3 Parte 5: conversa ≥5 turnos com memória.
5.4 Parte 6: tool calling `get_weather` + verificação do gate A-1.
5.5 Parte 7: voz (se D2 = sim).
5.6 Parte 8: encerramento/zero órfãos, `single-instance`.
5.7 Parte 10/11: C0–C4 (se D4 = sim) e OIDC real (se D1 = sim).

**Conclusão objetiva:** cada item com SHA, comando, log sanitizado e resultado; nenhum PASS por inferência.

### Etapa 6 — Distribuição (M, Codex + Arena)

6.1 `package-windows.mjs --internal-test` + `--check`.
6.2 Instalação limpa, upgrade sobre anterior, uninstall preservando `%APPDATA%\Lia`.
6.3 Inventário de licenças/notices do artefato; SBOM; hashes.
6.4 Assinatura Authenticode ou decisão escrita de release unsigned.

**Conclusão objetiva:** ciclo NSIS completo registrado; instalação abre AI Settings; dados preservados; decisão de assinatura anexada.

### Etapa 7 — Congelamento e revalidação (P, Arena + Codex)

7.1 Tag/commit candidato; nenhuma alteração de código durante a coleta.
7.2 Re-executar a matriz QA inteira no SHA taggeado (C-19), não só o delta.
7.3 Rodar o subconjunto de AC de UI aprovado (AC-01…AC-08 + regressão AC-21).
7.4 Revisão final de segurança e varredura anti-segredo.
7.5 Atualizar `CURRENT-STATE.md`; publicar relatório de beta e evidências.

**Conclusão objetiva:** todos os gates G-01…G-12 (§7) verdes no mesmo SHA; nenhum P0/P1 aberto; riscos residuais aceitos por escrito.

---

## 5. Divisão de trabalho

| Frente | Codex (Windows) | Arena (Linux/sandbox) | Produto (usuário) |
|---|---|---|---|
| Escopo e aceitação | Executa e reporta o que foi pedido | Analisa e documenta | **Decide D1–D8**; aceita riscos residuais |
| Qualidade/CI | CI Windows; evidências | Lint, stub, instalação, CI Linux | Aprova escopo do lint |
| Build/assets | Valida build no Windows | Mirror/hash/licença (com produto) | Decide licença/vendor (D8) |
| OIDC/segurança | Teste Electron real, issuer, IPC | Implementa Main-only, cancelamento, SEC-04/05/06/07 | Decide OIDC in/out (D1) |
| Ferramentas | Round-trip e gate na sessão | TOOL-01/02/03, testes | Mantém decisão de A-1 (sem UI agora) |
| Runtime | Boot, AI Settings, conversa, histórico, órfãos | Analisa logs; corrige defeitos encontrados | Aprova critérios de PASS |
| Distribuição | NSIS, assinatura (se houver cert) | Licenças/SBOM, revisão do pacote | Decide unsigned/assinado (D3) |
| Performance/voz | C0–C4, Kokoro, STT, GPU, soak | Protocolo e análise | Define thresholds (D4) e voz (D2) |

**Regra de ouro:** Codex não valida sobre worktree sujo; Arena não edita durante a janela de coleta Windows; o SHA da coleta é anunciado antes e não muda até o fim.

---

## 6. Conflitos e dependências

### 6.1 Não podem ocorrer simultaneamente

| Conflito | Arquivos/fluxos | Por quê | Ordem |
|---|---|---|---|
| OIDC × UI de conta | `stage-ui/stores/auth.ts`, `stage-tamagotchi/main/services/airi/auth.ts`, `pages/settings/account` | Mesma pilha de sessão; mudar contrato enquanto a UI valida gera resultados inválidos | Etapa 3 antes de qualquer ajuste de UI de conta |
| Segurança de credenciais × L-02 | `transport-config-service.ts`, `ConfigView.vue`, `AiResourcesView.vue`, `LiaProviderConfig.vue` | A UI pode depender do bridge que será alterado | Etapa 3 antes da consolidação de IA |
| Ferramentas × UI de ativação | `tools.ts`, `chat.ts`, `tool-resolver.ts` | TOOL-01/02 mudam a semântica antes de existir UI | Etapa 4 antes de X-04 |
| Lint em massa × qualquer código em voo | 3.490 arquivos | `--fix` reescreve imports/ordem e conflita com patches | Etapa 1, em janela limpa |
| Build/assets × NSIS | `electron.vite.config`, assets Live2D, empacotador | Pacote precisa de build estável | Etapa 2 antes da 6 |
| Código × validação Windows | todo o repo | Evidência só vale no SHA coletado | Congelar antes da 5 |
| `CURRENT-STATE.md` | um arquivo único | Três branches o reescrevem em bases diferentes | Só o agente principal edita; especialistas entregam texto |
| Branches de especialistas | bases `5ec464e`/`7cb8172` | Merge cego traz estado antigo | Cherry-pick de docs, nunca substituir árvore |

### 6.2 Dependências

- B-03 (assets) → B-04 (NSIS) e C-4.
- B-05/OIDC (D1) → SEC-03, QA-11 e UI de conta.
- SEC-04/05 → L-02 (uma porta normal de IA) e parte de SEC-06.
- B-06 → CI verde de todas as etapas seguintes.
- Etapa 5 depende de Etapas 1–4 concluídas no SHA congelado; se qualquer correção entrar depois, a coleta reinicia.
- Etapa 7 depende de 5 e 6; não é possível “declarar beta” com evidência de SHA anterior.

### 6.3 Trabalho seguro em paralelo

- Codex pode preparar roteiros, fixtures e checagens de ambiente no Windows enquanto Arena fecha 1–4, **sem** produzir evidência oficial.
- Arena pode adiantar documentação de licenças/SBOM enquanto Codex empacota.
- UI P1 (L-01, S-01, S-02, A-01) pode rodar em paralelo com segurança **se** não tocar `auth.ts`, `transport-config-service.ts` ou o store de ferramentas.

---

## 7. Critérios de saída do beta

O beta só é declarado quando **todos** os gates abaixo estiverem verdes **no mesmo SHA taggeado**, com evidência commitada.

| Gate | Critério | Evidência mínima | Estado atual |
|---|---|---|---|
| **G-01 — Código** | Lint exit 0; stage-ui exit 0; typechecks Lia 0; suítes node verdes; zero unhandled rejections | Logs + SHA | FAIL (lint 81; stage-ui exit 1) |
| **G-02 — Instalação** | Clone limpo instala e builda sem criar `.git` falso; `build:packages` antes de typecheck | Script/log de clone limpo | PARCIAL/FAIL documental |
| **G-03 — Build** | Stage renderer compila offline com assets hashados; sem dependência de host de terceiros em build-time | Log + hashes | BLOCKED |
| **G-04 — Runtime Windows** | Boot por `Lia.bat`; Stage pelo botão; AI Settings **16/16**; conversa ≥5 turnos; histórico após reinício; zero órfãos; sandbox/preload na janela real | Logs sanitizados + screenshots + PIDs | NOT RUN |
| **G-05 — Tool calling** | `get_weather` real: `tool-call`, `tool-result`, resposta citando o dado; gate A-1 verificado (desabilitar bloqueia apresentação e execução) | Log + payload + anotação | NOT RUN |
| **G-06 — Segurança OIDC** | Nenhum token no Renderer/`localStorage`/DOM/logs; refresh pós-logout não restaura; logout remoto com resultado explícito; teste de canário | Testes Electron + inspeção | FAIL/BLOCKED (SEC-01/02) |
| **G-07 — Credenciais/MCP/TLS** | SEC-04/05/06/07 fechados ou risco aceito por escrito; CSP efetiva; segredos ausentes de logs | Testes + revisão | EST (não corrigido) |
| **G-08 — Ferramentas** | TOOL-01/02 cobertos; escopo do gate documentado; nenhuma promessa de controle total | Testes + doc | Bancada DEM |
| **G-09 — Distribuição** | NSIS clean/upgrade/uninstall; dados preservados; licenças/SBOM; assinatura ou decisão unsigned | Logs + inventário + decisão | NÃO EXECUTADO |
| **G-10 — Performance/Arquitetura** | C0–C4 medidos contra thresholds aprovados; sem regressão vs baseline; soak 1h se aplicável | CSV/JSON + protocolo | NOT RUN |
| **G-11 — Voz (se D2=sim)** | Kokoro instala/pré-aquece/sintetiza com RTF; STT captura e cancela | Log + medição | BLOCKED/NOT RUN |
| **G-12 — Processo** | Matriz QA re-executada no SHA taggeado; AC-01…AC-08, AC-15 e regressão AC-21; `CURRENT-STATE.md` no mesmo commit; evidências versionadas; scan anti-segredo | Relatórios + commits | NOT RUN |

**Definição de PASS:** resultado executado, com SHA, ambiente, comando, saída e artefato sanitizado. **Skip não é PASS. Mock não prova integração real. Linux não substitui Windows.** Documentação não é prova de execução.

**Escopo de AC nesta proposta:** AC-09…AC-14 e AC-16 (design system, i18n, navegação, diagnósticos) ficam para as Fases 2/3; AC-17…AC-20 (estudo com usuários, performance, multi-monitor) têm gate próprio. O relatório de UI/UX lista AC-01…AC-16 como release; a diferença é deliberada e depende de D5.

**Riscos residuais:** se o produto decidir beta interno, SEC-04/05/06/07 e DIST-01 podem ser aceitos por escrito com prazo e plano; SEC-01/02 **não** devem ser aceitos se OIDC estiver acessível ao usuário, porque são o mecanismo de sessão. Se OIDC sair do escopo, a remoção precisa ser efetiva (entrada e consumidores), não apenas esconder a tela.

---

## 8. Decisões que dependem do usuário

1. **D1 — OIDC:** entra no beta (e B-05 vira P0) ou sai (remoção formal)?
2. **D2 — Voz:** entra no beta (Kokoro/STT/hardware) ou fica para depois?
3. **D3 — Público:** beta interno ou externo? Release assinado ou unsigned documentado?
4. **D4 — Performance:** C0–C4 é gate de beta? Quais thresholds?
5. **D5 — UI:** autorizar a Fase 1 (P1: prontidão, confirmações, contraste, a11y) sem redesenho?
6. **D8 — Assets/licenças:** autorizar mirror/vendor dos modelos Live2D/VRM com hash e revisão de licença?

Sem essas respostas, as Etapas 3–6 podem começar apenas nas partes independentes (higiene, build e tool policy); a validação Windows pode preparar ambiente, mas a evidência oficial precisa esperar o congelamento.

---

## Anexo A — Arquivos consultados

**Relatórios (lidos das branches de origem, sem merge):**

- `docs/reports/LIA-QA-VALIDATION-2026-11-14.md` — `origin/arena/18f50ae7-lia-project`
- `docs/reports/LIA-VALIDATION-MATRIX-AE46C49-2026-11-14.md` — idem
- `docs/reports/LIA-ARQUITETURA-SEGURANCA-AE46C4-2026-11-14.md` — `origin/arena/c6b02f64-lia-project`
- `docs/reports/LIA-UI-UX-AUDIT-2026-11-14.md` — `origin/arena/250b337a-lia-project`
- Evidências: `LIA-QA-VALIDATION-ae46c49-2026-11-14/` (11 logs), `lia-audit-ae46c4/README.md`, `lia-ui-ux-audit-2026-11-14/static-checks-revision-2.json`

**Código e documentos verificados nesta rodada:**

- `airi/packages/stage-ui/src/stores/ai/chat-llm/{tools.ts,tool-resolver.ts,tool-name.ts}`, `tool-call-rerun.ts`, `chat.ts`
- `airi/apps/stage-tamagotchi/src/main/services/airi/{auth.ts,mcp-servers/index.ts,channel-server/index.ts}`
- `airi/apps/stage-tamagotchi/src/main/services/lia/{transport-config-service.ts,secrets-service.ts}`
- `airi/apps/stage-tamagotchi/src/renderer/index.html`
- `airi/apps/lia-app/src/renderer/src/views/home-vm.ts`, `InteractiveArea.vue`
- `lia/core/src/transports/{validation.ts,repository.ts}`, `lia/core/src/credentials/owner-channel.ts`
- `docs/project/CURRENT-STATE.md`, `docs/reports/LIA-A1-TOOL-ENABLEMENT-2026-11-14.md`, `docs/reports/LIA-BRANCH-AUDIT-2026-11-14.md`

## Anexo B — Integridade desta consolidação

- Base restaurada para `ae46c49` por `fetch` → `read-tree` → `checkout-index -a -f` → `update-ref` → `set-upstream-to`; sem `checkout`/`switch`/reset/clean/force push.
- `tools/stt-bench/RX580-GPU-FEASIBILITY.md` preservado como arquivo local não rastreado (md5 `de29ede227a082f880559c38e1b54360`).
- Nenhum código de produto alterado; nenhuma branch de especialista mergeada; nenhuma evidência apagada.
- Reexecução própria: `tools.test.ts` 13/13, `tool-resolver.test.ts` 11/11, `tool-call-rerun.test.ts` 7/7, `built-in.test.ts` 1/1 (árvore de código idêntica a `ae46c49`), `tsc` sem erros nos arquivos alterados e eslint limpo neles.
- Cálculos de contraste WCAG refeitos independentemente; valores conferem com o relatório de UI/UX.
