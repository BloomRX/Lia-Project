# 3. Esquema do catálogo selecionável

**Data:** 11/11/2026 · **Compatível com:** `lia/core` em `29999aff`

## 3.1 O princípio

O catálogo **não** é uma lista de modelos. É uma separação em oito camadas, cada
uma com um dono diferente. Confundir duas delas é o erro que produz "selecionar
um modelo" quando o usuário queria "escolher como a voz funciona".

| # | Camada | Pergunta que responde | Dono |
|---|---|---|---|
| 1 | **Capability** | o que a Lia quer fazer | produto |
| 2 | **Model** | qual modelo executa | catálogo |
| 3 | **Weights** | quais pesos, em que quantização | catálogo |
| 4 | **Runtime** | como os pesos são executados | máquina do usuário |
| 5 | **Provider** | onde o serviço roda | usuário / conta |
| 6 | **Adapter** | como a Lia conversa com isso | código da Lia |
| 7 | **Configuration** | parâmetros escolhidos | usuário |
| 8 | **Routing policy** | como a Lia escolhe entre alternativas | política |

**Exemplo do erro evitado:** `Qwen3.5-9B` é *modelo*; `Q4_K_M` é *pesos*;
`llama.cpp` é *runtime*; `Ollama localhost:11434` é *provider*; `openai-compatible`
é *adapter*; `temperature=0.3` é *configuração*. Nenhum dos seis é o outro.

## 3.2 Taxonomia de capacidades

Identificador estável em `dominio.acao`. O ponto é o separador, não o `:`.

| Capacidade | O que cobre | Mapeia para `LiaBrainCapabilities` |
|---|---|---|
| `chat.conversation` | conversa geral, persona | `textInput`, `textOutput` |
| `chat.reasoning` | raciocínio deliberado | + `reasoning` |
| `chat.tools` | tool calling | + `toolCalling` |
| `chat.structured-output` | JSON/schema | `textOutput` + validação no adapter |
| `speech.tts` | síntese de voz | `audioOutput` |
| `speech.tts-clone` | clonagem | `audioOutput` (política própria) |
| `speech.stt` | transcrição | `audioInput` |
| `speech.realtime` | full-duplex | `realtime` + `audioInput` + `audioOutput` |
| `vision.understand` | descrever imagem | `imageInput` |
| `vision.ocr` | texto em imagem | `imageInput` |
| `vision.grounding` | localizar elemento | `imageInput` |
| `vision.video` | entender vídeo | `videoInput` |
| `screen.capture` | capturar tela/janela | **sem** mapeamento (é SO) |
| `screen.parse` | interpretar UI | `imageInput` |
| `computer.control` | executar ação | `toolCalling` |
| `memory.embed` | vetorizar | — |
| `memory.retrieve` | recuperar | — |
| `memory.rerank` | reordenar | — |
| `agents.orchestrate` | planejar/executar | `toolCalling` + `reasoning` |
| `image.generate` / `image.edit` | imagem | — |
| `video.generate` / `video.lipsync` | vídeo | — |
| `audio.classify` / `audio.separate` | áudio | — |
| `safety.classify` | moderação | — |

**Regra:** uma capacidade nova **não** cria um booleano novo em
`LiaBrainCapabilities` sem antes provar que a resolução de rota precisa dela.
O vocabulário fino vive no catálogo; o grosso continua sendo os 9 booleanos.

## 3.3 Estados de ciclo de vida

Sete estados, **mutuamente exclusivos, sempre explícitos**. Um modelo listado
está em `catalogued` — nunca em `in-use`.

| Estado | Significado | Quem pode promover |
|---|---|---|
| `catalogued` | aparece no catálogo; nada foi baixado | — (estado inicial) |
| `installable` | há caminho de instalação conhecido e licença aceita | catálogo |
| `installed` | pesos presentes no disco, hash conferido | runtime |
| `configured` | credencial/endpoint definidos e válidos | usuário |
| `validated` | **teste próprio executado** com resultado registrado | plano de testes |
| `selected` | escolhido pelo usuário para uma capacidade | usuário |
| `in-use` | em execução agora | runtime |

Estados de bloqueio (podem coexistir com `catalogued`):

`license-pending`, `hardware-incompatible`, `unavailable`, `deprecated`.

## 3.4 Registro — JSON Schema (resumo)

