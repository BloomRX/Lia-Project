# Auditoria de consumo — agente principal, subagentes e skills

**Data:** 30/10/2026. **Estado:** relatório para revisão; sem commit ou push.

## 1. Resumo executivo

Há desperdícios confirmados, mas não há base para atribuir uma porcentagem de economia ou um custo financeiro. A maior amplificação observada é o histórico extenso enviado novamente em cada chamada e herdado integralmente pelos workers. Os briefs eram curtos; o contexto inicial dos workers chegou a 421.951 tokens. Todos os agentes observados usaram `gpt-6.1-sol`, raciocínio `medium`.

As três missões somam **88.259.861 tokens de entrada**, dos quais **87.577.088 em cache**, e **257.670 de saída**. Entrada sem cache: **682.773**. Cache já faz parte da entrada; raciocínio já faz parte da saída. Esses contadores de uso não são uma fatura nem permitem explicar a regra comercial da quota.

A missão de 10min47s foi localizada: durou **647.910 ms** e terminou com **`usage_limit_exceeded`**. Não terminou como entrega aprovada. O estado local contém mais de cinco arquivos; essa descrição não coincide com o inventário observado. Não houve commit da implementação de transportes.

Alethe foi lido, mas não houve execução de seu runner, política, doctor ou ferramentas MCP nas três missões. A delegação efetiva ocorreu pela ferramenta nativa `spawn_agent`/`followup_task`. Portanto, não se atribui consumo de workers ao runner Alethe.

Esta auditoria não iniciou subagentes, não executou testes/builds, não alterou skills, modelos, configurações ou código funcional. Os trabalhos anteriores foram preservados. A implementação foi suspensa ao chegar esta solicitação.

## 2. Fontes, seleção e método

Fontes locais consultadas em modo de leitura:

- `C:/Users/lucas/.codex/state_5.sqlite`: tabelas `threads` e metadados de modelo/papel/origem. Conexão SQLite `mode=ro`.
- Rollout principal: `C:/Users/lucas/.codex/sessions/2026/10/19/rollout-2026-10-19T23-04-07-01a1570d-3b5f-7100-a580-c4ad0548b559.jsonl`.
- Dez rollouts de subagentes em `C:/Users/lucas/.codex/sessions/2026/10/30/`, identificados pelos IDs na seção 5.
- Eventos `task_started`, `task_complete`, `token_usage_record`, `turn_context` e chamadas de ferramentas; commits e artefatos locais de testes.

Tokens: soma de `token_usage_record.usage`, deduplicada por `response_id`, exigindo que `thread_id` corresponda ao arquivo proprietário e agrupando por `root_turn_id`. Não foram somados os contadores cumulativos `thread_token_usage`/`turn_token_usage` ou a coluna `tokens_used` do SQLite. Eventos `token_count` não foram somados novamente.

Os arquivos dos filhos contêm cópias de histórico do pai, com timestamps recriados durante o fork. Para contar ferramentas/skills, foram considerados apenas os turnos próprios do agente, identificados pelos seus registros de uso. Contar todo o arquivo produziria delegações e leituras fictícias. O arquivo principal tem aproximadamente 47,8 MB e histórico desde 20/10; seu total acumulado não é o custo de uma missão.

A extração sanitizada está em `C:/Users/lucas/.codex/tmp/lia-consumption-audit-20261030.json`; contém métricas, IDs e caminhos, sem copiar conversas completas ou credenciais. Não foram lidos `auth.json`, cofres ou chaves. Esse arquivo auxiliar local não é necessário para usar a aplicação.

| Execução | Root turn | Resultado | Horário local America/Sao_Paulo | Duração registrada |
| --- | --- | --- | --- | --- |
| R1 — Runtime próprio | `01a18adf-db65-7b43-82b2-f7c23669ce23` | Publicou `eb38005` (17 arquivos) | 00:34:49–01:23:49, 30/10 | 48min 59.978s |
| R2 — Runtime E2E | `01a18b1d-55ef-7592-8561-66613f0bd0dd` | Publicou `6ec4f99` (16 arquivos) | 01:41:58–02:14:16, 30/10 | 32min 18.623s |
| R3 — Transport Configuration | `01a18b40-66be-7a50-b704-bb4fb1923d65` | Interrompida por quota; sem commit | 02:20:16–02:31:04, 30/10 | 10min 47.910s |

