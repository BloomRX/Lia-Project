# Lia — Matriz de QA de áudio (TTS e STT) do beta interno

**Data:** 2026-11-14 · **Autor:** Arena (Linux/WSL) · **Branch:** `arena/18f50ae7-lia-project`
**SHA de referência:** `407300b8baa56b0ed8d14b7b2c0628222754e51f` (`407300b`). Delta `ae46c49 → 407300b` é **docs-only** (verificado — `docs/reports/evidence/LIA-QA-VALIDATION-407300b-2026-11-14/06-delta-ae46c49-407300b.log`); a árvore de código é idêntica à de `ae46c49`.
**Escopo:** beta **interno** · **voz e STT obrigatórios** (D2 = sim) · **Fase 1 de UI/UX autorizada** (testes são de protocolo/contrato, não de layout) · **OIDC NÃO aprovado para o beta** (nenhum teste deste documento depende de OIDC; a transcrição usa a credencial Groq já existente no vault, no escopo `groq`).
**Regra de ouro:** nenhuma linha desta matriz pode ser promovida a PASS por existência de componentes, por typecheck ou por testes unitários. **PASS de voz/STT exige execução real com SHA, comando, saída e artefato sanitizado.** Definições em §8–§9.

---

## 0. Resumo executivo

| Pergunta | Resposta |
|---|---|
| O pipeline de voz está construído? | **Sim** (fila FIFO serializada, seleção autoritativa `engineId`, métricas `lia.voice.synthesize`, Kokoro CPU-only, STT via Groq em `main`). |
| Ele funciona de ponta a ponta (mic → Brain → Kokoro)? | **Não provado.** 0% runtime neste SHA; Kokoro nunca sintetizou nesta base; STT nunca transcreveu áudio real. |
| Cobertura offline existe e passa? | **Sim:** lia-core voz 74/74; Stage áudio/voz/hearing 1.592/1.592 (104 arq.); stage-ui áudio 242/242; A-1 31/31 + built-in 1/1 — evidência em `docs/reports/evidence/LIA-QA-VALIDATION-407300b-2026-11-14/`. |
| O que falta para o beta interno (voz obrigatória)? | W-21…W-27 e AU-* abaixo, com mic/alto-falantes/Windows, chave Groq no vault, e rede para HF/jsDelivr (instalação Kokoro) e `api.groq.com` (STT). |
| Vazamento de áudio é um risco conhecido? | **Sim, não medido:** streams de mic e workers Kokoro nunca foram auditados em runtime; testes AU-X-01…04/07 cobrem. |

---

## 1. Referência técnica do pipeline de áudio (para o Codex não redescobrir)

### 1.1 STT — caminho do áudio do usuário até o texto

```
[Mic] → renderer: voice-input-session (state machine; VAD; segmentos)          (stage-ui composables/audio/)
      → use-streaming-transcription-input (substituição/commit no composer)    (stage-ui)
      → hearing store: @proj-airi/stage-ui/stores/modules/hearing              (stage-ui)
      → Lia hearing projection: renderer/stores/lia/hearing.ts                  (lia-managed, READ-ONLY IPC electronLiaHearingConfigGet;
                                                                                projeta a seleção STT gerenciada pelo Launcher)
      → main-transcription.ts → IPC electronLiaTranscriptionRun                 (renderer→main)
      → transcription-service.ts (MAIN): resolve transporte (lia-transports.json), credencial do vault
        (escopo `groq`), POST OpenAI-compatible em `https://api.groq.com/openai/v1/audio/transcriptions`
        modelo derivada `whisper-large-v3-turbo` (id derivado `lia-groq-transcription`;
        definitionId `openai-compatible-audio-transcription`)
      → limites: MAX_AUDIO_BYTES = 24 MB · TIMEOUT_MS = 30 000 · verbose_json opcional · request-id UUID
      → resposta → pipeline D2B12 (voice-send): o texto entra no fluxo de voz/composer;
        transcrição NÃO chama chatStore.send diretamente — o envio segue o caminho de voz existente
```

- Provedor nativo Apple (`apple-speech-transcription`) existe para macOS — **fora do escopo do beta interno Windows**; registrar NOT RUN se executado em outra plataforma.
- Cancelamento: `electronLiaTranscriptionCancel` + `AbortSignal` com wrapper `abortable` (para dependências que ignoram abort) em `transcription-service.ts`.
- Erros tipados: `ProviderError` com códigos (`configuration`, `network`, `input-invalid`, …) — a UI deve exibir mensagem tipada, nunca stack/chave.
- Transporte compartilhado: a mesma entrada de `lia-transports.json` do chat — remover o provider **para o chat** também para o STT.

### 1.2 TTS — caminho do texto até o alto-falante

```
[Resposta do Brain] → chat-voice-pipeline (renderer): speechStore.speech() por segmento
      → stage-ui: libs/speech/tts-session → playback-manager (Web Audio; AudioContext; stopByIntent)
      → IPC Lia voice bridge (lia-voice-service.ts, MAIN, registerLiaVoiceBridge;
        registrada ANTES do renderer load — main-window-voice-runtime.ts)
      → LiaVoiceService (lia-core/voice): fila FIFO única, serializada; seleção AUTORITATIVA
        (engineId resolvido → APENAS aquele engine; seleção não resolvida → rota vazia →
        `voice-unavailable`, NUNCA switch silencioso de TTS)
      → KokoroVoiceEngine (CPU-only; kokoro-onnx 0.6.1 + espeakng; venv próprio;
        modelo Kokoro-82M-v1.0-ONNX 92.361.116 bytes; sha256
        fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478)
      → métricas por síntese: log `lia.voice.synthesize` (engine, RTF, filas, duração, textLength, sampleRate 24000, mono)
      → WAV → playback-manager → [Alto-falante]
