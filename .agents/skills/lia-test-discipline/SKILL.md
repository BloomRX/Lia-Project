---
name: lia-test-discipline
description: Localiza e executa a suite certa da Lia entre as quatro existentes (Python tools/, Node Tests/tools, vitest lia-app, vitest core-agent), com o diretorio correto e o rebuild necessario. Use antes de rodar testes, ao escrever ou mover um teste, ao ver "Ran 0 tests", "Cannot find package" ou um teste que nao roda no CI.
compatibility: Exige Node, pnpm e Python. As suites vitest exigem airi/node_modules instalado.
---

# Testes na Lia

O repositório tem **quatro** suítes independentes, em quatro linguagens de
execução diferentes. Rodar a errada devolve verde que não prova nada.

## 1. Qual suíte, de onde, com qual comando

| Alvo | Diretório | Comando |
| --- | --- | --- |
| Suíte Python | `tools/` | `python -m unittest discover -s . -p "test_*.py" -t .` |
| Harness de QA | raiz | `node --test "Tests/tools/*.test.mjs"` |
| App Lia | `airi/apps/lia-app/` | `pnpm run test` |
| Pacote core-agent | `airi/` | `pnpm exec vitest run --root packages/core-agent --project @proj-airi/core-agent` |

Números de referência: Python **496** casos (4 arquivos), Node **267**
(14 arquivos), `lia-app` **23** arquivos de teste, `core-agent` **13** arquivos
/ **144** casos. Se a contagem cair sem que testes tenham sido removidos de
propósito, algo deixou de ser descoberto.

## 2. As quatro armadilhas que já custaram rodadas

1. **A suíte Python roda de `tools/`.** Da raiz o `discover` **não falha**:
   imprime `Ran 0 tests in 0.000s` seguido de `OK` e sai com **código 0**.
   É um **falso verde** — mais perigoso que um erro, porque parece aprovação.
   Se você vir `Ran 0 tests`, o diretório está errado: `cd tools` primeiro.
2. **`node --test` precisa do glob entre aspas.** `node --test Tests/tools`
   (diretório) ou sem aspas não descobre `.mjs` e termina em
   `MODULE_NOT_FOUND`. O comando certo é `node --test "Tests/tools/*.test.mjs"`.
3. **`pnpm install --ignore-scripts` deixa os pacotes do workspace sem build.**
   Antes de qualquer vitest, na ordem:
   `pnpm install --ignore-scripts` → `--filter @lia/core run build` →
   `--filter @proj-airi/server-shared run build` →
   `--filter "@proj-airi/core-agent..." run build`.
   Sintoma quando falta: `Cannot find package '@proj-airi/core-agent'`.
4. **O CI não roda `discover`.** `.github/workflows/devflow-ci.yml` enumera
   arquivos: `test_project_cli.py`, `test_creation.py`, `test_lia_dev.py`,
   `test_agent_skills.py`. **Um teste novo em `tools/` que não for adicionado a
   esse arquivo nunca roda no CI** — passa localmente e morre em silêncio.

## 3. Onde estão as regras de teste do AIRI

`airi/apps/lia-app` e `airi/packages/lia-core` são código da Lia dentro da
árvore do AIRI, então valem as regras do upstream — e elas **não** são
descobertas quando o agente trabalha a partir da raiz.

Antes de escrever teste em `airi/`, leia:

- `airi/.agents/skills/enforce-rules-for-vitest/SKILL.md` — escopo do projeto
  vitest, reprodução antes da correção, mock de IPC/serviços sem Electron real
- `airi/.agents/skills/vue-testing-best-practices/SKILL.md` — se o alvo for
  componente Vue

Se o agente estiver rodando com CWD na raiz, esses arquivos precisam ser lidos
**pelo caminho**, porque o Codex só descobre `.agents/skills` do CWD para cima.

## 4. Exigência mínima de um teste novo

- Falha **antes** da correção, pelo motivo certo — não por import quebrado,
  nome errado ou campo vazio.
- Prova o comportamento, não que a função foi chamada: asserção sobre a saída
  observável. Um teste que só confirma "o mock foi invocado" passa mesmo se a
  lógica estiver errada.
- Determinístico nas duas plataformas. Se depender de permissão POSIX
  (`chmod`), o teste correto é condicionado com skip explícito — nunca pular a
  suíte inteira.
- Nada de `sleep`, `sh`, `kill`, PowerShell ou WMIC dentro de teste.

## 5. Cobertura e buracos

`pnpm run test` na raiz de `airi/` roda `vitest --coverage`. Use para achar
área descoberta, não para perseguir percentual: cobertura alta com asserção
fraca não vale nada.

Buracos conhecidos e aceitos hoje: não há auditoria de dependências no CI, e as
suítes Node/vitest **não** rodam no `devflow-ci.yml` — ele cobre só Python.

## 6. Teste instável

Instável não é "verde na próxima". Registre `N de M`, preserve a saída das
falhas, e aplique `lia-regression-investigation` §8. Nunca aumente timeout para
resolver e nunca engula exceção de limpeza.
