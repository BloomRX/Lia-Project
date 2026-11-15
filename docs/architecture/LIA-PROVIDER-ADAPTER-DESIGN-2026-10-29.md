# B0.6 — Desenho do adaptador de configuração próprio da Lia

**Data:** 29/10/2026 · **Natureza:** análise. **Nada foi alterado.**
Base: HEAD `720a780`, árvore limpa, `airi/` intocado.
Continuação direta de B0.2 (aresta 4), B0.3 (bateria), B0.4 (política) e B0.5
(por que a remoção por cirurgia não é segura).

Autoridade: `AGENTS.md` §99. Mapa completo em
[`LIA-STAGE-DEPENDENCY-MAP-2026-10-28.md`](LIA-STAGE-DEPENDENCY-MAP-2026-10-28.md).

**Legenda:** **[C]** confirmado no código · **[I]** inferido · **[P]** pendente.

---

## 1. Resumo para decisão

O B0.5 concluiu que a aresta `composables/api` não pode ser removida por cirurgia.
Este documento desenha **por que ela morre por consequência** e qual é a menor
fronteira capaz de produzir essa consequência.

Três descobertas orientam o desenho:

1. **A Lia escreve no registro de provedores com `baseUrl`, e sim, por um caminho
   vivo.** `LiaProviderConfig.vue:215` chama `ensureProviderRecord(id, baseUrl)`
   diretamente. Quando o registro já existe e o usuário informou uma URL
   personalizada, `provider.ts:354` chama `updateProviderConfig`, que replica.
   Não é código morto. [C]

2. **O `baseUrl` mora em `localStorage`, não no `lia-product.json`.** O arquivo do
   produto guarda apenas *seleção* (`providerId`, `modelId`, estratégia, flags);
   o registro do provedor — com `baseUrl` e `status` — mora em
   `settings/providers/configured`. Duas camadas distintas. Qualquer store nova
   precisa ler essa chave para não perder configurações já existentes. [C]

3. **O canal entre janelas não é a requisição HTTP.** São coisas separadas:
   replicação remota (`patchConfigRemote` → `api.airi.build`) e sincronização
   entre janelas (`pinia-plugin-synced`, `state: true`). Desligar a primeira não
   desliga a segunda — e desligar a segunda, sem cuidado, quebra a janela de
   configurações. [C]

A fronteira mínima que sai disso **não é um store novo**. É uma **fachada com
porta de efeito remoto**: escrita local síncrona e autoritativa, efeito remoto
isolado numa porta explícita que pode ser omitida. O Stage continua idêntico
enquanto a porta estiver ligada; a Lia passa a depender só do contrato.

---

## 2. Estado atual comprovado

### 2.1 Os campos que a Lia lê e modifica

`InferenceServiceProvider` (`libs/providers/types.ts:36-47`) tem cinco campos.
A Lia toca **quatro**, e um deles só indiretamente: [C]

| Campo | A Lia lê | A Lia escreve | Como |
| --- | --- | --- | --- |
| `id` | sim | indiretamente | chave do mapa; vem de `providerId` curado |
| `definitionId` | sim | indiretamente | igual ao `id` (`ensureProviderRecord:348`) |
| `config` | **sim** | **sim** | `{ baseUrl }` em provider.ts; `{ baseUrl, model }` em hearing.ts |
| `status` | **sim** | **sim** | `'unconfigured'` nas duas escritas; `forceProviderConfigured` grava `'configured'` |
| `configuredBy` | **sim** (B0.4) | **não** | derivado da definição por `ensureProvider` |

`ProviderValidationStatus` tem cinco valores (`types.ts:32`); a Lia usa três:
`'unconfigured'`, `'configured'` e lê `'bypassed'` só por tabela.

**Nenhum campo de credencial aparece.** A `apiKey` entra exclusivamente pelo
resolver registrado (`provider.ts:526`), em memória, no build da instância. [C]

### 2.2 Fluxos de escrita — rastreados até o chamador final

**Fluxo A — conclusão da configuração (painel).** [C]

```
LiaProviderConfig.vue:215
  └─ store.ensureProviderRecord(providerId, baseUrl.trim() || undefined)   provider.ts:347
       ├─ registro ausente  → ensureProvider(id, id, {baseUrl})            LOCAL, sem rede
       └─ registro presente → (baseUrl informado?)
            ├─ não → nada
            └─ sim → updateProviderConfig(id, {...current, baseUrl}, 'unconfigured')   provider.ts:354
                       └─ patchConfigRemote                                          config.ts:224   REDE
```

