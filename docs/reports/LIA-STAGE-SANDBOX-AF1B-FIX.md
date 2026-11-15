# Correção de sandbox do Stage e AF-1b

**Rodada:** PROMPT-43
**Data/hora da validação:** 13/11/2026, 01:05–01:36 (-03)
**Branch:** `arena/01a10290-lia-project`
**HEAD inicial:** `1b8a7f94aa807849a210f848229c34e96dd95c43`
**HEAD inicial/remoto:** alinhados em `origin/arena/01a10290-lia-project`
**Resultado:** correções implementadas; testes e gates automatizados/Electron aprovados; boot da aplicação Stage real e fluxos de produto pendentes.

Esta rodada corrige os dois bloqueios pedidos. Ela não é uma aprovação de release nem
substitui o gate funcional completo da Lia.

## 1. Ambiente e preservação

| Item | Valor |
|---|---|
| SO | Windows 11 Home, versão 10.0.26200, build 26200 |
| CPU reportada | AMD Ryzen 5 5500 |
| Adaptador gráfico detectado | Parsec Virtual Display Adapter; não comprova presença/uso da RX 580 |
| Node.js / pnpm | 26.8.1 / 11.24.0 |
| Electron Stage | 43.4.1 |
| Branch / remoto | `arena/01a10290-lia-project` / `https://github.com/BloomRX/Lia-Project` |
| HEAD inicial | `1b8a7f94aa807849a210f848229c34e96dd95c43` |

O worktree já estava sujo no início. Alterações não relacionadas, incluindo trabalho de
OIDC, foram preservadas e não fazem parte desta correção. Nenhuma credencial real foi
acessada, registrada ou usada; os gates Electron usam fixtures locais. A validação não
repetiu medições C0–C4 nem provou compatibilidade da GPU física.

## 2. Alterações

### 2.1 Sandbox e preload do Stage

- As configurações das janelas Stage e do desktop overlay usam
  `createStageWebPreferences()`, que fixa `sandbox: true`, `contextIsolation: true`,
  `nodeIntegration: false` e o preload local.
- O teste de regressão percorre as configurações de todas as janelas inventariadas e falha
  se alguma deixar de usar o contrato comum.
- O preload expõe uma fachada com somente `invoke`, `on`, `removeListener` e `send`.
  Cada chamada é validada por canal e operação; os canais Eventa necessários permanecem
  disponíveis, e os canais OIDC de `invoke` são enumerados explicitamente.
- O objeto `IpcRendererEvent` não é repassado ao Renderer: o wrapper não expõe `sender`.
  A validação e a autorização dos handlers continuam no processo Main.
- O build produz um preload CommonJS autocontido em `out/preload/index.cjs`, sem chunks
  relativos incompatíveis com o sandbox.

### 2.2 AF-1b — prontidão e autoridade da seleção

- `getStartReadiness()` centraliza a decisão consumida por `isSafeToStart()` e pelo
  início da conversa/Stage.
- Ausência ou invalidade da seleção canônica, erro de leitura, provider gerenciado
  indisponível, registro ausente/duplicado/inconsistente/desabilitado, endereço inválido,
  modelo fora do registro e credencial ausente/vazia/ilegível resultam em bloqueios tipados.
- Uma seleção gerenciada só fica pronta quando o registro ativo, o modelo e a credencial
  são consistentes. A ausência do registro não autoriza implicitamente iniciar.
- Seleções não gerenciadas válidas continuam fora do gate de transporte gerenciado.
- O host serializa a atualização de configuração com a preparação do Stage. A tela legada
  `ConfigView.vue` envia `expectedPreferred`; alterações obsoletas ou que tentam trocar
  uma seleção gerenciada são recusadas pela política comum. IPC e UI mantêm códigos de
  erro específicos, com mensagens em pt-BR/en-US.
- O bridge de seleção do próprio Stage rejeita alvos malformados ou com campos secretos,
  inclusive em `expectedPreferred`, antes de consultar a política ou persistir.
- O transporte não substitui a decisão de prontidão: o início é bloqueado antes de
  depender da falha tardia da primeira requisição.

## 3. Testes e builds

Comandos executados nos diretórios indicados:

| Área | Comando | Resultado |
|---|---|---|
| `airi/packages/lia-core` | `pnpm test` | **PASS** — 31 arquivos, 381 testes |
| `airi/packages/lia-core` | `pnpm run typecheck` | **PASS** |
| `airi/packages/lia-core` | `pnpm run build` | **PASS** |
| `lia/core` (`@lia/contracts`) | `pnpm test` | **PASS** — 105 testes |
| `lia/core` (`@lia/contracts`) | `pnpm run typecheck` | **NOT AVAILABLE** — o pacote não declara esse script (`ERR_PNPM_NO_SCRIPT`); o helper compartilhado é verificado nos typechecks do Launcher/Stage |
| `airi/packages/core-agent` | `pnpm exec vitest run --root packages/core-agent --project @proj-airi/core-agent` | **PASS** — 13 arquivos, 156 testes |
| `airi/packages/core-agent` | `pnpm run typecheck` / `pnpm run build` | **PASS** |
| `airi/apps/lia-app` | `pnpm run test` | **PASS** — 36 arquivos, 353 passaram, 2 skips |
| `airi/apps/lia-app` | `pnpm run typecheck` / `pnpm run build` | **PASS** |
| `airi/apps/stage-tamagotchi` | `pnpm exec vitest run --config vitest.config.ts --project node --project browser` | **FAIL** — 214 arquivos; 2.556 passaram, 1 falhou, 4 skips; `oidc-link.test.ts` esperava rejeição após logout, mas recebeu HTTP 200 no callback |
| Stage — regressões desta correção | `pnpm exec vitest run --config vitest.config.ts src/main/services/lia/provider-config-service.test.ts src/main/windows/secure-web-preferences.test.ts src/preload/ipc-channel-policy.test.ts src/preload/shared.test.ts src/main/windows/desktop-overlay/window-contract.test.ts` | **PASS** — 5 arquivos, 13 testes |
| `airi/apps/stage-tamagotchi` | `pnpm run typecheck` (`vue-tsc --noEmit`) / `pnpm run build` | **PASS** |
| Stage — Electron | `node --test scripts/provider-runtime-electron/gate.test.mjs` | **PASS** — Electron 43.4.1, fixture HTTP local |
| Stage — OIDC | `node --test scripts/oidc-electron/gate.test.mjs` | **PASS** — issuer fixture local; não é teste de login de produção |

A suíte Stage imprimiu avisos de CSS/UnoCSS, `localStorage` experimental, Vue e mensagens
`ResizeObserver loop completed with undelivered notifications`. O único teste falho foi
`src/main/services/airi/oidc-link.test.ts > main-only browser account linking > composes
real session owner and vault logout during list-accounts`: após logout, uma nova chamada
ao callback resolveu com HTTP 200 quando o teste esperava rejeição. A falha foi reproduzida
também ao executar apenas esse caso. O teste pertence ao trabalho OIDC preexistente e não
alterado nesta correção; por isso foi registrado como **FAIL**, não corrigido neste escopo.
Os avisos de browser não foram tratados como aprovação visual.

O teste `pnpm run typecheck` em `lia/core` foi tentado e retornou `ERR_PNPM_NO_SCRIPT`.
O comando não reportou erro de tipos. Os metadados de pacote (`pnpm-lock.yaml` e
`node_modules` mínimo) criados por essa tentativa na pasta isolada foram inspecionados e
removidos; nenhuma dependência ou lockfile do projeto foi alterado.

## 4. Evidência de segurança

### Sandbox / preload

**PASS no runtime Electron do harness.** O relatório
`Tests/artifacts/provider-runtime-electron/1794543360647/report.json` registrou, para a
janela do harness:

| Propriedade efetiva | Valor |
|---|---|
| `sandbox` | `true` |
| `contextIsolation` | `true` |
| `nodeIntegration` | `false` |
| `webSecurity` | `true` |
| `window.electron` | somente `ipcRenderer` |
| Métodos de IPC expostos | `invoke`, `on`, `removeListener`, `send` |
| `process` / `require` no Renderer | `undefined` |

Esse gate usa o helper de produção e o preload compilado, além de exercitar IPC e o
provider runtime contra fixture local. Ele comprova as preferências efetivas e a fachada
nesse processo Electron de teste.

**NOT RUN para a janela da aplicação Stage real.** Não foi executado `Lia.bat` nem aberto
o Stage pelo botão normal do Launcher nesta rodada. Portanto o gate acima não prova boot,
renderização, preload/IPC da janela principal de produto, áudio ou encerramento da
aplicação Stage. O teste estrutural garante que os call sites de janela usam o helper,
mas não substitui esse runtime gate.

### AF-1b e credenciais

