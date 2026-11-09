# Baseline exploratório de desempenho — 08/11/2026

**INCOMPLETO — medição do pacote atual pendente do agente principal.** Este documento descreve somente o ASAR anterior às alterações da rodada, identificado pelo commit `dcd0b058483912b2047a82973e39edb1d076a344`. Não aprova beta, baixo consumo, fluidez ou uma engine.

## Origem e método

Fonte: `J:/lia-evidence/completion-resume-runtime-1794177433385/report.json`, entradas de `performance` e seus `metadata.json`, `samples.jsonl` e `summary.json`. Valores e apontadores completos, sem logs, perfis, credenciais, variáveis de ambiente ou linhas de comando: [evidência estruturada](../product/evidence/2026-11-08-beta-performance-baseline.json).

Coleta longa de **19:38:13 a 20:38:13 BRT** (**22:38:13 a 23:38:13 UTC**), 3600,01 segundos, 720 amostras e intervalo nominal de 5 segundos. Windows, pacote privado, HTTP sintético, CDP e múltiplas janelas. Coorte fixa com 17 PIDs de Launcher, Stage e auxiliares. Não é RAM exclusiva da Lia.

As raízes reportadas são `17112` e `17824`. `17112` é `cmd`, wrapper de execução do contexto Playwright; o processo `Lia` 14404 aparece como seu filho e pai de componentes Launcher e Stage. Essa identificação do provável Main vem da árvore de pais, não de inspeção inequívoca de sua linha de comando. O papel bruto `main_or_auxiliary` permanece ambíguo; a tabela não o converte em Main confirmado.

Memória em **MiB**. Células indicam **média/pico** de amostras válidas, com média aritmética; ausências não viram zero. CPU em **percentual da máquina com 12 processadores lógicos**, não percentual de um núcleo. Picos de métricas distintas não são necessariamente simultâneos.

## Cenários

| Cenário | PIDs/amostras | WS | PWS | Private bytes | CPU máquina % | Threads |
|---|---:|---:|---:|---:|---:|---:|
| beta-launcher-stage-closed | 5/3 | 381,73/391,25 | 132,78/134,20 | 283,40/285,11 | 0,00/0,00 | 126,67/127,00 |
| beta-stage-stationary-animated | 15/3 | 1870,20/1872,73 | 1025,43/1028,92 | 2119,23/2124,39 | 9,94/10,11 | 338,67/340,00 |
| beta-text-after-presence-and-chat | 17/3 | 2388,43/2438,46 | 1339,44/1390,21 | 2529,49/2708,25 | 9,78/11,42 | 389,00/390,00 |
| beta-continuous-ui-local-fixture | 17/720 | 2243,39/2368,88 | 1068,01/1324,69 | 2485,18/2528,01 | 7,55/14,92 | 342,75/385,00 |

Os três cenários curtos têm apenas três amostras de memória e duas de CPU: a primeira estabelece o delta de CPU. Mudam a coorte e o estado das janelas; não são comparações controladas.

## Processos da coleta longa

Nomes e papéis são os registrados pelo coletor. `auxiliar/principal possível` abaixo corresponde literalmente a `main_or_auxiliary`.