**Fluxo B — projeção de transcrição na montagem.** [C]

```
App.vue:356  (onMounted, somente windowContext.leadership === 'leader-only')
  └─ liaHearingStore.initialize()
       └─ applyProviderProjection(target)                                  hearing.ts:199
            ├─ registro ausente  → ensureProvider(id, defId, config)       LOCAL
            └─ registro presente → updateProviderConfig(id, config, 'unconfigured')   hearing.ts:206
                                     └─ patchConfigRemote                                    REDE
```

`appliedSignature` começa indefinido; a primeira projeção de cada sessão sempre
prossegue. **Consequência: uma requisição `PATCH` por inicialização** quando o STT
está configurado e o registro já existe. [C]

**Fluxo C — ativação do provedor preferido.** [C]

```
activatePreferred() provider.ts:406  |  activateConfiguredProvider() provider.ts:432
  └─ activateTarget(preferred)                    // sem o 2º argumento
       └─ ensureProviderRecord(id, undefined)
            └─ apenas ensureProvider se ausente    LOCAL, sem rede
```

Ou seja: a ativação em si **não** replica. Só os fluxos A e B replicam.

### 2.3 Persistência local

`config.ts:45-48` usa `useLocalStorage` (VueUse), três chaves: [C]

| Chave | Conteúdo | Papel |
| --- | --- | --- |
| `settings/providers/configured` | `Record<id, InferenceServiceProvider>` | **registro canônico** — onde `baseUrl` e `status` vivem |
| `settings/providers/added` | `Record<id, boolean>` | "adicionado pelo usuário"; alimenta `listedProviders` |
| `settings/credentials/providers` | `Record<id, config>` | **legado**, migrado na construção |

`providerStorageOptions` fixa `listenToStorageChanges: false` (`config.ts:15-19`),
com o comentário explicando que `pinia-plugin-synced` é o único canal entre
janelas — ouvir eventos de storage realimentaria o líder como proposta de estado.

**Migração** (`config.ts:52-70`): roda na construção da store, copia o legado para
`configured` pulando ids que já existem. Idempotente por causa da guarda; não
apaga a chave antiga. [C]

### 2.4 Serialização e sincronização entre janelas

`config.ts:261-275` declara `synced: { actions: [9 nomes], state: true }`. [C]

- `state: true` → o **estado inteiro** da store é replicado; um seguidor recebe
  `providers`, `addedProviders` e as derivadas.
- As 9 ações são encaminhadas ao líder e executadas lá.
- O namespace é `airi:stage:pinia` (`libs/pinia/setup-synced.ts:25`), com
  `callTimeout` de 5 min.
- A liderança vem da query `synced-leader`, resolvida em
  `renderer/window-context.ts:58`.

**Somente a janela principal é líder** (`windows/main/index.ts:211`,
`'synced-leader': 'true'`). São **13 janelas seguidoras**: about, caption, chat,
dashboard, desktop-overlay, devtools, editor, inlay, notice, onboarding, settings,
spotlight, widgets. [C]

Como a Lia vive na janela principal (`App.vue`), suas escritas propagam aos
seguidores pelo canal synced — não pela rede.

### 2.5 O que é local e o que é remoto em `inference-service-providers.ts`

| Função | Natureza | A Lia usa? |
| --- | --- | --- |
| `buildLocal` (`:100`) | puro, sem I/O; gera `id` com `nanoid()` | **não** — `ensureProvider` monta o objeto inline |
| `normalize` (`:114`) | puro; traduz `validated`/`validationBypassed` → `status` | indiretamente, no eco remoto |
| `fetchRemote` (`:134`) | **HTTP** | não |
| `createRemote` (`:151`) | **HTTP** | não |
| `deleteRemote` (`:171`) | **HTTP** | não |
| `patchConfigRemote` (`:181`) | **HTTP** | **sim**, pelos fluxos A e B |

**O que é compartilhado com o Stage e não pode mudar sem afetá-lo:**
`config.ts` inteiro (persistência, migração, sync, as três mutações),
`inference-service-providers.ts` inteiro, e `useProviderStore` — que lê
`providerConfigStore.configs` (`provider.ts:119`) para construir instâncias. [C]

