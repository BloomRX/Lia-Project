# Auditoria independente de arquitetura e segurança — Lia

**Data:** 14/11/2026. **Referência de código e documentos:** `ae46c495d7da7cd33f4b4da8f4e8cc95b0a867b6`. **Branch de entrega:** `arena/c6b02f64-lia-project`; HEAD de partida `7cb81720552a822a03f36ac6ce5f2e20b009f84c`. **Branch de desenvolvimento:** `arena/01a10290-lia-project`, consultada apenas como referência. Não foram aplicadas correções, modificadas configurações do projeto ou eliminadas evidências. O relatório não rastreado da auditoria anterior foi preservado, sem ser incluído neste commit.

## 1. Resumo executivo

**Recomendação: beta aberta ainda não aprovada.** Se OIDC estiver no escopo, tokens de sucesso continuam chegando ao Renderer e ao `localStorage` (SEC-01); uma corrida de refresh com logout foi reproduzida com dependências simuladas (SEC-02). Também persistem exposição condicional de credenciais legadas, risco de reutilização de credencial após alteração de destino, superfície privilegiada de MCP e lacunas de evidência do runtime e da distribuição. Não foi demonstrado XSS, execução remota por invasor, MITM nem roubo de credencial real.

O gate de ferramentas de `f3facdf` **existe na referência** e protege os executores registrados consultados normalmente: `defaultActive` continua sendo inclusão ambiente, não habilitação. Não se reabre o sintoma antigo de A-1 como defeito. Duas limitações novas foram reproduzidas sob condições controladas: um schema já capturado pode sobreviver a uma mudança concorrente, embora seu executor protegido recuse a execução (TOOL-01); e outra fonte com nome igual pode permanecer e ser executada em rerun, sem que o executor do ID desabilitado execute (TOOL-02). Não há prova de exploração por um usuário remoto nem de bypass do executor protegido no fluxo usual.

**Leitura de status:** “confirmado” identifica comportamento no código ou numa bancada descrita; não implica vulnerabilidade remotamente explorável. “Risco condicional” exige premissas não demonstradas; “ausência de evidência” não é falha comprovada. Severidades são estimativas de auditoria para o escopo beta, condicionadas ao recurso estar disponível.

### Proveniência e escopo

A referência foi obtida por `git fetch --no-tags --depth=1 origin ae46c495d7da7cd33f4b4da8f4e8cc95b0a867b6` e extraída por `git archive` em diretório temporário, **sem mudar a branch nem o worktree**. API do GitHub identifica `f3facdf8f4ec8873221fe70b67e34934e2631496` como pai do SHA solicitado; o commit `ae46c4` registra a decisão de produto e evidências sobre A-1. O diff entre HEAD da sessão e a referência contém seis arquivos de código/teste de ferramentas e quatro documentos. Achados, linhas e testes abaixo são associados à árvore `ae46c4`, não ao HEAD mais antigo. O histórico raso não é usado para inferir tudo o que aconteceu entre commits.

A inspeção privilegiou fluxos OIDC, preload/Eventa e handlers de alto impacto, credenciais, transportes, ferramentas, vault, TLS, updater, distribuição e medições. O inventário identificou muitas declarações e handlers IPC; **não foi possível verificar semanticamente cada canal, origem, resposta e handler de todas as janelas**. Não se afirma que todos os canais são seguros. Arquivos, comandos, verificações e lacunas estão na §9.

## 2. OIDC e autenticação

### SEC-01 — Tokens OIDC no Renderer e armazenamento comum

