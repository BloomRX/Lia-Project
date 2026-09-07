# M0-A — AIRI Bootstrap / Integração com upstream

> **Fase/Milestone:** M0-A (base reproduzível do AIRI no repositório Lia)
> **Data:** 07/09/2026 · **Branch:** `arena/01a07b6d-lia-project`
> **Escopo:** trazer o AIRI como base do repositório, validar toolchain, e **registrar** versão/commit/comandos/limitações. Não implementa a Lia nem refatora o AIRI.

---

## 0. STATUS (importante — não inventar sucesso)

**BOOTSTRAP DOCUMENTED — BUILD NOT VALIDATED IN SANDBOX**

- A tag/commit do AIRI foi **confirmada contra o upstream real** (não há divergência).
- O remote `upstream` foi configurado no repositório da Lia.
- **NÃO** foi feito vendor do source do AIRI (~576 MB / 5.332 arquivos) neste repositório nesta etapa.
- **NÃO** foi executado build/check do AIRI no sandbox: o sandbox **não possui Node 26.7.0** (tem Node v22.22.3), não possui `pnpm`/`mise`, e possui **apenas ~3,8 GB de RAM** (o monorepo AIRI exige muito mais).
- Portanto **nada aqui é validação de que o AIRI "roda"**. Build/typecheck/testes reais serão executados na **máquina de desenvolvimento real** (Ryzen 5 5500 · RX 580 8 GB · 16 GB RAM), seguindo os comandos da §5.

---

## 1. AIRI upstream, tag e commit confirmados (sem divergência)

Verificação feita contra `https://github.com/moeru-ai/airi` via API GitHub e `git ls-remote`:

| Campo | Valor |
|---|---|
| **Versão/tag** | `v0.12.0-beta.5` |
| **Tag object (annotated)** | `6ea680f51486d257f9b0eeda3bdc25db4307d3bb` |
| **Commit (peeled, alvo do checkout)** | `2c1e223c8dd813d7c74a324d7fd7399fbf47e8bf` |
| **Release publicado em** | `2026-08-29` |
| **Branch default upstream** | `main` |
| **Licença** | MIT (© 2024-PRESENT Neko Ayaka) |
| **Org / repo** | `moeru-ai/airi` |

**Conclusão:** a documentação atual (`docs/estudo-airi.md`, README, e os documentos de arquitetura) define a tag `v0.12.0-beta.5`, e essa tag **realmente existe** no upstream, apontando para o commit acima. **Não há divergência** entre documentação e upstream.

**Correspondência com o estudo:** o estudo relatou "48 pacotes"; a inspeção real da árvore do tag contou **49** entradas em `packages/` (irrelevante para a escolha da tag — apenas uma correção factual registrada aqui).

---

## 2. Remotes configurados

Estado verificado em `git remote -v` no repositório da Lia:

| Nome | URL | Papel |
|---|---|---|
| `origin` | `https://github.com/BloomRX/Lia-Project.git` | **Repositório da Lia** (produto/documentação/tooling Lia) |
| `upstream` | `https://github.com/moeru-ai/airi` | **AIRI** (fonte de verdade do runtime/base) |

Nenhum remote aponta para outro destino. `origin` permanece o repo da Lia; `upstream` aponta para o AIRI.

---

## 3. Proveniência / estrutura adotada

### 3.1 Estrutura do repositório da Lia hoje (após esta etapa)

```
Lia-Project/                       (= repositório git da Lia)
├── AGENTS.md                      (master prompt do produto Lia — preservado)
├── README.md                      (visão + índices — preservado/atualizado)
├── DevKit.bat  devkit.json  tools/ (DevKit de git da Lia — preservado)
├── docs/
│   ├── estudo-airi.md             (estudo original do AIRI)
│   ├── architecture/
│   │   ├── AIRI-ANALYSIS.md       (Fase 0)
│   │   └── LIA-ARCHITECTURE.md    (Fase 0)
│   └── upstream/
│       └── AIRI-INTEGRATION.md    (este documento)
└── (futuro M0 na máquina real) fork AIRI v0.12.0-beta.5 + camada Lia
```

### 3.2 Modelo de integração escolhido (M0-A, confirmado)

