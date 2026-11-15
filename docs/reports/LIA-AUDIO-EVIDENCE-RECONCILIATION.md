# Lia — Reconciliação forense das evidências de áudio (beta interno)

**Data:** 2026-11-15 (UTC) · **Autor:** Arena (Linux sandbox) · **Branch:** `arena/18f50ae7-lia-project` @ `4acd20e6fa5b8245bf135f5ba5bea386d00b4ba7`
**SHA do conteúdo disputado:** `407300b8baa56b0ed8d14b7b2c0628222754e51f` (áudio, `ae46c49→407300b` docs-only) · **E2E histórico:** `3ef6d11618f787dae6d197645d440a5775a60ad6` · **Auditoria central:** `28551805e8b0da016e947ff30de28e75a936deab` ("da Principal", na prática tip de `origin/arena/7fa837f0-lia-project`, 15/11; **main é `9c7ac18`** e não o contém)
**Natureza:** auditoria de evidências — **nenhuma execução de produto foi necessária e nenhuma ocorreu**; nenhuma linha de código, relatório ou branch remoto foi alterado; `git fetch` somente leitura.
**Regra aplicada:** nada marcado PASS sem evidência verificável; afirmação não versionada = **NOT RUN/BLOCKED para fins de gate**; mock ≠ integração; smoke ≠ aplicativo; Linux ≠ Windows.

---

## 0. Veredicto

**A contradição é aparente, e ela tem três causas reais:**

