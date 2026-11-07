# Lia — cobertura nativa dos provedores de chat (Corte B)

**Estado:** implementado em código na branch `arena/01a10290-lia-project`, sem commit
nem push. Base de trabalho: `c3d2186517fd44946a413de06f79e3bb3a13c4fd`.
**Escopo:** os dez provedores de chat curados da Lia executam no processo main do
Electron; o renderer deixa de receber credencial para eles.
**Referências:** [`LIA-NEXT-DECOUPLING-PLAN.md`](LIA-NEXT-DECOUPLING-PLAN.md) (plano do
PROMPT-22, preservado como registro da investigação),
[`LIA-PROVIDER-RUNTIME-2026-10-30.md`](LIA-PROVIDER-RUNTIME-2026-10-30.md).

---

## 1. O que mudou, em uma frase

Antes, o renderer montava o cliente HTTP do provedor com a chave do cofre em mãos;
agora ele monta um *shim* que encaminha a requisição por IPC, e o main resolve
endpoint, credencial, headers e execução — devolvendo apenas bytes de resposta.

O caminho é o mesmo transporte próprio já existente
(`lia/core/src/transports/` + `main/services/lia/transport-execution-service.ts`).
**Não foi criado segundo sistema de transportes**, e nenhum contrato de
`lia/core` foi alterado.

---

## 2. Catálogo curado (fonte única)

`airi/apps/stage-tamagotchi/src/shared/lia/provider-catalog.ts`

```ts
CURATED_CHAT_PROVIDER_IDS = [
  'openai', 'groq', 'cerebras-ai', 'anthropic', 'xai',
  'mistral-ai', 'openrouter-ai', 'openai-compatible', 'lm-studio', 'ollama',
]
isCuratedChatProvider(id)  // predicado
```

Antes desta fatia a mesma lista de dez IDs existia em três arquivos (renderer
`transport-config.ts`, renderer `provider.ts` e main
`transport-execution-service.ts`). Agora os três delegam ao catálogo. O arquivo é
data-only: não contém endpoint, chave, modelo nem fábrica.

**Regra que define a lista:** o provedor fala `POST <baseUrl>/chat/completions`
com `Authorization: Bearer` e declara `tasks: ['chat']` em
`packages/stage-ui/src/libs/providers/providers/<id>/index.ts`.
Todos os dez declaram `tasks: ['chat']` (verificado por grep nos dez diretórios);
nenhum provedor de *speech* está nesta lista.

---

## 3. Migrados × pendentes

| Provedor | `baseUrl` padrão | Fábrica AIRI | Executa no main | Nota |
|---|---|---|---|---|
| `openai` | `https://api.openai.com/v1` | `createOpenAI` | sim | — |
| `groq` | `https://api.groq.com/openai/v1/` | `createOpenAI` | sim | escopo também usado pela transcrição (ver §6) |
| `cerebras-ai` | `https://api.cerebras.ai/v1/` | `createCerebras` | sim | — |
| `anthropic` | `https://api.anthropic.com/v1/` | `createChatProvider` + `fetch` próprio | sim | ver §4.2 |
| `xai` | `https://api.x.ai/v1/` | `createXai` | sim | — |
| `mistral-ai` | `https://api.mistral.ai/v1/` | `createMistral` | sim | — |
| `openrouter-ai` | `https://openrouter.ai/api/v1/` | `createOpenRouter` | sim | headers Lia (§4.3) |
| `openai-compatible` | `https://api.openai.com/v1` | `createOpenAI` | sim | chave opcional |
| `lm-studio` | `http://localhost:1234/v1/` | `merge(chat, embed, model)` | sim | keyless |
| `ollama` | `http://localhost:11434/v1/` | `createOllama('')` | sim | keyless; `reasoningEffort` por `thinkingMode` |

**Pendentes fora da lista:** todos os demais provedores que a interface AIRI
oferece (ex.: `deepseek`, `together-ai`, `fireworks`, `moonshot`, etc.). Eles
continuam no caminho legado — por desenho: o corte migrou os dez que a Lia
apresenta, sem restringir a oferta. Um ID não curado **não** perde acesso; apenas
não ganha a fronteira nova.

**Restrição preservada:** IDs personalizados e endpoints personalizados continuam
aceitos. `openai-compatible` e uma entrada arbitrária em
`settings/providers/configured` geram registro de transporte com o `baseUrl` do
usuário (`legacyTransportCandidates` + `toTransportRecord`). Nenhuma lista
fechada de IDs é aplicada na entrada.

---

## 4. Fronteira de credencial

### 4.1 O caminho do segredo

1. O renderer guarda a chave **uma vez**, via `LiaProviderConfig.vue.save()` →
   `secretSet`.
2. `main` grava no cofre (`safeStorage`) e **nunca devolve** o valor para escopos
   curados (`canRendererReadLegacySecret`).
3. No envio, o renderer cria `Response` sintético e chama
   `eventa:invoke:lia:transport:start` com `{ providerId, operation, body, draft? }`.
   `body` é allowlist de chaves de chat (`chatKeys`), ≤ 16 MiB.
4. O main lê a chave do cofre **em processo**, aplica
   `Authorization: Bearer …`, remove `draft.apiKey` do objeto após montar os
   headers e nunca o inclui em erro, log ou chunk.
5. Streaming volta como chunks ≤ 64 KiB; erro volta como
   `{ ok: false, code, status? }` — sem mensagem de upstream e sem corpo.

`draft` existe para o caso de um envio que ainda não tem registro persistido
(primeiro uso antes da gravação). A chave vive **no payload IPC**, não em
`localStorage`, e o main a descarta depois de montar a requisição.

### 4.2 Fim de `withResolvedCredential` para os curados

`renderer/stores/lia/provider.ts` → `registerRuntimeExtensions()`:

- antes: `installChatFactory(async id => native(id) ?? previous(id, options))` —
  fallback silencioso para a fábrica AIRI, que resolvia a chave no renderer;
- agora: para um provedor curado, o factory **lança**
  `ProviderError('configuration')` se o runtime nativo não puder atender.

Prova: `native-provider-migration.test.ts` →
`'fails a curated provider closed instead of delegating to the legacy executor'`
(espera `rejects` com `code: 'configuration'` e confirma que `secretGet` e o
executor legado **não** foram chamados).

### 4.3 Headers que a Lia acrescenta

`main/services/lia/provider-request-headers.ts` — o único lugar que adiciona
header próprio, porque é o único processo que vê o ID do provedor e o endpoint
juntos.

| Provedor | Header | Por quê |
|---|---|---|
| `openrouter-ai` | `X-OpenRouter-Title: Lia` | identidade própria; **sem** `HTTP-Referer` (não há site público a declarar) |
| `anthropic` | `anthropic-dangerous-direct-browser-access: true` | preserva byte a byte o `fetch` que a definição AIRI sempre usou |

Antes, o OpenRouter recebia `HTTP-Referer: https://airi.moeru.ai/` e
`X-OpenRouter-Title: Project AIRI` (constante `OPENROUTER_ATTRIBUTION_HEADERS` da
definição compartilhada). A identidade foi trocada por um título neutro,
configurável em uma linha, **sem inventar domínio**. `Authorization` nunca vem
desta tabela: nomes reservados são descartados e o runtime do `lia/core` define a
credencial a partir do cofre.

Nenhum registro de transporte pode trazer `headers`: `isTransportRecord`
(`lia/core/src/transports/validation.ts`) rejeita a chave.

### 4.4 Leitura pelo renderer

`main/services/lia/transport-config-service.ts` → `canRendererReadLegacySecret`:

- **nega** todo ID curado — chat deles executa no main; o renderer não tem uso
  para a chave;
- **nega** todo escopo coberto por registro, tombstone ou
  `protectedCredentialScopes`, e tudo quando o snapshot declara
  `credentialProtectionIncomplete`;
- **falha fechado** se o snapshot não puder ser lido;
- **exceção única e nomeada:** `groq`, porque a transcrição da escuta ainda
  resolve credencial no renderer (`lia-groq-transcription` →
  `CREDENTIAL_SCOPE_ALIASES`). É dívida de outra fatia, com dono explícito e
  tamanho fixado em teste (`LIA_RENDERER_READ_EXCEPTIONS`).

---

## 5. Follower-only

`renderer/App.vue` chamava `registerRuntimeExtensions()` **apenas** na janela com
`leadership === 'leader-only'`. Como a ponte de chat morava dentro dessa chamada,
a janela `#/chat` (`leadership: false`) caía no executor legado: montava o cliente
sem resolvedor de credencial registrado e enviava requisição **sem**
`Authorization` — 401 que nenhum teste de líder via.

Separação aplicada:

| Função | Onde roda | O que faz |
|---|---|---|
| `registerChatTransport()` | **toda** janela | instala a ponte de chat (não lê credencial, não escreve estado compartilhado) |
| `registerRuntimeExtensions()` | só líder | resolvedor de credencial do cofre, cadeia de fallback, chamada única da ponte |

`registerRuntimeExtensions()` continua existindo e agora **começa** chamando
`registerChatTransport()`; `App.vue` chama a ponte antes do `if` de liderança.
Idempotência por instância de store (`WeakMap` em `installChatFactory`).
Teste: `follower-window-chat.test.ts` — três casos, um deles provando que a
instalação dupla não encaminha a requisição duas vezes.

---

## 6. Compatibilidade e limitações

**Preservado:** streaming (chunks + fim), cancelamento (`cancel` + abort),
timeout, erros sanitizados, concorrência entre conversas (jobs com dono e teto),
descarte de transporte e fechamento de janela, endpoints e IDs personalizados,
opções de adapter (`temperature`, `nested`, etc. — exceto chaves de credencial),
configurações por provedor, escolha de modelo.

**Limitações conhecidas:**

1. **`groq` continua legível pelo renderer** (transcrição). O chat de `groq` não
   usa esse canal — o teste de migração nativa prova `secretGet` não chamado.
2. **Anthropic**: a Lia reproduz a suposição da definição AIRI (`POST
   https://api.anthropic.com/v1/chat/completions`). A superfície nativa da
   Anthropic é `/v1/messages`; **não foi verificado contra a API real** nesta
   rodada, nem antes dela. O corte não piorou nem melhorou esse ponto: mesma URL,
   mesmo formato, mesmo header extra. Corrigir é trabalho de adapter de
   protocolo, fora do escopo.
3. **`ollama`** acrescenta `reasoningEffort` a partir de `thinkingMode` e **não**
   repassa `headers`; isso é comportamento da definição e não foi provado por
   execução nesta rodada.
4. **Janela follower antes do líder**: se `#/chat` abrir antes de o líder gravar
   o registro de transporte, o envio falha **alto**
   (`ProviderError('configuration')`) em vez de seguir sem autenticação. É o
   comportamento desejado, mas é uma mudança observável.
5. **Modelos**: a listagem (`listModels`) continua no caminho legado em
   `voice-editor.ts`; não foi migrada.
6. **Stage completo, modelo externo e instalador**: não executados.

---

## 7. Limpeza do `localStorage` (credencial antiga)

O estado que existia: a chave vivia em dois blobs do store compartilhado,
`settings/credentials/providers` e `settings/providers/configured`, e a migração
para o cofre **não removia** a cópia — o texto claro sobrevivia no LevelDB do
Chromium depois de a chave já estar no cofre.

Como ficou:

1. o renderer pede ao main para **adotar** o valor
   (`eventa:invoke:lia:secret:adopt`);
2. o main compara **em processo** e responde só uma palavra:
   `stored` \| `matching` \| `conflict` \| `unavailable`;
3. **somente** `stored`/`matching` habilitam a remoção
   (`renderer/services/lia/legacy-credential-cleanup.ts`), que:
   - remove só o campo `apiKey` do provedor afetado, preservando `baseUrl`,
     modelos e demais opções;
   - escreve no blob **e** na cópia reativa do store (a ref é *deep-watched* e o
     mapa é re-serializado na próxima escrita — limpar só o `localStorage` seria
     desfeito);
   - é idempotente (segunda passada não escreve);
   - nunca apaga a única cópia: `conflict` deixa tudo como está e `unavailable`
     reorganiza a tentativa para o próximo boot.

Casos tratados: só-chave-antiga (adota e limpa), já-no-cofre com valor igual
(`matching`, limpa), já-no-cofre com valor **divergente** (`conflict`, não
sobrescreve, não limpa), cofre indisponível (`unavailable`, não cria registro e
tenta de novo).

---

## 8. Testes realmente executados

Comando (`airi/`):

```bash
node node_modules/vitest/vitest.mjs run --config apps/stage-tamagotchi/vitest.config.ts \
  --project node src/renderer/stores/lia src/renderer/services/lia \
  transport-execution-service.test.ts secrets-service-bridge.test.ts \
  provider-config-service.test.ts transport-config-service.test.ts secrets.test.ts
```

| Conjunto | Resultado |
|---|---|
| Pacote acima (49 arquivos) | **643 passed, exit 0** |
| `src/renderer/stores/lia` isolado | **398 passed / 34 arquivos, exit 0** |
| `vue-tsc --noEmit` (stage-tamagotchi) | **exit 0**, sem erros |
| ESLint nos arquivos tocados | exit 0 após correções nos próprios arquivos |
| `Core` (`lia/core`) | **não executado nesta rodada** (nenhum arquivo de `lia/` foi alterado) |
| Chromium/browser, build Stage, Electron real | **não executados** |

Contagem anterior de referência (38 arquivos / 449 casos) **não** foi usada como
resultado desta rodada: foi reproduzida no início e depois medida de novo.

