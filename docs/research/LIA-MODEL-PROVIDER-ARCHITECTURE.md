# Proposta: catálogo de capacidades e arquitetura neutra de providers

**Natureza:** proposta de pesquisa (não implementação, não ADR, não altera código). **Consulta:** 14/11/2026. **Referência Lia:** `arena/01a10290-lia-project` remoto em `0bf0629263ba2c030efe07fc070283a4e025467a`; estado operacional diz code audit SHA `ae46c495d7da7cd33f4b4da8f4e8cc95b0a867b6`. **Limite:** não reconciliei todos os pacotes/código no novo tip, nem propus substituir componentes existentes. A branch tem contratos de host e provider/selection gateways no snapshot; comparação precisa de leitura do código atual antes de desenhar migration.

## 1. Objetivo de arquitetura

Disponibilizar um “mercado curado de capacidades” selecionável pelo usuário, não um catálogo de centenas de checkpoints nem um conjunto de abstrações só nominalmente independentes. O core da Lia consome contratos tipados e capability-negotiated; cada provider declara capacidades concretas, disponibilidade, recursos/licenças e forma de configuração. Adapter transforma contrato em protocolo do modelo. O host confiável guarda credenciais, faz validação, gerencia processos/downloads e controla permissões. Renderer apresenta escolhas e estado sem tokens/segredos.

**Princípio:** ligar provider a capability uma por uma. Um modelo multimodal pode satisfazer múltiplas capabilities, mas uma capability também pode compor múltiplos providers. Usuário escolhe deployment e escopo, com default conservador; fallback não troca para cloud sem ação explícita.

## 2. Separação de domínios (conceitual)

```text
Catalog Manifest (curated metadata + signed/verified source)
                  │
          Selection/Policy (user preference, enabled, consent, budget)
                  │
          Capability Router (input/output contract, negotiate)
           ┌──────┼─────────┐
     Provider Adapter  Local Runtime  External API Adapter
           │          │             │
     tool policy   supervised process  host-owned credential + HTTPS
           └──────────┴──────────┘
                  │
        response/event normalized to Lia contract
```

### 2.1 Catalog manifest vs runtime registration

Separar metadados curatorados da instância executável:

- **Provider definition:** organization/id, adapter key, protocol, versions, local/remote, supported regions, docs/support/security URLs, maintenance date.
- **Model artifact:** model ID and immutable revision, `sha256`, size bytes, source URL/repo, format, files/aux files, license IDs/URLs and redistribution flags, upstream card revision/date, safety notes, quantization.
- **Capability profile:** input/output modalities; streaming; function/tool schema support and known limitations; max context limits only if source verified; languages/locales tested vs vendor-claimed; tasks (ASR/TTS/vision/etc).
- **Execution profile:** OS/arch, runtime version, backend options CPU/Vulkan/DirectML/CUDA/ROCm/ONNX/etc, min RAM/VRAM as estimate/evidence, disk/free space, fallback path, concurrency, unload behavior.
- **Commercial profile:** free/paid/credit/subscription/on-prem, unit (tokens/second/character/request), official pricing URL, last checked, free tier expiry/limits/data terms; do not hard-code unknown price.
- **Status/provenance:** verified date, claim source and confidence (official docs, reproduced Lia test, third party); maturity/release state, last upstream release/commit. No star counts as acceptance signal.

Candidate phases: first ship curated rows (roughly 5–10 providers per user-facing capability) and “custom OpenAI-compatible endpoint” advanced path. Catalogue only tested/reviewed or clearly marked unverified. No automatic arbitrary Hugging Face model list.

### 2.2 Selection/configuration

Proposed separate records (names illustrative, not contracts implementation):

