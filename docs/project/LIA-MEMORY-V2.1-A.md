# Lia Memory V2.1-A

Base publicada `f89447f5`. O checkout original em `72c44425` estava um
commit atrás de `origin/main`, com nove arquivos modificados, dois novos e
índice limpo. A implementação usou um worktree isolado. O material anterior
da V2 permaneceu no checkout original.

## Escopo e recuperação

O Stage permite criar uma conversa em um projeto novo. O Main gera o UUID
do projeto a partir da ação explícita e liga a conversa ao projeto no
histórico. Novas conversas no projeto ativo herdam seu UUID. O nome só é
um rótulo. Selecionar outra conversa muda a referência do Main.

Ao criar uma nota, a pessoa escolhe Global, Projeto atual ou Conversa atual.
O Main resolve o escopo pela conversa ativa e rejeita operações de edição
ou remoção com ID fora do contexto visível. O Renderer seleciona a categoria
de escopo e informa a conversa que estava vendo para detectar troca de
contexto. Ele não informa o UUID do projeto nem injeta escopos nas notas.

A recuperação lexical filtra primeiro pelo escopo e pela expiração. Um
turno só pode receber notas globais, notas do seu projeto e notas de sua
conversa. Sem um contexto ativo legível, são elegíveis apenas as globais.
O opt-in e o limite de quatro notas, 100 registros e 500 caracteres por
nota continuam valendo. A memória permanece restrita ao chat local e
chega no turno de usuário como dados, sem autoridade de sistema ou de
permissão. Notas semelhantes de escopos distintos não se sobrescrevem.
Não há consolidação automática de conflitos nem escrita automática.

## Persistência e compatibilidade

O formato v1 sem escopo continua legível e suas notas são globais.
Sua identificação, conteúdo, metadados e expiração são preservados.
A primeira escrita de escopo restrito publica o formato v2 de forma
atômica. Escopos malformados ou inseridos em v1 fazem a leitura falhar
sem sobrescrita. Binários anteriores recusam v2 em vez de interpretar
notas privadas como globais. A exportação explícita com diálogo do Main
mantém o perfil inteiro e seus escopos. A limpeza confirmada abrange o
perfil inteiro. A lista do Stage apresenta as notas do contexto atual.

Conversas existentes seguem sem projeto. Uma nota ligada a uma conversa
excluída perde sua rota de recuperação, mas continua no arquivo até a
limpeza explícita e aparece no export. O escopo é uma fronteira de
contextualização do perfil, sem separação de contas do Windows.

## Evidência

A especificação Memory V2 e o conjunto anterior de 20 cenários não foram
localizados no checkout publicado. Os testes reutilizam o contrato e os
fixtures do Core e do Stage publicados.

- PASS automatizado. 11 testes focados de memória e histórico, 58 do Stage,
  build, typecheck, lint e checagem de diff.
- PASS Electron Windows. O gate `check-native-history.mjs` criou dois projetos
  e duas conversas no mesmo projeto, confirmou notas globais e verificou
  a ausência de notas do contexto anterior nas requisições ao serviço.
  Também confirmou reabertura, edição, expiração, exclusão e exportação v2.
- O serviço de chat foi HTTP local sintético. A persistência e o aplicativo
  foram reais. As respostas aos diálogos foram injetadas. Evidências em
  `J:/lia-evidence/memory-v21a/final-report.json` e
  `J:/lia-evidence/memory-v21a/final-memory-scopes.png`.

Arquivos. Contrato, persistência, recuperação e testes em `lia/core`.
Contexto e canais do Stage em `lia/stage/src/main` e `lia/stage/src/preload`.
Controles e traduções em `lia/stage/src/renderer` e `lia/stage/src/shared`.
Gate em `lia/desktop/scripts/check-native-history.mjs`.

O leitor Markdown externo é um incremento separado.
