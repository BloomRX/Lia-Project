# Lia × AIRI — plano do próximo corte de desacoplamento

| Campo | Valor |
|---|---|
| Data | 31/10/2026 |
| Branch analisada | `arena/01a10290-lia-project` |
| HEAD local = remoto | `c3d2186517fd44946a413de06f79e3bb3a13c4fd` |
| Árvore no início | limpa (0 entradas em `git status --porcelain`), 5974 arquivos rastreados |
| Árvore no fim | apenas este documento como não rastreado (`?? docs/architecture/LIA-NEXT-DECOUPLING-PLAN.md`); nenhum arquivo existente tocado |
| Entrega anterior | `22a39fe..c3d2186` — Transport Configuration (54 arquivos, +4187/−278) |
| Natureza desta rodada | **somente leitura**. Nenhum arquivo de produção, teste, configuração ou dependência foi alterado. Nenhum commit, nenhum push |
| Escopo deste documento | planejamento. Nada aqui foi implementado, executado ou testado em runtime |

Este documento é o sucessor de `docs/architecture/AIRI-DECOUPLING-PLAN-2026-10-28.md`, que propunha
`A2 (workspace próprio) → B1 (LiaChatPort) → B2 (Stage) → B3 (voz) → B4 (avatar) → A4 (instalador)`.
Aquele plano descreve um estado que já não existe: `@lia/lia-app` foi criado e já não importa nada do
AIRI, `lia/core` existe em duas camadas, e os transportes nativos entraram em `c3d2186`.
Nada do plano antigo é revogado aqui — apenas se registra o que ficou obsoleto e por quê (§3.1).
`LiaChatPort`, citado naquele plano como B1, **não existe no código**; nenhuma ocorrência em
`airi/` foi encontrada nesta rodada.

---

## 1. Resumo executivo

1. **A casca da Lia já está desacoplada.** `airi/apps/lia-app` não tem uma única importação
   `@proj-airi` em código de produção; as três ocorrências do texto `@proj-airi` em `src/` são
   comentários. O `package.json` declara apenas `@lia/core` e `vue`. O objetivo "lia-app constrói
   sem o workspace do AIRI" já foi atingido e não é mais um corte disponível.

2. **O produto que o usuário instala não é o lia-app.** O artefato empacotado é
   `airi/apps/stage-tamagotchi` (`package.json:226`, `appId: "ai.moeru.airi"`, builder em
   `electron-builder.config.ts`). O lia-app é um lançador que, em desenvolvimento, sobe o stage com
   `electron-vite dev` (`airi-stage-manager.ts:118,150`). **Todo acoplamento que ainda importa vive
   no stage-tamagotchi**, e é lá que o próximo corte tem de acontecer.

3. **Dentro do stage, o código da Lia são 81 arquivos de produção / 13 386 linhas**, distribuídos em
   cinco áreas (`main/services/lia`, `renderer/stores/lia`, `renderer/services/lia`,
   `shared/eventa`, `components/lia-config` + `LiaProviderConfig.vue`), sustentando **140 arestas de
   importação `@proj-airi`** contra **8 pacotes**. `@proj-airi/stage-ui` responde por 115 delas (82%).
   A UI principal de configuração de provider, `LiaProviderConfig.vue` (645 l.), tem **zero** imports
   `@proj-airi` — a camada de tela já está limpa; o acoplamento está nos stores por baixo dela.

4. **A fronteira de credencial fechou para 2 dos 10 provedores de chat oferecidos pela Lia.**
   `isNativeTransportDefinition` (`renderer/services/lia/transport-config.ts:7-9`) reconhece apenas
   `openai-compatible` e `lm-studio`. Os outros oito (`openai`, `groq`, `cerebras-ai`, `anthropic`,
   `xai`, `mistral-ai`, `openrouter-ai`, `ollama`) continuam caindo no caminho legado do AIRI, onde
   `withResolvedCredential` (`packages/stage-ui/src/stores/providers/provider.ts:97,865`) puxa a chave
   do cofre **para dentro do renderer** e a entrega a `createProvider`. Isso é consequência de código,
   não hipótese (§4.2).

5. **A fronteira também depende da janela.** `registerRuntimeExtensions()` roda apenas na janela
   líder (`renderer/App.vue:346-348`). A janela de chat é `follower-only`
   (`main/windows/chat/index.ts:51`), carrega `/chat`, e `InteractiveArea.vue:152` chama
   `chatStore.send(...)` — que resolve provider pelo caminho legado, sem resolver de credencial
   instalado. O resultado esperado é 401 em vez de conversa; não é vazamento, é quebra funcional
   (§4.4). "Os transportes novos passam" não descreve esta janela.

6. **Há exposição em repouso confirmada.** A migração copia `apiKey` de
   `localStorage['settings/providers/configured']` para o cofre, mas **nunca apaga a entrada
   antiga**: não existe `removeItem` em `renderer/stores/lia/provider.ts`. Quando a entrada existir,
   a chave em texto claro continua no Local Storage do Chromium depois da migração (§4.5).

7. **Há dependência de identidade em runtime.** Toda requisição ao OpenRouter sai com
   `HTTP-Referer: https://airi.moeru.ai/` e `X-OpenRouter-Title: Project AIRI`
   (`packages/stage-ui/src/libs/providers/providers/openrouter-ai/index.ts:9-12`). Terceiros veem
   "Project AIRI" quando o produto é a Lia (§3.6).

8. **Recomendação: Corte B — cobertura nativa total dos provedores curados.** Não é o corte menor,
   e não é o mais transformador; é o único que (a) fecha uma exposição confirmada, (b) não reabre
   `c3d2186`, (c) cabe em fases pequenas e testáveis, e (d) **cria a condição para o corte seguinte**
   de verdade — a substituição do loop de chat. Justificativa completa em §7; comparação em §6.

**O que este documento não faz:** não remove AIRI, não integra AIRI, não altera
`validateProviderConfig`, `config.ts`, `inference-service-providers.ts`, cofre, autenticação ou
persistência; não propõe merge, rebase ou atualização de dependências. As opções de §6 são propostas
para uma próxima missão, sob autorização explícita.

---

## 2. Estado do repositório

### 2.1 Git

```
HEAD local  c3d2186517fd44946a413de06f79e3bb3a13c4fd
origin/arena/01a10290-lia-project  c3d2186…  (idêntico)
origin/main 9c7ac183…  (intocado; nenhum ancestral comum novo)
cadeia     22a39fe → d6c14fe → b34a70f → c3d2186
```

- `git status --porcelain` vazio no início. No fim, exatamente uma entrada: este documento, não
  rastreado. Nenhum arquivo rastreado foi criado, modificado ou removido.
- 5974 arquivos rastreados; nenhuma divergência de hash de blob em relação ao HEAD.
- A rodada começou com o workspace aparentemente em `db99c70` com 228 entradas sujas, mas o disco
  era **byte-idêntico a `22a39fe`**. A divergência foi registrada e corrigida sem `reset`, sem
  `checkout` de árvore e sem descarte: `git update-ref` com guarda de valor antigo + `git read-tree`.
  Isso está registrado aqui porque é a única alteração de estado de git da rodada, e não tocou em
  nenhum arquivo do projeto.

