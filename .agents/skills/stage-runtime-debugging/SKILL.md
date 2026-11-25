---
name: stage-runtime-debugging
description: Diagnostica o Stage da Lia no Windows quando ele nao inicia, inicia sem janela, congela ou nao encerra, separando falha de build, de runtime, de IPC, de inicializacao e de interface. Use ao investigar o fluxo Launcher para Conversar com a Lia, processos residuais, PID errado ou janela em branco.
compatibility: Exige Windows com o checkout e Node no PATH. O Stage e um processo Electron supervisionado pelo launcher.
---

# Diagnosticar o Stage

O caminho normal é: `Lia.bat` → Launcher → **Conversar com a Lia** → processo do Stage → janela da personagem.

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

## 2. Separar resolução, início e encerramento

Confira a resolução do executável e os eventos de processo em `lia/desktop/src/main/native-stage-manager.ts`. No pacote instalado, confira `resources/stage/LiaStage.exe`. O sinal de prontidão é `[lia-stage] window-ready`. Registre separadamente falha ao localizar o executável, saída antes do sinal de prontidão, falha após a abertura da janela e processo residual depois do fechamento. Use `Tests/windows/README-completion.md` para reproduzir pelo fluxo real.

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
máquina que você não tem; ou o diagnóstico depender de credencial que você não
tem.
