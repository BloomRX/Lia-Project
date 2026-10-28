---
name: lia-test-discipline
description: Localiza e executa a suíte certa da Lia entre Python tools/, Node Tests/tools, Vitest lia-app e Vitest core-agent. Use antes de testar ou ao investigar "Ran 0 tests" e "Cannot find package".
compatibility: Exige Node, pnpm e Python. Suítes Vitest exigem dependências do workspace instaladas.
---
# Testes na Lia
## 1. Suíte, diretório e comando
| Alvo | Diretório | Comando |
|---|---|---|
| Python | `tools/` | `python -m unittest discover -s . -p "test_*.py" -t .` |
| Harness QA | raiz | `node --test "Tests/tools/*.test.mjs"` |
| App Lia | `airi/apps/lia-app/` | `pnpm run test` |
| core-agent | `airi/` | `pnpm exec vitest run --root packages/core-agent --project @proj-airi/core-agent` |
As contagens documentadas podem ficar desatualizadas. Compare a descoberta real com a referência operacional atual antes de concluir que testes sumiram.
## 2. Armadilhas
- Python `discover` executado da raiz pode reportar zero testes e sair com código 0. Execute em `tools/`.
- Passe o glob Node entre aspas: `node --test "Tests/tools/*.test.mjs"`.
- `pnpm install --ignore-scripts` pode deixar pacotes de workspace sem build. Consulte scripts e dependências antes de rodar Vitest.
- O CI pode enumerar testes explicitamente. Confirme que novos testes entram no workflow real.
## 3. Skills complementares independentes
- `.agents/skills/lia-vue-testing/SKILL.md` para componentes Vue/composables.
- `.agents/skills/lia-regression-investigation/SKILL.md` para reproduções e hipóteses.
- `.agents/skills/lia-pnpm-workspaces/SKILL.md` para workspace e builds.
## 4. Qualidade do teste
- Para regressão, prove falha antes da correção pelo motivo certo.
- Teste saída observável, não só que uma função/mocK foi chamada.
- Mantenha testes determinísticos e multiplataforma; registre skips explícitos.
- Não use sleep, comandos de shell ou PowerShell dentro de testes unitários para controlar processos.
- Cobertura ajuda a localizar buracos, mas percentual alto com asserções fracas não prova qualidade.
## 5. Teste instável
Registre N de M, preserve saídas e use `lia-regression-investigation`. Não aumente timeout para mascarar a falha nem engula exceções de limpeza. Diferencie falha funcional, falha de limpeza e ambiente.
