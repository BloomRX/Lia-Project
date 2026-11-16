# Lia — Reconciliação geral de branches e consolidação do estado

**Data:** 16/11/2026 (UTC)
**Branch de trabalho:** `arena/7fa837f0-lia-project` @ `971d309074` (= tip publicado; base `main` `9c7ac183fd`)
**Natureza:** **documentação e auditoria somente-leitura**. Nenhum merge, rebase, reset, clean, cherry-pick ou exclusão de branch. Nenhuma branch de outra sessão foi escrita. Nenhum código de produto foi alterado nesta rodada.
**Regra aplicada:** documentação ≠ prova de implementação; teste isolado ≠ funcionamento integrado; **sem PASS sem evidência**.

---

## 0. Sumário executivo

| Pergunta | Resposta |
|---|---|
| Todas as branches foram inventariadas? | **Sim** — 12 branches remotas + 4 refs de PR (`pr/1`…`pr/4`). Nenhuma branch publicada fora desse conjunto. |
| Existe branch perdida de áudio (`codex/lia-audio-recovery-407300b`) ou commit `9e94dce`? | **Não.** `9e94dce` não resolve em nenhuma ref local/remota (`git cat-file` falha; API do GitHub → 422); não há branch, tag ou PR com esse nome. A busca no Google Drive retornou 0 artefatos relevantes. **Não há recuperação a inventar.** |
| O código de segurança de `arena/c6b02f64` conflita com a Principal? | **Não.** Os 6 arquivos-chave são **byte-idênticos** ao HEAD atual (`407300b` como base). O port é limpo. |
| O código de segurança está aprovado para o beta? | **Não.** A própria auditoria da branch (`9f5ff431`) diz: **NÃO aprovado**; OIDC-OFF não implementado; SEC-04/05 abertos; L-02 bloqueado. |
| O áudio está aprovado? | **Não.** `0/15` critérios AV executados; G-AUD **BLOCKED**; evidência Windows vive em `J:\lia-evidence\…`, fora do repositório. |
| UI/UX pode ser integrada? | **Parcialmente.** Componentes de prontidão/acessibilidade/confirmação (sem L-02) → PORTAR. Tudo que depende de `LiaProviderConfig` gerenciado/segredos → **BLOQUEADO** até SEC-04/05. |
| A pesquisa pode virar padrão de produto? | **Não.** Todos os documentos são *Research reference*. Nenhum modelo experimental é promovido. |
| O estado canônico (`CURRENT-STATE.md`) está correto? | **Parcialmente.** Está correto sobre o que foi validado na rodada 18, mas **omite** que G-AUD/SEC/L-02 seguem bloqueados e que a evidência de áudio é externa ao repo. Correção proposta na §8. |
| Esta rodada integra algo? | **Não.** Entrega reconciliação + ordem de execução. Integração é decisão posterior e explícita. |

**Veredicto da rodada:** **PASS** para reconciliação documental (12/12 branches inventariadas, 4/4 PRs mapeados, 0 branches modificadas) · **BLOCKED** para G-AUD, SEC-01…SEC-05, L-02, G-ARCH (Windows) · **NOT RUN** para todo teste de runtime nesta rodada.

---

## 1. Método, escopo e limites

1. **Somente leitura nas outras refs.** Todo o inventário foi feito com `git rev-parse`, `git log`, `git merge-base`, `git diff --name-status`, `git show <ref>:<path>` e `git ls-tree`. Nenhum `checkout`/`switch` para outra branch; nenhum `git merge`/`rebase`/`cherry-pick`.
2. **Comparação por blob, não por diff de árvore.** Branches com base antiga (`7cb8172`, `5ec464e`, `0bf0629`, `da3a150`) mostram diffs enormes contra o HEAD atual que são **diferença de base**, não proposta de código. A unidade de análise foi o **blob** (`git rev-parse <ref>:<path>`) e o **commit exclusivo**.
3. **Documentos de origem preservados.** Os relatórios de segurança, áudio, UI/UX e pesquisa das outras branches foram copiados byte-a-byte para esta branch (§4.6), sem reescrita e sem perda. A consolidação é **aditiva**: nenhum documento histórico foi sobrescrito.
4. **Nada foi executado de produto.** Esta rodada não rodou build, testes de runtime, Electron ou Windows. As contagens citadas são **herdadas** dos relatórios de origem, com o rótulo de origem e SHA; não são re-execuções desta rodada.
5. **Limite de ambiente:** sandbox Linux (2 vCPU / ~3,9 GB RAM), sem Xvfb/libgtk, sem rede para `huggingface.co`/`cdn.jsdelivr.net`/`api.groq.com`, sem hardware de áudio. Qualquer PASS de voz/STT/Windows é impossível aqui — e por isso não é declarado.

