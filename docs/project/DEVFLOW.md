# DevFlow — desenvolvimento da Lia por rodada

Phase **DEVFLOW-D1**. Ferramenta de desenvolvimento. **Não** altera comportamento de
produto e **não** avança o baseline funcional.

## Resumo em uma linha

Dê dois cliques em **`DevKit.bat`** na raiz do repositório e escolha
**`1) Executar rodada atual`**. Você não precisa lembrar comandos Git, pré-requisitos de
build, comandos de teste nem o gate manual da rodada: tudo vem de um manifesto
machine-readable.

## Arquitetura

```
DevKit.bat                     fino: descobre o Python e delega (sem lógica em batch)
  ├─ sem argumentos → tools/lia_dev.py menu        (Lia, por rodada)
  └─ com argumentos → tools/project_cli.py         (DevKit universal / Git)

tools/lia_dev.py               camada Lia: menu + subcomandos, sem lógica de gate
  └─ tools/devflow/
       ├─ schema.py            contrato do manifesto (estrito, falha fechado)
       ├─ safe_paths.py        ÚNICO lugar que apaga algo
       ├─ markers.py           gate de marcadores ORDENADOS
       ├─ report.py            sanitização + artefatos + retenção
       ├─ runner.py            execução da rodada
       ├─ rounds/m3_0b.json    rodada ativa (contrato machine-readable)
       ├─ active-round.json    ponteiro da rodada ativa
       └─ script-inventory.json inventário auditado dos .bat/.ps1 históricos
```

O gate em si **não** está no batch nem no menu: está em `tools/devflow/`, com seams
injetáveis (`run_git`, `spawn`, `ask`, `clock`), para ser testável sem Windows, sem
Electron e sem operador.

## Menu do `DevKit.bat`

```
DevKit Lia - desenvolvimento por rodada
  rodada ativa: M3.0b - Pre-requisito de build gerenciado do Stage (core-agent/dist)
  1) Executar rodada atual
  2) Abrir Lia normalmente
  3) Mostrar rodada / estado atual
  4) Diagnóstico do ambiente
  5) Listar rodadas
  6) DevKit universal (Git)  [futuro/D2: consolidação de publish]
  0) Sair
```

Equivalente em terminal: `python tools/lia_dev.py round|status|open|diagnose|rounds|menu`.

## O que a rodada M3.0b faz, na ordem

1. exige a branch `arena/01a10290-lia-project` — branch diferente ⇒ **RECUSADO**, nada roda;
2. registra branch + HEAD + contagem de alterações não commitadas;
3. remove **apenas** `airi/packages/core-agent/dist` (gerado e gitignored) para reproduzir um
   pull fresco. **Nenhum build manual** — a rodada precisa provar que o Launcher reconstrói
   sozinho;
4. roda os testes direcionados: DevFlow, Lia App, contrato M3.0a;
5. lança o caminho gerenciado canônico (`Lia.bat`) com console capturado;
6. **você** clica em *Conversar com Lia*;
7. detecta, **nesta ordem**:
   1. `stage-prerequisite name=core-agent-build state=starting`
   2. `stage-prerequisite name=core-agent-build state=succeeded` + `reason=build-succeeded`
   3. `spawn: node … electron-vite.js dev`
   (opcional, não gateia: `ready in`);
8. pergunta **uma única** coisa que log não prova:
   `A personagem apareceu normalmente? [S|N]`
9. grava um relatório compacto e sanitizado.

**Ordem obrigatória (D1.1):** checkout limpo → limpeza → **todos** os testes obrigatórios
passando → lançamento → **todos** os marcadores na ordem → só então a pergunta visual. Se os
marcadores falharem, faltarem, expirarem ou o processo morrer antes, a pergunta **não é
feita**, a árvore é encerrada e o veredito é `FAIL`.

**Um log nunca vira PASS visual.** O veredito é `PASS` somente se todos os marcadores
casarem **e** a pessoa responder `S`. Resposta vazia, `N` ou qualquer outra coisa ⇒
`NOT_PASS`. Interrupção (Ctrl+C) ⇒ `INTERRUPTED`, registrado — nunca um silêncio e nunca um
sucesso, e com a mesma limpeza da árvore owned.

