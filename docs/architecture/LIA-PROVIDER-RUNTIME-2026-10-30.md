# Runtime próprio de providers — execução de 30/10/2026

Registro da primeira fatia, preservado como evidência histórica. A evolução com
segundo ID migrado, correção de cancelamento e gate Electron de componentes está
em [Runtime E2E — matriz atual](../product/RELEASE-WINDOWS-2026-10-30-RUNTIME-E2E.md).

## Resultado e limite da entrega

**Primeira fatia vertical funcional**, não independência total. O alvo genérico
persistido `openai-compatible`, com endereço explícito, executa HTTP de conversa,
descoberta e sondas de texto pelo registry/cache/transporte próprios em
`lia/core/src/providers/`. Não chama `getProviderInstance()` ou a fábrica de
definições AIRI para essas operações.

O caminho existente de chat continua montando mensagens, histórico e loop de
ferramentas em Core/xsAI. Uma ponte local fornece o fetch próprio à factory
estrutural esperada pelo host. Não houve mudança no Stage UI compartilhado,
nem substituição de funcionalidade de produção por mocks.

Os demais IDs, protocolos, voz e avatar continuam legados. Esta fatia não encerra
A2/B1 do plano de desacoplamento, não remove AIRI e não cria workspace novo.

## Preflight e preservação

- Raiz `J:\Lia-Project`; branch `arena/01a10290-lia-project`.
- HEAD inicial local e remoto: `8d5199cc0a801921f237eb73ef77f06332a5c5f3`.
  Remoto consultado; não havia commit novo a integrar.
- `main`: `db99c709059a6d074b18361bfb32c9f144620632`, sem alteração.
- Seis Core preexistentes continuam modificados, preservados por SHA-256 e
  excluídos do commit. Gates do host foram executados nesse working tree;
  não representam uma validação de checkout limpo desses seis arquivos.
- Sem alteração de secrets, Persona, TTS, política de fallback, descoberta de
  modelos de outros providers, `Lia.bat`, `DevKit.bat`, dependências ou lockfile.
- Baseline funcional permanece `3ef6d11618f787dae6d197645d440a5775a60ad6`.

## Auditoria direcionada do caminho real

| Etapa | Caminho e responsabilidade |
| --- | --- |
| Seleção | `LiaProviderConfig.vue` aceita sugestões ou ID livre, sem coerção de catálogo |
| Persistência | `stores/lia/provider.ts` → IPC `provider-config-service.ts` → `lia-product.json`; endpoint permanece no config facade legado |
| Ativação | `activatePreferred/activateConfiguredProvider` atribuem provider/model; ativação visual e sincronização continuam legadas |
| Despacho | `App.vue` instala extensões no renderer líder; `getChatProviderInstance` é uma action local, não sincronizada |
| Resolução anterior | `chat.ts` → provider store, diretamente com reasoning ou via consciousness; não existia hook executável em observadores/credenciais |
| Resolução própria | Ponte seletiva no port existente → `createNativeProviderRuntime` → registry/instância Lia, sem fábrica AIRI nesse ramo |
| Execução | `useLLM.stream` → Core `streamFrom` → xsAI mantém `.chat(model).fetch` → `ProviderRuntime.dispatch` nativo |
| Resposta | Transporte Lia gerencia corpo e erros; parser/loop do chat ainda Core/xsAI. APIs próprias `chat/stream` também são executáveis sem esses pacotes |
| Cancelamento/descarte | AbortSignal do pedido combinado com prazo da operação; credencial/fetch/corpo gerenciados; descarte e troca de configuração abortam operações |

Core sobrescreve headers e sinal das opções de provider, por isso autenticação
e timeout não foram colocados em `.chat()`: são aplicados dentro do fetch próprio.
O corpo existente permanece opaco ao bridge e é validado como JSON pelo runtime,
preservando ferramentas, imagens, modelos e opções adicionais.

## Decisões implementadas

1. **Contratos independentes:** JSON, provider, modelo, capacidades, configuração,
   credencial por operação, chat, resposta, eventos de texto, erros e cancelamento;
   nenhum tipo interno AIRI é exportado por `lia/core/src/providers/`.
2. **Registry próprio:** registra IDs/definições e recusa IDs duplicados ou
   desconhecidos. Não contém modelos recomendados/allowlist nem endpoints fixos.
3. **Implementação nativa:** fetch/Web Streams, sem SDK no núcleo. Protocolo
   implementado nesta fatia: `chat-completions` com GET models opcional para uso.
4. **Cache próprio:** instância por provider/configuração efetiva, sem chave;
   alteração de configuração remove a anterior. Modelo pertence ao pedido.