Testes novos, por garantia que cobrem:

| Arquivo | Garantia |
|---|---|
| `main/services/lia/transport-config-service.test.ts` (17) | todo curado negado ao renderer, inclusive sem registro; exceção única fixada; falha fechada |
| `main/services/lia/provider-request-headers.test.ts` (6) | OpenRouter sem identidade AIRI e sem referer; `Authorization` intocado; mesmo `fetch` quando não há o que adicionar |
| `main/services/lia/secrets-service-bridge.test.ts` (+5) | `adopt`: `stored`/`matching`/`conflict`/`unavailable`, sem devolver valor |
| `renderer/services/lia/legacy-credential-cleanup.test.ts` (7) | remoção cirúrgica, idempotente, resistente a storage hostil |
| `renderer/stores/lia/follower-window-chat.test.ts` (3) | janela sem resolvedor conversa via main; líder mantém tudo; ponte idempotente |
| `renderer/stores/lia/provider-config-facade.test.ts` (+2) | `replaceConfig` é local e não faz PATCH |

Testes existentes ajustados por mudança de contrato (não por conveniência):
`runtime-wiring` (inverte a asserção: agora prova *ausência* de credencial no
renderer), `native-provider-migration` (fallback legado → falha fechada),
`provider-config-write-paths` (fixture de `groq` para `deepseek`, porque `groq`
virou curado e não escreve config remota), `transport-configuration`
(adoção via `adopt` em vez de `set onlyIfMissing`).

---

## 9. Riscos abertos

1. **Exceção `groq`**: um provedor curado ainda é legível pelo renderer por causa
   da transcrição. Enquanto existir, a afirmação "nenhuma credencial de provedor
   curado chega ao renderer" é verdadeira **para chat**, não para o produto
   inteiro.
2. **`draft.apiKey` no IPC**: a chave atravessa o IPC no primeiro envio de um
   provedor ainda sem registro. É o mesmo canal que já transportava a chave; a
   diferença é que agora o main a descarta e o renderer não recebe nada de volta.
   Migrar esse caminho para "grava primeiro, envia depois" está na próxima fase.
3. **Anthropic não verificada** contra a API real — ver §6.2.
4. **`telemetria`**: a identidade neutra (`Lia`) é uma decisão de produto tomada
   aqui; se a Lia ganhar um domínio público, ele entra nesta tabela.
5. **Nenhum gate de runtime nesta rodada**: nada foi executado em Electron real.
   Verde automatizado não é gate de runtime.

---

## 10. Próxima etapa sugerida

1. Migrar a transcrição (`groq`) para o main e **remover** a exceção de leitura,
   fechando §9.1.
2. Eliminar `draft.apiKey` do protocolo IPC (§9.2): gravar o registro antes do
   primeiro envio.
3. Adapter de protocolo para Anthropic `/v1/messages` — decisão de produto, não
   correção deste corte.
4. Gate Electron real com os dez provedores apontando para servidor local
   (streaming, cancelamento, concorrência e fechamento de janela) — hoje só
   coberto por testes de unidade e por um serviço de transporte real em Node.

---

## 11. PROMPT-24 — credenciais fechadas e gate Electron ampliado (01/11/2026)

Escopo desta seção: **somente o que esta rodada mediu**. As seções 1–10 são o
registro da rodada anterior e não foram reescritas; onde esta rodada contradiz
uma limitação antiga, a contradição é declarada explicitamente (§11.5).

### 11.1 Primeiro envio sem `draft.apiKey` — fechado

`LiaTransportStartRequest.draft` carrega **apenas `baseUrl`**. O serviço do main
rejeita qualquer campo de credencial no `draft` com `ProviderError('configuration')`
**antes** do primeiro `fetch` e **antes** de tocar o cofre
(`validateStart` → `keys(draft) ⊆ ['baseUrl']`). A credencial só existe em
`vault.getSecret(record.credentialRef.scope, 'apiKey')`, sob `mayUseVault`.

Ordem no renderer (`prepareNativeExecution`): `secretSet(scope=providerId,
key='apiKey')` → `ensureProviderRecord` → confirmação de que o registro está
habilitado → só então a execução. Falha em qualquer passo vira
`ProviderError('credentials' | 'configuration')` e nada é enviado. `putRecord`
converge por CAS (`refresh` + re-decisão), sem retry cego.

Provado por `first-send-credential.test.ts` (**9 casos**), incluindo: primeiro
envio de provedor sem registro, falha ao gravar a credencial, falha ao persistir
o registro, repetição idempotente e duas configurações concorrentes. O payload de
execução é inspecionado verbatim e não contém `apiKey`.

### 11.2 Transcrição `groq` no main — fechado

- `RENDERER_READ_EXCEPTIONS` **deixou de existir**. `canRendererReadLegacySecret`
  nega **todos** os curados, com ou sem registro, e todo scope com registro ou
  tombstone (`transport-config-service.test.ts`, **17 casos**, inclui `groq`
  negado nos dois estados).
- O resolver de credencial do renderer recusa `lia-groq-transcription` **antes**
  de chamar o cofre; `groq` (chat) continua resolvendo normalmente.
- `prepareTranscriptionExecution` garante o registro de `groq` **sem endpoint
  explícito** (o endpoint vem do registro/enriquecimento padrão) e registra o
  executor de gravação. Sem executor, o pipeline xsai original segue intacto.
- `transcribeThroughMain` → `lia:transcription:run` com payload de chaves
  exatamente `['bytes','fileName','language','mimeType','model','providerId']`,
  sem endpoint e sem credencial. O main resolve o **único** registro habilitado +
  `vault.getSecret` e faz `POST {baseUrl}audio/transcriptions` multipart,
  preservando bytes, nome, mime, modelo, `responseFormat`,
  `timestamp_granularities[]`, `language`, `prompt` e `temperature`.
- Erros: `401/403` → `credentials`; registro ausente/desabilitado/ambíguo/tombstone
  → `configuration`; corpo inválido ou sem texto → `protocol`; sem credencial não
  há requisição de rede. Nenhum caminho ecoa o segredo.
- **Cancelamento**: o caminho de transcrição de arquivo **nunca teve** cancelamento
  do chamador — `transcribeForRecording` não passa `AbortSignal` nem no ramo do
  executor nem no ramo legado (os `abortSignal` de `hearing.ts` pertencem aos
  caminhos de streaming). Nada foi perdido; o main impõe um deadline próprio e o
  estouro vira `timeout`. Se o produto quiser cancelar uma transcrição em voo,
  é contrato novo, não regressão.

Medido: `main/services/lia/transcription-service.test.ts` **9 casos** (servidor
HTTP real em socket, incluindo isolamento entre execuções concorrentes e ausência
do segredo no resultado), `renderer/stores/lia/transcription-bridge.test.ts`
**5 casos**, `hearing.test.ts` **30 casos** (3 testes de alias reescritos para a
nova regra: o alvo derivado não resolve nada no renderer).

### 11.3 Gate Electron — escrito e ampliado, **NÃO executado**

O gate real continua em `scripts/provider-runtime-electron/gate.test.mjs`
(Playwright `_electron`, hoje com `skip: process.platform !== 'win32'`). Nesta rodada ele foi **ampliado** para os
dez curados:

- `index.html` passou a oferecer as dez opções de serviço;
- `renderer.ts` ganhou `seedRecords`, `executeProvider`, `concurrent` e
  `disposeAndExecute`, todos sobre a ponte de produção;
- o fixture HTTP autentica **cada provedor com a sua própria credencial**
  sintética (segmento de path = id do provedor), registra `authorization` como
  `present`/`absent` (nunca o valor) e `x-openrouter-title`, e ganhou a rota
  `/unavailable/` (503 com o segredo no corpo);
- o bloco novo verifica, para os dez: execução JSON e streaming no endpoint
  próprio, modelo correto por registro, `Authorization` presente só nos oito com
  chave (`lm-studio`/`ollama` sem header), `X-OpenRouter-Title: Lia` só em
  `openrouter-ai`, leitura bruta do cofre negada para todos, `readScopes` do main
  contendo cada escopo com chave, cinco execuções concorrentes isoladas,
  503 sanitizado (`http`, sem corpo), cancelamento fechando o socket e porta
  descartada recusando envio (`cancelled`).

**Não executado.** Não há binário do Electron no ambiente (`electron@43.4.1`
está em `node_modules` sem `dist/`; o download do asset responde 302 e falha em
`objects.githubusercontent.com`, exit 35) e o gate existente exige Windows
(`skip: process.platform !== 'win32'`, `powershell.exe`, `dist/electron.exe`).
Adaptá-lo a Linux exigiria reescrever a enumeração de processos e ainda assim não
haveria binário. **O gate não foi substituído por testes de unidade**; os testes
de unidade e o servidor HTTP local em Node cobrem o serviço, não a aplicação.

### 11.4 `listModels` — auditado, dívida documentada, descoberta mantida

- A descoberta dinâmica **não foi removida** nem trocada por tabela estática.
- Para os dez curados, `useLiaProviderStore().discoverModels` executa no main:
  `nativeRuntime.discover` → `execution.discover` → `POST`/`GET` de modelos pelo
  transporte, credencial resolvida do cofre do main. O canal de leitura do
  renderer (`secretGet`) **não é chamado**. Provado por
  `model-listing-scope.test.ts` (**11 casos**: os dez curados um a um + um caso
  que fixa a dívida legada).
- Migrabilidade: `ensureProviderRecord` aceita o endereço digitado, o salvo no
  registro, o salvo na config compartilhada e, por último, o default do schema do
  provedor — esta última é o que torna um provedor curado migrável sem o usuário
  redigitar endpoint.
- Cache/fallback: `providerRuntimeState[providerId].models` é cache **em memória**
  da UI, sem persistência; `refreshModelsForChangedCredentials` descarta a
  instância quando a credencial muda. `discoveryPending` deduplica somente
  requisições **em voo** e é limpo no `finally` — não há cache de resultado no
  store da Lia.
- **Dívida que continua**: o seletor genérico do AIRI
  (`providerStore.fetchModelsForProvider`, usado por `consciousness`, `hearing` e
  `vision`) resolve credencial no renderer via `withResolvedCredential`. Para um
  curado, o main agora nega a leitura e o resolver devolve `undefined`, então essa
  listagem sai **sem autenticação** — não há vazamento, mas a lista pode falhar
  (401) nesse caminho. Provedores fora do catálogo seguem resolvendo no renderer,
  como antes. Fechar isso exige migrar aquele consumidor; não foi feito aqui.

### 11.5 Anthropic — evidência corrigida, ainda **não validada**

A rodada anterior registrou (§6, "Limitações conhecidas", item 2) que a Lia reproduzia uma "suposição"
de `/v1/chat/completions`. A evidência desta rodada mostra que a rota **existe**:

- `GET https://api.anthropic.com/v1/chat/completions` → `405 Method Not Allowed`
  (`invalid_request_error`), enquanto um path inexistente no mesmo host devolve
  `404 not_found_error`. Ou seja, a rota é roteada e recusa o método, não o path.
- A documentação pública da Anthropic descreve a camada OpenAI-compatible em
  `https://api.anthropic.com/v1/` com `chat/completions` e `Authorization: Bearer`,
  **explicitamente como camada de avaliação**, com limites: `n` deve ser 1,
  `temperature` restrita em modelos novos, campos ignorados (`logprobs`,
  `response_format`, `seed`, …) e suporte a "thinking" só via `extra_body`.

O que continua **não validado**: um `POST` real com chave real (proibido nesta
rodada), o comportamento de `reasoning`/`thinking` pelo conector nativo, e se o
header `anthropic-dangerous-direct-browser-access: true` — herdado da definição
AIRI e hoje inútil no main (Node, não browser) — é aceito ou ignorado.
**Endpoint não foi alterado por suposição.** Validação isolada proposta:
uma instância com chave sintética contra um servidor local que imite o formato
OpenAI (feito), mais um teste manual e pago do Dev com **uma** requisição curta e
`n=1`, registrando status e `choices[0]` sem logar a chave.

### 11.6 Executado nesta rodada (números medidos)

| Verificação | Resultado |
|---|---|
| `stores/lia` + `services/lia` (renderer) + `main/services/lia` | **88 arquivos / 1488 casos, exit 0** |
| `packages/stage-ui` (`hearing.test.ts` + `libs/providers`) | 23 arquivos / 140 casos, exit 0 |
| `main/services/lia/curated-providers-local-http.test.ts` (novo) | 21 casos, exit 0 |
| `renderer/stores/lia/model-listing-scope.test.ts` (novo) | 11 casos, exit 0 |
| `main/services/lia/transcription-service.test.ts` (novo) | 9 casos, exit 0 |
| `vue-tsc --noEmit` do Stage | exit 0 |
| ESLint nos arquivos tocados | exit 0 |
| Gate Electron real | **não executado** (sem binário, Windows-only) |
| Stage completo, modelo externo, Chromium, instalador | **não executados** |

Correções de tipo encontradas por `vue-tsc` nesta rodada e corrigidas em produção:
o corpo multipart da transcrição precisava de um `ArrayBuffer` copiado (o
`FormData` não aceita `Uint8Array<ArrayBufferLike>`).

### 11.7 Riscos que continuam abertos

1. **Nenhum gate de runtime executado.** Verde automatizado não substitui a
   aplicação real; o gate está escrito e ampliado, não executado.
2. **Seletor genérico de modelos do AIRI** (§11.4): listagem de curado sai sem
   autenticação nesse caminho.
