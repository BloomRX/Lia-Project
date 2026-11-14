# Lia-Project — Relatório de QA e validação (ambiente Linux do Arena)

**Execução:** 14/11/2026 (UTC), ~03:30–04:20
**Branch local sob teste:** `arena/18f50ae7-lia-project` (sem commits novos; somente este relatório e sua evidência foram adicionados)
**SHA exato testado:** `7cb81720552a822a03f36ac6ce5f2e20b009f84c` (HEAD; shallow clone, `git rev-list --count HEAD` = 1; `git fsck --connectivity-only` exit 0)
**Base declarada da sessão:** branch `arena/01a10290-lia-project`, SHA `7cb81720552a822a03f36ac6ce5f2e20b009f84c` — confirmado idêntico ao HEAD local.
**Resultado geral:** 5.651 testes PASS em automação Linux, 18 skipped, **0 falhas de teste**. Dois portões vermelhos/bloqueados fora dos testes (lint: 81 erros; build do renderer do Stage e projetos de browser: bloqueados por rede do sandbox). **Nenhum gate de runtime/UI foi exercido — a Lia continua NÃO aprovada ponta a ponta.**

Restrições respeitadas: a branch principal (`main` = `9c7ac183…`) não foi tocada; nenhuma implementação foi alterada (apenas documentação e evidências adicionadas); nenhum arquivo ou evidência foi apagado; nenhum resultado foi inventado — o que não pôde ser executado está marcado **NOT RUN**, **BLOCKED** ou **FAIL** com o motivo e a evidência.

---

## 0. Resumo executivo

| # | Item | Resultado |
|---|------|-----------|
| 1 | Suítes Python do DevKit/CI (`compileall`, `test_project_cli`, `test_creation`, `test_lia_dev`, `test_agent_skills`) | **PASS** — 498 testes, 12 skipped (Windows-only) |
| 2 | `lia/core` (@lia/contracts), `lia/launcher`, `lia/stage` (Node `--experimental-strip-types`) | **PASS** — 105 + 8 + 9 testes |
| 3 | `Tests/tools/*.test.mjs` (Node `--test`) | **PASS** — 275 testes (77 suites) |
| 4 | `airi/packages/lia-core` (@lia/core) build + `vitest run` + typecheck | **PASS** — 381 testes; `vue-tsc`/`tsc` exit 0 |
| 5 | `airi/packages/core-agent` (vitest `--project @proj-airi/core-agent`) | **PASS** — 156 testes (igual à baseline Windows 156) |
| 6 | `airi/apps/lia-app` (Launcher) `vitest run` + `typecheck` + `build` | **PASS** — 353 testes + 2 skipped; build produziu `out/main/index.js`, `out/preload/index.cjs`, renderer |
| 7 | `airi/apps/stage-tamagotchi` **projeto node** (`--project node`) | **PASS** — 204 arquivos, 2.498 testes + 1 skipped (primeira execução: 27 arquivos FAIL por binário Electron ausente — ver §3.1) |
| 8 | `airi/apps/stage-tamagotchi` alvo AF-1b (5 arquivos) e `oidc-link.test.ts` | **PASS** — 13 e 30 testes (dentro da suíte) |
| 9 | `airi/packages/stage-ui` **projeto node** | **PASS parcial** — 154 arquivos, 1.140 testes PASS, **exit 1** por 1 rejeição não tratada (`updateCredits` → `api.airi.build` ECONNRESET) — §3.2 |
| 10 | `airi` (raiz) `pnpm lint` | **FAIL** — oxlint: 0 erros/10 avisos; eslint: **81 erros** (exit 1) — §3.3 |
| 11 | Stage `vue-tsc --noEmit` | **PASS** exit 0 (após `build:packages`; antes OOM no heap padrão e 15× TS2307 sem os `dist`) — §3.4 |
| 12 | Stage `pnpm run build` (`electron-vite build`) | **PARCIAL/BLOCKED** — main e preload PASS; **renderer BLOCKED** (`dist.ayaka.moe` inalcançável) — §4.1 |
| 13 | Stage `--project browser` e browser do stage-ui (29 arquivos no total) | **BLOCKED** — `cdn.playwright.dev` ECONNRESET — §4.2 |
| 14 | `scripts/provider-runtime-electron` (lib + gate-integrity) | **PASS** — 148 testes (o gate Electron completo permanece Windows-only) |
| 15 | Electron real (Launcher/Stage), `Lia.bat`, empacotamento NSIS, prova de runtime | **NOT RUN / BLOCKED** — sem display nem libs GUI no Linux do Arena — §4.3, §6 |
| 16 | Kokoro TTS / STT real / GPU / múltiplos monitores / instalação limpa | **BLOCKED/NOT RUN** — rede e hardware — §4, §6 |

**Leitura honesta:** o núcleo automatizado do projeto está saudável no Linux (5.651 PASS). Os buracos são exatamente os de sempre, agora com evidência fresca: (i) nenhuma prova de runtime real do Launcher/Stage; (ii) o portão de lint está vermelho neste SHA; (iii) o build do Stage depende de um host de terceiros (`dist.ayaka.moe`) inalcançável fora da rede autorizada; (iv) o portão de browser não roda sem `playwright install` alcançável; (v) `arena/01a10290-lia-project` avançou para `5ec464e…` no remoto — este relatório cobre apenas `7cb8172…`.

---

## 1. Matriz de testes

Ambiente de execução: Linux 6.1.158 x86_64, Node v22.22.3, npm 10.9.8, Python 3.11.2, pnpm 11.24.0 (via `corepack`, `packageManager` do repo). **Nenhum teste foi marcado PASS sem execução.**

### A. Executáveis no Linux do Arena (executados — ver §2)

