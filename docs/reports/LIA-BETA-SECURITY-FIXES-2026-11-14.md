# Correções de segurança — beta interno, 14/11/2026

## Situação e SHAs

**Entrega parcial; NÃO liberar o beta com base neste relatório. OIDC-OFF ainda não está implementado nem demonstrado.** Voz e STT continuam obrigatórios, sem validação Windows ou E2E nova. Não há prova nova de exploração real.

- Base solicitada e examinada: `407300b8baa56b0ed8d14b7b2c0628222754e51f`, consolidada no merge local `56b1a3e090d867b67d7711beec7e16bbc5321e16` com a auditoria anterior `e8a44c2`.
- Correções isoladas: `7ea61ca` (TOOL), `e25b7d4` (HTTP de credenciais), `013e4fd` (refresh/sessão). SHA final do conjunto de código examinado: `013e4fd` (o commit deste documento é posterior; obter seu SHA por `git log -1`).
- Plano atualizado consultado no remoto: `0bf0629263ba2c030efe07fc070283a4e025467a`, apenas documentos. Codex é responsável por preparação Windows sem evidência oficial enquanto há código em voo; não foi possível verificar a atividade efetiva em outro ambiente nem obter lock. Nenhum trabalho de voz/STT foi alterado. Não se alterou `CURRENT-STATE.md`, reservado ao principal.
- `docs/reports/LIA-INDEPENDENT-AUDIT-5ec464e-2026-11-14.md` permaneceu não rastreado e fora dos commits. `tools/stt-bench/RX580-GPU-FEASIBILITY.md` já estava ausente no início; não foi removido.

## TOOL-01/02 — corrida e colisão

**Achado:** a resolução assíncrona poderia capturar schema antes de desabilitação e entregá-lo depois; fonte diferente com mesmo nome poderia sobreviver ao filtro A-1. Reproduções anteriores usam fontes sintéticas; não provam colisão real em produção nem execução de executor registrado desabilitado.

**Alteração:** último filtro síncrono antes de `streamText`, wrappers revalidam execução; proveniência de ferramenta registrada é mantida localmente. Nomes com qualquer registro explicitamente desabilitado bloqueiam todas as fontes de mesmo nome, incluindo seleção explícita/rerun e objetos capturados. Isso é deliberadamente conservador e pode impedir uma ferramenta independente de mesmo nome. `defaultActive` continua apenas controlando inclusão ambiente; enablement A-1 é preservado. Reabilitação explícita é permitida; fontes sem nome de registro não recebem gate novo por ID.

**Arquivos:** `airi/packages/core-agent/src/{types/llm.ts,runtime/llm-service.ts,runtime/llm-service.test.ts}` e `airi/packages/stage-ui/src/stores/ai/chat-llm/{tools.ts,tool-resolver.ts,tool-resolver.test.ts,llm.ts,llm.test.ts}`. Testes cobrem barreira após resolução, dispatch, colisão, rerun e objeto capturado. Suite isolada: 99/99 PASS, condições abaixo. Não demonstra o loop real do modelo nem propagação interprocesso/entre janelas.

## SEC-01/02 — OIDC (aberto para beta)

**Achado:** Main legado envia tokens ao Renderer; store compartilhada os persiste em `localStorage`. A restauração após logout offline foi observada anteriormente em bancada sintética, não contra issuer real.

**Correção parcial isolada:** `airi/packages/stage-ui/src/stores/auth.ts` e `auth.test.ts`: geração invalida refresh e respostas de sessão antigas; logout limpa antes de aguardar rede; finalização antiga não limpa tentativa mais nova; exceções de refresh/logout não são registradas com texto potencialmente sensível. Regressões com refresh atrasado, logout pendente e resposta de sessão antiga PASS na suite isolada. Não prova revogação no issuer, coordenação entre janelas, nem impede callback de login em voo após logout. Não elimina tokens do Renderer, portanto SEC-01 segue aberto e SEC-02 não é considerado integralmente fechado.

**Entradas identificadas (inventário de código, não garantia de exaustividade):** serviço Main `apps/stage-tamagotchi/src/main/services/airi/auth.ts` registra `electronAuthStartLogin`, abre fluxo PKCE/loopback, troca código e publica `electronAuthCallback` com tokens. É criado para as janelas `main/rpc/index.electron.ts`, `settings/rpc/index.electron.ts` e `onboarding/index.ts`. Renderers acionam login em `pages/onboarding.vue`, `pages/settings/account/index.vue` e `components/stage-islands/controls-island/controls-island-auth-button.vue`; `bridges/electron-auth-callback.ts` chama `completeSignIn`. `renderer/App.vue` inicializa estado persistido; `stage-ui/src/libs/auth.ts`, `auth-oidc.ts`, `auth-fetch.ts`, `auth-client.ts` e `stores/auth.ts` contêm outras entradas de callback, troca, sessão e refresh. `renderer/main.ts` registra handler de browser. Componentes Main-only `oidc-session.ts`, `oidc-link.ts`, `oidc-account.ts`, `oidc-http.ts` e `oidc-sockets.ts` são preparação e não demonstram que o caminho legado está isolado.