```

- **Instalação:** `ensureKokoroInstalled` (idempotente, marker-pinned; HF `huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX` primário, jsDelivr shards fallback) — ou via smoke dev-only `node tools\kokoro-smoke.mjs [outDir]` (mede RTF, imprime `kokoroSmokeSummaryLine`). Windows real usa `%LOCALAPPDATA%\Lia\runtimes`; POSIX usa staging interno (não sujar a máquina de dev).
- **Prewarm:** somente em launch **managed** com `voice.enabled` — fire-and-forget; falha degrada para `voice-unavailable` (diagnostics), nunca trava o boot.
- **Vozes pt-BR desta build:** `pf_dora` (padrão), `pm_alex`, `pm_santa` (no .bin delas); `KOKORO_DEFAULT_LANGUAGE = pt-br`; outras línguas seguem o tag do usuário.
- **Startup greeting** (janela principal): latch exactly-once no processo — a saudação inicial é o primeiro consumidor real de TTS no boot managed.
- **Seleção/disabled gate:** ferramentas desabilitadas não disparam áudio; voz não é "tool", mas a mesma disciplina de opt-out se aplica via `voice.enabled` (config do produto).
- **Falhas tipadas de engine:** `LiaVoiceEngineError(kind)` com `input-invalid`, `engine-unavailable`, `timeout`, `provider-error`… — UI deve degradar para texto (nunca crash), com diagnóstico.

### 1.3 Limites e constantes (verificáveis no código)

| Item | Valor | Arquivo |
|---|---|---|
| Tamanho máximo do áudio (STT) | 24 MB | `transcription-service.ts` (`MAX_AUDIO_BYTES`) |
| Timeout STT | 30 s | `TIMEOUT_MS` |
| Resposta máxima | 8 MB JSON | `MAX_JSON_BYTES` |
| Modelo STT | `whisper-large-v3-turbo` | `hearing.ts` (`LIA_GROQ_TRANSCRIPTION_MODEL_ID`) |
| Base URL STT | `https://api.groq.com/openai/v1/` | idem (`..._BASE_URL`) |
| Escopo da credencial STT | `groq` | idem (`TRANSCRIPTION_SCOPE`) |
| Modelo Kokoro | `model_quantized.onnx` 92.361.116 B | `manifest.ts` |
| Amostra/canais | 24 kHz / mono | `manifest.ts` |
| Python (venv) | 3.10–3.13 | `manifest.ts` (`KOKORO_PYTHON_MIN/MAX`) |

---

## 2. Inventário de cobertura automatizada existente (evidência @ `407300b`)

Executado e commitado em `docs/reports/evidence/LIA-QA-VALIDATION-407300b-2026-11-14/` (subconjunto vinculado ao SHA); complemento integral em `LIA-VALIDATION-MATRIX-407300B-2026-11-14.md`.

| Suíte | Arquivo(s) | O que prova | O que NÃO prova |
|---|---|---|---|
| lia-core voz 74/74 | `voice-service.test.ts`, `config.test.ts`, `registry.test.ts`, kokoro `install/layout/smoke/engine` (via suite) | fila serializada; seleção autoritativa; rota vazia se seleção não resolvida; `ToolDisabledError`-análogo; métricas; hash/layout do Kokoro; smoke com doubles | Síntese real; áudio; mic; playback; rede |
| Stage áudio/voz/hearing 1.592 | `lia-voice-service.{enabled,kokoro}.test.ts`, `main-window-voice-runtime.test.ts`, `transcription-service.test.ts`, `transcription-adapters.test.ts`, `voice-prewarm.test.ts`, `voice-config-service.test.ts`, `voice-profiles*.test.ts`, `voice-profile-picker.test.ts`, `renderer/stores/lia/{hearing,voice,voice-*,chat-voice-pipeline,transcription-bridge,main-transcription}.test.ts`, `composables/use-hearing-input-channel.test.ts`, `utils/voice-input-*.test.ts`, `components/lia-config/sections/{VoiceSection,VoiceUxInvariants,CustomVoicePanel}.test.ts`, `shared/lia-voice.test.ts`, `pages/index.voice-authority.test.ts` | contratos IPC; seleção/hidratação de voz; pipeline chat→speech com provider stubbed; gates do mic; cancelamento; estados de erro tipados; playback manager stubado | Microfone real; permissões reais; reprodução real; Kokoro real; Groq real |
| stage-ui áudio 242/242 | `composables/audio/*.test.ts` (VAD, sessão, cadeia de transcrição, segmentos), `use-streaming-transcription-input.test.ts`, `stores/modules/hearing*.test.ts`, `streaming-transcription-*.test.ts`, `use-hearing-playground-segments.test.ts` | state machine do mic; VAD; append/commit de transcrição; reattach detach | Dispositivos reais; WER real |
| A-1 gate 31+1 | `tools/tool-resolver/tool-call-rerun/built-in` | habilitação real de ferramentas (não áudio, mas gate de segurança) | — |

**Nenhuma das linhas acima é prova de voz/STT para o beta.** Elas são pré-condições de código, não de experiência.

---

## 3. Classificação de ambiente (como ler AU-*)

