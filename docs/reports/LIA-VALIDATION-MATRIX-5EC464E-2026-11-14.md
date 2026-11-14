# Lia-Project — Matriz de validação do SHA `5ec464edf410008e390e2da4aff32d32537eb69d`

**Data:** 2026-11-14 · **Autor:** Arena (Linux/WSL, sem display, sem credenciais) · **Branch:** `arena/18f50ae7-lia-project`
**SHA de referência:** `5ec464edf410008e390e2da4aff32d32537eb69d` (tip no início desta tarefa; commit `5ec464e` — “docs: audit the development branch against its evidence”).
**Delta 7cb8172 → 5ec464e:** 1 commit, `+295/−1`, **somente documentação** (a auditoria `LIA-BRANCH-AUDIT-2026-11-14.md`). Nenhuma linha de código mudou.
**Este documento é a matriz pedida.** A auditoria citada é referência e insumo; nada nela conta como resultado executado.

Regra aplicada do início ao fim: **nenhum teste foi declarado PASS sem execução real nesta máquina, nesta rodada, e nenhum resultado de Windows foi simulado no Linux.** Resultados de rodadas anteriores (PROMPT-40/42/43/44, validação 7cb8172) são citados sempre como histórico rotulado, nunca como PASS deste SHA.

---

## 0. Resumo executivo

| Pergunta | Resposta |
|---|---|
| O núcleo offline do repositório está verde neste SHA? | **Sim, re-executado e verde:** 5.651 PASS únicos / 18 skipped / 0 FAIL nas suítes automatizadas (mesma contagem de 7cb8172, re-verificada aqui). |
| O Stage builda 100%? | **Não.** Main e preload PASS; **renderer BLOCKED** por `unplugin-fetch` em `dist.ayaka.moe` (ECONNRESET, rede inalcançável). |
| O Launcher está provado ponta a ponta? | **Não.** Boot real, UI, IPC real e ciclo de vida no Windows continuam **NOT RUN** em 5ec464e. |
| A beta pode ser declarada? | **Não.** 0 dos 16 passos de AI Settings foi re-executado neste SHA; tool calling, voz, Stage real, histórico persistente, órfãos e distribuição (NSIS) permanecem sem prova de runtime. Gates de aceite C-1…C-19: apenas C-17 (varredura anti-segredo) e o núcleo unitário passam. |
| O que fecha a beta? | §8 (roteiro Codex/Windows) e §10 (evidências por bloqueador B1–B7). |

**Veredicto:** a Lia em `5ec464e` continua **NÃO aprovada para beta**. O que esta rodada prova: o código compila, as suítes automatizadas passam e os artefatos de evidência existem no repositório. O que continua sem prova: todo o runtime real (Windows), toda a interação de usuário, toda dependência de rede externa, voz, hardware e distribuição.

---

## 1. Registro de integridade e escopo

| Item | Valor |
|---|---|
| HEAD na captura (`00-environment.txt`) | `5ec464edf410008e390e2da4aff32d32537eb69d` |
| HEAD da branch no momento desta entrega | `3523c3f` (acrescenta evidências desta rodada; relatório entra a seguir) |
| Base da branch | `7cb8172` (via `arena/01a10290-lia-project`) |
| Sistema | Linux 6.1.158 x86_64 (kernel `6.1.158+`), sem display/GPU utilizável |
| Toolchain | Node v22.22.3, npm 10.9.8, Python 3.11.2, pnpm 11.24.0 (via `corepack`, conforme `packageManager` do repo) |
| `airi/` instalado com | `corepack pnpm install --frozen-lockfile --ignore-scripts` (EXIT=0; `--ignore-scripts` obrigatório — scripts simples-git-hooks criam `.git` falso no subtree) |
| Heap Node para Stage/vue-tsc | `NODE_OPTIONS=--max-old-space-size=3072` |
| Electron nos testes node | `ELECTRON_OVERRIDE_DIST_PATH=/tmp/electron-override` (stub documentado em `/tmp/electron-override/README.txt`; nenhum dos 2.498 testes executa o binário) |
| Evidência desta rodada | `docs/reports/evidence/LIA-QA-VALIDATION-5ec464e-2026-11-14/` (30 arquivos, ~2,1 MB), **commitada** em `3523c3f` |
| Alterações de código | **Nenhuma.** Só `docs/reports/**` (relatórios + evidências). |
| Varredura anti-segredo | Concluída; 1 ocorrência era fixture sintético do `hearing.test.ts` (`gsk-…`), redigida para `gsk-REDACTED-SYNTHETIC-FIXTURE` no log commitado. Nenhum segredo real. |
| Desvio da captura | `00-environment.txt` registrou 3 arquivos sujos no início (eram o relatório/evidências da rodada 7cb8172, ainda não commitados — commitados depois em `dc3f68f`). Nenhum código envolvido. |

---

## 2. Matriz geral — três classes de ambiente

Legenda de estado: **PASS** (executado, resultado registrado) · **FAIL** (executado, falhou) · **BLOCKED** (pré-condição ausente — rede, credencial, permissão) · **NOT RUN** (não executado nesta rodada) · **N/A**.

### 2.A — LINUX/ARENA (executáveis aqui, nesta rodada, em `5ec464e`)

