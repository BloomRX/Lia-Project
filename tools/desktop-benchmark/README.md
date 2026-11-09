# Coletor Windows para comparação de presença desktop

Coleta CPU e memória de **PIDs explicitamente informados**, em Windows PowerShell 5.1 ou PowerShell 7. GPU é opcional e pode ficar indisponível. Não descobre árvore de processos, não inicia nem encerra aplicações e não representa sozinho o consumo total da Lia. O protocolo de comparação de engines está em [LIA-DESKTOP-ENGINE-EVALUATION.md](../../docs/architecture/LIA-DESKTOP-ENGINE-EVALUATION.md).

## Uso

Na raiz `J:\Lia-Project`, com os PIDs reais que o responsável escolheu observar:

```powershell
# Substitua 1234 e 5678 por PIDs existentes; não são valores detectados.
.\tools\desktop-benchmark\collect-windows.ps1 -ProcessId 1234,5678 -DurationSeconds 180 -IntervalSeconds 1 -ScenarioLabel idle-vrm-30

# Mesmo ensaio, solicitando contadores GPU WMI/CIM quando disponíveis.
.\tools\desktop-benchmark\collect-windows.ps1 -ProcessId 1234,5678 -DurationSeconds 180 -IntervalSeconds 1 -ScenarioLabel idle-vrm-30-gpu -IncludeGpu
```

Não alterar política de execução do sistema para usar o coletor. Rodar no PowerShell já autorizado pelo ambiente. Não é necessário instalar módulos. `Get-CimInstance` é usado somente quando GPU foi solicitada.

`ProcessId` aceita somente inteiros positivos, elimina duplicados e fixa a identidade inicial `(PID, StartTime UTC)`. PID inacessível ou ausente fica `unavailable`; o coletor não passa a monitorar outro processo que posteriormente receba o mesmo número. Um processo que morra durante a execução não é reiniciado. Alteração da identidade inicial é rejeitada.

`DurationSeconds`: 1–86400. `IntervalSeconds`: 0,1–3600, menor ou igual à duração. A primeira amostra tem CPU `unavailable/first_sample`, pois não há delta anterior. `ScenarioLabel` é um rótulo declarado pelo responsável, de 1–64 caracteres ASCII alfanuméricos, `_` ou `-`; o script não confirma que o cenário descrito esteja acontecendo.

`OutputRoot` padrão: `J:\lia-evidence`, fora do repositório. Cada execução cria uma pasta UTC+rótulo+GUID nova e usa criação exclusiva para os arquivos. Não sobrescreve pastas anteriores, não limpa evidências e rejeita saída no repositório ou através de junction/symlink existente na ancestralidade. Proteção não se destina a resistir a outro processo malicioso trocando diretórios simultaneamente.

## Arquivos e unidades

Para agregar uma coleta encerrada, execute `node
tools/desktop-benchmark/summarize.mjs <diretório-do-artefato>`. O resumo separa
o último instante observado da duração efetiva em `summary.json`. Coletas
parciais ficam sem status de conclusão. As médias excluem valores ausentes
por campo e preservam zero válido. Cada total exige observações válidas de
toda a coorte. GPU é registrada por instância e memória por PID.

Atualização beta de 08/11: `-IncludePrivateWorkingSet` consulta o contador
Windows `WorkingSetPrivate` por PID; resultado ausente tem status/motivo e não
vira zero. `threadCount` registra threads observadas. `processRoles` identifica
o tipo Chromium e pai pelo snapshot inicial; não guarda linhas de comando.
`main_or_auxiliary` é ambíguo, não confirmação de Main. Identidade/StartTime
continua sendo conferida nas amostras; contadores por PID podem ter cache.
O parâmetro é independente de `-IncludeGpu`; nenhum deles fornece FPS.

O roteiro `Tests/windows/completion-runtime.mjs --packaged --without-key
--performance --soak-seconds=3600` mede Launcher sem Stage, Stage parado
animado, após chat/presença e uma hora contínua. Esse wrapper inclui as raízes
Launcher e Stage e descendentes observados com criação compatível, mas a
coorte fica fixa. Não modifica stores para criar estados fictícios. As
[métricas da baseline](../../docs/architecture/LIA-BETA-PERFORMANCE-2026-11-08.md)
distinguem contaminação por testes, ausência de métricas e encerramento.

