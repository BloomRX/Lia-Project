# Lia — Auditoria e organização definitiva das branches

**Data:** 15/11/2026
**Auditor:** agente principal (Arena)
**Branch auditada como Principal:** `arena/7fa837f0-lia-project`, tip `da3a1502179daddd1a1d70f8701b0c4d5b49cdaf`
**Natureza:** auditoria e planejamento. Nenhuma branch foi criada, alterada, mergeada, rebaseada, removida ou forçada. Nenhum checkout de outra branch foi feito neste workspace.
**Base de comparação:** `da3a150` (tip da Principal no início da auditoria).

---

## 0. Sumário executivo

| Fato | Número |
|---|---|
| Branches remotas no início da auditoria | 13 |
| Branches remotas no fim da auditoria | **12** (`arena/01a10290` foi removida do remoto durante a auditoria) |
| Branches locais | 2 (`arena/7fa837f0`, `main`) |
| Sessões ativas mapeadas | **6 de 6** |
| Branches com trabalho de código não integrado | **3** (UI/UX, Architecture/Security, Codex UI) |
| Branches cuja árvore é docs-only e **não pode** ser mergeada | **2** (`agents/docs`, `arena/826a33f1`) |
| Branches redundantes ou já incorporadas | **3** (`arena/01a10290`, `arena/4ec8f22b` exceto `auth.ts`, `docs/especificacao`) |
| Conflitos de merge previstos com a Principal | 4 branches (1 crítico, 3 simples) |
| PRs abertos | 0 |

**O achado mais importante não é de código.** Duas sessões afirmam fatos diferentes sobre o **mesmo SHA** (`407300b`) no áudio: a QA diz que "Kokoro nunca sintetizou nesta base"; a sessão Codex de voz apresenta evidência Windows de 4 + 6 WAVs válidos. A evidência Windows está fora do repositório (`J:/lia-evidence/…`) e não é versionada. O plano da Principal reflete a versão pessimista. Isso precisa ser reconciliado antes de qualquer gate de áudio.

---

## 1. Inventário completo

### 1.1 Tabela geral

| # | Branch | SHA | Sessão | Base / merge-base com a Principal | Commits exclusivos | Arquivos (A/M/D) | Contida na Principal? | Estado |
|---|---|---|---|---|---|---|---|---|
| 1 | `arena/7fa837f0-lia-project` | `da3a150` | **Principal** | base = `main` `9c7ac18` | — | 650 vs `main` (+121.051/−1.690) | é a própria | **ATIVA** |
| 2 | `main` | `9c7ac18` | — (release) | — | 0 | — | **SIM** (ancestral) | intocada, 206 commits atrás |
| 3 | `arena/18f50ae7-lia-project` | `4acd20e` | **QA** | `5ec464e` | 7 | 89 A / 0 M / 0 D | NÃO | ativa, docs-only |
| 4 | `arena/250b337a-lia-project` | `dd8dc0c` | **UI/UX** | `407300b` | 8 | 31 A / 53 M / 0 D | NÃO | ativa, código |
| 5 | `arena/4ec8f22b-lia-project` | `be24b94` | **Higiene, CI e build** | `407300b` | 3 | 1 A / 8 M / 0 D | NÃO (parcial) | encerrada na prática |
| 6 | `arena/826a33f1-lia-project` | `16c97fd` | **Research** | `7cb8172` | 3 | 12 A / 2 M / 6.183 D* | NÃO | ativa, docs-only |
| 7 | `arena/c6b02f64-lia-project` | `0093de0` | **Architecture/Security** | `407300b` | 6 | 9 A / 12 M / 0 D | NÃO | ativa, código |
| 8 | `codex/lia-ui-ux-fase-1` | `e72574e` | Codex (não é sessão) | `da3a150` | 1 | 1 A / 4 M / 0 D | NÃO | recente, código |
| 9 | `codex/lia-multi-provider-voice` | `fd0451d` | Codex (não é sessão) | `0bf0629` | 1 | 1 A / 2 M / 0 D | NÃO | recente, docs |
| 10 | `agents/docs` | `7913c62` | — (referência) | `7cb8172` | 1 | docs-only† | NÃO | snapshot congelado |
| 11 | `docs/especificacao-geral-produto-lia` | `b2745f7` | — (antiga) | `f1eebd9` | 4 | 4 A / 3 M / 0 D | NÃO | **abandonada** (30/10) |
| 12 | `qa/windows-benchmarks` | `91b8995` | — (evidência) | **sem merge-base** (histórico órfão) | 3 | 20 arquivos | NÃO | **arquivo** (02/10) |
| 13 | `arena/01a10290-lia-project` | `abeffa4` | Principal anterior | `9c7ac18` | 0 (contida) | — | **SIM** | **removida do remoto** |

