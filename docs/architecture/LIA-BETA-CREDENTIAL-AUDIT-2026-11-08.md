# Credenciais — auditoria de prontidão beta, 08/11/2026

Referência inicial: `dcd0b058483912b2047a82973e39edb1d076a344`.
Revisão estática independente correlacionada com os handlers Main pelo agente
principal. **P0 ainda aberto; não é aprovação global de segurança.** Nenhum
perfil ou chave real foi aberto para montar o inventário. As referências abaixo
são caminhos relativos ao repositório e funções/classes de consumidores.

## Limite e critérios

O Credential Owner cobre `apiKey` dos transportes Main-native. Não cobre
automaticamente tokens de conta, integrações, assinaturas de protocolos ou
qualquer campo que se pareça com uma chave. Dados digitados pelo usuário podem
existir num rascunho transitório; não devem virar configuração persistida,
broadcast, telemetria, corpo de erro ou resposta IPC ao Renderer.

Classificações: **Main** = execução autenticada no Main; **legado exposto** =
segredo acessível/persistido no Renderer; **não verificado** = execução/egresso
não comprovados. A presença de código alcançável não comprova que alguém tenha
exfiltrado dados. A auditoria cobre as famílias localizadas, não certifica
plugins arbitrários, serviços externos ou todos os possíveis campos futuros.

## Inventário correlacionado

Nas linhas abreviadas, `.../main` e `.../renderer` referem-se a
`airi/apps/stage-tamagotchi/src/main` e `airi/apps/stage-tamagotchi/src/renderer`.

