# M1 Fase 5 — Round 7, hotfix 4: `localAppData` nunca existiu + registro IPC refém do filesystem

Adendo ao `M1-PHASE5-R7-UI-HOTFIX3-CLICK-TRACE.md`. O trace do hotfix 3 fez
exatamente o que foi projeto: impresso no renderer estavam `install-click`,
`install-handler-enter install` e `install-invoke false`, e no main apareceu
`Error: Failed to get 'localAppData' path` com `runtimeRootLayout →
runtimeRootDir → registerLiaBootstrapBridge` na stack.

## 1. `localAppData` era ou não key válida no Electron atual

**Não era, em nenhuma release do Electron.** A API `app.getPath(name)` aceita
um conjunto fixo de nomes (`home`, `appData`, `userData`, `cache`, `temp`,
`exe`, `module`, `desktop`, `documents`, `downloads`, `music`, `pictures`,
`videos`, `recent`, `logs`, `crashDumps`) e `localAppData` **não está entre
eles** — o que o próprio tipo do TypeScript dizia. Um cast previu o tipo como
"suportado em runtime no Windows" e estava errado: Electron lança
`Failed to get 'localAppData' path` quando pede uma chave desconhecida, e o
ramo `platform === 'win32'` nunca executava nas nossas bancadas Linux. O cast
ficou visível e foi removido; a origem suportada é agora validada (item F
abaixo e item I.3 deste relatório).

## 2. Por que a exceção impedia o main handler

`registerLiaBootstrapBridge` resolvia o root de forma **eager**: a store de
estado persistida precisava de um diretório, e a linha
`createRuntimeStateStore(runtimeRootDir())` rodava no corpo do registro, no
arranque do app. Com a key inventada quebrada no Windows, o throw saía do
injeção de dependências do main — matando o registro de TODOS os handlers de
bootstrap (`run`, `state`, `cancel`, `remove`) antes de existirem. O bridge
de **runtime** (registrado antes na mesma injeção e sem path eager no registro)
sobrevivia, então o renderer mostrava estado e o clique via trace, mas nada
chegava ao handler — exatamente as três linhas presentes e as duas ausentes
que o hotfix 3 deixou preparado.

## 3. Estratégia final de `%LOCALAPPDATA%`

`process.env.LOCALAPPDATA` em `platform === 'win32'`, validada antes de uso
(`voice-runtime-root.resolveLocalAppDataDir`, função pura exportada):

- **existe** (ausência = falha clara nomeando a variável — nunca roaming);
- **absoluta no formato Windows** (aceita drive-letter `C:\...` e raiz UNC
  `\\servidor\...`);
- **livre de caracteres da blacklist** do instalador silencioso do AllTalk
  (a mesma pinada em `ATSETUP_BLACKLIST_CHARS`; o erro cita a lista);
- fora do Windows, retorna `''` sem consultar nada — o layout resolver do
  root só lê esse valor em win32.

O alvo continua arquiteturalmente o mesmo (item B):
`%LOCALAPPDATA%\Lia\runtimes\alltalk`, sem voltar a Roaming.

## 4. Root resolution ficou lazy? Sim, nas duas pontas sensíveis

- `registerLiaBootstrapBridge` não toca em path nenhum agora: a store de
  estado persistida vira um getter com cache que só executa dentro de
  `ensureBootstrapper`, no primeiro uso real;
- `runAndPublish` envolve desde `ensureBootstrapper()` até o `run()` num
  try/catch que converte a exceção de resolução em **falha de bootstrap
  estruturada** (`phase: 'failed'`, os 5 steps pendentes conhecidos do card,
  log `[LIA-VOICE-BOOTSTRAP] bootstrap failed <detalhe>`), publica no canal e
  responde ao invoke normalmente — após a linha de trace
  `install-main-received` (item D satisfeito por construção);
- a leitura de estado (`electronLiaBootstrapState`) sob root quebrado devolve
  o estado idle (not-installed) com `console.warn`, então o card continua
  montando e oferecendo a ação.

## 5. Teste: invoke chegando ao main mesmo com root quebrado

`voice-runtime-bootstrap-service.test.ts` (novo): mocka `runtimeRootDir` e
`runtimeAppDir` para lançarem (a falha do QA), registra o bridge, e faz a
volta completa renderer→main com os adapters eventa reais:

1. o registro **não lança**;
2. `install-main-received` é impresso antes de qualquer trabalho pesado (item
   D);
3. o invoke resolve para `{ phase: 'failed', failureCategory: 'setup', steps:
   [5 × pending] }` — estado estruturado, checklist conhecido do card;
4. o estado failed também chega ao renderer por `electronLiaBootstrapChanged`;
5. com root quebrado, a leitura de estado devolve not-installed e a ação
   'equal-iteration' de repair segue o mesmo formato.

Mutation obrigatória: voltar a resolução do root para dentro do registro faz
os 3 testes falharem com `expected [Function] to not throw ... Failed to
resolve the local runtime root`. O teste do root Windows
(`resolveLocalAppDataDir` → layout completo →
`C:\Users\Test\AppData\Local\Lia\runtimes\alltalk`, sem `@`, sem `Roaming`,
absoluto, blacklist-livre; ausente/relativo/proibido = erros claros; off-win
= no-op) vive em `voice-runtime-root.test.ts`.

## 6. SHA

Hotfix 4: **`d32d778`** — "fix(lia): resolve %LOCALAPPDATA% from the environment and keep IPC registration lazy (round-7 hotfix 4)".
Suítes: **550/550 verdes** (services main incl. novos testes E/F, componentes
de config, stores, shared), `vue-tsc --noEmit` 0 erros, eslint limpo nos
arquivos tocados. Nada foi tocado em Miniconda, comandos pós-Miniconda, pin do
AllTalk, lista de pacotes, launchers, TTS ou na Voice UI (item G). O installer
continua **sem** condição PASS; o esperado do próximo QA Windows é a sequência
completa logada — renderer 3 linhas, main `install-main-received` +
`bootstrap start install` — e daí o backend da Round 7 seguindo normalmente.
