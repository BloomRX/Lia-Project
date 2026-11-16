# Compatibilidade de modelos e runtimes: Windows 11 + AMD RX 580

**Consulta:** 14/11/2026. **Alvo:** Windows 11 x64, AMD Radeon RX 580 8 GB (Polaris/GCN4, gfx803), Ryzen 5 5500, RAM 16 GB. **Estado:** documental; NENHUM benchmark foi executado e nenhum driver/configuração foi alterado.

## Resumo de compatibilidade

- **CPU x86-64:** caminho de fallback mais universal. Deve ser tratado como baseline obrigatório; throughput de modelos médios pode ser baixo, e CPU compartilha os 16 GB com OS, Stage e KV cache.
- **Vulkan:** primeira opção prática para testar GPU RX 580 com `llama.cpp` e ggml-oriented runtimes. O upstream documenta Vulkan backend e build Windows. Compatibilidade oficial do backend não é benchmark oficial de RX 580; referências RX580 são principalmente relatos comunitários.
- **ROCm/HIP:** **não suportado oficialmente para RX580/GFX803 no Windows** conforme listas atuais de Radeon support. Uma referência gfx803 em MI6/MI8 (hardware distinto) não valida RX580. Workarounds de Linux/containers/env overrides são experimentais e não devem ser base de produto.
- **DirectML:** ONNX Runtime documenta AMD GCN1+/DX12 device support, o que inclui nível arquitetural do RX580, mas execution provider está em sustained engineering e limitações operator/session importam. Para projetos novos, Microsoft recomenda WinML. Compatibilidade de um ONNX export específico é desconhecida até executar smoke test.
- **CUDA:** indisponível no equipamento AMD. Futuras máquinas NVIDIA podem usar CUDA como backend selecionável, nunca requisito estrutural.
- **VLM/áudio/geração de imagem/vídeo:** consumo inclui componentes auxiliares, contexto, codec/encoder e buffers. 8 GB VRAM não garante que todos caibam; não adotar alegações de “2B fits” sem medição de peak VRAM + Stage.

## Matriz de backends/runtime

| Backend/runtime | Situação no RX580/Windows | Tipo de evidência | Recomendação |
|---|---|---|---|
| CPU (x86-64, quantizado) | Compatibilidade provável para modelos que fornecem CPU kernels; RAM 16GB limita concorrência/context. | Inferência de software geral; por modelo testar instructions/runtime. | Baseline sempre disponível; manter thread cap/priority e fallback graceful. |
| llama.cpp Vulkan | Windows build é oficialmente documentado; backend suporta Vulkan GPUs. RX580 reports de comunidade indicam detecção, mas não testados aqui. | Fato: llama.cpp documenta build Windows/Vulkan. Hipótese: execução em RX580 depende de driver Vulkan/runtime/quant e kernel. | **P0 para benchmark** de text GGUF; audio/VL conforme suporta checkpoint. |
| llama.cpp HIP/ROCm | Não considerar suportado para RX580 no Windows; ROCm Radeon Windows matrix atual foca gerações mais recentes. | AMD official support matrix omite RX580; report não oficial de community não substitui suporte. | Não depender. Apenas laboratório separado em Linux, não no alvo beta. |
| ONNX Runtime + DirectML EP | API pode usar DirectX 12; docs mencionam AMD GCN first gen e RX580 architecture family. DirectML sustained engineering; limitations on opset/operators and parallel calls. | Fato da documentação ONNX Runtime; model-specific success **não comprovado**. | Só modelo ONNX export validado, serial execution + CPU fallback. Não primeiro alvo de LLM multimodal. |
| Windows ML (ONNX Runtime ecosystem) | Windows 11 supported; dynamically selects EPs. DirectML route supports DX12 hardware; may depend on packages/runtime version. | Microsoft/ONNX official docs. | Considerar para ONNX image/audio helper workloads; API/version/binary footprint integration must be weighed. |
| PyTorch CUDA | CUDA-only wheels cannot run AMD GPU. | NVIDIA-specific backend fact. | Não usar em RX580. CPU path possible if model/pkgs. |
| PyTorch ROCm | Official support matrix not include RX580 Windows. | AMD official support pages. | Descartar para reference test. |
| OpenVINO | Primary optimized paths for Intel CPUs/GPUs; no basis to promise RX580 GPU. | Vendor/project docs needed per model; no tested RX path. | Ignore for AMD GPU; CPU backend may be comparative but extra runtime cost. |
| MLX | Apple Silicon specific. | Official Apple/MLX target. | Not for Windows/RX580. |
| vLLM / SGLang | GPU server stacks primarily CUDA/HIP-supported environments; RX580 on Windows not an assumed deployment. | Per-project hardware support. | Not a reference-device target unless official gfx803/Windows support is confirmed at test date. |

