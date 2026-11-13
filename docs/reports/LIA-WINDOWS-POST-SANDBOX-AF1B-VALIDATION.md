# Validação Windows após sandbox do Stage e AF-1b

**Rodada:** PROMPT-44
**Data:** 13/11/2026 (UTC-03)
**Branch:** `arena/01a10290-lia-project`
**HEAD base testado:** `879a5f328588aaec53e5207ccc691f5b1e6b65e6`
**Resultado geral:** testes e builds automatizados passaram; a prova funcional do
Launcher/Stage real ficou bloqueada por falta de interação com desktop nesta sessão.
Não aprova a Lia ponta a ponta.

## 1. Ambiente e preservação

| Item | Resultado |
|---|---|
| SO | Windows 11 Home, versão 10.0.26200, build 26200 |
| PowerShell | 5.1.26100.9818 |
| CPU reportada | AMD Ryzen 5 5500 |
| Node.js / pnpm | v26.8.1 / 11.24.0 |
| Electron Stage | 43.4.1 |
| Branch / upstream | `arena/01a10290-lia-project` / `origin/arena/01a10290-lia-project` |
| HEAD local e upstream observado | `879a5f328588aaec53e5207ccc691f5b1e6b65e6` |
| Índice | Limpo |
| Worktree | Já estava sujo antes da rodada; todas as mudanças abaixo foram preservadas |

O código executado tinha como base o HEAD informado, mas **não foi um checkout limpo**.
Alterações preexistentes não foram stageadas, editadas ou incluídas neste relatório:

- Modificados: `airi/apps/stage-tamagotchi/src/main/services/airi/oidc-account.test.ts`,
  `oidc-account.ts`, `airi/apps/stage-tamagotchi/src/main/services/lia/transport-execution-service.ts`,
  `airi/packages/stage-ui/src/stores/chat.ts`, `chat/send-error.ts`,
  `chat/send-error.test.ts`, três documentos de OIDC/readiness e
  `docs/project/QUANTO-FALTA.md`.
- Não rastreados: `airi/apps/stage-tamagotchi/scripts/oidc-electron/`,
  `oidc-ipc.ts`, `oidc-resources.ts`, `oidc-resources.test.ts`,
  `airi/apps/stage-tamagotchi/src/renderer/services/lia/oidc-ipc.ts`,
  `airi/apps/stage-tamagotchi/src/shared/eventa/lia-oidc-ipc.ts`,
  `lia-oidc-resources.ts` e `docs/reports/PROMPT-37-CHAT-REAL-PROVIDER-FIX.md`.

`RX580-GPU-FEASIBILITY.md` não foi modificado. No início não havia processos Electron
ou Node preexistentes. `%APPDATA%\Lia` não existia; nenhum arquivo de segredo foi aberto,
nenhuma chave foi impressa/usada e `GROQ_API_KEY` não foi usado como caminho alternativo.

## 2. Build e testes automatizados

Comandos executados nos diretórios indicados:

| Área | Comando | Resultado |
|---|---|---|
| Stage — prerequisite | `pnpm --filter @proj-airi/core-agent run build` (em `airi/`) | **PASS**, exit 0 |
| Stage — typecheck | `pnpm exec vue-tsc --noEmit` (em `airi/apps/stage-tamagotchi/`) | **PASS**, exit 0 |
| Stage — build | `pnpm run build` (em `airi/apps/stage-tamagotchi/`) | **PASS**, exit 0; produziu `out/preload/index.cjs` |
| Launcher — AF-1b/readiness | `pnpm exec vitest run src/main/ai-connection-service.test.ts src/main/ai-selection-integration.test.ts src/main/lia-host.ai-interlock.test.ts` (em `airi/apps/lia-app/`) | **PASS**, 3 arquivos, 47 testes |
| Stage — sandbox/AF-1b direcionados | `pnpm exec vitest run --config vitest.config.ts src/main/services/lia/provider-config-service.test.ts src/main/windows/secure-web-preferences.test.ts src/preload/ipc-channel-policy.test.ts src/preload/shared.test.ts src/main/windows/desktop-overlay/window-contract.test.ts` | **PASS**, 5 arquivos, 13 testes |
| OIDC relatado anteriormente | `pnpm exec vitest run --config vitest.config.ts src/main/services/airi/oidc-link.test.ts` | **PASS**, 1 arquivo, 30 testes |
| Stage — suíte completa | `pnpm exec vitest run --config vitest.config.ts --project node --project browser` | **PASS**, 214 arquivos, 2.557 passaram, 4 skips |
| Launcher — typecheck | `pnpm run typecheck` (em `airi/apps/lia-app/`) | **PASS**, exit 0 |
| Launcher — build | `pnpm run build` (em `airi/apps/lia-app/`) | **PASS**, exit 0 |

A suíte Stage levou cerca de seis minutos. Em vários testes de browser, o console registrou
avisos de UnoCSS, Vue/Pinia, `localStorage` experimental e erros
`ResizeObserver loop completed with undelivered notifications`; a suíte terminou com exit
0. Os 4 skips não foram individualmente classificados. Os logs brutos ficaram apenas nos
arquivos temporários da sessão; este relatório preserva comandos e resultados observados,
sem conteúdo de conversa ou segredo.

## 3. AF-1b e autoridade de configuração

