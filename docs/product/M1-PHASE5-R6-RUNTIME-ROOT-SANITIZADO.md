# Phase 5 Round 6 — Fix: runtime root fora do path com `@` (`@proj-airi` → `proj-airi`)

Commits desta rodada em `arena/01a09ddb-lia-project`: `47c8e29` (fix + testes), `6eae5b0` (sonda aponta para a nova raiz), este doc (commit seguinte). **Sem installer PASS ainda** — falta o end-to-end no Windows após o fix.

## 1. Base confirmada (herdada da R5)

Causa raiz provada com teste binário na máquina real: mesmos argumentos oficiais, mesmo instalador com SHA-256 do registro oficial — com `@` no destino, exit=2 vazio; sem `@`, exit=0 com `_conda.exe`. Ver `M1-PHASE5-R5-EXIT2-INTEGRIDADE-E-PATH.md` §0.

## 2. Decisão (aprovada pelo usuário)

Opção A: **no Windows, a raiz de runtimes sai de `userData`** (`%APPDATA%\@proj-airi\stage-tamagotchi\runtimes\alltalk`) **para um irmão sanitizado** (`%APPDATA%\proj-airi\stage-tamagotchi\runtimes\alltalk`). Mata o `@` na árvore inteira — cwd do atsetup, installer, prefixo conda, env Python e scripts `start_alltalk` — e não só no `/D` do NSIS. Junction e "só mover o conda" foram descartadas no diálogo de decisão (indireção frágil / empurra a falha para o próximo estágio).

## 3. Implementação

- **Novo módulo `voice-runtime-root.ts`** (dependency-free, path api injetável — Windows testado em POSIX): `ATSETUP_FORBIDDEN_PATH_CHARS` (o conjunto literal da blacklist `findstr` do atsetup pinado), sanitizer por segmento (`@proj-airi` → `proj-airi`, colapsa runs, trim de hífens), `resolveRuntimeRootLayout` (off-Windows: idêntico ao anterior) e `migrateLegacyRuntimeRootSync`.
- **`voice-runtime-bootstrap-electron.ts`**: `runtimeRootDir()` resolve o novo layout; migração lazy, **uma tentativa por processo, latch só em sucesso** (falha transitória, ex.: arquivo travado, é retentada no próximo acesso — nunca cai de volta para o path com `@` silenciosamente). Log: `[LIA-VOICE-BOOTSTRAP] runtime-root migrated from=... to=...`.
- **Migração = um rename** (mesmo volume por construção, O(1)): installer de 85 MB, árvore extraída e state store vão juntos — **nada de re-download**. No-ops: `root-present` (já migrado), `legacy-absent` (instalação nova), `same-path` (off-Windows). Falha de rename **propaga** (fail-loud), com o motivo no log via o estado `failed` do bootstrap.
- **Consumers intocados**: `alltalk-runtime-service`, `voice-runtime-bootstrap-service`, `createRuntimeProbe` continuam chamando `runtimeRootDir()`/`runtimeAppDir()` — a mudança é central por construção (verificado: nenhum outro path hardcoded com `runtimes` no main).

## 4. Testes (14 novos, `voice-runtime-root.test.ts`)

- Pin literal: cada um dos 23 chars da blacklist do atsetup é coberto pelo regex; texto limpo (hífen, underscore, ponto) intocado.
- Sanitizer por segmento (ofensor real, runs colapsados, segmento que zera, segmento limpo inalterado) e por path relativo.
- Layout win32 exato (root novo + legacy) e **assert de que nenhum char da blacklist sobrevive no root efetivo**; linux mantém legacy ≡ root.
- Migração com harness fs em memória: ordem exata `mkdir`-antes-de-`rename` (1 chamada cada), fatos retornados, log com from/to, no-ops, e **EPERM propaga** sem log de sucesso.

## 5. Mutações — 4/4 detectadas

| mutação | resultado |
|---|---|
| sanitizer vira no-op (`return segment`) | 6/14 falham |
| guard de plataforma removida (todos legacy) | 2/14 falham |
| rename condicionado a root existir (nunca roda) | 2/14 falham |
| mkdir depois do rename | 1/14 falha |

Restauro verificado por `diff -q` e re-run 14/14 verde.

## 6. Estado verde local (executado, não presumido)

- `voice-runtime-root.test.ts`: **14/14**; diretório `lia/`: **15 arquivos / 286 passed**; suíte completa: 243 arquivos OK + **`better-ws` com 12 falhas ambientais** (`bind failed` — o sandbox bloqueia binds TCP; idêntico no baseline stashed, não é regressão).
- `vue-tsc`: 0 erros. ESLint: 0 nos 3 arquivos tocados (os erros transitórios que eu mesmo introduzi — import de `stat` dropado e ordenação — foram corrigidos antes do commit; baseline conferido limpo via stash).

## 7. O que NÃO muda

Outras plataformas, userData/config/segredos/persona, fluxo de download/extract/resume, argumentos do instalador (R4), UX do painel (R4), regra de retry sem re-download (R4 guard), Colab, Home. Diagnósticos continuam metadata-only.

## 8. Risco residual declarado

- Se algum registro de estado com paths absolutos legados já existisse na máquina de alguém, referências antigas ficariam obsoletas após o rename; como nenhuma instalação Windows jamais completou o conda nesta linha de QA, o estado persistido é no máximo parcial e os guards de verificação (verificação por artefatos) fazem o fluxo cair para uma tentativa limpa. Sem ação requerida.
- `%TEMP%\lia-qa-conda` da sonda pode ser apagado manualmente (`rd /s /q`).

## 9. Contratos do QA end-to-end (o que medir agora)

1. Primeiro "Instalar" após o update: uma linha `runtime-root migrated from=... to=...` no log (só na primeira vez).
2. `miniconda-install-verify exit=0 conda-prefix-exists=true conda-exe-exists=true` — isso autoriza **PASS do instalador Miniconda**.
3. Resume upstream roda (`atsetup -silent`) sem re-download dos 97/85 MB; env é criado; marker `start_alltalk.bat` aparece → sequência completa de instalação PASS.
4. Painel com etapas animadas ao clicar (contrato R4, já coberto por teste mas nunca observado ao vivo).

Cada item só será afirmado com o log correspondente colado.