---

## 2. Inventário completo (2026-11-16)

Legenda: **base** = `merge-base` com `origin/arena/7fa837f0-lia-project`; **Δ** = commits exclusivos (`rev-list --count base..branch`) / (`rev-list --count branch..base`).

| # | Branch (`origin/`) | HEAD | Último commit | base | Δ (+) | Δ (−) | Arquivos no diff | Natureza |
|---|---|---|---:|---:|---:|---|---|
| 1 | **arena/7fa837f0-lia-project** (esta) | `971d309074` | 11-16 · `fix(launcher): tsc limpo e parada de Runtime adotado` | — | 560 vs `main` | — | — | Principal de desenvolvimento |
| 2 | `main` | `9c7ac183fd` | 10-30 · `docs: align legacy project rules…` | ancestral | 0 | 560 | — | **Não contém o desenvolvimento**; intocada |
| 3 | `arena/c6b02f64-lia-project` | `a1f5b83195` | 11-16 · `docs: audit STT security and rehearsal gates` | `407300b` | 9 | 14 | 24 (19 de código/teste + 5 docs) | Arquitetura/Segurança |
| 4 | `arena/18f50ae7-lia-project` | `ccf3386120` | 11-16 · `docs(qa): régua de aceite AV-01…AV-15` | `5ec464e` | 9 | 17 | 91 (docs/evidência) | QA / áudio |
| 5 | `arena/250b337a-lia-project` | `ad802efe84` | 11-15 · `fix(ui): consolidate UI/UX comparison…` | `407300b` | 9 | 14 | 97 (91 código + 6 docs) | UI/UX Fase 1 |
| 6 | `arena/4ec8f22b-lia-project` | `be24b94f7b` | 11-15 · merge interno da própria branch | `407300b` | 3 | 14 | 9 | Higiene/CI/build |
| 7 | `arena/826a33f1-lia-project` | `b345355f75` | 11-16 · `docs: research Ornith model weights` | `7cb8172` | 5 | 18 | ~6.190* | Research |
| 8 | `agents/docs` | `7913c62ab3` | 11-14 · `docs(agents): add curated research-only documentation snapshot` | `7cb8172` | 1 | 18 | ~6.190* | Snapshot de docs de agentes |
| 9 | `codex/lia-multi-provider-voice` | `fd0451d766` | 11-14 · `docs: definir arquitetura de voz…` | `0bf0629` | 1 | 13 | 3 | Doc de arquitetura de voz |
| 10 | `codex/lia-ui-ux-fase-1` | `e72574e8d7` | 11-15 · `Melhora contraste e confirma ações destrutivas` | `da3a150` | 1 | 9 | 5 | UI/UX Fase 1 (Codex) |
| 11 | `docs/especificacao-geral-produto-lia` | `b2745f716d` | 10-30 · `docs: align product specification…` | `f1eebd9` | 4 | 131 | 5 | Spec/brand — **já incorporado** |
| 12 | `qa/windows-benchmarks` | `91b8995a68` | 10-30 · `docs: add shared Lia brand standard` | raiz própria `8ced3b60` | 3 (raiz) | — | 21 | Benchmark Windows histórico |

\* `arena/826a33f1` e `agents/docs` mostram ~6.190 arquivos / ~960 mil deleções porque são snapshots de worktree restaurado sobre base antiga; **não é proposta de código**. Avaliados por **commit**, não por diff.

**Refs de PR:** `pr/1`=`682f8e0`, `pr/2`=`1c86ce9`, `pr/3`=`7a93af1`, `pr/4`=`abeffa4` (fechado sem merge; conteúdo já está nesta branch via `7117aa8`).

**Nenhuma branch adicional publicada.** Confirmado por `git ls-remote --heads --tags 'refs/pull/*'` e por `gh api repos/BloomRX/Lia-Project/branches`.

---

## 3. Relação com a Principal e o que não integrou

### 3.1 O que já está na Principal (verificado por blob)