### 2.2 Documentos lidos nesta rodada

| Documento | Uso |
|---|---|
| `docs/product/RELEASE-WINDOWS-2026-10-30-TRANSPORT-CONFIGURATION.md` (384 l.) | o que `c3d2186` entrega, o que declara não entregar, limites assumidos |
| `docs/project/CURRENT-STATE.md` §0 | vocabulário de estado, fase 8.0D, baseline `3ef6d11` |
| `docs/project/QUANTO-FALTA.md` | pendências de produto e o que ainda é legado |
| `docs/architecture/LIA-PROVIDER-RUNTIME-2026-10-30.md` l. 89-125 | matriz de dependências já levantada (não repetida aqui) |
| `docs/architecture/AIRI-DECOUPLING-PLAN-2026-10-28.md` | plano anterior; §3.1 registra o que ficou obsoleto |

### 2.3 O que foi **executado** e o que foi apenas **inspecionado**

**Executado:** leitura de arquivos, `grep`, `find`, `wc`, `git log`/`status`/`ls-remote`. Nada mais.

**Não executado nesta rodada:** nenhuma suíte de testes, nenhum `typecheck`, nenhum build, nenhum
Electron, nenhum teste manual. Os números de PASS citados daqui em diante vêm do relatório de
`c3d2186` e estão identificados como tal. Não há `airi/node_modules` neste checkout, portanto
Vitest, `vue-tsc` e build do stage **não são executáveis aqui**; o preflight de `tools/` também
reporta `airi/packages/lia-core/dist/index.mjs` ausente. Nenhuma conclusão deste documento depende
de execução.

---

## 3. Mapa de dependências AIRI / Lia

### 3.1 As quatro camadas reais

```
┌─ airi/apps/lia-app ─────────────── @lia/lia-app ── 0 imports @proj-airi
│   main/: lia-host.ts, airi-stage-manager.ts, node-runtime.ts, devflow-autorun.ts,
│          voice-engine-service.ts, voice-provisioning.ts, ipc.ts, shutdown-coordinator.ts
│   deps: @lia/core (workspace:*), vue
│   build: pnpm -F @lia/core build && electron-vite build
│   papel: casca de produto + lançador do stage em DEV
│
├─ airi/packages/lia-core ────────── @lia/core ── 63 .ts, 28 testes, tsdown → dist/
│   bootstrap, path, product/config, secrets/vault, voice/*, voices/*, bridge/lia-config
│   deps: @moeru/std, destr, yauzl
│   papel: núcleo de produto da Lia (o código PRÓPRIO)
│
├─ lia/core ─────────────────────── @lia/contracts ── 30 arquivos, zero deps, sem build
│   lifecycle, protocol, providers/{contracts,registry,runtime}, transports/{contracts,repository,validation}
│   main: src/index.ts  |  7 arquivos de teste / 43 testes
│   papel: contratos + runtime de transporte, independente de AIRI
│
└─ airi/apps/stage-tamagotchi ───── produto empacotado (appId ai.moeru.airi)
    áreas Lia: 81 arq. prod / 13 386 l.  |  140 imports @proj-airi
    papel: é onde o usuário realmente está; é onde o acoplamento resta
```

**Consequência de leitura:** o eixo do problema mudou de lugar. Em 28/10 o problema era "a Lia
ainda mora dentro do AIRI". Em 31/10 o problema é "**o produto empacotado ainda é o app do AIRI**,
com uma camada Lia por cima". O lia-app prova que a casca desacoplada é possível, mas não é ele que
sai no instalador.

### 3.2 Dependências físicas (o núcleo próprio é importado por caminho relativo)

Não existe alias, `paths` de tsconfig nem dependência declarada ligando `stage-tamagotchi` a
`lia/core`. Doze arquivos o alcançam por caminho relativo, em **três profundidades diferentes**:

| Profundidade | Arestas | Exemplo |
|---|---|---|
| `../../../../../../../lia/core/src/…` (7 níveis) | 17 | `renderer/stores/lia/provider.ts`, `main/services/lia/transport-execution-service.ts`, `shared/eventa/lia-transports.ts` |
| `../../../../../../lia/core/src/…` (6 níveis) | 2 | `renderer/services/lia/transport-config.ts` |
| `../../../../../lia/core/src/…` (5 níveis) | 1 | `scripts/provider-runtime-electron/renderer.ts` |

Especificadores mais usados: `transports/contracts` (7), `providers/index` (5),
`providers/contracts` (3), `transports/repository` (2), `transports/validation` (1),
`providers/runtime` (1), `providers/registry` (1).

Nenhum `package.json` do monorepo declara `@lia/contracts`. O pacote existe, tem nome, não é
consumido por nome.

### 3.3 Dependências lógicas por área (medido)

| Área | Arq. prod | Linhas | Imports `@proj-airi` | Pacotes únicos |
|---|---:|---:|---:|---:|
| `src/main/services/lia/` | 38 | 5 485 | 1 | 1 (`voice-profile-picker.ts`) |
| `src/renderer/stores/lia/` | 17 | 3 846 | 104 | 3 |
| `src/renderer/services/lia/` | 11 | 1 126 | 22 | 2 |
| `src/shared/eventa/` | 7 | 1 340 | 8 | 5 |
| `src/renderer/components/lia-config/` (6 `.vue` + `sections-contract.ts`) | 7 | 944 | 5 | 1 |
| `src/renderer/components/LiaProviderConfig.vue` | 1 | 645 | 0 | 0 |
| **Total** | **81** | **13 386** | **140** | **8** |

`main/services/lia` é praticamente puro: 1 importação de AIRI em 38 arquivos.
O acoplamento está **no renderer**: 27 dos 73 arquivos de produção `.ts` citam `@proj-airi`, e o peso
não está em um arquivo isolado (o máximo por arquivo é 5 menções) — está na **repetição entre
módulos**: os quatro módulos de §3.4 são importados por praticamente toda a camada Lia.

### 3.4 Onde exatamente o renderer ainda depende de `stage-ui`

| Especificador | Arestas |
|---|---:|
| `@proj-airi/stage-ui/stores/providers/provider` | 22 |
| `@proj-airi/stage-ui/stores/providers/config` | 20 |
| `@proj-airi/stage-ui/stores/chat/chat-provider-runtime` | 18 |
| `@proj-airi/stage-ui/stores/modules/speech` | 11 |
| `@proj-airi/stage-ui/libs/providers/types` | 7 |
| `@proj-airi/stage-ui/stores/modules/consciousness` | 4 |
| `@proj-airi/stage-ui/libs/speech/tts-fallback` | 4 |
| `@proj-airi/stage-ui/stores/settings` | 3 |
| `@proj-airi/stage-ui/stores/chat` | 3 |
| 13 outros especificadores (`types/chat`, `modules/hearing`, `modules/airi-card`, `stores/chat/retry-content`, `stores/ai/chat-llm/llm`, …) | 21 |
| **Total `stage-ui`** | **115** |

As quatro primeiras linhas somam 71 arestas — **62% de todas** — e apontam para quatro módulos com
1 109 + 276 + 307 + 462 = **2 154 linhas**. Fora do `stage-ui`, o peso é baixo:
`@proj-airi/electron-vueuse` 14, `stage-shared` 4, `pipelines-audio` 2, `electron-eventa` 2,
`stage-ui-three` 1, `server-runtime` 1, `plugin-sdk-tamagotchi` 1.

