# Estratégia de branches e workspaces

## Branches
- `main`: linha oficial do produto e referência para releases aprovadas.
- `lia/development`: branch principal de desenvolvimento, foco do Codex no workspace Windows.
- `arena/01a10290-lia-project`: branch vinculada à sessão Arena já existente; preservar enquanto a sessão estiver ativa.
- `agents/docs`: esta base documental enxuta para pesquisa e descoberta.
- `arena/*`: branches próprias de cada sessão Arena adicional.
- `qa/*`: branches de validação, quando necessárias.
- Outras branches existentes devem ser preservadas até revisão explícita.

## Regras de propriedade
- Cada sessão Arena só escreve na própria branch vinculada. Pode inspecionar outras refs em modo somente leitura, mas não pode editar ou publicar nelas.
- Codex trabalha prioritariamente em `lia/development` no workspace local que contém o repositório completo e todas as refs necessárias.
- Arena pode implementar em sua própria branch quando isso for explicitamente delegado. Codex integra depois por revisão, cherry-pick ou PR.
- Nunca deixar Arena e Codex editar simultaneamente os mesmos arquivos ou compartilhar uma branch ativa.
- A sessão Arena antiga não deve ser renomeada nem apagada enquanto estiver vinculada a `arena/01a10290-lia-project`.
- `main` não recebe integração automática de desenvolvimento; somente mudanças aprovadas pelo gate.

## Fluxo de integração
1. Confirmar branch e SHA de origem.
2. Definir um único responsável de escrita por tarefa/arquivos.
3. Agente conclui, testa, documenta e publica na própria branch.
4. Codex atualiza refs, revisa diff e integra em `lia/development`.
5. Executar testes adequados no Windows e gates pertinentes.
6. Só depois propor promoção para `main`.

## Workspace Windows
O workspace local planejado é `Lia-Project_workspace`, contendo o clone completo do repositório, não apenas a branch atual. Codex deve consultar `git branch -a`, atualizar refs com fetch e trabalhar na branch explícita. A criação desse diretório local é uma ação a executar no PC do usuário; não foi realizada por esta branch.