\* A branch Research tem árvore **docs-only**: os 6.183 "D" são código que existe na Principal e não existe na árvore dela. O delta real de conteúdo são **6 documentos** (+1.057 linhas).
† `agents/docs` também é docs-only: `AGENTS.md`, `DOCS_VERSION`, `README.md` e `docs/`.

### 1.2 Detalhe por branch

#### 1.2.1 `arena/7fa837f0-lia-project` — Principal

- Tip `da3a150`, 206 commits à frente de `main`, +121.051/−1.690 linhas em 650 arquivos.
- Contém: A-1 (`f3facdf`), decisão A-1 (`ae46c49`), auditoria (`5ec464e`), plano rev.1 (`407300b`), plano rev.2 (`0bf0629`), integração parcial da Onda 1 (`abeffa4`), merge do histórico (`7117aa8`), registro da nova branch (`da3a150`).
- É a única branch que contém **todo** o histórico de desenvolvimento. `main` está contida nela (fast-forward possível no futuro).

#### 1.2.2 `main`

- Tip `9c7ac18`, 0 commits exclusivos, 206 atrás.
- Recebeu 4 commits de documentação (marca/independência da AIRI) que já estão na Principal via merge.
- **Não deve receber nada** até a promoção autorizada.

#### 1.2.3 `arena/18f50ae7-lia-project` — QA

- 7 commits, todos `docs(qa)`. 89 arquivos novos, 86.265 linhas, **7,7 MB** (logs de evidência).
- Conteúdo: matrizes `5ec464e`, `ae46c49`, `407300b`; `LIA-QA-VALIDATION-2026-11-14`; `LIA-AUDIO-QA-MATRIX`; 5 diretórios de evidência (33 + 10 + 30 + 11 + 2 arquivos).
- **Merge limpo** com a Principal (verificado com `git merge-tree`).
- Varredura anti-segredo: única ocorrência é o fixture sintético `gsk-ABCDEFGHIJKLMNOP1234567890` do `hearing.test.ts`, que testa justamente que a chave **não** vaza. Confirmado no próprio relatório.

#### 1.2.4 `arena/250b337a-lia-project` — UI/UX

- 8 commits, 31 arquivos novos, 53 modificados, +6.716/−602.
- Contém a **auditoria** (`LIA-UI-UX-AUDIT`) e a **implementação da Fase 1**: L-01, S-01/S-02, **L-02**, L-03, A-01/A-02, com testes e evidência.
- Alega: Launcher 360/360, Stage 72/72, stage-ui 56/56, A-1 31/31, layouts 41/41, typechecks e builds PASS, ESLint 0.
- **Conflito previsto:** apenas `docs/project/CURRENT-STATE.md`.
- **Risco de escopo:** implementou **L-02**, que o plano (DP-3) condiciona ao fechamento de SEC-04/05. Precisa de decisão explícita.
- **Duplicação:** disputa 4 arquivos de código com `codex/lia-ui-ux-fase-1`.

#### 1.2.5 `arena/4ec8f22b-lia-project` — Higiene, CI e build

- 3 commits (um de merge), 9 arquivos, +208/−15.
- **Já integrada** na Principal por `abeffa4`, com duas correções de revisão:
  - `process-monitor.mjs`: `firstSeen: _firstSeen` (o rename simples vazava `firstSeen`);
  - `config-update-sanitizer.ts`: helper preserva TAB/LF/CR (o original recusava multilinha).