| ID | Funcionalidade / área | Comando (cwd) | SHA | Resultado | Evidência |
|---|---|---|---|---|---|
| A-01 | DevKit — byte-compile | `python -m compileall -q tools` | 5ec464e | PASS (exit 0) | `01-compileall.log` |
| A-02 | DevKit — CLI universal | `python tools/ci_run_suite.py tools/test_project_cli.py` | 5ec464e | PASS 33/33 | `02-test_project_cli.log` |
| A-03 | DevKit — criação de repo | `python tools/ci_run_suite.py tools/test_creation.py` | 5ec464e | PASS 23/23 | `03-test_creation.log` |
| A-04 | DevKit — DevFlow | `python tools/ci_run_suite.py tools/test_lia_dev.py` | 5ec464e | PASS 435/435 (12 skip Windows-only) | `04-test_lia_dev.log` |
| A-05 | Skills de agente | `python tools/ci_run_suite.py tools/test_agent_skills.py` | 5ec464e | PASS 7/7 | `05-test_agent_skills.log` |
| A-06 | STT bench (stubs) | `python -m unittest discover -s tools/stt-bench/tests` | 5ec464e | PASS 70/70 (2 skip) | `06-stt-bench.log` |
| A-07 | Alethe budget | `python Tests/tools/alethe-budget.test.py` | 5ec464e | PASS 10/10 (1 skip) | `07-alethe-budget.log` |
| A-08 | Contratos Lia (seleção, transporte, ciclo de vida, presença, protocolo) | `node --experimental-strip-types --test "lia/core/test/*.test.ts"` | 5ec464e | PASS 105/105 | `08-lia-contracts.log` |
| A-09 | Launcher — decisão de alvo do Stage | `node --experimental-strip-types --test "lia/launcher/test/*.test.ts"` | 5ec464e | PASS 8/8 | `09-lia-launcher.log` |
| A-10 | Stage — host do Stage | `node --experimental-strip-types --test "lia/stage/test/*.test.ts"` | 5ec464e | PASS 9/9 | `10-lia-stage.log` |
| A-11 | QA harness (backup/restore, logs, storage, .bat, gitignore) | `node --test "Tests/tools/*.test.mjs"` | 5ec464e | PASS 275/275 | `11-qa-tools.log` |
| A-12 | airi — instalação congelada | `corepack pnpm install --frozen-lockfile --ignore-scripts` (airi/) | 5ec464e | PASS (exit 0, 56,9 s) | `12-airi-install.log` |
| A-13 | Build de pacotes (prerequisito) | `pnpm run build:packages` (airi/) | 5ec464e | PASS 33/33 tasks | `13-build-packages.log` |
| A-14 | core-agent — build | `pnpm --filter @proj-airi/core-agent run build` (airi/) | 5ec464e | PASS (exit 0) | `14-build-core-agent.log` |
| A-15 | @lia/core — build | `pnpm run build` (airi/packages/lia-core) | 5ec464e | PASS (exit 0) | `15-build-lia-core.log` |
| A-16 | core-agent — suíte | `pnpm exec vitest run --root packages/core-agent --project @proj-airi/core-agent` | 5ec464e | PASS 156/156 (13 arq.) | `16-test-core-agent.log` |
| A-17 | @lia/core — suíte | `pnpm exec vitest run` (airi/packages/lia-core) | 5ec464e | PASS 381/381 (31 arq.) | `17-test-lia-core.log` |
| A-18 | @lia/core — typecheck | `pnpm run typecheck` (airi/packages/lia-core) | 5ec464e | PASS (exit 0) | `18-typecheck-lia-core.log` |
| A-19 | **Launcher** (`@lia/lia-app`) — suíte | `pnpm exec vitest run` (airi/apps/lia-app) | 5ec464e | PASS 353/353 (2 skip; 36 arq.) | `19-test-lia-app.log` |
| A-20 | **Launcher** — typecheck | `pnpm run typecheck` (airi/apps/lia-app) | 5ec464e | PASS (exit 0) | `20-typecheck-lia-app.log` |
| A-21 | **Launcher** — build | `pnpm run build` (airi/apps/lia-app) | 5ec464e | PASS (exit 0) | `21-build-lia-app.log` |
| A-22 | **Stage** — typecheck | `pnpm exec vue-tsc --noEmit` (airi/apps/stage-tamagotchi), heap 3 GB | 5ec464e | PASS (exit 0) | `22-typecheck-stage.log` |
| A-23 | **Stage** — build | `pnpm run build` (airi/apps/stage-tamagotchi) | 5ec464e | **PARCIAL / BLOCKED** — main `✓ built in 1.52s` + preload `✓ built in 14ms`; **renderer FAIL**: `unplugin-fetch` GET `https://dist.ayaka.moe/live2d-models/hiyori_free_zh.zip` → ECONNRESET | `23-build-stage.log` |
| A-24 | **Stage** — projeto node (Main/Renderer/Shared) | `pnpm exec vitest run --config vitest.config.ts --project node` com `ELECTRON_OVERRIDE_DIST_PATH` | 5ec464e | PASS 2.498/2.498 (1 skip; 204 arq.; oidc-link 30/30 estável) | `24-test-stage-node.log` |
| A-25 | Stage — regressões direcionadas AF-1b/sandbox | `pnpm exec vitest run --config vitest.config.ts <5 arquivos: provider-config-service, secure-web-preferences, ipc-channel-policy, preload/shared, window-contract>` | 5ec464e | PASS 13/13 | `25-test-stage-targeted.log` |
| A-26 | Stage — projeto browser | `pnpm exec vitest run --config vitest.config.ts --project browser` | 5ec464e | **BLOCKED** — Chromium headless ausente e `cdn.playwright.dev` inalcançável; não simulado | `26-test-stage-browser-BLOCKED.log` |
| A-27 | Stage Electron gate — libs auditáveis (sem host Electron) | `node --test scripts/provider-runtime-electron/lib/*.test.mjs scripts/provider-runtime-electron/gate-integrity.test.mjs` (airi/apps/stage-tamagotchi) | 5ec464e | PASS 148/148 | `27-provider-electron-lib.log` |
| A-28 | stage-ui — projeto node (chat Lia, send-error, failover) | `pnpm exec vitest run --config vitest.config.ts --project node` (airi/packages/stage-ui) | 5ec464e | **PASS PARCIAL** — 1.140/1.140 testes PASS (154 arq.), **exit 1** por 1 unhandled rejection (`updateCredits` → fetch `api.airi.build`, ECONNRESET) | `28-test-stage-ui.log` |
| A-29 | Lint do monorepo | `pnpm lint` (airi/) | 5ec464e | **FAIL** — 81 erros eslint (10 warnings, 3.490 arquivos); pré-existente; **não corrigido** (fora de escopo desta etapa; 59 auto-fixáveis) | `29-lint.log` |

\* A-24: o binário do Electron não pôde ser baixado (`release-assets.githubusercontent.com` inalcançável). O seam oficial `ELECTRON_OVERRIDE_DIST_PATH` foi usado apenas para resolução de path no `require('electron')`; nenhum dos 2.498 testes executa o binário (IPC mockado).

**Totais únicos desta rodada (5ec464e): 5.651 PASS / 18 skipped / 0 FAIL**
(33+23+435+7+70+10 Python · 105+8+9+275 contratos/QA · 156+381+353+2.498+1.140+148 vitest — `A-25` é subconjunto de `A-24` e não é contado duas vezes.)

### 2.B — WINDOWS/CODEX (não executados aqui; NÃO simulados)

Ambiente exigido: Windows 10/11 x64, desktop interativo, máquina de desenvolvimento do projeto.

| ID | Item | Pré-condição | Estado prévio conhecido (rótulo: histórico, não PASS deste SHA) |
|---|---|---|---|
| W-01 | Boot real por `Lia.bat` (build, janela `Lia`, `lia-app.renderer-ready`) | Windows + Node LTS + `corepack enable` | PROMPT-40/42: janela abriu (`renderer-ready` +1.311 ms, SHA `0818305`); **NOT RUN em 5ec464e** |
| W-02 | Stage real integrado ao Launcher pelo botão "Conversar com Lia" | W-01 + Stage build | **NOT RUN** (nunca provado ponta a ponta) |
| W-03 | `Tests\LiaTests.bat` opções 2–4 (instalação isolada, restore, ACTIVE marker) | Windows + checkout da máquina de dev | harness coberto estaticamente (A-11); runtime **NOT RUN** |
| W-04 | `Tests\LiaBenchmark.bat` / `Tests\tools\qa-benchmark.mjs` completo | Windows + rede + repo | nunca executado ponta a ponta nesta base |
| W-05 | `Tools\stt-bench\run-stt-bench.*` | Windows + faster-whisper | core Python PASS (A-06); binários **NOT RUN** |
| W-06 | `scripts/provider-runtime-electron/gate.test.mjs` (gate Electron + fixture HTTP local, tabela de processos via PowerShell) | `powershell.exe`, Electron real | PROMPT-31/43: PASS no Windows (outro SHA); libs auditáveis PASS aqui (A-27); gate real **NOT RUN em 5ec464e** |
| W-07 | Gate `oidc-electron` (`scripts/oidc-electron/`) | **arquivos ausentes neste checkout** (untracked na worktree Windows do PROMPT-43/44) | impossível executar — ausência verificada de novo nesta rodada |
| W-08 | `airi/apps/lia-app/scripts/package-windows.mjs` (NSIS) + instalação limpa/atualização/desinstalação | Windows x64 + builds Launcher/Stage verdes | **NÃO EXECUTADO** em nenhuma rodada |
| W-09 | CI `devflow-ci.yml` metade `windows-latest` | Runner Windows | configurado; aqui só a metade Linux foi replicada |
| W-10 | `test_lia_dev.py` — 12 testes Windows-only (junction/symlink/pskill) | Windows | skipped por design (visíveis em `04-test_lia_dev.log`) |
| W-11 | Fechamento gracioso + zero órfãos (tabela de processos real, Launcher+Stage) | W-01/W-02 + PowerShell | boot fechou sem órfãos no PROMPT-40 (outro SHA); integração **NOT RUN em 5ec464e** |
| W-12 | Assinatura Authenticode + verificação | Windows + certificado (inexistente) | investigado; nunca executado |
| W-13 | `DevKit.bat` interativo (menu, wizard, `git push` real) | Windows interativo | lógica Python coberta (A-02/03/04) |
| W-14 | Introspecção de sandbox/preload **na janela de produto** (`webPreferences` efetivas; ausência de `process`/`require` no renderer) | W-01 + Computer Use **ou** CDP | PROMPT-43 provou harness; janela real **NOT RUN** |
| W-15 | AI Settings — 16 passos (§6.1) | W-01 + interação desktop + chave Groq digitada **na UI** | passos 1/16: PASS histórico PROMPT-40 (SHA `2246552`); demais **NOT RUN/BLOCKED** |
| W-16 | Conversa real ≥5 turnos + failover conforme política | W-15 | **NOT RUN** |
| W-17 | Tool calling `get_weather` round-trip (§6.2) | W-16 + rede (open-meteo.com, api.groq.com) | **NOT RUN** (inventário existe; round-trip nunca observado) |
| W-18 | Histórico e memória persistentes após reinício do app e do SO | W-16 + restart | **NOT RUN** |
| W-19 | OIDC real (issuer) login/logout | W-07 | **NOT RUN** (unit `oidc-link` 30/30 PASS, A-24) |
| W-20 | C0–C4 (baseline/repouso/animação/interação/oculto) — RAM/CPU/FPS/início/shutdown | máquina de dev Windows + pacote instalado | **NOT RUN** (§6.6) |

