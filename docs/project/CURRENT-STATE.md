# LIA — Estado operacional atual (living state)

**Fonte de verdade operacional do projeto.** Uma sessão nova lê o **§0 — Estado agora**,
logo abaixo; o restante é histórico consultável, aberto quando a tarefa exigir. Quando uma
decisão de produto ou um estado de validação mudar, este arquivo é atualizado no mesmo
commit. Registra **estado**, não narrativa: relatório de rodada vai para
`docs/product/`.

---

<!-- CABEÇALHO DE ESTADO: uma sessão nova lê só o §0. O resto é histórico
     consultável. A §6 (regras permanentes) é obrigatória antes de alterar código. -->

## 0. Estado agora

**Modelos livres em 29/10/2026:** removida coerção de IDs fora do catálogo no
editor de serviço/modelo. Principal e reserva aceitam IDs manuais; sugestões
locais e descobertas são opcionais, com estados pt-BR/en, debounce, deduplicação
e descarte de respostas antigas. Chaves de rascunho/vault continuam transitórias.
Teste de conexão agora envia o modelo escolhido em uma requisição de **texto**,
sem exigir listagem; não aprova ferramentas ou imagem. Salvar ativa a preferência
pelo mecanismo existente e preserva campos opcionais do documento (`brain` e
`setup` eram descartados pelo handler anterior, reproduzido antes da correção).
**PASS automatizado:** stores/lia 365, browser 11, persistência/lifecycle 11;
lint de 13 arquivos, vue-tsc, build i18n e build Stage. Sem alteração no runtime
compartilhado Stage UI, dependências ou schema. **NÃO EXECUTADO:** serviço/modelo
real, reinício instalado e gate Windows completo; nenhuma chamada externa nesta
rodada. Seis Core preexistentes preservados; baseline funcional inalterado.
Evidências e lista de arquivos: `docs/product/MODELOS-LIVRES-2026-10-29.md`.
**Próximo passo desta entrega:** gate Windows com serviço autorizado e limites
explícitos; rotas Brain por envio continuam tendo precedência quando configuradas.
Não retomar remoção AIRI nem alterar políticas de roteamento nesta entrega.

**Governança de arquitetura em 28/10/2026:** `AGENTS.md` ganhou a **§99 —
Independência arquitetural do AIRI**, que passa a ser a direção permanente e
prevalece sobre qualquer documento anterior. A Lia é o produto; o AIRI é
referência técnica externa. Foram corrigidas 22 passagens que ainda tratavam o
AIRI como base ou stack (§1, §6, §7, §8, §16, §31, §34, §36, §54, §73, §74, §75,
§78, §86, §92, §94, §95, §96, §98.3, §98.4, §98.18), e a §99 é nova.
`LIA-ARCHITECTURE.md` recebeu nota de supersessão e
segue como registro histórico. Tarefa **documental**: nenhum código, dependência,
lockfile, build ou instalador alterado; `airi/` intocado. Plano atualizado em
`docs/architecture/AIRI-DECOUPLING-PLAN-2026-10-28.md` (A1 concluída, C1
resolvido, B0 adicionada).

**Investigação de independência em 28/10/2026:** mapeado o que falta para remover
`airi/` com segurança. Nada foi alterado. Fatos: `airi/` são **5 687 dos 5 906**
arquivos rastreados (96%) e **580 MB**, dos quais 465 MB são a documentação do
próprio AIRI, sem uso pela Lia. Launcher e `@lia/core` **não importam nada do
AIRI** — a dependência real é o Stage, que **é** o app AIRI (~260 mil linhas,
21 pacotes do workspace), e o instalador Windows é esse mesmo app rebatizado.
`@proj-airi/*` **não é publicado no npm** (404); `@xsai/*` e `@moeru/*` são (MIT).
Bloqueio principal: `AGENTS.md` §6–§7 manda **depender** do AIRI, o oposto desta
missão. Relatórios: `docs/architecture/AIRI-INDEPENDENCE-2026-10-28.md` e
`AIRI-DECOUPLING-PLAN-2026-10-28.md`.

**Análise comparativa em 28/10/2026 — AIRI estável:** consultada a stable
**`v0.13.0`** (`3c4aca209330f1a78fe7288e8c4ca75639cd10e6`); a Lia permanece em
**`v0.12.0-beta.5`** (`2c1e223`), com **529 commits** de distância e **zero**
merges de subtree desde a integração. Nenhum código foi integrado nesta tarefa.
Três itens classificados como *Vale aproveitar*: grapheme clusters no TTS
(**defeito presente** em `tts-chunker.ts:72`), IPC uma vez por request
(`onlySameWindow`, já disponível no `eventa` 1.0.0 fixado) e resolução de
caminhos de renderer/preload num só lugar. O item de maior prioridade é o TTS.
Relatório: `docs/architecture/AIRI-UPDATE-REVIEW-2026-10-28.md`. Nada foi
compilado nem executado; conclusões vêm de leitura e comparação de arquivos.

**Entrega funcional de 28/10/2026 — Home:** ação **Encerrar conversa** usa o
`stopStage()` existente, bloqueia duplicatas durante a parada e só mostra sucesso
quando a resposta confirma `stopped`. Erro seguro permite retry; PID histórico
não impede o caminho canônico de iniciar. Launcher: **247 PASS / 2 skips**;
Home em Chromium: **7 PASS**; lint, typechecks e build de produção PASS.
Windows: Launcher compilado + IPC/gerenciador reais com processo Node controlado
confirmaram iniciar, parar pela Home e reabrir sem duplicar a instância. Isso
**não aprova AIRI Stage, conversa, imagem ou voz reais**, NÃO EXECUTADOS nesta
rodada sem chamadas externas. Um descendente apareceu na segunda checagem
imediata e estava ausente depois; latência de saída não medida. Baseline mantido.
Seis Core preexistentes preservados e excluídos do commit. Evidências e comandos:
`docs/product/RELEASE-WINDOWS-2026-10-28-HOME-STOP.md`.
**Próximo item:** corrigir feedback de salvar em ConfigView (reload apaga a
mensagem), com regressão no componente e estados de carregamento/erro. A revisão
dos seis Core preservados continua separada; não os incluir em entregas da Home.

**Hardening Alethe em 28/10/2026:** editor com texto DOM inerte e URLs HTTP(S)
sem credenciais; reserva atômica de estimativas e diagnóstico de excedentes.
Chromium real: 1 PASS; orçamento: 10 PASS, incluindo processos Windows;
estrutura skills: 5 PASS. Sete referências reparadas. Tokens reportados seguem
posteriores à chamada, sem promessa de teto rígido. Não houve nova chamada de IA,
gate de produto ou promoção do baseline. Seis Core preexistentes preservados.
Relatório atual: `docs/architecture/ALETHE-HARDENING-2026-10-28.md`.
A restrição histórica do editor citada na auditoria abaixo é atualizada por este
relatório; não equivale a aprovação de sandbox adversarial ou de todos providers.

**Auditoria em 28/10/2026:** inspecionadas 21 skills raiz e 28 AIRI, incluindo
Alethe 19 integrado em `a0e56fa8`. Nenhuma funcionalidade nova nesta tarefa.
Seis arquivos Core preexistentes continuam modificados e excluídos dos commits
da auditoria. A regra permanente de commit/push em AGENTS.md substitui a antiga
proibição de push nesta branch, preservando baseline e demais salvaguardas.
Resultados e pendências em `docs/architecture/AGENT-SKILLS-AUDIT.md`.
Teste estrutural das skills: 5 PASS após 10 subfalhas iniciais. Alethe: um
worker CLI real read-only, soma 5, processo encerrado e relatório recuperado.
Limites: tokens reportados não são teto por chamada; editor HTML não aprovado
para playbooks não confiáveis; gates do aplicativo não executados nesta auditoria.
Na auditoria, o próximo trabalho de produto era revisar os seis Core preservados;
pendências de skills/editor exigem correção e validação próprias, sem remover AIRI.

| Item | Valor |
| --- | --- |
| Branch | `arena/01a10290-lia-project`; tip sempre via `git rev-parse HEAD` |
| Baseline funcional Windows | `3ef6d11618f787dae6d197645d440a5775a60ad6` — **não promover commit posterior** |
| `main` | `db99c709059a6d074b18361bfb32c9f144620632` — sem merge |
| Fase | **8.0D aberta**, gate de conteúdo da imagem ainda FAIL; 8.0E não iniciada |
| Plano local | `docs/product/PLANO-FINALIZACAO-LIA.md` (o caminho em `docs/project/` não existe) |
| Independência do AIRI | `lia/` criado: `core` (contratos, **26 testes**), `stage` (**9**), `launcher` (**8**) — ver §0.1 |

### 0.1 Independência do AIRI — 27/10/2026

