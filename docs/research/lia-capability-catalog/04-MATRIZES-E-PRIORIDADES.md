# 4. Matrizes, compatibilidade e prioridades

**Data:** 11/11/2026 · **Base:** `29999aff`

## 4.1 Matriz modelo × runtime × SO × hardware

Legenda de célula: **S** suportado e documentado · **p** parcial / depende de build
· **?** não confirmado · **—** não se aplica.

### 4.1.1 LLM

| Modelo | llama.cpp (CPU) | llama.cpp (Vulkan) | llama.cpp (ROCm) | Ollama | vLLM | ORT GenAI | Windows | AMD |
|---|---|---|---|---|---|---|---|---|
| Qwen3.5-0.8B/2B/4B/9B | **S** | **S** | **S** | **S** | **S** | **S** | **S** | **S** (GGUF) |
| Qwen3.5-27B | **S** (lento) | **p** | **p** | **S** | **S** | ? | **S** | **p** |
| Qwen3.5-35B-A3B | **p** | **p** | **p** | **S** | **S** | ? | **p** | **p** |
| Qwen3.5-122B+ | **—** | **—** | **—** | **p** | **S** | **—** | **p** | **—** |
| Gemma 3 4B/12B/27B | **S** | **S** | **S** | **S** | **S** | ? | **S** | **S** |
| Llama 4 Scout | **p** | **?** | **?** | **S** | **S** | **—** | **p** | **?** |
| DeepSeek-V3 | **—** | **—** | **—** | **p** | **S** | **—** | **—** | **—** |

**Leitura para o parque Windows/AMD:** `llama.cpp` + Vulkan é o caminho que
existe em qualquer GPU AMD; `ROCm` oficial cobre um subconjunto de placas (não
assumir por modelo); `Ollama` empacota ambos e é o menor atrito de instalação.

### 4.1.2 Voz

| Modelo | ONNX/CPU | CUDA | DirectML | Vulkan | Windows | Streaming | PT-BR |
|---|---|---|---|---|---|---|---|
| Kokoro-82M | **S** | **S** | **S** | **p** | **S** | **S** | **p** (declarado) |
| Piper | **S** | — | **p** | — | **S** | **S** | **p** |
| CosyVoice 2 | **p** | **S** | ? | — | **p** | **S** | ? |
| GPT-SoVITS | **p** | **S** | ? | — | **p** | **—** | ? |
| faster-whisper | **S** | **S** | **—** | — | **S** | **p** | **S** |
| sherpa-onnx | **S** | **S** | **S** | — | **S** | **S** | **S** |
| Parakeet | **p** | **S** | **—** | — | **p** | **S** | **—** |

### 4.1.3 Visão

| Modelo | llama.cpp | vLLM | ORT | Windows | AMD | VRAM estimada (Q4) |
|---|---|---|---|---|---|---|
| Qwen3-VL-4B | **S** | **S** | **p** | **S** | **S** | ~3 GB |
| Qwen3-VL-8B | **S** | **S** | **p** | **S** | **S** | ~6 GB |
| Qwen3-VL-32B | **p** | **S** | **—** | **p** | **p** | ~20 GB |
| Florence-2-large | **—** | **p** | **S** | **S** | **S** | ~1,5 GB |
| PaddleOCR | **—** | **—** | **S** | **S** | **S** | ~0,5 GB |
| MediaPipe | **—** | **—** | **S** | **S** | **S** | ~0,1 GB |

### 4.1.4 Regras de hardware (estimativa, não medição)

| Classe de máquina | O que é razoável | O que não é |
|---|---|---|
| CPU only, 8 GB RAM | Qwen3.5-0.8B/2B, Gemma 270M, Kokoro, sherpa-onnx, OCR | qualquer VLM > 4B |
| GPU 4–6 GB (GTX 1650, RX 6400) | Qwen3.5-4B Q4, Qwen3-VL-4B Q4, Kokoro, Whisper turbo | 27B |
| GPU 8–12 GB (RTX 3060, RX 6600) | Qwen3.5-9B Q4, Qwen3-VL-8B Q4, CosyVoice | 27B denso |
| GPU 16–24 GB (RTX 4080/3090, RX 7900) | Qwen3.5-27B Q4, Qwen3.8-27B Q4, FLUX schnell | 122B |
| ≥ 48 GB ou multi-GPU | 122B MoE, 397B Q4, vLLM | desktop típico |

**Nunca prometer "roda em qualquer PC".** O perfil `low-power` existe justamente
porque a máquina do usuário pode estar rodando um jogo.

## 4.2 Comparação por categoria (vantagens × limitações)