| ID | Área | Comando (cwd) | Suíte/arquivos | Resultado |
|----|------|---------------|----------------|-----------|
| L-01 | DevKit/CI — byte-compile | `python -m compileall -q tools` | tools/ | PASS |
| L-02 | DevKit — CLI universal | `python tools/ci_run_suite.py tools/test_project_cli.py` | 33 | PASS |
| L-03 | DevKit — criação de repo | `python tools/ci_run_suite.py tools/test_creation.py` | 23 | PASS |
| L-04 | DevKit — DevFlow | `python tools/ci_run_suite.py tools/test_lia_dev.py` | 435 (+12 skip) | PASS |
| L-05 | Skills de agente | `python tools/ci_run_suite.py tools/test_agent_skills.py` | 7 | PASS |
| L-06 | STT bench (stubs) | `python -m unittest discover -s tools/stt-bench/tests` | 70 (+2 skip) | PASS |
| L-07 | Alethe budget | `python Tests/tools/alethe-budget.test.py` | 10 (+1 skip) | PASS |
| L-08 | Contratos Lia (seleção, transporte, ciclo de vida, presença, protocolo) | `node --experimental-strip-types --test "lia/core/test/*.test.ts"` | 105 (9 arq.) | PASS |
| L-09 | Launcher — decisão de alvo do Stage | `node --experimental-strip-types --test "lia/launcher/test/*.test.ts"` | 8 | PASS |
| L-10 | Stage — host do Stage | `node --experimental-strip-types --test "lia/stage/test/*.test.ts"` | 9 | PASS |
| L-11 | QA harness (backup/restore, logs, storage, .bat, gitignore) | `node --test "Tests/tools/*.test.mjs"` | 275 (77 suites) | PASS |
| L-12 | Build de pacotes (prerequisito) | `pnpm run build:packages` (airi/) | 33 tasks turbo | PASS |
| L-13 | core-agent | `pnpm --filter @proj-airi/core-agent run build` → `pnpm exec vitest run --root packages/core-agent --project @proj-airi/core-agent` | 156 | PASS |
| L-14 | @lia/core (voice/product/brain/secrets/vault) | `pnpm run build` + `vitest run` + `pnpm run typecheck` (airi/packages/lia-core) | 381 (31 arq.) | PASS |
| L-15 | **Launcher** (`@lia/lia-app`): Main, IPC, selection authority, interlock, shutdown | `pnpm exec vitest run` + `pnpm run typecheck` + `pnpm run build` (airi/apps/lia-app) | 353 + 2 skip (36 arq.) | PASS |
| L-16 | **Stage** (`@proj-airi/stage-tamagotchi`) — Main/Renderer/Shared (projeto node) | `pnpm exec vitest run --config vitest.config.ts --project node` com `ELECTRON_OVERRIDE_DIST_PATH=/tmp/electron-override` | 2.498 + 1 skip (204 arq.) | PASS* |
| L-17 | Stage — regressões AF-1b/sandbox direcionadas (comando oficial) | `pnpm exec vitest run --config vitest.config.ts <5 arquivos>` | 13 | PASS |
| L-18 | Stage — `oidc-link.test.ts` (reteste do flake PROMPT-43) | dentro da suíte node; PASS 30 | 30 | PASS |
| L-19 | stage-ui (store de chat Lia, send-error, failover) — projeto node | `pnpm exec vitest run --config vitest.config.ts --project node` (airi/packages/stage-ui) | 1.140 (154 arq.) | PASS parcial (exit 1) — §3.2 |
| L-20 | Stage Electron gate — libs auditáveis (sem Electron host) | `node --test lib/*.test.mjs gate-integrity.test.mjs` (…/provider-runtime-electron) | 148 | PASS |
| L-21 | Stage — typecheck | `pnpm exec vue-tsc --noEmit` (airi/apps/stage-tamagotchi) com `NODE_OPTIONS=--max-old-space-size=3072` | — | PASS exit 0 |
| L-22 | Launcher/Stage — build | `pnpm run build` (lia-app) **PASS**; `pnpm run build` (stage-tamagotchi) **PARCIAL** (main+preload PASS, renderer BLOCKED) | — | §4.1 |
| L-23 | Lint do monorepo | `pnpm lint` (airi/) | 3.490 arquivos | **FAIL** — §3.3 |

\* L-16: o binário do Electron não pôde ser baixado neste sandbox (`release-assets.githubusercontent.com` inalcançável). Foi usado o seam oficial do pacote `electron` (`ELECTRON_OVERRIDE_DIST_PATH`) somente para a resolução de path no `require('electron')`; nenhum dos 2.498 testes executa o binário (IPC mockado). Detalhe e primeira execução vermelha em §3.1.

### B. Que exigem Windows — encaminhar ao Codex (NÃO executados aqui)

