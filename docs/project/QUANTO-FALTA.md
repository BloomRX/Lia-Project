# Quanto falta — Lia-Project

Escrito para responder, sem precisar perguntar ao Dev: **o que resta, o que um
agente pode fazer sozinho e o que exige a máquina dele.**

Fonte: [`CURRENT-STATE.md`](CURRENT-STATE.md) §0 e §5, medido em
`4a6a811`. Se este arquivo e o `CURRENT-STATE.md` divergirem, **o
`CURRENT-STATE.md` vence** — ele é a fonte de verdade operacional.

---

## Onde o projeto está

06/11 (PROMPT-31): **o harness do gate Electron foi corrigido**, não o produto.
Cinco defeitos medidos pelo PROMPT-30 deixaram de existir: a liveness deixou de
usar PID cru e passou a comparar `(pid, createdAt)`; filhos efêmeros passaram a
ser rastreados por um monitor contínuo em vez de quatro snapshots; o log deixou
de mascarar 2 de 10 segredos (um registro único redige todos, e a escrita recusa
gravar o que ainda contiver valor); o runner passou a registrar a versão do
PowerShell num `environment.json`; e a evidência passou a ser exportada para
`<ExportRoot>/<runId>/` com `manifest.json` e SHA-256, fora da pasta que o
workspace recria. Os 16 grupos ganharam contabilidade que distingue `passed`,
`failed`, `running` e `not-run` — código presente não conta como executado.
Medido no Linux: **142 casos novos, 0 falhas**; suíte da Lia **1524 casos / 91
arquivos, exit 0**; `vue-tsc` exit 0; ESLint exit 0; `git diff --check` exit 0.
**O gate Electron continua NÃO EXECUTADO** (`# pass 0 / # skipped 1`), PowerShell
5.1 e 7 continuam por validar, e o aviso de frame descartado segue como análise
estática. Estado e instruções: [`../architecture/LIA-NATIVE-PROVIDER-COVERAGE.md`](../architecture/LIA-NATIVE-PROVIDER-COVERAGE.md) §17.

02/11 (PROMPT-28): **o cofre do renderer fechou por capacidade** — a correção
mínima que o PROMPT-27 só tinha descrito agora existe em código. `resolveApiKey`
recusa antes de ler o cofre todo provedor cuja definição não declare `chat` ou
task de transcrição (`speech-to-text`, `automatic-speech-recognition`, `asr`,
`stt`). Consequência direta: **nenhum provedor de voz recebe credencial no
renderer** — nem o preview da Lia, nem o Stage. Voz **local** sem segredo
(`voicevox`, `app-local-audio-speech`, `index-tts-vllm`, `kokoro-local`,
`custom-local-voice`) segue intacta, porque nunca precisou de chave; o que muda é
o TTS **remoto**, que agora falha de forma segura e explícita em vez de receber a
chave. Chat curado, descoberta de modelos, probe e a transcrição Groq continuam
pelo main, sem chave no renderer. **Custo aceito e registrado:** o preview de voz
remota não sintetiza mais (o estado vai para `error`); fazê-lo funcionar exige
executar o TTS no main, que **não** está autorizado nesta rodada. Medido, com
dependências instaladas de verdade nesta sessão: **1524 casos em 91 arquivos
(exit 0)**, `vue-tsc` do Stage **exit 0**, ESLint nos 7 arquivos tocados
**exit 0**, `git diff --check` **exit 0**. **O gate Electron continua NÃO
EXECUTADO** — nada aqui o promove. Estado e regra completa:
[`../architecture/LIA-NATIVE-PROVIDER-COVERAGE.md`](../architecture/LIA-NATIVE-PROVIDER-COVERAGE.md) §16.