| Arquivo / função | Quem chama e alcance em produção | Segredo no Renderer? | Owner / classificação e próximo trabalho |
| --- | --- | --- | --- |
| `airi/apps/lia-app/src/main/ai-connection-service.ts`, save/discover/test | IPC do Launcher, IA & Recursos | Entrada explícita; devolve presença, configuração e resultados limitados | Main proprietário; backup opaco e rollback de seleção já testados. HTTP real externo pendente |
| `lia/core/src/credentials/owner-channel.ts`, client/server | Launcher e Stage Main, lease por execução | Não; bootstrap removido do ambiente antes dos renderers | Main, limite/autenticação/cancelamento/revogação testados; sem proteção prometida contra comprometimento do Main/mesmo usuário |
| `airi/apps/stage-tamagotchi/src/main/services/lia/credential-owner-access.ts`, resolve/withCredentialOwner | Transportes chat, fala e gravação | Não no fluxo assíncrono; get IPC separado | `apiKey` usa Owner; campos diferentes mantêm host local, exigem revisão/migração de ownership e concorrência entre processos |
| `.../main/services/lia/transport-execution-service.ts`, execute/start/pull | IPC por janela, HTTP/modelos/chat/SSE/fala | Não recebe chave no pedido de execução | Main; validação, cancelamento, limite e descarte existentes. Respostas externas continuam dados não confiáveis |
| `.../main/services/lia/transcription-service.ts`, registerLiaTranscriptionBridge | Gravações nos adaptadores migrados | Não | Main; não confundir com STT de sessão/WebSocket |
| `.../main/services/lia/secrets-service.ts`, registerLiaSecretsBridge | Todas as janelas autorizadas ao bridge | `get` legado pode devolver chave quando política permite | `set/adopt/delete apiKey` no Owner; `canRendererReadLegacySecret` nega escopos protegidos. Leitura legada continua exposta por decisão histórica, bloqueia fechamento global |
| `airi/packages/lia-core/src/secrets/vault.ts`, set/delete/change | Hosts Main; não é API Renderer | Não por si só | Mutações sob lock do SO comum aos hosts; revisão por entrada e recibo de reversão impedem escrita obsoleta. Container ilegível preservado e temporário removido em falha. Evidência multiprocesso abaixo |
| `.../renderer/stores/lia/provider.ts`, resolveApiKey/registerRuntimeExtensions | Líder do Stage, SDK legado de chat/STT | Sim, fora das definições migradas | **Legado exposto**; protocolos não migrados precisam execução Main, não exceções ao Owner. Aliases de definições nativas agora recusam resolução no Renderer |
| `.../renderer/stores/lia/provider.ts`, installCredentialConfig | Editor genérico e input compartilhado, inclusive follower | Rascunho transitório, sem emitir chave ao config nos IDs reivindicados | Ampliado para chat Main-native e aliases; STT gravado já coberto. Não reivindica TTS e outros protocolos sem contrato equivalente |
| `airi/packages/stage-pages/src/pages/settings/providers/chat/[providerId].vue` | Rota legada incluída no Stage | Input nativo passa a usar porta Main quando disponível; demais mantêm legado | Corrigida ligação `provider-id`. Revisão das páginas específicas com autenticação adicional continua aberta |
| `airi/packages/stage-pages/src/pages/v2/settings/providers/edit/[providerId]/index.vue` | Editor genérico incluído no build | Evita rascunho/config de chave quando porta possui o ID; resto persiste config | **Parcial**; guarda não cobre campos arbitrários ou todas as definições |
| `airi/packages/stage-ui/src/stores/providers/config.ts`, configs/updateProviderConfig; `services/inference-service-providers.ts` | Editores/ações sincronizadas de todos os providers | Configs em localStorage; PATCH tenta enviar config integral ao servidor configurado | **Legado exposto**, inclusive sem login (auth-fetch acrescenta token, não bloqueia fetch). Migrar escrita/readiness por protocolo, preservar standalone, revisar campos além de apiKey |
| `airi/packages/stage-ui/src/stores/providers/provider.ts`, getProviderInstance/withResolvedCredential | Chat/visão/artistry/markdown/hearing | SDK legado pode receber chave transitória; cache guarda clientes | **Legado exposto**; não há bypass comprovado do Owner no fluxo nativo. Listagem de vozes e validateProviderConfig constroem diretamente do config e também exigem migração |
| `airi/packages/stage-ui/src/components/scenarios/providers/speech-provider-settings.vue` | Páginas TTS incluídas no Stage | Sim: setter apiKey grava no config; input sem provider-id | **Legado exposto**, mesmo para definição com alternativa Main no painel Lia. Exige contrato de configuração/catálogo/execução Main antes de reivindicar o editor; não remover a funcionalidade |
| `airi/packages/stage-ui/src/stores/modules/hearing.ts`, startVadRealtimeTranscription | Conversa por voz/sessão | SDK de sessão no Renderer; gravação tenta Main primeiro | **Legado exposto** em sessão. Adaptador de credenciais compostas também usa accessKeySecret/appKey; limpeza de apiKey não protege esses campos |
| `airi/packages/stage-ui/src/stores/modules/web-search.ts` e `tools/web-search.ts`; Stage tool-resolver | Configuração e ferramenta de busca | Chave em localStorage e cliente Renderer | **Legado exposto**; erro incorpora parte do corpo externo, sem comprovar que contenha chave. Mover execução/segredo, limitar erro e revisar contexto de ferramenta |
| `airi/packages/stage-ui/src/stores/modules/discord.ts`, twitter.ts | Configuração das integrações legadas, rotas presentes | Tokens/chaves em localStorage e sincronização | **Legado exposto**; migrar integrações a adaptadores Main com permissões, sem apagar configurações existentes |
| `airi/packages/stage-ui/src/stores/auth.ts`, createLocalStorageForAuth/refresh; Stage electron-auth-callback | Login legado/callback Main→Renderer; fluxo comum Lia oculta conta | Tokens de sessão no Renderer/localStorage | **Legado exposto**; ocultar entrada não remove rota/IPC. Fluxo OIDC tem state/loopback, sem bypass de state demonstrado; ownership de sessão precisa decisão própria |
| `.../main/services/airi/auth.ts`, token exchange | Login externo explicitamente iniciado | Sucesso envia tokens; rejeição usa mensagem fixa para IPC e log | **Legado exposto no sucesso**; sessão Main ainda necessária |
| `.../main/services/airi/channel-server/index.ts`, config/QR/get | Main e página de conexão/servidor | Token retornado, copiável, QR e localStorage | **Legado exposto por contrato**; não é apiKey de provider. Exige credencial de sessão com escopo/revogação próprios |
| `airi/packages/stage-ui/src/stores/modules/artistry.ts`; Stage renderer App.vue, artistrySyncConfig | Rotas/ferramentas de imagem; provider=none desativa, configuração explícita ativa | Chaves em localStorage/broadcast/IPC | **Legado exposto**; nenhum guard managed remove esse caminho |
| `.../main/services/airi/widgets/artistry-bridge.ts`; `main/configs/artistry.ts` | Main de widgets, configuração e execução | Recebe credenciais dos globals; persiste JSON sem cifra | **Legado exposto** fora do Owner. Erros/status voltam ao Renderer e ferramentas; migrar storage/execução antes de aprovar imagem autenticada |
| `.../main/services/airi/widgets/providers/` | Providers de imagem usados pelo bridge | Chave pode estar em URL de pedido; erro externo vira status | **Não verificado em runtime**; risco de eco de segredo em erro/log, não houve exploração com chave real. Sanitizar na origem e passar referências ao Main |
| `.../main/app/main-process-log-bus.ts` e file-logger.ts | Hook global Main→Viewer/arquivo | Viewer recebe texto sanitizado; arquivo antes recebia cru | Corrigido sink de arquivo e padrões query/JSON; teste com sentinelas e arquivo real. Valores sem rótulo, corpos arbitrários e logs históricos NÃO são garantidos seguros |
| `airi/packages/audio`, `core-agent` | Pipeline de áudio/orquestração por injeção | Nenhum leitor/escritor próprio localizado nesta busca | **Não verificado globalmente**; credencial pode chegar por cliente injetado. Não equivale a classificar seguro todo fluxo que os usa |
| Exportação de chat (use-data-maintenance) | Ação explícita de exportar sessões | Conteúdo de chat/ferramentas pode incluir erro externo | Não localizado export explícito de cofre completo. Evitar erros privados em contexto; não confundir com consentimento para exportar segredos |

