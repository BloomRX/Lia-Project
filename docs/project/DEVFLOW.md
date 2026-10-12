# DevFlow — desenvolvimento da Lia por rodada

Phase **DEVFLOW-D1**. Ferramenta de desenvolvimento. **Não** altera comportamento de
produto e **não** avança o baseline funcional.

## Resumo em uma linha

Dê **dois cliques** em **`DevKit.bat`** na raiz do repositório. Não há menu, não há número,
não há confirmação: o piloto automático sincroniza, testa, lança a Lia, aciona *Conversar*
sozinho, lê a própria evidência de runtime, encerra a árvore que criou e imprime um
veredito **PASS/FAIL** com o caminho do relatório. Comandos avançados existem, mas só com
argumento explícito.

## Arquitetura

```
DevKit.bat                     bootstrap fino: copia a si mesmo para %TEMP% e delega
  ├─ sem argumentos → tools/lia_dev.py bootstrap   (sincroniza e reexecuta o auto)
  └─ com argumentos → tools/lia_dev.py <verbo>     (auto|menu|round|status|git|…)

tools/lia_dev.py               camada Lia: verbos, sem lógica de gate
  └─ tools/devflow/
       ├─ pipeline.py          o piloto automático (9 etapas) + bloco final
       ├─ sync.py              política Git de zero escolha + prova do payload stageado
       ├─ devflow-config.json  branch de trabalho e identidade FIXADA do repositório
       ├─ schema.py            contrato do manifesto v2 (estrito, falha fechado)
       ├─ safe_paths.py        ÚNICO lugar que apaga algo
       ├─ processes.py         árvore owned + teardown com evidência
       ├─ report.py            sanitização + artefatos + retenção
       ├─ runner.py            execução da rodada e gate em duas fases
       ├─ rounds/m3_0b.json    rodada ativa (contrato machine-readable)
       ├─ active-round.json    ponteiro da rodada ativa
       ├─ upgrades/            bootstrap de transição, entregue FORA do checkout
       └─ script-inventory.json inventário auditado dos .bat/.ps1 históricos
```

O gate em si **não** está no batch nem no menu: está em `tools/devflow/`, com seams
injetáveis (`run_git`, `spawn`, `ask`, `clock`), para ser testável sem Windows, sem
Electron e sem operador.

## O que o duplo clique faz, e o que exige argumento

| invocação | efeito |
| --- | --- |
| `DevKit.bat` | **AUTO** — o piloto completo, zero escolha |
| `DevKit.bat status` | rodada ativa + validade do último PASS |
| `DevKit.bat rounds` | lista as rodadas |
| `DevKit.bat diagnose` | fatos do ambiente |
| `DevKit.bat open` | abre a Lia normalmente, sem gate |
| `DevKit.bat round` | só a rodada, sem sincronizar nem publicar |
| `DevKit.bat menu` | o menu antigo, para uso avançado |
| `DevKit.bat git <sub>` | DevKit universal (`publish`, `pull`, `validate`, …) |

O `.bat` **não usa `SHIFT`**: no `cmd.exe` o `SHIFT` não reescreve `%*`, então
`DevKit.bat git publish` repassaria o token `git` junto. O token é descartado em
`lia_dev.git_forward_argv`, onde é testável e onde o quoting já foi resolvido.

## O que a rodada M3.0b faz, na ordem

1. exige a branch `arena/01a10290-lia-project` — branch diferente ⇒ **RECUSADO**, nada roda;
2. registra branch + HEAD + contagem de alterações não commitadas;
3. remove **apenas** `airi/packages/core-agent/dist` (gerado e gitignored) para reproduzir um
   pull fresco. **Nenhum build manual** — a rodada precisa provar que o Launcher reconstrói
   sozinho;
4. roda os testes obrigatórios: DevFlow, Lia App, contrato M3.0a, DevFlow do Stage;
5. lança o caminho gerenciado canônico (`Lia.bat`) com o ambiente DevFlow;
6. o próprio Launcher aciona *Conversar* (`LIA_DEVFLOW_AUTORUN=conversar`);
7. detecta, **nesta ordem**:
   1. `stage-prerequisite name=core-agent-build state=starting`
   2. `stage-prerequisite name=core-agent-build state=succeeded` + `reason=build-succeeded`
   3. `spawn: node … electron-vite.js dev`
   (opcional, não gateia: `ready in`);