| PID | Nome / papel | WS | PWS | Private bytes | CPU máquina % | Threads |
|---|---|---:|---:|---:|---:|---:|
| 2564 | Lia / utility | 44,80/45,25 | 4,08/7,03 | 11,57/11,78 | 0,00/0,03 | 17,25/23,00 |
| 9932 | LiaStage / renderer | 129,16/130,90 | 58,57/64,83 | 77,67/77,73 | 0,00/0,00 | 22,07/24,00 |
| 12916 | conhost / auxiliar/principal possível | 7,56/7,67 | 0,58/0,83 | 1,18/1,22 | 0,00/0,00 | 2,05/3,00 |
| 14404 | Lia / auxiliar/principal possível | 105,21/108,62 | 24,53/32,48 | 73,74/73,84 | 0,00/0,05 | 43,53/47,00 |
| 14412 | LiaStage / renderer | 414,58/446,49 | 281,01/338,62 | 362,13/389,23 | 2,47/5,32 | 27,07/29,00 |
| 14608 | LiaStage / utility | 81,60/82,19 | 5,76/6,02 | 10,47/10,60 | 0,02/0,16 | 9,12/11,00 |
| 15888 | Lia / renderer | 98,30/110,68 | 24,84/35,29 | 44,99/47,55 | 0,00/0,03 | 22,07/24,00 |
| 16612 | LiaStage / utility | 53,57/54,02 | 4,59/7,65 | 12,13/12,44 | 0,00/0,03 | 18,35/25,00 |
| 17112 | cmd / auxiliar/principal possível | 7,44/7,74 | 1,74/2,11 | 3,52/4,47 | 0,00/0,00 | 1,05/2,00 |
| 17356 | LiaStage / renderer | 237,88/270,05 | 110,42/171,10 | 172,75/200,86 | 0,00/0,29 | 22,08/25,00 |
| 17824 | LiaStage / auxiliar/principal possível | 272,96/278,29 | 183,06/192,57 | 233,18/237,19 | 0,26/0,77 | 43,64/50,00 |
| 19396 | python / auxiliar/principal possível | 4,71/4,74 | 0,37/0,45 | 0,74/0,77 | 0,00/0,00 | 1,05/2,00 |
| 19888 | Lia / gpu-process | 141,13/145,69 | 58,08/82,56 | 220,36/221,76 | 0,00/0,03 | 30,04/31,00 |
| 20060 | LiaStage / renderer | 229,15/264,88 | 106,38/169,09 | 166,03/199,45 | 0,22/1,13 | 22,08/25,00 |
| 20176 | LiaStage / utility | 97,64/99,06 | 5,52/9,38 | 17,16/17,36 | 0,00/0,03 | 14,17/19,00 |
| 20244 | LiaStage / gpu-process | 144,19/151,03 | 49,43/60,50 | 548,75/578,04 | 4,59/8,88 | 30,00/31,00 |
| 21420 | python / auxiliar/principal possível | 173,50/174,96 | 149,04/151,73 | 528,81/528,98 | 0,00/0,00 | 17,14/22,00 |

## Primeiros e últimos cinco minutos

Cada janela contém 60 amostras. A variação compara médias das janelas, não somente dois pontos.

| Métrica | Primeiros 5 min | Últimos 5 min | Últimos − primeiros |
|---|---:|---:|---:|
| workingSetMiB | 2262,40 | 2240,93 | -21,47 |
| privateWorkingSetMiB | 1217,65 | 1028,82 | -188,83 |
| privateBytesMiB | 2345,09 | 2521,00 | 175,91 |
| cpuPercentOfMachine | 9,86 | 6,73 | -3,13 |
| threadCount | 352,42 | 340,72 | -11,70 |

| PID | Δ WS MiB | Δ PWS MiB | Δ private bytes MiB |
|---|---:|---:|---:|
| 2564 | -0,33 | -3,52 | 0,05 |
| 9932 | -2,04 | -7,88 | 0,00 |
| 12916 | -0,04 | -0,29 | -0,01 |
| 14404 | -3,86 | -8,27 | -0,01 |
| 14412 | 10,16 | -22,94 | 17,79 |
| 14608 | -0,63 | -0,24 | -0,02 |
| 15888 | -4,82 | -9,83 | -0,24 |
| 16612 | -0,28 | -3,64 | -0,06 |
| 17112 | -0,27 | -0,45 | -0,20 |
| 17356 | -5,47 | -41,62 | 0,44 |
| 17824 | 2,21 | -2,49 | 4,74 |
| 19396 | 0,05 | -0,08 | 0,00 |
| 19888 | -5,13 | -30,05 | -0,70 |
| 20060 | -1,24 | -36,91 | 2,34 |
| 20176 | -1,44 | -4,77 | -0,04 |
| 20244 | -6,62 | -12,55 | 151,86 |
| 21420 | -1,72 | -3,31 | -0,03 |