3. **Provedores fora do catálogo** continuam resolvendo credencial no renderer.
4. **Anthropic**: camada OpenAI-compatible existe, mas não foi exercitada de ponta
   a ponta com chave real; limites de parâmetros podem mudar sem aviso.
5. **Janela follower aberta antes do líder** falha alto (`configuration`) — é o
   comportamento desejado, mas é observável.
6. **Transcrição sem cancelamento do chamador** (§11.2): só deadline no main.

---

## 12. PROMPT-25 — descoberta genérica, follower-only e auditoria de credenciais (01/11/2026)

Escopo: **somente o que esta rodada mediu**. §1–§11 são histórico e não foram
reescritos. Onde esta rodada contradiz uma limitação anterior, a contradição é
declarada (§12.6).

### 12.1 Gate Electron — **não executado**, causa exata e alternativa

O gate de `scripts/provider-runtime-electron/gate.test.mjs` continua escrito e
ampliado (dez curados, §11.3). Nesta rodada ele **não rodou**. Investigação:

| Verificação | Resultado |
|---|---|
| Versão declarada | `electron: ^43.4.1` no catálogo do workspace; lockfile resolve `43.4.1` |
| Pacote no `node_modules` | presente (`electron@43.4.1`), com `checksums.json`, **sem `dist/` e sem `path.txt`** |
| Cache local do runtime | nenhum zip/`dist` em `~/.cache/electron` nem no store do pnpm |
| Asset oficial | `…/download/v43.4.1/electron-v43.4.1-linux-x64.zip` responde **302** para `objects.githubusercontent.com` / `release-assets.githubusercontent.com`, e o TLS desse host falha (`curl: (35) SSL_ERROR_SYSCALL`). Host fora da rede permitida deste ambiente |
| Display | Linux sem `DISPLAY`, sem Xvfb |
| Plataforma do gate | `skip: process.platform !== 'win32'`; o teardown usa `Get-CimInstance` e `dist/electron.exe` |

Ou seja: faltam **as duas** coisas — o binário e a plataforma. Nenhuma delas se
resolve sem mudar versão/lockfile (proibido), sem baixar de host não oficial
(proibido) ou sem reescrever a prova de processos para outro sistema operacional
(o que ainda assim deixaria o gate sem binário). **O gate não foi substituído por
testes de unidade.**

Procedimento oficial e reproduzível, registrado para o Windows do Dev (também no
cabeçalho do próprio gate):

1. `pnpm --filter @proj-airi/stage-tamagotchi exec node node_modules/electron/install.js`
   — instala o asset da **versão travada** com verificação de `checksums.json`;
2. `pnpm --filter @proj-airi/stage-tamagotchi build` — gera `out/preload`, que o
   gate lê;
3. `node --test scripts/provider-runtime-electron/gate.test.mjs` a partir do
   pacote.

### 12.2 Descoberta genérica de modelos — **migrada para o Main**

Antes: `providerStore.fetchModelsForProvider` (o seletor compartilhado usado por
`consciousness`, `hearing`, `vision` e o editor de voz) sempre passava por
`withResolvedCredential` + `listProviderModels`, que resolvia a chave no renderer
e construía um cliente xsai com ela.

Agora existe **um único slot opcional** no mesmo módulo de extensões já usado por
crédito e fallback (`chat-provider-runtime.ts`):
`registerProviderModelLister`. A regra é explícita:

- `undefined` = **o host não é dono deste id** → caminho legado roda byte a byte
  como antes (inclusive a saída antecipada "sem config, sem lista");
- **array** = o host é dono (mesmo vazio) → **não há fallback**. Uma falha vira
  `modelStatus: 'error'`, nunca um cliente autenticado construído aqui.

A Lia registra o lister dentro de `registerChatTransport()`, que `App.vue` chama
em **toda** janela (líder e follower): a listagem não lê credencial, então não há
motivo para ser líder-only. O lister executa `discoverModels`, que já garantia
registro persistido + descoberta pelo transporte do Main.

Provado por `model-listing-host.test.ts` (**4 casos**) e por
`model-listing-scope.test.ts` (**11 casos**, um por curado): o factory do
renderer não é chamado, `secretGet` não é chamado, o modelo escolhido e os IDs
personalizados permanecem, e a dívida legada (provedor fora do catálogo) fica
fixada como dívida — não como garantia.

### 12.3 Janela follower-only aberta antes da líder — **recuperada, sem segunda fonte de verdade**

Causa raiz encontrada: o registro de transporte só era criado pelo caminho de
**configuração** (tipicamente a janela líder). Um follower aberto primeiro tinha
o repositório do Main vazio, e o factory de chat exigia registro existente —
logo, `ProviderError('configuration')` em todo envio. Não era falta de
credencial, nem de liderança: era ordem de janelas.

Correção: o factory, ao ver um **id curado sem registro**, chama
`ensureCuratedRecordAvailable`, que:

1. só age se houver **endpoint configurado pelo usuário** (o `baseUrl` salvo na
   config compartilhada, replicada para todas as janelas, ou já no registro).
   Sem ele, para em `configuration` em vez de inventar host;
2. cria o registro pelo **mesmo** `ensureProviderRecord` usado pela líder, no
   **mesmo** repositório do Main, **sem credencial**;
3. relê o snapshot; se ainda vazio, tenta **uma** vez depois de 150 ms (cobre
   quem chegou junto), e então falha fechado;
4. nunca ressuscita tombstone — o `hasRemoved` continua recusando antes disso.

Provado em `follower-window-chat.test.ts` (**7 casos**), incluindo: follower
depois da líder, **follower antes da líder**, líder encerrada com follower aberto,
falha do Main ao persistir (falha fechado, sem requisição e sem `secretGet`) e
tombstone. Os cenários "líder reiniciada" e "follower encerrado e reaberto" não
têm teste próprio porque não há estado de janela envolvido: o registro vive no
Main e sobrevive a ambos; o que resta é o cenário de reinício do **processo**
inteiro, que só o gate Electron cobre (§12.1) e que segue **não executado**.

### 12.4 Cancelamento de transcrição — **decisão: não implementar agora, com evidência**

Investigação da cadeia real de gravação:

- `transcribeForRecording(recording)` (`packages/stage-ui/.../hearing.ts`) **não
  recebe `AbortSignal`**, e nenhum dos três chamadores
  (`stage-web`, `stage-pocket`, `voice-input-session`) tem um para oferecer;
- o modelo de cancelamento existente no `voice-input-session` é **ticket
  obsoleto**: a sessão descarta o resultado depois de pronto
  (`isStaleTranscriptionTicket`), não aborta a requisição;
- o executor registrado (`RecordingTranscriptionExecutor`) não tem campo de
  sinal, e o contrato IPC `lia:transcription:run` também não;
- o Main não mantém registro de jobs de transcrição (só o deadline de 30 s).

Portanto, adicionar cancelamento exigiria: assinatura nova em `hearing.ts`,
campo novo na interface do executor, **contrato IPC novo** (jobId + canal de
cancelamento) e registro de jobs no Main — para um recurso que **nenhum chamador
pede hoje**. Isso é contrato novo sem consumidor, e o risco de manter um segundo
ciclo de vida não se paga nesta rodada. Decisão: **manter o deadline**, que agora
tem prova explícita de que é reportado como `timeout` e não como sucesso
(`transcription-service.test.ts`, 10 casos). Proposta isolada para o futuro:
`transcribeForRecording(recording, { signal })` → `signal` no
`RecordingTranscriptionExecution` → `jobId` no request IPC → evento
`lia:transcription:cancel` → `AbortController` por job no Main, com `cancelled`
distinto de `timeout`.

### 12.5 Auditoria final de credenciais no Renderer

Busca sistemática em `apps/stage-tamagotchi/src` e `packages/stage-ui/src` por
`secretGet`, `withResolvedCredential`, `apiKey`, `ProviderCredentialResolver` e
chamadas de `getProviderInstance`/`getChatProviderInstance`.

| Caminho | Onde | Classificação |
|---|---|---|
| Chat (todos os 10 curados) | `registerChatTransport` → `nativeRuntime` → IPC | **Curado, executado no Main**. Testado; `secretGet` não é chamado |
| Descoberta de modelos (Lia) | `discoverModels` → `nativeRuntime.discover` | **Curado, executado no Main**. Testado (11 + 4 casos) |
| Descoberta de modelos (seletor compartilhado) | `providerStore.fetchModelsForProvider` | **Curado, executado no Main** via lister (§12.2). Fora do catálogo: legado |
| Probe de conexão | `nativeRuntime.probe` | **Curado, executado no Main** |
| Transcrição | `lia:transcription:run` → `vault.getSecret` no Main | **Curado, executado no Main**. O ramo legado xsai continua existindo, mas o resolver recusa `lia-groq-transcription` e o Main nega a leitura do escopo |
| Configuração (UI) | `LiaProviderConfig.vue` → `setApiKey` → `secret:set` | **Apenas escrita**: a chave digitada vai para o cofre do Main; nunca é lida de volta |
| `resolveApiKey` no resolver de credencial do renderer | `registerProviderCredentialResolver` (líder) | **Curado, ainda alcançável no Renderer** por consumidores que construam cliente aqui. Nenhum caminho do produto Lia identificado (chat/listagem/probe interceptados), mas permanecem: `use-vision-inference.ts:49`, `markdown-stress.ts:298`, `artistry-autonomous.ts:160` e os ramos legados de `hearing.ts:953/1283` |
| Fallback de transcrição no renderer | `hearing.ts:1283` sem executor registrado | **Curado, falha fechado**: o resolver recusa o alvo e o Main nega o escopo |
| Provedores fora do catálogo | `withResolvedCredential` + `getProviderInstance` | **Fora do catálogo, legado** — inalterado e ainda lê a chave no renderer |
| Migração/limpeza de chave antiga | `legacy-credential-cleanup`, `secret:adopt` | **Configuração/limpeza**: o valor só sai do `localStorage` após o Main confirmar posse; a resposta nunca contém o valor |
| Logs | `provider.ts` (resolver), `api-key` handlers | **Metadados apenas** (`providerId`, `secretSource`, `hasApiKey`); nenhum valor, length ou prefixo |
| IPC de execução | `lia:transport:*`, `lia:transcription:run` | Sem credencial por construção; `draft` só aceita `baseUrl` (§11.1) |

**Conclusão que este documento se autoriza a afirmar:** para os dez provedores
curados, os caminhos de **chat, descoberta de modelos, probe e transcrição** não
leem credencial no Renderer. **Não** é verdade que "nenhuma credencial de provedor
curado chega ao Renderer": o *resolver* continua instalado no líder e pode
alimentar consumidores AIRI que construam cliente no processo de renderização
(lista acima). Fechar isso exige migrar esses consumidores — não foi feito nesta
rodada e não foi declarado seguro.

### 12.6 Corrigido nesta rodada vs. §11

- §11.4 dizia que a listagem de curado saía **sem autenticação** no seletor
  genérico. **Deixou de ser verdade**: o seletor agora delega ao Main.
- §11.5 (Anthropic) e §11.7 (2,5,6) permanecem válidos.
- §12.3 resolve a limitação "follower antes da líder" registrada desde o
  PROMPT-23 (era tratada como "mudança observável desejada"; agora tem
  recuperação segura, e o comportamento de falha fica só para ausência real de
  configuração).

### 12.7 Executado nesta rodada

| Verificação | Resultado |
|---|---|
| `stores/lia` + `services/lia` + `main/services/lia` | **89 arquivos / 1497 casos, exit 0** |
| `packages/stage-ui` (`hearing`, `providers`, `chat`, `composables/audio`) | 28 arquivos / **341 casos, todos PASS**; a execução sai 1 por uma rejeição não tratada de rede em `updateCredits` (`api.airi.build`, bloqueado no sandbox) — pré-existente e alheia a estas mudanças |
| `vue-tsc --noEmit` (Stage) | exit 0 |
| `tsc --noEmit` do harness do gate | exit 0 |
| ESLint nos arquivos tocados | exit 0 |
| `pnpm install --frozen-lockfile --ignore-scripts` + build de `packages/*` e `server-sdk-shared` | ok (pré-requisito das suítes) |
| Gate Electron real | **não executado** (§12.1) |
| Build do Stage (`electron-vite build`) | **não executado até o fim**: falha em `configResolved` porque `unplugin-fetch` baixa modelos Live2D de `dist.ayaka.moe`, host fora da rede deste ambiente. Falha **antes** de compilar qualquer fonte |

### 12.8 Riscos que continuam abertos

1. **Gate de runtime**: nada foi executado em Electron nesta rodada (§12.1).
2. **Consumidores AIRI que constroem cliente no renderer** (§12.5) — o resolver
   ainda pode entregar a chave a eles.
3. **Provedores fora do catálogo** continuam resolvendo credencial no renderer.
4. **Follower sem endpoint configurado** falha fechado (`configuration`) — é o
   desejado, mas é observável.
5. **Transcrição sem cancelamento do chamador** (§12.4): só deadline.
6. **Anthropic** segue sem validação com chave real.

---

## 13. PROMPT-26 — consumidores AIRI do chat e procedimento do gate Windows (01/11/2026)

Escopo: fechar o item 2 da §12.8 — “o resolver ainda pode entregar a chave aos
consumidores AIRI que constroem cliente no renderer” — e deixar o gate Electron
executável por procedimento no Windows. §1–§12 são histórico e **não foram
reescritos**; onde esta rodada contradiz uma limitação anterior, a contradição é
declarada (§13.6). Nada foi commitado: a árvore de trabalho tem 39 modificados e
20 não rastreados, sobre o HEAD `c3d2186517fd44946a413de06f79e3bb3a13c4fd`.