### 2.C — HARDWARE (não executáveis em nenhum CI atual)

| ID | Item | Motivo | Estado |
|---|---|---|---|
| H-01 | Kokoro TTS real (`tools/kokoro-smoke.mjs`) — instalar engine, pré-aquecer, síntese, WAV, RTF | rede p/ `huggingface.co`/`cdn.jsdelivr.net` bloqueada aqui + CPU com AVX real | **BLOCKED** (rede) / nunca validado contra esta base |
| H-02 | STT real (mic → transcrição → cancelamento) | microfone físico + dispositivos | **NOT RUN** |
| H-03 | RX 580 / Live2D — render, avatar, animações, DPI, múltiplos monitores | GPU física; relatórios anteriores citam apenas adaptador virtual Parsec | **NOT RUN** |
| H-04 | Hotplug/resolução/escala, jogos borderless/exclusivo, click-through, foco | sessões interativas com hardware | **NOT RUN** |
| H-05 | Coleta de 1h (`--soak-seconds=3600`) com pacote real | sessão longa interativa Windows | **NOT RUN** |

---

## 3. Falhas encontradas (executadas, com evidência)

### 3.1 Stage — `pnpm run build` exit 1 (renderer) — `23-build-stage.log`
Main (`out/main/index.js`, 2,49 MB, `✓ built in 1.52s`) e preload (`out/preload/index.cjs`, `✓ built in 14ms`) **construídos com sucesso**. A falha ocorre na fase renderer: `@proj-airi/unplugin-fetch` lança `FetchError: [GET] "https://dist.ayaka.moe/live2d-models/hiyori_free_zh.zip": <no response> fetch failed` (`cause: ECONNRESET`). **Classificação: BLOCKED por rede, reproduzível, não é defeito de código.** O build do renderer não é reprodutível offline — é também o bloqueador C-4.

### 3.2 stage-ui — exit 1 com 1.140/1.140 PASS — `28-test-stage-ui.log`
154 arquivos de teste passam; **1 unhandled rejection**: `updateCredits` (`src/stores/auth.ts:359`) → `authedFetch` (`src/libs/auth-fetch.ts:39`) → `fetch failed`, host `api.airi.build:443`, `ECONNRESET`. Nenhum teste falhou; a suíte sai com código 1 por rejeição não tratada vinda de um fetch real disparado fora de mock. Mesma classe do achado da rodada 7cb8172 (§3.2 lá). Não corrigido (escopo: relatório, sem alterações de código).

### 3.3 `pnpm lint` — exit 1, 81 erros — `29-lint.log`
"Found 10 warnings and 0 errors." (primeira fase) seguido de "✖ 81 problems (81 errors, 0 warnings)" em 3.490 arquivos. Pré-existente (idêntico à rodada 7cb8172); 59 auto-fixáveis. **Não corrigido nesta etapa** por restrição explícita de não alterar código.

### 3.4 Stage — projeto browser — `26-test-stage-browser-BLOCKED.log`
`browserType.launch: Executable doesn't exist at …/chromium_headless_shell-1234/…` — binário Playwright ausente e `cdn.playwright.dev` inalcançável (ECONNRESET confirmado anteriormente). **BLOCKED por rede**; não substituído por simulação.

### 3.5 `00-environment.txt` — registro de worktree sujo na captura
O arquivo registrou 3 linhas de `git status --porcelain` no início (relatório + evidências da rodada 7cb8172 ainda não commitados). Ambos foram commitados em `dc3f68f` (34 arquivos, +32.121) **antes** desta matriz; nenhum código foi sujado. Registrado por transparência.

**Nenhuma falha de teste unitário/integração foi encontrada nesta rodada.** Todas as falhas são ambientais (rede) ou de lint pré-existente.

---

## 4. Testes bloqueados e motivos

| ID | Item | Motivo do bloqueio | O que destrava |
|---|---|---|---|
| BL-1 | Build do renderer do Stage (A-23) | `dist.ayaka.moe` inalcançável (ECONNRESET) | espelhar/vender os assets Live2D/VRM/Cubism com hash, ou rede que alcance o host |
| BL-2 | stage-ui exit 0 (A-28) | fetch real em `api.airi.build` fora de mock (`updateCredits`) | stub/mock de `updateCredits` nas suítes; exigência de 0 unhandled rejections |
| BL-3 | Stage projeto browser (A-26) | Playwright Chromium ausente; CDN inalcançável | CI com `playwright install --with-deps chromium` (windows/ubuntu runners) |
| BL-4 | Kokoro TTS (H-01) | `huggingface.co`/`cdn.jsdelivr.net` inalcançáveis; sem CPU-AVX garantida | máquina com rede + AVX; `tools/kokoro-smoke.mjs` com RTF medido |
| BL-5 | `get_weather` round-trip (W-17) | `open-meteo.com` externo + conversa real exige UI/chave | execução no Windows com rede (§8, Parte 6) |
| BL-6 | Tool calling ponta a ponta (B3) | round-trip nunca observado; `get_weather` depende de rede | W-17 verde + logs de `tool-call`/`tool-result` |
| BL-7 | AI Settings passos 2–15 (W-15) | sem interação de desktop (Computer Use desabilitado; `agent-browser` ausente; Launcher sem CDP autorizado) | Computer Use habilitado **ou** Launcher com CDP; chave Groq digitada na UI |
| BL-8 | Voz/STT (H-01/H-02) | microfone físico + rede de modelos | máquina de dev com mic e rede |
| BL-9 | C0–C4 (W-20) | requer pacote instalado e máquina de dev | medição no Windows (§8, Parte 10) |
| BL-10 | NSIS install/upgrade/uninstall (W-08) | Windows x64 + artefatos de build completos | roteiro §8, Parte 9 |
| BL-11 | Download do binário Electron no Linux | `release-assets.githubusercontent.com` inalcançável | seam `ELECTRON_OVERRIDE_DIST_PATH` (já usado) ou rede |
| BL-12 | `gate.test.mjs` Electron real (W-06) | `powershell.exe` + Electron real | execução no Windows |
| BL-13 | `oidc-electron` (W-07) | arquivos ausentes neste checkout | decisão B7 (entrar-ou-sair do escopo) + commit dos arquivos na Windows worktree |
| BL-14 | Groq API / descoberta de modelos (W-15.5/6) | `api.groq.com` alcançável só no Windows validado anteriormente; sem credencial aqui | chave na UI durante W-15 |

---

## 5. Cobertura dos fluxos críticos (o foco desta matriz)

Estado individual; **nada agregado**. "Offline" = prova por teste automatizado; "Runtime" = prova no produto real (Windows/hardware).

### 5.1 AI Settings — os 16 passos, um a um

Fonte do roteiro: `docs/project/LIA-AI-SETTINGS-END-TO-END-PLAN.md` §2; estados históricos citados com rótulo.

