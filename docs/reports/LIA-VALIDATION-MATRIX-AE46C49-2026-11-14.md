# Lia-Project — Matriz de validação do SHA `ae46c495d7da7cd33f4b4da8f4e8cc95b0a867b6`

> **Nota de supersessão (2026-11-14, SHA `407300b8baa56b0ed8d14b7b2c0628222754e51f`):** o tip do desenvolvimento avançou para `407300b` (delta **docs-only** em relação a `ae46c49` — verificado em `docs/reports/evidence/LIA-QA-VALIDATION-407300b-2026-11-14/06-delta-ae46c49-407300b.log`). A matriz vigente passou a ser [`LIA-VALIDATION-MATRIX-407300B-2026-11-14.md`](LIA-VALIDATION-MATRIX-407300B-2026-11-14.md). **Os resultados abaixo continuam válidos apenas para `ae46c49`** e são preservados como evidência histórica; não se transferem para a beta. As evidências deste SHA permanecem em `docs/reports/evidence/LIA-QA-VALIDATION-ae46c49-2026-11-14/`.

**Data:** 2026-11-14 · **Autor:** Arena (Linux/WSL, sem display, sem credenciais) · **Branch:** `arena/18f50ae7-lia-project`
**SHA de referência:** `ae46c495d7da7cd33f4b4da8f4e8cc95b0a867b6` (`ae46c49` — “docs: record the A-1 enablement decision”), tip de `arena/01a10290-lia-project` no momento desta tarefa.
**Delta `5ec464e → ae46c49`:** 2 commits — `f3facdf` **fix(stage-ui): make tool enablement a real gate (A-1)** (código + testes) e `ae46c49` **docs: record the A-1 enablement decision**. Nenhum outro arquivo do produto mudou.
**Escopo desta rodada:** re-executar **somente** o que o delta alcança (stage-ui e seu consumidor, o Stage) + builds de prerequisito; o restante de **5ec464e** foi **carregado adiante** (constraint explícita: não repetir rodada completa sem necessidade com evidência válida e recente) e está rotulado como tal em §2 e §10 — nunca como PASS deste SHA sem re-execução.

Regra aplicada do início ao fim: **nenhum teste foi declarado PASS sem execução real e registrada, e nenhum resultado de Windows foi simulado no Linux.** Resultados históricos (PROMPT-40/42/43/44) são citados como histórico rotulado.

---

## 0. Resumo executivo

| Pergunta | Resposta |
|---|---|
| O núcleo offline continua verde neste SHA? | **Sim, re-verificado no que mudou e carregado adiante no que não mudou.** Total único: **5.664 PASS / 18 skipped / 0 FAIL** (stage-ui 1.140→1.153 por causa dos 13 testes A-1 novos). |
| O achado A-1 está corrigido em `ae46c49`? | **Sim, por construção e por teste.** `enabledById` + `setToolEnabled()` no store; ferramenta desabilitada sai de `activeTools`, não resolve por `getToolsByNames` (envio e rerun) e recusa execução (`ToolDisabledError`). Evidência: A-1 targeted 31/31, built-in 1/1, suite stage-ui 1.153, Stage node 2.498. Round-trip real continua **NOT RUN**. |
| A beta pode ser declarada? | **Não.** AI Settings 0/16 re-executados; tool calling sem round-trip; voz/Stage/histórico/órfãos/NSIS NOT RUN; lint FAIL (81); stage-ui exit 1; Stage renderer BLOCKED. |
| O que mudou para o Codex? | Apenas o contrato de ferramentas (§5.2): enabled por padrão; disable = apresentação **e** execução recusadas. Roteiro Windows atualizado (§7, Parte 6). |

**Veredicto:** a Lia em `ae46c49` continua **NÃO aprovada para beta**. O fix A-1 fecha o achado de auditoria **em código e testes**; ele não substitui a prova de runtime (Windows + rede + credencial na UI) nem fecha o bloqueador B3 (tool calling round-trip).

---

## 1. Registro de integridade e escopo

| Item | Valor |
|---|---|
| HEAD executado (worktree destacada `ae46c49-validation`, removida após a coleta) | `ae46c495d7da7cd33f4b4da8f4e8cc95b0a867b6` (`git status --porcelain` = 0) — `00-environment.txt` |
| HEAD da branch de entrega neste momento | branch `arena/18f50ae7-lia-project`; evidências commitadas nesta sessão; relatório commitado a seguir |
| Sistema / toolchain | Linux 6.1.158 x86_64; Node v22.22.3; npm 10.9.8; Python 3.11.2; pnpm 11.24.0 (corepack, `packageManager` do repo) |
| airi instalado | `corepack pnpm install --frozen-lockfile --ignore-scripts` (EXIT=0, 13,2 s) — `01-airi-install.log` |
| Evidência desta rodada | `docs/reports/evidence/LIA-QA-VALIDATION-ae46c49-2026-11-14/` (11 arquivos, ~1,7 MB), commitada na branch de sessão |
| Carry-forward de 5ec464e (rótulo: **não re-executado**) | Python DevKit, contratos Lia, QA harness, core-agent/lia-core/lia-app, builds Launcher/core — ver §2.A e §10; evidência commitada em `3523c3f` e no relatório `LIA-VALIDATION-MATRIX-5EC464E-2026-11-14.md` |
| Alterações de código | **Nenhuma.** Só `docs/reports/**` (evidência + este relatório). O código `f3facdf`/`ae46c49` **não foi tocado**. |
| Desvios/armadilhas | (a) fixture sintético `gsk-…` do `hearing.test.ts` redigido nos logs commitados (`gsk-REDACTED-SYNTHETIC-FIXTURE`); (b) logs gerados em worktree fora do checkout principal — os logs citam o caminho da worktree, preservado para fidelidade; (c) `ELECTRON_OVERRIDE_DIST_PATH` para o projeto node do Stage; (d) `--frozen-lockfile` usado (stricter) |

---

## 2. Matriz geral — três classes de ambiente

Estado: **PASS** (executado) · **FAIL** (executado, falhou) · **BLOCKED** (pré-condição ausente) · **NOT RUN** (não executado) · **Carry-forward** = executado em 5ec464e (2026-11-14), válido e recente, **não re-executado** (delta docs-only ou fora do alcance de `f3facdf`).

### 2.A — LINUX/ARENA