01/11 (PROMPT-27, rodada 2): o **roteiro Windows** foi entregue —
`airi/apps/stage-tamagotchi/scripts/provider-runtime-electron/run-gate-windows.ps1`.
Ele verifica branch/HEAD/working tree, node e pnpm, as dependências que o gate
importa (`playwright`, `vite`), a versão `43.4.1` do pacote e o SHA-256 do asset
contra o `checksums.json` **do próprio pacote**; instala o runtime apenas pelo
`install.js` oficial (ou aceita um zip local com hash conferido); roda o build;
roda `node --test`; e re-checa por conta própria se alguma credencial sintética
apareceu no `electron.log`, procurando os **prefixos**, nunca os valores. Sai 1
em qualquer falha. **Ele não foi executado aqui**: este ambiente é Linux e não
tem `pwsh`. Foi revisado estaticamente e os três comandos centrais foram
confirmados no checkout. O **gate continua pendente**: `node --test` devolve
`# pass 0 / # skipped 1`, e o `electron@43.4.1` segue sem `dist/` porque o asset
oficial responde 302 e o host que entrega o conteúdo sai com exit 35. O **build
do Stage** re-executado com o comando do roteiro dá exit 1: `main` (541 módulos)
e `preload` compilam, e a falha é no **renderer**, buscando modelos Live2D/VRM em
`dist.ayaka.moe` — infraestrutura, não código. A **auditoria do preview de voz**
foi re-medida e mantém a classificação: **exposição possível, não comprovada**
(o caminho até o cofre está vivo, mas nenhum dos três escritores aceita id de
fala), com **legado fora do escopo** para chave em texto claro de instalação
pré-cofre; a correção mínima segue descrita e **não implementada**. Medido nesta
rodada: 1515 casos em 91 arquivos (exit 0), 23 casos nos arquivos-chave (exit 0),
`vue-tsc` exit 0, ESLint exit 0, `git diff --check` exit 0.
Próximo passo: rodar `run-gate-windows.ps1` no Windows do Dev e anexar
`report.json` + `electron.log` da pasta de artefatos.
Estado e limites: [`../architecture/LIA-NATIVE-PROVIDER-COVERAGE.md`](../architecture/LIA-NATIVE-PROVIDER-COVERAGE.md) §15.

01/11 (PROMPT-27): **tentativa de validação em Windows não foi possível neste
ambiente** — e isso está medido, não suposto. O `electron@43.4.1` está instalado
sem `dist/`, não há cache, o `install.js` falha em `fetch failed` (o asset
oficial responde 302 e o host que entrega o conteúdo sai com exit 35) e o gate se
pula fora do Windows: `node --test` devolveu `# pass 0 / # fail 0 / # skipped 1`.
**Skip não é aprovação.** O **build do Stage** avançou mais do que o registrado
antes: `main` (541 módulos, 2,4 MB) e **`preload`** compilam — este último é o
pré-requisito que o gate lê —, e a falha acontece só no **renderer**, em
`configResolved`, porque o plugin `Download` busca modelos Live2D/VRM em
`dist.ayaka.moe` e `cubism.live2d.com` (ambos exit 35). É falha de infraestrutura,
não de código; a afirmação anterior de que o build falhava “antes de compilar
qualquer fonte” fica corrigida. A **auditoria do preview de voz** mediu o caminho
inteiro: `LiaConfigPanel.vue:97` → `VoiceSection` → `voice-preview.ts:83` →
resolver → `secretGet`, com a chave aparecendo em `provider.speech('tts-1').apiKey`,
e o Main devolve `true` para escopo fora do catálogo. Mas **não há escritor**:
`setApiKey`, `prepareNativeExecution` e `adoptCredential` só aceitam ids curados e
o Stage não tem página de provedores. Classificação: **exposição possível, não
comprovada**; e **legado fora do escopo** para chave em texto claro de instalação
pré-cofre. A correção mínima (recusar no resolver ids cujas `tasks` não incluem
`chat`) está descrita e **não foi implementada**, por não haver necessidade
demonstrada. Medido nesta rodada: 1515 casos em 91 arquivos (exit 0, incluindo a
sonda nova do preview, 3/3), `vue-tsc` exit 0, ESLint e `git diff --check` exit 0.
Próximo: rodar o gate no Windows do Dev (§13.5/§14.1 do documento de cobertura) —
é o único item que separa “Corte B implementado” de “Corte B validado”.
Estado e limites: [`../architecture/LIA-NATIVE-PROVIDER-COVERAGE.md`](../architecture/LIA-NATIVE-PROVIDER-COVERAGE.md) §14.