Medido contra um clone limpo do `moeru-ai/airi` em `2c1e223`
(`v0.12.0-beta.5`), **fora** da árvore do repositório:
**353 arquivos criados pela Lia, 95 do upstream modificados, 0 removidos.**

O commit-base deixou de ser desconhecido — era a única pergunta de proveniência
em aberto, e a resposta já estava em `docs/upstream/AIRI-INTEGRATION.md` §1. O
registro em `docs/airi-modificacoes-registro.md` §1 foi corrigido.

**Código novo em `lia/`** — ao lado de `airi/`, jamais dentro, e **fora** do
`pnpm-workspace.yaml` do AIRI:

| Módulo | Conteúdo | Testes |
| --- | --- | --- |
| `lia/core` | `@lia/contracts`: ciclo de vida + protocolo, **zero dependências** | 26 PASS |
| `lia/stage` | host do Stage com plataforma injetada; `index.ts` é o único que importa Electron | 9 PASS |
| `lia/launcher` | decisão `packaged` × `development` em função pura | 8 PASS |

**Isto NÃO é o Stage pronto.** Abrir janela, renderizar personagem e encerrar
sem órfão no Windows estão **NÃO EXECUTADOS** — o ambiente do agente não tem
display nem binário do Electron. Teste unitário verde não é o gate visual.

**Achado que condiciona o resto:** a Lia hoje não é um app separado do AIRI, é
o AIRI com 353 arquivos injetados — 165 deles dentro de
`apps/stage-tamagotchi`, e com alterações em `packages/core-agent` e
`packages/stage-ui`, que são compartilhados e seriam sobrescritos por um
`subtree pull`.


**Windows real comprovado nesta rodada de 20/10/2026:**

- `Lia.bat` original → Launcher → Conversar → build concluído → Node real →
  Stage visível. Encerramento gerenciado observado e processos removidos.
- Chat: corrigida seleção por janela; nova conversa manteve a resposta **42**.
- Stream vazio agora produz erro em pt-BR e terminal `failed`, com retry e
  rascunho/anexos preservados. Não aprovar apenas o HTTP 200 do serviço.
- **A2 / M3.1 concluído:** quatro imagens recusadas pelo limite do modelo (3),
  aviso em pt-BR, texto e quatro prévias preservados, zero requisições do prompt
  sintético ao serviço. Contagem inclui histórico elegível e cobre envio/retry/
  captura de voz. Retry antigo sem ID mantém alvo por índice e passa pelo preflight.
- Voz B1/B1.1 continua PASS **histórico**, sem novo teste humano de microfone.

**Automatizado final da A2:** Core 353 testes, serviços de autoridade 76,
browser 15, Launcher 247 + 2 skips, Node 267, Python 487 casos/10 skips:
**PASS**. Lint dos arquivos alterados, typechecks Core/Stage e build Core: PASS.
A1 concluído: 11 casos novos da política real, 15 aprovados; opt-out e preferência
intactos. Isso não aprova failover E2E contra serviços reais.
Python teve FAIL intermitente em limpeza de fixtures (WinError 32/5), inclusive
na repetição após A1; a repetição após A2 passou em 272 s. Detentor/causa não
identificados; não ignorar, aumentar timeout ou declarar esse problema resolvido.

**Compatibilidade Spark corrigida:** comparação mínima sem Persona/histórico,
mesma imagem/SSE/limite 128: schema Spark com strict=true → stop vazio/um EOS;
strict=false → descrição correta. Mantidos schema e ferramenta, validação Zod
local antes do despacho e contrato interno de broadcast. Sem hardcode de modelo.
29 testes dirigidos, lint e typecheck Stage UI PASS. Build de produção Stage PASS;
Node 267 e Launcher 247 + 2 skips PASS nesta repetição.
Python após Spark teve FAIL de limpeza. O checkout recebeu posteriormente
limpeza resiliente e evidência de cinco repetições aprovadas. **Preflight de
21/10:** Python 495/10 skips PASS, Node 267 PASS, Launcher 247/2 skips PASS e
core-agent 144 PASS; instalação e builds de pré-requisito PASS. Isso não prova
quem detinha os handles antigos. O contrato de três chunks do commit `9267a50`
não reproduzia a perda de espaço. Em 22/10, um teste com deltas unitários
reproduziu no harness real: a guarda `trim()` descartava whitespace isolado.
Correção mínima aprovada com RED → GREEN e contraprova contra a guarda antiga.
Conteúdo, slices, histórico e hooks preservam espaços/quebras. 145 testes
core-agent, 255 Chat/Stage UI, 15 browser; lint, typecheck e build PASS.
Python 496/10 skips, Node 267, Launcher 247/2 skips PASS na repetição.
Windows com **transporte SSE sintético** mostrou palavras separadas e conteúdo
salvo exato; sonda restaurada. Não equivale a novo gate do serviço/modelo/voz.

**Bloqueio de saída da 8.0D:** no Windows, as sete ferramentas foram mantidas e
a resposta voltou a aparecer, mas o retângulo foi chamado de quadrado: conteúdo
da imagem **FAIL**. Texto independente em nova conversa GPT-OSS mostrou **42**:
PASS Windows real. Também foi observada perda de espaço (“círculoazul”) e prévia
de raciocínio em inglês. Não promover gate nem baseline por sucesso do stream.
9router `http://localhost:20128/v1`: último reteste de envio manteve HTTP 401
`invalid_api_key` (catálogo era acessível). Nenhuma chave foi lida/impressa para contornar.

**Onde parou:** A1 e A2 concluídos; A3 (matriz inicial) criado e atualizado com
estados conservadores. Cloud Sync v1 (A4) e fatiamento de instruções (A5) pendentes.
**Organização em 21/10:** fixtures em `Tests/tmp/`; saída de QA avulsa e staging
de benchmark em `Tests/artifacts/`. 157 arquivos legados movidos com SHA-256
conferido; 14 diretórios vazios arquivados sob `Tests/tmp/legacy-20261021/`.
Raiz sem `.devkit-*`. Runtime e dados de usuário preservados.
Validação final: Python 496/10 skips, Node 267 e Launcher 247/2 skips PASS;
sem novas fixtures residuais. Lint de ferramentas da raiz BLOCKED por falta
de configuração ESLint aplicável (exit 2); não foi declarado PASS.

**Reteste real em 22/10:** primeiro pedido BLOCKED 413 (7006 > 7000 tokens de
entrada). Pergunta mais curta recebeu resposta, mas conteúdo FAIL: quadrado
em vez de retângulo e terceira forma inventada. PNG enviado intacto por hash,
842 bytes/240×160; sete ferramentas mantidas. Texto bruto errado já veio do
serviço. Whitespace preservado no store, inclusive três deltas só de espaços.
Texto independente: 42 visível, rota de texto e zero imagens no pedido, PASS
funcional; UX FAIL por reasoning inglês/placeholder. Sondas restauradas.

**Erros de envio concluídos em 22/10:** catálogo seguro antes da persistência,
exibição/cópia pt-BR/en reativa e legado sem reescrita. 111 testes dirigidos,
275 de regressão Chat, 13 browser; lint de 9 arquivos, typecheck Stage UI,
build i18n/Stage PASS. Windows com transporte sintético: 413 seguro na tela/store,
rascunho preservado, retry 200 concluído; duas requisições e sondas restauradas.
Python 496/10 skips, Node 267 e Launcher 247/2 skips PASS. Um console.error
bruto antigo no Core segue pendente.

**Reasoning concluído em 23/10:** janela Chat recebe marcador gerenciado pela
autoridade já usada na principal; política explícita de apresentação não depende
de snapshot. Flag desenvolvedor reativa, histórico/stream intactos e standalone
preservado. RED funcional, contraprova e correção de regressão standalone na
revisão; 22 browser dirigidos, 11 contratos e 18 browser de regressão PASS.
Lint de 8 arquivos, typechecks Stage/Stage UI e build Stage PASS. Typecheck teve
TS2307 de pré-requisito em execução intermediária; repetição com dist estável
passou, sem atribuir causa confirmada à concorrência.
Fixtures do host agora fornecem contexto real (28 PASS, lint +2 arquivos).
Fixtures antigas do reporter foram corrigidas em commit separado para emitir
resposta real no mock (12 PASS), preservando política/asserções. Tipo usa API
pública do Stage UI após corrigir import TS2307. Stage Node completo final:
1798 PASS/4 skips em 144 arquivos; falhas intermediárias preservadas no relatório.
Python 496/10 skips, Node 267 e Launcher 247/2 skips PASS. Windows real sem transporte de teste:
resposta 42, raciocínio salvo e ausente do DOM, flag false e placeholder pt-BR;
captura aprovada. Sessão encerrada às `2026-10-23T12:54:23.461Z` em 584 ms,
Launcher exit 0, Electron do checkout ausente. Baseline inalterado.