| ID | Funcionalidade | Execução @ ae46c49 | Resultado | Evidência |
|---|---|---|---|---|
| A-01 | DevKit byte-compile | carry-forward 5ec464e | PASS exit 0 | `LIA-QA-VALIDATION-5ec464e-2026-11-14/01` |
| A-02 | test_project_cli | carry-forward | PASS 33/33 | idem /02 |
| A-03 | test_creation | carry-forward | PASS 23/23 | idem /03 |
| A-04 | test_lia_dev | carry-forward | PASS 435/435 (12 skip) | idem /04 |
| A-05 | test_agent_skills | carry-forward | PASS 7/7 | idem /05 |
| A-06 | stt-bench (stubs) | carry-forward | PASS 70/70 (2 skip) | idem /06 |
| A-07 | alethe-budget | carry-forward | PASS 10/10 (1 skip) | idem /07 |
| A-08 | Contratos Lia (105) | carry-forward | PASS 105/105 | idem /08 |
| A-09 | Launcher alvo do Stage | carry-forward | PASS 8/8 | idem /09 |
| A-10 | Stage host | carry-forward | PASS 9/9 | idem /10 |
| A-11 | QA harness | carry-forward | PASS 275/275 | idem /11 |
| A-12 | airi install (frozen) | **re-executado** | PASS (exit 0, 13,2 s) | `01-airi-install.log` |
| A-13 | build:packages | **re-executado** | PASS 33/33 | `02-build-packages.log` |
| A-14 | core-agent build+suite | carry-forward | PASS (exit 0; 156/156) | 5ec /14, /16 |
| A-15 | lia-core build+suite+typecheck | carry-forward | PASS (exit 0; 381/381; tsc 0) | 5ec /15, /17, /18 |
| A-16 | **Launcher** build+suite+typecheck | carry-forward | PASS (exit 0; 353/353 +2 skip; tsc 0) — **não é consumidor de stage-ui** (verificado) | 5ec /19–/21 |
| A-17 | Stage — typecheck | **re-executado** | PASS (vue-tsc exit 0) | `08-typecheck-stage.log` |
| A-18 | Stage — build | **re-executado** | **PARCIAL/BLOCKED** — main `✓ built in 1.42s` + preload (`✓ built in 18ms`); **renderer FAIL**: `unplugin-fetch` GET `…/hiyori_pro_zh.zip` → ECONNRESET (mesmo host/causa de 5ec464e) | `09-build-stage.log` |
| A-19 | Stage — suite projeto node (Main/Renderer/Shared) | **re-executado** | PASS **2.498/2.498** (1 skip; 204 arq.; oidc-link 30/30 estável; sem regressão do A-1) | `05-test-stage-node.log` |
| A-20 | Stage — regressões direcionadas | carry-forward | PASS 13/13 | 5ec /25 |
| A-21 | Stage — projeto browser | carry-forward | **BLOCKED** (Playwright ausente; CDN inalcançável) | 5ec /26 |
| A-22 | Stage Electron gate libs | carry-forward | PASS 148/148 | 5ec /27 |
| A-23 | stage-ui — suite projeto node | **re-executado** | **PASS PARCIAL** — **1.153/1.153** (+13 vs 5ec464e), **exit 1** por 1 unhandled rejection (`updateCredits` → `api.airi.build`, ECONNRESET — mesmo defeito ambiental BL-2; nenhum teste falhou) | `04-test-stage-ui.log` |
| A-24 | **A-1 targeted** (tools 13, tool-resolver 11, tool-call-rerun 7) | **re-executado** | PASS 31/31 | `03-a1-targeted.log` |
| A-25 | Built-in tools gate (`built-in.test.ts`) | **re-executado** | PASS 1/1 | `10-builtin-tools.log` |
| A-26 | stage-ui — typecheck | **re-executado** | PASS (vue-tsc exit 0) | `07-typecheck-stage-ui.log` |
| A-27 | Lint do monorepo | **re-executado** | **FAIL** — **81 erros** / 10 warnings (3.490 arquivos); **nenhum em arquivo do A-1**; 59 auto-fixáveis; pré-existente | `06-lint.log` |

**Totais únicos @ ae46c49 (com carry-forward de 5ec464e): 5.664 PASS / 18 skipped / 0 FAIL.** Detalhe: 5.651 (5ec464e) − 1.140 (stage-ui, substituído) + 1.153 (stage-ui, A-1) = 5.664. (A-24/A-25 ⊂ A-19; não somados em dobro.)

### 2.B — WINDOWS/CODEX (não executados; não simulados)

Sem mudança de estado em relação à matriz 5ec464e (nenhuma prova de runtime podia ser produzida aqui):

| ID | Item | Pré-condição | Estado |
|---|---|---|---|
| W-01 | Boot real por `Lia.bat` (janela, `renderer-ready`) | Windows + Node LTS + `corepack enable` | NOT RUN (histórico PROMPT-40, outro SHA) |
| W-02 | Stage integrado pelo botão “Conversar com Lia” | W-01 + Stage build | NOT RUN |
| W-03 | `Tests\LiaTests.bat` opções 2–4 | Windows + máquina de dev | NOT RUN (harness A-11 coberto estaticamente) |
| W-04 | `Tests\LiaBenchmark.bat` completo | Windows + rede | NOT RUN |
| W-05 | `Tools\stt-bench\run-stt-bench.*` | Windows + faster-whisper | NOT RUN (core Python PASS A-06) |
| W-06 | `gate.test.mjs` Electron real (fixture HTTP, PowerShell) | powershell.exe + Electron | NOT RUN (libs A-22 PASS) |
| W-07 | Gate `oidc-electron` | **arquivos ausentes neste checkout** | BLOCKED — impossível (decisão B7) |
| W-08 | NSIS: `package-windows.mjs --internal-test` + instalação limpa/upgrade/uninstall | Windows x64 + builds verdes | NÃO EXECUTADO |
| W-09 | CI `devflow-ci.yml` metade windows-latest | runner Windows | NOT RUN |
| W-10 | 12 testes Windows-only do `test_lia_dev.py` | Windows | skipped por design |
| W-11 | Encerramento + zero órfãos (Launcher+Stage) | W-01/W-02 + PowerShell | NOT RUN (histórico PROMPT-40, outro SHA) |
| W-12 | Assinatura Authenticode | certificado (inexistente) | NOT SIGNED |
| W-13 | `DevKit.bat` interativo | Windows interativo | NOT RUN (lógica A-02/03/04 PASS) |
| W-14 | Sandbox/preload **na janela de produto** | W-01 + Computer Use **ou** CDP | NOT RUN |
| W-15 | AI Settings — 16 passos (§5.1) | W-01 + interação + chave **na UI** | 0/16 re-executados; passos 1/16 históricos rotulados |
| W-16 | Conversa real ≥5 turnos | W-15 | NOT RUN |
| W-17 | Tool calling `get_weather` round-trip (§5.2) | W-16 + open-meteo.com + Groq | NOT RUN |
| W-18 | Histórico/memória após reinício | W-16 + restart | NOT RUN |
| W-19 | OIDC real (issuer) | W-07 | NOT RUN (oidc-link unit 30/30, A-19) |
| W-20 | C0–C4 (RAM/CPU/FPS/início/shutdown) | máquina dev + pacote | NOT RUN |