01/11 (PROMPT-26): os **consumidores do AIRI que ainda construíam cliente de chat
no renderer** deixaram de receber credencial — visão (`use-vision-inference`),
stress de markdown (Configurações → Sistema → Developer) e o diretor autônomo de
artistry passaram a executar no Main, porque a fábrica nativa agora envolve também
`getProviderInstance`, e o resolver passou a recusar **todo id curado** (e o alvo
de transcrição) antes de ler o cofre, o que fecha qualquer rota que escape da
primeira camada. Medido nesta rodada: 1512 casos em 90 arquivos nas suítes da Lia
(exit 0), `vue-tsc` exit 0, ESLint exit 0. O **procedimento do gate Electron**
ficou completo (versão travada 43.4.1, binário oficial, sha256 do asset, os três
comandos, pré-requisitos e preservação de log sem credencial), mas o gate
**continua não executado** — segue sendo o bloqueio real, junto com o build do
Stage, que aqui falha antes de compilar por baixar modelos Live2D de host fora da
rede permitida. Continua exposto: provedores **fora do catálogo** ainda resolvem
credencial no renderer (dívida pinada em teste) e o preview de voz lê config de
provedor de áudio, que não é curado (exposição latente, sem escritor de segredo
para esses escopos na UI distribuída). Também restam transcrição sem cancelamento
do chamador e Anthropic sem validação com chave real.
Próximo: rodar o gate no Windows do Dev com o procedimento da §13 do documento de
cobertura.
Estado e limites: [`../architecture/LIA-NATIVE-PROVIDER-COVERAGE.md`](../architecture/LIA-NATIVE-PROVIDER-COVERAGE.md) §13.

01/11 (PROMPT-25): a **descoberta genérica de modelos** deixou de ler credencial
no renderer para os dez curados — o seletor compartilhado agora delega ao Main
através de um slot único, e um provedor fora do catálogo continua no caminho
legado; e a **janela follower-only aberta antes da líder** passou a se recuperar
sem criar segunda fonte de verdade (registro criado pelo mesmo `ensureProviderRecord`,
no repositório do Main, sem credencial; sem endpoint configurado, falha fechado).
Medido nesta rodada: 1497 casos em 89 arquivos nas suítes da Lia (exit 0), 341
casos em 28 arquivos em `packages/stage-ui` (todos PASS), `vue-tsc` e ESLint exit 0.
**O que continua sendo o bloqueio real:** o **gate Electron nunca rodou** — neste
ambiente não há `dist/` do Electron (o asset oficial responde 302 e o TLS do host
de objects falha) e o gate é Windows-only; o build do Stage também não fecha aqui
porque baixa modelos Live2D de um host fora da rede permitida. Nada disso foi
substituído por teste de unidade. Restam ainda: consumidores AIRI que constroem
cliente no renderer (o resolver do líder pode entregar a chave a eles), provedores
fora do catálogo no caminho legado, transcrição sem cancelamento do chamador (só
deadline) e Anthropic sem validação com chave real.
Próximo: rodar o gate no Windows do Dev (procedimento no cabeçalho do gate),
migrar os consumidores que ainda constroem cliente no renderer.
Estado e limites: [`../architecture/LIA-NATIVE-PROVIDER-COVERAGE.md`](../architecture/LIA-NATIVE-PROVIDER-COVERAGE.md) §12.

