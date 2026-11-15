# Recomendações priorizadas: modelos, providers e capacidades Lia

**Data da pesquisa:** 14/11/2026 (UTC). **Desenvolvimento consultado somente leitura:** `arena/01a10290-lia-project` tip `0bf0629263ba2c030efe07fc070283a4e025467a`; CURRENT-STATE informa SHA de código auditado `ae46c495d7da7cd33f4b4da8f4e8cc95b0a867b6`. **Entrega estática:** sem integração, modelo baixado, benchmark ou alteração Windows.

## Resumo executivo

A Lia tem base arquitetural para escolha por provider/capability e alguns recursos já existentes (gestão de provider, runtime de voz supervisionado, memória local, autorização de tools), mas o estado operacional de 14/11 ainda descreve voz/STT e runtime final como gates não comprovados. A prioridade não é construir outro agente genérico nem comprar uma abstração única: é verificar os contratos já existentes no código, completar evidence de runtime, então adotar poucos adapters por capability com catálogo curado.

**Conclusões principais:**
- Para GPU AMD antiga RX580 em Windows, primeiro teste deve ser **llama.cpp GGUF Vulkan + CPU fallback**, não ROCm/CUDA. O backend Vulkan existe oficialmente, mas RX580-performance é ainda não testado aqui.
- **LFM3 é interessante, mas licença e modelo por modelo contam.** LFM3-1.7B é top text benchmark; LFM3-Audio pode ser pt-BR candidate, mas “voice chat”/LiveASR são inglês-only na ficha consultada e PT-BR locale não provado. Omni não substitui benchmark modular.
- Para fala PT-BR, **Kokoro** é candidato forte para TTS e **whisper.cpp vs sherpa-onnx** para STT; VAD separado Silero. O projeto já possui runtime Kokoro conforme arquitetura existente; compare antes de adicionar duplicata.
- Licenças não triviais: LFM Open License revenue threshold, Piper GPL + voz individual, XTTS CPML non-commercial, VoiceStudio AGPL, model weights e assets com licenças independentes.
- Não fazer catálogo indiscriminado. Oferecer poucos modelos testados, opções simples local/free/paid e uma tela avançada com critérios/termos. No free remote tier, revisar uso de dados do fornecedor.
- Current branch note nomeia `arena/826a33f1-lia-project` como fixa. A solicitação pede `arena/model-provider-research`, mas agentes Arena têm branch isolada fixa; não é seguro/permitido criar ou mudar de branch. Relatórios são entregues na branch vinculada desta sessão, sem tocar no desenvolvimento.

## Melhores candidatos por capacidade

| Capability | Primeiros candidatos para avaliação | Classe | Por que / limitações |
|---|---|---|---|
| Conversa local/tool-use | llama.cpp + LFM3-1.7B GGUF Q4; Qwen small comparator | **A** | Vulkan/CPU, local API. LFM License threshold, accuracy/tool use pt-BR e performance RX580 precisam teste. |
| Conversa remota | provider neutral: Google Gemini/OpenAI/Anthropic/Groq as optional adapters | **A/B** | Usar pricing oficial; quotas, policies, models and rate limits mudam. Nenhum deve ser default forçado. |
| STT pt-BR local | whisper.cpp vs sherpa-onnx | **A** | Offline, alternatives CPU/ONNX/C++ but pt-BR quality and real-time support to benchmark. faster-whisper good CPU batch comparator; Python/CUDA assumptions are a poor first Windows AMD path. |
| VAD | Silero VAD | **A** | Small CPU model; low compute candidate; MIT; not wakeword or speech recognition. |
| TTS pt-BR | Existing Lia Kokoro runtime vs current Kokoro/ONNX artifact; optional Cartesia/ElevenLabs hosted | **A/B** | Do not add competitor until existing runtime measured. Model/voice/dependencies own licenses; remote options consent/cost. |
| One model audio+speech | LFM3-Audio-2B | **B** | Feature breadth, but English-only voice-chat/live ASR and no RX580 test; license custom. |
| Vision/screen | crop + OCR (PaddleOCR/Tesseract) then LFM3-VL or Qwen VLM | **B** | OCR lower-cost for crisp text; screen opt-in, small frames; multimodal weight/RX58 unsupported unknown. |
| Embeddings | Qwen3-Embedding-0.6B/BGE-M3 only after current memory tests | **B** | Apache/MIT card depends exact model, 100+ multilingual claims; not needed until lexical recall fails. |
| Reranking | BGE/Qwen reranker on top-k | **C** | New compute/disk and latency; requires measurable recall gain. |
| Full-duplex | modular VAD/STT/router/TTS plus remote OpenAI/Gemini realtime comparison; LiveKit as reference | **B/C** | Measure barge-in, echo, latency, consent, cloud cost. Shizuku Duplex is Japanese-specialized research/product, not PT-BR deployable target. |
| Image generation | stable-diffusion.cpp Vulkan/ComfyUI user-managed + optionally BFL/OpenAI image API | **C** | Large weights/time and artifact licenses; not core always-on service. |
| Video generation | Wan2.2 only on high-end optional; hosted API | **D for RX580 default**, **C optional** | Video compute/cost not companion real-time; no RX580 viability. |
| Agent orchestrator | existing Lia tool/permission architecture; LangGraph JS spike only if durable state needed | **A for existing**, **C for new framework** | First validate tool round-trip, permission, persistence; library cannot solve safety. |
| Plugin interop | MCP adapter behind own tool broker | **B** | MCP server permissions/license/security vary. Do not auto-install servers. |

