# Avaliação aprofundada: Liquid AI LFM3

**Consulta:** 14/11/2026. **Referência da Lia:** código referido no estado em `0bf0629263ba2c030efe07fc070283a4e025467a`; o snapshot operacional diz que o código auditado ainda era `ae46c495d7da7cd33f4b4da8f4e8cc95b0a867b6`. **Estado:** pesquisa documental; nenhum download, inference ou benchmark executado.

## Sumário

LFM3 é uma família de modelos distintos que compartilham um backbone/linhagem; não é um único modelo universal com capacidades idênticas. **LFM3-1.7B** é candidato leve para LLM/tool calling. **VL-2B** recebe vídeo/imagem e produz texto, mas a própria ficha não recomenda coding, multi-turn chat ou raciocínio complexo. **Audio-2B** cobre speech-to-text, speech generation, tradução e conversação por áudio, mas o modo de voice chat e LiveASR são atualmente documentados como English-only, enquanto o conjunto de idiomas de transcrição/síntese é mais amplo. **Omni-2B** junta texto, imagem, vídeo e áudio e responde com texto/voz; reduz orquestração de componentes, mas aumenta custo de memória/complexidade e não é raciocínio habilitado segundo seu card. d1 são modelos de saída decisória/calibrada, não chatbots.

LFM3 merece **A — avaliação prática prioritária** para texto (GGUF com llama.cpp/Vulkan) e **B — protótipo** para áudio/VL/Omni. A licença é **LFM Open License v1.0**, não MIT/Apache: uso comercial acima do threshold de US$10M de receita anual (Legal Entity incluindo afiliadas sob controle comum) não fica autorizado pelo acordo. A família tem variantes GGUF/ONNX para alguns modelos, mas Windows + RX 580 não está comprovado por benchmarks LiquidAI; não assumir que ONNX significa DirectML, nem que o backend escolhido aceite todos os operadores/modalidades.

## Tabela real de capacidades

