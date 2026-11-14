# Lia — Plano executável do beta interno (revisão 2)

**Data:** 14/11/2026
**Branch:** `arena/01a10290-lia-project`
**Base desta revisão:** `407300b8baa56b0ed8d14b7b2c0628222754e51f` (consolidação rev. 1), sobre `ae46c49`.
**SHA de código auditado:** `ae46c495d7da7cd33f4b4da8f4e8cc95b0a867b6` — nenhum código de produto mudou desde então.
**Natureza:** documentação e coordenação. **Nenhuma implementação de produto nesta rodada**, nenhum merge de branch de especialista, A-1 não reaberto.

---

## 0. Decisões de produto que regem este plano

| ID | Decisão | Consequência direta no plano |
|---|---|---|
| **DP-1** | Primeiro beta é **interno** | Bloqueadores de distribuição pública (licença comercial, SmartScreen/assinatura, telemetria) deixam de ser P0; permanecem os de integridade do pacote. Tester externo não é público. |
| **DP-2** | **Voz e STT são obrigatórios** para aprovação | Áudio deixa de ser “condicional” e vira gate bloqueante (G-AUD). Kokoro/STT reais passam de NOT RUN para P0. Toda a §4 existe por causa disso. |
| **DP-3** | **Fase 1 de UI/UX autorizada** | L-01, S-01, S-02, A-01, A-02 entram no escopo do beta; L-02 depende de segurança; L-03 entra junto com áudio. Design system completo (Fase 2) continua fora. |
| **DP-4** | **OIDC sem decisão** — não aprovado, não seguro | OIDC sai do **caminho funcional** do beta sem remoção definitiva: entrada desabilitada, nenhuma requisição de auth, tokens legados ignorados/limpos. Ver §9. |
| **DP-5** | **Instalador interno unsigned aceitável com aviso claro** | Authenticode deixa de bloquear; entram aviso no instalador/README, hash SHA-256 publicado e nota em `DISTRIBUTION-NOTICE`. |
| **DP-6** | **Asset sem licença/proveniência confirmada não pode ser redistribuído** | Define o corte de assets da §8: VRM AvatarSample fica; Live2D/Cubism, Hero PNG e demais não verificados saem do pacote do beta. |

### 0.1 O que mudou em relação à revisão 1

| Tema | Revisão 1 | Revisão 2 |
|---|---|---|
| Público | decisão pendente (D3) | **interno** (DP-1) |
| Voz | bloqueador condicional (D2) | **obrigatório**; gate G-AUD com 15 critérios |
| UI | Fase 0/1 a autorizar (D5) | **Fase 1 autorizada** (DP-3) com escopo fechado |
| OIDC | decisão pendente (D1) | **fora do caminho funcional** até decisão (DP-4, §9) |
| Assinatura | “ou decisão unsigned” | **unsigned aceito** com aviso + hash (DP-5) |
| Assets | “licença/mirror a decidir (D8)” | corte explícito: VRM sim; Live2D/Cubism/Hero não (DP-6, §8) |
| Bloqueadores | 6 comprovados | 7 comprovados (áudio entra), 3 condicionais (C0–C4, Live2D, Hero PNG) |

### 0.2 Leitura rápida

1. O beta interno **não pode ser declarado** hoje: falta runtime Windows, tool calling, áudio real e instalador.
2. O que **pode começar já**, sem conflito: higiene de CI (S-A) — é pré-requisito de todo o resto.
3. O que **não pode** começar sem decisão: OIDC definitivo (P-1), escopo de TTS remoto (P-2), Live2D (P-4), Hero PNG (P-5).
4. A ordem correta é: **qualidade → build → segurança/OIDC-off → ferramentas → áudio → UI P1 → validação Windows → pacote → revalidação**.
5. Nenhuma sessão mexe em `CURRENT-STATE.md` além do agente principal.

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
| Assinatura Authenticode | NOT SIGNED — **não bloqueia** por DP-5 (aviso + hash) | W-12 |
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
9. **Critério de release da UI/UX:** o relatório de UI/UX pede AC-01…AC-16 + regressão AC-21. Esta consolidação propõe para o beta apenas AC-01…AC-08, AC-15 e a regressão AC-21, adiando AC-09…AC-14 e AC-16 (design system/navegação/diagnósticos) — é a decisão DP-3 (escopo de UI), não uma discordância silenciosa. AC-17…AC-20 dependem de estudo com usuários/hardware e ficam por fase.

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
| X-04 | Sem UI de ativação e sem persistência de `enabledById`; estado em memória/sincronizado | `tools.ts:82,192-195`; nenhum chamador de produção de `setToolEnabled` | EST | BAIXO/MÉDIO | Não bloqueia (decisão `ae46c49`); dor futura | P-7 | Produto/Arena | Adiar; quando autorizado, definir dono único da preferência |

### 2.2 Segurança e autenticação