### 2.C — HARDWARE

| ID | Item | Motivo | Estado |
|---|---|---|---|
| H-01 | Kokoro TTS real (instalação, pré-aquecimento, síntese, RTF) | rede p/ HuggingFace/jsDelivr + CPU AVX | BLOCKED (rede) |
| H-02 | STT real (mic → transcrição → cancelamento) | mic físico | NOT RUN |
| H-03 | RX 580 / Live2D — render, DPI, múltiplos monitores | GPU física (só adaptador virtual Parsec relatado antes) | NOT RUN |
| H-04 | Hotplug/resolução/escala, click-through, foco | sessões interativas | NOT RUN |
| H-05 | Coleta 1h (`--soak-seconds=3600`) | sessão longa | NOT RUN |

---

## 3. Falhas encontradas (executadas)

1. **Stage — build exit 1 (renderer)** — `09-build-stage.log`: main+preload constroem; renderer falha em `unplugin-fetch` (`hiyori_pro_zh.zip`, ECONNRESET, `dist.ayaka.moe`). **BLOCKED por rede**, não defeito. Bloqueador C-4.
2. **stage-ui — exit 1** — `04-test-stage-ui.log`: 1.153/1.153 testes PASS; **1 unhandled rejection** (`updateCredits` → `api.airi.build`, ECONNRESET). Idêntico ao defeito ambiental BL-2 da rodada 7cb8172/5ec464e; **nenhum teste falhou**; não corrigido nesta etapa. Bloqueador C-16.
3. **`pnpm lint` — exit 1** — `06-lint.log`: 81 erros (10 warnings; 3.490 arquivos; 59 auto-fixáveis). Pré-existente; **nenhum erro nos arquivos do A-1** (verificado nos logs: `chat-llm/*`, `tool-name.ts`, `tool-call-rerun.ts` ausentes da lista de erros).
4. **Stage browser gate** — carry-forward, BLOCKED (Playwright/CDN).
5. **`00-environment.txt`** — 0 arquivos sujos na captura (worktree destacada). Nenhuma alteração de código.

**Nenhuma falha de teste unitário/integração neste SHA.** As falhas acima são ambientais/rede ou de lint pré-existente.

---

## 4. Testes bloqueados e motivos

| ID | Item | Motivo | Destrava com |
|---|---|---|---|
| BL-1 | Renderer do Stage (A-18) | `dist.ayaka.moe` inalcançável (ECONNRESET) | assets Live2D/VRM/Cubism em cache/mirror com hash; ou rede |
| BL-2 | stage-ui exit 0 (A-23) | `updateCredits` dispara fetch real fora de mock (`api.airi.build`) | stub/mock de `updateCredits`; meta: 0 unhandled rejections |
| BL-3 | Stage browser (A-21) | Playwright Chromium ausente; `cdn.playwright.dev` inalcançável | CI c/ `playwright install --with-deps chromium` |
| BL-4 | Kokoro TTS (H-01) | `huggingface.co`/`cdn.jsdelivr.net` inalcançáveis | máquina com rede + AVX |
| BL-5 | `get_weather` round-trip (W-17) | rede externa + UI/chave | execução no Windows (§7 Parte 6) |
| BL-6 | Tool calling ponta a ponta | round-trip nunca observado (B3) | W-17 verde; logs tool-call/tool-result |
| BL-7 | AI Settings 2–15 (W-15) | sem interação de desktop (Computer Use OFF; `agent-browser` ausente; CDP não autorizado) | Computer Use **ou** CDP + chave Groq **na UI** |
| BL-8 | Voz/STT (H-01/H-02) | mic + rede de modelos | máquina de dev |
| BL-9 | C0–C4 (W-20) | pacote + máquina dev | §7 Parte 10 |
| BL-10 | NSIS (W-08) | Windows x64 | §7 Parte 9 |
| BL-11 | Binário Electron no Linux | `release-assets.githubusercontent.com` inalcançável | seam `ELECTRON_OVERRIDE_DIST_PATH` (já usado) |
| BL-12 | `gate.test.mjs` (W-06) | `powershell.exe` + Electron real | Windows |
| BL-13 | `oidc-electron` (W-07) | arquivos ausentes neste checkout | decisão B7 + commit |
| BL-14 | Groq API / descoberta de modelos (W-15) | `api.groq.com`; sem credencial aqui | chave na UI durante W-15 |

---

## 5. Cobertura dos fluxos críticos

### 5.1 AI Settings — os 16 passos, individualmente (SHA `ae46c49`)

| # | Passo | Estado @ ae46c49 | Cobertura offline | Origem/o que falta |
|---|---|---|---|---|
| 1 | Abrir o Launcher | **NOT RUN** (hist.: PASS PROMPT-40, SHA `2246552`) | boot/alvo/pré-req A-09/A-14/A-16 | re-executar no Windows no SHA de beta; não transfere |
| 2 | Abrir AI Settings | **BLOCKED** | AF-1/AF-1b cobertos por A-19/A-20 (contrato, não UI) | interação real; screenshot vs concept `02-ai-resources.png` |
| 3 | Confirmar provider Groq | NOT RUN | catálogo A-08/A-15/A-16 | tela com Groq `ready`, OpenAI-compatível indisponível |
| 4 | Cadastrar/substituir chave | NOT RUN | vault A-15 | campo mascarado; chave **na UI** |
| 5 | Testar conexão | NOT RUN | validação A-08/A-15 | resultado tipado; sem chave no log |
| 6 | Descobrir modelos | NOT RUN | model-discovery A-19 | lista c/ `openai/gpt-oss-120b` |
| 7 | Selecionar o modelo | NOT RUN | seleção A-08/A-16 | visível e salvo |
| 8 | Salvar (`provider.chat.preferred`) | NOT RUN | `selection-write-policy` + AF-1/AF-1b PASS (A-08/A-19/A-20) | config íntegro; recusas tipadas na UI |
| 9 | Fechar e reabrir o Launcher | NOT RUN | — | seleção restaurada |
| 10 | Confirmar que a Lia usa a seleção | NOT RUN | rota Brain A-14/A-15 (mock) | log de rota = Groq/`openai/gpt-oss-120b`; verificação §4 do plano |
| 11 | Iniciar conversa real | NOT RUN | chat pipeline A-14/A-19/A-23 | Stage sobe pela seleção |
| 12 | Confirmar resposta | NOT RUN | — | resposta real do modelo |
| 13 | Fechar e reabrir a conversa | NOT RUN | persistência A-19/A-23 (store) | reabre do disco |
| 14 | Confirmar histórico | NOT RUN | idem | troca anterior presente |
| 15 | Encerrar a aplicação | NOT RUN | shutdown A-16/A-19 | saída limpa pelo fluxo oficial |
| 16 | Ausência de órfãos | **NOT RUN** (hist.: PASS PROMPT-40) | A-16; A-22 | lista de PIDs vazia no Windows |