- **Severidade:** ALTO, se OIDC estiver acessível. **Estado:** exposição confirmada estaticamente; roubo não demonstrado.
- **Evidência:** `airi/apps/stage-tamagotchi/src/main/services/airi/auth.ts:27-32,115-164,193-223` inicia autorização PKCE, troca code e envia `accessToken`, `refreshToken` e `idToken` recebidos por `electronAuthCallback`; refresh e ID são opcionais na resposta. `src/renderer/bridges/electron-auth-callback.ts:16-28` entrega-os ao store; `src/renderer/App.vue:197-202` instala o listener. `airi/packages/stage-ui/src/stores/auth.ts:17-50,155-169,233-272` os armazena, restaura e renova em `localStorage`. Pontos de login reais: `src/renderer/pages/settings/account/index.vue:8-23`, onboarding e controles; o serviço Main é instanciado nas janelas principal, settings e onboarding.
- **Impacto/condições:** após login, código com acesso ao Renderer/perfil pode ler tokens presentes. É necessário login e comprometimento desse contexto ou acesso local; não há prova de XSS nem de exfiltração. `offline_access` é solicitado, mas emissão de refresh depende do servidor.
- **Correção:** decisão explícita de escopo. Se incluído, Main deve ser dono de sessão, refresh e consumo, sem exportar tokens, com migração/remoção de armazenamento legado; se excluído, bloquear todos os pontos de entrada e consumidores, não só esconder a UI.
- **Testes:** issuer local em Electron empacotado; login, refresh, cancelamento, falhas e logout; inspeção de payloads IPC, DOM, `localStorage`, logs e perfil com canários; sender/frame não autorizado, reinício e migração.

### SEC-02 — Refresh atrasado pode repovoar estado após logout

- **Severidade:** ALTO, condicional a corrida e comportamento do servidor. **Estado:** comportamento local confirmado em bancada sintética; efeito em issuer real não demonstrado.
- **Evidência:** `airi/packages/stage-ui/src/stores/auth.ts:150-186` aguarda `refreshAccessToken` e depois grava tokens e chama `fetchSession`, sem verificar geração de sessão ou cancelamento. `:298-326` aguarda logout de rede e então limpa, e `:329-348` interrompe timer, mas não invalida refresh já em voo. A página settings cancela tentativa de login Main antes do logout (`src/renderer/pages/settings/account/index.vue:18-24`), o que não cancela essa operação do store.
- **Reprodução:** `evidence/lia-audit-ae46c4/auth-probe.ts` executou o store real do SHA com storage em memória, logout offline simulado, refresh atrasado e consulta de sessão simulada como aceita. Resultado: storage vazio imediatamente após logout; após liberar refresh, access e refresh tokens sintéticos reaparecem, client ID continua ausente e `isAuthenticated=true`. O issuer real, a revogação e a persistência Electron não foram exercitados. A consistência do estado após reinício também não foi testada.
- **Impacto/condições:** resposta antiga concluída após limpeza pode restaurar dados e identidade local se a consulta de sessão aceitar o token; logout offline torna plausível a persistência de sessão remota, mas não foi observada. Também é possível o servidor negar a sessão e provocar limpeza posterior.
- **Correção:** invalidar geração/cancelar ou descartar todas as respostas anteriores ao logout/novo login, inclusive refresh e consulta de sessão; limpar local imediatamente e coordenar revogação remota com timeout e resultado explícito.
- **Testes:** refresh iniciado antes de logout, sucesso e falha chegando depois, logout offline/HTTP 500/timeout, novo login concorrente, reinício e múltiplas janelas; validar tanto armazenamento quanto estado e timers.

### SEC-03 — Logout remoto e revogação não comprovados

- **Severidade:** MÉDIO. **Estado:** fluxo estático confirmado; revogação efetiva é ausência de evidência, não falha do issuer demonstrada.
- **Evidência:** `auth.ts:298-326` faz GET de end-session com `id_token_hint` ou POST sign-out com bearer, sem checar `response.ok`; em erro de rede registra mensagem e limpa local após o `fetch` terminar. Não há timeout explícito nesse trecho nem chamada explícita de revogação de refresh token. Uma resposta HTTP de erro não gera exceção automaticamente. Sem resposta indefinidamente, a limpeza após `await` pode atrasar. O `id_token_hint` via query também merece revisão de logs e política do servidor, sem alegar vazamento observado.
- **Condições/impacto:** servidor offline, requisição pendente ou erro HTTP pode deixar sessão/token remotos válidos ou resultado desconhecido; comportamento concreto depende do issuer. **Correção:** invalidar primeiro a sessão local e distinguir confirmação remota, timeout e falha; usar revogação apropriada às capacidades do issuer, sem vazar hint em logs. **Testes:** issuer realista com revogação, HTTP 4xx/5xx, desconexão e requisição pendente; verificar replay e tempos limites.

### Controles observados e limites de implementação

