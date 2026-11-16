# Lia — Reconciliação de QA de áudio (AV-01…AV-15)

**Data:** 16/11/2026
**Branch de origem (leitura):** `arena/18f50ae7-lia-project` @ `ccf3386120`
**Branch de destino:** `arena/7fa837f0-lia-project` @ `971d309074`
**Documentos preservados byte-a-byte nesta branch:**
[`LIA-AV-ACCEPTANCE-CRITERIA.md`](LIA-AV-ACCEPTANCE-CRITERIA.md) · [`LIA-AUDIO-QA-MATRIX.md`](LIA-AUDIO-QA-MATRIX.md) · [`LIA-AUDIO-EVIDENCE-RECONCILIATION.md`](LIA-AUDIO-EVIDENCE-RECONCILIATION.md)
**Natureza:** consolidação documental. **Nenhum teste executado nesta rodada.**
**Regra-mãe:** *não reduzir critérios; não transformar NOT RUN em PASS; mock ≠ integração; Linux ≠ Windows.*

---

## 0. Veredicto

| Pergunta | Resposta |
|---|---|
| Quantos AV estão PASS? | **0/15.** |
| Quantos atribuíveis? | **0.** |
| G-AUD | **BLOCKED.** |
| O áudio está construído? | Sim (fila serializada, seleção autoritativa, STT no Main, Kokoro CPU-only). |
| O áudio **funciona** no SHA candidato? | **Não provado.** Nenhum log `lia.voice.synthesize` versionado; nenhuma captura real; nenhum STT real. |
| Existe evidência recuperável de `9e94dce`? | **Não.** O commit e a branch citados **não existem** em nenhuma ref. |
| A evidência Windows (4 + 6 WAVs) vale para o gate? | **Não.** É N2 (smoke dev-only), externa ao repositório, não inspecionável. |

---

## 1. Investigação da "entrega local do Codex" — resultado factual

| Verificação (somente leitura) | Resultado |
|---|---|
| `git cat-file -t 9e94dce` | **objeto não existe** |
| `git rev-list --all --objects \| grep 9e94dce` | **0 objetos** |
| `git ls-remote --heads --tags origin` | 12 branches + 4 PR refs; **nenhuma** `codex/lia-audio-recovery-407300b` |
| `gh api repos/BloomRX/Lia-Project/commits/9e94dce` | **422 — "No commit found for SHA"** |
| PRs (`gh pr list --state all`) | `pr/1`…`pr/4`; nenhum contém o SHA |
| Google Drive (`search_files`: `LIA`, `AUD`, `AV-`, `audio`, `407300b`, `evidência`) | **0 artefatos relevantes** (1 PDF clínico de 2025, sem relação) |
| Repositório local: `*.wav`, `lia.voice.synthesize`, `lia-app.voice-install` | **0 arquivos** |
| Branches locais (`git branch -a`) | apenas `arena/7fa837f0` e `main` |
| Stash (`git stash list`) | **vazio** |
| Objetos soltos (`git fsck --lost-found --no-reflogs`) | **nenhum commit dangling** |
| Reflog | clone + checkout; nenhum trabalho perdido registrado |

**Conclusão:** não há entrega local recuperável pelo Git, pelo GitHub ou pelo Drive. Pode ser um commit nunca enviado no checkout Windows (perdido) ou um SHA incorreto. **Não há como distinguir sem a máquina de origem.** Este relatório **não inventa** reconstrução, não estima conteúdo e não promove nenhum AV por causa disso.

**O que destrava:** o Codex, na máquina Windows, deve rodar `git log --all --oneline \| grep -i audio` / `git fsck --lost-found` no checkout local e, se encontrar, publicar em branch própria (`codex/lia-audio-recovery-407300b`) **ou** anexar manifesto (SHA-256, comandos, logs) a um relatório. Sem isso, o capítulo está encerrado como **BLOCKED**.

---

## 2. As nove camadas que não podem ser confundidas