01/11, PROMPT-24: as duas dívidas de credencial do chat ficaram **fechadas** —
o primeiro envio de um provedor sem registro não carrega mais a chave no payload
IPC (`draft` só tem `baseUrl`; o main rejeita campo de credencial antes de
qualquer rede) e a transcrição de `groq` passou a executar no main, o que
permitiu **remover a exceção** de `canRendererReadLegacySecret`: todo provedor
curado é negado ao renderer, com ou sem registro. PASS automatizado medido:
1488 casos em 88 arquivos (`stores/lia` + `services/lia` + `main/services/lia`),
140 casos em `packages/stage-ui`, `vue-tsc` e ESLint exit 0. O gate Electron foi
**ampliado** para os dez curados sobre servidor HTTP local (credencial por
provedor, endpoint próprio, streaming, cancelamento, concorrência, 503
sanitizado, porta descartada), mas **não foi executado**: não há binário do
Electron neste ambiente e o gate é Windows-only — e ele **não foi trocado por
testes de unidade**. Dívidas que restam: listagem de modelos pelo seletor
genérico do AIRI (sai sem autenticação para curado, sem vazamento), provedores
fora do catálogo (ainda resolvem no renderer), Anthropic sem validação com chave
real (a camada OpenAI-compatible existe: a rota responde 405, não 404) e
transcrição sem cancelamento do chamador (nunca teve; o main impõe deadline).
O que falta de fato agora é **rodar o gate em Windows** e migrar o seletor de
modelos. Estado e limites: [`../architecture/LIA-NATIVE-PROVIDER-COVERAGE.md`](../architecture/LIA-NATIVE-PROVIDER-COVERAGE.md) §11.

31/10, Corte B: os dez provedores de chat curados da Lia executam no processo
main pelo transporte próprio (sem segundo sistema de transportes e sem alterar
contratos de `lia/core`); o renderer encaminha e não recebe credencial. Catálogo
único de IDs, endpoint padrão resolvido no main, fallback legado fechado para
provedor curado, leitura do cofre negada ao renderer (exceção `groq`, por causa
da transcrição), janela follower-only corrigida, identidade AIRI removida do
OpenRouter e limpeza da chave em texto claro do `localStorage` só após
confirmação do main. PASS automatizado: 643 casos / 49 arquivos, typecheck e
lint; **sem** núcleo, Chromium, build, Electron ou modelo externo nesta rodada —
não há gate de runtime. Impacto no que falta: a migração de credenciais deixa de
ser bloqueio para o chat dos dez, mas **continua aberta** para a transcrição
(`groq`), para a listagem de modelos e para o primeiro envio sem registro.
Estado e limites: [`../architecture/LIA-NATIVE-PROVIDER-COVERAGE.md`](../architecture/LIA-NATIVE-PROVIDER-COVERAGE.md).

30/10, revisão de Transport Configuration: persistência e consumidor HTTP/SSE
próprios no main, migração/CAS e proteções de remoção/escopos testadas. Núcleo 77,
Core-agent 156, stores/main/cache/cofre 449, Chromium 16, lint/typechecks/builds PASS;
Electron real com HTTP local e rede do renderer bloqueada confirmou 11 grupos.
**Segurança global permanece parcial:** consumidores legados ainda usam getter
de credenciais no renderer fora dos escopos protegidos. Stage completo, modelo
externo e instalador não foram aprovados. P2 de descarte encerrado em 31/10:
10 testes diretos PASS; conferência para publicação 57 PASS / 4 arquivos.
Versionamento/publicação autorizados pelo Dev; seis Core/auditorias preservados,
baseline mantido. [Relatório e matriz](../product/RELEASE-WINDOWS-2026-10-30-TRANSPORT-CONFIGURATION.md).