`auth.ts:85-88,115-164,175-181` confere sender da janela, usa PKCE S256/state, cancela tentativas e não imprime corpo de erro da troca; o loopback escuta `127.0.0.1` e valida state (`http-server/http/auth/index.ts:27-32,86-124`). Esses controles não impedem SEC-01/02. A busca por chamadas de `createOidcSessionOwner`, `createOidcAccountService`, `createOidcHttpService`, `createOidcLinkService` e `createOidcSocketService` fora de testes/documentos localizou definições, não composição de produção. Isso não exclui alias indireto ou código externo, mas não demonstra que o owner Main-only substituiu o fluxo legado.

`docs/reports/LIA-STAGE-SANDBOX-AF1B-FIX.md:81-85` relata gate local OIDC PASS com issuer fixture e uma falha isolada em `oidc-link.test.ts`; `docs/reports/LIA-WINDOWS-POST-SANDBOX-AF1B-VALIDATION.md:5-8,23-41,117-129` relata reteste posterior PASS em base `879a5f3` com worktree sujo. São execuções de escopos/estados diferentes, não prova de produção no SHA auditado. O diretório `scripts/oidc-electron/` constava não rastreado na rodada Windows e não aparece no `git ls-tree` desta referência. Não foram executados testes OIDC Electron nesta auditoria.

## 3. IPC, isolamento e credenciais

### Mapa de superfície

- **Launcher:** `airi/apps/lia-app/src/preload/index.ts:1-52` expõe métodos nomeados via `contextBridge`; `src/main/web-preferences.ts:19-21` usa `contextIsolation`, `sandbox` e `nodeIntegration:false`. O Renderer ainda pode solicitar ações por essa API: validação e autorização continuam responsabilidade do Main.
- **Stage:** `airi/apps/stage-tamagotchi/src/preload/shared.ts:9-53` expõe fachada de `invoke/on/removeListener/send` e sanitiza o objeto do evento; `ipc-channel-policy.ts:1-24` limita canais brutos por operação. `eventa-message` é multiplexado: permitir ou negar o canal bruto não equivale a conferir todos os eventos lógicos e suas permissões. `src/main/windows/secure-web-preferences.ts:3-9` fixa isolamento/sandbox/sem Node; `windows/shared/window.ts:53-78` contém guardas de navegação e popups.
- **Famílias inspecionadas:** auth, credenciais, transporte, seleção de provider, MCP, execução/pull/cancel, memória, voz e janelas; há outras famílias em `src/shared/eventa/` e handlers em `src/main/`. Há validação de payload em vários caminhos, sender ownership nos jobs de transporte e checagem de sender no login; não há base nesta amostra para afirmar que todos os handlers validam identidade, frame, resposta e tamanho.

### SEC-04 — Leitura de credenciais legadas por Renderer

- **Severidade:** ALTO se providers legados não curados estiverem no escopo. **Estado:** exceção confirmada no código, sem exploração real.
- **Evidência:** `airi/apps/stage-tamagotchi/src/main/index.ts:450` conecta `canRendererReadLegacySecret`; `services/lia/transport-config-service.ts:49-64` nega providers curados e scopes protegidos, mas permite scopes não catalogados sem proteção; `services/lia/secrets-service.ts:137-145` retorna o segredo quando permitido. `src/renderer/stores/lia/model-listing-scope.test.ts:130-140` documenta exemplo sintético de provider legado; não foi executado aqui.
- **Impacto/condições:** segredo existente em scope permitido pode ser lido por código capaz de usar o bridge no Renderer. Isso não prova acesso a todos os segredos nem ataque remoto. **Correção:** migrar consumidores legados para operações autenticadas no Main e remover leitura genérica; inventariar escopos e migração. **Testes:** canários, curados/não curados, tombstones, falha de leitura, migração e sender não autorizado.

### SEC-05 — Alteração de endpoint pode afetar destino da credencial

