# PROMPT-39 — AI Settings do Launcher (MVP)

**Data:** 12/11/2026
**Branch:** `arena/01a10290-lia-project`
**Base da rodada:** `a7fdb45`
**Proposta aprovada:** [LIA-LAUNCHER-AI-SETTINGS-PROPOSAL-2026-11-12](../product/LIA-LAUNCHER-AI-SETTINGS-PROPOSAL-2026-11-12.md)

## Resultado em uma linha

O MVP de AI Settings está implementado no código e coberto por testes automatizados
verdes: catálogo de provedores, conexão única por provedor, chave no vault, descoberta de
modelos, `modelId` manual, seleção canônica e restauração após reinício. **A validação
Windows de 9 passos NÃO foi executada** neste ambiente; nenhuma funcionalidade de runtime
é declarada aprovada.

## 1. O que foi implementado

### Catálogo de provedores (`@lia/contracts`)

`lia/core/src/providers/catalog.ts` é a lista canônica das definições que o Launcher pode
oferecer, sem segredo e sem dependência de Electron:

- **Groq** — `ready`, endpoint `https://api.groq.com/openai/v1`, modelos sugeridos
  `openai/gpt-oss-120b` (recomendado) e `qwen/qwen3.8-27b`, `requiresApiKey: true`;
  `definitionId`, `stageProviderId` e `engineId` são campos separados (hoje iguais por
  fato auditado, não por regra).
- **OpenAI-compatível** — `unavailable`, com motivo explícito e **sem** ids de Stage/engine:
  permanece visível, mas nunca selecionável enquanto a resolução completa até o Stage não
  estiver implementada e testada.
- Lookups por definição, por provider do Stage e por engine; ids desconhecidos retornam
  `undefined` e não lançam.

### Serviço Main — autoridade única

`airi/apps/lia-app/src/main/ai-connection-service.ts`:

- `catalog()` → metadados não secretos, com `availability`/`unavailableReason`.
- `read(definitionId?)` → estado da conexão com `definitionId`, `connectionId`,
  `stageProviderId`, `engineId`, `modelId`, `hasKey`, `revision` e `selected`; a chave
  nunca sai do vault.
- `save(input)` → envelope estrito `{ providerId, baseUrl, apiKey?, modelId?, revision,
  confirmHostChange? }`; exige `providerId`; bloqueia provedor não gerenciável
  (`provider-unavailable`); valida revisão (`conflict`), host (`unconfirmed-host`) e
  credencial (`credentials`); grava `enabled: false` antes de trocar chave/seleção, usa
  CAS no vault e restaura chave, seleção e registro em caso de falha.
- `discover(providerId)` / `probe(providerId)` → exigem `providerId`, leem o registro
  salvo, aplicam a mesma política de endpoint, usam `redirect: 'error'`, timeout de 30 s e
  teto de 1 MB no corpo; linha duplicada/corrompida falha fechada como `unconfigured`.
- `isSafeToStart()` → continua sendo o gate consumido por `lia-host.ts`; configuração
  insegura ou registro `enabled: false` impedem o início do Stage. Seleção legada fora do
  catálogo mantém o comportamento anterior.
- Política de endpoint no Main: HTTPS em qualquer host; HTTP só loopback; URL sem
  usuário/senha/query/fragmento; troca de host exige confirmação explícita e chave nova.

### IPC / preload

- `lia:ai:providers` (novo), `lia:ai:connection:get`, `:save`, `:models`, `:test`.
- O preload expõe `aiProviders()`, `aiConnectionGet/Models/Test(providerId?)` e
  `aiConnectionSave(input)`. Nenhuma chave cruza a superfície.

### Renderer

`AiResourcesView.vue` foi reescrita como central de configuração:

- lista os provedores do catálogo, mostra indisponíveis com o motivo e desabilita a
  configuração;
- carrega o estado por `definitionId` (sem provedor implícito), exibe "Em uso pela Lia"
  quando a seleção canônica aponta para ele;
- cadastra/troca a chave, testa a conexão, busca modelos, escolhe da lista **ou** digita o
  `modelId` manualmente;
- salva com `providerId` e `revision`; quando o host muda, exige confirmação explícita e
  avisa que a chave precisa ser nova;
- limpa o campo de chave após salvar e ao desmontar; não usa `localStorage`,
  `sessionStorage` nem loga segredo;
- mantém pt-BR/en e os primitivos/tokens existentes.

## 2. Arquivos alterados