| ID | Achado | Evidência | Estado | Gravidade | Impacto no beta | Depende de | Dono | Próximo passo |
|---|---|---|---|---|---|---|---|---|
| SEC-01 | Tokens OIDC (`access`, `refresh`, `id`) chegam ao Renderer e são gravados em `localStorage` | `stage-tamagotchi/.../auth.ts:27-32,115-164,193-223`; `stage-ui/stores/auth.ts:17-50,155-169,233-272` | DEM (código) | ALTO | **Bloqueia enquanto OIDC estiver acessível**; roubo não demonstrado | DP-4 / P-1 | Arena | Main como dono da sessão; remover tokens do Renderer/storage legado; migração |
| SEC-02 | Refresh em voo concluído após logout repovoa tokens e `isAuthenticated=true` | `auth.ts:150-186,298-348`; `auth-probe.ts`: `clearedAfterLogout=true`, `restoredToken=true`, `authenticated=true` | DEM (bancada) | ALTO | **Bloqueia enquanto OIDC estiver acessível** | DP-4 / P-1 | Arena | Geração de sessão/cancelamento; descartar respostas antigas; limpar local antes da rede |
| SEC-03 | Logout remoto sem checagem de `response.ok`, sem timeout explícito e sem revogação comprovada de refresh | `auth.ts:298-326` | EST | MÉDIO | Só relevante se OIDC voltar; fora do caminho no beta | DP-4 / P-1 | Arena | Distinguir confirmado/timeout/falha; revogação conforme issuer; testes 4xx/5xx/offline |
| SEC-04 | Renderer pode ler credencial legada de provider não curado em condições específicas | `main/index.ts:450`; `transport-config-service.ts:49-64`; `secrets-service.ts:137-145` | EST | ALTO (se legado existir) | **Bloqueia beta externo** com providers legados; não afeta curados | Inventário de escopos | Arena | Migrar consumidores para o Main; remover leitura genérica; canários |
| SEC-05 | Mutação de endpoint pode reaproveitar credencial para destino diferente | `transport-config-service.ts:78-90`; `lia/core/.../validation.ts:16-22,60-68`; `repository.ts:133-153` | EST | ALTO (condicional) | **Bloqueia beta externo** se o bridge de config for alcançável | Autorização de destino | Arena | Vincular credencial↔host no owner; autorizar troca; HTTPS por padrão |
| SEC-06 | MCP permite spawn de processo e expõe stderr/env via configuração privilegiada | `mcp-servers/index.ts:166-184,340-413`; `stores/tools/mcp.ts:22-32` | EST | ALTO (cond.) / MÉDIO (logs) | Condicional a Renderer comprometido | SEC-01/05 | Arena | Autorização de sender/capacidade; confirmação; vault por referência; política de log |
| SEC-07 | Confiança TLS por campos textuais do certificado (CN/issuer), sem chave/fingerprint | `channel-server/index.ts:220-253` | EST | ALTO (cond.) | Condicional; MITM não demonstrado | — | Arena | Pinar CA/chave; hostname; ciclo de vida; testes com CA impostora |
| SEC-08 | CSP do Stage está comentada; não há prova de política efetiva em todas as distribuições | `renderer/index.html:6-17` | EST | MÉDIO | Defesa em profundidade; não bloqueia sozinho | — | Arena | Definir CSP restritiva compatível com assets; validar no build real |
| SEC-09 | Repositório de transportes não tem lock multiprocesso visível no módulo | `repository.ts:70-119,133-153`; Launcher e Stage criam instâncias | TEOR | MÉDIO | Baixo para beta; risco de lost update | Confirmar mesmo arquivo | Arena | Provar topologia; owner único ou CAS/lock entre processos; teste com barreira |

### 2.3 Qualidade, CI, distribuição e cadeia de suprimentos

| ID | Achado | Evidência | Estado | Gravidade | Impacto no beta | Depende de | Dono | Próximo passo |
|---|---|---|---|---|---|---|---|---|
| DIST-01 | Dependências/downloads/licenças sem SBOM e com hashes incompletos (Kokoro `soundfile`, notices Spine/Cubism) | `kokoro/manifest.ts:17-29,68-76`; `THIRD-PARTY-NOTICES.md` | EST | MÉDIO | Blockers parciais: assets sem licença; `soundfile` sem hash | DP-6 | Arena + Produto | Lock/hashes transitivos, SBOM, revisão de scripts e notices do artefato |
| DIST-02 | Updater upstream ativo em modos não gerenciados | `stage-tamagotchi/main/index.ts:262-266`; `auto-updater.ts:308-325` | EST | MÉDIO (cond.) | Condicional ao modo de distribuição | DP-5 | Arena | Política de feed por distribuição; fail-closed; testes de modo |
| QA-01 | `pnpm lint` falha com 81 erros eslint (59 auto-fixáveis) | `06-lint.log` no SHA `ae46c49` | DEM | MÉDIO | **Bloqueia CI verde** (C-2) | P-8 | Arena | Escopar regras de QA/scripts; corrigir mecânicos; meta exit 0 |
| QA-02 | stage-ui termina exit 1 com 1.153 testes PASS por rejeição não tratada (`updateCredits` → `api.airi.build`) | `04-test-stage-ui.log` | DEM | MÉDIO | **Bloqueia CI verde** (C-16) | — | Arena | Stub do client nas suítes; exigir 0 unhandled rejections |
| QA-03 | Build do renderer do Stage falha sem rede (`dist.ayaka.moe`, ECONNRESET) | `09-build-stage.log` | DEM | ALTO | **Bloqueia build reproduzível e pacote** (C-4) | DP-6 | Arena + Produto | Inventariar assets; licenciar/espelhar com hash; build offline |
| QA-04 | Projeto browser (Stage/stage-ui) BLOCKED por ausência de Chromium/CDN | `25…`, `29…` | DEM (bloqueio) | BAIXO/MÉDIO | Cobertura, não funcionalidade | CI com Playwright | Arena | Job de CI com `playwright install --with-deps chromium` |
| QA-05 | Instalação documentada (`pnpm install` em `airi/`) cria `.git` falso via postinstall no layout subtree | `LIA-QA-VALIDATION` §3.5; inspeção estática | EST | MÉDIO | **Bloqueia instalação reproduzível** (C-1) | P-8 | Arena | Documentar `--ignore-scripts` + ordem de build ou corrigir postinstall |
| QA-06 | Nenhum runtime Windows no SHA candidato (W-01…W-20) | Matriz QA §2.B | DEM (ausência) | CRÍTICO | **Bloqueia beta** | SHA congelado | Codex | Executar roteiro §7 (Partes 2–8) |
| QA-07 | Tool calling ponta a ponta nunca observado | W-17/B3; 0/1 round-trip | DEM (ausência) | CRÍTICO | **Bloqueia beta** | QA-06 | Codex | `get_weather` real com `tool-call`/`tool-result` |
| QA-08 | NSIS instalação/upgrade/uninstall nunca executado; sem assinatura | W-08/W-12 | DEM (ausência) | ALTO | **Bloqueia distribuição** | QA-03 | Codex + Produto | `package-windows.mjs --internal-test`; decisão de assinatura |
| QA-09 | Voz/STT/GPU/DPI/1h não validados | H-01…H-05 | DEM (ausência) | CRÍTICO (voz obrigatória) | **Bloqueia** (DP-2, B-07) | DP-2 | Codex | AV-01…AV-15; render/soak |
| QA-10 | Gate C0–C4 aberto; sem medições comparáveis | W-20; decisão de runtime | DEM (ausência) | MÉDIO/ALTO | **Bloqueia se arquitetura for gate de beta** | P-3 | Codex mede; Arena analisa | Protocolo aprovado; C0–C4 no pacote |
| QA-11 | Gate `oidc-electron` e IPC/recursos OIDC ausentes do repositório | W-07; `scripts/oidc-electron/` inexistente | DEM | ALTO (se OIDC) | **Bloqueia se OIDC voltar** | P-1 | Codex/Arena | Decidir entra (commit + gate) ou sai (remoção formal) |
| QA-12 | Evidências Windows de PROMPT-37/OIDC só existiam em worktree local | B6; relatório de branch | EST | MÉDIO | Processo/auditoria | Codex | Codex | Commitar evidência e limpar worktree |
| QA-13 | Baseline funcional `3ef6d11` está muito atrás do tip | `CURRENT-STATE.md` §1 | EST | MÉDIO | Nenhum resultado histórico transfere | QA-06 | Codex | Revalidar no SHA de beta |