- `CapabilityId`: `chat`, `reasoning`, `vision.image`, `vision.screen`, `audio.stt`, `audio.tts`, `audio.vad`, `audio.realtime`, `embedding`, `rerank`, `image.generate`, `video.generate`, `tool.call`, `memory.recall`.
- `Selection`: capability → provider/model/deployment ID, version/revision, settings ref; enabled flag distinct from registered/available and consent. A model can satisfy more than one capability; user's capability routing may select same model across entries.
- `AvailabilityState`: `not-configured`, `needs-key`, `needs-download`, `downloaded`, `checking`, `ready`, `incompatible`, `offline`, `quota`, `unhealthy`, `disabled`, `license-review`, `unsupported`, `error`; include reason and retryability.
- `Consent`: local/remote, microphone/screen, retention, per-capability; timestamp and scope. Consent revocation must stop active streams and clear transient buffers.
- `ResourcePolicy`: `quiet`, `balanced`, `performance`, or custom CPU threads/VRAM cap/context/concurrency/frame budget where runtime supports. These are preferences, not promise of exact utilization. The UI can state “best effort”.
- `CostGuard`: monthly/manual spend limit for remote provider; estimate/confirm before chargeable generation. Do not assume provider exposes hard account spend cap.
- `ModelPin`: pinned manifest hash + runtime; do not auto-update model in a way that alters behavior without notice.

### 2.3 Capability contracts (illustrative semantics)

- **Text generation:** conversation, system/user/assistant/tool messages; streaming events (`delta`, `tool_call`, `usage`, `finish`, `error`); cancellation signal; structured output schema optional; explicit nonstandard fields in feature declarations. Preserve provider's native stop/error details in normalized metadata.
- **Vision:** `ImageInput` with MIME/byte/reference, dimensions, crop and consent scope; video as bounded timestamped frames; output text + optional regions/confidence. Never accept arbitrary screen capture path from renderer.
- **STT:** audio stream or file with sample-rate/channel/locale; partial/final transcript and timestamps; cancellation; VAD can be independent and optional; confidence only if provider returns.
- **TTS:** text chunk/locale/voice selection; output chunk with sample rate/codec/timing; cancel; voice metadata/license; no arbitrary voice cloning by default.
- **Realtime session:** audio in/out chunks, events for speech start/stop, turn, partial transcript, output cancel, tool request, session failure; model provider endpoints normalized but preserve provider-specific event extension safely.
- **Embedding/reranker:** input text; vector dimension and model revision; batch limits; similarity-space metadata; embeddings never mix across incompatible model revisions without migration.
- **Memory:** Lia owns policies/data/deletion; model provider can propose memory extraction but cannot write persistent memory without an explicit tool/policy decision. Separate raw transcripts from derived entries.
- **Image/video generation:** prompt plus references and output constraints; explicit estimated price/resource/time; confirmation before costly generation; output artifact hashes/terms.
- **Tools:** router receives schema + allowlisted capabilities; model produces intent only; host validates, policy authorizes, user confirms sensitive action, executor applies. Never map provider tool calls directly to shell or filesystem.

**Compatibility:** OpenAI-compatible REST should be one adapter protocol, not canonical internal schema. SSE, WebSocket/realtime, Anthropic messages, Gemini parts, audio-specific event APIs differ; adapter normalizes only common semantics and records feature gaps. Avoid lying that API compatibility implies image/audio/tooling parity.

## 3. Local model lifecycle

1. User selects capability/model; show disk size and estimated RAM/VRAM/context; require explicit **Download** action. Installer ships no large weights unless an asset is explicitly approved/licensed.
2. Host resolves pinned manifest from allowlisted source, checks HTTPS, hash/signature where available, writes to temp/quarantine directory, verifies hash/size and manifest, atomically promotes. Tar/zip extraction must defend traversal, symlink, decompression bombs, unexpected executable files.
3. Model registry stores artifact path/size/hash/revision/license consent/runtime compatibility, not secret. Paths are canonicalized inside model store; protect from symlink traversal. No model runs before validation and user approval.
4. Runtime launcher uses a dedicated non-elevated child process, explicit environment, restricted loopback/IPC, process tree supervision, startup timeout, health check, cancel/shutdown, CPU/memory budgets if supported. Do not expose local API on public interfaces by default.
5. Model update is a new pinned revision, side-by-side or staged; rollback preserves prior artifact unless user explicitly removes. Revalidate license/publisher/checksum on update.
6. Uninstall model removes associated variants/auxiliary files/cache/index when selected; tell user if shared artifacts remain due to other providers. User can inspect size and remove. No silent cache purge of user data.
7. Compatibility discovery runs non-invasive static requirements and runtime smoke; actual run is separate state. “Supported” vs “detected” vs “tested on this device” are distinct UI badges.

## 4. Remote providers, credentials and cost

