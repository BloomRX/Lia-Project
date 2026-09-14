# Phase 5 Round 5 — exit=2 persiste com argumentos oficiais: refutação, integridade do instalador, hipóteses restantes e protocolo

Commits desta rodada em `arena/01a09ddb-lia-project` (nesta ordem: sonda QA v2, este doc). **Sem installer PASS** — a próxima leitura no Windows decide. Nenhum código de produção foi alterado nesta rodada (diagnóstico apenas).

## 1. O que o log da Round 5 prova

A linha `miniconda-install-start` mostra que a correção da R4 chegou inteira ao processo:

```
exe=C:\...\miniconda_installer.exe  (win32)
args=/InstallationType=JustMe /AddToPath=0 /RegisterPython=0 /S /D=C:\Users\lucas\...\alltalk_environment\conda  (oficial, /D por último, sem aspas, win32)
```

E mesmo assim: `miniconda-install-finished exit=2 stdout=(empty) stderr=(empty)` + `miniconda-install-verify exit=2 conda-prefix-exists=false conda-exe-exists=false`.

Conclusão honesta: as hipóteses **(a)** (path misto no `/D`) e **(b)** (flags extras `/NoShortcuts`/`/NoRegistry`) da R4 estão **empiricamente refutadas** — com o conjunto oficial e o path win32 o sintoma é idêntico. O "Tentar novamente" continua imediato (nenhum re-download no log; `installer-bytes` inalterado), confirmando o guard da R4.

## 2. O instalador tem exatamente o tamanho oficial

O `atsetup.bat` pinado (`f16117e9`) baixa **uma versão fixa**, não "latest":

```
set MINICONDA_DOWNLOAD_URL=https://repo.anaconda.com/miniconda/Miniconda3-py311_24.4.0-0-Windows-x86_64.exe
```

Registro oficial (índice `repo.anaconda.com/miniconda/`, arquivo datado 2024-05-20):

| campo | oficial | máquina do QA (log R5) |
|---|---|---|
| tamanho | 81.7M ⇒ **85,690,400 bytes** | `installer-bytes=85690400` |
| sha256 | `fb6aaeaf92907b8e7598aac0f7b29793a00b27641dc074a961eeb86ff86d0268` | a medir pela sonda v2 |

O byte count é uma correspondência exata. Se o SHA-256 também bater (`certutil -hashfile`, a sonda imprime lado a lado), o arquivo está **íntegro** e a refutação fica completa: **não são os argumentos, não é o path win32, não é o arquivo** — o exit=2 vem do destino ou do ambiente.

## 3. Hipóteses restantes (ranqueadas)

**(h1) O caractere `@` no path de destino.** O prefixo real é `C:\Users\lucas\AppData\Roaming\@proj-airi\stage-tamagotchi\...` — o `@` vem do productName scoped do Electron e contamina **todo** o runtime tree (incluindo o cwd de `atsetup`). Evidência interna forte: o próprio `atsetup.bat` pinado mantém uma blacklist de "caracteres especiais que podem fazer a instalação falhar" via `findstr` — e `@` está **literalmente na lista** (`[!#\$%&()\*+,;<=>?@\[\]\^`{|}~]`). A documentação Anaconda também pede destino sem espaços e sem caracteres especiais/não-ASCII. Um `/D=` contendo `@` é exatamente o tipo de entrada que essa trava do AllTalk foi feita para pegar — só que o nosso layout coloca o `@` no path **por padrão**.

**(h2) Corrupção in-place do arquivo** (disco, AV reescrevendo bytes após o download). Menos provável dado o tamanho exato, mas o SHA-256 fecha a questão em segundos.

**(h3) Ambiente**: Windows Defender / Controlled Folder Access / SmartScreen / AV de terceiros bloqueando a escrita do instalador silencioso. Sintoma público equivalente existe (ex.: reticulate issue #1312 — "miniconda installation failed [exit code 2]" com download completo): a classe de causa conhecida desse sintoma é destino/permissão, não argumentos.

## 4. Protocolo de isolamento (sonda v2)

`airi\QA-Miniconda.bat` agora: imprime bytes + SHA-256 ao lado do esperado em **todo** modo, e aceita:

| modo | o que faz | como ler |
|---|---|---|
| *(sem argumento)* | facts + sha256 + install silencioso oficial no prefixo real | sha256 ≠ esperado ⇒ rodar `redownload`; sha256 = esperado e exit≠0 ⇒ rodar `cleanpath` |
| `cleanpath` | **mesmos** argumentos oficiais, mas `/D=%TEMP%\lia-qa-conda` (sem `@`, curto) | exit 0 ⇒ **h1 confirmada** (o `@` do path é a causa); exit 2 ⇒ **h3 lidera** — checar Segurança do Windows → Histórico de proteção no horário do run, Controlled Folder Access e AV de terceiros |
| `redownload` | apaga o installer, rebaixa a URL pinada exata, re-verifica bytes+sha256, roda o install padrão | isola h2 |
| `shortcuts` / `registry` | um flag constructor por vez | controles negativos da R4, mantidos |

Ordem sugerida de execução na máquina QA: **default → cleanpath** (o que já fecha h1 vs h3 na maioria dos cenários), `redownload` só se o sha256 divergir.

## 5. O que não foi decidido

Produção intacta nesta rodada. Se h1 confirmar, as opções de correção (prefixo conda fora da árvore com `@`; junction sem `@`; passar o short-name 8.3 do diretório apenas ao `/D`) têm trade-offs de produto e ficam para o spec da Round 6 — nenhuma será aplicada sem a prova. O mesmo vale para auto-reparo por hash na produção.

## 6. Contratos da próxima leitura

1. sha256 impresso pela sonda bate com `fb6aaeaf…d0268`?
2. `cleanpath`: exit code + `conda prefix exists=` + `_conda.exe exists=`.
3. Se h3 vencer: uma entrada correspondente no Histórico de proteção do Windows no horário do run.
4. Se algum modo retornar exit 0 + `_conda.exe` no prefixo real, aí sim o resume upstream (`resume-incomplete`) pode ser exercitado — até lá, **sem installer PASS**.

## 7. Verificação local

A sonda é diagnóstico manual (sem suite automatizada); nenhum arquivo node/tocado em código — a suíte permanece no estado verde da R4 (104 arquivos / 960 passed / 1 skipped, vue-tsc 0, ESLint 0). Nada foi fabricado: todas as afirmações sobre a máquina QA vêm do log colado.

## 8. SHAs

`airi\QA-Miniconda.bat` (v2) → `206ace7`; este doc → commit seguinte na mesma branch.