30/10, Runtime E2E: **PASS Windows real de componentes** em Electron com IPC,
cofre criptografado e perfil isolado; JSON/SSE, autenticação sintética por serviço,
erros, cancelamento, timeout padrão, reinício e crash do renderer com encerramento
limpo. Servidor HTTP local, sem modelo externo e sem Launcher/Stage completo.
Segundo ID persistido migrado com endereço explícito; registros sem endereço
mantêm executor legado. Corrigido cancelamento infinito com fonte travada.
Núcleo 62, stores 377, Chromium 13, lint/typechecks/build Stage PASS. A matriz
atual e os limites estão em [Runtime E2E](../product/RELEASE-WINDOWS-2026-10-30-RUNTIME-E2E.md).
Próximo: configuração própria de transportes preservando registros antigos;
Core/xsAI/configuração/ativação/voz/avatar ainda legados. Release e fase 8.0D
continuam abertas, baseline inalterado.

30/10: primeira fatia do runtime próprio executa o transporte do alvo genérico
com endpoint explícito, com registry/cache/HTTP/SSE/credenciais da Lia. Núcleo
nativo 56, stores 371, UI browser 11 e Web Platform browser 2 PASS; lint,
typechecks e build PASS. O loop de ferramentas ainda é Core/xsAI, exercitado
com rede simulada. Servidor HTTP local foi testado sem SDK. Outros providers,
config/dispatcher/ativação, voz/visão e Stage continuam legados; remoção AIRI e
independência total não concluídas. Gates reais de modelo/Electron/hardware e
instalador NÃO EXECUTADOS. [Matriz e evidências](../architecture/LIA-PROVIDER-RUNTIME-2026-10-30.md).

29/10: editor aceita IDs livres de modelo principal/reserva, preservados ao editar,
salvar, reabrir e trocar serviço. Descoberta usa rascunho/vault sem persistir chaves;
falha não bloqueia manual. Sonda envia o ID escolhido e só aprova texto, sem afirmar
compatibilidade de ferramentas/imagem. Handler de salvar preserva `brain`/`setup`.
Stores 365, browser 11, persistência/lifecycle 11, lint/typecheck/builds PASS
automatizados. Rede real, reinício instalado e gate Windows completo NÃO EXECUTADOS;
fase 8.0D/baseline mantidos. [Evidências](../product/MODELOS-LIVRES-2026-10-29.md).

28/10: Home ganhou **Encerrar conversa**, progresso, sucesso confirmado e erro
com retry. Launcher 247 PASS/2 skips, browser Home 7 PASS, lint/typechecks/build
PASS. Windows com Launcher/IPC reais e processo controlado confirmou o controle
de parada e reabertura; **não é gate do AIRI Stage nem conversa/voz reais**.
Baseline e fase 8.0D permanecem. Próximo item de Launcher: feedback de salvar em
ConfigView apagado por reload. Seis arquivos Core preexistentes seguem separados.
[Evidência e limites](../product/RELEASE-WINDOWS-2026-10-28-HOME-STOP.md).

22/10: perda de espaços reproduzida com deltas unitários e corrigida com
contraprova. Core-agent 145, Chat/Stage UI 255, browser 15, Python 496/10 skips,
Node 267 e Launcher 247/2 skips PASS. UI Windows com transporte SSE sintético
confirmou palavras separadas e conteúdo salvo exato. O gate do serviço real
continua separado. [Evidência](../product/RELEASE-WINDOWS-2026-10-22.md).

Erros de envio agora usam texto seguro no novo histórico e tradução pt-BR/en
na tela/cópia, inclusive para legado sem regravar dados. 111 testes dirigidos,
275 de regressão Chat e 13 browser, lint/typecheck/builds e suítes gerais PASS.
Windows com transporte sintético validou 413→retry 200 com rascunho preservado.
23/10: corrigida fronteira de apresentação do reasoning sem depender de snapshot;
standalone preservado, flag reativa e conteúdo intacto. 22 browser dirigidos,
11 contratos, 18 browser de regressão, lint/typechecks/build PASS. Windows real
mostrou 42 sem prévia técnica e placeholder pt-BR; raciocínio segue salvo.
Stage Node completo passou: 1798 testes e 4 skips em 144 arquivos, após
corrigir contexto de fixtures e respostas simuladas vazias preexistentes.
Python 496/10 skips, Node 267 e Launcher 247/2 skips PASS. Próximo item:
logs brutos do Core. [Evidência](../product/RELEASE-WINDOWS-2026-10-23.md).