A duração da tabela é a do turno principal. Os tokens agregam os filhos atribuídos ao mesmo root, inclusive os que terminaram segundos depois do principal. Em R3, o principal terminou às 02:31:04 e o último filho às 02:31:17; não se confundiu tempo do principal com soma de durações paralelas.

A auditoria atual é uma execução posterior, iniciada às **16:50:33 de 30/10**, root `01a18e5d-2bea-79f2-acb3-ced36c4a48c4`, ainda em andamento na coleta. Foi separada das três implementações solicitadas; não é uma quarta entrega de código. Não foram encontrados outros turnos principais de desenvolvimento entre R3 e a auditoria no rollout consultado.

Na coleta do Git havia **29 caminhos de implementação/documentos de teste fora dos seis Core preexistentes**: 20 arquivos rastreados modificados e 9 novos. Além disso, havia um cache gerado em `node_modules/.cache` na raiz. Os cinco arquivos podem se referir a um subconjunto de worker, mas a origem desse número é **NÃO COMPROVADA**. Não foi feita limpeza, descarte ou publicação para forçar essa contagem.

## 3. Tempos: o que é medido e o que não é

| Execução | Até primeira escrita de qualquer agente | Até primeira escrita do principal | Até primeira chamada identificada de teste/build/typecheck |
| --- | --- | --- | --- |
| R1 — Runtime próprio | 6min 41.725s | 9min 40.401s | 4min 1.827s |
| R2 — Runtime E2E | 4min 34.233s | 12min 45.879s | 4min 34.233s |
| R3 — Transport Configuration | 2min 30.272s | 3min 30.801s | 3min 9.257s |

Esses são marcos de ferramenta, não fases exclusivas. O intervalo anterior à primeira escrita inclui preflight, leitura, testes de baseline e trabalho paralelo. **Tempo puro de planejamento, tempo efetivo de implementação e tempo total exclusivo de testes: NÃO DISPONÍVEL.** Seriam necessários spans explícitos por etapa e intervalos dos processos. Não é correto classificar todo o tempo anterior à edição do principal como planejamento, pois workers já estavam implementando.

Artefatos reproduzíveis de Electron encontrados:

- R2: quatro execuções, duas sem conclusão e duas PASS. As duas primeiras falharam em código do painel/runner (evento SDK e consulta ao objeto Playwright já fechado), com spans de **2,891 s** e **31,398 s**. Total direto desses spans: **34,289 s**; não inclui raciocínio/correção.
- R3: três execuções, duas sem conclusão e uma PASS de componentes. As duas primeiras falharam na segunda janela (visibilidade/preload), spans **32,209 s** e **32,339 s**, total **64,548 s**.
- A repetição após novas asserções de segurança é justificada; não foi classificada como desperdício. Os 30 segundos do teste de timeout também são requisito funcional do cenário, não evidência de lentidão do modelo.

Reports: `Tests/artifacts/provider-runtime-electron/{1793336254250,1793336314296,1793336550455,1793337018084}/report.json` em R2 e `{1793337976581,1793338049683,1793338154705}/report.json` em R3. PASS desses componentes não equivale ao Stage completo ou serviço externo.

## 4. Tokens e chamadas

| Execução | Entrada | Entrada em cache, incluída à esquerda | Entrada sem cache | Saída | Raciocínio, incluído na saída | Respostas com uso registrado |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| R1 — Runtime próprio | 34.838.791 | 34.679.680 | 159.111 | 109.563 | 62.208 | 112 |
| R2 — Runtime E2E | 40.726.197 | 40.452.480 | 273.717 | 96.753 | 50.770 | 124 |
| R3 — Transport Configuration | 12.694.873 | 12.444.928 | 249.945 | 51.354 | 15.239 | 96 |

As respostas acima correspondem a `response_id` com uso registrado. Tentativas sem registro de uso, falhas antes da resposta e retries internos de rede não têm contagem completa disponível. **Chamadas totais físicas ao backend e tokens de tentativas não registradas: NÃO DISPONÍVEL**, não zero.

A proporção de entrada em cache foi 99,543% / 99,328% / 98,031%. Isso não mede economia de quota, custo em reais nem latência. O limite de contexto observado foi **475.000 tokens**: é capacidade, não tokens consumidos por resposta.

