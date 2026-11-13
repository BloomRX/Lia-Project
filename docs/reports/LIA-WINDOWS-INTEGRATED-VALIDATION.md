# Validação integrada da Lia no Windows

**Execução:** 13/11/2026 (horário local UTC-03; observação final registrada às 00:09:19)
**Branch:** `arena/01a10290-lia-project`
**HEAD do código validado:** `08183053d0c0ffbfe3bc0cfe3e613e1aa21f8dab`
**Escopo:** validação automatizada, boot/fechamento limitado do Launcher e auditoria de
evidências reais. Nenhuma credencial foi lida, criada ou enviada.
**Evidências desta rodada:** [diretório](./evidence/lia-windows-integrated-validation-0818305/)

## A. Ambiente e integridade do repositório

- Windows 11 Home, build 26200; PowerShell 5.1.26100.9818.
- AMD Ryzen 5 5500, 6 núcleos/12 threads, 16 GiB RAM; Radeon RX 580 2048SP, driver
  31.0.21925.1001.
- WMI reportou AdapterRAM próximo a 4 GiB, diferente dos 8 GB informados para a placa.
  Essa leitura não valida a VRAM disponível e não foi usada como medição.
- Node.js v26.8.1; pnpm 11.24.0; Electron v43.4.1.
- `HEAD` local e remoto estavam alinhados no hash acima antes da rodada documental
  (branch sem commits à frente/atrás após `git fetch`). A URL de `origin` era
  `https://github.com/BloomRX/Lia-Project`.
- **Limitação importante:** o worktree já estava sujo no início. As mudanças locais de
  conversa/transporte (`transport-execution-service.ts`, `stage-ui/src/stores/chat.ts` e
  `send-error.ts`, seus testes), alterações OIDC e documentação foram preservadas. Testes e
  builds foram executados nesse worktree; não representam o commit remoto isolado.
  Nenhuma dessas alterações preexistentes foi incluída nesta rodada documental.
- Perfil temporário de teste em `evidence/lia-windows-integrated-validation-0818305/` com
  `voice.enabled=false`, sem credenciais, para evitar o provisionamento automático de voz.
  O perfil real `%APPDATA%\Lia` não continha `lia-product.json` nem `lia-secrets.json`.
- HEAD inicial/final do **código validado**: `08183053d0c0ffbfe3bc0cfe3e613e1aa21f8dab`.
  O commit documental desta rodada e seu HEAD remoto são informados no encerramento da
  execução; não são o código funcional testado.

## B. Build e testes automatizados

Resultados capturados no worktree acima:

Scripts/comandos oficiais correspondentes:

- `lia/core`: `node --experimental-strip-types --test "test/*.test.ts"` (executado em
  `lia/core`).
- `@lia/core` (a partir de `airi/`): `pnpm --filter @lia/core run test`,
  `pnpm --filter @lia/core run typecheck` e `pnpm --filter @lia/core run build`.
- `@proj-airi/core-agent` (a partir de `airi/`):
  `pnpm exec vitest run --root packages/core-agent --project @proj-airi/core-agent`,
  `pnpm --filter @proj-airi/core-agent run typecheck` e
  `pnpm --filter @proj-airi/core-agent run build`.
- `@lia/lia-app` (a partir de `airi/`): `pnpm --filter @lia/lia-app run test`,
  `pnpm --filter @lia/lia-app run typecheck` e `pnpm --filter @lia/lia-app run build`.
- Stage UI (a partir de `airi/`):
  `pnpm exec vitest run --config packages/stage-ui/vitest.config.ts`.
- Stage (a partir de `airi/`):
  `pnpm exec vitest run --config apps/stage-tamagotchi/vitest.config.ts`,
  `pnpm --filter @proj-airi/stage-tamagotchi run typecheck` e
  `pnpm --filter @proj-airi/stage-tamagotchi run build`.
- Contratos de host: script `node --experimental-strip-types --test "test/*.test.ts"`
  do pacote `@lia/contracts`, executado de `lia/core`.
- Launcher real: `.\Lia.bat`; ver §H.

As saídas brutas de cada comando não foram arquivadas nesta pasta; a manifestação dos
scripts acima vem dos manifests vigentes e as contagens foram observadas na execução.
O primeiro comando de contratos foi executado no diretório incorreto, descobriu zero testes
e não foi contado como aprovação; foi repetido em `lia/core`, com os testes reportados
abaixo.

| Alvo | Resultado |
|---|---|
| `lia/core` / `@lia/contracts` (contratos de host incluídos) | **PASS** — 105/105 testes; `host-contract.test.ts` tem 7 casos dentro da suíte |
| `@lia/core` | **PASS** — 381/381 testes; typecheck e build |
| `@proj-airi/core-agent` | **PASS** — 156/156 testes; typecheck e build |
| `@lia/lia-app` | **PASS** — 343 testes aprovados, 2 skips, 36 arquivos; typecheck e build de produção |
| Stage UI | **PASS** — 1.147 testes, 154 arquivos |
| Stage | **PASS** — 2.494 aprovados, 4 skips, 202 arquivos; `vue-tsc` e build Main/preload/renderer |
| `git diff --check` | **PASS** — sem erros; apenas avisos de conversão LF/CRLF em arquivos preexistentes |

