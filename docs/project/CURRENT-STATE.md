# LIA — Estado operacional atual (living state)

**Este arquivo é a fonte de verdade operacional do projeto.** Qualquer sessão nova deve
lê-lo antes de trabalhar. Quando uma decisão de produto ou um estado de validação mudar,
este arquivo é atualizado no mesmo commit — conforme a regra já estabelecida em
`docs/product/lia-ui-implementation-roadmap.md` ("Update documentation whenever a
deliberate product-level decision changes").

Ele registra **estado**, não narrativa. Relatórios longos de rodada continuam em
`docs/product/`. Aqui fica só o que uma próxima sessão precisa para não partir de
premissa falsa.

---

## 1. Repositório, branch e baseline validado

| Item | Valor |
| --- | --- |
| Repositório | `BloomRX/Lia-Project` |
| Branch de trabalho | `arena/01a10290-lia-project` |
| **Último commit funcional validado em Windows** | `3ef6d11618f787dae6d197645d440a5775a60ad6` |
| `main` | `db99c709059a6d074b18361bfb32c9f144620632` — **não recebeu merge** |
| Prefixo de código | tudo sob `airi/` |

**Atenção:** a branch contém código funcional **posterior** ao baseline acima — a rota
Brain multimodal da Phase 8.0D-M1 (seção 5). Esse código está verde em testes
automatizados mas **ainda não passou por gate de runtime real**. O baseline só avança
quando um commit passar por um gate Windows; até lá ele permanece `3ef6d11`.

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

Números da Phase 8.0D-M1 (o commit que contém a rota multimodal). **Teste automatizado
verde não é gate de runtime** — ver a seção 5 para o gate Windows pendente.

| Verificação | Resultado |
| --- | --- |
| Stage `vitest run --project node` | 141 arquivos, **1725 passed**, 1 skipped |
| `@lia/core` | 28 arquivos, **353 passed** |
| `@proj-airi/core-agent` | 12 arquivos, **127 passed** |
| `@lia/lia-app` | 18 arquivos, **191 passed**, 2 skipped |
| typecheck `stage-tamagotchi` | **0 `error TS`** |
| typecheck `@lia/core` / `core-agent` / `@lia/lia-app` | **0 `error TS`** |
| `pnpm lint` (sem `--fix`) | **0 warnings, 0 errors em 3294 arquivos** |

Mutation tests desta fase (cada mutação restaurada e confirmada por `md5sum -c`):

| Mutação | Falhas |
| --- | --- |
| `imageInput: true` removido do Qwen | 13 (8 lia-core + 5 Stage) |
| segunda rota removida da política | 12 (gates 3, 4, 5, 6, 6c, 8 + testes de política) |
| transporte do attachment até a request removido | 2 (gate 7 + o teste de attachments pré-existente) |

Comandos (a partir de `airi/`):

```bash
cd apps/stage-tamagotchi && npx vitest run --project node [arquivo]
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

## 5. Estado da 8.0D e a rota multimodal (Phase 8.0D-M1)

Conforme `docs/product/lia-ui-implementation-roadmap.md`, a família de fases é
`8.0A → 8.0J` e o trabalho atual está em **8.0D — First Multimodal Brain Adapter**.

A reconciliação curta dos critérios de 8.0D **já foi feita** (auditoria read-only aceita).
Resultado, com a Phase 8.0D-M1 já aplicada:

| critério | status | observação |
| --- | --- | --- |
| text conversation | **DONE** | validado em Windows real no baseline `3ef6d11` |
| image/screen understanding | **IMPLEMENTADO, gate Windows PENDENTE** | rota Qwen adicionada nesta fase; ver abaixo |
| audio understanding ("where supported") | **NOT STARTED** | o candidato aprovado é text+image; B1/B1.1 é STT *antes* do brain, não áudio nativo no brain |
| tool calling | **PARTIAL** | transporte + gate de compatibilidade provados no seam da Lia; o *loop* completo pertence ao `@xsai/stream-text` e segue como item de closure |
| latency | **NOT STARTED** | nenhuma medição existe; o contrato de telemetria exclui timing por desenho |
| region/network impact | **NOT STARTED** | nenhuma referência no escopo Brain |
| failure behavior | **PARTIAL** | failover real registrado e classificado; falta teste dirigido recoverable→failover / permanent→não |
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

Só depois desse gate o baseline funcional avança e `image/screen understanding` pode ser
marcado DONE.

### Itens de closure restantes da 8.0D (fora desta fase)

1. **tool-calling closure** — teste dirigido do loop completo: rota resolvida → modelo
   devolve `tool_call` → ferramenta executa → resultado volta ao modelo. O loop vive no
   `@xsai/stream-text`; prová-lo exige modelo real ou um mock arquitetural pesado, por
   isso não foi alargado o escopo nesta fase.
2. **latency measurement** (Windows real).
3. **region/network measurement** (Windows real).
4. **directed failure-behavior test** (automatizável).

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