### 2.4 UI/UX

| ID | Achado | Evidência | Estado | Gravidade | Impacto no beta | Depende de | Dono | Próximo passo |
|---|---|---|---|---|---|---|---|---|
| UI-L01 | Primeiro uso conclui “somente texto” sem configurar IA, mas mantém CTA “Conversar com Lia” | `home-vm.ts:27-43,79-99`; 6 asserts puros | EST/DEM (VM) | ALTO | **Bloqueia primeira experiência** | — | Arena | Separar prontidão de preferência; CTA contextual; teste |
| UI-S01 | Limpar chat é destrutivo sem confirmação nem nome acessível | `InteractiveArea.vue:355-362`; `chat.ts:862-867` | EST | ALTO | Risco de perda de contexto no beta | — | Arena | Confirmação de escopo, cancelar padrão, foco |
| UI-S02 | Remover provedor apaga transporte/chaves sem confirmação | `LiaProviderConfig.vue:323-362` | EST | ALTO | Risco de perda de configuração | — | Arena | Reutilizar padrão `DoubleCheckButton` |
| UI-L02 | IA editável em superfícies concorrentes (Launcher novo + `ConfigView` legada + Stage) | `ConfigView.vue`; `AiResourcesView.vue`; `LiaProviderConfig.vue` | EST | ALTO | Confusão e edição recusada | SEC-04/05 | Arena | Uma porta normal; legado em Avançado |
| UI-L03 | Estados/cópias de voz divergem entre Launcher e Stage | `voice-engine-card.vm.ts`; `VoiceSection.vue` | EST | MÉDIO | **Bloqueia aprovação de voz**: não se pode declarar “voz pronta” sem estado único | DP-2 | Arena | Projeção única por capacidade |
| UI-A01 | CTA branco sobre `#e545c8` = 3,49:1 (abaixo de AA 4,5:1) | Cálculo WCAG refeito nesta rodada | DEM (cálculo) | MÉDIO | Qualidade/acessibilidade | — | Arena | Token de ação `#a62b90` (6,23:1) ou texto escuro |
| UI-A02 | Foco/teclado/nomes acessíveis inconsistentes (tabs, composer, ícones) | `LiaConfigPanel.vue`; `InteractiveArea.vue`; `select-tab.vue` | EST | MÉDIO | Acessibilidade | — | Arena | Corrigir primitivos; matriz accname/teclado |
| UI-L04 | Navegação sem deep-link/voltar; “Configuração” ambíguo | `App.vue`; `home-vm.ts:33` | EST | BAIXO/MÉDIO | Pós-beta | Fase 2/3 | Arena | Destinos estáveis; `aria-current` |
| UI-S03 | Loading em inglês com flash infinito; auto-collapse por tempo; drag hint morto | `pages/index.vue`; `controls-island/index.vue` | EST | BAIXO/MÉDIO | Pós-beta | — | Arena | Loading localizado; não recolher com foco |
| UI-X01 | Tokens, Tailwind cru, hex e três mecanismos de strings coexistem | `lia-tokens.css`; painéis Stage | EST | BAIXO/MÉDIO | Pós-beta | Fase 2 | Arena | Consolidar design system |
| UI-X02 | Conceitos mostram capacidades não aprovadas | `docs/design/concepts/01–07`; `AppearanceSection.vue` | EST | BAIXO | Expectativa falsa | DP-3 | Produto | Conceito como direção; UI capability-driven |
| UI-F01 | Caminhada contínua, jogos, extensões, roupas | docs/wireframes | EST | BAIXO | Fora do beta | DP-3 | Produto | Spec separada; sem toggles falsos |

---

## 3. Bloqueadores e prioridades (revisão 2)

### 3.1 Bloqueadores comprovados do beta interno

| # | Bloqueador | Prova | Fecha com | Dono | Gate |
|---|---|---|---|---|---|
| **B-01** | **Sem prova de runtime no SHA candidato** — boot, Stage, AI Settings, conversa, histórico, encerramento | QA matriz W-01…W-20; AI Settings 0/16 | Coleta no SHA congelado (§6, Onda 4) | Codex | G-CONV/G-STAGE |
| **B-02** | **Tool calling sem round-trip real** | W-17/B3; 0/1 | `get_weather` com `tool-call` + `tool-result` | Codex | G-TOOLS |
| **B-03** | **Build do renderer não reproduzível** — `dist.ayaka.moe` e ECONNRESET | `09-build-stage.log` | Assets VRM com hash em cache controlado; Live2D fora do build | Arena (S-B) | G-CI |
| **B-04** | **Distribuição não executada** — NSIS nunca rodou | W-08 | Pacote interno, instalação/upgrade/uninstall + aviso unsigned | Codex (S-H) | G-INST |
| **B-05** | **OIDC no caminho funcional** — tokens no Renderer/`localStorage`; refresh pós-logout | SEC-01 (código); SEC-02 (bancada) | OIDC-OFF verificável (§9) | Arena (S-C) + Codex | G-SEC |
| **B-06** | **CI vermelho** — lint 81 erros; stage-ui exit 1 | `06-lint.log`; `04-test-stage-ui.log` | Lint 0; exit 0; 0 unhandled rejections | Arena (S-A/S-C) | G-CI |
| **B-07** | **Áudio não provado** — TTS/STT reais nunca executados; VAD baixa modelo em runtime; Kokoro exige Python + rede na instalação | QA H-01/H-02; §4 | AV-01…AV-15 na máquina física | Codex (S-G) + Arena (S-F) | G-AUD |

### 3.2 Bloqueadores condicionais

| # | Condição | Efeito | Observação |
|---|---|---|---|
| **C-B01** | Gate C0–C4 é critério de beta? | Se sim, W-20 bloqueia; se não, vira dívida documentada | Decisão **P-3** |
| **C-B02** | Live2D volta ao pacote? | Reabre Cubism (licença), `dist.ayaka.moe` e ~133 caminhos no Stage | Decisão **P-4**; recomendação: VRM apenas |
| **C-B03** | Hero PNG permanece na Home? | Asset sem proveniência confirmada não pode ser redistribuído (DP-6) | Decisão **P-5**: placeholder neutro ou autorização |

### 3.3 Riscos que exigem investigação (não são incidentes)