| ID | Item | Motivo | Status prévio conhecido |
|----|------|--------|------------------------|
| W-01 | Boot real por `Lia.bat` (build, janela, `lia-app.renderer-ready`) | Electron + Windows | PROMPT-40/42 abriram janela; fluxos reais NOT RUN |
| W-02 | Stage real integrado ao Launcher pelo botão "Conversar com Lia" | Electron, display | NOT RUN (nunca provado ponta a ponta) |
| W-03 | `Tests\LiaTests.bat` opções 2–4 (instalação isolada, restore, ACTIVE marker) | Windows + máquina de dev | harness testado estaticamente (L-11); runtime não |
| W-04 | `Tests\LiaBenchmark.bat` / `Tests\tools\qa-benchmark.mjs` completo (publica em `qa/windows-benchmarks`) | Windows + rede + repo | nunca executado ponta a ponta nesta base |
| W-05 | `Tools\stt-bench\run-stt-bench.*` | Windows + faster-whisper | core Python PASS (L-06) |
| W-06 | `scripts/provider-runtime-electron/gate.test.mjs` (gate Electron + fixture HTTP local, tabela de processos via PowerShell) | `powershell.exe`, `windowsHide`, Electron real | PROMPT-31/43: PASS no Windows; ausente aqui |
| W-07 | Gate `oidc-electron` (`scripts/oidc-electron/`) | **não existe neste checkout** (era untracked na worktree Windows do PROMPT-43/44) | impossível executar — arquivo ausente |
| W-08 | `airi/apps/lia-app/scripts/package-windows.mjs` (NSIS) + instalação limpa/atualização/desinstalação | Windows + instalador | NÃO EXECUTADO em nenhuma rodada |
| W-09 | CI `devflow-ci.yml` metade `windows-latest` | Runner Windows | configurado; aqui só a metade Linux foi replicada |
| W-10 | `test_lia_dev.py` — 12 testes Windows-only | junction/symlink/pskill | skipped por design (visíveis no log L-04) |
| W-11 | Fechamento gracioso + zero órfãos (tabela de processos real) | Windows | prompts anteriores: encerramento ok no boot, orphans não medidos de forma integrada |
| W-12 | Assinatura Authenticode + verificação | Windows + certificado (inexistente) | investigado, nunca executado |
| W-13 | `DevKit.bat` interativo (menu, wizard de primeiro cadastro, fluxo real de `git push`) | Windows interativo | lógica Python coberta por L-02/L-03/L-04 |

### C. Que exigem hardware específico (NÃO executáveis em nenhum CI atual)

| ID | Item | Motivo |
|----|------|--------|
| H-01 | Kokoro TTS real (`tools/kokoro-smoke.mjs`) — instalar engine, síntese, WAV, RTF | rede p/ `huggingface.co`/`cdn.jsdelivr.net` bloqueada aqui + áudio/CPU-AVX real; nunca validado contra esta base |
| H-02 | STT real (mic → transcrição → cancelamento) | microfone físico + dispositivos |
| H-03 | RX 580 / Live2D — render, avatar, animações, DPI, múltiplos monitores (incl. segundo monitor) | GPU física; relatórios anteriores citam apenas adaptador virtual Parsec |
| H-04 | Hotplug/resolução/escala, jogos borderless/exclusivo, click-through, foco | sessões interativas com hardware |
| H-05 | Coleta de 1h (`--soak-seconds=3600`) com pacote real | sessão longa interativa Windows |

---

## 2. Resultados executados (evidência por teste)

Evidência bruta (33 arquivos) em `docs/reports/evidence/LIA-QA-VALIDATION-2026-11-14/` (logs `.log` de cada suíte + `00-environment.txt`). Nenhum segredo real consta neles; a única ocorrência de padrão `gsk-…` é o fixture sintético de `hearing.test.ts` (`gsk-ABCDEFGHIJKLMNOP1234567890`, usado por um teste que afirma que a chave NÃO vaza nos logs) — verificado no source.

Destaques por área de escopo:

- **Testes unitários e de integração:** ver L-02…L-20. Total único: **5.651 PASS / 18 skipped / 0 FAIL**. A suíte Stage completa do projeto node (L-16) passou em 2ª execução — ver §3.1.
- **Builds:** `core-agent`, `@lia/core`, `@lia/lia-app`, `build:packages` (33 tasks) → PASS. Stage: main+preload PASS, renderer BLOCKED (§4.1). `vue-tsc` Stage exit 0 (L-21).
- **Typechecks:** `@lia/core` PASS; `@lia/lia-app` PASS; Stage PASS (com override de heap). Typecheck da raiz (`pnpm typecheck` monorepo) **NOT RUN** — ver §4.6.
- **Launcher e inicialização:** lógica de boot/alvo/prerequisitos/interlock coberta por L-15/L-09/L-13 (353+8+156 PASS). **Boot real NOT RUN** (Windows, W-01).
- **Main e Renderer:** unit/integração PASS (IPC surface, security-baseline, runtime-boundary, selection authority, shutdown-coordinator: `shutdown-coordinator.test.ts` 7/7). **Electron real NOT RUN** (Linux sem GUI; §4.3).
- **Stage e renderização:** node project PASS (L-16); browser project BLOCKED (§4.2); render real NOT RUN (H-03).
- **Conversação e histórico:** `stage-ui` chat contracts + `chat-voice-pipeline`, `memory-chat`, `managed-chat-startup`, `first-send-credential` etc. PASS (1.140 + componente em L-16). Persistência após reinício real **NOT RUN**.
- **Seleção e configuração de provedores:** `provider-config-service`, `transport-config/execution`, `model-discovery`, `native-provider-*`, `provider-validation`, `selection-write-policy`, `ai-selection-*` PASS. **Chamada real a provedor externo NOT RUN** (sem credencial; e `api.groq.com` alcançável só no Windows validado anteriormente — aqui TLS trava).
- **Memória e persistência:** `memory-service`, `presence-service`, `memory-chat`, `vault-write/backup/process` PASS. **Reabertura com perfil real NOT RUN** (W-01/W-04).
- **TTS e STT:** engines com mocks PASS (`kokoro/engine|install|layout|smoke.test.ts`, `voice-service`, `transcription-*`); `stt-bench` core PASS. **Engine/real device BLOCKED** (H-01/H-02; rede).
- **Autenticação e credenciais:** vault + owner-channel + credential-owner-host + oidc-unit (link/session/http/sockets) PASS; `oidc-link.test.ts` 30/30 (reteste OK neste SHA em checkout limpo). **Login real NOT RUN**; histórico de flake em §5.2.
- **IPC e comunicação entre processos:** `ipc-surface` (7/7), `ipc-channel-policy`, `preload/shared`, `host-contract` PASS. IPC real em Electron **NOT RUN** (§4.3).
- **Encerramento e limpeza:** `shutdown-coordinator` (7/7), `single-instance` (2/2), libs do gate Electron (148) PASS; boot/close real com verificação de órfãos **NOT RUN** (W-11).
- **Regressões pós-reinicialização:** **NOT RUN** (nenhuma rodada nesta base; exige Windows + empacotamento).