| Execução | Agente | Respostas | Entrada | Cache incluído | Saída | Entrada na primeira resposta | Duração somada dos turnos |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| R1 | `/root` | 62 | 19.705.596 | 19.622.272 | 72.004 | 242.554  48min 59.978s |
| R1 | `/root/map_provider_execution` | 14 | 4.009.159 | 3.973.888 | 4.980 | 261.292  3min 48.551s |
| R1 | `/root/own_provider_runtime` | 28 | 8.357.386 | 8.340.864 | 27.228 | 277.242  15min 8.321s |
| R1 | `/root/review_native_provider` | 8 | 2.766.650 | 2.742.656 | 5.351 | 329.529  4min 14.389s |
| R2 | `/root` | 60 | 16.058.114 | 15.928.064 | 54.877 | 383.340  32min 18.623s |
| R2 | `/root/audit_runtime_lifetime` | 25 | 8.031.460 | 7.958.144 | 13.054 | 415.552  10min 22.974s |
| R2 | `/root/fix_cancel_lifetime` | 14 | 6.172.319 | 6.152.960 | 11.290 | 421.951  6min 51.602s |
| R2 | `/root/map_electron_gate` | 13 | 5.399.634 | 5.367.936 | 7.255 | 395.829  4min 22.046s |
| R2 | `/root/migrate_local_transport` | 12 | 5.064.670 | 5.045.376 | 10.277 | 405.096  6min 12.995s |
| R3 | `/root` | 32 | 4.161.619 | 4.109.056 | 16.087 | 91.018  10min 47.910s |
| R3 | `/root/audit_runtime_lifetime` | 2 | 93.050 | 88.832 | 206 | 44.624  0min 16.472s |
| R3 | `/root/map_transport_config` | 15 | 1.870.141 | 1.714.048 | 7.698 | 99.643  4min 15.187s |
| R3 | `/root/transport_electron` | 27 | 3.936.267 | 3.913.216 | 12.005 | 128.040  8min 24.922s |
| R3 | `/root/transport_repository` | 20 | 2.633.796 | 2.619.776 | 15.358 | 117.833  8min 2.467s |

Modelo e esforço foram conferidos nos metadados: **todos `gpt-6.1-sol` / `medium`**. Cache-write registrado: zero nas respostas analisadas. Tempo ativo dos turnos de um worker não deve ser somado ao tempo do principal, porque há paralelismo.