| # | Camada | O que prova | Como se prova | Estado em `407300b` | Nível |
|---|---|---|---|---|---|
| L1 | **WAV válido** | que o arquivo é áudio PCM legítimo | header RIFF/fmt/data, 1 canal, 24 kHz, 16-bit, duração > 0,5 s, RMS > 0, sem clipping | **declarado** (4 + 6), não inspecionado | N2 |
| L2 | **Síntese local isolada** | que o engine sintetiza fora do app | `tools/kokoro-smoke.mjs` com RTF medido | **declarado** (4 WAVs CPU 1.30.0; 6 WAVs ORT 1.24.4) | N2 |
| L3 | **Síntese no Stage** | que o **app** sintetiza | log `lia.voice.synthesize` de sessão real | **não provado** | N3 |
| L4 | **Reprodução no app** | que o áudio sai pelo alto-falante | audição + log de playback | **não provado** | N4 |
| L5 | **Captura de microfone** | que o mic captura e o VAD segmenta | permissão + log VAD + duração | **não provado** | N5 |
| L6 | **STT real** | que a transcrição sai correta | Groq real + palavras-chave | **não provado** | N5 |
| L7 | **Turno completo** | mic → STT → chat → Brain → TTS → som | log único com timings | **não provado** (histórico `3ef6d11`, não transferível) | N6 |
| L8 | **Interrupção** | parar fala ≤1 s, sem sobreposição, fila liberada | log + gravação | **não provado** | N6 |
| L9 | **Liberação de recursos** | zero órfãos (python/worker/Electron), reabertura íntegra | `Get-Process` antes/depois | **não provado in-app** (shutdown do worker externo declarado) | N6 |

**Consequência:** "WAV válido" (L1) e "síntese local isolada" (L2) **não** implicam L3–L9. O gate G-AUD exige L3–L9 no mesmo SHA; é por isso que 4 ou 6 WAVs não movem o placar.

---

## 3. AV-01…AV-15 — definição e estado (preservados, sem redução)

| ID | Critério (resumo fiel) | Estado | Bloqueio |
|---|---|---|---|
| **AV-01** | Mic: permissão só para áudio; vídeo negado; sobrevive a reabrir | **NOT RUN** | Windows + hardware |
| **AV-02** | Seleção de dispositivo ≥1 entrada; troca persiste; próxima captura usa o novo | **NOT RUN** | Windows + hardware |
| **AV-03** | Captura + VAD: 3 s de fala → início/fim e buffer ≥2 s; silêncio não envia | **NOT RUN** | Windows + silero-vad |
| **AV-04** | STT Groq: ≤ **1,5×duração + 2 s** e ≥90% palavras-chave (3 frases pt-BR) — **limiar PROPOSTO** | **NOT RUN** | **P-2** + rede + chave |
| **AV-05** | STT sem vazar chave; falha de provider tipada | **NOT RUN** | Windows + chave real |
| **AV-06** | Transcrição vira exatamente UMA mensagem e a conversa responde | **NOT RUN** | Windows |
| **AV-07** | Kokoro instala, pré-aquece e sintetiza pt-BR com RTF ≤ **0,5** — **limiar PROPOSTO** | **NOT RUN / BLOCKED** | **P-2** + rede + Python |
| **AV-08** | Reprodução no dispositivo padrão; legenda; "parar" ≤1 s sem retomar | **NOT RUN** | Windows + alto-falante |
| **AV-09** | Falhas (offline, engine ausente, voz inexistente) → mensagem humana, sem crash | **NOT RUN** | Windows |
| **AV-10** | Seleção `voice.tts` persiste `preferred`/`fallback`; não grava segredo | **NOT RUN** | Windows + perfil |
| **AV-11** | Cancelamento libera fila; nenhuma 2ª reprodução começa | **NOT RUN** | Windows |
| **AV-12** | Encerramento sem órfãos; próxima abertura sintetiza | **NOT RUN** | Windows |
| **AV-13** | Mic ausente/negado → texto funciona com erro tipado | **NOT RUN** | Windows |
| **AV-14** | UI distingue preparando/pronta/erro/indisponível; nunca "pronta" sem engine | **NOT RUN** | Windows |
| **AV-15** | Áudio não persistido sem consentimento; transcrição não em log de diagnóstico | **NOT RUN** | Windows + inspeção de perfil |

