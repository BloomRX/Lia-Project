# Estabilização da arquitetura — Etapa 1, auditoria de identidade e segurança

**Data:** 12/11/2026
**Branch:** `arena/01a10290-lia-project`
**Base:** `140ff09` (decisão de runtime publicada)
**Natureza:** código executável no sandbox + auditoria estática. Nenhum gate Windows foi
executado, nenhuma credencial foi cadastrada, nenhum provider foi ampliado.

---

## 1. O que este relatório cobre

| Etapa do plano mestre | O que foi feito | Estado |
|---|---|---|
| 1 — estabilizar a arquitetura escolhida | contrato de host versionado no Core; fronteiras já congeladas em teste | **PASS** (offline) |
| 2.1 — identidade do provider | invariante de seleção única; auditoria dos escritores | **PASS** com achado AF-1 |
| 3 — tool calling | inventário do mecanismo existente | **auditado**; gate real NOT RUN |
| 4 — revisão visual | — | **NOT RUN** (sem display) |
| 5 — segurança e regressão | endurecimento do IPC + auditoria da superfície | **PASS** (offline) |
| 6 — documentação | este relatório + `CURRENT-STATE` | **PASS** |

---

## 2. Contrato de host (`@lia/contracts`)

`lia/core/src/host/contracts.ts` materializa a fronteira que a decisão de 12/11 exigiu: o
Core pergunta por **capacidade**, não por runtime.

- `HOST_CONTRACT_VERSION = '1.0.0'`; compatibilidade por MAJOR, reutilizando
  `negotiate()` do protocolo Launcher↔Stage — não há segunda regra de versão.
- Lista fechada de capacidades: `windows`, `tray`, `audio`, `screen`, `power`,
  `shortcuts`, `notifications`, `tools`.
- `LiaHostDescriptor` valida id/kind/versão/capacidades e **recusa sem lançar**.
- `missingCapabilities` / `hostSatisfies` devolvem a capacidade ausente **e o motivo do
  requisito** — "faltou `screen` porque a presença acompanha monitores".
- Comandos: `window.show`, `window.hide`, `presence.set-budget`, `stage.spawn`,
  `stage.stop`, `audio.list-devices`, `tool.execute` — nenhum executa comando arbitrário.
- `parseHostCommand` recusa versão incompatível, tipo desconhecido, id malformado e campo
  extra, sem lançar. O `payload` é opaco de propósito: cada handler valida o seu.

**Por que isso importa agora:** o teste demonstra que um host `headless` pode servir
`tools` sem janela, e que um host Electron sem `tools` não pode. A decisão de migração deixa
de depender de "o código está acoplado?" e passa a depender de "qual capacidade falta?".

**Testes:** `lia/core/test/host-contract.test.ts` — **7/7**.

## 3. Identidade do provider e seleção única (Etapa 2.1)

### 3.1 O que o Launcher escreve

`ai-connection-service.ts` grava a seleção canônica por `deps.saveSelection({ providerId,
modelId })`, que o host liga a `provider.chat.preferred`. O novo teste estático
`ai-selection-authority.test.ts` congela:

- nenhuma escrita em `brain.engine.preferred` / `brain.model.preferred`;
- nenhuma referência a `brainSelectionUpdate` / `brainRoutingModeUpdate`;
- nenhum import de Electron nem do Stage em tempo de execução;
- identidade derivada do objeto de catálogo (`definition.stageProviderId`,
  `definition.engineId`), nunca de igualdade de string presumida;
- falha fechada: `provider-unavailable` e `enabled: false` antes de qualquer troca.

### 3.2 Achado AF-1 — o renderer do Stage ainda escreve `provider.chat.preferred`

**Fato local, com caminho completo:**

1. `airi/apps/stage-tamagotchi/src/renderer/stores/lia/provider.ts:441` — `persistConfig`
   chama `saveChatConfig` (eventa `electronLiaProviderChatConfigSet`).
2. `.../main/services/lia/provider-config-service.ts:32` — o handler grava
   `provider.chat.preferred` direto no `lia-product.json`.
3. O componente é **montado de verdade**: `renderer/pages/home.vue:296` (onboarding) e
   `components/lia-config/sections/AiSection.vue` (configurações).

**Consequência:** existem dois escritores da mesma seleção — o Launcher (novo, autoridade
aprovada) e o Stage (legado, ainda alcançável). Não é uma segunda seleção em `brain.*`,
mas é uma segunda *fonte de escrita* em `provider.chat.preferred`.

**Por que não foi corrigido nesta rodada:** o `LiaProviderConfig.vue` é o único caminho
para provedores fora do catálogo do Launcher; removê-lo sem validação Windows regrediria
funcionalidade conquistada (PROMPT-37). A correção exige uma regra de produto — "para
provider gerenciado pelo Launcher, o Stage não altera `preferred`" — e um teste de runtime
na máquina real. Fica registrado como item aberto, **não** como resolvido.

### 3.3 Achado AF-2 — `brainSelectionUpdate` é código dormente

