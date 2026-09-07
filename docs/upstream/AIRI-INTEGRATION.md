# M0-A — AIRI Bootstrap / Baseline no repositório da Lia

> **Milestone:** M0-A (base AIRI reproduzível no repositório Lia)
> **Data:** 07/09/2026 · **Branch:** `arena/01a07b6d-lia-project`
> **Regras vigentes:** AGENTS.md completo, incl. **§97 THIRD-PARTY ATTRIBUTION** e **§98 INTERNATIONALIZATION**.
> **Objetivo provar:** "A base AIRI escolhida está corretamente integrada ao repositório da Lia e consegue ser instalada/buildada/executada no ambiente de desenvolvimento real."
> **Fora de escopo agora:** M1 e todo desenvolvimento da Lia (UI, i18n, personalidade, voz, memória, Discord, Vision, Computer Use, installer, provider routing, Voice Studio, branding, UX).

---

## 0. STATUS — M0-A

**BOOTSTRAP DOCUMENTED — BUILD NOT VALIDATED**

Status permitido pela ETAPA 10, porque esta sessão roda em um ambiente **genuinamente incapaz** de instalar/buildar/executar o monorepo AIRI (detalhes na §8). Nada abaixo deve ser lido como validação de build/execução.

---

## 1. ETAPA 1 — Base AIRI confirmada (VALIDADO)

Revalidado nesta execução contra `https://github.com/moeru-ai/airi` via `git ls-remote`:

| Campo | Valor | Status |
|---|---|---|
| Versão/tag | `v0.12.0-beta.5` | VALIDADO |
| Tag object (annotated) | `6ea680f51486d257f9b0eeda3bdc25db4307d3bb` | VALIDADO |
| Commit alvo (peeled) | `2c1e223c8dd813d7c74a324d7fd7399fbf47e8bf` | VALIDADO |
| Release publicado | 2026-08-29 | VALIDADO |
| Licença | MIT (© 2024-PRESENT Neko Ayaka) | VALIDADO |

**Divergência:** **nenhuma.** Documentação e upstream concordam. Nenhuma troca silenciosa de versão/commit.

Correção factual registrada: o estudo citou "48 pacotes"; a árvore real do tag contém **49** entradas em `packages/`.

---

## 2. ETAPA 2 — Git / remotes (VALIDADO)

| Remote | URL | Papel | Status |
|---|---|---|---|
| `origin` | https://github.com/BloomRX/Lia-Project.git | repositório da Lia | VALIDADO |
| `upstream` | https://github.com/moeru-ai/airi | AIRI (fonte de verdade) | VALIDADO |

- O modelo preserva a **origem** (AIRI como `upstream`), permitindo futuramente `git fetch upstream` e comparação/merge.
- O histórico Git do AIRI **será preservado** quando o source entrar na máquina real (estratégia §5.2), de modo que o projeto não vira "cópia sem origem".

---

## 3. ETAPA 3 — Trazer o AIRI (NÃO VALIDADO — vendor adiado)

**Estratégia adotada (confirmada pelo usuário na execução anterior):**
- **Não** fazer vendor do source completo do AIRI (~576 MB / 5.332 arquivos; clone ~919 MB) **neste repositório/sandbox nesta etapa** (decisão explícita + limites de persistência do ambiente).
- O source real entra na **máquina de desenvolvimento real**, na tag/commit confirmados, **sem refactor** e **sem alterar** source, estrutura de packages/workspace, apps, services, plugins, integrations ou scripts.

| DoD (ETAPA 3) | Status |
|---|---|
| Source presente no repositório conforme estratégia | NÃO VALIDADO (na máquina real) |
| Preservar source / package structure / workspace / apps / packages / services / plugins / integrations / scripts | NÃO VALIDADO (aguarda ingresso) — nenhum arquivo foi tocado |
| Sem refactor | VALIDADO (nenhum código alterado) |

---

## 4. ETAPA 4 — Toolchain (NÃO VALIDADO no sandbox; bloqueada)

**Esperado / pinado pelo AIRI:** Node.js **26.7.0** (`.tool-versions`) e pnpm **11.24.0** (`packageManager`), via corepack/mise.

**Verificado neste ambiente:**

| Ferramenta | Necessária | Encontrada no sandbox | Observação |
|---|---|---|---|
| Node.js | 26.7.0 | **22.22.3** | indisponível |
| pnpm | 11.24.0 | **ausente** | indisponível |
| mise | (leitor de .tool-versions) | **ausente** | indisponível |
| npm | — | 10.9.8 | não substitui pnpm |