- API keys managed by trusted host/vault; renderer only sees masked status/reference. Never log Authorization, full URL query secrets, audio or prompt payload by default. Do not accept endpoint URL schemes other than HTTPS (except explicit loopback local provider) and allow host policy to mitigate SSRF/DNS rebinding.
- Credential validation uses safe metadata/low-cost ping or explicit “Test connection”; show request will go to provider. Support user-entered key; optionally offer provider account/deep link without storing browser tokens in renderer.
- Provider selection and credentials are per user, not checked-in catalog. On change, verify stale selection/version and ownership like existing managed selection semantics.
- Billing display: current official price URL, last sync, unit, tax/currency caveat, cached/input/output/media rate, estimated per typical scenario and “estimate only”; user-configured hard Lia budget before any call. Avoid false statement that provider free quota is permanent or commercially licensed.
- Include disable/delete credentials; logout/revocation must stop retries/streaming and erase tokens from memory where feasible.
- Data controls: local/offline indicator, remote provider name, content classes about to upload, redaction/crop, retention link; setting per capability. Mic and screen consent independent.

## 5. Model sharing vs specialization

### Safe to share when verified
- Single text model can serve chat + short-form reasoning + tool intent if same context/quality/capabilities validated. But selection UI may allow independent primary and fallback models.
- Same model runtime can host text and vision if checkpoint supports images; don't claim it handles screen OCR precisely or video temporal tasks without test.
- One audio model might do STT/TTS/translation but voice chat, ASR, language support and codec are separately declared. Allow user to assign independent STT/TTS.
- A multimodal model can reduce process count if only loaded once and features run sequentially, but it can increase peak footprint and produce worse specialist results. Profile can share one model ID across capabilities; do not make shared model a forced coupling.
- Embeddings and reranker are separate roles; reranker cannot replace embedding retrieval. Embedding space is model/version-specific.

### Keep independent
- VAD vs STT vs TTS vs turn-detection/echo cancellation.
- Screen capture permission vs vision model; model capability must not grant capture permission.
- Memory storage/policy vs LLM; model can propose but cannot autonomously persist sensitive facts.
- Tools and executor vs tool-calling model.
- Image/video generator vs avatar rendering/animation/lipsync.
- Provider protocol adapter vs provider account/credential.

## 6. User experience: simple first, advanced optional

### Recommended experience for newcomer

1. **Quick setup:** selectable chips `Local & private`, `Free cloud (limits/data terms shown)`, `Paid cloud`, `Not now`; no paid provider preselected without disclosure.
2. **Capabilities overview:** chat, voice, screen, image creation, memory; each has a simple state and off switch. “Voice” opens STT + TTS + VAD group but allows defaults without exposing internals immediately.
3. **Per-capability recommended option:** concise label such as “Works offline · uses ~X GB disk · estimated memory range · Portuguese: tested/not tested · license constraint · last verified”. Recommendation never auto-switches provider.
4. **Install on demand:** model download size, disk space, source, checksum/provenance, cancellation, remove model. No download until user confirms.
5. **Cloud transparency:** key required, provider, free quota caveat, estimated cost, what goes off-device, data use/retention link. Meter/cost ceiling and “ask before each billable image/video”.
6. **Fallback:** only within user's explicitly enabled set; show fallback provider/remote status and ask before changing local-only to remote.

### Advanced view

Search/filters by modality, local/hosted, Windows compatibility level, tested on device, VRAM/RAM/disk, license type/commercial, languages/pt-BR evidence, streaming/tool/structured output, cost, maturity. Show protocol, model revision, runtime/backend, custom endpoints, sampling parameters, context, resource budgets, logs and network diagnostic. Let user independently select LLM, vision, audio, TTS, STT, embeddings, reranker and generation providers.

### Keep catalog curated

Do not show every HF repo. Tiers: `Recommended tested by Lia`, `Compatible by upstream claim`, `Advanced/experimental`, `Unavailable on this machine`, `License review`. Provide a “custom model” route only for experienced users, no support promise. Review catalogue on release cycle; expire old pricing, URLs and support status.

## 7. Risks and anti-patterns

