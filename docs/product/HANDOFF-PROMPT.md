# Prompt de handoff — nova sessão

Copiar tudo abaixo do separador para a nova sessão.

---

## Contexto

> **Leia primeiro `docs/project/CURRENT-STATE.md`.** Ele é a fonte de verdade
> operacional (branch, HEAD, gates de runtime, próximo ponto do roadmap). Este
> arquivo é referência técnica e armadilhas históricas; as seções operacionais
> abaixo foram atualizadas, mas o estado corrente vive lá.

Você está continuando o trabalho no repositório `BloomRX/Lia-Project`, branch
`arena/01a10290-lia-project`. **HEAD = `3ef6d11`, já pushado e confirmado**
(`git ls-remote` retorna `3ef6d11618f787dae6d197645d440a5775a60ad6`). Árvore limpa.
`main` está em `db99c709` e **não** recebeu merge.

Todo o código fica sob o prefixo `airi/`. A raiz git do checkout muda conforme o
ambiente — confirmar com `git rev-parse --show-toplevel`, nunca assumir um caminho.

## Estado da validação (números confirmados em `3ef6d11`)

- Stage `vitest run --project node`: **141 arquivos / 1718 passed / 1 skipped**
- `@lia/core`: **27 arquivos / 343 passed** · `@lia/lia-app`: **18 arquivos / 191 passed / 2 skipped**
- `vue-tsc` (`stage-tamagotchi`, `@lia/core`, `@lia/lia-app`): **0 `error TS`**
- ESLint (`pnpm lint`, sem `--fix`): **0 warnings / 0 errors em 3293 arquivos**
- **Gate real: cadeia de voz completa PASS em Windows real** — ver
  `docs/project/CURRENT-STATE.md` seção 2. Teste automatizado verde **não** substitui
  esse gate.

Comandos (rodar de `airi/`):

```bash
cd apps/stage-tamagotchi && npx vitest run --project node [arquivo]
cd apps/stage-tamagotchi && NODE_OPTIONS=--max-old-space-size=3072 npx vue-tsc --noEmit -p tsconfig.json
pnpm lint
```

Em `apps/stage-tamagotchi` passar **sempre** `--project node`: o default roteia para o
projeto `browser` (chromium), ausente neste ambiente. `pnpm typecheck` na raiz **não
completa** aqui — nunca declarar como PASS.

## Histórico — M1 Phase 5 (13 commits, `3aae478..db019f6`)

> Registro histórico, já encerrado. Mantido porque as armadilhas continuam úteis.
> A rodada atual é `phase 8.0D`; ver `docs/project/CURRENT-STATE.md`.

O blocker era: no Windows real, `fetch-source` baixava 97 MB e depois falhava com
`archive entry escapes the destination directory`.

**Causa real (não era ameaça, era falso positivo):** dois defeitos no guard de path.
A entry culpada era `alltalk_tts-f16117e95b540e9bbbd8247b49ca6c6b1350b172/` — o
marcador de diretório raiz do ZIP do GitHub, a **primeira** entry das 732.
(a) o `destDir` era montado com `/` hardcoded enquanto o `target` era normalizado,
então `startsWith` falhava para **todas** as entries; (b) o `topLevel` era atribuído
depois de calcular o `relative`, então o prefixo nunca era removido.

**Correção** (`main/services/lia/archive-path.ts`): normalizar a raiz com `resolve`,
validar o entry **antes** de resolver (`//` UNC → `/` absoluto → drive letter → `..`
→ vazio), e boundary check com função pura exportada:

```js
export function isInsideRoot(t, r, p) { return t === r || t.startsWith(`${r}${p.sep}`) }
```

A ordem importa: `//` tem que vir antes de `/`.

Depois disso vieram correções da **mesma classe de bug** — "um fato escrito em dois
lugares" — encontradas procurando o padrão em vez de esperar ele aparecer:

| Commit | Fato duplicado |
| --- | --- |
| `0407bdc` | Endereço do servidor: bootstrap usava `127.0.0.1:7851` hardcoded enquanto o resto lia da config |
| `074eb62` | O que torna uma instalação utilizável: duas listas de marcadores divergentes |
| `7619b1d` | Timeout de start: literal `180_000` vs `DEFAULT_START_TIMEOUT_MS` |
| `00639de` | Subdiretório `'app'` escrito como literal em dois módulos |

Mais: `ea4f07f` (log `extract-complete` — antes uma extração longa era
indistinguível de um hang), `3726812` (teste do timeout do instalador),
`85ebe2a` (recusar caminho com espaço **antes** de baixar),
`6da7bac` e `db019f6` (testes que pinçam os acordos acima).

O relatório completo está em **`docs/product/M1-PHASE5-ARCHIVE-EXTRACTION-FIX.md`**
(seções 1–8). Ler esse arquivo antes de mexer nessa área.

## ★ O que está pendente

O próximo ponto do roadmap é **`8.0E — Perception Foundation`** — ver
`docs/project/CURRENT-STATE.md` seção 5 e
`docs/product/lia-ui-implementation-roadmap.md`.

### Encerrado — não reabrir sem evidência nova

A cadeia de voz completa está **PASS em Windows real** no commit `3ef6d11`:

```
Lia.bat → managed STT → microphone → transcription → D2B12 → Brain → response → Kokoro TTS
```

Hearing é configurado automaticamente no modo Complete, sem nenhuma seleção manual de
STT, usando Groq (definição OpenAI-compatible) com `whisper-large-v3-turbo`. Web Speech
permanece **apenas como diagnóstico histórico — não é fallback**.

O blocker antigo desta seção ("QA da extração/instalação do AllTalk no Windows") e o
blocker de microfone/transcrição **não** devem ser reabertos por leitura de código nem
por teste automatizado isolado. Só reabrir com comportamento novo observado em máquina
real. O estado do QA de instalação do AllTalk (M1 Phase 5) **não foi re-verificado**
depois daquela rodada — tratar como desconhecido, não como PASS nem como FAIL.

## Restrições permanentes (o usuário já corrigiu isso antes — não repetir)

- **Sempre falar em pt-BR.**
- Commits separados por responsabilidade, push de cada um, informar hash/arquivos/riscos.
- **Git:** nunca `reset`/`checkout` destrutivo/`clean`. Não descartar trabalho preexistente.
- **ESLint: NUNCA `eslint --fix` com glob de diretório** (`src/renderer`, `src/main`).
  Isso "corrige" baseline silenciosamente em arquivos alheios e infla o diff.
  **Listar sempre os arquivos individualmente.** Conferir com `git diff --name-only <base>..HEAD`.
- ESLint: corrigir só o que você introduziu, não a baseline.
- **Nunca marcar PASS sem ter executado.** Sem DISPLAY/binário do Electron, não fingir —
  rodar substituto automatizado e declarar a limitação.
- Bugfixes sem correções superficiais: sem `setTimeout`, sem reload, sem esconder
  form sem estado, **sem mascarar mensagem de erro**, sem "corrigir" áudio baixando volume.
- **Não assumir `persistConfig()` = "provider ativado"**; rastrear o fluxo real.
  A configuração persistida é a única fonte de verdade. Nunca gravar segredo em
  localStorage/config.
- **Não tocar em:** Persona; secrets; TTS runtime; fallback runtime de chat;
  web/pocket; live model discovery. Provedor/model **nunca hardcoded**.
- **`DevKit.bat` genérico da raiz NÃO pode ser alterado/substituído/renomeado.**
  Os scripts vivem em `airi\DevKit.bat`, `airi\DevTamagotchi.bat`, `airi\QA.bat`.
- Não executar `pnpm install` automaticamente nos `.bat`; nenhum caminho absoluto
  de máquina (usar `%~dp0`).
- Diagnostics: **não remover a infraestrutura**. Nenhuma flag de localStorage pode
  desbloquear diagnostics em produção (gate só por build mode). Instrumentação
  temporária **só metadata** — nunca áudio completo, texto completo, API keys.
- Não misturar dois assuntos num único commit se isso aumentar o risco.