**Placar @ ae46c49: 0/16 re-executados; passo 2 BLOCKED; passos 1/16 históricos rotulados; 3–15 NOT RUN.** Complementos do plano (chave não reaparece; troca de host exige confirmação; erro tipado; screenshot vs concept): pendentes.

### 5.2 Tool calling — estado após o fix A-1 (`f3facdf`)

O que o fix estabelece (verificado por leitura + testes, não por execução real ainda):

- `defaultActive` permanece **inclusão ambiente** apenas (contrato upstream intacto): a ferramenta não entra por omissão no contexto.
- **`enabledById` + `setToolEnabled()`** no `useLlmToolsStore` são o interruptor real: desabilitada ⇒ ausente de `activeTools`, **não resolvida** por `getToolsByNames` (caminho único do envio **e** do rerun) e execução recusada via `ToolDisabledError` mesmo em objeto capturado antes da mudança.
- IDs desconhecidos permanecem **habilitados** (só `false` explícito desabilita); re-registro/refresh **não** reverte escolha explícita.
- **Decisão de produto (14/11/2026, registrada em `ae46c49`):** `get_weather`, `image_journal` e widgets permanecem **habilitados**; nada desligado; sem UI de ativação nesta rodada; persistência do estado habilitado fica para a tarefa seguinte (infra de leitura/mutação exposta no store).
- `built-in.ts` ainda registra as 3 ferramentas com `defaultActive: false` (sem mudança de comportamento para o usuário).

| Aspecto | Estado |
|---|---|
| Regressão do gate A-1 (unit/integração) | **PASS** — tools 13/13, tool-resolver 11/11, rerun 7/7, built-in 1/1 (A-24/A-25) |
| Envio explícito de ferramenta desabilitada → recusa | **PASS** (testes: `ToolDisabledError`, ausência em `getToolsByNames`) |
| Round-trip `get_weather` real (open-meteo.com) | **NOT RUN** — rede externa + UI (BL-5/BL-6; B3) |
| `stage_widgets` (executeWidgetAction local) | NOT RUN runtime; unit PASS |
| `image_journal` (provider artistry) | NOT RUN (provider ausente) |
| Registro `defaultActive` vs `enabledById` (UI futura) | infra no store; UI/persistência na próxima tarefa |

**Cobertura de tool calling @ ae46c49: contratos PASS (offline); round-trip real 0/1. O achado de auditoria A-1 está fechado em código; o bloqueador B3 continua aberto.**

### 5.3 Voz (Kokoro/STT)

| Aspecto | Estado |
|---|---|
| Engines com mocks | **PASS** (carry-forward A-15/A-19) |
| `stt-bench` core Python | **PASS** 70/70 (carry-forward A-06) |
| Kokoro real + RTF | **BLOCKED** (BL-4/H-01) |
| STT real (mic) | **NOT RUN** (H-02) |
| Voz na conversa (latência/qualidade) | **NOT RUN** |

**Cobertura de voz: contratos PASS offline; 0% runtime.**

### 5.4 Stage

| Aspecto | Estado |
|---|---|
| Suite projeto node (204 arq.) | **PASS 2.498** (re-executado; sem regressão do A-1) |
| Typecheck (vue-tsc 3 GB) | **PASS** |
| Build main+preload | **PASS** |
| Build renderer | **BLOCKED** (BL-1) |
| Sandbox/preload na **janela de produto** | **NOT RUN** (W-14; harness histórico PROMPT-43) |
| Render real (Live2D/VRM, RX 580, DPI) | **NOT RUN** (H-03) |
| Projeto browser | **BLOCKED** (BL-3) |

**Cobertura de Stage: forte offline; runtime NOT RUN.**

### 5.5 Histórico e memória

| Aspecto | Estado |
|---|---|
| Stores de chat/memória (stage-ui) | **PASS 1.153** (exit 1 por BL-2; nenhum teste falha) |
| `memory-service`, `presence-service`, vault | **PASS** (carry-forward A-15) |
| Persistência após reinício do app / do SO | **NOT RUN** (W-18) |
| Histórico visível na UI (passos 13–14) | **NOT RUN** |

**Cobertura de histórico: store PASS offline; persistência real NOT RUN.**

### 5.6 Encerramento de processos

| Aspecto | Estado |
|---|---|
| `shutdown-coordinator` (7/7), `single-instance` (2/2) | **PASS** (carry-forward A-16) |
| Gate Electron libs | **PASS** 148/148 (carry-forward A-22) |
| Boot/close real `Lia.bat` + tabela de processos | **NOT RUN** (hist. PROMPT-40, outro SHA) |
| `single-instance` na 2ª instância real | **NOT RUN** |
| Dados preservados após encerramento forçado | **NOT RUN** |

**Cobertura de encerramento: contratos PASS offline; runtime NOT RUN.**

### 5.7 Resumo dos fluxos críticos

| Fluxo | Offline @ ae46c49 | Runtime | Gate |
|---|---|---|---|
| AI Settings (16) | contratos/políticas PASS | **0/16** | B2 / C-7 / C-9 |
| Tool calling | gate A-1 PASS; contratos PASS | **round-trip NOT RUN** | B3 / C-11 |
| Voz | mocks PASS | **BLOCKED/NOT RUN** | H-01/H-02 / C-10 |
| Stage | suite node PASS; renderer BLOCKED | **NOT RUN** | W-02 / C-5 / C-15 |
| Histórico | stores PASS | **NOT RUN** | W-18 / C-8 |
| Encerramento | coordinator PASS | **NOT RUN** | W-11 / C-12 |
| Distribuição NSIS | pacote revisado estaticamente | **NÃO EXECUTADO** | B4 / C-13/C-14 |
| Arquitetura (C0–C4) | decisão Cenário C | **NOT RUN** | B5 |
| Segurança (sandbox/IPC/vault) | **PASS offline** | janela real NOT RUN | C-6 |
| OIDC | unit 30/30 (carry-forward) | arquivos ausentes (W-07) | B7 / C-11 |

---

## 6. Testes duplicados e lacunas de cobertura