## Correções comprovadas e limites

- Container malformado, acesso negado e cifra que lança: testes RED, depois 13
  PASS focados. Inexistência real (ENOENT) continua permitindo criar o cofre.
  Fixture Stage passou a representar arquivo ausente com ENOENT, preservando
  os asserts anteriores; não trata arquivo truncado como instalação nova.
- Sink de log e query/JSON: dois testes RED, depois 7 PASS; inclui leitura de
  arquivo efetivamente gravado com sentinelas sintéticas. Não limpa logs antigos
  nem encontra segredos arbitrários sem formato identificável.
- Porta do editor chat nativo e alias: 2 regressões RED, depois conjunto com
  política de credenciais 21 PASS. Não transforma teste de presença/configuração
  em teste de conexão. A página avançada de ping legado continua pendente de
  teste completo Main; fluxo normal do Launcher já tem ferramenta/resultado.
  Revisão posterior encontrou prontidão exigindo chave em serviço local e em
  alias novo: exigência agora é declarada pela porta, e definição do alias é
  consultada antes de existir transporte. Delta final: 23 PASS; composable real
  e registro da porta: 5 PASS. Contraprova de compilação com o ramo antigo deu
  2 FAIL/2 PASS, sem modificar a fonte produtiva durante o build.
  Persistência de endpoint/opções pelo editor genérico e o ping legado não
  estão aprovados por essa troca de propriedade da chave: são contratos
  adicionais a integrar ao Main antes de declarar o editor completo.

## Ordem segura de fechamento

Na retomada, o login legado passou a descartar o corpo da rejeição HTTP no
Main e usar mensagens fixas no log e no evento de erro. O teste do handler
reproduziu o envio de uma sentinela antes da correção e passou depois, junto
ao teste do callback Renderer. A revisão independente não apontou defeitos
no delta. A sessão bem-sucedida e seus tokens no Renderer permanecem uma
frente de migração. A rodada seguinte corrigiu o ciclo de vida de tentativas
de login descrito abaixo.

### OIDC Desktop — fronteira e ordem de corte