| Risco | Estado | O que falta | Onde |
|---|---|---|---|
| SEC-03 logout/revogação | EST | Só importa se OIDC voltar | §9 |
| SEC-04 leitura legada | EST | Inventário de escopos legados; canário | Onda 2 (S-C) |
| SEC-05 destino de credencial | EST | IPC real; sender não autorizado; HTTP/redirect | Onda 2 (S-C) |
| SEC-06 MCP spawn/logs | EST | Processo sintético; prompt injection; segredo em stderr | Onda 2 (S-C) |
| SEC-07 TLS textual | EST | CA impostora com nomes iguais | Onda 2 (S-C) |
| SEC-08 CSP | EST | CSP efetiva no build real | Onda 2 (S-C) |
| SEC-09 concorrência de repositório | TEOR | Dois processos no mesmo arquivo; crash | Onda 2/3 |
| TOOL-01/02 | DEM (bancada) | Payload real; colisão MCP/plugin real | Onda 2 (S-D) |
| DIST-01/02 | EST | SBOM; modo de distribuição | Onda 5 |

### 3.4 P1 de UI autorizados (DP-3)

| ID | Correção | Por que entra no beta | Tamanho |
|---|---|---|---|
| UI-L01 | Prontidão separada de preferência; CTA contextual | Primeiro uso promete conversa que pode não existir | P |
| UI-S01 | Confirmação para limpar chat | Perda de contexto por acidente | P |
| UI-S02 | Confirmação para remover provedor | Perda de configuração/credencial | P |
| UI-A01 | Contraste do CTA ≥ 4,5:1 | Barato e verificável | P |
| UI-A02 | Foco/teclado/nome acessível nos primitivos | Requisito de qualidade | M |
| UI-L03 | Estado de voz único por capacidade | **DP-2**: não se declara voz pronta sem estado único | M |
| UI-L02 | Uma porta normal de IA; legado em Avançado | Depende de SEC-04/05 | M (Onda 3) |

### 3.5 Fora do escopo do beta interno

Beta externo/público; TTS remoto (existe na lista herdada de providers do AIRI, mas não é validado nem está no escopo); clonagem de voz; streaming de TTS (`streams: false`); STT local `app-local-audio-transcription` como requisito (fica suportado, não obrigatório); Live2D/Cubism; Spine; caminhada contínua/jogos; design system completo; UI de ativação de ferramentas (X-04).

---

## 4. Áudio funcional — definição e critérios

### 4.1 O que significa “áudio funcional” neste beta

Áudio funcional é a **cadeia completa e observável**: microfone → VAD → transcrição → texto no chat → resposta → síntese → reprodução → parada → liberação dos recursos. Não é “o engine existe”, nem “o teste unitário passa”. Cada elo tem prova própria e falha tipada própria.

Regra de evidência: **mock de provider não conta**; gravação de tela + log sanitizado + transcrição e áudio produzidos contam.

### 4.2 O que já existe e **não** deve ser reimplementado

| Peça | Onde | Fato verificado |
|---|---|---|
| Captura e dispositivos | `stage-ui/composables/audio/audio-device.ts`, `stores/settings/audio-device.ts` | `enumerateDevices` + `getUserMedia`; seleção persistida |
| Permissão de mídia | `stage-tamagotchi/main/services/electron/media-permissions.ts` | concede **áudio-only** para URL local; rejeita vídeo |
| VAD | `stage-ui/workers/vad/vad.ts` | `AutoModel.from_pretrained('onnx-community/silero-vad')` — **baixa modelo em runtime** |
| Pipeline de escuta | `stage-ui/stores/modules/hearing.ts` + `stage-tamagotchi/renderer/stores/lia/hearing.ts` | pipeline AIRI preservado; execução de transcrição no Main |
| STT gerenciado | `main/services/lia/transcription-service.ts` | Groq derivado (`lia-groq-transcription`), 24 MB, timeout 30 s, credencial só no Main |
| Envio à conversa | `renderer/pages/index.vue:635` (`sendVoiceInputTextToChat`) | texto transcrito entra no mesmo `chatStore.send` |
| TTS local | `lia-core/voice/engines/kokoro/*` | Kokoro CPU, 24 kHz mono, pt-BR `pf_dora`, modelo 92.361.116 B com SHA-256 fixo |
| Instalação do engine | `kokoro/install.ts` | Python 3.10–3.13 + pip (`kokoro-onnx==0.6.1`, `soundfile` sem hash) + download com hash |
| Pré-aquecimento | `main/services/lia/voice-prewarm.ts` | só em launch gerenciado; falha degrada sem derrubar o Stage |
| Fallback de TTS | `stage-ui/libs/speech/tts-fallback.ts` | 6 tentativas; categorias terminais `voice-not-found`, `engine-unavailable`; abort-aware |
| Parada/mudo | `stage-ui/stores/speech-output-control.ts` | publica stop; cancela síntese, stream, fila e reprodução |
| Configuração TTS | `stage-tamagotchi/renderer/stores/lia/voice.ts` | persiste `{preferred, fallback[]}` com `providerId/modelId/voiceId`; segredo descartado no bridge |

### 4.3 Provedores no escopo

| Papel | Provedor | Obrigatório? | Observação |
|---|---|---|---|
| TTS | **Kokoro local (CPU)** | **Sim** | único adapter registrado (`VOICE_ENGINE_ADAPTERS`); `streams:false`, `runsLocally:true` |
| STT | **Groq remoto via Main** (`lia-groq-transcription`) | **Sim** | caminho gerenciado; credencial nunca no Renderer |
| STT local | `app-local-audio-transcription` | Não | exige servidor local (candle) em loopback; suportado, não exigido |
| TTS remoto | providers herdados (ElevenLabs, Gemini, Comet, MiniMax… ) | Não | existem na lista AIRI, mas não foram validados; a UI não deve apresentá-los como prontos |

### 4.4 Critérios objetivos (testáveis)

> Limiares marcados **[proposto]** precisam de aprovação do produto (P-2) **antes** da coleta; sem isso o critério é “medir e registrar”, não “passar/falhar”.