- **Severidade:** ALTO sob controle indevido do bridge de configuração. **Estado:** fluxo confirmado estaticamente; exploração Electron não demonstrada.
- **Evidência:** Stage `transport-config-service.ts:78-90` aceita mutação do repositório; `lia/core/src/transports/validation.ts:16-22,60-68` aceita HTTP/HTTPS e valida referência de credencial ao provider, não ao host; `transports/repository.ts:133-153` permite atualizar record com mesma identidade; `services/lia/transport-execution-service.ts:252-278,315-340` usa destino salvo e credencial, e `lia/core/src/providers/runtime.ts:220-230` cria bearer. O draft com URL diferente não usa o vault; isso não resolve, por si, mudança anterior do registro salvo. O fluxo AI Settings do Launcher tem confirmação e salvaguardas próprias (`ai-connection-service.ts:298-305,357-375`), que não se deve generalizar ao outro bridge.
- **Impacto/condições:** ator capaz de mudar configuração e disparar operação pode direcionar credencial ao endereço escolhido; não se demonstrou que ator externo alcance o Renderer, nem envio real nesta rodada. Providers customizados também exigem endpoints legítimos. **Correção:** autorização confiável de mudança de destino e vínculo credencial/destino no owner, HTTPS por padrão e exceções explícitas para loopback. **Testes:** IPC real, Renderer/janela indevidos, URL alterada, HTTP, redirect, revisão obsoleta, concorrência, drafts e mudança customizada aprovada.

### SEC-06 — MCP: spawn e logs atravessam fronteira privilegiada

- **Severidade:** ALTO para spawn se Renderer autorizado for comprometido; MÉDIO para dados em logs. **Estado:** capacidades confirmadas estaticamente; exploração remota não demonstrada.
- **Evidência:** `airi/apps/stage-tamagotchi/src/main/services/airi/mcp-servers/index.ts:166-184,340-351,354-376,384-413,461-491` recebe comandos/configuração, constrói `StdioClientTransport` com `command`, args, cwd e env, e registra stderr ou o retorna em erro; texto de configuração pode conter env. `src/renderer/stores/tools/mcp.ts:22-32` registra ferramentas MCP; `airi/packages/stage-ui/src/tools/mcp.ts:93-129` permite descoberta/chamada de ferramentas já disponíveis.
- **Condições/impacto:** controle do IPC de configuração/teste e payload apropriado pode solicitar processo no contexto do usuário; não foi demonstrado que saída de modelo configura diretamente um novo servidor. Valores sensíveis no env/stderr podem ir para arquivo, log ou UI se presentes; nenhum foi coletado. **Correção:** autorização de sender e capacidade no Main, confirmação confiável para configurar/iniciar servidores, vault por referência e política de logs. **Testes:** processos e segredos sintéticos, sender indevido, configuração inválida, stderr verboso, prompt injection e ferramentas negadas.

### SEC-07 — Verificação TLS por nomes textuais

- **Severidade:** ALTO condicional. **Estado:** predicado confirmado estaticamente; MITM não reproduzido.
- **Evidência:** `airi/apps/stage-tamagotchi/src/main/services/airi/channel-server/index.ts:174-183,224-253` aceita erro de autoridade para hosts específicos se subject/issuer tiverem campos textuais esperados, sem comparação de chave/fingerprint da CA nesse predicado. `:259-269,297-320` gera e tenta instalar CA local no SO; sucesso de instalação não foi verificado.
- **Condições/impacto:** atacante precisaria controlar rota ou endpoint para um dos hosts aceitos e apresentar certificado cujos campos correspondam; campos textuais não são prova criptográfica da identidade. Não se demonstrou interceptação de tráfego. **Correção:** conferir cadeia/chave esperada e hostname no escopo mínimo, avaliar ciclo de vida e necessidade de confiança no SO. **Testes:** CA real e impostora com nomes iguais, hostname errado, expiração, cadeia inválida e sessões independentes.

### SEC-08 — CSP não demonstrada para Stage

- **Severidade:** MÉDIO, defesa em profundidade. **Estado:** meta CSP comentada em `airi/apps/stage-tamagotchi/src/renderer/index.html:6-17`; não foi comprovada ausência de outra CSP efetiva em todas as distribuições. **Impacto/condições:** se não houver política efetiva, dano de injeção pode aumentar; nenhuma injeção foi demonstrada. **Correção:** política restritiva compatível com os recursos e canais de produção. **Testes:** inspecionar headers/CSP efetiva em builds real e dev; bloquear script/`connect-src` indevidos sem quebrar assets autorizados.

### SEC-09 — Concorrência de repositório de transportes