| Entrada ou consumidor | Contrato atual e alcance no Desktop | Fronteira de destino |
| --- | --- | --- |
| `main/services/airi/auth.ts`, RPC da janela principal, Settings e Onboarding | Main abre o navegador com PKCE, recebe o código por loopback e confere o `state`. A troca no Main publica access, refresh e ID token no evento de sucesso. | Main conserva a sessão. A janela recebe somente estado da operação e DTO de perfil. |
| `renderer/bridges/electron-auth-callback.ts` → `stage-ui/stores/auth.ts` | O callback grava os tokens e dados de expiração no `localStorage` da origem e em Pinia sincronizado. `fetchSession` guarda também a sessão Better Auth, que tem campo `token`. A inicialização no Stage relê os dados e arma a renovação. | Adapter desktop instalado antes dos stores. Usar apenas estado autenticado e `id`, `name`, `email`, `image` do perfil. Nunca enviar o objeto `Session` bruto. |
| `stage-ui/libs/auth-fetch.ts`, `auth-client.ts`, cliente Hono e Settings de conta | REST lê token do store ou direto de `auth/v1/token`. Inclui sessões, edição de conta, senha e vínculos, além de créditos, personagens, configurações de provedores e chat. A conta pode ser aberta por rota direta. | Operações Main com origem, método e caminho limitados. Projetar respostas de conta e filtrar headers e erros. Manter suporte aos fluxos públicos de conta. |
| `stage-ui/stores/chat/session-store.ts` e `libs/chat-sync/ws-client.ts` | REST sincroniza sessões. O WS `/ws/v2/chat` envia o token no frame de autenticação após a conexão. O chat oficial também consome HTTP SSE. | Autenticar WS e SSE no Main e entregar apenas mensagens de domínio ou frames de dados. Manter reconexão e cancelamento. |
| `stage-ui/libs/providers/providers/official/`, `libs/speech/streaming-session.ts`, `streaming-pipeline.ts` | Chat e TTS REST usam Bearer. Preview e fala contínua usam WS `/api/v1/audio/speech/ws` com o token na query. STT `/api/v1/audio/transcriptions/stream` recebe stream HTTP duplex. | Adaptadores Main específicos por transporte, preservando streaming binário, upload, backpressure e cancelamento. Uma resposta IPC em buffer não preserva o contrato duplex. |
| `stage-ui/stores/auth.ts`, `libs/auth-oidc.ts` | Renovação proativa a 80% do TTL e retry em 401. Logout no Renderer usa ID token em `end-session` ou Bearer em `sign-out`. IPC Desktop só cancela o login pendente. | Renovação single-flight e revogação no Main. Serializar persistência e invalidar a geração antiga em logout. Não interpretar `end-session` como prova de revogação de todos os tokens. |

O Main já tem o cofre do Stage injetado em `main/index.ts`. O corte deve
reutilizar essa instância e reservar um escopo de sessão inacessível a todas
as operações do bridge genérico, inclusive leitura legada, adoção e escrita.
Validar restauração, falha de descriptografia, descarte, geração de sessão e
renovação com rotação antes de habilitar a nova propriedade. Para dados já
gravados no Renderer, definir adoção única com limpeza somente após confirmação
do Main, ou reautenticação explícita. Evitar leitura dos valores em logs.

**Fatia implementada nesta rodada.** Uma tentativa possui identidade, janela e
sinal de cancelamento no Main. Logout, fechamento da janela proprietária e
substituição invalidam a tentativa antiga, inclusive quando o loopback ou o
HTTP respondem mais tarde. O Main registra a etapa da falha e o status HTTP
quando conhecido, com mensagem fixa para a UI. O fetch da troca recusa redirects.
O formato de sucesso legado foi preservado até haver adaptadores para seus
consumidores. A migração de propriedade, revogação e recuperação após reinício
continuam abertas. Nenhuma validação deste delta demonstra sigilo dos tokens
de um login bem-sucedido.

**Ordem do próximo corte.** Implementar o proprietário do cofre e o adapter
de conta/REST. Em seguida, cobrir WS de chat e HTTP SSE, WS de áudio e STT
duplex em fatias próprias, com gates de reconexão e cancelamento. Ativar o
Desktop sem token no Renderer somente quando esses caminhos estiverem cobertos.
Web e Pocket podem continuar no adapter atual. O próximo consumidor fora de
OIDC é o PATCH/broadcast de configuração de provedores, usado pelo cliente
Hono e pelo store compartilhado. Depende da separação entre configuração
pública e referência do cofre, com migração dos valores antigos no Main.

### Sessão e REST de conta preparados para ativação conjunta — 09/11

O usuário escolheu preparar por fatias e ativá-las juntas. A origem do
bloqueio foi confirmada em revisão independente. O WS de chat precisa de
`chat:authenticate` com token no primeiro frame autenticado. A prévia e o
pipeline WS de TTS passam o token na query. STT oficial usa Bearer e áudio
duplex. As portas atuais de transporte Main cobrem respostas em streaming
e transcrição de bytes completos. Elas não cobrem esses sockets nem upload
vivo. Retirar o token antes dos adaptadores quebraria consumidores existentes.