**Proposta para OIDC-OFF temporário, sem decidir remoção do produto:** guard de capacidade no Main do perfil Lia beta, negando eventos de login e qualquer callback/token antes de abrir navegador/loopback ou trocar código; invalidar trabalhos pendentes; não emitir tokens ao Renderer; impedir inicialização/refresh/callback compartilhados para esse perfil e limpar sem ler nem registrar valores dos cinco campos legados `auth/v1/*` de token, refresh, ID, client ID e expiração em todos os perfis/janelas relevantes. Desabilitar entrada visível e consumidores de sessão, não apenas esconder UI. Revisar Eventa, browser authorization, dados de outras partições e componentes Main-only. Outros perfis upstream exigem avaliação de compatibilidade; não fazer `isStageTamagotchi()` equivaler silenciosamente a Lia, pois cobre Electron em geral. Não está implementado aqui.

**Testes ainda necessários:** chamadas IPC forjadas de cada janela sem abrir browser/servidor nem emitir tokens; callback e refresh pendentes após OFF/logout; inicialização com armazenamento legado em múltiplas janelas; restart e inspeção de storage/DOM/log com canários; captura de rede sem auth no uso normal; dependências de conta/voz; suite Electron e Windows no SHA candidato. Só esses resultados podem demonstrar indisponibilidade efetiva no beta. Se produto decidir ativar OIDC futuramente, exige sessão Main-only, migração, política de revogação/issuer e validação independente; manter OFF até lá.

## SEC-04/05 — credenciais e destino (parcial)

**Achado:** scopes legados não catalogados podem ser lidos via bridge; mudança de endpoint em Stage pode redirecionar Bearer para endereço escolhido sob controle indevido do bridge. A evidência anterior é um fetch simulado de Core, sem tráfego real ou Electron E2E. Launcher possui controles diferentes.

**Alteração:** `lia/core/src/providers/runtime.ts` recusa antes de fetch anexar credencial em HTTP fora de `localhost`, `127.0.0.1` e `[::1]`; HTTPS segue com validação normal e redirect recusado. HTTP sem credencial continua permitido. `lia/core/test/providers.test.ts` testa destinos externos/LAN falsos, loopback, ausência de fetch e uso sem chave. Core 107/107 PASS. Impacto: serviços LAN HTTP com chave deixam de funcionar no runtime Core; use HTTPS ou um endpoint local. Loopback não protege contra processo local malicioso.

**Limite:** HTTPS em host atacante ainda é permitido se endpoint for alterado; não há vínculo de credencial a origem aprovada nem confirmação/CAS completa no Stage. Leitura de scopes legados permanece, portanto SEC-04/05 **não estão fechados**. Resolver exige inventário/migração e regra de autorização no Main para mudança de origem, preservando clientes customizados. O serviço Main de fala já valida HTTPS ou loopback; adaptador de transcrição contém validação semelhante, mas não foi alterado nem exercitado nesta entrega.

## Verificações e limites

- Node `v22.22.3`: em `lia/core`, `node --experimental-strip-types --test test/*.test.ts`: 107/107; mesmo comando em `lia/stage`: 9/9; em `lia/launcher`: 8/8. Testes locais, não E2E.
- `docs/reports/evidence/lia-beta-security-2026-11-14/run-isolated-vitest.sh`: 99/99, seis arquivos. Copia fontes reais para diretório temporário, instala dependências npm com versões explícitas e substitui módulos de rede, UI, timers e ferramentas por fixtures; não é configuração Vitest oficial, não executa Electron, provedores, ferramenta real ou issuer e não faz typecheck completo. Logs de erro genéricos emitidos por testes negativos são esperados.
- `git diff --check`: PASS antes dos commits de código. Typecheck completo, suite AIRI oficial, browser/Electron, teste de rede e Windows físico: NOT RUN. Não há evidência de revogação real de sessão, STT ou TTS reais nesta execução.
- SEC-03/06/07/08/09, demais achados e gates de distribuição/áudio/Windows permanecem conforme auditoria e plano; nenhuma documentação aqui constitui correção. TLS/certificados não foram enfraquecidos. Não se declara o beta seguro ou pronto.