| # | Passo | Estado @ 5ec464e | Cobertura offline | Origem do estado / o que falta |
|---|---|---|---|---|
| 1 | Abrir o Launcher | **NOT RUN** (histórico: PASS PROMPT-40, SHA `2246552`, 12/11) | boot/alvo/pré-requisitos cobertos por A-09/A-14/A-19/A-21 | re-executar no Windows no SHA de beta; o PASS de 12/11 não se transfere |
| 2 | Abrir AI Settings | **BLOCKED** | telas/políticas AF-1/AF-1b cobertas por A-24/A-25 (contrato, não UI) | interação real (BL-7); screenshot sanitizado comparável ao concept `02-ai-resources.png` |
| 3 | Confirmar provider Groq | NOT RUN | catálogo/seleção cobertos por A-08/A-17/A-19 (`ai-selection-*`, `provider-config-service`) | tela com Groq `ready` e OpenAI-compatível indisponível |
| 4 | Cadastrar/substituir a chave | NOT RUN | vault/owner-channel cobertos por A-17 | campo mascarado; chave digitada **na UI**, nunca em chat/arquivo/env/log |
| 5 | Testar conexão | NOT RUN | validação de provider coberta por A-08/A-17 | resultado tipado; nenhuma chave no log |
| 6 | Descobrir modelos | NOT RUN | `model-discovery` PASS em A-24 | lista do serviço com `openai/gpt-oss-120b` |
| 7 | Selecionar `openai/gpt-oss-120b` | NOT RUN | seleção persistida coberta por A-08/A-19 | seleção visível e salva |
| 8 | Salvar (`provider.chat.preferred`) | NOT RUN | `selection-write-policy` + AF-1/AF-1b PASS (A-08/A-24/A-25) | config íntegro; recusa `stale-selection`/`selection-owned-by-launcher` na UI |
| 9 | Fechar e reabrir o Launcher | NOT RUN | — | seleção restaurada na tela |
| 10 | Confirmar que a Lia usa a seleção | NOT RUN | rota Brain/Stage coberta por A-16/A-17 (mock) | log de resolução de rota = Groq/`openai/gpt-oss-120b` (verificação de identidade, plano §4) |
| 11 | Iniciar conversa real | NOT RUN | chat pipeline PASS (A-16/A-24/A-28) | Stage sobe pela seleção |
| 12 | Confirmar resposta | NOT RUN | — | resposta real do modelo |
| 13 | Fechar e reabrir a conversa | NOT RUN | persistência de histórico coberta por A-24/A-28 (store) | conversa retorna do disco |
| 14 | Confirmar histórico | NOT RUN | idem | a resposta anterior aparece |
| 15 | Encerrar a aplicação | NOT RUN | `shutdown-coordinator` 7/7, `single-instance` PASS (A-19/A-24) | saída limpa pelo fluxo oficial |
| 16 | Confirmar ausência de órfãos | **NOT RUN** (histórico: PASS PROMPT-40) | idem A-19; gate Electron libs PASS (A-27) | lista de PIDs vazia no Windows (W-11) |

**Placar honesto @ 5ec464e: 0 PASS re-executados; 1 BLOCKED (passo 2); 15 NOT RUN; 2 PASS históricos rotulados (passos 1 e 16, SHA `2246552`).** Complementos obrigatórios do plano também pendentes: chave não reaparece após salvar; troca de host exige confirmação + chave nova; erro de rede/HTTP como mensagem tipada; screenshot vs concept.

### 5.2 Tool calling — `get_weather` (formulário read-only)

Cadeia verificada no código (esta rodada, leitura estática — nenhum comportamento foi exercido):

- Ferramentas built-in do `stage-tamagotchi` (`image_journal`, `stage_widgets`, `get_weather`) registradas com **`defaultActive: false`** (`apps/stage-tamagotchi/src/renderer/stores/tools/builtin/*.ts`).
- `collectToolReferences` (stage-ui `src/stores/chat.ts`) mescla nomes de ferramentas do histórico de mensagens + `tools` do payload.
- `getToolsByNames` (stage-ui `src/stores/ai/chat-llm/tools.ts`) resolve as definições **por nome, independentemente de `defaultActive`** — é o caminho pelo qual ferramentas não ativas podem chegar ao modelo.
- `resolveLlmTools` (`tool-resolver.ts`) ordena `customTools` antes de `activeTools`; `llm.ts` liga o `builtinToolsResolver` do core-agent.
- `@proj-airi/core-agent` (`llm-service.ts`) combina o `builtinToolsResolver` com os `tools` do request.

| Aspecto | Estado |
|---|---|
| Inventário e fiação de ferramentas (leitura de código) | **Verificado** (achado A-1 da auditoria confirmado por leitura: `defaultActive: false` não impede o envio ao modelo) |
| Cobertura unit/integração offline (registro, resolução, resolver, sanitização de argumentos) | **PASS** (A-16, A-17, A-24, A-28) |
| `get_weather` — chamada real a `open-meteo.com` (geocoding + forecast) + `executeWidgetAction` (spawn de widget) | **BLOCKED/NOT RUN** — rede externa; não executável neste sandbox |
| Round-trip completo (pedido do usuário → tool-call → tool-result → resposta final) observável em log | **NOT RUN** (nunca observado em nenhuma rodada; bloqueador B3) |
| `stage_widgets` (executeWidgetAction local) | NOT RUN em runtime; unit PASS |
| `image_journal` (depende do provider artistry) | NOT RUN; depende de provider configurado |

**Cobertura de tool calling @ 5ec464e: inventário PASS (estático) + contratos PASS (offline); execução real 0/1.**

### 5.3 Voz (Kokoro TTS / STT)

| Aspecto | Estado |
|---|---|
| Engines com mocks (`kokoro/engine|install|layout|smoke.test.ts`, `voice-service`, `transcription-*`) | **PASS** (A-17, A-24) |
| `stt-bench` core Python | **PASS** 70/70 (A-06) |
| Kokoro real: instalar engine, pré-aquecer, sintetizar, RTF | **BLOCKED** (BL-4/H-01) |
| STT real: mic → transcrição → cancelamento | **NOT RUN** (H-02) |
| Latência/qualidade percebida na conversa | **NOT RUN** |

**Cobertura de voz @ 5ec464e: contratos PASS offline; 0% runtime.**

### 5.4 Stage (windows, avatar, janelas)

| Aspecto | Estado |
|---|---|
| Suíte projeto node (Main/Renderer/Shared) — 204 arq., inclui janelas, tray, widgets, desktop overlay (contrato) | **PASS** 2.498 (A-24) |
| Typecheck (vue-tsc, heap 3 GB) | **PASS** (A-22) |
| Build main + preload | **PASS** (A-23) |
| Build renderer | **BLOCKED** (BL-1) |
| Sandbox/preload/IPC — contratos na janela de teste (helper de produção) | **PASS** (A-24/A-25; histórico PROMPT-43: gate Electron com `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`) |
| `webPreferences` efetivas na **janela de produto real** | **NOT RUN** (W-14) |
| Render real (Live2D/VRM, RX 580, DPI, 2 monitores) | **NOT RUN** (H-03) |
| Stage integrado pelo botão "Conversar com Lia" | **NOT RUN** (W-02) |
| Projeto browser (UI em Chromium real) | **BLOCKED** (BL-3) |

**Cobertura de Stage @ 5ec464e: forte offline (contratos+tipos); renderer/runtime NOT RUN.**

### 5.5 Histórico e memória

| Aspecto | Estado |
|---|---|
| Store de chat (stage-ui): send-error, failover, persistência local, `memory-chat` | **PASS** 1.140 (A-28, exit 1 por BL-2) |
| `memory-service`, `presence-service`, `vault-write/backup/process` | **PASS** (A-17) |
| Persistência após reinício do **aplicativo** (mesmo perfil) | **NOT RUN** (W-18) |
| Persistência após reinício do **SO** | **NOT RUN** |
| Histórico visível na UI após reabrir a conversa (passos 13–14) | **NOT RUN** |

**Cobertura de histórico @ 5ec464e: store PASS offline; persistência real NOT RUN.**

### 5.6 Encerramento de processos e limpeza

| Aspecto | Estado |
|---|---|
| `shutdown-coordinator` (7/7), `single-instance` (2/2) | **PASS** (A-19) |
| Gate Electron — libs auditáveis (win-hide, fixture, integrity) | **PASS** 148/148 (A-27) |
| Boot/close real pelo fluxo `Lia.bat` + tabela de processos antes/depois | **NOT RUN em 5ec464e** (histórico PROMPT-40: fechou sem órfãos, SHA `2246552`) |
| `single-instance` na segunda instância real | **NOT RUN** |
| Dados preservados após encerramento forçado (kill) | **NOT RUN** |

**Cobertura de encerramento @ 5ec464e: contratos PASS offline; runtime NOT RUN.**

### 5.7 Quadro-resumo dos fluxos críticos

