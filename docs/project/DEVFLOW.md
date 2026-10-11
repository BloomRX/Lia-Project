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

**Um log nunca vira PASS visual.** O veredito é `PASS` somente se todos os marcadores
casarem **e** a pessoa responder `S`. Resposta vazia, `N` ou qualquer outra coisa ⇒
`NOT_PASS`. Interrupção (Ctrl+C) ⇒ `INTERRUPTED`, registrado — nunca um silêncio e nunca um
sucesso.

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

## Segurança

- nenhum `git clean`, `git reset --hard`, force-push ou recursão fora de allowlist;
- a rodada **não muta** o Git: só lê (`rev-parse`, `status`, `check-ignore`);
- limpeza exige, nesta ordem: estar no allowlist do perfil da rodada → caminho relativo
  simples (sem `..`, sem drive, sem UNC) → resolver para dentro do repositório → nenhum
  componente symlink/reparse → o Git confirmar que é **ignorado** (gerado). Qualquer
  falha ⇒ recusa, com o motivo;
- o relatório é amarrado ao SHA exato; se o HEAD mudar, `status` reporta `stale` e o PASS
  anterior deixa de valer.

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

## Estado

- **M3.0b existe em código** no commit `c65de97`.
- O **gate gerenciado durável no Windows continua `NOT PASS`** até o DevFlow executá-lo numa
  máquina real. Nada aqui prova runtime.
- **D1 é só ferramenta**: não avança o baseline funcional, que continua **`3ef6d11`**.

## Roteiro

- **D2** — integração Git: consolidar publish/limpeza no menu Lia, dar ao scanner universal
  um escopo explícito da subárvore do produto, e decidir o destino de `devkit.json
  ignore_dirs: ["airi"]`.
- **D3** — limpeza dos scripts históricos usando `tools/devflow/script-inventory.json`.
  **D1 não apagou nada.**
