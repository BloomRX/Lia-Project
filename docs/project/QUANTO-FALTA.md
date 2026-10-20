# Quanto falta — Lia-Project

Escrito para um agente responder sozinho: **o que resta, o que ele fecha, o que
exige o Dev, o que ninguém planejou, e o que pode estar quebrado no que já foi
feito.**

Fonte: [`CURRENT-STATE.md`](CURRENT-STATE.md) §0 e §5, medido em `9e47857`.
Se este arquivo e o `CURRENT-STATE.md` divergirem, **o `CURRENT-STATE.md` vence**.

---

## Horizonte deste documento — leia antes de assumir qualquer coisa

Este documento cobre **fechar a Phase 8.0D** mais a dívida conhecida. **Ele não
cobre "finalizar o app".** As fases 8.0E a 8.0J existem como nome e objetivo no
roadmap, não como plano. A seção C diz exatamente onde o planejamento acaba.

Se você chegou ao fim da seção A e a 8.0D ainda depende do Windows, **você chegou
ao limite do que é executável sem o Dev**. Pare e reporte. Não invente a 8.0E.

---

## Onde o projeto está

- **Branch:** `arena/01a10290-lia-project`. `main` não recebeu merge.
- **Baseline funcional validado em Windows:** `3ef6d11618f787dae6d197645d440a5775a60ad6`.
  **Não promover commit posterior a baseline.**
- **Fase:** 8.0D — First Multimodal Brain Adapter. **Não CLOSED.** 8.0E não iniciado.
- **Código:** tudo sob `airi/`.
- **Sessão:** abrir na **raiz**, nunca dentro de `airi/`.

### Já provado em Windows real

Cadeia de voz gerenciada B1/B1.1 (**E2E PASS**, blocker encerrado, §2) · bootstrap
de roteamento do Brain e seleção de rota (**M2**) · conversa só de texto (**DONE**).

Automatizado verde **não é** gate de runtime.

### Como conferir que está verde antes de mudar qualquer coisa

```
cd airi && corepack pnpm install --ignore-scripts
cd airi && corepack pnpm --filter @lia/core run build
cd tools && python3 -m unittest discover -s . -p "test_*.py" -t .   # 487 testes
node --test Tests/tools/*.test.mjs                                 # 267 testes
cd airi/apps/lia-app && ../../node_modules/.bin/vitest run         # 246 + 2 skip
cd airi && ./node_modules/.bin/moeru-lint <arquivos tocados>       # 0 warnings
```

---

# A) Um agente fecha sozinho, em Linux

## A1. Dívida de produto

| # | Item | Onde está |
|---|---|---|
| A1.1 | **Teste dirigido de `failure behavior`** — recoverable→failover, permanent→não. Único critério PARTIAL da 8.0D que fecha sem Windows | §5, tabela de critérios |
| A1.2 | **8.0D-M3.1** — preflight do limite de **3 imagens**. Dividido para fora da M3 e nunca entregue | §5 |
| A1.3 | **`docs/compatibility/MATRIX.md` não existe** e a §81 do `AGENTS.md` o exige. Dívida, não histórico | §81 |
| A1.4 | **Cloud Sync v1** envia texto puro para user/assistant. Registrada, não corrigida | §5 |

## A2. Contexto de agente

| # | Item | Por quê |
|---|---|---|
| A2.1 | **Fatiamento portátil do `AGENTS.md`** | São **10 990 tok** carregados em toda mensagem (medido). Fatiar em `.claude/rules/` **só ajuda o Claude Code** — para quem lê `AGENTS.md` é invisível. A via portátil: núcleo curto no `AGENTS.md` + detalhe em documentos que a §0 manda abrir sob demanda |

## A3. Defeitos de documentação confirmados

Todos verificados por medição, não por opinião.