| Fluxo crítico | Offline (este SHA) | Runtime (Windows/hardware) | Gate |
|---|---|---|---|
| AI Settings (16 passos) | contratos/políticas PASS | **0/16 re-executado** | B2 / C-7 / C-9 |
| Tool calling (`get_weather`) | fiação + contratos PASS | **round-trip NOT RUN** | B3 / C-11 |
| Voz (Kokoro/STT) | mocks PASS | **BLOCKED/NOT RUN** | H-01/H-02 / C-10 |
| Stage | suíte node PASS; renderer BLOCKED | **NOT RUN** | W-02 / C-5 / C-15 |
| Histórico | stores PASS | **NOT RUN** | W-18 / C-8 |
| Encerramento/órfãos | shutdown-coordinator PASS | **NOT RUN** | W-11 / C-12 |
| Distribuição NSIS | `package-windows.mjs` revisado estaticamente (`--internal-test`) | **NÃO EXECUTADO** | B4 / C-13/C-14 |
| Arquitetura (C0–C4) | decisão Cenário C registrada | **NOT RUN** | B5 |
| Segurança (sandbox/IPC/vault) | **PASS offline** (A-17…A-28) | janela real NOT RUN | C-6 |
| OIDC | unit 30/30 PASS | arquivos ausentes W-07 | B7 / C-11 |

---

## 6. Prioridades e pendências objetivas

**P0 (fecha B1/B2):** rodada Windows limpa no SHA de beta — boot, AI Settings 16/16, conversa 5 turnos, histórico, voz, encerramento sem órfãos.
**P1 (fecha B3):** tool calling `get_weather` read-only com captura de `tool-call`/`tool-result`.
**P2 (fecha B4):** NSIS — instalação limpa, upgrade, uninstall; inventário de licenças; decisão de assinatura.
**P3 (fecha B7):** OIDC — comitar o existente ou remover do escopo, com registro.
**P4 (fecha B5):** C0–C4 medidos; decisão de arquitetura com números.
**P5:** higiene — `CURRENT-STATE.md` atualizado no commit que fechar cada gate; índice de evidências.

Não repetir: pesquisa de engines, PROMPT-39 (implementado), auditoria AF-1/SEC-1 (resolvidas offline), contrato de host (publicado).

---

## 7. Procedimentos exatos para o Codex (Windows) — roteiro único

> Executar **nesta ordem**, num Windows 10/11 x64 com a máquina de desenvolvimento do projeto. Cada parte tem pré-condições, comandos e evidência exigida. **Parar e reportar (não improvisar) quando uma pré-condição faltar.** Chave Groq **somente** digitada no campo da UI — nunca por chat, arquivo, variável de ambiente ou log. Nunca usar `git reset --hard`, `git clean -fd`, force push, nem alterar configs do usuário para forçar aprovação.

### Parte 0 — Sincronização e integridade (antes de tudo)

```powershell
cd <checkout>                       # ex.: C:\dev\Lia-Project
git fetch origin
git status --porcelain              # DEVE estar limpo; se listar OIDC/chat não commitado: PARAR e comitar primeiro (protocolo §7.3 do audit)
git rev-parse HEAD                  # esperado: 5ec464edf410008e390e2da4aff32d32537eb69d
                                    # ou um SHA que CONTENHA 5ec464e + dc3f68f + 3523c3f + este relatório
git log --oneline -5
node -v                             # esperado: LTS >= 22
corepack enable
```

Evidência: `docs/reports/evidence/LIA-WINDOWS-<data>-<sha-curto>/00-ambiente.txt` com os outputs acima (sanitizados).

### Parte 1 — Bootstrap do repositório (uma vez)

```powershell
cd <checkout>\airi
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build:packages             # esperado: 33/33 tasks
cd packages\lia-core; pnpm run build; pnpm run typecheck; cd ..\..
cd apps\lia-app; pnpm run build; cd ..\..
cd apps\stage-tamagotchi; pnpm run build   # main+preload ok; renderer exige rede p/ dist.ayaka.moe (BL-1) — registrar, não contornar
```

Evidência: logs `01-install.log`, `02-build-packages.log`, `03-build-launcher.log`, `04-build-stage.log` (sanitizados).

### Parte 2 — Boot pelo fluxo oficial

```powershell
cd <checkout>
.\Lia.bat                           # duplo clique também vale; NÃO editar o .bat
```

Observar: linhas `[Lia] Starting the Lia Launcher (dev)...`, build de core/main/preload/renderer, janela `Lia` criada, `lia-app.renderer-ready` (anotar +ms), `%APPDATA%\Lia\lia-product.json` e `lia-secrets.json` materializados.

```powershell
Get-Process | Where-Object { $_.ProcessName -match 'Lia|electron' } | Format-Table Id, ProcessName, StartTime
```

Evidência: `05-boot.log` (console), PID inicial listado, horário. Se a janela não abrir ou o renderer-ready não aparecer: **registrar verbatim** e parar (não re-rodar em loop).

### Parte 3 — Introspecção de sandbox/preload na janela real (W-14)

Escolha **uma** via; se nenhuma existir, o passo é **BLOCKED** (registrar qual):

**Via A — Computer Use habilitado:** abrir DevTools → Application/Console; confirmar que `window.process`, `require` e `process.versions` **não** existem no contexto do renderer; confirmar `webPreferences` efetivas via `lia-app.renderer-ready`/logs de main (sandbox true, contextIsolation true, nodeIntegration false, preload único `index.cjs`).
**Via B — Launcher com CDP:** iniciar com `--remote-debugging-port=0` **somente** via mecanismo suportado pelo Launcher (não patchear código) e enumerar targets via CDP; confirmar as mesmas três propriedades no target da janela `Lia`.

Evidência: `06-sandbox-window.txt` com o método usado, saída observada e screenshot sanitizado da janela.

### Parte 4 — AI Settings, 16 passos (W-15)

Pré-condição dura: interação de desktop real (Computer Use) ou CDP autorizado + chave Groq válida **digitada no campo da UI**. Sem isso, passos 2–15 = **BLOCKED** e a beta continua bloqueada. Procedimento, um bloco por passo, **resultado individual obrigatório**:

1. **Abrir o Launcher** — observar `lia-app.renderer-ready` + janela. Evidência: screenshot da janela + linha do log.
2. **Abrir AI Settings** — navegar até a central de IA. Evidência: screenshot sanitizado comparável ao concept `02-ai-resources.png` (Etapa 4).
3. **Confirmar provider Groq** — Groq aparece como `ready`; OpenAI-compatível listado como indisponível. Evidência: screenshot.
4. **Cadastrar/substituir a chave** — digitar a chave **no campo mascarado**. Evidência: screenshot do campo mascarado (sem revelar valor) + confirmação de que não aparece em chat/log.
5. **Testar conexão** — clicar em testar; resultado **tipado** (sucesso/erro), nenhuma exceção crua, nenhuma chave no log. Evidência: screenshot + trecho de log sanitizado.
6. **Descobrir modelos** — confirmar a lista do serviço contém `openai/gpt-oss-120b`. Evidência: screenshot da lista.
7. **Selecionar `openai/gpt-oss-120b`** — selecionar; seleção visível. Evidência: screenshot.
8. **Salvar** — salvar; verificar `%APPDATA%\Lia\lia-product.json` contém `provider.chat.preferred` consistente (sem segredo em claro; chave só no vault). Tentar sobrescrita concorrente: a UI deve recusar com `stale-selection`; trocar provedor gerenciado deve recusar com `selection-owned-by-launcher`. Evidência: trecho JSON sanitizado + screenshots das recusas tipadas.
9. **Fechar e reabrir o Launcher** — fechar pela UI; reabrir pelo Lia.bat. Evidência: 2 screenshots + PIDs.
10. **Confirmar que a Lia usa a seleção** — iniciar conversa mínima; conferir no log de rota do Brain/Stage: provider=Groq, model=`openai/gpt-oss-120b`; `read()` do registro de seleção devolve o mesmo `definitionId/connectionId/stageProviderId/engineId`; nenhuma rota alternativa usa `GROQ_API_KEY` do ambiente. Evidência: trecho de log sanitizado + anotação do método §4 do plano (5 perguntas respondidas).
11. **Iniciar conversa real** — clicar "Conversar com Lia"; Stage sobe. Evidência: screenshot + log de boot do Stage + PID.
12. **Confirmar resposta** — enviar 1 mensagem; resposta real do modelo chega. Evidência: transcrição sanitizada.
13. **Fechar e reabrir a conversa** — fechar janela da conversa; reabrir. Evidência: screenshots.
14. **Confirmar histórico** — a troca anterior está presente. Evidência: screenshot.
15. **Encerrar a aplicação** — fechar Launcher e Stage pela UI. Evidência: console `[Lia] Closed cleanly.` + exit code.
16. **Confirmar ausência de órfãos** — `Get-Process | ? ProcessName -match 'Lia|electron'` → **vazio**; `%APPDATA%\Lia` íntegro. Evidência: saída do comando + listagem do diretório.