**Tentativa de instalação do Node 26.7.0 (ETAPA 4 — reportar se não instalável):** download do binário oficial `node-v26.7.0-linux-x64.tar.xz` de `nodejs.org` **falhou por erro SSL (curl exit 35)** — o host não é alcançável deste sandbox. Sem Node 26.7.0 e sem pnpm 11.24.0, e com **~3,8 GB de RAM**, a toolchain exigida **não pode ser instalada/executada aqui**.

**Regra respeitada:** NÃO adaptar para Node 22, NÃO usar outra versão para contornar. Per ETAPA 4: como a versão exigida não pode ser instalada neste ambiente, **paro e reporto o problema** (sem fingir instalação).

| DoD (ETAPA 4) | Status |
|---|---|
| Toolchain correta | NÃO VALIDADO no sandbox (Node 26.7.0 + pnpm 11.24.0 indisponíveis aqui) |

---

## 5. ETAPA 5 — Dependencies (NÃO VALIDADO)

`pnpm install` **não foi executado**: depende da toolchain da §4, que não existe neste ambiente. Não substituí pnpm por npm/yarn. Quando executado na máquina real, registrar comando, resultado, warnings, erros e tempo.

| DoD (ETAPA 5) | Status |
|---|---|
| Dependencies instaladas | NÃO VALIDADO (bloqueado pela toolchain; máquina real) |

---

## 6. ETAPA 6 — Validar AIRI original (NÃO VALIDADO)

Scripts reais confirmados no `package.json` raiz do tag (`@proj-airi/root`): `typecheck`, `lint`, `build:web`, `build:tamagotchi`, `dev:tamagotchi`, `test:run`, `build:packages`, `install-electron` (via scripts dev), etc. **Não inventei scripts.**

Nenhum destes foi executado/validado no sandbox (toolchain ausente). Todos ficam para a máquina real.

| DoD (ETAPA 6) | Status |
|---|---|
| typecheck validado | NÃO VALIDADO |
| lint validado | NÃO VALIDADO |
| build validado (build:web / desktop) | NÃO VALIDADO |
| desktop/runtime validado (dev:tamagotchi) | NÃO VALIDADO |

---

## 7. ETAPA 7 — Regra de baseline (VALIDADO)

Nenhuma customização da Lia foi iniciada: sem branding, Home, settings, personality, orchestrator, provider routing, Voice Studio, installer, nem UX. O AIRI permanece intacto.

---

## 8. ETAPA 8 / 10 — Ambiente atual e limitações

| # | Observação | Impacto |
|---|---|---|
| 1 | Sandbox **Node v22.22.3** (exige 26.7.0) | build inválido aqui |
| 2 | Sandbox **sem pnpm/mise** | pnpm 11.24.0 indisponível |
| 3 | Sandbox **~3,8 GB RAM** | monorepo (49 packages) não builda |
| 4 | Download do Node 26.7.0 de `nodejs.org` **SSL-bloqueado** (curl 35) | não é possível instalar toolchain aqui |
| 5 | Source ~576 MB / 5.332 arquivos | vendor adiado (persistência/estratégia) |
| 6 | **Sem GPU/áudio/display** (container headless Linux) | runtime desktop Electron e qualquer teste de hardware (RX 580 etc.) impossíveis aqui |

**Hardware-alvo registrado (ambiente real de dev/teste):** Ryzen 5 5500 · AMD RX 580 8 GB · 16 GB RAM. Nenhum fato de comportamento desse hardware pôde ser observado neste ambiente (headless) → **UNKNOWN** até execução real. **Não** se cria solução específica para RX 580 nesta fase; apenas se registram fatos quando houver.

---

## 9. Resultados por etapa (resumo VALIDADO / NÃO VALIDADO / UNKNOWN)

| Item | Status |
|---|---|
| AIRI tag `v0.12.0-beta.5` confirmada | VALIDADO |
| AIRI commit `2c1e223c…` confirmado | VALIDADO |
| `origin` configurado (Lia) | VALIDADO |
| `upstream` configurado (moeru-ai/airi) | VALIDADO |
| Source presente no repositório | NÃO VALIDADO (máquina real) |
| Toolchain correta (Node 26.7.0 + pnpm 11.24.0) | NÃO VALIDADO (indisponível no sandbox) |
| Dependencies instaladas | NÃO VALIDADO |
| typecheck | NÃO VALIDADO |
| lint | NÃO VALIDADO |
| build (web/desktop) | NÃO VALIDADO |
| desktop/runtime (dev:tamagotchi) | NÃO VALIDADO |
| Documentação atualizada | VALIDADO |
| Limitações documentadas | VALIDADO |
| Comportamento em Ryzen 5 5500 / RX 580 / 16 GB | UNKNOWN (sem execução real) |