| # | Defeito | Evidência |
|---|---|---|
| A3.1 | **A tabela A1 do `GUIA-LIA-PROJECT.md` está errada.** Diz `AGENTS.md ~16.000 tokens`; o medido é **10 990**. Diz `CURRENT-STATE.md 783 linhas · ~13.000 tokens` lido no "começo de toda tarefa"; hoje são 825 linhas e a §0 manda ler **só o cabeçalho (~700 tok)**. A conta "~29 mil tokens" e o "ganho estimado de ~16.000 para ~2.000–3.000" partiram de premissas que não existem mais | comparar a tabela com `tools/agents-docs/measure.mjs` |
| A3.2 | **`LEIA-ME-SESSAO.md` linhas 34 e 66 ainda dizem `/memory`**, que não é o comando que lista os arquivos carregados | `grep -n /memory docs/1-PARA-Lia-Project/` |
| A3.3 | **`docs/README.md` apodrece.** Hoje cobre os 63 `.md` com 0 links quebrados, mas **nenhum teste garante isso**. Documento novo entra e o índice fica mentindo | não há teste |
| A3.4 | **O cabeçalho do `CURRENT-STATE.md` pode divergir do corpo.** A §0 agora é o que os agentes leem; se o corpo mudar e o cabeçalho não, todo agente recebe informação errada. **Não há verificação automática de coerência** | estrutural |
| A3.5 | **SHAs fixos no cabeçalho** (baseline e `main`). Permitido pelo modelo de documentação — o que é proibido é fixar o *tip* — mas envelhecem sem aviso | §0 |
| A3.6 | **`tools/agents-docs/` mede com `o200k_base`**, que é um *proxy*. Claude e Codex usam outros tokenizadores. Os números são indicativos, não exatos | dito no próprio script |

---

# B) Exige o Windows do Dev — nenhum agente na nuvem aprova

| # | Item | O que precisa acontecer |
|---|---|---|
| B1 | **Gate Windows E2E visual** — saída da 8.0D | abrir pelo `Lia.bat` · anexar imagem · pergunta determinística sobre o conteúdo · rota `groq` + `qwen/qwen3.8-27b` · resposta correta **pela imagem** · e um turno só de texto permanecendo no GPT-OSS |
| B2 | **Reteste do pré-requisito do Stage (M3.0b)** | build termina · o pré-requisito registra estado final · o Stage abre |
| B3 | **Os dois `.bat` movidos para `Tests/`** | duplo clique em `Tests\LiaTests.bat` abre o menu e a opção 1 cria a pasta de run. Ver D1 |
| B4 | Qualquer validação de runtime, voz, instalador ou benchmark | — |

Um agente pode *preparar* tudo isso. **Não pode aprovar.**

---

# C) O que não está planejado

Aqui é onde "seguir até o fim" deixa de ser executável.

**A conta:** a 8.0D tem **547 linhas** de especificação real na §5 do
`CURRENT-STATE.md` — critérios, gates, causa raiz, evidência. As fases **8.0E a
8.0J inteiras** somam **115 linhas** no roadmap, e são declarações de objetivo.

**A próxima fase, na íntegra** (`8.0E — Perception Foundation`, 17 linhas):

> Goal: Establish perception inputs independently from model choice.
> **Possible inputs:** microphone; screenshot; window capture; future camera/video.
> Perception producers should feed the Capability Router.

"*Possible*". Não foram escolhidos. Sem ordem, sem critério de aceite, sem arquivo
alvo, sem plano de teste.

**Decisões de produto em aberto que bloqueiam a 8.0E** — só o Dev responde:

1. Quais percepções entram primeiro: microfone, screenshot, captura de janela?
2. Nessa ordem, ou outra?
3. Screenshot e captura de janela são coisas distintas ou uma só?
4. Câmera/vídeo fica fora da 8.0E?
5. O que é "sucesso" para cada uma?

**O roadmap termina num experimento.** `8.0J — Free Mode Experiment` é a última
fase e fecha com *"Multi-monitor and richer autonomy come later."* **Não existe
fase de distribuição, critério de release nem definição de 1.0 em lugar nenhum do
repositório.** "Finalizar o app" não está escrito.

Regra vigente: **não implementar 8.0E sem antes reconciliar os critérios da 8.0D.**

