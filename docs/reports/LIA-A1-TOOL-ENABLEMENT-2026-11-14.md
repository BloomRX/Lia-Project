# A-1 — Ativação de ferramentas: o filtro que não existia

**Data:** 14/11/2026
**Branch:** `arena/01a10290-lia-project`
**Base auditada:** `5ec464e` (`docs: audit the development branch against its evidence`)
**Escopo:** `packages/stage-ui` (store de ferramentas, resolução e rerun) + testes
**Fora do escopo:** UI de configuração de ferramentas, persistência de preferências,
ferramentas built-in fora do store (`mcp()`, `debug()`, `spark-web-search`).

---

## 1. O achado, reafirmado

`defaultActive: false` não impedia o envio de `get_weather`, `image_journal` e dos
widgets ao modelo. A auditoria de 14/11 registrou o sintoma; esta rodada confirma a
causa exata:

| Caminho | Código (base `5ec464e`) | Consultava `defaultActive`? |
| --- | --- | --- |
| Lista ambiente | `tools.ts` → `activeTools` | Sim (`defaultActive !== false`) |
| Envio de chat (seleção explícita por turno) | `chat.ts:556` → `getToolsByNames` → `resolveLlmTools` | **Não** |
| Rerun de tool call | `chat.ts:847` → `resolveLlmTools({ customTools: getToolsByNames(name) })` | **Não** |

Ou seja: havia **um** filtro, aplicado a **uma** das duas rotas, e a rota usada pelo
chat era justamente a que não filtrava. Pior: `defaultActive` era documentado no
store como “Includes this tool when a request does not select it explicitly”, mas a
auditoria e a documentação de arquitetura o trataram como “desabilitada” — duas
leituras incompatíveis convivendo no mesmo repositório.

## 2. O que `defaultActive` sempre foi (e o que não é)

No desenho upstream, `defaultActive` é **inclusão ambiente**: a ferramenta entra na
lista quando o pedido **não** a nomeia. Ela continua resolvível por nome. É assim que
o Stage expõe sob demanda `get_weather`, `image_journal` e os widgets: eles são
enviados quando a UI os referencia, não por estarem “ligados”.

Consequência: **`defaultActive: false` nunca foi um interruptor de desligar.** O
defeito real era não existir interruptor nenhum — e a documentação ter dito que
existia.

## 3. Correção aplicada

### 3.1 Interruptor explícito de habilitação (`enabledById`)

`packages/stage-ui/src/stores/ai/chat-llm/tools.ts`:

```ts
const enabledById = ref<Record<string, boolean>>({})

function isToolEnabled(id: string): boolean {
  return enabledById.value[id] ?? true
}

function setToolEnabled(id: string, enabled: boolean): void {
  enabledById.value = { ...enabledById.value, [id]: enabled }
}
```

Três camadas separadas, agora nomeadas:

1. **registrada?** — a definição existe no store (inventário);
2. **ambiente?** — `defaultActive !== false` (contrato upstream, inalterado);
3. **habilitada?** — `enabledById` (decisão explícita do usuário/produto).

A camada 3 vale para **todas** as rotas:

- `activeTools` filtra `defaultActive !== false && isToolEnabled(id)`;
- `getToolsByNames` — usada tanto pelo envio quanto pelo rerun — **não resolve**
  ferramenta desabilitada, mesmo que o nome venha de um turno antigo;
- cada `execute` exposto passa por um wrapper que lança `ToolDisabledError` se a
  ferramenta foi desabilitada **depois** de o objeto ter sido capturado (envio em
  fila, rerun armazenado, referência de plugin).

### 3.2 Por que o padrão é “habilitada”

`isToolEnabled` devolve `true` para ids desconhecidos. Registrar uma ferramenta já é
uma decisão da aplicação; transformar isso em opt-in implícito removeria
funcionalidade que hoje funciona, violando a restrição de compatibilidade. **Só um
`false` explícito desabilita.** Nada no código chama `setToolEnabled` automaticamente
— não há auto-habilitação nem permissão implícita.

Re-registro (refresh de líder, reconexão de MCP/plugin) **não** limpa a escolha: o
mapa é por id e `addTools` não o toca. `removeToolById` também preserva a escolha,
para que um plugin que volte não volte ligado por acidente.

### 3.3 Higiene que veio junto

- `tool-name.ts`: `toolNameFrom` extraído para um módulo folha. `tool-resolver.ts`
  reexporta; `tool-call-rerun.ts` importa a folha. Sem isso, qualquer teste do rerun
  arrastava `tools/index` → spark-command → `server-sdk` → `better-ws` →
  `server-shared` → `plugin-protocol/types` e não executava. É refactor de import,
  sem mudança de comportamento; foi ele que desbloqueou `tool-call-rerun.test.ts`.
- Documentação de `defaultActive` corrigida no tipo (não é interruptor).
- O caso de teste que fixava a identidade do executor (`activeTools[0].execute ===
  second.execute`) passou a verificar **comportamento** (delega ao executor
  registrado e não ao anterior), porque o wrapper de habilitação é intencional.

## 4. O que **não** mudou

- Nenhum `defaultActive` foi alterado; nenhuma ferramenta foi ligada ou desligada
  nesta entrega.
- Nenhuma configuração do usuário foi tocada — não existe hoje configuração de
  ferramentas para tocar.
- `get_weather`, `image_journal` e widgets continuam funcionando exatamente como
  antes. A decisão de desligá-los por padrão é de produto e está na §6.
- `mcp()`, `debug()` e spark/web-search continuam fora do store e não são afetados
  por `enabledById` (documentado como pendência estrutural).