8. **aguarda** a evidência terminal, que chega depois: `renderer=ready`,
   `window=visible`, `renderer-app=mounted` e `avatar-scene=mounted`;
9. encerra **somente** a árvore que iniciou e grava um relatório sanitizado.

**Ordem obrigatória:** checkout exato → limpeza → **todos** os testes obrigatórios passando
→ lançamento → cadeia ordenada → **toda** a evidência terminal → veredito. Se algo faltar,
expirar, aparecer fora de ordem ou o processo morrer antes, a árvore é encerrada e o
veredito é `FAIL`.

**Um log nunca vira PASS.** `PASS` exige a cadeia ordenada completa **e** os quatro fatos
terminais **e** nenhum marcador proibido **e** todos os testes passando. Interrupção
(Ctrl+C) ⇒ `INTERRUPTED`, registrado — nunca um silêncio e nunca um sucesso, e com a mesma
limpeza da árvore owned. A M3.0b não declara nenhuma afirmação humana: o `S/N` foi
substituído por evidência de máquina.

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

## AUTO-1a: o que uma auditoria independente encontrou, e como foi fechado

Uma auditoria do commit AUTO-1 confirmou a arquitetura e apontou defeitos que impediriam a
primeira execução real. Todos foram corrigidos aqui; nenhum foi considerado falso.

### 1. A cópia em `%TEMP%` perdia a raiz do repositório

O `DevKit.bat` se copiava para `%TEMP%` e reexecutava a cópia — mas `%~dp0` **dentro da
cópia é `%TEMP%`**, não o repositório. O resultado era determinístico: `ERRO:
tools\lia_dev.py nao encontrado ao lado do DevKit.bat`. Ou seja, o duplo clique **sempre**
falharia.

Hoje a raiz original é verificada e exportada em `LIA_DEVKIT_ROOT` **antes** da cópia, e o
corpo do script só usa essa variável — `%~dp0` não aparece mais depois de `:body`. A cópia
tem **nome único por execução** (`%RANDOM%-%RANDOM%`); colisão de nome recusa em vez de
reutilizar; falha de `copy` é **FAIL CLOSED** (nada roda a partir do original, que pode ser
sobrescrito durante a atualização); o código de saída do filho é propagado; os artefatos
temporários são removidos. Não há caminho de máquina embutido.

### 2. O gate parava de esperar a evidência terminal

`_launch_and_gate` saía do laço assim que a cadeia ordenada completava e lia
`terminal_seen` **das linhas que já tinha**. Como `renderer=ready`, `window=visible` e
`avatar-scene=mounted` chegam **depois** do `spawn: node`, uma Lia perfeitamente saudável
era encerrada antes de o renderer montar e reportada como `FAIL`.

O gate agora tem duas fases, ambas com limite de tempo em `time.monotonic()`:

- **fase A** — a cadeia ordenada de inicialização;
- **fase B** — **todos** os marcadores terminais, com orçamento próprio contado a partir do
  fim da fase A.

Ambas vigiam saída do processo e marcador proibido; marcador proibido falha na hora. Uma
linha satisfaz **no máximo um** marcador (o índice é carimbado na emissão, não no consumo),
então um padrão terminal nunca conta como ordenado nem o contrário. Depois da evidência
completa há uma janela **limitada** para capturar um marcador proibido que chegue logo em
seguida — ela nunca espera por evidência nova.

Os testes usam um spawner que emite de uma thread em background, com atrasos reais. Um
spawner que empurra tudo antes de retornar é exatamente o formato que escondia o defeito.

### 3. Identidade do repositório e prova do que é stageado

A verificação era `if 'Lia-Project' not in url`. Isso aceita qualquer host ou dono que
contenha a substring — não é verificação de identidade. Agora o repositório é **fixado**
(`BloomRX/Lia-Project` em `github.com`) e a URL é normalizada nas formas canônicas HTTPS e
SSH; qualquer outro host, dono ou repositório é recusado. Credenciais embutidas na URL são
**redigidas** antes de qualquer mensagem.