**Placar preservado: 0/15 atribuíveis.** Nenhuma linha foi reclassificada nesta rodada.

**Regras R-01…R-10 preservadas** (íntegras no documento de origem): SHA congelado em `00-ambiente.txt`; mesmo SHA em todos os AV; Windows 11 físico; método literal com log; artefato inspecionável; WAV RIFF 24 kHz mono 16-bit sem clipping; mock não conta; anti-segredo/anti-PII; rastreio `lia.voice.*`; fechamento honesto com `CURRENT-STATE.md` no mesmo commit.

> **Nota sobre limiares:** AV-04 (`1,5×dur + 2 s`, 90% keywords) e AV-07 (`RTF ≤ 0,5`) continuam **PROPOSTOS**. O plano rev.2 os marca como pendentes de **P-2**. Sem decisão escrita, um PASS nesses dois é **inválido por construção** — não por falta de execução, mas por falta de régua aprovada.

---

## 4. Evidências por SHA · ambiente · teste · resultado

| # | SHA | Ambiente | Teste | Resultado declarado | Classe | Vale para G-AUD? |
|---|---|---|---|---|---|---|
| E-01 | `407300b` | Windows 11 físico (RX 580/Ryzen 5 5500/16 GB) | smoke Kokoro CPU 1.30.0 | 4 WAVs válidos; cold start 9,5 s; síntese 4,45–7,85 s; shutdown do worker | **N2 declarado, não versionado** | **NÃO** |
| E-02 | `407300b` | Windows 11 físico | smoke isolado ORT 1.24.4 | 6 WAVs CPU 1,50–4,88 s; frases diferentes | **N2 declarado, não versionado** | **NÃO** |
| E-03 | `407300b` | Windows 11 físico | Kokoro DirectML 1.24.4 | **2 tentativas falharam** no `ConvTranspose` antes de WAV | **N2 FAIL declarado** | **NÃO** (mas é FAIL a registrar) |
| E-04 | `407300b` | Windows 11 físico | suíte automatizada | "110 testes passaram"; reprodução/mic/STT/turno "pendentes" | **N1** | **NÃO** |
| E-05 | `407300b` | Windows 11 físico (RX 580) | llama.cpp Vulkan (texto) | 25/25 camadas na GPU; pico 98% compute | **N/A (texto)** | **NÃO** |
| E-06 | `407300b` | **Linux sandbox** | `lia-core` voz 74/74; Stage áudio 1.592/1.592; stage-ui 242/242; A-1 31/31+1/1 | **1.940 PASS offline** | **N1 versionado** | **NÃO** |
| E-07 | `5ec464e` / `ae46c49` | Linux sandbox | suítes offline (carry-forward rotulado) | 381/381; 2.498 PASS; 1.140/1.140 (exit 1 por unhandled rejection); 81 erros de lint | **N1 versionado** | **NÃO** |
| E-08 | `0818305` | Windows físico | boot do Launcher | `renderer-ready` +791 ms; fechamento gracioso; **voz desabilitada no perfil** | **PASS parcial (boot)** | **NÃO** (áudio off) |
| E-09 | `3ef6d11` (histórico) | Windows físico | E2E de voz confirmado pelo usuário | mic/Hearing automáticos; transcrição visível; Lia respondeu; TTS tocou | **N6 histórico** | **NÃO** (~193 commits atrás; fases 7.8/7.9 reescreveram o caminho) |
| E-10 | `qa/windows-benchmarks` (`91b8995`) | CI Windows | build/lint/typecheck/vitest | PASS de infra; **nenhum WAV** | **N/A** | **NÃO** |
| E-11 | `407300b` | Windows (declarado) | varredura do repo | **zero** WAV/log de síntese/STT versionado | **BLOCKED (prova por ausência)** | **NÃO** |