5. **Credenciais:** resolver existente do vault é reutilizado por operação.
   Sondas de rascunho usam runtime temporário; a chave não entra no SDK/cache.
6. **Compatibilidade temporária explícita:** modificar uma action pública local
   do host evita alterar Stage UI ou duplicar o loop caro de ferramentas/voz.
   Outros IDs delegam ao executor anterior. Não é um wrapper para a antiga
   criação de instâncias no alvo migrado.
7. **Preservação de prazos:** sondas mantêm 15 s; runtime normal tem padrão de
   30 s, configurável no contrato até 300 s. O prazo inclui corpo e credenciais;
   não foi alargado para fazer teste passar.
8. **Erros seguros:** códigos fechados/status HTTP, sem causa, corpo, endereço ou
   chave. HTTP 400/404 continua identificável pela política existente sem mudar
   essa política. MIME/UTF-8/envelope de erro SSE são conferidos antes do SDK.
9. **Integração de source:** Node strip-types usa `.ts` explícito no núcleo;
   Stage permite essas extensões no typecheck de seu grafo externo. Seu linter
   continua recusando extensões nos fontes legados.
10. **Tooling temporário:** perfil ESLint do núcleo herda o config já instalado
    no repositório, retirando somente o seletor de extensões para Node nativo e
    a exigência de Vitest nos seus testes `node:test`. As demais restrições,
    inclusive de segurança, permanecem; scanner de fronteiras não foi alterado.

Essa decisão autoriza somente a ponte necessária no host legado e o uso do seu
tooling durante esta fatia. Não adiciona dependência AIRI ao runtime independente.

## Matriz de dependências restantes

| Área | Estado | Evidência / próximo passo |
| --- | --- | --- |
| Contratos públicos de provider/transporte | **REMOVIDA do novo núcleo** | `lia/core/src/providers/` não importa AIRI, Vue, Pinia ou SDK |
| Registry/factory/cache/HTTP do alvo genérico | **REMOVIDA da execução desse ramo** | Teste chama o LLM real sem invocar executor antigo; credenciais por pedido |
| Descoberta e teste do alvo genérico | **REMOVIDA da execução desse ramo** | Chamadas passam pelo runtime próprio; spy de definição antiga não chamado |
| Ponto de despacho do Stage | **ISOLADA** | Action local envolvida pelo port `provider-runtime.ts`; futura UI deverá chamar runtime diretamente |
| Estado/configuração de endpoint e registro visual | **AINDA NECESSÁRIA / ISOLADA** | `provider-config-facade` e activation leem/escrevem stores legados; inclusive registry na ativação visual |
| Modelo preferido/persistência/vault | **DA LIA; transporte Electron ainda necessário** | IPC/autoridade existentes preservados; sem schema novo ou migração |
| Orquestração/histórico/ferramentas/parse do chat | **AINDA NECESSÁRIA** | Core-agent, xsAI e Stage UI mantêm ciclo de conversa; não se declara independência do chat inteiro |
| Providers com outros IDs e protocolos | **AINDA NECESSÁRIA** | Executor antigo preservado; adapter específico deverá ser implementado/testado antes de migrar |
| Voz/STT/TTS | **OUTRA CAPACIDADE, AINDA NECESSÁRIA** | Hearing, preview e editor continuam no port E2 legado; nenhum suporte de áudio prometido pelo novo núcleo |
| Visão/Brain | **OUTRA CAPACIDADE, AINDA NECESSÁRIA** | Wire de imagem passa intacto; inferência visual e roteamento/capacidades não foram migrados |
| Avatar/janela/presença | **OUTRA CAPACIDADE, AINDA NECESSÁRIA** | Stage atual intacto |
| Build/lint/type tooling e instalador | **ISOLADA / AINDA NECESSÁRIA** | Host/build e perfil de lint usam ferramentas existentes em airi; instalação independente não executada |

## Matriz de protocolos / compatibilidade

| Alvo | Implementação própria | O que foi comprovado |
| --- | --- | --- |
| HTTP chat-completions, endpoint explícito | **SIM** | JSON/texto/SSE/modelos, autenticação, erros, cancelamento, cache e descarte com fixtures |
| Loop de ferramentas do chat existente | Transporte próprio + loop Core/xsAI | Duas requisições, tool_call → execução inofensiva → tool_result → texto final, inclusive rotação da chave |
| Campos de imagem/extra de transporte | Preservados no wire | Igualdade do JSON com partes de imagem/tools/reasoning; não é compreensão de imagem |
| API nativa de messages / Anthropic | **NÃO IMPLEMENTADA** | ID atual permanece legado; não presumir compatibilidade por HTTP |
| API nativa de Ollama | **NÃO IMPLEMENTADA** | ID atual permanece legado; eventual modo compatível exige endpoint/protocolo correspondente |
| LM Studio e outros servidores compatíveis | Protocolo genérico disponível, IDs antigos não migrados | Nenhum desses serviços reais foi testado; fixture não aprova fornecedor |
| Pesos locais, download, execução universal | **FORA DE ESCOPO** | Nenhum modelo baixado |

