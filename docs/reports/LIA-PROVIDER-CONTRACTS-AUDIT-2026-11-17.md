# Contratos de provider — Anthropic e embeddings

**Rodada 21 · 17/11/2026 · branch `arena/7fa837f0-lia-project` · base `3fc7856a`**

Escopo: verificar (a) se a Lia fala o protocolo nativo da Anthropic e (b) se existe
caminho de embeddings no produto, quais providers os implementam, como aparecem no
catálogo e se há teste de contrato. **Nada foi presumido:** cada afirmação abaixo
aponta para o arquivo e a linha que a sustentam no HEAD auditado.

---

## 1. Veredicto

| Pergunta | Resposta | Veredicto |
|---|---|---|
| A Lia fala o protocolo nativo da Anthropic (`/v1/messages`)? | Não. O transporte é OpenAI `/chat/completions`. | **FAIL (antes) → declaração corrigida nesta rodada** |
| A entrada "Anthropic" do catálogo prometia o quê? | `api.anthropic.com/v1/` direto, como se funcionasse. Produz 404 (`POST /v1/chat/completions` não existe). | **FAIL (antes)** |
| Existe suporte a embeddings no produto? | Não. Existe fábrica no pacote vendado e em 5 providers, mas **nenhum consumidor, nenhuma task declarada, nenhum teste**. | **NOT SUPPORTED (correto)** |
| Embeddings aparecem no catálogo da Lia? | Não. `LIA_AI_PROVIDER_CATALOG` tem 2 entradas, ambas de chat. | **PASS (nada anunciado)** |

O que foi alterado nesta rodada é **uma declaração**, não uma capacidade nova:
não foi escrito adaptador Anthropic nem caminho de embeddings. Inventar suporte
seria pior que não ter.

---

## 2. Anthropic — cadeia de evidência

O AIRI vendado (`airi/packages/stage-ui/src/libs/providers/providers/anthropic/index.ts`)
monta o provider assim:

```ts
createChatProvider({ apiKey, fetch: anthropicFetch, baseURL })
```

`createChatProvider` não fala HTTP por conta própria; ele só devolve as opções
(`@xsai-ext/providers/dist/utils/index.js:1`). Quem escolhe a rota é o cliente
de geração de texto do pacote `@xsai/shared-chat`:

```js
// @xsai/shared-chat@0.5.0-beta.8/dist/index.js:3
const chat = async (options) => postJSON("chat/completions", { ...options, ... })
```

Com `baseURL = https://api.anthropic.com/v1/` o resultado é
`POST https://api.anthropic.com/v1/chat/completions`. A API nativa da Anthropic
expõe `/v1/messages`, com corpo diferente (`system` fora de `messages`,
`max_tokens` obrigatório, blocos de conteúdo). **O endpoint simplesmente não
existe.** Não é uma diferença de dialeto: é 404.

Mesmo assim a entrada se apresentava como `description: 'anthropic.com'` e
oferecia uma Base URL padrão apontando para o host nativo — configuração que
falha na primeira mensagem.

### Correção aplicada

Somente a declaração mudou. A entrada continua no catálogo porque **um gateway
que traduza OpenAI → Messages funciona com ela** (é o mesmo caso do
"OpenAI-compatível"); o que não pode é prometer acesso direto.

- `description`: `'Requer gateway compatível com OpenAI (a API nativa usa /v1/messages)'`
- comentário no arquivo registrando a razão, para não ser "corrigido de volta"
  numa próxima atualização upstream.
- teste novo `anthropic/index.test.ts` (3 casos) travaria a regressão da
  declaração.

O teste garante o que dá para garantir offline: **a promessa**. Ele não prova
que um gateway funciona — isso exige um gateway real e não foi executado.

### O que seria necessário para suporte nativo (não implementado)

Um protocolo novo no contrato de transporte do produto, que hoje só conhece
três valores:

```ts
// lia/core/src/transports/contracts.ts:9
protocol: 'chat-completions' | 'audio-speech' | 'audio-transcription'
```

e em `lia/core/src/providers/contracts.ts:12` a definição só aceita
`chat-completions`. Um adaptador Anthropic exigiria `'messages'` nessa união,
validação própria em `transports/validation.ts:60`, tradutor de corpo/streaming
e testes de contrato. **Fora do escopo desta rodada por decisão de escopo, não
por impedimento técnico** — e sem isso a Lia não deve aparecer em lugar nenhum
como "suporta Anthropic".