- **PASS automatizado:** ausência de registro gerenciado bloqueia antes de iniciar; seleção
  válida continua elegível; modelo obsoleto e configuração inconsistente bloqueiam;
  provider unmanaged válido permanece elegível; credencial ausente ou vazia e erros de
  leitura não viram autorização.
- **PASS automatizado:** interlock de início/gravação, recusa de seleção obsoleta e recusa
  de troca de seleção gerenciada chegam como códigos tipados à UI.
- **NOT RUN na UI real:** não foi provocado o fluxo visual de recusa de `ConfigView.vue`.
- **NOT RUN com segredo real:** nenhum segredo foi lido, impresso ou usado.

Revisão de segurança limitada aos arquivos alterados: não foi identificado bypass novo
nas fronteiras revisadas. O canal Eventa continua sendo um transporte interno amplo para
os handlers registrados; a allowlist do preload restringe o canal/operação Electron,
mas não substitui a validação e autorização de cada handler Main. Não se declara auditoria
completa do Stage.

## 5. Roteiro da próxima validação Windows

Executar em sessão interativa e pelo caminho normal:

1. Abrir `.\Lia.bat` e iniciar Stage pelo fluxo normal do Launcher.
2. Confirmar que a janela principal renderiza e que o preload/IPC inicializam sem erro.
3. Inspecionar as preferências efetivas da janela Stage: sandbox ligado, isolamento ligado,
   integração Node desligada; confirmar que `require`/`process` não existem no Renderer.
4. Exercitar os canais Eventa e os fluxos autorizados do preload; tentar um canal
   explicitamente negado e confirmar recusa.
5. Validar uma seleção gerenciada válida; depois seleção ausente, registro ausente,
   credencial ausente e tentativa obsoleta. Confirmar erro tipado e mensagem amigável.
6. Confirmar que provider não gerenciado documentado continua compatível.
7. Fechar Stage e Launcher; verificar os PIDs associados à sessão e ausência de órfãos.

Até executar esses passos, a janela Stage real e o fluxo visual de recusa permanecem
**BLOCKED/NOT RUN**.

## 6. Estado por área

| Área | Estado | Pendência |
|---|---|---|
| Core e Launcher; Stage typecheck/build e regressões direcionadas | **PASS** | Stage full suite tem 1 falha em teste OIDC preexistente, reproduzida separadamente |
| Sandbox/preload Stage | **PASS no harness Electron** | Boot da aplicação Stage via `Lia.bat` |
| AF-1b / seleção gerenciada | **PASS automatizado** | Confirmação na UI real |
| Providers não gerenciados | **PASS automatizado** | Compatibilidade visual/runtime |
| AI Settings autenticado | **NOT RUN** | Credencial e interação real |
| Conversa e histórico reais | **NOT RUN** | Provider configurado e fluxo visual |
| Tool calling real | **NOT RUN** | Habilitação explícita, credencial e round-trip |
| Stage avatar / voz / áudio | **NOT RUN** | Inicialização real, dispositivos e providers |
| Desempenho C0–C4 | **NOT RUN** | Máquina e cenas comparáveis; GPU RX 580 não detectada |
| Encerramento do Stage de produto | **NOT RUN** | Boot normal e verificação de processos da sessão |

**Pronto nesta rodada:** a proteção contra autorização implícita e a configuração de
sandbox/preload estão implementadas; Core/Launcher, regressões direcionadas, typechecks,
builds e evidência Electron de harness passaram. A suíte Stage completa teve uma falha
preexistente de OIDC, detalhada acima.

**Parcial/bloqueado:** o Stage real e seus fluxos de produto ainda não foram abertos pelo
launcher oficial; nada nesta rodada prova conversa, tool calling, áudio, desempenho ou
aprovação da Lia ponta a ponta.

**Três riscos principais:** (1) inicialização e interação da janela Stage real pendentes;
(2) AI Settings, conversa e tool calling sem prova real; (3) GPU/performance não validadas
na RX 580, pois o adaptador detectado foi virtual.

**Próxima ação:** executar o roteiro da §5 em uma sessão Windows interativa; depois concluir
AI Settings, conversa e tool calling com credencial autorizada, sem registrar segredo.

**Commits de código:** sandbox `6b17a2656e50f0f62e48a53281eb037aaab67055`;
AF-1b `a34097071b8448ae8950dd7975ab9f133bfc1592`; validação de payload do Stage
`6303cd6f02b615ff12df1cf9e4f8b53e50e26766`. O commit de testes/documentação e o HEAD
remoto final serão identificados no encerramento da execução.