O checkpoint usava `git add -A`, que stageia o checkout inteiro em vez dos caminhos
revisados. Agora:

- o `git status` é lido com **`-z -uall`**: `-z` porque sem ele o git cita caminhos com
  espaço ou byte não-ASCII em octal (e o texto classificado não seria o caminho no disco),
  `-uall` porque um diretório não rastreado chegaria colapsado como `tools/`;
- renomeação, cópia e caminho em conflito são **recusados**, não interpretados;
- caminho absoluto, com `..`, symlink/reparse que escapa do repositório e arquivo não
  regular são recusados **antes** de stagear;
- só os caminhos aprovados são stageados, com `git add -- <paths>`;
- depois, `verify_staged_payload` prova que o índice contém **exatamente** o conjunto
  aprovado, que o modo é de arquivo regular (symlink `120000` e submódulo `160000` são
  recusados), que o blob stageado é **igual** ao working tree, e roda a verificação de
  segredo e tamanho **sobre o blob stageado**, não sobre o texto do disco.

`allow_checkpoint` fica **desligado** por padrão: para esta primeira execução no Windows o
contrato é checkout limpo. O caminho endurecido está implementado e testado, mas só roda se
for ligado explicitamente.

### 4. Fast-forward correto na publicação

`publish()` recusava sempre que `remote_head != current` — o que recusa justamente o caso
para o qual publicar existe: um commit local à frente do remote. A semântica correta é:
HEAD igual ao testado, checkout limpo, branch de trabalho, remote verificado como o
repositório esperado, `fetch` imediatamente antes do push, e **a ponta do remote precisa ser
ancestral do HEAD testado** (`git merge-base --is-ancestor`). Aí o push normal, sem
`--force`, é permitido. Divergência ⇒ recusa e revalidação. Nenhum rebase acontece depois do
gate: isso colocaria um SHA diferente sob um PASS medido contra o anterior.

Como `M3.0b.ready_for_publish=false`, o bloco final imprime
**`Push: SKIPPED BY ROUND POLICY`** — um PASS da M3.0b **não** publica código.

### 5. Limpeza de processo com evidência

`render_final_block` imprimia `Process cleanup: PASS` quando `result.stage` era não-vazio —
ou seja, qualquer string de estágio virava PASS. E `terminate()` retornava `None` engolindo
falha de `taskkill`, enquanto o runner gravava `tree_cleaned = True` incondicionalmente.

`terminate()` agora devolve um `TeardownResult` com o que foi **provado**: raiz confirmada
morta, método, detalhe e evidência de descendentes (`-1` quando a plataforma não sabe —
incerteza continua incerteza). No Windows o `taskkill` tem o retorno e o `SUCCESS:` lidos;
no POSIX a sobrevivência do grupo é sondada com `os.killpg(pgid, 0)`. O bloco final lê esse
fato e pode imprimir `PASS`, `FAIL`, `N/A` (nada foi lançado) ou `UNKNOWN`.

### 6. Resolução de executável no Windows

A sonda de PATH mínimo criava um `git.cmd` no PATH isolado. Mas `CreateProcess` só anexa
`.exe` e **não consulta `PATHEXT`**, então `subprocess(['git'], shell=False)` não acharia o
shim: a sonda mediria "o git sumiu" em vez de "nenhuma ferramenta POSIX é necessária".

Agora existe `LIA_DEVFLOW_GIT` com o caminho **absoluto** do git, e todos os pontos de
chamada o consomem (`sync._git`, `sync._git_raw`, `runner.default_git`,
`safe_paths._assert_git_ignored`, `lia_dev._git`). A sonda remove o git do PATH de verdade e
passa o caminho absoluto. Fazer isso expôs três chamadas literais que ainda existiam — é
para isso que a prova comportamental serve.

### 7. Evidência de avatar nomeada com honestidade