**Teste pulado nunca é sucesso (D1.1).** Todo teste declarado em `round.tests` é
**obrigatório**. Teste com falha ⇒ rodada `FAIL` e **sem lançamento**. Teste indisponível
(dependências não instaladas, diretório ausente) ⇒ rodada `REFUSED` e **sem lançamento**.
Não existe teste opcional inferido: se um dia houver, precisa ser explícito no schema.

**Checkout limpo é pré-condição (D1.1).** Antes de qualquer limpeza, teste ou lançamento:
branch esperada **e** `git status --porcelain` vazio. Arquivos gerados e ignorados
(`Tests/runs/`, `core-agent/dist`) não bloqueiam — o porcelain já os exclui. Havendo
alterações não ignoradas, a rodada é `REFUSED`, nada é apagado, nada roda e nada é lançado;
só a **contagem** é impressa, nunca os nomes. A D1.1 **não** commita nem descarta nada.

## Artefatos

```
Tests/runs/devflow/<timestamp>-<round>/
  REPORT.txt              relatório legível
  run.json                fatos estruturados (branch, SHA, limpeza, testes, marcadores,
                          afirmações humanas, notas)
  console.sanitized.log   só linhas de diagnóstico do launcher, redigidas
```

`Tests/runs/` já é gitignored na raiz. Retenção: as **20** execuções mais recentes e nada
com mais de **30** dias (`retention` no manifesto). Nenhum segredo, chave, conteúdo de
vault, imagem, prompt ou conversa é gravado: toda linha passa pelo redator universal de
`tools/project_cli.py`, o diretório home vira `<HOME>`, e linhas que não têm forma de
diagnóstico do launcher são **descartadas** (a quantidade descartada é reportada).

## AUTO: o piloto automático de um clique

O contrato humano é **um só**: duplo clique em `DevKit.bat`. Sem menu, sem número, sem
submenu Git, sem pull manual, sem build manual, sem clique em "Conversar com Lia", sem
resposta S/N. No caminho saudável a contagem de interações é **zero**.

```
DevKit.bat  ->  copia a si mesmo para %TEMP% e reexecuta a cópia
            ->  tools/lia_dev.py bootstrap
            ->  sincroniza o branch de trabalho
            ->  processo NOVO: tools/lia_dev.py auto --post-sync
            ->  bootstrap | sync | classificação | checkpoint | prepare
                | tests | runtime | teardown | publish
            ->  bloco final PASS/FAIL
```

Comandos avançados continuam existindo **só com argumento explícito**:
`DevKit.bat menu|round|status|open|diagnose|rounds` e `DevKit.bat git <subcomando>`.

### Por que o .bat se copia

O `cmd.exe` lê o `.bat` incrementalmente, por deslocamento de byte. Se o checkout for
atualizado por cima dele no meio da execução, o script em andamento se corrompe. A cópia em
`%TEMP%` elimina isso: o original pode ser sobrescrito à vontade.

### Por que um processo novo depois do sync

O bootstrap importa apenas o módulo de sincronização. A rodada em si roda num **processo
novo**, lançado depois do sync — é isso que garante que o código que avalia o gate é o
recém-atualizado, e não uma mistura de módulos antigos já importados com novos. O manifesto
da rodada também é lido **depois** do sync, pelo mesmo motivo.

### Política Git de zero escolha

O branch de trabalho é **configurado** em `tools/devflow/devflow-config.json`, nunca
adivinhado. Regras duras: nunca atualiza nem publica o `main`; nunca `--force`; nunca
`reset --hard`, `clean` ou `stash`; nenhum conflito resolvido automaticamente.

Antes do sync, com o checkout limpo: `fetch` + `rebase` sem perguntar nada. Com alterações
locais, elas são **classificadas**:

- segredo (`.env`, credencial, token, vault, `lia-product.json`) ⇒ **bloqueia**;
- caminho fora das raízes de código do projeto (classificação desconhecida) ⇒ **bloqueia**;
- peso de modelo ou binário opaco (`.safetensors`, `.onnx`, `.bin`, `.exe`, …) ⇒ **bloqueia**;
- arquivo acima de 5 MB ⇒ **bloqueia**;
- tudo o resto é código-fonte do projeto ⇒ passa pelo verificador de segredos **universal**
  e vira um **checkpoint local** com mensagem determinística.

Ambíguo ⇒ **FAIL CLOSED**: nada é descartado, nada é escondido em stash, o motivo é impresso.