---

## 3. Falhas encontradas

### 3.1 Stage — primeira execução: 27 arquivos FAIL (causa ambiental, resolvida para evidência)

Na 1ª execução (`--project node`, sem `ELECTRON_OVERRIDE_DIST_PATH`): **27 arquivos FAIL / 177 PASS**, todos com a mesma causa: `Error: Electron failed to install correctly` — o pacote `electron` (43.4.1) não tem binário porque a instalação usou `--ignore-scripts` (ver §3.5) e o download (`github.com/.../releases/download/...`) redireciona para `release-assets.githubusercontent.com`, **inalcançável** neste sandbox (`SSL_ERROR_SYSCALL`; testado via `curl -L`). Os arquivos afetados são majoritariamente os que transitam por `@proj-airi/electron-vueuse`/fixtures nos mocks (ex.: `oidc-link.test.ts`, `transport-configuration.test.ts`, `hearing.test.ts`).

**Correção de ambiente (sem tocar no repo):** `ELECTRON_OVERRIDE_DIST_PATH=/tmp/electron-override` — seam documentado do próprio pacote `electron` que faz `require('electron')` resolver um path sem rede e **sem executar binário**. Rerodado: **204/204 arquivos, 2.498 testes PASS, 1 skipped** (`23-test-stage-node-PASS.log`). Registro honesto: **o binário do Electron jamais foi executado aqui**; a alegação "verde" vale para a lógica, não para o runtime.

### 3.2 stage-ui — exit 1 com 1.140/1.140 testes PASS (1 rejeição não tratada)

`src/stores/auth.ts` (`updateCredits` → `client.api.v1.flux.$get()`) dispara fetch real para **`api.airi.build`** quando `isAuthenticated` vira verdadeiro; em `provider.test.ts` a promise flutuante rejeita com `ECONNRESET` e o Vitest marca **Unhandled Rejection** ("Errors 1 error"), retornando **exit 1** mesmo com zero testes falhos. Nenhum log contém credencial. **Achado de higiene de teste** (fetch externo não stubbed dentro de suíte unitária): em máquinas sem rede para `api.airi.build` o portão fica vermelho sem falha de teste; em máquinas com rede, a suíte faz chamada real ao serviço AIRI em contexto de teste. Não corrigido (fora do escopo de QA; requer autorização).

### 3.3 `pnpm lint` (raiz do monorepo) — FAIL com 81 erros eslint

Fase oxlint (moeru-lint/oxlint): **0 erros, 10 avisos** (ex.: `unicorn/no-new-array`, `eslint(no-control-regex)` intencional em `transport-execution-service.ts:67`, `unicorn/no-useless-spread`). Fase eslint: **81 erros**, 59 auto-fixáveis. Distribuição: `perfectionist/sort-imports` 22, `no-restricted-syntax` 16, `style/quotes` 11, `test/no-import-node-test` 8, `test/prefer-lowercase-title` 5, `regexp/no-unused-capturing-group` 3, `import/consistent-type-specifier-style` 3, `style/max-statements-per-line` 2, e 11 regras com 1 ocorrência cada (entre elas `node/prefer-global/process`, `perfectionist/sort-named-imports`, `vue/no-useless-v-bind`, `jsonc/sort-keys`, `antfu/curly`, `import/first`, `style/arrow-parens`). Concentração: `scripts/provider-runtime-electron/**` (o gate Lia deliberadamente usa `node:test` e extensões `.mjs` — conflito de política de lint, não defeito funcional), janelas/serviços Lia do Stage (`src/main/windows/*/index.ts`, `preload/shared.ts` — `node/prefer-global/process`), e `apps/lia-app/**`.

**Nenhum ciclo PROMPT-4x executou `pnpm lint`** (não consta dos comandos documentados); o harness `qa-benchmark.mjs` (passo `lint`) registra `errors/warnings` como métrica. Este é um portão vermelho **novo e não tratado** no SHA testado. Sob o gate do benchmark, o passo sai "failed". Decisão necessária: escopo de lint para scripts de QA (`.mjs` com `node:test`) e `--fix` para os mecânicos.

### 3.4 Stage typecheck — duas armadilhas de ambiente antes do PASS

1. `pnpm exec vue-tsc --noEmit` com heap padrão → **FATAL ERROR: JavaScript heap out of memory** (Node v22.22.3; caixa com 2 vCPU/4 GiB). Windows (Node v26.8.1) passou. Não é defeito de código; é sensibilidade de memória.
2. Com heap 3072 MB: **15× TS2307** (`@proj-airi/server-sdk`, `@proj-airi/i18n/locales`, `@proj-airi/audio/encoding`, `@proj-airi/server-sdk-shared`…) — workspace `dist` ausente porque a instalação usou `--ignore-scripts`. Após `pnpm run build:packages` (**33 tasks turbo, exit 0**): **exit 0**. Ordem de validação obrigatória em checkout fresco: `build:packages` **antes** do typecheck do Stage.

### 3.5 Divergência do caminho documentado de instalação

