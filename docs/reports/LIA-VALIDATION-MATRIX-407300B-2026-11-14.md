# Lia-Project — Matriz de validação do SHA `407300b8baa56b0ed8d14b7b2c0628222754e51f`

**Data:** 2026-11-14 · **Autor:** Arena (Linux/WSL, sem display, sem credenciais) · **Branch:** `arena/18f50ae7-lia-project`
**SHA de referência:** `407300b8baa56b0ed8d14b7b2c0628222754e51f` (`407300b` — “docs: consolidate the three specialist audits into a beta plan”), tip de `arena/01a10290-lia-project`.
**Delta `ae46c49 → 407300b`:** **1 commit, docs-only** — `CURRENT-STATE.md` (+19) e `docs/reports/LIA-BETA-READINESS-PLAN-2026-11-14.md` (novo, 424 linhas). **Nenhuma linha de código de produto mudou** (`git diff --stat` em `06-delta-ae46c49-407300b.log`; worktree destacada e limpa, `git status --porcelain` = 0 → `00-environment.txt`).
**Histórico preservado:** a matriz anterior (`LIA-VALIDATION-MATRIX-AE46C49-2026-11-14.md`) permanece no repositório, agora marcada como supersedida no topo; seus resultados são válidos **somente para `ae46c49`**. Este documento é a matriz vigente para o beta interno.
**Decisões de produto vigentes (14/11/2026, registradas no plano consolidado e no `CURRENT-STATE.md` @ 407300b):** **beta interno** · **voz e STT obrigatórios** (D2 = sim → G-11/C-10/C-12 tornam-se mandatórios) · **Fase 1 de UI/UX autorizada** (D5 — P1 apenas, sem redesenho; AC-01…AC-08 + AC-15 + regressão AC-21) · **OIDC NÃO aprovado para o beta** (D1 pendente; nenhum teste de OIDC pertence ao gate do beta interno).
**Escopo desta rodada:** (1) re-verificar o delta (docs-only, sem código) e (2) **vincular os resultados de áudio ao novo SHA** — lia-core voz (74), suítes Stage da área de áudio/voz/hearing (1.592) e stage-ui áudio (242) — porque a próxima frente é o **beta interno com voz obrigatória**. O restante é carry-forward rotulado de `ae46c49`/`5ec464e` (restrição: não repetir rodada completa sem necessidade com evidência válida e recente, e o código é idêntico).

Regra aplicada do início ao fim: **nenhum teste declarado PASS sem execução real registrada; nenhum resultado de Windows simulado.** Resultados históricos são citados como histórico rotulado.

---

## 0. Resumo executivo

| Pergunta | Resposta |
|---|---|
| O código mudou desde `ae46c49`? | **Não.** Delta docs-only (verificado). O núcleo 5.664 PASS / 18 skipped / 0 FAIL carrega adiante com o rótulo de carry-forward. |
| A área de áudio passou no SHA `407300b`? | **Sim, offline:** lia-core voz 74/74; Stage (áreas áudio/voz/hearing) 1.592/1.592 (104 arq.) após build; stage-ui áudio 242/242; A-1 31/31 + built-in 1/1; `build:packages` 33/33. |
| Voz e STT estão prontos para o beta interno? | **Não.** 0% runtime: Kokoro nunca sintetizou nesta base; STT nunca transcreveu áudio real; microfone, reprodução e cancelamento nunca foram exercidos no produto. Ver `LIA-AUDIO-QA-MATRIX.md` (nova). |
| O beta interno pode ser declarado? | **Não.** Faltam: prova de runtime Windows (boot… órfãos), voz/STT real, NSIS, C0–C4 (se D4), CI verde (lint 81; stage-ui exit 1), renderer build reproduzível, e o encerramento formal do escopo OIDC para o beta. |

**Veredicto:** beta interno **NÃO aprovado**. O plano consolidado (`407300b`) permanece o roteiro mestre; esta matriz e a matriz de áudio são a referência operacional de QA para ele.

---

## 1. Registro de integridade