O renderer emitia `avatar-scene=mounted` logo depois de `createApp(App).mount('#app')`. Isso
prova que o **app raiz** montou, não que um avatar foi carregado ou desenhado. Ficou o
desenho A: o sinal raiz foi renomeado para **`renderer-app=mounted`**, e o sinal de avatar
passou a vir de quem realmente sabe — `componentStateStage === 'mounted'` em
`pages/index.vue`, escrito pelo próprio componente de cena (`WidgetStage` → `Stage.vue`).

`window=visible` também foi auditado: `show()` é um **pedido**, não um fato. O marcador agora
só é emitido se `isVisible()` confirmar; caso contrário ele simplesmente não aparece e o
gate falha por evidência ausente, em vez de confiar na chamada.

Nenhum dos dois carrega conteúdo: são metadados, sem prompt, imagem, mensagem, chave ou dado
de vault, e nada é persistido como imagem.

### 8. Caminho de atualização única, entregue FORA do checkout

Limitação real de transição: o checkout do dono do projeto ainda tem o `DevKit.bat`
**anterior** ao AUTO. Um recurso do DevKit novo não pode rodar dentro do antigo antes de ser
baixado — então **não é verdade** que dois cliques no DevKit antigo usem o código novo.

`tools/devflow/upgrades/LIA-DEVFLOW-UPGRADE.bat` é o bootstrap de transição: só precisa do
`git`, confere repositório/remote fixado/branch, recusa com checkout sujo, faz `fetch` e
avança **somente por fast-forward** até o commit revisado, e então chama o `DevKit.bat`
novo. Nada é forçado, mesclado ou descartado.

**Entrega:** o arquivo é versionado aqui para revisão, mas precisa chegar **FORA do
checkout** — anexo da conversa ou download. Colocá-lo apenas no Git não resolve o problema:
não haveria como executá-lo antes do update que ele próprio faz. Ele **não** deve ser
executado pelo dono do projeto antes da revisão independente do commit final.

## AUTO-1b: o que a segunda auditoria encontrou, e como foi fechado

Uma segunda revisão do commit AUTO-1a encontrou cinco defeitos que continuavam permitindo
um relatório mais otimista do que a evidência. Todos foram confirmados no código e fechados.

### 1. `DevKit.bat` lia `%ERRORLEVEL%` dentro de bloco parentetizado

O `cmd.exe` expande `%ERRORLEVEL%` quando **lê** o bloco `if ... ( ... )`, não quando o
executa. O `:dispatch` tinha `if "%~1"=="" ( %RUNPY% ... bootstrap & set "LIA_DEVKIT_RC=%ERRORLEVEL%" )`,
portanto gravava o código de saída de algo que rodou **antes** do Python — um bootstrap com
falha era reportado como sucesso. Hoje o fluxo é por rótulo (`goto :with_args` / `:finish`),
cada chamada ao Python é seguida, na linha seguinte e fora de qualquer bloco, por
`set "LIA_DEVKIT_RC=%ERRORLEVEL%"`, e `exit /b %LIA_DEVKIT_RC%` é o que sai do script.
O teste não pergunta "existe uma linha que captura": ele exige que **todo** caminho de
dispatch capture o código da própria chamada.

### 2. O `finally` do teardown não cobria o gate inteiro

`handle = self.spawn(...)` ficava **fora** do `try`. Qualquer coisa levantada enquanto o gate
esperava os marcadores — Ctrl+C na fase A ou B, uma exceção no casamento de marcador, um erro
de fila — vazava a árvore inteira da Lia sem registrar nada. O `try` agora começa na linha
seguinte ao `spawn()` e o `finally` cobre as duas fases, o dreno de marcadores proibidos e a
seção de relatório. Três testes levantam exceção de dentro do gate, com entrega de marcador
atrasada, e exigem `terminate_calls == 1`.

### 3. A evidência de descendentes era colhida tarde demais