```json
{
  "$id": "lia.catalog.entry/v1",
  "type": "object",
  "required": ["id", "capability", "kind", "displayName", "vendor", "lifecycle", "license", "sources"],
  "properties": {
    "id":              { "type": "string", "pattern": "^[a-z0-9]+(\\.[a-z0-9-]+)+$" },
    "capability":      { "type": "string", "enum": ["chat.conversation", "speech.tts", "..."] },
    "kind":            { "type": "string", "enum": ["model", "weights", "runtime", "provider", "adapter", "pipeline", "framework"] },
    "displayName":     { "type": "string" },
    "description":     { "type": "string" },
    "vendor":          { "type": "string" },
    "lifecycle":       { "type": "string", "enum": ["catalogued","installable","installed","configured","validated","selected","in-use"] },
    "blockers":        { "type": "array", "items": { "enum": ["license-pending","hardware-incompatible","unavailable","deprecated","unverified"] } },
    "modalities": {
      "type": "object",
      "properties": {
        "input":  { "type": "array", "items": { "enum": ["text","image","audio","video","screen"] } },
        "output": { "type": "array", "items": { "enum": ["text","image","audio","video","action"] } }
      }
    },
    "model": {
      "type": "object",
      "properties": {
        "modelId":     { "type": "string" },
        "family":      { "type": "string" },
        "parameters":  { "type": "string" },
        "architecture":{ "type": "string" },
        "contextTokens": { "type": "integer" },
        "releaseDate": { "type": "string", "format": "date" }
      }
    },
    "weights": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "variant":     { "type": "string", "examples": ["BF16","Q4_K_M","Q8_0","FP8","ONNX-int8"] },
          "format":      { "enum": ["safetensors","gguf","onnx","mlx","tflite","pytorch"] },
          "sizeBytes":   { "type": "integer" },
          "quantization":{ "type": "string" },
          "url":         { "type": "string", "format": "uri" },
          "sha256":      { "type": "string" },
          "license":     { "type": "string" }
        }
      }
    },
    "runtime": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id":       { "enum": ["llama.cpp","ollama","lm-studio","vllm","sglang","onnxruntime","onnxruntime-genai","openvino","mlx","sherpa-onnx","pytorch","comfyui"] },
          "backends": { "type": "array", "items": { "enum": ["cpu","cuda","rocm","vulkan","directml","metal","openvino"] } },
          "os":       { "type": "array", "items": { "enum": ["windows","linux","macos"] } },
          "api":      { "type": "array", "items": { "enum": ["openai-compatible","grpc","cli","python","none"] } },
          "streaming":{ "type": "boolean" }
        }
      }
    },
    "provider": {
      "type": "object",
      "properties": {
        "kind":     { "enum": ["local","hosted","hybrid"] },
        "id":       { "type": "string" },
        "endpoint": { "type": "string" },
        "region":   { "type": "string" },
        "auth":     { "enum": ["none","api-key","oauth","device-code"] }
      }
    },
    "license": {
      "type": "object",
      "required": ["code", "weights", "commercialUse"],
      "properties": {
        "code":          { "type": "string" },
        "weights":       { "type": "string" },
        "commercialUse": { "enum": ["allowed","restricted","forbidden","unknown"] },
        "attribution":   { "type": "boolean" },
        "copyleft":      { "enum": ["none","file","library","network","unknown"] }
      }
    },
    "hardware": {
      "type": "object",
      "properties": {
        "minRamGb":   { "type": "number" },
        "minVramGb":  { "type": "number" },
        "cpuOnly":    { "type": "boolean" },
        "notes":      { "type": "string" }
      }
    },
    "languages": {
      "type": "object",
      "properties": {
        "supported":   { "type": "array", "items": { "type": "string" } },
        "portugueseBr":{ "enum": ["verified","declared","unknown","unsupported"] }
      }
    },
    "cost": {
      "type": "object",
      "properties": {
        "model":      { "enum": ["free","free-tier","metered","subscription"] },
        "unit":       { "type": "string" },
        "amount":     { "type": "number" },
        "currency":   { "type": "string" },
        "checkedAt":  { "type": "string", "format": "date" },
        "source":     { "type": "string", "format": "uri" }
      }
    },
    "performance": {
      "type": "object",
      "properties": {
        "source":     { "enum": ["vendor","third-party","self-measured","unknown"] },
        "firstTokenMs": { "type": "number" },
        "tokensPerSecond": { "type": "number" },
        "notes":      { "type": "string" }
      }
    },
    "sources": {
      "type": "array",
      "items": { "type": "object", "required": ["url","checkedAt"], "properties": {
        "url": { "type": "string", "format": "uri" },
        "checkedAt": { "type": "string", "format": "date" },
        "kind": { "enum": ["model-card","repo","docs","pricing","paper","benchmark"] }
      } }
    },
    "lastVerifiedAt": { "type": "string", "format": "date" }
  }
}
```

## 3.5 Registros de exemplo

### 3.5.1 Capacidade de voz, modelo local

```json
{
  "id": "speech.tts.kokoro-82m",
  "capability": "speech.tts",
  "kind": "model",
  "displayName": "Kokoro 82M",
  "vendor": "hexgrad",
  "lifecycle": "in-use",
  "modalities": { "input": ["text"], "output": ["audio"] },
  "model": { "modelId": "hexgrad/Kokoro-82M", "family": "Kokoro", "parameters": "82M",
             "architecture": "StyleTTS2", "releaseDate": "2024-12-26" },
  "weights": [
    { "variant": "fp32", "format": "pytorch", "url": "https://huggingface.co/hexgrad/Kokoro-82M",
      "license": "apache-2.0" }
  ],
  "runtime": [{ "id": "onnxruntime", "backends": ["cpu","cuda","directml"], "os": ["windows","linux"],
                "api": ["python"], "streaming": true }],
  "provider": { "kind": "local", "id": "lia-kokoro-worker", "auth": "none" },
  "license": { "code": "Apache-2.0", "weights": "Apache-2.0", "commercialUse": "allowed",
               "attribution": false, "copyleft": "none" },
  "hardware": { "minRamGb": 1, "cpuOnly": true, "notes": "~330 MB de pesos" },
  "languages": { "supported": ["en","pt","es","fr","hi","it","ja","zh"], "portugueseBr": "declared" },
  "cost": { "model": "free" },
  "sources": [{ "url": "https://huggingface.co/hexgrad/Kokoro-82M", "checkedAt": "2026-11-11",
                "kind": "model-card" }],
  "lastVerifiedAt": "2026-11-11"
}
```