**Próximo item exato:** proteger logs brutos de falha de envio do Core,
incluindo orquestrador, promises/callbacks do llm-service e parser de resposta.
Preservar identidade da rejeição, sinks e estados terminais, com sentinelas
sintéticas em testes antes da correção. Gate de conteúdo da imagem continua
FAIL; loop real de ferramentas pendente. A sonda de conexão atual só usa ping
e não aprova loop.
Continuar as pendências da 8.0D antes
de avançar Launcher/presença/release. Não alterar fallback, Persona ou secrets.

Execução de QA de 23/10 encerrada normalmente às `12:54:23.461Z` em 584 ms;
Electron do checkout ausente. O gate de apresentação desta rodada não usou
sonda de transporte. Evidências locais em `Tests/runs/release-20261022/`.
Relatório atual, arquivos, comandos e DoD em
[`RELEASE-WINDOWS-2026-10-23.md`](../product/RELEASE-WINDOWS-2026-10-23.md).
Histórico de imagem e erros no relatório de 22/10.
Instalador/instalação limpa NÃO EXECUTADOS; release incompleta, baseline inalterado.

**Restrições de continuidade:** o preflight em `20b9da7` encontrou árvore limpa;
o plano está versionado. Sem reset/clean/rebase/merge, nova branch ou
mudanças em `Lia.bat`/`DevKit.bat`.
Push normal somente na branch acordada, seguindo a regra permanente de AGENTS.md.
**Quanto falta:** [`QUANTO-FALTA.md`](QUANTO-FALTA.md). **Antes de código:** §6.

---

## 1. Repositório, branch e baseline validado

| Item | Valor |
| --- | --- |
| Repositório | `BloomRX/Lia-Project` |
| Branch de trabalho | `arena/01a10290-lia-project` |
| **Último commit funcional validado em Windows** | `3ef6d11618f787dae6d197645d440a5775a60ad6` |
| `main` | `db99c709059a6d074b18361bfb32c9f144620632` — **não recebeu merge** |
| Prefixo de código | tudo sob `airi/` |
| Máquina de desenvolvimento/teste | Ryzen 5 5500 · AMD RX 580 8 GB · 16 GB RAM — perfil de compatibilidade importante; **nunca** otimizar a arquitetura exclusivamente para ela (migrado da §88 do `AGENTS.md`) |

**Atenção:** a branch contém código funcional **posterior** ao baseline acima — a rota
Brain multimodal da Phase 8.0D-M1, o bootstrap de roteamento da Phase 8.0D-M2 e a retenção
de turno falho da Phase 8.0D-M3 (seção 5). O reteste Windows da M2 **provou** o bootstrap
gerenciado do Brain e a seleção de rota (`mode=absent` → `automatic`; Qwen selecionado;
`initialRouteOverride*` observado na execução). O que continua **pendente** é o gate de
conteúdo da imagem: entender a imagem de fato, com resposta correta. O baseline só avança
quando um commit passar por esse gate Windows; até lá ele permanece `3ef6d11`.

### O tip da branch não é registrado aqui

A branch pode conter commits documentais posteriores ao baseline funcional, então
qualquer SHA de tip gravado neste arquivo nasceria obsoleto no commit seguinte. **O tip é
sempre verificado dinamicamente no preflight**, nunca lido deste arquivo:

```bash
git rev-parse HEAD                                            # tip local
git ls-remote origin refs/heads/arena/01a10290-lia-project    # tip remoto (devem bater)
git fetch -q origin main && git rev-list --count FETCH_HEAD..HEAD   # à frente de main
git status --porcelain | wc -l                                # deve ser 0
```

Pelo mesmo motivo **não existe contagem fixa de commits à frente de `main`** neste
arquivo: ela muda a cada commit e deve ser calculada no preflight. O que este arquivo
fixa são apenas duas coisas — o `main` de referência (`db99c709…`, válido enquanto
`main` não se mover) e o baseline funcional validado.

### Baseline funcional validado

`3ef6d11618f787dae6d197645d440a5775a60ad6` — **B1.1 / last Windows-validated functional
commit**.

É o último commit **de código** que passou pelo gate de runtime real. Commits posteriores
na branch podem ser puramente documentais; eles não alteram o baseline e não precisam
atualizar este arquivo. Quando um novo commit de código passar por um gate real novo, o
baseline passa a ser ele.

Commits funcionais da fase atual, do mais antigo ao mais recente:

```
d819397  phase 8.0D: derive final route conformance facts
8ddcbd2  phase 8.0D: preserve image attachments on retry
9ad9119  phase 8.0D: preserve voice turn fidelity
27ba585  phase 8.0D: bootstrap Lia-managed transcription      <- B1
3ef6d11  phase 8.0D: harden managed microphone bootstrap      <- B1.1 / last Windows-validated functional commit
```

**Nenhuma sessão deve criar outra branch, fazer merge em `main` ou abrir PR por conta
própria.** A branch de trabalho é fixa por sessão.

---

## 2. Cadeia de voz — WINDOWS E2E PASS

```
Lia.bat → managed STT → microphone → transcription → D2B12 → Brain → response → Kokoro TTS
                                     = WINDOWS E2E PASS
```

Confirmado pelo usuário em Windows real, rodando o commit `3ef6d11`, pelo fluxo normal:

- Lia iniciada por `Lia.bat`, sem nenhum passo manual;
- **nenhuma** configuração em AIRI Settings > Hearing;
- microfone/Hearing funcionou automaticamente;
- o usuário falou e a fala apareceu transcrita na interface, abaixo da Lia;
- o transcript entrou no fluxo normal de conversa;
- Lia respondeu;
- a resposta foi reproduzida por TTS.

### O que isso significa, em fatos

| Fato | Estado |
| --- | --- |
| **B1 — managed STT landed** | `27ba585` |
| **B1.1 — microphone bootstrap hardening landed** | `3ef6d11` |
| **Windows E2E** | **PASS confirmado em runtime real** |
| STT em produção | Groq, definição OpenAI-compatible, modelo `whisper-large-v3-turbo` |
| Hearing no modo **Complete** | configurado **automaticamente** pelo Launcher |
| Seleção manual de STT pelo usuário | **não é necessária** |
| Web Speech | **apenas diagnóstico histórico — NÃO é fallback** |
| Voice → D2B12 → Brain → TTS | **validado em runtime real** |

### Blocker encerrado — não reabrir

O blocker "microfone não habilita / fala não transcreve no Windows" está **encerrado**.

**Não reabrir sem nova evidência concreta de regressão** — ou seja, um novo
comportamento observado em Windows real, com o log do console do renderer do Stage.
Não reabrir por leitura de código, por suspeita estática, nem por teste automatizado
isolado: os testes passam e o runtime real também passa.

---

## 3. Como o Hearing gerenciado funciona (para não quebrar)

Autoridade de produto: o **Launcher** decide o STT e escreve o documento canônico
`lia-product.json`. O renderer do Stage **lê** essa decisão por IPC read-only e a projeta
nos stores do AIRI. Não existe setter de STT no renderer.

- `packages/lia-core/src/product/config.ts` — schema canônico, **sem nome de vendor**.
- `apps/lia-app/src/main/lia-host.ts` — `ensureSttReadyForConversar()` roda antes de
  `stage.start` e grava `voice.stt.preferred`.
- `apps/stage-tamagotchi/src/renderer/stores/lia/hearing.ts` — projeta o alvo canônico e
  faz o bootstrap do microfone.
- `apps/stage-tamagotchi/src/renderer/stores/lia/provider.ts` — alias de credencial
  **somente no caminho de leitura**.

Invariantes que B1/B1.1 estabeleceram e que valem como contrato:

- `voice.enabled === false` é **opt-out absoluto**: nunca chega ao handshake de permissão.
- O microfone **não é religado** depois que o usuário o desliga de propósito.
- O one-shot do bootstrap é consumido **por sucesso**, não por tentativa.
- Não existe watcher de microfone no store de Hearing.
- Nenhuma chave, áudio, transcript, `deviceId` ou label de dispositivo é logado ou
  persistido. Diagnósticos são metadata-only, prefixo `[LIA-HEARING]`.
- O modo de transcrição é **segmentado** (fala → pausa → texto), não palavra a palavra:
  é o caminho `startAutoSegmentation()`, e é o comportamento correto.

---

## 4. Estado da validação automatizada

Números da Phase 8.0D-M3 (retenção de turno falho + roteamento pelo prompt efetivo).
**Teste automatizado verde não é gate de runtime** — ver a seção 5 para o gate Windows
pendente.