- 6 dos 7 arquivos estão **idênticos** à Principal; 2 diferem só pelas correções.
- **Não integrado:** `airi/packages/stage-ui/src/stores/auth.ts` (+11/−4) — aguarda parecer de Architecture/Security.
- Merge agora **conflita** em 2 arquivos — esperado, porque a versão da Principal é a revisada.

#### 1.2.6 `arena/826a33f1-lia-project` — Research

- 3 commits: o snapshot `7913c62` (idêntico ao tip de `agents/docs`) + 2 commits de pesquisa.
- Delta real: 6 documentos (+1.057 linhas): catálogo de modelos/providers, arquitetura neutra, recomendações, avaliação LFM3, compatibilidade Windows/AMD, pesquisa de recursos de runtime.
- **Árvore docs-only.** Um merge apagaria 6.183 arquivos de código. `git merge-tree` confirma conflitos `modify/delete` em massa.
- **Nunca mergear.** Só copiar os 6 arquivos.

#### 1.2.7 `arena/c6b02f64-lia-project` — Architecture/Security

- 6 commits, 21 arquivos, +584/−35. **Merge limpo** com a Principal.
- Contém a auditoria (`LIA-ARQUITETURA-SEGURANCA`) e correções reais:
  - **TOOL-01/02**: filtro síncrono no último ponto antes de `streamText`, wrappers que revalidam na execução, bloqueio por colisão de nome, proveniência local (`resolvedIds`). Testes 99/99 na suíte isolada.
  - **SEC-05 (parcial)**: recusa de credencial em HTTP fora de loopback (`lia/core/src/providers/runtime.ts`), Core 107/107.
  - **SEC-02 (parcial)**: geração de sessão invalida refresh/respostas antigas; logout limpa antes da rede. Não elimina tokens do Renderer — **SEC-01 segue aberto**.
- O próprio relatório declara: "Entrega parcial; NÃO liberar o beta com base neste relatório. OIDC-OFF ainda não está implementado nem demonstrado."
- **Colisão semântica:** sua alteração em `auth.ts` remove o import de `errorMessageFrom`, que a correção de `updateCredits` (be24b94) usa. As duas edições **não podem** ser aplicadas sem reconciliação.

#### 1.2.8 `codex/lia-ui-ux-fase-1`

- 1 commit do autor "Lucas", base **`da3a150`** (a mais atual de todas).
- 5 arquivos, +23/−3: contraste `#a62b90` no `LiaButton`, `role="status"` na Home, `window.confirm` para limpar chat e remover provider, + relatório.
- **Merge limpo**, mas **duplica** 4 arquivos da branch UI/UX com abordagem inferior:
  - `#a62b90` fixo vs token `--lia-accent-action` com hover `#8f247c` e foco preservado;
  - `window.confirm` vs `DoubleCheckButton` com nome acessível, foco em Cancelar, Escape e retorno de foco.

#### 1.2.9 `codex/lia-multi-provider-voice`

- 1 commit, 3 arquivos: novo documento de arquitetura de voz + edições no plano e no `CURRENT-STATE.md`.
- **Conflito:** `docs/project/CURRENT-STATE.md`.
- **Divergência factual:** afirma evidência Windows em `407300b` (Kokoro CPU 1.30.0 → 4 WAVs; smoke ORT 1.24.4 → 6 WAVs; DirectML falhou no `ConvTranspose`). A QA afirma o contrário para o mesmo SHA.

#### 1.2.10 `agents/docs`

- 1 commit sobre `7cb8172`: snapshot curado docs-only, com `DOCS_VERSION` apontando `source_commit: 7cb8172`.
- 6 arquivos exclusivos: `DOCS_VERSION`, `AGENT-WORKFLOW.md`, `BRANCH-STRATEGY.md`, `DECISIONS.md`, `PROJECT-OVERVIEW.md`, `PROJECT-STATUS.md`.
- `docs/BRANCH-STRATEGY.md` está **desatualizado**: trata `lia/development` como branch principal de desenvolvimento e `arena/01a10290` como ativa. Ambas as premissas caíram.
- **Nunca mergear** (árvore docs-only).