**Duplicados/sobreposições identificados:**
1. **A-24/A-25 ⊂ A-19** — os 5 arquivos direcionados (incl. `built-in.test.ts`) são subconjunto da suite Stage; contados uma vez no total.
2. **AF-1b direcionado (A-20) ⊂ suite Stage (A-19)** — útil como sinal rápido, redundante como cobertura.
3. **`lia/launcher` e `lia/stage` (raiz, A-09/A-10) não são importados por nenhum artefato do produto** (`airi/**`) — são contratos executáveis/documentação viva; o produto vive em `airi/apps/lia-app` e `stage-tamagotchi`. Risco de divergência contrato×implementação. Decisão pendente: promover a fonte única ou rotular como referência.
4. **Dois "lia-core"** colididos (`lia/core` = `@lia/contracts`; `airi/packages/lia-core` = `@lia/core`) — confusão em CI/relatórios.
5. **Camadas de voz 4×** (engine→serviço→store→UI) cobrem o mesmo fluxo — manutenção alta, classes de defeito diferentes.
6. **`test_lia_dev.py` (435) e `Tests/tools` (275) exercitam o harness, não o produto** — não contam como prova de produto.

**Lacunas de cobertura (não existe teste automatizado para…):**
1. **Runtime/E2E de produto** — boot, UI real, IPC real, reinício; toda a Fase B (§7) existe exatamente para fechar esta lacuna.
2. **Round-trip de tool calling** — nenhuma suíte observa `get_weather` de ponta a ponta; nem com mock de rede em nível de diálogo.
3. **AI Settings UI** — nenhuma asserção automatizada sobre a tela real (catálogo renderizado, mascaramento, mensagens tipadas visíveis).
4. **Voz real** (RTF, cancelamento, latência) — depende de hardware/rede.
5. **Instalação/upgrade/uninstall** (NSIS) — nenhuma automação cobre o ciclo; só revisão estática.
6. **Persistência pós-reinício do SO** — não há teste de boot com perfil real.
7. **Browser gates** — chromium ausente (BL-3); cobertura visual/E2E de store inexistente aqui.
8. **`updateCredits`/fetches externos não stubbed** — não há política de zero unhandled rejections; C-16 permanece FAIL.
9. **C0–C4** — nenhuma coleta de RAM/CPU/FPS automatizada; medição manual apenas.
10. **Fronteiras por caminho relativo** (`../../../../../lia/core/src/…`) atravessam pacotes sem `exports` — frágil; sem teste de contenção.

---

## 7. Testes Windows pendentes e roteiro detalhado para o Codex

**Pendentes (pendentes há 3 rodadas):** W-01…W-20 — nenhum foi executado neste SHA nem em `5ec464e`. **Prioridade absoluta: o roteiro abaixo, nesta ordem.** Executar num Windows 10/11 x64, na máquina de desenvolvimento, num checkout limpo. **Parar e reportar (não improvisar) quando uma pré-condição faltar.** Chave Groq **somente** digitada no campo da UI — nunca por chat, arquivo, variável ou log. Nunca `reset --hard`/`clean -fd`/force push.

### Parte 0 — Sincronização e integridade
```powershell
cd <checkout>                     # ex.: C:\dev\Lia-Project
git fetch origin
git status --porcelain            # DEVE estar limpo; se listar OIDC/chat não commitado: PARAR e comitar antes
git rev-parse HEAD                # esperado: ae46c495d7da7cd33f4b4da8f4e8cc95b0a867b6
                                  # ou SHA que contenha ae46c49 + dc3f68f + 3523c3f + este relatório
git log --oneline -5
node -v                           # LTS >= 22
corepack enable
```
Evidência: `00-ambiente.txt` (sanitizado).

### Parte 1 — Bootstrap do repositório
```powershell
cd <checkout>\airi
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build:packages             # esperado: 33/33
cd packages\lia-core; pnpm run build; pnpm run typecheck; cd ..\..
cd apps\lia-app; pnpm run build; cd ..\..
cd apps\stage-tamagotchi; pnpm run build   # main+preload ok; renderer exige dist.ayaka.moe (BL-1) — registrar, não contornar
```
Evidência: `01-install.log`, `02-build-packages.log`, `03-build-launcher.log`, `04-build-stage.log`.

### Parte 2 — Boot pelo fluxo oficial (W-01)
```powershell
cd <checkout>
.\Lia.bat                        # ou duplo clique; NÃO editar o .bat
Get-Process | ? ProcessName -match 'Lia|electron' | Format-Table Id, ProcessName, StartTime
```
Observar/registrar: janela `Lia`, `lia-app.renderer-ready` (anotar +ms), `%APPDATA%\Lia\lia-product.json`/`lia-secrets.json` materializados. Evidência: `05-boot.log` + PID inicial. Se falhar: registrar verbatim e parar.

### Parte 3 — Introspecção de sandbox/preload na janela real (W-14)
**Via A — Computer Use:** janela `Lia` → DevTools → confirmar que `window.process`, `require`, `process.versions` **não** existem no renderer; confirmar main-side `webPreferences` (sandbox true, contextIsolation true, nodeIntegration false, preload único `index.cjs`).
**Via B — CDP:** iniciar o Launcher com `--remote-debugging-port=0` somente pelo mecanismo suportado (sem patch) e enumerar targets; confirmar as mesmas 3 propriedades no target da janela `Lia`.
Sem nenhuma das duas: **BLOCKED** (registrar qual). Evidência: `06-sandbox-window.txt` + screenshot sanitizado.

### Parte 4 — AI Settings, 16 passos individuais (W-15)
Pré-condição dura: Computer Use **ou** CDP + chave Groq válida **digitada no campo da UI**. Sem isso: passos 2–15 = BLOCKED (não simular).

1. **Abrir o Launcher** — `renderer-ready` + janela; screenshot + linha de log.
2. **Abrir AI Settings** — navegar à central; screenshot sanitizado vs concept `02-ai-resources.png`.
3. **Confirmar provider Groq** — Groq `ready`; OpenAI-compatível indisponível; screenshot.
4. **Cadastrar/substituir a chave** — digitar a chave no **campo mascarado**; screenshot (sem valor) + confirmação de que não aparece em log/chat.
5. **Testar conexão** — resultado tipado; nenhuma exceção crua; nenhuma chave em log; screenshot + trecho de log.
6. **Descobrir modelos** — a lista contém `openai/gpt-oss-120b`; screenshot.
7. **Selecionar `openai/gpt-oss-120b`** — seleção visível; screenshot.
8. **Salvar** — `%APPDATA%\Lia\lia-product.json` com `provider.chat.preferred` íntegro (sem segredo claro); **testar as recusas AF-1**: trocar provedor gerenciado → `selection-owned-by-launcher`; sobrescrita concorrente → `stale-selection`; mensagens tipadas na UI; screenshots + JSON sanitizado.
9. **Fechar e reabrir** — 2 screenshots + PIDs; seleção restaurada.
10. **Confirmar que a Lia usa a seleção** — iniciar conversa mínima; log de rota = Groq/`openai/gpt-oss-120b`; `read()` do registro → `definitionId/connectionId/stageProviderId/engineId`; nenhuma rota alternativa usa `GROQ_API_KEY` do ambiente; responder o §4 do plano (5 perguntas).
11. **Iniciar conversa real** — “Conversar com Lia”; Stage sobe; screenshot + log + PID.
12. **Confirmar resposta** — 1 mensagem; resposta real; transcrição sanitizada.
13. **Fechar e reabrir a conversa** — screenshots.
14. **Confirmar histórico** — a troca anterior está presente; screenshot.
15. **Encerrar a aplicação** — `[Lia] Closed cleanly.` + exit 0; `%APPDATA%\Lia` íntegro.
16. **Ausência de órfãos** — `Get-Process | ? ProcessName -match 'Lia|electron'` → vazio; saída do comando anexada.