### 3.5 Dependências de build e distribuição

| Dependência | Onde | Efeito |
|---|---|---|
| `@lia/core` (tsdown → `dist/`) | `lia-app` build e dev | bloqueia qualquer execução do lia-app se `dist/` não existir |
| `@proj-airi/core-agent` | `stage-tamagotchi` script `dev` (`package.json:21`) | só o `dev` o constrói; `build` (`:23`) não — depende de `dist/` pré-existente |
| `@proj-airi/stage-ui` 1 109 l. + 948 l. + 276 l. | runtime do renderer | nenhuma cópia local equivalente |
| `lia/launcher`, `lia/stage` | **nenhum** `package.json`, script, workflow ou import | código sem consumidor (§3.7) |
| `electron-builder.config.ts` + `appId ai.moeru.airi` | distribuição | define qual app é o produto |

### 3.6 Dependência de identidade observável

`packages/stage-ui/src/libs/providers/providers/openrouter-ai/index.ts:9-12`:

```ts
export const OPENROUTER_ATTRIBUTION_HEADERS: Record<string, string> = {
  'HTTP-Referer': 'https://airi.moeru.ai/',
  'X-OpenRouter-Title': 'Project AIRI',
}
```

Toda chamada ao OpenRouter feita pela Lia sai identificando-se como **Project AIRI** e apontando para
`airi.moeru.ai`. É dependência de AIRI que não aparece em nenhum grafo de imports — aparece no fio.
Também em `ollama/index.ts:186` a mensagem de erro orienta o usuário a configurar
`OLLAMA_ORIGINS=https://airi.moeru.ai,...`; é texto de diagnóstico, não chamada de rede, mas é
instrução de produto que nomeia outro produto.

### 3.7 Código próprio sem consumidor

`lia/launcher` (`index.ts`, `resolve-stage-target.ts`) e `lia/stage` (`main/index.ts`,
`stage-host.ts`) têm **zero importadores** fora de `lia/`: nenhum `package.json`, nenhum script,
nenhum workflow, nenhuma referência em `airi/`. O lançador real é
`airi/apps/lia-app/src/main/airi-stage-manager.ts`. `lia/launcher` e `lia/stage` mantêm 2 arquivos
de teste que passam (`launcher.test.ts`, `stage-host.test.ts`) e dão a impressão de uma camada viva
que não existe.

### 3.8 Runtime de chat: quem executa de fato

```
renderer/pages/*.vue  →  components/InteractiveArea.vue:152  →  chatStore.send(...)
  └─ packages/stage-ui/src/stores/chat.ts:513  executeSendAttempt
       :516  throw 'No active chat provider or model configured'
       :535  useProviderStore().getChatProviderInstance(provider, {reasoning})
       :536  consciousnessStore.getChatProviderInstance(providerId)
             └─ stores/modules/consciousness.ts:99  → providers/provider.ts:887
                  └─ getProviderInstance  (provider.ts:865)
                       ├─ withResolvedCredential(providerId, config)   ← COFRE → RENDERER
                       └─ definition.createProvider(effectiveConfig)   ← cliente @xsai no heap
```

O único desvio desse caminho é o monkey-patch de
`renderer/stores/lia/provider-runtime.ts:96-104`:

```ts
const previous = source.getChatProviderInstance
const dispatch = async (providerId, options) => {
  const native = await factory(providerId)
  return native ?? previous(providerId, options)
}
```

`factory` é instalado em `renderer/stores/lia/provider.ts:678` e devolve `undefined` — caindo no
legado — sempre que `!isNativeTransportDefinition(id) && !transports.get(id)`.

O objeto nativo devolvido (`renderer/services/lia/native-provider-runtime.ts:47-88`) preserva a
forma `ChatProvider` do AIRI (`{ model, baseURL, fetch }`) e substitui **apenas** `fetch`, que passa
a chamar `execution.dispatch` → IPC → main. É por isso que ferramentas, imagens e raciocínio
continuam funcionando sem reescrita do loop: o payload de fio é preservado.

**Este é o achado estrutural mais importante da rodada:** a costura para desacoplar o chat já
existe e já é usada. O que falta não é arquitetura nova — é **cobertura**.

### 3.9 Loop de agente

`@proj-airi/core-agent` (34 arquivos, 5 013 linhas) é dependência `workspace:^` de `stage-ui` e
fornece `streamFrom`, `modelKey`, `isToolRelatedError`, `useLlmmarkerParser` e `categorizeResponse`.
É o loop de conversa real. Não tem substituto local; `LiaChatPort` nunca foi escrito.

---

## 4. Auditoria de segurança e credenciais

### 4.1 Como o cofre é lido hoje

`main/index.ts:416`:

```ts
registerLiaSecretsBridge({ context, vault: deps.liaSecrets, allowRendererRead: canRendererReadLegacySecret })
```

A política **é** passada — a lacuna que a rodada anterior deixou em aberto está fechada.
`main/services/lia/transport-config-service.ts:16-29` define:

```ts
export async function canRendererReadLegacySecret(scope: string): Promise<boolean> {
  if (scope === 'openai-compatible' || scope === 'lm-studio') return false
  try {
    const snapshot = await getApplicationRepository().read()
    if (snapshot.credentialProtectionIncomplete || (snapshot.tombstones.length > 0 && !snapshot.protectedCredentialScopes))
      return false
    return !snapshot.protectedCredentialScopes?.includes(scope)
      && !snapshot.records.some(record => record.credentialRef.scope === scope)
      && !snapshot.tombstones.includes(scope)
  } catch { return false }
}
```

A política é **allow-by-default com exceções**: nega dois ids fixos e nega escopos que já tenham
registro de transporte. Um escopo sem registro é legível pelo renderer.

### 4.2 A cadeia de leitura no renderer (risco confirmado por código)

`renderer/stores/lia/provider.ts:395-398`:

```ts
async function resolveApiKey(providerId: string): Promise<string | undefined> {
  return secretGet({ scope: secretScopeFor(providerId), key: API_KEY_NAME })
}
```

Consumidores vivos:

1. `provider.ts:483-492` — `draftConfig()`: para provider não-nativo,
   `const apiKey = args.apiKey ?? (native ? undefined : await resolveApiKey(providerId))`, e a chave
   entra em `config.apiKey`.
2. `provider.ts:693` — `registerProviderCredentialResolver(async (providerId) => { const key = await resolveApiKey(providerId); … return key ? { apiKey: key } : undefined })`.
   Esse resolver é consumido por `withResolvedCredential`
   (`packages/stage-ui/src/stores/providers/provider.ts:97-107`), que funde a chave no config que vai
   para `definition.createProvider(effectiveConfig)` em `provider.ts:865-873`.
3. `packages/stage-ui/src/stores/providers/provider.ts:689` — a listagem de modelos usa o mesmo
   `withResolvedCredential`, então o mesmo caminho vale para descobrir modelos.

