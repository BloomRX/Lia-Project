---
name: lia-safe-change
description: Protege o trabalho existente ao implementar mudanças na Lia. Use antes de editar código, reorganizar arquivos, integrar dependências ou continuar uma tarefa iniciada por outro agente.
---

# Mudanças seguras na Lia

## 1. Establish the baseline before editing

1. Leia `AGENTS.md` e, seções relevantes, `docs/project/CURRENT-STATE.md` e `docs/project/QUANTO-FALTA.md`.
2. Confirme branch, HEAD e estado do Git: `git status --short --branch`, `git rev-parse HEAD` e `git diff --stat`.
3. Inspecione mudanças staged, unstaged e arquivos untracked antes de tocar em qualquer coisa.
4. Se o checkout ou os documentos contradisserem a tarefa, pare e reporte a divergência.

## 2. Preservar o trabalho alheio

- Nunca use `git reset --hard`, `git clean -fd`, `git checkout -- .` ou `git restore .` para limpar o checkout.
- Não sobrescreva, descarte, reformate em massa ou mova mudanças que não pertencem claramente à tarefa atual.
- Não troque de branch nem faça rebase/merge sem autorização.
- Prefira alterações pequenas, focadas e reversíveis. Não misture refatoração oportunista com correção funcional.
- Antes de alterar arquivo já modificado, entenda o diff e preserve as partes existentes.

## 3. Planejar a mudança

Antes de editar, declare internamente o objetivo, os arquivos necessários, o comportamento esperado e o teste que demonstrará sucesso. Leia o código e os testes reais; não deduza a arquitetura apenas pelo nome de um arquivo.

Não instale dependências, altere lockfiles, baixe runtimes, mude credenciais, publique releases ou faça push além do escopo autorizado. Se um recurso ou acesso for necessário, explique o motivo e pare antes da ação externa não autorizada.

## 4. Provar a correção

- Reproduza o defeito antes da correção quando aplicável.
- Crie ou atualize um teste que observe o comportamento real, não apenas chamadas a mocks.
- Rode a suíte correta descrita em `.agents/skills/lia-test-discipline/SKILL.md`.
- Para mudanças no AIRI, leia também as skills relevantes em `airi/.agents/skills/`.
- Diferencie PASS, FAIL, BLOCKED e NOT RUN. Nunca apresente algo não executado como aprovado.
- Não alegue que o app funciona apenas porque build, lint ou testes unitários passaram.

## 5. Encerramento

Informe arquivos alterados, razão, comandos executados, códigos de saída, resultados, limitações e próximos passos. Não faça commit ou push, a menos que a tarefa peça explicitamente. Se houver risco de perda de trabalho, falta de acesso ou falha não explicada, STOP AND REPORT.
