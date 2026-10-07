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

## 1. Repositório e branch

| Item | Valor |
| --- | --- |
| Repositório | `BloomRX/Lia-Project` |
| Branch de trabalho | `arena/01a10290-lia-project` |
| HEAD | `3ef6d11618f787dae6d197645d440a5775a60ad6` |
| Branch remota | sincronizada (`git ls-remote` retorna o mesmo SHA) |
| `main` | `db99c709059a6d074b18361bfb32c9f144620632` — **não recebeu merge** |
| Commits à frente de `main` | 5, todos `phase 8.0D` |
| Worktree | limpo |
| Prefixo de código | tudo sob `airi/` |

Commits da fase atual, do mais antigo ao mais recente:

```
d819397  phase 8.0D: derive final route conformance facts
8ddcbd2  phase 8.0D: preserve image attachments on retry
9ad9119  phase 8.0D: preserve voice turn fidelity
27ba585  phase 8.0D: bootstrap Lia-managed transcription      <- B1
3ef6d11  phase 8.0D: harden managed microphone bootstrap      <- B1.1 (HEAD)
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

## 5. Próximo ponto do roadmap

Conforme `docs/product/lia-ui-implementation-roadmap.md`, a família de fases é
`8.0A → 8.0J` e o trabalho atual está em **8.0D — First Multimodal Brain Adapter**.

**Próximo ponto real: `8.0E — Perception Foundation`**
(`docs/product/lia-ui-implementation-roadmap.md`, seção 8.0E).

Objetivo declarado no roadmap: estabelecer entradas de percepção independentemente da
escolha de modelo — microfone, screenshot, window capture e, no futuro, câmera/vídeo —
alimentando o Capability Router.

Observação factual, não uma nova prioridade: **a primeira dessas entradas, o microfone,
já foi entregue por B1/B1.1** e está validada em Windows real. Ou seja, 8.0E começa com
a entrada de áudio já funcionando; o que resta dela são as demais entradas e a ligação
formal com o Capability Router (`8.0C`).

Dentro de 8.0D permanece válida a ressalva do próprio roadmap: *"Do not make a model the
permanent default until measured on the target Windows machine."*

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

1. branch, HEAD ou o estado de `main`;
2. o resultado de um gate de runtime real (PASS/FAIL e o commit testado);
3. uma decisão de produto que altere o comportamento visível;
4. o próximo ponto do roadmap.

Não transformar este arquivo em relatório de rodada. Relatório de rodada vai para
`docs/product/` com nome próprio; aqui entra só o estado resultante.
