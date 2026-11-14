# Relatório de higiene de build — Lia

**Branch:** `arena/4ec8f22b-lia-project` (a partir de `407300b8baa56b0ed8d14b7b2c0628222754e51f`)
**Data:** 14/11/2026
**Local:** São Paulo, SP, BR (UTC)
**Status:** correções isoladas aplicadas e commitadas; build **não** declarado reprodutível (não demonstrado em ambiente limpo).

Este relatório é dividido por domínio: lint, Stage UI, build, dependências externas, ativos/licenças e limitações de ambiente. Nenhuma regra do ESLint foi silenciada globalmente. Nenhuma alteração de arquitetura de autenticação, áudio, redesign de UI, remoção de ativo ou redistribuição sem direito confirmado foi feita.

---

## 1. Lint

### Situação inicial (commit `407300b`, sem minhas alterações)
`pnpm run lint` (`moeru-lint .`) sobre 3491 arquivos: **81 erros, 0 avisos**. Os erros são, em sua maioria, problemas de estilo (import ordering, aspas, chaves) espalhados pelo repositório, além de um conjunto alvo de erros reais em 7 arquivos que usei como escopo da correção:

- `no-control-regex` — 4 ocorrências (regex de controle `\u00XX` rejeitadas pela regra).
- `no-unused-vars` / `unused-imports/no-unused-imports` — 2 ocorrências (import não usado em `ipc.ts`, variável destruída não usada em `process-monitor.mjs`).
- `unicorn/no-new-array` — 1 ocorrência (`new Array(10).fill(...)`).
- `unicorn/no-useless-spread` — 3 ocorrências (`[...jobs.values()]`).

### Correções aplicadas (7 arquivos, sem silenciar regras)
Substitui regex de controle por helpers de código de ponto (`containsControlCharacter` / `containsDisallowedControlCharacter`), removi import não usado, renomeei variável destruída para `_firstSeen`, troquei `new Array(10).fill()` por `Array.from({ length: 10 }).fill()` e troquei `[...jobs.values()]` por `jobs.values()`. Corrigi também a estrutura de funções que o script inicial havia rompido acidentalmente (assinatura separada do corpo `{` em `validId`/`identifier`/`validText`).

Arquivos editados:
- `airi/apps/lia-app/src/main/config-update-sanitizer.ts`
- `airi/apps/lia-app/src/main/ipc.ts`
- `airi/apps/lia-app/src/main/ai-connection-service.ts`
- `airi/apps/stage-tamagotchi/src/main/services/lia/transport-execution-service.ts`
- `airi/apps/stage-tamagotchi/src/main/services/lia/memory-service.ts`
- `airi/apps/stage-tamagotchi/src/renderer/services/lia/memory-context.test.ts`
- `airi/apps/stage-tamagotchi/scripts/provider-runtime-electron/lib/process-monitor.mjs`

### Resultado
Os 7 arquivos alvo agora têm **0 erros e 0 avisos** sob a config do repositório (`pnpm run lint`). O restante do repositório ainda apresenta ~79 erros de estilo pré-existentes (fora do escopo alvo); não rodei `--fix` em todo o repositório porque geraria um diff não isolado (centenas de arquivos), contrário ao princípio de correções isoladas.

---

## 2. Stage UI — exit 1 e rejeição não tratada

### Testes
Após build dos pacotes `@proj-airi/audio` e `@proj-airi/pipelines-audio` (seus `dist/` estavam em falta e causavam 34 falhas de afirmação), rodei `pnpm -C airi/packages/stage-ui test:run` (`vitest run`):

- **Test Files: 154 passed (174)**
- **Tests: 1153 passed (1153), 0 failed**

Todas as 1153 afirmações de unidade passam. As 20 arquivos restantes são de navegador (playwright) e não foram executadas.

### Exit 1 do vitest
O exit 1 vem do **BrowserPool do vitest (playwright)**: `TypeError: fetch failed` ao tentar abrir o navegador (`PlaywrightBrowserProvider.createContext`), sem ambiente de tela/navegador no sandbox. É uma **limitação de ambiente**, não falha de teste. Os testes de nó passam todos.

### Rejeição não tratada (corrigida)
`packages/stage-ui/src/stores/auth.ts`, `updateCredits()` era invocado com `void updateCredits()` (fire-and-forget). Se `client.api.v1.flux.$get()` rejeitasse (ex. `api.airi.build` inalcançável — ECONNRESET no sandbox), a promessa rejeitava sem manipulador → **rejeição não tratada**. Corrigi envolvendo o corpo em `try/catch`, registrando o erro via `console.error` + `errorMessageFrom`. Não altera arquitetura de autenticação nem credenciais.

### `api.airi.build`
`speech.ts:139` (`loadVoicesForProvider`) também chama `api.airi.build` e sofre ECONNRESET no sandbox, mas trata o erro graciosamente (teste passa). Não é fonte de rejeição não tratada.

---

## 3. Build (turbo)

Rodei `pnpm run build` com `--concurrency=1` (o sandbox tem ~4 GB RAM, 2 CPUs; rolldown/tsdown em paralelo matou processos via OOM, exit 129).

- **36 tarefas bem-sucedidas, 22 em cache**, 40 no escopo.
- `@proj-airi/audio/dist/` e `@proj-airi/pipelines-audio/dist/` agora existem (desbloqueia imports de `encoding`, `audio-context` nos testes).
- **Bloqueado:** `@proj-airi/stage-pocket#build` falha com exit 1 porque o plugin `@proj-airi/unplugin-fetch@0.2.3` tenta baixar, na fase `configResolved` do Vite, de `https://dist.ayaka.moe/...` → **ECONNRESET** (TLS interrompido pelo sandbox). Como o turbo aborta tarefas em voo, `stage-tamagotchi` e `stage-web` também não produziram `dist/`. Nenhum `dist/` de app Stage existe no momento.