- **Severidade:** MÉDIO potencial. **Estado:** risco teórico, não reproduzido; verificar topologia antes de afirmar falha.
- **Evidência:** `lia/core/src/transports/repository.ts:70-119,133-153,193-219` serializa por instância, lê revisão e usa rename atômico; não há lock multiprocesso visível nesse módulo. Launcher cria repositório em `airi/apps/lia-app/src/main/lia-host.ts:316`; Stage cria em `transport-config-service.ts:20-30`. É necessário provar se apontam ao mesmo arquivo e se há coordenação externa no modo testado.
- **Condições/impacto:** dois escritores de processos diferentes, se compartilharem arquivo e ambos lerem mesma revisão antes de escrever, podem perder atualização. **Correção:** owner único ou lock/CAS real envolvendo leitura, comparação e escrita. **Testes:** dois processos reais sincronizados por barreira, crash e recuperação em Windows, aliases de caminho e conflito de revisão.

### Vault, CAS e rollback — controles encontrados

`airi/packages/lia-core/src/secrets/vault.ts:129-133,170-181,210-230` usa cipher injetado, recusa escrita sobre conteúdo ilegível e verifica revisão sob `withVaultWriteLock`; `vault-lock.ts:6-12,14-49` usa endpoint de lock entre processos com timeout e liberação no finally. `lia/core/src/credentials/owner-channel.ts:29-39,46-64,80-91,94-101,130-160` restringe operações, exclui scope OIDC, consome ambiente e usa token aleatório com comparação constante; o próprio código não o apresenta como proteção contra malware do mesmo usuário. Launcher `ai-connection-service.ts:316-349,400-424` tenta backup/rollback e deixa registro desabilitado antes de alterar credencial. Esses controles são positivos, mas não demonstram transação atômica de todas as configurações ou segurança de todo segredo. Testes de rollback, crash e corrida reais de múltiplos processos/Windows permanecem necessários; não se abriu vault real.

## 4. Ferramentas e capacidades

### Estado do gate e caminhos normais

`airi/packages/stage-ui/src/stores/ai/chat-llm/tools.ts:76-110,120-136,139-178` implementa `enabledById`, default habilitado, filtro em `activeTools` e `getToolsByNames`, e wrapper que consulta novamente o ID antes de executar. Re-registro e remoção preservam o mapa. `chat.ts:451-462,553-560,824-855` resolve referências atuais/históricas por nome; retry volta ao envio e rerun chama `resolveLlmTools` usando `getToolsByNames`. `tool-call-rerun.ts:77-104,116-143` exige chamada correspondente no histórico e executa ferramenta encontrada.

A decisão documentada em `docs/reports/LIA-A1-TOOL-ENABLEMENT-2026-11-14.md:142-184` mantém `get_weather`, `image_journal` e widgets habilitadas, sem UI agora. `defaultActive:false` apenas remove inclusão ambiente; chamadas explícitas das UIs permanecem intencionais. O mapa é memória sincronizada (`tools.ts:82,192-195`), sem persistência própria, e não foi identificado chamador de produção de `setToolEnabled`; reinício/persistência e política de produto futura não foram comprovados em Electron. Não se pode apresentar o gate atual como controle global de segurança de todas as capacidades.

### TOOL-01 — Schema capturado antes da desabilitação pode persistir na resolução

- **Severidade:** MÉDIO, condicional a mudança concorrente. **Estado:** confirmado em bancada do resolvedor real; execução do executor desabilitado foi bloqueada.
- **Evidência:** `tool-resolver.ts:77-81,128-154` captura `activeTools` antes de aguardar outras fontes; `tools.ts:98-110` consulta o estado ao executar, mas não remove o schema já capturado. `evidence/lia-audit-ae46c4/tools-probe.ts` aguarda fonte custom sintética, desabilita ID e libera a resolução: resultado contém schema, `ToolDisabledError` é lançado e `rawCalls=0`. Testa composição em memória, não envio real ao provider.
- **Impacto/condições:** se desabilitação ocorrer enquanto resolução está em andamento, a lista pode manter nome/schema após o desligamento; esse wrapper não permite executar o executor registrado no teste. Não prova envio de fato nem execução indevida. **Correção:** revalidar no último ponto antes da apresentação, definir snapshot/revogação de turno e tornar clara a política de operações já iniciadas. **Testes:** barreiras antes/depois da resolução, SDK/provider simulado verificando payload, executor bloqueado e concorrência entre janelas.

