# OIDC Main — vínculos e transportes preparados

## Escopo e estado

Preparação sobre `569a983207b89bce663028b7fc25df82de246e4e`, branch
`arena/01a10290-lia-project`, em Windows. A autorização da rodada pede
substitutos testados antes da ativação conjunta. Os serviços novos têm
contratos TypeScript e testes de composição com o owner Main. O registro
IPC e a adaptação dos consumidores de produção pertencem ao corte de
ativação. A auditoria global permanece bloqueada.

## Inventário conferido antes de implementar

| Consumidor atual | Protocolo e autenticação | Ciclo de vida existente |
| --- | --- | --- |
| `stage-ui/composables/use-linked-accounts.ts` | `POST /api/auth/link-social`; identidade OpenID usa `/api/auth/link/steam`. Bearer no cliente, URL externa devolvida pelo servidor | Servidor persiste state com usuário do vínculo e consome-o no callback. Desvinculação por `POST /api/auth/unlink-account` |
| `stage-ui/libs/providers/providers/official/shared.ts` | `POST /api/v1/openai/chat/completions`, Bearer, SSE | xsAI recebe mensagens, ferramentas e sinal de cancelamento. Header de sessão `x-airi-session-id` |
| `stage-ui/libs/chat-sync/ws-client.ts` | `/ws/v2/chat`, Eventa. `chat:authenticate` transmite token depois da abertura | Push, send/pull RPC, ordenação por seq, catchup após abrir; reconexão com espera exponencial e 4001 por rejeição |
| `stage-ui/libs/chat-sync/cloud-mapper.ts` | GET/POST `/api/v1/chats`, DELETE `/:id`, Bearer | POST 409 recupera o chat com o mesmo ID por listagem |
| `stage-ui/libs/speech/streaming-session.ts` e `streaming-pipeline.ts` | `/api/v1/audio/speech/ws`, token na query, JSON e áudio binário | `start`, `text`, `finish`, `cancel`; `sentence.*`, `subtitle`, `session.finished`. Interrupção fecha a sessão. Fala interrompida exige nova intenção |
| `stage-ui/libs/providers/stream-transcription/index.ts` | POST `/api/v1/audio/transcriptions/stream`, Bearer, upload incremental e SSE | Áudio Uint8Array; eventos delta, snapshot substituível e conclusão; captura encerra ou aborta a sessão |
| Catálogos de voz, créditos e demais chamadas de `composables/api.ts` | REST autenticado no Renderer | Continuam exigindo contratos delimitados e adaptação antes da retirada conjunta dos tokens |

O vínculo usa o state do servidor e o loopback já existente. O servidor
permite callback HTTP loopback com porta variável em `auth/src/origin.ts`.
O plugin `oidc-jwt-bearer.ts` autoriza o início pelo Bearer do Main. O state
do vínculo guarda a identidade autenticada, permitindo terminar no navegador
externo. Essa composição foi estudada no código vendado. O emissor real
ainda exige ensaio próprio.

## Contratos preparados

### Vínculos

`createOidcLinkService` recebe `origin`, `withAccess` e `openExternal` do Main.
`execute(windowId, { provider }, signal)` retorna somente sucesso ou código
de erro. `cancel`, `disposeWindow` e `dispose` encerram tentativas. O ID da
janela deve vir do sender autorizado pelo handler Main.

Cada tentativa gera state e marcador independentes, abre um loopback de uso
único e envia callback e errorCallbackURL fixados pelo Main. A URL de
autorização fica no Main e no navegador externo. Um retorno válido é seguido
por GET autenticado de contas associadas, confirmando o provedor solicitado.
O limite padrão é cinco minutos e há no máximo 32 tentativas simultâneas.
Rejeição, cancelamento, logout, bind tardio e resposta HTTP tardia limpam os
recursos e impedem sucesso tardio.

Cancelamento local encerra a espera e o retorno ao aplicativo. Uma associação
já confirmada no servidor pode persistir após cancelar ou fazer logout. Sua
remoção usa a operação explícita de desvinculação no serviço de conta. A
confirmação com 401 retorna `unauthenticated`, permitindo atualizar a listagem
após reautenticar. O serviço preserva o início do vínculo como mutação única.

### HTTP e STT

`createOidcHttpService({ origin, session })` cria `forWindow(windowId)`.
O contrato público está em `shared/eventa/lia-oidc-http.ts`. São operações
delimitadas de chat SSE, fala HTTP, STT incremental e listagem/criação/exclusão
de chats. O Main escolhe método, URL e cabeçalhos, resolve a sessão e emite
somente bytes e metadados permitidos.