## Prioridade

### P0 — validar as capacidades e contratos que já existem

1. Read current development code at `0bf0629` and compare with audited `ae46c49`; identify provider registry, chat adapter, Kokoro supervisor, memory service, tool permission and any missing fields.
2. Run authorized Windows `Lia.bat` release/QA gates; current state notes voice/STT required for beta but runtime not proved. No inference from docs as proof.
3. Write a capability/provider conformance test matrix for text, streaming/cancellation, tool call, error, redaction, stale selection, process health and lifecycle.
4. Verify provider credential trust boundary and any OIDC/renderer security items already in CURRENT-STATE before expanding hosted services.
5. Baseline reference PC CPU/RAM/VRAM and Stage idle/game impact before downloading multiple models.

### P1 — small, reversible model POCs

1. LFM3-1.7B Q4 GGUF through llama.cpp Vulkan and CPU baseline; also run one permissive-license comparator model to separate engine vs model effect.
2. Compare existing Kokoro local runtime to official/local Kokoro model version: startup/resident memory, RTF, quality in PT-BR and pronunciation. Confirm model file/license.
3. Compare whisper.cpp vs sherpa-onnx using same labeled PT-BR dataset and system audio capture; use Silero VAD versus basic push-to-talk as control.
4. No need to prototype direct LFM Audio/Omni unless above indicates actual value. If tested: treat English voice chat separately from multilingual ASR/TTS claims.

### P2 — capability expansion

1. Screen OCR on user-selected crop; OCR-first then VLM if question needs semantics. Explicit transient/local vs remote indication.
2. Memory evaluation from existing store: recall correctness, context tokens, provenance/deletion; embeddings only if FTS/lexical fails specific cases.
3. Realtime cloud test (OpenAI Realtime or Gemini Live) only with explicit choice; cost cap and redacted synthetic audio first. Compare against modular local pipeline.
4. MCP experimental adapter with audited test server, least privilege, visible consent, process isolation and no secrets; never arbitrary marketplace auto-install.

### P3 — creative workloads

Optional image generation with full model license audit and user-initiated downloads. Treat video generation as out-of-scope for everyday presence until clear user story. Neither should run at startup or share GPU unexpectedly with game/Stage.

## Candidate ranking A–D

**A — Recommended for practical research:**
- llama.cpp text GGUF using CPU/Vulkan (runtime, not all models).
- Kokoro and whisper.cpp/sherpa-onnx as pt-BR voice comparisons, with current Lia voice service as baseline.
- Silero VAD for CPU/wake gating experiment (not full speech system).
- Existing Lia capability/protection and memory design as baseline to test.
- OCR localized (PaddleOCR/Tesseract) for screen text spike.

**B — Promising / conditional:**
- LFM3-Audio/VL/Omni, Qwen/Gemma models; model-level test/terms first.
- Gemini/OpenAI/Anthropic/Groq/Cartesia/ElevenLabs provider options, selected per capability/terms/price.
- LiveKit Agents full-duplex architecture and Shizuku-Duplex turn-taking ideas.
- MCP, Qwen/BGE embedding models, Foundry Local/WinML.

**C — Experimental:**
- DirectML/WinML for a specific ONNX export on RX580; exact model graph test.
- LangGraph.js, sqlite-vec, custom multimodal universal model route.
- stable-diffusion.cpp Vulkan image generation, Wan2.2, full-duplex local model prototype.

**D — Not recommended in target context:**
- Rely on CUDA or ROCm for RX580; “gfx803 unofficial override” in user environment.
- XTTS-v2 for commercial product using CPML weights; Piper1-GPL bundled by assumption; any voice package without voice model license.
- Shipping VoiceStudio whole desktop suite (AGPL + large independent TTS workflow/dependencies) as part of Lia; its feature catalog is UX reference.
- Large vector DB service for current single-user local memory without evidence of dataset need.
- Always-on video generation or VLM screen stream without opt-in/resource/cost controls.

## Arquitetura e UX recomendadas