| Arquivo | Estado |
| --- | --- |
| `lia/core/src/providers/catalog.ts` | novo — definições, disponibilidade, lookups |
| `lia/core/src/providers/index.ts` | reexporta o catálogo |
| `lia/core/test/providers-catalog.test.ts` | novo — 5 testes do catálogo |
| `airi/apps/lia-app/src/main/ai-connection-service.ts` | reescrito — serviço Main do MVP |
| `airi/apps/lia-app/src/main/ai-connection-service.test.ts` | reescrito — 24 testes |
| `airi/apps/lia-app/src/main/ipc.ts` | canal de catálogo + `providerId` |
| `airi/apps/lia-app/src/preload/index.ts` | APIs tipadas expostas ao renderer |
| `airi/apps/lia-app/src/main/lia-host.ai-interlock.test.ts` | atualizado para a nova API |
| `airi/apps/lia-app/src/main/credential-owner-host.test.ts` | atualizado para a nova API |
| `airi/apps/lia-app/src/renderer/src/views/AiResourcesView.vue` | reescrita — UI de AI Settings |
| `airi/apps/lia-app/src/renderer/src/ai-resources-view.test.ts` | novo — 7 garantias estáticas |
| `docs/product/LIA-LAUNCHER-AI-SETTINGS-PROPOSAL-2026-11-12.md` | novo — decisões aprovadas |
| `docs/reports/PROMPT-39-LAUNCHER-AI-SETTINGS.md` | este relatório |
| `docs/project/CURRENT-STATE.md` | estado da rodada |

`lia-host.ts` **não** foi alterado: ele já consumia `aiConnection.isSafeToStart()` e o
interlock continua verde com a nova API. Nenhum arquivo preexistente não relacionado foi
removido ou revertido.

## 3. Testes executados

### `lia/core` (`@lia/contracts`)

```bash
cd lia/core
node --experimental-strip-types --test "test/*.test.ts"
```

Resultado: **98 testes, 98 passed, 0 fail, 0 skipped** (11 suites).

### `@lia/lia-app`

```bash
cd airi
corepack pnpm -F @lia/lia-app test
```

Resultado: **29 arquivos, 301 passed, 2 skipped (303)**. As 3 falhas da rodada anterior
foram corrigidas e revalidadas:

1. rollback de seleção agora recebe `modelId` (a seleção só é publicada quando há modelo);
2. linha de transporte duplicada/corrompida em `discover`/`probe` retorna `unconfigured`
   (fail-closed), não `network`;
3. assertiva do catálogo não confunde `requiresApiKey` com segredo.

Destaques do arquivo `ai-connection-service.test.ts` (24/24):

- catálogo não contém chave e bloqueia provedor indisponível;
- CRUD de chave sem devolver o segredo;
- HTTP 401 → `http`;
- descoberta de modelos + persistência da seleção após reinício do serviço;
- `modelId` manual aceito e validação rejeita quebra de linha;
- troca de host sem confirmação → `unconfirmed-host`; chave guardada nunca é enviada a
  destino não salvo;
- integração produto → decisão do Brain → mapeamento do Stage → registro de transporte;
- catálogo × política de engines (`groq → groq`).

### Verificações estáticas

```bash
cd airi
corepack pnpm -F @lia/lia-app typecheck   # tsc --noEmit: 0 erros
corepack pnpm -F @lia/lia-app build       # main + preload + renderer compilam
```

O `build` do script chama `pnpm` puro; neste sandbox foi executado com um shim de
`corepack pnpm` no `PATH`. A saída gerada em `out/` não é versionada.

## 4. Evidência de segurança (automatizada)

- O catálogo exposto ao renderer é serializável e não contém chave; a assertiva usa
  `not.toHaveProperty('apiKey')` e ausência de `secret|bearer|private`.
- O serviço não retorna a chave em `read`, `save`, `discover` nem `probe`.
- Teste dedicado confirma que a chave persistida não é enviada para um host não salvo.
- O envelope de `save` rejeita campos desconhecidos, `apiKey` com quebra de linha e URL
  com credencial/query/fragmento.
- A página do renderer não usa `localStorage`/`sessionStorage`/`console`, limpa o campo de
  chave no save e no unmount.

## 5. Validação Windows — NÃO EXECUTADA

O roteiro obrigatório de 9 passos **não foi executado**:

1. abrir o Launcher;
2. cadastrar uma chave Groq válida;
3. testar a conexão;
4. consultar os modelos;
5. selecionar `openai/gpt-oss-120b`;
6. salvar;
7. abrir "Conversar com Lia";
8. enviar uma mensagem e receber resposta;
9. reabrir a conversa e confirmar a persistência.

Este sandbox é Linux e não tem acesso ao runtime Windows, ao vault real nem a uma chave
Groq válida. Consequências:

- **nenhum PASS de runtime é declarado** para AI Settings;
- a sonda de conexão (passo 3) não substitui a conversa real (passos 7–9);
- a seleção persistida foi provada por teste de integração com o `lia-product.json` real
  do fixture, não por reabertura do aplicativo Electron.

## 6. Pendências reais

1. **Gate Windows de 9 passos** acima — bloqueia declarar o MVP aprovado.
2. **PROMPT-38 (tool calling)** continua sendo gate independente: a rodada anterior
   observou `401 invalid_api_key` no Groq real; sem chave válida não há prova de tool call.
3. **Fidelidade visual** a `docs/design/concepts/02-ai-resources.png` não foi validada por
   screenshot; a página é funcional e usa os tokens/primitivos, mas não houve inspeção
   visual no Electron.
4. **Múltiplas conexões por provedor, Model Manager, benchmark de hardware e roteamento
   por função** continuam fora de escopo por decisão aprovada.