### 13.1 As duas camadas da correção

O Corte B migrou o **caminho de chat**. Sobraram consumidores do AIRI que não
passam por ele: eles chamam `providerStore.getProviderInstance(providerId)` — o
acessório genérico —, recebem a config já com a chave resolvida e constroem um
cliente xsai **neste processo**. Havia dois jeitos de fechar isso, e a regra do
prompt proíbe o terceiro (um segundo sistema de transporte). Foram usados os dois
permitidos, um atrás do outro:

**(1) Execução nativa também pelo acessório genérico.** `installChatFactory` em
`src/renderer/stores/lia/provider-runtime.ts` envolve agora **os dois**
acessórios:

```ts
const previousChat = source.getChatProviderInstance
const previousInstance = source.getProviderInstance
const dispatch = async (providerId, options) => {
  const native = await factory(providerId)
  return native ?? previousChat(providerId, options)
}
const instanceDispatch = async (providerId) => {
  const native = await factory(providerId)
  return (native ?? await previousInstance(providerId)) as never
}
source.getChatProviderInstance = dispatch
source.getProviderInstance = instanceDispatch
```

A fábrica é a mesma de antes: responde `undefined` para tudo que a Lia não
possui, e aí o caminho antigo roda sem alteração. Um único `uninstall` restaura
os dois acessórios. **Nenhum transporte novo**: o shim que ela devolve é o que já
encaminhava `chat(modelo).fetch(...)` para o Main.

**(2) Recusa no chokepoint.** Mesmo com (1), um consumidor pode construir o
cliente por outro caminho. O resolver registrado por `registerRuntimeExtensions`
(`src/renderer/stores/lia/provider.ts`) passou a recusar **antes de tocar o
cofre**:

```ts
if (isNativeTransportDefinition(providerId) || providerId === LIA_GROQ_TRANSCRIPTION_PROVIDER_ID)
  return undefined
```

Ou seja: todo id curado — e o alvo derivado de transcrição — não recebe
credencial neste processo, por nenhuma rota. O consumidor que escapar de (1)
degrada para requisição sem chave ou erro explícito; nunca para uma requisição
autenticada no renderer.

### 13.2 Os consumidores, um por um

| Arquivo:linha | O que constrói | Alcançável no Stage distribuído? | Evidência de alcançabilidade | Curado? | Depois desta rodada |
|---|---|---|---|---|---|
| `packages/stage-ui/src/composables/vision/use-vision-inference.ts:49` | cliente de chat + `generateText` sobre imagem | **Sim** | `pages/devtools/vision.vue` é o único chamador de `processCapture`; rotas geradas por `vue-router/auto-routes` sobre `src/renderer/pages/`, e `/devtools/*` é navegável por hash na janela de devtools (`main/windows/main/index.ts:319`) | sim | executa no Main pelo shim de (1) |
| `packages/stage-ui/src/stores/markdown-stress.ts:298` | cliente de chat para o stress de markdown | **Sim** | `pages/settings/system/developer.vue` (Configurações → Sistema → Developer) aciona o stress | sim | Main pelo shim de (1) |
| `packages/stage-ui/src/stores/modules/artistry-autonomous.ts:160` | `getProviderInstance` + `generateText` do diretor autônomo | **Sim, condicionada** | `stores/chat.ts:432-439` dispara quando o card tem `artistry.autonomousEnabled: true` — default `false` em `airi-card.ts:258,305` | sim | Main pelo shim de (1) |
| `packages/stage-ui/src/stores/modules/hearing.ts:953` | provedor de transcrição | Sim | ramo de transcrição do hearing | sim / `lia-groq-transcription` | falha fechado em (2) |
| `packages/stage-ui/src/stores/modules/hearing.ts:1283` | idem, ramo de re-tentativa | Sim | idem | sim | falha fechado em (2) |
| `packages/stage-ui/src/stores/providers/provider.ts:935` (`getChatProviderInstance`) | acessório explícito de chat | Sim | usado pelo caminho de chat | sim | já era o alvo do Corte B; continua coberto |
| `apps/stage-tamagotchi/src/renderer/stores/lia/voice-preview.ts:83` | sintetiza voz com o provedor de TTS do card | **Sim** | `components/lia-config/LiaConfigPanel.vue:97` monta `VoiceSection.vue`, que usa `createVoicePreviewDriver` | **não** (é provedor de áudio, §13.6) | inalterado; ver §13.6 item 2 |
| `packages/stage-ui/src/components/scenes/Stage.vue:535` / `components/scenarios/providers/voicevox-family-settings.vue:59` | provedores de fala (voicevox/local) | Sim | cena e configuração de voz | não | inalterado — nenhum id curado |
| `apps/stage-web/src/pages/devtools/performance-playground.vue:153,205` | provedores de fala/chat | **Não** | outro app (`stage-web`), não faz parte do Stage da Lia | — | fora do escopo |

“Não aparece na UI principal” não foi usado como prova em nenhuma linha: para
cada uma há rota, registro de componente ou gatilho nomeado.

### 13.3 Testes que pinam o resultado

Novo: `src/renderer/stores/lia/renderer-airi-consumers.test.ts` (15 casos), com
eventa e cofre dublados. Ele monta a loja real, registra o transporte e prova:

1. `getProviderInstance<ChatProvider>('openrouter-ai')` devolve o shim, a
   requisição sai **uma vez** para `${ENDPOINT}chat/completions`,
   `ipc.vaultRead` é chamado no Main e `ipc.secretGet` **não** é;
2. `generateText({ ...chatProvider.chat(model) })` — exatamente o que
   `artistry-autonomous` faz — devolve a resposta do Main com a mesma contagem
   de rede e sem `secretGet`;
3. um id curado **sem registro** rejeita com `configuration` em vez de construir
   cliente sem chave, e não toca o cofre;
4. um id **fora do catálogo** (`deepseek`) continua resolvendo no renderer,
   **inclusive com a chave no objeto do cliente** — asserção do comportamento
   atual, não elogio: é a dívida do §13.6 item 1;
5. nenhuma resposta da loja contém o valor sintético.

Os testes anteriores que pinavam o contrário foram **invertidos**, não
enfraquecidos: `activation.test.ts`, `hearing.test.ts` (2 casos, o log passa a
usar um id não curado), `runtime-wiring.test.ts`, `secret-bridge.test.ts` (f e j)
e `transcription-bridge.test.ts` (que agora também recusa `groq`). Se algum deles
voltar a passar esperando a chave no renderer, o chokepoint quebrou.

### 13.4 Auditoria sistemática de credencial no renderer

Busca por `secretGet`, `withResolvedCredential`, `apiKey`, `providerCredentials`
e por log/erro que carregue config, restrita a código de produção:

| Categoria | Onde a credencial é tocada | Processo | Situação |
|---|---|---|---|
| chat | shim do transporte | Main | fechado |
| descoberta de modelos | `nativeRuntime.discover` (curado) / `withResolvedCredential` (fora do catálogo) | Main / renderer | fechado para curado, legado fora |
| probe | `nativeRuntime.probe` | Main | fechado |
| transcrição | serviço do Main; ramos de `hearing` recusados pelo resolver | Main | fechado |
| visão | `use-vision-inference` pelo shim de (1) | Main | fechado |
| artistry / markdown-stress | idem | Main | fechado |
| voz (preview e cena) | `voice-preview.ts` / `Stage.vue` | renderer | **não curado** — §13.6 item 2 |
| stores | `LiaProviderConfig.vue` guarda a chave digitada em `ref` local, limpa depois de gravar (`apiKey.value = ''` em três pontos) e só grava pelo `secrets:set`; a config persistida é limpa de `apiKey` (`stripCredentialField`) | renderer (transitório) | aceitável e documentado |
| IPC | `electronLiaSecretGet` só existe em `stores/lia/provider.ts:271`; o Main nega leitura para id curado (`canRendererReadLegacySecret`) | Main | fechado |
| logs e erros | `console.info` do resolver imprime **metadados** (`secretSource`, `hasApiKey`), nunca o valor; nenhum `throw` interpola chave | — | fechado |

**Não** se declara “nenhuma credencial chega ao renderer”: há caminho
remanescente, §13.6.

### 13.5 Gate Electron — procedimento para o Windows

Continua **não executado**, e não foi substituído por unitários. O que esta
rodada fez foi fechar o procedimento com os dados exatos:

| Item | Valor |
|---|---|
| Versão | `electron` 43.4.1 — catálogo `^43.4.1`, lockfile resolve 43.4.1; **não alterar** |
| Binário oficial | `apps/stage-tamagotchi/node_modules/electron/dist/electron.exe`, instalado pelo `install.js` do próprio pacote |
| Asset | `electron-v43.4.1-win32-x64.zip`, sha256 publicado no `checksums.json` do pacote: `c2ef9a5f65472c34d14bd3e67b7d14e66b0c01f124aba45263d6a4232160e13a` |
| Origem | release oficial do GitHub, via `@electron/get`; `ELECTRON_MIRROR` só para espelho oficial — **nunca** host de terceiro |
| Pré-requisito do gate | `out/preload/index.mjs` (lido na primeira linha útil) e sessão de desktop com usuário logado, porque o cofre usa o keychain do SO |
| PowerShell | obrigatório: o teardown enumera `electron.exe` com `Get-CimInstance Win32_Process` |
| Pular sozinho | `skip: process.platform !== 'win32'` — em Linux/macOS ele **não** roda, e isso não é aprovação |

Passos, na ordem (os mesmos do cabeçalho do próprio gate):

```bat
cd /d J:\Lia-Project\airi
pnpm --filter @proj-airi/stage-tamagotchi exec node node_modules/electron/install.js
pnpm --filter @proj-airi/stage-tamagotchi build
cd apps\stage-tamagotchi
node --test scripts/provider-runtime-electron/gate.test.mjs
```

Os dez provedores são verificados sobre um servidor HTTP **local**: cada caminho
começa pelo id do provedor (`/<id>/chat/completions`), o fixture exige
`Authorization: Bearer <credencial sintética daquele provedor>` e responde 401
quando não bate — então um provedor autenticado com a credencial de outro
reprova. `lm-studio` e `ollama` são keyless, como no produto.

Logs sem credencial: o relatório (`Tests/artifacts/provider-runtime-electron/
<timestamp>/report.json`) grava por requisição apenas `authorization:
present|absent`, o modelo e o título — nunca o valor. O `electron.log` só é
escrito com os dois escopos históricos substituídos por `[REDACTED]`, e antes
disso o próprio gate **falha** se qualquer credencial sintética aparecer em
`logs` (asserção na linha 463). Os erros 401/503 do fixture devolvem a
credencial sintética na mensagem justamente para provar que o erro que chega ao
renderer é sanitizado.

**Por que não rodou nesta missão:** sem `dist/` do Electron (o asset oficial
responde 302 e o TLS de `objects.githubusercontent.com` falha com exit 35 neste
ambiente), sem `DISPLAY`/Xvfb, e o gate é Windows-only. A build do Stage também
não fecha aqui porque `unplugin-fetch` baixa modelos Live2D de `dist.ayaka.moe`,
host fora da rede permitida — falha em `configResolved`, antes de compilar.

### 13.6 O que continua exposto

1. **Provedores fora do catálogo** (`deepseek`, `siliconflow`, …) continuam
   resolvendo a credencial no renderer. É o legado do AIRI, inalterado de
   propósito (mudá-lo seria outro corte) e **pinado em teste** para que a dívida
   não seja esquecida nem confundida com correção.
2. **Voz.** `voice-preview.ts` cria o provedor de TTS pelo acessório genérico e
   recebe `getConfig(providerId)` com o que o card tiver. Os ids de TTS são
   provedores de áudio (`openai-audio-speech`, `voicevox`, locais), **fora do
   catálogo curado** — o resolver os trata como legado e o shim de (1) não os
   intercepta. Não há escritor de segredo para esses escopos na UI distribuída:
   o único `setApiKey` em produção é `LiaProviderConfig.vue`, restrito a
   `LIA_CHAT_PROVIDER_OPTIONS`, e o Stage não tem página genérica de provedores.
   Fica a exposição latente: **se** um dia algum caminho gravar um segredo com
   escopo de provedor de áudio, `voice-preview` o leria no renderer. Corrigir
   agora exigiria mover a síntese de voz para o Main — outro corte.
3. **`localStorage` legado** só é limpo por provedor **migrado** (adopt
   `stored`/`matching`); um blob antigo de provedor não migrado segue no
   Chromium. Não é cofre, é o modelo antigo do AIRI.
4. **Gate de runtime**: nada foi executado em Electron (§13.5).
5. **Transcrição sem cancelamento do chamador**: segue só o deadline do Main.
6. **Anthropic** segue sem validação com chave real.

### 13.7 Testes realmente executados nesta rodada

| Comando | Resultado |
|---|---|
| `vitest --project node src/renderer/stores/lia src/renderer/services/lia src/main/services/lia` | **1512 casos, 90 arquivos, exit 0** (inclui o novo arquivo, 15/15) |
| `vitest --project node src/renderer/stores/lia/renderer-airi-consumers.test.ts` | **15/15, exit 0** |
| `tsc -p scripts/provider-runtime-electron/tsconfig.json` | **exit 0** |
| `vue-tsc --noEmit` (Stage, `NODE_OPTIONS=--max-old-space-size=2560`) | **exit 0, 0 erros** |
| `eslint` nos 8 arquivos tocados | **exit 0** (4 erros de ordem de import corrigidos com `--fix` restrito a esses arquivos, reexecutado) |
| `git diff --check` | **exit 0** |