O aumento de private bytes concentra-se no GPU-process Stage 20244 (+151,86 MiB); o renderer 14412 soma +17,79 MiB e o processo 17824 soma +4,74 MiB. O working set da coorte cai 21,47 MiB e o PWS cai 188,83 MiB. Essas medidas indicam onde investigar; **não demonstram vazamento**.

## GPU

Há contadores GPU reais, mas nenhum FPS ou frame time. O único contador com atividade positiva foi o PID **20244**, adaptador LUID `0x00000000_0x0000D987`, físico 0, **engine 0 / 3D**: média **37,69%**, pico **46,00%**, em 717 amostras válidas. Todas as outras instâncias reportadas ficaram em zero. Percentuais não foram somados entre engines nem tratados como percentual geral da GPU.

| PID | Dedicada média/pico MiB | Compartilhada média/pico MiB | Dedicada primeiros→últimos 5 min MiB |
|---|---:|---:|---:|
| 20176 | 4,18/4,18 | 0,02/0,02 | 4,18→4,18 |
| 20244 | 487,48/516,82 | 1,76/11,63 | 364,32→516,82 |
| 19888 | 130,14/130,18 | 1,38/30,82 | 130,16→130,14 |

## Disponibilidade e contaminação

**Nenhum PID indisponível** em 12.240 observações. PWS: 717/720 amostras válidas por PID; três consultas falharam para toda a coorte (`counter_query_failed:CimException`): **19:51:53, 20:07:59 e 20:24:05 BRT**. A média total válida é **1068,01 MiB**, não 1063,56 MiB, valor que resultaria de tratar ausências como zero. GPU engine: 717/720; memória GPU: 720/720.

**Os primeiros aproximadamente 20 minutos estão contaminados por testes, typechecks e harness concorrentes.** Os processos de teste não pertencem à coorte fixa, mas competem por CPU e recursos da máquina. Logs locais comprovam sobreposição:

| Arquivo em `J:/lia-evidence/` | Início BRT | Duração |
|---|---|---:|
| beta-stage-full-node.log | 19:45:57 | 408,81 s |
| beta-core-full.log | 19:46:07 | 18,73 s |
| beta-stage-timeouts-isolated.log | 19:57:45 | 12,84 s |
| beta-core-full-sequential.log | 19:57:55 | 11,86 s |

Após os primeiros 20 minutos, a CPU da coorte apresenta média **6,78%** e pico **9,22%** em 480 amostras. Essa separação temporal não cria um experimento isolado e não prova que toda diferença vem dos testes.

## Limites e estado de conclusão

- WS somado inclui páginas compartilhadas; não corresponde a RAM física exclusiva. Private bytes representa compromisso privado, não residência. PWS não substitui análise de alocação.
- Coorte fixa não acompanha processos criados posteriormente. Contadores GPU codificam PID, com rechecagem de identidade, mas cache do driver pode ficar atrasado; PWS também tem limite de cache/identidade documentado pelo coletor.
- HTTP sintético, pacote privado, contexto CDP e múltiplas janelas limitam generalização para uso normal, serviço externo e instalação limpa.
- FPS, frame time, energia e impacto em jogos estão **indisponíveis/não medidos**. Nenhum benchmark comparativo ou vencedor de engine foi produzido.
- `summary.json` da coleta longa registra `completed` e 3600,01 s. Separadamente, `report.json.stopped` registra Stage PID 17824 com `lastExitCode: 1`; sucesso do coletor não aprova encerramento Stage limpo.
- Nenhuma conclusão causal sobre o consumo total ou o RAF de sombra pode ser obtida deste baseline.

**Assinatura de estado:** análise documental do baseline anterior concluída; **medição do pacote atual pendente do agente principal**. Nenhum app, build, teste novo ou comparação de engines executado nesta análise.

Validação: JSON reaberto por parser, contagens e arredondamentos confrontados com as amostras de origem; comandos de cálculo somente leitura e geração documental com exit 0.