| Tag | Significado | Exemplo |
|---|---|---|
| `[L-AUTO]` | Automatizável hoje em Linux (mocks/harness) | pipelines com provider stubbed |
| `[L-NET]` | Automatizável em Linux **com rede** (Kokoro real roda em CPU; STT precisa de `api.groq.com`) | síntese Kokoro real no sandbox |
| `[W]` | Exige Windows (runtime do produto, IPC real, instalação) | boot, `Lia.bat`, NSIS |
| `[W+NET]` | Exige Windows **e** rede externa | Groq STT real |
| `[W+HW]` | Exige Windows **e** hardware (mic e/ou alto-falante) | gravação real, playback audível |
| `[HW]` | Hardware independente de SO | GPU RX 580 (monitoramento), hotplug |

Cada AU-* indica tags nas colunas **Ambiente**. "NOT RUN" continua sendo o estado padrão — nenhuma execução real de áudio ocorreu ainda em nenhuma rodada.

---

## 4. Matriz de testes — TTS (Kokoro e seleção de engine)

| ID | Teste | Ambiente | Pré-condições | Procedimento | Resultado esperado | Observado | Estado | Evidência mínima |
|---|---|---|---|---|---|---|---|---|
| AU-TTS-01 | Instalação Kokoro (`ensureKokoroInstalled`) idempotente; modelo e vozes com sha256 verificado | `[L-NET]` `[W+NET]` | Python 3.10–3.13; rede HF/jsDelivr (ou mirror D8) | `node tools\kokoro-smoke.mjs` (Windows: `DevKit.bat kokoro-smoke`); observar árvore `%LOCALAPPDATA%\Lia\runtimes`; rodar 2× | 1ª: baixa e valida (bytes/sha256); 2ª: reutiliza (idempotente); falha deixa árvore recuperável | — | NOT RUN | log completo do smoke + `lia.voice.engine.install` + listagem do diretório |
| AU-TTS-02 | Smoke dev-only: síntese de 3 frases (curto/médio/longo) + RTF medido | `[L-NET]` `[W+NET]` | AU-TTS-01 PASS | executar smoke; ler `kokoroSmokeSummaryLine`; checar WAV 24 kHz mono | WAV válidos; **RTF reportado por frase**; sem erro de engine | — | NOT RUN | saída do smoke + `.wav` gerados + RTF anotado + SHA |
| AU-TTS-03 | Seleção de engine de voz na UI/AI Settings (Kokoro como default do build) | `[W]` | W-01; app em execução | AI Settings → seção de voz; observar engine selecionada e estado (`ready`/`unavailable`) | Kokoro aparece selecionada; estado verdadeiro (não "pronta" se não instalada) | — | NOT RUN | screenshot sanitizado + trecho de log |
| AU-TTS-04 | Troca de engine em runtime (selecionar → salvar → nova síntese usa a nova) | `[W]` | ≥2 engines ou STUB de 2ª engine; AU-TTS-03 | trocar seleção; salvar; disparar 1 síntese; verificar log `lia.voice.synthesize engine=…` | log mostra o engine recém-selecionado; sem restart necessário (ou com aviso de restart, conforme design) | — | NOT RUN | log das 2 sínteses (engines diferentes) |
| AU-TTS-05 | Health/prewarm no boot managed: `voice.available` vira true após prewarm; boot não atrasa | `[W]` | launch managed completo | abrir pelo `Lia.bat`; medir `renderer-ready`; observar log de prewarm; consultar `electronLiaVoiceStatus` | boot sem stall; capability `voice.available=true` após settle; greeting sintetizado | — | NOT RUN | log com timestamps (boot × prewarm × greeting) |
| AU-TTS-06 | Síntese básica in-app de uma resposta curta | `[W+HW]` | AU-TTS-01/03; alto-falante | enviar 1 mensagem na conversa; aguardar resposta; escutar | **Áudio audível correto**; log `lia.voice.synthesize` com RTF e duração; sem exceção | — | NOT RUN | log + anotação do observador + screenshot |
| AU-TTS-07 | Interrupção: nova mensagem durante a fala interrompe reprodução (stopByIntent) | `[W+HW]` | AU-TTS-06 | disparar resposta longa; enviar 2ª mensagem durante a fala | playback para no novo intent; sem sobreposição de áudios; log de `stopByIntent(session-cancelled)` | — | NOT RUN | log + marcação temporal + anotação |
| AU-TTS-08 | Fila/serialização: 3 respostas rápidas seguidas | `[W+HW]` | AU-TTS-06 | enviar 3 mensagens seguidas | sintetizadas em ordem FIFO; nenhuma síntese paralela (ou conforme capacidade declarada); sem clipping de áudio | — | NOT RUN | logs `lia.voice.synthesize` ordenados por `queuedAt` |
| AU-TTS-09 | Provedor de voz indisponível: seleção configurada ausente → unavailable honesto | `[L-AUTO]`+`[W]` | config apontando engine não registrado | setar preferência para id inexistente; consultar estado + tentar síntese | `voice.available=false`; síntese rejeita com `engine-unavailable`; **nenhuma** tentativa de outro TTS | — | PARCIAL (unit PASS) → executar E2E | log + comportamento de UI (degrada para texto com aviso) |
| AU-TTS-10 | Kokoro não instalado → estado unavailable; UI orienta instalação; nada quebra | `[W]` | runtime sem engine | apagar/renomear marker apenas em perfil sintético; abrir app | status unavailable; tela mostra caminho de instalação; chat funciona em texto | — | NOT RUN | screenshot + log |
| AU-TTS-11 | Falha de rede/download durante instalação (corte no meio) | `[W+NET]` | rede instável (throttle ou cabo) | interromper download a ~50%; reexecutar | erro tipado; árvore retryable; 2ª execução completa com sha256 ok | — | NOT RUN | logs das 2 tentativas + exit codes |
| AU-TTS-12 | Timeout/crash do worker durante síntese | `[L-AUTO]`+`[W]` | perfil com worker que falha | matar processo `python` do Kokoro sob demanda; ou `synthesizeTimeoutMs` baixo em perfil sintético | erro `engine-unavailable`/`timeout` tipado; chat degrada p/ texto; app segue | — | PARCIAL (unit PASS) → E2E pendente | log + UI observada + `Get-Process` antes/depois |
| AU-TTS-13 | Troca de voz pt-BR: `pf_dora` → `pm_alex` → `pm_santa` (e volta) | `[W+HW]` | AU-TTS-01 | trocar voz no perfil; sintetizar a mesma frase nos 3 | 3 vozes **audivelmente distintas**; logs com voice id; sem vazamento entre trocas | — | NOT RUN | log por voz + anotação auditiva |
| AU-TTS-14 | Ausência de dispositivo de saída (fone desconectado/sem device) | `[W+HW]` | máquina sem alto-falante ou device removido | desconectar fone durante/antes da fala | erro/aviso tipado; nada trava; replug → playback volta | — | NOT RUN | log + estado do device + anotação |
| AU-TTS-15 | Recuperação após falha: síntese falha 1× → próxima funciona | `[W+HW]` | falha injetada (rede/CPU) + perfil sintético | provocar 1 falha; enviar nova mensagem | 2ª síntese completa; fila drena; RTF normal; app estável | — | NOT RUN | logs das 2 tentativas |
| AU-TTS-16 | Persistência de configuração de voz após reabrir o app | `[W]` | AU-TTS-03/13 | selecionar voz X; fechar Lia; reabrir; abrir AI Settings/voz | voz X restaurada; `lia-product.json` íntegro (sem segredos) | — | NOT RUN | `lia-product.json` sanitizado + screenshot |