**Nada nesta tabela foi reexecutado nesta rodada.** As classes são as atribuídas pelos documentos de origem.

---

## 5. O que cada camada exigiria (checklist operacional para o Codex)

| Camada | Passo mínimo | Artefato |
|---|---|---|
| L1/L2 | `node tools\kokoro-smoke.mjs <outDir>` no SHA congelado | WAV + RTF + sha256 do modelo |
| L3 | abrir Launcher managed com `voice.enabled`, ouvir greeting | log `lia.voice.synthesize` (engine, RTF, fila, duração, sampleRate 24000, mono) |
| L4 | resposta falada + "parar fala" | log playback + descrição do observador |
| L5 | permissão de mic + 3 s de fala + 10 s de silêncio | log VAD + duração do buffer |
| L6 | frase fixa → Groq | transcript + timestamps + palavras-chave |
| L7 | turno único mic→resposta falada | log único com timings |
| L8 | nova mensagem durante a fala | log de interrupção + gravação |
| L9 | `Get-Process` antes/depois; reabrir | saída de comando + histórico/greeting 1× |

**Pré-condições:** SHA anunciado, `git status` limpo, perfil sintético (`%APPDATA%\Lia` com backup), chave Groq no vault (nunca em env var), rede para HF/jsDelivr e `api.groq.com`, antivírus/SmartScreen documentado se bloquear o worker Python.

**Proibido:** contornar barreira de rede, usar chave em variável de ambiente como atalho, desativar antivírus sem registro, "ajustar" comportamento durante a coleta, screenshot sem log.

---

## 6. Bloqueadores (preservados)

| ID | Bloqueador | Destrava com |
|---|---|---|
| BL-A1 | Kokoro nunca instalado/sintetizado **nesta base** | AU-TTS-01/02 no Windows (ou Linux com rede) |
| BL-A2 | STT real nunca executado | AU-STT-07 no Windows |
| BL-A3 | Playback nunca verificado | AU-TTS-06 |
| BL-A4 | Vazamento de áudio nunca medido (tracks/workers) | AU-X-01/02/03/07 |
| BL-A5 | Gate exige SHA congelado; re-coleta obrigatória | SHA taggeado |
| **BL-A6** | **Evidência Windows externa ao repo** | REC-01 (manifesto + hashes) |
| **BL-A7** | **`9e94dce` / branch de recuperação inexistentes** | Codex na máquina de origem |

---

## 7. Riscos de leitura (falsos positivos)

| Leitura errada | Correção |
|---|---|
| "4 + 6 = 10 WAVs" | Duas rodadas, runtimes e frases diferentes; **não comparáveis** (o próprio relatório diz) |
| "WAV válido ⇒ Lia fala" | L1 ≠ L3/L4; falta síntese **pelo app** e reprodução audível |
| "shutdown do worker confirmado ⇒ sem órfãos" | Refere-se ao smoke externo; ciclo in-app não medido (AV-12) |
| "1.940 PASS ⇒ áudio aprovado" | É N1; nenhum runtime de voz |
| "histórico `3ef6d11` PASS ⇒ vale" | ~193 commits; caminho de voz reescrito; sem artefato versionado |
| "DirectML falhou ⇒ Kokoro não funciona" | DirectML está fora do escopo do build (CPU-only); o FAIL é do backend, não do produto |

---

## 8. Caminho de desbloqueio (ordem)

1. **REC-02 (P-2)** — aprovar ou remover por escrito os limiares de AV-04/AV-07.
2. **REC-01** — Codex versiona manifesto da evidência existente (se ainda houver acesso a `J:\`), **ou** declara perdida e re-coleta.
3. **AUD-R-01** — executar os 15 AV no Windows físico, SHA congelado, mesmo commit.
4. **AUD-R-02** — anexar artefatos com R-01…R-10.
5. **AUD-R-03** — fechar G-AUD e atualizar `CURRENT-STATE.md` no mesmo commit.

**Nenhum passo foi dado nesta rodada.** G-AUD permanece **BLOCKED**.