O novo núcleo exige base URL HTTP(S) sem credenciais embutidas, query ou fragmento.
Serviços que dependam de parâmetros na URL/headers especiais precisam de adapter
ou contrato explícito antes da migração. SSE tem limite de 1 MiB por evento.
As condições de prontidão/autenticação da UI continuam no host legado: a API
nativa aceita credencial opcional quando a definição permite, mas isso não
remove automaticamente a exigência de chave do onboarding genérico existente.

## Verificações reais desta rodada

Ambiente: Windows, Node 26.8.1, PowerShell, data local 30/10/2026. Os testes de
integração do host usam esse working tree e os artefatos Core já presentes. As
APIs nativas também foram testadas sem importar qualquer módulo AIRI/SDK.

| Diretório | Comando | Resultado |
| --- | --- | --- |
| Raiz | `node --experimental-strip-types --test "lia/core/test/*.test.ts"` | **PASS**, 56 testes: 26 anteriores, 29 novos de provider e 1 HTTP local, saída 0 |
| `airi` | `./node_modules/.bin/vitest run --config apps/stage-tamagotchi/vitest.config.ts --project node src/renderer/stores/lia` | Baseline **365 PASS**; final **371 PASS**, 31 arquivos, saída 0 |
| `airi` | `./node_modules/.bin/vitest run --config apps/stage-tamagotchi/vitest.config.ts --project node native-provider-execution.test.ts` | **6 PASS**, incluídos nos 371; saída 0 |
| `airi` | `./node_modules/.bin/vitest run --config apps/stage-tamagotchi/vitest.config.ts --project browser LiaProviderConfig.browser.test.ts` | **11 PASS Chromium**, saída 0 |
| `airi` | `./node_modules/.bin/vitest run --config apps/stage-tamagotchi/vitest.config.ts --project browser native-provider-runtime.browser.test.ts` | **2 PASS Chromium**, Headers/Response/Streams reais com fetch simulado, saída 0 |
| Raiz | `./airi/node_modules/.bin/tsc.cmd --project lia/core/tsconfig.json --typeRoots ./airi/node_modules/@types --types node` | **PASS**, strict/noEmit, saída 0 |
| `airi/apps/stage-tamagotchi` | `./node_modules/.bin/vue-tsc.cmd --noEmit` | **PASS**, saída 0 |
| `airi/apps/stage-tamagotchi` | `pnpm run build` pelo Corepack instalado | **PASS**, main/preload/renderer, saída 0 |

Lint nativo, raiz, **PASS saída 0**:

```powershell
./airi/node_modules/.bin/eslint.cmd --config lia/core/eslint.config.mjs lia/core/eslint.config.mjs lia/core/src/providers/contracts.ts lia/core/src/providers/registry.ts lia/core/src/providers/runtime.ts lia/core/src/providers/index.ts lia/core/test/providers.test.ts lia/core/test/providers-http.test.ts
```

Lint do host, diretório `airi`, **PASS saída 0**:

```powershell
./node_modules/.bin/moeru-lint apps/stage-tamagotchi/src/renderer/services/lia/native-provider-runtime.ts apps/stage-tamagotchi/src/renderer/stores/lia/provider-runtime.ts apps/stage-tamagotchi/src/renderer/stores/lia/provider.ts apps/stage-tamagotchi/src/renderer/stores/lia/native-provider-execution.test.ts apps/stage-tamagotchi/tsconfig.json
```

O novo `services/lia/native-provider-runtime.browser.test.ts` também foi lintado
separadamente pelo mesmo comando/ferramenta, saída 0.

`pnpm` foi invocado por
`& "$env:LOCALAPPDATA/Lia-DevTools/node_modules/.bin/corepack.cmd" pnpm run build`.
Avisos de localStorage do Node e opções/plugins do bundler permanecem nos logs;
não houve erro final nem aumento de timeout para contorná-los.

### Cobertura e contraprovas

- Registry, desconhecido, configuração inválida, chave ausente/inválida, modelo
  personalizado, endereço, texto válido/vazio, HTTP, timeout, cancelamento,
  SSE/UTF-8/espaços, cache, descarte e troca de configuração/modelo: núcleo nativo.
- Falhas HTTP/SSE contendo sentinelas privadas não chegam aos erros públicos;
  factories/cache não expõem chave e resolvem autenticação a cada pedido.