`Lia.bat` e `Tests/README.md` mandam instalar com `cd airi && pnpm install`. O `postinstall` da raiz é `pnpm exec simple-git-hooks && pnpm run build:packages`. Inspeção estática de `simple-git-hooks@2.13.1` (`simple-git-hooks.js`): sem `airi/.git`, `_getHooksDirPath(cwd=airi/)` retorna `airi/.git/hooks` (o repo não define `core.hooksPath`), que **não existe** → o instalador faz `mkdirSync('airi/.git/hooks', {recursive:true})` e escreve `pre-commit` com `pnpm nano-staged`. Ou seja, o caminho documentado cria um **`.git` falso dentro de `airi/`** no layout de subtree deste repositório (git dentro de `airi/` passaria a operar num repositório vazio). Não foi executado aqui (a instalação usou `--ignore-scripts` propositalmente); a verificação foi por leitura do código do instalador. O repo raiz tem `.git/hooks/commit-msg` próprio, que **não** seria sobrescrito no cenário default (hooks escritos sob `airi/.git`), mas viraria `airi/.git/hooks/pre-commit` — poluente e confuso. Recomendação: documentar `--ignore-scripts` + `pnpm -F @lia/core build && pnpm --filter @proj-airi/core-agent run build && pnpm run build:packages` como instalação suportada, ou adaptar o `postinstall` ao layout subtree.

---

## 4. Testes bloqueados e motivos

| ID | Item | Bloqueio | Evidência |
|----|------|----------|-----------|
| 4.1 | Stage `pnpm run build` — **renderer** (`electron-vite build`) | `@proj-airi/unplugin-fetch` busca `https://dist.ayaka.moe/live2d-models/hiyori_free_zh.zip` (+ `hiyori_pro_zh.zip`, `AvatarSample_A/B.vrm`, Cubism SDK). Host **inalcançável**: `ECONNRESET` no build; `curl -r 0-100` retorna `000`. Main (`out/main/index.js` 2.49 MB) e preload (`out/preload/index.cjs` 2.49 kB) **compilaram** | `17-build-stage-main-preload-ok-renderer-BLOCKED.log`; `airi/.cache` ausente; assets em `packages/stage-ui/src/assets/live2d|vrm` contêm apenas previews (~256 KB), não os modelos |
| 4.2 | `--project browser` (stage-tamagotchi: 9 arquivos; stage-ui: 20) | Playwright Chromium ausente (`~/.cache/ms-playwright` inexistente); `pnpm exec playwright install chromium` → `ECONNRESET` em `cdn.playwright.dev` (curl `000`). Windows: suíte browser com ~59 testes passou (2.557−2.498) | `25-test-stage-browser-BLOCKED.log`, `29-playwright-install-BLOCKED.log` |
| 4.3 | Qualquer prova de runtime Electron (Launcher, Stage, overlays) | **Linux do Arena sem libs GUI**: `ldconfig -p` → 0 ocorrências de `libgtk-3|libnss3|libasound|libgbm`; sem Xorg/Xvfb; binário Electron nem existe (§3.1) | §1-C, `00-environment.txt` |
| 4.4 | `tools/kokoro-smoke.mjs` (smoke Kokoro) | Download de modelos em `huggingface.co` / `cdn.jsdelivr.net` / `raw.githubusercontent.com` — fora da allowlist; áudio físico. Unit mocks do engine PASS (L-14) | `airi/packages/lia-core/src/voice/engines/kokoro/manifest.ts:21-51` |
| 4.5 | Download do binário Electron 43.4.1 | `release-assets.githubusercontent.com` cortado (SSL_ERROR_SYSCALL); bloqueia gate Electron e runtime local | §3.1 |
| 4.6 | `pnpm typecheck` da raiz (todos os pacotes/apps/server/docs) | Não executado: inclui `vue-tsc` do Stage com heap padrão → OOM provável (§3.4.1); exige máquina ≥8 GiB ou `NODE_OPTIONS`. Typechecks Lia-relevantes PASS (L-14/L-15/L-21) | decisão registrada; sem invenção de resultado |
| 4.7 | `Tests/tools/qa-benchmark.mjs` completo | Exige Windows, git limpo e execução real; aqui só a suíte estática do harness rodou (L-11) | §1-B W-04 |
| 4.8 | `scripts/oidc-electron/gate.test.mjs` (relatório PROMPT-43 cita PASS) | **Ausente neste checkout** (artefato untracked da worktree Windows); nenhum arquivo correspondente | `find scripts/` → inexistente |
| 4.9 | OIDC real contra issuer de produção; provedores externos (Groq/OpenAI) autenticados; `api.groq.com` | Credenciais deliberadamente não utilizadas (regra da sessão desassistida); `api.airi.build` alcançável somente por reset TLS (§3.2) | políticas do projeto + §3.2 |
| 4.10 | Instalação limpa NSIS / atualização / desinstalação / assinatura | Windows + máquina limpa; nunca executado em nenhuma rodada | `LIA-BETA-READINESS-2026-11-08.md` §Matriz |
| 4.11 | Multi-monitor/DPI/RX 580/jogos/hotplug | Hardware interativo | H-03/H-04 |

Nada aqui foi marcado PASS por inferência; itens 4.6–4.11 são "NOT RUN", não "FAIL".

---

## 5. Regressões identificadas

5.1 **Lint vermelho (novo):** 81 erros eslint neste SHA (§3.3). Não é regressão funcional, mas é portão de qualidade vermelho nunca antes medido; classificado como regressão de processo/gate. Nenhuma baseline anterior do projeto executou `pnpm lint` nesta combinação de arquivos Lia.

5.2 **`oidc-link.test.ts` — histórico de flake, não reproduzido aqui:** PROMPT-43 registrou FAIL (callback HTTP 200 após logout, 1/2.556); PROMPT-44 isolado 30/30 PASS (worktree sujo); **neste checkout limpo: PASS 30/30** e a suíte completa verde. Não há evidência de regressão atual; manter o teste sob vigilância em CI Windows e investigar a sensibilidade a ordem/concorrência (o arquivo não foi alterado nesta base).

5.3 **stage-ui exit 1 sem teste falho (novo):** rejeição `updateCredits`→`api.airi.build` (§3.2). Comportamento latente do upstream; exposto agora porque a suíte roda em rede restrita. Vira flakiness determinística fora da rede da AIRI.