O snapshot do grupo de processo era pedido **depois** de a raiz já ter sido colhida, quando o
filho do Stage já foi reparentado para o init: a resposta era sempre "nenhum descendente", o
que lia como prova de limpeza e não era. Prova observada antes da correção: um neto criado por
`fork` sobreviveu e o `TeardownResult` disse `descendants=0`, `ok=True`. Agora a identidade da
árvore é gravada **no spawn** e unida ao snapshot do teardown, a tabela de processos é lida de
`/proc` (POSIX) ou do Toolhelp32 via `ctypes` (Windows), e `TeardownResult.state` é
**tri-estado**: `PASS` exige raiz morta **e** descendentes verificados; descendentes vivos é
`FAIL`; não verificado é `UNKNOWN` e nunca é lavado em `PASS`. `snapshot_owned_tree` devolve
`None` (não verificado) e não `frozenset()` (verificado como nenhum) quando a raiz já sumiu.

### 4. Evidência de runtime e posse de processo são afirmações diferentes

`result.result = 'PASS'` nunca consultava `cleanup_state`, e o `run.json` persistia só
`verdict`. Uma rodada que provou todos os marcadores e deixou Lia + Electron rodando era
publicada como `PASS`. Hoje `RoundOutcome.overall_verdict` exige teardown `PASS`, o passo
**8b** do `pipeline` retorna `FAIL` quando `cleanup_state ∈ {FAIL, UNKNOWN}` **antes** de
qualquer publicação, e o `run.json` grava os dois: `runtime_verdict` (o que os marcadores e
testes provaram) e `overall_verdict` (o que alguém de fora pode usar). O `REPORT.txt` imprime
as duas linhas e o `Process cleanup:` aparece também no caminho de falha — antes o bloco
`FAIL` só imprimia `Stage`/`Reason` e escondia o fato da limpeza.

Uma consequência direta: `result.runtime_ok` voltou a ler `round_outcome.verdict`, não
`overall_verdict`. E o desvio de falha do pipeline testa o veredito de **runtime**: com
`is_pass` ali, uma falha de limpeza entrava no ramo que culpa o runtime e imprimia
`Stage: runtime / o gate de runtime não provou o necessário` sobre evidência que passou.

### 5. O bootstrap de transição aceitava identidade por substring

`findstr /I /C:"github.com"` e `/C:"BloomRX/Lia-Project"` são comparações por substring:
`github.com.evil.com` e `BloomRX/Lia-Project-evil` passavam. Além disso a URL do remote era
gravada num `%TEMP%\lia-upgrade-url.txt` de nome fixo, impressa com `type` na recusa (uma URL
pode carregar credencial embutida) e o `del` só existia no caminho de sucesso.

Hoje a identidade é **igualdade exata** contra seis formas canônicas completas
(`https://`, `ssh://git@`, `git@github.com:`, com e sem `.git`), a URL é capturada em
variável e **nunca** é impressa, gravada ou ecoada, nenhum arquivo temporário é criado (o
`status --porcelain -uall` é lido por `for /f`, sem arquivo), o placeholder
`PLACEHOLDER-REVIEWED-SHA` é recusado, e o SHA **resultante** é relido com `rev-parse HEAD` e
comparado — `merge --ff-only` sair com 0 não prova onde o checkout parou, e é desse checkout
que o DevKit novo vai carregar código.

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
`launch` (com `env` e `auto_action`), `runtime_assertions` (ordenados, **terminais**,
proibidos, opcionais), `scenario`, `manual_assertions` e `retention`. O schema exige
evidência **terminal ou humana** — nunca a ausência das duas, e nunca as duas obrigatórias
ao mesmo tempo.

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
- **AUTO-1b** fecha os cinco defeitos da segunda auditoria: o `%ERRORLEVEL%` expandido no
  parse do `:dispatch`, o `finally` que não cobria o gate, o snapshot de descendentes colhido
  depois de a raiz morrer, o PASS que ignorava `cleanup_state`, e a identidade por substring
  do bootstrap de transição. Nenhum arquivo de produto mudou.
- **AUTO-1a** corrige os defeitos auditados do AUTO-1 antes da primeira execução real:
  a raiz perdida na cópia em `%TEMP%`, o gate que parava de esperar a evidência terminal, a
  identidade de repositório por substring, o `git add -A`, a semântica de fast-forward, o
  PASS de limpeza fabricado, o shim `git.cmd` inalcançável e o nome desonesto do marcador de
  avatar.
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
