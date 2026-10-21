# Rodada Windows — 21/10/2026

## Estado inicial

Host Windows LUCASPC; Node 26.8.1, Python 3.14.7, pnpm 11.24.0.
Branch `arena/01a10290-lia-project`, HEAD inicial `20b9da7`, árvore limpa e
referência local de origin no mesmo commit. Nenhum merge, push ou nova branch.
Baseline funcional permanece `3ef6d11`; release incompleta.

O checkout contém mudanças feitas após a rodada anterior: limpeza resiliente
de fixtures, evidência de cinco execuções Python com exit 0, skills e teste de
contrato de espaços. Esse último passa com o código original: a hipótese de
`trim()` não explica o caso exercitado. Nenhuma correção especulativa aplicada.

## Preflight executado

Todos os comandos abaixo terminaram com exit 0 nesta rodada:

| Diretório | Comando | Resultado |
| --- | --- | --- |
| `airi` | `corepack pnpm install --ignore-scripts` | PASS automatizado |
| `airi` | `corepack pnpm --filter @lia/core run build` | PASS automatizado |
| `airi` | `corepack pnpm --filter @proj-airi/server-shared run build` | PASS automatizado |
| `airi` | `corepack pnpm --filter "@proj-airi/core-agent..." run build` | PASS automatizado |
| `tools` | `python3 -m unittest discover -s . -p "test_*.py" -t .` | PASS automatizado: 495 casos, 10 skips, 316,8 s |
| raiz | `node --test "Tests/tools/*.test.mjs"` | PASS automatizado: 267 testes |
| `airi/apps/lia-app` | `../../node_modules/.bin/vitest run` | PASS automatizado: 247 testes, 2 skips |
| `airi` | `./node_modules/.bin/vitest run --root packages/core-agent --project @proj-airi/core-agent` | PASS automatizado: 144 testes |

Corepack foi invocado pelo shim existente em
`%LOCALAPPDATA%/Lia-DevTools/node_modules/.bin/corepack.cmd`.
Logs locais ignorados: `Tests/runs/release-20261019/preflight-21-*.log`.
Isso confirma a execução atual; não identifica retroativamente o detentor dos
locks WinError 32 antigos. O gate visual de conteúdo de imagem continua aberto.

## Organização solicitada pelo Dev

- Fixtures Python agora são criadas em `Tests/tmp/`, fora da raiz.
- WAVs do smoke avulso e staging de benchmark usam `Tests/artifacts/`.
- Inventário reconhece os novos diretórios e continua reconhecendo o legado.
- `.gitignore` e `Tests/README.md` documentam os destinos.
- `TemporaryDirectory.cleanup()` é chamado após a remoção bem-sucedida para
  encerrar seu ciclo de vida e evitar avisos de finalização implícita.
- As 14 pastas antigas `.devkit-tests-*` continham apenas diretórios vazios e
  foram movidas para `Tests/tmp/legacy-20261021/`.
- Os 157 arquivos de `.devkit-qa` foram movidos para `Tests/artifacts/` com
  caminhos relativos preservados; todos os SHA-256 conferiram após a mudança.
  Manifesto local: `Tests/inventory/root-organization-20261021.json`.

Não foram movidos runtimes, dados/configurações do usuário, código ou metadados
Git. A resolução histórica de staging não-Windows do smoke permanece igual;
a mudança de saída não altera o runtime de voz. Os scripts `.bat` permanecem
intactos. A revisão automática bloqueou o primeiro comando que incluía remoção
de diretórios vazios; foram usadas apenas movimentações reversíveis.

Regressões antes da correção: localização real da fixture Python falhou porque
seu pai era a raiz; contrato do smoke falhou porque ainda usava `.devkit-qa`.
Depois: 4 testes dirigidos Python e 48 Node PASS, ambos exit 0.
Logs: `cleanup-location-{red,green}-{python,node}.log` no diretório da rodada.

Validação final do item (mesmos comandos do preflight): Python **496 casos,
10 skips, 290,5 s**, Node **267 testes** e Launcher **247 testes/2 skips**:
PASS automatizado, exit 0 em todos. Logs `organization-{python,node,launcher}.log`.
Nenhum ResourceWarning no log Python final; nenhuma fixture nova permaneceu
em `Tests/tmp` e nenhum `.devkit-*` reapareceu na raiz.

Lint: `moeru-lint` com os seis caminhos absolutos `.mjs` alterados foi executado
de `airi`, exit 2: ESLint 10.9.0 não encontrou `eslint.config.*` para ferramentas
da raiz, além de avisos preexistentes. **BLOCKED por configuração**, não PASS.
A tentativa com caminhos `../` foi recusada pelo CLI antes da análise. Log:
`organization-lint.log`. Não foi criado um config permissivo para ocultar dívida.

## Gates e limitações

- PASS Windows real: Launcher abriu pelo `Lia.bat` original; botão Conversar
  iniciou build e spawn Node. Build do pré-requisito: 3,164 s.
- NOT RUN nesta retomada: gate visual completo de imagem/texto, microfone,
  ferramentas reais, presença Livre/multi-monitor e instalador.
- O ensaio de UI foi interrompido para atender à organização solicitada.
- PASS Windows real: encerramento gerenciado em 740 ms às `23:54:39Z`,
  saída 0 do Launcher e nenhum Electron do checkout remanescente.
- O erro de geometria e a perda de espaço observados na rodada anterior seguem
  abertos; não há evidência nova suficiente para reclassificá-los.

DoD de produto e inventário visual permanecem no
[relatório anterior](RELEASE-WINDOWS-2026-10-20.md). Esta rodada não aprova release.

Arquivos do item de organização: `.gitignore`, `Tests/README.md`,
`Tests/tools/kokoro-smoke-seam.test.mjs`, `Tests/tools/qa-benchmark.mjs`,
`Tests/tools/qa-benchmark-lib.mjs`, `Tests/tools/qa-benchmark-integration.test.mjs`,
`Tests/tools/qa-storage.mjs`, `tools/kokoro-smoke.mjs`, `tools/project_cli.py`,
`tools/test_project_cli.py` e os documentos de estado/relatório desta rodada.
Contagem de referência atualizada em `.agents/skills/lia-test-discipline/SKILL.md`.
Não houve alteração de código do app neste item.