Complementos obrigatórios: a chave não reaparece após salvar (reabrir tela); troca de host exige confirmação + chave nova; erro de rede/HTTP como mensagem tipada; OpenAI-compatível indisponível e não selecionável.

### Parte 5 — Conversa real, 5 turnos + failover (W-16)
5 mensagens cobrindo: pergunta factual; pergunta com contexto; “lembre que meu nome é X”; recuperação do fato no turno 4–5 (memória); pergunta aberta. Se houver failover conforme política (429/5xx): registrar se ocorreu e o comportamento. Evidência: `07-conversa-5turnos.md` (sanitizada) + `08-conversa.log` com timestamps.

### Parte 6 — Tool calling `get_weather` (W-17) — pós-fix A-1 — fecha B3
Pré-condição: rede para `api.groq.com` **e** `open-meteo.com`; conversa da Parte 5 aberta.

1. Enviar: “Que tempo está fazendo agora em São Paulo?” (ou local controlado).
2. Capturar no log: evento `tool-call` com `get_weather` + argumentos; evento `tool-result` com o JSON de previsão; resposta final citando o dado real.
3. Confirmar que a ferramenta **foi** invocada (não resposta de memória).
4. **Verificar o gate A-1 na sessão**: as ferramentas `get_weather`/`image_journal`/`stage_widgets` permanecem **habilitadas** (decisão de produto — disponíveis sob pedido explícito). Se o teste desabilitar uma ferramenta pelo store (`setToolEnabled(id, false)`), ela deve: sumir de `activeTools`, falhar resolução em `getToolsByNames` (envio/rerun) e recusar execução com `ToolDisabledError`. Registrar os 3 comportamentos observados. **Reativar ao final** (não deixar estado sujo) e anotar que a UI de ativação ainda não existe.
5. Opcional: `stage_widgets` (local, sem rede). `image_journal`: somente com provider artistry configurado; senão **NOT RUN (provider ausente)**.
6. Sem rede → **BLOCKED**, registrar.

Evidência: `09-tool-calling.log` (tool-call/tool-result/resposta sanitizados) + anotação do payload de ferramentas.

### Parte 7 — Voz (Kokoro/STT) (H-01/H-02)
```powershell
cd <checkout>\airi
node tools\kokoro-smoke.mjs
```
Instalar engine (se aceito), pré-aquecer, sintetizar 1 frase, medir **RTF**; STT: captura → transcrição → cancelamento. Sem rede/mic → **BLOCKED**. Evidência: `10-voz.txt` (RTF, device, resultado).

### Parte 8 — Encerramento e órfãos (W-11) — C-12
```powershell
$antes = Get-Process | ? ProcessName -match 'Lia|electron' | select Id, ProcessName
# ...uso normal... fechar pela UI (X/bandeja), aguardar 10 s
$depois = Get-Process | ? ProcessName -match 'Lia|electron'
if (-not $depois) { 'ZERO ORFAOS' } else { $depois | Format-Table Id, ProcessName }
```
Também: 2ª instância (`single-instance`); histórico reabre; `%APPDATA%\Lia` íntegro. Evidência: `11-orfaos.txt`.

### Parte 9 — Distribuição NSIS (W-08) — fecha B4
```powershell
cd <checkout>\airi\apps\lia-app
node scripts\package-windows.mjs --internal-test --check
node scripts\package-windows.mjs --internal-test
```
Com **perfil sintético**: (a) instalação limpa → launch → AI Settings abre; (b) upgrade sobre a anterior; (c) uninstall → `%APPDATA%\Lia` preservado; (d) assinatura Authenticode **ou** decisão escrita de release unsigned comunicada. Evidência: `12-nsis-*.log` + inventário de licenças + decisão de assinatura. **Não assinar sem certificado/decisão humana.**

### Parte 10 — C0–C4 (W-20) — fecha B5
Medir **uma** aplicação empacotada estável (private bytes Launcher+Stage, CPU idle, início, shutdown, FPS/GPU):

| Controle | Roteiro | Registrar |
|---|---|---|
| C0 — controle | desktop sem Lia; Shell sem avatar; renderer vazio | baseline por processo |
| C1 — repouso estático | avatar carregado sem animação/física/fala | RAM/CPU repouso |
| C2 — repouso animado | idle/piscar/respiração a 15 e 30 FPS (60 opcional, separado) | RAM/CPU/FPS |
| C3 — interação | roteiro fixo olhar/clique/arraste/emoção/menu + 60 s de áudio idêntico | retomada, lip sync |
| C4 — invisível | tray / minimizado / coberto / pausa explícita | frames, timers, áudio |

Sucesso/falha por controle vs umbrais da decisão de runtime (ex.: > 1.500 MiB em C1 autoriza protótipo Tauri). Evidência: `13-c0-c4.csv|json` + relatório curto.

### Parte 11 — OIDC (W-07) — fecha B7
Decidir com o humano: **entra** (comitar `scripts/oidc-electron/` + IPC/recursos; rodar gate; registrar) **ou sai** do escopo da beta (documentar). Nunca meio caminho. Evidência: commit + relatório de gate.

### Parte 12 — Publicação das evidências
```powershell
git add docs/reports/evidence/LIA-WINDOWS-<data>-<sha-curto>/
git commit -m "docs(qa): evidências da validação Windows no SHA <sha-curto>"
```
Atualizar `CURRENT-STATE.md` **no mesmo commit** que fecha cada gate. A beta só é declarada com C-1…C-19 verdes (§8).

---

## 8. Critérios objetivos de aceite para beta (mensuráveis; estado em `ae46c49`)