1. **Escopo não delimitado nas duas frases divergentes.** A QA afirmou “Kokoro nunca sintetizou **nesta base**” medindo o **Linux/sandbox** (sem rede para `huggingface.co`/`cdn.jsdelivr.net`, sem venv Python, sem microfone). O Codex afirmou **4 WAVs válidos** (smoke CPU 1.30.0) e **6 WAVs válidos** (smoke isolado ORT 1.24.4) medindo a **máquina física Windows 11** (RX 580 8 GB, Ryzen 5 5500, 16 GB) — ambos **no SHA `407300b`**. As duas afirmações são compatíveis entre si; **nenhuma das duas prova o aplicativo**.
2. **A evidência do Windows não está versionada.** Os WAVs e logs vivem em `J:\lia-evidence\beta-407300b-windows-20261114\` e `J:\lia-evidence\rx580-local-ai-407300b\`, **fora do repositório**, não inspecionáveis neste sandbox, não verificáveis quanto a SHA exato da coleta, hashes, validade técnica dos arquivos ou integridade após a coleta.
3. **O aplicativo nunca executou síntese no SHA `407300b`** — nenhum log `lia.voice.synthesize` (ou `lia-app.voice-install`) está versionado em lugar nenhum; capturas de microfone, STT real, reprodução, turno completo e liberação de recursos no app permanecem **não provados** em `407300b`. A prova ponta a ponta existe apenas no baseline **histórico `3ef6d11`** (§2/E-14), ~193 commits atrás, com fases de voz 7.8/7.9 (runtime, prewarm, métricas) implementadas **depois** — **não transferível**.

**Consequência prática:** o gate **G-AUD (critérios AV-01…AV-15, plano rev.2 do beta interno) permanece BLOCKED/NOT RUN**. As duas contagens de WAV (4 e 6) não se cancelam nem se somam: são **duas rodadas de smoke dev-only com runtimes e frases diferentes**, admitidas pelo próprio relatório do Codex como não comparáveis. Até que a evidência seja recuperada e versionada, a Lia **não tem** TTS nem STT aprovados no SHA candidato.

---

## 1. Como ler as hierarquias de prova

| Nível | Prova | Vale para beta? |
|---|---|---|
| N0 | O código existe (arquivos, contratos) | não |
| N1 | Testes unitários/integração (mocks, harness) — \_Linux\_ | não, isoladamente |
| N2 | **Smoke dev-only do engine** (`tools/kokoro-smoke.mjs`): WAV produzido fora do app, RTF medido | **não** (qualifica componente, não produto) |
| N3 | **Síntese pelo aplicativo** (log `lia.voice.synthesize` de uma sessão real) | necessário |
| N4 | **Reprodução audível verificada** (playback no Stage, descrição do observador + log) | necessário |
| N5 | **STT real** (mic → Groq → texto correto no composer) | necessário (voz obrigatória no beta interno) |
| N6 | **Fluxo completo** mic → VAD → STT → chat → resposta → TTS → reprodução → interrupção → liberação de recursos (AV-01…AV-15 / AU-*) | **gate G-AUD** |
| N7 | Soak (60 min) com atividade de voz | desejável |

**Aplicando:** Codex = N2 (declarado, não versionado → não verificável). QA Linux = N1. In-app N3–N6 = **não provado em `407300b`**. Histórico `3ef6d11` ≈ N6, rotulado como histórico.

---

## 2. Matriz de evidências (SHA · origem · método · resultado · arquivos · limitações · classe)

| # | Fonte (repo/branch/SHA/arquivo) | Alvo | Método | Arquivos | Resultado declarado | Limitações | Classificação |
|---|---|---|---|---|---|---|---|
| E-01 | `codex/lia-multi-provider-voice` @ `fd0451d` (base `0bf0629`), `docs/reports/LIA-MULTI-PROVIDER-VOICE-ARCHITECTURE.md` — seção “O que foi testado” | `407300b` | smoke **de produção** Kokoro CPU 1.30.0 (Windows físico) | WAVs + logs em `J:/lia-evidence/beta-407300b-windows-20261114/` — **fora do repo** | **4 WAVs válidos**; cold start 9,5 s; síntese 4,45–7,85 s; **shutdown do worker confirmado** | evidência não versionada; WAVs não inspecionados nesta auditoria; smoke ≠ app; não diz *quais* frases; sem hashes públicos | **BLOCKED** — recuperar e versionar (§7) |
| E-02 | idem — “O smoke isolado posterior em ORT 1.24.4” | `407300b` | smoke isolado ONNX Runtime 1.24.4 | mesma pasta | **6 WAVs CPU** em 1,50–4,88 s, frases diferentes; “as rodadas não constituem série comparável” | idem; frases diferentes impossibilitam comparação WAV↔WAV entre rodadas | **BLOCKED** — recuperar e versionar; não usar p/ série temporal |
| E-03 | idem — “Kokoro DirectML 1.24.4” | `407300b` | engine com DirectML EP | — | **2 tentativas falharam** no `ConvTranspose` antes de produzir WAV; “enumerar backend + criar sessão **não** provaram síntese” | sem WAV; DirectML fora de escopo do build (CPU-only); coerente com o manifesto do produto | **FAIL** (declarado; não reproduzido aqui) |
| E-04 | idem — “Pipeline de áudio” | `407300b` | suíte automatizada no Windows | — | “**110 testes automatizados passaram**. Reprodução física na conversa, captura de microfone, STT e integração do turno completo **ficaram pendentes**” | recorte/metodologia distintos dos números do QA (1.592+242+74 no recorte Linux; ver E-11/E-12); não verificável nesta auditoria | **SKIP** (não verificável; não é prova de runtime) |
| E-05 | idem — llama.cpp Vulkan RX 580 | `407300b` | inferência de **texto** (25/25 camadas; pico 98% compute; demo curta) | `J:/lia-evidence/rx580-local-ai-407300b/` | texto OK na RX 580 | **sem áudio**; não qualifica TTS/STT | **SKIP** (irrelevante para este gate) |
| E-06 | Esta branch @ `4acd20e` — `docs/reports/LIA-AUDIO-QA-MATRIX.md` (§0, BL-A1) e `LIA-VALIDATION-MATRIX-407300B-2026-11-14.md` (A-03…A-07) | `407300b` | Linux sandbox; rede bloqueada; execução registrada em evidência versionada | `docs/reports/evidence/LIA-QA-VALIDATION-407300b-2026-11-14/02,03,05,07,08` (74+1.592+242+1+31 = **1.940 PASS**) | “Kokoro nunca sintetizou **nesta base**” — **correto para Linux**; nada provado no Windows | frase mal delimitada causou a disputa; o conteúdo executado é válido e versionado | **PASS** (como declaração de escopo) — **não** como prova negativa sobre o Windows |
| E-07 | Plano rev.1 @ `407300b` (`LIA-BETA-READINESS-PLAN-2026-11-14.md`): H-01, H-02, QA-09, B-07 | `407300b` | consolidação de QA/Arch/UI-UX | plano em `docs/reports/` (origem `arena/01a10290…`) | “voz/STT/GPU/DPI/1h não validados; **áudio é bloqueador comprovado B-07**” | escrito antes da publicação do relatório Codex; conservador por construção | **SKIP** (histórico/conservador; correto até evidência versionada) |
| E-08 | Plano rev.2 @ `0bf0629` (lido de `origin/codex/lia-multi-provider-voice` e `origin/arena/7fa837f0-lia-project`): §4.1–4.5, AV-01…AV-15, G-AUD, B-07, DP-2/P-2 | `407300b` | consolidação pós-comprovação (áudio obrigatório) | plano em `docs/reports/LIA-BETA-READINESS-PLAN-2026-11-14.md` | AV-01…AV-15 todos **NOT RUN**; G-AUD exige os 15 PASS no Windows físico c/ STT Groq e Kokoro local; AV-04/07 limiares marcados **[proposto]** (P-2, aprovação Pendente) | AV-04 e AV-07 sem limiar aprovado (RTF ≤ 0,5 e 1,5×+2 s são **propostas**, não critério vigente) | **SKIP** (vigente; referência normativa do gate) |
| E-09 | `arena/7fa837f0-lia-project` @ `2855180` — `docs/reports/LIA-GIT-BRANCH-ORGANIZATION-AUDIT.md` (§1.2.9, Anexo B.1, R-02, E-5) + `CURRENT-STATE.md` §0 (Decisões rev.2) | `407300b` | auditoria Git só-leitura (15/11) | relatório acima | registra a divergência de áudio; exige recuperação de `J:/lia-evidence` e correção de B-07/plano | não executou testes; declara explicitamente não ter acesso a `J:/` | **PASS** (como diagnóstico de processo; a contradição existe e precisava deste relatório) |
| E-10 | `main` @ `9c7ac18` | — | — | não contém o desenvolvimento; não contém este trabalho | — | fora de escopo; intocada | **N/A** |
| E-11 | Esta branch — evidência Linux 5ec464e/ae46c49 (carry-forward rotulado) | `5ec464e`/`ae46c49` | Linux sandbox | `docs/reports/evidence/LIA-QA-VALIDATION-5ec464e-2026-11-14/`, `…ae46c49-…/` | suítes offline: lia-core 381/381 (5ec464e) / A-1 targeted 31/31 + built-in 1/1; Stage node 2.498 PASS/1 skip (ae46c49 re-exec.; 204 arq.); stage-ui 1.140/1.140 (5ec464e, exit 1 por BL-2 — fetch real `updateCredits` → `api.airi.build`; 1.153 no ae46c49) | mocks/unit; nenhum runtime de voz; lint 81 erros conhecidos (0 warnings) | **PASS offline** — não promove gate |
| E-12 | Esta branch @ `4acd20e` — re-verificação 407300b (esta rodada) | `407300b` | Linux sandbox, worktree limpa `407300b-validation` (removida após coleta) | `…/407300b-2026-11-14/00-environment…08` | `build:packages` 33/33; lia-core voz 74/74; Stage áudio 1.592/1.592 (104 arq.); stage-ui áudio 242/242; A-1 31/31 + built-in 1/1 | **delta docs-only verificado** (`06-delta-…log`); incidente de `/tmp` (shim pnpm perdido entre turnos; 1ª tentativa FAIL, re-run PASS — preservado em `03a`) | **PASS offline** — não promove gate |
| E-13 | Esta branch — `docs/reports/evidence/lia-windows-integrated-validation-0818305/manifest.md` | `08183053…` (13/11) | Windows físico (Launcher) | manifest + `test-profile/lia-product.json` (só `locale` + `voice.enabled=false`) | boot OK (`renderer-ready` +791 ms); fechamento gracioso; **voz desabilitada no perfil**; nenhum screenshot; Computer Use/CDP/agent-browser indisponíveis | perfil de boot com voz **off**; nenhuma síntese/STT; perfil real `%APPDATA%\Lia` sem `lia-product.json`/`lia-secrets.json` | **PASS parcial** (boot); **SKIP** (áudio deliberadamente fora deste ensaio) |
| E-14 | Esta branch — `docs/project/CURRENT-STATE.md` §2 (esta branch) e `docs/reports/LIA-BRANCH-AUDIT-2026-11-14.md` | `3ef6d11` (E2E) / `0818305` etc. | Windows físico, **confirmado pelo usuário**, sem artefatos versionados | seção §2 ("Cadeia de voz — WINDOWS E2E PASS") | Lia iniciada por `Lia.bat`; mic/Hearing automáticos; transcrição visível; transcript→fluxo; Lia respondeu; **resposta reproduzida por TTS** | commit histórico ~193 atrás do tip; fases 7.8/7.9 reescreveram o caminho de voz (runtime, prewarm, métricas, seleção autoritativa); **nenhuma evidência versionada**; SHA não é o candidato | **SKIP** (histórico rotulado; **não transferível**) |
| E-15 | `qa/windows-benchmarks` @ `91b8995` | out/2026 bench | benchmark CI | `benchmarks/20261002-*` | PASS de infra (build/lint/typecheck/vitest); **nenhum WAV/áudio** | não qualifica áudio | **N/A** (irrelevante para este gate) |
| E-16 | `Tests/tools/kokoro-smoke-seam.test.mjs`, `qa-voice-metrics.mjs` (esta branch / `codex/lia-multi-provider-voice`) | ferramenta | estático/teste de costura | arquivos acima | harness de coleta de `lia.voice.*` e costura do smoke | ferramentas, não resultados | **N/A** (úteis para §7) |
| E-17 | Repo inteiro, esta branch | — | varredura por `*.wav`, `lia.voice.synthesize`, `lia-app.voice-install`, `lia-evidence` | **zero** arquivos | nenhum WAV, nenhum log de síntese real, nenhum log STT, nenhum log de worker | prova por ausência: o que não está versionado não existe para o gate | **BLOCKED** (as evidências residem em `J:\`) |

**Legenda de classe:** `PASS` = evidência versionada e executada (escopo declarado) · `PARTIAL` = parte provada, parte declarada · `BLOCKED` = existe/declara-se evidência mas inacessível/não inspecionável/impede o gate · `SKIP` = histórico/irrelevante/não verificável neste contexto · `FAIL` = execução falhou · `N/A` = fora do escopo.

---

## 3. As contradições, ponto a ponto

| Contradição aparente | Resolução |
|---|---|
| **4 WAVs** (E-01) × **6 WAVs** (E-02) | Não são dois números do mesmo evento. São **duas rodadas com runtimes e frases diferentes** (CPU 1.30.0 “smoke de produção” × ORT 1.24.4 “smoke isolado”). O próprio relatório admite que **não são série comparável**. Nenhuma das duas está versionada; portanto, para o gate, as duas são **BLOCKED** (existência não verificável), não “10 WAVs”. |
| Codex: "**WAVs válidos**" (E-01/E-02) × QA: "**Kokoro nunca sintetizou nesta base**" (E-06) | Escopos diferentes: **Windows físico** (declarado) × **Linux sandbox**. A QA não afirmou falha no Windows; o Codex não afirmou nada sobre o Linux. O erro foi de **delimitação de frase**, não de fato. Ambos corretos; nenhum prova o produto. |
| "Kokoro nunca sintetizou nesta base" (E-06/E-07) × Plano B-07 "TTS/STT reais nunca executados" (E-07/E-08) | Posicionamento equivalente para o gate: sem artefato versionado, **é NOT RUN**. O plano permanece correto: AV-01…AV-15 todos NOT RUN; **B-07 (áudio = bloqueador comprovado do beta interno) continua aberto**. |
| E2E "WINDOWS E2E PASS" @ `3ef6d11` (E-14) × áudio não provado @ `407300b` | Baselines diferentes (~193 commits; fases 7.8/7.9 introduziram bridge, prewarm, fila serializada, seleção autoritativa e métricas `lia.voice.synthesize`). Resultado histórico **não se transfere** para o SHA candidato; e nunca houve artefato versionado. |
| "**110 testes automatizados passaram**" (E-04) × "5.664 PASS / 18 skip / 0 FAIL" (E-11/E-12) | Recortes diferentes (suíte/áreas/metodologia). Ambos são N1 — **não funcionam como prova de runtime** para G-AUD. |
| "Shutdown do worker confirmado" (E-01) × vazamento de áudio não medido (AU-X-02/03, E-12) | O shutdown declarado refere-se ao **smoke isolado** (processo Python externo ao app). **Nada** mediu o ciclo completo dentro do aplicativo (boot → greeting → sínteses → fechamento), que é o que AV-12 exige. |
| QA (esta branch) × Plano rev.2 × Pré-plano rev.1 × Auditoria 2855180 | Os três documentos convergem no que importa: **nenhum elo de produção do áudio está aprovado**. Divergem apenas no tom (a versão antiga pessimista; esta reconciliação é a definitiva). |

---

## 4. As cinco grandezas que não podem ser confundidas (e o status de cada uma @ `407300b`)

| Grandeza | Pergunta | Estado @ `407300b` |
|---|---|---|
| **WAV existe** | Existe arquivo `.wav` em algum lugar? | Declaro **sim em `J:\lia-evidence\beta-407300b-windows-20261114\`** (E-01/E-02) — **não inspecionado, não versionado → não verificável**. No repo: **não** (E-17). |
| **WAV é tecnicamente válido** | Header/mono/24 kHz/duração/RMS/clipping? | **Não verificado por ninguém independente.** A validade declarada é do autor da coleta. Exige inspeção automatizada (§7). |
| **Síntese executada pelo aplicativo** | `lia.voice.synthesize` em sessão real do Stage? | **Não provado** — zero logs versionados (E-17). O smoke é uma ferramenta externa, não o app. |
| **Reprodução no aplicativo** | AudioContext → playback-manager → alto-falante, verificado? | **Não provado** (Codex declarou pendente — E-04). |
| **Fluxo completo de conversa com TTS** | mic → VAD → STT → chat → resposta → TTS → reprodução → interrupção → liberação | **Não provado** (AV-01…AV-15 todos NOT RUN; E-08/E-12). Histórico `3ef6d11` = rotulado, não transfere (E-14). |

---

## 5. Auditoria do gate de áudio em nove etapas — estado oficial @ `407300b`

Legenda: `unit PASS` = N1 verde no Linux (evidência versionada) · `declarado` = afirmado por terceiro, não versionado · `histórico` = `3ef6d11` · `NOT RUN` = sem prova no SHA · `BLOCKED` = precisa de acesso externo · `AV-xx` = critério do plano rev.2 · `AU-*` = caso da matriz de áudio desta branch.

| # | Etapa | unit (Linux) | Windows físico (declarado) | Estado oficial @ `407300b` | Prova mínima (gate) |
|---|---|---|---|---|---|
| 1 | **Microfone** (permissão, device, captura) | hearing `PASS` (13 testes) | pendente (Codex E-04) / `histórico` | **NOT RUN** | AV-01, AV-02, AV-03; AU-STT-01…06 |
| 2 | **VAD** (início/fim de fala; silero baixa em runtime) | voice-input-vad-startup `PASS` | não verificado | **NOT RUN** (depende de rede p/ silero-vad) | AV-03; AU-STT-06 |
| 3 | **STT** (Groq no Main; chunking; cancelamento) | transcription-service/adapters `PASS` | pendente / `histórico` | **NOT RUN** (gate exige STT Groq real) | AV-04, AV-05, AV-06; AU-STT-07…20 |
| 4 | **Texto no chat** (D2B12; composer) | voice-send-sequence/pipeline `PASS` | pendente / `histórico` | **NOT RUN** | AV-06; AU-STT-10/11 |
| 5 | **Resposta** (Brain → segmento de fala) | chat contracts `PASS` | pendente / `histórico` | **NOT RUN** | AV-06; AU-X-09 |
| 6 | **TTS** (Kokoro local, fila, seleção autoritativa) | voice-service/engine `PASS` (74) | **smoke declarado: 4 + 6 WAVs (N2)**; DirectML FAIL | **PARTIAL (não utilizável)** — N3 in-app inexistente | AV-07, AV-08, AV-10; AU-TTS-01…16 |
| 7 | **Reprodução** (Web Audio; playback-manager; parada ≤ 1 s) | playback stubbed `PASS` | pendente | **NOT RUN** | AV-08, AV-11; AU-TTS-06/07; AU-X-05/06 |
| 8 | **Interrupção** (stopByIntent; cancelar síntese e reprodução) | stop/cancel paths `PASS` (unit) | pendente | **NOT RUN** | AV-08, AV-11; AU-TTS-07/08; AU-X-04/05 |
| 9 | **Liberação de recursos** (tracks, workers Kokoro, WAVs, fila) | shutdown-coordinator `PASS` (unit); worker shutdown declarado (smoke) | **não medido no app** | **NOT RUN** | AV-12; AU-X-01/02/03/07 |

**Score de gate: 0/9 elos provados.** Mesmo creditando o smoke declarado à etapa 6 como “PARTIAL”, nenhum elo satisfaz o plano rev.2 (AV-01…AV-15 no Windows físico, mesmo SHA, artefatos versionados).

---

## 6. O que existe no repositório × o que está fora (`J:\lia-evidence\`)

**Dentro (verificado):** nenhum WAV; nenhum log com `lia.voice.synthesize`, `lia.voice.prewarm`, `lia-app.voice-install`, `lia.voice.engine.error`; nenhum transcript Groq; nenhum manifesto de smoke do Windows; nenhuma medição RTF; nenhuma listagem de `J:\`. A evidência desta branch para áudio é exclusivamente **offline** (listada em E-11/E-12/E-13/E-17).

**Fora (declarado, não acessível por este sandbox; `J:` é a máquina física Windows):**

```
J:\lia-evidence\
├─ beta-407300b-windows-20261114\     ← Kokoro smoke 1.30.0 (4 WAVs), smoke ORT 1.24.4 (6 WAVs),
│                                      DirectML FAIL (2 tentativas), (provavelmente) logs de console,
│                                      timings (9,5 s cold start; 4,45–7,85 s; 1,50–4,88 s)
└─ rx580-local-ai-407300b\            ← llama.cpp Vulkan (texto; 25/25 camadas; pico 98% compute)
```

Detalhes estruturais (subpastas, nomes de arquivo, tamanho de cada WAV, hashes, se há `lia-console.log`, se há `Tests/artifacts/kokoro-smoke/` no checkout) **não são conhecidos daqui** — perguntá-los ao Codex é parte do roteiro §8.

---

## 7. Evidências que precisam ser recuperadas (e o que cada uma deve provar)

| # | Item a recuperar de `J:\lia-evidence\beta-407300b-windows-20261114\` (e entorno) | Deve responder | Aceite |
|---|---|---|---|
| R-1 | Inventário recursivo do diretório (`Get-ChildItem -Recurse | Select FullName,Length,LastWriteTime`) | o que existe, tamanhos, datas | inventário commitado (texto) |
| R-2 | Todos os **10 WAVs** (4 + 6) | existência, tamanho, formato | SHA-256 de cada um registrado; se total ≤ ~8 MB, commitar os binários em `docs/reports/evidence/LIA-WINDOWS-VOZ/wav/`; senão, manifest com hashes + 1 WAV representativo por rodada |
| R-3 | Inspeção técnica de cada WAV (header RIFF, canais, sample rate 24 000, duração > 0,5 s, RMS > 0, sem clipping, taxa de fala plausível) — script Python (`wave`+`audioop`) ou equivalente | validade técnica declarada em E-01/E-02 | relatório `wav-inspection.txt` commitado com tabela WAV→(dur,RMS,peak,clip) |
| R-4 | Logs completos das duas rodadas de smoke (stdout/stderr) + comando exato + a versão exata do runtime Kokoro/ONNX usada no worker Python (“CPU 1.30.0” precisa ser confirmada; a tentativa com ORT 1.24.4 DirectML falhou antes de produzir WAV), `python -V`, hash do modelo (`fbae9257…` esperado) | método, SHA da árvore, RTF por frase, tempos de cold start | logs commitados (sanitizados) + linha de commit do checkout no momento da coleta |
| R-5 | Logs da falha DirectML (traceback ConvTranspose) | falha E-03 é mesmo DirectML EP e não config | log commitado |
| R-6 | Confirmação de que o ambiente de coleta era **o SHA `407300b`** (`git -C <checkout> rev-parse HEAD`) | o alvo desta disputa | sem isso, toda a evidência é ANULADA para o gate |
| R-7 | `Tests/artifacts/kokoro-smoke*` e `.devkit-qa/` do checkout Windows (saídas da ferramenta) | extensão do smoke e consistência com R-4 | manifest commitado |
| R-8 | **N3 in-app**: log de console do Launcher/Stage de uma sessão com `lia.voice.synthesize`, `lia.voice.prewarm`, greeting, shutdown limpo | aplicativo, não smoke | log commitado sanitizado |
| R-9 | **N4–N6**: roteiro AV-01…AV-15 completo (ou os AU-* do LIA-AUDIO-QA-MATRIX) com a Parte 7 do roteiro da matriz mestre | o gate inteiro | evidências por AV-xx conforme §8 |
| R-10 | Estado do `%APPDATA%\Lia` antes/depois (perfil) | sem corrupção; `%LOCALAPPDATA%\Lia\runtimes` íntegro | listagem sanitizada |

Se qualquer item não existir (foi perdido com a máquina/limpeza), registrar **BLOCKED/não recuperável** e reexecutar o smoke no SHA congelado — nunca reconstruir de memória.

---

## 8. Roteiro curto para o Codex (Windows, quando acessar `J:\`)

> Executar na máquina Windows 11 física. **Não** alterar código; **não** mudar de branch; trabalhar na branch de coleta designada; commitar somente `docs/**`. Cada passo com timestamp e saída literal. Se qualquer pré-condição faltar → **BLOCKED** com o comando exato e o erro.

1. **Âncora de SHA.** No checkout de coleta: `git rev-parse HEAD` → deve ser `407300b8baa56b0ed8d14b7b2c0628222754e51f` (ou a tag congelada da coleta). `git status --porcelain` → limpo. Registrar os dois em `00-ambiente.txt`.
2. **Inventário.** `Get-ChildItem 'J:\lia-evidence\beta-407300b-windows-20261114' -Recurse -File | Select FullName,Length,LastWriteTime | Format-Table | Out-File inventory.txt`. Idem para `rx580-local-ai-407300b`. Commitar como `01-inventario.txt`.
3. **Hashes.** `Get-ChildItem … -File | Get-FileHash -Algorithm SHA256 | Out-File 02-sha256.txt`. Commitar.
4. **Inspeção dos WAVs.** Rodar um inspetor (ex.: Python no host: abrir com `wave`, exigir `nchannels=1`, `framerate=24000`, `sampwidth=2`, `nframes`→duração; calcular RMS e pico; marcar clipping). Salvar `03-wav-inspection.txt`/`.csv` com uma linha por WAV. **Anotar qualquer discrepância** (ex.: 48 kHz = re-encode, invalida o caminho Kokoro direto).
5. **Commitar artefatos.** WAVs ≤ ~8 MB no total → commitar em `docs/reports/evidence/LIA-WINDOWS-VOZ-20261114-407300b/wav/` + WAVs representativos; acima disso → `04-wav-manifest.sha256` + 1 WAV por rodada. Nunca commitar áudio com voz clonada/identidade pessoal sem autorização.
6. **Re-execução do smoke no SHA de coleta.** `node tools\kokoro-smoke.mjs <artifactsDir>`; comparar RTF/timings com R-4; commitar o novo log (a **série comparável** exigida pela divergência E-01×E-02).
7. **Fechar os elos N3–N6.** Rodar `Lia.bat` no perfil sintético; AI Settings c/ chave Groq na UI; abrir Stage; usar o roteiro §7 da matriz mestre e a Parte 7 expandida de `LIA-AUDIO-QA-MATRIX.md`; coletar AV-01…AV-15 (incl. AU-X-02/07 para recursos/órfãos), cada um com log e (quando aplicável) screenshot sanitizado.
8. **Publicar.** Commitar em `docs/reports/evidence/LIA-WINDOWS-VOZ-<data>-<sha-curto>/`; atualizar `CURRENT-STATE.md` **no mesmo commit** que fechar o gate de voz; anexar o resultado em relatório curto referenciando este documento. G-AUD só é declarado com os 15 AV-* PASS no mesmo SHA.
9. **Limpeza segura.** Não apagar `J:\lia-evidence`; não commitar binários grandes; não incluir `%APPDATA%\Lia` bruto; varredura anti-segredo antes do push.
10. **Se a coleta falhar** (rede, Python, mic, alto-falante): registrar **BLOCKED** por AV-xx, com comando/erro; **não** reverter para mock; **não** declarar parcial; atualizar o relatório de beta com o estado.

---

## 9. Leituras que este relatório recomenda corrigir (sem editar nada aqui)

1. `LIA-AUDIO-QA-MATRIX.md` §0/BL-A1: trocar a leitura de “Kokoro nunca sintetizou nesta base” para “nunca sintetizou no Linux/sandbox; no Windows, smoke declarado porém não versionado — NOT RUN para fins de gate”.
2. Plano rev.2 (`arena/01a10290…`/`codex/lia-multi-provider-voice`/`arena/7fa837f0…`): **não** relaxar B-07/AV-01…AV-15 com base nos WAVs até R-1…R-7 serem versionados.
3. Auditoria `2855180` (Anexo B.1/R-02/E-5): confirmada a divergência factual; este documento cumpre o “auditar `J:/lia-evidence`” **na parte documental**; a parte física (inspeção) fica com o Codex (§8).
4. Histórico `3ef6d11` (“WINDOWS E2E PASS”, esta branch, `CURRENT-STATE.md` §2): rotular explicitamente como **histórico não transferível** em qualquer relatório de beta; não citar como prova do candidato.
5. `LIA-BRANCH-AUDIT-2026-11-14.md` (esta branch): a linha “Cadeia STT→Brain→Kokoro validada em Windows no baseline `3ef6d11`” herda a limitação — manter, rotulada.

Nenhuma alteração de conteúdo foi feita nos documentos acima (restrição: preservar relatórios existentes).

---

## 10. O que esta auditoria NÃO conseguiu fazer (limitações)

1. **Inspecionar os WAVs** — `J:\` é inacessível neste sandbox; não há montagem, compartilhamento nem cópia. Nenhuma validação de header/RTF foi executada aqui.
2. **Reexecutar o smoke ou qualquer AV-xx** — exigiria Windows + rede + dispositivos; nada foi executado (e nada podia ser).
3. **Verificar os hashes dos pesos Kokoro** na máquina Windows (esperado `fbae9257…`).
4. **Verificar a identidade exata da máquina/perfil** da coleta 407300b no Windows.
5. **Confirmar a contagem “110 testes automatizados”** — não re-executada; tratada como SKIP (E-04).
6. **Recuperar os artefatos da rodada DirectML** — só com acesso ao Windows.
7. **Validar `J:\lia-evidence\rx580-local-ai-407300b`** — fora de escopo de áudio (texto); inventariar apenas.

---

## Anexo — Registro da sessão

```
# Estado do repo no início (rollback de snapshot detectado; refs locais perderam os commits da sessão)
git status --short                       # HEAD = 7cb8172, trabalho da sessão como untracked
git fetch origin arena/18f50ae7-lia-project   # FETCH_HEAD = 4acd20e (pushed)
# conferência byte-a-byte de cada arquivo docs/reports/* vs FETCH_HEAD → idênticos
git update-ref refs/heads/arena/18f50ae7-lia-project 4acd20e6fa5b8245bf135f5ba5bea386d00b4ba7
git read-tree HEAD && git checkout-index -a -f        # tree == HEAD; status limpo
# Leituras forenses (read-only)
git fetch origin main                      # main = 9c7ac18 (não contém a auditoria central)
git fetch origin '+refs/heads/*:refs/remotes/origin/*'   # traz 2855180 e branches remotas
git show 2855180:docs/reports/LIA-GIT-BRANCH-ORGANIZATION-AUDIT.md   # auditoria central
git show origin/codex/lia-multi-provider-voice:docs/reports/LIA-MULTI-PROVIDER-VOICE-ARCHITECTURE.md
git show 0bf0629:docs/reports/LIA-BETA-READINESS-PLAN-2026-11-14.md  # plano rev.2 (AV-01…AV-15)
grep -rniE 'wav|kokoro|lia-evidence|synth' docs/       # inventário local
ls docs/reports/evidence/                    # 5 diretórios; zero WAVs/logs de síntese
```

Nenhum teste de produto foi executado (desnecessário e insuficiente para esta auditoria de evidências); nenhum código editado; nenhuma evidência apagada; nenhuma branch/ref principal alterada.

**Veredicto final:** as evidências de áudio de `407300b` existem apenas **fora do repositório** e **sem inspeção independente**; **nenhuma etapa do gate de áudio está aprovada** (0/9); **G-AUD PERMANECE BLOCKED** até o Codex executar §8 e os critérios AV-01…AV-15 ficarem PASS no mesmo SHA congelado, com `CURRENT-STATE.md` atualizado no mesmo commit.