## Armadilhas que já custaram tempo (não redescobrir)

- **`if s.count(old)==1` sem `assert` ⇒ patch silenciosamente não aplica.** Aconteceu
  duas vezes. Sempre `assert`, e confirmar o resultado lendo o arquivo.
- **`cp $FILE /tmp/dir/` sem `mkdir -p` ⇒ restore falha e o arquivo fica mutado.**
  Confirmar restore com `git diff --stat` vazio, nunca assumir.
- **Mutação que sobrevive porque o código é inalcançável pela API pública** ⇒
  exportar como função pura e testar direto (foi assim que `isInsideRoot` nasceu).
- **Mutação que sobrevive porque o fake cria tudo de uma vez** ⇒ o teste precisa
  construir a forma que separa os casos (foi o commit `6da7bac`).
- **Asserção fraca que passa sem testar nada** (`expect(x.length===1).toBe(true)`
  num teste que devia provar que o child foi morto). Guardar o objeto do mock e
  asserar a chamada.
- **Guard de path só testado no host Linux é invisível.** Injetar `pathImpl` e testar
  `path.win32`.
- **`startsWith` sem boundary é falso positivo de segurança:**
  `'C:\Lia\runtime-evil\x'.startsWith('C:\Lia\runtime') === true`.
- **Validar depois de `resolve` apaga a evidência** — `resolve` colapsa `..`.
- **Symlink:** filename validation não protege. Detectar por
  `(versionMadeBy>>>8===3) && ((externalFileAttributes>>>16)&0o170000)===0o120000`;
  **yauzl 3.4.0 não tem helper**.
- **yauzl e jszip já bloqueiam entries hostis** (`validateFileName` na linha 871, só
  com `decodeStrings`). Teste e2e de entry maliciosa precisa do builder manual
  `makeRawZip()` em `voice-runtime-extract.test.ts`.
- **Módulo que importa `electron` não carrega em teste Node.** Por isso existe o
  split `voice-runtime-install-exec.ts` (sem electron) ↔
  `voice-runtime-bootstrap-electron.ts`.
- **API eventa: `defineInvokeHandler(context, event, handler)`.** Canal novo quebra
  todos os mocks — registrar em todos os harnesses.
- **Harness de UI:** `renderToString(createSSRApp(C).use(pinia))` de
  `vue/server-renderer`. `t()` devolve o **caminho da chave**. `onMounted` **não**
  roda em SSR. `<details>` fechado ainda renderiza o conteúdo.
- **`lia-config.test.ts` tem UM regex por arquivo capturando o prefixo** ⇒ só UM
  helper `tt` por painel; `PANEL_SOURCES` precisa listar cada arquivo novo.
- **`useLiaVoiceStore()` expõe `refreshConfig()`, NÃO `load()`.**
- **i18n:** pt-BR em `packages/i18n/src/locales/pt-BR/home.yaml`; en em
  `packages/i18n/src/locales/en/tamagotchi/home.yaml`. `node -e "require('yaml')"`
  precisa rodar de `airi/`.
- **Dois `vue-tsc` em paralelo ⇒ saída vazia enganosa.**
- **Glob de shell não expande `src/**/x.test.ts` no vitest.**
- **O ambiente reverte sozinho** (21× registradas até M1, e continuou acontecendo nas
  rodadas de 8.0D — inclusive no meio de uma investigação), apagando o checkout,
  `/tmp`, `node_modules` e o `pnpm` global. **Receita atual:** conferir
  `git status`/HEAD no início de toda rodada; se o checkout sumiu ou não bate, fazer
  **clone novo da URL do GitHub na branch da sessão** e conferir HEAD + worktree limpo.
  **Não usar `git reset --hard`** — está proibido. Depois:
  `corepack enable pnpm && corepack prepare pnpm@11.24.0 --activate` (nunca
  `npm i -g pnpm`) → `cd airi && pnpm install --ignore-scripts` (sem
  `--ignore-scripts` o postinstall do `onnxruntime-node` falha com
  `UNABLE_TO_VERIFY_LEAF_SIGNATURE`; nunca desligar verificação TLS) →
  `pnpm --filter "@proj-airi/stage-tamagotchi^..." --filter "@lia/lia-app^..." run build`.
  Um clone novo não tem identidade git: configurar `user.name`/`user.email`
  **no escopo do repositório**.