| Verificação | Resultado |
| --- | --- |
| Stage `vitest run --project node` | 142 arquivos, **1757 passed**, 1 skipped |
| `@proj-airi/stage-ui` `--project node` | 151 arquivos, **1095 passed** |
| `@lia/core` | 28 arquivos, **353 passed** |
| `@proj-airi/core-agent` | 13 arquivos, **142 passed** |
| `@lia/lia-app` | 19 arquivos, **202 passed**, 2 skipped |
| typecheck `stage-tamagotchi` | **0 `error TS`** |
| typecheck `stage-ui` / `@lia/core` / `core-agent` / `@lia/lia-app` | **0 `error TS`** |
| `pnpm lint` (sem `--fix`) | **0 warnings, 0 errors em 3301 arquivos** |

Mutation tests (cada mutação restaurada e confirmada por `md5sum -c`):

| Mutação | Falhas |
| --- | --- |
| **M3** marcação da cauda do envio falho desativada em `executeSend` | **6 de 7** testes de exclusão; a requisição seguinte volta a levar **4 imagens** em vez de 1 — exatamente o `Too many images` do Windows |
| **M3** contribuição do histórico efetivo removida de `hasImageInput` | **3**; o retry só-texto sobre histórico com imagem volta a resolver **`openai/gpt-oss-120b`** em vez de `qwen/qwen3.8-27b` |
| **M3** filtro de `role: 'error'` removido da projeção | **5** (3 core-agent + 2 stage-ui); a bolha de erro volta a entrar no prompt do provider |
| **M2** chamada `ensureBrainReadyForConversar(snapshot)` removida de `conversar()` | **10 de 11** testes do ciclo de vida gerenciado |
| **M2** sonda de elegibilidade + gate de identidade do engine removidos | **1** (o teste “provider que o Brain não atende não fabrica automatic”) |
| **M2** chamada `decisionLog?.(decision)` removida da ponte | **3** (s1, s2, s3) |
| **M2** bloco `initialRouteOverride*` removido do formatador | **3** (m1, m2, m5) |
| **M1** `imageInput: true` removido do Qwen | 13 (8 lia-core + 5 Stage) |
| **M1** segunda rota removida da política | 12 (gates 3, 4, 5, 6, 6c, 8 + testes de política) |
| **M1** transporte do attachment até a request removido | 2 (gate 7 + o teste de attachments pré-existente) |

Comandos (a partir de `airi/`):

```bash
cd apps/stage-tamagotchi && npx vitest run --project node [arquivo]
cd packages/stage-ui && npx vitest run --project node [arquivo]
npx vitest run packages/core-agent          # a partir de airi/; @proj-airi/core-agent não tem script test
NODE_OPTIONS=--max-old-space-size=3072 npx vue-tsc --noEmit -p tsconfig.json   # em apps/stage-tamagotchi
pnpm lint
```

Armadilhas de tooling que continuam valendo:

- em `apps/stage-tamagotchi` passar **sempre** `--project node` (o default roteia para
  `browser`/chromium, ausente aqui);
- `vue-tsc` estoura heap no padrão — usar `NODE_OPTIONS=--max-old-space-size=3072`;
- `pnpm typecheck` na raiz **não completa** neste ambiente: nunca declarar como PASS;
- nunca `eslint --fix`;
- o ambiente **reverte sozinho**: conferir `git status`/HEAD no início de toda rodada e
  re-clonar da URL do GitHub na branch correta quando necessário.

---

## 5. Estado da 8.0D e a rota multimodal (Phase 8.0D-M1 / M2)

> **Status do gate Windows da M1: FAIL / NÃO VALIDADO.** O Qwen **não chegou a
> executar** — não falhou: não foi testado. Ver “Primeiro gate Windows da M1” abaixo.
> O baseline funcional **não avança**; continua `3ef6d11`.

Conforme `docs/product/lia-ui-implementation-roadmap.md`, a família de fases é
`8.0A → 8.0J` e o trabalho atual está em **8.0D — First Multimodal Brain Adapter**.

A reconciliação curta dos critérios de 8.0D **já foi feita** (auditoria read-only aceita).
Resultado, com a Phase 8.0D-M1 já aplicada:

| critério | status | observação |
| --- | --- | --- |
| text conversation | **DONE** | validado em Windows real no baseline `3ef6d11` |
| image/screen understanding | **IMPLEMENTADO, bootstrap+rota PROVADOS em Windows, gate de conteúdo da imagem PENDENTE** | rota Qwen (M1) + bootstrap de roteamento (M2, provado em Windows) + retenção de turno falho (M3). Falta o sucesso do turno de imagem no provider. Ver abaixo |
| audio understanding ("where supported") | **NOT STARTED** | o candidato aprovado é text+image; B1/B1.1 é STT *antes* do brain, não áudio nativo no brain |
| tool calling | **PARTIAL** | transporte + gate de compatibilidade provados no seam da Lia; o *loop* completo pertence ao `@xsai/stream-text` e segue como item de closure |
| latency | **NOT STARTED** | nenhuma medição existe; o contrato de telemetria exclui timing por desenho |
| region/network impact | **NOT STARTED** | nenhuma referência no escopo Brain |
| failure behavior | **PARTIAL** | failover real registrado e classificado; a **retenção de turno falho** foi corrigida na M3 (um envio que falhou não participa mais do contexto de provider futuro). Teste dirigido da política real PASS em 20/10/2026 (15 casos, incluindo 11 novos); recuperação E2E contra serviços reais NÃO EXECUTADA |
| default não medido no alvo | **PARTIAL** | medido só pelo E2E de voz |

### O que a Phase 8.0D-M1 entregou

Uma rota Brain **realmente multimodal**, sem substituir o brain textual:

- engine `groq`, agora com **dois** modelos: `openai/gpt-oss-120b` (textual, primeira rota)
  e `qwen/qwen3.8-27b` (visão, segunda rota);
- o engine declara o **superset** de capabilities; cada modelo declara as suas. É o
  contrato que já existia (`routes.ts`/`resolver.ts` julgam engine **e** modelo pelos
  próprios descritores), não um contorno;
- um turno que exige `imageInput` torna o GPT-OSS inelegível e resolve para o Qwen **por
  capability**, através da política declarada — sem heurística de filename, prompt,
  provider ativo ou UI;
- turno **sem** imagem continua resolvendo para `openai/gpt-oss-120b`; o Qwen nunca é
  promovido por acidente;
- mesma credencial Groq, mesmo provider, nenhuma key nova, nenhum provider novo,
  `activeProvider`/`activeModel` globais intactos;
- Voice/STT/TTS intocados (gate automatizado pinça as identidades do B1/B1.1).

O transporte de imagem já existia e é **agnóstico de modelo**:
`core-agent/src/runtime/chat-orchestrator-runtime.ts` monta partes `image_url` em data URL
base64, e `sanitizeMessages` as preserva enquanto `streamOptionsContentArrayCompatibilityOk`
é verdadeiro (default por model key). Limite publicado do modelo: **3 imagens** por turno,
cada uma contando 2048 tokens de entrada.

### Primeiro gate Windows da M1 — **FALHOU** (evidência real)

O usuário rodou o fluxo normal em Windows (`Lia.bat` → Conversar), anexou uma imagem e
enviou o prompt determinístico. Resultado:

```
Remote sent 400 response: {"error":{"message":"messages[9].content must be a string",
"type":"invalid_request_error","param":"messages[9].content"}}
```

e, no log do Launcher/Stage para os mesmos envios lógicos:

```
status="noBrainRouteSelected"  attempt0.providerId="groq"
attempt0.modelId="openai/gpt-oss-120b"  → terminal failed
```

Ou seja: **o Qwen não foi executado**. O turno com imagem caiu na rota globalmente ativa
(GPT-OSS), e o Groq rejeitou o array de conteúdo.

**Causa raiz exata — provada por execução, não por leitura de código.** Rodando o código
de produção real do `@lia/core` (catálogo de produção + política de produção +
`decideBrainRouteFromProductState`) sobre o documento canônico que um Launcher normal
produz:

| estado do documento | turno com imagem | `routeOverride` |
| --- | --- | --- |
| como o Launcher deixa (`brain` ausente) | `{"status":"modeUnspecified"}` | `undefined` |
| com `brain.mode="automatic"` | `automatic` / `selected` → `groq` + `qwen/qwen3.8-27b` | presente |

`readBrainRoutingMode` devolve `undefined` porque **nada no produto escreve `brain.mode`**:
`brainRoutingModeUpdate` não tinha nenhum call site de produção, `defaultLiaProductConfig`
não tem a chave `brain`, o Launcher não tinha nenhuma referência a `brain`, e não existe
IPC nem UI que grave o campo. `modeUnspecified` → sem rota → `resolveLiaBrainSendRouteCandidate`
devolve `undefined` → o envio mantém o provider/modelo ativo → a imagem chega a um modelo
textual.

