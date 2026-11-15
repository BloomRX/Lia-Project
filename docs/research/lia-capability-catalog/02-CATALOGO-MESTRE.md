# 2. Catálogo mestre — modelos, pesos, runtimes e provedores

**Data da pesquisa:** 11/11/2026 · **Base:** `29999aff`

> **Revisão 2 (11/11/2026).** Correções verificadas em `06-ERRATA-E-REVISAO.md`:
> Fish Audio em três camadas, F5-TTS confirmado, Qwen3.5-4B *instruct* vs `-Base`,
> tamanhos reais dos GGUF do Qwen3.8-27B, vozes PT do Kokoro e o enquadramento da
> AGPL do VoiceStudio.
>
> **Como ler as tabelas.** `licença` é sempre a **do repositório/pesos indicado**,
> não "do projeto em geral". Onde a licença do código e a dos pesos divergem, as
> duas aparecem. `?` significa **não confirmado nesta pesquisa** — não é "sim".
> Nenhum item foi baixado, instalado ou executado.
>
> **Regra de hardware (estimativa, não medição):** VRAM ≈ `parâmetros × bytes por
> parâmetro + KV cache`. BF16/FP16 = 2 B/param; Q8 ≈ 1 B; Q4 ≈ 0,5–0,6 B. Some
> 20–40 % para contexto longo e runtime. Isso é aritmética, não benchmark.

---

## A. Modelos de linguagem e raciocínio

### A.1 Famílias abertas principais

