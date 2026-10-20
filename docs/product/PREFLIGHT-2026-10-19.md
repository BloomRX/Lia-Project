# Preflight de desenvolvimento — 19/10/2026

**Resultado: bloqueado antes do item A1 de `QUANTO-FALTA.md`.** Nenhuma mudança
de produto, gate Windows ou promoção de baseline. Branch de trabalho:
`arena/01a10290-lia-project`; revisão inicial: `9e47857`.

## Preparação e correções restritas aos testes

- Corepack não estava no PATH. A instalação global encontrou conflito com o
  pnpm existente; foi instalado em `%LOCALAPPDATA%/Lia-DevTools`, sem sobrescrever
  o pnpm. A instalação do workspace usou essa cópia e pnpm 11.24.0, versão
  declarada no projeto, com `--ignore-scripts`.
- `Tests/tools/qa-benchmark.test.mjs`: o fixture esperava UTC, mas
  `runTimestampId` usa os getters de horário local. O instante do fixture agora
  é construído no horário local. A implementação do identificador permanece igual.
- `tools/test_lia_dev.py`: o filho que simula saída Unicode do Vitest agora
  configura explicitamente stdout como UTF-8. Antes, falhava em cp1252 antes de
  imprimir a exceção que o teste pretendia verificar.

Os dois casos Python dirigidos (consistência da causa persistida e publicação de
peso staged) passaram no reteste com `PYTHONUTF8=1`. Depois da correção no
fixture, a consistência da causa também passou sem essa variável. O arquivo
Node corrigido passou seus 30 testes dirigidos; a suíte Node completa foi
reexecutada com sucesso.

## Verificações executadas

| Verificação | Resultado |
| --- | --- |
| `corepack pnpm install --ignore-scripts`, em `airi/` | concluída, pnpm 11.24.0 |
| `corepack pnpm --filter @lia/core run build`, em `airi/` | concluído |
| `corepack pnpm --filter @proj-airi/core-agent run build`, em `airi/` | concluído |
| `python3 -m unittest discover -s . -p "test_*.py" -t .`, em `tools/` | primeira execução: 487 casos, 3 falhas de subtestes, 1 erro, 10 skips; repetição: 487 casos, 2 erros, 10 skips |
| `node --test Tests/tools/*.test.mjs` | primeira execução: 266 aprovados, 1 falha; após correção, repetida com `--test-reporter=dot`: exit 0, 267 testes |
| `../../node_modules/.bin/vitest run`, em `airi/apps/lia-app/` | duas execuções: 246 aprovados, 2 skips |
| `moeru-lint` no arquivo Node tocado | não aprovado: caminho relativo com `..` recusado; caminho absoluto chega ao ESLint, que não encontra configuração para a raiz |
| ESLint com `airi/eslint.config.ts` explícito | não aprovado; 95 erros também reproduzidos na versão original do arquivo via `git show HEAD:Tests/tools/qa-benchmark.test.mjs` e stdin |
| `git diff --check` | sem problemas |

## Bloqueios observados

### Limpeza de fixtures Git no Windows

Na primeira execução, `GitFlowTests.test_staged_weight_is_not_silently_published`
falhou em `tearDown`, ao remover o diretório temporário `repo com espaços`:
`PermissionError: [WinError 32]`, com tentativas subsequentes retornando
`WinError 5`. O caso passou isoladamente.

Na repetição completa, o mesmo tipo de erro de limpeza ocorreu em:

- `GitFlowTests.test_first_push_and_skip_models_env_and_dependencies`;
- `GitFlowTests.test_missing_remote_branch_does_not_pull_main_instead`.

A mudança dos casos afetados confirma que o problema não ficou resolvido pelo
reteste isolado. **O processo que mantém o diretório aberto e a causa do lock
não foram identificados.** Não atribuir a antivírus, Git, Python ou indexação
sem medir. Não ignorar erros de limpeza nem aumentar timeout para obter verde.

### Aplicação do lint às ferramentas da raiz

Não existe configuração ESLint para `Tests/tools` na raiz. A configuração em
`airi/` é voltada ao workspace AIRI. Aplicá-la explicitamente ao teste Node gera,
entre outros, erros que exigem usar Vitest em vez de `node:test` e remover
extensões `.mjs` dos imports. A versão original também apresenta 95 erros, logo
essa dívida precede as correções desta rodada.

Resolver o escopo da configuração para as ferramentas nativas Node é trabalho
pendente; não migrar o runner, remover regras ou formatar todo o arquivo como
contorno dentro do item A1. O lint permanece **não aprovado**.

## Retomada

1. Identificar o detentor dos locks e resolver a limpeza dos fixtures Git.
2. Definir e validar a configuração de lint aplicável às ferramentas da raiz.
3. Repetir o preflight completo; só então iniciar A1, teste dirigido de failure
   behavior, sem modificar a política de fallback.

Os gates da seção B continuam pendentes. As mensagens PASS emitidas por fixtures
simulados dentro dos testes Python não constituem prova de runtime. Baseline
funcional permanece `3ef6d11618f787dae6d197645d440a5775a60ad6`.