Depois do gate: só o **HEAD exato testado** e com checkout limpo pode ser publicado. Se o
HEAD mudou, ou o remote avançou entre o gate e a publicação, a publicação é recusada e a
rodada pede revalidação. Gate reprovado **nunca** publica um checkpoint local "para salvar o
progresso".

### O clique em "Conversar" virou automático

`LIA_DEVFLOW_AUTORUN=conversar` faz o Launcher chamar **exatamente** `host.conversar()` — a
mesma função que o botão alcança pelo handler IPC `lia:stage:start`. Não há caminho
alternativo de Stage: a rodada continua validando
`Lia.bat → Launcher → AiriStageManager → Stage`, que é justamente o que a M3.0b existe para
provar. Fora desse valor exato de flag, o Launcher não inicia nada sozinho e o clique
explícito continua obrigatório.

### O S/N virou evidência de máquina

A M3.0b nasceu porque o Stage já teve ícone na barra **sem superfície visível**: um
`core-agent/dist` obsoleto fazia o renderer falhar ao instanciar seus módulos. "ready in
512 ms" não prova nada disso. Por isso o gate exige, além da cadeia ordenada, três fatos
terminais vindos de quem realmente os conhece:

| marcador | quem emite | o que prova |
| --- | --- | --- |
| `lia-stage renderer=ready` | main do Stage, `did-finish-load` | o documento do renderer carregou |
| `lia-stage window=visible` | main do Stage, depois de `show()` | a `BrowserWindow` chegou ao estado visível |
| `lia-stage avatar-scene=mounted` | renderer → IPC → main | o Vue montou, ou seja, os módulos instanciaram |

Faltar qualquer um ⇒ **FAIL**. Marcador proibido (`state=failed`, `autorun=failed`) ⇒
**FAIL**. Tudo isso é inerte sem `LIA_DEVFLOW_DIAGNOSTICS=1`, que só o DevFlow define; num
launch normal nenhum listener é registrado e nada é logado. São apenas metadados: nenhum
prompt, imagem, mensagem, chave ou dado de vault.

O schema passou para **v2**: `diagnostics` virou `runtime_assertions`
(`ordered_markers` / `terminal_markers` / `forbidden_markers` / `optional_markers`),
`launch` ganhou `env` e `auto_action`, e existe um `scenario { driver, steps }` genérico para
que rodadas futuras (gate de imagem multimodal, contexto de imagens históricas, roteamento
só-texto, orçamento de provedor, chamadas de ferramenta) sejam dirigíveis sem ninguém digitar
prompt. **Nenhuma dessas rodadas foi implementada** — só a arquitetura.

Invariantes que o schema impõe: uma rodada precisa de `terminal_markers` **ou** de ao menos
uma afirmação humana, **nunca de nenhum dos dois**; `launch.env` não pode definir variáveis
críticas de processo (`PATH`, `COMSPEC`, `SYSTEMROOT`, …); `auto_action` e `scenario.driver`
não implementados são erro, não no-op silencioso.

## Segurança

- nenhum `git clean`, `git reset --hard`, force-push ou recursão fora de allowlist;
- a rodada **não muta** o Git: só lê (`rev-parse`, `status`, `check-ignore`);
- limpeza exige, nesta ordem: estar no allowlist do perfil da rodada → caminho relativo
  simples (sem `..`, sem drive, sem UNC) → **nenhum componente é redireção de filesystem**
  (symlink POSIX, symlink Windows, junction ou qualquer reparse point) — inspecionado
  **lexicamente, componente a componente, antes de resolver**, porque resolver primeiro
  apagaria a evidência → resolver para dentro do repositório → o Git confirmar que é
  **ignorado** (gerado). Qualquer falha ⇒ recusa, com o motivo. Erro de inspeção ⇒ recusa;
- `tools/devflow/filesystem.py` é a **única** autoridade de redireção/remoção: a limpeza da
  rodada e a retenção usam o mesmo helper. Não há segunda lógica mais fraca;
- a retenção recebe a raiz permitida do **argumento `repo`**, nunca da localização do
  próprio arquivo — por isso funciona igual em worktrees, repositórios temporários e CI;
- o relatório é amarrado ao SHA exato **e** a `dirty=0`; se o HEAD mudar, `status` reporta
  `stale`. Um checkout sujo nunca é chamado de "validado atual".

### Processo owned e teardown (D1.1)