5.4 **Fragilidade de bootstrap dos testes do Stage:** ~27 arquivos de teste dependem transitivamente de `require('electron')` resolver; sem binário/override a suíte "verde" aparenta 27 vermelhos (§3.1). Não é defeito de produto; é fragilidade de ambiente/CI que precisa de `ELECTRON_OVERRIDE_DIST_PATH` documentado ou Electron disponível.

5.5 **Divergência `airi/` subtree × instalação documentada:** §3.5 (`.git` falso dentro de `airi/` pelo postinstall). Não é regressão de código; é armadilha do caminho de instalação neste layout — ausente da documentação atual.

5.6 **Divergência de SHA base × remoto:** `arena/01a10290-lia-project` no remoto já está em `5ec464e…`, enquanto esta validação cobre `7cb8172…` (HEAD da branch de sessão). Commits novos podem conter correções não cobertas aqui; a comparação de conteúdo é impossível no clone raso. **Nenhuma conclusão deste relatório se estende a `5ec464e…`.** E a branch `arena/18f50ae7-lia-project` ainda não existe no remoto.

5.7 **Sem evidência de regressão de produto nas áreas cobertas:** seleção de provider (AF-1b), autoridade única, interlock, vault, shutdown, memória, transcrição, voz (mocks) — todos PASS nesta base limpa, alinhado com PROMPT-42/43/44.

---

## 6. Testes que exigem Windows (encaminhar ao Codex)

Copiar a tabela §1-B (W-01…W-13). Mínimo viável para fechar a lacuna de runtime, nesta ordem:

1. **W-01/W-02** — `.\Lia.bat`, janela Launcher, abrir Stage, `lia-app.renderer-ready`, fechar e confirmar zero órfãos (log do console + `lia-product.json` observado, sem ler segredos).
2. **W-04** — `Tests\LiaBenchmark.bat --no-push` para exercitar o harness completo e produzir métricas locais (sem publicação).
3. **AI Settings 9 passos (PROMPT-39/40)** com credencial válida no vault do perfil de teste: catálogo → conexão → seleção → 5 mensagens consecutivas → reabrir e validar persistência → `get_weather` real (autorizar) → histórico após reinício → encerrar sem órfãos.
4. **W-06** — `node --test scripts/provider-runtime-electron/gate.test.mjs` no Windows (16 grupos; fixtures HTTP locais; comprovação de sandbox/preload/IPC na janela real e limpeza de processos).
5. **W-07** — confirmar/recuperar o gate `oidc-electron` (hoje ausente do repositório) e o gate OIDC real de login (PROMPT-37/44).
6. **W-08** — `package-windows.mjs --internal-test`, instalação limpa, atualização, desinstalação (preservando dados), e verificação de pacote (NotSigned esperado até certificado).
7. **H-01/H-02/H-03** — smoke Kokoro real, STT real, Live2D/RX 580, segundo monitor.
8. **W-09** — deixar o CI `devflow-ci.yml` (windows-latest) verde na branch `arena/01a10290-lia-project` e registrar os artefatos.

Regras para o Codex: nunca imprimir/usar credenciais fora do campo do Launcher; sessões com Computer Use habilitado; evidências no formato deste diretório (`docs/reports/evidence/…`); `Lia.bat` como único entry point oficial.

---

## 7. Critérios de aceite para beta (gate explícito, mensurável)

Cada item exige evidência anexada ao relatório de beta. Estado em **14/11/2026** (esta rodada):

| # | Critério de aceite | Estado atual |
|---|--------------------|--------------|
| C-1 | `pnpm install` reproduzível a partir de clone limpo (instruções atualizadas ao layout subtree; sem `.git` falso; build dos pacotes documentado) | **FAIL documental** (§3.5) |
| C-2 | CI verde: Python DevKit (ubuntu+windows), suítes Node/Vitest Lia-relevantes, `pnpm lint` exit 0 | Python PASS; Node PASS; **lint FAIL** |
| C-3 | Projetos browser (stage-tamagotchi e stage-ui) verdes em CI com Chromium disponível | **BLOCKED** (rede) |
| C-4 | Build do Stage 100% offline-reprodutível (assets Live2D/VRM/Cubism em cache/mirror controlado, com hash; sem dependência de `dist.ayaka.moe` em build-time) | **BLOCKED** (§4.1) |
| C-5 | Launcher → Stage → conversa real (≥5 mensagens, failover conforme política) — Windows | **NOT RUN** |
| C-6 | Configuração efetiva de sandbox/preload/IPC comprovada na janela de produto (não só harness) | **NOT RUN** (harness PASS) |
| C-7 | AI Settings ponta a ponta: catálogo, vault, teste de conexão, seleção persistida após reinício | **NOT RUN** (unit PASS; Windows pendente) |
| C-8 | Histórico e memória persistentes após reinício do app e do SO (opt-in/out respeitado) | **NOT RUN** |
| C-9 | AF-1b/AF-1: seleção gerenciada não é sobrescrita por escritores legados na UI real (erros tipados visíveis) | unit PASS; UI real **NOT RUN** |
| C-10 | Voz: Kokoro instala, pré-aquece, sintetiza (RTF medido) e STT captura com cancelamento — hardware real | **BLOCKED/NOT RUN** |
| C-11 | OIDC real (issuer) login/logout sem regressão do flake de callback; ferramenta `get_weather` com autorização e resultado correto | **NOT RUN** (unit 30/30 PASS) |
| C-12 | Encerramento: `Lia.bat` fecha Launcher+Stage sem órfãos; dados preservados; `single-instance` respeitado | unit PASS; runtime **NOT RUN** |
| C-13 | Instalador NSIS: instalação limpa, atualização, desinstalação sem apagar dados do usuário; inventário de licença completo | **NÃO EXECUTADO** (627/45.397 arquivos; 39/1.039 manifestos no ASAR; 27/789 notices — beta 08/11) |
| C-14 | Assinatura Authenticode (ou release explicitamente unsigned e comunicado) | **NOT SIGNED** (sem certificado) |
| C-15 | Gates de hardware: RX 580 renderiza avatar; DPI/hotplug/segundo monitor; sem regressão de memória/CPU em coleta de 1h | **NOT RUN** |
| C-16 | Nenhum fetch externo não stubbed em suítes unitárias (rejeições não tratadas = 0) | **FAIL** (§3.2) |
| C-17 | Zero credenciais em logs/relatórios/commits (varredura anti-segredo no release) | PASS nesta rodada (varredura manual do pacote de evidência; fixture sintético confirmado) — repetir no pacote final |
| C-18 | `CURRENT-STATE.md` e este relatório atualizados no mesmo commit que fechar cada gate | processo — este relatório é o primeiro passo |

