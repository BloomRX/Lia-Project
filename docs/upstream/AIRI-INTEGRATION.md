# M0-A — AIRI Bootstrap / Baseline no repositório da Lia

> **Milestone:** M0-A (base AIRI reproduzível no repositório Lia)
> **Regras vigentes:** AGENTS.md completo, incl. **§97 THIRD-PARTY ATTRIBUTION** e **§98 INTERNATIONALIZATION**.
> **Objetivo provar:** "A base AIRI escolhida está corretamente integrada ao repositório da Lia e consegue ser instalada/buildada/executada no ambiente de desenvolvimento real."
> **Fora de escopo agora:** M1 e todo desenvolvimento da Lia (UI, i18n, personalidade, voz, memória, Discord, Vision, Computer Use, installer, provider routing, Voice Studio, branding, UX).

---

## 0. STATUS — M0-A

**M0-A EM VALIDAÇÃO NA MÁQUINA REAL — instalação ✅ · typecheck 56/57 ⚠️ · build:web ✅ · runtime desktop ✅ · lint pendente**

- O source do AIRI está **vendado dentro do repositório** (`airi/`, `git subtree --squash`, commit `2c1e223c…`); remotes corretos.
- Validação **real** concluída na máquina de desenvolvimento (Ryzen 5 5500 · RX 580 8 GB · 16 GB RAM):
  - ✅ `pnpm install` **concluído** (2647 pacotes, postinstall ok, ~5m10s).
  - ✅ toolchain Node 26.8.1 + pnpm 11.24.0.
  - ⚠️ `pnpm typecheck` **56/57** — única falha isolada em `packages/stage-ui-live2d/.test.ts`, **já corrigida upstream** (`d8e62f12`, 30/08/2026).
  - ✅ `pnpm build:web` **concluído** — Tasks 22/22 successful, `✓ built in 44.27s`, PWA (681 entradas) gerado.
  - ✅ `pnpm dev:tamagotchi` **rodou** — main+preload+renderer do Electron buildados; **a janela do app abriu** (usuario confirmou); DI (`injeca`) inicializou todos os módulos/janelas/tray; `server-runtime` subiu em `ws://127.0.0.1:6121`; WebSocket com peers conectados. → **"O AIRI original roda dentro do repositório da Lia."**
  - ⏳ `pnpm lint` — **único item pendente** (não bloqueante para a conclusão da validação de baseline).

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

## 6. Toolchain (VALIDADO na máquina real)

| Ferramenta | Exigida | Real usada | Status |
|---|---|---|---|
| Node.js | 26.7.0 | **26.8.1** (canal current) | VALIDADO (linha Node 26; ver nota) |
| pnpm | 11.24.0 | **11.24.0** | VALIDADO |

**Nota de toolchain (honestidade):** o usuário instalou o binário oficial do canal *current* do Node, que publica **26.8.1** (patche/minor dentro do release-train 26; o `.tool-versions` do AIRI pina 26.7.0). Isto **não** é a divergência proibida (Node 22/24) — é Node 26, apenas um patch à frente. O `mise` também tem o `26.7.0` exato disponível (`mise exec -- node -v` = 26.7.0) caso seja necessário. pnpm `11.24.0` confere com o pinado.

---

## 7. Resultados de validação na máquina real (Ryzen 5 5500 · RX 580 · 16 GB)

### 7.1 Installation — `pnpm install` → **VALIDADO (SUCESSO)**
- **2647 pacotes** instalados; store em `J:\.pnpm-store\v11`.
- `postinstall` rodou: `simple-git-hooks` + `build:packages` → **32 tasks successful, 32 total** (~54s).
- `electron-builder install-app-deps` concluído (electron 43.4.1, native deps).
- Downloads de assets locais (MediaPipe tasks, etc.) concluídos.
- **Tempo:** ~5m10s.
- **Warnings (benignos):**
  1. `Failed to create bin ... arrow2csv / cap-vite / server-runtime ... ENOENT ... .EXE` — links `.bin` de pacotes cujos `dist/` são criados no `build:packages`; não impede instalação/build.
  2. `WARNING no output files found for @proj-airi/*#build` — pacotes sem step de build real ("No build step required"); aviso padrão do turbo.
  3. `Xcode version is below 26` no electron-builder — aviso de macOS aparecendo no Windows; inofensivo aqui.
  4. `Update available 11.24.0 → 12.3.4` — apenas sugestão do pnpm; mantemos 11.24.0 (pinado).

### 7.2 Typecheck — `pnpm typecheck` → **PARCIAL (56/57 passaram)**

**Resultado:** 56 de 57 projetos de workspace type-checkaram com sucesso. Falhou **apenas** `packages/stage-ui-live2d`, com 2 erros **em arquivo de teste** (não em código de produção):
```
packages/stage-ui-live2d typecheck: src/utils/live2d-zip-loader.test.ts(277,21): error TS2339: Property 'expressions' does not exist on type 'ModelSettings'.
packages/stage-ui-live2d typecheck: src/utils/live2d-zip-loader.test.ts(280,21): error TS2339: Property 'motions' does not exist on type 'ModelSettings'.
```

**Diagnóstico (não é problema do nosso ambiente):**
- O arquivo de teste está **idêntico ao upstream** no nosso baseline (`2c1e223c…`); o vendoring é fiel.
- `ModelSettings` vem de `pixi-live2d-display/cubism4` (lib externa `pixi-live2d-display@0.4.0`, patchada no repo). A tipagem dessa versão **não expõe** `.expressions`/`.motions` como o teste assume.
- `skipLibCheck: true` → o erro é do **uso no `.test.ts`**, não da lib.
- Trata-se de uma falha de tipagem real **dentro do baseline da tag beta** `v0.12.0-beta.5`.