| Item | Origem | Verificação |
|---|---|---|
| `docs/product/ESPECIFICACAO-GERAL-DO-PRODUTO-LIA.md` | `docs/especificacao-geral-produto-lia` | blob **idêntico** |
| `docs/BRAND-STANDARDS.md` | `qa/windows-benchmarks` e `docs/especificacao…` | blob **idêntico** |
| `docs/reports/LIA-BUILD-HYGIENE-2026-11-14.md` | `arena/4ec8f22b` | blob **idêntico** |
| `memory-service.ts`, `memory-context.test.ts` | `arena/4ec8f22b` | blob **idêntico** |
| `ai-connection-service.ts`, `config-update-sanitizer.ts`, `ipc.ts`, `process-monitor.mjs`, `transport-execution-service.ts` | `arena/4ec8f22b` | **integrados** (`abeffa4` + refinamentos posteriores); o que difere é **posterior** (`@lia/contracts`, runtime D-04), não regressão |
| `auth.ts` — `try/catch` em `updateCredits()` | `arena/4ec8f22b` | **NÃO integrado de propósito** — rejeitado pela auditoria (`errorMessageFrom` não é sanitizador) e **substituído** pela variante superior de `b67929c5` |
| Plano rev.2 | `0bf0629` | presente, com header atualizado para esta branch |

### 3.2 O que **não** integrou (e por quê)

| Conteúdo | Branch | Situação |
|---|---|---|
| Gate de ferramentas desabilitadas (`guardResolvedTool`/`isNameBlocked`) | `c6b02f64` | **Não integrado.** Código idêntico ao HEAD → port limpo, pendente de decisão. |
| Bloqueio de credencial em HTTP não-loopback (`providers/runtime.ts`) | `c6b02f64` | **Não integrado.** Idem. |
| Geração de auth + single-flight + limpeza antes da rede | `c6b02f64` | **Não integrado.** Store atual ainda é a base `8b3f87c1`. |
| `creditsStatus` + validação numérica | `c6b02f64` | **Não integrado**; consumidores não adotam o status. |
| OIDC-OFF | nenhuma branch | **Não implementado em lugar nenhum.** |
| AV-01…AV-15, matriz AU-*, reconciliação de evidências | `18f50ae7` | **Não existia na Principal**; preservado integralmente nesta rodada (§4.6). |
| Fase 1 de UI/UX (primitivos, Home, DoubleCheck, Config/Voice) | `250b337a` | **Não integrado.** A Principal está na base `407300b` nesses arquivos. |
| Correções pontuais do Codex (guarda de chat vazio, `aria-label`, contraste hardcoded) | `codex/lia-ui-ux-fase-1` | **Não integrado.** 1 item portável; 2 rejeitados por redundância/hardcode. |
| Catálogo e arquitetura de modelos/providers, LFM3, Windows/AMD, Ornith | `826a33f1` | **Não existia na Principal**; preservado como *Research reference* (§4.6). |
| Arquitetura de voz multi-provedor | `codex/lia-multi-provider-voice` | **Não existia na Principal**; preservada como referência documental. |

### 3.3 Documentos de origem preservados nesta rodada

Copiados byte-a-byte (nenhum foi reescrito):

| Origem | Arquivos |
|---|---|
| `arena/18f50ae7` | `docs/reports/LIA-AV-ACCEPTANCE-CRITERIA.md`, `LIA-AUDIO-QA-MATRIX.md`, `LIA-AUDIO-EVIDENCE-RECONCILIATION.md` |
| `arena/c6b02f64` | `docs/reports/LIA-STT-SECURITY-AUDIT-2026-11-14.md`, `LIA-AUTH-RECONCILIATION-SECURITY-AUDIT.md`, `LIA-BETA-SECURITY-FIXES-2026-11-14.md`, `LIA-ARQUITETURA-SEGURANCA-AE46C4-2026-11-14.md` |
| `arena/250b337a` | `docs/reports/LIA-UIUX-IMPLEMENTATION-COMPARISON.md`, `LIA-UI-UX-AUDIT-2026-11-14.md`, `docs/product/LIA-PHASE1-UI-UX-2026-11-14.md` |
| `codex/lia-multi-provider-voice` | `docs/reports/LIA-MULTI-PROVIDER-VOICE-ARCHITECTURE.md` |
| `arena/826a33f1` | `docs/research/` (7 documentos) + `docs/reports/LIA-RESEARCH-DOCUMENT-TRANSFER-REVIEW.md` |