**Dívida de compatibilidade separada (registrada, NÃO usada para mascarar o defeito):** a
string de erro do Groq `messages[N].content must be a string` **não** casa com nenhum dos
padrões de `CONTENT_ARRAY_RELATED_ERROR_PATTERNS` (`core-agent/src/runtime/llm-service.ts`),
que cobrem “invalid type: sequence, expected a string” e “expected/should be … string”.
Portanto o auto-degrade de content-array não dispara para essa variante. **Isto não foi
“corrigido” de propósito**: fazer um turno com imagem passar como texto-only seria um falso
PASS. O comportamento exigido continua sendo
`imageInput → Brain autoritativo → qwen/qwen3.8-27b → imagem chega ao provider`.

### O que a Phase 8.0D-M2 entregou (correção autorizada)

O menor bootstrap de produto possível, análogo em espírito ao STT gerenciado, e dono do
mesmo princípio: **o Launcher é a autoridade de configuração de produto**.

`ensureBrainReadyForConversar(snapshot)` em `airi/apps/lia-app/src/main/lia-host.ts`,
chamado em `conversar()` antes de o filho subir:

- `brain.mode` **explícito** é absoluto: `disabled` e `manual` nunca são sobrescritos, e um
  `automatic` existente é preservado sem regravação;
- **só** um modo ausente pode ser default, e só quando **todos** valem:
  1. existe chat provider configurado;
  2. o **Brain real de produção** — mesmo catálogo, mesma política, mesma decisão canônica
     que o Stage roda — **selecionaria** uma rota para um turno de texto simples em modo
     automático (a elegibilidade é **perguntada** ao roteador, nunca presumida);
  3. o engine dessa rota **é** o chat provider configurado (identidade engine↔provider,
     sem segunda tabela de mapping) — é isso que impede selecionar o Groq Brain para quem
     não o justifica;
  4. a credencial **existente** daquele provider está presente (só a presença; o valor nunca
     é lido, copiado ou logado);
- persiste pelo writer canônico (`brainRoutingModeUpdate`); sem mutação de config no
  renderer, sem tocar `activeProvider`/`activeModel`, sem B1/B1.1/STT/TTS, sem 8.0E;
- falha de escrita degrada honestamente: documento intacto, conversa segue, motivo emitido.

Não é uma segunda autoridade de roteamento: a decisão continua sendo do roteador canônico,
feita pelo Stage.

**Diagnóstico metadata-only adicionado** (para o próximo gate não precisar inferir nada):

| fato | onde |
| --- | --- |
| modo canônico recebido (owner do campo) | evento `lia-app.conversar-brain-mode mode=automatic\|manual\|disabled\|absent` |
| default aplicado / recusa e motivo | `lia-app.conversar-brain-defaulted mode=automatic` / `lia-app.conversar-brain-not-ready reason=…` |
| **status da decisão** + engine/modelo selecionados | linha nova `[LIA-BRAIN-DECISION]` (`brain-decision-diagnostic.ts`, dev-gated) |
| resultado do `routeOverride` autoritativo | campos `initialRouteOverride*` acrescentados ao fim da linha `[LIA-BRAIN-DIAG]` |

Nada de prompt, imagem, ferramenta ou credencial em nenhum deles.

### Gate de saída PENDENTE — Windows E2E visual

Testes automatizados verdes **não** são este gate. Roteiro exato:

1. abrir a Lia pelo fluxo normal (`Lia.bat`), sem configurar nada;
2. **anexar uma imagem** numa conversa;
3. perguntar algo **determinístico** sobre o conteúdo dela (ex.: texto legível na imagem,
   contagem de objetos, cor dominante);
4. confirmar que a rota usada foi **`groq` + `qwen/qwen3.8-27b`**;
5. confirmar que a resposta está **correta com base no conteúdo da imagem** — não uma
   resposta genérica plausível;
6. confirmar de passagem que um turno **só de texto** continua no GPT-OSS.

Provas de runtime a ler no log (todas metadata-only; **não** inferir nada
indiretamente desta vez):

| o que procurar | onde | o que significa |
| --- | --- | --- |
| `lia-app.conversar-brain-mode mode=…` | log do Launcher | modo canônico que este lançamento recebeu. Na primeira execução de um install existente espera-se `mode=absent`; da segunda em diante, `mode=automatic` |
| `lia-app.conversar-brain-defaulted mode=automatic` | log do Launcher | o default foi gravado (só na primeira execução) |
| `lia-app.conversar-brain-not-ready reason=…` | log do Launcher | o default foi recusado — o motivo está no próprio evento |
| `[LIA-BRAIN-DECISION] status=… selection=… selectedEngineId=… selectedModelId=…` | log do Stage | **status real da decisão**. Para o turno com imagem espera-se `status="automatic" selection="selected" selectedEngineId="groq" selectedModelId="qwen/qwen3.8-27b"` |
| `initialRouteOverrideStatus=… initialRouteOverrideProviderId=… initialRouteOverrideModelId=…` | fim da linha `[LIA-BRAIN-DIAG]` | o `routeOverride` autoritativo que a execução recebeu de fato |

`noBrainRouteSelected` **não** deve mais aparecer. Se aparecer, a linha
`[LIA-BRAIN-DECISION]` diz qual foi o status da decisão — não é preciso deduzir.

Só depois desse gate o baseline funcional avança e `image/screen understanding` pode ser
marcado DONE.

### O que a Phase 8.0D-M3 entregou — retenção de turno falho e roteamento pelo prompt efetivo

Duas falhas reais observadas em Windows depois que a M2 fez o Qwen finalmente executar:

1. `Too many images provided. This model supports up to 3 images`;
2. num turno posterior **só de texto**, `messages[9].content must be a string` com GPT-OSS.

A auditoria read-only (aceita em `a8900b7`) provou as duas por execução, e a causa raiz é
uma só: **o registro da conversa e o prompt do provider eram a mesma lista**. Um envio que
o provider rejeitou continuava durável, visível **e** projetado — então cada tentativa
falha de imagem doava a sua imagem ao pedido seguinte, e um turno só de texto herdava a
imagem de um turno antigo sem que o requisito de rota soubesse disso.

O que mudou:

- **`excludedFromProviderContext`** — campo **genérico** em `ChatHistoryItem`
  (`core-agent/src/types/chat.ts`). Ausente/`false` é o comportamento histórico. Só um
  `true` explícito retira a mensagem da projeção; UI, persistência e retry continuam
  vendo-a.
- **Uma única regra de contexto de provider** — `core-agent/src/messages/provider-context.ts`
  (`isProviderContextMessage`, `selectProviderContextMessages`,
  `countProviderContextImageParts`, `hasProviderContextImageInput`). É a **única**
  definição de “o que chega ao provider”, consumida pela projeção do runtime **e** pelos
  fatos de capacidade do Brain. A segunda definição que existia em
  `stage-ui/src/stores/chat.ts` (`toProviderHistory`, que alimentava o artist task) foi
  **removida** e passou a usar a mesma regra.
- **Marcação na fronteira de settlement** — `executeSend` marca a cauda que o envio lógico
  acrescentou **antes** de a bolha de erro ser acrescentada. Vale para **qualquer** falha
  terminal, com ou sem fallback resolver registrado; nada inspeciona o erro.
- **`role: 'error'` nunca entra no prompt** — filtrado na costura canônica de projeção.
  Uma bolha de erro deixa de ser reescrita como texto de usuário sintético nos pedidos
  seguintes.
- **Requisito de Brain pelo prompt efetivo** — `chatTurnFactsFromSend` recebe agora
  `providerHistory` (obrigatório em todos os call sites) e deriva `hasImageInput` da
  attachment atual **ou** do histórico ainda visível ao provider. Consequência aceita de
  produto: enquanto uma imagem bem-sucedida estiver no contexto efetivo, um turno novo só
  de texto **também** exige `imageInput` e vai para `groq` + `qwen/qwen3.8-27b`.

Nada foi achatado: nenhuma imagem histórica é convertida em texto nem removida
silenciosamente para “caber” num modelo.

**Não entregue nesta fase — dividido como 8.0D-M3.1:** o preflight do limite de **3
imagens** do modelo de visão. Expressar um limite numérico exige alargar o schema de
capacidades, que hoje é booleano por construção (`LiaBrainCapabilities`, nove campos, e
`satisfiesBrainCapabilities` compara `!== true`); o lugar natural é
`LiaBrainModelDescriptor.metadata`, hoje documentado como opaco e nunca lido pelo
registry. Fazer o registry lê-lo **é** o alargamento, então foi parado e reportado em vez
de alargado. A M3 já elimina a causa observada em Windows (imagens de tentativas falhas);
o teto continua real para **4 ou mais imagens bem-sucedidas** na mesma conversa, e o M3.1
deve rejeitar o envio **antes** do pedido com erro determinístico de produto — nunca
descartando imagens.