---

# D) O que pode estar quebrado no que já foi feito

Ordem decrescente de risco. "Não executado" significa exatamente isso: escrito e
revisado, nunca rodado no alvo.

## D1. RISCO ALTO — os dois `.bat` movidos para `Tests/` nunca foram executados

`LiaTests.bat` e `LiaBenchmark.bat` saíram da raiz em `5b02abf`. Os dois derivam
caminhos de `%~dp0`, e a mudança usa:

```
cd /d "%~dp0.."
set "REPO=%~dp0..\"
```

A aposta é que o Windows resolve o `..` no caminho. **Não há `cmd.exe` no ambiente
onde isso foi escrito.** Evitou-se de propósito o idioma
`for %%I in ("%~dp0..") do set "REPO=%%~fI\"` justamente por não ser testável,
mas a via escolhida também não foi executada.

**Como verificar:** duplo clique em `Tests\LiaTests.bat`. Se o menu abrir e a
opção 1 criar a pasta de run, está certo. Se falhar, o erro aparece na linha do
`cd` ou no `node "%TOOLS%\..."`.

**O que mais quebra junto:** `Tests/LiaBenchmark.bat`, e as mensagens de
`qa-config.mjs` / `qa-run.mjs` que apontam para `Tests\LiaTests.bat`.

## D2. RISCO ALTO — a correção do pré-requisito do Stage nunca rodou no Windows

`node-runtime.ts` + `stage-build-prerequisite.ts`. Causa raiz medida:
`process.execPath` no processo main é o binário Electron, não Node. A correção tem
teste de unidade, **não tem execução no Windows**. Gate **NÃO aprovado**.

## D3. RISCO MÉDIO — `delete stageEnv.ELECTRON_RUN_AS_NODE`

Mudança do Dev em `airi-stage-manager.ts`, com teste correspondente. Verde em
Linux (**487 + 267 + 246**), nunca no Windows. O efeito só se manifesta na cadeia
real `Lia.bat → Launcher → Conversar → Stage`.

## D4. RISCO BAIXO — `posix.resolve` no teste de fuse darwin

Corrigido em `f137fcd`. **Provado por execução nos dois sentidos** contra a função
real: `posix.resolve(...) === fuseFilePathFor(app,'darwin')` e
`win32.resolve(...) !== fuseFilePathFor(app,'darwin')`. Falta só a rodada Windows.

## D5. RISCO BAIXO — `Lia.bat` é LF; os outros três `.bat` são CRLF

`Lia.bat` **LF** · `DevKit.bat`, `Tests/LiaTests.bat`, `Tests/LiaBenchmark.bat`
**CRLF**. `Tests/LiaTests.bat` tem teste exigindo CRLF por ser "batch-safe".
`Lia.bat` não tem `goto`/labels, então provavelmente funciona — mas é
inconsistência, e mexer nele é mexer no processo que o gate M3.0b captura.
**Não alterar sem autorização.**

---

# Primeira hora de um agente novo

1. Abrir na **raiz**. Nunca em `airi/` — `airi/AGENTS.md` tem **zero** menção a
   `CURRENT-STATE`, `pt-BR`, `STOP AND REPORT`, `DevKit` ou `baseline`.
2. Ler `CURRENT-STATE.md` §0 e §6.
3. Ler [`docs/README.md`](../README.md) para o mapa dos documentos.
4. Rodar as suítes da seção "como conferir que está verde".
5. Pegar **um** item da seção A. Um por vez. Commit pequeno. Rodar de novo.

# O que nunca fazer

- Tocar em Persona, secrets, TTS runtime, fallback de chat, web/pocket ou live
  model discovery sem autorização explícita.
- Alterar `DevKit.bat` ou `Lia.bat`.
- Promover commit posterior a `3ef6d11` a baseline funcional.
- Fazer merge em `main`.
- Reportar gate não executado como PASS.
- Aumentar timeout como forma de correção.
- Tratar suspeita como causa confirmada.
- **Inventar a 8.0E.** Ela está na seção C por um motivo.