| ID | Critério | Método | Evidência | Estado hoje |
|---|---|---|---|---|
| **AV-01** | Permissão de microfone concedida para áudio e negada para vídeo; decisão sobrevive ao reinício | Testar no Stage real: pedir mic, negar vídeo, reabrir | log Main + screenshot do prompt | NOT RUN |
| **AV-02** | Seleção de dispositivo lista ≥1 entrada, troca de dispositivo aplica na próxima captura e persiste | Trocar mic em Configurar Lia → falar → reabrir | captura + log de `deviceId` (sem PII) | NOT RUN |
| **AV-03** | Captura+VAD: 3 s de fala geram início/fim de fala e buffer ≥ 2 s; silêncio não gera envio | Frase controlada + 10 s de silêncio | log VAD + duração | NOT RUN |
| **AV-04** | STT remoto: transcrição chega em ≤ **1,5× duração do áudio + 2 s** **[proposto]** e ≥ 90% das palavras-chave presentes em 3 frases fixas | 3 frases pt-BR pré-definidas | texto transcrito + tempos | NOT RUN |
| **AV-05** | STT sem vazar credencial: nenhuma chave em log/DOM/toast/URL; erro de provider é tipado | Chave sintética + derrubar rede | varredura + screenshot | NOT RUN |
| **AV-06** | Texto transcrito vira **uma** mensagem de usuário e a conversa responde; ferramentas e anexos seguem o mesmo caminho do texto digitado | Ditado → resposta | histórico + log de send | NOT RUN |
| **AV-07** | Kokoro instala, pré-aquece e sintetiza pt-BR com RTF ≤ **0,5** em CPU **[proposto]** após aquecimento | 5 frases, medir tempo/duração | tabela RTF + WAV | BLOCKED (rede/Python) |
| **AV-08** | Reprodução: áudio toca no dispositivo padrão, legenda acompanha, **parar fala** corta em ≤ 1 s e não retoma | Interromper no meio | gravação + log | NOT RUN |
| **AV-09** | Falhas tratadas: provider off-line, engine ausente e voz inexistente mostram mensagem humana, sem crash e sem repetir áudio | 3 falhas induzidas | screenshots + log | NOT RUN |
| **AV-10** | Seleção de provedor: `voice.tts` persiste `preferred`/`fallback`, aplica na próxima resposta e não grava segredo | Trocar voz/modelo, reabrir | `lia-product.json` sanitizado | NOT RUN |
| **AV-11** | Cancelamento: stop durante síntese e durante reprodução libera a fila; nenhuma segunda reprodução começa | Parar 2× em momentos distintos | log + gravação | NOT RUN |
| **AV-12** | Encerramento: sair falando não deixa processo órfão (`python`, worker, Electron) e a próxima abertura sintetiza de novo | Fechar durante fala; contar PIDs | `Get-Process` antes/depois | NOT RUN |
| **AV-13** | Degradação: microfone ausente/negado mantém o chat de texto funcional e mostra erro tipado | Remover mic / negar permissão | screenshot + log | NOT RUN |
| **AV-14** | Estado honesto: UI distingue preparando/pronta/erro/indisponível e nunca mostra “pronta” com engine ausente | Forçar engine ausente | screenshots | NOT RUN |
| **AV-15** | Privacidade: áudio não é persistido sem consentimento; transcrição não aparece em log de diagnóstico sem ação do usuário | Inspeção de perfil/log | varredura | NOT RUN |

### 4.5 Dependências duras de áudio

1. **Rede na primeira execução**: VAD baixa `onnx-community/silero-vad`; Kokoro baixa modelo e 3 vozes (com SHA-256) e instala wheels. Sem rede, ambos falham — registrar BLOCKED, não FAIL.
2. **Python 3.10–3.13** na máquina do tester para o Kokoro; ausência = engine indisponível (AV-14), não crash.
3. **`soundfile` sem versão/hash** no manifest — pendência de integridade (§8, DIST-01).
4. **Pacotes de voz** (`pf_dora`, `pm_alex`, `pm_santa`) com SHA-256 fixo, mas termos de redistribuição precisam de registro.
5. **Dispositivo físico**: sem mic/auto-falante não há como produzir a evidência — Linux sem áudio não substitui.

---

## 5. Gates do beta interno

Todos exigem evidência no **mesmo SHA**, com comando, saída e artefato sanitizado. Skip não é PASS.

### 5.1 G-CONV — Conversa

| Critério | Como medir | Estado |
|---|---|---|
| Abrir conversa pelo Launcher e receber resposta real em ≤ 30 s **[proposto]** | cronômetro + log | NOT RUN |
| 5 turnos com contexto e memória (“meu nome é X” → recuperar no turno 4) | transcrição sanitizada | NOT RUN |
| Falha de rede/429 exibe erro humano e preserva rascunho | derrubar rede no 3º turno | NOT RUN |
| Cancelar geração para o texto sem quebrar a sessão | botão parar | NOT RUN |

### 5.2 G-HIST — Histórico e memória

| Critério | Como medir | Estado |
|---|---|---|
| Conversa sobrevive a fechar/reabrir o Stage | screenshots antes/depois | NOT RUN |
| Conversa sobrevive a reinício do SO | reiniciar máquina | NOT RUN |
| Limpar histórico pede confirmação e não apaga por acidente | UI-S01 | NOT RUN |
| Memória opt-in respeitada; apagar tudo pede confirmação | inspeção + screenshot | NOT RUN |

### 5.3 G-TOOLS — Ferramentas

| Critério | Como medir | Estado |
|---|---|---|
| `get_weather` real: `tool-call` + `tool-result` + resposta citando o dado | log sanitizado | NOT RUN |
| Desabilitar ferramenta pelo store: some da apresentação **e** recusa execução | verificação AV-A1 (abaixo) | PASS offline (31/31) |
| TOOL-01: captura concorrente não apresenta schema obsoleto | teste de barreira | bancada DEM |
| TOOL-02: colisão de nome não executa fonte homônima quando o ID está desabilitado | teste de colisão | bancada DEM |

**AV-A1 (verificação do gate no runtime):** com a sessão aberta, chamar `setToolEnabled('<id>', false)`, pedir a ferramenta, confirmar ausência no payload e erro de indisponibilidade; reativar ao final. Registrar os 3 comportamentos.

### 5.4 G-STAGE — Stage e segurança de janela

| Critério | Como medir | Estado |
|---|---|---|
| `Lia.bat` abre janela e emite `renderer-ready` | log | NOT RUN |
| Botão “Conversar com Lia” sobe o Stage certo | PID + screenshot | NOT RUN |
| `window.process`, `require`, `process.versions` ausentes no Renderer | DevTools/CDP | NOT RUN |
| Avatar renderiza (VRM) no tamanho suportado | screenshot + FPS | NOT RUN |
| Fechar não deixa órfãos; 2ª instância é bloqueada | `Get-Process` | NOT RUN |

### 5.5 G-AUD — Áudio (DP-2)

**Critério de aprovação:** AV-01…AV-15 **todos PASS** no Windows físico, com Kokoro local e STT Groq. AV-04/AV-07 usam os limiares aprovados em P-2. Qualquer BLOCKED impede o gate; “funciona no mock” não conta.

### 5.6 G-INST — Instalação e distribuição interna

