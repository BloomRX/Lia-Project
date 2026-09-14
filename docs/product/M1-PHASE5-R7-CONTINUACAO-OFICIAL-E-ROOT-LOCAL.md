# Phase 5 Round 7 — Continuação oficial idempotente (sem `atsetup.bat`) + root em `Local\Lia`

Commits desta rodada em `arena/01a09ddb-lia-project`: `a1c3638` (W2: root + migração), `bd9b2b7` (W1: continuação + service + testes), `abefa61` (sonda aponta para `Local\Lia`), este doc. **Sem installer PASS declarado** — só o QA end-to-end no Windows, sobre este código, fecha os itens 9/10 do brief.

## 1. Fatos de entrada (QA da R6, executado pelo usuário)

- Miniconda **install PASS**: exit real `0`, `conda-prefix-exists=true`, `conda-exe-exists=true`, `miniconda-install-verified`. O arco das rodadas 3→6 (install direto com os switches oficiais, exit real, verify por artefatos) encerra provado.
- O resume cego `atsetup.bat -silent` morreu a seguir: exit real `1`, `stderr` com `EnvironmentLocationNotFound` e `O sistema não pode localizar o rótulo do lote - RunScript` (33718 ms), evento `resume-incomplete`.

## 2. Auditoria do pin (itens 3/4 do brief)

Auditado `atsetup.bat` no commit pinado `f16117e9` e no master upstream de hoje: **não existe label `:RunScript` em nenhum dos dois** — o branch `conda exists` do script termina em `goto RunScript` para um rótulo inexistente. Bug upstream, presente no pin e ainda vivo no master; não é corrupção local nem erro de invocation. Lista completa do que o pin roda **depois** do Miniconda funcionar (item 5), com ordem e canais: ver `alltalkSetupCommands()` em `voice-runtime-bootstrap.ts` — cada entrada carrega o `id` do label/step do script de onde foi extraída.

## 3. Decisões (itens 2 e 8 do brief)

- **Produção nunca mais executa `atsetup.bat`** (item 2). O script permanece na árvore extraída — é artefato do pin — mas não é spawnado (mesmo `-silent` blind está baniido).
- **Root do runtime sai de Roaming para `%LOCALAPPDATA%\Lia\runtimes\alltalk`** (dev: `Lia-dev`) — W2. Gigabytes de env conda não pertencem a um perfil roaming; `%LOCALAPPDATA%\Lia` não contém nenhum char da blacklist do instalador. Fixado pelo usuário contra `%LOCALAPPDATA%\<namespace>\<app>` e `%PROGRAMDATA%` (UAC).

## 4. Implementação W2 — root + migração (`voice-runtime-root.ts`)

- `resolveRuntimeRootLayout({appDataDir, localAppDataDir, ...})` → `{rootDir, legacyRootDirs[]}`. Win32: `join(localAppData,'Lia','runtimes','alltalk')` (`WINDOWS_RUNTIME_PRODUCT_DIR='Lia'`); wrapper Electron passa `app.getPath('localAppData')` só em win32.
- Legados ordenados **mais recente primeiro**: `[round-6 Roaming\proj-airi, userData @proj-airi]`; a migração síncrona (`rename` mesmo volume) move **só o sobrevivente mais novo** e **nunca sobrescreve um root existente** — runtime tratado como dado do usuário. Reasons: `migrated`, `root-present`, `legacy-absent`, `same-path` (linux/lista vazia); EPERM propaga.
- Consumers seguem chamando `runtimeRootDir()` — centralização intacta.

## 5. Implementação W1 — continuação oficial idempotente (`stepRunSetup`)

1. **ensureInstaller**: se o exe do pin faltar, baixa a URL oficial `Miniconda3-py311_24.4.0-0-Windows-x86_64.exe` e **antes de executar** prova bytes=`85_690_400` **e** sha256=`fb6aaeaf…d0268` (registro oficial repo.anaconda.com); divergiu → apaga e falha como `download`, nunca executa.
2. **ensureConda**: install direto com os switches oficiais (inalterado da R4) + **`_conda.exe --version` código 0 obrigatório** antes de construir em cima (meia-instalação ou AV-mangled morre aqui, não 20 comandos depois).
3. **ensureEnvironment**: `conda create --no-shortcuts -y -k --prefix <env> python=3.11.9` se `<env>\python.exe` faltar; verify por arquivo.
4. **ensureDependencies**: os **9 comandos oficiais como dados ordenados** (`pytorch==2.2.1`/tv/ta/cuda12.1 (`-c pytorch -c nvidia`), `pytorch::faiss-cpu`, `ffmpeg` gpl, `ffmpeg` h `--no-deps`, `requirements_standalone.txt`, `gradio==4.44.1` upgrade, wheel deepspeed (download → install → `del`, na ordem do pin), `requirements_parler.txt`, `conda clean`) — **mesmos comandos, mesma ordem**; só muda o mecanismo de mira: `--prefix <env>` / `Scripts\pip.exe` explícitos em vez de `conda activate` interativo (item 6: sem automação de menu, sem reimplementação). **Fatal em todos exceto `clean`** exatamente como o guard de `errorlevel` do pin (item 7: seqüência idempotente — pacotes satisfeitos não re-baixam). Timeouts por subetapa.
5. **Launchers**: os 4 `start_*.bat` escritos **byte-exact** ao que o pin produz (CRLF, prolog de 5 linhas com os caminhos absolutos desta árvore). Arquivo já idêntico byte-a-byte é **mantido**; ausente ou divergente (paths absolutos velhos da era Roaming) é re-escrito — a migração de root não deixa `.bat` apontando para o passado (comparação byte-igual é a verificação, item 7).
6. Guarda de entrada mantida: `SETUP_INPUTS` (os dois requirements lidos por caminho relativo) sem `atsetup.bat`. `verify-install` intacto ao final.