Não é possível completar o build dos apps Stage neste sandbox porque o download é obrigatório no momento de resolução de config e a rede externa está bloqueada. Registrado como limitação de ambiente (item 6).

---

## 4. Dependências externas — `dist.ayaka.moe` (ECONNRESET)

Os 3 arquivos de config do Vite (via `@proj-airi/unplugin-fetch@0.2.3`, pacote externo, não está em `plugins/`) chamam:

- `apps/stage-pocket/vite.config.ts`
- `apps/stage-tamagotchi/electron.vite-config.ts`
- `apps/stage-web/vite.config.ts`

Cada um baixa, em tempo de build:
- `https://dist.ayaka.moe/live2d-models/hiyori_free_zh.zip`
- `https://dist.ayaka.moe/live2d-models/hiyori_pro_zh.zip`
- `https://dist.ayaka.moe/vrm-models/VRoid-Hub/AvatarSample-A/AvatarSample_A.vrm`
- `https://dist.ayaka.moe/vrm-models/VRoid-Hub/AvatarSample-B/AvatarSample_B.vrm`
- Mais `DownloadLive2DSDK()` (Cubism SDK, `cubism.live2d.com`).

No sandbox todos dão ECONNRESET / 302 (interceptação TLS). Esses ativos **não estão presentes localmente** (são só placeholders `preview.png` em `stage-ui/assets/`).

Classificação (item 5): **recursos opcionais e diferíveis** (modelos de personagem amostra + SDK Cubism), não obrigatórios para iniciar o Lia. O problema é que o plugin os torna obrigatórios no build (lança exceção em `configResolved`).

### Solução reprodutível proposta (não implementada neste sandbox)
Vendoriar esses ativos localmente com SHA-256, licenças e proveniência, e fazer o plugin/download pular ou usar cache local quando offline, para o build ser independente da rede e reprodutível. **Não implementei** porque: (a) não consigo baixar os ativos (rede bloqueada); (b) não posso redistribuir sem direito de uso confirmado (licença não avaliada). Registrado como pendente.

---

## 5. Ativos e licenças

Inventário físico de `lia/assets/` (sem arquivos de licença em `lia/`; licença/proveniência **não avaliadas** — conforme `docs/licenses/ASSET-LICENSES.md`, "Lia Hero PNG: requer autorização / não verificado"):

| Ativo | Caminho | Tamanho | SHA-256 | Licença/proveniência |
|---|---|---|---|---|
| Brand | `lia/assets/brand/LiaName.png` | 15.393 B | `c981019c…67c70f` | não avaliada |
| Caractere | `lia/assets/character/LiaHeroImage.png` | 1.771.358 B | `a6772cb1…e9126e` | não avaliada (ASSET-LICENSES.md) |
| Ícone | `lia/assets/icons/IconAppCompact.png` | 1.463.818 B | `1510b224…09996` | não avaliada |
| Ícone | `lia/assets/icons/IconAppToolBar.png` | 2.538.122 B | `48e3bc3e…707b0` | não avaliada |

Referências úteis já no repositório: `docs/licenses/ASSET-LICENSES.md`, `docs/licenses/THIRD-PARTY-NOTICES.md`, `docs/licenses/PACKAGED-INVENTORY-2026-11-08.json`, `docs/licenses/PACKAGED-INVENTORY-BETA-2026-11-08.json`.

Ações respeitando as restrições do usuário: **não removi** nenhum ativo (licença não avaliada) e **não redistribuí** nada. A inclusão desses ativos em distribuição pública exige avaliação de licença separada.

---

## 6. Limitações de ambiente (Linux sandbox)

- **Rede externa bloqueada por TLS:** `dist.ayaka.moe`, `cubism.live2d.com`, `api.airi.build`, GitHub releases (postinstalls de `onnxruntime-node` e `sharp`) dão ECONNRESET / `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. `pnpm install` só foi concluído com `--ignore-scripts`.
- **Build dos apps Stage:** bloqueado pelos downloads de `dist.ayaka.moe` (item 4). Só pacotes de biblioteca (incl. `@proj-airi/audio`, `@proj-airi/pipelines-audio`) buildam.
- **Testes de navegador (playwright/vitest browser):** não rodam no sandbox headless (sem tela/navegador). Exit 1 do vitest vem daqui, não de falhas de teste.
- **Eletrão 43.4.1:** sem `dist/` nem cache local; porta de Eletrão é **Windows-only** (conforme registros anteriores). Requer Windows para validar.
- **Reprodutibilidade:** **não declarada**. Não foi demonstrada em ambiente limpo.

O que ainda requer Windows: validação do runtime Eletrão e, possivelmente, downloads de `dist.ayaka.moe`/`cubism.live2d.com` de uma rede sem o bloqueio de TLS deste sandbox.

---

## Conclusão

Correções isoladas aplicadas e verificadas: lint alvo (0 erros nos 7 arquivos), testes stage-ui (1153/1153 passam), rejeição não tratada de `updateCredits` corrigida. Build de bibliotecas concluído; apps Stage bloqueados por dependência de rede externa (`dist.ayaka.moe`) que não está disponível neste sandbox. Ativos de `lia/assets/` inventariados com hash; licenças não avaliadas — nenhum ativo removido ou redistribuído. Build não declarado reprodutível.