**Resultado:** para os oito provedores curados que não são transporte nativo, o valor do cofre
atravessa IPC, existe no heap do renderer em `config.apiKey`, e é retido enquanto a instância
estiver em `providerInstanceCache` (Map privado, não-Pinia, mas em memória do renderer). Para os
dois nativos não há leitura: o `draftConfig` passa `undefined` e a execução acontece em main
(`main/services/lia/transport-execution-service.ts:252`).

Isso não é novidade de projeto — `resolveApiKey` documenta "never persisted/logged" e cumpre isso.
O que se registra é o alcance: **8 de 10**, não 0 de 10.

### 4.3 Provedores curados e o transporte usado

`LIA_CHAT_PROVIDER_OPTIONS` (`renderer/stores/lia/provider.ts:51-62`) declara 10 opções.
`isNativeTransportDefinition` reconhece 2:

| Provider id | Base URL efetiva (de `stage-ui/libs/providers/providers/<id>/index.ts`) | Transporte |
|---|---|---|
| `openai` | `https://api.openai.com/v1` | legado (cofre → renderer) |
| `groq` | `https://api.groq.com/openai/v1/` | legado |
| `cerebras-ai` | `https://api.cerebras.ai/v1/` | legado |
| `anthropic` | `https://api.anthropic.com/v1/` | legado |
| `xai` | `https://api.x.ai/v1/` | legado |
| `mistral-ai` | `https://api.mistral.ai/v1/` | legado |
| `openrouter-ai` | `https://openrouter.ai/api/v1/` | legado |
| `ollama` | `http://localhost:11434/v1/` | legado |
| `openai-compatible` | definida pelo usuário | **nativo** |
| `lm-studio` | `http://localhost:1234/v1/` | **nativo** |

**Todos os dez falam o protocolo `chat/completions` do núcleo** — inclusive `anthropic`: a
implementação do AIRI não usa a API Messages, usa `createChatProvider` de
`@xsai-ext/providers/utils` apontado para `https://api.anthropic.com/v1/`
(`anthropic/index.ts:20-40`), isto é, o endpoint de compatibilidade OpenAI da Anthropic, com
`Authorization: Bearer`. Nenhum precisa de `x-api-key` nem de `anthropic-version` no caminho que a
Lia usa hoje — isto é o que o código do AIRI faz, não o que foi testado contra o serviço (§10). A única peculiaridade é um header de conveniência de browser
(`anthropic-dangerous-direct-browser-access`) que só existe porque a chamada parte do renderer.

Isso muda o custo do Corte B de forma material: **não é preciso mexer no contrato de
`lia/core`**. O `ProviderRegistry` exige `protocol === 'chat-completions'`
(`lia/core/src/providers/registry.ts:10-11`) e todos satisfazem.

### 4.4 A fronteira depende da janela (risco confirmado por código)

`renderer/App.vue:345-362` instala as extensões **apenas** quando
`windowContext.leadership === 'leader-only'`. `leadership` vem de `?synced-leader=`
(`renderer/window-context.ts:38-60`). A janela de chat abre com
`'synced-leader': 'false'` (`main/windows/chat/index.ts:51`) e carrega a rota `/chat`
(`chat.vue` → `chat-page-shell.vue` → `InteractiveArea.vue:152` → `chatStore.send`).

Nessa janela:
- `installChatFactory` não está instalado → nenhum provider é nativo, inclusive
  `openai-compatible` e `lm-studio`;
- `registerProviderCredentialResolver` não está instalado → `withResolvedCredential` devolve o config
  intacto (`provider.ts:99-100`);
- o resultado esperado é requisição sem `Authorization` → 401.

**Não é vazamento nesta janela; é quebra.** Fica classificado como risco de consistência de fronteira:
a mesma ação produz comportamentos diferentes conforme a janela, e a regra que garante isso
(`leadership`) é uma condição de UI, não uma barreira no processo principal.

### 4.5 Exposição em repouso (risco confirmado por código)

`packages/stage-ui/src/stores/providers/config.ts:46-48`:

```ts
const providers       = useLocalStorage<…>('settings/providers/configured', {})
const addedProviders  = useLocalStorage<…>('settings/providers/added', {})
const legacyConfigs   = useLocalStorage<…>('settings/credentials/providers', {})
```

`renderer/stores/lia/provider.ts:280-334` lê os dois e migra `apiKey` para o cofre com
`secretSet(..., { onlyIfMissing: true })`. **Não existe nenhum `removeItem` em `provider.ts`** —
verificado por grep. A chave antiga, quando existia, continua em `localStorage`, que é LevelDB do
Chromium, sem `safeStorage`. O mesmo vale para `settings/credentials/providers`: é lido por
`legacyTransportCandidates(...)` e nunca apagado.

### 4.6 Classificação honesta dos riscos

**Confirmado por leitura de código (não executado):**

| # | Risco | Onde |
|---|---|---|
| R1 | Chave do cofre entra no renderer para 8 dos 10 provedores curados | §4.2 |
| R2 | Instância criada com a chave fica em `providerInstanceCache` enquanto a sessão durar | `stage-ui/.../provider.ts:873-874` |
| R3 | Chave antiga permanece em `localStorage` em texto claro | §4.5 |
| R4 | Janela de chat opera em caminho legado, sem cofre | §4.4 |
| R5 | Requisições ao OpenRouter se identificam como "Project AIRI" | §3.6 |
| R6 | Log `console.info` do resolver revela providerId, escopo e presença de chave | `provider.ts:699-704` — metadado, sem valor; não é vazamento, é superfície |

**Possibilidade teórica (não confirmada):**

- Um renderer secundário com `allowRendererRead` válido poderia ler escopos legados sem passar pela
  política de liderança, já que a política é por *escopo*, não por *janela*. Não foi verificado se
  alguma janela não-líder chama `secretGet` fora do fluxo de chat.
- `draftConfig` aceita `args.apiKey` vindo do chamador (`provider.ts:485`); se algum chamador futuro
  receber a chave por outro canal, ela entra no mesmo config. Nenhum chamador atual faz isso.
- `adapterOptions` é `Record<string, JSONValue>` livre (`lia/core/src/transports/contracts.ts:11`) e
  hoje não é repassado à config de runtime em main. Se um corte futuro passar a repassá-lo, qualquer
  campo String vira superfície. Não é um problema hoje.

**Não investigado:**

- Conteúdo efetivo do `lia-secrets.json` (o script `scripts/diagnose-lia-provider.ts:234` só testa
  existência) e qualidade da criptografia por `safeStorage` por plataforma.
- Se o Windows real mantém ou não o `localStorage` após atualização do instalador.
- Áudio, visão, Brain e avatar: não foram auditados quanto a credencial nesta rodada.
- `provider-validation` e `model-discovery` (`AbortSignal.timeout(15000)`) não foram rastreados até
  o consumidor final de credencial.

### 4.7 Caminhos que já estão na fronteira correta

Para não superdeclarar risco, o que **não** está exposto:

- `main/services/lia/transport-execution-service.ts` resolve a credencial em main
  (`:252`) e nunca devolve o valor; o renderer só recebe bytes de resposta
  (`:344-352`, `MAX_CHUNK` 64 KiB), JSON de descoberta (`:262`) ou códigos de erro.
- `electronLiaTransportsGet`/`Mutate` (`transport-config-service.ts:40-56`) trocam apenas registros
  validados, sem segredo; o schema de `lia-schema.ts` não tem campo `apiKey`.