- **Nunca reparar um clone antigo.** Se `status` não estiver vazio, ou a branch/HEAD não
  bater, clonar de novo.
- **Nunca fabricar resultado.** Se não deu para rodar, dizer isso explicitamente.

## Fatos externos verificados (não precisa re-baixar)

- **`atsetup.bat` RECUSA ESPAÇO NO CAMINHO.** Linha 353 (ramo `-silent`):
  `echo "%CD%"| findstr /C:" " >nul && ... goto exit`. Aborta em silêncio, sem código
  de erro útil. Linha 28 (menu) faz o mesmo com `pause && goto :end`. Por isso existe
  `assessInstallPath()` em `voice-runtime-env.ts`.
- **PIN:** `PINNED_ALLTALK_COMMIT='f16117e95b540e9bbbd8247b49ca6c6b1350b172'` ⇒
  `https://github.com/erew123/alltalk_tts/archive/<sha>.zip`. **Não existe tag de
  release v2.** 732 entries, 0 symlinks, 0 paths hostis.
- **`atsetup.bat -silent` existe** (linha 46: `if "%1"=="-silent" goto InstallCustomStandalone`).
  Só **curl** é obrigatório. Git/Python/eSpeak/FFmpeg/Build Tools/UAC: não.
  Gera `alltalk_environment\conda` e `alltalk_environment\env` (linhas 371-372) —
  são exatamente os marcadores que o `verify-install` exige.
- **Limitação conhecida:** `atsetup.bat:406` fixa `pytorch-cuda=12.1` sem branch
  CPU-only ⇒ ~10 GB mesmo em GPU AMD. **Sem checksum oficial.**
- **Licença:** AllTalk AGPL-3.0. Pesos XTTS-v2 sob Coqui Public Model License 1.0.0
  **não-comercial**; Coqui Inc fechou em jan/2024, então não há quem venda licença
  comercial.
- **AllTalk v2 API:** `POST http://{ip}:{port}/api/tts-generate`,
  `application/x-www-form-urlencoded`, porta **7851**. Idioma `pt`, **não existe
  `pt-BR`**. Resposta é JSON com caminho, não bytes — baixar o WAV em 2º request.
  Health: usar `/api/voices` (`/api/ready` só existe em fonte secundária).

## Invariantes que não devem mudar

`voice.tts` é o único source of truth. Canônico
`userData/lia-voices/<id>/<file>` × cópia `<voicesDir>/lia-<id>.wav`.
`managedVoiceFilename()` só `randomUUID()` + ext whitelist + `safeFilename`.
`MAX_FILE_BYTES = 4 GB`. `DEFAULT_ALLTALK_BASE_URL='http://127.0.0.1:7851'`.
`toAllTalkLanguage()` (`pt-BR`→`pt`). `CUSTOM_VOICE_PROVIDER_ID` em
`shared/lia-voice.ts`. **`LiaBootstrapFailureCategory` em `shared/lia-voice.ts` é a
fonte de verdade das categorias** — o bootstrapper só tem um alias.

## Primeira coisa a fazer

1. `git log --oneline -1`, `git status` e `git ls-remote origin refs/heads/<branch>` —
   confirmar branch, HEAD `3ef6d11` e worktree limpo. Se o checkout sumiu, clonar de
   novo (ver "O ambiente reverte sozinho", acima).
2. **Ler `docs/project/CURRENT-STATE.md`** — estado operacional corrente.
3. Ler o relatório da área em que vai mexer. Para voz/Hearing, o contrato está na
   seção 3 de `CURRENT-STATE.md`.
4. Perguntar ao usuário qual é a tarefa da rodada. **Não assumir** que é continuar um
   gate antigo: gates de runtime dependem de o usuário executar no Windows.