Não executados: gate Electron real, build do Stage (`electron-vite build`),
Stage completo, modelo externo. Nenhum deles é declarado aprovado.

---

## 14. PROMPT-27 — tentativa de validação em Windows, build do Stage e auditoria do preview de voz (01/11/2026)

Escopo: validar o Corte B em ambiente real, tentar o gate Electron e o build
completo do Stage, e auditar o único consumidor que a §13.6 havia deixado
classificado só como “latente”: o preview de voz. §1–§13 são histórico e não
foram reescritos. Uma afirmação anterior é **corrigida** aqui, com evidência, no
§14.2 (o ponto exato em que o build do Stage falha).

Ambiente desta rodada (medido, não presumido): `Linux 6.1.158+ x86_64`,
Debian 12, node `22.22.3`, sem `DISPLAY`, **sem `powershell.exe`, sem `pwsh`,
sem `wine`**. `node_modules` foi reconstruído (`pnpm install --frozen-lockfile
--ignore-scripts`, exit 0) e os pacotes compilados (`build:packages`, 33/33
tarefas, exit 0). Nada foi commitado.

### 14.1 Gate Electron — **não executado**. Bloqueio exato, com evidência

O gate continua sendo `scripts/provider-runtime-electron/gate.test.mjs`, e
continua **não substituído por testes de unidade**. O que foi verificado, na
ordem que o procedimento pede:

| Verificação | Comando/inspeção | Resultado |
|---|---|---|
| Versão travada | `package.json` do pacote `electron` em `node_modules` | **43.4.1** (sem alteração de versão nem de lockfile) |
| Binário local | `ls node_modules/.pnpm/electron@43.4.1*/node_modules/electron/` | **sem `dist/`, sem `path.txt`** — só `install.js`, `checksums.json`, `cli.js`, `index.js` |
| Cache | `~/.cache/electron` | **inexistente** |
| SHA-256 do asset | `checksums.json` do próprio pacote | `electron-v43.4.1-win32-x64.zip` = `c2ef9a5f65472c34d14bd3e67b7d14e66b0c01f124aba45263d6a4232160e13a` — **confere** com o valor documentado na §13.5 |
| Instalação oficial | `node node_modules/electron/install.js` | **falha**: `TypeError: fetch failed` em `@electron/get` → `FetchDownloader` |
| URL que ele tentou | `DEBUG='@electron/get:*'` | `Checking the cache … for electron-v43.4.1-linux-x64.zip (https://github.com/electron/electron/releases/download/v43.4.1/electron-v43.4.1-linux-x64.zip)` |
| Asset Windows no host oficial | `curl -I .../electron-v43.4.1-win32-x64.zip` | **HTTP/2 302** com `location: https://objects.githubusercontent.com/github-production-release-asset-2e65be/9384267/…` |
| O host do objeto | `curl` direto ao `objects.githubusercontent.com` | **exit 35** (`http=000`) — TLS bloqueado neste ambiente; DNS resolve |
| Plataforma do gate | `test(... skip: process.platform !== 'win32')` | — |
| Execução do gate | `node --test scripts/provider-runtime-electron/gate.test.mjs` | **`# pass 0` / `# fail 0` / `# skipped 1`**, exit 0 |

Saída literal do gate nesta rodada:

```
ok 1 - Electron real: production IPC, encrypted vault and native provider runtime against local HTTP # SKIP Requires Windows for the real safeStorage gate
1..1
# tests 1
# pass 0
# fail 0
# skipped 1
```

**`skip` não é aprovação.** Faltam as duas coisas ao mesmo tempo: o binário
(o asset oficial existe e tem hash publicado, mas o host que serve o conteúdo
está fora da rede permitida) e a plataforma (o teardown usa
`Get-CimInstance Win32_Process` e `dist/electron.exe`). Nenhuma das duas se
resolve sem baixar de host não oficial (proibido), sem alterar versão/lockfile
(proibido) ou sem reescrever a prova de processos para outro SO — o que ainda
assim deixaria o gate sem binário. **O gate segue pendente.**

### 14.2 Build do Stage — implementação parcialmente compilada, renderer **bloqueado** (infra)

Comando oficial do pacote: `electron-vite build` (`package.json` →
`"build": "electron-vite build"`, e `"app:build": "pnpm run build"`).

Executado nesta rodada, `apps/stage-tamagotchi`:

| Etapa | Resultado |
|---|---|
| `main` (SSR) | **compilou**: 541 módulos → `out/main/index.js` (2 436 596 bytes) + 4 chunks |
| `preload` | **compilou**: `out/preload/index.mjs`, `beat-sync.mjs`, `shared-O9damPO_.mjs` |
| `renderer` | **falhou** em `configResolved` do plugin `Download` (`@proj-airi/unplugin-fetch`) |

```
✓ 541 modules transformed.  →  out/main/index.js 2,436.59 kB
✓ 5 modules transformed.    →  out/preload/index.mjs 0.11 kB
error during build:
FetchError: [GET] "https://dist.ayaka.moe/live2d-models/hiyori_pro_zh.zip": <no response> fetch failed
    code: 'ECONNRESET', host: 'dist.ayaka.moe', port: 443
STAGE_BUILD_EXIT=1
```

**Correção de uma afirmação anterior.** A §12.7 e a §13.5 dizem que o build
falha “antes de compilar qualquer fonte”. Isso está **errado** e fica corrigido
aqui: `electron-vite build` compila os ambientes `main` e `preload` **primeiro**,
com sucesso, e só então resolve a configuração do `renderer`, onde o plugin de
download dispara — a falha é antes de compilar o **renderer**, não antes de
qualquer fonte. A consequência prática é que `out/preload/index.mjs`, que é o
pré-requisito que o gate lê na primeira linha útil, **existe** nesta árvore.

Downloads externos identificados na configuração do projeto
(`electron.vite.config.ts:262-266`), todos de origem declarada pelo próprio repo:

1. `DownloadLive2DSDK()` → `https://cubism.live2d.com/sdk-web/bin/CubismSdkForWeb-5-r.3.zip`
2. `https://dist.ayaka.moe/live2d-models/hiyori_free_zh.zip`
3. `https://dist.ayaka.moe/live2d-models/hiyori_pro_zh.zip`
4. `https://dist.ayaka.moe/vrm-models/VRoid-Hub/AvatarSample-A/AvatarSample_A.vrm`
5. `https://dist.ayaka.moe/vrm-models/VRoid-Hub/AvatarSample-B/AvatarSample_B.vrm`

Cache esperado: `airi/.cache` (`sharedCacheDir`, `electron.vite.config.ts:20`) —
**inexistente** nesta árvore. Os dois hosts externos respondem **exit 35**
(`curl: SSL_ERROR_SYSCALL`, `http=000`) a partir deste ambiente.

**Classificação: falha de infraestrutura, não de código.** Nenhum erro de
compilação de fonte apareceu; o que falhou foi um `fetch` de asset de terceiro
bloqueado pela rede. Não se declara o build aprovado, e não se contorna baixando
de outra origem nem alterando `electron.vite.config.ts` (fora do escopo
autorizado).

### 14.3 Auditoria do preview de voz

Caminho confirmado neste checkout (números de linha reais):

`components/lia-config/LiaConfigPanel.vue:97` → `<LiaConfigVoiceSection>` →
`components/lia-config/sections/VoiceSection.vue:39` (`createVoicePreviewDriver`) →
`stores/lia/voice-preview.ts:77` (`createVoicePreviewDriver`) →
`:83` `providerRuntime.getInstance(target.providerId)` →
`:93` `providerConfig.getConfig(target.providerId)` →
`:95` `speechStore.speech(provider, model, text, voice, config, …)` → `:100` `playAudio`.

**1. Quais provedores o preview pode usar?** Todo provedor de fala que o
registro publica em `speechStore.availableSpeechProvidersMetadata`, menos
`speech-noop` (`voice-editor.ts:94` `HIDDEN_FROM_LIA_PICKER`). Em termos
concretos, com `tasks` de TTS: `openai-audio-speech`, `openai-compatible-audio-speech`,
`elevenlabs`, `google-gemini-audio-speech`, `comet-api-speech`, `mimo-audio-speech`,
`minimax-speech`, `openrouter-audio-speech`, `player2-speech`, `deepgram-tts`,
`index-tts-vllm`, `app-local-audio-speech`, `browser-local-audio-speech`,
`custom-local-voice`, `kokoro-local`. **Nenhum deles está no catálogo curado de
chat.**

**2. Onde cada credencial é obtida?** Duas fontes, nesta ordem: (a) o config
persistido do provedor, devolvido por `providerConfig.getConfig()` e passado como
`config` para `speech()`; (b) o resolver de credencial do líder, invocado dentro
de `withResolvedCredential` quando o preview chama `getProviderInstance` —
`stores/lia/provider.ts:1008` → `resolveApiKey` → `secretGet` (cofre do Main).

**3. A credencial passa pelo Renderer?** **Sim, quando existe.** Medido, não
inferido: um sonda nova (`voice-preview-credentials.probe.test.ts`, 3 casos)
mostra que `getProviderInstance('openai-audio-speech')` chama
`ipc.secretGet({ scope: 'openai-audio-speech', key: 'apiKey' })` **neste
processo** e que o valor devolvido aparece em
`provider.speech('tts-1').apiKey` — exatamente o objeto que o preview entrega a
`speechStore.speech`. O caso de controle com `openai` (curado) não chama
`secretGet` e recebe o shim do Main.

**4. Existe caminho que permite ler uma chave do cofre no Renderer?** Sim, e é
duplo: (a) no renderer, o resolver só recusa **ids curados** e
`lia-groq-transcription` (§13.1) — qualquer outro id resolve; (b) no Main,
`canRendererReadLegacySecret` devolve **true** para um escopo fora do catálogo,
sem registro e sem tombstone (`transport-config-service.test.ts`, caso
“leaves providers outside the chat catalog … alone”). A cadeia inteira está
viva; o que falta é o dado.

**5. IPCs e serviços envolvidos.** `electronLiaSecretGet`
(`shared/eventa/index.ts:571` → `main/services/lia/secrets-service.ts:111`),
`useProviderConfigStore` (persistência em `localStorage`),
`useProviderStore.getProviderInstance` (com o `installChatFactory` por cima),
`useLiaProviderRuntime.getInstance`, `useSpeechStore.speech` → `@xsai/generate-speech`
(HTTP direto do renderer ao provedor) e `AudioContext` para reproduzir.

**6. É alcançável na aplicação distribuída?** **Sim.** `LiaConfigPanel.vue:97`
monta a seção de voz, e o preview é acionado pelo botão
`lia-config-voice-preview` (`VoiceSection.vue:231`). O alvo vem de `voice.tts` do
card (`voice-editor.ts`), não de uma lista fechada da Lia.

**7. Existe escritor de credenciais para esses provedores na interface atual?**
**Não.** Inventário completo dos escritores em código de produção:

| Escritor | Arquivo | Quem chama | Ids possíveis |
|---|---|---|---|
| `setApiKey` → `secretSet` | `provider.ts:451` | `LiaProviderConfig.vue:162,171` | só `LIA_CHAT_PROVIDER_OPTIONS` / `FALLBACK_PROVIDER_OPTIONS` (curados) |
| `prepareNativeExecution` → `secretSet` | `provider.ts:622` | `discoverModels` (`:669`), `testConnection` (`:700`), alimentados pelo mesmo componente | curados |
| `adoptCredential` → `secretAdopt` | `provider.ts:290` | migração, `provider.ts:356`, sobre `legacyTransportCandidates` | só `isNativeTransportDefinition` (`transport-config.ts:65,74`) |

Além disso, o Stage **não tem** rota `/settings/providers/*`
(`src/renderer/pages/settings/` não tem diretório de provedores; o galho de
`layouts/settings.vue:27` é herança inerte do AIRI) e o editor de voz, quando o
provedor exige configuração, manda o usuário “às configurações do provedor” —
tela que não existe neste app.

**8. Legado do AIRI ou exposição efetiva?** **As duas coisas, em graus
diferentes.** O *caminho de leitura* é comportamento herdado do modelo do AIRI
(o resolver do store compartilhado) e continua vivo; a *produção de dado* não
existe neste app. Logo: **exposição possível, mas não comprovada.** Separadamente,
um install atualizado de uma versão **pré-cofre** do AIRI pode ainda ter
`apiKey` em texto claro no blob `settings/providers/configured` para um id de
fala — a limpeza (`legacy-credential-cleanup`) só toca ids curados adotados.
Isso é **legado fora do escopo atual**: o dado já estava em `localStorage` antes
da Lia, e o preview apenas o lê de onde o AIRI sempre leu.

**9. O preview pode operar sem credencial?** Sim, para os provedores com
`requiresCredentials: false` (`app-local-audio-speech`, `browser-local-audio-speech`,
`custom-local-voice`, `kokoro-local`, `speech-noop` — este escondido) e para
qualquer provedor local sem chave. Para um provedor credenciado **sem** segredo,
o preview funciona até a requisição e falha com erro do provedor (401): não
quebra a UI, mas também não sintetiza.

**10. Menor correção arquitetural segura.** Recusar resolução de credencial, no
mesmo resolver já existente, para ids cuja definição **não** declara `chat` nas
`tasks`. Nenhum consumidor da Lia precisa da chave de um provedor de fala ou de
transcrição neste processo — a transcrição curada executa no Main e o preview
só precisa de uma chave para um provedor que ele não deveria executar no
renderer. O predicado cabe entre a recusa atual e a resolução:

```ts
// já existe
if (isNativeTransportDefinition(providerId) || providerId === LIA_GROQ_TRANSCRIPTION_PROVIDER_ID)
  return undefined
// proposta — uma consulta ao registro que o store já expõe
const tasks = findProviderDefinition(providerId)?.tasks ?? []
if (!tasks.includes('chat'))
  return undefined
```

O efeito no preview é idêntico ao de hoje sem segredo: cliente sem chave e erro
do provedor na hora de sintetizar, em vez de chave em memória. Custo funcional
medido: nenhum caminho de produção da Lia depende de chave de fala/transcrição no
renderer (§14.3 item 7). Fica com a ressalva de que precisa de teste próprio (um
caso por tarefa de provedor) e de revisão antes de entrar.

Com isso o preview passa a montar o cliente sem chave (comportamento idêntico ao
de hoje quando não há segredo) e o cofre deixa de ser alcançável pelo caminho de
voz. **Não implementada nesta rodada:** a exposição não está comprovada, não há
escritor para esses escopos, e a missão proíbe implementar correção sem
necessidade demonstrada. Fica pronta para autorização.

**Classificação final:** *exposição possível, mas não comprovada* para o caminho
de cofre; *legado fora do escopo atual* para o `apiKey` em texto claro de
instalação pré-cofre; *caminho inacessível* não se aplica (ele é alcançável);
*exposição confirmada* não se aplica (não existe escritor que produza o dado).

### 14.4 Revisão dos caminhos de credenciais

Verificação direcionada, no código e na suíte, sem alteração de comportamento:

| Verificação | Evidência | Estado |
|---|---|---|
| dez curados executam no Main | `installChatFactory` embrulha `getChatProviderInstance` **e** `getProviderInstance` (`provider-runtime.ts:148-149`); `renderer-airi-consumers.test.ts` 15/15 | mantido |
| descoberta de modelos no Main | `registerProviderModelLister` (`provider.ts:959`), desregistrado em `:426` | mantido |
| transcrição curada protegida | resolver recusa `lia-groq-transcription` (`provider.ts:1008`); serviço no Main | mantido |
| consumidores AIRI do PROMPT-26 protegidos | visão, artistry e markdown-stress pelo shim; `hearing` fecha por falta de credencial | mantido |
| fora do catálogo continua legado | resolver devolve `{ apiKey }` para `deepseek`; pinado em `renderer-airi-consumers.test.ts` | **não generalizado** — a proteção não foi estendida |
| nada desta rodada reabriu acesso | única mudança de código foi o arquivo de sonda (teste); nenhum arquivo de produção tocado | confirmado |

`secretGet` em código de produção continua existindo em **um** lugar
(`provider.ts:271`), como antes. `withResolvedCredential` continua em três pontos
do store compartilhado (`providers/provider.ts:98,743,914`) — um deles é o
caminho de construção do cliente que a §14.3 mede.

### 14.5 Testes realmente executados nesta rodada

| Comando | Resultado |
|---|---|
| `node node_modules/vitest/vitest.mjs run --config apps/stage-tamagotchi/vitest.config.ts --project node src/renderer/stores/lia src/renderer/services/lia src/main/services/lia` | **1515 casos, 91 arquivos, exit 0** (inclui a sonda nova, 3/3) |
| idem, só `voice-preview-credentials.probe.test.ts` | **3/3, exit 0** |
| `vue-tsc --noEmit` (Stage, `--max-old-space-size=2560`) | **exit 0, 0 erros** |
| `tsc -p scripts/provider-runtime-electron/tsconfig.json` | **exit 0** |
| `eslint` no arquivo novo | **exit 0** |
| `git diff --check` | **exit 0** |
| `node --test scripts/provider-runtime-electron/gate.test.mjs` | **1 skipped**, exit 0 — não é aprovação |
| `electron-vite build` | **exit 1**: main+preload OK, renderer bloqueado por download (§14.2) |

Não executados: gate Electron real (bloqueio do §14.1), Stage completo,
`electron-builder` (instalador), modelo externo, chamada paga.

### 14.6 Pendências e próximo passo

1. **Gate Electron** — pendente, bloqueio duplo (binário + plataforma). Rodar no
   Windows do Dev com o procedimento da §13.5; nenhuma parte do Corte B pode ser
   chamada de validada antes disso.
2. **Build do Stage** — bloqueado em asset externo. No Windows com rede aberta, o
   mesmo comando deve concluir; o que já se sabe é que `main` e `preload`
   compilam.
3. **Preview de voz** — *possível, não comprovada*. Correção mínima pronta
   (§14.3 item 10), aguardando autorização.
4. **Provedores fora do catálogo** — legado identificado, não generalizado.
5. **Transcrição sem cancelamento** e **Anthropic sem chave real** — como na §13.6.

**Próximo passo mínimo recomendado:** rodar o gate no Windows (§13.5) — é o
único item que separa “Corte B implementado” de “Corte B validado”.

---

## 15. PROMPT-27 (rodada 2) — roteiro PowerShell entregue, re-execução Linux, gate segue pendente (01/11/2026)

Escopo desta rodada: separar o que o Linux pode provar do que só o Windows do Dev
pode provar, entregar o roteiro executável e re-medir tudo o que é medível aqui.
§1–§14 são histórico e **não foram reescritos**; a auditoria do preview de voz
continua detalhada na §14.3 e é apenas recapitulada no §15.4.

Ambiente: Linux `6.1.158+` x86_64 (Debian 12), node `22.22.3`, sem `DISPLAY`, sem
`pwsh`/`powershell`. Dependências reconstruídas nesta rodada
(`pnpm install --frozen-lockfile --ignore-scripts` exit 0; `build:packages`
33/33 exit 0). Nada commitado.

### 15.1 Roteiro Windows: `run-gate-windows.ps1`

Novo arquivo, ao lado do gate:

`airi/apps/stage-tamagotchi/scripts/provider-runtime-electron/run-gate-windows.ps1`

É um **runner fino**: executa os comandos que o repositório já declara e não
reimplementa, enfraquece nem substitui o gate. Faz, nesta ordem:

| Passo | O que verifica/executa | Falha quando |
|---|---|---|
| 1 | `git rev-parse --abbrev-ref HEAD`, `git rev-parse HEAD`, `git status --porcelain` (somente leitura) | `git` não responde, ou falta `gate.test.mjs`/`package.json` |
| 2 | `node --version`, `pnpm --version` | node < 22, ausência de qualquer um |
| 3 | `require.resolve('playwright')` e `require.resolve('vite')` a partir de `apps/stage-tamagotchi` | não resolvem (dependências do gate ausentes) |
| 4 | versão do pacote `electron` = `43.4.1`; SHA-256 do asset conferido contra o `checksums.json` **do próprio pacote**; runtime já instalado? | versão diferente, hash divergente, runtime presente com versão errada |
| 5 | `pnpm --filter @proj-airi/stage-tamagotchi exec node node_modules/electron/install.js` (ou zip local verificado por `-ElectronZip`) | instalador sai ≠ 0 ou `dist/electron.exe` ausente |
| 6 | `pnpm run build` no app (ou `-SkipBuild`) | build sai ≠ 0; depois disso exige `out/preload/index.mjs` |
| 7 | `node --test scripts/provider-runtime-electron/gate.test.mjs` | exit ≠ 0 |
| 8 | localiza a pasta de artefatos **desta execução** em `Tests/artifacts/provider-runtime-electron/`, imprime `report.result`, `exitCode`, `logSecretsAbsent`, contagem de `requests`/`checks`, e faz varredura independente do `electron.log` pelos **prefixos** sintéticos | pasta ausente, `report.json` ausente, prefixo encontrado, `logSecretsAbsent: false` |
| 9 | resumo em tabela; reconfere que `git status` não mudou de contagem | (só aviso) |

Segurança do roteiro:

- **Nenhuma operação de Git** além de `rev-parse`/`status`. Sem `add`, `commit`,
  `push`, `checkout`, `reset`, `clean`, `stash`.
- **Nenhum segredo é impresso.** A varredura procura os prefixos
  `synthetic-`, `synthetic-A-`, `synthetic-B-` e, ao encontrar, imprime só os
  prefixos e o caminho do arquivo — nunca a linha.
- **Nenhum `irm ... | iex`**, nenhum download de host arbitrário: a instalação é
  o `install.js` do próprio pacote (que valida contra `checksums.json`).
- Com `-ElectronZip`, o SHA-256 é conferido **antes** de qualquer extração, e o
  caminho é entregue ao instalador oficial via `ELECTRON_OVERRIDE_DIST_PATH`.
- Não altera versão, lockfile nem configuração global.
- Compatível com PowerShell 5.1: não usa `??`, `?.` nem ternário. As leituras de
  comando nativo isolam `$ErrorActionPreference` para não transformar stderr em
  erro terminativo no PowerShell 7.3+.

**Limitação desta entrega, declarada:** o roteiro **não foi executado**. Este
ambiente não tem `pwsh` nem `powershell`. O que foi feito foi revisão estática:
balanceamento de chaves/aspas, checagem de que toda função chamada está definida,
checagem de ausência de sintaxe exclusiva de PS 7, e verificação de que **os três
comandos centrais existem de fato** — `pnpm --filter … exec node
node_modules/electron/install.js` (roda e falha só no `fetch`, como esperado),
`pnpm run build` (roda, `main`+`preload` OK, renderer bloqueado) e `node --test
scripts/provider-runtime-electron/gate.test.mjs` (roda e se pula fora do
Windows). Qualquer erro restante será de execução, não de comando inexistente.

### 15.2 Estado real do gate

**Não executado.** Rodado nesta rodada, literalmente:

```
$ node --test scripts/provider-runtime-electron/gate.test.mjs
# tests 1  # pass 0  # fail 0  # skipped 1
```

Motivos, todos medidos nesta rodada: `electron@43.4.1` instalado **sem `dist/` e
sem `path.txt`**; sem cache em `~/.cache/electron`; `install.js` termina em
`TypeError: fetch failed` (o asset oficial responde 302 e o host que serve o
conteúdo responde exit 35); e o gate é `skip` fora do `win32`. Sem artefatos
criados — o `Tests/artifacts` só nasce quando o teste roda de fato.

### 15.3 Estado do build do Stage

Re-executado nesta rodada com o comando exato do roteiro (`pnpm run build` em
`apps/stage-tamagotchi`), **exit 1**:

```
✓ 541 modules transformed.  → out/main/index.js 2,436.59 kB
✓ 5 modules transformed.    → out/preload/index.mjs 0.11 kB
error during build:
FetchError: [GET] "https://dist.ayaka.moe/live2d-models/hiyori_free_zh.zip": <no response> fetch failed
```

Respostas às perguntas da missão:

- **É compatível com Linux?** O build em si é; o **download dos assets**, não.
  `main` e `preload` compilam em Linux sem nenhum ajuste.
- **Quais downloads externos exige?** `DownloadLive2DSDK()` →
  `cubism.live2d.com/sdk-web/bin/CubismSdkForWeb-5-r.3.zip`; quatro assets de
  `dist.ayaka.moe` (2 modelos Live2D, 2 VRM), declarados em
  `electron.vite.config.ts:262-266`.
- **O bloqueio é antes da compilação de código?** **Não** — e isso corrige a
  afirmação anterior (§14.2): `main` e `preload` compilam primeiro; a falha é
  antes de compilar o **renderer**.
- **Existe caminho documentado para usar assets já presentes?** Sim, o plugin
  aceita cache (`cacheDir: airi/.cache`, `electron.vite.config.ts:20`), mas o
  diretório **não existe** nesta árvore. Não há caminho documentado para apontar
  a um cache externo sem editar a configuração do build — o que está fora do
  escopo autorizado.
- **Infraestrutura, dependência externa ou erro de código?** Falha de
  **infraestrutura/dependência externa**: zero erro de compilação de fonte.

### 15.4 Preview de voz — recapitulação medida (detalhe na §14.3)

Caminho reconfirmado neste checkout: `LiaConfigPanel.vue:97` →
`VoiceSection.vue:39,45` (`useVoiceEditor({ preview: createVoicePreviewDriver() })`,
botão `lia-config-voice-preview` em `:231`) → `voice-preview.ts:83`
`providerRuntime.getInstance()` → `:93` `providerConfig.getConfig()` → `:95`
`speechStore.speech()`.

| Pergunta | Resposta medida |
|---|---|
| Quais provedores? | todo provedor de fala de `availableSpeechProvidersMetadata`, menos `speech-noop` (`voice-editor.ts:94`); **nenhum está no catálogo curado** |
| Onde a credencial é obtida? | config persistido do provedor **e** o resolver do líder → `secretGet` |
| Passa pelo Renderer? | **sim**, quando existe: a sonda prova `secretGet` neste processo e `provider.speech('tts-1').apiKey` com o valor |
| Acesso ao cofre pelo Renderer? | **sim**: o resolver só recusa curados + transcrição (§13.1) e o Main devolve `true` para escopo fora do catálogo sem registro |
| IPCs/serviços | `electronLiaSecretGet` → `secrets-service.ts:111`; `useProviderStore`; `useLiaProviderRuntime`; `useSpeechStore.speech` (HTTP direto); `AudioContext` |
| Alcançável na app distribuída? | **sim**, pelos componentes acima |
| Existe escritor para esses escopos? | **não** — os três escritores só aceitam ids curados (§14.3 item 7) |
| Classificação | **exposição possível, não comprovada** (cofre) + **legado fora do escopo** (texto claro pré-cofre) |
| Menor correção segura | no resolver, recusar id cujas `tasks` não incluem `chat` — descrita na §14.3 item 10, **não implementada** |