## ROCm, Vulkan e DirectML em detalhe

### ROCm/HIP
AMD public compatibility documentation targets current supported Radeon series and supported OS/framework combinations. Current product stack documents Radeon RX 9000 and selected RX 7000, with Windows PyTorch support for those listed GPUs. It does not provide a supported RX 580 gfx803 Windows path. Some old docs list gfx803 for MI6/MI8 accelerator products; that is not the same as validating consumer Polaris RX580. Unofficial `HSA_OVERRIDE_GFX_VERSION`/container instructions should be marked experimental and excluded from user installation flows.

### Vulkan
`ggml-org/llama.cpp` describes Vulkan backend and gives Windows Vulkan build steps. This is an attractive vendor-neutral compute path because AMD Adrenalin drivers expose Vulkan for RX580. However, “Vulkan device detected” only proves enumeration, not correct/fast model kernels. Verify `fp16`, integer dot support, supported operators, memory allocation, stability, shader cache, driver resets, and CPU fallback. Large context and simultaneous Stage rendering may compete for VRAM bandwidth and cause stutter.

### DirectML / WinML
ONNX Runtime DirectML EP docs say DirectML supports GCN first-generation-and-above GPUs. The same official doc states DirectML is in sustained engineering, uses constraints (e.g. memory pattern disabled, execution mode sequential, no concurrent Run calls on same session) and operator/opset support caps. Microsoft/ORT recommends Windows ML for new Windows inference: in-box/redistributable ONNX runtime can select execution providers, but Windows ML model/runtime packaging, dynamic EP downloads, API and min OS need review. Neither broad DirectX 12 support nor an ONNX graph means a given model is accelerated efficiently; unsupported ops may fall back to CPU or fail. Track EP placement per graph node and test exact export.

## Model compatibility candidate matrix

All resource estimates are qualitative unless stated. File size/parameter count is not peak working set. Quantized model files do not include all runtime workspaces, KV cache, tokenizer/vision/audio assets, shader buffers or app overhead.

| Capability/model candidate | Reference path | Hardware suitability (estimate) | Expected trouble / classification |
|---|---|---|---|
| LFM3-1.7B text GGUF Q4 | llama.cpp CPU, Vulkan | Best first LLM POC; 8GB card likely has room for small quant model plus modest context, subject to actual graph/KV and renderer. | **Not tested**; prioritize. |
| LFM3-VL-2B GGUF Q4 + mmproj | llama.cpp Vulkan/CPU | Still-image POC potentially plausible; video/many frames increases vision tokens/latency/VRAM. | Multimodal exporter and sampler specifics; **not tested**. |
| LFM3-Audio-2B GGUF | llama.cpp CPU/Vulkan if checkpoint path works | Audio codec/encoder add memory and sustained compute; do not promise realtime on RX580. | PT-BR exact voice/ASR and streaming are unknown; **not tested**. |
| LFM3-Omni-2B GGUF | llama.cpp CPU/Vulkan | Most demanding because text+vision+audio components; one model may still consume more than separately active path. | Do not load by default. POC only after smaller models; **not tested**. |
| Qwen3 0.6–4B / Gemma small | llama.cpp GGUF Vulkan/CPU, variant specific | Good comparison baseline; test exact GGUF/chat template/tool format/weight license. | Model support/card revisions differ; no blanket “works”. |
| Whisper small/base via whisper.cpp | native CPU/Vulkan/other backends per upstream | Plausible with CPU and may test GPU; audio processing competes with real-time avatar/game. | Set-specific PT-BR WER and latency unknown. |
| Kokoro TTS 82M | ONNX/PyTorch runtime, C# options; CPU first | Weight size modest versus large speech models; CPU likely acceptable candidate, but throughput/voice quality on Ryzen unmeasured. | Licensing/assets/runtime packaging and pt-BR voice choice; **benchmark**. |
| Silero VAD | CPU/ONNX | Very small compared with ASR; most plausible always-on local model. | False positives, mic policy, ONNX integration; CPU use unmeasured in Lia. |
| PaddleOCR | C++/Paddle/ONNX options, CPU/DirectML dependent | Document/screen OCR can be CPU or supported backend; screen crop is better than whole desktop. | Model architecture and ops support must be validated; avoid giant document parsing stack for basic overlay text. |
| BGE/Qwen embeddings 0.6B | CPU/ONNX or GPU if graph permits | Embedding on demand (not always-on) feasible; could batch background. | Only add if current lexical memory recall proves inadequate. |
| Stable Diffusion.cpp / FLUX | C++ CPU/Vulkan | SD1.5-class image generation could fit but is slow on RX580; modern models may exceed VRAM/time. | Screen/game latency and large downloads; optional feature, not always resident. |
| Wan/video diffusion (5B/14B) | GPU/CPU stacks vary | Not credible as interactive RX580 capability; CPU-only likely impractical. | D for default bundle; optional cloud or advanced lab only; license varies by checkpoint. |