Retomada de 21/10: preflight Python 495/10 skips, Node 267, Launcher 247/2 skips
e core-agent 144 PASS. Fixtures e artefatos reorganizados sob `Tests/tmp` e
`Tests/artifacts`; evidências e limites em
[`RELEASE-WINDOWS-2026-10-21.md`](../product/RELEASE-WINDOWS-2026-10-21.md).
O gate de conteúdo de imagem permanece aberto.

Atualização local de 20/10/2026: a finalização Windows foi autorizada pelo Dev.
O fluxo `Lia.bat → Launcher → Conversar → Stage visível` e o encerramento foram
executados no PC. Uma rejeição inesperada do pré-requisito agora termina em erro
com retry, coberto por regressão. A seleção local da janela Chat foi corrigida
e a resposta 42 ficou visível no Electron. **A release não está pronta:** imagem
agora recebe resposta após correção da compatibilidade Spark, mas o modelo
confundiu retângulo com quadrado; houve também erros de quota Groq.
O 9router exige autenticação no envio (401). A mesma imagem foi reconhecida
em requisição mínima pela Groq, mas o gate na UI segue FAIL de conteúdo. O erro de stream
vazio agora aparece em pt-BR e termina em failed, validado no Windows e em testes.
Inventário dos sete concepts, resultados e checklist:
[`RELEASE-WINDOWS-2026-10-20.md`](../product/RELEASE-WINDOWS-2026-10-20.md).
O plano local está em `docs/product/PLANO-FINALIZACAO-LIA.md`.

- **Branch:** `arena/01a10290-lia-project`. `main` não recebeu merge.
- **Baseline funcional validado em Windows:** `3ef6d11618f787dae6d197645d440a5775a60ad6`.
  **Não promover commit posterior a baseline.**
- **Fase:** 8.0D — First Multimodal Brain Adapter. **Não CLOSED.** 8.0E não iniciado.
- **Código:** tudo sob `airi/`.

## O que já está provado em Windows real

- Cadeia de voz gerenciada B1/B1.1 — **E2E PASS**. Blocker encerrado (§2).
- Bootstrap de roteamento do Brain e seleção de rota — **M2**.
- Conversa só de texto — **DONE**.

Automatizado verde **não é** gate de runtime. Nunca reportar um gate não executado
como PASS.

## Tabela de critérios da 8.0D (transcrita da §5)

| Critério | Estado | O que falta |
|---|---|---|
| text conversation | **DONE** | — |
| image/screen understanding | **PENDENTE** | bootstrap e rota provados em Windows; falta o **gate de conteúdo da imagem** no provider |
| audio understanding | **NOT STARTED** | o candidato aprovado é text+image; B1/B1.1 é STT *antes* do brain |
| tool calling | **PARTIAL** | transporte e gate de compatibilidade provados; o *loop* completo é do `@xsai/stream-text` |
| latency | **NOT STARTED** | nenhuma medição existe; o contrato de telemetria exclui timing por desenho |
| region/network impact | **NOT STARTED** | nenhuma referência no escopo Brain |
| failure behavior | **PASS automatizado / runtime pendente** | política real: recoverable→próximo, permanent→não, fim da cadeia e opt-out; E2E em rede NÃO EXECUTADO |
| default não medido no alvo | **PARTIAL** | medido só pelo E2E de voz |

---

## A) Um agente pode fazer sozinho, em Linux

Verificável aqui: suíte Python `tools/` (487 testes), Node `Tests/tools` (267),
vitest `airi/apps/lia-app` (246 + 2 skip), `moeru-lint`, build `@proj-airi/core-agent`.