### TOOL-02 — Colisão de nome permite outra fonte em send/rerun

- **Severidade:** MÉDIO, dependente de nomes/IDs e fontes coexistentes. **Estado:** comportamento de composição confirmado com fontes sintéticas; não é execução do ID desabilitado nem prova de exploração de produto.
- **Evidência:** `tool-resolver.ts:128-154` mescla built-ins, debug, Spark, web search, custom e ativos por **nome**, sem filtro global para IDs desabilitados; `chat.ts:851-856` usa essa lista no rerun, que procura pelo nome. A bancada `tools-probe.ts` desabilita ID registrado e insere outra fonte sintética com mesmo nome: `getToolsByNames` retorna vazio, mas rerun chama o executor da **outra fonte** (`altCalls=1`, `rawCalls=0`). Os testes `tool-resolver.test.ts:168-175,190-243` injetam fontes alternativas vazias nos casos de habilitação, não cobrem essa colisão.
- **Caso real limitado:** Stage registra IDs `mcp:builtIn_mcpListTools` e `mcp:builtIn_mcpCallTool` (`src/renderer/stores/tools/mcp.ts:22-32`); resolvedor também inclui `mcp()` com mesmos nomes (`stage-ui/src/tools/mcp.ts:93-129,134-158`). Quando o registro real fica fora, o fallback pode deixar schema homônimo na lista, mas seu runtime é explicitamente indisponível: **não se demonstrou execução do MCP real por esse fallback**. Outra colisão executável depende de configuração/fonte concreta; não foi demonstrada em produção.
- **Correção:** identidade canônica e política comum para todas as fontes; impedir colisões ambíguas ou resolver nomes por ID/autorização, sem ressuscitar definição de menor precedência quando a escolhida estiver desligada. **Testes:** MCP real/fallback, plugin/custom com mesmo nome, send, retry, rerun, disable/re-enable e colisão entre dois IDs; verificar schema e efeitos.

### TOOL-03 — Gate não é autorização do Main nem cobre todas as fontes

- **Severidade:** MÉDIO para promessa de controle global; **estado:** escopo limitado confirmado, abuso não demonstrado. `tool-resolver.ts:137-151` adiciona fontes próprias; `docs/reports/LIA-A1-TOOL-ENABLEMENT-2026-11-14.md:98-107,176-184` reconhece MCP fallback/debug/Spark/web search fora do store e ausência de persistência. APIs diretas de widgets/MCP no Main são outra superfície, não necessariamente passam pelo wrapper do modelo.
- **Condições/impacto:** uma futura UI que prometa desligar toda capacidade sem cobrir outros caminhos, reinício ou chamadas diretas induziria falsa segurança; hoje não há UI identificada para essa promessa. **Correção:** política de capacidade no lado executor/Main onde necessário, escopo explícito por recurso e persistência antes de prometer controle durável. **Testes:** fontes independentes, IPC direto, reinício, sincronização entre janelas e revogação durante chamadas já em voo.

## 5. Arquitetura, cadeia de suprimentos e distribuição

Launcher coordena Stage e owner de credenciais (`airi/apps/lia-app/src/main/lia-host.ts:316-419`); Stage Main fornece plataforma e transporte; Renderer monta interação, histórico e ferramentas; `lia/core/src/providers/runtime.ts` e `transports/` fornecem contratos/runtime. Há exceções legadas: OIDC e providers não curados no Renderer, e múltiplas superfícies de configuração. A existência de um diagrama de autoridade única não prova que toda seleção ou execução passe por um único owner.

### DIST-01 — Dependências, downloads e licenças pendentes

