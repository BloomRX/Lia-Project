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

## 4. Estado da validação automatizada em `3ef6d11`

Re-verificado nesta rodada no checkout `3ef6d11`: `hearing.test.ts` **30 passed**, exit 0.

| Verificação | Resultado |
| --- | --- |
| `hearing.test.ts` (focused, `--project node`) | 30 passed |
| Stage `vitest run --project node` | 141 arquivos, 1718 passed, 1 skipped |
| `@lia/core` | 27 arquivos, 343 passed |
| `@lia/lia-app` | 18 arquivos, 191 passed, 2 skipped |
| typecheck `stage-tamagotchi` / `@lia/core` / `@lia/lia-app` | 0 `error TS` |
| `pnpm lint` (sem `--fix`) | 0 warnings, 0 errors em 3293 arquivos |

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

## 5. Transição 8.0D → 8.0E

Conforme `docs/product/lia-ui-implementation-roadmap.md`, a família de fases é
`8.0A → 8.0J` e o trabalho atual está em **8.0D — First Multimodal Brain Adapter**.

**Próxima fase nomeada no roadmap após 8.0D: `8.0E — Perception Foundation`.**
**Antes de iniciar implementação 8.0E, fazer uma reconciliação curta dos critérios de
8.0D e confirmar quais estão DONE / PARTIAL / NOT STARTED.**

Essa reconciliação é necessária porque B1/B1.1 fecharam especificamente o managed
STT/microphone no Windows E2E, e isso **não prova sozinho** que todos os critérios de
8.0D foram concluídos.

### O que está registrado como fato

- **B1, B1.1 e o blocker Voice/STT estão CLOSED** — gate de runtime real PASS na seção 2.
- Isso **não equivale automaticamente a encerrar toda a 8.0D.** O roadmap lista para 8.0D
  uma validação mais ampla (conversa de texto, compreensão de imagem/tela, compreensão
  de áudio onde suportado, tool calling, latência, impacto de região/rede e comportamento
  de falha), além da ressalva *"Do not make a model the permanent default until measured
  on the target Windows machine."* Esses critérios **não foram avaliados** por B1/B1.1.
- **O microfone é uma capacidade já funcional** e poderá ser reaproveitada em 8.0E —
  é a primeira das entradas que 8.0E lista (microfone, screenshot, window capture e, no
  futuro, câmera/vídeo).
- **O requisito de 8.0E de os perception producers alimentarem o Capability Router
  (`8.0C`) ainda deve ser verificado e implementado — não presumido entregue.** B1/B1.1
  projetam o STT nos stores do AIRI e entregam o transcript ao fluxo de conversa
  existente; eles não implementam um perception producer ligado ao Capability Router.

### Próxima rodada

Auditoria curta de fechamento da 8.0D — **não implementação**. Só depois dessa
reconciliação é que se decide o escopo real de 8.0E.

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