**O que a Lia pode evitar sem tocar no Stage:** o *acoplamento direto* a esses
módulos, substituindo-o por um contrato próprio. Foi o que o B0.4 fez para a
política de autenticação; este documento propõe o mesmo movimento para a
configuração.

---

## 3. Fronteira mínima proposta

### 3.1 Princípio

Uma **fachada**, não um store novo. A fachada:

- expõe só o que a Lia usa, com nomes do domínio da Lia;
- torna a escrita local **síncrona e autoritativa** (hoje o eco remoto pode
  substituir o registro local — `config.ts:225-226`);
- isola o efeito remoto numa **porta explícita**, cuja implementação padrão
  preserva o comportamento atual do Stage;
- mantém a mesma store por baixo, logo **as mesmas chaves de `localStorage`** e a
  mesma sincronização entre janelas.

A vantagem de fachada sobre store novo: o comportamento do Stage fica idêntico
por construção, e a bateria B0.3 pode rodar contra ela sem reescrever asserções.

### 3.2 Interface conceitual

```
// Leitura — sem efeito, sem rede
LiaProviderRegistry
  get(id: string): LiaProviderRecord | undefined
  all(): Record<string, LiaProviderRecord>
  isConfigured(id: string): boolean

// Escrita local — síncrona, autoritativa, sem rede
LiaProviderWriter
  ensure(id: string, definitionId: string, config: LiaProviderConfig): LiaProviderRecord
  updateConfig(id: string, config: LiaProviderConfig, status: LiaProviderStatus): LiaProviderRecord

// Efeito remoto — separado, opcional, substituível
LiaProviderReplication
  replicate(record: LiaProviderRecord): Promise<void>    // pode ser no-op
```

Tipos do domínio da Lia, delimitados:

```
LiaProviderConfig      // Record<string, string> — só valores escalares, sem credencial
LiaProviderStatus      = 'unconfigured' | 'configured' | 'bypassed'
LiaProviderRecord      = { id, definitionId, config: LiaProviderConfig,
                           status: LiaProviderStatus, configuredBy: 'user' | 'authentication' }
```

**Por que a escrita fica síncrona.** Hoje `updateProviderConfig` é `async` por
causa do `await mutateAsync`. Se o efeito remoto sai da função, não resta motivo
para ela ser assíncrona. Os dois chamadores (`provider.ts:354`,
`hearing.ts:206`) já usam `await`; `await` sobre valor não-promise é inócuo, então
a troca é compatível na chamada, mas **deve ser decidida explicitamente** (§7, D-2).

**Por que o tipo de `config` não tem campo de credencial.** É o mesmo argumento do
`lia-capability-port`: se o tipo não tem onde guardar a `apiKey`, nenhum caminho
novo pode introduzi-la por acidente. A credencial continua entrando só pelo
resolver, no build da instância — fora da fachada.

### 3.3 O que a fachada NÃO cobre

Os sete membros de runtime (`validateProviderConfig`, `initializeProvider`,
`forceProviderConfigured`, `disposeProviderInstance`, `getModelsForProvider`,
`supportsModelListing`, `getProviderInstance`) **ficam de fora**. Eles executam
provedores e constroem instâncias; são o passo 6 do B0.2, não este. A fachada é
só de configuração — seis membros: cinco de leitura/escrita local e um de efeito
remoto.

**Fronteira explícita:** depois da fachada, a Lia ainda depende de
`useProviderStore` para executar. O adaptador **não** elimina essa dependência, e
não deve ser vendido como se eliminasse.

---

## 4. Persistência e compatibilidade

### 4.1 Três camadas, não uma

| Camada | Onde | O que guarda | Quem escreve |
| --- | --- | --- | --- |
| Cofre | processo principal | `apiKey` por escopo | IPC `lia:secret:*` |
| Produto | `lia-product.json` | seleção: `preferred`, `fallback`, `onboarded` | IPC `lia:provider:chat:config:set` |
| Registro | `localStorage` do renderer | `config` (com `baseUrl`), `status`, `configuredBy` | store compartilhada |

**O `baseUrl` personalizado está na terceira camada, não na segunda.** [C]
Verificado: `LiaProviderChatTarget` tem só `providerId` e `modelId`
(`shared/eventa/index.ts:569-572`); `LiaProviderChatConfig` tem só estratégia,
preferido, fallback e flags (`:574-582`).