| Item | Valor |
|---|---|
| HEAD executado (worktree destacada `407300b-validation`, removida após a coleta) | `407300b8baa56b0ed8d14b7b2c0628222754e51f`; worktree limpa (`00-environment.txt`) |
| HEAD da branch de entrega | `arena/18f50ae7-lia-project` (evidências commitadas; matriz a seguir) |
| Delta verificado | `git diff --stat ae46c49 407300b` → só `docs/**` (`06-delta-...log`) |
| Toolchain | Linux 6.1.158 x86_64; Node v22.22.3; Python 3.11.2; pnpm 11.24.0 (corepack) |
| airi | `pnpm install --frozen-lockfile --ignore-scripts` (exit 0; 55,7 s) — `01` |
| `build:packages` | **exit 0, 33/33** (após recriação do shim pnpm em `/tmp`; 1ª tentativa falhou com “Unable to find package manager binary” — ver `04` e a nota de integridade abaixo) |
| Evidência | `docs/reports/evidence/LIA-QA-VALIDATION-407300b-2026-11-14/` (10 arquivos), commitada |
| Carry-forward | `ae46c49` → `LIA-VALIDATION-MATRIX-AE46C49-2026-11-14.md`; `5ec464e` → `LIA-VALIDATION-MATRIX-5EC464E-2026-11-14.md`; histórico 7cb8172 preservado |
| Alterações de código | **Nenhuma.** Só `docs/**` (evidência + matrizes). |
| Lint: número que vale | **81 erros eslint / 0 warnings** (os “10 avisos” do texto anterior eram da fase `oxlint`; divergência registrada também pelo plano consolidado §1.5-1). Preexistente; fora de escopo corrigir aqui. |

**Incidente de ambiente desta rodada (registrado, não apagado):** o sandbox perdeu `/tmp/pnpm-shim` entre turnos; (a) a 1ª execução de `build:packages` falhou (EXIT=1) e passou após recriar o shim (`04-build-packages.log`); (b) a 1ª execução filtrada das suítes Stage falhou (70 arquivos/15 testes, imports de workspace sem build) e passou após `build:packages` (104/104, 1.592 testes). Ambos os fatos estão preservados em `03a-stage-audio-suites-FIRST-RUN-FAIL.txt` e nos logs.

---

## 2. Matriz de testes — classes de ambiente

Legenda: PASS (executado) · FAIL (executado, falhou) · BLOCKED (pré-condição ausente) · NOT RUN · **CF** = carry-forward de `ae46c49`/`5ec464e` (código idêntico; diff docs-only verificado).

### 2.A — LINUX/ARENA (re-executados neste SHA)

| ID | Funcionalidade | Resultado | Evidência |
|---|---|---|---|
| A-01 | Ambiente de validação (worktree limpa, SHA exato) | PASS | `00-environment.txt` |
| A-02 | airi install (`--frozen-lockfile --ignore-scripts`) | PASS (exit 0) | `01-airi-install.log` |
| A-03 | **lia-core voz** — `vitest src/voice` (voice-service, engines registry, kokoro config/install/layout/smoke) | **PASS 74/74** (7 arq.) | `02-lia-core-voice.log` |
| A-04 | **Stage — área áudio/voz/hearing** (`src/main/services/lia`, `src/renderer/stores/lia`, `composables`, `utils`, `index.voice-authority`, `sections`, `shared`) — inclui hearing, chat-voice-pipeline, transcription-service/adapters, voice-* | **PASS 1.592/1.592** (104 arq.) — 1ª tentativa FAIL por build ausente (ver §1) | `03-stage-audio-suites.log` (+`03a-…`) |
| A-05 | **stage-ui — áudio** (`src/composables`, `src/stores/modules`) — hearing store, voice-input-*, streaming transcription | **PASS 242/242** (32 arq.) | `05-stage-ui-audio-suites.log` |
| A-06 | A-1 canary (`built-in.test.ts`) | PASS 1/1 | `07-a1-canary.log` |
| A-07 | A-1 targeted (tools 13, tool-resolver 11, rerun 7) | PASS 31/31 | `08-a1-targeted.log` |
| A-08 | `build:packages` (prerequisito) | PASS 33/33 | `04-build-packages.log` |
| A-09 | Delta ae46c49→407300b (docs-only) | verificado | `06-delta-ae46c49-407300b.log` |

\* A-04/A-05 são **subconjuntos** das suítes completas (Stage node 2.498; stage-ui 1.153) re-executados em `ae46c49`; não contados duas vezes.

### 2.A′ — LINUX/ARENA (carry-forward rotulado, não re-executado)