`airi/packages/lia-core/src/product/config.ts:464` define escritores de
`brain.engine.preferred` / `brain.model.preferred`. A busca no repositório encontra apenas
os testes do próprio módulo: **nenhum caminho de produção chama a função**. Hoje não há
segunda seleção ativa; o risco é uma reativação acidental. O teste de autoridade impede que
o serviço de AI Settings a use.

## 4. Segurança do IPC (Etapa 5)

### 4.1 Endurecimento aplicado

`sanitizeConfigUpdate` foi extraído de `ipc.ts` para
`airi/apps/lia-app/src/main/config-update-sanitizer.ts` — sem Electron, portanto testável —
e passou a impor:

- **no máximo 8 credenciais por atualização** (antes: lista ilimitada);
- `scope`/`key` no formato `[\w.:-]{1,64}` — antes qualquer string de até 64 caracteres,
  incluindo caminhos e espaços;
- valor de até 4 KiB e **sem caractere de controle** (NUL, quebras de linha, ESC);
- valor vazio continua significando **remoção explícita** (semântica preservada).

`lia-host.updateConfig` continua sendo o validador final e mantém a checagem de
`isPublicCredentialReference` + CAS de revisão no vault.

**Testes:** `config-update-sanitizer.test.ts` — 5 casos, incluindo payload hostil
(`__proto__`, tipos errados, lote acima do limite).

### 4.2 Auditoria da superfície

`ipc-surface.test.ts` congela o inventário dos **26 canais** e verifica:

- prefixo `lia:` e ausência de duplicatas;
- nenhum `getSecret(` no caminho do renderer — só `hasSecret`;
- nenhum `console.log/debug/info` no arquivo;
- `lia:secrets:presence` valida `isPublicCredentialReference` e devolve booleano;
- cada operação de AI Settings é ligada a um provider explícito;
- `lia:config:update` passa **sempre** pelo sanitizador;
- `lia:voices:import` só aceita caminhos escolhidos pelo diálogo.

### 4.3 Achado AF-3 — `sandbox: false`

`airi/apps/lia-app/src/main/index.ts:208` cria a janela com `contextIsolation: true`,
`nodeIntegration: false` e `sandbox: false`. O preload importa apenas
`contextBridge`/`ipcRenderer`, o que é compatível com sandbox. **Não foi alterado** nesta
rodada: ligar sandbox sem validação no Windows pode impedir o boot da janela. Fica como
SEC-1, com o teste de fronteira já garantindo que o preload permanece sandbox-compatível.

## 5. Tool calling (Etapa 3) — inventário, sem criação

O mecanismo exigido já existe; o que falta é a prova real, não a ferramenta:

| Peça | Evidência |
|---|---|
| Registro de ferramentas do Stage | `renderer/stores/tools/index.ts`, `built-in.ts`, `mcp.ts`, `plugins.ts` |
| Ferramentas embutidas | `stage_widgets`, `get_weather`, `image_journal` — todas com `defaultActive: false` e prefixo `tamagotchi:` |
| Execução e streaming | `@proj-airi/core-agent` streaming com `tool-call`/`tool-result`/`tool-error`; auto-degrade só para providers sem suporte |
| Autorização | ativação por ferramenta no store; nenhuma execução arbitrária de comando |

**Conclusão:** criar uma nova ferramenta não é o gargalo. O que falta é o round-trip real
(requisição → tool call → execução local → retorno ao modelo → resposta → histórico), que
exige chave válida e runtime Windows. Continua **NOT RUN**.

## 6. Testes executados nesta rodada

| Verificação | Resultado |
|---|---|
| `lia/core` (`node --experimental-strip-types --test test/*.test.ts`) | **105 passed**, 0 fail |
| `@lia/lia-app` (`vitest run`) | 33 arquivos, **323 passed**, 2 skipped |
| `@lia/lia-app` typecheck (`tsc --noEmit`) | **0 erros** |
| Novos testes | host contract 7, sanitizer 5, IPC surface 7, seleção única 5 |
| Windows / runtime real | **NÃO EXECUTADO** |

## 7. Gates

| Gate | Estado |
|---|---|
| Arquitetura | **PASS** (decisão + contrato de host + fronteiras testadas) |
| Migração | **N/A** — não autorizada |
| Launcher | **PASS** apenas para init/shutdown (PROMPT-40); resto NOT RUN |
| AI Settings | **BLOCKED** (interação humana + chave na UI) |
| Provider | **NOT RUN** |
| Tool Calling | **NOT RUN** |
| Histórico | **NOT RUN** |
| Visual | **NOT RUN** |
| Segurança | **PASS offline**; SEC-1 (`sandbox`) e AF-1 abertos |
| Distribuição | **NOT RUN** |

## 8. Próximos passos

1. Windows: habilitar interação, digitar a chave na UI e executar os 16 passos do
   `LIA-AI-SETTINGS-END-TO-END-PLAN.md`.
2. Medir C0–C4 e o experimento de runtime único (decisão de arquitetura, §9).
3. Decidir AF-1 com regra de produto e teste real; só então alterar o Stage.
4. Avaliar SEC-1 (`sandbox: true`) junto da mesma rodada Windows, com plano de reversão.