- **Remote-model fork white-label:** `origin` = Lia; `upstream` = AIRI.
- **Fonte do AIRI NÃO é vendada neste repositório nesta etapa** (decisão do usuário): o source (~576 MB) será obtido/colocado na **máquina de desenvolvimento real**, conforme §5.
- **Customizações Lia futuras** devem ficar **isoladas/marcadas** e acima do core AIRI, com diffs mínimos (AGENTS §7); registros de integração em `docs/upstream/`.
- **`AGENTS.md` e a documentação/ferramentas da Lia são preservados** (não foram apagados/sobrescritos). O `AGENTS.md` raiz é o da **Lia**; o `AGENTS.md` interno do AIRI (345 linhas) coexistirá apenas dentro da árvore do AIRI quando ela for trazida (fork), e nunca substituirá o raiz da Lia.

### 3.3 Terceiros / licença (regra THIRD-PARTY ATTRIBUTION)

O AIRI é o primeiro projeto de terceiros adotado como base (aplicação futuramente distribuída). Registo mínimo aqui; detalhamento futuro em `docs/licenses/`:

| Campo | Valor |
|---|---|
| Nome | Project AIRI |
| Repositório oficial | https://github.com/moeru-ai/airi |
| Versão utilizada | `v0.12.0-beta.5` |
| Licença | **MIT** |
| Finalidade | runtime/base do produto Lia (companheiro virtual) |
| Redistribuição | Permitida sob MIT (manter aviso/créditos originais nos arquivos) |
| Attribution | Obrigatória (MIT) → registrar em README Credits + `docs/licenses/THIRD-PARTY-NOTICES.md` quando a base entrar |

---

## 4. Toolchain esperada (pinada pelo AIRI)

Verificada nos arquivos do tag (`package.json`, `.tool-versions`, `pnpm-workspace.yaml`):

| Ferramenta | Versão exigida | Onde declarado |
|---|---|---|
| Node.js | **26.7.0** | `.tool-versions` |
| pnpm | **11.24.0** (`packageManager`) | `package.json` |
| Gerenciador de runtime p/ Node | **mise** (lê `.tool-versions`) ou nvm alternativo | docs/estudo |
| Git | presente | — |

**Não adaptar para Node 22** apenas para "funcionar" neste sandbox. A toolchain pinada pelo AIRI (Node 26.7.0 + pnpm 11.24.0) é o alvo da máquina real.

Estrutura do monorepo AIRI (confirmada): `packages/**`, `plugins/**`, `integrations/**`, `services/**`, `examples/**`, `docs/**`, `engines/**`, `apps/**`, `server/**` (glob do `pnpm-workspace.yaml`). Orquestrador de tasks: `turbo`. Root package: `@proj-airi/root` v0.12.0-beta.5.

---

## 5. Comandos para a máquina de desenvolvimento real

> Estes comandos reproduzem o fluxo do M0 na máquina real (16 GB, Ryzen 5 5500). **Não foram executados aqui** por limitação do sandbox (§0). Ajustar conforme o S.O. (Windows/PowerShell vs bash).

### 5.1 Pré-requisitos
```bash
# git presente; instalar mise (leitor de .tool-versions) OU usar nvm
# Depois: Node 26.7.0 + corepack/pnpm 11.24.0
mise install            # lê .tool-versions → instala node 26.7.0
corepack enable         # ativa pnpm da packageManager
```

### 5.2 Obter o AIRI na versão correta (fork na máquina real)
```bash
# 1) clonar o repositório da Lia
git clone https://github.com/BloomRX/Lia-Project.git
cd Lia-Project

# 2) (se ainda não existirem) adicionar remotes
git remote add origin https://github.com/BloomRX/Lia-Project.git
git remote add upstream https://github.com/moeru-ai/airi

# 3) buscar e criar uma branch/baseline a partir do commit exato do AIRI
git fetch upstream tag v0.12.0-beta.5
# → resultado esperado: tag v0.12.0-beta.5 → commit 2c1e223c8dd813d7c74a324d7fd7399fbf47e8bf

# (estratégia de ingresso do source será definida no próximo milestone;
#  preservar histórico Git do AIRI quando viável, ex.: git merge --allow-unrelated-histories
#  ou abordagem subtree — decisão a documentar quando executarmos.)
```