### 4.2.1 TTS local

| Modelo | Vantagem | Limitação | Licença |
|---|---|---|---|
| Kokoro | 82 M, rápido em CPU, Apache | sem clonagem, PT-BR depende de G2P | Apache-2.0 |
| Piper | minúsculo, C++, offline | arquivado, vozes datadas | MIT |
| CosyVoice 2 | clonagem + streaming + Apache | ecossistema jovem, pesado | Apache-2.0 |
| GPT-SoVITS | clonagem few-shot muito boa | não é tempo real | MIT |
| XTTS-v2 | clonagem madura | **proibido comercialmente** | CPML |
| ChatTTS | prosódia natural | **AGPL** | AGPL-3.0 |
| F5-TTS | qualidade alta | pesos NC (verificar) | MIT / NC |

### 4.2.2 STT

| Modelo | Vantagem | Limitação |
|---|---|---|
| faster-whisper | preciso, PT-BR, MIT, 4–8× mais rápido | não é streaming real |
| sherpa-onnx | streaming real, Windows/CPU, C++ | WER maior que Whisper large |
| WhisperX | timestamps por palavra + diarização | pipeline mais pesado |
| Parakeet | muito rápido em GPU | sem PT-BR confirmado |

### 4.2.3 Memória

| Solução | Vantagem | Limitação |
|---|---|---|
| Lexical (atual) | zero dependência, determinístico | não entende sinônimo/paráfrase |
| BGE-M3 + sqlite-vec | MIT, multilíngue, sem servidor | +570 MB e um modelo a carregar |
| Mem0 | extração automática | pode consolidar fato errado (falso positivo de memória) |
| Graphiti | relações temporais | complexidade alta |

## 4.3 Compatibilidade de licenças — o filtro duro

| Licença | Efeito na Lia | Exemplos |
|---|---|---|
| Apache-2.0 / MIT / BSD | **livre** para distribuir | Qwen, Kokoro, llama.cpp, BGE-M3 |
| Gemma / Llama Community | uso comercial com termos e restrições | Gemma 3, Llama 4 |
| GPL-3.0 | contamina se embarcado | ComfyUI |
| AGPL-3.0 | contamina inclusive via rede | ChatTTS, VoiceStudio, Skyvern, Ultralytics |
| CC-BY-NC | **proíbe uso comercial** | F5-TTS (pesos), Jina v3, MusicGen (pesos) |
| CPML | **proíbe uso comercial** | XTTS-v2 |
| Sem licença declarada | **não usar** | Wav2Lip |
| Licença própria restritiva | revisar caso a caso | HunyuanVideo, LivePortrait, MuseTalk, Llama 4 |

## 4.4 Provedores hospedados mapeados (18)

| Provedor | Modalidades | API compatível OpenAI | Observação |
|---|---|---|---|
| OpenAI | texto, imagem, áudio, realtime, embeddings | sim (origem) | — |
| Anthropic | texto, visão | SDK próprio | — |
| Google (Gemini/Vertex) | texto, imagem, áudio, vídeo | parcial | — |
| xAI | texto, visão | sim | — |
| DeepSeek | texto | sim | preço agressivo |
| Mistral | texto, visão, OCR, embeddings | sim | — |
| Alibaba Qwen (DashScope) | texto, visão, omni, TTS | sim | Qwen3-Omni via API |
| Groq | texto (LPU) | sim | **já integrado** |
| Cerebras | texto | sim | **já integrado** |
| Together AI | texto, imagem | sim | catálogo aberto amplo |
| Fireworks | texto, imagem | sim | — |
| OpenRouter | agregador | sim | **já integrado** |
| HF Inference | texto, imagem, áudio | parcial | — |
| Replicate | qualquer modelo | próprio | — |
| fal | imagem, vídeo, áudio | próprio | — |
| ElevenLabs | TTS, clonagem | próprio | — |
| Fish Audio | TTS, clonagem | parcial | — |
| Azure Speech | TTS/STT/avatar | próprio | PT-BR forte |

> **Preços, cotas, rate limits, SLA e retenção não foram verificados nesta
> pesquisa.** Cada linha precisa de coleta na fonte oficial, com data, antes de
> virar registro de catálogo com `cost`. Ver `05-PLANO-DE-TESTES-E-RISCOS.md` §3.

## 4.5 Perfis de usuário (presets, não limites)

