# Lia Evolution Program V1

Base publicada da fundação cognitiva `58745748`. Execução na `main` do
Lia-Project. O plano de produto e a arquitetura cognitiva definem os limites.

| Meta | Estado | Próximo passo |
| --- | --- | --- |
| 02 Memory System | VALIDATED | Incremento local validado. Busca semântica depende de embeddings validados. |
| 03 Agent Hub Integration | PARTIAL | Catálogo real validado. Delegação depende de um executor externo. |
| 04 Decision & Autonomy | VALIDATED | Responder, sugerir plano de relógio e executar mediante confirmação no Stage. |
| 05 Personality & Emotion | VALIDATED | Estado observado em chat, áudio e expressão VRM. |
| 06 Perception & Action | VALIDATED | Inspeção e cópia supervisionada de anexo. Demais fontes dependem de autorização específica. |
| 07 Avatar & Presence | VALIDATED | Reação no VRM, dois monitores e suspensão verificados. |
| 08 Design Foundation | PARTIAL | Tokens oficiais aplicados. Layouts e materiais de tela aguardam aprovação. |

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

## Meta 03 com catálogo validado

O checkout do Hub `fbf6351b` publica o catálogo ativo e declara que o Hub é
um registro. A implementação inspecionada não executa capacidades nem
fornece uma API de execução supervisionada. O lado consumidor pode descobrir,
filtrar e inspecionar capacidades por ID sem interpretar a prosa ou conceder
permissões com base no índice.

Solicitação de integração. Para delegação real, o responsável pelo executor
deve disponibilizar um contrato versionado com criação idempotente, identidade
da capacidade, aprovação e escopo, entradas mínimas tipadas, consulta de estado,
cancelamento, resultado limitado e identificador de auditoria. O índice v1
não deve ser usado como prova de execução ou autorização.

A Meta 02 está publicada em `2ca1136f`. Na Meta 03, build e typecheck do Stage
e lint passaram. O gate Electron Windows com `--agent-hub`, evidência
`lia-native-history-Zg5nHc`, leu uma capacidade publicada pelo Hub e conferiu
filtro e inspeção de ID. A conversa do ensaio usou HTTP sintético.

Próxima ação concreta. Integrar uma sugestão de plano com consumidor no
Stage e reaproveitar a confirmação de relógio no Main para o primeiro passo
supervisionado.

## Meta 04 com primeiro fluxo supervisionado validado

A Meta 03 está publicada em `7700e5f1`. A Meta 04 expõe a sugestão de
plano do relógio no chat. O plano informa como solicitar, autorizar e usar
o resultado. A sugestão preserva o rascunho, sem acessar o modelo ou
executar a capacidade. O envio com consulta passa pela confirmação nativa
existente, e a resposta do modelo só recebe o horário depois de uma chamada
válida. O Stage mantém o cancelamento e a revalidação do destino.

Build, typecheck e lint passaram. O gate Electron Windows
`lia-native-history-D61gGU` confirmou sugestão sem envio, recusa sem envio e
ida e volta do relógio com HTTP sintético e confirmação injetada. O plano se
restringe à capacidade conhecida. Níveis de autonomia contínua e execução
delegada permanecem indisponíveis.

Próxima ação concreta. Definir estados expressivos simulados, ligados aos
eventos reais de conversa e expostos aos consumidores de voz e presença.

## Meta 05 com expressão no chat e na reprodução

A Meta 04 está publicada em `a97d8f33`. O Stage exibe repouso, foco,
resposta pronta e reprodução em função dos eventos de conversa e áudio.
A reação à resposta dura até 1,8 segundo. A reprodução logo após a reação
pode usar 1,03× no player. O motor TTS não depende do estado expressivo.
O módulo `lia/stage/src/renderer/expression-state.ts` publica fase e
intensidade. A personalidade e seus traços seguem persistidos no perfil.

Passaram três testes do estado, build, typecheck e lint. No Electron
Windows, `check-native-history.mjs --voice` confirmou a transição de
resposta e a de reprodução com Kokoro local silenciado. Evidência
`lia-native-history-cHOjSH`. A revisão visual da captura passou. Os
estados são apresentação simulada e o avatar ainda não os consome.

Próxima ação concreta. Integrar uma ação verificável a uma entrada de
percepção já autorizada, com resultado e cancelamento no Main.

## Meta 06 com inspeção e cópia supervisionada

