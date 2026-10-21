# Quanto falta — Lia-Project

Escrito para responder, sem precisar perguntar ao Dev: **o que resta, o que um
agente pode fazer sozinho e o que exige a máquina dele.**

Fonte: [`CURRENT-STATE.md`](CURRENT-STATE.md) §0 e §5, medido em
`4a6a811`. Se este arquivo e o `CURRENT-STATE.md` divergirem, **o
`CURRENT-STATE.md` vence** — ele é a fonte de verdade operacional.

---

## Onde o projeto está

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

Regras que valem para tudo isso: §6 do `CURRENT-STATE.md` e o `AGENTS.md` inteiro.
Em particular — **STOP AND REPORT em vez de contornar**, e não declarar PASS sem
executar.

## B) Exige o Windows do Dev — nenhum agente na nuvem faz

1. **Gate Windows E2E visual** (o gate de saída da 8.0D). Roteiro na §5:
   abrir pelo `Lia.bat` · anexar imagem · pergunta determinística sobre o conteúdo ·
   rota `groq` + `qwen/qwen3.8-27b` · resposta correta **pela imagem** · e um turno
   só de texto permanecendo no GPT-OSS.
2. **Reteste do pré-requisito do Stage (M3.0b).** **PASS Windows real em
   20/10/2026 nesta rodada:** build termina, pré-requisito registra sucesso,
   personagem aparece e encerramento gerenciado remove os processos da sessão.
   Baseline funcional preservado em `3ef6d11`; isso não aprova o gate de imagem.
3. **Qualquer validação de runtime, voz, instalador ou benchmark.**

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