### 15.5 Revisão do Corte B (re-medida nesta rodada)

| Item | Evidência | Estado |
|---|---|---|
| `secretGet` em produção | **1** ocorrência: `provider.ts:462` | inalterado |
| `secretSet` em produção | `provider.ts:452` (`setApiKey`) e `:627` (`prepareNativeExecution`) | só curados |
| `withResolvedCredential` | `providers/provider.ts:98,743,914` | 3 pontos, inalterados |
| `getProviderInstance` / `getChatProviderInstance` | ambos embrulhados: `provider-runtime.ts:148-149`, restaurados em `:151-154` | mantido |
| `installChatFactory` | `provider.ts:905` | mantido |
| `isNativeTransportDefinition` | `transport-config.ts:17` delega a `isCuratedChatProvider` | mantido |
| `lia-groq-transcription` | recusado em `provider.ts:1008` | mantido |
| `registerProviderModelLister` | `provider.ts:959` (registra) / `:426` (limpa) | mantido |
| consumidores AIRI do PROMPT-26 | visão `:49`, markdown-stress `:298`, artistry `:160`, hearing `:953/:1283` — protegidos pelo shim + recusa | mantido |
| fora do catálogo | resolver devolve `{ apiKey }`; pinado em teste | **legado, não generalizado** |

Nenhuma mudança desta rodada tocou código de produção: a única adição de código
é o roteiro PowerShell e, na rodada anterior, a sonda de teste.

### 15.6 Testes executados nesta rodada (Linux)

| Comando | Resultado |
|---|---|
| `vitest run --project node src/renderer/stores/lia src/renderer/services/lia src/main/services/lia` | **1515 casos, 91 arquivos, exit 0** |
| `vitest run` com `voice-preview-credentials.probe` + `renderer-airi-consumers` + `transcription-bridge` | **23 casos, 3 arquivos, exit 0** |
| `vue-tsc --noEmit` (Stage) | **exit 0, 0 erros** |
| `eslint` em `voice-preview-credentials.probe.test.ts`, `provider.ts`, `provider-runtime.ts` | **exit 0** |
| `git diff --check` | **exit 0** |
| `node --test scripts/provider-runtime-electron/gate.test.mjs` | 1 skipped — **não é aprovação** |
| `pnpm run build` (Stage) | **exit 1** em infraestrutura (§15.3) |

Incompatíveis com Linux / não executados: gate Electron real, Stage completo,
`electron-builder`, validação com provedor externo, roteiro PowerShell (sem
`pwsh`).

### 15.7 Pendências

1. **Gate Electron** — pendente; executar `run-gate-windows.ps1` no Windows do Dev
   e anexar `report.json` + `electron.log` da pasta de artefatos.
2. **Build do Stage** — bloqueado em asset externo; o roteiro já trata a falha
   como `FAIL` e aborta antes do gate, de propósito.
3. **Preview de voz** — correção mínima descrita, aguardando autorização.
4. **Legado fora do catálogo**, **transcrição sem cancelamento**, **Anthropic sem
   chave real** — como nas §13.6 e §14.6.

---

## 16. PROMPT-28 — política de credencial por capacidade declarada (02/11/2026)

Fecha o buraco que a §14 mediu e a §15 registrou como pendente. A correção é
mínima e vive em **dois arquivos de produção**, sem mover síntese de voz, sem
novo transporte e sem ampliar o catálogo.

### 16.1 O buraco, com o código na frente

`resolveApiKey` (`renderer/stores/lia/provider.ts:515`) é o único caminho deste
renderer ao cofre: `secretGet({ scope, key: 'apiKey' })`. Antes, recusava
exatamente dois casos:

```ts
if (isNativeTransportDefinition(providerId) || providerId === LIA_GROQ_TRANSCRIPTION_PROVIDER_ID)
  return undefined
return secretGet({ scope: secretScopeFor(providerId), key: API_KEY_NAME })
```

Todo outro id recebia a chave. Isso inclui **todos os provedores de voz
remotos** — e o preview de voz monta o cliente TTS aqui mesmo
(`voice-preview.ts` → `providerRuntime.getInstance` → `speechStore.speech`).
O main não era uma segunda barreira: `main/services/lia/secrets-service.ts` só
confere o escopo do cofre, não a capacidade do provedor.

### 16.2 A regra: capacidade declarada, não categoria

Uma definição só pode entregar credencial a este processo se ela própria declarar
uma task que a Lia ainda executa no renderer:

```ts
const RENDERER_CREDENTIAL_TASKS: ReadonlySet<string> = new Set([
  'chat', 'speech-to-text', 'automatic-speech-recognition', 'asr', 'stt',
])

function rendererMayHoldCredential(providerId: string): boolean {
  return providerRuntime.providerTasks(providerId)
    .some(task => RENDERER_CREDENTIAL_TASKS.has(String(task).toLowerCase()))
}
```

A lista é lida do **registro real** por `providerRuntime.providerTasks(id)`
(`provider-runtime.ts`), implementado como
`source.findProviderDefinition(id)?.tasks ?? []`. É acessor **bound-only**, no
mesmo padrão de `defaultBaseUrl`: fora da interface `LiaProviderRuntime`, para
não mexer no contrato de quatro operações que os testes pinam.

`resolveApiKey` chama o predicado **antes** de qualquer leitura do cofre. O
resolver de credencial (`registerRuntimeExtensions`) chama o mesmo predicado
antes de `resolveApiKey`, para que a linha de auditoria
`[lia] provider credential resolved: …` não registre tentativa de resolução para
um provedor que nunca teria credencial ali.

**Por que não "bloquear voz".** Medido no catálogo (63 definições): 34 declaram
`chat`; 18 declaram fala **sem** `chat`; e cinco de fala — `voicevox`,
`app-local-audio-speech`, `index-tts-vllm`, `kokoro-local`, `custom-local-voice`
— declaram `requiresCredentials: false`. Um predicado por voz teria bloqueado
justamente os motores locais, que não têm segredo a proteger. O predicado que o
PROMPT-27 rascunhou ("sem `chat` → negar") foi **descartado** por esse motivo:
confundia "não declara chat" com "não pode ter credencial".

### 16.3 Efeito por tipo de operação

| Operação | Caminho | Antes | Depois |
|---|---|---|---|
| chat curado (10 ids) | shim no main | resolver recusa | **igual** |
| descoberta de modelos | main (probe) | sem chave | **igual** |
| conexão/probe de configuração | main | sem chave | **igual** |
| transcrição Groq | `transcribeThroughMain` | recusa explícita | **igual** |
| preview de voz remota | renderer | **chave do cofre** | recusa; falha segura |
| voz local sem segredo | renderer | funciona sem chave | **igual** |
| chat fora do catálogo | renderer (legado) | chave | **igual** (dívida assumida) |
| STT legado fora do Groq | renderer (legado) | chave | **igual** |
| id sem definição | qualquer | **chave** | recusa (fail-closed) |