| ID | Item | Última execução | Estado |
|---|---|---|---|
| CF-01 | Python DevKit (compileall, project_cli, creation, lia_dev 435, agent_skills, stt-bench 70, alethe-budget) | 5ec464e (2026-11-14) | PASS |
| CF-02 | Contratos Lia 105/105; launcher 8/8; stage 9/9; QA harness 275/275 | 5ec464e | PASS |
| CF-03 | core-agent 156/156; lia-core 381/381 + typecheck 0; lia-app 353/353 (+2 skip) + typecheck 0 + build 0 | ae46c49/5ec464e | PASS |
| CF-04 | Stage suite node completa 2.498/2.498 (1 skip); typecheck vue-tsc exit 0; build main+preload PASS | ae46c49 | PASS |
| CF-05 | stage-ui suite 1.153/1.153 — **exit 1** (1 unhandled rejection `updateCredits`→`api.airi.build`; defeito BL-2) | ae46c49 | PASS PARCIAL (não é verde) |
| CF-06 | `pnpm lint` | ae46c49 | **FAIL — 81 erros eslint / 0 warnings** (59 auto-fixáveis) |
| CF-07 | Stage browser project | ae46c49 | **BLOCKED** (Chromium ausente; CDN inalcançável) |
| CF-08 | Stage build renderer | ae46c49 | **BLOCKED** (`dist.ayaka.moe` ECONNRESET) |
| CF-09 | oidc-link 30/30 | dentro da CF-04 | PASS |
| CF-10 | Provider-electron libs 148/148 | 5ec464e | PASS |

**Total único consolidado @ `407300b`: 5.664 PASS / 18 skipped / 0 FAIL** (inalterado; delta docs-only). **Re-executado nesta rodada:** 74+242+31+1 = **348** (subconjuntos) + 1.592 (A-04, subconjunto da CF-04).

### 2.B — WINDOWS/CODEX (NOT RUN; não simulados)

W-01…W-20 inalterados em relação a §2.B da matriz `ae46c49` (boot `Lia.bat`, Stage integrado, LiaTests.bat, LiaBenchmark.bat, stt-bench Windows, gate.test.mjs, **`oidc-electron` ausente (W-07; e OIDC fora do escopo do beta interno por decisão)**, NSIS, CI windows-latest, testes Windows-only, encerramento/órfãos, Authenticode, DevKit.bat, sandbox na janela real, **AI Settings 16/16 (0/16 executados)**, conversa 5 turnos, **tool calling `get_weather` round-trip**, histórico/memória pós-reinício, C0–C4) — acrescidos de:

| ID | Item (novo foco: beta interno com voz) | Estado |
|---|---|---|
| W-21 | **Kokoro no Windows real**: `ensureKokoroInstalled` (download 92 MB do modelo da HF/jsDelivr, sha256 `fbae9257…`), venv Python 3.10–3.13, `kokoro-onnx 0.6.1`, síntese e RTF medido | NOT RUN |
| W-22 | **STT real** ponta a ponta (mic → Groq `whisper-large-v3-turbo` via `api.groq.com/openai/v1/`, credencial do vault em `main`) — inclui permissão de microfone, device, cancelamento | NOT RUN |
| W-23 | **Reprodução TTS na interface** (playback-manager / Web Audio) audível e verificada; interrupção/parada | NOT RUN |
| W-24 | **Fluxo voz completo**: falar → transcrição → envio → resposta → Kokoro fala a resposta; pausar/retomar/fechar Lia sem vazar áudio | NOT RUN |
| W-25 | **Seleção/troca de provedor de voz e STT na UI** (voice-engine, fallback honesto, `voice-unavailable` sem switch silencioso) | NOT RUN |
| W-26 | **Vazamento de recursos de áudio**: processos de worker Kokoro e streams de mic ausentes após encerrar | NOT RUN |
| W-27 | Beta interno sem superfícies OIDC acessíveis (remoção efetiva de entrada e consumidores, se D1 = sair) | **CONDICIONAL à decisão D1** — hoje: NOT RUN; gate do beta |

### 2.C — HARDWARE

| ID | Item | Estado |
|---|---|---|
| H-01 | Kokoro real (download, venv, síntese, RTF) | **BLOCKED (rede aqui) / NOT RUN** |
| H-02 | Microfone físico + permissões + hotplug | NOT RUN |
| H-03 | Render RX 580 / DPI / múltiplos monitores | NOT RUN |
| H-04 | Soak 1h (`--soak-seconds=3600`) | NOT RUN |
| H-05 | Alto-falantes/fones (reprodução verificável) | NOT RUN |
| H-06 | Falha/ausência de dispositivo de entrada e de saída (recuperação) | NOT RUN |

---

## 3. Falhas encontradas (executadas; nenhuma correção aplicada)