**Consequência de projeto:** qualquer implementação futura que não continue lendo
`settings/providers/configured` **perde as URLs personalizadas** dos usuários
existentes — elas simplesmente não estão em nenhum outro lugar.

### 4.2 Requisitos de compatibilidade

| # | Requisito | Verificação proposta |
| --- | --- | --- |
| K1 | Continuar lendo `settings/providers/configured` | teste de reload com fixture nessa chave |
| K2 | Continuar honrando a migração de `settings/credentials/providers` | teste com a chave legada preenchida |
| K3 | `baseUrl` personalizado sobrevive a um ciclo completo | round-trip ensure → update → reload |
| K4 | `status` não regride por efeito de replicação | teste comparando antes/depois do eco |
| K5 | Config nunca ganha campo de credencial | asserção de ausência no registro serializado |
| K6 | Nenhuma leitura de cofre ou `lia-product.json` pela fachada | revisão de imports + teste de fronteira |

**Credenciais:** a fachada nunca as vê. O resolver é registrado em
`provider.ts:526`, fora da fachada, e continua sendo o único caminho. Nenhum
teste desta etapa lê cofre ou `lia-product.json`.

### 4.3 Onde a compatibilidade quebra se a decisão for "store própria"

Se o produto optar por uma store realmente separada (não fachada), os requisitos
sobem de nível e passam a incluir **uma migração de dados**:

1. ler `settings/providers/configured` na primeira execução;
2. copiar para a chave nova;
3. manter a chave antiga intacta por uma versão;
4. **não** migrar credenciais — elas não estão lá.

Isso é trabalho real e um risco próprio. A fachada evita tudo isso porque não
troca a camada de persistência. [I]

---

## 5. Matriz de riscos e efeitos sobre o Stage

| # | Risco | Efeito se a fachada for implementada | Efeito se a Lia ganhar store própria | Confiança |
| --- | --- | --- | --- | --- |
| R1 | Janela de configurações (seguidora) deixa de ver provedores da Lia | **nenhum** — mesma store, mesmo canal synced | **alto**: a store nova não está na lista `synced`, e seguidores não veriam nada até recarregar | [C] para o mecanismo, [I] para o efeito |
| R2 | Eco remoto sobrescreve o registro local | **resolvido** pela escrita síncrona: o remoto passa a ser efeito, não fonte | resolvido por construção | [C] |
| R3 | URL personalizada perdida | **nenhum** — mesmas chaves | **alto** sem migração (§4.3) | [C] |
| R4 | Uma `PATCH` por inicialização (fluxo B) | inalterado enquanto a porta estiver ligada | **desaparece** — é o objetivo | [C] |
| R5 | Migração legada roda duas vezes (duas stores) | não se aplica | risco real: duas stores migrando a mesma chave | [I] |
| R6 | Ordem `updateConfig('unconfigured')` → `forceProviderConfigured('configured')` | inalterada; a fachada preserva a sequência | precisa ser reproduzida explicitamente | [C] |
| R7 | Follower executa ação encaminhada ao líder fora de ordem | inalterado | a store nova não teria o encaminhamento | [P] |
| R8 | `providerStore.getProviderInstance` lê `providerConfigStore.configs` (`:119`) | inalterado — a fachada escreve na mesma store | **quebra**: o runtime não veria os registros da store nova | [C] |
| R9 | `stage-pages` lê a store compartilhada nas páginas de configuração | inalterado | páginas do Stage mostram estado divergente | [C] |

**R8 é o mais sério e o menos óbvio.** Uma store própria da Lia não é suficiente:
`useProviderStore` monta instâncias a partir de `providerConfigStore.configs`,
não de qualquer store da Lia. Sem mudar também o caminho de leitura do runtime, os
provedores configurados pela Lia deixariam de ser encontráveis na execução. Isso
empurra a store própria para um passo muito maior do que parece. [C]

### 5.1 A remoção futura da replicação afeta outras janelas?

**Fatos verificados:**

- A replicação remota (`patchConfigRemote`) e a sincronização entre janelas
  (`pinia-plugin-synced`) são canais **independentes**. Desligar a primeira não
  afeta a segunda. [C]
- Só a janela principal é líder; as 13 demais recebem estado por synced. [C]
- A janela de configurações renderiza páginas de `stage-pages` que leem a store
  compartilhada. [C]
- A Lia não é a única escrevente: `stage-pages` também chama
  `updateProviderConfig` nas páginas de configuração de provedor. [C]