- `shared/eventa/lia-transport-execution.ts:10` admite `draft.apiKey` **apenas** no caminho de teste
  de conexão com URL digitada, e `transport-execution-service.ts:245` só permite uso do cofre quando
  a URL do draft é idêntica à salva.
- A validação de URL em `lia/core/src/transports/validation.ts:16-21` rejeita credenciais embutidas,
  query e hash.

---

## 5. Tabela classificada de dependências

Legenda: **Código** = import/alias em produção · **Build** = script, bundler, `dist` ·
**Runtime** = comportamento observável em execução · **Doc** = referência textual ·
**Comparação** = AIRI mantido só como referência · **Morto** = sem consumidor.

| Dependência | Tipo | Evidência | Estado |
|---|---|---|---|
| `@proj-airi/stage-ui/stores/providers/provider` (1 109 l.) | Código + Runtime | 22 arestas; `withResolvedCredential:97`; `getProviderInstance:865`; `getChatProviderInstance:887` | **Acopla.** Pivô de credencial. Alvo do Corte B. |
| `@proj-airi/stage-ui/stores/providers/config` (276 l.) | Código + Runtime | 20 arestas; `config.ts:46-48` localStorage | **Acopla.** Também é a fonte legada de R3. |
| `@proj-airi/stage-ui/stores/chat/chat-provider-runtime` (307 l.) | Código + Runtime | 18 arestas; registry de resolvers `:165-218` | **Acopla.** É a costura do monkey-patch. |
| `@proj-airi/stage-ui/stores/chat` (948 l.) | Código + Runtime | `chat.ts:513-536`; 3 arestas diretas | **Acopla.** Dono do loop de envio. |
| `@proj-airi/stage-ui/stores/modules/speech` (462 l.) | Código + Runtime | 11 arestas (voz, hearing) | **Acopla.** Fora do escopo deste corte. |
| `@proj-airi/stage-ui/stores/modules/consciousness` (141 l.) | Código | 4 arestas; `:99-103` delega ao provider store | **Fino.** Desaparece quando o provider store for substituído. |
| `@proj-airi/core-agent` (5 013 l.) | Código + Build | dep `workspace:^`; `dev` script `package.json:21` | **Acopla.** Nenhum substituto local. |
| `@proj-airi/electron-vueuse` | Código | 14 arestas | **Acopla (fino).** `useElectronEventaInvoke` em todo `stores/lia`. |
| `@proj-airi/stage-shared` | Código | 4 arestas (`stage-shared/composables`, `godot-stage`) | **Acopla (fino).** |
| `@proj-airi/pipelines-audio` | Código | 2 arestas | **Acopla (fino).** |
| `@proj-airi/electron-eventa` | Código | 2 arestas em `shared/eventa` | **Acopla (fino).** |
| `@proj-airi/stage-ui-three`, `server-runtime`, `plugin-sdk-tamagotchi` | Código | 1 aresta cada | **Marginal.** |
| `lia/core` (`@lia/contracts`) | Código (relativo) | 12 arquivos, 20 arestas, 3 profundidades | **Acopla por caminho.** Corte A. |
| `lia/launcher`, `lia/stage` | Morto | zero importadores, zero scripts | **Removível** (não nesta missão). |
| `airi/apps/lia-app` | Build + Runtime (dev) | `package.json` idem; spawna o stage | **Já desacoplado em código**; não é o app distribuído. |
| `electron-builder` / `appId ai.moeru.airi` | Build + Distribuição | `stage-tamagotchi/package.json:226` | **Define o produto.** Decisão de produto, não de código. |
| `docs/architecture/AIRI-*.md`, `LIA-INTEGRATION-PLAN.md`, `LIA-STAGE-DEPENDENCY-MAP-…` | Doc | — | **Referência/comparação.** Preservar. |
| `airi/` inteiro (monorepo) | Comparação | — | **Não remover nesta etapa.** |

---

## 6. Comparação de cortes

Quatro cortes foram considerados. Cada um é avaliado pelo que resolve, não pelo tamanho.

### Corte A — Publicar `@lia/contracts` e matar o caminho relativo

- **Problema que resolve:** 12 arquivos alcançam o núcleo próprio por três profundidades relativas
  diferentes, sem dependência declarada. Qualquer reorganização de pasta quebra o stage em tempo de
  build, e o erro aparece longe da causa.
- **Arquivos envolvidos:** `lia/core/package.json` (já tem `name`, `main`, zero deps);
  `airi/apps/stage-tamagotchi/package.json` (declarar `"@lia/contracts": "workspace:*"`); os 12
  arquivos de §3.2 (trocar o especificador); `pnpm-workspace.yaml`/lockfile.
- **Deps removidas:** nenhuma de AIRI. Zero redução de acoplamento com AIRI.
- **Deps que ficam:** todas.
- **Risco de regressão:** baixo em lógica, médio em build. Exige que o pacote seja resolvível pelo
  bundler do Electron nos três contextos (main, renderer, `shared`), e `lia/core` não tem etapa de
  build — `main: src/index.ts` é TypeScript cru. `electron-vite` precisa transpilá-lo, o que hoje
  acontece por estar dentro do grafo de arquivos do próprio app.
- **Complexidade:** baixa/média. Mecânica, mas com um risco de configuração real.
- **Testes:** os 43 testes de `lia/core` continuam; mais um teste de "nenhum arquivo do stage importa
  `lia/core` por caminho relativo" (grep em teste), e um `tsc --noEmit` que prove a resolução.
- **Critério objetivo de conclusão:** `grep -rn "lia/core/src/"` em `airi/apps` retorna zero;
  `pnpm -F @lia/contracts test` verde; build do `lia-app` verde.
- **Benefício:** manutenção e legibilidade. **Nenhum** benefício de segurança ou de independência.
- **Veredito:** não é o próximo corte. É higiene que pode ser feita em qualquer momento, inclusive
  como prelúdio de 1 dia do Corte B. Não resolve nada do que dói.

### Corte B — Cobertura nativa total dos provedores curados *(recomendado)*

- **Problema que resolve:** R1 do §4.6, e de forma incidental R5. Depois dele, os 10 provedores
  curados têm registro de transporte, a chave é resolvida só em main, e `canRendererReadLegacySecret`
  nega por consequência (não por lista fixa de 2 ids). O caminho nativo não emite
  `HTTP-Referer`/`X-OpenRouter-Title`, então a identificação "Project AIRI" no fio desaparece.
  **R3 não é fechado por B** — a limpeza do legado em repouso é a Fase B5, independente.