A Meta 05 está publicada em `912709bc`. O Stage inspeciona formato e
dimensões dos cabeçalhos PNG/JPEG selecionados. A cópia usa diálogo do Main
para obter o destino, verifica o conteúdo preparado, publica sem sobrescrever
e aceita cancelamento antes da publicação. O registro local da sessão conserva
32 resultados com horário, estado e metadados da imagem protegidos do modelo.
O registro não guarda nome, caminho, bytes ou hash.

Passaram 3 testes focados, build, typecheck, lint e o gate de visão no Electron
Windows. O relatório `lia-native-vision-siiXrc` confirma cancelamento,
preservação do destino, igualdade dos bytes e auditoria com diálogo injetado.
O caminho de visão e texto passou com HTTPS local e credencial sintética
protegida pelo cofre. A inspeção valida metadados, sem demonstrar interpretação
semântica. A revisão visual do anexo passou.

Próxima ação concreta. Projetar a expressão simulada existente no VRM por
eventos tipados e verificar a janela de presença em dois monitores.

## Meta 07 com reação VRM ligada à conversa

A Meta 06 está publicada em `7f264bf9`. A fase expressiva chega ao overlay
por IPC restrito à janela autorizada e a quatro fases sem texto. O VRM usa
os presets relaxado, feliz e abertura de boca quando existem, com pesos
limitados. A abertura de boca indica reprodução, sem sincronização fonética.
Modelos sem presets continuam renderizando. Os eventos não reativam a
renderização oculta e o quadro neutro é restaurado.

Build, typecheck e lint passaram. O Electron Windows
`check-native-presence.mjs --measure-renderer` confirmou mudança de pixels
com resposta HTTP local sintética, restauração, segundo monitor conectado,
ocultação e suspensão. Revisão visual do VRM sintético aprovada
(`lia-native-presence-LGV7yQ`). Três amostras visíveis de cerca de 2 s
registraram 0,043 a 0,047 s de CPU no renderer e 105 a 107 MiB de
working set. Oculto, 0 a 0,001 s e cerca de 107 MiB. Esses valores
descrevem o fixture e o processo medido. Jogos e GPU não foram medidos.

Próxima ação concreta. Aplicar os tokens publicados da Foundation V1.1
ao Launcher e ao Stage. Os candidatos a layouts continuam em revisão.

## Meta 08 com tokens oficiais validados

A Meta 07 está publicada em `0fc7ca1c`. A Foundation V1.1.0 do Stitch
Design Hub congelou o JSON com SHA-256
`4898BE854BFD84BB412288F766FB217AFEE3F0F3EA1C072B62DDA4F870E186D5`.
A seleção compartilhada em `lia/assets/styles/lia-foundation.css` fornece
superfícies, texto, ações, contornos e foco aos renderers do Launcher e do
Stage, com Segoe UI e fallback de sistema. A adoção preserva layouts,
navegação e assets existentes. Os candidatos WIDE, COMPACT e Launcher
gerado continuam em revisão. A arte Hero candidata permanece sem autorização
de uso comprovada.

Passaram build e typecheck de Launcher e Stage, lint, 22 testes focados
do Launcher e 17 no Chromium. As capturas Electron Windows de Launcher
e Stage passaram na revisão visual. O Launcher abriu e encerrou o Stage
sem `airi/` no ensaio `lia-native-stage-2ISGu9`.

## Validação integrada e encerramento do incremento V1

No Electron Windows, `check-native-history.mjs --agent-hub --voice`
(`lia-native-history-4S9w2O`) passou com chat HTTP sintético, catálogo
publicado de um Hub real e Kokoro local com reprodução silenciada.
A execução verificou identidade, traços, memória, histórico, sugestão,
confirmação injetada, relógio, voz e Foundation no Stage. Os gates de visão
e presença acima verificaram cópia real de arquivo, credencial sintética
protegida por DPAPI, reação VRM, dois monitores e suspensão. Passaram também
54 testes do Stage, sete testes focados de memória e Hub e `git diff --check`.

O incremento aplicável das sete metas foi entregue. Meta 03 segue parcial
até o contrato externo de execução. Meta 08 segue parcial até os layouts e
materiais de tela serem aprovados. Busca semântica requer embeddings
validados. Lip-sync fonético, jogos, GPU, áudio físico, provedores externos
e captura do desktop não foram validados neste programa. Ações gerais de
agentes e controle amplo do computador não foram implementados.

Evidências locais em `J:/lia-evidence/evolution-program-v1` e capturas
revisadas em `J:/lia-evidence/captures`. Próxima ação para retomada futura.
Solicitar aprovação das telas e um contrato de execução ao responsável pelo
executor, antes de ampliar a integração.