Complementos obrigatórios (registrar junto): a chave não reaparece após salvar (fechar/reabrir tela); troca de host exige confirmação + chave nova; erro de rede/HTTP aparece como mensagem tipada; OpenAI-compatível continua indisponível e não selecionável.

### Parte 5 — Conversa real, 5 turnos + failover (W-16)

Com a seleção ativa (Parte 4), trocar 5 mensagens cobrindo: pergunta factual simples, pergunta com contexto, "lembre que meu nome é X", recuperação desse fato no turno 4–5 (memória), e uma pergunta aberta. Se o transporte exigir failover conforme política (429/5xx), observar e registrar se ocorreu e como. Evidência: `07-conversa-5turnos.md` (transcrição sanitizada, sem chave), logs `08-conversa.log` com timestamps.

### Parte 6 — Tool calling `get_weather` (W-17, read-only) — fecha B3

Pré-condição: rede para `api.groq.com` **e** `open-meteo.com`; conversa da Parte 5 aberta.

1. Enviar exatamente: "Que tempo está fazendo agora em São Paulo?" (ou local controlado).
2. Capturar no log (nível de log de ferramentas do Stage/Launcher): evento `tool-call` com nome `get_weather` e argumentos (city/lat/lon), evento `tool-result` com o JSON de previsão, e a resposta final do modelo citando o dado real.
3. Confirmar que `get_weather` **foi** invocada (não resposta de memória do modelo).
4. Registrar o comportamento de `defaultActive: false` (achado A-1): as ferramentas não ativadas aparecem ou não no payload; se aparecerem, registrar a observação (é o comportamento atual documentado, não um PASS de política).
5. Opcional: repetir com `stage_widgets` (ação local `executeWidgetAction`, sem rede).
6. `image_journal`: somente se o provider artistry estiver configurado; caso contrário registrar **NOT RUN (provider ausente)** — não inventar.

Evidência: `09-tool-calling.log` (trechos tool-call/tool-result/resposta, sanitizados) + anotação do caminho das ferramentas no payload. Sem rede → **BLOCKED**, registrar.

### Parte 7 — Voz (Kokoro/STT) (H-01/H-02)

Pré-condição: rede para `huggingface.co`/`cdn.jsdelivr.net`; microfone físico; CPU com AVX.

```powershell
cd <checkout>\airi
node tools\kokoro-smoke.mjs            # instalar engine (se aceito), pré-aquecer, sintetizar 1 frase, medir RTF
```

STT: no app, ativar captura, falar uma frase, verificar transcrição e cancelamento. Evidência: `10-voz.txt` com RTF medido, device e resultado; **sem rede ou mic → BLOCKED**, registrar.

### Parte 8 — Encerramento e órfãos (W-11) — fecha critério C-12

```powershell
$antes = Get-Process | ? ProcessName -match 'Lia|electron' | select Id, ProcessName
# ...uso normal...
# Fechar pela UI (X / bandeja), aguardar 10 s
$depois = Get-Process | ? ProcessName -match 'Lia|electron'
if (-not $depois) { 'ZERO ORFAOS' } else { $depois | Format-Table Id, ProcessName }
```

Também: tentar abrir uma 2ª instância (`single-instance` deve focar a existente ou recusar, conforme política); verificar histórico reabre (Parte 4, passos 13–14); `%APPDATA%\Lia` íntegro. Evidência: `11-orfaos.txt` com antes/depois.

### Parte 9 — Distribuição NSIS (W-08) — fecha B4

Pré-condição: builds Launcher/Stage verdes (Parte 1) em **Windows x64**.

```powershell
cd <checkout>\airi\apps\lia-app
node scripts\package-windows.mjs --internal-test --check    # pré-requisitos
node scripts\package-windows.mjs --internal-test            # gera instalador (electron-builder)
```

Depois, com **perfil sintético** (não a máquina pessoal): (a) instalação limpa → launch → AI Settings abre; (b) upgrade sobre a instalação anterior; (c) desinstalação → `%APPDATA%\Lia` preservado; (d) assinatura Authenticode ou decisão escrita de release unsigned comunicada à equipa/usuário. Evidência: `12-nsis-*.log` (install/upgrade/uninstall), inventário de licenças, decisão de assinatura. **Não assinar sem certificado/decisão humana.**

### Parte 10 — C0–C4 (W-20) — fecha B5

Metodologia fixada (§7 do estudo de 07/11; decisões em `LIA-DESKTOP-RUNTIME-ARCHITECTURE-DECISION.md`): medir **uma** aplicação empacotada estável; registrar private bytes somados Launcher+Stage, CPU idle, tempo de início, shutdown, FPS/GPU.

| Controle | Roteiro fixo | Registrar |
|---|---|---|
| C0 — controle | desktop sem Lia; Shell sem avatar; renderer vazio transparente | baseline por processo |
| C1 — repouso estático | avatar carregado, sem animação/física/fala/IA, sob demanda | RAM/CPU (repouso) |
| C2 — repouso animado | idle/piscar/respiração/física a 15 e 30 FPS (60 opcional, separado) | RAM/CPU/FPS |
| C3 — interação | roteiro fixo olhar/clique/arraste/emoção/menu + 60 s de áudio idêntico | retomada, lip sync, CPU/GPU |
| C4 — invisível | tray / minimizado / coberto / pausa explícita | frames, timers, captura, áudio |

Sucesso/falha por controle: os números de C1 comparados ao umbral registrado na decisão de runtime (ex.: > 1.500 MiB em C1 autoriza protótipo Tauri). Evidência: `13-c0-c4.csv|json` + relatório curto.

### Parte 11 — OIDC (W-07) — fecha B7

Decidir com o responsável humano: **entra** (comitar `scripts/oidc-electron/` + IPC/recursos OIDC existentes na worktree, rodar gate, registrar PASS/FAIL) **ou sai** do escopo da beta (documentar no relatório e no `CURRENT-STATE.md`). Não deixar meia implementação solta. Evidência: commit + relatório de gate.

### Parte 12 — Publicação das evidências

```powershell
git add docs/reports/evidence/LIA-WINDOWS-<data>-<sha-curto>/
git commit -m "docs(qa): evidências da validação Windows no SHA <sha-curto>"
# NUNCA force push; branch de trabalho apenas
```

Atualizar `CURRENT-STATE.md` **no mesmo commit** que fechar cada gate. A beta só pode ser declarada depois de C-1…C-19 verdes (§9).

---

## 8. Critérios objetivos de aceite para beta (gate explícito e mensurável)

Cada item exige evidência anexada ao pacote de beta, no SHA taggeado. Estado em 5ec464e (esta rodada; estados anteriores rotulados):

