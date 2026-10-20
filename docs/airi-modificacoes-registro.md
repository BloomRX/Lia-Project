# Registro das modificações feitas no AIRI vendado

**Atualização local — 20/10/2026:** o patch Node da seção 4 já existe no checkout,
com correções posteriores; não o reaplicar. Nesta rodada, a abertura do Stage e
o encerramento passaram no Windows real. O manager também recebeu tratamento
de rejeição inesperada do pré-requisito, com regressão e retry. A descrição de
trabalho perdido abaixo é histórica. Também foram corrigidos o restauro de
seleção local em `packages/stage-ui/src/stores/chat/session-store.ts` e o falso
sucesso de stream vazio em `packages/core-agent/src/runtime/chat-orchestrator-runtime.ts`.
O preflight M3.1 declara `maxImagesPerRequest` no modelo de Lia Core e aplica
a recusa no adaptador Stage, contando também histórico elegível. Retry antigo
sem ID passa pela autoridade antes de reenviar, preservando seu alvo por índice.
Nenhum patch Node foi reaplicado; Persona, credenciais, STT/TTS e política de
fallback de produção foram preservados.
São diffs pequenos sobre o runtime compartilhado, com regressões; preservar
na próxima atualização upstream. Evidências e limites em
[`product/RELEASE-WINDOWS-2026-10-20.md`](product/RELEASE-WINDOWS-2026-10-20.md).

