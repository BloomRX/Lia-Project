# Lia Evolution Program V1

Base publicada da fundação cognitiva `58745748`. Execução na `main` do
Lia-Project. O plano de produto e a arquitetura cognitiva definem os limites.

| Meta | Estado | Próximo passo |
| --- | --- | --- |
| 02 Memory System | VALIDATED | Incremento local validado. Busca semântica depende de embeddings validados. |
| 03 Agent Hub Integration | NOT_STARTED | Comparar o consumidor atual com o contrato publicado do Hub. |
| 04 Decision & Autonomy | NOT_STARTED | Reaproveitar a política por turno e a confirmação no Main. |
| 05 Personality & Emotion | NOT_STARTED | Ligar estado simulado observável aos consumidores atuais. |
| 06 Perception & Action | NOT_STARTED | Selecionar um fluxo autorizado e verificável. |
| 07 Avatar & Presence | NOT_STARTED | Exercitar presença e reação com o VRM existente. |
| 08 Design Foundation | NOT_STARTED | Identificar os materiais oficiais aprovados. |

## Checkpoint

A inspeção confirmou que o Stage já utiliza uma memória local opt-in, com
gravação serializada, histórico separado e recuperação lexical na conversa.
O incremento validado reutiliza o arquivo e o IPC existentes. Os pontos
de alteração são `lia/core/src/memory`, a interface e o Main do Stage e o gate
`lia/desktop/scripts/check-native-history.mjs`.

A recuperação semântica exige um provedor de embeddings validado. Nenhum
serviço foi escolhido para esta etapa. Experiências rotuladas pela pessoa
mantêm origem declarada pela pessoa. O modelo não escreve memórias.

Meta 02. O arquivo v1 aceita notas antigas e metadados opcionais de tipo,
classificação, proveniência declarada, criação e expiração UTC. A expiração
interrompe a recuperação e mantém a entrada acessível para correção, exclusão
ou exportação. O Stage edita e exporta em JSON mediante diálogo do Main, para
um arquivo novo. A busca lexical entrega notas como dados no turno de usuário
e apenas à IA local. Binários antigos podem descartar metadados ao gravar.

Passaram 17 testes Node focados, build e typecheck do Stage, lint do desktop e
o gate `node lia/desktop/scripts/check-native-history.mjs` no Electron Windows.
O gate usou HTTP sintético, respostas de diálogos injetadas e confirmou
reabertura, recuperação, correção, expiração, exportação e exclusão. Evidência
local no diretório `lia-native-history-e3WVo7`.

Próxima ação concreta. Inspecionar o publicador v1 do Hub e identificar quais
contratos de seleção, tarefa, execução e auditabilidade já estão disponíveis.