| # | Critério | Como medir | Estado @ 5ec464e |
|---|---|---|---|
| C-1 | `pnpm install` reproduzível de clone limpo (instruções atualizadas ao layout subtree) | clone fresco + Parte 1 sem edição | **PARCIAL** — install/frozen-lockfile verificado (A-12); doc de instalação ainda divergente (herdado da 7cb8172 §3.5) |
| C-2 | CI verde: Python DevKit (ubuntu+windows), suítes Node/Vitest Lia-relevantes, `pnpm lint` exit 0 | CI + logs | Python PASS; Node PASS; **lint FAIL (81)** |
| C-3 | Projetos browser (stage-tamagotchi, stage-ui) verdes em CI com Chromium disponível | log CI ou `26-*-BLOCKED.log` rerodado com browser | **BLOCKED** (BL-3) |
| C-4 | Build do Stage 100% offline-reprodutível (assets Live2D/VRM/Cubism em cache/mirror com hash) | build sem rede externa | **BLOCKED** (BL-1) |
| C-5 | Launcher → Stage → conversa real (≥5 mensagens, failover conforme política) — Windows | Partes 2, 4, 5 | **NOT RUN** |
| C-6 | Sandbox/preload/IPC comprovados na **janela de produto** (não só harness) | Parte 3 | **NOT RUN** (harness PASS) |
| C-7 | AI Settings ponta a ponta: catálogo, vault, teste de conexão, seleção persistida após reinício | Parte 4, passos 2–9 | **NOT RUN** (unit PASS offline) |
| C-8 | Histórico e memória persistentes após reinício do app e do SO (opt-in/out respeitado) | Parte 4 passos 13–14 + Parte 8 | **NOT RUN** |
| C-9 | AF-1/AF-1b: seleção gerenciada não sobrescrita por escritores legados na UI real (erros tipados visíveis) | Parte 4 passo 8 | unit PASS; **UI real NOT RUN** |
| C-10 | Voz: Kokoro instala/pré-aquece/sintetiza (RTF medido) e STT captura com cancelamento — hardware real | Parte 7 | **BLOCKED/NOT RUN** |
| C-11 | OIDC real (issuer) login/logout sem regressão do flake; `get_weather` com autorização e resultado correto | Partes 6 e 11 | **NOT RUN** (oidc-link unit 30/30) |
| C-12 | Encerramento: `Lia.bat` fecha Launcher+Stage sem órfãos; dados preservados; `single-instance` respeitado | Partes 4/8 | unit PASS; **runtime NOT RUN** |
| C-13 | NSIS: instalação limpa, upgrade, uninstall sem apagar dados; inventário de licenças completo | Parte 9 | **NÃO EXECUTADO** |
| C-14 | Assinatura Authenticode (ou release unsigned explicitamente comunicado) | Parte 9 | **NOT SIGNED** (sem certificado) |
| C-15 | Hardware: RX 580 renderiza avatar; DPI/hotplug/2º monitor; coleta 1h sem regressão | Parte 10 + máquina dev | **NOT RUN** |
| C-16 | Zero unhandled rejections por fetch externo não stubbed em suítes unitárias | `28-test-stage-ui.log` com exit 0 | **FAIL** (BL-2) |
| C-17 | Zero credenciais em logs/relatórios/commits (varredura anti-segredo no release) | scan do pacote final | **PASS nesta rodada** (1 fixture sintético redigido); repetir no pacote beta |
| C-18 | `CURRENT-STATE.md` atualizado no mesmo commit que fecha cada gate | revisão de histórico | processo — pendente por gate aberto |
| C-19 | Esta matriz re-executada no SHA taggeado beta, com evidência commitada | este documento, novo run | **NOT RUN** (5ec464e ≠ beta) |

**Conclusão de beta: sob estes critérios objetivos, a Lia não está pronta.** A distância está em C-3…C-15 e C-19 (runtime, distribuição, hardware), não no núcleo unitário, que está saudável (5.651 PASS).

---

## 9. Evidências necessárias para fechar cada bloqueador (B1–B7)

| # | Bloqueador | Evidência mínima exigida para fechar | Quem | Onde a evidência entra |
|---|---|---|---|---|
| B1 | Nenhum E2E no tip | Transcript sanitizado de 5 turnos no SHA de beta + screenshots AI Settings/Stage/conversa + `renderer-ready` + logs com timestamps; passos 1–16 individuais registrados; zero órfãos (Parte 8) | Codex (Windows) | `docs/reports/evidence/LIA-WINDOWS-*/` + §7 deste doc atualizado |
| B2 | AI Settings sem gate funcional | Tabela dos 16 passos @ SHA beta (hoje: 0 PASS re-executados) + screenshots sanitizados + `read()` do registro (`definitionId/connectionId/stageProviderId/engineId`) + prova AF-1 na UI (`stale-selection`, `selection-owned-by-launcher`) + log de rota Brain/Stage = Groq/`openai/gpt-oss-120b` | Codex + usuário (chave na UI) | `docs/reports/evidence/LIA-WINDOWS-*/20-ai-settings-*.md` + `CURRENT-STATE.md` |
| B3 | Tool calling não provado | Captura `tool-call`/`tool-result` de `get_weather` com dados reais do open-meteo + resposta final citando o dado + registro do comportamento `defaultActive:false` (A-1) + rede confirmada (ou BLOCKED explícito com comando de reprodução) | Codex (Windows) | `…/09-tool-calling.log` + relatório de gate |
| B4 | Distribuição sem assinatura/instalação/licença | Logs NSIS `--internal-test` (pack/clean/upgrade/uninstall) com perfil sintético + dados preservados no uninstall + inventário de licenças completo + decisão escrita de assinatura (ou unsigned comunicado) | Arena prepara checklist; Codex executa; humano decide assinatura/licença | `…/12-nsis-*.log` + `docs/reports/LIA-BETA-READINESS-*.md` |
| B5 | Gate de arquitetura aberto | C0–C4 medidos (private bytes, CPU idle, FPS/GPU, início, shutdown) em pacote estável + veredicto registrado (Cenário C confirmado **ou** autorização de protótipo Tauri/segundo runtime com números) | Codex mede; Arena analisa | `…/13-c0-c4.*` + atualização de `LIA-DESKTOP-RUNTIME-ARCHITECTURE-DECISION.md` |
| B6 | Evidência fora do repo / worktree sujo | PROMPT-37 report + OIDC IPC/resources commitados na worktree Windows + `git status` limpo + índice em `docs/reports`; no Linux: esta rodada já comitou `dc3f68f` (7cb8172) e `3523c3f` (5ec464e) | Codex comita; Arena revisa | commits + `docs/reports/LIA-EVIDENCE-INDEX.md` (se criado) |
| B7 | OIDC indefinido | Decisão registrada **entra** (commit + gate `oidc-electron` PASS/FAIL documentado) **ou sai** (remoção formal do escopo com registro); nunca "talvez" | Decisão humana + Codex | commit + relatório + `CURRENT-STATE.md` |

---

## 10. Comparação 7cb8172 × 5ec464e (o que se preserva, o que se re-provou)

| Item | 7cb8172 (rodada anterior) | 5ec464e (esta rodada) | Transferível como PASS de 5ec464e? |
|---|---|---|---|
| Commit/escopo | 7cb8172; 153 commits de código pós-3ef6d11 | `5ec464e` = 1 commit **docs-only** sobre 7cb8172 | sim (docs) |
| Python DevKit (A-01…A-07) | PASS | **re-executado: PASS** | — |
| Contratos/QA node (A-08…A-11) | PASS (105/8/9/275) | **re-executado: mesmos números** | — |
| airi install / build:packages | PASS (33/33) | **re-executado: PASS 33/33** (frozen-lockfile desta vez) | — |
| core-agent / lia-core / lia-app | PASS | **re-executado: PASS** (156/381/353+2 skip) | — |
| Stage node suite | PASS 2.498 (2ª execução; 1ª FAIL ambiental) | **re-executado: PASS 2.498** (1 skip) | — |
| Stage typecheck | PASS (3 GB heap; 15× TS2307 antes do build:packages) | **re-executado: PASS** | — |
| Stage build main+preload / renderer | PARCIAL / BLOCKED (ayaka.moe) | **idêntico: main+preload PASS; renderer BLOCKED** | — |
| stage-ui | 1.140 PASS, exit 1 (updateCredits→api.airi.build) | **idêntico** | — |
| lint | 81 erros (preexistentes) | **idêntico: 81** | — |
| Browser project | BLOCKED (playwright) | **idêntico** | — |
| oidc-link flake | não reproduzido (30/30) | **30/30 de novo** | — |
| 16 passos AI Settings | 1/16 PASS histórico, 15 sem execução | **nenhum re-executado; rótulo honesto §5.1** | não |
| Windows/hardware/NSIS/C0–C4 | NOT RUN | **NOT RUN** | não |

**Nada se perdeu entre as rodadas** (evidências 7cb8172 preservadas em `dc3f68f`; 5ec464e em `3523c3f`).

---

## 11. Limites desta validação e o que ela NÃO prova

