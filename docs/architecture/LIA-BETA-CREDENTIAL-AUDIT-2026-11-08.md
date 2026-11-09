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
| `airi/packages/lia-core/src/secrets/vault.ts`, set/delete/backup | Hosts Main; não é API Renderer | Não por si só | Corrigido nesta rodada: mutações não substituem container ilegível; erros de cifra não saem; temporário removido em falha. Serialização do dono não resolve escritores legados de outro processo |
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
| `.../main/services/airi/auth.ts`, token exchange | Login externo explicitamente iniciado | Sucesso envia tokens; erro externo pode atravessar IPC/log | **Legado exposto**; não usar sanitizador por regex como substituto de mensagens fixas e sessão Main |
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