A cadeia real é `DevFlow → cmd.exe → Lia.bat → pnpm dev:lia → Launcher → Stage`. Encerrar só
o processo que o Python criou deixaria órfãos. Por isso a rodada dona do lançamento cria o
filho em **grupo de processo próprio** e o teardown é sempre enraizado no **PID que esta
rodada criou**:

- Windows: `taskkill /PID <raiz> /T /F`, com `CREATE_NEW_PROCESS_GROUP`;
- POSIX: `start_new_session=True` + `os.killpg` (SIGTERM e, se preciso, SIGKILL).

Nunca há kill global por nome de imagem: nada que o DevFlow não iniciou é sinalizado. O
teardown roda no `finally`, então acontece após PASS, após falha de marcador, após `N` e
após Ctrl+C.

### Falha de teste é autodiagnosticável (D1.2)

Um `FALHOU (exit 1)` sozinho inutiliza o DevKit. Por isso, quando um teste obrigatório
falha, o console imprime automaticamente um resumo curto:

```
teste devflow: FALHOU (exit 1)
  detalhe: FAIL: test_algo (__main__.Suite.test_algo)
  detalhe: AssertionError: 1 != 2
  detalhe: Ran 86 tests in 7.0s
  detalhe: FAILED (failures=1)
```

Existe **um único** sanitizador de saída de teste, `report.sanitize_test_output`, e ele é
aplicado **na fronteira de persistência**, dentro de `_run_tests`, ao montar
`TestResult.detail` — não apenas dentro do invocador padrão. Nenhum invocador plugável e
nenhum caminho futuro consegue colocar saída crua de subprocesso num artefato. O mesmo
resultado alimenta as quatro superfícies: resumo no console, `TestResult.detail`,
`REPORT.txt` e `run.json`. Não há segundo sanitizador mais fraco.

Contrato dele:

- **bounded** — no máximo 14 linhas e 1200 caracteres;
- reutiliza o **redator universal** do DevKit (`project_cli.redact`) e o colapso de home
  (`<HOME>`) que o DevFlow já usava no console;
- preserva o fluxo útil: unittest/vitest escrevem a falha em **stderr**, então stderr vence
  quando tem conteúdo; stdout é o fallback, nunca os dois concatenados;
- remove sequências ANSI;
- **descarta** linhas com formato de conversa (`user:`, `system:`, `assistant:`,
  `prompt:`, `messages:`) — não têm valor de diagnóstico e podem carregar conteúdo;
- mantém o suficiente para identificar **qual teste** falhou e **qual exceção** estourou.

Em `REPORT.txt`, testes com falha (ou pulados) exibem o detalhe; testes que passaram ficam
concisos. Isso permite mandar só o `REPORT.txt` para análise.

### Auto-teste portável (D1.2)

A suíte do DevFlow **não pode** depender de executáveis POSIX. A primeira rodada real no
Windows morreu com um `exit 1` opaco porque um teste cross-platform spawnava `sleep`, que
não existe no Windows. Hoje:

- pai, neto e espectador são todos `sys.executable` dormindo com `time.sleep` — nenhum
  `sleep`/`sh`/`kill`, nenhum PowerShell, nenhum WMIC;
- o teste de árvore usa as **mesmas** flags de plataforma do DevFlow, então exercita o
  caminho de produção real nos dois sistemas;
- há uma prova **comportamental**: a suíte inteira é re-executada num subprocesso com um
  `PATH` contendo **só o git**; e um contrato por AST como defesa em profundidade.

### Invocação de batch (auditada)

`processes.launch_argv` é o **único** seam de plataforma. No Windows, um `.bat`/`.cmd` é
executado pelo interpretador indicado pela variável documentada `%COMSPEC%` (fallback
`cmd.exe`) com `/d /s /c` — `/d` ignora AutoRun, `/s /c` preserva as regras de quoting do
cmd. Fora isso o argv passa intacto. O argv é sempre uma lista fixa e confiável construída
nesse seam: **não** há `shell=True` e nenhuma string do usuário é interpolada. stdout e
stderr são unidos num único pipe, e o diretório de trabalho é a raiz passada pelo chamador.

## Fronteira Git (por que `devkit.json` ignora `airi`)

`devkit.json` tem `"ignore_dirs": ["airi"]`. Isso alimenta `ignored_path()` em
`project_cli.py`, usado pelo `project_files()` da varredura de segredos do DevKit
**universal**: `airi/` é o monorepo AIRI com dezenas de milhares de arquivos, então a
varredura o pula por custo.