## 5. Matriz de testes — STT (mic → texto → conversa)

| ID | Teste | Ambiente | Pré-condições | Procedimento | Resultado esperado | Observado | Estado | Evidência mínima |
|---|---|---|---|---|---|---|---|---|
| AU-STT-01 | Permissão de microfone — conceder | `[W+HW]` | Windows com mic; build de beta | 1ª gravação; conceder permissão no diálogo | permissão registrada; gravação inicia; estado `listening` no composer | — | NOT RUN | screenshot do diálogo + log de estado |
| AU-STT-02 | Permissão de microfone — negar | `[W+HW]` | idem | negar no diálogo; tentar gravar | mensagem tipada (sem stack); botão volta a idle; app segue em texto | — | NOT RUN | screenshot + log |
| AU-STT-03 | Listagem e seleção de dispositivo de entrada; hotplug | `[W+HW]` | ≥2 devices de entrada (mic interno + USB) | listar devices; selecionar B; hotplug de B durante uso | lista correta; seleção aplicada; device some → fallback tipado/aviso; replug re-listado | — | NOT RUN | log de devices + screenshot |
| AU-STT-04 | Iniciar gravação (botão mic / push-to-talk) | `[W+HW]` | AU-STT-01 | pressionar iniciar; observar nível/estado | estado `recording`; indicador visível; stream aberta (log `getUserMedia` ok) | — | NOT RUN | log + screenshot |
| AU-STT-05 | Interromper gravação (release/segunda pressão) | `[W+HW]` | AU-STT-04 | interromper; observar flush do segmento | estado volta a idle; segmento commitado; `use-streaming-transcription-input.clear/commit` aplicado | — | NOT RUN | log de commit do segmento |
| AU-STT-06 | Encerrar corretamente (fim da fala / timeout VAD) | `[W+HW]` | AU-STT-04 | parar de falar; aguardar VAD encerrar | tracks finalizadas (`track.stop()`); sem `NotReadableError` posterior; estado idle | — | NOT RUN | log + DevTools: `navigator.mediaDevices.getUserMedia` handles count = 0 |
| AU-STT-07 | **Transcrição correta pt-BR** — frase fixa: “A Lia é minha assistente pessoal.” | `[W+NET]` | chave Groq no vault; mic | gravar a frase 3×; conferir texto retornado | ≥1 das 3 com as 5 palavras-chave corretas; WER observado anotado; em falha total: FAIL com causa | — | NOT RUN | transcrições exatas + áudio (se retido) + comparação |
| AU-STT-08 | Confidence/verbose_json ativo (quando configurado) | `[W+NET]` | env com threshold de confiança | ativar threshold; transcrever; observar campo de confiança | `verbose_json` parseado; segmentos com confidence; sem crash em ausência do campo | — | NOT RUN | log do adapter (`parseTranscriptionResponse`) sanitizado |
| AU-STT-09 | Cancelamento durante gravação/transcrição | `[W+HW]` | AU-STT-04 | cancelar no meio (Esc/botão/IPC `electronLiaTranscriptionCancel`) | requisição abortada; sem texto parcial commitado; estado idle; sem erros soltos | — | NOT RUN | log de `abort` + estado da UI |
| AU-STT-10 | **Transcrição → conversa**: envio pelo caminho de voz | `[W+HW]` | AU-STT-07 | falar uma pergunta curta; observar composer e envio; resposta chega | texto da transcrição entra no fluxo D2B12 e dispara a mensagem (conforme política configurada); resposta da Brain chega | — | NOT RUN | transcrição + mensagem na thread + resposta |
| AU-STT-11 | Política de envio por voz (auto-send × confirmação) — comportamento real | `[W]` | config de voz | alterar setting; repetir AU-STT-10 nos 2 modos | comportamento corresponde à configuração exibida; sem envio surpresa | — | NOT RUN | 2 logs (um por modo) + screenshots das settings |
| AU-STT-12 | Troca de provider/modelo STT na UI (Groq ↔ playground ↔ Apple no macOS) | `[W]` | Launcher + config | AI Settings → STT; trocar provider; salvar; status refletido | lista e estados verdadeiros; modelo efetivo registrado (`whisper-large-v3-turbo` no Groq) | — | NOT RUN | screenshots + logs de resolução de transporte |
| AU-STT-13 | Provider indisponível: 401 (chave inválida) / 429 (quota) / 5xx | `[W+NET]` | perfil com chave inválida (sintético) ou throttle | 401: chave sintética inválida; 429/5xx: apontar transporte para mock de rede local? — **proibido mock em prova de beta**: usar throttle real ou chave inválida real | erro **tipado** exibido ("credencial inválida"/"quota excedida"); sem upload; app segue; nenhum segredo em log | — | NOT RUN | screenshot da mensagem + log sanitizado |
| AU-STT-14 | Timeout de rede (>30 s) durante STT | `[W+NET]` | rede com latência alta (throttled) | transcrever com link lento forçado | abort em ~30 s (`TIMEOUT_MS`); mensagem tipada; sem hang; retry possível | — | NOT RUN | log c/ timestamp (início/abort) + UI |
| AU-STT-15 | Offline durante STT | `[W+NET]` | NIC desabilitada ou radio off | gravar e transcrever | falha tipada de rede (não exceção crua); estado recuperável; sem fila presa | — | NOT RUN | log + screenshot |
| AU-STT-16 | Ausência de dispositivo de entrada (mic removido antes da gravação) | `[W+HW]` | hotplug | remover mic antes de clicar; clicar | mensagem tipada; botão não trava; lista de devices atualiza | — | NOT RUN | screenshot + log |
| AU-STT-17 | Dispositivo em uso exclusivo por outro app (NotReadableError) | `[W+HW]` | app externo segurando o mic | tentar gravar | `NotReadableError` tipado; mensagem orientando fechar o outro app; sem crash | — | NOT RUN | log + screenshot |
| AU-STT-18 | Recuperação após falha transitória (5xx único → sucesso no retry) | `[W+NET]` | perfil real; falha transitória (ou throttle de 429×1) | provocar 1 falha; repetir fala | retry manual/automático conforme design **funciona**; texto transcrito | — | NOT RUN | 2 logs consecutivos + transcrição final |
| AU-STT-19 | Limite de 24 MB / gravação longa (>10 min contínuos) | `[W+HW]` | — | gravar até estourar limite (ou simular bytes) | recusa tipada ANTES do upload; sem envio parcial; sem áudio corrompido no provider | — | NOT RUN | log de recusa `configuration`/`input-invalid` |
| AU-STT-20 | Funcionamento após pausar/retomar a Lia (minimize→tray→restore) | `[W+HW]` | sessão com conversa por voz | pausar/minimizar; restaurar; gravar de novo | gravação pós-restore funciona; estado não corrompido; histórico intacto | — | NOT RUN | logs + anotação |

