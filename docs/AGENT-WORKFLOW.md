# Fluxo de trabalho para agentes

## Modalidades
### RESEARCH — base `agents/docs`
Pesquisa de projetos, bibliotecas, modelos, addons, licenças e alternativas. Sem implementação. A saída é relatório e recomendação.

### AUDIT — base `lia/development` ou SHA indicado
Inspeção de código, arquitetura, segurança, testes ou UX. Sem alterar código, salvo autorização explícita. Relatar evidências com caminhos, linhas, comandos e limitações.

### IMPLEMENTATION — base `lia/development` (Codex) ou branch Arena própria
Implementação delimitada. Um único agente por arquivo/escopo simultaneamente. Antes de editar, verificar branch, HEAD, status e alterações preexistentes.

## Brief obrigatório
- Objetivo e resultado esperado.
- Modalidade e branch/SHA base.
- Escopo incluído e excluído.
- Arquivos/áreas com propriedade de escrita.
- Critérios de aceite.
- Testes e evidências exigidos.
- Dependências e riscos.
- Política de commit/push.

## Segurança Git
- Inspecionar `git status --short`, `git branch --show-current`, `git rev-parse HEAD` e upstream antes de agir.
- Preservar alterações locais e arquivos não rastreados.
- Não usar `reset --hard`, `clean`, `stash`, force-push ou `git add -A`.
- Stage apenas arquivos do escopo.
- Não mudar de branch em sessão Arena.
- Não afirmar que testes passaram sem comando e saída verificáveis.
- Nunca incluir `tools/stt-bench/RX580-GPU-FEASIBILITY.md` em commits; preservá-lo intocado.

## Handoff
Entregar resumo, commits/SHA, arquivos alterados, testes executados e resultados, evidências, limitações, riscos, itens não feitos e instrução de integração. Não declarar tarefa concluída se houver trabalho não commitado sem explicar.