`open` registra a operação antes do acesso à sessão e devolve UUID. `pull`
consome até 64 KiB por chamada. `write` recebe até 64 KiB de áudio ou `null`
para terminar a entrada. A pressão do stream de upload controla a próxima
escrita. `cancel` é idempotente e `dispose` encerra todas as operações da
janela. Há limites de quatro operações por janela, 32 ativas no serviço e
16 portas de janela. O prazo de operação é 120 segundos. Áudio total tem
limite de 32 MiB, JSON de 2 MiB e evento SSE de 256 KiB.

O modelo, mensagens e ferramentas escolhidos seguem no corpo do chat.
Fala HTTP preserva voz, modelo, velocidade, formato e opções de corpo
limitadas. Opções de autoridade como headers, tokens e endpoints são
recusadas. Metadados de chats são projetados em campos públicos. POST 409
com ID conhecido consulta a listagem e recupera o chat correspondente.

Um 401 solicita renovação no owner fora da ação antiga. Somente a listagem
GET é repetida automaticamente, uma vez. Mutações e gerações retornam
`unauthenticated` para o chamador controlar uma nova tentativa.

### WebSocket e fala bidirecional

`createOidcSocketService({ origin, withAccess, refreshAccess })` oferece
`forWindow(windowId)`, `disposeWindow` e `dispose`. A porta tem `chat` e
`speech`. O contrato Eventa é delimitado pela Lia, com os nomes e envelopes
existentes. O teste usa as declarações do servidor para conferir a
compatibilidade. A implementação usa a biblioteca Eventa já instalada.

Chat oferece `connect`, `status`, `disconnect`, `sendMessages`,
`pullMessages`, assinaturas de status e de mensagens. O Main autentica a
conexão. Há limite de 16 RPCs pendentes e deadline por RPC. A reconexão usa
base de 1 a 30 segundos, com jitter de 50 a 100% da base. Um 4001 pode solicitar renovação
antecipada e nova autenticação. O chamador faz catchup por seq após reabrir.
RPCs da conexão anterior terminam com erro e preservam a necessidade de
reconciliação explícita pelo chamador.

Fala oferece `start`, `appendText`, `finish`, `send`, `cancel` e `done`.
O start preserva modelo, voz, formato, extraBody e campos de analytics
previstos pelo protocolo atual. Os frames recebidos são projetados e
validados antes do callback. O send público também valida evento e chaves
em runtime. Fila e buffer têm limite de 512 KiB. O prazo é 120 segundos,
o áudio total é limitado a 32 MiB e a recepção a 4096 eventos. A conclusão
exige `session.finished`. Cada fala é executada em uma única conexão.
A query de autenticação exigida pelo protocolo atual de fala WS fica na
conexão do Main. Ela está fora dos DTOs e eventos das portas preparadas.
O emissor real e sua política de logs de rede permanecem sem validação.

### Renovação e proteção da saída

`owner.refreshAccess(signal)` permite renovação antecipada por rejeição do
servidor e compartilha a mesma promessa usada para renovar na expiração.
Cancelar um chamador preserva a renovação aguardada por outro. Logout
invalida a geração e recusa a persistência de uma renovação atrasada.

O predicate Main de valores privados também reconhece sufixos que são
prefixos de tokens. Eventos e bytes ficam retidos enquanto esse prefixo
puder se completar. A checagem considera fragmentos SSE, texto WS e áudio
binário, incluindo a forma crua e os escapes Unicode de JSON em argumentos
de ferramentas. `oidc-egress.ts` segue a composição do consumidor de chat
pela primeira escolha e seus aliases, com argumentos por índice de ferramenta.
Para STT, mantém separados o agregado substituível e o stream só de deltas.
O Main normaliza CR, LF e CRLF antes de verificar e publicar SSE.

Um prefixo incompleto no fim da resposta é liberado. Um prefixo em campo que
pare de receber deltas pode reter eventos seguintes até EOF ou até o limite
do buffer. Essa escolha conservadora pode aumentar a latência. Catálogos e
adaptação da UI precisam preservar feedback de carregamento e erro ao ativar.
O filtro cobre os tokens conhecidos da sessão e as decodificações descritas.
Conteúdo privado arbitrário exige sua própria política de dados.

## Matriz antes da ativação conjunta

