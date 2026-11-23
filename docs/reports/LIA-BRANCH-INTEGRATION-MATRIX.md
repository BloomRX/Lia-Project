# Lia — Matriz de integração seletiva de branches

## Retomada da consolidação — 22/11/2026

A consolidação integra `138e2fd2` e `9065aa2` em `1e8a68bd` e foi
publicada em `main`. Ela preserva os commits de visão cognitiva e o bootstrap
de skills do Agent Hub.

Em 23/11, a referência remota `arena/7fa837f0-lia-project` foi removida depois de confirmar que seu SHA `9065aa2d4c63b337dab19eb6c4719b02082fc061` era ancestral da `main` e coincidia com o espelho externo e o checkout local preservado. A `main` era a branch padrão e a consulta ao GitHub retornou zero PRs abertos.

O [relatório de voz de `fd0451d7`](LIA-MULTI-PROVIDER-VOICE-ARCHITECTURE.md) já estava na `main` com o mesmo conteúdo de origem em `3c2b132f`. A exigência de um TTS e um STT funcionais, configuráveis separadamente, foi incorporada à decisão DP-2. A especificação em `b2745f71` está na `main` com seções adicionais de visão cognitiva e o padrão de marca coincide byte a byte. As duas referências remotas de documentação, `codex/lia-multi-provider-voice` e `docs/especificacao-geral-produto-lia`, foram removidas após a reconciliação.

Os oito blobs acrescentados por Research entre `7913c62a` e `b345355f` coincidem com os da `main`. O snapshot `agents/docs` e as regras de sua antiga linha de desenvolvimento ficam preservados no espelho como histórico. Para pesquisa e delegação atuais, consulte o [AGENTS.md](../../AGENTS.md) e o [contrato de orquestração](../project/AGENT-ORCHESTRATION.md).

Os 16 hashes de `SHA256SUMS.txt` do benchmark de outubro conferem com os blobs de `91b8995a`. O histórico está preservado no espelho e na tag `archive/qa-windows-2026-10-02`. A entrada de linha de comando do benchmark só gera evidência local. O CI Windows nativo publica seus relatórios como artefatos. Os resultados do benchmark pertencem somente ao SHA `cfd8d7f`.