**Hipóteses não verificadas:**

- **[P]** Se alguma janela seguidora **precisa** dos registros em runtime (por
  exemplo, a janela de chat construindo instâncias). Não foi rastreado qual
  processo envia mensagens.
- **[P]** Se o backend em `api.airi.build` mantém estado consultado por outro
  cliente ou por outro dispositivo. A Lia não chama `fetchProviders`, mas o Stage
  chama. Deixar de replicar **não** altera o que o Stage já gravou lá.
- **[P]** Se o eco remoto hoje normaliza algum campo que a Lia depende de ter
  normalizado (`normalize` traduz `validated` → `status`). Enquanto o registro for
  escrito diretamente com `status`, o eco é irrelevante — mas isso não foi medido
  com um servidor real.

**Conclusão honesta:** remover a replicação **do caminho da Lia** não afeta outras
janelas nem o Stage, desde que a Lia continue escrevendo na store compartilhada.
Se a Lia deixar a store compartilhada, afeta — e muito.

---

## 6. Plano de testes e critérios de aceitação

### 6.1 Testes propostos

Todos determinísticos: `fetch` stubado, sem rede, sem cofre, sem
`lia-product.json`, sem credencial real.

| ID | Teste | Como | Projeto |
| --- | --- | --- | --- |
| **T1** | `updateConfig` grava local e devolve o registro, sem esperar rede | chamada direta; `fetch` que nunca resolve | `node` |
| **T2** | Com a porta remota desligada, **zero** requisições | contador em `fetch` stubado | `node` |
| **T3** | Com a porta ligada, **uma** requisição (comportamento atual preservado) | contador em `fetch` stubado | `node` |
| **T4** | Registro sobrevive a "reinício" (nova instância Pinia, mesma fixture) | injetar fixture em `settings/providers/configured` | `browser` |
| **T5** | Escrita no líder aparece no seguidor | `createSyncedContext` com dois contextos e namespace único | `browser` |
| **T6** | `baseUrl` personalizado sobrevive a um ciclo completo | ensure → update({baseUrl}) → releitura | `node` |
| **T7** | Migração legada continua funcionando | fixture em `settings/credentials/providers` | `browser` |
| **T8** | Config nunca contém credencial após update | asserção de ausência no serializado | `node` |
| **T9** | Bateria B0.3 (21 testes) verde contra a fachada | rodar a bateria com o sujeito trocado | `node` |
| **T10** | Política B0.4 inalterada | `provider-auth-policy.test.ts` (11 testes) | `node` |
| **T11** | Fronteira: a fachada não importa `stores/auth`, `composables/api` nem `libs/analytics` | inspeção do grafo de módulos | `node` |

**Por que T4, T5 e T7 exigem o projeto `browser`:** no projeto `node` não existe
`document`, e `useStorage` precisa dele. O B0.3 já tentou um shim e falhou com
`document is not defined` — simular o ambiente testaria o simulacro, não a store.
O precedente correto é `stores/chat/session-store.browser.test.ts`, que usa
`createSyncedPiniaPlugin` com contextos líder/seguidor e namespace único. [C]

### 6.2 Critérios objetivos de aceitação

O passo seguinte só deve ser aceito se **todos** valerem:

1. T1–T11 passando, sem rede real em nenhum deles.
2. `stores/lia/` com **244 + N** testes verdes, sem nenhum teste antigo alterado
   além dos que o próprio passo exigir.
3. Bateria B0.3 passando **sem edição de asserção**.
4. `provider-auth-policy.test.ts` inalterado e verde.
5. `git status` mostrando apenas arquivos do escopo declarado; nenhum arquivo de
   `packages/stage-ui/` modificado.
6. `eslint` limpo nos arquivos tocados.
7. `vue-tsc --noEmit` com 0 erros (exige `NODE_OPTIONS=--max-old-space-size=3072`;
   com o padrão o processo morre por OOM neste ambiente).
8. Diff provando que persistência, migração, sync e replicação **não** mudaram de
   comportamento.

---

## 7. Decisões que dependem do proprietário