## Model and package selection constraints

- Check `safetensors`/GGUF/ONNX source repository and exact revision; verify hash, file size, signer/provenance where available. Never execute arbitrary `.py` from HF with `trust_remote_code` without source review.
- Separate model registry from backend: `format` and `backend support` are independent facts. A model can have GGUF yet only some features (audio decoding/tool schema) work in llama.cpp.
- Keep CPU fallback if validated quality/latency viable; allow user to choose device and resource budget; do not silently switch to cloud.
- Downloads user-initiated, resume/space estimate/checksum, atomic completion, uninstall all artifacts including cache. Avoid automatic downloading every modality on installer run.

## Reproducible test plan (NOT RUN)

### Pre-flight

Record GPU exact PCI/device name + VRAM, `gfx` expected only diagnostic, AMD driver version, Vulkan API/driver version (`vulkaninfo`/equivalent), Windows build, BIOS/system memory, CPU model, disk type/free space, monitor resolution/refresh, game title/version. Confirm GPU is RX580, not virtual adapter. No driver changes or registry tweaks. Freeze model/runtime commit, quantization hash, test prompts, power plan and runtime flags.

### Cases

1. **Idle baseline:** OS+Launcher idle 10 min; record RAM, CPU, GPU VRAM, power/temperature where available.
2. **Stage baseline:** visible and hidden/occluded, avatar idle/animated, multi-monitor; measure p50/p95 frame time and process private bytes.
3. **LLM:** CPU versus Vulkan, same GGUF quant/context, load time, first-token time, decode tokens/sec, max RSS/VRAM, tool-call schema validity, 30-min soak and unload.
4. **STT/TTS:** fixed licensed PT-BR corpus (clean/noisy), VAD on/off; WER/CER, real-time factor, first-audio latency, CPU peak, interruption; human TTS quality rubric.
5. **Vision:** still image and cropped desktop target; OCR character error, object/question quality, input frame count/resolution, time/memory. Video test only after still image passes, fixed fps/duration.
6. **Concurrent:** game in fixed repeatable scene, Lia Stage visible; compare local inference vs idle vs remote chosen voluntarily. Log game frame time/1% lows and dropped frames, but do not infer causation unless repeatable paired runs.
7. **Stability:** 2h session with audio/Stage/game on controlled test machine, driver reset, model unload, sleep/wake; no silent requests or data persisted beyond consent.

### Report template

`model ID/revision/hash | task | runtime version/build/backend | driver/API | precision/quant | ctx/batch/threads/offload | warm/cold | TTFT/p50/p95 | tok/s or RTF | RSS peak | VRAM peak | GPU/CPU util | task quality | failure/fallback | test fixture provenance | status (PASS/FAIL/BLOCKED/NOT RUN)`.

## Priority and caveats

- **A:** llama.cpp + Vulkan for text GGUF evaluation (supported Vulkan backend; exact RX580 behavior still POC); CPU fallback; Kokoro/Whisper/VAD benchmark as modality-specific paths.
- **B:** DirectML/WinML for ONNX-specific OCR/image models; validate exact graph, not generic GPU badge.
- **C:** gfx803 ROCm/HIP workarounds, community-built wheels, unofficial wrappers; lab only.
- **D:** CUDA as requirement on AMD; ROCm as supported on RX580; web claims of fixed tokens/s/images/sec treated as facts for Lia.

## Official sources consulted

- [AMD ROCm Radeon/Ryzen compatibility](https://rocm.docs.amd.com/projects/radeon-ryzen/en/latest/) · [AMD ROCm GPU arch specs](https://rocm.docs.amd.com/en/docs-7.0.0/reference/gpu-arch-specs.html) · [HIP SDK Windows requirements](https://rocm.docs.amd.com/projects/install-on-windows/en/latest/).
- [llama.cpp repo](https://github.com/ggml-org/llama.cpp) · [Windows Vulkan build docs](https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md).
- [ONNX Runtime DirectML EP](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html) · [Windows install/WinML](https://onnxruntime.ai/docs/get-started/with-windows.html) · [Microsoft DirectML overview](https://learn.microsoft.com/en-us/windows/ai/directml/dml).
- [Microsoft Windows ML FAQ](https://learn.microsoft.com/en-us/windows/ai/faq) · [WinML deployment](https://learn.microsoft.com/en-us/windows/ai/new-windows-ml/distributing-your-app).
- [LFM3 official cards](https://huggingface.co/collections/LiquidAI/lfm3) and [Kokoro official repo](https://github.com/hexgrad/kokoro).

**No test was run.** Support labels refer to upstream docs; do not turn them into a performance guarantee, validated app support, or endorsement of experimental unofficial setup instructions.