- **Arquivos envolvidos:**
  - `renderer/services/lia/transport-config.ts:7-9` — `isNativeTransportDefinition` deixa de ser
    allowlist de 2 ids e passa a consultar uma tabela de produto.
  - tabela nova (proposta: `renderer/services/lia/provider-catalog.ts`) com
    `providerId → { baseUrl, needsApiKey }` para os 10 ids de `LIA_CHAT_PROVIDER_OPTIONS`
    (`stores/lia/provider.ts:51-62`), usando as URLs de §4.3.
  - `renderer/stores/lia/provider.ts:420-449` (`ensureProviderRecord`) — criar registro de transporte
    também para provedor curado não-nativo, usando a base URL padrão quando o usuário não informou uma.
  - `main/services/lia/transport-config-service.ts:16-29` — `canRendererReadLegacySecret` passa a
    negar por padrão, com lista explícita de exceções para consumidores não migrados (§8, Fase B3).
  - `main/services/lia/transport-execution-service.ts:226` — `knownDraftIds` hoje é
    `{openai-compatible, lm-studio}`; precisa acompanhar a tabela.
  - `renderer/components/LiaProviderConfig.vue` e `lia-config/sections/AiSection.vue` — refletir que
    "Testar" e "Descobrir modelos" passam pelo main para os 10.
- **Deps removidas:** **nenhuma importação** sai do renderer. O que sai é a *leitura do cofre no
  renderer* para os 10 provedores.
- **Deps que ficam:** `stage-ui/stores/providers/provider` (para configuração e instâncias legadas de
  voz/hearing), `stores/chat`, `core-agent` — intactos.
- **Risco de regressão:** médio e localizado, em quatro pontos conhecidos:
  1. **`groq` e a transcrição.** `CREDENTIAL_SCOPE_ALIASES['lia-groq-transcription'] = 'groq'`
     (`provider.ts:173-175`). Se `groq` ganhar registro e a política negar o escopo `groq`,
     `resolveApiKey('lia-groq-transcription')` para de funcionar e o STT quebra com 401. Precisa de
     exceção explícita e testada até o STT migrar.
  2. **`ollama` sem chave.** `TransportRecord.credentialRef` é obrigatório
     (`lia/core/src/transports/contracts.ts:15`). Um registro é criado com `credentialRef` apontando
     para um escopo sem segredo; o runtime tolera ausência (`runtime.ts:227` só define o header se
     houver credencial), mas `credentialRequired` não é propagado hoje — a falha vira 401 genérico.
  3. **OpenRouter perde a atribuição.** Decisão de produto, não bug: remover `HTTP-Referer`/`X-Title`
     muda como o OpenRouter classifica o app. Precisa ser decidido, não descoberto.
  4. **Descoberta de modelos no `anthropic`.** O endpoint de compatibilidade pode não servir
     `/models`; `ProviderCapabilities.modelDiscovery` existe e pode ser `false`, mas a UI precisa
     aceitar modelo digitado (já aceita — `LIA_MODEL_CATALOG` é sugestão, não allowlist).
- **Complexidade:** média. Nenhuma mudança de contrato em `lia/core`; mudanças em um arquivo de
  política, um de tabela, um de store e um de execução.
- **Testes:** a suíte de 449 testes / 38 arquivos de `stores/main/cache/cofre` (PASS em `c3d2186`) continuam
  sendo o piso; mais: teste de que `save()` de cada um dos 10 ids cria registro; teste de que
  `canRendererReadLegacySecret(scope)` é `false` para os 9 sem exceção e `true` só para `groq`;
  teste de que `draftConfig` não chama `resolveApiKey` para id curado; teste de que a exceção `groq`
  existe e é a única.
- **Critério objetivo de conclusão:** para cada um dos 10 ids de `LIA_CHAT_PROVIDER_OPTIONS`,
  `transports.get(id)` devolve registro após o save, e um teste com `secretGet` espião prova zero
  chamadas no caminho de chat.
- **Benefício:** remove a maior exposição de credencial confirmada; padroniza os 10 provedores num
  único caminho de execução (main); elimina a identidade "Project AIRI" no fio do OpenRouter; e
  transforma `getChatProviderInstance` em operação puramente nativa, que é a pré-condição para o
  Corte C.

### Corte C — Runtime de chat próprio (substituir `stores/chat.ts`)

- **Problema que resolve:** o acoplamento de verdade. Elimina o monkey-patch, remove a dependência
  de `stores/providers/provider` no caminho de conversa e abre espaço para dispensar `core-agent`.
- **Arquivos envolvidos:** `packages/stage-ui/src/stores/chat.ts` (948 l.), `stores/providers/provider.ts`
  (1 109 l.), `stores/chat/chat-provider-runtime.ts` (307 l.), `stores/providers/config.ts` (276 l.),
  retry/fallback (`retry-*.ts`, `lia-authoritative-retry`), e um runtime novo em
  `renderer/stores/lia/` ou `lia/`.
- **Deps removidas:** até 60 das 140 arestas `@proj-airi` (provider 22 + config 20 + chat-provider-runtime 18).
- **Deps que ficam:** `core-agent` (5 013 l.), `stage-ui/modules/speech`, `electron-vueuse`.
- **Risco de regressão:** **alto**. O `chat.ts` carrega correções caras: fallback em cadeia
  (`CHAT_FALLBACK_MAX_ATTEMPTS = 4`), `tailBoundary` para marcar falha terminal, reescrita e
  restauração de `consciousnessStore.activeProvider` (`chat.ts:709,729`), retry por conteúdo,
  telemetria por rodada. Reimplementar sem perder essas garantias exige uma suíte de paridade que
  não existe.
- **Complexidade:** alta. É o maior arquivo do caminho quente e o mais entrelaçado com Pinia e com o
  servidor de inferência.
- **Testes:** não há suíte de paridade. Seria preciso criá-la antes de cortar.
- **Critério objetivo de conclusão:** os mesmos cenários de fallback, retry, tool-call e cancelamento
  passam sem `stores/chat.ts`; zero chamadas a `getChatProviderInstance` legado.
- **Benefício:** máximo arquitetural. **Veredito:** é o destino, não o próximo passo. Sem o Corte B,
  ele começa com credencial no renderer e precisa resolver isso de qualquer forma.

### Corte D — Promover `lia-app` a host de produção

- **Problema que resolve:** o produto distribuído deixa de ser `ai.moeru.airi` e passa a ser a casca
  da Lia, que já não importa AIRI.
- **Arquivos envolvidos:** `apps/lia-app` inteiro (que hoje tem main, sem UI de produto),
  `electron-builder.config.ts`, workflows de release, `Lia.bat`, docs de release.
- **Deps removidas:** nenhuma no primeiro momento; remove a *dependência de distribuição* do AIRI.
- **Deps que ficam:** tudo do stage, porque o host teria de hospedar equivalentes.
- **Risco de regressão:** **muito alto**. Não existe UI no lia-app: janelas, chat, voz, avatar,
  configurações e onboarding vivem no stage. Promover o host significa mover ou reimplementar
  ~13 386 linhas de área Lia mais toda a UI do AIRI que a Lia usa.
- **Complexidade:** muito alta, plurimissão.
- **Critério objetivo de conclusão:** instalador gerado a partir do `lia-app`, com paridade funcional
  verificada — não há como definir isso hoje sem antes definir a paridade.
- **Benefício:** o maior de todos, e o mais distante. **Veredito:** decisão de produto, não próximo corte.

### Quadro comparativo