| # | Critério | Como medir | Estado @ ae46c49 |
|---|---|---|---|
| C-1 | `pnpm install` reproduzível de clone limpo | clone fresco + Parte 1 | **PARCIAL** (A-12 re-verificado; doc de instalação herdada divergente) |
| C-2 | CI verde (Python DevKit ubuntu+windows; Node Lia; lint exit 0) | CI + logs | Python PASS; Node PASS (re-verificado no delta); **lint FAIL (81)** |
| C-3 | Projetos browser verdes em CI c/ Chromium | log CI | **BLOCKED** (BL-3) |
| C-4 | Build Stage 100% offline-reprodutível (assets com hash) | build sem rede | **BLOCKED** (BL-1) |
| C-5 | Launcher → Stage → conversa ≥5 mensagens — Windows | Partes 2/4/5 | **NOT RUN** |
| C-6 | Sandbox/preload/IPC na **janela de produto** | Parte 3 | **NOT RUN** (harness PASS) |
| C-7 | AI Settings ponta a ponta + seleção persistida | Parte 4 | **NOT RUN** (unit PASS offline) |
| C-8 | Histórico/memória persistentes após reinício app/SO | Parte 4 (13–14) + Parte 8 | **NOT RUN** |
| C-9 | AF-1/AF-1b na UI real (recusas tipadas) | Parte 4 passo 8 | unit PASS; **UI real NOT RUN** |
| C-10 | Voz: Kokoro instala/pré-aquece/RTF + STT mic | Parte 7 | **BLOCKED/NOT RUN** |
| C-11 | OIDC real sem regressão do flake; `get_weather` com autorização e resultado | Partes 6 e 11 | **NOT RUN** (oidc-link 30/30; gate A-1 PASS offline) |
| C-12 | Encerramento: sem órfãos; dados preservados; `single-instance` | Partes 4/8 | unit PASS; **runtime NOT RUN** |
| C-13 | NSIS limpo/upgrade/uninstall; inventário de licenças | Parte 9 | **NÃO EXECUTADO** |
| C-14 | Authenticode (ou unsigned comunicado) | Parte 9 | **NOT SIGNED** |
| C-15 | RX 580 renderiza; DPI/hotplug/2º monitor; 1h sem regressão | Parte 10 + máquina dev | **NOT RUN** |
| C-16 | Zero unhandled rejections por fetch não stubbed | `04-test-stage-ui.log` exit 0 | **FAIL** (BL-2) |
| C-17 | Zero credenciais em logs/relatórios/commits | scan do pacote final | **PASS nesta rodada** (fixture redigido); repetir no beta |
| C-18 | `CURRENT-STATE.md` atualizado no commit que fecha cada gate | histórico | processo — pendente por gate |
| C-19 | Esta matriz re-executada no SHA taggeado beta | este doc, novo run | **NOT RUN** |

**Conclusão: a Lia não está pronta para beta.** A distância está em C-3…C-15 e C-19 (runtime, distribuição, hardware) — não no núcleo unitário (5.664 PASS).

---

## 9. Evidências para fechar cada bloqueador (B1–B7)

| # | Bloqueador | Evidência mínima | Quem | Onde entra |
|---|---|---|---|---|
| B1 | Sem E2E no tip | 5 turnos sanitizados @ beta + screenshots AI Settings/Stage + `renderer-ready` + logs; 16 passos individuais; zero órfãos | Codex | `docs/reports/evidence/LIA-WINDOWS-*/` + §7 atualizado |
| B2 | AI Settings sem gate | tabela 16/16 @ beta + screenshots + `read()` do registro (`definitionId/connectionId/stageProviderId/engineId`) + recusas AF-1 na UI + log de rota = Groq/`openai/gpt-oss-120b` | Codex + usuário (chave na UI) | `…/20-ai-settings-*.md` + `CURRENT-STATE.md` |
| B3 | Tool calling não provado | `tool-call`/`tool-result` reais de `get_weather` + resposta citando dado do open-meteo + verificação do gate A-1 (disable bloqueia apresentação **e** execução) + registro do comportamento `defaultActive` | Codex | `…/09-tool-calling.log` + relatório |
| B4 | Distribuição sem assinatura/instalação | logs NSIS `--internal-test` (pack/clean/upgrade/uninstall) perfil sintético + dados preservados + licenças completas + decisão de assinatura | Arena prepara; Codex executa; humano decide | `…/12-nsis-*.log` + `LIA-BETA-READINESS-*.md` |
| B5 | Gate de arquitetura aberto | C0–C4 medidos em pacote estável + veredicto Cenário C confirmado **ou** autorização de protótipo, com números | Codex mede; Arena analisa | `…/13-c0-c4.*` + `LIA-DESKTOP-RUNTIME-ARCHITECTURE-DECISION.md` |
| B6 | Evidência fora do repo / worktree sujo | PROMPT-37 + OIDC IPC/resources commitados + `git status` limpo + índice | Codex comita; Arena revisa | commits + índice em `docs/reports/` |
| B7 | OIDC indefinido | decisão **entra** (commit + gate PASS/FAIL documentado) **ou sai** (remoção formal) | decisão humana + Codex | commit + relatório + `CURRENT-STATE.md` |

**Nota sobre B6:** no Linux, esta rodada já comitou `dc3f68f` (7cb8172), `3523c3f`/`59af1cc` (5ec464e) e as evidências ae46c49 — a parte local está preservada; falta a parte Windows (PROMPT-37/OIDC).

---

## 10. Comparação 5ec464e × ae46c49 (o que se re-provou, o que se carrega)

| Item | 5ec464e (rodada anterior) | ae46c49 (esta) | Transferível? |
|---|---|---|---|
| Commit delta | — | `f3facdf` (stage-ui A-1, código+testes) + `ae46c49` (docs A-1) | — |
| Python DevKit (A-01…A-07) | PASS | carry-forward | sim (fora do alcance) |
| Contratos/QA node (A-08…A-11) | PASS | carry-forward | sim |
| install / build:packages | 56,9 s / 33/33 | **13,2 s / 33/33 (re-executado)** | — |
| core-agent / lia-core / lia-app | PASS | carry-forward | sim (lia-app sem dep stage-ui) |
| Stage node suite | PASS 2.498 | **PASS 2.498 (re-executado)** | — |
| Stage typecheck / build | PASS / main+preload PASS, renderer BLOCKED | **idem (re-executado)** | — |
| stage-ui suite | 1.140 PASS, exit 1 (BL-2) | **1.153 PASS (+13 A-1), exit 1 (BL-2)** | — |
| A-1 (tools/resolver/rerun/built-in) | não existia | **PASS 31/31 + 1/1** | — |
| stage-ui typecheck | não rodado isolado | **PASS (re-executado)** | — |
| lint | 81 erros | **81 erros (idêntico; nenhum em arquivo A-1)** | — |
| oidc-link | 30/30 | 30/30 (dentro da suite A-19) | — |
| 16 passos AI Settings | 0/16 | **0/16** | não |
| Windows/hardware/NSIS/C0–C4 | NOT RUN | **NOT RUN** | não |