## 6. Matriz de testes — transversais (vazamento, ciclo de vida, ponta a ponta)

| ID | Teste | Ambiente | Pré-condições | Procedimento | Resultado esperado | Observado | Estado | Evidência mínima |
|---|---|---|---|---|---|---|---|---|
| AU-X-01 | Streams/tracks de mic são encerrados após cada gravação | `[W+HW]` | AU-STT-06 | 10 ciclos gravar→parar; checar handles em DevTools/`Get-Process` | handles/streams não crescem; `getUserMedia` count volta a 0 | — | NOT RUN | tabela antes/depois de handles por ciclo |
| AU-X-02 | Workers do Kokoro não viram órfãos (boot, sínteses, fechamento) | `[W+HW]` | AU-TTS-06; launcher | contar processos `python*`/`kokoro*` em: antes do boot, pós-greeting, pós-10 sínteses, pós-fechar | zero workers órfãos após fechamento; durante uso, ≤1 worker ativo (FIFO) | — | NOT RUN | `Get-Process` snapshots ×4 pontos |
| AU-X-03 | Arquivos temporários de áudio (WAV/tmp) são limpos | `[W]` | AU-TTS-06 | sintetizar 5×; listar diretórios temp do runtime | sem acúmulo de WAVs transcritos/falhos; tmp vazio ou rotativo | — | NOT RUN | listagem diretório antes/depois |
| AU-X-04 | Matar worker do Kokoro durante síntese → app segue em texto | `[W+HW]` | AU-TTS-06 | `Stop-Process` no worker; continuar conversando | erro tipado na fala corrente; texto continua; próxima síntese recria worker | — | NOT RUN | log + `Get-Process` + UI |
| AU-X-05 | Pausar → retomar → falar: pipeline íntegro | `[W+HW]` | sessão ativa; Fase 1 de UI | minimizar/tray ≥2 min; restaurar; gravar e ouvir resposta | STT e TTS imediatos pós-restore; sem estado `listening` zumbi | — | NOT RUN | logs + anotação |
| AU-X-06 | Janela oculta/minimizada (C4) — política de áudio respeitada | `[W+HW]` | C4 protocol (tray/oculto) | ocultar durante resposta longa | comportamento conforme política C4 (pausa/rate/continue) sem vazamento de CPU/áudio | — | NOT RUN | métricas C4 + logs |
| AU-X-07 | **Fechar Lia: zero processos de áudio e Electron órfãos** | `[W+HW]` | sessão com conversa por voz | fechar pela UI (X); aguardar; `Get-Process \| ? { $_.ProcessName -match 'Lia\|electron\|python\|kokoro' }` | **vazio**; `%APPDATA%\Lia` íntegro; histórico reabre | — | NOT RUN | saída do comando + listagem `%APPDATA%\Lia` |
| AU-X-08 | Reabrir Lia: `voice.available` restaurado; saudação não duplica; histórico íntegro | `[W+HW]` | AU-X-07 | reabrir; observar boot; abrir conversa anterior | greeting exatamente 1×; histórico com as falas anteriores; voz disponível sem reconfigurar | — | NOT RUN | logs de greeting + screenshot do histórico |
| AU-X-09 | **Ponta a ponta: falar → Lia Brain → resposta falada** | `[W+NET]` | voz + chat + Groq configurados; AU-* base verdes | falar “Lia, diga apenas: estou funcionando”; aguardar resposta falada completa | STT correta; Brain responde; TTS fala a resposta; RTF total aceitável (proposto ≤ meta D4); sem erro em qualquer etapa | — | NOT RUN | **log completo do turno** (transcrição, rota, `lia.voice.synthesize`, timings) + anotação auditiva |
| AU-X-10 | Soak 60 min com atividade de voz (Fase 1: não bloqueante; beta interno: recomendado) | `[W+HW]` | máquina dev livre | sessão 1h com 1 fala/5 min + monitoração | sem crescimento de memória/workers; sem erro sonoro; RTF estável | — | NOT RUN | CSV/JSON de amostragem + relatório curto |