1. **Nenhum runtime real foi exercido.** Sem display, sem GPU utilizável, sem microfone, sem credencial: boot, janela, IPC real, UI, conversa, voz, render, NSIS, C0–C4 permanecem não provados em 5ec464e.
2. **Nenhuma conclusão se estende para além de `5ec464e`.** Qualquer SHA futuro exige nova rodada (C-19).
3. **A-25 ⊂ A-24** (5 arquivos direcionados são subconjunto da suíte Stage); contado uma vez.
4. **`lia/launcher` e `lia/stage` (raiz, A-09/A-10) não são importados por nenhum artefato do produto** (`airi/**`) — são contratos executáveis/documentação viva; o produto vive em `airi/apps/lia-app` e `stage-tamagotchi`. Decidir promover a fonte única ou rotular como referência (herdado).
5. **Dois "lia-core"** de escopos distintos e nomes colididos (`lia/core` = `@lia/contracts`; `airi/packages/lia-core` = `@lia/core`) — risco de confusão em CI/relatórios (herdado).
6. **Fronteiras por caminhos relativos** (`../../../../../lia/core/src/…`) atravessam pacotes sem `exports` — frágil a movimentação (herdado).
7. **`pnpm install` sem `--ignore-scripts` é proibido neste subtree** (simples-git-hooks cria `.git` falso); registrado para o Codex.
8. **A auditoria de 14/11 (5ec464e) é insumo, não resultado.** Onde as duas divergirem (ex.: estados de step), vale esta matriz para 5ec464e e o plano para o roteiro.
9. **Lint (81 erros) e stage-ui exit 1** são defeitos/ambiente conhecidos, **não corrigidos** por restrição de escopo ("sem alterações de código nesta etapa").
10. **Redundância observada:** camadas de voz cobrem o mesmo fluxo em 4 níveis (engine→serviço→store→UI) — manutenção alta, cobertura útil; revisar após beta.

---

## Anexo A — Comandos executados (ordem real desta rodada)

```bash
# 0. Integridade e preparo
git rev-parse HEAD                                 # 5ec464edf410008e390e2da4aff32d32537eb69d
python -m compileall -q tools                      # exit 0        → 01
python tools/ci_run_suite.py tools/test_project_cli.py   # 33 OK   → 02
python tools/ci_run_suite.py tools/test_creation.py      # 23 OK   → 03
python tools/ci_run_suite.py tools/test_lia_dev.py       # 435 OK (12 skip) → 04
python tools/ci_run_suite.py tools/test_agent_skills.py  # 7 OK    → 05
python -m unittest discover -s tools/stt-bench/tests      # 70 OK (2 skip) → 06
python Tests/tools/alethe-budget.test.py           # 10 OK (1 skip) → 07
node --experimental-strip-types --test "lia/core/test/*.test.ts"     # 105/105 → 08
node --experimental-strip-types --test "lia/launcher/test/*.test.ts" # 8/8 → 09
node --experimental-strip-types --test "lia/stage/test/*.test.ts"    # 9/9 → 10
node --test "Tests/tools/*.test.mjs"               # 275/275 → 11

# 1. airi/ — instalação e builds (shim pnpm→corepack em /tmp/pnpm-shim)
cd airi && corepack pnpm install --frozen-lockfile --ignore-scripts  # exit 0, 56,9s → 12
PATH=/tmp/pnpm-shim:$PATH NODE_OPTIONS=--max-old-space-size=3072 corepack pnpm run build:packages  # 33/33 → 13
corepack pnpm --filter @proj-airi/core-agent run build   # exit 0 → 14
(cd packages/lia-core && corepack pnpm run build)        # exit 0 → 15

# 2. Suítes e typechecks
corepack pnpm exec vitest run --root packages/core-agent --project @proj-airi/core-agent  # 156 → 16
(cd packages/lia-core && corepack pnpm exec vitest run && corepack pnpm run typecheck)    # 381 / exit 0 → 17, 18
(cd apps/lia-app && corepack pnpm exec vitest run && corepack pnpm run typecheck && corepack pnpm run build)  # 353+2skip / 0 / 0 → 19, 20, 21
(cd apps/stage-tamagotchi && NODE_OPTIONS=--max-old-space-size=3072 corepack pnpm exec vue-tsc --noEmit)      # exit 0 → 22
(cd apps/stage-tamagotchi && PATH=/tmp/pnpm-shim:$PATH corepack pnpm run build)  # exit 1 (renderer, BL-1) → 23
(cd apps/stage-tamagotchi && PATH=/tmp/pnpm-shim:$PATH ELECTRON_OVERRIDE_DIST_PATH=/tmp/electron-override corepack pnpm exec vitest run --config vitest.config.ts --project node)  # 2.498 → 24
(cd apps/stage-tamagotchi && ELECTRON_OVERRIDE_DIST_PATH=/tmp/electron-override corepack pnpm exec vitest run --config vitest.config.ts \
   src/main/services/lia/provider-config-service.test.ts src/main/windows/secure-web-preferences.test.ts \
   src/preload/ipc-channel-policy.test.ts src/preload/shared.test.ts src/main/windows/desktop-overlay/window-contract.test.ts)  # 13/13 → 25
(cd apps/stage-tamagotchi && timeout 90 corepack pnpm exec vitest run --config vitest.config.ts --project browser)  # BLOCKED → 26
(cd apps/stage-tamagotchi && node --test scripts/provider-runtime-electron/lib/*.test.mjs scripts/provider-runtime-electron/gate-integrity.test.mjs)  # 148 → 27
(cd packages/stage-ui && PATH=/tmp/pnpm-shim:$PATH ELECTRON_OVERRIDE_DIST_PATH=/tmp/electron-override NODE_OPTIONS=--max-old-space-size=3072 corepack pnpm exec vitest run --config vitest.config.ts --project node)  # 1.140, exit 1 (BL-2) → 28

# 3. Lint
(cd airi && timeout 600 PATH=/tmp/pnpm-shim:$PATH corepack pnpm lint)  # exit 1 — 81 erros → 29
```

## Anexo B — Integridade, escopo e desvios

- **Somente documentação** foi adicionada (`docs/reports/**`): este relatório + 30 arquivos de evidência. Nenhuma linha de código, teste, build config, lockfile ou asset foi alterada.
- Evidência da rodada 7cb8172 **preservada e commitada** em `dc3f68f`; evidência desta rodada em `3523c3f`.
- Logs commitados passaram por varredura anti-segredo. Única ocorrência: fixture sintético `gsk-ABCDEFGHIJKLMNOP1234567890` do `hearing.test.ts` (teste que **afirma** que a chave não vaza nos logs) — redigido para `gsk-REDACTED-SYNTHETIC-FIXTURE` em `24-test-stage-node.log`. Nenhum segredo real.
- `00-environment.txt` registrou worktree com 3 arquivos não rastreados no instante da captura (o relatório/evidências 7cb8172); ambos commitados em `dc3f68f` na mesma sessão, antes deste relatório.
- Electron nos testes node: seam oficial (`ELECTRON_OVERRIDE_DIST_PATH` → `/tmp/electron-override`, stub documentado; `ELECTRON_RUN_AS_NODE` não aplicável). Nenhum binário executado; IPC mockado.
- `pnpm install` executado **sempre** com `--ignore-scripts` (pós-instalação do simples-git-hooks criaria `.git` falso no subtree).
- `pnpm lint` e `stage-ui` foram executados e **falharam** — registrados como falha/parcial, nunca como PASS.
- Divergência herdada do caminho documentado de instalação (§3.5 da rodada 7cb8172) **não corrigida** (fora de escopo).
- `git`/`gh` usados apenas na branch `arena/18f50ae7-lia-project`; sem force push, reset, clean ou stash; sem merge em `main` ou na branch principal.

## Anexo C — Classificação final

| Eixo | Estado final @ 5ec464e |
|---|---|
| LINUX/ARENA — suítes automatizadas | **PASS** (5.651/5.651 executados; 18 skips; 0 FAIL) |
| LINUX/ARENA — builds | Launcher/core-agent/lia-core/pacotes **PASS**; Stage main+preload **PASS**; renderer **BLOCKED** |
| LINUX/ARENA — lint/browser/stage-ui exit | **FAIL/BLOCKED** (pré-existentes ou rede), registrados sem correção |
| WINDOWS/CODEX — boot, AI Settings, Stage, conversa, tool calling, histórico, órfãos, NSIS, C0–C4, OIDC | **NOT RUN** (roteiro §7 exato; nada simulado) |
| HARDWARE — GPU/RX 580, mic, Kokoro RTF, coleta 1h | **BLOCKED/NOT RUN** |
| Beta | **NÃO APROVADA.** Para declarar beta: C-1…C-19 verdes no SHA taggeado, com evidência commitada por gate (§8/§9). |