1. **Build Stage renderer BLOCKED** (CF-08) — `dist.ayaka.moe` ECONNRESET; main+preload PASS. Bloqueia B-03/G-03.
2. **stage-ui exit 1** (CF-05) — 1.153/1.153 PASS + 1 unhandled rejection (`updateCredits`→`api.airi.build`). Bloqueia C-16/G-01 (QA-02 do plano).
3. **`pnpm lint` FAIL** (CF-06) — 81 erros eslint / **0 warnings** (correção factual vs. rodada anterior; 10 avisos eram da fase oxlint).
4. **Ambiente de validação instável entre turnos** — `/tmp` perdido (shim pnpm); 1ª `build:packages` FAIL → PASS após recriação (log preservado); 1ª suíte Stage FAIL por build ausente → PASS após `build:packages` (`03a…`). **Não são defeitos de produto**; mas o Codex deve esperar o mesmo de checkouts limpos: `build:packages` antes de qualquer typecheck/suíte.
5. **Stage browser BLOCKED** por rede/CDN (CF-07).
6. Nenhuma falha de teste de produto nas re-execuções desta rodada (A-03…A-07: 74+1.592+242+1+31 = **1.940 PASS / 0 FAIL**).

---

## 4. Testes bloqueados e motivos (resumo; detalhe em `LIA-AUDIO-QA-MATRIX.md` §9)

| ID | Item | Motivo |
|---|---|---|
| BL-1 | Renderer Stage (A-…/CF-08) | rede `dist.ayaka.moe` |
| BL-2 | stage-ui exit 0 (CF-05) | fetch não stubbed `api.airi.build` |
| BL-3 | Stage browser (CF-07) | Playwright/CDN |
| BL-4 | Kokoro real (H-01/W-21) | rede HF/jsDelivr + Python AVX — **mandatório p/ beta interno (voz)** |
| BL-5/6 | `get_weather` round-trip / tool calling completo | rede externa + UI |
| BL-7 | AI Settings passos 2–15 | sem interação de desktop aqui |
| BL-8 | Voz/STT real (H-02/H-05) | mic/alto-falante físicos |
| BL-9 | C0–C4 | pacote + máquina dev |
| BL-10 | NSIS | Windows x64 |
| BL-11 | Electron binário no Linux | CDN |
| BL-12 | `gate.test.mjs` | powershell + Electron real |
| BL-13 | `oidc-electron` | arquivos ausentes; **OIDC fora do beta (decisão)** — remover do gate |
| BL-14 | Groq API (STT) | `api.groq.com` + chave (somente no Windows com interação) |
| BL-15 | **Superfícies OIDC no build de beta** | escopo pendente de D1 — requisito de processo para o beta interno |

---

## 5. Cobertura dos fluxos críticos (resumo; áudio detalhado em `LIA-AUDIO-QA-MATRIX.md`)

| Fluxo | Offline | Runtime | Gate beta interno |
|---|---|---|---|
| AI Settings (16) | contratos/políticas PASS | **0/16** | B-01/B-02 (QA-06); C-7 |
| Tool calling | gate A-1 PASS offline | round-trip **NOT RUN** | B-02 (QA-07); G-05 |
| **Voz TTS (Kokoro)** | engines/service PASS (74); pipeline PASS offline | **0% runtime** | **G-11 (mandatório)** |
| **STT (mic→Groq→texto)** | hearing pipeline PASS offline | **0% runtime** | **G-11 (mandatório)** |
| Stage | suite node PASS; renderer BLOCKED | NOT RUN | W-02; G-04 |
| Histórico | stores PASS | NOT RUN | G-04; C-8 |
| Encerramento/órfãos | coordinator PASS | NOT RUN | G-04; C-12 |
| Distribuição NSIS | revisão estática | NÃO EXECUTADO | G-09 |
| Arquitetura (C0–C4) | decisão Cenário C | NOT RUN | G-10 (se D4) |
| Segurança (sandbox/IPC/vault) | PASS offline | janela real NOT RUN | G-06/G-07 |
| OIDC | unit 30/30 (CF) | — | **FORA do gate (decisão beta interno)**; só retorna com D1 = entra + correções SEC-01/02 (plano §3.1-B-05) |

---

## 6. Duplicados e lacunas (delta desta rodada)