**UI (item 10 / invariante do projeto)**: qualquer desses passos que falhe produz a frase opaca padrão (“The voice system could not be installed.”); os motivos técnicos (`conda`, exit codes, paths) existem **apenas** no log estruturado (`miniconda-*`, `conda-env-*`, `setup-command-*`, `start-script-*`).

## 6. Tabela dos 10 itens do brief

| # | pedido | onde |
|---|---|---|
| 1 | Miniconda PASS confirmado | §1 (log da máquina QA) |
| 2 | não chamar `atsetup -silent` cegamente | §3; guard do step, zero spawns do script |
| 3 | auditar branch pós-Miniconda do pin | §2 |
| 4 | RunScript inexistente = bug upstream | §2 (pin **e** master) |
| 5 | comandos exatos do pin identificados | `alltalkSetupCommands()` + `alltalkStartScripts()`, com `id` de origem |
| 6 | reutilizar scripts/comandos oficiais | §5.4 (mesmos comandos; só mira `--prefix`) |
| 7 | continuação idempotente até `start_alltalk.bat` + verify-install | §5 (3-6), testes de resume/resuability |
| 8 | root fora de Roaming, path à prova de blacklist | §3/§4 (`%LOCALAPPDATA%\Lia…`) |
| 9 | não declarar PASS até QA | §7 |
| 10 | sem leaks técnicos na UI | §5 nota final + testes `state.message` |

## 7. Estado verde local (executado, não presumido)

- `apps/stage-tamagotchi/src/main/services/lia/`: **15 arquivos / 294 testes verdes** (inclui os 16 de `voice-runtime-root.test.ts` e a suíte de bootstrap reescrita em torno da continuação: sequência oficial em ordem, cwd raiz da árvore em todo spawn, pip só via `Scripts\pip.exe` do env, wheel download→install→del, `clean` tolerado, integrity do instalador, launchers byte-exact/kept/stale, retry reutilizando artefatos, args pinados NSIS, `_conda --version` gate).
- `eslint` limpo nos 4 arquivos tocados; `vue-tsc --noEmit` 0 erros.
- Mutações: **não rodadas neste turno** (a suíte reescrita já carrega asserts de sequência/byte/exit-code; rodada de mutações fica como débito para a próxima sessão).

## 8. Contrato para o próximo QA Windows (evidência mínima para fechar 9/10)

1. **Migração**: máquina com runtime em `Roaming\proj-airi` → ao abrir, o log mostra `runtime-root migrated` e a árvore aparece em `%LOCALAPPDATA%\Lia\runtimes\alltalk` sem re-download.
2. **Resume do env**: com conda+installer presentes e env ausente (estado deixado pela R6), o passo `run-setup` cria o env (`conda-env-create-*`), corre os 9 comandos (`setup-command-start/finished`, nenhum `setup-command-failed`) e termina `ready` **sem** `atsetup` no log e **sem** exit 1/RunScript.
3. **Bats renovados**: os 4 `start_*.bat` no novo root, com caminhos `Local\Lia` (ver `start-script-written/kept`).
4. Falha induzida (opcional): quebrar sha256 do instalador baixado → falha categorizada `download`, instalador apagado, nada executado.

## 9. Adendo R7.1 — "botão Instalar/Tentar novamente sumiu" (fix da sessão seguinte)

Sintoma reportado: durante a continuação o card ficava sem o botão e aparentava travado. O botão é escondido por design em fase ativa — o problema de verdade era que ela podia ficar ativa **para sempre** e **muda**:

- **Download sem timeout** (`createRuntimeDownload`): uma conexão travada (TCP meio-aberto) deixava a fase ativa eternamente. Agora há teto de 45 min com `AbortSignal.timeout`, normalizado para falha de rede — e a mensagem evita "aborted", que cairia no regex de `cancelled` e mostraria "Instalação cancelada." sobre uma falha de rede (pego em teste de categorização).
- **Download parcial era reutilizado**: falha de rede no instalador/wheel deixava arquivo presente; a retentativa o executaria corrompido. Agora o passo apaga o destino (`remove`) sempre que o download falha, antes de propagar o erro.
- **Zero subestado durante a etapa mais longa** (30–90 min reais na máquina QA): o card mostra agora as palavras da própria máquina — "Baixando os arquivos…", "Preparando o ambiente de voz…", "Instalando os componentes de voz… 3/9" (contador real, 9 comandos oficiais; tokens em i18n, nenhum substanto técnico vaza).

Testes: main 15 arquivos / 297 verdes (+stalled-download cleanup ×2, +tokens de subestado, +classificação ETIMEDOUT); renderer lia-config + stores: 35 arquivos / 520 verdes (subestados no wiring real, invariant atualizado: `'downloading'` passa a ser subestado real renderizado). Commits separados (main / UI). Débito mantido: rodada de mutações.