**Conclusão de beta:** sob estes critérios, a Lia **não está pronta para beta**; a distância real é C-4…C-15 (runtime e distribuição), não o núcleo unitário, que está saudável.

---

## 8. Plano de validação recomendado

**Fase A — Higiene e portões (1–2 dias, Linux + CI)**
A1. Corrigir/escopar os 81 erros de lint (sugestão: `node/prefer-global/process` e `node:test` escopados para `scripts/provider-runtime-electron/**` no flat config; `--fix` para sort-imports/quotes) — requer autorização; meta: `pnpm lint` exit 0 no SHA de beta.
A2. Stubbar `updateCredits`/`api.airi.build` nas suítes de unit-test (mock de `client`) e exigir **0 unhandled rejections** no CI.
A3. Documentar a instalação suportada (§3.5) e adicionar um passo CI ubuntu que replique esta matriz (cache de `pnpm`, `ELECTRON_OVERRIDE_DIST_PATH`, `build:packages` antes de typecheck).
A4. Espelhar/cachear os assets Live2D/VRM/Cubism com hashes (ou vendor-los) para build reproduzível; abrir issue sobre a dependência de `dist.ayaka.moe`.
A5. Fixar no CI a execução de `vitest --project browser` com `playwright install --with-deps chromium` onde o runner alcança o CDN (windows-latest/ubuntu-latest).

**Fase B — Windows automatizado (2–4 dias, Codex)**
B1. W-01/W-02 boot+Stage com logs; W-03 harness isolado; W-06 gate Electron; B3. `devflow-ci` verde nas duas metades.
B2. AI Settings 9 passos + 5 mensagens + `get_weather` + persistência pós-reinício (C-7…C-9), log capturado no padrão de evidência.
B3. W-11 órfãos; W-12 assinatura ou release unsigned documentado.

**Fase C — Distribuição e hardware (3–5 dias, máquina de dev do Dev)**
C1. W-08 pacote NSIS: instalação limpa/atualização/desinstalação com perfil sintético.
C2. H-01…H-05 voz/STT/GPU/monitores; coleta de 1h pós-mudança do caminho de voz.
C3. Medição de baixo consumo (memória/CPU/GPU) comparada à baseline de 08/11.

**Fase D — Fechamento (1 dia)**
D1. Re-rodar esta matriz no SHA taggeado beta; anexar evidências; atualizar `CURRENT-STATE.md` e `LIA-BETA-READINESS-*.md`; assinar release ou documentar decisão de não assinar.
D2. Checklist final contra C-1…C-18; somente então declarar beta.

**Cobertura e redundância (observações):**
- Redundância baixa e intencional: AF-1b direcionado (L-17) ⊂ suíte Stage (L-16); shim `stage-tamagotchi/…/selection-write-policy.ts` reexporta a política canônica de `lia/core` (sem duplicar lógica); camadas de voz (engine→serviço→store→UI) cobrem o mesmo fluxo em 4 níveis — manutenção alta, mas cada nível pega classes diferentes de defeito.
- Redundância a revisar: `lia/launcher` e `lia/stage` (raiz, 17 testes) **não são importados por nenhum artefato do produto** (0 imports em `airi/**`) — são contratos executáveis/documentação viva; o produto real vive em `airi/apps/lia-app` e `stage-tamagotchi`. Risco de divergência entre "contrato" e "implementação". Decidir: promover para fonte única ou rotular como referência.
- `airi/packages/lia-core` (@lia/core, voz/produto) × `lia/core` (@lia/contracts) — dois "lia-core" de escopos distintos com nome colidido; renomear um evitaria confusão em CI/relatórios.
- Fronteiras por caminhos relativos (`../../../../../lia/core/src/…`) atravessam pacotes sem passar por `exports` — frágil a movimentação de pastas; coberto indiretamente por L-14/L-15/L-16, mas quebra silenciosa se alguém mover `lia/core`.
- **Sem cobertura automatizada de runtime**: boot, UI real, IPC real, reinício — a lacuna que a Fase B fecha. Unit/integração: forte. Browser/visual: nulo aqui. E2E de produto: inexistente.
- `test_lia_dev.py` (435 PASS) e `Tests/tools` (275 PASS) exercitam o harness, não o produto — não contam como prova de produto.

---

## Anexo A — Comandos utilizados (ordem real)