O QA do beta de 14/11 também está preservado no espelho e na tag
[`archive/qa-beta-2026-11-14`](https://github.com/BloomRX/Lia-Project/tree/archive/qa-beta-2026-11-14).
A [matriz de áudio](LIA-AUDIO-QA-MATRIX.md), a [régua AV-01–AV-15](LIA-AV-ACCEPTANCE-CRITERIA.md)
e a [reconciliação das evidências](LIA-AUDIO-EVIDENCE-RECONCILIATION.md) da `main`
coincidem com os três arquivos no SHA `ccf33861`. Os 88 caminhos restantes,
com as matrizes de SHAs anteriores e seus logs, são consultáveis no arquivo
de QA da tag. Seus resultados são históricos.

O espelho externo contém as 12 branches remotas e passou em
`git fsck --full`. Foram verificados os bundles locais e comparadas
por SHA-256 as cópias dos 11 checkouts órfãos. O principal órfão
coincide com a árvore rastreada de `da3a150`; o inventário de arquivos
não rastreados foi separado da comparação do histórico.

Na candidata passaram a instalação congelada, 33 builds de pacotes,
o build do Stage, 54 testes focados de OIDC e 275 testes de ferramentas.
O commit `610b2d07` preserva as três verificações dos consumidores e
permite executar 154 testes do pacote de contratos sem a árvore AIRI.
O aplicativo desktop ainda usa o workspace AIRI. A execução agregada
inicial do Core registrou 384 aprovações e dois timeouts.
A reexecução reproduziu os timeouts nas duas verificações que
varriam os consumidores do workspace. Essas verificações passaram
em um único teste de integração, com as mesmas regras de dependência.
Após a separação, os 384 testes restantes do Core passaram. O build
do Launcher também passou no checkout candidato.

A seção a seguir registra o destino e as classificações originais
da auditoria de 16/11. Elas também servem de referência para revisar
as diferenças remanescentes antes de qualquer exclusão de branch.

### Prévia independente no Windows

Um arquivo gerado por `git archive 6ca14790 lia` foi extraído em pasta
separada. A conferência em execução confirmou a ausência de `airi/`.
Launcher e Stage próprio instalaram com lockfile congelado e compilaram.
Passaram 16 testes do Stage próprio e 365 do Launcher, com três
skips no Launcher. Com Electron
43.4.1 instalado em `lia/stage`, o Launcher abriu o Stage pelo botão
**Conversar com Lia** e o encerrou pelo botão **Encerrar conversa**.
O status autenticado encontrou uma janela e o encerramento removeu
o registro. O ensaio usou a prévia opt-in e configuração local sintética.
Ele cobre o ciclo de vida da prévia. Depois, o NSIS da prévia privada
também foi gerado nessa árvore. No Windows, a instalação silenciosa em
uma pasta de teste, a abertura e o encerramento do Stage pelo Launcher
instalado e a desinstalação retornaram sucesso. A verificação confirmou
a remoção do executável e da entrada de desinstalação da prévia.
O pacote posterior substituiu o Stage de uma compilação anterior de
mesma versão 0.0.1 no teste NSIS. A troca dos arquivos foi verificada
por SHA-256 e o ciclo Launcher–Stage e a desinstalação passaram.
Fluxo padrão, atualização entre versões, atualização automática e
paridade com o Stage legado seguem pendentes.

Os gates hospedados do GitHub Actions também confirmaram a abertura e o
encerramento pelo Launcher e a janela de presença com VRM sintético em uma
árvore sem AIRI. A mesma execução registrou 43 timeouts na suíte do Launcher
e 12 falhas no cofre multiprocesso, ainda na preparação de credenciais
sintéticas. Os 27 testes da configuração passaram. A origem da falha do
cofre hospedado foi isolada na escrita privada. Escrita comum e
criação do canal de coordenação passaram; a [escrita privada
falhou após 5.033 ms](https://github.com/BloomRX/Lia-Project/actions/runs/45099185541).
O [ensaio por fase](https://github.com/BloomRX/Lia-Project/actions/runs/45100009657/job/137448428832)
parou entre a identificação do usuário e a criação das regras de acesso
com ambiente restrito, mesmo sem stdin. Com o ambiente herdado, as mesmas
etapas terminaram em 528 ms. O construtor .NET direto terminou em 185 ms
no ambiente restrito e passou a ser usado no helper de escrita privada,
com as mesmas permissões e o mesmo limite de execução. Resultados anteriores por etapa na
[execução Windows de 22/11](https://github.com/BloomRX/Lia-Project/actions/runs/45098566159).
O [gate hospedado de histórico](https://github.com/BloomRX/Lia-Project/actions/runs/45098698966)
também passou com serviço HTTP local sintético, incluindo retomada após
reinício, cancelamento da limpeza e remoção do contexto após confirmar.

A [reexecução com a correção](https://github.com/BloomRX/Lia-Project/actions/runs/45100386598)
passou nos dois jobs. O helper de produção escreveu em 1.748 ms no runner.
Passaram 39 testes de cofre multiprocesso e configuração, 365 do Launcher
com três skips, 21 do Stage e três de empacotamento. Os gates Electron
de ciclo de vida, presença e histórico passaram na árvore sem AIRI.

A ampliação para a suíte integral do runtime registrou
[382 aprovações e uma falha](https://github.com/BloomRX/Lia-Project/actions/runs/45144443198)
na criação de uma entrada DPAPI com cofre sintético. O helper passou
a resolver o tipo .NET diretamente, mantendo escopo `CurrentUser`,
entropia, formato das entradas e prazo. Em Windows local, passaram
o teste real entre processos e todos os 383 testes do runtime.

No Windows local, a prévia respondeu com uma nota de teste usando
`llama.cpp` e `Qwen3.5-9B-Q4_K_M` em CPU, sem serviço externo.
O modelo abriu em 24.123 ms e respondeu em 7.089 ms naquele ensaio.
O perfil e as entradas foram sintéticos. Evidência local em
`stage-qwen-real-iN37SD/report.json` no diretório do backup de consolidação.

**Data:** 16/11/2026
**Branch de destino:** `arena/7fa837f0-lia-project` @ `971d309074`
**Escopo:** plano **por alteração**, não por branch. **Nenhuma integração foi executada nesta rodada.**
**Regras:** PORTAR/ADAPTAR só com teste no SHA integrado; L-02 bloqueado até SEC-04/05; nenhum modelo experimental promovido; prettier/lint apenas nos arquivos alterados.

**Rodada 20:** o delta executado e os critérios que continuam abertos estão
no [relatório de implementação](LIA-ROUND-20-IMPLEMENTATION-REPORT.md). Os
registros abaixo preservam a decisão da Rodada 19.

| Registro | Execução na Rodada 20 |
| --- | --- |
| SEC-R-01 | PORTADO e reforçado em `2fabc39`. Regressões focadas de resolução, despacho e substituição passaram. |
| SEC-R-02 | PORTADO em `7ff636b`. Core e integração HTTP loopback no Windows passaram. |
| SEC-R-03/04 | ADAPTADOS em `ec5622a`. Testes de geração, concorrência, logout e saldo passaram. |
| SEC-R-05 | IMPLEMENTADO em `e448464`. Canários de logs e tracing passaram nas suítes focadas. |
| SEC-R-06 | IMPLEMENTADO no Stage a partir de `ec5622a`. Janela de rede e limpeza sintética exercitadas no Electron. Gate de beta ainda depende de T-07/T-08. |
| SEC-R-07 | BLOQUEADO. T-07 requer migração dos consumidores e T-08 requer vínculo persistido de credencial a origem. |
| SEC-R-08 | PARCIAL em `8235fdf`. Guarda de janela/frame e cancelamento com teste. Consentimento remoto segue bloqueado. |
| AUD-R-01…04 | Régua e arquitetura preservadas. REC-01 inventariou quatro WAVs L1/L2; evidência original e G-AUD seguem bloqueados. |
| UI-R-* | Preservados como referência nesta ordem. UI-R-04/L-02 segue bloqueado por SEC-04/05. |
| RES-R-* e DOC-R-* | Referências mantidas nas classificações existentes, sem promoção de modelos. |

**Classificações:** `PORTAR` (aplicar como está, com teste) · `ADAPTAR` (aplicar com ajuste) · `MANTER NA ORIGEM` (não trazer) · `DOCUMENTAR` (só registro) · `REJEITAR` (não usar, com justificativa) · `BLOQUEADO` (depende de gate).

---

## 1. Sumário por classificação

| Classificação | Qtd. | IDs |
|---|---:|---|
| PORTAR | 10 | SEC-R-01, SEC-R-02, SEC-R-05, UI-R-01, UI-R-02, UI-R-03†, UI-R-06, UI-R-10, RES-R-01, DOC-R-01 |
| ADAPTAR | 3 | SEC-R-03, SEC-R-04, UI-R-07 |
| MANTER NA ORIGEM | 4 | HYG-R-01, RES-R-05, DOC-R-02, DOC-R-03 |
| DOCUMENTAR | 3 | AUD-R-01, AUD-R-04, VOICE-R-01 |
| REJEITAR | 4 | UI-R-08, UI-R-09, UI-R-11, HYG-R-02 |
| BLOQUEADO | 7 | SEC-R-06, SEC-R-07, SEC-R-08, UI-R-04, UI-R-05, AUD-R-02, AUD-R-03 |

† UI-R-03 é **híbrido**: o `DoubleCheckButton` é PORTAR e a guarda de chat vazio é ADAPTAR.
Total: **31 registros** (alguns agregam vários arquivos da mesma alteração).

---

## 2. Segurança — `arena/c6b02f64-lia-project` @ `a1f5b831`

Base `407300b`. **Verificado por blob: os 6 arquivos-chave abaixo são idênticos ao HEAD atual** — o port é limpo, sem conflito. O que exige cuidado é o comportamento, não o merge.

### SEC-R-01 — Gate de ferramentas desabilitadas

| Campo | Valor |
|---|---|
| **Origem** | `c6b02f64`, commit `7ea61cac` |
| **Classificação** | **PORTAR** |
| **Arquivos** | `airi/packages/stage-ui/src/stores/ai/chat-llm/tool-resolver.ts` (l. 68–83, 173, 175) · `…/tools.ts` (l. 87, 102–111, 126, 134–145) · `…/llm.ts` (l. 34) · `airi/packages/core-agent/src/runtime/llm-service.ts` (l. 152, 196) · `airi/packages/core-agent/src/types/llm.ts` |
| **O que faz** | (a) `guardedSources: WeakMap<Tool,Tool>` + `guardResolvedTool()` re-checa `isToolAllowed` no `execute` e lança `Tool "x" is disabled or unavailable.`; (b) filtro final síncrono `.filter(tool => isToolAllowed(tool))` antes de `toReversed()`/`streamText`; (c) `resolvedIds: WeakMap<Tool,string>` para proveniência; (d) `isNameBlocked()` — qualquer registro com o mesmo nome desabilitado bloqueia **todas** as fontes; (e) `activeTools` filtra `!isNameBlocked`. |
| **Depende de** | Gate A-1 existente na Principal (`useLlmToolsStore`, `isToolEnabled`, `defaultActive`). **Não** depende de OIDC/SEC-04. |
| **Risco** | Médio — conservador por desenho: uma ferramenta independente com nome colidente é bloqueada. Reabilitação explícita é permitida; fontes sem nome de registro não recebem gate por ID. |
| **Testes exigidos** | `tool-resolver.test.ts` (barreira pós-resolução, dispatch, colisão, rerun, objeto capturado) e `llm-service.test.ts` no **SHA integrado**; mutação: remover `guardResolvedTool` deve falhar. |
| **Responsável** | Arena (implementação) — revisão de segurança independente |
| **Ordem** | 1.1 |
| **Aceite** | Suítes PASS no SHA integrado + mutação falha + nenhuma ferramenta A-1 (`get_weather`, `image_journal`, `stage_widgets`) deixa de funcionar |

### SEC-R-02 — Credencial recusada em HTTP fora de loopback

| Campo | Valor |
|---|---|
| **Origem** | `c6b02f64`, commit `e25b7d47` |
| **Classificação** | **PORTAR** |
| **Arquivos** | `lia/core/src/providers/runtime.ts` (l. 225–232) · `lia/core/test/providers.test.ts` |
| **O que faz** | Antes do `fetch`: se há `credential` e o destino não é `https:` nem host ∈ {`localhost`, `127.0.0.1`, `[::1]`} → `ProviderError('configuration')`. HTTP sem credencial continua permitido; redirect segue recusado. |
| **Depende de** | Nada. |
| **Risco** | Baixo-médio — quebra serviços LAN HTTP **com chave** (intencional). **Não** fecha SEC-05: HTTPS em host atacante continua permitido se o endpoint for alterado; loopback não protege contra processo local malicioso. |
| **Testes exigidos** | `lia/core` suite: destino externo, LAN, loopback, ausência de `fetch`, uso sem chave. |
| **Responsável** | Arena |
| **Ordem** | 1.2 |
| **Aceite** | Core PASS; teste prova que o `fetch` **não** ocorre no caso recusado |

### SEC-R-03 — Geração de auth, single-flight e limpeza antes da rede

| Campo | Valor |
|---|---|
| **Origem** | `c6b02f64`, commits `013e4fdc` + `b67929c5` (reconciliação) |
| **Classificação** | **ADAPTAR** |
| **Arquivos** | `airi/packages/stage-ui/src/stores/auth.ts` (l. 95, 155–201, 260) · `auth.test.ts` |
| **O que faz** | `authGeneration++` em `completeSignIn`/`clearAuthState`; `inflightRefresh` single-flight com `if (inflightRefresh === attempt)`; refresh/sessão de geração obsoleta descartados; `logout()` limpa **antes** da rede; logs de classe fixa (sem `errorMessageFrom`); falha de sessão corrente limpa estado (fail-closed). |
| **Depende de** | Nada de OIDC-OFF; **não** fecha SEC-01/02 (tokens seguem no Renderer). |
| **Risco** | Alto se aplicado mecanicamente: o patch da higiene (`4ec8f22b`) usa `errorMessageFrom` e **não** deve ser reintroduzido; a base atual (`8b3f87c1`) difere de `0093de0` — reaplicar por diff revisado, nunca `cherry-pick` cego. `authedFetch` (`libs/auth-fetch.ts:39–72`) **continua sem geração** — risco aberto. |
| **Testes exigidos** | `auth.test.ts`: refresh atrasado, logout pendente, resposta de sessão antiga, canário sintético em log; rodar no SHA integrado. |
| **Responsável** | Arena |
| **Ordem** | 1.3 |
| **Aceite** | Testes PASS; `grep -c errorMessageFrom` nos pontos sensíveis = **0**; nenhum token em log |

### SEC-R-04 — `creditsStatus` e validação do saldo

| Campo | Valor |
|---|---|
| **Origem** | `c6b02f64`, `b67929c5` |
| **Classificação** | **ADAPTAR** (código) + adoção obrigatória nos consumidores |
| **Arquivos** | `auth.ts` (l. 95 e `updateCredits`) + **consumidores** do saldo |
| **O que faz** | `creditsStatus: 'idle'\|'loading'\|'ready'\|'auth-error'\|'error'`, `creditsRequest` contador, valida `typeof flux === 'number' && isFinite`, distingue 401/403, descarta resposta anterior/posterior ao logout, zera saldo no logout. |
| **Risco** | Alto **sem** adoção: quem lê só `credits` mostra saldo antigo/zero como atual. 401 pode ser tratado antes por `authedFetch` → status volta a `idle` em vez de `auth-error`. |
| **Testes exigidos** | Teste de 401, 403, erro de rede, resposta fora de ordem, logout durante request. |
| **Ordem** | 1.4 (mesmo commit de 1.3 se possível) |
| **Aceite** | Nenhum componente exibe saldo como atual sem `creditsStatus === 'ready'` |

### SEC-R-05 — STT-01: transcrição descartada não vai para log

| Campo | Valor |
|---|---|
| **Origem** | `c6b02f64` (`LIA-STT-SECURITY-AUDIT-2026-11-14.md`, achado **STT-01**) — **sem implementação na branch** |
| **Classificação** | **PORTAR (implementar)** |
| **Arquivo** | `airi/packages/stage-ui/src/composables/audio/voice-input-session.ts` **l. 390–394** (`log('info','recording-drop-after-asr', …, { trigger, gate, text })`) e o consumidor `stage-tamagotchi/src/renderer/pages/index.vue` (~l. 698–710) |
| **O que faz** | Remover `text` do payload de diagnóstico; usar metadata allowlisted (trigger, gate, comprimento). |
| **Risco** | Baixo. Caminho demonstrado por código; ocorrência real não medida. |
| **Testes exigidos** | Canário sintético na transcrição + gate pós-ASR acionado → canário **ausente** de console/logs/telemetria. |
| **Ordem** | 1.5 |
| **Aceite** | Teste passa; `grep -n "text,"` no bloco de log = 0 |

### SEC-R-06 — OIDC-OFF

| Campo | Valor |
|---|---|
| **Origem** | Proposta em `c6b02f64` (`LIA-AUTH-RECONCILIATION` §OIDC-OFF) — **não implementada em nenhuma branch** |
| **Classificação** | **BLOQUEADO** (P-1 + T-07/T-08) |
| **Escopo mínimo** | Guard de capacidade no Main do perfil Lia: negar login/callback antes de abrir browser/loopback, invalidar trabalhos pendentes, não emitir tokens ao Renderer, impedir refresh/callback compartilhados, limpar os 5 campos `auth/v1/*` sem ler valores, desabilitar consumidores (não só esconder UI). |
| **Aceite** | IPC forjado de cada janela não abre browser/servidor nem emite token; restart com storage legado limpo; captura de rede sem auth; suite Electron + Windows no SHA candidato |
| **Nota** | `isStageTamagotchi()` **não** pode equivaler a "Lia" — cobre Electron em geral. |

### SEC-R-07 — SEC-04/05: vínculo credencial–destino e scopes legados

| Campo | Valor |
|---|---|
| **Origem** | `c6b02f64` (`LIA-BETA-SECURITY-FIXES` §SEC-04/05) |
| **Classificação** | **BLOQUEADO** |
| **Pendências** | (1) inventário/migração de scopes legados legíveis por `secrets-service.ts`; (2) autorização no Main para **mudança de origem** (CAS/confirmação); (3) vínculo provedor–destino–credencial também para HTTPS; (4) testes negativos de IPC forjado. |
| **Impacto** | Enquanto não fechar, **L-02 permanece bloqueado** e qualquer UI que dependa de configurar provedor/segredo no Launcher não entra. |

---

## 3. Áudio — `arena/18f50ae7-lia-project` @ `ccf33861`

### AUD-R-01 — Critérios AV-01…AV-15

| Campo | Valor |
|---|---|
| **Origem** | `18f50ae7`, commit de `LIA-AV-ACCEPTANCE-CRITERIA.md` |
| **Classificação** | **DOCUMENTAR** (preservado) / gate **BLOQUEADO** |
| **Arquivos** | `docs/reports/LIA-AV-ACCEPTANCE-CRITERIA.md` (copiado byte-a-byte), `LIA-AUDIO-QA-MATRIX.md`, `LIA-AUDIO-EVIDENCE-RECONCILIATION.md` |
| **Estado** | **15/15 NOT RUN**; AV-07 BLOCKED (rede/Python); `0/15` atribuíveis; regras R-01…R-10; `G-AUD BLOCKED` |
| **Depende de** | REC-01 (evidência), REC-02 (limiares P-2) |
| **Risco** | Tratar documento como aprovação. Ele é **régua**, não resultado. |
| **Aceite** | Nenhum AV promovido a PASS sem SHA + comando + saída + artefato sanitizado |

### AUD-R-02 e AUD-R-03 — Evidência externa e recuperação

| Campo | Valor |
|---|---|
| **Origem** | `18f50ae7` (`LIA-AUDIO-EVIDENCE-RECONCILIATION.md`) |
| **Classificação** | **BLOQUEADO** |
| **Fatos** | (a) `J:\lia-evidence\beta-407300b-windows-20261114\` (4 WAVs CPU 1.30.0) e `J:\lia-evidence\rx580-local-ai-407300b\` (6 WAVs ORT 1.24.4) — **fora do repo**, não inspecionáveis; (b) `9e94dce` **não existe** (cat-file falha, API 422); (c) `codex/lia-audio-recovery-407300b` **não existe**; (d) zero `*.wav` e zero `lia.voice.synthesize` versionados. |
| **Ação** | Codex, na máquina Windows, versionar **manifesto** (SHA-256 dos WAVs, comando, ambiente, log de síntese). WAVs grandes ficam fora do Git, referenciados por hash. |
| **Aceite** | Manifesto revisável + pelo menos 1 WAV reproduzível + `git status` limpo |
| **Proibição** | **Não reconstruir nem inventar** a evidência perdida |

### AUD-R-04 — Documento de voz multi-provedor

| Campo | Valor |
|---|---|
| **Origem** | `codex/lia-multi-provider-voice` @ `fd0451d766` |
| **Classificação** | **DOCUMENTAR** (copiado) |
| **Conteúdo** | Arquitetura TTS/STT com provedores independentes; evidência Windows em `407300b`; catálogo de candidatos com licenças. |
| **Ressalva** | **Doc ≠ implementação aprovada.** Cita 110 testes e 4+6 WAVs — evidência **não versionada**; reprodução/STT/turno completo "pendentes" no próprio texto. |
| **Não** | Não altera seleção de providers, não promove candidato, não autoriza TTS remoto (P-2). |

---

## 4. UI/UX — `arena/250b337a` @ `ad802efe` × `codex/lia-ui-ux-fase-1` @ `e72574e8`

Base `407300b` em ambas. **A Principal está na base nesses arquivos** — nada de UI da Fase 1 está integrado.

### UI-R-01 — Primitivos (`LiaButton`, `basic-button`, `DoubleCheckButton`)

| Campo | Valor |
|---|---|
| **Classificação** | **PORTAR** |
| **Arquivos** | `lia-app/src/renderer/src/components/lia/LiaButton.vue` (l. 32 `min-height:40px`, 39–40 foco, 59–72 tokens + `forced-colors`) · `lia-app/src/renderer/src/styles/lia-tokens.css` (`--lia-accent-action`, `--lia-accent-action-hover`) · `airi/packages/ui/src/components/misc/basic-button.vue` (l. 18 `min-h-8`, 30–32 `motion-reduce`, `focus-visible`) · `…/double-check-button.vue` (l. 4 `useId/nextTick`, 44–86 confirmação, foco em Cancelar, Escape, retorno de foco, `description`) |
| **Depende de** | Nada de segurança |
| **Risco** | Baixo. Mudança de comportamento em consumidores existentes do `DoubleCheckButton` (novos props opcionais). |
| **Testes** | `lia-ui-foundation.test.ts`, `app-shell.test.ts`, `lia-config.test.ts`; contraste estático `#a62b90` × branco = **6,2321:1** |
| **Ordem** | 2.1 |
| **Aceite** | Suítes PASS; nenhum hex hardcoded no componente; foco visível e Escape cobertos |

### UI-R-02 — HomeView

| Campo | Valor |
|---|---|
| **Classificação** | **PORTAR** |
| **Arquivos** | `lia-app/src/renderer/src/views/HomeView.vue` (l. 245–246 `aria-describedby`/`aria-busy`, 262 `role=status` de feedback, 300 `role=status aria-live=polite aria-atomic=true`), `views/home-vm.ts`, `styles.css` |
| **Depende de** | UI-R-01 |
| **Risco** | Baixo-médio — altera a primeira tela; exige teste de first-run |
| **Testes** | `home.test.ts`, `app-shell.test.ts` |
| **Ordem** | 2.2 |
| **Aceite** | Nenhum anúncio duplicado (assertiva de `aria-atomic`); CTA não promete conversa sem IA (`aria-busy`/disabled por estado desconhecido) |

### UI-R-03 — Confirmação destrutiva + guarda de chat vazio

| Campo | Valor |
|---|---|
| **Origem** | `250b337a` (DoubleCheck) + `e72574e8` (guarda de sessão/mensagens — a **única** ideia do Codex portada) |
| **Classificação** | **PORTAR / ADAPTAR** |
| **Arquivos** | `stage-tamagotchi/src/renderer/components/InteractiveArea.vue` (l. 353–364 handler; `aria-label` na lixeira; desabilitar reativamente) · `LiaProviderConfig.vue` (uso do DoubleCheck) |
| **O que muda vs. Codex** | O Codex usa `window.confirm` nativo e texto pt-BR hardcoded. A versão da Lia usa `DoubleCheckButton` com `label/confirmLabel/cancelLabel/description` i18n, foco em Cancelar, Escape e retorno de foco. **A guarda** (`!sessionId \|\| !messageCount`) é portada e melhorada: controle desabilitado reativamente + sessão capturada no handler. |
| **Depende de** | UI-R-01 |
| **Risco** | Médio — mexe no fluxo de limpeza de conversa (dados do usuário). **Nunca** apagar sem confirmação. |
| **Testes** | `lia-config.test.ts`, testes de chat/`index.vue`; E2E Windows pendente |
| **Ordem** | 2.3 |
| **Aceite** | Cancelar preserva conversa; confirmação só com sessão e mensagens; foco retorna ao gatilho |

### UI-R-04 — `LiaProviderConfig` gerenciado, L-02, "IA & Recursos"

| Campo | Valor |
|---|---|
| **Classificação** | **BLOQUEADO** até SEC-04/05 |
| **Arquivos** | `stage-tamagotchi/src/renderer/components/LiaProviderConfig.vue` (resumo `managed` somente leitura; evitar `loadExisting` no mount) · `lia-config/sections/AiSection.vue` (`liaManaged`) · `lia-app/.../ConfigView.vue` e `App.vue` (navegação "IA & Recursos", disclosure legado) · `docs/product/LIA-PHASE1-UI-UX-2026-11-14.md` §L-02 |
| **Por quê** | `LIA-AUTH-RECONCILIATION` §"L-02 e SEC-04/05": `cb2f418` foi implementado **fora da ordem** do plano rev.2 (`0bf0629` exige T-07/T-08 antes). UI oculta **não é** autorização; o bridge `transport-config-service.ts` / `secrets-service.ts` segue acessível. |
| **Aceite para desbloquear** | SEC-R-06/SEC-R-07 fechados + teste browser/Windows no SHA integrado |
| **Nota** | Outras partes da Fase 1 **não** dependem de L-02 e seguem por UI-R-01…03. |

### UI-R-05 — Demais telas (Config/Voice/App shell)

| Campo | Valor |
|---|---|
| **Classificação** | **BLOQUEADO (parte)** / PORTAR (parte) |
| **Portável já** | `VoiceView.vue` (estados), `voice-engine-strings.ts`, `VoiceSection.vue`, `CustomVoicePanel.vue`, `App.vue` (shell) — **desde que** o diff não toque em cofre/segredo |
| **Bloqueado** | Tudo que dependa de editar provedor/segredo no Launcher (`ConfigView`, `AiSection`, `MemorySection` apenas na parte de credencial) |
| **Ordem** | 2.5 (após revisão arquivo a arquivo) |
| **Aceite** | Nenhum arquivo portado altera `transport-config-service.ts`, `secrets-service.ts`, `transport-execution-service.ts` |

### UI-R-06 — `basic-button` (motion-reduce) — já coberto em UI-R-01

### UI-R-07 — Confirmação nativa do Codex (adaptação)

| Campo | Valor |
|---|---|
| **Classificação** | **ADAPTAR** — só a **guarda**, não o `window.confirm` |
| **Arquivo** | `InteractiveArea.vue` (l. 353–357 do Codex) |
| **Justificativa** | `window.confirm` bloqueia a thread, não é estilizável, não tem foco controlado nem i18n; o produto já tem `DoubleCheckButton`. |

### UI-R-08 — `role="status"` do Codex em Home

| Campo | Valor |
|---|---|
| **Classificação** | **REJEITAR** |
| **Justificativa** | Redundante: a Home da Lia já tem `role="status" aria-live="polite" aria-atomic="true"` (l. 300) — o do Codex é subconjunto e criaria anúncio duplicado. |

### UI-R-09 — `background:#a62b90` + `filter:brightness(1.08)`

| Campo | Valor |
|---|---|
| **Classificação** | **REJEITAR** |
| **Justificativa** | Hardcode de hex no componente e hover por filtro (imprevisível em forced-colors/print). A versão com tokens `--lia-accent-action`/`--lia-accent-action-hover` tem contraste maior no hover (7,7453:1 vs 5,53:1) e `forced-colors: Highlight`. |

---

## 5. Higiene/CI — `arena/4ec8f22b` @ `be24b94f`

### HYG-R-01 — Onda 1 de higiene

| Campo | Valor |
|---|---|
| **Classificação** | **MANTER NA ORIGEM (já incorporado)** |
| **Verificação** | `memory-service.ts`, `memory-context.test.ts`, `LIA-BUILD-HYGIENE-2026-11-14.md` → **blob idêntico**. `ai-connection-service.ts`, `config-update-sanitizer.ts`, `ipc.ts`, `process-monitor.mjs`, `transport-execution-service.ts` → diferenças são **posteriores** (`@lia/contracts`, runtime D-04), não regressão. |
| **Pendência cosmética** | `process-monitor.mjs:223` — a Principal usa `({ firstSeen: _firstSeen, ...identity })`; a higiene usa `({ _firstSeen, ...identity })`. Verificar se a regra `no-unused-vars` aceita o rename; se não, alinhar **só esse arquivo**. |
| **Aceite** | Nenhum retrabalho; lint escopado por arquivo |

### HYG-R-02 — `try/catch` com `errorMessageFrom` em `updateCredits()`

| Campo | Valor |
|---|---|
| **Classificação** | **REJEITAR** |
| **Justificativa** | `errorMessageFrom` **não é sanitizador** (auditoria `LIA-AUTH-RECONCILIATION`): mensagem de fetch/servidor pode conter URL, texto ou segredo. Substituído por SEC-R-04, que classifica `auth-error`/`error` e loga classe fixa. |

---

## 6. Pesquisa — `arena/826a33f1` @ `b345355f75`

### RES-R-01 — Documentos de pesquisa

| Campo | Valor |
|---|---|
| **Classificação** | **PORTAR como *Research reference*** (copiados) |
| **Arquivos** | `docs/research/{2026-11-14-runtime-resource-research, LIA-LFM3-EVALUATION, LIA-MODEL-PROVIDER-ARCHITECTURE, LIA-MODEL-PROVIDER-CATALOG, LIA-MODEL-PROVIDER-RECOMMENDATIONS, LIA-ORNITH-WEIGHTS-RESEARCH, LIA-WINDOWS-AMD-MODEL-COMPATIBILITY}.md` + `docs/reports/LIA-RESEARCH-DOCUMENT-TRANSFER-REVIEW.md` |
| **Regra** | Nenhum modelo promovido a padrão; nenhuma dependência/peso adicionado; distinção teórico × teste local × benchmark real preservada |
| **Aceite** | Nenhuma alteração em código/catálogo executável por causa destes docs |

### RES-R-05 — Esquema documental concorrente

| Campo | Valor |
|---|---|
| **Classificação** | **MANTER NA ORIGEM** |
| **Arquivos** | `DOCS_VERSION`, `docs/PROJECT-OVERVIEW.md`, `docs/PROJECT-STATUS.md`, `docs/DECISIONS.md`, `docs/BRANCH-STRATEGY.md`, `docs/AGENT-WORKFLOW.md`, `.agents/skills/**` |
| **Justificativa** | Conflita com a estrutura canônica (`docs/project/CURRENT-STATE.md`, `docs/architecture/decisions/`, `docs/product/`, `docs/reports/`). Duas fontes de status criariam divergência — exatamente o problema que esta rodada corrige. |

---

## 7. Documentos e histórico

### DOC-R-01 — Docs preservados (segurança/áudio/UI/voz)

**Classificação: PORTAR** (executado nesta rodada, cópia byte-a-byte) — ver `LIA-GLOBAL-BRANCH-RECONCILIATION` §3.3.

### DOC-R-02 — `docs/especificacao-geral-produto-lia`

**Classificação: MANTER NA ORIGEM** — conteúdo já idêntico na Principal (spec + brand). Nada a portar.

### DOC-R-03 — `qa/windows-benchmarks`

**Classificação: MANTER NA ORIGEM** — benchmark de 02/10/2026 em SHA antigo (`cfd8d7f`); PASS de infra (build/lint/typecheck/vitest), **sem áudio**, não qualifica o SHA candidato.

### VOICE-R-01 — `codex/lia-multi-provider-voice`

**Classificação: DOCUMENTAR** — ver AUD-R-04.

---

## 8. Grafo de dependências

```
SEC-R-01 ─┐
SEC-R-02 ─┼─> (independentes) 
SEC-R-05 ─┘

SEC-R-03 ──> SEC-R-04 ──> consumidores
   │
   └──> SEC-R-06 (OIDC-OFF)  [requer P-1 + T-07/T-08 = SEC-R-07]

SEC-R-07 ──> UI-R-04 (L-02)  [BLOQUEADO]
SEC-R-07 ──> UI-R-05 (parte)

UI-R-01 ──> UI-R-02
        └─> UI-R-03

REC-01 (evidência Windows) ──> AUD-R-01 ──> AUD-R-02 ──> G-AUD
REC-02 (P-2 limiares) ───────┘
```

**Paralelizável:** (SEC-R-01) ∥ (SEC-R-02) ∥ (SEC-R-05) ∥ (RES-R-01) ∥ (UI-R-01).
**Sequencial:** SEC-R-03 → SEC-R-04; SEC-R-07 → UI-R-04; REC-01 → AUD-R-01.
**Nunca em paralelo:** SEC-R-03/04 (mesmo arquivo `auth.ts`) com qualquer outra frente que toque o store.

---

## 9. Checklist de execução (para quem integrar)

1. `git status` limpo + SHA anunciado; nenhuma outra sessão na mesma máquina.
2. Um registro por commit; mensagem cita o ID (`SEC-R-01`, `UI-R-01`…).
3. Rodar **as suítes no SHA integrado** (não em cópia isolada).
4. Teste de mutação para cada guarda de segurança.
5. Atualizar `CURRENT-STATE.md` no **mesmo** commit quando o gate mudar.
6. Nunca aplicar patch de `auth.ts` sem revisar import por import.
7. Não rodar lint global em arquivos de outras frentes.
8. Não fechar branch de origem antes de o port estar provado.