Os documentos permanecem **também** nas branches de origem. A cópia não substitui a fonte nem promove o conteúdo a aprovado.

---

## 4. Achados principais

| ID | Achado | Evidência | Consequência |
|---|---|---|---|
| **A-01** | **Não existe** `codex/lia-audio-recovery-407300b` nem `9e94dce`. | `git cat-file -e 9e94dce` → falha; `git rev-list --all --objects \| grep 9e94dce` → 0; `gh api …/commits/9e94dce` → **422**; `ls-remote` sem a branch; `git fsck --lost-found` → **0 dangling**; stash vazio; só 2 branches locais. | A "entrega local do Codex" não é recuperável pelo Git. **G-AUD BLOCKED**. Não inventar reconstrução. |
| **A-02** | A evidência de áudio (4 e 6 WAVs) **não está versionada**. Vive em `J:\lia-evidence\beta-407300b-windows-20261114\` e `J:\lia-evidence\rx580-local-ai-407300b\`. | `LIA-AUDIO-EVIDENCE-RECONCILIATION.md` §2 (E-01, E-02, E-17). | Para o gate, vale **NOT RUN/BLOCKED** — existência declarada ≠ prova verificável. |
| **A-03** | O delta de segurança é **limpo**: os 6 arquivos são byte-idênticos ao HEAD. | `git rev-parse <ref>:<path>` igual em `auth.ts`, `tool-resolver.ts`, `tools.ts`, `llm-service.ts`, `llm.ts`, `providers/runtime.ts` (base `407300b`). | Port sem conflito; o risco é de **comportamento**, não de merge. |
| **A-04** | A branch de segurança **não se autoaprova**. | `LIA-AUTH-RECONCILIATION-SECURITY-AUDIT.md` §0: "NÃO aprovado para beta"; OIDC-OFF "não implementado nem demonstrado". | Não promover o conjunto a "segurança aprovada"; portar por item com teste. |
| **A-05** | A auditoria de segurança testou **106/106 em cópia isolada**, não na suíte oficial. | `9f5ff431` + `LIA-STT-SECURITY-AUDIT` §"Evidências e limites" (93/93 de STT, 107/107 de Core em `b67929c`). | O port precisa **re-executar** as suítes no SHA integrado. Evidência de origem não transfere. |
| **A-06** | A Principal **não tinha** nenhum dos documentos de segurança/áudio/UI/UX/pesquisa. | `git cat-file -e origin/arena/7fa837f0:<doc>` → ausente em 11 de 11 verificados. | Sem a preservação desta rodada, o conhecimento se perderia ao fechar as branches. |
| **A-07** | `L-02` foi implementado **fora da ordem** prescrita pelo plano rev.2. | `LIA-AUTH-RECONCILIATION` §"L-02 e SEC-04/05": `cb2f418` é posterior a `0bf0629`, que exige T-07/T-08 antes de L-02. | L-02 permanece **BLOQUEADO**; a existência do código não altera o gate. |
| **A-08** | `docs/especificacao-geral-produto-lia` e `qa/windows-benchmarks` não têm trabalho pendente. | Spec e `BRAND-STANDARDS.md` já idênticos; benchmark é de 02/10 (SHA antigo). | **MANTER NA ORIGEM** (histórico); nada a portar. |
| **A-09** | `arena/826a33f1` e `agents/docs` carregam um **esquema documental concorrente** (`docs/PROJECT-STATUS.md`, `docs/DECISIONS.md`, `DOCS_VERSION`). | `git diff --name-status 7cb8172..origin/arena/826a33f1` → `A docs/PROJECT-STATUS.md` etc. | Portar **apenas** `docs/research/**` + o relatório de transferência. O esquema antigo fica na origem. |
| **A-10** | `config-update-sanitizer.ts` na Principal é **mais permissivo de propósito** que a higiene (preserva TAB/LF/CR para segredos multilinha), com justificativa em comentário. | Diff `HEAD` × `be24b94f` no arquivo. | **Não regredir** para a versão antiga; registrar a diferença como intencional. |

---

## 5. Matriz de reconciliação por branch

| Branch | Documentação histórica | Implementação | Testes/evidências | Decisão | Destino |
|---|---|---|---|---|---|
| `arena/c6b02f64` | 4 relatórios + README de bancada | 6 arquivos de código (24 no total) | 99/99 + 28/28 + 65/65 + 107/107 **em cópia isolada**; audit 106/106 | **ADAPTAR por item** (TOOL e HTTP-runtime: PORTAR; auth/credits: ADAPTAR; OIDC-OFF/SEC-04/05: BLOQUEADO) | Esta branch, em commits pequenos |
| `arena/18f50ae7` | 3 docs AV/QM/ER + matrizes de validação | **nenhuma** alteração de código | 1.940 PASS offline (Linux), 0 runtime | **PORTAR documentos** (feito); **G-AUD BLOQUEADO** | `docs/reports/` + gate |
| `arena/250b337a` | auditoria UI/UX + comparação + HTML W1–W8 | 91 arquivos de código/config (Launcher + Stage + packages) + 6 docs | 105 testes de core citados; browser **BLOCKED** | **PORTAR seletivamente**; L-02 **BLOQUEADO** | Componentes independentes de segurança |
| `arena/4ec8f22b` | `LIA-BUILD-HYGIENE` | 9 arquivos | integrado; lint 81 erros históricos | **JÁ INCORPORADO** (exceto `auth.ts`, rejeitado) | Nada a fazer |
| `arena/826a33f1` | 7 docs de pesquisa + transfer review | **nenhuma** | — | **PORTAR como Research reference** (feito) | `docs/research/` |
| `agents/docs` | snapshot de `.agents/skills` + esquema antigo | **nenhuma** | — | **MANTER NA ORIGEM** | — |
| `codex/lia-multi-provider-voice` | arquitetura de voz | **nenhuma** (doc-only) | 110 testes citados no Windows; não versionados | **DOCUMENTAR** (feito) | `docs/reports/` |
| `codex/lia-ui-ux-fase-1` | retomada Fase 1 | 4 arquivos de UI | 105 core; Windows **NOT RUN** | **PORTAR 1 item; REJEITAR 2** | `DoubleCheckButton`/guarda |
| `docs/especificacao-geral-produto-lia` | spec do produto | já incorporado | — | **MANTER NA ORIGEM** | — |
| `qa/windows-benchmarks` | benchmark 02/10 | já publicado | CI PASS em SHA antigo | **MANTER NA ORIGEM** | — |
| `main` | — | — | — | **INTOCADA** | — |

Detalhe por alteração (IDs, arquivos, linhas, dependências, risco, teste, responsável, ordem e critério de aceite): **[LIA-BRANCH-INTEGRATION-MATRIX.md](LIA-BRANCH-INTEGRATION-MATRIX.md)**.

### 5.1 Higiene/CI (`arena/4ec8f22b`) — incorporado × pendente

| Item | Estado | Evidência |
|---|---|---|
| `memory-service.ts`, `memory-context.test.ts` | **incorporado** | blob idêntico ao HEAD |
| `docs/reports/LIA-BUILD-HYGIENE-2026-11-14.md` | **incorporado** | blob idêntico |
| `ai-connection-service.ts`, `config-update-sanitizer.ts`, `ipc.ts`, `process-monitor.mjs`, `transport-execution-service.ts` | **incorporado** (`abeffa4`) e **refinado depois** | diferenças são `@lia/contracts` + runtime D-04, não regressão |
| `auth.ts` (`try/catch` + `errorMessageFrom`) | **rejeitado de propósito** | substituído pela variante `b67929c5` (SEC-R-04) |
| `process-monitor.mjs:223` (`firstSeen: _firstSeen`) | **pendência cosmética** | verificar regra de lint; alinhar só o arquivo se necessário |
| Lint global | **não executado** | fora do escopo; 81 erros históricos citados no relatório de origem |

Nada a re-portar. O trabalho da Onda 1 **não deve ser repetido**.

---

## 6. Consolidação do estado canônico

O `docs/project/CURRENT-STATE.md` §0 está **correto** quanto ao que foi provado na rodada 18 (core 153, launcher 270, stage 873, tsc 0, build PASS) e **omisso** quanto ao que segue bloqueado. A atualização desta rodada (§8 do CURRENT-STATE) adiciona, sem remover histórico:

1. Esta reconciliação e a matriz de integração (ponteiros).
2. O estado real dos gates: **G-AUD BLOCKED**, **SEC-01/02/03/04/05 abertos**, **L-02 BLOQUEADO**, **G-ARCH aberto** (Windows não medido).
3. Que a evidência de áudio é **externa ao repositório** e que `9e94dce`/`codex/lia-audio-recovery-407300b` **não existem**.
4. Que a branch de segurança **não está aprovada** e que o port é por item.

Nada do histórico da rodada 18 é removido.

### 6.1 Documentos canônicos revisados nesta rodada

| Documento | Verificação | Estado |
|---|---|---|
| `docs/project/CURRENT-STATE.md` §0 | leitura integral do cabeçalho + comparação com os gates | **corrigido** (parágrafo da rodada 19; restante do arquivo preservado) |
| `docs/reports/LIA-BETA-READINESS-PLAN-2026-11-14.md` | cabeçalho, §0, §1.3–1.5, matriz de achados | **consistente**; rev.2 vigente; P-1/P-2 pendentes |
| `docs/architecture/decisions/ADR-0001-desktop-runtime-d-plus.md` + `DECISION-RECORD-2026-11-16.md` | relido na rodada 18; referenciado aqui | **consistente** com a pesquisa de runtime (não reabre framework) |
| `docs/reports/LIA-DESKTOP-LIFECYCLE-DIAGNOSIS-2026-11-16.md` | produzido na rodada 18; histórico | **histórico** (não reescrito) |
| `docs/reports/LIA-GIT-BRANCH-ORGANIZATION-AUDIT.md` (15/11) | inventário anterior; serviu de base | **histórico**; esta rodada o atualiza |
| Auditorias de segurança (`LIA-BETA-SECURITY-FIXES`, `LIA-AUTH-RECONCILIATION`, `LIA-STT-SECURITY-AUDIT`, `LIA-ARQUITETURA-SEGURANCA`) | preservadas e reconciliadas | **propostas/evidências**, não aprovação |
| Plano de recuperação de áudio | **não existe** como documento; a recuperação é o REC-01 | **pendente** |
| `docs/README.md` | índice atualizado com os 6 relatórios | **corrigido** |

**Distinção aplicada:** implementado = só o que tem código + teste no SHA; proposto = documento/plano; pendente = decisão ou execução em aberto; superado = conteúdo substituído por variante superior (registrado, não apagado).

---

## 7. Riscos abertos

| ID | Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|---|
| R-01 | Port de `auth.ts` mecânico reintroduz `errorMessageFrom` ou deixa import órfão | Média | Alto (log sensível) | Portar por diff revisado + teste de canário; nunca aplicar patch cego |
| R-02 | `creditsStatus` sem consumidores → UI mostra saldo antigo como atual | Alta | Médio | Adotar getter nos consumidores no **mesmo** commit |
| R-03 | Gate de ferramenta bloqueia ferramenta independente de mesmo nome | Média | Médio | Comportamento **deliberadamente conservador**; documentar e testar reabilitação explícita |
| R-04 | HTTP loopback não protege contra processo local malicioso | Média | Médio | Documentar limite; SEC-05 exige vínculo provedor–destino–credencial |
| R-05 | Integrar UI Fase 1 antes de SEC-04/05 reabre caminho de segredo no Launcher | Alta | Alto | L-02 bloqueado; portar só componentes sem toque em cofre/config |
| R-06 | "4/6 WAVs" ser lido como prova de produto | Alta | Alto | Matriz de níveis N0–N7 (E-RE §1); G-AUD só abre com N3–N6 |
| R-07 | Snapshot de docs (`agents/docs`) sobrescrever estrutura canônica | Média | Médio | **MANTER NA ORIGEM**; não portar `docs/PROJECT-STATUS.md` |
| R-08 | Re-executar só a cópia isolada e declarar verde na suíte oficial | Média | Alto | Exigir execução no SHA integrado, com log |

---

## 8. Ordem de execução priorizada

Premissas: **uma frente por vez** onde há dependência de arquivo; paralelismo só entre frentes que não tocam os mesmos arquivos. Nenhuma etapa abaixo foi executada nesta rodada.

### Onda 0 — imediata, sem código (paralelizável)

| Ordem | ID | Trabalho | Responsável | Depende de | Critério de aceite |
|---:|---|---|---|---|---|
| 0.1 | REC-00 | **Congelar** esta reconciliação como baseline (`971d309` + commit desta rodada) e anunciar o SHA às sessões | Arena principal | — | Commit pushado; SHA nos relatórios |
| 0.2 | REC-01 | **Recuperar e versionar** a evidência de áudio de `J:\lia-evidence\{beta-407300b-windows-20261114,rx580-local-ai-407300b}\` (WAVs, logs, hashes, comandos, ambiente) | **Codex (máquina Windows)** | Acesso ao `J:\` | ≥ 1 WAV com SHA-256 + `lia.voice.synthesize` + `git status` limpo; artefatos grandes referenciados por hash, não commitados |
| 0.3 | REC-02 | **Decidir P-2** (limiares AV-04/RTF e AV-07/latência) | Produto (usuário) | — | Decisão escrita em `CURRENT-STATE.md` no mesmo commit |
| 0.4 | REC-03 | **Decidir P-1** (OIDC: OFF no beta ou correção Main-only) | Produto (usuário) | — | Idem |
| 0.5 | REC-04 | **Fechar T-07/T-08** (autorização de mudança de origem/credencial no Main) | Arena/segurança | REC-03 | Teste negativo IPC forjado + decisão de escopo |

### Onda 1 — segurança, sequencial (mesmos arquivos)

| Ordem | ID | Trabalho | Arquivos | Depende de | Critério de aceite |
|---:|---|---|---|---|---|
| 1.1 | SEC-R-01 | Portar **gate de ferramenta** (`guardResolvedTool`, `isNameBlocked`, `isToolAllowed`, filtro pré-`streamText`) | `stage-ui/src/stores/ai/chat-llm/{tool-resolver,tools,llm}.ts`, `core-agent/src/runtime/llm-service.ts`, `types/llm.ts` + testes | — | Suítes de tool-resolver/llm-service PASS **no SHA integrado**; mutação (remover guarda) falha |
| 1.2 | SEC-R-02 | Portar **rejeição de credencial em HTTP não-loopback** | `lia/core/src/providers/runtime.ts` + `providers.test.ts` | — | Core suite PASS; teste de destino externo/LAN/loopback/HTTPS |
| 1.3 | SEC-R-03 | Adaptar **geração de auth + single-flight + limpeza antes da rede** | `stage-ui/src/stores/auth.ts` + `auth.test.ts` | 1.1/1.2 não conflitam; **não** depende de REC-04 | Testes de refresh atrasado, logout pendente, resposta de sessão antiga PASS; **zero** `errorMessageFrom` nos pontos sensíveis |
| 1.4 | SEC-R-04 | Adaptar **`creditsStatus` + validação numérica** e **adotar nos consumidores** | `auth.ts` + consumidores do saldo | 1.3 | Teste de 401/403/erro de rede; UI não mostra saldo antigo como atual |
| 1.5 | SEC-R-05 | Corrigir **STT-01** (remover `text` do log `recording-drop-after-asr`) | `stage-ui/src/composables/audio/voice-input-session.ts` | — | Teste com canário: transcript nunca em console/log |
| 1.6 | SEC-R-06 | **OIDC-OFF** | pendente de REC-03/REC-04 | 1.3 | Critérios de `LIA-AUTH-RECONCILIATION` §OIDC-OFF: IPC forjado não abre browser, não emite token, storage legado limpo |

### Onda 2 — UI/UX seletiva (paralela à Onda 1 apenas nos arquivos que não tocam auth)

| Ordem | ID | Trabalho | Depende de | Critério de aceite |
|---:|---|---|---|---|
| 2.1 | UI-R-01 | Portar primitivos: `LiaButton`, `basic-button` (motion-reduce/focus-visible), `DoubleCheckButton` (focus/Escape/i18n) | — | Testes `lia-ui-foundation`, `component` PASS; contraste estático ≥ 4,5:1 |
| 2.2 | UI-R-02 | Portar `HomeView` (status atômico, `aria-describedby`, `aria-busy`, first-run) | 2.1 | `home.test.ts` PASS; sem duplicação de anúncio |
| 2.3 | UI-R-03 | Portar `InteractiveArea` + guarda de sessão vazia (Codex) | 2.1 | `DoubleCheckButton` desabilitado reativamente; cancelar preserva conversa |
| 2.4 | UI-R-04 | **BLOQUEADO**: `LiaProviderConfig` gerenciado / L-02 / ConfigView "IA & Recursos" | SEC-04/05 | Não integrar antes de 1.6 |
| 2.5 | UI-R-05 | Rejeitar `background:#a62b90` hardcoded e `role="status"` redundante do Codex | — | Registro de rejeição com justificativa |

### Onda 3 — áudio (bloqueada até REC-01)

| Ordem | ID | Trabalho | Depende de | Critério de aceite |
|---:|---|---|---|---|
| 3.1 | AUD-R-01 | Executar AV-01…AV-15 no Windows físico com SHA congelado | REC-01, REC-02, Onda 1.5 | 15/15 PASS com artefato (log + WAV/hash + ambiente) |
| 3.2 | AUD-R-02 | Registrar evidência no repo (ou hash + caminho externo aprovado) | 3.1 | E-RE §7 (8 itens) completo |
| 3.3 | AUD-R-03 | Fechar G-AUD e atualizar `CURRENT-STATE` | 3.1/3.2 | Nenhum PASS sem os 8 itens |

### Onda 4 — pesquisa e higiene (paralela, sem código de produto)

| Ordem | ID | Trabalho | Depende de | Critério de aceite |
|---:|---|---|---|---|
| 4.1 | RES-R-01 | Revisar `docs/research/**` como *Research reference* e confirmar que nenhum modelo virou padrão | — | Nenhuma promoção; catálogo continua com candidatos |
| 4.2 | HYG-R-01 | Confirmar que a Onda 1 de higiene está fechada; só reabrir se lint regredir | — | `LIA-BUILD-HYGIENE` conferido por blob |
| 4.3 | — | Não rodar lint global em arquivos de outras frentes | — | Escopo por arquivo alterado |

---

## 9. Critérios de aceite desta rodada

| # | Critério | Resultado | Evidência |
|---|---|---|---|
| 1 | Todas as branches inventariadas | **PASS** | §2 (12 + 4 PRs) |
| 2 | Diferenças classificadas | **PASS** | §5 + matriz de integração |
| 3 | Nenhuma branch modificada | **PASS** | Nenhum `merge/rebase/reset/cherry-pick`; `git status` desta branch só com docs novos |
| 4 | Segurança reconciliada | **PASS (documento)** / **BLOCKED (gate)** | `LIA-SECURITY-RECONCILIATION.md` |
| 5 | Áudio preservado | **PASS** | 3 docs copiados; `LIA-AUDIO-QA-RECONCILIATION.md` |
| 6 | UI/UX comparado | **PASS** | `LIA-UIUX-RECONCILIATION.md` |
| 7 | Pesquisa atualizada | **PASS** | `LIA-RESEARCH-TRANSFER-RECONCILIATION.md` |
| 8 | Entrega local investigada | **PASS (negativo)** | A-01: não existe |
| 9 | Estado canônico corrigido | **PASS** | `CURRENT-STATE.md` §0 + §8 |
| 10 | Plano executável | **PASS** | §8 + matriz |
| 11 | Nenhum gate PASS sem evidência | **PASS** | G-AUD/SEC/L-02 = BLOCKED |

---

## 10. Anexo — comandos de reprodução

```bash
# inventário
git ls-remote --heads --tags --refs origin
gh api repos/BloomRX/Lia-Project/branches --jq '.[].name'
git rev-parse --short origin/<branch>
git log -1 --format='%H %ad %s' --date=iso origin/<branch>

# relação com a Principal
mb=$(git merge-base origin/arena/7fa837f0-lia-project origin/<branch>)
git rev-list --count $mb..origin/<branch>
git diff --name-status $mb..origin/<branch> | head -50

# comparação por blob (não por diff)
git rev-parse origin/arena/7fa837f0-lia-project:<path>
git rev-parse origin/<branch>:<path>

# prova de inexistência
git cat-file -e 9e94dce^{commit} || echo INEXISTENTE
git rev-list --all --objects | grep 9e94dce || echo "0 objetos"
gh api repos/BloomRX/Lia-Project/commits/9e94dce   # 422
git ls-remote --heads origin 'refs/heads/codex/lia-audio-recovery-407300b'  # vazio
```

---

**Relatórios irmãos:** [matriz de integração](LIA-BRANCH-INTEGRATION-MATRIX.md) · [segurança](LIA-SECURITY-RECONCILIATION.md) · [áudio](LIA-AUDIO-QA-RECONCILIATION.md) · [UI/UX](LIA-UIUX-RECONCILIATION.md) · [pesquisa](LIA-RESEARCH-TRANSFER-RECONCILIATION.md).
