# M1 Fase 5 — Round 7, hotfix 3: "cliquei e nada aconteceu"

Adendo ao `M1-PHASE5-R7-UI-HOTFIX-ACAO-PRIMARIA.md`. QA real: o botão
"Instalar sistema de voz" aparece, mas o clique não muda a UI, não mostra
spinner, e o log `[LIA-VOICE-BOOTSTRAP] bootstrap start` nunca aparece. O
pedido era localizar o ponto exato onde o clique morre entre UI → handler →
IPC → main → bootstrap, sem tocar em Miniconda, env, packages, AllTalk,
runtime root, migração, launchers ou integridade (item K — obedecido).

## 1. As cinco linhas do trace

Instrumentação temporária embarcada neste commit (item A), na ordem real do
clique:

1. `[LIA-VOICE-UI] install-click` — entrada do handler do botão
   (`RuntimeInstallCard.vue`);
2. `[LIA-VOICE-UI] install-handler-enter <ação>` — dispatch explícito por ação
   (item F);
3. `[LIA-VOICE-IPC] install-invoke <repair>` — store `runBootstrap`, antes do
   invoke;
4. `[LIA-VOICE-IPC] install-main-received <repair>` — handler do main, ao
   receber;
5. `[LIA-VOICE-BOOTSTRAP] bootstrap start <install|repair>` — o bootstrapper,
   que sempre existiu.

A primeira linha ausente no próximo QA localiza o elo: se a 2 falta, é o
binding/`<button>`; se a 3, é a store; se a 4, é IPC (preload/canal/contexto);
se a 5, é o handler ou o bootstrapper.

## 2. Causa exata

Em aberto até o QA rodar — e isso é uma informação, não evasão: a corrente
inteira foi provada FUNCIONAL em teste de integração full-stack (item C/D/E,
abaixo): DOM real → handler real → store real → adapters eventa reais dos dois
lados → handler do main. Todos os sete pontos do audit (B/H) saíram limpos:

- `#LIA-VOICE-UI` instala-handler existe e o binding de clique aponta para ele;
- botão fora de `<form>`, `type="button"`, sem overlay, sem pointer-events
  anômalo; o binding `disabled` corresponde ao estado;
- **sem emit/prop na corrente** (item G): o card chama a store diretamente, e
  a `VoiceSection` não depende de nenhum listener filho — não existe "emit sem
  ouvinte" possível aqui;
- a ponte eventa é a mesma que entrega `electronLiaRuntimeState` ao renderer —
  e esse invoke **funciona na máquina do QA** (o cartão deriva estado real),
  o que prova preload, `exposeInMainWorld('electron', ...)`, `createContext` e
  nomes de canal saudáveis;
- o handler do bootstrap está registrado em `main/index.ts` junto com o de
  runtime, no mesmo `createContext(ipcMain, mainWindow)` do fix da round 4.

O defeito REAL que a investigação confirmou e corrigiu: a store engolia a
rejeição do invoke **em silêncio** (`catch {}`). Uma ponte quebrada apareceria
exatamente como o sintoma do QA — nada acontece. Esse caminho agora emite
`console.warn('[LIA-VOICE-IPC] install-invoke failed', error)` (permanente —
o silêncio foi o que escondeu o bug). Se a resposta do QA mostrar a linha 3 e
o warn, a 4 ausente, a quebra é IPC-side; com a instrumentação embarcada, o
próximo run diz onde.

## 3. Arquivos responsáveis (esta rodada)

- `renderer/components/lia-config/sections/RuntimeInstallCard.vue` — trace nas
  duas primeira linhas + dispatch explícito install/repair/retry (item F);
- `renderer/stores/lia/runtime.ts` — trace do invoke + fim do catch silencioso;
- `main/services/lia/voice-runtime-bootstrap-service.ts` — trace do recebimento;
- `renderer/components/lia-config/sections/InstallClickFlow.test.ts` — novo.

## 4. Click, emit/listener ou IPC?

Pelo conjunto de evidências: **não é emit/listener** (a corrente não usa
emits), **não é click perdido em overlay/formulário** (auditoria item B) e
**não é canal errado** (mesma ponte e nomes compartilhados entre os lados). Os
suspeitos que sobram exigem o ambiente real: fio quebrado específico da janela
(no QA o app roda empacotado, não no dev-server), alguma proteção do real
`ipcRenderer` (ex.: `invoke`/`send` indisponível naquele preload isolado), ou
um estado que os testes não reproduziram. O trace embarcado cobre os três.

## 5. O teste click→invoke (item C, D, E)

`InstallClickFlow.test.ts` monta a `VoiceSection` REAL com apenas o transporte
IPC falsificado (par em memória, adapters eventa reais nos dois lados), com a
configuração de voz que representa "Minha própria voz" selecionada:

- **C**: estado `not-installed` → clique em `[ Instalar ]` →
  `electronLiaBootstrapRun` invocado **exatamente 1 vez** com `repair=false`;
  em seguida, o main publica 'checking' → o DOM passa a "Preparando o sistema
  de voz…", e publicando 'installing-runtime' → botão mostra "Instalando…"
  desabilitado; clique extra (spam) **não** invoca de novo (item I, sem estado
  local fake);
- **D**: estado `failed` (setup) → `[ Tentar novamente ]` → o MESMO invoke,
  exatamente 1 vez;
- **E**: `repair-needed` e `failed` por saúde do servidor → `[ Reparar ]` →
  invoke exatamente 1 vez com `repair=true`, nos dois estados.

## 6. Mutation (item J)

Três mutações independentes, cada uma detectada por todos os 3 testes

(esperavam `1 chamada`, obtiveram `0`):

1. remover `@click` do botão → 3/3 falham;
2. trocar o canal do invoke na store (apontar para `BootstrapState`) → 3/3
   falham;
3. fazer `runBootstrap` retornar antes do invoke → 3/3 falham.

A mutação "remover listener no pai" não se aplica: a corrente não tem listener
de evento de filho (item G); as mutações 1 e 3 cobrem as duas pontas
análogas. Tudo revertido e re-certificado: **542/542 verdes**, `vue-tsc
--noEmit` 0 erros.

## 7. SHA

Hotfix 3: **`fb0a594`** — "fix(lia-ui): trace the install click end to end +
prove it in tests (round-7 hotfix 3)". Suites: 542 testes passando em serviços do main, componentes de
config, stores e shared. O installer continua **sem** condição PASS — o
próximo passo é o QA Windows com as cinco linhas do trace ATIVAS, e a remoção
da instrumentação temporária (items A) assim que a causa estiver provada no
ambiente real.
