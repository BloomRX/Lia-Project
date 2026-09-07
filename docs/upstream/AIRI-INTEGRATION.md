# M0-A — AIRI Bootstrap / Baseline no repositório da Lia

> **Milestone:** M0-A (base AIRI reproduzível no repositório Lia)
> **Regras vigentes:** AGENTS.md completo, incl. **§97 THIRD-PARTY ATTRIBUTION** e **§98 INTERNATIONALIZATION**.
> **Objetivo provar:** "A base AIRI escolhida está corretamente integrada ao repositório da Lia e consegue ser instalada/buildada/executada no ambiente de desenvolvimento real."
> **Fora de escopo agora:** M1 e todo desenvolvimento da Lia (UI, i18n, personalidade, voz, memória, Discord, Vision, Computer Use, installer, provider routing, Voice Studio, branding, UX).

---

## 0. STATUS — M0-A

**M0-A COMPLETE (estrutura integrada) — BUILD AINDA NÃO VALIDADO NA MÁQUINA REAL**

O **source do AIRI foi vendado dentro do repositório** (método `git subtree --squash`, prefix `airi/`), os remotes estão corretos e a estrutura foi verificada. A **validação de instalação/build/execução** ainda precisa ser feita no **ambiente de desenvolvimento real** (Ryzen 5 5500 · RX 580 8 GB · 16 GB RAM), pois este ambiente de execução não possui Node 26.7.0/pnpm e não pode rodar o monorepo. Nada abaixo deve ser lido como "AIRI buildado/executado".

---

## 1. AIRI upstream, tag e commit (VALIDADO — sem divergência)

| Campo | Valor | Status |
|---|---|---|
| Versão/tag | `v0.12.0-beta.5` | VALIDADO |
| Tag object (annotated) | `6ea680f51486d257f9b0eeda3bdc25db4307d3bb` | VALIDADO |
| Commit alvo (peeled) | `2c1e223c8dd813d7c74a324d7fd7399fbf47e8bf` | VALIDADO |
| Release publicado | 2026-08-29 | VALIDADO |
| Licença | MIT (© 2024-PRESENT Neko Ayaka) | VALIDADO |

Divergência: **nenhuma**. Correção factual: estudo dizia "48 pacotes"; árvore real do tag = **49** em `packages/`.

---

## 2. Remotes (VALIDADO)

| Remote | URL | Papel |
|---|---|---|
| `origin` | https://github.com/BloomRX/Lia-Project.git | repositório da Lia |
| `upstream` | https://github.com/moeru-ai/airi | AIRI (fonte de verdade) |

Confirmado via `git remote -v`. O remote `upstream` permanece para `git fetch upstream` e atualizações futuras.

---

## 3. Método de integração (VALIDADO — integração feita)

**Método escolhido:** `git subtree add --squash`

**Comando executado (commit alvo = AIRI v0.12.0-beta.5):**
```
git subtree add --squash --prefix=airi 2c1e223c8dd813d7c74a324d7fd7399fbf47e8bf
```

**Motivo da escolha:**
- Mantém o source **fisicamente dentro do repositório da Lia** em `airi/`.
- `--squash` **não importa o histórico completo** do AIRI (~4.358 commits) para o `.git` da Lia — mantém o repo tratável (proveniência preservada pelo `upstream` + commit pinado documentado, não por histórico duplicado).
- Permite futuramente `git subtree pull` para atualizar o AIRI dentro do repo da Lia.

**Commits gerados (log):**
```
92acfe1d7 Merge commit '8cc304ec47104e536630ee82c5743afdfc01ac2e' as 'airi'
8cc304ec4 Squashed 'airi/' content from commit 2c1e223c8
```

**Estrutura final do repositório:**
```
Lia-Project/
├── airi/                  ← source completo do AIRI v0.12.0-beta.5 (5.332 arquivos)
├── docs/                  (architecture/, upstream/, licenses/ ...)
├── AGENTS.md              (master prompt da Lia — preservado)
├── README.md
├── DevKit.bat  devkit.json  tools/   (DevKit da Lia — preservado)
└── demais arquivos da Lia
```

---

## 4. Verificações pós-integração (VALIDADO)

| Verificação | Resultado |
|---|---|
| `git status` limpo após o subtree | ✅ limpo |
| Working tree | ~576 MB (source presente) |
| `.git` | ~524 MB (aceitável; sem histórico AIRI completo) |
| `airi/` contém a árvore esperada | ✅ 5.332 arquivos; raiz `@proj-airi/root` v0.12.0-beta.5 |
| Commit/tag corresponde ao AIRI | ✅ subtree squash a partir de `2c1e223c…`; tag `v0.12.0-beta.5` → `2c1e223c…` |
| `origin` correto | ✅ BloomRX/Lia-Project |
| `upstream` correto | ✅ moeru-ai/airi |
| Sem node_modules/build-gerado/caches/models/logs no commit | ✅ (ver §5) |

---

## 5. Proveniência / arquivos sensíveis (VALIDADO)