| | A — `@lia/contracts` | B — cobertura nativa | C — chat próprio | D — host próprio |
|---|---|---|---|---|
| Riscos que fecha | nenhum | R1, R5 | R1–R5 | R1–R6 |
| Arestas `@proj-airi` removidas | 0 | 0 | até 60 | estruturais |
| Arquivos tocados | 12 + 2 manifests | ~6 | ~15 | dezenas |
| Risco de regressão | baixo (build) | médio | alto | muito alto |
| Exige `lia/core` mudar | não | **não** | provavelmente | sim |
| Testes existentes cobrem | parcialmente | **sim (449)** | não | não |
| Prazo plausível | 1 dia | 1–2 fases | plurimissão | plurimissão |
| Desbloqueia o próximo | nada | **C** | nada | — |

---

## 7. Recomendação

**Corte B, com o Corte A como prelúdio opcional de baixo risco.**

Três razões, em ordem de peso:

1. **É o único corte cujo critério de conclusão é verificável com a infraestrutura que já existe.**
   449 testes verdes nas suítes de stores/main/cache/cofre são o piso. Concluir B exige acrescentar testes,
   não construir um aparato de paridade do zero, como C exigiria.

2. **É o corte que muda a natureza do risco, não apenas a sua quantidade.** Hoje a regra é
   "allow-by-default com duas exceções". Depois de B, a regra é "todo provider curado é executado em
   main; o renderer só lê escopo que não é de chat". Isso permite, no corte seguinte, **apagar**
   `registerProviderCredentialResolver` do caminho de chat em vez de reimplementá-lo.

3. **Prepara C sem tocar em C.** Depois de B, `getChatProviderInstance` devolve sempre o mesmo tipo de
   objeto (o shim de `fetch`), para todos os 10. Substituir o loop passa a ser um problema de loop,
   não de credencial e de roteamento ao mesmo tempo. Fazer C primeiro obrigaria a resolver as duas
   coisas juntas — a razão mais provável de o corte falhar.

**O que a recomendação recusa explicitamente:** escolher A por ser pequena. A é a opção que produz
relatório verde sem mover nenhum risco. Ela pode ser feita, e provavelmente deve, mas não é "o
próximo corte".

**O que a recomendação não afirma:** que B deixa o app seguro. R3 (chave em `localStorage`),
R4 (janela de chat) e R6 (log) continuam abertos depois de B, e voz/visão/Brain/avatar não foram
auditados. B fecha a exposição do caminho de chat dos provedores curados e nada além disso.

---

## 8. Plano em fases pequenas

Cada fase termina com árvore verde, commit próprio e um critério que pode falhar.
Nenhuma fase altera `validateProviderConfig`, `config.ts`, `inference-service-providers.ts`,
cofre, autenticação ou persistência além do que está listado.

### Fase B0 — Congelar o estado e medir o piso

- Rodar, no ambiente Windows do projeto, as suítes de `c3d2186` e registrar os números exatos
  (núcleo 77, core-agent 156, stores/main/cache/cofre 449, Chromium 16, gate Electron).
- Adicionar teste de inventário: para cada id de `LIA_CHAT_PROVIDER_OPTIONS`, registrar qual caminho
  resolve hoje (legado ou nativo). O teste passa descrevendo o estado atual, inclusive os 8 legados.
- **Critério:** a suíte nova passa e falha se um provider mudar de caminho sem que alguém atualize a
  expectativa.

### Fase B1 — Tabela de produto dos 10 provedores

- Criar `renderer/services/lia/provider-catalog.ts` com `providerId → { baseUrl, needsApiKey,
  modelDiscovery }` a partir das URLs de §4.3, importando os valores dos módulos de provider do
  `stage-ui` em vez de repetir strings (evita duas fontes de verdade sobre a mesma URL).
- `isNativeTransportDefinition(id)` passa a `provider-catalog.has(id)`.
- Teste: os 10 ids de `LIA_CHAT_PROVIDER_OPTIONS` estão na tabela; nenhum id fora da lista.
- **Critério:** tabela e opções curadas são bijetivas; teste falha se divergirem.

### Fase B2 — Registro de transporte para provedor curado

- `ensureProviderRecord` (`provider.ts:420-449`): quando o id está na tabela, criar registro com
  `baseUrl` do usuário ou o padrão, `credentialRef: { scope: secretScopeFor(id), key: 'apiKey' }`,
  `modelIds` dos alvos configurados.
- `knownDraftIds` (`transport-execution-service.ts:35`, usado em `:226`) passa a derivar da mesma tabela.
- **Ainda não mexer na política de leitura.** Nesta fase os 10 têm registro, mas
  `canRendererReadLegacySecret` continua respondendo como hoje — o registro já a faz negar, mas por
  coincidência do critério `records.some(...)`, e é isso que o teste deve capturar.
- Teste: `save()` de cada id cria exatamente um registro; `transports.get(id)` não é `undefined`;
  a base URL gravada é a esperada.
- **Critério:** os 10 têm registro após o fluxo de configuração; os 449 testes continuam verdes.

### Fase B3 — Política explícita, com exceção nomeada

- `canRendererReadLegacySecret` deixa de ter os dois ids fixos e passa a negar **todo** escopo que
  tenha registro, com uma constante exportada e documentada:
  ```ts
  /** Escopos ainda lidos pelo renderer por consumidores não migrados. Cada entrada é dívida. */
  const RENDERER_READ_EXCEPTIONS = new Set(['groq']) // lia-groq-transcription (STT)
  ```
- Teste: `false` para os 9 sem exceção; `true` para `groq`; a constante tem exatamente 1 entrada.
- **Critério:** o teste falha se alguém acrescentar exceção sem tocar no teste; o STT continua
  funcionando (o teste de `hearing` cobre).

### Fase B4 — Decisão de atribuição do OpenRouter

- Decidir explicitamente entre: remover os dois headers; apontar `HTTP-Referer` para um domínio
  próprio da Lia e trocar o título; ou manter como está, com justificativa registrada.
  **Não** deixar "Project AIRI" por inércia.
- Se removido, registrar em `docs/product/` que o app deixa de se identificar como AIRI no OpenRouter.
- **Critério:** existe uma decisão escrita; o header final é o decidido, verificado por teste de
  requisição.

### Fase B5 — Limpeza do legado em repouso (independente, mas da mesma família)

- Após migração bem-sucedida, remover `apiKey` de `settings/providers/configured` e
  `settings/credentials/providers` **somente** quando `secretHas` confirmar que o cofre tem o valor.
- Falha do cofre ⇒ não apagar (fail-closed, como já faz `retryCredentialMigration`).
- **Critério:** teste com `secretSet` falhando prova que a chave antiga **não** é apagada; teste com
  sucesso prova que é.

### Fora de escopo deste plano

Janela de chat (R4) — exige decidir se a janela delegará a main ou se recusará a enviar; e voz,
visão, Brain e avatar, que não foram auditados.

---

## 9. Testes e critérios de aceitação

### Piso existente (de `c3d2186`, não reexecutado nesta rodada)

| Suíte | Arquivos | Testes | Estado reportado |
|---|---:|---:|---|
| `lia/core` (`node --experimental-strip-types --test`) | 7 | 43 | verde |
| núcleo agregado | — | 77 | PASS |
| `core-agent` | — | 156 | PASS |
| `stores/main/cache/cofre` (Vitest node) | 38 | 449 | PASS |
| Chromium | 2 | 16 | PASS |
| gate Electron | 11 grupos | — | 39,964 s, `logSecretsAbsent=true` |

### Novos testes exigidos pelo Corte B