| Consumidor | Implementação Main | Contrato preparado | Regressão sintética | Cancelamento/logout | Renovação | Entrega pública |
| --- | --- | --- | --- | --- | --- | --- |
| Sessão e REST de conta | Disponíveis | API Main anterior | PASS automatizado | PASS automatizado | PASS automatizado no owner | DTOs permitidos |
| Vínculo/desvínculo social | Disponíveis | `execute` e serviço de conta | PASS automatizado, HTTP/loopback reais | PASS automatizado, incluindo owner real | Expiração antes de iniciar coberta pelo owner; 401 ao confirmar exige reautenticar | Resultado fixo |
| Chat SSE | Disponível | `OidcHttpPort` | PASS automatizado | PASS automatizado | Owner e 401 com geração sem replay | SSE verificado |
| Sincronização REST | Disponível | `OidcHttpPort` | PASS automatizado, inclusive 409 | Owner e porta por janela | GET pode renovar e repetir uma vez | Metadados projetados |
| Chat/sincronização WS | Disponível | Porta chat e wire Eventa | PASS automatizado, WS real | PASS automatizado com owner real | 4001 → renovação → autenticação, com owner real | Status, mensagens e seq |
| TTS HTTP/WS | Disponível | Porta HTTP e speech | PASS automatizado | PASS automatizado | Sessão resolvida antes de iniciar; fala interrompida exige nova intenção | Áudio e controles projetados |
| STT entrada e saída incremental | Disponível | `write` e `pull` | PASS automatizado, HTTP real com entrada e saída intercaladas | Abort fecha input/output | Sessão resolvida antes de iniciar; retomada exige nova captura | SSE verificado |
| Catálogos de voz, créditos e outros REST | Inventariados | Pendente | NÃO EXECUTADO para substituto Main | Pendente | Pendente | Consumidores legados alcançáveis |
| Registro e integração Electron/Renderer de todas as portas | Pendente | Binding precisa usar sender Main e limpeza de janela | NÃO EXECUTADO para estes serviços em IPC real | Gate integrado pendente | Gate integrado pendente | Callback de produção segue legado |

## Evidências e revisão

Logs da preparação e retomada ficam em `J:/lia-evidence/oidc-next-*.log` e
`J:/lia-evidence/oidc-resume-*.log`, com códigos de saída ao lado. A execução
focada antes da retomada teve 113 PASS em sete arquivos. Inclui login,
callbacks, conta, vínculo, owner, HTTP e sockets. HTTP e WS sintéticos reais
comprovam upload/recepção, wire Eventa, interrupção, reconexão e isolamento
das portas. O fixture de cofre usa o Core real com cifra de teste.

A revisão independente reproduziu reflexão de token entre deltas e em áudio
binário, argumentos JSON com Unicode escapado e send com frame arbitrário.
As correções têm regressões. A revisão inicial testou 39 posições de corte
em argumentos escapados e bloqueou todas. A retomada verificou o diff inteiro
em leitura e encontrou
divergências entre as regras de concatenação dos consumidores e da guarda,
terminadores SSE, segmentos de ponto no DELETE e decodificação de URLs de
vínculo. A renovação após rejeição agora respeita o sinal e a identidade da
tentativa original no HTTP e no WS. Os testes exercitam também a substituição
de uma conexão durante renovação pendente. A revisão final ficou sem achados
acionáveis e os 123 casos focados passaram em sete arquivos.

[Resultados agregados e estado de prontidão](../product/LIA-BETA-READINESS-2026-11-08.md#preparação-oidc--retomada-de-1011-e-1111).

## Dependências e próximo corte

1. Preparar catálogos de voz, créditos e demais REST autenticados com DTOs
   públicos e comportamento equivalente ao cliente atual.
2. Adaptar UI/Pinia e composição Main para todas as portas em conjunto,
   validar sender, cancelar por janela e migrar sessões legadas com o cofre
   existente. A retirada do callback legado depende desse conjunto.
3. Executar os contratos no IPC real do Electron, incluindo múltiplas janelas,
   logout, reinício, renovação e regressão de voz/captura.
4. Testar vínculo e revogação com o emissor real, cookies do navegador,
   expiração, latência, áudio físico e políticas do serviço. Esses ensaios
   estão NÃO EXECUTADOS nesta preparação.

O baseline funcional permanece `3ef6d11`. A aprovação beta depende também
dos demais consumidores descritos na auditoria de credenciais.