> `lifecycle: in-use` aqui é legítimo porque a engine Kokoro **já está
> registrada e testada** em `lia/core/src/voice/engines/kokoro/`. Todo o resto do
> catálogo começa em `catalogued`.

### 3.5.2 Capacidade de tela, pipeline

```json
{
  "id": "vision.screen-understanding.qwen3vl-local",
  "capability": "vision.screen-understanding",
  "kind": "pipeline",
  "displayName": "Tela: captura + Qwen3-VL + OCR",
  "vendor": "lia",
  "lifecycle": "catalogued",
  "blockers": ["unverified"],
  "modalities": { "input": ["screen"], "output": ["text","action"] },
  "model": { "modelId": "Qwen/Qwen3-VL-8B-Instruct", "parameters": "8B" },
  "runtime": [
    { "id": "llama.cpp", "backends": ["cpu","vulkan","cuda","rocm"], "os": ["windows","linux"],
      "api": ["openai-compatible"], "streaming": true }
  ],
  "license": { "code": "Apache-2.0", "weights": "Apache-2.0", "commercialUse": "allowed",
               "attribution": false, "copyleft": "none" },
  "hardware": { "minRamGb": 16, "minVramGb": 8,
                "notes": "estimativa para Q4; contexto de imagem consome muito KV" },
  "sources": [{ "url": "https://github.com/QwenLM/Qwen3-VL", "checkedAt": "2026-11-11", "kind": "repo" }],
  "lastVerifiedAt": "2026-11-11"
}
```

### 3.5.3 Provedor hospedado

```json
{
  "id": "provider.elevenlabs",
  "capability": "speech.tts",
  "kind": "provider",
  "displayName": "ElevenLabs",
  "vendor": "ElevenLabs",
  "lifecycle": "catalogued",
  "provider": { "kind": "hosted", "id": "elevenlabs", "auth": "api-key" },
  "license": { "code": "proprietary", "weights": "proprietary", "commercialUse": "restricted",
               "attribution": false, "copyleft": "unknown" },
  "cost": { "model": "metered", "unit": "1k-character", "checkedAt": "2026-11-11",
            "source": "https://elevenlabs.io/pricing" },
  "sources": [{ "url": "https://elevenlabs.io/docs", "checkedAt": "2026-11-11", "kind": "docs" }]
}
```

> `amount` deliberadamente ausente: **preço não verificado na fonte no dia** não
> vira número. O campo existe para ser preenchido com data.

## 3.6 Política de roteamento por capacidade

```json
{
  "id": "policy.default",
  "perCapability": {
    "speech.tts":       { "prefer": ["local"], "fallback": ["hosted"], "maxCostPer1kChars": 0 },
    "chat.conversation":{ "prefer": ["local:qwen3.5-4b", "hosted:groq"], "requireConsent": true },
    "vision.grounding": { "prefer": ["local:qwen3-vl-8b"], "fallback": [] },
    "computer.control": { "requireApproval": "every-action", "allowlistOnly": true }
  }
}
```

Regras que a política **não** pode quebrar:

1. `computer.control` nunca executa sem aprovação explícita.
2. `speech.tts-clone` exige consentimento registrado da voz.
3. `provider.kind = hosted` só entra se o usuário autorizou envio externo.
4. Nenhuma capacidade pode ficar **sem** candidato local quando o perfil é
   `local-private` — se não houver, a Lia diz "indisponível", não vaza.

## 3.7 Onde isso se conecta ao código que existe

| Camada do catálogo | Encaixe atual | Ação necessária |
|---|---|---|
| Capability | `LiaBrainCapabilities` + futuro vocabulário fino | ampliar vocabulário, **não** o contrato |
| Model | `LiaBrainModelDescriptor` | adicionar `metadata` (já é `Record<string, unknown>`) |
| Weights | — | **novo**: campo de catálogo, sem runtime |
| Runtime | — | **novo**: declaração, sem execução |
| Provider | `provider-catalog.ts` (10 ids) | ampliar lista curada por capacidade |
| Adapter | `transport-execution-service.ts` | reaproveitar `openai-compatible` |
| Configuration | `product/config.ts`, vault | já existe |
| Routing policy | `brain/selection.ts`, `decision.ts` | já existe para chat; ampliar |

**Conclusão do encaixe:** cinco das oito camadas já têm casa. As três novas
(pesos, runtime, catálogo por capacidade) são **dados**, não arquitetura.