---

## 3. Embeddings

### 3.1 O que existe

- `@xsai-ext/providers` exporta `createEmbedProvider`
  (`dist/utils/index.js:7`) — é uma capacidade da biblioteca, não do produto.
- Cinco providers vendados constroem a fábrica: `302-ai` (`index.ts:46`),
  `aihubmix` (`index.ts:49`), `lm-studio` (`index.ts:47`), além do
  repasse em `azure-openai` (`index.ts:254`).
- O classificador de metadados conhece a categoria
  (`providers/metadata.ts:10,58`) via `tasks: ['embed' | 'embedding']`.

### 3.2 O que **não** existe

- **Nenhum provider declara a task.** Varredura de todas as entradas do
  catálogo vendado: `chat` 34×, `text-to-speech` 17×, `speech-to-text` 6×,
  `tts` 4×, `streaming-transcription` 4×, `text-generation` 1× — **`embed`
  aparece zero vezes**. Logo `getProviderCategory()` nunca retorna `'embed'`
  em produção: o galho é inalcançável.
- **Nenhum consumidor.** A única chamada de `.embed(` fora do passthrough do
  Azure está comentada (`Stage.vue:1072`, bloco de teste com
  `Xenova/nomic-embed-text-v1`). Não há índice vetorial, tabela com vetor,
  busca por similaridade nem migração de memória.
- **A memória do produto é lexical e declara isso.** 
  `src/shared/lia/memory-context.ts:10`:
  *"Lexical retrieval only: no chat history, extraction, embeddings or network."* —
  score por termos em comum, sem vetores.
- **Não há teste de contrato.** Nenhum teste exercita `embed`, corpo de
  requisição, resposta nem dimensão. Os únicos testes de provider são de chat,
  STT e TTS.
- **Não está no catálogo da Lia.** `LIA_AI_PROVIDER_CATALOG`
  (`lia/core/src/providers/catalog.ts`) tem `groq` (ready) e
  `openai-compatible` (unavailable, por falta de prova ponta a ponta). Nenhuma
  entrada de embedding, nenhum campo de dimensão.

### 3.3 Consequência

Se a Lia algum dia usar embeddings, o caminho **não** pode ser "reaproveitar o
que já existe": seria preciso escolher o modelo (a pesquisa aponta
`bge-m3` MIT como candidato, `Qwen3-Embedding-0.6B` Apache como leve — ver
`LR-MODEL-005`), declarar a task no provider, criar índice, definir formato de
armazenamento/dimensão/migração, tratar troca de modelo como invalidação do
índice e escrever testes de contrato. **Nada disso foi iniciado**, e o produto
não anuncia nada disso hoje — o estado atual está correto por omissão.

---

## 4. O que esta auditoria não prova

- Não foi feita chamada real à Anthropic (sem credencial, e o repositório não
  deve conter chave). A conclusão vem do código do cliente HTTP, não de um
  teste de integração.
- Não foi testado nenhum gateway OpenAI→Messages. A declaração nova diz
  "requer gateway", não "funciona com gateway".
- Não foi medido consumo de VRAM/CPU de nenhum modelo de embedding — não há
  caminho para medir.

## 5. Registro de pesquisa

Consultado `LR-MODEL-005` (embeddings leves, licenças e limites) via índice do
Lia-Research. Conclusão de pesquisa **não autoriza implementação**.

## 6. Arquivos tocados

| Arquivo | Mudança |
|---|---|
| `airi/packages/stage-ui/src/libs/providers/providers/anthropic/index.ts` | descrição + comentário de razão |
| `airi/packages/stage-ui/src/libs/providers/providers/anthropic/index.test.ts` | novo, 3 casos |
| `docs/airi-modificacoes-registro.md` | adendo datado (patch sobre upstream) |
| `docs/reports/LIA-PROVIDER-CONTRACTS-AUDIT-2026-11-17.md` | este relatório |

Testes: `vitest run src/libs/providers/providers/anthropic/index.test.ts`
→ **3/3 PASS** (`packages/stage-ui`).
