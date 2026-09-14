# Prompt de handoff — nova sessão

Copiar tudo abaixo do separador para a nova sessão.

---

## Contexto

Você está continuando o trabalho no repositório `BloomRX/Lia-Project`, branch
`arena/01a07b6d-lia-project`. **HEAD = `db019f6`, já pushado e confirmado**
(`git ls-remote` retorna `db019f6cd429fa673ce7e07461491f4283b49fdc`). Árvore limpa.

Raiz git: `/home/user/Lia-Project`. Todo o código fica sob o prefixo `airi/`.

## Estado da validação (números confirmados em `db019f6`)

- Suíte tamagotchi: **102 arquivos / 921 passed / 1 skipped**
- `vue-tsc`: **3 erros, todos baseline pré-existente** —
  `provider-config-service.ts(41,32) TS2322`, `home.vue(85,9) TS6133`,
  `lia-persona.ts(383,42) TS6133`. **Não corrigir esses 3**; qualquer erro novo é seu.
- ESLint: 0

Comandos (rodar de `airi/`):

```bash
./node_modules/.bin/vitest run --config apps/stage-tamagotchi/vitest.node.config.ts [arquivo]
cd apps/stage-tamagotchi && NODE_OPTIONS=--max-old-space-size=3300 ./node_modules/.bin/vue-tsc --noEmit
./node_modules/.bin/eslint --quiet <arquivos listados um a um>
```

## O que foi feito na rodada anterior (13 commits, `3aae478..db019f6`)

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

**QA no Windows real.** O usuário precisa clicar em Instalar. Esperado:
`fetch-source downloaded → extract-source complete → próxima etapa`.

**NÃO declarar installer PASS.** Extração corrigida não é o mesmo que instalação
funcionando. A lista do que ainda precisa rodar em máquina real está na seção 7 do
relatório. Um item foi parcialmente reduzido (seção 8.6): os 6 prompts
`choice /C YN` do `atsetup.bat` estão todos dentro de blocos `if errorlevel 1 (`,
ou seja, só são alcançáveis quando um passo conda já falhou — mas **o que `choice`
retorna com stdin fechado e sem console não foi observado**, é inferência do fluxo
de controle.

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
- **O ambiente reverte sozinho** (já aconteceu 21×), apagando `airi/`, `/tmp`,
  `node_modules` e o `pnpm` global. Receita de recuperação:
  `git fetch origin arena/01a07b6d-lia-project` → `merge-base --is-ancestor HEAD FETCH_HEAD`
  → backup de `docs` em `/tmp` → `git reset --hard FETCH_HEAD` →
  `npm i -g pnpm@11.24.0` → `cd airi && pnpm install --ignore-scripts && pnpm rebuild esbuild`
  → `pnpm -r --no-bail --filter "./packages/**" build` → idem `./server/packages/**`.
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

1. `git log --oneline -1` e `git status` — confirmar que está em `db019f6` e limpo.
2. Ler `docs/product/M1-PHASE5-ARCHIVE-EXTRACTION-FIX.md`.
3. Perguntar ao usuário qual é a tarefa da rodada. **Não assumir que é continuar o
   QA** — o QA depende dele clicar em Instalar no Windows.