| Modelo | Lançamento | Params | Contexto | Licença (pesos) | Runtime | Link |
|---|---|---|---|---|---|---|
| **Qwen3.5-0.8B / 2B / 4B / 9B** *instruct* | fev/2026 | 0,8–9 B dense | ver model card | Apache-2.0 | llama.cpp, ORT, MLX | [HF](https://huggingface.co/Qwen/Qwen3.5-9B) |
| **Qwen3.5-4B-Base** *pré-treinado* | fev/2026 | 4 B dense | ver model card | Apache-2.0 | llama.cpp | [HF](https://huggingface.co/Qwen/Qwen3.5-4B-Base) |
| **Qwen3.5-27B** | fev/2026 | 27 B dense | ver model card | Apache-2.0 | llama.cpp, vLLM | [HF](https://huggingface.co/Qwen/Qwen3.5-27B) |
| **Qwen3.5-35B-A3B** | fev/2026 | 35 B / 3 B ativos | ver model card | Apache-2.0 | llama.cpp, vLLM | [HF](https://huggingface.co/Qwen/Qwen3.5-35B-A3B) |
| **Qwen3.5-122B-A10B / 397B-A17B** | fev/2026 | MoE | ver model card | Apache-2.0 | vLLM, SGLang | [HF](https://huggingface.co/Qwen/Qwen3.5-397B-A17B) |
| **Qwen3.8-27B** | ago/2026 | 27 B dense | ver model card | Apache-2.0 | llama.cpp (GGUF oficial) | [HF](https://huggingface.co/Qwen/Qwen3.8-27B) |

> **Pesos reais do Qwen3.8-27B** (`unsloth/Qwen3.8-27B-GGUF`, tamanho de arquivo,
> 11/11/2026): `UD-Q4_K_S` **15,36 GB** · `Q4_0` **16,06 GB** · `UD-Q4_K_M`
> **16,56 GB** · `Q8_0` **29,05 GB** · `UD-IQ2_XXS` **7,21 GB**. Nada disso cabe
> em 8 GB de VRAM: Q4 exige *offload* parcial, com perda forte de velocidade.


| **Qwen3-0.6B / 1.7B / 4B / 8B / 14B / 32B** | abr/2025 | dense | 32K nativo (128K com YaRN, 8B+) | Apache-2.0 | tudo | [HF](https://huggingface.co/Qwen/Qwen3-8B) |
| **Qwen3-30B-A3B / 235B-A22B** | abr/2025 | MoE | 128K+ | Apache-2.0 | vLLM, llama.cpp | — |
| **Gemma 3 270M / 1B** | mar/2025 | 0,27–1 B | 32K | Gemma License (gated) | llama.cpp, ORT | [HF](https://huggingface.co/google/gemma-3-27b-it) |
| **Gemma 3 4B / 12B / 27B** | mar/2025 | dense | 128K | Gemma License (gated) | llama.cpp, vLLM | idem |
| **Llama 4 Scout** | abr/2025 | 109 B / 17 B ativos, 16 experts | 10 M (declarado) | Llama 4 Community | vLLM, llama.cpp parcial | [HF](https://huggingface.co/meta-llama/Llama-4-Scout-17B-16E-Instruct) |
| **Llama 4 Maverick** | abr/2025 | 400 B / 17 B ativos, 128 experts | 1 M | Llama 4 Community | vLLM (multi-GPU) | [HF](https://huggingface.co/meta-llama/Llama-4-Maverick-17B-128E-Instruct) |
| **DeepSeek-V3 / R1** | 2024–2025 | 671 B / 37 B ativos | 128K | MIT (V3) | vLLM, SGLang | [GitHub](https://github.com/deepseek-ai/DeepSeek-V3) |
| **GLM-4 / GLM-4.5** | 2024–2025 | 9 B–355 B | 128K | Apache-2.0 (GLM-4-9B) | vLLM | [GitHub](https://github.com/zai-org/GLM-4) |
| **Kimi K2** | 2025 | 1 T / 32 B ativos | 256K | Modified MIT | vLLM | [GitHub](https://github.com/MoonshotAI/Kimi-K2) |

> **Sobre contexto:** o único valor confirmado no model card nesta pesquisa foi
> o do **Qwen3-8B** (32 768 nativo, 131 072 com YaRN). Os demais estão marcados
> como *ver model card* — não foram confirmados e não devem ser exibidos ao
> usuário como número.

**Qwen3.5/3.8 são nativamente multimodais** (`image-text-to-text` no model card)
— isso muda a decisão da categoria C: para muitas tarefas de visão, não é
preciso um VLM separado.

### A.2 Pequenos e rápidos (o que roda no parque instalado)

| Modelo | Params | Papel | Licença | Nota |
|---|---|---|---|---|
| Qwen3.5-0.8B | 0,8 B | roteador, classificação, extração | Apache-2.0 | cabe em CPU |
| Gemma 3 270M | 0,27 B | classificação, moderação leve | Gemma | ~300–600 MB em Q4 |
| Qwen3-0.6B | 0,6 B | idem | Apache-2.0 | maduro, muito quantizado |
| SmolLM3-3B | 3 B | conversa curta local | Apache-2.0 | bom em CPU |
| Phi-4-mini | 3,8 B | raciocínio curto | MIT | forte em matemática para o tamanho |
| Qwen3.5-4B | 4 B | assistente local padrão | Apache-2.0 | **melhor relação qualidade/tamanho da família** |

### A.3 Português brasileiro

| Modelo | Base | Licença | Situação |
|---|---|---|---|
| **Sabiá-7B** (Maritaca) | Mistral-7B | Apache-2.0 (código) / uso dos pesos **verificar** | treinado em PT-BR; pesos no HF |
| **Tucano-2B/7B** (PoetiCA) | — | **verificar** | série aberta em português |
| **Amália-7B/9B** | — | **verificar** (projeto português, PT-PT) | European Portuguese, não BR |
| **Gervásio-1.2B/3B** | — | **verificar** | PT-BR, pequeno |
| **Bode-7B** | — | **verificar** | alinhamento em PT-BR |

> **Achado honesto:** nenhum modelo aberto em português tem hoje a combinação
> "licença clara + qualidade competitiva + manutenção ativa" verificada nesta
> pesquisa. **Qwen3.5 e Gemma 3 declaram suporte multilíngue forte** e são a
> aposta de menor risco para PT-BR; os modelos nativos ficam como
> *experimentais* até teste próprio de qualidade em português.

### A.4 Saídas estruturadas

Não é modelo, é camada: **Outlines** (Apache-2.0), **Instructor** (MIT),
**guidance**, **XGrammar** (usado por vLLM/SGLang). A Lia deve validar JSON no
adapter, não confiar no modelo.

### A.5 Classificação da categoria A

| Item | Classe | Por quê |
|---|---|---|
| Qwen3.5-4B / 9B | **Recomendado** | Apache-2.0, multimodal nativo, GGUF oficial, tamanho viável |
| Qwen3.5-27B / Qwen3.8-27B | **Recomendado** (GPU ≥ 24 GB) | melhor denso aberto da geração |
| Gemma 3 12B / 27B | **Promissor** | licença gated, mas ecossistema enorme |
| Qwen3-30B-A3B | **Promissor** | MoE eficiente; exige RAM, não VRAM proporcional |
| Llama 4 Scout | **Experimental** | 109 B para rodar local; licença com cláusula de 700 M MAU |
| DeepSeek-V3/R1 | **Promissor (servidor)** | MIT, mas 671 B — não é desktop |
| Modelos PT-BR nativos | **Licença pendente** | licença dos pesos não confirmada |

---

## B. Voz

### B.1 TTS — modelos abertos

| Modelo | Params/tam. | Clonagem | Streaming | Licença | Runtime | Link |
|---|---|---|---|---|---|---|
| **Kokoro-82M** | 82 M, ~330 MB | não | sim (chunk) | **Apache-2.0** | ONNX, PyTorch, `kokoro` | [HF](https://huggingface.co/hexgrad/Kokoro-82M) |

> **Kokoro em português:** o repositório tem `voices/pf_dora.pt`, `pm_alex.pt` e
> `pm_santa.pt`, mas o model card declara `language: ["en"]`. Existem vozes PT;
> **a qualidade em PT-BR não foi validada**. `portugueseBr` = `unverified`.


| **Piper** | ~5–60 M por voz | não | sim | MIT | ONNX (C++) | [GitHub](https://github.com/rhasspy/piper) — **arquivado ago/2025** |
| **XTTS-v2** (Coqui) | ~1,8 GB | **sim** (zero-shot) | não nativo | **CPML — não comercial** | PyTorch | [HF](https://huggingface.co/coqui/XTTS-v2) |
| **F5-TTS** | ~1,2 GB | sim | parcial | **código MIT / pesos CC-BY-NC-4.0 (confirmado)** | PyTorch | [GitHub](https://github.com/SWivid/F5-TTS) |
| **CosyVoice 2/3** | 0,5–1,5 B | sim | **sim** | Apache-2.0 | PyTorch, vLLM | [GitHub](https://github.com/FunAudioLLM/CosyVoice) |
| **ChatTTS** | ~1 GB | não | sim | **AGPL-3.0** | PyTorch | [GitHub](https://github.com/2noise/ChatTTS) |
| **GPT-SoVITS** | ~1–2 GB | sim (few-shot) | não | MIT | PyTorch | [GitHub](https://github.com/RVC-Boss/GPT-SoVITS) |
| **VoxCPM** | 0,5 B | sim | sim | Apache-2.0 | PyTorch | [GitHub](https://github.com/OpenBMB/VoxCPM) |
| **MOSS-TTS** | ~1–2 B | sim | ? | Apache-2.0 | PyTorch | [GitHub](https://github.com/OpenMOSS/MOSS-TTS) |
| **Fish Speech (código)** | — | — | — | **Fish Audio Community License v1.0** (13/out/2026) | — | [GitHub](https://github.com/fishaudio/fish-speech) |
| **fish-speech 1.4/1.5, s1-mini** (pesos) | ~1 B | sim | sim | **CC-BY-NC-SA-4.0** | PyTorch | [HF](https://huggingface.co/fishaudio/fish-speech-1.5) |
| **s2-pro / drama-3** (pesos) | — | sim | sim | **Fish Audio Research License — NC, gate com checkbox** | PyTorch | [HF](https://huggingface.co/fishaudio/s2-pro) |
| **VibeVoice** (MS) | 1,5 B / 7 B | multi-falante | sim | MIT | PyTorch | [GitHub](https://github.com/microsoft/VibeVoice) |
| **Dia** (Nari) | 1,6 B | — | — | Apache-2.0 | PyTorch | [GitHub](https://github.com/nari-labs/dia) |

**VoiceStudio** (`debpalash/VoiceStudio`, **AGPL-3.0**, 108 k estrelas,
atualizado 11/11/2026): estúdio local completo — clonagem, *voice design* por
descrição, dublagem de vídeo, transcrição e narração; declara **646 idiomas** e
roda em desktop/mobile/servidor.

> **AGPL não proíbe uso comercial.** Permite cobrar pelo software; a obrigação
> nasce da **distribuição** ou da **modificação**, e a cláusula Affero acrescenta
> a oferta por rede. A decisão depende da forma de integração:
> Lia falando HTTP com um VoiceStudio instalado pelo usuário ≠ Lia embarcando ou
> modificando o código. Classificação: **`integration-dependent`**, não
> "não recomendado".

### B.2 TTS — serviços hospedados

| Serviço | Modalidades | Clonagem | Nota |
|---|---|---|---|
| **ElevenLabs** | TTS, dublagem, voice design | sim | líder de naturalidade; preço por caractere; retenção a verificar |
| **Fish Audio** | TTS, clonagem | sim | API compatível com ElevenLabs em parte |
| **OpenAI TTS** | TTS | não (vozes fixas) | simples, sem clonagem |
| **Google Cloud TTS / Chirp** | TTS, multi-falante | limitada | vozes PT-BR boas |
| **Azure Speech** | TTS + STT + avatar | custom neural voice (aprovação) | PT-BR forte |
| **MiniMax / Cartesia / PlayHT** | TTS | sim | alternativas relevantes |

> **Preços não são reproduzidos aqui** — mudam sem aviso e a pesquisa não os
> verificou em fonte oficial no dia. Consultar a página de preços do provedor e
> registrar a data no ato da integração.

### B.3 STT

| Modelo | Tamanho | Streaming | Idiomas | Licença | Runtime |
|---|---|---|---|---|---|
| **Whisper large-v3 / turbo** | 1,55 B / 809 M | não (janela) | 99 | MIT | faster-whisper, whisper.cpp |
| **faster-whisper** | (CTranslate2) | pseudo | idem | MIT | CPU/GPU, **4–8× mais rápido** que o original |
| **WhisperX** | idem + diarização | não | idem | BSD-2 | alinhamento por palavra + `pyannote` |
| **NVIDIA Parakeet TDT 0.6B** | 0,6 B | sim (NeMo) | EN (v2/v3: +EU) | Apache-2.0 (NeMo) / **CC-BY-4.0 nos pesos (verificar)** | NeMo, ONNX |
| **Moonshine** | 27 M–245 M | sim | EN | **verificar** (repo sem SPDX) | ONNX, C++ |
| **sherpa-onnx** | vários | **sim** | multilíngue | Apache-2.0 | ONNX, C++, **Windows/CPU** |
| **Canary** (NVIDIA) | 1 B | não | 25 EU | CC-BY-4.0 | NeMo |
| **Vosk** | 50 MB–1,5 GB | sim | 20+ | Apache-2.0 | Kaldi, CPU |

> **Português:** Whisper (large-v3/turbo) e sherpa-onnx são os caminhos com
> suporte PT-BR declarado e ecossistema maduro. Parakeet e Moonshine **não têm
> PT-BR confirmado**.

### B.4 Conversação em tempo real (full-duplex)

| Solução | Tipo | Duplex | Pesos | Nota |
|---|---|---|---|---|
| **Qwen3-Omni** | modelo omni (texto/imagem/áudio/vídeo → texto+fala) | streaming | Apache-2.0 | [GitHub](https://github.com/QwenLM/Qwen3-Omni); 30B-A3B e 234B-A22B |
| **Moshi** (Kyutai) | full-duplex nativo | **sim** | Apache-2.0 | [GitHub](https://github.com/kyutai-labs/moshi); referência aberta do gênero |
| **GPT Realtime / Gemini Live** | API | duplex parcial | fechado | latência de rede conta |
| **Shizuku-Duplex** | modelo japonês full-duplex | **sim, tick 80 ms** | **não publicados** | [anúncio](https://shizuku.ai/en/blog/1/) 08/11/2026 |
| **Cascata STT→LLM→TTS** | arquitetura | não | — | o caminho que a Lia já sabe montar |

**Shizuku-Duplex — o que ele ensina (e o que não entrega).** Tick de 80 ms,
escuta enquanto fala, *barge-in* e *backchannels*; dois modelos: um de interação
(loop rápido) e um de fundo (busca/raciocínio), ligados por um token `DELEGATE`;
compactação de contexto a cada ~5 min. Números publicados são **do próprio
laboratório**, com juiz LLM: 0,57 s mediana após fim de turno, QA multi-turno
79 % contra 95 % do GPT-Live. Não há pesos públicos anunciados e o foco é
japonês. **Não é candidato de integração hoje**; é o melhor *design de
referência* para o dia em que a Lia fizer duplex.

**Open-LLM-VTuber** (14,6 k estrelas, licença sem SPDX): referência de
arquitetura para avatar + voz local com interrupção, ASR via sherpa-onnx.
Mesma leitura: referência, não dependência.

### B.5 Classificação da categoria B

| Item | Classe | Motivo |
|---|---|---|
| Kokoro-82M | **Recomendado (já em uso)** | Apache-2.0, 82 M, rápido, PT-BR via espeak/misaki — o que a Lia já tem |
| Piper | **Legado** | arquivado; ótimo para CPU, mas sem manutenção |
| CosyVoice 2 | **Recomendado (clonagem)** | Apache-2.0 + streaming + clonagem, raro |
| VoxCPM / MOSS-TTS | **Promissor** | Apache-2.0, recentes, precisam teste PT-BR |
| GPT-SoVITS | **Promissor** | MIT, clonagem few-shot; pesado para tempo real |
| XTTS-v2 | **Não recomendado** | **CPML proíbe uso comercial** |
| F5-TTS | **Não recomendado (pesos)** | pesos CC-BY-NC-4.0 confirmados; código MIT |
| Fish Speech `s2-pro`/`drama-3` | **Não recomendado (pesos)** | Research License, gate "non-commercial use ONLY" |
| Fish Speech 1.5 / s1-mini | **Não recomendado (pesos)** | CC-BY-NC-SA-4.0 |
| Fish Speech (código) | **Licença dependente** | Community License: comercial sob US$ 500k de receita |
| ChatTTS | **Integration-dependent (AGPL)** | permite uso comercial; obrigação ao distribuir/modificar/oferecer por rede |
| VoiceStudio | **Integration-dependent** | AGPL permite uso comercial; obrigação só ao distribuir/modificar/oferecer por rede |
| faster-whisper | **Recomendado (STT)** | MIT, rápido, PT-BR bom |
| sherpa-onnx | **Recomendado (streaming)** | Apache-2.0, C++, roda em Windows/CPU |
| Parakeet / Moonshine | **Compatibilidade não confirmada** | sem PT-BR confirmado |

---

## C. Visão computacional e compreensão de imagens

### C.1 Visão-linguagem (VLM)

| Modelo | Params | Licença | Força | Link |
|---|---|---|---|---|
| **Qwen3-VL 2B/4B/8B/32B** | 2–32 B | Apache-2.0 | **grounding de UI**, OCR, documento | [GitHub](https://github.com/QwenLM/Qwen3-VL) |
| **Qwen3.5 / 3.8 (nativos)** | 0,8–27 B | Apache-2.0 | multimodal no mesmo peso do chat | [HF](https://huggingface.co/Qwen/Qwen3.5-9B) |
| **Gemma 3 4B/12B/27B** | 4–27 B | Gemma | imagem 896×896, 256 tokens | [HF](https://huggingface.co/google/gemma-3-27b-it) |
| **MiniCPM-V 4** | ~8 B | Apache-2.0 | forte em mobile/edge | [GitHub](https://github.com/OpenBMB/MiniCPM-V) |
| **InternVL 3** | 1–78 B | MIT (repo) / **pesos variam** | líder open em muitos benchmarks | [GitHub](https://github.com/OpenGVLab/InternVL) |
| **Florence-2** | 0,23–0,77 B | MIT | **caption, detecção, grounding em 1 modelo pequeno** | [HF](https://huggingface.co/microsoft/Florence-2-large) |
| **SmolVLM2** | 256 M–2,2 B | Apache-2.0 | vídeo + imagem em edge | [HF](https://huggingface.co/HuggingFaceTB/SmolVLM2-2.2B-Instruct) |

### C.2 Especialistas

| Tarefa | Modelo | Licença | Nota |
|---|---|---|---|
| Detecção de objetos | **YOLO11/12** (Ultralytics) | **AGPL-3.0** | uso comercial exige licença paga |
| Detecção | **RF-DETR** (Roboflow) | Apache-2.0 | alternativa permissiva ao YOLO |
| Detecção aberta | **Grounding DINO** | Apache-2.0 | texto → caixa |
| Segmentação | **SAM 2** | Apache-2.0 | vídeo também |
| OCR | **PaddleOCR** | Apache-2.0 | 80+ idiomas, PT-BR incluso |
| OCR | **Surya** | GPL-3.0 (verificar) | layout + leitura |
| OCR leve | **RapidOCR** (ONNXRuntime) | Apache-2.0 | Windows/CPU |
| Pose | **MediaPipe** | Apache-2.0 | 33 landmarks, tempo real, CPU |
| Profundidade | **Depth Anything V2** | Apache-2.0 (small) | cena/ambiente |

### C.3 Classificação da categoria C

| Item | Classe |
|---|---|
| Qwen3-VL-8B | **Recomendado** — melhor custo/benefício para imagem + UI |
| Qwen3.5-4B/9B (nativo) | **Recomendado** — evita carregar dois modelos |
| Florence-2-large | **Recomendado (leve)** — 0,77 B, faz caption+detecção+grounding |
| Gemma 3 12B | **Promissor** |
| InternVL 3 | **Licença pendente** (pesos variam por tamanho) |
| YOLO | **Não recomendado sem licença** (AGPL) |
| RF-DETR | **Promissor** |

---

## D. Percepção da tela e contexto do computador

> **A distinção que o pedido exige — e que quase todo projeto confunde:**

| Etapa | O que é | Quem resolve | Estado na Lia |
|---|---|---|---|
| 1. **Capturar** | pixels da tela/janela | SO (Electron `desktopCapturer`, Windows Graphics Capture) | **5** |
| 2. **Interpretar** | "o que há nesta tela" | VLM | **5** |
| 3. **Localizar** | "o botão Salvar está em (x,y)" | GUI grounding (UI-TARS, Qwen3-VL) | **5** |
| 4. **Planejar** | "clique em Salvar, depois feche" | LLM com tools | **3** (só o booleano) |
| 5. **Executar** | mover mouse, teclar | UIAutomation, pywinauto, Playwright | **5** |
| 6. **Verificar** | "a janela mudou como esperado" | captura + diff + VLM | **5** |

**Um modelo que descreve screenshots não controla o computador.** São seis
problemas; cada um falha de um jeito próprio.

### D.1 Modelos e frameworks

| Solução | Tipo | Licença | Situação em 11/11/2026 |
|---|---|---|---|
| **UI-TARS** (ByteDance) | modelo computer-use | Apache-2.0 | **repositório ARQUIVADO** (jan/2026) |
| **UI-TARS-desktop** | app Electron | Apache-2.0 | **ARQUIVADO** (out/2026) |
| **OmniParser v2** (Microsoft) | parser de UI (detector + captioner) | repo **CC-BY-4.0** / pesos **verificar** | ativo (jul/2026) |
| **Qwen3-VL** | grounding nativo de UI | Apache-2.0 | ativo |
| **ShowUI / AGUVIS** | modelos de GUI agent | verificar | nicho |
| **OSWorld** | **benchmark** de computer use | Apache-2.0 | ativo — é régua, não solução |

**Achado que muda a recomendação:** os dois repositórios UI-TARS estão
arquivados. Continuam utilizáveis (pesos e código permanecem), mas **não são
base para dependência de longo prazo**. A aposta correta é **Qwen3-VL para
grounding** + parser próprio.

### D.2 Stack mínima viável para a Lia

```
captura (Electron desktopCapturer / Windows.Graphics.Capture)
   → downscale + região de interesse
   → Qwen3-VL-4B/8B (descrição + grounding de caixa)
   → [opcional] PaddleOCR/RapidOCR para texto exato
   → LLM de plano (Qwen3.5-4B local ou nuvem)
   → executor (UIAutomation primeiro; mouse/teclado como último recurso)
   → captura de novo + diff + confirmação
```

**UIAutomation antes de pixel.** Clicar por coordenada é frágil; a árvore de
acessibilidade do Windows dá nome, tipo e estado do controle. Usar visão só
quando a árvore não basta.

### D.3 Classificação

| Item | Classe |
|---|---|
| Qwen3-VL (grounding) | **Recomendado** |
| OmniParser | **Promissor** (licença dos pesos a confirmar) |
| UI-TARS | **Legado** (arquivado) |
| OSWorld | **Recomendado como benchmark** |
| Stack de captura Electron | **Recomendado** — já é a base do app |

---

## E. Controle de computador e interação

| Ferramenta | Camada | Licença | Windows | Nota |
|---|---|---|---|---|
| **Playwright** | automação de navegador | Apache-2.0 | **sim** | determinístico, sem LLM |
| **browser-use** | agente sobre navegador | MIT | sim | LLM dirige o browser |
| **Stagehand** | automação híbrida (código + IA) | MIT | sim | bom meio-termo |
| **Skyvern** | agente de browser | **AGPL-3.0** | sim | evitar embarcar |
| **Open Interpreter** | execução de código/ações | Apache-2.0 | sim | **alto risco**: roda código local |
| **pywinauto** | automação Win32/UIA | BSD-3 | **sim** | maduro, Python |
| **UIAutomation** (yinkaisheng) | árvore de acessibilidade | Apache-2.0 | **sim** | mais direto que pywinauto |
| **AutoHotkey** | macro/teclado | GPL-2.0 | sim | usuário avançado |
| **MCP** | protocolo de ferramentas | spec aberta | — | já há servidores no repo (herança AIRI) |

**Separação obrigatória:** modelo (decide) ≠ framework (executa) ≠ API do SO
(faz). A Lia deve executar no **Main**, nunca no renderer, com aprovação
explícita por ação destrutiva.

### Classificação

| Item | Classe |
|---|---|
| Playwright | **Recomendado** (navegador) |
| UIAutomation / pywinauto | **Recomendado** (desktop Windows) |
| browser-use / Stagehand | **Promissor** |
| Skyvern | **Não recomendado** (AGPL) |
| Open Interpreter | **Experimental, com sandbox** |

---

## F. Memória e recuperação

### F.1 Embeddings

| Modelo | Dimensão | Contexto | Idiomas | Licença | Tamanho |
|---|---|---|---|---|---|
| **BGE-M3** | 1024 | 8192 | 100+ (inclui PT) | **MIT** | ~2,2 GB fp32 / ~570 MB fp16 |
| **bge-large-en-v1.5** | 1024 | 512 | EN | MIT | ~1,3 GB |
| **Qwen3-Embedding 0.6B/4B/8B** | 1024–4096 | 32K | 100+ | Apache-2.0 | 0,6–8 B |
| **multilingual-e5-large** | 1024 | 512 | 100+ | MIT | ~2,2 GB |
| **Nomic Embed v1.5/v2** | 768 | 8192 | EN forte | Apache-2.0 | ~550 MB |
| **Jina Embeddings v3/v4** | 1024 | 8192 | 100+ | **CC-BY-NC-4.0** (v3) — verificar v4 | — |
| **GTE-multilingual** | 768 | 8192 | 100+ | Apache-2.0 | ~600 MB |

**Recomendado para a Lia: BGE-M3** — MIT, multilíngue, 8 k de contexto e o mesmo
peso serve para denso + esparso + ColBERT. Um modelo, três recuperações.

### F.2 Rerankers

| Modelo | Licença | Nota |
|---|---|---|
| **bge-reranker-v2-m3** | Apache-2.0 | par natural do BGE-M3 |
| **jina-reranker-v2** | CC-BY-NC (verificar) | forte, licença restritiva |
| **Cohere Rerank** | API paga | melhor qualidade, custo por busca |
| **mixedbread mxbai-rerank** | Apache-2.0 | alternativa aberta |

### F.3 Armazenamento

| Solução | Tipo | Licença | Quando usar |
|---|---|---|---|
| **sqlite-vec** | extensão SQLite | Apache-2.0 | **melhor encaixe**: já há SQLite no app, zero servidor |
| **LanceDB** | embedded, colunar | Apache-2.0 | milhões de vetores, sem servidor |
| **Qdrant** | servidor | Apache-2.0 | escala, filtros ricos |
| **Chroma** | embedded/servidor | Apache-2.0 | prototipagem |
| **pgvector** | Postgres | PostgreSQL | se já houver Postgres |

### F.4 Sistemas de memória

| Projeto | Licença | O que é | Risco |
|---|---|---|---|
| **Mem0** | Apache-2.0 | camada de memória para agentes | extração automática pode "lembrar" errado |
| **Letta** (ex-MemGPT) | Apache-2.0 | agente com memória própria | traz runtime de agente inteiro |
| **Graphiti** | Apache-2.0 | grafo temporal de fatos | complexidade |
| **Cognee** | Apache-2.0 | pipeline grafo + vetor | — |
| **WeKnora** (Tencent) | **sem SPDX** (verificar) | plataforma de conhecimento/RAG sobre documentos | 37 k estrelas, ativo 09/11/2026; é **plataforma**, não biblioteca |

### F.5 Classificação

| Item | Classe |
|---|---|
| BGE-M3 + sqlite-vec | **Recomendado** — mínimo viável, sem servidor |
| bge-reranker-v2-m3 | **Promissor** (segunda fase) |
| Qwen3-Embedding-0.6B | **Promissor** (se já houver Qwen local) |
| Jina v3 | **Licença pendente** (NC) |
| Mem0 / Letta / Graphiti | **Experimental** — resolvem memória, mas trazem arquitetura junto |
| WeKnora | **Referência** para RAG documental |

---

## G. Orquestração e multiagentes

| Projeto | Licença | O que é de fato | Encaixe na Lia |
|---|---|---|---|
| **LangGraph** | MIT | grafo de estado para agentes | pesado; conceito útil |
| **AutoGen** | repo CC-BY-4.0 (código MIT, verificar) | conversa multiagente | experimental |
| **CrewAI** | MIT | times de agentes por papel | opinião forte de framework |
| **Agno** | Apache-2.0 | runtime de agentes leve | promissor |
| **PydanticAI** | MIT | agentes tipados | **bom modelo mental** para contratos |
| **Semantic Kernel** | MIT | orquestração corporativa | pesado |
| **Mastra** | sem SPDX (verificar) | TS/JS agents | relevante por ser TypeScript |
| **Temporal** | MIT | **workflow durável** | ótimo para execução persistente |
| **OpenAI Agents SDK** | MIT | agentes + handoffs | acopla a OpenAI |
| **Claude Agent SDK** | MIT | agentes + tools | acopla a Anthropic |
| **Anthropic managed agents** | serviço | agentes gerenciados | dependência externa |
| **Alethe** | skill local no repo | framework de agentes já estudado em `.agents/skills/alethe/` | **já há análise interna** |
| **promptfoo** | MIT | **avaliação** de prompts/modelos | **recomendado para o plano de testes** |

### A decisão que o pedido já toma por nós

> "A Lia deve manter seu próprio contrato de orquestração. Não adotar um
> framework inteiro como dependência central sem demonstrar necessidade."

**Recomendação:** manter o contrato próprio e adotar **apenas conceitos**, não
dependências: grafo de tarefas com estado (LangGraph), durabilidade com retry
(Temporal), tipagem de ferramentas (PydanticAI), avaliação (promptfoo).

### Classificação

| Item | Classe |
|---|---|
| Orquestrador próprio da Lia | **Recomendado** |
| Temporal (como serviço opcional) | **Promissor** |
| PydanticAI (conceito de contrato) | **Promissor** |
| LangGraph / AutoGen / CrewAI | **Experimental** como dependência; **Recomendado** como leitura |
| promptfoo | **Recomendado (avaliação)** |

---

## H. Embeddings, busca e classificação

Coberto em F.1–F.3. Adicionais:

| Tarefa | Solução | Licença |
|---|---|---|
| Classificação de intenção | Qwen3.5-0.8B / Gemma 3 270M | Apache / Gemma |
| Classificação de imagem | SigLIP 2, CLIP | Apache-2.0 |
| Busca multimodal | **VINDEX** (ICCV 2025, Apache-2.0) | pesquisa em espaço visual |
| Duplicata near-exact | MinHash/SimHash (biblioteca) | — |
| Detecção de tópicos | BERTopic (MIT) | — |

---

## I. Geração de imagens e edição

| Modelo | Tipo | Licença | Nota |
|---|---|---|---|
| **FLUX.1-schnell** | T2I | **Apache-2.0** | 4 steps, rápido |
| **FLUX.1-dev** | T2I | **não comercial** | qualidade alta, uso restrito |
| **SDXL** | T2I | CreativeML OpenRAIL++ | ecossistema enorme de LoRA |
| **Stable Diffusion 3.5** | T2I | Stability Community | restrições por receita |
| **Qwen-Image** | T2I + edição | Apache-2.0 (verificar) | texto em imagem |
| **Z-Image** | T2I | verificar | recente |
| **HiDream-I1** | T2I | MIT (código) / verificar pesos | — |
| **Real-ESRGAN** | upscale | BSD-3 | — |
| **rembg** | remoção de fundo | MIT | U2Net |
| **ComfyUI** | interface/workflow | **GPL-3.0** | referência de grafo, não embarcar |
| **diffusers** | biblioteca | Apache-2.0 | caminho de integração |

**Distinções que o catálogo precisa carregar:** checkpoint ≠ LoRA ≠ VAE ≠
ControlNet ≠ workflow. Uma "entrada de catálogo" de imagem aponta para um
**checkpoint** e lista os complementos compatíveis — não é um único campo.

---

## J. Vídeo, animação e lip sync

| Modelo | Tipo | Licença |
|---|---|---|
| **Wan 2.2** | T2V / I2V | Apache-2.0 |
| **LTX-Video** | T2V rápido | Apache-2.0 |
| **CogVideoX** | T2V | Apache-2.0 |
| **HunyuanVideo** | T2V | **licença Tencent (restrições)** |
| **Mochi 1** | T2V | Apache-2.0 |
| **LivePortrait** | animação de retrato | **licença própria (verificar)** |
| **MuseTalk** | lip sync | **licença própria** |
| **Wav2Lip** | lip sync | **sem licença declarada — não comercial na prática** |
| **LatentSync** | lip sync | Apache-2.0 (verificar) |
| **Kling / Veo / Sora** | API | comercial |

---

## K. Áudio além de voz

| Tarefa | Solução | Licença |
|---|---|---|
| Eventos sonoros | **PANNs**, **AST**, **YAMNet** | MIT / Apache |
| Áudio-texto | **CLAP** | Apache-2.0 |
| Separação de fontes | **Demucs** (arquivado), **Spleeter** | MIT |
| Diarização | **pyannote.audio** | MIT (código) + gated no HF |
| Emoção na fala | **SpeechBrain** | Apache-2.0 |
| Música | **MusicGen/AudioCraft** | MIT (código) / pesos CC-BY-NC |
| Efeitos sonoros | **Stable Audio Open** | Stability license (verificar) |

---

## L. Movimento, animação e presença

| Recurso | Solução | Licença |
|---|---|---|
| Pose | **MediaPipe Pose** | Apache-2.0 |
| Pose 3D | **RTMPose / MotionBERT / GVHMR** | Apache-2.0 |
| Mocap facial | MediaPipe FaceLandmarker | Apache-2.0 |
| Avatar 2D | **Live2D Cubism SDK** | licença comercial própria |
| Avatar 3D | **three-vrm / @pixiv/three-vrm** | MIT |
| Pipeline completo | **Open-LLM-VTuber** | verificar |
| Lip sync em tempo real | MediaPipe + blendshapes | Apache-2.0 |

**A Lia já usa Live2D via Stage.** O catálogo deve registrar que a camada de
movimento é **separada do modelo de linguagem** — o LLM não anima o avatar.

---

## M. Segurança, moderação e proteção

| Camada | Solução | Licença | Papel |
|---|---|---|---|
| Classificador de conteúdo | **Llama Guard 3/4** | Llama Community | risco por categoria |
| Prompt injection | **Prompt Guard 2** | Llama Community | detecta injeção |
| Moderação | **ShieldGemma** | Gemma | política configurável |
| Guardrails de diálogo | **NeMo Guardrails** | verificar | fluxo conversacional |
| Validação de schema | **Guardrails AI**, **Outlines**, **Instructor** | Apache/MIT | saída estruturada |
| PII | **Presidio** | MIT | detecção/anonimização |
| Red team | **garak**, **promptfoo redteam** | Apache/MIT | testes adversariais |
| Isolamento | sandbox do SO / VM | — | execução de ferramentas |

**O que é modelo ≠ o que é política.** Um classificador não substitui aprovação
humana; a política de autorização é da Lia (ver `05-PLANO-DE-TESTES-E-RISCOS.md` §5).

---

## Contagem desta pesquisa

| Categoria | Modelos/soluções citados |
|---|---|
| A. LLM e raciocínio | 24 |
| B. Voz (TTS + STT + duplex) | 30 |
| C. Visão | 19 |
| D. Percepção de tela | 6 |
| E. Controle de computador | 9 |
| F. Memória | 19 |
| G. Orquestração | 13 |
| H. Embeddings/busca | 8 |
| I. Imagem | 12 |
| J. Vídeo/lip sync | 10 |
| K. Áudio | 9 |
| L. Movimento | 7 |
| M. Segurança | 9 |
| **Total aproximado** | **175** |

Provedores hospedados mapeados: **18** (ver `04-MATRIZES-E-PRIORIDADES.md` §4).