| Critério | Como medir | Estado |
|---|---|---|
| NSIS gera instalador com hash SHA-256 publicado | `package-windows.mjs --internal-test --check` | NÃO EXECUTADO |
| Instalação limpa abre o Launcher e o AI Settings | máquina limpa | NÃO EXECUTADO |
| Upgrade sobre versão anterior preserva `%APPDATA%\Lia` | instalar por cima | NÃO EXECUTADO |
| Uninstall remove programa e **preserva** dados do usuário | desinstalar | NÃO EXECUTADO |
| Aviso de unsigned visível no instalador e no README | screenshot + texto | NÃO EXECUTADO |
| Notices/licenças dos bytes empacotados conferem com o inventário | inventário + diff | NÃO EXECUTADO |

### 5.7 G-SEC — Segurança

| Critério | Como medir | Estado |
|---|---|---|
| OIDC fora do caminho: zero requisições de auth em 10 min de uso; tokens legados limpos | proxy/log de rede + inspeção | FAIL (hoje há tokens) |
| Nenhum token/segredo em `localStorage`, DOM, logs, screenshots ou config | varredura com canário | FAIL/BLOCKED |
| SEC-04/05 fechados ou aceitos por escrito com prazo | revisão + testes | EST |
| SEC-06/07/08 tratados ou aceitos por escrito | revisão | EST |
| Scan anti-segredo no pacote de evidências | script + revisão | PASS histórico (repetir) |

### 5.8 G-CI — Qualidade automatizada

| Critério | Como medir | Estado |
|---|---|---|
| `pnpm lint` exit 0 | log | FAIL (81) |
| stage-ui exit 0, zero unhandled rejections | log | FAIL |
| Typechecks Lia 0 | logs | PASS (exceto root) |
| Clone limpo instala e injeta ordem `build:packages` antes do typecheck | script | PARCIAL |
| Build do Stage offline com hashes | log + manifest | BLOCKED |

### 5.9 G-PROC — Processo

| Critério | Como medir | Estado |
|---|---|---|
| Matriz QA re-executada no SHA taggeado | relatório | NOT RUN |
| AC-01…AC-08 + regressão AC-21 verdes | UI + testes | NOT RUN |
| `CURRENT-STATE.md` no mesmo commit de cada gate | git log | pendente |
| Evidências versionadas e sanitizadas | repo | pendente |

---

## 6. Ordem de execução e paralelismo

### 6.1 Ondas

| Onda | Objetivo | Sessões | Pode iniciar quando |
|---|---|---|---|
| **0** | Decisões e plano | Produto + principal | DP-1…DP-6 registradas; P-1…P-8 podem aguardar |
| **1** | Higiene que reescreve arquivos em massa | **S-A** (Arena) | **já** — não depende de decisão pendente |
| **2** | Implementação paralela com donos de arquivo | **S-B, S-C, S-D, S-E, S-F** (Arena) | Onda 1 concluída |
| **3** | Integração e matriz Linux | Principal + S-A | Ondas 1–2 integradas |
| **4** | Validação Windows oficial | **S-G** (Codex) | SHA congelado e limpo |
| **5** | Pacote interno | **S-H** (Codex) + S-B | build estável (T-14) e SHA congelado (T-15) |
| **6** | Revalidação e declaração | Principal + Codex | Ondas 4–5 verdes |

### 6.2 Tarefas, responsáveis e dependências

| ID | Tarefa | Sessão | Depende de | Arquivos principais |
|---|---|---|---|---|
| T-01 | Escopar lint de QA/scripts, `--fix` nos 59 mecânicos, resolver manuais | S-A | — | repo inteiro (sozinho) |
| T-02 | `updateCredits` stub / remoção da rejeição; stage-ui exit 0 | S-C | T-06 (mesma sessão: mesmo arquivo) | testes de stage-ui; `auth.ts` |
| T-03 | Documentar instalação (`--ignore-scripts`, ordem de build) e CI Linux | S-A | — | docs, `.github/` |
| T-04 | Baseline Linux completo pós-onda 1 | S-A | T-01, T-03 | — |
| T-05 | VRM com hash em cache (parte A, independente); Live2D fora do build e default VRM (parte B, depende de P-4) | S-B | T-01; P-4 para a parte B | `electron.vite.config.ts`, `display-models.ts`, assets |
| T-06 | OIDC-OFF: entrada desabilitada, sem PKCE/refresh, tokens legados limpos | S-C | T-01 | `stage-ui/stores/auth.ts`, `stage-tamagotchi/.../auth.ts`, conta |
| T-07 | SEC-04: remover leitura de segredo legado pelo Renderer | S-C | T-06 | `transport-config-service.ts`, `secrets-service.ts` |
| T-08 | SEC-05: vínculo credencial↔endpoint e autorização de troca | S-C | T-01 | `transport-config-service.ts`, `lia/core/transports` |
| T-09 | TOOL-01/02: revalidar no envio; identidade canônica | S-D | T-01 | `tools.ts`, `tool-resolver.ts`, `chat.ts` |
| T-10 | UI P1: L-01, S-01, S-02, A-01, A-02 | S-E | T-01 | `home-vm.ts`, `InteractiveArea.vue`, `LiaProviderConfig.vue`, tokens |
| T-11 | Áudio: estado único (L-03), erros tipados, liberação no stop/exit, hotplug | S-F | T-01 | `hearing.ts`, `voice.ts`, `VoiceSection.vue`, `speech-output-control.ts` |
| T-12 | Preparar roteiros/fixtures Windows **sem** evidência oficial | S-G | — | `docs/reports/evidence/` (rascunho), scripts locais |
| T-13 | Integração sequencial e resolução de conflitos | Principal | T-05…T-11 | — |
| T-14 | Matriz Linux + build offline no SHA integrado | S-A | T-13 | — |
| T-15 | Congelar SHA candidato (tag interna) | Principal | T-14 | — |
| T-16 | Boot, Stage, sandbox/preload, órfãos | S-G | T-15 | evidência |
| T-17 | AI Settings 16/16 | S-G | T-15 | evidência |
| T-18 | Conversa 5 turnos + memória | S-G | T-17 | evidência |
| T-19 | Histórico após reinício do app e do SO | S-G | T-18 | evidência |
| T-20 | Tool calling `get_weather` + AV-A1 | S-G | T-18 | evidência |
| T-21 | Áudio AV-01…AV-15 | S-G + usuário (mic/voz) | T-18 | evidência |
| T-22 | C0–C4 (se P-3 = sim) | S-G | T-15 | CSV/JSON |
| T-23 | NSIS pack/install/upgrade/uninstall + aviso unsigned + hash | S-H | T-15 | instalador |
| T-24 | Inventário de licenças/notices/SBOM do artefato | S-H + S-B | T-23 | inventário |
| T-25 | Revalidação final no SHA taggeado + varredura de segredo | Principal + S-G | T-16…T-24 | relatório |
| T-26 | Declaração de beta + `CURRENT-STATE.md` | Principal + Produto | T-25 | docs |