**Consequência importante:** o scanner universal **não** enxerga a subárvore do produto.
Por isso o DevFlow **não** herda essa regra — ele resolve caminhos por conta própria, com
seu próprio allowlist. **D1 não removeu o `ignore_dirs`**: a decisão certa é do D2, que
deve dar ao scanner universal um escopo explícito do produto (por exemplo, uma varredura
direcionada a `airi/apps/lia-app` e `airi/packages/lia-core`) em vez de simplesmente
desligar a exclusão e explodir o custo.

## Como adicionar uma rodada nova

1. crie `tools/devflow/rounds/<id>.json` seguindo `schema.py` (schema estrito: chave
   desconhecida é erro);
2. aponte `tools/devflow/active-round.json` para o novo `round_id`;
3. rode `python tools/test_lia_dev.py`.

O manifesto precisa declarar: `round` (id, título, fase, `ready_for_publish`, `tested_sha`),
`git.expected_branch`, `prepare`, `cleanup_profile.allowlisted_generated`, `tests`,
`launch`, `diagnostics.ordered_markers`, `manual_assertions` (**obrigatório** — uma rodada
sem afirmação humana é recusada pelo schema) e `retention`.

**Nunca** dirija execução a partir da prosa de `CURRENT-STATE.md`. A documentação pode
espelhar o manifesto; o contrato é o JSON.

## `tested_sha` e a autoridade de evidência

A autoridade de evidência de runtime é o **`run.json`** de cada execução: é ele que registra
o SHA exato do HEAD, `dirty=0`, o resultado de cada teste obrigatório, os marcadores
ordenados e a afirmação humana. Um `PASS` só existe com tudo isso presente — o runner
rebaixa para `NOT_PASS` se faltar evidência.

O `tested_sha` do **manifesto versionado** pode permanecer `null` até uma atualização de
docs/estado revisada por gente. **O runtime nunca escreve `tested_sha` no manifesto**: fazer
isso sujaria o repositório no meio da rodada e quebraria a própria pré-condição de checkout
limpo. Não há contradição: `run.json` prova o que foi testado; o manifesto declara o que foi
**revisado e aceito**.

`status` reporta: último SHA com PASS, HEAD atual, e `current` / `stale` / `dirty` /
`unknown`. Um checkout com alterações não commitadas **nunca** é chamado de "validado atual".

## Estado

- **O entrypoint humano é `DevKit.bat` e duplo clique significa AUTO.** `Lia.bat` passou a
  entrypoint interno/de runtime (o DevFlow o invoca por manifesto); os demais BAT/PS1
  históricos permanecem internos até o D3, que fará as fusões/remoções.
- **D1 existiu** no commit `32025ab`; **D1.1** no `12ab92e`; **D1.2** no `e204ecb`. A primeira rodada real no
  Windows alcançou o HEAD exato e limpo, removeu `core-agent/dist` com segurança e o
  fail-closed funcionou (o teste automatizado com `exit 1` impediu o lançamento da Lia);
  **D1.2** torna o auto-teste portável e a falha autodiagnosticável.
- Uma **auditoria independente** encontrou defeitos de correção/segurança limitados, antes
  da primeira rodada real no Windows. **D1.1 os fecha**: falso PASS por teste pulado, falso
  PASS com checkout sujo, afirmação visual pedida antes do gate automático, proteção de
  reparse/junction superestimada, teardown que não alcançava a árvore, e retenção acoplada
  ao checkout de origem.
- **M3.0b existe em código** desde `c65de97`.
- O **gate gerenciado durável no Windows continua `NOT PASS`** até o DevFlow executá-lo numa
  máquina real. Nada aqui prova runtime.
- **D1/D1.1 são só ferramenta**: não alteram código de produto, não tocam
  Brain/provider/voz/vision, e **não avançam o baseline funcional, que continua `3ef6d11`**.

## Roteiro

- **D2** — integração Git: consolidar publish/limpeza no menu Lia, dar ao scanner universal
  um escopo explícito da subárvore do produto, e decidir o destino de `devkit.json
  ignore_dirs: ["airi"]`.
- **D3** — limpeza dos scripts históricos usando `tools/devflow/script-inventory.json`.
  **D1 não apagou nada.**