- Adopt the proposal in [architecture report](LIA-MODEL-PROVIDER-ARCHITECTURE.md): curated manifest per exact model and provider, capability adapters, host-owned credentials/process, user selection, measured compatibility and explicit state. Treat as research, compare with existing design first.
- Onboarding simple choices: local/private, free remote (with free-tier privacy/rate-limit info), paid (cost estimator and key flow), not now. Advanced panel lets user mix different LLM, STT, TTS, VAD, vision, embedding and generation.
- Never auto change a local selection to cloud, never assume that signup/API free tier includes commercial content rights, and never quietly enable microphone/screen/model downloads.
- Tags: `tested-on-this-device`, `upstream-says-compatible`, `license-review`, `experimental`, `requires-key`, `requires-download`, `may-send-data-off-device`. Display updated date.
- Catalog scope initial target: 2–4 alternatives per capability maximum, not 100s; add candidate when it has user story, owner, source/license, maintainer, hardware profile and pass criteria.

## Licenses, security and unresolved risks

- LFM3 LFM Open License v1.0 contains annual revenue threshold; review legal impact for product and distribution.
- Piper current GPL engine, voice per card; rhasspy MIT repo archived. XTTS model CPML non-commercial although TTS toolkit code has separate MPL license. VoiceStudio AGPL-3.0. Other model card weights, voice rights and assets need independent check.
- Download from official pinned repo; record SHA256, license text/commit, model card and all aux files; protect archive extraction. Reject unknown `pickle`/executable artifacts, no unreviewed HF `trust_remote_code`, signed manifest/verification, quarantined isolated runtime.
- Local provider server bind loopback only; authentication / anti-SSRF; process non-elevated; kill, timeout, memory guard; secrets never passed through renderer, prompts or logs.
- Remote endpoints: host stores key, HTTPS, allowlist; per-capability consent; show usage/cost and data use. User prompted before high-cost video/image.
- Model output only proposes tools; permissions in Lia execution broker are authoritative; adversarial screen/voice prompt treated as untrusted.
- Licenses, provider prices, APIs, model formats, deprecation and quotas change. Catalog needs expiration date and owner.

## Matriz de benchmark para hardware de referência (NOT RUN)

Hardware: Windows 11; Ryzen 5 5500; 16GB; RX580 8GB (Polaris/gfx803); confirm exact card/driver. Candidate backends: CPU first, Vulkan for ggml, DirectML/WinML only for exact ONNX model; exclude official-support claims for ROCm/CUDA. See [compatibility report](LIA-WINDOWS-AMD-MODEL-COMPATIBILITY.md).

| Capability | First benchmark | Measures |
|---|---|---|
| Text/chat | LFM3 1.7B Q4 Vulkan/CPU; comparator same engine | cold load, RSS/VRAM, TTFT, decode t/s, pt-BR dialog/tool correctness, context, unload |
| STT | whisper.cpp vs sherpa-onnx CPU/Vulkan where supported | WER/CER by PT-BR speaker/noise, real-time factor, peak RAM/CPU, partial transcript delay |
| TTS | current Kokoro vs candidate Kokoro build, local; hosted choice separate | RTF/chunk latency, intelligibility/prosody, pronunciation, peak memory, downloadable size, voice rights |
| VAD/realtime | Silero vs push-to-talk; then streaming stack | false trigger, speech endpointing, echo, barge-in stop p50/p95, CPU idle |
| Vision | OCR crop vs 1-frame VLM | OCR error, latency, memory, small text, data handled |
| Embeddings | current memory baseline then Qwen/BGE | retrieval precision/recall, tokens, latency, memory, delete behavior |
| Image/video | no install first; disk/resources documented; image generation lab opt-in | load/setup, VRAM, image latency, install footprint and game frame-time; likely defer |
| Long session | Stage idle/game + audio/LLM one at a time | RSS growth, GPU memory, temperature, hangs, sleep/wake/restart, game frame pacing |

**Compare measurements:** cold vs warm, same context/quant/prompt, 3–5 repetitions, report p50/p95/peak, processor & driver/backend version. Keep dataset licensed and de-identified. Never make hardware/driver changes for the POC without authorization. NO test results are claimed here.

## Decisões para o responsável de produto

1. Beta scope and whether voice is a mandatory feature given unverified runtime state.
2. Distribution scope and stance on revenue-threshold/custom license, GPL/Piper, VoiceStudio AGPL and model/voice redistribution.
3. Default privacy posture: local-only and explicit remote opt-in; definition of “free” including data terms.
4. Whether custom OpenAI-compatible local endpoints are supported or only Lia-managed runtimes.
5. User-facing resource budget: strict CPU/RAM/VRAM targets and policy during games.
6. Consent/retention requirements for screen images, audio, memory and remote APIs.
7. Initial supported model count and maintenance owner for revisions/license refresh.

## Sources and confidence

Primary product facts from current development SHA through GitHub read-only fetch; external sources listed in [catalog](LIA-MODEL-PROVIDER-CATALOG.md), [LFM3](LIA-LFM3-EVALUATION.md), and [AMD compatibility](LIA-WINDOWS-AMD-MODEL-COMPATIBILITY.md). Research executed 14/11/2026; vendor docs/price tables are dynamic, and official claims are not independent validations. Hardware POC and Windows runtime tests: **NOT RUN**.