```bash
# SHA e integridade
git rev-parse HEAD                 # 7cb81720552a822a03f36ac6ce5f2e20b009f84c
git status --porcelain | wc -l     # 0 (antes do relatório)
git fsck --connectivity-only       # exit 0
git ls-remote origin               # main=9c7ac18…; arena/01a10290-lia-project=5ec464e…; branch de sessão ausente no remoto

# Python (paridade com .github/workflows/devflow-ci.yml)
python -m compileall -q tools
python tools/ci_run_suite.py tools/test_project_cli.py   # 33 PASS
python tools/ci_run_suite.py tools/test_creation.py      # 23 PASS
python tools/ci_run_suite.py tools/test_lia_dev.py       # 435 PASS, 12 skipped, ~115 s
python tools/ci_run_suite.py tools/test_agent_skills.py  # 7 PASS
python -m unittest discover -s tools/stt-bench/tests     # 70 PASS, 2 skipped
python Tests/tools/alethe-budget.test.py                 # 10 PASS, 1 skipped

# Node — raiz (sem dependências)
node --experimental-strip-types --test "lia/core/test/*.test.ts"      # 105 PASS
node --experimental-strip-types --test "lia/launcher/test/*.test.ts"  # 8 PASS
node --experimental-strip-types --test "lia/stage/test/*.test.ts"     # 9 PASS
node --test "Tests/tools/"*.test.mjs                                   # 275 PASS

# airi/ — instalação (sem postinstall; ver §3.5) e builds
corepack pnpm install --frozen-lockfile --ignore-scripts   # 2648 pacotes, exit 0
pnpm run build:packages                                     # turbo, 33 tasks PASS
pnpm --filter @proj-airi/core-agent run build               # PASS
pnpm run build                                               # (lia-core) PASS → dist/

# airi/packages/lia-core
pnpm exec vitest run                                        # 381 PASS (31 arq.)
pnpm run typecheck                                          # exit 0

# airi/apps/lia-app (Launcher)
pnpm exec vitest run                                        # 353 PASS + 2 skip
pnpm run typecheck                                          # exit 0
pnpm run build                                              # exit 0 (com /tmp/pnpm-shim no PATH)

# airi/apps/stage-tamagotchi (Stage)
NODE_OPTIONS=--max-old-space-size=3072 pnpm exec vue-tsc --noEmit   # exit 0 (após build:packages)
pnpm run build                        # main+preload PASS; renderer BLOCKED (dist.ayaka.moe)
pnpm exec vitest run --config vitest.config.ts --project node                           # FAIL 27 arq. (1ª)
ELECTRON_OVERRIDE_DIST_PATH=/tmp/electron-override pnpm exec vitest run --config vitest.config.ts --project node
                                       # 204 PASS, 2.498 testes + 1 skip
pnpm exec vitest run --config vitest.config.ts --project browser                        # BLOCKED (sem Chromium)
pnpm exec vitest run --config vitest.config.ts src/main/services/lia/provider-config-service.test.ts \
  src/main/windows/secure-web-preferences.test.ts src/preload/ipc-channel-policy.test.ts \
  src/preload/shared.test.ts src/main/windows/desktop-overlay/window-contract.test.ts   # 13 PASS
node --test lib/*.test.mjs gate-integrity.test.mjs          # 148 PASS (cwd …/provider-runtime-electron)

# stage-ui
pnpm exec vitest run --config vitest.config.ts --project node   # 1.140 PASS; exit 1 (§3.2)

# lint
pnpm lint                             # oxlint 0 erros/10 avisos; eslint 81 erros → exit 1
```

Notas operacionais: `pnpm` não está no PATH global — usado via `corepack pnpm@11.24.0` e um shim temporário em `/tmp/pnpm-shim` (não persistido no repo). `ELECTRON_OVERRIDE_DIST_PATH=/tmp/electron-override` (stub de 1 arquivo de texto + dir vazio) foi usado **somente** para os testes unitários do Stage; verificado que nenhum teste executa o binário. Nenhuma evidência foi escrita fora de `docs/reports/evidence/LIA-QA-VALIDATION-2026-11-14/` e `/tmp`.

## Anexo B — Integridade, escopo e desvios

- Working tree limpo antes do relatório (`git status --porcelain` = 0); após: somente `docs/reports/evidence/LIA-QA-VALIDATION-2026-11-14/` + este arquivo.
- Clone raso (depth 1) — sem capacidade de `git diff` histórica; a "regressão" deste relatório é medida contra a documentação PROMPT-38…44, não contra diff.
- Remoto: `arena/01a10290-lia-project` = `5ec464e…` (≠ SHA testado); `arena/18f50ae7-lia-project` inexistente no remoto; `main` = `9c7ac18…` (não tocada); `git fsck --connectivity-only` exit 0; `.git/hooks/commit-msg` intacto (não executado postinstall — §3.5).
- Nenhuma credencial foi lida de vault/config/env; `GROQ_API_KEY` não foi consultada. Nenhum processo Electron permaneceu (nenhum foi iniciado). `airi/.cache` não foi criado. Nada em `Tests/runs|artifacts|tmp` foi gerado pelos testes; `Tests/artifacts/alethe-editor-inert.png` não foi regerado (browser ausente).
- Saídas de build em `airi/**/out`, `dist`, `node_modules`, `airi/.cache` são gitignored — o repositório não recebeu artefatos.
- Limitação declarada: números de custo/tempo/memória são específicos desta caixa (2 vCPU, 4 GiB); o typecheck do Stage exigiu heap de 3 GiB (Windows: passou com padrão).

## Anexo C — Classificação final

**PASS (automatizado, Linux):** núcleo de contratos, Launcher, Stage (node), stage-ui (testes), DevKit/QA harness, builds de pacotes, typechecks Lia-relevantes.
**FAIL:** `pnpm lint` (81 erros); instalação documentada cria `.git` falso em `airi/` (documental).
**BLOCKED:** renderer do Stage (rede), browser/Chromium, Electron runtime, Kokoro, assets Live2D/VRM.
**NOT RUN:** tudo em Windows interativo (W-01…W-13), hardware (H-01…H-05), reinício/distribuição/assinatura, AI Settings real, conversa real, histórico, voz/STT reais.

**A Lia não está aprovada ponta a ponta.** Este relatório não atesta funcionamento do produto; atesta o estado verificável da engenharia nesta data, com os buracos explicitamente enumerados.
