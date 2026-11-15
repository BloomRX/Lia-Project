---
name: stage-runtime-debugging
description: Diagnostica o Stage da Lia no Windows quando ele nao inicia, inicia sem janela, congela ou nao encerra, separando falha de build, de runtime, de IPC, de inicializacao e de interface. Use ao investigar o fluxo Launcher para Conversar com a Lia, processos residuais, PID errado ou janela em branco.
compatibility: Exige Windows com o checkout e Node no PATH. O Stage e um processo Electron supervisionado pelo launcher.
---

# Diagnosticar o Stage

O caminho normal é: `Lia.bat` → Launcher → **Conversar com a Lia** → build do
`@proj-airi/core-agent` → spawn do Stage → janela da personagem.

## A regra que não se negocia

**Processo criado não é inicialização.** **Compilação concluída não é app
funcional.** O Stage só está funcional quando a janela aparece, responde, e o
encerramento remove os processos daquela sessão.

## 1. Preservar evidência antes de mexer

Registre, nesta ordem:

1. fase reportada (`starting`, `running`, `stopping`, `stopped`, `error`);
2. `pid` do filho e se ele ainda existe;
3. as últimas linhas do `stdout`/`stderr` do Stage — o manager mantém esse
   *tail* justamente para o painel de diagnóstico;
4. código de saída, quando houver;
5. em rodada do harness de QA: `Tests\runs\<run>\logs\lia-console.log` e
   `logs\stage-console.log`.

Sem isso, qualquer conclusão é chute.

## 2. Separar as quatro falhas

| Sintoma | Onde olhar primeiro |
| --- | --- |
| Build falha antes do spawn | `stage-build-prerequisite.ts`, pré-requisito `core-agent-build` |
| Build passa, nada é criado | `node-runtime.ts` — resolução do executável Node |
| Processo existe, janela nunca aparece | sinal de *ready* do manager, saída do `electron-vite` |
| Janela aparece, encerra sujo | caminho de parada e processos filhos |

### Build

O pré-requisito `core-agent-build` roda com timeout de `600_000` ms. Timeout
estourado **não** se corrige aumentando o timeout; investigue por que o build
não termina.

### Executável Node

Em modo dev o processo é iniciado pelo Electron, então `process.execPath` é o
binário do Electron, **não** o Node do sistema. `node-runtime.ts` classifica a
resolução em `electron-as-node`, `node-execpath` ou `node-from-path`, e consulta
o estado do fuse `runAsNode` (`disabled`, `enabled`, `unknown`).

Fato que engana: **se o fuse `runAsNode` estiver desabilitado,
`ELECTRON_RUN_AS_NODE` é ignorado.** Definir a variável e continuar usando
`process.execPath` como se fosse Node é uma aposta que já falhou neste projeto.
Confirme o tipo resolvido, não a variável de ambiente.

### Ready

`airi-stage-manager.ts` reconhece `ready in`, `Local: ... http` ou `dev server`
na saída. `'running'` significa **o filho existe e o sinal de ready foi visto** —
não significa "spawn retornou".

### Encerramento

No Windows a parada mata a árvore (`taskkill /PID /T /F`) porque matar só o pai
deixa filhos órfãos. `'stopped'` só é reportado depois de o encerramento real
ser observado — trate essa informação como confiável, e o contrário como
suspeita.

## 3. Inspecionar processos no Windows

```powershell
Get-Process -Id <pid> -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, StartTime
Get-CimInstance Win32_Process -Filter "ParentProcessId=<pid>" | Select-Object ProcessId, Name, CommandLine
```

Depois do encerramento, confirme que **não sobrou** `electron` nem `node` da
sessão. Compare com a lista de antes: residual é o que apareceu depois do
launch, não o que já existia na máquina.

**Nunca** encerre processo de outro dono para liberar arquivo. Se houver
suspeita de handle, registre processo e caminho — não mate.

## 4. Corrigir só depois de provar

Reproduza primeiro, com passos numerados e determinísticos. Depois:

- a correção precisa endereçar a causa identificada;
- escreva o teste de regressão **no harness real** do módulo, e veja-o falhar
  antes da correção;
- se o teste só passa porque o alvo da asserção está vazio, ele não prova nada.

O método completo está em `lia-regression-investigation`.

## 5. Verificar o que o usuário vê

Não encerre no processo: clique em **Conversar com a Lia** e confirme que a
janela abriu e a personagem apareceu. Depois feche e confirme a ausência de
processos residuais.

## 6. Parar

Pare e reporte se: a causa não puder ser provada; o problema só reproduz em
máquina que você não tem; a correção exigir alterar `DevKit.bat` ou `Lia.bat`
(eles são o alvo do gate); ou o diagnóstico depender de credencial que você não
tem.