- **A-04 ⊂ CF-04** (subconjunto; não somado em dobro). A-05 ⊂ CF-05.
- **Lacuna fechada nesta rodada:** a matriz anterior não tinha **nenhum teste de áudio vinculado ao SHA**; agora há (A-03…A-07, 1.940 PASS).
- **Lacunas mantidas:** sem E2E/runtime (boot, UI, IPC real); sem round-trip de tool calling; sem execução Kokoro/STT real; cobertura visual (browser gate BLOCKED); `updateCredits` sem stub; `lia/launcher` e `lia/stage` (raiz) não importados pelo produto; dois "lia-core"; fronteiras por caminho relativo; lint vermelho; build não reproduzível offline.
- **Lacuna de processo nova:** entre turnos o sandbox pode perder `/tmp` e a instalação (`.turbo` cache recriado na raiz); o roteiro do Codex deve incluir `build:packages` como pré-requisito explícito de qualquer typecheck/suíte (agora refletido em §1 e no roteiro do Codex).

---

## 7. Windows/Codex — pendências e roteiro

**`oidc-electron` (W-07) sai do gate do beta interno** por decisão de escopo (OIDC não aprovado). O item permanece na lista como histórico/pendência de D1, não como bloqueador de QA de voz.
**Voz torna-se gate obrigatório.** Roteiro único anterior (Partes 0–12 da matriz `ae46c49`, válido) **mais** a Parte 7 expandida em `LIA-AUDIO-QA-MATRIX.md` §11–§12 (instalação Kokoro, smoke, fluxo in-app completo, vazamentos). Ordem: Parte 0→1→2→3→4 (16/16, chave Groq na UI)→5 (conversa 5 turnos)→6 (tool calling)→**7 (voz completa)**→8 (órfãos, incl. sem processos de áudio)→9 (NSIS)→10 (C0–C4 se D4)→12 (publicação de evidências).

---

## 8. Critérios de aceite para o beta **interno** (mensuráveis; estado em `407300b`)

Herança de C-1…C-19 (ver matriz `ae46c49` §8) com as decisões de produto aplicadas:

| # | Critério | Estado @ 407300b |
|---|---|---|
| C-2 | CI verde (Python+Node) | lint FAIL (81) → **FAIL** (QA-01) |
| C-3 | Projetos browser em CI | BLOCKED (CF-07) |
| C-4 | Build Stage offline reproduzível | BLOCKED (CF-08) |
| C-5 | Conversa ≥5 turnos real — Windows | NOT RUN |
| C-6 | Sandbox/preload na janela real | NOT RUN |
| C-7 | AI Settings ponta a ponta | NOT RUN (0/16) |
| C-8 | Histórico/memória pós-reinício | NOT RUN |
| C-9 | AF-1/AF-1b na UI real | unit PASS; UI real NOT RUN |
| **C-10** | **Voz: Kokoro instala/pré-aquece/sintetiza (RTF medido) + STT mic→texto→conversa com cancelamento** | **NOT RUN — mandatório para beta interno (voz)** |
| C-12 | Encerramento sem órfãos (incl. processos de áudio) | unit PASS; runtime NOT RUN |
| C-13/14 | NSIS + assinatura (ou unsigned documentado) | NÃO EXECUTADO / NOT SIGNED |
| C-15 | Hardware (RX 580, DPI, 2º monitor) | NOT RUN |
| C-16 | Zero unhandled rejections | FAIL (BL-2) |
| C-17 | Anti-segredo no pacote beta | PASS nesta rodada (fixture redigido); repetir |
| C-18 | `CURRENT-STATE.md` no commit de fechamento de gate | pendente |
| C-19 | Esta matriz re-executada no SHA taggeado | NOT RUN |
| **D1** | **OIDC fora do beta interno: nenhum ponto de entrada de OIDC acessível no build interno, ou D1 formalmente revertido com SEC-01/02 corrigidos** | **CONDICIONAL — pendente de decisão + verificação W-27** |
| **D5** | **UI Fase 1: AC-01…AC-08, AC-15 e regressão AC-21 verdes no SHA taggeado** | NOT RUN (subconjunto aprovado do relatório UI/UX; AC-09…AC-14/AC-16 adiados) |

**Conclusão: a Lia não está pronta para o beta interno.** Distância: runtime Windows (B-01/QA-06), voz/STT real (G-11), tool calling (B-02), build reproduzível (B-03), NSIS (B-04), CI (B-06), decisão D1.

---

## 9. Evidências para fechar os bloqueadores do beta interno (B1–B7 do plano §3.1)

