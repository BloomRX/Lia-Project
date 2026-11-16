# Catálogo de modelos, provedores e runtimes para Lia

**Consulta:** 14/11/2026 (UTC). **Referência documental de desenvolvimento consultada:** `arena/01a10290-lia-project` atualizado para `0bf0629263ba2c030efe07fc070283a4e025467a`; CURRENT-STATE registra código auditado em `ae46c495d7da7cd33f4b4da8f4e8cc95b0a867b6`. A branch tem decisões de providers/capabilities existentes, seleção canônica no Launcher e adapter provider neutro em projeto; verifique HEAD/código antes de qualquer adoção. Este é catálogo curado, não lista exaustiva nem avaliação prática.

## Como ler este catálogo

**Prioridade A/B/C/D** é prioridade de pesquisa e avaliação, não autorização de implementação nem julgamento global de qualidade:
- **A — avaliar na prática:** forte encaixe técnico; ainda não significa pronto para produção.
- **B — promissor:** vale spike focalizado se a capacidade for priorizada.
- **C — experimental:** pesquisa ou laboratório, superfície/licença/qualidade relevantes em aberto.
- **D — evitar no uso descrito:** licença, incompatibilidade, risco ou custo desproporcional.

**Proveniência:** “fato” se declarado por projeto/fornecedor oficial; benchmarks do fornecedor são rotulados como tal; sem hardware do alvo, desempenho da Lia não é comprovado. Código, modelo/pesos, voz, dataset, runtime, asset e API têm termos independentes. Quotas/preços mutáveis: nas telas de configuração sempre mostrar URL e data/atualização, e abrir o pricing oficial.

## Contexto da Lia — fatos estáticos relevantes

- O snapshot descreve arquitetura com seleção por capacidade/provedor, credenciais sob autoridade do host e preferência de provider; status corrente diz decisão de provedores/segredos e teste de runtime beta pendente.
- Core possui contratos de host em `lia/core`; não concluir que todo runtime/provider do AIRI é parte permanente da Lia.
- Serviço de memória local e runtime de voz supervisionado existem no SHA consultado; não se recomenda duplicá-los antes de comparar contrato/teste real.
- A-1 separa cadastrada, ambiente e habilitada para ferramentas; ferramenta desabilitada não deve ser resolvida/executada. Esta separação inspira capability toggle do catálogo, mas capability “disponível” não significa “enabled” nem consentimento para upload.
- Para status de conversa, voz, GPU, credenciais e beta, consultar `docs/project/CURRENT-STATE.md`; naquele commit há gates/validações runtime pendentes. Pesquisa não atesta app pronto.

---

## A. LLMs: local, remote, compact, tool-use