1. **Teste dirigido de `failure behavior` — CONCLUÍDO (PASS automatizado).**
   11 casos novos, 15 aprovados no harness do store real. Recuperáveis,
   permanentes, fim da cadeia, opt-out e preferência intacta. Não aprova E2E
   contra dois serviços reais. Próximo item executável: A2.
2. **8.0D-M3.1 — CONCLUÍDO.** Limite no descritor do modelo; contagem
   inclui histórico elegível. Envio e retry recusam excesso preservando dados.
   PASS automatizado e PASS Windows real do bloqueio de quatro imagens.
   Isso não aprova o gate de reconhecimento do conteúdo.
3. **`docs/compatibility/MATRIX.md` — CONCLUÍDO como inventário inicial.**
   Atualizado com gates Windows e estados conservadores. Manutenção continua;
   nenhuma plataforma foi promovida a suporte total.
4. **Dívida de Cloud Sync v1** — envia texto puro para user/assistant. Registrada
   na §5, não corrigida.
5. **Fatiamento portátil do `AGENTS.md`** — hoje são ~10 800 tok carregados sempre.
   Fatiar em `.claude/rules/` **só** ajuda o Claude Code; a via portátil é núcleo
   curto no `AGENTS.md` + detalhe em documentos abertos sob demanda.
6. **Independência do AIRI — em andamento (27/10/2026).** `lia/{core,stage,launcher}`
   existem com **43 testes verdes** (`@lia/contracts` sem nenhuma dependência).
   Feito: comparação contra clone limpo em `2c1e223`, contratos de ciclo de vida e
   protocolo, host do Stage testável sem display, decisão do Launcher em função pura.
   **Falta:** portar os 70 arquivos de `stage-tamagotchi/src/main/services/lia`,
   criar o `LiaChatPort` e ligá-lo ao `core-agent`, migrar as configs, e — só então —
   trocar o `AiriStageManager` pelo `createLauncher`. Ordem e rollback em
   `docs/architecture/LIA-MIGRATION-PLAN.md`.
7. **Síntese de voz remota (aberto pelo PROMPT-28).** O corte por capacidade
   fechou o cofre para todo provedor de TTS, então o preview de voz remota passou
   a falhar de forma segura em vez de receber a chave. Para voltar a sintetizar
   sem reabrir o cofre, a síntese precisa rodar no main — **não autorizado** até
   agora, e é exatamente o caminho que o PROMPT-28 proibiu de improvisar. Enquanto
   isso, motores locais sem segredo cobrem o caso de uso.

Regras que valem para tudo isso: §6 do `CURRENT-STATE.md` e o `AGENTS.md` inteiro.
Em particular — **STOP AND REPORT em vez de contornar**, e não declarar PASS sem
executar.

## B) Exige o Windows do Dev — nenhum agente na nuvem faz

**Como rodar o gate (PROMPT-31).** Duas execuções, uma por host, e cada uma
produz uma pasta exportável diferente:

```powershell
# PowerShell 5.1 (Windows PowerShell)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  airi\apps\stage-tamagotchi\scripts\provider-runtime-electron\run-gate-windows.ps1

# PowerShell 7
pwsh -NoProfile -File `
  airi\apps\stage-tamagotchi\scripts\provider-runtime-electron\run-gate-windows.ps1