A linha "chat fora do catálogo" é dívida consciente: o PROMPT-28 autoriza fechar
voz, não migrar o chat legado. Ela está pinada em teste
(`voice-preview-credentials.probe.test.ts`, caso "still resolves a chat provider
outside the catalog") para que ninguém a leia como esquecimento — e para que
qualquer mudança nela seja deliberada.

### 16.4 O preview falha de forma explícita

Um TTS remoto sem credencial não quebra em silêncio: a definição de áudio chama
`config.apiKey.trim()` dentro de `createProvider`, e o `TypeError` resultante não
diz nada ao usuário. O driver em `voice-preview.ts` reembrulha a falha de
construção:

```ts
catch (error) {
  throw new Error(`Voice provider "${target.providerId}" cannot be prepared in this window`, { cause: error })
}
```

O `voice-editor` já convertia erro em `previewState = 'error'` + `previewError`
(`playPreview`, ~486-525), e a `VoiceSection.vue` já renderiza
`data-testid="lia-config-voice-preview-state"`. Nada de novo subsistema: a mesma
UI passa a mostrar um estado de erro honesto. A mensagem não pode conter segredo
— a credencial nunca foi obtida.

### 16.5 Testes (9 provas exigidas)

| # | Prova | Onde |
|---|---|---|
| 1 | chat curado continua no main | `native-provider-migration.test.ts`, `renderer-airi-consumers.test.ts` |
| 2 | descoberta de modelos/probe intactas | `provider-models.test.ts`, `model-listing-*.test.ts` |
| 3 | Groq transcription intacta | `transcription-bridge.test.ts` |
| 4 | preview de voz não recebe credencial | `voice-preview-credentials.probe.test.ts` (caso B4) |
| 5 | voz local sem credencial funciona | idem (casos de `kokoro-local`) |
| 6 | voz remota falha segura e explícita | idem (caso B6, via driver real) |
| 7 | fora do catálogo não recebe credencial pelo caminho protegido | idem ("fails closed for an id with no definition") |
| 8 | consumidores AIRI anteriores seguem protegidos | `renderer-airi-consumers.test.ts` |
| 9 | outros consumidores legítimos do cofre não quebram | idem (chat legado + STT legado) |

Além disso, `provider-runtime.test.ts` ganhou três casos para o acessor novo:
devolve as tasks da definição, devolve lista vazia para id desconhecido e devolve
**cópia** (chamar `push` no resultado não reescreve o registro).

### 16.6 Resultados medidos (Linux, deps instaladas nesta sessão)

| Comando | Resultado |
|---|---|
| `pnpm install --frozen-lockfile --ignore-scripts` + `build:packages` + `server-sdk-shared` | `INSTALL_EXIT=0`, `BUILD_PKGS_EXIT=0` |
| `vitest run --project node src/renderer/stores/lia src/renderer/services/lia src/main/services/lia` | **1524 casos / 91 arquivos, exit 0** |
| 9 arquivos-chave (consumers, migration, transcription, models, validation, runtime, preview, editor, probe) | **118 casos, exit 0** |
| `vue-tsc --noEmit` (Stage) | **exit 0** |
| `eslint --no-cache` nos 7 arquivos tocados | **exit 0** |
| `git diff --check` | **exit 0** |
| gate Electron (`node --test`) | **1 skipped — NÃO EXECUTADO** |

Dois testes existentes pinavam o comportamento **antigo** de `speech-noop`
(`secretGet` chamado duas vezes no caminho de rascunho). Eles foram atualizados
para pinar o novo contrato — `not.toHaveBeenCalled()` — **mantendo** exatamente
as asserções que davam sentido ao caso (`{ status: 'ready', models: [] }`,
`{ ok: false, failure: 'unsupported' }`,
`{ ok: false, scope: 'text', failure: 'configuration' }`, `requests == []`).
Não houve enfraquecimento: o que caiu foi a expectativa de que um provedor de
TTS com `requiresCredentials: false` consultasse o cofre.

### 16.7 Limitações e riscos que permanecem

1. **Preview de voz remota não sintetiza mais.** Custo aceito do corte. Resolver
   exige executar TTS no main — explicitamente fora do escopo do PROMPT-28.
2. **Chat fora do catálogo ainda resolve chave no renderer.** Registrado, não
   generalizado nesta rodada.
3. **A regra depende de `tasks` no registro.** Uma definição futura que declare
   fala mas precise de chave continuará recusada; uma que declare `chat` por
   engano ganharia a permissão. Ambos os casos são fail-safe (o primeiro falha
   fechado, o segundo é o mesmo risco que já existia para chat).
4. **TTS remoto no Stage (fora da Lia).** O mesmo resolver serve o Stage; ali o
   efeito é idêntico — voz local funciona, voz remota falha. É a consequência
   direta de fechar a capacidade, não um vazamento.
5. **Gate Electron segue NÃO EXECUTADO.** Nada nesta rodada o promove.

---

## 17. PROMPT-31 — harness do gate corrigido: identidade de processo, segredos e exportação (06/11/2026)

Missão de **qualidade do harness**, não de produto. Nenhum módulo de produção foi
tocado: `transport-execution-service.ts`, o catálogo de provedores, o fluxo de
credenciais e a interface da Lia ficaram exatamente como estavam em `91f0e99`.
Tudo o que mudou está em `apps/stage-tamagotchi/scripts/provider-runtime-electron/`
e nos três documentos de estado.

### 17.1 O que estava errado antes desta rodada

O PROMPT-30 mediu seis defeitos no harness. O commit `91f0e99` não os corrige:

| # | Defeito | Consequência medida |
|---|---|---|
| A | Liveness por `process.kill(pid, 0)` | PID reciclado = processo encerrado parece vivo → falha espúria; PASS dependia de sorte |
| B | `descendants()` por 4 snapshots | filho nascido e morto entre dois snapshots nunca entrava no conjunto verificado |
| C | `electron.log` com `replaceAll` de 2 valores | as 8 chaves por provedor iam em texto claro para o log, justamente no caminho de falha |
| D | versão do PowerShell não registrada | "5.1 e 7" não era auditável a partir do artefato |
| E | evidência só em `Tests/artifacts/` (git-ignored) | recriação do workspace apagou os dois relatórios |
| F | `checks` sem contabilidade de grupo | falha no grupo 7 e no 12 produziam a mesma lista curta |
| G | aviso de frame descartado | conclusão por análise estática (§17.7) |

### 17.2 Correção A — identidade de processo

Novo módulo `lib/process-identity.mjs`. A identidade é o par **`(pid, createdAt)`**,
comparado como instante exato — sem janela de tolerância:

```js
export function isSameProcess(left, right) {
  if (left.pid !== right.pid) return false
  if (left.createdAt === UNKNOWN_CREATED_AT || right.createdAt === UNKNOWN_CREATED_AT) return false
  return left.createdAt === right.createdAt
}
```

`parseCimDate` aceita as duas formas que o PowerShell produz — `\/Date(ms)\/`
(5.1) e ISO 8601 com 7 dígitos de fração (7) — e recusa uma data sem fuso em vez
de resolvê-la em hora local. A consulta converte o carimbo **dentro** do
PowerShell (`CreationDate.ToUniversalTime().ToString('o')`), para 5.1 e 7
concordarem na origem.

Três estados, e o terceiro é o que importa:

- `alive` — mesmo PID **e** mesmo instante;
- `gone` — PID livre, ou PID usado por outro instante (reciclado);
- `unknown` — identidade incompleta ou tabela ilegível. **Nunca** colapsado em
  `gone`.

O gate trata `unknown` como "encerramento não confirmado": continua amostrando
até 20 s e, se persistir, falha citando o PID e o motivo.

### 17.3 Correção B — rastreamento contínuo de descendentes

`lib/process-monitor.mjs`: um monitor por tempo de vida do Electron, iniciado
imediatamente após o launch e parado antes de cada `close()`. Cada leitura
acumula identidades num mapa indexado por `pid:createdAt`, então duas encarnações
do mesmo PID sobrevivem as duas.

**Limitação registrada, não escondida:** continua sendo amostragem. Um processo
que nasce e morre dentro de um intervalo (150 ms por padrão) pode escapar. Fechar
essa janela exigiria Job Object do Windows (impossível sem addon nativo) ou
`Win32_ProcessStartTrace` via WMI (exige sessão elevada). Ambos foram rejeitados:
o gate tem de rodar na conta normal do Dev. O relatório publica o intervalo, para
que o leitor julgue — `report.processTracking[].coverage`.

### 17.4 Correção C — segredos

`lib/secret-redaction.mjs`. Um registro único, criado a partir do objeto de
segredos do gate, substitui os valores **exatos** (mais longos primeiro) e depois
aplica uma regra de forma (`synthetic-*`) como defesa em profundidade.

A escrita passa a ter uma porta só:

```js
await writeArtifact({ writeFile, join }, artifacts, 'report.json', report, secretRegistry)
await writeArtifact({ writeFile, join }, artifacts, 'electron.log', logs, secretRegistry)
```

`writeArtifact` redige e **reverifica o próprio resultado**; se ainda houver um
valor registrado, lança e não cria o arquivo — o `finally` grava então
`ARTIFACTS-WITHHELD.txt`. O critério da missão é coberto por um teste de ponta a
ponta com sistema de arquivos real (`lib/artifact-leak.test.mjs`, 6 casos): dez
provedores + genérica + local, falha depois de geradas, falha no teardown, e
varredura de **todos** os bytes gravados contra **todos** os valores daquela
execução.

### 17.5 Correções D e E — ambiente e exportação

`run-gate-windows.ps1` ganhou duas etapas novas (a numeração passou de 9 para 11
seções):

- **9. Ambiente** — grava `environment.json` com `PowerShell` (versão completa,
  edição Desktop/Core, host), Windows (versão, build, caption, arch), node,
  electron, pnpm, branch/commit e `startedAt`. Valor indisponível é `'unknown'`,
  nunca inventado. BOM não é escrito (5.1 prepende um).
- **10. Exportação** — copia (nunca move) `report.json`, `electron.log`,
  `environment.json` e, se existir, `electron.png` para
  `<ExportRoot>/<runId>/`, mais um `manifest.json` com SHA-256 por arquivo,
  branch, commit, resultado e o resumo dos grupos.

`$ExportRoot` é configurável por parâmetro ou `$env:LIA_GATE_EXPORT_ROOT`;
padrão `Tests/exports/provider-runtime-electron`. **Fora** de `Tests/artifacts`
de propósito: era exatamente a pasta descartável que apagou a evidência anterior.

Verificação do pacote:

```powershell
Get-FileHash -Algorithm SHA256 <arquivo>
# compare com files[].sha256 em manifest.json
```

### 17.6 Correção F — os 16 grupos

`lib/run-groups.mjs` mantém a lista canônica dos 16 grupos (a mesma numeração do
PROMPT-30) e um gravador com `begin(n)` / `pass(n)` / `fail(n, motivo)`. A
execução continua **linear** — o gate não foi fragmentado em subtests que possam
ser pulados —, mas a contabilidade passa a distinguir:

- `passed` — o grupo começou **e** chegou ao fim;
- `failed` — começou e quebrou (o `catch` atribui a falha ao grupo em execução);
- `running` — interrompido;
- `not-run` — nunca começou.

`report.groups` traz `total`, `executed`, `passed`, `failed`, `notRun`,
`complete` e `interruptedAt`; `report.groupsDescription` diz em uma frase onde
parou. **Código presente não conta como executado.**

### 17.7 Correção G — aviso de frame descartado

Nenhuma alteração preventiva. A análise estática do PROMPT-30 se sustenta: o
produto não referencia `mainFrame`/`webFrameMain`, o `main.ts` da fixture só
grava métricas no `render-process-gone`, e `transport-execution-service.ts`
remove os dois listeners em `detach()` (pinado por teste). Não há observação
direta no Arena — **a confirmação depende do próximo gate no Windows**, e o
`electron.log` do pacote exportado é o lugar onde ela aparece.

### 17.8 Testes desta rodada (Linux, medidos agora)

| Comando | Resultado |
|---|---|
| `node --test lib/*.test.mjs gate-integrity.test.mjs` | **142 casos, 0 falhas** |
| `vitest run --project node` (stores/lia + services/lia + main/services/lia) | **1524 casos / 91 arquivos, exit 0** |
| `vue-tsc --noEmit` (Stage) | **exit 0** |
| `eslint --config …/eslint.config.mjs` na pasta do harness | **exit 0** |
| `node --test gate.test.mjs` | **# pass 0 / # skipped 1 — NÃO EXECUTADO** |
| `git diff --check` | **exit 0** |

Distribuição dos 142: identidade de processo 36, monitor 15, redação 23,
exportação/manifesto 23, grupos 17, vazamento ponta a ponta 6, integridade
estrutural do gate 22.

### 17.9 O que continua pendente de Windows

1. **Execução real do gate** — `node --test scripts/provider-runtime-electron/gate.test.mjs`
   numa sessão com desktop e keychain.
2. **`Get-CimInstance` / `CreationDate` reais** — o parser e a normalização são
   testados contra as duas formas documentadas, não contra um host Windows.
3. **Aviso de frame** — observação direta, não inferida.
4. **PowerShell 5.1 e 7** — as duas execuções continuam por fazer. O runner agora
   registra a versão, então a próxima evidência será conclusiva.
5. **Build completo do Stage** — bloqueado neste sandbox por asset externo.

Nada nesta rodada promove o gate a aprovado, e o Corte B continua **não
validado**.

## 18. PROMPT-31 — integração e validação no Windows

**06/11/2026. Gate de componentes do Corte B aprovado nas duas versões do PowerShell.**
Raiz `J:\Lia-Project`, branch `arena/01a10290-lia-project`, HEAD
`9d7a831a18c722b247dc663486e6a856b28dbcb3`. O checkout estava limpo após o
fast-forward. As correções desta validação ficam no working tree, índice vazio,
sem commit ou push. O baseline funcional permanece `3ef6d11`.

| Arquivos locais anteriores | Destino |
| --- | --- |
| `gate.test.mjs` | Monitor contínuo, grupos e registro de segredos do Arena preservados. Integrados isolamento de chaves das fixtures, modelo da fixture original e comparação de leituras do cofre antes e depois de bloquear o transporte. |
| `renderer.ts` do harness | Recuperados os dois acréscimos do backup para limpar a chave sintética de `lm-studio` no perfil isolado. |
| `run-gate-windows.ps1` | Recuperadas verificação do ZIP/distribuição, compatibilidade 5.1, seleção da nova pasta de artefatos e checagem positiva do TAP. Ambiente e exportação do Arena preservados. |
| Cobertura, `CURRENT-STATE.md` e `QUANTO-FALTA.md` | Histórico publicado preservado e estado atualizado com as evidências desta rodada. Os textos locais anteriores continuam no backup. |

Os seis SHA-256 das cópias correspondem ao manifesto de
`J:\Lia-Backup-PROMPT-29-20261106-222316-441690`. O patch original permanece lá.

**Falhas encontradas.** A chamada CIM direta confirmou erro de sintaxe antes de
`ConvertTo-Json`. Corrigidos o separador de comandos e a propagação de falha
da consulta. O primeiro gate 5.1 excedeu o limite de 180 s e sua árvore foi
encerrada pelo PID validado. A consulta síncrona medida levou 426 ms ante um
intervalo nominal de 150 ms. A coleta periódica passou a ser assíncrona, com
uma consulta por vez, e é drenada no encerramento e antes do próximo launch.
O Playwright usa `cmd.exe` como pai do Electron nesta máquina. A tabela do
monitor inclui o wrapper, e cada launch exige a identidade do Electron Main.
No runner, a variável local foi renomeada para evitar colisão com `$PSEdition`.
Outra tentativa passou os 16 grupos mas saiu 1 na exportação porque o manifesto
era gerado separadamente da lista de cópias. A checagem passou a consultar os
arquivos no diretório final. Os transcripts das tentativas estão em `J:\lia-evidence`.

| Verificação | Resultado |
| --- | --- |
| `node --test lib\*.test.mjs gate-integrity.test.mjs` | 142 PASS no checkout inicial. Após a regressão de coleta sem sobreposição e atualização da asserção de integração, 143 PASS, zero falhas e skips. |
| ESLint dos arquivos do harness, typecheck do harness e `git diff --check` | PASS |
| Preparação do runtime | Electron 43.4.1 oficial, ZIP SHA-256 `c2ef9a5f65472c34d14bd3e67b7d14e66b0c01f124aba45263d6a4232160e13a`, 75 arquivos da instalação conferidos. Node 24.22.2 e pnpm 11.24.0. |
| Build completo do Stage | Exit 0 no primeiro 5.1 e no 7 final. As repetições no 5.1 usaram o preload desse build. |
| PowerShell 5.1.26100.9711 | Runner e gate exit 0, 16 PASS / 0 FAIL / 0 skips, 39 requisições encerradas, 11 identidades encerradas, timeout de 30 061 ms. |
| PowerShell 7.6.9 | Runner e gate exit 0, 16 PASS / 0 FAIL / 0 skips, 40 requisições encerradas, 11 identidades encerradas, timeout de 30 058 ms. |

Os grupos 1 a 16 passaram em ambas as execuções. Os relatórios enumeram cada
resultado, do cofre e da migração ao crash controlado. Em ambas, todas as
requisições satisfizeram a autenticação esperada e encerraram, a checagem final
registrou zero identidades vivas, desconhecidas ou não verificáveis, e nenhum
poll reportou falha. A exportação foi conferida independentemente: os quatro
arquivos de cada pacote são byte a byte iguais aos originais e conferem com
tamanho e SHA-256 do manifesto. `logSecretsAbsent=true` e a busca independente
não encontrou credenciais sintéticas nos arquivos exportados.

O runner foi invocado da pasta do harness, com `-ElectronZip` apontando para o
ZIP oficial já verificado e `-ExportRoot J:\lia-evidence`, pois não existe `D:`
no host. No 5.1 foi usado `powershell.exe -NoProfile -ExecutionPolicy Bypass
-File run-gate-windows.ps1` e, na repetição final, `-SkipBuild`. No 7 foi usado
`pwsh -NoProfile -File run-gate-windows.ps1`, com build completo.

| Shell | Pasta original em `Tests/artifacts/provider-runtime-electron/` | Pacote em `J:\lia-evidence\` |
| --- | --- | --- |
| 5.1 | `1794016273746` | `f3946a69-bb31-40e2-a922-797f849a5e9b` |
| 7 | `1794016378308` | `d499d307-a11b-4fef-bbb3-78df21084b9d` |

Cada pacote contém `report.json`, `electron.log`, `electron.png`,
`environment.json` e `manifest.json`. O crash controlado ainda gera aviso de
frame descartado. A coleta de processos é amostral e pode perder processos
muito breves. Reinstalação de dependências/runtime, Stage completo, provedores
externos, voz remota e instalador não foram exercitados nesta rodada.


## 19. Transcrição gravada e cancelamento nativos — 07/11/2026

A rota derivada padrão e cinco definições de gravação executam no Main,
com UUID por operação, cancelamento HTTP, deadline distinta, isolamento por
janela e limpeza no encerramento. Registros usam o mesmo repository de
transportes, com protocolo `audio-transcription`; modelos e IDs personalizados
são preservados. Os quatro editores remotos salvam a chave explicitamente no
cofre, incluindo janelas follower, sem persistir a digitação no v-model.

Corrigido o bypass de `apiKey` histórico quando o resolver recusava fornecê-lo.
Isso não fecha todos os leitores do Stage: chat fora do catálogo, autenticação
de sessão STT, catálogo/editor genérico e outros consumidores legados continuam
identificados. Não removemos dependências AIRI nem declaramos desacoplamento.

A [matriz atual, evidências e roteiro manual](LIA-NATIVE-TRANSCRIPTION.md)
diferencia execução Main, preservação local e pendências. Os resultados de
cortes anteriores acima são históricos e não substituem essa matriz.