- **License**: model weights may use custom/non-commercial/revenue threshold even when repo/runtime MIT/Apache. Build a manifest-based license audit before packaging; no legal conclusion from labels like “open weights”.
- **Supply chain**: model repos can contain executable custom code, pickle `.pt` unsafe loader, tokenizer/model code and malicious archives. Prefer safetensors; pin code; hashes/signatures; scan/quarantine; no `trust_remote_code` by default.
- **Provider ambiguity**: OpenAI-compatible endpoint does not guarantee API behavior; normalization can drop refusal, audio, usage, JSON or errors. Feature negotiation and test matrix required.
- **User choices**: no surprise cloud fallback, model change, paid call, voice clone or screen streaming. No vendor-only recommended model as mandatory.
- **Resource hogging**: avoid loading every chosen model simultaneously; scheduler admits jobs by memory/concurrency budget and unload policy; Stage animation/voice stays responsive.
- **Credential/sandbox**: backend child process and renderer need privilege separation; local server loopback authentication; never ship API keys.
- **Long-tail operations**: dependency matrix, Windows binary signing, updates, model cache cleanup, schema migration, crash recovery and support docs may dominate adapter coding cost.

## 8. Architecture alternatives and recommendation

| Alternative | Advantage | Cost/risk | Verdict |
|---|---|---|---|
| A. One adapter abstraction over all providers, all modalities | Uniform-looking UI and router | Leaky abstraction, common denominator destroys provider-specific features, huge interface | **Reject as monolithic abstraction**; protocol adapters + capability interface better |
| B. Capability contracts + independent provider adapters + manifests | Provider replacement, per-capability choice, truthful support/consent, works with current Lia capability direction | Moderate manifest/test/lifecycle engineering; must maintain registry | **Recommended target**, staged, verify against existing code first |
| C. One multimodal provider/model owns whole user session | Easy setup/low configuration | Vendor lock-in, language/license/cost coupling, failure removes all abilities | **Offer only as preset**, never sole architecture |
| D. Plugin/MCP auto-discovery for models/providers | Huge catalog | Arbitrary executable code/credential/data access, incompatible schemas | **Reject automatic install/discovery**; curated verified extensions only |
| E. External local runtime model manager only (Ollama/LM Studio) | Lower Lia download/package responsibility | external app install/status, not beginner-safe, model licence and API/runtime vary | **Advanced optional endpoint**; Lia still owns policy/credential UX |

## 9. Fit to current Lia and next architecture questions

**Likely reuse, confirm in current HEAD:** managed provider selection and config gateways, host-owned credentials and process supervision, core capability contracts, voice-runtime boundary, user memory store, tool enablement/authorization. Avoid replacing any without code review. The current state explicitly flags browser renderer OIDC token handling/security questions and beta voice/testing; do not treat this work as security approval.

Product decisions needed before catalog implementation:
1. Must beta offer exactly which modalities? CURRENT-STATE says voice/STT are beta gates but runtime remains unvalidated; distinguish roadmap from validated capability.
2. Is model selection user-facing at beginner level or optional advanced screen? Do we ship local weights or only user-approved downloads?
3. Distribution/commercial scope and whether custom licenses (LFM Open License threshold, AGPL VoiceStudio, GPL Piper) can be accepted.
4. Local provider support policy: only Lia-managed processes or arbitrary localhost OpenAI-compatible endpoint? If latter, address SSRF, origin, authentication, remote masquerading as localhost.
5. Memory consent/retention and telemetry opt-out; remote providers can receive derived memories.
6. Max resource budget/system performance SLO for Ryzen/RX580, including gaming; no SLO currently evidenced by this research.

## 10. Recommended implementation staging (research priority only)

1. **Catalog schema & evidence governance** design doc + representative records; no model installer yet.
2. **Provider compatibility conformance suite** from current existing adapter contracts: text/stream/cancel/tool-call/error/usage/key redaction/provider switching.
3. **Local POC** one text model llama.cpp Vulkan + CPU; explicitly downloadable and removeable; one model only.
4. **Voice POC** compare current Kokoro/speech path with Kokoro candidate, Whisper.cpp vs sherpa-onnx, VAD. Ensure pt-BR and current voice gate.
5. **Remote provider UX** one paid + one rate-limited free tier option, cost estimate and explicit data permission; do not take third party API terms as equivalent.
6. **Vision** OCR crop first, then VLM; user-triggered one-shot only.
7. **RAG/embedding, image/video generation and MCP** deferred until user story and measured value.

No implementation authorized by this proposal.