**Dívida de Cloud Sync registrada:** o Cloud Sync v1 envia texto puro para user/assistant,
partes de imagem não fazem round-trip e mensagens de erro são locais. Portanto a marca de
exclusão é autoritativa na **persistência local** e a semântica de turno falho **não é
plenamente representável entre dispositivos** no v1. A M3 não amplia o schema de wire e
não é uma migração de protocolo.

**Gate:** testes automatizados verdes **não** são este gate. O E2E multimodal em Windows
continua **NOT PASS**; o baseline funcional validado continua sendo `3ef6d11`.

### 8.0D-M3.0a — Stage invisível no Windows por `dist` obsoleto do core-agent

**O que aconteceu, observado no Windows real:** depois de puxar o código da M3, o Stage
abria como ícone na barra de tarefas mas **nada aparecia na tela** — janela presente,
invisível. Não era regressão de produto: era artefato de build obsoleto.

**Causa raiz (invariante quebrado):** *código-fonte do renderer e o `dist` compilado de
cada pacote de workspace que ele importa precisam estar consistentes quando o Stage dev
inicia.* A cadeia que quebrou:

- `@proj-airi/core-agent` publica pelo `dist/` compilado (`main: ./dist/index.mjs`), e
  `dist/` é **gitignored** (`airi/.gitignore`) — ou seja, nunca vem no pull;
- a M3 adicionou exports públicos novos (`selectProviderContextMessages`,
  `isProviderContextMessage`, `countImagePartsInMessage`, `countProviderContextImageParts`,
  `hasProviderContextImageInput`), re-exportados **em runtime** por
  `stage-ui/src/stores/chat/provider-context.ts` a partir do **código-fonte** do renderer;
- `Lia.bat → pnpm dev:lia → @lia/lia-app dev` reconstrói apenas `@lia/core`, e o Stage
  gerenciado roda `@proj-airi/stage-tamagotchi dev` = `install-electron && electron-vite dev`
  — **nenhum dos dois construía o core-agent**;
- com o `dist` pré-M3, o import falha no **link** ESM (`does not provide an export named
  'selectProviderContextMessages'`) antes de qualquer código rodar: nada monta, nada é
  logado, e como a janela é `transparent: true` o Stage fica só como ícone.

**Prova no Windows (executada pelo usuário):**
`findstr /C:"selectProviderContextMessages" packages\core-agent\dist\index.mjs` → **vazio**;
em seguida `pnpm -F @proj-airi/core-agent run build` → **o Stage abriu imediatamente**.
`dist` obsoleto, confirmado — não hipótese.

**Correção da M3.0a — e o seu limite real (corrigido pela M3.0b):**
`apps/stage-tamagotchi/package.json` — `dev` e `dev:xwayland` agora começam com
`pnpm -F @proj-airi/core-agent run build && `. Somente os scripts `dev` foram alterados:
`build`, `start`, `start:xwayland`, `app:build` continuam idênticos, porque release já é
ordenado pelo turbo (`build.dependsOn: ["^build"]` + a dependência `workspace:^` da
`stage-ui`). O contrato está pinado por
`apps/stage-tamagotchi/src/main/dev-build-contract.test.ts`, que **executa** a string real
do script num shell com comandos stub (ordem + abortar em falha) e roda módulos ES reais em
processo Node filho para provar a falha de link.

**Essa correção cobre APENAS o caminho manual** (`pnpm dev:tamagotchi`). Ela **não** protege
`Lia.bat → Conversar com Lia`, e a documentação desta seção afirmava que protegia — essa
afirmação estava **errada** e foi corrigida. O log de runtime do Windows mostrou o motivo:

```
lia-app.conversar-brain-mode mode=automatic
lia-app.stage-log spawn: node ...\apps\stage-tamagotchi\node_modules\electron-vite\bin\electron-vite.js dev
```

O `AiriStageManager` lança o entrypoint do electron-vite **diretamente com Node**, sem shell
e sem package manager (é a correção de ownership da Phase 7.2, e os testes existentes
assertam `command()` sem `pnpm`, `execPath`, `argv = [electron-vite.js, "dev"]`,
`shell === undefined`). Ele nunca lê o `package.json` do Stage. O run do Windows que abriu
só passou porque um `postinstall`/`build:packages` tinha acabado de rodar
(`@proj-airi/core-agent:build ✔ Build complete`) — ou seja, **não** é prova de frescor
durável no caminho gerenciado.

### 8.0D-M3.0b — pré-requisito de build no caminho gerenciado

**Invariante fechado:** `Lia.bat → Launcher → Conversar → pré-requisito de build garante o
artefato do core-agent → só depois de sucesso, spawn direto do electron-vite`.

**Implementação:** módulo novo `apps/lia-app/src/main/stage-build-prerequisite.ts`, chamado
dentro de `AiriStageManager.spawnStage()` — portanto **dentro da promise single-flight de
`start()`**, antes do spawn. Um duplo clique não dispara dois builds nem dois stages.

**Portabilidade no Windows (verificada, não suposta):** `execFile('pnpm', ...)` **não
funciona**. Medido aqui: `execFile('pnpm', ['--version'])` → `ERR ENOENT` (pnpm nem está no
PATH num workspace Corepack), e no Windows o shim é `pnpm.cmd`, que o Node recusa spawnar
sem `shell: true` desde o hardening CVE-2024-27980 — exatamente a rota DEP0190 que a Phase
7.2 removeu. Por isso o build roda **como o próprio Stage roda**: resolve o `bin` da
ferramenta como um ARQUIVO concreto e executa com `process.execPath`
(`node <tsdown>/dist/run.mjs`, cwd `packages/core-agent`). Um único caminho de código, sem
shell, sem PATHEXT, sem cmd.exe; o pré-requisito é um filho curto e aguardado, **nunca** o
processo owned.

**Ownership preservado:** o filho Stage continua `process.execPath [electron-vite.js, dev]`
com `shell` undefined. `applies()` é síncrono de propósito: quando não há
`packages/core-agent/package.json` (produção empacotada) nada é aguardado, o spawn continua
no mesmo tick e os **13 testes existentes de ownership/stop passam sem alteração**.

**Fail-closed:** build com exit ≠ 0, ferramenta não resolvida, script composto (exigiria
shell) ou manifest ilegível ⇒ `phase: 'error'`, **zero** spawns, mensagem honesta. Nunca
lança contra um `dist` sabidamente obsoleto.

**Diagnóstico (só metadados, sem caminhos/segredos/conteúdo):**
`stage-prerequisite name=core-agent-build state=starting|succeeded|failed|skipped reason=…`.

**Isto NÃO é o PASS multimodal no Windows.** O baseline funcional validado continua sendo
`3ef6d11`; o gate de conteúdo visual da 8.0D continua **PENDENTE**.

### DEVFLOW-D1 — entrypoint único de desenvolvimento (só ferramenta)

O código da M3.0b existe em **`c65de97`**. Mas o **gate gerenciado durável no Windows
continua `NOT PASS`**: ele só será provado quando o DevFlow o executar numa máquina real.
Nenhum teste automatizado desta fase prova runtime.

**O que a D1 entregou:** `DevKit.bat` na raiz virou o entrypoint humano único — dois cliques
e `1) Executar rodada atual`. A orquestração Lia vive em `tools/lia_dev.py` +
`tools/devflow/`, separada das primitivas Git universais de `tools/project_cli.py`. A rodada
ativa é um contrato **machine-readable** (`tools/devflow/rounds/m3_0b.json`), nunca prosa
deste arquivo. Documentação: `docs/project/DEVFLOW.md`.

A rodada exige a branch, identifica o HEAD, remove **só** `airi/packages/core-agent/dist`
(gerado), roda os testes direcionados, lança o caminho gerenciado, detecta os três marcadores
**na ordem** e só então pergunta `A personagem apareceu normalmente? [S/N]`. **Log nunca vira
PASS visual.** Artefatos em `Tests/runs/devflow/<timestamp>-<round>/` (gitignored, retidos 20
execuções / 30 dias), sanitizados com o redator universal.

**A D1 é somente ferramenta:** não altera código de produto, não toca
Brain/provider/voz/vision, e **não avança o baseline funcional — que continua `3ef6d11`**.

**A D1 existiu em `32025ab`.** Antes da primeira rodada real no Windows, uma **auditoria
independente** encontrou defeitos limitados de correção e segurança. A **D1.1 os fecha**:

1. **falso PASS por teste pulado** — testes indisponíveis eram ignorados no veredito; agora
   todo teste declarado é **obrigatório**: falha ⇒ `FAIL` sem lançamento, indisponível ⇒
   `REFUSED` sem lançamento;
2. **falso PASS com checkout sujo** — `dirty` era registrado mas não barrava nada; agora
   `git status --porcelain` não vazio ⇒ `REFUSED` **antes** de qualquer limpeza, teste ou
   lançamento (só a contagem é impressa);