**PASS automatizado** nos 47 testes do Launcher e 13 regressões direcionadas do Stage.
As coberturas executadas incluem seleção canônica ausente, registro gerenciado ausente,
credencial gerenciada ausente/vazia, falhas de leitura, configuração inconsistente,
seleção/modelo obsoleto, seleção não gerenciada válida, recusa de gravação obsoleta ou
gerenciada e interlock entre gravação e início. `isSafeToStart()` não autorizou
implicitamente os casos bloqueados nos testes.

Os erros tipados e os caminhos de escrita foram exercitados pelos testes. A apresentação
visual das mensagens de `ConfigView.vue`, a provocação desses erros pela interface real e
a confirmação de que nenhum escritor legado consegue contornar a autoridade canônica em
runtime são **NOT RUN**.

## 4. Launcher e Stage na aplicação real

| Verificação de runtime | Estado | Evidência / limite |
|---|---|---|
| Iniciar por `.\Lia.bat` | **BLOCKED** | Não iniciado. A sessão está desassistida e o Computer Use não pode ser habilitado nela; não há como acionar a interface e fechar o app com segurança. |
| Janela/renderer do Launcher, logs Main/Renderer/preload | **NOT RUN** | Não houve boot; nenhum log de produto foi coletado. |
| Abrir Stage pelo botão normal do Launcher | **BLOCKED** | Sem controle da janela do Launcher, o fluxo oficial não pode ser acionado. |
| Sandbox efetivo (`sandbox`, `contextIsolation`, `nodeIntegration`) na janela real | **NOT RUN** | Build e testes não substituem introspecção da janela de produto. |
| Preload e IPC da janela real | **NOT RUN** | O build produziu o preload, mas ele não foi carregado por uma janela real nesta rodada. |
| `process`/`require` indisponíveis no Renderer real | **NOT RUN** | Sem renderer de produto acessível. |
| Stage abre, renderer carrega, avatar/animações | **NOT RUN** | Sem janela observável; não inferido pelo build. |
| Comunicação Main–Renderer e recursos anteriores | **NOT RUN** | Nenhum IPC foi acionado pela UI real. |
| Fechamento gracioso e ausência de processos órfãos | **NOT RUN** | Nenhum processo da aplicação foi iniciado nesta rodada. |

Não foi feita prova da configuração efetiva de sandbox/preload/IPC no Stage real. A
evidência Electron de harness em
[LIA-STAGE-SANDBOX-AF1B-FIX.md](./LIA-STAGE-SANDBOX-AF1B-FIX.md) continua válida somente
para o harness, não para a janela de produto.

## 5. AI Settings, conversa, histórico e tool calling

| Verificação | Estado | Motivo |
|---|---|---|
| AI Settings e provider selecionado | **BLOCKED** | Não há perfil padrão em `%APPDATA%\Lia` e não foi confirmado vault disponível. |
| Conexão e modelo `openai/gpt-oss-120b` | **BLOCKED** | Nenhuma credencial previamente cadastrada foi encontrada/confirmada; não foi feita requisição autenticada. |
| Cinco mensagens reais consecutivas | **BLOCKED** | Dependem da credencial e do fluxo UI não acessíveis. |
| Reabrir conversa e validar histórico persistido | **BLOCKED** | Nenhuma conversa real foi criada. |
| Tool call real com `get_weather` | **BLOCKED** | A conversa real não foi habilitada; não houve autorização, execução externa nem resultado meteorológico. |
| Áudio/voz | **NOT RUN** | Dispositivos e providers configurados não foram comprovados; nenhum modelo/peso foi baixado. |

Nenhum mock foi tratado como prova funcional. Não foram inventadas respostas, resultados de
ferramenta ou histórico.

## 6. Reexecução da falha OIDC anterior

O teste que falhou no relatório PROMPT-43 passou isoladamente (**30/30**), e a suíte
Stage completa passou (**2.557 testes, 4 skips**). Portanto, a falha anterior de callback
HTTP 200 após logout **não foi reproduzida** neste reteste.

O worktree tinha alterações locais OIDC/chat, então esta execução não prova causalidade
nem equivalência com um checkout limpo. O teste `oidc-link.test.ts` e os arquivos
`oidc-link.ts`, `oidc-session.ts` e `oidc-session.test.ts` não estavam alterados; as
mudanças OIDC locais identificadas concentram-se em `oidc-account` e novos recursos/IPC,
além de alterações separadas do transporte/chat. Não há evidência nesta rodada de
regressão nova ou de falha atual no teste OIDC, mas a independência causal não foi provada.
Nenhum trabalho OIDC/chat local foi incorporado ao commit deste relatório.

## 7. Conclusão e próxima pendência

- **PASS:** builds/typechecks de Core Agent, Stage e Launcher; regressões direcionadas de
  sandbox/AF-1b; 47 testes AF-1b do Launcher; suíte Stage completa; reteste OIDC.
- **BLOCKED/NOT RUN:** `Lia.bat`, janela real do Launcher/Stage, sandbox efetivo, preload/
  IPC em produto, avatar/animações, conversa, histórico, voz e tool calling.
- **Conclusão:** a correção mantém evidência automatizada positiva, mas o critério
  principal — Launcher e Stage funcionando juntos na janela real — **não foi comprovado**.
  A Lia não está aprovada ponta a ponta.
- **Próximo passo real:** repetir esta rodada numa sessão Windows interativa com controle
  de desktop habilitado; iniciar somente por `.\Lia.bat`, abrir Stage pelo botão normal e
  coletar logs/preferências efetivas. Para AI Settings/conversa/tool calling, é necessário
  que uma credencial válida já esteja no vault acessível; não usar variável de ambiente
  como substituto.