- O escopo `lia:main:oidc` está protegido no bridge genérico de segredos.
  Get, Has, Set, Adopt e Delete recusam o escopo antes de consultar o cofre
  ou a exceção de leitura legada. Portas de transporte aceitam somente
  referências `apiKey`, distintas da entrada `session-v1`.
- `oidc-session.ts` prepara a propriedade exclusiva em Main. Usa o cofre
  existente do Stage, com `safeStorage` no host e serialização de escrita
  compartilhada no processo. O cofre aceita um sinal opcional e verifica
  cancelamento antes da troca atômica de arquivo. A troca é o ponto de
  commit, sem reversão posterior. Uma entrada vincula tokens, expiração,
  origem e client ID. A renovação por expiração é single-flight. Logout
  invalida a geração antes de apagar a entrada e pedir revogação ao emissor.
  A aceitação HTTP do pedido de revogação não confirma a invalidação de
  toda a sessão remota nem o encerramento do cookie no navegador. Uma
  rotação que já ocorreu no emissor antes do abort pode deixar um refresh
  sucessor fora da revogação. Falha em excluir uma credencial rejeitada
  pode fazer o próximo início tentar renovar novamente. [RFC 7009 §2.2](https://www.rfc-editor.org/rfc/rfc7009.html#section-2.2)
  Se o emissor rotacionar o refresh e a gravação do sucessor falhar, o
  owner invalida a sessão em memória e tenta remover a entrada antiga.
  A próxima chamada neste processo exige novo login.
- `oidc-account.ts` prepara operações REST de perfil, listagem de vínculos,
  nome, senha, reset, exclusão por confirmação e desvinculação.
  O destino vem da configuração Main e os métodos e caminhos são fechados.
  A resposta usa DTOs e códigos fixos, sem headers nem objetos de sessão brutos.
  A listagem de sessões ficou fora da nova porta. O endpoint Desktop atual
  só devolve a sessão correspondente à credencial e não tem consumidor de
  interface identificado. O perfil é projetado sem o objeto de sessão.
  O fluxo de iniciar vínculo GitHub, Google ou Steam exige definir o retorno
  do navegador ao Desktop. Continua legado.

**Bloqueio identificado na preparação anterior.** O Launcher e o Stage usam
o mesmo `lia-secrets.json`. O Launcher passa `APP_USER_DATA_PATH` ao Stage.
O canal de proprietário atual encaminha apenas `apiKey`. `session-v1`
seguiria ao escritor local do Stage. Cada processo serializa apenas sua
própria fila, enquanto o cofre substitui o JSON inteiro. Em uma reprodução
determinística com dois cofres e gravação sintética, o Stage apagou a sessão
e uma gravação concorrente do Launcher restaurou o snapshot anterior
(`oidc-prepared-shared-writer-repro.log`). A reprodução confirma a janela
de read-modify-write do cofre. Não executou dois processos Electron reais.
Ativar em modo gerenciado exige um único escritor ou exclusão mútua entre
processos no cofre já existente. A correção e suas evidências estão abaixo.

### Coordenação multiprocesso do cofre — 09/11

O Core passa a controlar o ciclo de leitura, alteração e troca de cada
mutação sob exclusão mútua do sistema operacional. No Windows, os dois hosts disputam o
named pipe `lia-vault-writer-v1`. O namespace global também cobre aliases
de caminho e perfis distintos, ao custo de serializar seus pequenos writes.
O pipe só funciona como trava e não recebe credenciais. O kernel libera o
handle ao encerrar o processo. A implementação libuv usa a primeira instância
exclusiva do pipe e reporta contenção como `EADDRINUSE`.
[Implementação libuv](https://github.com/libuv/libuv/blob/v1.x/src/win/pipe.c).

O Launcher, o Stage independente e os pedidos do canal de credenciais
usam o mesmo Core. As filas locais continuam ordenando cada serviço, mas a
trava compartilhada protege a releitura mais recente e o rename em disco.
O JSON mantém o formato de mapa de strings e ganha uma entrada reservada de
metadados, sem delimitador NUL. Os segredos continuam cifrados pelo host.
Arquivos antigos são lidos com revisão inicial `legacy`.

Cada entrada presente tem revisão própria. A exclusão avança uma revisão
de ausência mesmo quando o slot já não existe. Atualizações capturam a
revisão antes de aguardar fila, rede ou lock, e a comparam dentro da trava.
Assim, uma exclusão confirmada impede que a operação anterior recrie a
entrada. A revisão de ausência é compartilhada entre entradas ausentes,
podendo recusar conservadoramente uma criação concorrente com outra exclusão.
O chamador precisa reler e repetir uma nova ação explícita nesse conflito.

`changeSecret` devolve o recibo de sua própria escrita e uma reversão
condicional àquela revisão. Isso substitui o backup sem vínculo com a
mutação. A reversão não pode repor uma versão sobre exclusão ou substituição
posterior. O OIDC lê tokens e revisão no mesmo snapshot, renova com CAS e
limpa falhas de modo condicional. O login preparado exige a revisão capturada
antes de abrir o navegador. O IPC genérico do Launcher também recusa o escopo
OIDC e delimitadores que poderiam fabricar uma referência reservada.

Set e Adopt passam a revisão já capturada ao escritor sem solicitar o valor
anterior. Isso mantém a substituição de uma chave órfã no Stage gerenciado,
que ainda não tem registro de transporte para autorizar uma leitura no
Launcher. A leitura anterior fica limitada às operações que precisam de
reversão. O diagnóstico conta apenas referências compostas de segredos e
ignora o slot público de revisões.

O arquivo temporário fica no mesmo diretório e é publicado por rename.
Falhas conhecidas removem o temporário. Encerramento forçado antes do rename
pode deixar um temporário cifrado órfão, que nunca é carregado como sessão.
Não há lease de arquivo, roubo de lock por idade nem restauração de snapshot
antigo na inicialização. A garantia cobre processos usando esta versão do
Core no mesmo Windows. Misturar um executável antigo que ignore a trava
não é um cenário validado. Queda de energia e filesystem remoto exigem
ensaios próprios. Linux usa socket abstrato e o fallback de outros sistemas
usa um listener loopback; esses hosts ainda não receberam gate nesta rodada.

Em 10/11, o gate real de componentes em Electron 43.4.1 no Windows passou
os 16 grupos com credenciais sintéticas e fixture HTTP local. A varredura
dos logs não encontrou as sentinelas. A coordenação entre processos foi
exercitada separadamente pelos 12 casos com processos Node reais. O
[relatório beta](../product/LIA-BETA-READINESS-2026-11-08.md#coordenação-compartilhada-do-cofre--retomada-de-539d2dd)
registra os resultados e o caminho das evidências.

O owner e o REST preparado ainda não têm registro IPC nem chamadores no
login em produção. O evento de sucesso ainda entrega access, refresh e ID
tokens ao Renderer. O Pinia e o `localStorage` legados também permanecem.
Antes da ativação conjunta, conectar os adaptadores restantes, definir a
transição das sessões antigas e validar logout no emissor real, revogação,
renovação antecipada após rejeição do servidor e isolamento de janelas no
IPC real. A troca de senha com `revokeOtherSessions` pode exigir novo login:
o Better Auth remove sessões e retorna uma credencial de navegador, que a
porta de conta descarta. Validar a transição da UI nesse caso. Manter a
migração de credenciais de provedores fora deste corte.

1. Terminar contrato Main de configuração/listagem/probe para chat avançado e
   TTS, reaproveitando transportes existentes sem passar plaintext ao SDK Renderer.
2. Migrar STT de sessão/assinatura e campos compostos por protocolo, incluindo
   cancelamento e troca de credenciais; não simplesmente negar e remover recurso.
3. Separar credenciais de integrações/conta/canal/imagem das preferências; impedir
   PATCH/broadcast e JSON em claro dos segredos sem descartar dados legados.
4. Mensagens fixas nos produtores de erro externo, revisão de telemetria/export,
   gates sintéticos negativos por janela e validação externa autorizada.

Até essas frentes serem corrigidas e testadas, a classificação é **Ainda
bloqueada** para beta por credenciais legadas alcançáveis. Não é registro de
incidente de exfiltração nem autorização para redistribuição pública.