```

Em ambas, aponte a exportação para fora do clone e copie o resultado:

```powershell
-ExportRoot D:\lia-evidence     # ou $env:LIA_GATE_EXPORT_ROOT
```

Cada execução grava `D:\lia-evidence\<runId>\` com `report.json`,
`electron.log`, `environment.json`, `manifest.json` e (se houver) `electron.png`.
O `environment.json` responde "5.1 ou 7?" sem depender do nome da pasta. Para
conferir a integridade:

```powershell
Get-FileHash D:\lia-evidence\<runId>\report.json -Algorithm SHA256
# compare com files[].sha256 em manifest.json
```

O que ainda **não** está coberto por nenhuma dessas execuções: voz remota,
instalador, atualização e qualquer serviço externo.

1. **Gate Windows E2E visual** (o gate de saída da 8.0D). Roteiro na §5:
   abrir pelo `Lia.bat` · anexar imagem · pergunta determinística sobre o conteúdo ·
   rota `groq` + `qwen/qwen3.8-27b` · resposta correta **pela imagem** · e um turno
   só de texto permanecendo no GPT-OSS.
2. **Reteste do pré-requisito do Stage (M3.0b).** **PASS Windows real em
   20/10/2026 nesta rodada:** build termina, pré-requisito registra sucesso,
   personagem aparece e encerramento gerenciado remove os processos da sessão.
   Baseline funcional preservado em `3ef6d11`; isso não aprova o gate de imagem.
3. **Qualquer validação de runtime, voz, instalador ou benchmark.**
4. **Gate do Stage próprio.** `lia/stage` só foi provado em Linux headless: a
   janela nunca abriu de verdade, o "personagem" é um placeholder declarado e o
   encerramento sem órfão no Windows nunca foi observado. O que precisa rodar no
   Windows do Dev: abrir o Stage, ver a janela, fechar, e conferir na lista de
   processos que nada ficou para trás.
   **Medido em 01/11/2026 (PROMPT-27):** o build do Stage compila `main` e
   `preload` em Linux; o que impede o build completo aqui é o download dos
   modelos Live2D/VRM, não o código. No Windows com rede aberta o mesmo comando
   deve concluir — mas isso ainda **não foi observado**, e nenhum build é
   declarado aprovado.
5. **Gate de runtime dos provedores em Electron** (`scripts/provider-runtime-electron/gate.test.mjs`).
   **Roteiro pronto:** `.\scripts\provider-runtime-electron\run-gate-windows.ps1`
   a partir de `airi\apps\stage-tamagotchi` (§15.1 do documento de cobertura).
   Ele aborta se o build falhar, e falha se aparecer credencial sintética nos logs.
   Procedimento fechado — versão travada, binário oficial, sha256 do asset, os três
   comandos na ordem, PowerShell e sessão de desktop como pré-requisitos — na §13.5
   de [`../architecture/LIA-NATIVE-PROVIDER-COVERAGE.md`](../architecture/LIA-NATIVE-PROVIDER-COVERAGE.md).
   Ele se **pula sozinho** fora do Windows, e pular não é aprovar. Nunca foi executado.

Um agente pode *preparar* tudo isso — código, testes, roteiro, diagnóstico — mas
**não pode aprovar**. Se o seu plano termina em "gate aprovado", ele não termina
sozinho.

---

## O que um agente novo deve fazer na primeira hora

1. Abrir a sessão **na raiz do repositório**, nunca dentro de `airi/`.
2. Ler `CURRENT-STATE.md` §0 (cabeçalho de estado, ~700 tok) e a §6 (regras permanentes).
3. Ler [`../README.md`](../README.md) e [`../docs/README.md`](../README.md) para o mapa dos documentos.
4. Rodar as quatro suítes da seção A e conferir que estão verdes **antes** de mudar algo.
5. Escolher um item da seção A. Um por vez. Commit pequeno.

## O que ele nunca deve fazer

- Tocar em Persona, secrets, TTS runtime, fallback de chat, web/pocket ou live
  model discovery sem autorização explícita.
- Alterar `DevKit.bat` da raiz ou `Lia.bat` — `Lia.bat` é o processo que o gate
  M3.0b captura.
- Promover commit posterior a `3ef6d11` a baseline funcional.
- Fazer merge em `main`.
- Reportar um gate não executado como PASS.
- Aumentar timeout como forma de correção.
- Tratar suspeita como causa confirmada.