**Nada se perdeu entre as rodadas** — evidências de 7cb8172/5ec464e preservadas em commits anteriores; nada apagado.

---

## 11. Limites e ressalvas desta validação

1. **Nenhum runtime real foi exercido** (sem display/credencial/hardware). Boot, UI, IPC real, conversa, voz, render, NSIS, C0–C4: não provados em `ae46c49`.
2. **Nenhuma conclusão se estende além de `ae46c49`.** SHA futuro exige nova rodada (C-19).
3. **Catch-forward rotulado** (§2.A): Python/contratos/QA/lia-app/core-agent carregados de 5ec464e (2026-11-14), delta `f3facdf` fora do alcance; se qualquer um deles regredir em CI, vale o log do CI.
4. **A-24/A-25 são subconjuntos da A-19** (não contados duas vezes).
5. **`lia/launcher` e `lia/stage` (raiz) não são importados pelo produto** (A-09/A-10 = contratos vivos, não prova de produto).
6. **Dois "lia-core"** de nomes colididos; **fronteiras por caminho relativo** — riscos herdados, sem correção nesta etapa.
7. **`pnpm install` sempre com `--ignore-scripts`** neste subtree (simples-git-hooks criaria `.git` falso).
8. **Lint (81) e stage-ui exit 1** são conhecidos e **não corrigidos** (restrição: sem alterações de código).
9. **A-1 é gate de habilitação, não prova de chamada.** Ele garante apresentação/execução coerentes; **não** garante que o modelo chamará `get_weather` corretamente, nem que a rede responde — isso é W-17/B3.
10. **Evidência gerada fora do checkout principal** (worktree destacada `ae46c49-validation`, removida após a coleta); logs preservam o caminho original e o `git rev-parse HEAD` da worktree (`ae46c49…`, worktree limpa).

---

## Anexo A — Comandos executados (ordem real desta rodada)

```bash
# 0. Delta e preparo
git fetch origin arena/01a10290-lia-project      # ae46c495d7da7cd33f4b4da8f4e8cc95b0a867b6 (FETCH_HEAD)
git diff --stat 5ec464e ae46c49                   # 2 commits; stage-ui + docs
git worktree add --detach /home/user/ae46c49-validation ae46c49   # limpo (status=0)

# 1. airi/ (worktree) — instalação e prerequisito
corepack pnpm install --frozen-lockfile --ignore-scripts          # exit 0, 13,2 s → 01
PATH=/tmp/pnpm-shim:$PATH NODE_OPTIONS=--max-old-space-size=3072 corepack pnpm run build:packages   # 33/33 → 02

# 2. A-1 — testes direcionados
(cd airi/packages/stage-ui && PATH=/tmp/pnpm-shim:$PATH ELECTRON_OVERRIDE_DIST_PATH=/tmp/electron-override corepack pnpm exec vitest run --config vitest.config.ts --project node \
   src/stores/ai/chat-llm/tools.test.ts src/stores/ai/chat-llm/tool-resolver.test.ts src/stores/tool-call-rerun.test.ts)   # 31/31 → 03
(cd airi/packages/stage-ui && NODE_OPTIONS=--max-old-space-size=3072 corepack pnpm exec vitest run --config vitest.config.ts --project node)  # 1.153 PASS, exit 1 (BL-2) → 04
(cd airi/apps/stage-tamagotchi && ELECTRON_OVERRIDE_DIST_PATH=/tmp/electron-override NODE_OPTIONS=--max-old-space-size=3072 corepack pnpm exec vitest run --config vitest.config.ts --project node)  # 2.498 PASS → 05
(cd airi/apps/stage-tamagotchi && ELECTRON_OVERRIDE_DIST_PATH=/tmp/electron-override corepack pnpm exec vitest run --config vitest.config.ts --project node src/renderer/stores/tools/built-in.test.ts)  # 1/1 → 10

# 3. Tipos, build, lint
(cd airi/packages/stage-ui && NODE_OPTIONS=--max-old-space-size=3072 corepack pnpm run typecheck)    # exit 0 → 07
(cd airi/apps/stage-tamagotchi && NODE_OPTIONS=--max-old-space-size=3072 corepack pnpm exec vue-tsc --noEmit)  # exit 0 → 08
(cd airi/apps/stage-tamagotchi && corepack pnpm run build)   # exit 1 (renderer BLOCKED, BL-1) → 09
(cd airi && PATH=/tmp/pnpm-shim:$PATH timeout 700 corepack pnpm lint)  # exit 1 — 81 erros → 06

# 4. Limpeza
git worktree remove --force /home/user/ae46c49-validation
```

## Anexo B — Integridade, escopo e desvios
- Somente `docs/reports/**` alterado nesta branch: evidência `LIA-QA-VALIDATION-ae46c49-2026-11-14/` + este relatório. **Zero linhas de código.**
- Logs commitados passaram por varredura anti-segredo; 1 fixture sintético redigido.
- `00-environment.txt`: worktree destacada limpa (`git status --porcelain` = 0) em `ae46c49…`.
- Branch de sessão: commit e **push somente em `arena/18f50ae7-lia-project`**; sem merge em `main`, sem force push/reset/clean; branch principal intacta.
- Carry-forward rotulado (§2.A) — nenhuma evidência antiga foi apagada ou reescrita.

## Anexo C — Classificação final

| Eixo | Estado final @ ae46c49 |
|---|---|
| LINUX/ARENA — suítes automatizadas | **PASS** (re-executado no delta) + carry-forward rotulado — 5.664 PASS totais / 18 skip / 0 FAIL |
| LINUX/ARENA — builds | Launcher/core/pacotes PASS (cf.); Stage main+preload PASS (re-exec.); renderer **BLOCKED** |
| LINUX/ARENA — lint / stage-ui exit / browser | **FAIL / FAIL / BLOCKED** (pré-existentes/rede; A-1 limpo) |
| WINDOWS/CODEX — boot, AI Settings, Stage, conversa, tool calling, histórico, órfãos, NSIS, C0–C4, OIDC | **NOT RUN** (roteiro §7; nada simulado) |
| HARDWARE — GPU/mic/Kokoro/1h | **BLOCKED/NOT RUN** |
| A-1 (achado de auditoria) | **Corrigido em código** (`f3facdf` + `ae46c49`); verificado offline; round-trip runtime pendente (B3) |
| Beta | **NÃO APROVADA.** Declarar só com C-1…C-19 verdes no SHA taggeado, evidência commitada por gate. |