### 5.3 Instalar dependências e validar base (na máquina real)
```bash
# na raiz do monorepo AIRI:
pnpm install                      # postinstall roda simple-git-hooks + build:packages
pnpm dev                          # stage-web (validação mais leve)
pnpm dev:tamagotchi               # desktop Electron (validação do app principal)
# Alternativa de validação só de build de um alvo:
pnpm build:web                    # build do app web
# checks
pnpm typecheck
pnpm lint
pnpm test:run                     # testes (mais pesado)
# desktop packaging
pnpm build:tamagotchi             # gera o app Electron do desktop
```

**Nota (Electron ≥42):** alguns comandos de dev do Electron exigem `install-electron` antes (`pnpm exec electron` provê o binário); o script dev costuma tratar isso.

---

## 6. Problemas encontrados / limitações do ambiente atual

| # | Problema/Limitação | Impacto | Tratamento |
|---|---|---|---|
| 1 | Sandbox tem **Node v22.22.3**; AIRI exige **Node 26.7.0** | build/typecheck inválido aqui | Não adaptar; rodar na máquina real (Node 26.7.0) |
| 2 | Sandbox **sem pnpm/mise** | pnpm 11.24.0 indisponível | Instalar via corepack na máquina real |
| 3 | Sandbox com **~3,8 GB RAM** | monorepo AIRI (49 packages) não builda | Build na máquina real (16 GB) |
| 4 | Source AIRI ~**576 MB / 5.332 arquivos**; clone pesado | acima do limite de persistência do sandbox | vendor adiado; obter na máquina real |
| 5 | Estudo dizia "48 pacotes"; real = **49** em `packages/` | apenas fato descritivo | corrigido aqui |
| 6 | `AGENTS.md` raiz = **Lia**; AIRI tem o próprio `AGENTS.md` interno | não podem colidir | manter o da Lia na raiz; o do AIRI fica dentro da árvore do fork |

---

## 7. O que precisará ser executado na máquina de desenvolvimento real (próximos passos)

1. Instalar Node 26.7.0 + pnpm 11.24.0 (§4).
2. Trazer o source AIRI na tag/commit confirmado (§5.2), preservando histórico Git do AIRI e mantendo `origin`/`upstream` (§2).
3. `pnpm install` e validar toolchain.
4. Executar builds/checks relevantes: `pnpm build:web`, `pnpm dev`, e idealmente `pnpm dev:tamagotchi` (desktop) para provar **"o AIRI original roda dentro do repositório da Lia"**.
5. Registrar o **resultado real do build** e quaisquer **problemas/alteracões necessárias** neste documento (ou em `AIRI-PATCHES.md`), atualizando o STATUS (§0) quando houver validação real.
6. Só então começar a colocar a camada **Lia** por cima (próximos milestones).

---

## 8. Critérios de sucesso do M0-A (definição de feito)

O M0-A está **verdadeiramente concluído** quando, **na máquina real**, for possível:

- [ ] Reproduzir o AIRI `v0.12.0-beta.5` (commit `2c1e223c…`) dentro do repositório da Lia;
- [ ] Rodar `pnpm install` sem erros na toolchain pinada;
- [ ] `pnpm typecheck` e `pnpm lint` verdes (ou com divergências documentadas);
- [ ] `pnpm build:web` (e idealmente `pnpm dev:tamagotchi`) concluídos;
- [ ] Resultado/limitações registrados neste documento; STATUS atualizado para validado.

> **Enquanto isso não ocorrer, o STATUS permanece:**
> **BOOTSTRAP DOCUMENTED — BUILD NOT VALIDATED IN SANDBOX**

---

## 9. Histórico de mudanças desta etapa

| Arquivo | Alteração |
|---|---|
| `AGENTS.md` | Adicionada a regra **§97 THIRD-PARTY ATTRIBUTION** (conforme ajuste de regras do usuário) |
| `docs/upstream/AIRI-INTEGRATION.md` | Criado (este documento) — registro do M0-A |
| Remotes (`git remote`) | Adicionado `upstream` → `moeru-ai/airi` |

Nenhum código do AIRI foi modificado, nenhuma UI da Lia criada, nenhum provider/Orchestrator/Voice Studio/installer implementado, e nenhuma dependência instalada nesta etapa.