#### 1.2.11 `docs/especificacao-geral-produto-lia`

- 4 commits de 30/10, 125 commits atrás.
- Conteúdo exclusivo: `docs/product/ESPECIFICACAO-GERAL-DO-PRODUTO-LIA.md` e `docs/BRAND-STANDARDS.md` — **ambos idênticos** (md5) aos da Principal. O resto é `AGENTS.md`/`README.md` antigos, superados.
- **Redundante.** Nada a integrar.

#### 1.2.12 `qa/windows-benchmarks`

- Histórico **órfão** (root `8ced3b6`, 02/10), 3 commits, 20 arquivos.
- Uma execução de benchmark Windows (`20261002-141203-cfd8d7f`) do SHA `cfd8d7f`, que é ancestral da Principal (estado de 02/10).
- **Arquivo histórico.** Não mergear (histórico não relacionado).

#### 1.2.13 `arena/01a10290-lia-project` (removida)

- No início da auditoria constava em `ls-remote` como `abeffa4`. Ao final, **não consta mais** — foi removida do remoto durante a sessão (provavelmente pela limpeza pós-fechamento do PR #4). Nenhuma exclusão foi executada por mim.
- `abeffa4` é **ancestral** de `da3a150`. **Nenhum conteúdo foi perdido.**

---

## 2. Mapeamento sessão → branch

| Sessão | Branch | Evidência usada | Confiança |
|---|---|---|---|
| **1. Lia Project Principal** | `arena/7fa837f0-lia-project` | Declaração do usuário + é a branch que contém o plano rev.2, A-1 e a integração da Onda 1 | **Alta** |
| **2. Higiene, CI e build** | `arena/4ec8f22b-lia-project` | Relatório `LIA-BUILD-HYGIENE`; commits citam T-01/T-03/T-04; 7 arquivos de lint/higiene | **Alta** |
| **3. Research** | `arena/826a33f1-lia-project` | 6 documentos em `docs/research/`; commits `docs(research)`; construída sobre o snapshot `agents/docs` | **Alta** |
| **4. UI/UX** | `arena/250b337a-lia-project` | `LIA-UI-UX-AUDIT`; implementação L-01/L-02/L-03/S-01/S-02/A-01/A-02; evidência `lia-phase1-ui-ux` | **Alta** |
| **5. QA** | `arena/18f50ae7-lia-project` | Matrizes de validação e 5 diretórios de evidência; `LIA-AUDIO-QA-MATRIX` | **Alta** |
| **6. Architecture/Security** | `arena/c6b02f64-lia-project` | `LIA-ARQUITETURA-SEGURANCA`; correções TOOL e SEC; evidência `lia-audit-ae46c4` | **Alta** |

**Limite do método:** os nomes das branches usam UUIDs de sessão do Arena, não os nomes das sessões. O vínculo foi confirmado por **conteúdo** (relatórios, escopo e arquivos), não por identificador. Nenhuma sessão adicional foi inferida.

**Branches fora das seis sessões:**

| Branch | Natureza | Sessão? |
|---|---|---|
| `codex/lia-ui-ux-fase-1` | Trabalho do Codex (autor "Lucas") | **Não** |
| `codex/lia-multi-provider-voice` | Trabalho do Codex (autor "Lucas") | **Não** |
| `agents/docs` | Snapshot documental de referência | **Não** |
| `docs/especificacao-geral-produto-lia` | Resto de trabalho antigo (30/10) | **Não** |
| `qa/windows-benchmarks` | Evidência histórica órfã (02/10) | **Não** |
| `main` | Linha de release | **Não** |

---

## 3. Classificação de integração

### 3.1 Pode ser integrado (sem correção prévia)

| Branch | O que integrar | Por quê |
|---|---|---|
| **QA** | Os 89 arquivos de docs/evidência | Merge limpo, docs-only, fecha a lacuna de evidência da Principal |
| **Research** | **Só os 6 documentos** (cópia, não merge) | Arquivo de referência; árvore docs-only impede merge |

### 3.2 Precisa de correção/decisão antes da integração

| Branch | Pendência | Impacto |
|---|---|---|
| **UI/UX** | conflito em `CURRENT-STATE.md`; decisão sobre L-02; escolha entre ela e `codex/lia-ui-ux-fase-1`; reexecutar testes no SHA final | Alto |
| **Architecture/Security** | `auth.ts` depende de parecer; `updateCredits` precisa ser reconciliado com a versão de Higiene; OIDC-OFF não implementado | Alto |
| **Higiene** | só `auth.ts`; merge direto conflita com a versão já revisada | Médio |
| **Codex voice** | conflito em `CURRENT-STATE.md`; reconciliar a divergência factual de áudio | Alto |
| **Codex UI** | duplicata parcial da branch UI/UX; precisa escolher uma | Médio |

### 3.3 Deve permanecer independente (não mergear)

| Branch | Motivo |
|---|---|
| `agents/docs` | Árvore docs-only; merge apagaria o código |
| `arena/826a33f1` (Research) | idem |
| `qa/windows-benchmarks` | Histórico órfão; merge criaria divergência |
| `main` | Só release autorizado |

### 3.4 Redundante ou já incorporada

| Branch | Estado |
|---|---|
| `arena/01a10290` | 100% contida em `da3a150`; removida do remoto |
| `arena/4ec8f22b` | 7/8 arquivos já na Principal (2 com correções); falta `auth.ts` |
| `docs/especificacao-geral-produto-lia` | Conteúdo idêntico ao da Principal |

### 3.5 Precisa de investigação adicional

1. **Áudio em `407300b`:** evidência Windows (Codex) × "nunca sintetizou" (QA).
2. **L-02 adiantado:** implementado antes de SEC-04/05.
3. **`auth.ts`:** três versões concorrentes — base (`407300b`), `updateCredits` (be24b94) e geração de sessão (c6b02f64).
4. **Evidência 7,7 MB:** decidir se logs entram no repositório ou em armazenamento externo.

---

## 4. Matriz de integração e conflitos

### 4.1 Resultado do `git merge-tree` (Principal × branch)

| Branch | Resultado | Conflitos |
|---|---|---|
| QA (`18f50ae7`) | **LIMPO** | — |
| Arch/Sec (`c6b02f64`) | **LIMPO** | — |
| Codex UI (`codex/lia-ui-ux-fase-1`) | **LIMPO** | — |
| UI/UX (`250b337a`) | conflito | `docs/project/CURRENT-STATE.md` |
| Codex voice (`codex/lia-multi-provider-voice`) | conflito | `docs/project/CURRENT-STATE.md` |
| Higiene (`4ec8f22b`) | conflito | `config-update-sanitizer.ts`, `process-monitor.mjs` (já integrados com correção) |
| Research (`826a33f1`) | **crítico** | `modify/delete` em massa (6.183 arquivos) |
| `agents/docs` | **crítico** | idem |

### 4.2 Sobreposição de arquivos entre branches

| Par | Arquivos em comum |
|---|---|
| UI/UX × Codex UI | **4** (`LiaButton.vue`, `HomeView.vue`, `InteractiveArea.vue`, `LiaProviderConfig.vue`) |
| UI/UX × Codex voice | 1 (`CURRENT-STATE.md`) |
| Arch/Sec × Higiene | 1 (`auth.ts`) |

### 4.3 Ordem sugerida de integração

1. **QA** (docs, limpo) — não bloqueia nada.
2. **Research** (cópia de 6 docs) — não bloqueia nada.
3. **Arch/Sec** (código, limpo) — **depois** do parecer sobre `auth.ts` e da decisão de escopo OIDC.
4. **UI/UX** (código) — depois de decidir contra `codex/lia-ui-ux-fase-1` e sobre L-02.
5. **Higiene `auth.ts`** — junto com o item 3, com reconciliação explícita.
6. **`main`** — só após todos os gates.

---

## 5. Riscos

| # | Risco | Severidade | Mitigação |
|---|---|---|---|
| R-01 | Merge de árvore docs-only (`Research`, `agents/docs`) apagar código | **Crítico** | Proibir merge; integrar por cópia de caminhos |
| R-02 | Evidência de áudio contraditória no mesmo SHA | **Alto** | Auditar `J:/lia-evidence`, versionar os artefatos, corrigir B-07 |
| R-03 | `auth.ts` com três versões concorrentes | **Alto** | Um único dono; aplicar por último com testes |
| R-04 | Duas implementações de Fase 1 (UI/UX × Codex) | **Alto** | Escolher uma; arquivar a outra |
| R-05 | L-02 adiantado sem SEC-04/05 | Médio | Decidir: aceitar com ressalva ou reverter |
| R-06 | Relatórios das sessões não estão na Principal | Médio | Integrar docs (etapa 1) |
| R-07 | `main` 206 commits atrás | Médio | Fast-forward só na promoção |
| R-08 | Repositório cresce 7,7 MB com logs | Baixo | Aceitar ou mover para artefato |
| R-09 | `agents/docs` desatualizado (`lia/development`) | Baixo | Marcar como histórico; não usar como regra |
| R-10 | Workspace Windows com worktrees órfãos | Médio | Checklist de verificação antes de reutilizar |

---

## 6. Estrutura recomendada do workspace

> Não inspecionei `J:\` — o sandbox é Linux. Esta seção é proposta, não execução.

### 6.1 Layout

```
J:\Lia\
├─ Lia-Project_workspace\
│  ├─ principal\                    ← clone primário; guarda .git e TODAS as refs
│  │                                  (branch arena/7fa837f0-lia-project)
│  ├─ higiene\                      ← worktree arena/4ec8f22b-lia-project
│  ├─ research\                     ← worktree arena/826a33f1-lia-project
│  ├─ uiux\                         ← worktree arena/250b337a-lia-project
│  ├─ qa\                           ← worktree arena/18f50ae7-lia-project
│  ├─ archsec\                      ← worktree arena/c6b02f64-lia-project
│  ├─ codex\
│  │  ├─ ui-ux-fase-1\              ← worktree codex/lia-ui-ux-fase-1
│  │  └─ multi-provider-voice\      ← worktree codex/lia-multi-provider-voice
│  └─ archive\                      ← checkouts destacados, somente leitura
│     ├─ agents-docs\
│     ├─ especificacao\
│     └─ windows-benchmarks\
└─ lia-evidence\                    ← FORA do repositório
   ├─ beta-407300b-windows-20261114\
   └─ rx580-local-ai-407300b\
```

**Por que `principal` é o clone primário:** o requisito diz que a Principal deve ficar em `J:\...\principal`. Se ela guarda o `.git`, todos os worktrees compartilham objetos e refs — um único `fetch` atualiza tudo. O custo é que apagar `principal` quebra os demais. A alternativa (um clone por sessão) isola, mas multiplica o `fetch` e cria o risco clássico de cada sessão estar num SHA diferente.

### 6.2 Regras de uso

1. **Uma branch por worktree.** `git worktree add` recusa a mesma branch duas vezes — isso é proteção, não obstáculo.
2. **`git fetch` só em `principal`.** Os worktrees leem as mesmas refs.
3. **`CURRENT-STATE.md` é da Principal.** Nenhum worktree de sessão edita.
4. **Codex nunca trabalha em `principal`.** Usa `codex\...`.
5. **`archive\` é somente leitura** (detached HEAD, sem branch local).
6. **Evidência fora do repo** (`J:\Lia\lia-evidence\`), referenciada por caminho nos relatórios.
7. **Nunca `git clean -xdf` em `principal`** — destrói trabalho não rastreado de todas as sessões.
8. **`node_modules` por worktree**, mas store do pnpm compartilhado (deduplicação automática).
9. **NTFS local, fora de OneDrive**, com `core.longpaths=true`.

### 6.3 Sequência de criação (somente com autorização)

```bat
git clone https://github.com/BloomRX/Lia-Project.git "J:\Lia\Lia-Project_workspace\principal"
cd /d "J:\Lia\Lia-Project_workspace\principal"
git config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"
git fetch origin --prune
git config core.longpaths true

git worktree add ..\higiene   -b arena/4ec8f22b-lia-project    origin/arena/4ec8f22b-lia-project
git worktree add ..\research  -b arena/826a33f1-lia-project    origin/arena/826a33f1-lia-project
git worktree add ..\uiux      -b arena/250b337a-lia-project    origin/arena/250b337a-lia-project
git worktree add ..\qa        -b arena/18f50ae7-lia-project    origin/arena/18f50ae7-lia-project
git worktree add ..\archsec   -b arena/c6b02f64-lia-project    origin/arena/c6b02f64-lia-project
git worktree add ..\codex\ui-ux-fase-1 -b codex/lia-ui-ux-fase-1 origin/codex/lia-ui-ux-fase-1
git worktree add ..\codex\multi-provider-voice -b codex/lia-multi-provider-voice origin/codex/lia-multi-provider-voice
git worktree add --detach ..\archive\agents-docs origin/agents/docs
git worktree add --detach ..\archive\especificacao origin/docs/especificacao-geral-produto-lia
git worktree add --detach ..\archive\windows-benchmarks origin/qa/windows-benchmarks
```

### 6.4 Verificação de worktree órfão (antes de reutilizar)

```bat
git worktree list
git -C <caminho> rev-parse HEAD
git -C <caminho> status --porcelain
git -C <caminho> rev-parse --abbrev-ref HEAD
```

Critério: só reutilizar se o HEAD for o tip esperado **e** `status` estiver vazio. Se houver trabalho não rastreado, preservar antes de qualquer ação.

---

## 7. Plano de organização em etapas

| Etapa | Objetivo | Escrita? | Depende de |
|---|---|---|---|
| **E-0** | Aprovar este relatório e as decisões de escopo (L-02, Codex UI, áudio) | Não | — |
| **E-1** | Trazer **documentação** das sessões para a Principal: QA (89), UI/UX (31), Arch/Sec (9), Research (6) — por cópia, nunca merge de árvore docs-only | Sim (docs) | E-0 |
| **E-2** | Reconciliar `auth.ts`: parecer + escolha entre `updateCredits` e geração de sessão | Sim (código) | E-0, parecer |
| **E-3** | Integrar Arch/Sec (TOOL, SEC-05 parcial) com testes no SHA final | Sim (código) | E-2 |
| **E-4** | Integrar UI/UX (ou Codex UI, o que for escolhido) com testes | Sim (código) | E-0 |
| **E-5** | Auditar a evidência de áudio e corrigir B-07/plano | Sim (docs) | acesso a `J:/` |
| **E-6** | Arquivar branches redundantes (com autorização) | Ref | E-1..E-5 |
| **E-7** | Montar o workspace `J:\` e validar os worktrees | Fora do Git | E-0 |
| **E-8** | Promover a `main` (fast-forward) | Ref | todos os gates |

**Nenhuma etapa foi executada nesta rodada.**

---

## 8. Ações que exigem autorização explícita

| # | Ação | Por que exige autorização |
|---|---|---|
| A-01 | Copiar os 89 arquivos da QA para a Principal (7,7 MB) | Aumenta o repositório; decisão de onde a evidência mora |
| A-02 | Copiar os 6 documentos da Research | Integração de conteúdo de outra sessão |
| A-03 | Copiar os relatórios de UI/UX e Arch/Sec | idem |
| A-04 | Integrar código de Arch/Sec (`tools.ts`, `tool-resolver.ts`, `runtime.ts`) | Altera comportamento de ferramentas e credenciais |
| A-05 | Integrar `auth.ts` (qual das versões) | Segurança + parecer pendente |
| A-06 | Integrar a Fase 1 de UI/UX | Altera UI de produto |
| A-07 | Arquivar `codex/lia-ui-ux-fase-1` ou `arena/250b337a` | Descarte de trabalho de terceiro |
| A-08 | Arquivar `docs/especificacao-geral-produto-lia` | idem |
| A-09 | Excluir qualquer branch remota | Irreversível na prática |
| A-10 | Criar os worktrees em `J:\` | Altera o ambiente do usuário |
| A-11 | Promover a `main` (fast-forward de 206 commits) | Release oficial |
| A-12 | Mover/limpar `agents/docs` e sua `BRANCH-STRATEGY` desatualizada | Referência usada por agentes |

---

## Anexo A — Método e limitações

**Executado (somente leitura):** `git ls-remote`, `git fetch` (refs remotas), `git rev-list --count`, `git merge-base`, `git diff --name-status/--numstat`, `git merge-tree --write-tree`, `git log`, `git show`, `git cat-file`, varredura de segredos por padrão textual.

**Limitações:**

1. **Sandbox Linux.** Não inspecionei `J:\`, não validei worktrees existentes e não executei testes de nenhuma branch (cada uma exigiria checkout próprio).
2. **Não reexecutrei as suítes das sessões.** Os números citados (360/360, 99/99, 107/107 etc.) são **declarações dos relatórios**, não medições desta auditoria.
3. **Evidência Windows** (`J:/lia-evidence/`) não é acessível daqui e não está versionada.
4. **Nomes de sessão** não são deriváveis dos UUIDs das branches; o mapeamento é por conteúdo.
5. **Repositório era shallow** no início; foi aprofundado com `fetch --deepen` para permitir merge-bases. Isso não alterou nenhuma branch.
6. A remoção de `arena/01a10290` do remoto ocorreu **durante** a auditoria; não fui eu quem a executou.

## Anexo B — Divergências factuais registradas

### B.1 Áudio em `407300b`

| Fonte | Afirmação |
|---|---|
| `codex/lia-multi-provider-voice` | Kokoro CPU 1.30.0 gerou 4 WAVs válidos; smoke ORT 1.24.4 gerou 6 WAVs; DirectML falhou no `ConvTranspose` |
| QA (`LIA-AUDIO-QA-MATRIX`) | "Kokoro nunca sintetizou nesta base"; 0% runtime; STT nunca transcreveu áudio real |
| Plano da Principal (B-07) | "TTS/STT reais nunca executados" |

As três afirmações não podem estar corretas ao mesmo tempo. A hipótese mais provável é que a QA mediu **outro ambiente** (Linux/sandbox) e o Codex mediu **Windows físico**, mas nenhum dos dois documentos delimita isso com clareza suficiente para o gate. **Requer auditoria da evidência antes de qualquer PASS.**

### B.2 L-02

DP-3 diz "L-02 depende de segurança". A branch UI/UX implementou L-02. Não é violação automática (a implementação é de navegação/disclosure, não de escrita de credencial), mas exige decisão registrada.

### B.3 `auth.ts`

| Versão | Origem | Efeito |
|---|---|---|
| Base | `407300b` | rejeição não tratada em `updateCredits` (QA-02) |
| `updateCredits` com `try/catch` | `be24b94` (Higiene) | elimina a rejeição; usa `errorMessageFrom` |
| Geração de sessão | `c6b02f64` (Arch/Sec) | corrige SEC-02 parcial; **remove** o import de `errorMessageFrom` |

Aplicar as duas sem reconciliação **quebra a compilação** (import removido × uso no `catch`).

---

## Anexo C — Referências

- `docs/reports/LIA-BETA-READINESS-PLAN-2026-11-14.md` (plano rev.2)
- `docs/project/CURRENT-STATE.md` §0
- `docs/reports/LIA-BUILD-HYGIENE-2026-11-14.md`
- `docs/reports/LIA-ARCH-SEC-REVIEW-REQUEST-UPDATECREDITS-2026-11-15.md`
- Relatórios das sessões: `LIA-QA-VALIDATION-2026-11-14.md`, `LIA-AUDIO-QA-MATRIX.md`, `LIA-UI-UX-AUDIT-2026-11-14.md`, `LIA-ARQUITETURA-SEGURANCA-AE46C4-2026-11-14.md`, `LIA-BETA-SECURITY-FIXES-2026-11-14.md`, `LIA-MULTI-PROVIDER-VOICE-ARCHITECTURE.md` (todos nas branches de origem, **não** na Principal)