| Model card oficial | Parâmetros / contexto publicado | Entrada → saída | Capacidades declaradas / limites importantes | Formatos/runtime citados |
|---|---|---|---|---|
| [LFM3-1.7B](https://huggingface.co/LiquidAI/LFM3-1.7B) | 1.73B; card/model docs dizem até 256K em text model. Consumo cresce com KV/context. | Texto → texto | Instrução, structured output/tool calling orientado a agent harnesses; não substitui visão/áudio. Multilíngue; verificar pt-BR em teste. | Transformers; GGUF para llama.cpp; Liquid docs mostram streaming API OpenAI-compatible. |
| [LFM3-1.7B-Base](https://huggingface.co/LiquidAI/LFM3-1.7B-Base) | base checkpoint da família | Texto → texto | Base para fine-tuning/post-training; não é o modelo instruction/chat pronto para UI. | HF Transformers; fine-tuning exige ferramenta/dados/compute. |
| [LFM3-VL-2B](https://huggingface.co/LiquidAI/LFM3-VL-2B) | 1.92B total (1.73B LM + 164M vision encoder + 25M projector); contexto 128K | Texto + imagens + vídeo → texto | Video input a 2 fps, 4–768 frames default card; raciocínio visual/spatial; **não recomendado pelo autor para coding, multi-turn conversational use ou complex reasoning**. Não é OCR estruturado garantido; avalie tela e texto pequeno. | HF Transformers >=5.21, GGUF + mmproj para llama.cpp b11960+ (per card), ONNX, MLX (Apple), vLLM/SGLang para GPU. |
| [LFM3-Audio-2B](https://huggingface.co/LiquidAI/LFM3-Audio-2B) | 2B; 32K | Texto ou áudio 16 kHz → texto, speech 24 kHz, texto+speech intercalados | ASR, TTS, tradução entre 18 idiomas; streaming causal; audio understanding/tool calls. Textual voice chat/LiveASR documentado como English-only. Portuguese consta entre speech languages; Brazilian locale/voz pt-BR **não confirmado**. | HF Transformers >=5.20.2 + PyTorch/codec dependencies; GGUF + llama.cpp; ONNX repo divulgado; atenção às implementações e support parity. |
| [LFM3-Omni-2B](https://huggingface.co/LiquidAI/LFM3-Omni-2B) | 2.17B; 32K | Texto + imagem + vídeo (+ áudio soundtrack) + áudio 16 kHz → texto, fala 24 kHz, interleaved | VQA, audio reasoning, ASR/TTS, spoken tool calls; multimodal video+sound. Card diz **non-reasoning**, `enable_thinking=True` não suportado. Áudio/video default frames/seconds e locale precisam seguir pre/postprocessor. | Transformers >=5.20.2; GGUF com llama.cpp; Liquid docs listam GGUF/MLX; server realtime de speech em llama.cpp descrito no card. |
| [d1-2B](https://huggingface.co/LiquidAI/d1-2B) | aproximadamente 2B; consultar card revisionada | Texto/imagem/vídeo → decisão estruturada/calibrada | Saídas tipo yes/no, choice, score, point, read/estimate/pick conforme família d1; não usar como conversa geral. | Docs do fornecedor/HF; formato local varia por checkpoint. |
| [d1-Omni-2B](https://huggingface.co/LiquidAI/d1-Omni-2B) | aproximadamente 2B | texto/imagem/vídeo/áudio → decisões calibradas | Decisão multimodal, não agente/personagem de conversação. Casos e schema específicos exigem teste. | HF; formatos de execução/model card a validar para a revisão escolhida. |

**Importante sobre diferenças de versões:** páginas/cards da família atualizados em torno da data de consulta podem divergir de posts resumidos (context window, vídeo frames, capacidade de reasoning, idioma). Fixar `revision`/commit de cada card e revisar README, config, processor/tokenizer e LICENSE no arquivo baixado. Esta avaliação usa a página oficial consultada; futuras revisões devem atualizar a matriz.

## Idiomas, áudio e pt-BR

- **Fato do card Audio:** lista Portuguese dentre 18 idiomas/regiões de speech; model card separa “voice chat” em inglês apenas e “multilingual speech” em 18 idiomas. LiveASR em chunks de cerca de 0.96 s é explicitamente English-only no trecho consultado.
- **Fato do card Omni:** texto inclui Portuguese; speech languages inclui Portuguese, mas não especifica voz/locale Brazilian Portuguese na tabela.
- **Não confirmado:** WER/CER em pt-BR, sotaques do Brasil, pontuação, entidades/números, robustez a ruído, separação de locutores, turn detection, VAD e naturalidade de voz. Não inferir pt-BR nativo de “Portuguese”.
- **Protocolo de validação:** set pt-BR com consentimento/licença e consentimento de voz; sotaques diversos, microfone/headset, ruído ambiente e TV; auditar WER/CER, latência de first text/audio, audio chunks e taxa de interrupção. TTS avaliação humana cega de inteligibilidade, pronúncia, prosódia, consistência, emoção e clipping.

## Tool calling, streaming, percepção e geração

- **Tool calls:** blog da Liquid diz Audio permite fala → tool call; model cards e docs devem ser usados para extrair schema/template atual. Isso é geração de uma solicitação de ferramenta, não autorização ou execução. Lia valida nome/argumentos e permissão local e pede confirmação conforme política; nunca confia na fala/modelo para conceder acesso.
- **Streaming:** Audio tem encoder causal, incremental prefill e streaming speech; Omni fala/texto intercalados e codec. API de geração local na rota llama.cpp pode ter streaming de tokens, porém comportamento de audio chunks/realtime deve ser validado separadamente; card descreve realtime speech server, não promete barge-in natural pronto para Electron.
- **Visão/vídeo:** VL e Omni aceitam frame/image inputs. Card VL sampling 2 fps e resolução nativa pode aumentar tokens e custo; não é contínuo screen perception automático. Capture da Lia precisa de consentimento e limite de área/frames.
- **TTS/STT:** Audio/Omni podem reduzir modelos e codepaths, mas sem demonstração de melhor qualidade que um STT especializado + TTS local e sem controle de VAD/full-duplex garantido.
- **Imagem/voz gerada:** não é gerador de imagem/vídeo; recebe vision/video e responde em texto/voz. Não substituir diffusion/video generation.

## Licença, redistribuição, comercial e proveniência

- **Fato conferido no LICENSE oficial:** [LFM Open License v1.0](https://huggingface.co/LiquidAI/LFM3-1.7B/blob/main/LICENSE) permite copiar, modificar, derivar, redistribuir e sublicenciar conforme condições de avisos/licença. Define Threshold como receita anual de US$10,000,000 ou mais; direitos para Commercial Use estão condicionados a You/Legal Entity não exceder threshold; Commercial Use quando a entidade excede o limiar **não está licenciado neste acordo**. Legal Entity agrega entidades sob controle comum. Não descrever como licença permissiva OSI/MIT/Apache.
- **Distribuição:** redistribuição é possível apenas satisfazendo condições no License, incluindo anexar licença, avisos de alterações, copyright/patent/trademark/attribution notices aplicáveis e NOTICE quando requerido. Confirmar mesma license no repo de cada variante/modelo antes de redistribuir; pedido de licença empresarial para distribuidor acima do threshold antes da integração comercial.
- **Pesos vs código:** o runtime llama.cpp/Transformers tem licença própria; licença de weights é LFM Open License. Conversão GGUF/ONNX não apaga a licença do modelo. Adapters, voices, processor code, datasets e dependencies exigem inventário próprio.
- **Hugging Face remote custom code:** examples usam `trust_remote_code=True`. Baixar e executar Python do repo remoto é execução de código; pin de commit, inspeção do código, hash do artefato, sandbox, sem tokens/secrets no processo, atualizar SBOM. Preferir format/runtimes sem código remoto se equivalência funcional comprovada.
- **Model endpoints:** Liquid API/Playground são serviço separado, com termos, cobrança, retenção e disponibilidade próprios; não confundir open weights com API livre/ilimitada. Preço/quotas devem ser consultados antes de UX/custo.

## Requisitos de hardware e viabilidade RX 580

**Não há footprint/benchmark do LFM3 em RX 580 Windows verificado.** 2B parâmetros não equivale a 1 GB total resident memory. O Q4 quantizado do text model pode ter ordem de 1 GB weights como estimativa de tamanho teórico e documentação secundária/provedor, mas runtime, KV cache, activations, multimodal encoders/projector/audio codec, contexts e staging buffers aumentam RAM/VRAM. Para VL/Audio/Omni, medir todos os artefatos auxiliares; 8 GB VRAM não significa que modelo+contexto+Stage simultaneamente caibam.

- **LFM3 text:** candidato mais realista para local CPU ou Vulkan; 1.7B Q4 é relativamente modesto; velocidade qualitativa ainda depende de RX 580 bandwidth/FP16/int8 kernel. llama.cpp oficial lista Vulkan; run on device via GGUF. Se excede VRAM, CPU offload/hybrid pode funcionar, com penalidade não determinada.
- **VL:** LFM3-VL GGUF needs language GGUF + `mmproj` file and image processing; VRAM context/video frames can overwhelm; test still images first, then video with short clip/low frame count.
- **Audio/Omni:** audio tokenization/codecs and audio encoder add memory/cpu; no standard `ggml` result on RX580 currently in this review; model card’s GGUF support indicates route available, not a validated realtime RX580 route. Use Windows CPU fallback if backend or operator unsupported.
- **CUDA:** no on RX580 (AMD). Future NVIDIA machines can use llama.cpp CUDA/vLLM, etc., but should be optional backend.
- **ROCm/HIP:** ROCm current supported hardware lists do not include consumer RX580 Polaris gfx803 for supported ROCm Windows stack (official Radeon matrix focuses newer Radeon RX9000 and select RX7000). GFX803 references in ROCm docs for MI6/MI8 products are not proof of RX580 support. Treat ROCm RX580 as unsupported/experimental for product, not recommend.
- **Vulkan:** llama.cpp officially documents Vulkan build and supported backend. Community tests exist for RX580, but they are anecdotal and differ in OS, model, drivers and quant. Best test candidate, not guarantee.
- **DirectML/WinML:** DirectML EP accepts GCN first-generation and DirectX 12 GPU per ONNX Runtime docs, so RX580 may be enumerated. DirectML is in sustained engineering; Microsoft recommends Windows ML for new ONNX integrations. Model support depends on ONNX export/operators. This says nothing about generative model decoder performance or LFM3 model support.

## Unificado (Omni) vs modular architecture

| Aspect | LFM3 Omni as one model | Separate LLM + STT + TTS + VLM |
|---|---|---|
| User config | Simple: one “voice+vision model” option | Fine-grained options/choice and capability fallback |
| Runtime overhead | Avoids separate models loaded simultaneously in theory; still includes multimodal components in one checkpoint | Potentially smaller active components; independent downloads and process lifecycle |
| Resource isolation | One workload may use all modalities; hard to shed a submodule | Can stop/defer VLM/TTS or use external service for one capacity |
| Capability fit | Unified context, cross-modal question, one model interface; actual behavior varies | Can choose best Portuguese STT, lowest latency TTS and strongest chat separately |
| Failure mode | One model/backend failure removes several capacities | Degraded operation possible; more adapters/lifecycle complexity |
| Privacy/cost | Can be wholly local if supported; external endpoint could remain one request | Different modality may be sent to different vendors; explicit privacy per capacity required |
| Licensing | LFM Open License, all variants individually check | Mixed terms; more license inventory |

**Recommendation:** expose unified model as convenience preset, not an opaque replacement for STT/TTS/VLM selectors. In UI show capabilities and language/local latency. Allow composite plan (Audio model ASR/TTS + separate chat LLM) and route per capability. Never activate voice/screen before opt-in.

## Recommendation

**A — RECOMMENDED FOR PRACTICAL EVALUATION:** LFM3-1.7B GGUF on llama.cpp in Windows Vulkan and CPU, compare against an Apache/MIT model and chosen external API. Assess PT-BR tool use, output schema, stop/cancel/streaming, initial token latency, tokens/s, memory, logs.

**B — PROMISING:** LFM3-Audio-2B for PT speech ASR/TTS and incremental output. First do CPU/GPU smoke and language quality/voice review. LFM3-VL-2B for occasional screenshot/image understanding (not continuous screen); test one-frame + optional multi-frame video. LFM3-Omni-2B end-to-end POC only after comparing local memory and responsiveness against modular architecture.

**C — EXPERIMENTAL:** d1 decision models, because their typed decision promise may offer a small classifier role but no independent measurement on Lia tasks; don't use to authorize tools.

**D — NOT RECOMMENDED:** treating all LFM3 checkpoints as equivalent; deploy Omni everywhere without memory/latency/language tests; rely on full 32K/128K/256K context by default; ship before license threshold analysis; assume built-in voice has PT-BR accent, continuous full-duplex or safe tool execution.

## Reproducible POC matrix (not run)

1. Pin model card commit, model/processor hashes and exact GGUF revision/quants; use HF authenticated? Avoid credentials if public; inspect remote code.
2. Test local llama.cpp GGUF with CPU and Vulkan on Win11 RX580, no ROCm/CUDA; system driver untouched. Record backend build, GPU name/device, VRAM baseline and system RAM baseline.
3. Models: 1.7B text Q4_K_M + Q8_0 if VRAM allows; VL Q4_0 with separate mmproj and fixed 1 image; Audio Q4 variant; Omni only after memory safe. Quant names availability must be checked per repo.
4. Context lengths 2K/4K/8K; do not start at advertised max; concurrency one; unload between runs. Measure cold/warm load; first output; steady output; memory peak/resident; GPU utilization/temp; 10–20 minute soak.
5. Tasks: pt-BR chat/persona (not factual claim), tools with synthetic allowlisted tools; Portuguese OCR/screen small text; PT-BR clean/noisy ASR; PT speech synthesis human check; audio/image question. Save redacted prompts/fixtures with consent.
6. Control experiment: same prompt/settings on pure CPU and Vulkan; optional remote provider with synthetic non-sensitive tasks; no claim remote comparison is like-for-like.
7. Report BPE/tokenizer-specific counts, WER/CER, first-token/first-audio latency, quality rubric, timeouts, unsupported ops, model download size and restart after process kill.

## Official sources and date

- [Liquid AI LFM3 blog](https://www.liquid.ai/blog/lfm3) and [Hugging Face launch article](https://huggingface.co/blog/LiquidAI/lfm3), queried 14/11/2026.
- Model cards: [LFM3-1.7B](https://huggingface.co/LiquidAI/LFM3-1.7B), [Base](https://huggingface.co/LiquidAI/LFM3-1.7B-Base), [VL-2B](https://huggingface.co/LiquidAI/LFM3-VL-2B), [Audio-2B](https://huggingface.co/LiquidAI/LFM3-Audio-2B), [Omni-2B](https://huggingface.co/LiquidAI/LFM3-Omni-2B), [d1 collection](https://huggingface.co/collections/LiquidAI/lfm3).
- [License text](https://huggingface.co/LiquidAI/LFM3-1.7B/blob/main/LICENSE).
- [Liquid docs: llama.cpp local](https://docs.liquid.ai/deployment/on-device/llama-cpp), [Windows Llama desktop](https://docs.liquid.ai/deployment/on-device/llama), [ONNX](https://docs.liquid.ai/deployment/on-device/onnx), [model library](https://docs.liquid.ai/lfm/models/complete-library).
- [llama.cpp Windows Vulkan build](https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md); [AMD ROCm Radeon support](https://rocm.docs.amd.com/projects/radeon-ryzen/en/latest/); [ONNX Runtime DirectML](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html); [Windows ML deployment](https://onnxruntime.ai/docs/get-started/with-windows.html).

**Limitações:** pages and weights may change; no model downloaded/tested, no hardware available; the HF model cards are authoritative for official claims but vendor benchmarks have not been independently reproduced. Commercial licence interpretation requires legal/product review. Compatibility is per backend/export/operator, not per filename.