- Servidor HTTP local real em porta efêmera: GET modelos → POST conversa SSE,
  cabeçalho sintético e ID exato, texto `Olá Lia\n42`, fechamento limpo.
  **Não é serviço/modelo real nem gate visual Windows.**
- Integração host real + rede simulada: texto `Lia nativa\n42`, preservação de
  campos multimodais/tools, duas rodadas de ferramenta e chave por operação.
- Persistência/reabertura/editor da etapa anterior preservados nos testes de
  stores e Chromium; nenhuma alteração de schema/configuração pessoal.
- Corrida A→B identificada na revisão: factory antiga podia ressuscitar cache A
  e enviar credencial nova ao endereço antigo. Corrigida antes do commit.
  Contraprova removendo somente a guarda: **1 FAIL / 5 skips**, erro `protocol`
  em vez de recusa `cancelled`; versão corrigida restaurada e suíte verde.
- Guard SSE inicial revelou falha de backpressure em chunks parciais. Corrigido
  o loop de leitura, sem aumentar prazo; testes em bytes/caracteres e HTTP passam.
- Falhas intermediárias de import/tipagem/configuração de lint foram corrigidas
  sem novos imports de Core no host, dependências, mocks de SDK ou mudança no
  scanner arquitetural. O teste usa o consumidor público `useLLM` real.
- Revisão independente final: **NADA A APONTAR** após a correção da factory.
- No Chromium, o Reader do corpo também preservou o código seguro do erro SSE.
  A asserção inicial via `Response.text()` recebeu `TypeError: Failed to fetch`;
  a leitura direta do stream comprovou `protocol`, sem modificar produção ou
  exigir que o helper de alto nível preservasse o objeto de erro da stream.

Logs locais em `Tests/artifacts/provider-runtime-*-20261030.log` (ignorados pelo
Git). Este relatório versionado conserva resultados, comandos e limites.

## Arquivos e conclusão

| Arquivo | Responsabilidade |
| --- | --- |
| `lia/core/src/providers/contracts.ts` | Contratos independentes e erros seguros |
| `lia/core/src/providers/registry.ts` | Definições/capacidades por ID |
| `lia/core/src/providers/runtime.ts` | Cache, HTTP/SSE, credencial por operação e vida útil |
| `lia/core/src/providers/index.ts` | API pública do módulo |
| `lia/core/test/providers.test.ts` | Casos determinísticos do núcleo |
| `lia/core/test/providers-http.test.ts` | HTTP local real, sem SDK |
| `lia/core/eslint.config.mjs` | Perfil preciso para Node strip-types |
| `airi/apps/stage-tamagotchi/src/renderer/services/lia/native-provider-runtime.ts` | Ponte de transporte/rascunhos e proteção de factory antiga |
| `airi/apps/stage-tamagotchi/src/renderer/services/lia/native-provider-runtime.browser.test.ts` | Web Platform Chromium |
| `airi/apps/stage-tamagotchi/src/renderer/stores/lia/native-provider-execution.test.ts` | Caminho LLM/Core/SDK e loop de ferramentas |
| `airi/apps/stage-tamagotchi/src/renderer/stores/lia/provider-runtime.ts` | Ponto local de instalação, preservando operações legadas |
| `airi/apps/stage-tamagotchi/src/renderer/stores/lia/provider.ts` | Seleção da fatia, resolução do vault e descarte |
| `airi/apps/stage-tamagotchi/tsconfig.json` | Consumo dos fontes Node TS independentes |
| `docs/design/LIA-PROVIDER-RUNTIME.md` | Arquitetura efetivamente implementada |
| `docs/architecture/LIA-PROVIDER-RUNTIME-2026-10-30.md` | Relatório e matriz de dependências |
| `docs/project/CURRENT-STATE.md` | Estado operacional e próximo estágio |
| `docs/project/QUANTO-FALTA.md` | Progresso e limites da independência |

**NÃO EXECUTADO:** modelo externo, credenciais reais, janela Electron usando
serviço real, gates de voz/visão/hardware, instalador ou checkout limpo dos seis
Core pendentes. Nenhuma chamada paga ou download de modelo foi realizado.

**Próximo estágio:** configuração própria de transportes preservando registros
antigos, adapters de protocolos adicionais com fixtures reais de formato e
ampliação seletiva da migração. Separadamente, gate Windows com serviço autorizado
e limites explícitos. A missão ampla de independência permanece parcial.

Commit/push desta fatia somente na branch acordada, com caminhos explícitos;
HEAD final e igualdade local/remoto são verificados depois da publicação e
informados na resposta de entrega, sem hash autorreferente neste documento.