---

## 7. Automatizável hoje × exige microfone/auto-falantes/Windows

| Classe | IDs | Situação |
|---|---|---|
| Automatizável em Linux (mocks) — já executado no SHA | AU-TTS-09 (unit), AU-TTS-12 (unit); todo o §2 (1.940 PASS) | PASS offline — **não promove beta** (ver §8–§9) |
| Automatizável em Linux **com rede** (bloqueada aqui) | AU-TTS-01, AU-TTS-02, AU-TTS-11, AU-STT-13/14/15/18/19 (parcialmente) | BLOCKED (rede) |
| Só Windows (runtime do produto) | AU-TTS-03/04/05/10/14/15/16; AU-STT-11/12; AU-X-03 | NOT RUN |
| Windows + rede externa | AU-STT-07/08/13/14/15/18; AU-X-09 | NOT RUN |
| Windows + mic/alto-falante | AU-STT-01…06, 10, 16, 17, 20; AU-TTS-06/07/08/13; AU-X-01/02/04/05/06/07/08/10 | NOT RUN |
| Hardware dedicado | RX 580 p/ render (fora do áudio, H-03); hotplug (AU-STT-03) | NOT RUN |

**Nada nesta tabela pode ser executado em CI atual sem (a) rede, (b) chave Groq válida no vault e (c) dispositivos — logo, todo o gate de voz do beta interno é manual/assistido, como o AI Settings.**

---

## 8. Evidências mínimas por teste (obrigatórias)

Para CADA AU-* declarado PASS/FAIL/BLOCKED, o registro deve conter:

1. **ID** e **SHA** (`407300b8…` ou tag de beta).
2. **Ambiente:** Windows/Linux, máquina, GPU, devices (mic/speaker), versões (Node, Python, app), rede.
3. **Pré-condições** efetivamente atendidas (ex.: “Kokoro instalado, `pf_dora` presente”).
4. **Comando/procedimento** executado (verbatim) ou roteiro de UI numerado.
5. **Resultado esperado** (da coluna “Esperado”) e **resultado observado** (com valores: RTF, ms, bytes, contagem de processos).
6. **Artefato:** log sanitizado (sem chave/token/PII de áudio bruto salvo indevidamente), screenshots quando houver UI, WAVs grandes fora do commit (referenciar path/hash no log).
7. **Timestamp** (UTC) e **responsável**.
8. **Varredura anti-segredo** do artefato antes de commitar.

Sem os 8 itens, o teste permanece NOT RUN no registro oficial. Skip ≠ PASS. Mock ≠ integração real. Linux ≠ Windows.

---

## 9. Matriz de aprovação — TTS/STT NÃO podem passar por existência de componentes

**Definição de PASS por afirmação:**