3. **afirmação visual pedida cedo demais** — estava num `finally`, então podia perguntar
   "A personagem apareceu?" com o Stage morto, marcador ausente ou timeout; agora só é
   perguntada **depois** de todos os marcadores na ordem;
4. **proteção reparse/junction superestimada** — usava só `Path.is_symlink()`, que no
   Windows não detecta junction; agora `tools/devflow/filesystem.py` é a **única**
   autoridade (bit `FILE_ATTRIBUTE_REPARSE_POINT`, compatível com Python 3.10, inspeção
   lexical antes de resolver, erro de inspeção ⇒ recusa), usada pela limpeza **e** pela
   retenção;
5. **teardown que não alcançava a árvore** — encerrava só o filho direto, podendo deixar
   `pnpm`/Electron/Stage órfãos; agora o filho nasce em grupo de processo próprio e o
   teardown é enraizado no PID da rodada (`taskkill /PID <raiz> /T /F` no Windows,
   `os.killpg` no POSIX), no `finally`, também após Ctrl+C;
6. **retenção acoplada ao checkout de origem** — derivava a raiz permitida de
   `Path(__file__).parents[2]`, então nunca funcionava em repositório temporário/worktree;
   agora a autoridade é o argumento `repo`.

Um `PASS` continua exigindo, e agora **prova no `run.json`**: SHA exato, `dirty=0`, todos os
testes obrigatórios passando, marcadores ordenados e afirmação humana aceita — o runner
rebaixa para `NOT_PASS` se faltar evidência. O `tested_sha` do manifesto pode seguir `null`:
o runtime **não** o escreve, porque isso sujaria o repositório no meio da rodada.

**A D1.1 existiu em `12ab92e`.** A **primeira rodada real no Windows** (`DevKit.bat →
1) Executar rodada atual`) alcançou o HEAD exato `12ab92e759f9` com `alteracoes_nao_commitadas=0`,
removeu `airi/packages/core-agent/dist` com segurança e **o fail-closed funcionou**: o teste
automatizado `devflow` saiu com `exit 1` e a rodada parou **antes** de lançar a Lia. Isso é o
comportamento correto.

O que estava errado era o **auto-teste**, não o gate. Causa-raiz confirmada por reprodução:
`OwnedProcessTests.test_teardown_is_idempotent_and_scoped_to_the_owned_pid` fazia
`subprocess.Popen(['sleep', '30'], start_new_session=True)` **sem guarda de plataforma**.
`sleep` não é um executável padrão do Windows, então o teste estourava com
`FileNotFoundError` e a suíte inteira devolvia `exit 1`. (`start_new_session` não era o
problema: no CPython ele é aceito e ignorado no Windows — `unused_start_new_session`.)
Era o **único** executável externo sem guarda em toda a suíte; os outros quatro (`git`, e
`sh`/`kill`/`cmd` dentro de testes guardados) estavam corretos.

A **D1.2** fecha isso:

1. **auto-teste portável** — pai, neto e espectador viraram processos `sys.executable`
   dormindo com `time.sleep`. Um único teste cross-platform prova agora os pontos A–H
   (raiz viva, descendente vivo, espectador vivo → `terminate()` → raiz morta, descendente
   morto, espectador **vivo**, `terminate()` repetido idempotente), usando as mesmas flags
   de plataforma do DevFlow. Sem `sleep`, `sh`, `kill`, PowerShell ou WMIC;
2. **prova comportamental** — a suíte inteira é re-executada num subprocesso com `PATH`
   contendo **só o git**; se algo depender de ferramenta POSIX, a sonda falha. Há também um
   contrato por AST como defesa em profundidade;
3. **falha autodiagnosticável** — existe **um único** sanitizador
   (`report.sanitize_test_output`), aplicado **na fronteira de persistência**, alimentando
   console, `TestResult.detail`, `REPORT.txt` e `run.json`. Bounded (14 linhas / 1200
   caracteres), reusa o redator universal, colapsa `<HOME>`, descarta linhas com formato de
   conversa e preserva o fluxo útil (stderr vence, stdout é fallback). Antes,
   `TestResult.detail` recebia os **últimos 400 caracteres crus** do subprocesso e ia
   direto para `run.json` e `REPORT.txt` — isso foi corrigido;
4. **`REPORT.txt` mostra o detalhe de teste que falhou**, mantendo os que passaram concisos.

A ordem fail-closed da D1.1 foi preservada sem enfraquecimento: branch/worktree limpo →
preparo seguro → **todos** os testes obrigatórios → só então o gate do Windows → marcadores
ordenados → pergunta visual → relatório.

**A D1.2 existiu em `e204ecb`.** O **DEVFLOW-AUTO-1** muda o contrato com o dono do projeto:
não existe mais menu no duplo clique.

- **`DevKit.bat` é o único entrypoint humano e duplo clique = AUTO.** Ele se copia para
  `%TEMP%` (o `cmd.exe` lê `.bat` por deslocamento de byte, então sobrescrever o original no
  meio da execução o corromperia), descobre o Python e chama `lia_dev.py bootstrap`.
- **Bootstrap auto-atualizável:** sincroniza o branch de trabalho e depois lança um **processo
  novo** com `auto --post-sync`. O manifesto também é lido depois do sync. É isso que garante
  que o código que avalia o gate é o recém-atualizado, e não módulos antigos já importados.
- **Política Git de zero escolha:** branch de trabalho **configurado** em
  `tools/devflow/devflow-config.json`; checkout limpo ⇒ `fetch`+`rebase` sem perguntar;
  alterações locais são **classificadas** (segredo, caminho fora da política, peso de modelo,
  binário >5 MB ⇒ bloqueiam; código-fonte do projeto ⇒ checkpoint local determinístico após
  o verificador de segredos universal). Ambíguo ⇒ FAIL CLOSED, sem descartar nada. Nunca
  `main`, nunca `--force`, nunca conflito resolvido sozinho. Depois do gate, só o **HEAD exato
  testado** e limpo é publicado; se o remote avançou, a publicação é recusada e pede
  revalidação. Gate reprovado nunca publica.
- **O clique em "Conversar" virou automático:** `LIA_DEVFLOW_AUTORUN=conversar` faz o Launcher
  chamar **exatamente** `host.conversar()`, a mesma função que o botão alcança via
  `lia:stage:start`. Sem caminho alternativo de Stage: a cadeia
  `Lia.bat → Launcher → AiriStageManager → Stage` continua sendo o que é validado. Fora da
  flag, nada muda no produto.
- **O S/N virou evidência de máquina.** Além da cadeia ordenada, a rodada exige **quatro**
  fatos terminais, em qualquer ordem: `lia-stage renderer=ready`, `lia-stage window=visible`,
  `lia-stage renderer-app=mounted` e `lia-stage avatar-scene=mounted` (renderer → IPC →
  main). Faltar um ⇒ FAIL; marcador proibido ⇒ FAIL. Tudo inerte sem
  `LIA_DEVFLOW_DIAGNOSTICS=1`. "ready in 512 ms" continua sendo apenas opcional e nunca é
  evidência terminal.
- **Schema v2:** `runtime_assertions` (ordered/terminal/forbidden/optional), `launch.env`,
  `launch.auto_action` e um `scenario { driver, steps }` genérico. Nenhuma rodada futura foi
  implementada — só a arquitetura que as torna dirigíveis.

**AUTO-1a existiu para corrigir defeitos que impediriam essa primeira execução.** Uma
auditoria independente do commit AUTO-1 confirmou a arquitetura e apontou problemas reais:

- o `DevKit.bat` se copiava para `%TEMP%` e a cópia usava `%~dp0`, que lá é o próprio
  `%TEMP%` — o duplo clique **sempre** falharia com "tools\lia_dev.py nao encontrado";
- o gate parava de esperar assim que a cadeia ordenada completava, então lia a evidência
  terminal de linhas que ainda não tinham chegado e reprovava uma Lia saudável;
- a identidade do repositório era `'Lia-Project' in url`, que aceita qualquer host ou dono
  com essa substring;
- o checkpoint usava `git add -A`, stageando o checkout inteiro em vez dos caminhos
  revisados;
- `publish()` recusava um fast-forward legítimo;
- `Process cleanup: PASS` saía de qualquer string de estágio não vazia, e `terminate()`
  engolia falha de `taskkill`;
- a sonda de PATH criava um `git.cmd` que `subprocess(shell=False)` não alcança no Windows;
- o marcador `avatar-scene=mounted` vinha do mount do app raiz, não do avatar.

Todos foram corrigidos. O marcador raiz foi renomeado para `renderer-app=mounted` e o sinal
de avatar passou a vir do próprio componente de cena; `window=visible` agora exige
`isVisible()`. `allow_checkpoint` fica desligado por padrão — para esta execução o contrato
é checkout limpo.