Preço por modelo no contrato da conta, custo efetivo, débito de quota por chamada e custo por skill: **NÃO DISPONÍVEL**. Não foi consultado serviço pago nem feita inferência de custo a partir de duração. A documentação oficial explica a inclusão de cache na entrada e raciocínio na saída; os números locais continuam sendo evidência distinta de cobrança: [Observability and usage](https://developers.openai.com/api/docs/guides/agents-api/observability).

## 5. Agente principal e subagentes

| Execução | Novos workers | Reutilizações | Evidência de uso dos resultados |
| --- | ---: | --- | --- |
| R1 | 3 | Sem followup nativo registrado | Mapa de despacho, implementação de registry/transporte e revisão da factory antiga utilizados no commit |
| R2 | 4 | 2 followups ao reviewer | Mapa Electron usado no painel; migração local e fix de cancelamento incorporados; reviewer achou limpeza travada e lacunas nas asserções do gate |
| R3 | 3 | 3 followups: exploração→testes, endurecimento do repo, revisão | Repo e ponte Electron presentes no diff; testes dirigidos utilizados. Revisão final ficou incompleta por quota |

Não houve `spawn_agent` emitido por filhos nas operações próprias encontradas. Os dez novos agentes têm profundidade 1 e pai principal. **Delegação recursiva: não observada.** R3 também reutilizou `/root/audit_runtime_lifetime`; portanto teve quatro identidades de worker atuando, mas somente três novos spawns.

IDs para localizar rollouts:

- `/root/review_native_provider` em R1 — Runtime próprio: `01a18af1-25c9-7c12-bc13-4c40b3ad3f42`.
- `/root/own_provider_runtime` em R1 — Runtime próprio: `01a18ae3-5871-7f51-9805-5d4c9ee2f07c`.
- `/root/map_provider_execution` em R1 — Runtime próprio: `01a18ae0-e224-7483-b72f-c4b0337091a0`.
- `/root/fix_cancel_lifetime` em R2 — Runtime E2E: `01a18b24-538c-7810-9e7d-fd1d355853cf`.
- `/root/audit_runtime_lifetime` em R2 — Runtime E2E: `01a18b23-14fa-75a2-94c6-0f63407f43db`.
- `/root/migrate_local_transport` em R2 — Runtime E2E: `01a18b1f-97a2-7b00-a98e-127fc1d7e86f`.
- `/root/map_electron_gate` em R2 — Runtime E2E: `01a18b1e-d6e8-72d0-8129-4bbd42260bcd`.
- `/root/transport_electron` em R3 — Transport Configuration: `01a18b42-c6e6-7af2-ba53-c97e0769d2cc`.
- `/root/transport_repository` em R3 — Transport Configuration: `01a18b41-bbf9-7841-9fb0-6b2349114acf`.
- `/root/map_transport_config` em R3 — Transport Configuration: `01a18b40-d343-7131-ae27-38decd65abdf`.
- `/root/audit_runtime_lifetime` em R3 — Transport Configuration: `01a18b23-14fa-75a2-94c6-0f63407f43db`.

Em todos os dez spawns, `fork_turns` foi omitido; o padrão da ferramenta é `all`. Nenhum spawn especificou modelo/esforço alternativo. Briefs de 716 a 3.576 caracteres foram acompanhados por entradas iniciais de 99.643 a 421.951 tokens. Assim, o histórico carregado, e não só a descrição da tarefa, foi o principal volume inicial.

Em R2, as primeiras entradas dos quatro workers somaram **1.638.428 tokens**. Isso é volume observado, não economia garantida com `fork_turns=none`: ainda seriam necessários instruções, ferramentas e contexto de tarefa. Um piloto com handoff curto deve medir a diferença real.

O principal também permaneceu com contexto grande: primeira entrada de R1 242.554, R2 383.340, R3 91.018. Em R2 houve compactação do principal às 02:06:17 e do reviewer às 02:09:17; as menores entradas posteriores foram 34.805 e 31.826. É evidência de redução do contexto após resumo, não benchmark controlado de qualidade/custo.

A delegação funcional não foi inútil: o reviewer encontrou defeitos reais e os workers produziram código usado. A oportunidade de simplificação é o tamanho do contexto e o número de papéis para exploração localizada. Em R3, principal e explorador leram os mesmos componentes/configuração antes de integrar o mapa; sobreposição **provável**, mas não é possível atribuir todos esses bytes a desperdício porque o integrador também precisa entender o contrato.

O principal realizou 43 / 38 / 17 chamadas externas `exec` em R1/R2/R3; uma chamada pode conter várias ferramentas internas. Não confundir esse número com chamadas ao modelo, nem com processos iniciados.

## 6. Skills efetivamente carregadas

A tabela conta solicitações próprias de leitura de `SKILL.md`, não todas as skills instaladas nem cópias herdadas no fork. Não há um medidor separado de “ativação de skill”. Alethe foi lido em partes em R3: duas leituras não significam duas execuções completas.

Tamanho aproximado = caracteres do arquivo atual / 4, arredondado. É **estimativa de texto**, não uso real de tokens do modelo, e não mede quanto de um arquivo parcialmente lido ou truncado chegou ao contexto.

| Skill/localização | R1 | R2 | R3 | Estimativa do arquivo completo | Instrução relevante / impacto observado |
| --- | ---: | ---: | ---: | ---: | --- |
| [alethe](../../.agents/skills/alethe/SKILL.md) | 1 | 0 | 2 | ~5.365 | Pede delegação proativa em tarefas grandes; runner não executado. Instruções longas para backend/planos sem uso nesta execução. |
| [lia-ai-sdk-integration](../../.agents/skills/lia-ai-sdk-integration/SKILL.md) | 2 | 0 | 0 | ~336 | Compatibilidade/streaming/credenciais; duas leituras pequenas em R1. Não inicia agentes. |
| [lia-browser-automation](../../.agents/skills/lia-browser-automation/SKILL.md) | 0 | 2 | 0 | ~424 | AGENTS, CDP, seletores e isolamento. Lida por principal e explorador em R2; execução efetiva foi fixture Playwright. |
| [lia-electron-cdp-debugging](../../.agents/skills/lia-electron-cdp-debugging/SKILL.md) | 0 | 2 | 0 | ~304 | Escolha de renderer CDP; lida por dois agentes. Sobreposição com browser/windows. |
| [lia-eventa-ipc](../../.agents/skills/lia-eventa-ipc/SKILL.md) | 0 | 1 | 0 | ~253 | Contratos/validação IPC e ciclo de vida; leitura pelo explorador Electron. |
| [lia-pnpm-workspaces](../../.agents/skills/lia-pnpm-workspaces/SKILL.md) | 1 | 0 | 0 | ~226 | Workspace/build correto; sem instalação ou orquestração automática comprovada. |
| [lia-release-gate](../../.agents/skills/lia-release-gate/SKILL.md) | 1 | 1 | 0 | ~1.148 | Estados honestos e gate real; repete salvaguardas de AGENTS, mas relevantes à entrega. |
| [lia-safe-change](../../.agents/skills/lia-safe-change/SKILL.md) | 1 | 2 | 1 | ~676 | Preflight/preservação/diff. Duplicação de regras gerais, sem exigir auditoria integral. |
| [lia-security-review](../../.agents/skills/lia-security-review/SKILL.md) | 1 | 1 | 1 | ~597 | Fronteiras/segredos, baseline de segurança e testes negativos. Revisão direcionada encontrou falhas reais. |
| [lia-test-discipline](../../.agents/skills/lia-test-discipline/SKILL.md) | 1 | 2 | 1 | ~690 | Cwd/suítes/concorrência; alguns erros de cwd ocorreram apesar da leitura. |
| [lia-vue-development](../../.agents/skills/lia-vue-development/SKILL.md) | 1 | 0 | 1 | ~379 | Padrões de estado/componentes; checklist curto, não inicia agentes. |
| [lia-vue-testing](../../.agents/skills/lia-vue-testing/SKILL.md) | 0 | 1 | 0 | ~334 | Testes de estado/DOM e isolamento; leitura pelo worker da migração em R2. |
| [lia-windows-electron-validation](../../.agents/skills/lia-windows-electron-validation/SKILL.md) | 0 | 2 | 0 | ~431 | Janela/processos/logs; lida pelo principal e explorador R2. |
| [stage-runtime-debugging](../../.agents/skills/stage-runtime-debugging/SKILL.md) | 0 | 2 | 0 | ~1.120 | Build/runtime/ready/encerramento; maior que as outras de Electron, parcialmente sobreposta ao escopo de componentes. |

Referências de produto explicitamente carregadas incluem CURRENT-STATE §0/§6 e QUANTO-FALTA nas três missões; os relatórios de runtime/arquitetura exigidos pelas missões em R2/R3; e `docs/product/LIA-SECURITY-PERMISSIONS-WINDOWS-TRUST.md` em R3. `lia-safe-change`, `lia-test-discipline` e `lia-release-gate` remetem a esses documentos de estado/validação, portanto parte da leitura coincide com o prompt da missão. Não foi encontrada leitura própria de arquivos `references/*.md` do Alethe nessas três missões. As referências mencionadas dentro de SKILL.md não foram contadas como arquivos carregados. Skills já presentes no histórico foram herdadas pelos workers; isso não foi contado como nova leitura.

Alethe contém a instrução de uso proativo quando o pedido permite dividir unidades independentes. As outras skills examinadas não mandam criar vários agentes por padrão nem ler todas as referências. `lia-safe-change` pede seções relevantes; o próprio AGENTS restringe a leitura de CURRENT-STATE a §0 e §6 antes de editar. Portanto, “todas as skills obrigam auditoria completa” é **não comprovado**.

`stage-runtime-debugging` remete a `lia-regression-investigation`; `lia-test-discipline` remete a Vue testing/regression/workspaces; `lia-safe-change` remete a test discipline e skills relevantes do upstream; release gate também remete a test discipline/regression. Isso é orientação textual, não cadeia de invocações automáticas. As leituras efetivas, e não só essas referências, estão na tabela.

O [AGENTS.md](../../AGENTS.md) atual tem **63.343 caracteres (~15.836 tokens por chars/4)**, mais regras e catálogo de skills fornecidos pelo host. Esse volume compõe contexto/instruções; a participação exata de cada fonte em uma requisição é **NÃO DISPONÍVEL**. A presença de uma descrição no catálogo não prova que o SKILL.md inteiro foi carregado.

## 7. Fontes de desperdício priorizadas

| Prioridade / classificação | Problema e evidência | Execuções | Impacto demonstrável | Proposta, não aplicada |
| --- | --- | --- | --- | --- |
| Alta — confirmado | Fork completo por padrão; 10 spawns sem `fork_turns`, workers iniciando com 99k–422k de entrada | R1/R2/R3 | Entradas iniciais medidas; R2 1.638.428 somadas. Débito/custo evitável exato desconhecido | Brief limitado e `fork_turns=none` quando a tarefa independente puder receber contexto suficiente |
| Alta — confirmado | Histórico grande no principal; R2 atingiu entrada 451.198 antes de compactar | R1/R2, menor em R3 | Mais input por chamada e duas compactações em R2; efeito na quota não isolado | Handoff curto/foco por missão e resumo de contratos antes de delegar; medir piloto |
| Alta — confirmado | Principal rodou `moeru-lint --fix` sobre lista ampla com arquivo de outro worker e perfil inadequado | R3 | Gate atual ficou com `it(...)` sem import; log `transport-config-host-lint-20261030.log` acusa `no-undef` | Validação final sem auto-fix; autor corrige seus arquivos com perfil Node próprio; respeitar ownership |
| Média — confirmado | Defeitos do próprio painel/runner exigiram novas tentativas Electron | R2/R3 | Spans diretos falhos de 34,289s e 64,548s; tempo de correção/tokens não isolados | Provar primeiro bootstrap/preload/seletores em cenário curto, depois executar o caso de 30s |
| Média — confirmado | Primeiro stores foi executado da raiz em vez de airi, gerando warnings UnoCSS e cache na raiz | R3 | Suíte registrada durou 136,50s; cache local gerado; repetir do cwd correto foi necessário | Centralizar comando validado e cwd explícito; não inferir descoberta pelo nome do diretório |
| Média — confirmado | Saídas grandes foram truncadas | R1/R2/R3 | 7 / 12 / 10 outputs próprios distintos com aviso de truncamento no recorte; não equivale a número de releituras | Limitar seções e obter metadados/mapa antes do conteúdo; preservar logs e ler trecho de falha |
| Média — provável | Principal e explorador repetem parte do mapa/configuração | R1/R3 | Exploração de R3 63,614s; parte do resultado foi usada, então não é toda evitável | Um dono para mapa, outro para integração; não reler o mapa inteiro para reconstruí-lo |
| Baixa — confirmado, economia não medida | Skills de Electron lidas por principal e explorador; SDK lida duas vezes em R1 | R1/R2 | Leituras identificadas; efeito incremental por cache desconhecido | Compartilhar requisitos essenciais no handoff e carregar apenas a skill que governa o fluxo efetivo |
| Não comprovado | Alethe CLI iniciou workers adicionais, delegação recursiva, necessidade de modelo mais caro ou economia percentual específica | Todas | Nenhuma evidência dessas causas | Não alterar ferramentas/modelos por essa hipótese |

A revisão crítica e testes de regressão não devem ser eliminados: trouxeram correções de corrida de factory, cancelamento travado e asserções fracas. Também não há prova de que `medium` tenha causado raciocínio desnecessário: foram **128.217 tokens de raciocínio** nas três missões, já incluídos em saída, mas tarefas complexas justificam parte desse trabalho.

## 8. Proposta de execução otimizada, aguardando decisão

1. **Principal:** manter responsabilidade por arquitetura, limites, integração e diff. `gpt-6.1-sol medium` já produziu entregas verificáveis; não há evidência para recomendar modelo mais caro. Usar esforço menor em inventário puramente mecânico somente após piloto.
2. **Workers:** começar com zero para mudança simples; em migração grande, no máximo dois escritores de áreas independentes mais uma revisão curta quando o risco justificar. Exploração de caminho pequeno pode ficar no principal. Não criar workers apenas para preencher papéis.
3. **Contexto:** preferir handoff contendo objetivo, arquivos proprietários, contrato, salvaguardas e teste esperado, sem histórico completo. `fork_turns=none` é proposta, não mudança executada. Registrar input da primeira chamada para validar a redução real.
4. **Modelo de exploração:** testar um modelo mais econômico que esteja efetivamente disponível no ambiente; comparar acerto, necessidade de retrabalho, latência e consumo no mesmo mapa. Nome/preço/acesso não verificados aqui; não presumir economia a partir do rótulo.
5. **Skills:** carregar só a habilidade governante da área e a disciplina de segurança/testes aplicável. Não reler o arquivo no mesmo agente sem mudança ou dúvida específica. Alethe: usar runner apenas se ele trouxer controle/telemetria útil; não misturar sua cerimônia com delegação nativa sem necessidade.
6. **Leituras:** mapa resumido reutilizável com caminhos e contratos; depois trechos necessários à edição. Evitar batches que imprimem vários documentos inteiros e acabam truncados.
7. **Validação:** unitários dirigidos durante implementação; suíte integrada uma vez depois da integração; repetir somente após mudança relevante, falha ou asserção nova. Build/gate Windows continuam obrigatórios quando o escopo exigir.
8. **Ownership:** principal não executa auto-fix amplo sobre arquivos de workers. Workers não publicam. Integrar resultado e revisar diff antes de comando mutante.
9. **Encerramento:** reservar margem de contexto/tempo para lint, relatório e Git. Se a quota interromper, deixar inventário e estado preciso; não chamar entrega parcial de concluída.

Nenhuma dessas propostas foi salva em skills, config.toml, política Alethe, modelos ou prompts do repositório.

## 9. Telemetria futura sem serviço pago

Os rollouts já contêm uso por resposta e agente. A primeira melhoria é um extrator somente leitura, fora do fluxo de produto, com este esquema:

- `run_id/root_turn_id`, `thread_id`, `turn_id`, `response_id`, timestamps, modelo/esforço, input/cache/output/raciocínio; deduplicação por resposta e exclusão do histórico copiado.
- `task_started/task_complete`, parent/depth, brief e primeira entrada; quantidade de spawns/followups e indicação de resultado utilizado/descartado.
- Spans de preflight, implementação, teste, build, revisão e encerramento. Processos devem registrar início/fim/código de saída, sem conteúdo privado.
- Leituras com caminho normalizado, faixa de linhas e hash da versão; outputs truncados; comandos e cwd. Não reter credenciais nem texto integral de arquivos para medir leituras.
- Skills: nome/hash/faixa lida e respostas posteriores em que o contexto foi usado. **Tokens exclusivos por skill não são separáveis** sem instrumentação de prompt/tokenização ou experimento controlado; não atribuir a ela toda a chamada posterior.

Validar os totais do extrator com registros de turnos, não com duração ou limite de contexto. Se o ambiente já fornecer uso por sessão/turno, consultar essa fonte sem instalar ou migrar infraestrutura. Habilitar nova telemetria/configuração exige decisão posterior; nada foi habilitado nesta auditoria.

## 10. Limitações e estado preservado

- Registros de uso são observados pelo cliente; não substituem faturamento. Tentativas sem usage podem faltar.
- A contagem de leituras de skill prova solicitação de leitura, não utilização cognitiva de cada instrução. Tamanho por chars/4 é estimativa não tokenizada.
- Tempos de CPU/modelo, fases exclusivas e débito por skill não estão instrumentados. Não se usou duração como proxy de tokens.
- Leituras repetidas após alteração/revisão não são automaticamente desperdício. Oportunidades de economia precisam de experimento curto antes de adotar nova configuração.
- Os seis Core preexistentes e a implementação em andamento permanecem no checkout. O relatório não valida nem publica esse diff.
- Há falhas de lint pendentes na implementação suspensa; a linha 58 do gate está atualmente em `it(...)` sem definição. Não foi corrigida porque esta missão proíbe mudanças funcionais.
- O baseline funcional e os commits publicados não foram promovidos. HEAD permaneceu `6ec4f99fa1f73ec5ff62c7f2f9964587271160ae`; branch `arena/01a10290-lia-project`.
- Somente este documento foi criado no repositório pela auditoria. Nenhum commit, push, configuração de modelo, skill ou orquestrador foi alterado. Publicação fica para revisão do usuário.