- **Severidade:** MÉDIO; pode bloquear distribuição externa conforme requisitos legais. **Estado:** riscos documentais/configuração confirmados; pacote atual não inspecionado.
- **Evidência:** `airi/pnpm-workspace.yaml:458-491` permite scripts de instalação em vários pacotes, inclusive componentes nativos. `airi/packages/lia-core/src/voice/engines/kokoro/manifest.ts:17-29,68-76` fixa hash de modelo e `kokoro-onnx`, mas lista `soundfile` sem versão/hash e não fixa ali o grafo pip transitivo. `docs/licenses/THIRD-PARTY-NOTICES.md` registra pendências Spine/Cubism e notices de inventários anteriores; `docs/product/evidence/2026-11-08-beta-performance-comparison.json` relata instalador anterior sem assinatura, não valida o artefato deste SHA.
- **Impacto/condições:** build/provisionamento depende de insumos externos; distribuição sem revisão de direitos/avisos ou integridade pode comprometer segurança e conformidade. Nenhum comprometimento foi observado. **Correção:** lock/hashes transitivos, SBOM, revisão dos scripts, build controlado, assinatura e inventário/licenças dos bytes da release real. **Testes:** instalação limpa, hash alterado, assinatura inválida, builds reproduzíveis, notices e direitos efetivos.

### DIST-02 — Updater upstream em modos não gerenciados

- **Severidade:** MÉDIO condicional. **Estado:** configuração confirmada; instalação incorreta não demonstrada. `airi/apps/stage-tamagotchi/src/main/index.ts:262-266` desabilita updater quando `LIA_MANAGED=1`, nome `lia-stage` ou Steam; `services/electron/auto-updater.ts:39-40,308-325,410-431,521-528` contém origens upstream e instalação, com `autoDownload=false`. Se um artefato Lia for executado fora dessas condições, pode consultar/oferecer releases upstream. **Correção:** política explícita de feed e assinatura por distribuição, fail-closed. **Testes:** modo gerenciado/standalone, nome e env reais do pacote, feed incorreto, recusa de usuário e assinatura inválida.

## 6. C0–C4 e experimento de runtime único

`docs/architecture/LIA-DESKTOP-ENGINE-EVALUATION.md:118-141` define C0 desktop/Shell/renderer vazio, C1 avatar estático, C2 idle animado, C3 interação/fala roteirizada, C4 invisibilidade em estados separados. O protocolo propõe 60 s aquecimento, 180 s por janela e cinco repetições; não são resultados.

`docs/reports/LIA-WINDOWS-INTEGRATED-VALIDATION.md:155-159,187,224-228,255-256` declara C0–C4 NOT RUN naquela rodada, inclusive após adendo; adaptador observado foi virtual Parsec e não comprova RX 580 física. `docs/reports/LIA-DESKTOP-RUNTIME-ARCHITECTURE-DECISION.md:290-325` contém medições exploratórias anteriores não comparáveis entre si, sem GPU/FPS/energia/jogos; `:481-510` registra experimento de runtime único NOT RUN. Documentos registram relatos, não arquivos brutos aqui reproduzidos; não se conclui que Electron é insuficiente ou superior a alternativas.

Para fechar o gate, aprovar critérios antes da coleta; fixar commit, diff, hardware/driver/adaptador real, cena/avatar, janela, serviços e árvore de processos; medir controles C0–C4 no produto atual, e em seguida experimento de runtime único e alternativas com paridade. Guardar resultados brutos, metodologia, dispersão e hashes; ausente = NOT RUN/N/A. Não confundir C0–C4 de performance com etapas homônimas de outro plano.

## 7. Bloqueadores recomendados para beta

1. Decidir incluir ou excluir OIDC e provar implementação correspondente; SEC-01/02/03 são relevantes se o fluxo estiver acessível.
2. Controlar destino e uso de credenciais (SEC-04/05), restringir MCP/execução privilegiada e tratar TLS condicional (SEC-06/07).
3. Validar política de ferramentas e limites efetivos do gate (TOOL-01/02/03), sem mudar a decisão atual de mantê-las habilitadas.
4. Executar produto candidato limpo no Windows: Launcher → Stage → AI Settings → conversa real controlada → tool call autorizado → resultado → persistência/reabertura → encerramento; voz e recuperação de falha quando no escopo. Os testes atuais não substituem esse fluxo.
5. Verificar pacote exato, assinatura, instalação e licenças/notices, e preencher gate de desempenho/arquitetura conforme orçamento aprovado.

## 8. Plano priorizado