**AUTO-1b fechou os cinco defeitos que a segunda auditoria encontrou no AUTO-1a.** Todos
permitiam um relatório mais otimista do que a evidência:

- `%ERRORLEVEL%` dentro do bloco parentetizado do `:dispatch` era expandido no **parse**,
  então um bootstrap com falha saía com código 0;
- `handle = self.spawn(...)` ficava fora do `try`, e qualquer exceção durante a espera pelos
  marcadores (inclusive Ctrl+C) vazava a árvore inteira da Lia;
- o snapshot de descendentes era pedido **depois** de a raiz morrer, quando o filho do Stage
  já foi reparentado — a resposta era sempre "nenhum descendente". Prova observada: um neto
  criado por `fork` sobreviveu com `descendants=0` e `ok=True`;
- `result.result = 'PASS'` nunca consultava `cleanup_state`, e o `run.json` persistia só
  `verdict`, então uma Lia deixada rodando era publicada como PASS;
- o bootstrap de transição conferia o remote com `findstr` por substring
  (`github.com.evil.com` passava), gravava a URL num arquivo de nome fixo no `%TEMP%` e a
  imprimia na recusa.

Hoje: fluxo por rótulo com captura de código em cada caminho; `finally` cobrindo o gate
inteiro; identidade da árvore gravada no spawn e `TeardownResult.state` tri-estado
(`PASS`/`FAIL`/`UNKNOWN`, onde `UNKNOWN` nunca vira `PASS`); `overall_verdict` separado de
`runtime_verdict` no `run.json` e um passo 8b que reprova antes de publicar; e identidade de
remote por **igualdade exata** contra seis formas canônicas, sem imprimir a URL e com o SHA
resultante relido e comparado.

**AUTO-1c fechou os cinco bloqueadores de Windows apontados pela terceira auditoria.** Eram
todos defeitos que só aparecem na máquina real:

- `for attempt, sig in ((0, signal.SIGTERM), (1, signal.SIGKILL))` é um literal avaliado na
  construção, e `signal.SIGKILL` não existe no Windows Python: **todo** teardown no Windows
  levantava `AttributeError` antes de chegar ao `taskkill`, e por estar num `finally` ainda
  mascarava o relatório do gate;
- nenhuma função de `kernel32` tinha `restype`/`argtypes`; o `c_int` padrão trunca um HANDLE de
  64 bits, então a comparação com `INVALID_HANDLE_VALUE` nunca casava e
  `ctypes.get_last_error()` lia um slot que `ctypes.windll` nunca preenche;
- `OpenProcess` ou `GetExitCodeProcess` falhando era contado como "processo morto", e a soma
  virava `descendentes: nenhum vivo`;
- `TeardownResult.state` não conhecia o resultado do `taskkill`, então um kill recusado com a
  raiz já morta lia como `PASS`;
- o bootstrap de transição resolvia o SHA alvo **antes** do `fetch`, ou seja, desistia no único
  cenário que ele existe para resolver.

Hoje: ramos Windows/POSIX separados e `_escalation_signals` devolvendo `()` no Windows; tabela
`WIN32_PROTOTYPES` completa aplicada sobre `ctypes.WinDLL('kernel32', use_last_error=True)`,
com `HANDLE = c_void_p`, `th32DefaultHeapID` como `ULONG_PTR` e `PROCESSENTRY32` de 304/296
bytes; inspeção de PID tri-estado onde só `ERROR_INVALID_PARAMETER` ou um código de saída real
provam ausência; `kill_ok` dominando o `state`; e a ordem identidade → branch → status
verificado → fetch → resolução → ancestralidade → `--ff-only` → SHA resultante → DevKit.

**Limitação de transição:** o checkout do dono do projeto ainda tem o `DevKit.bat` anterior
ao AUTO, e um recurso do DevKit novo não roda dentro do antigo antes de ser baixado. Por
isso existe `tools/devflow/upgrades/LIA-DEVFLOW-UPGRADE.bat`, que só precisa do `git` e deve
ser entregue **FORA do checkout** (anexo ou download). Ele ainda **não** deve ser executado.

**O gate gerenciado da M3.0b no Windows continua `NOT PASS`** e o baseline funcional continua
**`3ef6d11`**. Nenhum commit de ferramenta foi ou será promovido a baseline funcional. A
próxima prova é **um único duplo clique** do dono do projeto no Windows, e ele **ainda não
foi solicitado**.

**Nada foi apagado.** Os `.bat`/`.ps1` históricos estão inventariados e classificados
(KEEP / INTERNAL / CANDIDATE-MERGE / CANDIDATE-DELETE) em
`tools/devflow/script-inventory.json`, como entrada para o **D3**. `devkit.json` continua
com `ignore_dirs: ["airi"]` — a razão está documentada em `DEVFLOW.md` e a decisão é do
**D2**.

### Itens de closure restantes da 8.0D (fora desta fase)

1. **tool-calling closure** — teste dirigido do loop completo: rota resolvida → modelo
   devolve `tool_call` → ferramenta executa → resultado volta ao modelo. O loop vive no
   `@xsai/stream-text`; prová-lo exige modelo real ou um mock arquitetural pesado, por
   isso não foi alargado o escopo nesta fase.
2. **latency measurement** (Windows real).
3. **region/network measurement** (Windows real).
4. **directed failure-behavior test** (automatizável) — recoverable→failover /
   permanent→não-failover. A parte de **retenção** do turno falho já está coberta pela M3.
5. **8.0D-M3.1 — preflight do limite de imagens do modelo de visão.** Rejeitar o envio
   antes do pedido, com erro determinístico de produto, quando o contexto visual efetivo
   exceder o limite do modelo selecionado. Exige metadata de capacidade numérica; ver
   acima. Nunca resolver descartando ou achatando imagens.
6. **Cloud Sync v1 — semântica de turno falho entre dispositivos.** A marca de exclusão é
   local; partes de imagem não fazem round-trip no v1. Registrado como dívida de sync, não
   como migração de protocolo.
7. **variante de string de erro do Groq para content-array** — `messages[N].content must
   be a string` não casa com `CONTENT_ARRAY_RELATED_ERROR_PATTERNS`
   (`core-agent/src/runtime/llm-service.ts`). Registrado como dívida; **não** alargar o
   auto-degrade para “resolver” a M1, porque isso transformaria um turno com imagem num
   falso PASS textual. A M3 remove a **causa** observada (um turno só de texto não é mais
   roteado a um modelo textual enquanto uma imagem vai no mesmo pedido); a dívida de
   casamento de string permanece para os demais casos.

**8.0D não está CLOSED.** E **8.0E não foi iniciado**: nenhum screenshot capture, window
capture, câmera, audio input nativo, nova UI de provider, novo provider ou mudança de key.

---

## 6. Regras permanentes que continuam valendo

Resumo operacional. A lista completa e o histórico de armadilhas estão em
`docs/product/HANDOFF-PROMPT.md` e em `AGENTS.md`.

- Falar sempre em pt-BR.
- Nunca `git reset --hard` / `restore` / `clean` / `stash` / `rebase` / `--amend` /
  force push. Nunca descartar trabalho preexistente.
- Nunca declarar PASS sem ter executado. Teste automatizado verde **não é** PASS de
  runtime: o gate é Windows real.
- Nunca gravar segredo em log, `localStorage` ou config. Reportar apenas
  configurado/não-configurado e o provider ID.
- Provedor e model **nunca hardcoded**; `lia-product.json` é a única autoridade de produto.
- Não tocar em Persona, secrets, TTS runtime, fallback de chat, web/pocket ou live model
  discovery sem autorização explícita da rodada.
- `DevKit.bat` da raiz não pode ser alterado, substituído ou renomeado.
- Commits separados por responsabilidade; informar hash, arquivos e riscos.
- **STOP AND REPORT** em vez de contornar um bloqueio, alargar escopo ou commitar
  workaround.

---

## 7. Como manter este arquivo

Atualizar aqui, no mesmo commit, sempre que mudar:

1. a branch de trabalho, ou o `main` de referência;
2. **o baseline funcional validado** — ou seja, quando um novo commit **de código** passar
   por um gate de runtime real (registrar o SHA, o gate e o resultado);
3. uma decisão de produto que altere o comportamento visível;
4. a transição de fase no roadmap.

**Não exigir atualização deste arquivo a cada commit documental.** Commits que só mudam
`docs/` não alteram o baseline funcional e não precisam tocá-lo. É exatamente por isso
que o tip da branch e a contagem de commits à frente de `main` **não** são registrados
aqui: seriam obsoletos no commit seguinte. Ambos se verificam no preflight (seção 1).

Não transformar este arquivo em relatório de rodada. Relatório de rodada vai para
`docs/product/` com nome próprio; aqui entra só o estado resultante.