O comando completo da primeira tentativa dos contratos não é evidência de teste: reportou
zero testes e foi repetido no diretório apropriado, onde os 105 passaram. Os dois skips do
Launcher são testes de falha de escrita dependentes de permissões POSIX, não reproduzíveis
no Windows. Os quatro skips do Stage não tiveram a causa individual preservada no resumo
de execução; não se presume motivo.

As suítes automatizadas cobrem, entre outros, seleção de provider, concorrência/revisão,
sanitização de credenciais, contratos de host, IPC/preload, catálogo, AI Settings, vault,
política de endpoint, sandbox estático e `provider-config-service`. Isso **não** prova
interação visual, conectividade real com provider ou runtime do Stage.

## C. Segurança

- **Sandbox do Launcher: BLOCKED como prova de runtime.** O código configura
  `sandbox: true`, `contextIsolation: true` e `nodeIntegration: false`; o Launcher abriu
  sob essa configuração. Não foi possível introspectar a propriedade efetiva da WebContents
  em runtime nem inspecionar console/Renderer pela sessão sem UI/CDP.
- **Preload/IPC: PASS automatizado; runtime parcial.** Builds e suítes correspondentes
  passaram. O preload não foi inspecionado pela janela real e nenhum fluxo IPC foi acionado
  visualmente nesta rodada.
- **Stage: BLOCKED em runtime.** O código da janela principal configura `sandbox: false`
  ([main window](../../airi/apps/stage-tamagotchi/src/main/windows/main/index.ts)); a janela
  Stage não foi iniciada para verificar seu estado efetivo ou impacto nesta execução. Não
  inferir que a configuração de sandbox do Launcher se estende ao Stage.
- **Credenciais: BLOCKED para fluxo de cadastro; sem exposição observada.** Não havia
  credencial no perfil de usuário e não foi lido conteúdo de secrets. Não se criou chave
  falsa, não se usou variável de ambiente e não houve chamada autenticada.
- **AF-1: PASS automatizado / NOT RUN na UI.** Política e cobertura de regressão passaram;
  recusa tipada e mensagem compreensível não foram provocadas na janela real.
- **AF-1b: FAIL residual por inspeção estática.** [`ConfigView.vue`](../../airi/apps/lia-app/src/renderer/src/views/ConfigView.vue)
  continua gravando campos de provider/model por `updateConfig`, sem catálogo ou revisão.
  Além disso, [`isSafeToStart()`](../../airi/apps/lia-app/src/main/ai-connection-service.ts)
  retorna `record?.enabled !== false`; para registro ausente, o resultado é `true`. A
  cobertura do serviço de transporte no worktree testado
  ([service](../../airi/apps/stage-tamagotchi/src/main/services/lia/transport-execution-service.ts))
  rejeita registro ausente ao enviar, mas a sequência real Stage→chat não foi exercitada.
  Não se conclui exploração de credencial nem bypass remoto; a falha comprovada é a
  autoridade incompleta e a possibilidade de permitir iniciar a conversa antes de revelar
  erro no envio.
- Não houve alteração de política/código: decidir se aposentar ou redirecionar a tela
  legada exige decisão de produto e validação da UX.

## D. AI Settings

**BLOCKED** para os passos de UI e provider real. O perfil não continha segredo, e Computer
Use não estava disponível na sessão sem assistência; também não havia CDP configurado nem
`agent-browser` instalado. Portanto, catálogo visual, cadastro de chave, teste de conexão,
descoberta do modelo `openai/gpt-oss-120b`, seleção, persistência após reabrir/reiniciar,
troca de provider e estados de erro/recuperação ficaram **NOT RUN**. Testes automatizados
aprovados não substituem esses passos.

## E. Conversa e histórico

**BLOCKED** para conversa real e **NOT RUN** para persistência do histórico. Não houve
credencial de provider, clique/envio pela interface ou resposta do modelo. Mensagem vazia,
erro de rede, timeout, HTTP 429, autenticação inválida e recuperação também não foram
exercitados end-to-end. Nenhuma conversa foi simulada ou inventada.

## F. Tool calling

**BLOCKED — round-trip real não provado.**

- `get_weather` está registrado como `tamagotchi:get_weather`, recebe `city`, é
  `defaultActive: false` e usa geocodificação e API meteorológica externas.
- A ferramenta não foi habilitada nem executada; não foi criada autorização silenciosa nem
  resultado meteorológico fictício.
- Sem AI Settings funcional/credencial e sem interação visual, não houve prova de schema
  enviado ao modelo, emissão estruturada de tool call, decisão de autorização, execução
  externa, retorno ao modelo, resposta final baseada no resultado ou histórico persistido.
- Não se aceita teste unitário, mock, HTTP 200 ou texto que imite tool call como prova da
  sequência real.

## G. Stage e voz

- **Stage: NOT RUN em runtime.** Não foi iniciado; avatar, animações, bridge, persistência
  real e alternância de conversa não foram observados.