- **Nenhum** `node_modules`, `dist` gerado, cache, modelo de IA, log ou artefato de build **gerado por nós** entrou no commit.
- Alguns caminhos como `airi/**/.env` e `airi/apps/stage-tamagotchi/build/` **são parte do source upstream** (a tag `v0.12.0-beta.5` os versiona): são **templates vazios** (chaves placeholder, ex. `DISCORD_TOKEN=''`) e recursos de ícone/entitlements do electron-builder. Não contêm segredos reais. Foram preservados **intactos** para manter fidelidade/proveniência com o upstream (não foram gerados por nós e não devem ser removidos nesta fase).

---

## 6. Toolchain esperada (pinada pelo AIRI)

| Ferramenta | Versão exigida | Onde declarado |
|---|---|---|
| Node.js | **26.7.0** | `airi/.tool-versions` |
| pnpm | **11.24.0** | `airi/package.json` → `packageManager` |

**Não adaptar para Node 22/24.** A validação de build usa Node 26.7.0 + pnpm 11.24.0.

---

## 7. Procedimento de validação na máquina real (a executar)

> Executar **dentro da pasta raiz do monorepo AIRI**, ou seja, em `airi/`, **com a toolchain pinada**. Ajustar conforme S.O. (PowerShell vs bash). Este passo **ainda não foi executado/validado** (ver STATUS §0).

```bash
# 0) pré-requisito: Node 26.7.0 + pnpm 11.24.0 ativos
node -v        # esperado v26.7.0
pnpm -v        # esperado 11.24.0

# 1) dentro do source do AIRI (prefixo airi/)
cd airi

# 2) instalar dependências (postinstall roda simple-git-hooks + build:packages)
pnpm install

# 3) Electron ≥42: prover binário se o dev não o fizer
pnpm exec install-electron   # se necessário

# 4) checks e build
pnpm typecheck
pnpm lint
pnpm build:web               # build do app web (validação mais leve)

# 5) desktop/runtime (prova principal)
pnpm dev                     # executa stage-web
pnpm dev:tamagotchi          # desktop Electron (exige display/GPU no host)
```

**Resultados esperados de retorno para este registro:** installation result, typecheck result, lint result, build result, runtime result, problemas, warnings, tempo. Ainda **UNKNOWN** até execução real.

---

## 8. Como atualizar o subtree no futuro

```bash
# na raiz do repositório da Lia
git fetch upstream tag <nova-tag>            # ex.: v0.13.0
git subtree pull --squash --prefix=airi upstream <nova-tag>
```

**Como verificar a proveniência do source:**
```bash
git rev-parse v0.12.0-beta.5^{commit}        # → 2c1e223c8dd813d7c74a324d7fd7399fbf47e8bf
git log --oneline -- airi | head             # commits do subtree (squash merge)
git remote -v                                # origin=Lia, upstream=airi
```

---

## 9. Hardware-alvo / limitações

- **Ambiente real de dev/teste:** Ryzen 5 5500 · AMD RX 580 8 GB · 16 GB RAM. Fato de comportamento desse hardware: **UNKNOWN** até validação real (build/runtime). **Não** se cria solução específica para RX 580 nesta fase.
- **Limitações do ambiente de execução desta sessão:** sem Node 26.7.0/pnpm; ~3,8 GB RAM; headless (sem display/GPU/áudio). Por isso a validação de build fica para a máquina real.

---

## 10. Definition of Done — M0-A

| [ ] | Item | Estado |
|---|---|---|
| [x] | AIRI tag confirmada | VALIDADO |
| [x] | AIRI commit confirmado | VALIDADO |
| [x] | origin configurado | VALIDADO |
| [x] | upstream configurado | VALIDADO |
| [x] | source presente no repositório (subtree) | VALIDADO |
| [ ] | toolchain correta validada | NÃO VALIDADO (máquina real) |
| [ ] | dependencies instaladas | NÃO VALIDADO (máquina real) |
| [ ] | typecheck validado | NÃO VALIDADO |
| [ ] | lint validado | NÃO VALIDADO |
| [ ] | build validado | NÃO VALIDADO |
| [ ] | desktop/runtime validado | NÃO VALIDADO |
| [x] | documentação atualizada | VALIDADO |
| [x] | limitações documentadas | VALIDADO |

**Status: estrutura integrada e verificada; build/runtime pendentes de validação real.**

---

## 11. Histórico de mudanças

| Data | Arquivo/item | Mudança |
|---|---|---|
| 07/09/2026 | `airi/` (subtree) | Integrado AIRI v0.12.0-beta.5 (commit `2c1e223c…`) via `git subtree add --squash` |
| 07/09/2026 | `docs/upstream/AIRI-INTEGRATION.md` | Atualizado com método, estrutura, verificações e procedimento |

Nenhum código do AIRI foi modificado; nenhuma feature/UI/provider/installer da Lia foi iniciada; nenhuma dependência instalada nesta etapa.
