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

> **Revisão 2 (11/11/2026).** A revisão do Dev pediu onze campos que faltavam.
> Eles estão especificados em **§3.8**, que complementa e prevalece sobre o
> resumo abaixo. O schema em §3.4 permanece como visão geral; §3.8 é normativo
> para a implementação.


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


---

# Revisão 2 — campos exigidos pela revisão do Dev

## 3.8 Os onze campos obrigatórios

A revisão de 11/11/2026 apontou campos sem os quais o catálogo não sustenta uma
interface selecionável. Todos foram incorporados. A coluna "já existia" mostra
onde o schema anterior dava uma resposta **parcial** — que é pior que ausência,
porque parece resolvida.

| Campo | Já existia? | O que resolve | Obrigatório em |
|---|---|---|---|
| `model_id` | parcial (`model.modelId`) | identidade estável, independente do nome de exibição | `kind: model` |
| `revision` | **não** | saber **qual** versão exata foi pesquisada/testada | `kind: model` |
| `weights_id` | **não** | distinguir pesos diferentes do mesmo modelo | `kind: weights` |
| `weights_hash` | parcial (`weights[].sha256`) | garantir que o arquivo testado é o instalado | `installable`+ |
| `quantization` | parcial | diferenciar Q4/Q5/Q8/FP16 | por variante |
| `runtime_version` | **não** | reproduzir o teste | `validated` |
| `backend` | parcial (`runtime.backends[]`) | CUDA/Vulkan/ROCm/CPU **da execução**, não da promessa | `validated` |
| `hardware_constraints` | parcial (`hardware`) | impedir seleção incompatível | `installable`+ |
| `license_scope` | parcial (`license.code`/`weights`) | separar código, pesos e uso comercial | sempre |
| `validation_evidence` | **não** | apontar para o teste real | `validated` |
| `last_verified_at` | sim (`lastVerifiedAt`) | quando a informação foi confirmada | sempre |

### 3.8.1 Estruturas

```json
{
  "model": {
    "modelId": "Qwen/Qwen3.5-4B",
    "revision": "<sha-do-commit-no-hub>",
    "variant": "instruct",
    "family": "Qwen3.5",
    "parameters": "4B",
    "architecture": "Qwen3_5ForConditionalGeneration",
    "releaseDate": "2026-02-27"
  },

  "weights": [{
    "weightsId": "qwen3.5-4b-gguf-q4km",
    "modelId": "Qwen/Qwen3.5-4B",
    "revision": "<sha-do-commit-no-hub>",
    "file": "Qwen3.5-4B-Q4_K_M.gguf",
    "format": "gguf",
    "quantization": "Q4_K_M",
    "sizeBytes": null,
    "sha256": null,
    "license": { "name": "Apache-2.0", "commercialUse": "allowed" },
    "sourceUrl": "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF"
  }],

  "runtime": [{
    "id": "llama.cpp",
    "version": "b6000",
    "backend": "vulkan",
    "backendVerifiedOn": ["gfx803", "gfx1010"],
    "os": ["windows", "linux"],
    "streaming": true
  }],

  "hardwareConstraints": {
    "requiresVramGb": 3.0,
    "fitsCpuOnly": true,
    "unsupportedArch": [],
    "notes": "estimativa Q4 em contexto 8k; nao medido"
  },

  "licenseScope": {
    "code": { "name": "Apache-2.0", "commercialUse": "allowed", "copyleft": "none" },
    "weights": { "name": "Apache-2.0", "commercialUse": "allowed", "copyleft": "none" },
    "integrationDependency": false,
    "obligation": "none"
  },

  "validation": {
    "state": "validated",
    "evidence": [{
      "ficha": "evidence/qwen3.5-4b-vulkan-gfx803.yaml",
      "date": "2026-11-11",
      "machine": "ref-rx580",
      "runtimeVersion": "b6000",
      "backend": "vulkan",
      "result": "pass",
      "notes": "batch 512 corrompido; usar 256"
    }]
  }
}
```

> **Os valores acima são ilustrativos.** `<sha-do-commit-no-hub>`, `null` e
> `"…"` são marcadores: nenhum hash, tamanho ou data neste bloco foi medido. A
> regra vale ao contrário também — campo preenchido com valor não verificado é
> pior que campo `null`.