> **Para que serve este arquivo.** O diretório `airi/` é uma cópia do projeto
> upstream [`moeru-ai/airi`](https://github.com/moeru-ai/airi) com trabalho da
> Lia aplicado por cima. Se um dia for preciso re-clonar o AIRI do zero, este
> documento diz **exatamente o que precisa ser reaplicado** e o que pode ser
> simplesmente recopiado, para que a investigação "quebrou no AIRI ou na Lia?"
> não comece do zero.
>
> Gerado em 2026-10-16 a partir do estado real do repositório na branch
> `arena/01a10290-lia-project`, HEAD `0ade8973e9028e306c51bf848fd0747bb0af40c3`.

---

## 1. Proveniência

| Item | Valor | Como foi verificado |
|---|---|---|
| Upstream | `moeru-ai/airi` | links no `airi/README.md` |
| Versão vendada | `0.12.0-beta.5` | `airi/package.json` |
| Release citada no README | `v0.11.3` | badge de download no `airi/README.md` |
| Commits da branch que tocaram `airi/` | **17 de 45** | `git log --oneline db99c70..HEAD -- airi/` |
| Volume total da diferença | **76 arquivos, +10438 / −272** | `git diff --stat db99c70..HEAD -- airi/` |

> A versão do `package.json` (`0.12.0-beta.5`) e a release do badge (`v0.11.3`)
> **não coincidem**. Não há no repositório nenhum registro do commit exato do
> upstream de onde a cópia foi feita. Se o re-clone for feito, esse commit precisa
> ser decidido e registrado aqui — hoje ele é desconhecido.

---

## 2. Classificação de risco (o que importa para um re-clone)

A existência no upstream foi verificada pela API do GitHub
(`repos/moeru-ai/airi/contents/...`), **não** por inspeção local.

### 2.1 Risco ZERO — não existem no upstream

Verificado: `apps/lia-app` e `packages/lia-core` **não existem** em
`moeru-ai/airi`. São criação integral da Lia.

- `airi/apps/lia-app/**`
- `airi/packages/lia-core/**`

Num re-clone do AIRI, esses diretórios não são tocados: basta recopiá-los.

### 2.2 Risco ZERO — nossos, dentro de pacote upstream

O pacote `stage-tamagotchi` existe no upstream, mas as pastas abaixo **não**:

| Caminho | Evidência |
|---|---|
| `apps/stage-tamagotchi/src/renderer/services/**` | o diretório `services` **não existe** no upstream (HTTP 404) |
| `apps/stage-tamagotchi/src/renderer/stores/lia/**` | ausente da listagem upstream de `stores/` |
| `apps/stage-tamagotchi/src/main/services/lia/**` | upstream tem apenas `airi/` e `electron/` |

Também são nossos, embora o pacote seja upstream: os módulos **novos**
(status `A` no git) em `core-agent` e `stage-ui` — por exemplo
`core-agent/src/messages/provider-context.ts`,
`stage-ui/src/stores/chat/provider-context.ts` e
`stage-ui/src/stores/chat/retry-content.ts`.

### 2.3 RISCO REAL — arquivos upstream que nós modificamos

**Estes 13 arquivos são a lista de reaplicação.** São os únicos pontos onde o
trabalho da Lia se mistura a código do AIRI. Total: **+311 / −53 linhas** —
intervenção cirúrgica, não um fork.

| # | Arquivo | Δ |
|---|---|---|
| 1 | `airi/apps/stage-tamagotchi/package.json` | 4 |
| 2 | `airi/apps/stage-tamagotchi/src/main/index.ts` | +11 |
| 3 | `airi/apps/stage-tamagotchi/src/main/windows/main/index.ts` | +17 |
| 4 | `airi/apps/stage-tamagotchi/src/renderer/App.vue` | +10 |
| 5 | `airi/apps/stage-tamagotchi/src/renderer/components/InteractiveArea.vue` | 25 |
| 6 | `airi/apps/stage-tamagotchi/src/renderer/main.ts` | +13 |
| 7 | `airi/apps/stage-tamagotchi/src/renderer/pages/index.vue` | 55 |
| 8 | `airi/apps/stage-tamagotchi/src/shared/eventa/index.ts` | +34 |
| 9 | `airi/packages/core-agent/src/index.ts` | +8 |
| 10 | `airi/packages/core-agent/src/messages/index.ts` | +8 |
| 11 | `airi/packages/core-agent/src/runtime/chat-orchestrator-runtime.ts` | 13 |
| 12 | `airi/packages/core-agent/src/types/chat.ts` | +12 |
| 13 | `airi/packages/stage-ui/src/stores/chat.ts` | 154 |

O padrão é consistente: a Lia **acrescenta módulos próprios** e os **liga** nos
pontos de entrada do upstream (`index.ts`, `chat.ts`, `main.ts`, `App.vue`).
Quase toda a diferença é aditiva; o único arquivo com reescrita substancial é
`packages/stage-ui/src/stores/chat.ts`.

### 2.4 O que este registro NÃO classifica

A verificação upstream foi feita **por diretório**, não arquivo a arquivo. Os
arquivos de teste com nome da Lia que aparecem como "modificados" em relação ao
`main` deste repositório — `InteractiveArea.retry.test.ts`,
`index.voice-authority.test.ts`, `chat.retry.test.ts`, `session-store.test.ts`,
`llm-service.test.ts`, `chat-orchestrator-runtime.test.ts` — **não tiveram sua
existência no upstream verificada individualmente**. "Modificado em relação ao
`main`" não é a mesma coisa que "existe no upstream": o `main` já contém trabalho
anterior da Lia.

---

## 3. Correções de portabilidade Windows aplicadas nesta série

Todas em `airi/apps/lia-app/src/main/` — portanto dentro da área de **risco zero**
da seção 2.1. Nenhuma tocou código upstream.

| Commit | O que fez |
|---|---|
| `c40d750` | `fixtureEnv` passou a fornecer `LOCALAPPDATA`; `lia-host.test.ts` deixou de comparar com barra fixa; `voice-engine-service.test.ts` deixou de esperar literal POSIX |
| `16d5424` | removeu o `USERPROFILE` do fixture (regressão que ele próprio introduziu) e tornou `runtime-location.test.ts` independente de POSIX |
| `0ade897` | as duas asserções que dependem de `chmod(0o500)` viram `ctx.skip()` explícito no Windows |

Causas, em uma linha cada:

1. `fixtureEnv` devolvia só `APPDATA`, mas `resolveVoiceRuntimeHome` no win32 lê
   `LOCALAPPDATA` e **lança** sem ele. `envLookup` é `env[name]` puro, sem
   fallback. A aritmética fechou com o log: 5 dos 7 testes de `runtime-location`
   chamam `runtimeLocationStatus()`; os 2 que passam nunca o chamam.
2. Comparações com separador fixo (`startsWith(\`${dir}/\`)`) e literais
   `join('/tmp', …)`, que no Windows são recusados pelo validador de caminho.
3. `chmod(0o500)` não impede escrita no Windows, então a premissa "a gravação
   canônica falhou" não pode ser criada lá. **Cobertura declarada como
   inexistente no Windows**, não convertida em PASS.

Decisão do dono registrada: **manter `/` como forma canônica em
`lia-product.json`**. `lexicalNormalize` (`packages/lia-core/src/paths/install-location.ts:77`)
não foi alterado, e a convenção já é fixada por teste em
`packages/lia-core/src/paths/install-location.test.ts:13`.

---

## 4. ⚠ Trabalho PERDIDO — precisa ser refeito

A correção do pré-requisito de build do Stage foi implementada, testada e
**não commitada** (por instrução explícita de não commitar). O sandbox foi
reprovisionado e destruiu o clone junto com os backups. **Esse trabalho não
existe mais em lugar nenhum.**

O que estava pronto, com resultado medido na época:

- `vitest` lia-app: **238 passed | 2 skipped** (23 arquivos)
- `moeru-lint` nos 6 arquivos: **0 warnings, 0 errors**
- `pnpm --filter @proj-airi/core-agent build` após `rm -rf dist`: **exit 0**, 2,293 s
- **3 mutações aplicadas e detectadas** pelos testes certos

### Causa raiz (confirmada por árvore de processos real no Windows)

`stage-build-prerequisite.ts` e `airi-stage-manager.ts` usavam `process.execPath`
como se fosse Node. Como `src/main/*` roda no **processo principal do Electron**
(`main: ./out/main/index.js`, lançado por `electron-vite dev`), `process.execPath`
é o **executável do Electron**. Evidência do dono: PID `85772` `electron.exe`
(principal da Lia) → filho PID `83592` `electron.exe` executando
`...\tsdown\dist\run.mjs`, com processos auxiliares de GPU e rede.

Sem `ELECTRON_RUN_AS_NODE` — que a documentação do Electron descreve como o que
"inicia o processo como um processo Node.js normal" — o binário inicia um **app**
Electron, cujo ciclo de vida é governado pelo app e não pelo esgotamento do event
loop. O build rodava e o filho **nunca saía**; o callback do `execFile` nunca
disparava; o pré-requisito ficava em `starting` sem marcador terminal. E como o
gerenciador faz `await prerequisite.run()` **antes** do spawn, os marcadores do
Stage também não apareciam: **uma causa, dois sintomas**.

### Estratégia que estava implementada

Módulo novo `node-runtime.ts` com `resolveNodeInvocation({ childLaunchesElectron, execPath, versions, env, platform, existsImpl })`:

1. **Não é Electron** (`process.versions.electron` ausente) → `process.execPath`.
2. **É Electron** → procura um `node`/`node.exe` real varrendo `PATH` pelo
   `delimiter` e testando cada candidato com `existsSync`. Sem shell, sem
   PATHEXT, sem caminho absoluto da máquina.
3. **Sem Node no PATH** e o filho **não** lança Electron (o `tsdown`) → fallback
   `process.execPath` + `ELECTRON_RUN_AS_NODE=1`, com o env do pai **espalhado,
   não substituído** (o build precisa de `PATH`).
4. **Sem Node no PATH** e o filho **lança** Electron (o `electron-vite`) →
   `unavailable`, e o gerenciador **recusa o spawn** com `phase: 'error'` e log
   `stage-runtime state=unavailable reason=…`.

A assimetria entre 3 e 4 é o cerne e não pode ser "simplificada":
`electron-vite` lança a janela com `spawn(electronPath, [entry], { stdio: 'inherit' })`
— **sem `env`** — então o ambiente do filho chega ao Electron verbatim, e um
`ELECTRON_RUN_AS_NODE` vazado faria a **janela** iniciar como Node: nenhuma
janela abriria.

Também fazia parte: o log de spawn deixou de imprimir a palavra fixa `"node"` e
passou a imprimir `basename(runtime.command)` — era por isso que os logs do
Windows nunca revelaram o executável real.

### Arquivos envolvidos (a recriar)

| Arquivo | Estado anterior |
|---|---|
| `airi/apps/lia-app/src/main/node-runtime.ts` | **novo** — a estratégia |
| `airi/apps/lia-app/src/main/node-runtime.test.ts` | **novo** — 5 testes da decisão |
| `airi/apps/lia-app/src/main/stage-build-prerequisite.ts` | consome a decisão |
| `airi/apps/lia-app/src/main/stage-build-prerequisite.test.ts` | +3 testes |
| `airi/apps/lia-app/src/main/airi-stage-manager.ts` | consome a decisão + falha fechada |
| `airi/apps/lia-app/src/main/airi-stage-manager.test.ts` | +2 testes |

---

## 5. Como reaplicar depois de um re-clone do AIRI

1. Recopiar `airi/apps/lia-app/` e `airi/packages/lia-core/` inteiros (seção 2.1).
2. Recopiar os módulos novos da seção 2.2 (`services/lia/**`, `stores/lia/**`,
   `provider-context.ts`, `retry-content.ts` e afins).
3. **Reaplicar à mão os 13 arquivos da seção 2.3.** São +311/−53 linhas; o único
   que exige atenção real é `packages/stage-ui/src/stores/chat.ts` (154 linhas).
4. Registrar neste arquivo o commit exato do upstream usado no re-clone.
5. Refazer o trabalho perdido da seção 4.

---

## 6. O que NÃO foi verificado

- **Nenhum comportamento foi observado em Electron neste ambiente.** O binário do
  Electron não é baixável no sandbox (o download redireciona para
  `release-assets.githubusercontent.com`, fora da allowlist). As conclusões sobre
  `process.execPath` vêm da documentação oficial do Electron, do
  `node_modules/electron/cli.js`, do precedente no próprio `electron-vite`
  (`spawn(electronPath, [script], { env: { ELECTRON_RUN_AS_NODE: '1' } })`) e da
  **árvore de processos coletada pelo dono** — não de medição local.
- **A inicialização visual do Stage nunca foi observada** nesta série de rodadas.
  M3.0b permanece incompleto até haver os marcadores ordenados de runtime e a
  confirmação do dono de que a personagem apareceu normalmente.
- A existência upstream dos arquivos de teste listados na seção 2.4.
- O commit exato do upstream de onde `airi/` foi copiado.