| Candidato / oficial | Capacidade e licenças | Hardware / encaixe / avaliação |
|---|---|---|
| **Liquid AI LFM3-1.7B** · [card](https://huggingface.co/LiquidAI/LFM3-1.7B), [blog](https://www.liquid.ai/blog/lfm3) | Texto→texto; pequena família, agent/tool calling segundo vendor. LFM Open License v1.0 (commercial threshold US$10M de receita anual; não MIT/Apache). GGUF/HF/ONNX variantes; exato card fixa contexto/formato. | **A** benchmark local no llama.cpp/Vulkan e CPU; interessante para RX580 8GB. Não inferir que reasoning/tool accuracy satisfaz chat/persona. Sem tokens/s no hardware alvo. |
| **Qwen3 / Qwen3.5 checkpoint específico** · [Qwen org](https://huggingface.co/Qwen), [GitHub](https://github.com/QwenLM) | Muitas famílias variantes e licenças; alguns text/multimodal cards Apache-2.0, outros API proprietária. Tool call/template pertence a modelo concreto. | **A/B** bons comparadores; usar modelos pequenos em GGUF/Vulkan e verificar multilingual Portuguese, context, quantization, base vs instruct, tool parser. Não generalizar licença por família. |
| **Gemma 4 small** · [official HF](https://huggingface.co/google), [Google models](https://ai.google.dev/gemma) | Text/image; alguns tamanhos com audio support de input conforme card; function-calling support em versões. Licença por model card; card atual pode ser Apache-2.0 conforme variante (verificar). | **B** eval em quantized GGUF/Transformers; total weights/active params e RAM depend quant. Não assume RX580 speed. |
| **llama.cpp** · [repo](https://github.com/ggml-org/llama.cpp), [docs](https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md) | Runtime C/C++, GGUF, CPU/GPU hybrid, quantization, OpenAI-style server; repo MIT. Model weights retain their own terms. | **A** runtime candidate: CPU, Vulkan, CUDA, HIP/ROCm, SYCL (backend specific). Vulkan first test for RX580; ROCm unsupported target there. API local adapter; process isolation and model download need design. |
| **Ollama** · [repo](https://github.com/ollama/ollama), [docs](https://docs.ollama.com) | Local model management/server developer-friendly; license and feature support should be read from current upstream tag. Model manifests/pulls are separate from weight licensing. | **B** optional dev/advanced user local runtime, not required package; hardware backend/model support differs from llama.cpp under hood. Avoid hidden resident server and implicit network downloads. |
| **LM Studio** · [site](https://lmstudio.ai), [docs](https://lmstudio.ai/docs) | GUI app/model catalog/OpenAI-compatible local server; proprietary application, models separately licensed. | **B** good comparative UX and local API target; not redistributable dependency. User can separately install; local endpoint still needs authentication/loopback safeguards. |
| **Liquid AI API** · [docs](https://docs.liquid.ai), [pricing](https://www.liquid.ai/pricing) | Hosted LFM service; request modalities/models/terms/prices change independently of weights. | **B** optional remote provider; no assumption of free tier. Cost/privacy/retention per current terms. |
| **Google Gemini API / Live** · [API docs](https://ai.google.dev/gemini-api/docs), [pricing](https://ai.google.dev/gemini-api/docs/pricing), [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) | Hosted text/vision/audio/video/model endpoints; proprietary weights/API terms. Free and paid tiers, quotas and data terms differ; only use current official page. | **A/B** multimodal/voice evaluation; no local GPU cost, but internet/API data and changing quotas. Free tier has separate data use policy—do not route sensitive screen/mic content without consent. |
| **OpenAI API** · [models](https://platform.openai.com/docs/models), [pricing](https://developers.openai.com/api/docs/pricing) | Proprietary API: text, image, audio, transcription, image generation, realtime APIs. Billing by token/media duration/model; no assumption of standing free tier. | **A/B** remote quality/streaming comparison; retain user-controlled key, cost cap, explicit remote consent. API models and app subscription plans are separate products. |
| **Anthropic API** · [docs](https://docs.anthropic.com), [pricing](https://docs.anthropic.com/en/docs/about-claude/pricing) | Proprietary text/image, tool use, prompt caching and hosted APIs. Paid API; pricing/model lifecycle varies. | **B** text/reasoning provider, capability adapter; not a free API baseline. Permission enforcement remains Lia-owned. |
| **Groq Cloud** · [docs](https://console.groq.com/docs), [limits](https://console.groq.com/docs/rate-limits) | Hosted accelerated inference with OpenAI-compatible endpoints for supported models, quotas/rates by model/account. Model license ≠ hosted service terms. | **B** low-latency optional provider, rate limits and model availability vary; user-provided credentials. Never promise “free forever”. |
| **OpenRouter** · [docs](https://openrouter.ai/docs), [limits](https://openrouter.ai/docs/api-reference/limits) | Routing/meta-provider to third-party models; price, availability, terms and data paths depend on upstream route. Some free variants transient. | **B** advanced multi-vendor option; expose actual endpoint/model/price, don't hide chain of processors. Additional intermediary privacy/supply risk. |

### Candidate comparison and guidance

- Select by **capability contract + exact model ID/version**, not vendor label. Keep `input modalities`, `output modalities`, `tools`, `streaming`, `context`, `locale`, `local/remote`, limits, license URL, deployment requirements.
- For reference hardware, local small GGUF model on CPU/Vulkan is an evaluation path, not guaranteed interactive quality. For stronger answer quality, hosted provider may be opt-in; UI must indicate cost/data transfer.
- Small 1–4B models may be weak in planning/tool correctness even if file fits. Evaluate task success, JSON/schema compliance, false tool calls, refusal, pt-BR quality and prompt injection, not only tokens/sec.

## B. Multimodal models

### LFM3 (model-specific table and licensing details)

See [dedicated LFM3 evaluation](LIA-LFM3-EVALUATION.md). Key distinction:
- VL accepts text/image/video and outputs text; not designed as main multi-turn/chat/code model per its own card.
- Audio accepts text/audio, can output text/speech; voice chat and LiveASR are English-only in current card, despite multilingual speech/translation list including Portuguese.
- Omni combines inputs/text+speech outputs, but 32K context and non-reasoning card; not equivalent to all specialist accuracy/low-memory paths.
- d1 models make structured decisions, not conversational persona.

### Other VLMs / hosted visual APIs

| Candidate | Features / license | Fit |
|---|---|---|
| **Qwen-VL checkpoint** · [Qwen Hugging Face](https://huggingface.co/Qwen) | Exact variants may accept image/video and produce text; per card license/runtime/size differs. | **B** compare for screenshot/desktop understanding, with crop policy; not continuous capture by default. |
| **PaddleOCR PP-OCR** · [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) | OCR/document extraction; project Apache-2.0, specific models and optional components separately check. Upstream reports Windows C++ deployment for PP-OCRv5 and 109-languages model (vendor statement). | **A/B** targeted OCR for UI text may be cheaper/more predictable than a large VLM. Measure English/PT-BR screenshot/scene text. Avoid installing full document AI dependencies if only screen text is needed. |
| **Cloud multimodal APIs** (OpenAI/Gemini etc.) | Accept image; some support video/audio; exact model endpoints/payload, retention and price vary. | **B** optional remote capability; only on explicit permission, crop/redact before upload; cost estimates include image/frame tokens. |
| **Windows AI / Foundry Local** · [Microsoft AI FAQ](https://learn.microsoft.com/en-us/windows/ai/faq) | Windows-native AI APIs/Foundry local/Windows ML have differing PC requirements. Some Windows AI APIs need Copilot+ NPU, Foundry Local supports broader DX12 devices; ONNX Windows ML handles imported models. | **B** monitor, especially for Windows-first lightweight use; verify which API works on non-NPU RX580 before UX promise. |

## C. TTS, STT, VAD and voice products

### Text-to-speech

| Candidate | Official links; actual function | License/cost/hardware/risk | Priority |
|---|---|---|---|
| **Kokoro 82M** | [hexgrad/kokoro](https://github.com/hexgrad/kokoro), [model card](https://huggingface.co/hexgrad/Kokoro-82M). Local TTS, 82M; voice/language list varies model version; community/inference implementations support pt-BR. | Weights Apache-2.0 according to HF; code/deps/voicepack separate. `espeak-ng` may GPL in some wrappers. Need verify redistribution, voice data terms, pt-BR voice quality. CPU candidate; no Lia measurement. | **A** TTS comparison, because low parameter count and pt-BR voice candidate. |
| **VoiceStudio** | [debpalash/VoiceStudio](https://github.com/debpalash/VoiceStudio) · [docs/site](https://voicestudio.sh). Local desktop suite covering TTS voice design/cloning, video dubbing, dictation/transcription, audiobooks, local API/MCP, model manager. Upstream active as of query; page showed current commits on 14 Nov 2026. | App AGPL-3.0; each engine/model/voice terms differ. Python/Node/native dependencies and large downloads, optional remote workers. Not a TTS model/provider itself; code copying/bundling would incur AGPL review. Security risk local API/install/model downloads, though upstream documents authorization controls. | **B/REFERENCE** for UX/catalog/model lifecycle; avoid embedding whole studio. |
| **OHF Piper 1 GPL** | [OHF-Voice/piper1-gpl](https://github.com/OHF-Voice/piper1-gpl); current maintained fork/engine for local ONNX TTS. | GPL-3.0 code; voices have individual model-card licenses. Older rhasspy repository MIT is archived and not current maintained source. | **B** if external child process and voice has suitable rights; licensing engineering required. |
| **Coqui TTS / XTTS v2** | [Coqui TTS](https://github.com/coqui-ai/TTS), [XTTS model](https://huggingface.co/coqui/XTTS-v2). Toolkit MPL-2.0; XTTS weights CPML non-commercial. | Do not confuse library license with weights; Lia licensing docs state XTTS is not distributed/bundled and commercial restriction. Requires Python/Torch and GPU/CPU resources. | **D** for commercial product with model weights; adapt only noncommercial research. |
| **OpenAI TTS / audio** | [speech API](https://platform.openai.com/docs/guides/text-to-speech), [pricing](https://developers.openai.com/api/docs/pricing). Hosted streaming-capable models/endpoints. | Paid usage/current policies, network, voice/output rights and data handling. No local load. | **B** paid opt-in remote option. |
| **ElevenLabs** | [API docs](https://elevenlabs.io/docs/api-reference/text-to-speech), [pricing](https://elevenlabs.io/pricing/api). Cloud expressive multilingual TTS/voice services. | Free plan/product licensing differs from paid commercial rights; user voice cloning requires consent and plan/terms. Per-char/credit price changes. | **B** compare service; not default. |
| **Cartesia Sonic** | [docs](https://docs.cartesia.ai), [pricing](https://cartesia.ai/pricing). Hosted streaming low-latency TTS and voice APIs; supplier advertises latency/languages, must test pt-BR. | API hosted; pricing/tiers and commercial use from plan terms; cloning rights separate. | **B** full-duplex/latency candidate. |

### STT / VAD / audio

| Candidate | Function / license | Fit / concern | Priority |
|---|---|---|---|
| **whisper.cpp** · [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp) | C/C++ Whisper inference; MIT project. Whisper weight license separately verify source card (OpenAI Whisper official weights MIT). CPU and multiple optional backends. | Local offline PT-BR baseline, Windows package can be smaller vs Python stack. Streaming typically chunk/loop, not naturally full-duplex. | **A** benchmark. |
| **faster-whisper** · [SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper) | Whisper via CTranslate2; MIT. Upstream claim up to 4x original Whisper throughput on same hardware; official stack primarily Python/CUDA GPU and CPU quantized. | Good CPU/batch benchmark; not native low-friction Electron bundle and not true streaming by itself; CTranslate2 backend support on AMD Windows needs specific verification. | **B** compare if Python runtime acceptable. |
| **OpenAI Whisper** · [repo](https://github.com/openai/whisper) | STT/translation/language ID; MIT code and official weights per upstream. | Python-heavy; reference quality, not cheapest package/runtime. | **B** baseline/reference. |
| **sherpa-onnx** · [repo](https://github.com/k2-fsa/sherpa-onnx), [docs](https://k2-fsa.github.io/sherpa/onnx/) | ONNX/C++/Python/mobile ASR, streaming models, VAD, keyword spotting, diarization (model-dependent); Apache-2.0 code, model rights per artifact. | Strong candidate for streaming edge/audio; test pt-BR model availability and latency Windows CPU/ONNX. | **A/B** POC. |
| **Silero VAD** · [repo](https://github.com/snakers4/silero-vad) | Voice activity detection; MIT. Upstream cites small ~2MB JIT and sub-ms chunk claim—author claim, hardware dependent. | CPU-first local gating; does not transcribe, wake-word, or identify speaker. | **A** if voice capture proceeds. |
| **Google/Azure/OpenAI STT APIs** | Hosted transcription/streaming endpoints; prices per audio/time/tokens in vendor pages. | Optional network path, data/retention terms and ongoing price. Need fallback local and explicit setting. | **B** evaluate per requirement. |

## D. Full-duplex voice

| Candidate | State | Recommendation |
|---|---|---|
| **OpenAI Realtime API** · [docs](https://platform.openai.com/docs/guides/realtime), [prices](https://developers.openai.com/api/docs/pricing) | Hosted audio-in/audio-out realtime sessions and turn events; paid and external. Exact API/model version mutates. | **B** remote benchmark for barge-in; measure per-minute cost and provider-data policy. Not a local default. |
| **Google Gemini Live API** · [docs](https://ai.google.dev/gemini-api/docs/live), [billing](https://ai.google.dev/gemini-api/docs/billing) | Hosted realtime audio/video modalities; supported languages and feature behavior per model. Free-tier data conditions differ from paid. | **B** compare; consent and remote indicator. |
| **LiveKit Agents** · [repo](https://github.com/livekit/agents), [docs](https://docs.livekit.io/agents/) | Python/Node voice agent runtime, provider plugins, WebRTC media, turn detection; Apache-2.0 framework, turn model license separate. | **B/C** architecture for streaming, interruption, turn taking; server/media stack may be excessive for local desktop companion. |
| **Shizuku-Duplex** · [official article](https://shizuku.ai/en/blog/1/) | Japanese full-duplex research/product model; vendor reports 80 ms tick and timing benchmarks; TensorRT/Triton optimizations. | **C** Japanese-specific, no documented pt-BR or compatible general Windows/RX580 weights/API. Excellent interaction design reference; not integration candidate. |
| **LFM3-Audio/Omni** | Full audio input, generated speech/interleaving; model-specific limitations in LFM3 report. | **B/C** local modality test; don't assume barge-in, VAD or full duplex from streaming speech generation alone. |

**Full-duplex contract distinctions:** microphone capture always-on vs push-to-talk; VAD; end-of-turn endpoint; partial STT; assistant output starts while user speaks; cancellation; acoustic echo cancellation; backchannel. These are separate capabilities. Test “stop audio within x ms” and echo false-trigger, not merely WebSocket streaming.

## E. Vision, OCR, image/video generation

### Vision and OCR

- **PaddleOCR** · [official repo](https://github.com/PaddlePaddle/PaddleOCR) (Apache-2.0 code): local OCR/layout/document extraction; upstream reports Windows C++ inference and 109-language PP-OCRv5 model. Model card/dependency terms and RX580 DirectML support need checking. **A/B** for screen text vs expensive VLM.
- **Tesseract OCR** · [repo](https://github.com/tesseract-ocr/tesseract), Apache-2.0 engine; traineddata language data terms/source separate. CPU local, mature, suitable baseline for clear UI text; less robust to stylized/scene text. **B** baseline.
- **VLM local:** LFM3-VL, Qwen-VL, Gemma multimodal variants—model exact architecture, license, processor, frame sampling. **B** occasional screenshots; crop and redact. Do not capture desktop continuously without opt-in.
- **Hosted VLM:** Gemini/OpenAI providers support varying image/video input; **B** advanced mode after explicit remote-consent and cost estimation.

### Image generation

- **ComfyUI** · [Comfy-Org/ComfyUI](https://github.com/Comfy-Org/ComfyUI): node graph workflow engine, GPL-3.0. UI/tool not weights. Good advanced user external integration/local REST concept, but too broad/heavy as core runtime.
- **stable-diffusion.cpp** · [leejet/stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp): C/C++ image diffusion runtime, MIT code; backend lists CPU, Vulkan, CUDA, Metal/OpenCL/SYCL as project support. Model licenses per checkpoint (e.g. FLUX.1 schnell Apache-2.0; FLUX.1 dev noncommercial license; Stability license may include thresholds). **B/C** optional creative provider; RX580 feasibility and generation time unknown.
- **Black Forest Labs FLUX API/weights** · [models](https://bfl.ai/models/flux-pro), [docs](https://docs.bfl.ai/flux_2): model/API roster; Schnell Apache-2.0, Dev variants are non-commercial terms per official product pages; hosted pro is paid. Confirm exact model/license before generated assets distributed. **B** optional remote image provider.
- **OpenAI Images / Google Imagen**: paid hosted image generation/edit APIs; no local hardware; prices output/image vary; explicit confirmation/cost. **B** remote option.

### Video/motion/lipsync

- **Wan2.2** · [official repo](https://github.com/Wan-Video/Wan2.2) and [ComfyUI guide](https://docs.comfy.org/tutorials/video/wan/wan2_2): T2V/I2V/TI2V; official repo states Apache-2.0 weights; sizes include 5B/14B models. High RAM/VRAM and noninteractive compute; RX580 not a practical default, no exact test. **C** optional advanced user/cloud workload.
- **Veo / hosted video**: vendor hosted generation, usage billed by second/credits, highly volatile API lineup. **C** advanced capability only, strict confirmation and estimates; never ambient companion behavior.
- **Lip sync**: avatar-specific viseme/phoneme animation should consume audio timestamps; not require generative video model. Explore existing Live2D/VRM facial animation renderer instead of diffusion. Verify license of avatar SDK and each model/asset.

## F. Embedding, search, memory, rerank

| Candidate | Facts / licensing | Lia fit |
|---|---|---|
| **Qwen3 Embedding 0.6B** · [card](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B), [repo](https://github.com/QwenLM/Qwen3-Embedding) | Card Apache-2.0; multilingual (100+ per model documentation), 32k input, dims flexible. Larger 4B/8B models increase footprint. | **B** local index experiments only if current lexical memory doesn't retrieve well. CPU ONNX export support and quality pt-BR need verification. |
| **BGE-M3** · [FlagEmbedding](https://github.com/FlagOpen/FlagEmbedding), [BAAI model](https://huggingface.co/BAAI/bge-m3) | multilingual dense/sparse/ColBERT embedding, long input; license of code and card confirm exact artifact (FlagEmbedding repo MIT, model card per model). | **B** alternative for multilingual retrieval. Disk/CPU larger than simple FTS. |
| **Qwen3 reranker / BGE reranker** · [Qwen3 reranker](https://huggingface.co/collections/Qwen/qwen3-embedding), [BGE reranker](https://huggingface.co/BAAI/bge-reranker-v2-m3) | Pairwise relevance scoring. Per checkpoint license; CPU cost proportional to candidates. | **C** rerank top-k only if retrieval metrics justify additional model load/latency. |
| **SQLite FTS5 / current Lia memory JSON** | SQLite FTS5 built-in; Lia snapshot includes local validated JSON memory service and recall logic (code at reference commit). | **A** measure current recall/context before embedding store; maintain deletion/opt-out provenance. |
| **sqlite-vec** · [repo](https://github.com/asg017/sqlite-vec) | C SQLite extension, Apache-2.0/MIT dual; upstream marks pre-v1/breaking API. | **C** watch/POC if vector retrieval needed; do not use as stable required package before maturity. |
| **Qdrant** · [repo](https://github.com/qdrant/qdrant) | Vector DB server Rust, Apache-2.0; separate process/service. | **D** for single-user desktop by default (extra daemon/RAM/ops); evaluate only if datasets exceed embedded store. |
| **Hosted embeddings** (OpenAI/Gemini) | Paid or tier-dependent remote API; privacy/cost. | **C** optional if user chooses cloud; local memory must not silently upload conversation history. |

## G. Memory, personality and agent architecture

- **Lia current memory**: JSON local, limits, validation, explicit enable/save/remove/clear/recall in inspected `memory-service.ts`. This exists: **A** validate retrieval/UX/security before replacement. Separate durable memory from user persona/profile/session facts and raw transcript.
- **LangGraph JS** · [repo](https://github.com/langchain-ai/langgraphjs) (MIT): long-running graph, checkpoints, human interruption; JS/TS. **B** conditional proof if durable resume needed. A framework checkpoint is not semantic memory/policy.
- **MCP protocol** · [spec](https://github.com/modelcontextprotocol/modelcontextprotocol), [SDK](https://github.com/modelcontextprotocol/typescript-sdk): standard tools/resources. Protocol is MIT; servers are individually licensed/maintained and may be unsafe. **B** optional bridge behind Lia's capability/permission gateway; never auto-run arbitrary discovered servers.
- **Tool/agent evaluation**: tool-call acceptance fixture, replay harness, model prompt/adversarial safety evaluations more valuable than multiagent framework. **A** develop evaluations, not necessarily a dependency.
- **Personality**: store system persona/version separately from learned profile and event/session state; use rubric-based consistency tests and explicit user-controlled tone sliders rather than model fine-tuning. No dependency necessary.

## H. Desktop/game/app integrations and other capabilities

- **Discord**: official bot API and SDKs can provide opt-in chat presence; Discord Developer Policy and user consent apply. Do not read private messages or join voice without explicit permissions. WebSocket/API costs/privacy; dependency per SDK. **C** until product requirement.
- **Game/app integrations**: APIs (game-specific plugin/mod/API) are safer than global keyboard/mouse; generic screen OCR/action has privilege and prompt injection risk. Adapter per app with declarative allowlist, visible consent and postcondition. **B** targeted games; do not add generic “autopilot”.
- **MCP/app plugin ecosystems**: pluggable processes, but protocol ≠ sandbox. Validate tool schema, origin, file/network scope, run-as-user, kill/timeout, approval, audit and rollback. **B** interoperability only.
- **Foundry Local** · [docs](https://learn.microsoft.com/en-us/windows/ai/foundry-local/): Windows-local model server/API may simplify model download/hardware selection; verify model catalog and Windows version/provider. **B** monitor/compare with llama.cpp rather than dependency.

## Comparison summary

| Capability | Best first local evaluation | External/provider alternative | Main blocker |
|---|---|---|---|
| Chat/tool LLM | llama.cpp + small GGUF (LFM3 1.7B and Qwen small comparison) | user-configured OpenAI/Gemini/Anthropic/Groq/OpenRouter | Quality/tool safety on pt-BR; model licenses |
| Vision/screen OCR | crop + PaddleOCR/Tesseract, then VLM | Gemini/OpenAI VLM | privacy/capture consent, ops support |
| STT | whisper.cpp vs sherpa-onnx | OpenAI/Gemini/ElevenLabs | pt-BR WER/latency and stream |
| TTS | Kokoro vs candidate existing runtime/Piper voice | Cartesia/ElevenLabs/OpenAI | voice quality rights and real latency |
| Full duplex | modular VAD/STT/LLM/TTS pipeline; LiveKit as design comparison | Realtime APIs / Gemini Live | true barge-in/echo and recurring costs |
| Image generation | external process `stable-diffusion.cpp` / ComfyUI user-managed | BFL/OpenAI/Imagen | VRAM/time, checkpoint license |
| Video | user-managed Wan only on capable hardware | hosted Veo/vendor | huge cost and not interactive |
| RAG | existing Lia memory + lexical recall, test first | hosted embeddings if explicitly opted | need not exist until recall fails |

## Sources (official first-party)

- [LFM3 evaluation](LIA-LFM3-EVALUATION.md) and [license](https://huggingface.co/LiquidAI/LFM3-1.7B/blob/main/LICENSE).
- [llama.cpp](https://github.com/ggml-org/llama.cpp), [Qwen](https://github.com/QwenLM), [Gemma](https://ai.google.dev/gemma), [Ollama](https://github.com/ollama/ollama), [LM Studio docs](https://lmstudio.ai/docs).
- [Kokoro](https://github.com/hexgrad/kokoro), [Piper](https://github.com/OHF-Voice/piper1-gpl), [Coqui TTS](https://github.com/coqui-ai/TTS), [whisper.cpp](https://github.com/ggml-org/whisper.cpp), [faster-whisper](https://github.com/SYSTRAN/faster-whisper), [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx), [Silero VAD](https://github.com/snakers4/silero-vad), [VoiceStudio](https://github.com/debpalash/VoiceStudio).
- [OpenAI docs/pricing](https://developers.openai.com/api/docs/pricing), [Gemini API/billing](https://ai.google.dev/gemini-api/docs/billing), [Anthropic docs](https://docs.anthropic.com), [Groq limits](https://console.groq.com/docs/rate-limits), [OpenRouter limits](https://openrouter.ai/docs/api-reference/limits), [Cartesia docs](https://docs.cartesia.ai), [ElevenLabs docs](https://elevenlabs.io/docs/api-reference).
- [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR), [Tesseract](https://github.com/tesseract-ocr/tesseract), [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp), [ComfyUI](https://github.com/Comfy-Org/ComfyUI), [Wan2.2](https://github.com/Wan-Video/Wan2.2), [BFL docs](https://docs.bfl.ai/flux_2).
- [Qwen3 embeddings](https://github.com/QwenLM/Qwen3-Embedding), [BGE](https://github.com/FlagOpen/FlagEmbedding), [sqlite-vec](https://github.com/asg017/sqlite-vec), [Qdrant](https://github.com/qdrant/qdrant), [LangGraph JS](https://github.com/langchain-ai/langgraphjs), [MCP spec](https://github.com/modelcontextprotocol/modelcontextprotocol).
- [LiveKit Agents](https://github.com/livekit/agents), [Shizuku-Duplex research](https://shizuku.ai/en/blog/1/), [Microsoft Windows AI FAQ](https://learn.microsoft.com/en-us/windows/ai/faq).

All sources queried 14/11/2026; dynamic pricing/quotas and model repos must be rechecked at selection time. “Official” means the provider/project host, not independent verification.