### 6.3 Regras anti-conflito

1. **T-01 roda sozinha.** `--fix` reescreve imports/ordem em milhares de arquivos; qualquer sessão aberta no mesmo repo gera conflito.
2. **`auth.ts` pertence a S-C** até T-06/T-02 terminarem. Nenhuma outra sessão toca login, conta, `updateCredits` ou `localStorage`.
3. **`transport-config-service.ts`/`secrets-service.ts` pertencem a S-C.** S-E não implementa L-02 antes de T-07/T-08.
4. **`tools.ts`, `tool-resolver.ts`, `chat.ts` pertencem a S-D.** S-E/S-F não tocam o store de ferramentas.
5. **Arquivos de voz (`hearing.ts`, `voice.ts`, `VoiceSection.vue`, `speech-output-control.ts`) pertencem a S-F**, inclusive L-03. S-E não edita cópia de estado de voz.
6. **`electron.vite.config.ts` e `display-models.ts` pertencem a S-B.** Ninguém mais muda assets/default de avatar.
7. **Codex não produz evidência oficial em paralelo com código em voo.** A Onda 4 só começa no SHA congelado; antes disso, T-12 é preparação, não prova.
8. **`CURRENT-STATE.md` é do agente principal.** Sessões entregam texto, não editam o arquivo.
9. **Branches de especialistas não são mergeadas.** Seus documentos já foram absorvidos; nada de trazer árvore antiga.

### 6.4 O que pode começar agora, sem conflito

| Sessão | Pode começar? | Escopo seguro |
|---|---|---|
| **S-A** | **Sim, primeiro** | T-01 e T-03 (higiene + CI); nada mais toca o repo até T-01 fechar |
| **S-G (Codex)** | Sim, em preparação | T-12: roteiros, fixtures, checklist de ambiente, contagem de PIDs — **sem** evidência oficial |
| **Produto** | Sim | P-1…P-8 (§11) |
| S-B/S-C/S-D/S-E/S-F | Não antes de T-01 | Entram na Onda 2 com os donos de arquivo acima |
| S-H | Não | Depende de build estável e do SHA congelado |

---

## 7. Tarefas que exigem Windows e hardware físico

| Tarefa | Por que não pode ser feita no sandbox Linux | Evidência mínima |
|---|---|---|
| Boot por `Lia.bat`, janela, `renderer-ready` | Electron + display | log + screenshot |
| Sandbox/preload na janela real | precisa de janela Electron | DevTools/CDP |
| AI Settings 16 passos | interação real + chave na UI | screenshots + JSON sanitizado |
| Conversa e histórico | runtime + reinício do SO | transcrição + capturas |
| Tool calling `get_weather` | rede + provider + execução local | `tool-call`/`tool-result` |
| **Mic/STT** | microfone físico | gravação + transcrição |
| **TTS Kokoro** | Python + áudio + CPU física | WAV + RTF |
| Parada/mudo de áudio | saída de áudio real | gravação |
| Órfãos/PIDs | tabela de processos Windows | `Get-Process` |
| NSIS/instalação/upgrade/uninstall | Windows x64 | logs + screenshots |
| C0–C4 (se P-3 = sim) | pacote + GPU/CPU reais | CSV/JSON |
| Render RX 580/DPI/multi-monitor | GPU física | screenshots + medição |

**Linux pode provar:** contratos, testes unitários, typecheck, lint, build de main/preload, lógica de stores, política de fallback. **Linux não pode provar:** janela, áudio, instalação, GPU, PIDs.

---

## 8. Assets: indispensáveis × adiáveis

Base: `docs/licenses/ASSET-LICENSES.md` e `THIRD-PARTY-NOTICES.md` (estado de 08/11) + `electron.vite.config.ts:266-269`.

### 8.1 Indispensáveis para o beta interno

| Asset | Uso | Licença/proveniência | Ação |
|---|---|---|---|
| **VRM `AvatarSample_A`** (e B como opção) | avatar do Stage | **Permitido com condições** (VRoid/pixiv): não repassar por cobrança, não aplicar CC0, não insinuar endosso | Fixar hash, incluir aviso e manter distribuição gratuita/interna |
| **Fonte Comfortaa** (e demais fontes efetivamente usadas) | UI | OFL-1.1, aprovada com atribuição | Conferir famílias realmente empacotadas |
| **Modelo Kokoro + 3 vozes** | TTS | modelo Apache-2.0 (verificar termos dos pacotes de voz) | Baixado na instalação, não no instalador; registrar SHA-256 e notices |
| **Silero VAD (`onnx-community/silero-vad`)** | STT | upstream MIT declarado; **bytes não verificados** | Registrar revisão/hash usados em runtime e o aviso |
| **Ícones/fontes de dependência já licenciados** | UI | pacotes npm com licença própria | Notices do pacote final |

### 8.2 Adiáveis ou removíveis por licença

| Asset | Motivo | Decisão sugerida |
|---|---|---|
| Live2D Hiyori free/pro + **Cubism Core/Framework/SDK** | proprietário, termos de publicação não verificados; 133 caminhos no Stage | **Fora do beta** (P-4); VRM é o avatar |
| **Lia Hero PNG** | sem autoria/proveniência confirmada | Placeholder neutro ou autorização escrita (P-5) |
| Spine runtimes/assets | licença por usuário; não necessário ao beta | Fora |
| `Flamingo.glb`, `LittlestTokyo.glb` | não verificado; não usado no fluxo Lia | Fora |
| Backgrounds adicionais | não verificados | Manter só o fundo padrão neutro |
| Pacotes de voz extras / clonagem | fora do escopo | Fora |

### 8.3 Efeito no build

- Sem Live2D, o build deixa de baixar `hiyori_*.zip`; o **VRM** continua vindo de `dist.ayaka.moe` até ser vendorizado.
- Meta: build offline com `airi/.cache` pré-semeado e **verificação de hash fail-closed**; nenhum host de terceiro no build.
- O instalador interno pode redistribuir **apenas** o que estiver em 8.1; o restante fica fora do pacote.

---

## 9. OIDC — decisão pendente registrada

**Estado:** não aprovado, não declarado seguro, sem decisão de produto (DP-4). Nada neste plano autoriza afirmar que OIDC funciona ou é seguro.

