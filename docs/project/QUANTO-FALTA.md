# Quanto falta — Lia-Project

Escrito para responder, sem precisar perguntar ao Dev: **o que resta, o que um
agente pode fazer sozinho e o que exige a máquina dele.**

Fonte: [`CURRENT-STATE.md`](CURRENT-STATE.md) §0 e §5, medido em
`4a6a811`. Se este arquivo e o `CURRENT-STATE.md` divergirem, **o
`CURRENT-STATE.md` vence** — ele é a fonte de verdade operacional.

---

## Onde o projeto está

30/10, revisão de Transport Configuration: persistência e consumidor HTTP/SSE
próprios no main, migração/CAS e proteções de remoção/escopos testadas. Núcleo 77,
Core-agent 156, stores/main/cache/cofre 449, Chromium 16, lint/typechecks/builds PASS;
Electron real com HTTP local e rede do renderer bloqueada confirmou 11 grupos.
**Segurança global permanece parcial:** consumidores legados ainda usam getter
de credenciais no renderer fora dos escopos protegidos. Stage completo, modelo
externo e instalador não foram aprovados. Revisão não publicada, aguardando o Dev;
seis Core/auditorias preservados, baseline mantido. [Relatório e matriz](../product/RELEASE-WINDOWS-2026-10-30-TRANSPORT-CONFIGURATION.md).

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
4. **Gate do Stage próprio.** `lia/stage` só foi provado em Linux headless: a
   janela nunca abriu de verdade, o "personagem" é um placeholder declarado e o
   encerramento sem órfão no Windows nunca foi observado. O que precisa rodar no
   Windows do Dev: abrir o Stage, ver a janela, fechar, e conferir na lista de
   processos que nada ficou para trás.

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