- **Voz: NOT RUN.** Não foram testados dispositivos, TTS, STT, interrupção, áudio contínuo,
  dispositivo ausente ou encerramento de áudio. Nenhum modelo/peso pesado foi baixado.
- As suítes, typecheck e build do Stage passaram, mas isso não é gate de runtime.

## H. Desempenho, estabilidade e encerramento

- **C0–C4: NOT RUN.** Não foram executadas cenas nem protocolo de medição; não há medidas
  novas de working set, memória privada/comprometida, CPU, avatar ou conversa. Não comparar
  com resultados antigos sob condições diferentes. A decisão de runtime continua provisória.
- **Inicialização do Launcher: PASS limitado.** Executado pelo caminho oficial `.\Lia.bat`
  com perfil temporário e voz desativada. A janela titulada “Lia” foi localizada como
  responsiva; o log registrou `renderer-ready` em +791 ms. Isso comprova o boot básico da
  janela, não a capacidade de conversar nem o Stage.
- **Encerramento do Launcher: PASS limitado.** A janela recebeu fechamento gracioso; o
  processo terminou com código 0 e a consulta posterior não encontrou processos Electron
  com os PIDs associados à sessão. O Stage não foi aberto; seu ciclo de vida não foi testado.
- Erros de console, reinício repetido, desconexão de rede, troca de conversa e reinício do
  Windows: **NOT RUN**.

## I. Conclusão e estado por área

| Área | Estado | Evidência | Pendência |
|---|---|---|---|
| Build e testes Core | PASS | testes, typecheck/build listados na §B | interpretar como worktree local, não commit isolado |
| Build e testes Launcher | PASS | 343 aprovados/2 skips; typecheck/build | fluxos da UI |
| Build e testes Stage | PASS | 2.494 aprovados/4 skips; typecheck/build | runtime real |
| Sandbox efetivo | BLOCKED | flags configuradas e boot básico | introspecção real da WebContents |
| IPC/preload | PASS automatizado | suíte/build | invocar bridge pela UI real |
| AI Settings real | BLOCKED | sem credencial e UI indisponível | cadastrar/testar/selecionar/persistir |
| AF-1 | PASS automatizado; NOT RUN UI | policy/testes | testar recusa e mensagem na janela |
| AF-1b | FAIL residual | `ConfigView.vue` usa `updateConfig`; ausência de record passa no start guard | decisão de produto e regressão UI |
| Conversa real | BLOCKED | sem credencial e sem interação | resposta real e falhas/recuperação |
| Histórico persistente | NOT RUN | nenhuma conversa real | reabrir app/conversa |
| Tool calling real | BLOCKED | `get_weather` desativada por padrão; sem provider | round-trip autorizado e externo |
| Stage/Avatar | NOT RUN | nenhum Stage iniciado | abrir e verificar renderização |
| Voz | NOT RUN | sem dispositivo/provider testado | TTS/STT, interrupção e fallback |
| Desempenho C0–C4 | NOT RUN | sem medições desta rodada | executar protocolo com cenas equivalentes |
| Encerramento do Launcher | PASS limitado | exit code 0; sem PIDs associados restantes | repetição e ciclo do Stage |

**Realmente pronto:** builds e testes automatizados listados na §B; boot e fechamento
básicos do Launcher, sob perfil de teste.

**Parcialmente pronto:** Launcher abre; os contratos de segurança/configuração têm testes
automatizados, mas não foram validados nas interações reais.

**Bloqueado/não provado:** AI Settings autenticado, conversa e histórico reais, Stage/voz,
tool calling, sandbox efetivo, desempenho e estabilidade do conjunto. **Não declarar a Lia
pronta para uso ponta a ponta.**

**Três riscos principais:**

1. AF-1b ainda permite que `ConfigView.vue` escreva provider/model fora da autoridade
   canônica; seleção gerenciada sem registro não barra o início via `isSafeToStart()`.
2. O fluxo funcional de AI Settings/conversa/tool calling permanece sem prova real e sem
   credencial disponível.
3. O Stage não foi executado e sua janela principal configura `sandbox: false`; voz e C0–C4
   também não foram medidos, então a decisão de runtime não pode ser promovida com base
   apenas em build/testes.

**Próxima ação recomendada:** em uma sessão interativa Windows, com credencial já
disponibilizada no vault e aprovação explícita para usar `get_weather`, concluir primeiro
AI Settings → conversa real → round-trip da ferramenta; depois abrir o Stage e coletar
evidência de voz, encerramento e C0–C4. Separadamente, decidir se `ConfigView.vue` será
aposentada ou redirecionada, sem ampliar a política antes dessa decisão.

**Commits e publicação:** nenhum commit/push da implementação de aplicação foi feito nesta
validação. O HEAD remoto do código testado no baseline era
`08183053d0c0ffbfe3bc0cfe3e613e1aa21f8dab`; o hash do commit documental publicado e o estado
final do worktree serão informados no fechamento da execução. As alterações preexistentes
listadas na §A permanecem fora desse commit.