## 5. Evidência desta rodada

Comandos e resultados (Linux, sandbox; nenhuma alegação de Windows):

| Verificação | Comando | Resultado |
| --- | --- | --- |
| Store de ferramentas | `corepack pnpm exec vitest run src/stores/ai/chat-llm/tools.test.ts` | **13/13 PASS** (5 originais + 8 de habilitação) |
| Resolução + rerun (composição real) | `... vitest run src/stores/ai/chat-llm/tool-resolver.test.ts` | **11/11 PASS** (6 originais + 5 novos) |
| Rerun isolado | `... vitest run src/stores/tool-call-rerun.test.ts` | **7/7 PASS** |
| Registro das built-ins | `pnpm -F @proj-airi/stage-tamagotchi exec vitest run --config vitest.config.ts src/renderer/stores/tools/built-in.test.ts` | **1/1 PASS** |
| Tipos | `corepack pnpm exec tsc --noEmit` (filtrado nos arquivos alterados) | **0 erros** nos arquivos alterados; erros preexistentes fora do escopo permanecem |
| Lint | `corepack pnpm exec eslint` nos 6 arquivos | **limpo** |
| `llm.test.ts` | — | **NOT RUN / BLOCKED**: `@proj-airi/stream-kit` sem build neste ambiente (falha preexistente, não relacionada) |

Os 31 testes acima foram **re-executados na árvore commitada `f3facdf`** depois de o
workspace ser restaurado (o sandbox recriou o checkout em `db99c70` no meio da rodada;
o estado foi preservado em `/home/user/lia-preserve/round9/` e restaurado por
`fetch` → `read-tree` → `checkout-index` → `update-ref`, sem `checkout`/`switch`).
`node_modules` e `dist` não persistem entre turnos: dependências do `stage-ui` e do
`stage-tamagotchi`, e builds de `plugin-protocol`, `core-agent`, `server-shared`,
`better-ws` e `server-sdk` foram refeitos antes dessa re-execução.

Casos de regressão cobertos (todos com prova de execução, não mock de tool calling):

- ferramenta habilitada é apresentada e executa (envio explícito e rerun);
- ferramenta desabilitada **não** é apresentada em nenhuma das duas rotas;
- objeto capturado antes da desabilitação **recusa** execução (`ToolDisabledError`);
- nome inexistente continua devolvendo lista vazia;
- re-registro não reabilita;
- desabilitar uma não afeta as outras;
- `enabledById` permanece vazio quando ninguém desabilita (sem auto-habilitação
  silenciosa de nada).

## 6. Decisão de produto — registrada em 14/11/2026

**Decisão do usuário: opção (a) — manter sob demanda.** `get_weather`,
`image_journal` e `stage_widgets` continuam **habilitadas** e disponíveis quando
solicitadas explicitamente; nada é desligado, nenhuma configuração existente muda e
a UI de ativação **não** é implementada agora.

A distinção fica estabelecida como contrato:

| Conceito | Campo | Significado | Efeito |
| --- | --- | --- | --- |
| Inclusão automática | `defaultActive` | Entra no contexto da conversa quando o pedido **não** nomeia a ferramenta | Não é interruptor; `false` ≠ desabilitada |
| Habilitação | `enabledById` / `setToolEnabled` | A ferramenta está habilitada ou desabilitada | Desabilitada = não é apresentada ao modelo **e** não é executada |
| Disponibilidade | registro no store | A ferramenta existe no inventário do runtime | Sem registro, não há o que resolver |

- Habilitada continua disponível quando solicitada explicitamente, mesmo com
  `defaultActive: false`.
- Desabilitada não pode ser apresentada ao modelo nem executada, **inclusive por
  referências capturadas anteriormente** (envio em fila, rerun armazenado, objeto de
  plugin já resolvido).

## 7. Infraestrutura preparada para a futura tela de gerenciamento

A decisão foi **não** construir a UI agora, mas o gate já é o ponto de extensão
correto e nenhuma mudança de contrato será necessária depois:

| Peça | Estado | O que a UI futura fará |
| --- | --- | --- |
| `tools` | lista de definições com `id` estável | renderiza a lista (id, nome, descrição, `defaultActive`) |
| `isToolEnabled(id)` | `enabledById[id] ?? true` | lê o estado do interruptor |
| `setToolEnabled(id, enabled)` | único caminho de mutação | liga/desliga por ferramenta |
| `enabledById` | `ref` exposto no store | superfície de leitura/observação |
| `synced: { state: true }` | já existente no store | propaga a escolha entre janelas do Stage |

O que falta, e fica explicitamente para a tarefa da UI:

1. tela/chave de ativação chamando `setToolEnabled` (hoje sem chamador de produção);
2. **persistência** de `enabledById` entre reinícios — o store é em memória, então
   hoje reiniciar volta ao padrão “habilitada”, igual ao registro de ferramentas;
   a UI deve gravar a escolha pelo mesmo caminho de configuração já usado pelo app,
   sem introduzir um segundo dono da preferência;
3. `mcp()`, `debug()`, spark e web-search não passam pelo store; uma política única
   de “desligar” precisa alcançá-los antes de a tela prometer controle total.

## 8. Pendências estruturais registradas

1. UI de ativação + persistência (ver §7) — **adiado por decisão de produto**.
2. Ferramentas built-in fora do store (`mcp()`, `debug()`, spark, web-search) ainda
   não são alcançadas por `enabledById`.
3. `docs/reports/LIA-ARCHITECTURE-STABILIZATION-2026-11-12.md` afirmava “ativação por
   ferramenta no store” antes de ela existir — nota de correção adicionada.