| Prioridade | Ação | Critério de saída |
|---|---|---|
| P0 | OIDC: owner Main ou exclusão efetiva; cancelar/inutilizar refresh e sessão anteriores ao logout | Electron com issuer fixture, concorrência e inspeção sem tokens no Renderer; decisão de escopo aprovada |
| P0 | Vínculo endpoint/credencial e remoção da leitura legada | Testes IPC de sender, alterações não autorizadas, uso customizado aprovado, canários e rollback |
| P0 | MCP/TLS: reduzir privilégio, ancorar confiança criptográfica | Testes de processo sintético, política de ferramenta, CA falsa e janelas não autorizadas |
| P1 | Resolver concorrência de schema e colisões de fontes; política comum de capacidades | Testes send/retry/rerun e IPC direto; esclarecer se desligamento é persistente ou não |
| P1 | Validar CSP, logs, lock/CAS multiprocesso e recuperação | Testes de pacote, canários, concorrência e crash em Windows |
| P1 | Gate funcional, distribuição, licenças e proveniência | Artefato assinado/hash, instalação limpa, SBOM/notices, testes e logs sanitizados ligados ao SHA |
| P2 | Executar C0–C4 e experimento de runtime único | Protocolo e critérios aprovados, dados brutos e comparação com paridade |

## 9. Evidências, comandos e limites

### Comandos executados

- Identidade/preservação: `git status --short`, `git branch --show-current`, `git rev-parse HEAD`, `git cat-file -t`, `git diff --name-status HEAD ae46c495d7da7cd33f4b4da8f4e8cc95b0a867b6`, `git diff --check HEAD ae46c4 -- airi/packages/stage-ui`; `gh api repos/BloomRX/Lia-Project/commits/ae46c495d7da7cd33f4b4da8f4e8cc95b0a867b6`; fetch por SHA e `git archive` em `/tmp`.
- Revisão: `rg -n` de canais, handlers, `enabledById`, chamadas de OIDC e caminhos de ferramentas; `nl -ba`/`sed` nos arquivos citados; comparação explícita com `5ec464e` dos caminhos OIDC/vault/transportes/Launcher, sem alterações entre esses recortes.
- Testes **sobre o snapshot extraído de `ae46c4`**, Node `v22.22.3`: `node --experimental-strip-types --test test/*.test.ts` nos diretórios `lia/core`, `lia/stage` e `lia/launcher`. Resultados respectivamente **105/105**, **9/9** e **8/8**, zero falhas/skips reportados; não são suites Electron.
- Reproduções de ferramentas e auth: [README e quatro scripts](evidence/lia-audit-ae46c4/README.md), usando módulos reais do snapshot, fixtures explícitas, npm com `--ignore-scripts` e dependências instaladas apenas em pasta temporária. Ambas passaram com os resultados detalhados em SEC-02 e TOOL-01/02. Não houve rede de produto ou token real. O primeiro empacotamento do probe auth falhou por resolução de `vue` no stub e foi corrigido apenas na bancada; uma assertion inicial de ferramenta falhou por propriedade `isError: undefined` e foi ajustada à estrutura observada antes da execução final bem-sucedida.

### Documentos e evidências não reproduzidos

A referência relata 13/13 testes de store, 11/11 de resolver, 7/7 de rerun e 1/1 built-in em `f3facdf` (`LIA-A1-TOOL-ENABLEMENT-2026-11-14.md:109-129`); esses valores são **relatos**, não foram reexecutados aqui. `docs/reports/evidence/lia-windows-integrated-validation-0818305/manifest.md:4-18` associa evidência a outro SHA, registra worktree inicial sujo, ausência de logs brutos e screenshots; `Tests/artifacts/` é ignorado por `.gitignore:8-20`. Não se presume que artefatos externos não existam; não foram disponibilizados/validados nesta rodada.

**Não executado:** suite completa `pnpm`/Vitest AIRI, build/typecheck, Electron empacotado, Windows, issuer/provider externos, IPC de todas as janelas, análise exaustiva de plugin/frame, pentest, CVEs por versão, áudio, C0–C4, runtime único ou inspeção do instalador atual. O ambiente não tinha `airi/node_modules` nem `pnpm`; a instalação temporária dos probes não é instalação do workspace. Conclusões são limitadas ao código e experimentos descritos; documentação não é prova de execução nem aprovação de release.