---

## 10. Comandos exatos — procedimento executável na máquina real

> Reproduz o M0-A no ambiente de desenvolvimento real (16 GB, Ryzen 5 5500). Rodar **sem** pular a toolchain. Ajustes conforme S.O.

### 10.1 Toolchain
```bash
# Linux/macOS (bash)
curl -fsSL https://mise.jdx.dev/install.sh | sh   # ou use nvm
mise install                # lê .tool-versions → instala Node 26.7.0
mise use node@26.7.0        # garante a versão no PATH
corepack enable             # ativa pnpm da packageManager
node -v && pnpm -v          # esperado: v26.7.0 e 11.24.0

# Windows (PowerShell, recomendado via mise/nvm-windows)
#  winget install Node 26.7.0  ;  corepack enable  ;  corepack pnpm@11.24.0 activate
```

### 10.2 Trazer o AIRI (preservando histórico)
```bash
git clone https://github.com/BloomRX/Lia-Project.git
cd Lia-Project
git remote add origin https://github.com/BloomRX/Lia-Project.git   # se ausente
git remote add upstream https://github.com/moeru-ai/airi           # se ausente

git fetch upstream tag v0.12.0-beta.5
# confirmar:  tag v0.12.0-beta.5  →  commit 2c1e223c8dd813d7c74a324d7fd7399fbf47e8bf
git rev-parse v0.12.0-beta.5^{commit}
```
**Estratégia de ingresso do source (preservar histórico):** uma das opções abaixo, a definir no commit de execução e registrada aqui:
- **merge sem histórico comum** (`git merge --allow-unrelated-histories FETCH_HEAD`) criando uma branch de baseline `airi-baseline-v0.12.0-beta.5`; ou
- abordagem **subtree** (`git subtree add --squash` não preserva histórico) — **evitar** se a prioridade for histórico; preferir a opção de merge/rebase.
Documentar a opção escolhida e o diff/marcações quando executar.

### 10.3 Instalar dependências e validar
```bash
pnpm install                 # postinstall: simple-git-hooks + build:packages
pnpm exec install-electron   # necessário p/ Electron ≥42 (se o dev não o fizer)
pnpm typecheck
pnpm lint
pnpm build:web               # validação de build leve (web)
pnpm dev                     # executa stage-web
# Desktop/runtime (prova principal):
pnpm dev:tamagotchi          # desktop Electron (exige display/GPU no host)
# opcional, mais pesado:
pnpm test:run
pnpm build:tamagotchi        # packaging do desktop
```

---

## 11. Próximos passos / handoff

1. **Aguardar execução do usuário** na máquina real seguindo §10.
2. Quando o usuário retornar **logs/resultados** (ETAPA 11): analisar, identificar falhas, corrigir **somente** problemas necessários e atualizar este documento (installation/typecheck/lint/build/runtime results, warnings, problemas, tempo).
3. Atualizar STATUS (§0) para **M0-A COMPLETE** somente após validação real com execução.
4. **Não avançar para M1 (Lia Shell)** até o baseline estar validado.

---

## 12. Definition of Done — M0-A

| [ ] | Item | Estado atual |
|---|---|---|
| [x] | AIRI tag confirmada | VALIDADO |
| [x] | AIRI commit confirmado | VALIDADO |
| [x] | origin configurado | VALIDADO |
| [x] | upstream configurado | VALIDADO |
| [ ] | source presente no repositório | NÃO VALIDADO |
| [ ] | toolchain correta | NÃO VALIDADO |
| [ ] | dependencies instaladas | NÃO VALIDADO |
| [ ] | typecheck validado | NÃO VALIDADO |
| [ ] | lint validado | NÃO VALIDADO |
| [ ] | build validado | NÃO VALIDADO |
| [ ] | desktop/runtime validado | NÃO VALIDADO |
| [x] | documentação atualizada | VALIDADO |
| [x] | limitações documentadas | VALIDADO |

---

## 13. Histórico de mudanças

| Data | Arquivo / item | Mudança |
|---|---|---|
| 07/09/2026 | `docs/upstream/AIRI-INTEGRATION.md` | Criado (registro inicial M0-A) e expandido para matriz de resultados/ETAPAS |
| 07/09/2026 | `git remote` | `upstream` → `https://github.com/moeru-ai/airi` |
| 07/09/2026 | `AGENTS.md` | §§97 (third-party) e 98 (i18n) adicionadas (execuções anteriores) |

Nenhum código do AIRI foi modificado; nenhuma UI/providers/orchestrator/Voice Studio/installer/i18n da Lia foi iniciado; nenhuma dependência instalada nesta etapa.