**Verificação upstream — JÁ CORRIGIDO NO MAIN:**
- Commit **`d8e62f12` "fix(ci): remove incomplete release tests (#2407)"** no `main` do `moeru-ai/airi` (publicado 30/08/2026, **1 dia após** a nossa tag 29/08/2026) **removeu exatamente esse teste** (`-48` linhas em `live2d-zip-loader.test.ts`).
- No `main` atual, o arquivo **não usa mais** `settings.expressions`/`settings.motions` (as ocorrências restantes de "motions/expressions" são só literais de caminho `*.motion3.json`/`*.exp3.json`).
- **Conclusão:** é seguro e isolado portar essa correção (remoção de um teste incompleto) para o baseline, OU esperar uma release nova. Nada mais no repo depende dele.

### 7.3 Build web — `pnpm build:web` → **VALIDADO (SUCESSO)**
- `turbo run build -F @proj-airi/stage-web` · **Tasks: 22 successful, 22 total** (21 cached) · **Time: 1m31s**.
- `@proj-airi/stage-web:build` (vite 8.2.2): baixou/usou Cubism SDK + avatares VRM + fontes; `✓ 5171 modules transformed`; `✓ built in 44.27s`; PWA gerado (681 entradas, ~154 MB precache).
- Warnings (benignos/esperados): `inlineDynamicImports`/`external` deprecados; `[SOURCEMAP_BROKEN]` de unplugin-yaml; duckdb sourcemap fora do pacote; alguns chunks >500 kB. Nenhum erro.

### 7.4 Desktop / runtime — `pnpm dev:tamagotchi` → **VALIDADO (RODOU)**
- Electron main process + preload + renderer buildados; dev server em `http://localhost:5173/`.
- `starting electron app...` → DI (`injeca`) `PROVIDE` + `RUN` de todos os módulos/janelas: `windows:main`, `chat`, `settings`, `widgets`, `onboarding`, `tray`, `spotlight`, `editor`, `about`, `notice`, `caption`, `beat-sync`, `godot-stage-manager`, `mcp-stdio-manager`, `plugin-host`, `auto-updater`, `channel-server`, `server-runtime`, `artistry-bridge`, etc.
- `@proj-airi/server-runtime started on ws://127.0.0.1:6121` · `WebSocket server started` · peers conectados.
- **A janela do app abriu** (confirmado pelo usuário). Logs de sessão em `%APPDATA%\@proj-airi\stage-tamagotchi\logs\airi-tamagotchi-*.log`.
- Observação: auto-updater apontou para o feed do **upstream** (`github-release-lane:beta` → `moeru-ai/airi` v0.12.0-beta.5) — esperado no baseline; será redirecionado quando a Lia tiver identidade própria.
- Warnings (benignos): sourcemaps duckdb/arrow fora do pacote; unocss "unmatched utility"; `@proj-airi/plugin-sdk is working in progress`.

### 7.5 Lint — `pnpm lint` → **NÃO executado** (pendente, não bloqueante).

### 7.6 Resultado consolidado
| Validação | Resultado |
|---|---|
| `pnpm install` | ✅ VALIDADO |
| `pnpm typecheck` | ⚠️ 56/57 (falha isolada, corrigida upstream `d8e62f12`) |
| `pnpm build:web` | ✅ VALIDADO |
| `pnpm dev:tamagotchi` (runtime desktop) | ✅ VALIDADO (janela abriu) |
| `pnpm lint` | ⏳ pendente |

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
| [x] | toolchain correta | VALIDADO (Node 26.8.1 + pnpm 11.24.0) |
| [x] | dependencies instaladas | VALIDADO (pnpm install OK, 2647 pacotes) |
| [~] | typecheck validado | **PARCIAL — 56/57** (1 falha isolada em `.test.ts`, já corrigida upstream `d8e62f12`) |
| [~] | lint validado | NÃO EXECUTADO (pendente, não bloqueante) |
| [x] | build validado | VALIDADO (`pnpm build:web` — Tasks 22/22) |
| [x] | desktop/runtime validado | VALIDADO (`pnpm dev:tamagotchi` — janela abriu) |
| [x] | documentação atualizada | VALIDADO |
| [x] | limitações documentadas | VALIDADO |

**Status: AIRI original integrado, instalado, buildado e EXECUTADO dentro do repositório da Lia. O objetivo da M0-A ("o AIRI roda dentro do repo da Lia") está cumprido.** `pnpm lint` permanece pendente como item de saneamento, sem bloquear a conclusão do baseline.

---

## 11. Histórico de mudanças

| Data | Arquivo/item | Mudança |
|---|---|---|
| 07/09/2026 | `airi/` (subtree) | Integrado AIRI v0.12.0-beta.5 (commit `2c1e223c…`) via `git subtree add --squash` |
| 07/09/2026 | `devkit.json` | `airi/` em `ignore_dirs` (baseline vendado fora do escopo de validação/commit do DevKit) |
| 07/09/2026 | `docs/upstream/AIRI-INTEGRATION.md` | Atualizado com método, estrutura, verificações e procedimento |
| 07/09/2026 | `docs/upstream/AIRI-INTEGRATION.md` | Registrados resultados reais (install OK, typecheck 56/57, achado upstream `d8e62f12`) |
| 07/09/2026 | `docs/upstream/AIRI-INTEGRATION.md` | Registrados `build:web` OK (22/22) e `dev:tamagotchi` OK (janela abriu) → **baseline AIRI validado no runtime desktop** |

Nenhum código do AIRI foi modificado; nenhuma feature/UI/provider/installer da Lia foi iniciada; nenhuma dependência instalada nesta etapa.