- `metadata.json`: versão do esquema, PowerShell/Windows, PIDs solicitados, identidades iniciais, intervalo, duração e número de processadores lógicos reportado pelo runtime. Sem `CommandLine`, argumentos do processo, ambiente, títulos de janelas ou credenciais.
- `samples.jsonl`: uma linha JSON por amostra, com tempos de início/fim, CPU e memória por PID, mais contadores GPU opcionais. É gravado e descarregado durante a execução.
- `summary.json`: estado da coleta, quantidade de amostras e duração realmente decorrida. Criado no encerramento normal ou no `finally` de falha tratável. Encerramento forçado do host pode deixar a pasta parcial sem resumo.

`cpuCores = delta(TotalProcessorTime em segundos) / delta(tempo monotônico em segundos)`. Valor 1 equivale a um processador lógico ocupado durante o intervalo. `percentOfMachine = 100 * cpuCores / logicalProcessors`. O denominador é `[Environment]::ProcessorCount`, que pode refletir limitações de afinidade/grupo/runtime; não é inventário físico completo. Os tempos usam relógio monotônico, por PID, para não atribuir o tempo de consulta de outros PIDs à janela errada. Deltas negativos ou sem tempo válido ficam indisponíveis.

`workingSetBytes` e `privateBytes` são bytes de `WorkingSet64` e `PrivateMemorySize64`; não são a mesma medida. Somar working sets pode contar memória compartilhada repetidamente. Somar apenas os PIDs selecionados não inclui filhos novos, compositor DWM, driver ou serviços externos. Nenhuma coluna se chama “consumo total do produto”.

GPU opcional usa `Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine` (`UtilizationPercentage`) e `GPUProcessMemory` (`DedicatedUsage`, `SharedUsage` em bytes), filtradas pelos PIDs e novamente conferidas no cliente. Preserva cada instância de engine/adaptador; não soma percentuais nem deduz VRAM total. Classes ausentes, falta de permissão, erro CIM ou ausência de instâncias resultam em `unavailable` com motivo, sem derrubar a coleta de CPU/memória. Quando não solicitado: `not_requested`.

A identidade dos processos é revalidada depois da consulta GPU. Porém contadores do driver codificam PID e não `StartTime`: cache de contador não pode ser atribuído com certeza à vida do processo. GPU deve ser interpretada com essa limitação e, quando necessário, validada com instrumentação externa. Não houve prova de leitura bem-sucedida desses contadores nesta máquina.

Consultas CIM usam timeout de operação de 2 s por classe, mas o tempo real do transporte pode ultrapassá-lo. Coleta é síncrona; intervalo e duração são alvos, não prazos rígidos. `startedAtSeconds`, `completedAtSeconds` e `elapsedSeconds` expõem atrasos. A consulta opcional GPU pode reduzir bastante a frequência; não interpretar isso como travamento da aplicação observada. O overhead do coletor e do host deve ser considerado no protocolo.

FPS, frame time, impacto em jogos e potência do sistema ficam **unavailable/not_measured_by_this_collector** nos metadados. Rótulo de cenário, porcentagem GPU e frequência de amostras não permitem calcular essas métricas. Exit 0 significa que o coletor concluiu e gravou os dados, não que todos os contadores existam, que a Lia tenha passado algum gate ou que uma engine seja melhor.

## Provas realizadas em 07/11/2026

Escopo das provas: o processo PowerShell que executa o próprio coletor. **Nenhuma destas execuções mede a Lia.** Arquivo final do script: SHA-256 `3282A8235143C98F86EBFE136B1CA04D12D2BC4AA58D73809BB2A455904B21C4`.

Comandos reais, executados na raiz:

```powershell
powershell.exe -NoProfile -Command '& ./tools/desktop-benchmark/collect-windows.ps1 -ProcessId $PID -DurationSeconds 5 -IntervalSeconds 1 -ScenarioLabel collector-final-ps51'
pwsh.exe -NoProfile -Command '& ./tools/desktop-benchmark/collect-windows.ps1 -ProcessId $PID -DurationSeconds 5 -IntervalSeconds 1 -ScenarioLabel collector-final-ps7'
```

| Verificação | Resultado | Exit |
| --- | --- | --- |
| PowerShell `5.1.26100.9711`, versão final, 5 s | 5 amostras, 5,0052474 s decorridos; identidade, memória e normalização CPU verificadas | 0 |
| PowerShell `7.6.9`, versão final, 5 s | 5 amostras, 5,0018438 s decorridos; mesmas verificações | 0 |
| Parser PowerShell 5.1 e 7 | `Parser.ParseFile` nos dois hosts: zero erros sintáticos | 0 em ambos |
| GPU solicitada em PS5.1, processo próprio, duração-alvo 1 s | 1 amostra, 4,467267 s reais; ambas as classes retornaram `unavailable/counter_query_failed:CimException`; resumo concluído | 0 |
| PID inexistente `2147483647`, PS7, duração 1 s, GPU solicitada | Processo indisponível, GPU `no_valid_process_identity`; sem inventar CPU/memória | 0 |
| `DurationSeconds 0`, PS5.1 | Rejeitado na validação de parâmetro | 1 esperado |
| `OutputRoot .`, PS7 | Rejeitado: diretório dentro do repositório | 1 esperado |

Evidências finais:

- `J:\lia-evidence\20261107T175147100Z-collector-final-ps51-e6a1efed06dd42d58964a741e79410a1`
- `J:\lia-evidence\20261107T175147242Z-collector-final-ps7-98944baca6f24989af666581b5e18f99`
- GPU indisponível: `J:\lia-evidence\20261107T175055633Z-collector-gpu-ps51-7826651e03e042739715c9461699f185`
- PID inexistente: `J:\lia-evidence\20261107T175055587Z-collector-missing-ps7-e864a2bf64034a5c8058489e38605b85`

A validação dos artefatos leu JSON/JSONL, conferiu contagem, PID/StartTime contra identidade inicial, bytes de memória positivos, fórmula CPU e ausência de métricas de frames inventadas; exit 0. Parser é verificação sintática, não PSScriptAnalyzer: esse módulo não foi instalado nem executado.

Para repetir o parser em cada host, usar:

```powershell
$tokens = $null
$parseErrors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile((Join-Path $pwd 'tools/desktop-benchmark/collect-windows.ps1'), [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { $parseErrors; exit 1 }
```

Para repetir os ensaios de ausência/validação:

```powershell
powershell.exe -NoProfile -Command '& ./tools/desktop-benchmark/collect-windows.ps1 -ProcessId $PID -DurationSeconds 1 -IntervalSeconds 1 -ScenarioLabel collector-gpu-ps51 -IncludeGpu'
pwsh.exe -NoProfile -Command '& ./tools/desktop-benchmark/collect-windows.ps1 -ProcessId 2147483647 -DurationSeconds 1 -IntervalSeconds 1 -ScenarioLabel collector-missing-ps7 -IncludeGpu'
powershell.exe -NoProfile -Command '& ./tools/desktop-benchmark/collect-windows.ps1 -ProcessId $PID -DurationSeconds 0 -ScenarioLabel invalid'
pwsh.exe -NoProfile -Command '& ./tools/desktop-benchmark/collect-windows.ps1 -ProcessId $PID -DurationSeconds 1 -IntervalSeconds 1 -ScenarioLabel invalid -OutputRoot .'
```

PID reciclado, acesso negado real, GPU com contadores disponíveis, grupos acima de 64 CPUs, junction, execução prolongada, processo externo e benchmarks da Lia: **NOT RUN**. A proteção correspondente foi revisada no código, sem declarar prova runtime desses cenários. Próximo passo: selecionar explicitamente os PIDs da execução autorizada e coletar cenários equivalentes do protocolo; não comparar engines com base nos números de auto-observação acima.