| # | Bloqueador (plano §3.1) | Evidência mínima | Onde entra |
|---|---|---|---|
| B-01 | Sem prova de runtime no SHA | Partes 2–8 + **voz completa** (`LIA-AUDIO-QA-MATRIX.md`); logs+screenshots+PIDs; AI Settings 16/16 | `docs/reports/evidence/LIA-WINDOWS-*/` |
| B-02 | Tool calling sem round-trip | `tool-call`+`tool-result` reais de `get_weather` + gate A-1 verificado na sessão | idem |
| B-03 | Build não reproduzível | `electron-vite build` do Stage offline; assets com hash + licença (D8) | commit de build + log + hashes |
| B-04 | Distribuição inédita | NSIS clean/upgrade/uninstall + dados preservados + licenças/SBOM + decisão de assinatura (beta interno: unsigned documentado é aceitável se decidido) | `…/12-nsis-*.log` + inventário + decisão |
| B-05 | OIDC inseguro | **D1 = sair:** remoção efetiva (entrada + consumidores) verificada no build; docs atualizados. **D1 = entrar:** SEC-01/02/03 corrigidos (Main-only, geração/cancelamento, logout explícito) + testes | commit + relatório + CURRENT-STATE.md |
| B-06 | CI vermelho | lint exit 0; stage-ui exit 0; zero unhandled rejections; job Linux da matriz | logs de CI |
| (voz) | G-11 mandatório | `LIA-AUDIO-QA-MATRIX.md` completo: AU-* PASS com logs reais (RTF, transcrição real, playback audível) | `docs/reports/evidence/LIA-WINDOWS-*/voz/` |

---

## 10. Histórico e integridade desta rodada

- Evidências desta rodada: `docs/reports/evidence/LIA-QA-VALIDATION-407300b-2026-11-14/` (00–08 + `03a` + `04`), commitadas antes deste relatório.
- Carry-forward: `ae46c49` (matriz + evidências) e `5ec464e`/`7cb8172` preservados, nenhum apagado.
- **Delta verificado docs-only** — por isso os resultados de código carregam adiante **sem se misturarem** com a coleta deste SHA: cada item da §2.A′ diz onde e quando foi executado.
- Incidente de `/tmp` registrado na §1/§3 (não houve perda de evidência).
- Varredura anti-segredo: limpa (fixture sintético redigido).
- Nenhuma alteração de código; nenhuma branch principal tocada; sem merge; commit e push somente na branch de sessão.

---

## Anexo A — Comandos (desta rodada) e Anexo B — desvios

```bash
git fetch origin arena/01a10290-lia-project          # 407300b8… (tip)
git worktree add --detach /home/user/407300b-validation 407300b8…
# worktree: pnpm install --frozen-lockfile --ignore-scripts        → 01
# airi: pnpm run build:packages (shim recriado)                     → 04 (33/33)
# packages/lia-core: pnpm exec vitest run src/voice                 → 02 (74/74)
# apps/stage-tamagotchi: vitest --project node <áudio/voz/hearing>  → 03 (1.592; 1ª tentativa FAIL sem build — ver 03a)
# packages/stage-ui: vitest --project node src/composables src/stores/modules → 05 (242/242)
# stage-tamagotchi: built-in.test.ts → 07 (1/1); stage-ui: chat-llm A-1 → 08 (31/31)
# delta: git diff --stat ae46c49 407300b                            → 06 (docs-only)
git worktree remove --force /home/user/407300b-validation
```

**Desvios:** coleta em worktree destacada (preserva a branch de sessão e garante SHA exato); `/tmp` perdido entre turnos (shim recriado; fatos em `03a`); `build:packages` pré-requisito revalidado; nenhuma ferramenta de produto executada fora do repositório; nenhuma credencial usada.

## Anexo C — Classificação final

| Eixo | Estado @ `407300b` |
|---|---|
| LINUX/ARENA — suítes (re-exec. áudio/A-1 + CF) | **PASS** (1.940 re-executados; total consolidado 5.664/18 skip/0 FAIL) |
| LINUX/ARENA — build/lint/browser | build 33/33; lint **FAIL (81)**; browser **BLOCKED**; renderer **BLOCKED** |
| WINDOWS/CODEX — boot, AI Settings, Stage, conversa, tool calling, histórico, órfãos, NSIS, voz/STT, C0–C4 | **NOT RUN** |
| HARDWARE — Kokoro/mic/speakers/RX 580/soak | **BLOCKED/NOT RUN** |
| Beta interno | **NÃO APROVADO.** Gates: B-01…B-06 do plano `407300b` + voz (G-11) + D1 (OIDC fora) verificados no SHA taggeado. |