**O que está demonstrado:**
- SEC-01: tokens (`access`, `refresh`, `id`) chegam ao Renderer e são gravados em `localStorage` (`stage-ui/src/stores/auth.ts`).
- SEC-02: refresh em voo concluído após logout repovoa tokens e `isAuthenticated=true` (bancada com store real e dependências simuladas).
- O gate `scripts/oidc-electron/` não existe no repositório.

**Requisito do beta (OIDC-OFF), até decisão:**

1. Nenhum ponto de entrada de login acionável no build interno (conta/onboarding/controles mostram “indisponível nesta versão”, sem prometer login).
2. Nenhuma requisição de autorização, token, refresh ou end-session em uso normal — medido em log de rede por 10 min.
3. Tokens legados em `localStorage` são **ignorados e limpos** no boot; nenhuma sessão é restaurada.
4. `updateCredits`/chamadas dependentes de `isAuthenticated` não disparam com OIDC off.
5. A funcionalidade **não é removida em definitivo**: código permanece atrás de guarda/flag, reversível quando P-1 for decidido.
6. Documentar no relatório de beta: “OIDC desabilitado por decisão pendente; não avaliado”.

**Critério de aceite (G-SEC):** perfil novo → zero requisições; perfil com tokens antigos → limpos e não restaurados; varredura não encontra token em DOM/log/config.

**Se P-1 decidir “entra”:** reabre SEC-01/02/03, o gate ausente e a UI de conta — nova rodada, não esta.
**Se P-1 decidir “sai”:** transformar o OIDC-OFF em remoção formal documentada (não apenas esconder a tela).

---

## 10. Checklist de declaração do beta interno

Só declarar quando **todos** estiverem verdes no mesmo SHA taggeado:

- [ ] G-CI: lint 0, stage-ui exit 0, typecheck 0, build offline com hash
- [ ] G-CONV: 5 turnos + erro humano + cancelamento
- [ ] G-HIST: reabrir app e SO preservam; confirmação de limpeza
- [ ] G-TOOLS: `get_weather` real + gate A-1 verificado + TOOL-01/02 cobertos
- [ ] G-STAGE: boot, Stage, sandbox, VRM render, zero órfãos
- [ ] G-AUD: AV-01…AV-15 PASS (TTS local + STT remoto)
- [ ] G-INST: NSIS limpo/upgrade/uninstall + aviso unsigned + hash + notices
- [ ] G-SEC: OIDC-OFF comprovado; SEC-04/05/06/07 fechados ou aceitos por escrito
- [ ] G-PROC: matriz re-executada no SHA, evidências commitadas, `CURRENT-STATE.md` atualizado
- [ ] Riscos residuais assinados pelo produto

---

## 11. Pendências que exigem decisão do usuário

| ID | Decisão | Por que bloqueia | Recomendação |
|---|---|---|---|
| **P-1** | OIDC: entra ou sai do produto? | Define se SEC-01/02/03 são corrigidos ou se o OIDC-OFF vira remoção | Manter OIDC-OFF no beta e decidir depois |
| **P-2** | Aprovar limiares de áudio (AV-04/AV-07) e o escopo “Kokoro local + Groq remoto” | Sem limiar não há PASS/FAIL testável | Aprovar os propostos; TTS remoto fora |
| **P-3** | C0–C4 é gate do beta? Quais thresholds? | Muda o custo da Onda 4 | Adiar C0–C4 para pós-beta interno, registrar dívida |
| **P-4** | Live2D no pacote? | Licença Cubism + build externo | VRM apenas no beta |
| **P-5** | Hero PNG: autorização ou placeholder? | Asset sem proveniência não pode ser redistribuído | Placeholder neutro até autorização |
| **P-6** | Python 3.10–3.13 e rede na instalação do Kokoro são aceitáveis para os testers internos? | Define se o TTS entra como “instalável” ou “pré-provisionado” | Aceitar e documentar; opcional pré-provisionar |
| **P-7** | Quando autorizar a UI de ativação de ferramentas (X-04)? | Não bloqueia o beta atual | Pós-beta |
| **P-8** | Escopo do lint para scripts de QA/`.mjs` e correção em massa | Sem isso, G-CI não fecha | Escopar regras e corrigir mecânicos (T-01) |

---

## Anexo A — Fontes consultadas nesta revisão

**Documentos:**
`docs/reports/LIA-BETA-READINESS-PLAN-2026-11-14.md` (rev. 1, base `407300b`), `docs/project/CURRENT-STATE.md`, `docs/reports/LIA-VALIDATION-MATRIX-AE46C49-2026-11-14.md`, `docs/reports/LIA-QA-VALIDATION-2026-11-14.md`, `docs/reports/LIA-ARQUITETURA-SEGURANCA-AE46C4-2026-11-14.md`, `docs/reports/LIA-UI-UX-AUDIT-2026-11-14.md`, `docs/reports/LIA-A1-TOOL-ENABLEMENT-2026-11-14.md`, `docs/licenses/ASSET-LICENSES.md`, `docs/licenses/THIRD-PARTY-NOTICES.md`.

**Código verificado nesta revisão (leitura, sem execução):**
`lia-core/voice/engines/{registry.ts,kokoro/{manifest.ts,install.ts,layout.ts}}`,
`stage-tamagotchi/main/services/lia/{voice-config-service.ts,speech-config-service.ts,transcription-service.ts,voice-prewarm.ts,media-permissions.ts}`,
`stage-tamagotchi/main/services/electron/media-permissions.ts`,
`stage-tamagotchi/renderer/stores/lia/{hearing.ts,voice.ts,provider.ts}`,
`stage-tamagotchi/renderer/pages/index.vue`,
`stage-ui/stores/modules/{hearing.ts,speech.ts}`,
`stage-ui/stores/{speech-output-control.ts,speech-runtime.ts,auth.ts,display-models.ts}`,
`stage-ui/libs/speech/tts-fallback.ts`,
`stage-ui/workers/vad/vad.ts`,
`stage-tamagotchi/electron.vite.config.ts`.

## Anexo B — Integridade

- Base restaurada para `407300b` por `fetch` → `read-tree` → `checkout-index -a -f` → `update-ref` → `set-upstream-to`; sem `checkout`/`switch`/reset/clean/force push.
- `tools/stt-bench/RX580-GPU-FEASIBILITY.md` preservado, não rastreado (md5 `de29ede227a082f880559c38e1b54360`).
- Nenhum código de produto alterado; nenhuma branch de especialista mergeada; nenhuma evidência apagada.
- A-1 permanece fechado; nenhum indício novo de defeito.
- Os critérios de áudio descrevem o que **já existe** no código (pipeline, fallback, stop, prewarm) e o que **precisa ser provado**; não foram inventados resultados.