| Perfil | Chat | Voz | Visão | Memória | Regra |
|---|---|---|---|---|---|
| **Econômico** | Qwen3.5-4B local → Groq free | Kokoro | Florence-2 | lexical | zero custo por padrão |
| **Local e privado** | Qwen3.5-9B local | Kokoro + sherpa-onnx | Qwen3-VL-8B local | BGE-M3 + sqlite-vec | nenhum byte sai |
| **Equilibrado** | local + OpenRouter | Kokoro + ElevenLabs opcional | local + API | BGE-M3 | externo só com ganho |
| **Alta qualidade** | Qwen3.5-27B / API frontier | ElevenLabs / CosyVoice | Qwen3-VL-32B / API | BGE-M3 + reranker | custo autorizado |
| **Baixo consumo** | Qwen3.5-0.8B | Kokoro (ONNX CPU) | OCR only | lexical | não competir com jogos |
| **Personalizado** | escolha por capacidade | idem | idem | idem | usuário decide tudo |

## 4.6 Melhores candidatos por critério

| Critério | Escolha | Por quê | Confiança |
|---|---|---|---|
| **Melhor local (geral)** | Qwen3.5-4B / 9B | Apache, multimodal, GGUF, tamanho viável | alta (licença verificada) |
| **Melhor em nuvem** | Qwen3.5-397B via API / frontier proprietário | capacidade | média (preço não verificado) |
| **Melhor gratuito** | Qwen3.5-4B local + Groq free tier | custo zero real | alta para local |
| **Melhor baixo consumo** | Kokoro (ONNX) + Gemma 3 270M + sherpa-onnx | roda em CPU | alta |
| **Melhor para português** | Qwen3.5 / Gemma 3 (declarado) | multilíngue forte | **média — precisa teste próprio** |
| **Melhor para AMD/Vulkan** | Qwen3.5-4B/9B em llama.cpp Vulkan | GGUF + Vulkan | alta |
| **Melhor alta qualidade** | Qwen3.5-27B / Qwen3.8-27B | denso aberto mais forte | alta |
| **Melhor TTS local** | Kokoro (padrão) / CosyVoice 2 (clonagem) | licença limpa | alta |
| **Melhor STT local** | faster-whisper (precisão) / sherpa-onnx (streaming) | PT-BR | alta |
| **Melhor memória** | BGE-M3 + sqlite-vec | MIT, sem servidor | alta |
| **Melhor embedding leve** | Qwen3-Embedding-0.6B | Apache, 32K ctx | média |
| **Melhor avaliação** | promptfoo | MIT, cobre LLM+agente | alta |

## 4.7 Alternativas promissoras (não escolhidas hoje)

| Item | Por que promissor | Por que não agora |
|---|---|---|
| Qwen3-Omni | um modelo para áudio+visão+fala | pesado; duplex ainda imaturo |
| CosyVoice 2 | clonagem Apache + streaming | precisa teste PT-BR |
| VoxCPM / MOSS-TTS | Apache, geração 2026 | pouca validação independente |
| Qwen3.8-27B | melhor denso de ago/2026 | GGUF recente, ecossistema em formação |
| RF-DETR | detecção Apache | substitui YOLO só após teste |
| Temporal | durabilidade de execução | exige serviço; só quando houver fila real |
| WeKnora | RAG documental maduro | plataforma, não biblioteca |
| Understand-Anything | código → grafo de conhecimento | fora do escopo do produto hoje |

## 4.8 Não recomendados (e por quê)

| Item | Motivo |
|---|---|
| XTTS-v2 | CPML proíbe uso comercial |
| ChatTTS | AGPL-3.0 |
| VoiceStudio (como dependência) | AGPL-3.0 |
| Skyvern | AGPL-3.0 |
| Ultralytics YOLO | AGPL-3.0 |
| ComfyUI (embarcado) | GPL-3.0 |
| Wav2Lip | sem licença declarada |
| UI-TARS (como base) | repositórios arquivados |
| MiniMax/qualquer modelo só-API como *default* | cria dependência de fornecedor |

## 4.9 Cobertura da matriz de compatibilidade

| Verificação exigida | Situação |
|---|---|
| Modelos × runtimes | coberto por família (§4.1) |
| Modelos × SO | coberto; Windows é o alvo, Linux é o de desenvolvimento |
| Modelos × hardware | coberto por classe de máquina (§4.1.4) |
| Modelos × backend de GPU | **parcial**: Vulkan/ROCm/DirectML marcados como `p`/`?` — **exigem teste físico** |
| Quantizações por modelo | **parcial**: GGUF é regra para llama.cpp; tamanhos exatos variam por repositório |

> Onde a célula é `?`, o catálogo deve gravar `blockers: ["unverified"]`. Nunca
> promover para `installable` por analogia de arquitetura.