1. **Bijetividade do catálogo** — `LIA_CHAT_PROVIDER_OPTIONS` ↔ `provider-catalog` são o mesmo
   conjunto. Falha se alguém adicionar provedor em um lugar só.
2. **Zero leitura de cofre no caminho de chat** — `secretGet` espião, exercitando `save` + `send`
   para cada um dos 10 ids; expectativa `0` chamadas.
3. **Política de escopo** — `canRendererReadLegacySecret` falso para 9, verdadeiro só para `groq`.
4. **Registro por provider** — cada id produz um `TransportRecord` válido segundo
   `isTransportRecord` (`lia/core/src/transports/validation.ts`).
5. **Exceção única e nomeada** — o conjunto de exceções tem tamanho 1 e comentário de dívida.
6. **Descoberta** — `discover` para os 10 executa em main; para `anthropic`, se `/models` não
   existir, o teste espera `modelDiscovery: false` e modelo manual aceito.
7. **Regressão do STT** — `hearing` continua resolvendo `lia-groq-transcription` sem 401.

### Critério de aceitação do corte (todos obrigatórios)

- `git diff --check` limpo.
- 43 + 449 + 16 continuam verdes, mais os novos.
- `grep` de `resolveApiKey` no caminho de chat retorna zero chamadas para id curado.
- Nenhuma credencial em log: `logSecretsAbsent=true` no gate.
- `canRendererReadLegacySecret` não tem mais ids hardcoded, exceto a exceção nomeada.
- Nenhum arquivo de `airi/packages/**` alterado.
- Nenhuma alteração em `validateProviderConfig`, `config.ts`, `inference-service-providers.ts`,
  `vault.ts`, `secrets-service.ts`, `lia-schema.ts`.

---

## 10. Riscos, limitações e questões abertas

### Riscos do próprio plano

| Risco | Mitigação |
|---|---|
| `groq` deixa de ser legível e o STT quebra | exceção nomeada em B3 antes de remover a lista fixa |
| `ollama` sem credencial gera 401 opaco | `credentialRequired` explícito por definição no registro; teste de mensagem de erro |
| Base URL errada por provider | valores lidos dos módulos existentes, não redigitados; teste por id |
| Perda da atribuição OpenRouter | decisão explícita em B4, com registro em `docs/product/` |
| Regressão silenciosa no roteamento legado | rodar a suíte de 449 antes e depois; ela cobre provider/cofre, **não** o fallback de chat de `stage-ui` |
| Duas fontes de verdade para URL | tabela importa do módulo de provider |

### Limitações deste documento

- **Nada foi executado.** Nenhuma suíte, nenhum build, nenhum Electron. Todos os PASS citados são de
  `c3d2186`, não desta rodada.
- `airi/node_modules` ausente ⇒ Vitest, `vue-tsc` e build do stage não são executáveis neste ambiente.
  `airi/packages/lia-core/dist/index.mjs` está ausente.
- Não houve inspeção de `lia-secrets.json` real, de `safeStorage` por plataforma, nem de
  comportamento em Windows.
- Voz, visão, Brain e avatar não foram auditados.
- A afirmação de que o endpoint de compatibilidade da Anthropic atende `/v1/chat/completions` com
  `Bearer` foi derivada de a implementação do AIRI **já fazer isso** — não de teste contra o serviço.
  Tratar como hipótese forte, a confirmar em B1.
- Números de linhas e imports são medições de texto; não substituem análise semântica de fluxo.

### Questões abertas, para decisão

1. **A janela de chat (R4) deve delegar a execução a main ou recusar-se a enviar?** Delegar exige
   instalar as extensões em janela não-líder, o que conflita com o desenho atual de liderança.
   Recusar é honesto e menor.
2. **A atribuição do OpenRouter deve apontar para a Lia, para `airi.moeru.ai`, ou sumir?**
3. **`groq` deve continuar legível enquanto o STT não migrar, ou o STT deve migrar junto?** A segunda
   opção é mais correta e maior.
4. **`lia/launcher` e `lia/stage` devem ser removidos?** Têm testes verdes e zero consumidores.
   Remover é uma decisão de repositório, não deste plano.
5. **O produto deve continuar sendo o `stage-tamagotchi` empacotado?** Enquanto sim, "desacoplar"
   significa mover código de dentro do stage para pacotes próprios, e não promover o lia-app.
   Essa é a decisão que determina se o Corte D é destino ou desvio.
6. **`core-agent` (5 013 l.) fica ou é substituído?** Nenhuma resposta foi produzida nesta rodada.

---

## Apêndice — caminhos citados

```
lia/core/src/providers/contracts.ts:12,19-25      protocol literal; ProviderConfig
lia/core/src/providers/registry.ts:10-11          protocol deve ser chat-completions
lia/core/src/providers/runtime.ts:215-232         #request, Authorization: Bearer
lia/core/src/providers/runtime.ts:360,438         chat/completions, models
lia/core/src/transports/contracts.ts:4-16         TransportRecord, credentialRef obrigatório
lia/core/src/transports/validation.ts:16-21       endpoint() http/https sem user/query/hash

airi/packages/lia-core/                            @lia/core — 63 .ts, 28 testes
airi/apps/lia-app/package.json                     deps: @lia/core, vue
airi/apps/lia-app/src/main/airi-stage-manager.ts:118,150
airi/apps/stage-tamagotchi/package.json:21,23,226  dev/build, appId ai.moeru.airi

airi/apps/stage-tamagotchi/src/renderer/stores/lia/provider.ts:51-62,173-175,280-334,395-398,420-449,483-492,675-706
airi/apps/stage-tamagotchi/src/renderer/stores/lia/provider.ts:693   registerProviderCredentialResolver
airi/apps/stage-tamagotchi/src/renderer/stores/lia/provider-runtime.ts:96-104
airi/apps/stage-tamagotchi/src/renderer/services/lia/transport-config.ts:7-9
airi/apps/stage-tamagotchi/src/renderer/services/lia/native-provider-runtime.ts:47-88
airi/apps/stage-tamagotchi/src/renderer/App.vue:345-362
airi/apps/stage-tamagotchi/src/main/windows/chat/index.ts:51
airi/apps/stage-tamagotchi/src/main/index.ts:416
airi/apps/stage-tamagotchi/src/main/services/lia/transport-config-service.ts:16-29,40-56
airi/apps/stage-tamagotchi/src/main/services/lia/transport-execution-service.ts:220-262,226,240,252
airi/apps/stage-tamagotchi/src/renderer/components/InteractiveArea.vue:152

airi/packages/stage-ui/src/stores/chat.ts:513-536,709,729
airi/packages/stage-ui/src/stores/providers/provider.ts:97-107,689,865-874,887
airi/packages/stage-ui/src/stores/providers/config.ts:46-48
airi/packages/stage-ui/src/stores/chat/chat-provider-runtime.ts:165-218
airi/packages/stage-ui/src/stores/modules/consciousness.ts:99-103
airi/packages/stage-ui/src/libs/providers/providers/openrouter-ai/index.ts:9-12
airi/packages/stage-ui/src/libs/providers/providers/anthropic/index.ts:20-40
```

**Fim do documento.** Nada foi implementado, alterado, commitado ou enviado nesta rodada.
