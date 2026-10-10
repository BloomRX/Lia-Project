# LIA — Estado operacional atual (living state)

**Este arquivo é a fonte de verdade operacional do projeto.** Qualquer sessão nova deve
lê-lo antes de trabalhar. Quando uma decisão de produto ou um estado de validação mudar,
este arquivo é atualizado no mesmo commit — conforme a regra já estabelecida em
`docs/product/lia-ui-implementation-roadmap.md` ("Update documentation whenever a
deliberate product-level decision changes").

Ele registra **estado**, não narrativa. Relatórios longos de rodada continuam em
`docs/product/`. Aqui fica só o que uma próxima sessão precisa para não partir de
premissa falsa.

---

## 1. Repositório, branch e baseline validado

| Item | Valor |
| --- | --- |
| Repositório | `BloomRX/Lia-Project` |
| Branch de trabalho | `arena/01a10290-lia-project` |
| **Último commit funcional validado em Windows** | `3ef6d11618f787dae6d197645d440a5775a60ad6` |
| `main` | `db99c709059a6d074b18361bfb32c9f144620632` — **não recebeu merge** |
| Prefixo de código | tudo sob `airi/` |

**Atenção:** a branch contém código funcional **posterior** ao baseline acima — a rota
Brain multimodal da Phase 8.0D-M1, o bootstrap de roteamento da Phase 8.0D-M2 e a retenção
de turno falho da Phase 8.0D-M3 (seção 5). O reteste Windows da M2 **provou** o bootstrap
gerenciado do Brain e a seleção de rota (`mode=absent` → `automatic`; Qwen selecionado;
`initialRouteOverride*` observado na execução). O que continua **pendente** é o gate de
conteúdo da imagem: entender a imagem de fato, com resposta correta. O baseline só avança
quando um commit passar por esse gate Windows; até lá ele permanece `3ef6d11`.

### O tip da branch não é registrado aqui

A branch pode conter commits documentais posteriores ao baseline funcional, então
qualquer SHA de tip gravado neste arquivo nasceria obsoleto no commit seguinte. **O tip é
sempre verificado dinamicamente no preflight**, nunca lido deste arquivo:

```bash
git rev-parse HEAD                                            # tip local
git ls-remote origin refs/heads/arena/01a10290-lia-project    # tip remoto (devem bater)
git fetch -q origin main && git rev-list --count FETCH_HEAD..HEAD   # à frente de main
git status --porcelain | wc -l                                # deve ser 0
```

Pelo mesmo motivo **não existe contagem fixa de commits à frente de `main`** neste
arquivo: ela muda a cada commit e deve ser calculada no preflight. O que este arquivo
fixa são apenas duas coisas — o `main` de referência (`db99c709…`, válido enquanto
`main` não se mover) e o baseline funcional validado.

### Baseline funcional validado

`3ef6d11618f787dae6d197645d440a5775a60ad6` — **B1.1 / last Windows-validated functional
commit**.

É o último commit **de código** que passou pelo gate de runtime real. Commits posteriores
na branch podem ser puramente documentais; eles não alteram o baseline e não precisam
atualizar este arquivo. Quando um novo commit de código passar por um gate real novo, o
baseline passa a ser ele.

Commits funcionais da fase atual, do mais antigo ao mais recente:

```
d819397  phase 8.0D: derive final route conformance facts
8ddcbd2  phase 8.0D: preserve image attachments on retry
9ad9119  phase 8.0D: preserve voice turn fidelity
27ba585  phase 8.0D: bootstrap Lia-managed transcription      <- B1
3ef6d11  phase 8.0D: harden managed microphone bootstrap      <- B1.1 / last Windows-validated functional commit
```

**Nenhuma sessão deve criar outra branch, fazer merge em `main` ou abrir PR por conta
própria.** A branch de trabalho é fixa por sessão.

---

## 2. Cadeia de voz — WINDOWS E2E PASS

```
Lia.bat → managed STT → microphone → transcription → D2B12 → Brain → response → Kokoro TTS
                                     = WINDOWS E2E PASS
```

Confirmado pelo usuário em Windows real, rodando o commit `3ef6d11`, pelo fluxo normal:

- Lia iniciada por `Lia.bat`, sem nenhum passo manual;
- **nenhuma** configuração em AIRI Settings > Hearing;
- microfone/Hearing funcionou automaticamente;
- o usuário falou e a fala apareceu transcrita na interface, abaixo da Lia;
- o transcript entrou no fluxo normal de conversa;
- Lia respondeu;
- a resposta foi reproduzida por TTS.

### O que isso significa, em fatos

| Fato | Estado |
| --- | --- |
| **B1 — managed STT landed** | `27ba585` |
| **B1.1 — microphone bootstrap hardening landed** | `3ef6d11` |
| **Windows E2E** | **PASS confirmado em runtime real** |
| STT em produção | Groq, definição OpenAI-compatible, modelo `whisper-large-v3-turbo` |
| Hearing no modo **Complete** | configurado **automaticamente** pelo Launcher |
| Seleção manual de STT pelo usuário | **não é necessária** |
| Web Speech | **apenas diagnóstico histórico — NÃO é fallback** |
| Voice → D2B12 → Brain → TTS | **validado em runtime real** |

### Blocker encerrado — não reabrir

O blocker "microfone não habilita / fala não transcreve no Windows" está **encerrado**.

**Não reabrir sem nova evidência concreta de regressão** — ou seja, um novo
comportamento observado em Windows real, com o log do console do renderer do Stage.
Não reabrir por leitura de código, por suspeita estática, nem por teste automatizado
isolado: os testes passam e o runtime real também passa.

---

## 3. Como o Hearing gerenciado funciona (para não quebrar)

Autoridade de produto: o **Launcher** decide o STT e escreve o documento canônico
`lia-product.json`. O renderer do Stage **lê** essa decisão por IPC read-only e a projeta
nos stores do AIRI. Não existe setter de STT no renderer.

- `packages/lia-core/src/product/config.ts` — schema canônico, **sem nome de vendor**.
- `apps/lia-app/src/main/lia-host.ts` — `ensureSttReadyForConversar()` roda antes de
  `stage.start` e grava `voice.stt.preferred`.
- `apps/stage-tamagotchi/src/renderer/stores/lia/hearing.ts` — projeta o alvo canônico e
  faz o bootstrap do microfone.
- `apps/stage-tamagotchi/src/renderer/stores/lia/provider.ts` — alias de credencial
  **somente no caminho de leitura**.

Invariantes que B1/B1.1 estabeleceram e que valem como contrato:

- `voice.enabled === false` é **opt-out absoluto**: nunca chega ao handshake de permissão.
- O microfone **não é religado** depois que o usuário o desliga de propósito.
- O one-shot do bootstrap é consumido **por sucesso**, não por tentativa.
- Não existe watcher de microfone no store de Hearing.
- Nenhuma chave, áudio, transcript, `deviceId` ou label de dispositivo é logado ou
  persistido. Diagnósticos são metadata-only, prefixo `[LIA-HEARING]`.
- O modo de transcrição é **segmentado** (fala → pausa → texto), não palavra a palavra:
  é o caminho `startAutoSegmentation()`, e é o comportamento correto.

---

## 4. Estado da validação automatizada

Números da Phase 8.0D-M3 (retenção de turno falho + roteamento pelo prompt efetivo).
**Teste automatizado verde não é gate de runtime** — ver a seção 5 para o gate Windows
pendente.

| Verificação | Resultado |
| --- | --- |
| Stage `vitest run --project node` | 142 arquivos, **1757 passed**, 1 skipped |
| `@proj-airi/stage-ui` `--project node` | 151 arquivos, **1095 passed** |
| `@lia/core` | 28 arquivos, **353 passed** |
| `@proj-airi/core-agent` | 13 arquivos, **142 passed** |
| `@lia/lia-app` | 19 arquivos, **202 passed**, 2 skipped |
| typecheck `stage-tamagotchi` | **0 `error TS`** |
| typecheck `stage-ui` / `@lia/core` / `core-agent` / `@lia/lia-app` | **0 `error TS`** |
| `pnpm lint` (sem `--fix`) | **0 warnings, 0 errors em 3301 arquivos** |

Mutation tests (cada mutação restaurada e confirmada por `md5sum -c`):

| Mutação | Falhas |
| --- | --- |
| **M3** marcação da cauda do envio falho desativada em `executeSend` | **6 de 7** testes de exclusão; a requisição seguinte volta a levar **4 imagens** em vez de 1 — exatamente o `Too many images` do Windows |
| **M3** contribuição do histórico efetivo removida de `hasImageInput` | **3**; o retry só-texto sobre histórico com imagem volta a resolver **`openai/gpt-oss-120b`** em vez de `qwen/qwen3.8-27b` |
| **M3** filtro de `role: 'error'` removido da projeção | **5** (3 core-agent + 2 stage-ui); a bolha de erro volta a entrar no prompt do provider |
| **M2** chamada `ensureBrainReadyForConversar(snapshot)` removida de `conversar()` | **10 de 11** testes do ciclo de vida gerenciado |
| **M2** sonda de elegibilidade + gate de identidade do engine removidos | **1** (o teste “provider que o Brain não atende não fabrica automatic”) |
| **M2** chamada `decisionLog?.(decision)` removida da ponte | **3** (s1, s2, s3) |
| **M2** bloco `initialRouteOverride*` removido do formatador | **3** (m1, m2, m5) |
| **M1** `imageInput: true` removido do Qwen | 13 (8 lia-core + 5 Stage) |
| **M1** segunda rota removida da política | 12 (gates 3, 4, 5, 6, 6c, 8 + testes de política) |
| **M1** transporte do attachment até a request removido | 2 (gate 7 + o teste de attachments pré-existente) |

Comandos (a partir de `airi/`):

```bash
cd apps/stage-tamagotchi && npx vitest run --project node [arquivo]
cd packages/stage-ui && npx vitest run --project node [arquivo]
npx vitest run packages/core-agent          # a partir de airi/; @proj-airi/core-agent não tem script test
NODE_OPTIONS=--max-old-space-size=3072 npx vue-tsc --noEmit -p tsconfig.json   # em apps/stage-tamagotchi
pnpm lint
```

Armadilhas de tooling que continuam valendo:

- em `apps/stage-tamagotchi` passar **sempre** `--project node` (o default roteia para
  `browser`/chromium, ausente aqui);
- `vue-tsc` estoura heap no padrão — usar `NODE_OPTIONS=--max-old-space-size=3072`;
- `pnpm typecheck` na raiz **não completa** neste ambiente: nunca declarar como PASS;
- nunca `eslint --fix`;
- o ambiente **reverte sozinho**: conferir `git status`/HEAD no início de toda rodada e
  re-clonar da URL do GitHub na branch correta quando necessário.

---

## 5. Estado da 8.0D e a rota multimodal (Phase 8.0D-M1 / M2)

> **Status do gate Windows da M1: FAIL / NÃO VALIDADO.** O Qwen **não chegou a
> executar** — não falhou: não foi testado. Ver “Primeiro gate Windows da M1” abaixo.
> O baseline funcional **não avança**; continua `3ef6d11`.

Conforme `docs/product/lia-ui-implementation-roadmap.md`, a família de fases é
`8.0A → 8.0J` e o trabalho atual está em **8.0D — First Multimodal Brain Adapter**.

A reconciliação curta dos critérios de 8.0D **já foi feita** (auditoria read-only aceita).
Resultado, com a Phase 8.0D-M1 já aplicada:

| critério | status | observação |
| --- | --- | --- |
| text conversation | **DONE** | validado em Windows real no baseline `3ef6d11` |
| image/screen understanding | **IMPLEMENTADO, bootstrap+rota PROVADOS em Windows, gate de conteúdo da imagem PENDENTE** | rota Qwen (M1) + bootstrap de roteamento (M2, provado em Windows) + retenção de turno falho (M3). Falta o sucesso do turno de imagem no provider. Ver abaixo |
| audio understanding ("where supported") | **NOT STARTED** | o candidato aprovado é text+image; B1/B1.1 é STT *antes* do brain, não áudio nativo no brain |
| tool calling | **PARTIAL** | transporte + gate de compatibilidade provados no seam da Lia; o *loop* completo pertence ao `@xsai/stream-text` e segue como item de closure |
| latency | **NOT STARTED** | nenhuma medição existe; o contrato de telemetria exclui timing por desenho |
| region/network impact | **NOT STARTED** | nenhuma referência no escopo Brain |
| failure behavior | **PARTIAL** | failover real registrado e classificado; a **retenção de turno falho** foi corrigida na M3 (um envio que falhou não participa mais do contexto de provider futuro). Falta teste dirigido recoverable→failover / permanent→não |
| default não medido no alvo | **PARTIAL** | medido só pelo E2E de voz |

### O que a Phase 8.0D-M1 entregou

Uma rota Brain **realmente multimodal**, sem substituir o brain textual:

- engine `groq`, agora com **dois** modelos: `openai/gpt-oss-120b` (textual, primeira rota)
  e `qwen/qwen3.8-27b` (visão, segunda rota);
- o engine declara o **superset** de capabilities; cada modelo declara as suas. É o
  contrato que já existia (`routes.ts`/`resolver.ts` julgam engine **e** modelo pelos
  próprios descritores), não um contorno;
- um turno que exige `imageInput` torna o GPT-OSS inelegível e resolve para o Qwen **por
  capability**, através da política declarada — sem heurística de filename, prompt,
  provider ativo ou UI;
- turno **sem** imagem continua resolvendo para `openai/gpt-oss-120b`; o Qwen nunca é
  promovido por acidente;
- mesma credencial Groq, mesmo provider, nenhuma key nova, nenhum provider novo,
  `activeProvider`/`activeModel` globais intactos;
- Voice/STT/TTS intocados (gate automatizado pinça as identidades do B1/B1.1).

O transporte de imagem já existia e é **agnóstico de modelo**:
`core-agent/src/runtime/chat-orchestrator-runtime.ts` monta partes `image_url` em data URL
base64, e `sanitizeMessages` as preserva enquanto `streamOptionsContentArrayCompatibilityOk`
é verdadeiro (default por model key). Limite publicado do modelo: **3 imagens** por turno,
cada uma contando 2048 tokens de entrada.

### Primeiro gate Windows da M1 — **FALHOU** (evidência real)

O usuário rodou o fluxo normal em Windows (`Lia.bat` → Conversar), anexou uma imagem e
enviou o prompt determinístico. Resultado:

```
Remote sent 400 response: {"error":{"message":"messages[9].content must be a string",
"type":"invalid_request_error","param":"messages[9].content"}}
```

e, no log do Launcher/Stage para os mesmos envios lógicos:

```
status="noBrainRouteSelected"  attempt0.providerId="groq"
attempt0.modelId="openai/gpt-oss-120b"  → terminal failed
```

Ou seja: **o Qwen não foi executado**. O turno com imagem caiu na rota globalmente ativa
(GPT-OSS), e o Groq rejeitou o array de conteúdo.

**Causa raiz exata — provada por execução, não por leitura de código.** Rodando o código
de produção real do `@lia/core` (catálogo de produção + política de produção +
`decideBrainRouteFromProductState`) sobre o documento canônico que um Launcher normal
produz:

| estado do documento | turno com imagem | `routeOverride` |
| --- | --- | --- |
| como o Launcher deixa (`brain` ausente) | `{"status":"modeUnspecified"}` | `undefined` |
| com `brain.mode="automatic"` | `automatic` / `selected` → `groq` + `qwen/qwen3.8-27b` | presente |

`readBrainRoutingMode` devolve `undefined` porque **nada no produto escreve `brain.mode`**:
`brainRoutingModeUpdate` não tinha nenhum call site de produção, `defaultLiaProductConfig`
não tem a chave `brain`, o Launcher não tinha nenhuma referência a `brain`, e não existe
IPC nem UI que grave o campo. `modeUnspecified` → sem rota → `resolveLiaBrainSendRouteCandidate`
devolve `undefined` → o envio mantém o provider/modelo ativo → a imagem chega a um modelo
textual.

**Dívida de compatibilidade separada (registrada, NÃO usada para mascarar o defeito):** a
string de erro do Groq `messages[N].content must be a string` **não** casa com nenhum dos
padrões de `CONTENT_ARRAY_RELATED_ERROR_PATTERNS` (`core-agent/src/runtime/llm-service.ts`),
que cobrem “invalid type: sequence, expected a string” e “expected/should be … string”.
Portanto o auto-degrade de content-array não dispara para essa variante. **Isto não foi
“corrigido” de propósito**: fazer um turno com imagem passar como texto-only seria um falso
PASS. O comportamento exigido continua sendo
`imageInput → Brain autoritativo → qwen/qwen3.8-27b → imagem chega ao provider`.

### O que a Phase 8.0D-M2 entregou (correção autorizada)

O menor bootstrap de produto possível, análogo em espírito ao STT gerenciado, e dono do
mesmo princípio: **o Launcher é a autoridade de configuração de produto**.

`ensureBrainReadyForConversar(snapshot)` em `airi/apps/lia-app/src/main/lia-host.ts`,
chamado em `conversar()` antes de o filho subir:

- `brain.mode` **explícito** é absoluto: `disabled` e `manual` nunca são sobrescritos, e um
  `automatic` existente é preservado sem regravação;
- **só** um modo ausente pode ser default, e só quando **todos** valem:
  1. existe chat provider configurado;
  2. o **Brain real de produção** — mesmo catálogo, mesma política, mesma decisão canônica
     que o Stage roda — **selecionaria** uma rota para um turno de texto simples em modo
     automático (a elegibilidade é **perguntada** ao roteador, nunca presumida);
  3. o engine dessa rota **é** o chat provider configurado (identidade engine↔provider,
     sem segunda tabela de mapping) — é isso que impede selecionar o Groq Brain para quem
     não o justifica;
  4. a credencial **existente** daquele provider está presente (só a presença; o valor nunca
     é lido, copiado ou logado);
- persiste pelo writer canônico (`brainRoutingModeUpdate`); sem mutação de config no
  renderer, sem tocar `activeProvider`/`activeModel`, sem B1/B1.1/STT/TTS, sem 8.0E;
- falha de escrita degrada honestamente: documento intacto, conversa segue, motivo emitido.

Não é uma segunda autoridade de roteamento: a decisão continua sendo do roteador canônico,
feita pelo Stage.

**Diagnóstico metadata-only adicionado** (para o próximo gate não precisar inferir nada):

| fato | onde |
| --- | --- |
| modo canônico recebido (owner do campo) | evento `lia-app.conversar-brain-mode mode=automatic\|manual\|disabled\|absent` |
| default aplicado / recusa e motivo | `lia-app.conversar-brain-defaulted mode=automatic` / `lia-app.conversar-brain-not-ready reason=…` |
| **status da decisão** + engine/modelo selecionados | linha nova `[LIA-BRAIN-DECISION]` (`brain-decision-diagnostic.ts`, dev-gated) |
| resultado do `routeOverride` autoritativo | campos `initialRouteOverride*` acrescentados ao fim da linha `[LIA-BRAIN-DIAG]` |

Nada de prompt, imagem, ferramenta ou credencial em nenhum deles.

### Gate de saída PENDENTE — Windows E2E visual

Testes automatizados verdes **não** são este gate. Roteiro exato:

1. abrir a Lia pelo fluxo normal (`Lia.bat`), sem configurar nada;
2. **anexar uma imagem** numa conversa;
3. perguntar algo **determinístico** sobre o conteúdo dela (ex.: texto legível na imagem,
   contagem de objetos, cor dominante);
4. confirmar que a rota usada foi **`groq` + `qwen/qwen3.8-27b`**;
5. confirmar que a resposta está **correta com base no conteúdo da imagem** — não uma
   resposta genérica plausível;
6. confirmar de passagem que um turno **só de texto** continua no GPT-OSS.

Provas de runtime a ler no log (todas metadata-only; **não** inferir nada
indiretamente desta vez):

| o que procurar | onde | o que significa |
| --- | --- | --- |
| `lia-app.conversar-brain-mode mode=…` | log do Launcher | modo canônico que este lançamento recebeu. Na primeira execução de um install existente espera-se `mode=absent`; da segunda em diante, `mode=automatic` |
| `lia-app.conversar-brain-defaulted mode=automatic` | log do Launcher | o default foi gravado (só na primeira execução) |
| `lia-app.conversar-brain-not-ready reason=…` | log do Launcher | o default foi recusado — o motivo está no próprio evento |
| `[LIA-BRAIN-DECISION] status=… selection=… selectedEngineId=… selectedModelId=…` | log do Stage | **status real da decisão**. Para o turno com imagem espera-se `status="automatic" selection="selected" selectedEngineId="groq" selectedModelId="qwen/qwen3.8-27b"` |
| `initialRouteOverrideStatus=… initialRouteOverrideProviderId=… initialRouteOverrideModelId=…` | fim da linha `[LIA-BRAIN-DIAG]` | o `routeOverride` autoritativo que a execução recebeu de fato |

`noBrainRouteSelected` **não** deve mais aparecer. Se aparecer, a linha
`[LIA-BRAIN-DECISION]` diz qual foi o status da decisão — não é preciso deduzir.

Só depois desse gate o baseline funcional avança e `image/screen understanding` pode ser
marcado DONE.

### O que a Phase 8.0D-M3 entregou — retenção de turno falho e roteamento pelo prompt efetivo

Duas falhas reais observadas em Windows depois que a M2 fez o Qwen finalmente executar:

1. `Too many images provided. This model supports up to 3 images`;
2. num turno posterior **só de texto**, `messages[9].content must be a string` com GPT-OSS.

A auditoria read-only (aceita em `a8900b7`) provou as duas por execução, e a causa raiz é
uma só: **o registro da conversa e o prompt do provider eram a mesma lista**. Um envio que
o provider rejeitou continuava durável, visível **e** projetado — então cada tentativa
falha de imagem doava a sua imagem ao pedido seguinte, e um turno só de texto herdava a
imagem de um turno antigo sem que o requisito de rota soubesse disso.

O que mudou:

- **`excludedFromProviderContext`** — campo **genérico** em `ChatHistoryItem`
  (`core-agent/src/types/chat.ts`). Ausente/`false` é o comportamento histórico. Só um
  `true` explícito retira a mensagem da projeção; UI, persistência e retry continuam
  vendo-a.
- **Uma única regra de contexto de provider** — `core-agent/src/messages/provider-context.ts`
  (`isProviderContextMessage`, `selectProviderContextMessages`,
  `countProviderContextImageParts`, `hasProviderContextImageInput`). É a **única**
  definição de “o que chega ao provider”, consumida pela projeção do runtime **e** pelos
  fatos de capacidade do Brain. A segunda definição que existia em
  `stage-ui/src/stores/chat.ts` (`toProviderHistory`, que alimentava o artist task) foi
  **removida** e passou a usar a mesma regra.
- **Marcação na fronteira de settlement** — `executeSend` marca a cauda que o envio lógico
  acrescentou **antes** de a bolha de erro ser acrescentada. Vale para **qualquer** falha
  terminal, com ou sem fallback resolver registrado; nada inspeciona o erro.
- **`role: 'error'` nunca entra no prompt** — filtrado na costura canônica de projeção.
  Uma bolha de erro deixa de ser reescrita como texto de usuário sintético nos pedidos
  seguintes.
- **Requisito de Brain pelo prompt efetivo** — `chatTurnFactsFromSend` recebe agora
  `providerHistory` (obrigatório em todos os call sites) e deriva `hasImageInput` da
  attachment atual **ou** do histórico ainda visível ao provider. Consequência aceita de
  produto: enquanto uma imagem bem-sucedida estiver no contexto efetivo, um turno novo só
  de texto **também** exige `imageInput` e vai para `groq` + `qwen/qwen3.8-27b`.

Nada foi achatado: nenhuma imagem histórica é convertida em texto nem removida
silenciosamente para “caber” num modelo.

**Não entregue nesta fase — dividido como 8.0D-M3.1:** o preflight do limite de **3
imagens** do modelo de visão. Expressar um limite numérico exige alargar o schema de
capacidades, que hoje é booleano por construção (`LiaBrainCapabilities`, nove campos, e
`satisfiesBrainCapabilities` compara `!== true`); o lugar natural é
`LiaBrainModelDescriptor.metadata`, hoje documentado como opaco e nunca lido pelo
registry. Fazer o registry lê-lo **é** o alargamento, então foi parado e reportado em vez
de alargado. A M3 já elimina a causa observada em Windows (imagens de tentativas falhas);
o teto continua real para **4 ou mais imagens bem-sucedidas** na mesma conversa, e o M3.1
deve rejeitar o envio **antes** do pedido com erro determinístico de produto — nunca
descartando imagens.

**Dívida de Cloud Sync registrada:** o Cloud Sync v1 envia texto puro para user/assistant,
partes de imagem não fazem round-trip e mensagens de erro são locais. Portanto a marca de
exclusão é autoritativa na **persistência local** e a semântica de turno falho **não é
plenamente representável entre dispositivos** no v1. A M3 não amplia o schema de wire e
não é uma migração de protocolo.

**Gate:** testes automatizados verdes **não** são este gate. O E2E multimodal em Windows
continua **NOT PASS**; o baseline funcional validado continua sendo `3ef6d11`.

### Itens de closure restantes da 8.0D (fora desta fase)

1. **tool-calling closure** — teste dirigido do loop completo: rota resolvida → modelo
   devolve `tool_call` → ferramenta executa → resultado volta ao modelo. O loop vive no
   `@xsai/stream-text`; prová-lo exige modelo real ou um mock arquitetural pesado, por
   isso não foi alargado o escopo nesta fase.
2. **latency measurement** (Windows real).
3. **region/network measurement** (Windows real).
4. **directed failure-behavior test** (automatizável) — recoverable→failover /
   permanent→não-failover. A parte de **retenção** do turno falho já está coberta pela M3.
5. **8.0D-M3.1 — preflight do limite de imagens do modelo de visão.** Rejeitar o envio
   antes do pedido, com erro determinístico de produto, quando o contexto visual efetivo
   exceder o limite do modelo selecionado. Exige metadata de capacidade numérica; ver
   acima. Nunca resolver descartando ou achatando imagens.
6. **Cloud Sync v1 — semântica de turno falho entre dispositivos.** A marca de exclusão é
   local; partes de imagem não fazem round-trip no v1. Registrado como dívida de sync, não
   como migração de protocolo.
7. **variante de string de erro do Groq para content-array** — `messages[N].content must
   be a string` não casa com `CONTENT_ARRAY_RELATED_ERROR_PATTERNS`
   (`core-agent/src/runtime/llm-service.ts`). Registrado como dívida; **não** alargar o
   auto-degrade para “resolver” a M1, porque isso transformaria um turno com imagem num
   falso PASS textual. A M3 remove a **causa** observada (um turno só de texto não é mais
   roteado a um modelo textual enquanto uma imagem vai no mesmo pedido); a dívida de
   casamento de string permanece para os demais casos.

**8.0D não está CLOSED.** E **8.0E não foi iniciado**: nenhum screenshot capture, window
capture, câmera, audio input nativo, nova UI de provider, novo provider ou mudança de key.

---

## 6. Regras permanentes que continuam valendo

Resumo operacional. A lista completa e o histórico de armadilhas estão em
`docs/product/HANDOFF-PROMPT.md` e em `AGENTS.md`.

- Falar sempre em pt-BR.
- Nunca `git reset --hard` / `restore` / `clean` / `stash` / `rebase` / `--amend` /
  force push. Nunca descartar trabalho preexistente.
- Nunca declarar PASS sem ter executado. Teste automatizado verde **não é** PASS de
  runtime: o gate é Windows real.
- Nunca gravar segredo em log, `localStorage` ou config. Reportar apenas
  configurado/não-configurado e o provider ID.
- Provedor e model **nunca hardcoded**; `lia-product.json` é a única autoridade de produto.
- Não tocar em Persona, secrets, TTS runtime, fallback de chat, web/pocket ou live model
  discovery sem autorização explícita da rodada.
- `DevKit.bat` da raiz não pode ser alterado, substituído ou renomeado.
- Commits separados por responsabilidade; informar hash, arquivos e riscos.
- **STOP AND REPORT** em vez de contornar um bloqueio, alargar escopo ou commitar
  workaround.

---

## 7. Como manter este arquivo

Atualizar aqui, no mesmo commit, sempre que mudar:

1. a branch de trabalho, ou o `main` de referência;
2. **o baseline funcional validado** — ou seja, quando um novo commit **de código** passar
   por um gate de runtime real (registrar o SHA, o gate e o resultado);
3. uma decisão de produto que altere o comportamento visível;
4. a transição de fase no roadmap.

**Não exigir atualização deste arquivo a cada commit documental.** Commits que só mudam
`docs/` não alteram o baseline funcional e não precisam tocá-lo. É exatamente por isso
que o tip da branch e a contagem de commits à frente de `main` **não** são registrados
aqui: seriam obsoletos no commit seguinte. Ambos se verificam no preflight (seção 1).

Não transformar este arquivo em relatório de rodada. Relatório de rodada vai para
`docs/product/` com nome próprio; aqui entra só o estado resultante.