| Afirmação | Prova mínima exigida | Não basta |
|---|---|---|
| “Kokoro instalado e operacional” | AU-TTS-01+02 executados no ambiente de coleta: log de instalação + síntese real + RTF + sha256 verificado | `engine.test.ts`; existência de `manifest.ts`; health mockado |
| “A Lia fala” (TTS PASS) | AU-TTS-06 **e** AU-TTS-07 executados com áudio audível confirmado + `lia.voice.synthesize` com `rtf` e `totalMs` + sem worker órfão (AU-X-02) | `speechStore` verde; `chat-voice-pipeline` stubbed |
| “STT funciona” (STT PASS) | AU-STT-01/04/06/07 executados: permissão concedida, gravação real, transcrição com as palavras-chave corretas (3 tentativas), cancelamento sem vazamento | testes de adapter com bytes sintéticos; `transcription-service.test.ts` |
| “Transcrição chega à conversa” | AU-STT-10: transcrição visível na mensagem enviada **e** resposta do Brain observada | joinInputAndTranscription coberto por unit |
| “Provider unavailable é honesto” | AU-TTS-09 **ou** AU-TTS-10: estado `unavailable`/`voice-unavailable` e zero switch silencioso, observado em UI real | unit de `route()` |
| “Sem vazamento de áudio” | AU-X-01+02+03 com contagens antes/depois | ausência de erro no console |
| “Fecha sem órfãos” | AU-X-07 com saída de comando anexada + reabertura íntegra (AU-X-08) | `shutdown-coordinator` unit |
| “Ponta a ponta de voz” | AU-X-09: turno completo em log único, com timings e resposta falada | qualquer conjunto de units isolados |

**Regra de bloqueio:** se qualquer AU-* mandatório para D2=sim for BLOCKED (sem rede/chave/mic/speaker), o gate de voz do beta interno **não abre** — documentar no `CURRENT-STATE.md` e no relatório de beta. Aceite de risco residual para voz **não é permitido** pelo produto (voz é obrigatória); o waiver exigiria nova decisão de produto (D2 revertido), registrada por escrito.

**Checklist de aprovação do beta interno (voz):** AU-TTS-01, 02, 03, 05, 06, 07, 09, 10, 12, 13, 16 · AU-STT-01, 02, 04, 05, 06, 07, 09, 10, 12, 13, 15, 17 · AU-X-01, 02, 04, 05, 07, 08, 09 → todos PASS no mesmo SHA. Desejáveis: AU-TTS-11, 14, 15; AU-STT-03, 08, 11, 14, 18, 19, 20; AU-X-03, 06, 10; AU-TTS-04, 08 (fila) → PASS ou risco aceito por escrito com prazo.

---

## 10. Dependências de hardware, rede e ambiente

| Dependência | Para quê | Onde | Bloqueio atual |
|---|---|---|---|
| Rede: `huggingface.co` / `cdn.jsdelivr.net` / `raw.githubusercontent.com` | download Kokoro (modelo+vozes) | AU-TTS-01/02/11 | sandbox sem acesso → BLOCKED |
| Rede: `api.groq.com` | STT real (`whisper-large-v3-turbo`) | AU-STT-07…19, AU-X-09 | sem chave/rede aqui |
| Chave Groq válida no vault (escopo `groq`) | STT (e Brain do chat) | Launcher/Windows | interação + UI obrigatória |
| Python 3.10–3.13 + venv + `espeak-ng` + `onnxruntime` (CPU) | engine Kokoro | AU-TTS-01…15 | — (smoke resolve) |
| CPU com AVX | Kokoro RTF decente | AU-TTS-02/06 | RX 580 não é exigida p/ CPU |
| Microfone físico (+ driver) | STT | AU-STT-01…20 | — |
| Alto-falante/fone | AU-TTS-06…, AU-X-09 | AU-TTS | — |
| Windows 10/11 x64 + build do Stage | runtime do produto | todos os [W] | — |
| GPU RX 580 / 2 monitores | render do avatar (fora do áudio) | H-03/H-04 | não bloqueia voz |
| `%LOCALAPPDATA%\Lia\runtimes` (Win) / staging POSIX | árvore do engine | AU-TTS-01/15/16 | permissões de escrita |

---

## 11. Procedimento integrado no Windows (voz completa) — para o Codex

Pré-condição obrigatória: a máquina de coleta **não** pode estar em coleta de outro agente; `git status` limpo; SHA anunciado (`407300b8…` ou tag).

```powershell
# A. Pré-requisitos
git rev-parse HEAD                      # 407300b8... (ou tag congelada)
node tools\kokoro-smoke.mjs "$env:USERPROFILE\Desktop\kokoro-smoke-457"   # AU-TTS-01/02 — medições e WAVs
# B. Launcher limpo (perfil sintético): %APPDATA%\Lia backup antes!
.\Lia.bat
# C. AI Settings (Parte 4 do roteiro da matriz mestre):
#    abrir, confirmar Groq ready, chave no vault (se turno anterior já fez: pular 4-5),
#    descobrir modelos, selecionar openai/gpt-oss-120b, salvar, reabrir → seleção persistente
# D. Conversa de voz:
#    1. clicar "Conversar com Lia"; aguardar greeting FALADO (prova de TTS no boot managed)
#    2. clicar no mic; falar: "Lia, diga apenas: estou funcionando"
#    3. conferir transcrição no composer (AU-STT-07/10) e envio automático/confirmado (AU-STT-11)
#    4. aguardar resposta FALADA (AU-TTS-06/09); anotar RTF do log
#    5. durante a resposta, enviar outra mensagem → verificar interrupção (AU-TTS-07)
#    6. repetir 2–4 com voz trocada pm_alex (AU-TTS-13)
# E. Vazamentos e fechamento (AU-X-01…08):
Get-Process | ? { $_.ProcessName -match 'Lia|electron|python|kokoro' } | Format-Table Id, ProcessName
#    fechar pela UI; aguardar 10 s; repetir o comando → vazio; reabrir; conferir greeting 1× e histórico (AU-X-08)
```