### 3.8.2 Regras que os campos novos impõem

1. **`revision` vazio ⇒ não pode ser `validated`.** Sem saber o commit, o teste
   não vale como evidência.
2. **`weightsHash` ausente ⇒ não pode ser `installable`.** Baixar "o Q4_K_M" de
   um repositório que muda não é instalar o que foi testado.
3. **`runtimeVersion` vazio ⇒ `validation` não conta.** Vulkan muda entre
   commits; o resultado é daquele binário.
4. **`backend` é da execução, não do modelo.** Um modelo pode ter CUDA `S` e
   Vulkan `p`; o registro precisa dos dois estados, não de um só.
5. **`licenseScope` com `code` e `weights` divergentes ⇒ `commercialUse` é o
   mais restritivo dos dois.** Nunca o mais permissivo.
6. **`validation.state` tem cinco valores:** `none` (nunca rodou), `in-use` (em
   uso no produto, ainda sem teste formal), `validated`, `rejected` e
   `inconclusive`. `in-use` **não** é `validated`.
7. **`integrationDependency: true`** marca os casos em que a licença só é
   problema dependendo de **como** a Lia integra (AGPL). O veredito deixa de ser
   binário.

## 3.9 Compatibilidade por capacidade — multimodal não é tela

A revisão está certa: **aceitar imagem não significa perceber tela continuamente**.
São capacidades distintas e o catálogo passa a tratá-las como tal.

| Capacidade | O que exige | Por que não se deduz do VLM |
|---|---|---|
| `vision.understand` | 1 imagem → texto | é o que todo VLM faz |
| `vision.ocr` | texto exato na imagem | VLM alucina caractere; OCR dedicado não |
| `vision.grounding` | caixa (x,y,w,h) de um elemento | exige treino específico de UI |
| `vision.screen-parse` | árvore de elementos + estado | exige parser de UI, não só imagem |
| `vision.screen-track` | **comparar quadros ao longo do tempo** | exige diff temporal, não 1 frame |
| `vision.multi-monitor` | N telas, coordenadas por monitor | exige gestão de espaço de tela |
| `computer.control` | planejar + executar + verificar | exige executor e política, não só visão |

**Regra de dedução proibida:** `vision.understand` **não** habilita
`vision.screen-track` nem `computer.control`. Cada uma exige entrada própria no
catálogo, com sua própria evidência.

### 3.9.1 Matriz de capacidades visuais por candidato

| Candidato | understand | ocr | grounding | screen-parse | screen-track | control |
|---|---|---|---|---|---|---|
| Qwen3-VL-8B | sim | parcial | **sim** | não | não | não |
| Florence-2-large | sim | parcial | sim (leve) | não | não | não |
| PaddleOCR | não | **sim** | não | não | não | não |
| OmniParser | não | parcial | sim | **sim** | não | não |
| MediaPipe | não | não | não | não | parcial (movimento) | não |
| Playwright | não | não | não | não | não | **sim** (navegador) |

Nenhum candidato cobre a linha inteira. É por isso que `vision.screen-understanding`
é um **pipeline**, não um modelo.

## 3.10 Orquestração decomposta (nove campos, não um)

```json
{
  "kind": "pipeline",
  "capability": "agents.orchestrate",
  "agent": {
    "orchestratorId": "lia-native",
    "modelPlannerId": "chat.reasoning.qwen3.8-27b",
    "modelWorkerIds": ["chat.conversation.qwen3.5-4b"],
    "runtimeId": "lia-main-process",
    "toolIds": [],
    "memoryId": "memory.store.sqlite-vec",
    "budget": { "maxTokens": 0, "maxCalls": 0, "maxCostUsd": 0 },
    "approvalPolicy": "every-destructive-action",
    "reviewPolicy": "none"
  }
}
```

Um framework externo (LangGraph, PydanticAI, Temporal) entra como
`agent.orchestratorId` alternativo — **substituível sem tocar no Core**. O modelo
planejador e os trabalhadores são escolhas separadas, como a revisão pediu.