| # | Decisão | Por que não é técnica | Impacto |
| --- | --- | --- | --- |
| **D-1** | Fachada sobre a store compartilhada, ou store realmente separada? | a separada exige migração de dados e resolve R8 antes de valer | define o tamanho do passo |
| **D-2** | `updateConfig` passa a ser síncrona, ou mantém `Promise` por compatibilidade? | síncrona é mais correta; assíncrona é menos diff | pequeno, mas visível no contrato |
| **D-3** | A Lia deve continuar gravando no registro que a janela de configurações do AIRI exibe? | se não, a janela do Stage mostra estado divergente (R9) | alto para o Stage |
| **D-4** | Quando desligar a porta remota para a Lia? | é o passo que realiza R4; antes disso a fachada não muda comportamento | é o objetivo final |
| **D-5** | A configuração de URL personalizada deve migrar para o `lia-product.json`? | hoje ela vive só em `localStorage`; mover dá durabilidade mas toca o formato do produto | alto |
| **D-6** | A Lia terá conta própria? (herdada de D-A do B0.2, ainda aberta) | define se `LiaSessionPort` fica em `false` para sempre | bloqueia o passo 3 |

**D-5 merece atenção:** o `baseUrl` está numa camada que o produto não controla
diretamente. Se o usuário limpar o armazenamento do renderer, a URL se perde e o
provedor volta a "não configurado" — mas a seleção em `lia-product.json` continua
apontando para ele. Esse descompasso já existe hoje; não foi introduzido por este
desenho. [C]

---

## 8. Ordem recomendada, quando autorizada

1. Testes T1, T2, T6, T8 e T11 **primeiro**, contra a store atual — fixam o
   contrato antes de existir fachada.
2. Fachada com a porta remota **ligada** (comportamento idêntico ao atual).
3. Bateria B0.3 apontada para a fachada; T3 confirma que nada mudou.
4. Só então: porta remota desligada **para a Lia**, T2 confirmando zero rede, e a
   reescrita do teste de replicação do B0.3: ele existe justamente para que essa
   mudança não passe silenciosa.
5. T4, T5 e T7 no projeto `browser`.

Nenhum passo altera `config.ts`, `inference-service-providers.ts` ou o
comportamento do Stage.

---

## 9. Referências exatas

- `packages/stage-ui/src/stores/providers/config.ts` — `:15-19` opções de storage,
  `:45-48` chaves, `:52-70` migração, `:85-98` query e mutações, `:211-232`
  `updateProviderConfig`, `:261-275` bloco `synced`.
- `packages/stage-ui/src/services/inference-service-providers.ts` — `:100`
  `buildLocal`, `:114` `normalize`, `:134` `fetchRemote`, `:151` `createRemote`,
  `:171` `deleteRemote`, `:181` `patchConfigRemote`.
- `packages/stage-ui/src/stores/providers/provider.ts` — `:116` instanciação do
  auth, `:119` `providerCredentials`, `:240` `validateProviderConfig`,
  `:836` `getProviderInstance`.
- `packages/stage-ui/src/libs/providers/types.ts` — `:32` status, `:33`
  `configuredBy`, `:36-47` registro.
- `packages/stage-ui/src/libs/pinia/setup-synced.ts` — `:25` namespace.
- `apps/stage-tamagotchi/src/main/windows/main/index.ts:211` — `synced-leader`.
- `apps/stage-tamagotchi/src/renderer/window-context.ts:58` — liderança.
- `apps/stage-tamagotchi/src/renderer/App.vue:346,356` — montagem líder-only e
  inicialização do hearing.
- `apps/stage-tamagotchi/src/renderer/components/LiaProviderConfig.vue:215` —
  escrita com `baseUrl`.
- `apps/stage-tamagotchi/src/renderer/stores/lia/provider.ts:347-358,396` —
  `ensureProviderRecord` e o fluxo C.
- `apps/stage-tamagotchi/src/renderer/stores/lia/hearing.ts:199-212` — projeção.
- `apps/stage-tamagotchi/src/shared/eventa/index.ts:569-582` — tipos do produto.
- `packages/stage-ui/src/stores/chat/session-store.browser.test.ts:106-118` —
  precedente de teste de sincronização.

---

## 10. O que este documento não fez

Não alterou código, dependência, lockfile ou build; não implementou o adaptador;
não tocou em autenticação, persistência, migração ou replicação; não executou
requisição externa; não leu cofre, segredo ou `lia-product.json`; não alterou
`main`. Todas as afirmações marcadas **[C]** vêm de leitura do código nesta
árvore; as marcadas **[I]** são inferências do desenho; as **[P]** estão
explicitamente em aberto.