O Codex **não** deve improvisar atalhos da UI; qualquer falha → registrar verbatim (mensagem, log, exit code), não contornar. Se a rede para HF/jsDelivr/Groq estiver indisponível → AU-TTS-01/02 e AU-STT-07+ = **BLOCKED** (não FAIL), com o comando exato e o erro.

---

## 12. Bloqueadores, lacunas e riscos específicos de áudio

**Bloqueadores do beta interno (voz):**
1. **BL-A1** — Kokoro nunca instalado/sintetizado nesta base (evidência: ausência de qualquer log `lia.voice.synthesize` no histórico do repo). Destranca com AU-TTS-01/02 no Windows (ou Linux com rede).
2. **BL-A2** — STT real nunca executado (Groq). Destranca com AU-STT-07 no Windows.
3. **BL-A3** — Playback nunca verificado (Web Audio/alto-falante). AU-TTS-06.
4. **BL-A4** — Vazamento de áudio nunca medido (tracks/workers). AU-X-01/02/03/07.
5. **BL-A5** — Gate de voz exige SHA congelado; re-coleta obrigatória (C-19).

**Lacunas técnicas a observar:**
- `hearing.ts` exige modelo fixo (`whisper-large-v3-turbo`) porque `listModels()` retorna vazio — qualquer mudança de modelo é manual; documentar.
- Seleção autoritativa: seleção configurada mas não buildável = rota vazia (`voice-unavailable`) — **esperado**; testar explicitamente (AU-TTS-09/10) para não "corrigir" o comportamento errado por engano.
- `chat-voice-pipeline` prova segmentação/target resolution com provider **stubbed** — não infere latência real.
- `VoiceSection.browser.test.ts` existe mas o projeto browser está BLOCKED (BL-3) — a UI de voz não tem prova em navegador real.
- Voz de clonagem (custom local voice) existe no código — **fora do escopo do beta interno**; não testar como gate.
- O worker Kokoro é processo Python separado: antivírus/SmartScreen no Windows pode bloquear a 1ª execução — documentar no roteiro; não é falha de produto se observada com mensagem do AV.

**Riscos de dados/privacidade:** áudio bruto não deve ser commitado; transcrições em logs devem ser sanitizadas (o logger atual é metadata-only — manter!); WAVs de smoke ficam fora de commits (`Tests/artifacts` é gitignored — verificar antes de `git add`).

---

## 13. Critérios de aceite de voz/STT para o beta **interno** (mensuráveis)

| # | Critério | Alvo |
|---|---|---|
| V-1 | Kokoro instalado e smoke OK com RTF medido e registrado (por frase) | execução real, SHA de coleta; RTF anotado (meta proposta ≤ 1,0 em CPU AVX — aprovar em D2/D4 ou remover a meta por escrito) |
| V-2 | Greeting do boot managed é falado (TTS no first run) | 100% das coletas |
| V-3 | STT pt-BR: frase fixa reconhecida corretamente em ≥2 de 3 tentativas | palavras-chave exatas; falha total = FAIL com causa |
| V-4 | Transcrição entra no fluxo da conversa e dispara/confirma o envio conforme configuração | observação direta |
| V-5 | Interrupção de fala por novo intent sem sobreposição | AU-TTS-07 |
| V-6 | Erros tipados (401/429/5xx/offline/timeout/ausência de dispositivo) exibidos sem crash e sem segredos em log | AU-STT-13/14/15/16/17; AU-TTS-09/10/12 |
| V-7 | Fecho do app com zero processos de áudio/Electron órfãos; reabertura íntegra (greeting 1×, histórico) | AU-X-07/08 |
| V-8 | 10 ciclos gravar→encerrar sem crescimento de handles/memória; 60 min soak sem degradação (recomendado) | AU-X-01/10 |
| V-9 | Evidências versionadas e anti-segredo limpo | §8 (8 itens) |
| V-10 | `CURRENT-STATE.md` atualizado no commit que fecha o gate de voz | processo (C-18) |

**G-11 (voz, obrigatória no beta interno) só abre com AU-* do checklist §9 todos PASS no SHA taggeado e V-1…V-10 registrados.**

---

## 14. Registro e prevenção de falsos positivos

Proibido marcar PASS quando: o teste rodou mockado mas o relatório não diz; o log não cita SHA/ambiente/device; a evidência é screenshot sem log; "funcionou na máquina do dev" sem registro; o comportamento foi "ajustado" durante a coleta; o erro foi contornado (barreira de rede burlada, chave em env var usada como atalho, AV desativado sem registro). Qualquer um desses → o teste permanece NOT RUN e o desvio vai para o log de incidentes do relatório de beta.

---

## Histórico

- 2026-11-14 — criação desta matriz no SHA `407300b` (docs-only sobre `ae46c49`; código idêntico, resultados de código carregados com rótulo). Delta da rodada: re-verificação áudio/A-1 (1.940 PASS) + inventário de lacunas AU-*. Evidência: `docs/reports/evidence/LIA-QA-VALIDATION-407300b-2026-11-14/`.
- Rodadas anteriores: `LIA-VALIDATION-MATRIX-AE46C49-2026-11-14.md` (evidência ae46c49), `LIA-VALIDATION-MATRIX-5EC464E-2026-11-14.md` (5ec464e), `LIA-QA-VALIDATION-2026-11-14.md` (7cb8172). Áudio nunca foi executado em nenhuma delas — esta matriz existe para mudar isso no beta interno.
