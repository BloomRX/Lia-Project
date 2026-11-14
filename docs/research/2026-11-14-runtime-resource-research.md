# Pesquisa incremental: recursos em desktop sempre ativo e uso durante jogos

**Consulta:** 14/11/2026 (UTC)
**Repositório Lia:** BloomRX/Lia-Project
**Referência de desenvolvimento examinada somente em leitura:** `arena/01a10290-lia-project` no commit `ae46c495d7da7cd33f4b4da8f4e8cc95b0a867b6` (commit de 14/11/2026).
**Branch desta entrega:** `arena/826a33f1-lia-project`.
**Natureza:** pesquisa documental e inspeção estática seletiva; nenhum runtime/benchmark foi executado. Este relatório complementa `docs/TECHNOLOGY-RESEARCH.md`, não repete sua pesquisa geral de AIRI, STT/TTS, MCP, llama.cpp etc. Foca em descobertas novas ligadas ao tip atual: custo do segundo Electron, comando `presence.set-budget`, runtime de voz isolado, memória local existente e modo de jogo.

## 1. Resumo executivo

A consulta do commit atual muda a priorização: a Lia já possui decisões e componentes de produto relevantes para várias recomendações genéricas anteriores. O código/documentação do tip descreve Core sem dependência Electron, um Launcher supervisor, Stage Electron separado, runtime Kokoro separado e comando de host `presence.set-budget`. O custo estrutural mais claramente identificado pelo próprio relatório de arquitetura é **empacotar e iniciar um segundo Electron completo para o Stage**, não apenas “falta otimizar animação”. Há um gate de runtime ainda aberto e nenhuma medição comparativa confiável de alternativas ou do consumo em jogo.

A oportunidade de maior retorno é, portanto, **medir e atacar a duplicação do runtime do Stage sem migração ampla**. A decisão documentada é manter Electron nesta etapa; o experimento mais conservador é comparar o pacote/arranjo atual com formas de compartilhar runtime/processo, medindo RSS, tempo de startup, VRAM/GPU, estabilidade de janelas e compatibilidade de 70 arquivos de Main dependentes do Electron. Não há ainda evidência suficiente para recomendar Tauri, PAVISE ou mudança de renderer.

Para jogos, uma direção segura é colocar o próprio trabalho não essencial da Lia em orçamento baixo quando Stage está oculto ou um jogo está ativo: limitar render/ticker, pausar tarefas opcionais e permitir reativação imediata por áudio/evento. Windows EcoQoS é uma API oficial relevante para trabalho CPU de baixa urgência, mas **não limita GPU/RAM, não melhora automaticamente FPS e não deve ser aplicado a processos/threads de áudio em prazo real**. PAVISE é um projeto de pesquisa útil para estudar governança/restauração, mas requer administrador e altera outros processos/sistema; não deve ser incorporado nem imitado sem sandbox, threat model e teste adversarial.

## 2. Método, fatos e limitações

### Referência da Lia

O SHA `ae46c495d7da7cd33f4b4da8f4e8cc95b0a867b6` foi buscado como objeto Git remoto e inspecionado em modo somente leitura. Foram lidos `docs/project/CURRENT-STATE.md`, `docs/reports/LIA-DESKTOP-RUNTIME-ARCHITECTURE-DECISION.md`, `docs/architecture/LIA-AGENT-CONSUMPTION-AUDIT.md`, `docs/architecture/LIA-STAGE-ARCHITECTURE.md`, `lia/core/src/host/contracts.ts`, o serviço de memória e documentos de licenciamento de voz. Não fiz checkout dessa branch nem alterei seus arquivos. O commit do relatório de runtime citado no snapshot pode refletir análise anterior; informação afirmada abaixo é atribuída ao commit indicado, não à execução desta sessão.

### Classes de evidência

- **Fato no commit da Lia:** conteúdo encontrado em código ou relatório versionado no SHA acima; não é validação dinâmica.
- **Fato oficial externo:** documentação ou repositório oficial declara o comportamento/licença.
- **Estimativa:** previsão qualitativa de custo ou valor, sem benchmark reproduzido.
- **Hipótese:** abordagem que precisa de spike ou teste.
- **Não verificado:** falta fonte, medição, build Windows, avaliação de dependências ou validação no dispositivo alvo.

### Limitações

Sem Windows interativo/hardware RX 580 nesta sessão; não foram medidos RSS/VRAM/CPU/FPS/latência, nem verificado jogo em foco, device-removal, multi-monitor real ou restauração de sistema. Web pesquisada via fontes oficiais principalmente GitHub, Microsoft e Electron. PAVISE foi inspecionado pela página do repositório e seu README; não houve auditoria linha a linha nem execução. Isso não é recomendação de uso em máquina de produção.

## 3. Estado atual que afeta as recomendações

**Fatos documentais/estáticos no commit consultado:**

1. O relatório `LIA-DESKTOP-RUNTIME-ARCHITECTURE-DECISION.md` registra Cenário C: manter Electron, sem migração aprovada, com gate de arquitetura ainda aberto. Launcher e Stage são processos/aplicações separados, e o bundle contém `LiaStage.exe` com segundo Electron completo.
2. O mesmo relatório identifica o Stage como fronteira mais pesada: 70 arquivos não-teste importam Electron no inventário daquela análise, 16 famílias de janelas e renderer com Three.js/VRM, Live2D/Pixi e áudio. A contagem/versões são o inventário do relatório, não auditoria atual independente.
3. `lia/core/src/host/contracts.ts` tem comando declarativo `presence.set-budget` e comandos de lifecycle `stage.spawn`/`stage.stop`. A existência do contrato **não prova** que a política de orçamento tenha implementação, efeitos ou UI validada.
4. Arquitetura reporta runtime Kokoro como processo supervisionado separado. Documentos de voz estabelecem que AllTalk/XTTS-v2 não são empacotados e que XTTS weights têm restrição não comercial. Portanto não sugerir adicionar outro TTS sem confrontar esse desenho e as políticas de licença já documentadas.
5. Existe serviço de memória local simples em `lia/.../memory-service.ts`: JSON de usuário, validação/limites, gravação temporária + rename, API de get/mutate/recall e contexto limitado. Logo, a oportunidade incremental não é introduzir um framework de memória: é medir a qualidade do recall e o custo de tokens/latência do contexto existente.
6. O projeto tem auditoria de consumo de agentes que reporta custo fixo alto de instruções/skills na configuração auditada. Ela fornece evidência de que a própria Lia já trata custo de contexto como problema; comparar quantitativamente com o consumo real do Stage/provider antes de priorizar nova infraestrutura.
7. Status oficial do snapshot afirma que Stage real via `Lia.bat`, conversa, tool calling, voz e C0–C4 não tinham sido aprovados ponta a ponta no estado descrito. Otimização de jogo deve ser benchmark com instrumentação e harness, não claims de UX pronta.

**Conclusão de encaixe:** priorizar a jornada de medição e controle sobre a arquitetura já existente; não propor frameworks novos nem duplicar armazenamento, provider ou voz.

## 4. Pesquisa por categoria

### 4.1 Recursos durante jogos: PAVISE como estudo de caso, não dependência

- **Projeto:** [PAVISE / Pavise-Game](https://github.com/dulaiduwang003/Pavise-Game) · [site](https://pavise.club/en/) · [guia](https://pavise.club/en/docs/v3/) · [releases](https://github.com/dulaiduwang003/Pavise-Game/releases).
- **Função declarada pelo projeto:** orquestrador Windows de recursos durante jogos. README enumera modos de supressão de tarefas em segundo plano, prioridades CPU/I/O/memória/GPU, placement/afinidade, perfis por jogo, whitelist, logs e restauração de ações temporárias após a sessão.
- **Tecnologias/maturidade:** repositório indica C#/.NET Framework/PowerShell e compilação com toolchain Windows. README na consulta lista versão `3.3.0.8`, branch/tag `pavise3x`, 27 commits no branch exibido e último commit em 10/11/2026; projeto pequeno/recente em desenvolvimento, com testes de regressão publicados e um benchmark independente. Números de versão e atividade são fotografia da consulta, não garantia de maturidade.
- **Licença:** GPL-3.0-only indicada no badge/arquivo do repo. Reutilizar/distribuir código sob GPL exige revisão de compatibilidade com distribuição da Lia; não copiar. O estudo de ideias não herda licença.
- **Hardware/desempenho:** Windows 10 2004+; .NET Framework 4.7.2+; vários recursos requerem admin. Hardware/driver dependente. README recomenda comparar cena reprodutível; não foi encontrada medida independente que prove ganho estável para Lia ou RX 580. Suporte explícito a hardware AMD em todos os submódulos não verificado.
- **Segurança:** manipula prioridades, processos, serviços, políticas de energia e registry; usa PowerShell e pede administrador. O próprio upstream alerta para incompatibilidade com outros otimizadores, falsos positivos do antivírus, revisão de fonte e restauração. Erro pode reduzir disponibilidade ou alterar configurações do SO; qualquer allowlist de processo pode ser explorada.
- **Compatibilidade com Lia:** baixa como integração; alta como fonte de requisitos para “game-aware resource budget”. Lia precisa reduzir o seu footprint, não gerir processos de usuário ou otimizar todos os jogos. Não deve competir com outros governors nem mexer em afinidade/serviços/registry.
- **Recomendação:** **REFERÊNCIA** para gestão por sessão, whitelist, logging e restauração; **DESCARTAR** como dependência/runtime de Lia. Protótipo futuro deve aplicar budget apenas aos próprios processos/threads, sem privilégio administrativo e com restauração garantida.

### 4.2 Windows EcoQoS / Quality of Service: API de sistema para trabalho próprio de baixa urgência

- **Fonte oficial:** [Microsoft — Quality of Service](https://learn.microsoft.com/en-us/windows/win32/procthread/quality-of-service) · [SetProcessInformation](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-setprocessinformation) · [PROCESS_POWER_THROTTLING_STATE](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/ns-processthreadsapi-process_power_throttling_state).
- **Função (fato):** Windows permite sinalizar QoS para influenciar escalonamento/eficiência energética; documentação descreve Eco para processos/threads explicitamente marcados e uso em trabalho sem requisito de latência. A orientação depende de plataforma e configuração de processador.
- **Licença/dependência:** API nativa do Windows, sem dependência open-source a incorporar; interoperabilidade exigiria código de host/Win32 e avaliação de compatibilidade com o runtime. Não presume CUDA/ROCm nem GPU específica.
- **O que não faz:** não é limitador de RAM, não suspende modelo/GPU, não garante FPS e não substitui quotas/cancelamento/backpressure. A própria descrição de QoS não concede à Lia controle confiável sobre prioridade de aplicação/jogo de terceiros.
- **Compatibilidade com Lia:** potencialmente encaixa no host Windows para trabalho opcional da própria Lia (indexação/idle maintenance), desde que estado seja restaurado ao tornar-se interativa. **Não** marcar captura/saída de áudio, playback, pipeline de fala em tempo real, IPC crítico ou tarefas que impactem UI com Eco sem prova; evitar prioridade alta manual.
- **Risco:** configuração aplicada no processo pode influenciar threads associadas; restauração/escopo devem ser explícitos. P/Invoke incorreto pode afetar experiência; API não portátil para macOS/Linux.
- **Recomendação:** **EXPERIMENTAL** em microbenchmark Windows, como opção host-only e opt-in. Primeiro medir necessidade e testar em jogo real; sem resultado claro, preferir reduzir trabalho e FPS do renderer em vez de mexer em QoS.

### 4.3 Electron: throttling de fundo e telemetria nativa para descobrir custo real

- **Fontes oficiais:** [BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window) · [WebContents](https://www.electronjs.org/docs/latest/api/web-contents) · [app.getAppMetrics](https://www.electronjs.org/docs/latest/api/app#appgetappmetrics) · [powerMonitor](https://www.electronjs.org/docs/latest/api/power-monitor).
- **Fatos:** BrowserWindow tem `backgroundThrottling` (documentado como padrão `true`) e webContents permite consultar/definir throttling. Electron avisa que desligá-lo pode afetar frames da janela inteira, e visibilidade de página também muda. API `app.getAppMetrics()` oferece métricas de processos Electron/CPU/memória; `powerMonitor` permite eventos de energia/sistema conforme SO.
- **Compatibilidade:** ferramentas já pertencem ao runtime escolhido; não adicionam fornecedor inferencial nem dependem de CUDA/ROCm. O código real da Lia precisa ser auditado antes de dizer quais janelas deixam throttling ligado ou desligado.
- **Risco/manutenção:** throttling indiscriminado pode interromper sincronização/áudio, timer e animação; desabilitar globalmente pode anular economia. Métricas variam por OS e não substituem medição de GPU por ETW/Windows Performance Analyzer. Não mandar métricas sensíveis para telemetry externa.
- **Recomendação:** **RECOMENDADA para observabilidade e experimento controlado**, sem assumir mudança de comportamento. Inventariar per-window throttling, frames ocultos, render process, timer e background audio; comparar estados minimized/occluded/visible e evitar `backgroundThrottling: false` salvo requisito comprovado.

### 4.4 PixiJS / loop de render: não comprar novo renderer; usar política de frame rate existente

- **Fontes:** [documentação PixiJS Ticker](https://pixijs.download/dev/docs/ticker.html) · [guia oficial Performance Tips](https://pixijs.com/8.x/guides/concepts/performance-tips) · [repo PixiJS](https://github.com/pixijs/pixijs).
- **Fatos:** ticker documenta `maxFPS` para limitar frequência de atualização e `minFPS` para cap de delta; ticker pode ser controlado e callbacks removidos. PixiJS é renderer 2D; Lia já usa Live2D/Pixi segundo inventário do Stage.
- **Possíveis ganhos:** para avatar fora de foco/oculto/idle, cadence menor (ex.: 15–30 FPS) e pausa de render quando estado visual estático podem reduzir trabalho de CPU/GPU; **estimativa/hipótese**, não benchmark medido na Lia. O ganho depende de compositor, transparência, ticker compartilhado e animação/áudio acoplados.
- **Riscos:** congelar ticker que move boca/expressão ou atualiza áudio causa defeito visível; `maxFPS` sozinho não limita WebGL/VRAM nem loops fora do ticker. Arquitetura tem Three.js/VRM também: solução Pixi não cobre todas as cenas.
- **Recomendação:** **RECOMENDADA como direção de benchmark**, não como nova dependência ou mudança de renderer. Criar estados de presença e orçamento com passos de degradação, respeitando áudio e reduzindo frames de avatar somente quando seguro. Investigar render-on-demand e compartilhamento de ticker já instalado.

### 4.5 Segundo Electron completo: principal oportunidade de custo/tamanho (e maior risco de retrabalho)

- **Evidência local:** decisão de runtime no commit de referência relata que Launcher empacota `stage-tamagotchi/dist/lia-windows/win-unpacked` em `resources/stage` e inicializa `LiaStage.exe`, logo existem dois pacotes Electron/Chromium/Node completos no produto empacotado.
- **Não verificado:** o tamanho extra em MB do instalador, RSS incremental, cold-start, compartilhamento efetivo de DLLs/cache/renderer-processos, impacto de GPU e se um arranjo de single-runtime reduz memória em Windows. Não declarar “2x consumo”; binários/caches podem ser compartilhados por SO e processo.
- **Alternativas a avaliar:** otimizar o empacotamento/instalação do Stage sem remover isolamento; integrar Stage como janela/processo dentro do runtime Launcher; ou trocar só o host Stage em prazo maior. Cada opção muda isolamento, ciclo de vida, IPC, atualizador, crash boundaries e superfície Electron. Não trocar para Tauri apenas para evitar o segundo pacote: Stage tem muitas APIs Electron, multiwindow, transparência e addons nativos.
- **Recomendação:** **EXPERIMENTAL, prioridade máxima de benchmark**, condicionado a gate de arquitetura existente. Faça comparação A/B em Windows limpo com install size, startup, working set por processo, private bytes, GPU memory, CPU idle, FPS e falhas de shutdown, preservando Sandbox/CSP/preload e sem misturar com alteração de renderer.

### 4.6 Memória/contexto: oportunidade é qualidade de recuperação e orçamento, não novo framework

- **Fatos na referência:** serviço Main-owned salva arquivo JSON limitado e validado, limita tamanho/entradas e constrói contexto local via recall. Auditoria de agentes no snapshot mede tokens de instruções/skills e identifica excesso de contexto fixo.
- **Hipótese de melhoria:** medir recall de memórias, tamanho de contexto adicionado, duplicação e latência com fixtures pt-BR. Compressão/resumo não deve remover procedência nem autorização de memória. Já existe a capacidade, portanto integrar LangGraph/vector DB agora teria baixa vantagem e risco de migração.
- **Recomendação:** **ADAPTAR/TESTAR o componente existente** com conjunto sintético, trilha de origem e métrica de tokens; manter o JSON enquanto volume/retrieval não provar limite. Confirmar em commit atual se arquivos e política persistem, pois somente leitura estática.

### 4.7 Providers locais/externos e modelos durante jogo

- **Estado:** runtime local/provedores já são área documentada no relatório anterior; commit atual já tem serviço de provider e runtime de voz isolado conforme arquitetura consultada. Não repetir catálogo de inferência.
- **Oportunidade nova:** política game-aware poderia pausar geração local não essencial, limitar concorrência e evitar carregar simultaneamente modelo conversacional, voz e renderer sob pressão. Se usuário escolhe provider hospedado, CPU local pode cair, mas rede/áudio externo traz custo, privacidade e latência; jamais forçar migração para um serviço pago durante gameplay.
- **Risco:** unload/reload pode elevar latência e não liberar VRAM imediatamente; interromper ferramenta pode corromper estado. Precisa cancelamento cooperativo e estado persistido antes de pausar.
- **Recomendação:** **EXPERIMENTAL** com classificação de tarefa (interativa, voz em tempo real, background/dispensável), concorrência máxima e botão/manual budget. Provider continua preferência do usuário.

## 5. Comparação e classificações

| Alternativa | Valor incremental no tip consultado | Limite/risco | Recomendação |
|---|---|---|---|
| PAVISE | Inspira guard por sessão, allowlist, trilha e restauração | GPL-3.0, jovem, admin, altera serviços/processos/registry e potencialmente GPU/afinidade | **REFERÊNCIA; descartar integração** |
| Windows EcoQoS | Pode ceder CPU em tarefas próprias não críticas | Windows-only; sem controle RAM/GPU; pode prejudicar deadlines | **EXPERIMENTAL** |
| Electron app metrics + throttling | Medir processos reais e aproveitar API já presente | Não substitui profiling GPU; throttle pode quebrar voz/timers | **RECOMENDADA para estudo/instrumentação** |
| PixiJS ticker/frame policy | Reduz trabalho 2D em idle/occluded | Stage também tem Three.js; impacto real a medir | **RECOMENDADA para protótipo localizado** |
| Otimização do segundo Electron | Ataca maior custo estrutural reportado | Mudança de alto risco em isolamento/lifecycle; ganho ainda não medido | **EXPERIMENTAL, benchmark P0** |
| Framework novo de memória/agente | Baixo valor incremental: há store e contratos existentes | Migração, custo operacional e privacidade | **DESCARTAR por ora** |
| Troca geral Electron → Tauri | Pode reduzir runtime em app novo | Stage acoplado em muitas APIs Electron; custo alto; gate permanece aberto | **DESCARTAR como atalho de otimização** |

## 6. Oportunidades que a Lia ainda pode explorar

1. **Budget de presença com estados verificáveis:** contrato `presence.set-budget` vira estados com limites declarativos (interactive/ambient/idle/game/background), validade/expiry, dono e estado de fallback. Tratar a presença como orçamento de produto, não comando genérico de prioridade.
2. **Um processo-alvo para cada medição:** separar Launcher, Stage renderer/GPU, Stage main e Kokoro; de outro modo ganhos do segundo runtime ficam confundidos com model weights e Chromium.
3. **Reatividade ao jogo sem monitoramento invasivo:** não detectar título/jogo por captura contínua. Preferir input do usuário, foreground/window state e opt-in; deteção de processo somente com transparência/allowlist e sem ler conteúdo.
4. **Render adaptativo:** diferenciar avatar visível, janela oculta/ocluída, idle, áudio em andamento e jogo foreground; manter animações e boca sincronizadas ao áudio, reduzir apenas partes não críticas.
5. **Bounded work e backpressure:** limitar operações de background/context compaction, image capture, memória/embeddings e tool polling; parar trabalho quando Stage perdeu orçamento e retomá-lo de forma cancelável.
6. **SLOs de uso em jogo:** estabelecer teto de CPU idle, working set incremental, p95 de latência de fala, frame time, picos de GPU e impacto na consistência do jogo; valores só após baseline de hardware.
7. **Benchmark reproduzível na máquina-alvo:** Ryzen 5 5500 / 16 GB / RX 580 indicada na decisão de runtime; adicionar device real (não virtual), driver e Windows build. Fazer cena de jogo constante, aquecimento e repetitions; comparar median/p95 e logs de carga.
8. **Minimização de runtime/package duplicado:** avaliar instalação do segundo app e atualizações separadamente; compartilhar componentes de instalação apenas se assinatura/versão compatível e sem violar limite de isolamento.

## 7. Protótipos que merecem avaliação

### P0 — baseline de consumo, sem alterar comportamento

- Em Windows real, instrumentar exatamente: Launcher idle; Stage visível idle; Stage oculto/ocluído; avatar animando; áudio TTS/STT; jogo foreground; geração local (se habilitada); shutdown/restart.
- Capturar `app.getAppMetrics()` por processo, perfmon/ETW para CPU/GPU/working set, FPS/time-to-frame, energia em laptop e install-size. Sem prompts, áudio ou caminhos pessoais nos logs.
- Repetir com e sem `LiaStage.exe` em estado equivalente; controlar resolução, monitor, taxa de atualização, driver e jogo.
- Gate de sucesso: resultados reproduzíveis e regressão de áudio/janelas ausente. Não há número limite definido aqui.

### P1 — budget de presença e throttling de frame

- Teste isolado no Stage: manter comportamento do avatar/voz, cap de frame em janela não ativa e desligamento de render quando invisível/estático; aplicar a componentes Pixi e Three separadamente.
- Confirmar que overlay transparente/clique atravessável, multi-monitor, DPI, movimento de boca e wake/resume continuam íntegros.
- Rollback imediato com uma opção acessível. Não alterar background throttling global sem auditar todas as webContents da BrowserWindow.

### P2 — EcoQoS para manutenção dispensável

- Apenas processo/tarefa da própria Lia, não game nem outro app; medir CPU, latência de retorno, comportamento AC/bateria e versões suportadas do Windows. Excluir thread de áudio, UI, IPC e provider interativo.
- Implementação eventual tem de restaurar QoS em transição, crash, suspend/resume e desligamento; usar capability guard e fallback não-Windows.

### P3 — compartilhamento de runtime Stage/Launcher (spike arquitetural)

- Primeiro prova técnica sem migrar APIs do Stage: estimar recursos, copiar somente configuração protótipo isolada, comparar se compartilhar o Electron reduz tamanho/working set sem romper crash/security boundary.
- Inspecionar Electron `app.getAppMetrics`, child-processes, crash handling, update e sandbox no fluxo real. Não é aprovação de arquitetura.

### P4 — PAVISE apenas como estudo de safety/restoration

- Revisar seus testes e abordagem de transação/restauração sem executar mudanças de sistema. Se for usado para comparação externa, em VM snapshot sem credenciais e sem instalar driver/hook.
- Não empacotar PAVISE, seu código GPL nem powershell scripts no produto.

## 8. Tecnologias/abordagens não recomendadas

- **PAVISE no runtime da Lia:** escopo de administrador e mutação do sistema muito maior que a necessidade de reduzir o próprio consumo; GPL-3.0 e conflito potencial com governors instalados.
- **Process Lasso/otimizador de terceiros como dependência:** pode interferir na configuração do usuário; não é necessário para a Lia ceder recursos próprios.
- **Aumentar prioridade da Lia ou mexer em registry/afinidade/driver da GPU:** objetivo é ceder ao foreground, mas caminhos não portáveis e de alto risco; dados atuais não provam bottleneck de CPU/GPU causado pela Lia.
- **Forçar provider pago/remoto em jogo:** conflita com escolha local/gratuita do usuário e cria riscos de privacidade/custo; deve ser apenas opção explícita.
- **Trocar renderer/runtime inteiro para “economizar recursos”:** sem A/B, não há prova de que reduzir segundo Electron compense custo de reescrever APIs Stage e perder estabilidade.
- **Pausar toda janela Electron oculta:** pode afetar áudio, timers, IPC e janelas siblings; throttling precisa ser por comportamento seguro e testado.
- **Adicionar banco vetorial ou framework de memória:** o snapshot já mostra serviço e fluxo de memória; provar limitação antes de migrar.
- **OpenWakeWord weights padrão em build comercial:** documentação anterior alerta licença não comercial dos modelos; não repetir adoção sem revisar pesos atuais.

## 9. Recomendações priorizadas para Agente Principal

1. **Não reabrir a troca de runtime como solução presumida.** A decisão vigente mantém Electron, mas gate de arquitetura está aberto. Use a oportunidade específica do segundo pacote como uma evidência comparativa.
2. **Fazer baseline Windows antes de otimizar.** Capturar dados por processo e situação de jogo no hardware real. Os números disponíveis atualmente não provam impacto da Lia nem ganho de qualquer otimização.
3. **Transformar `presence.set-budget` em política verificável, não em mais um framework.** Especificar estados e efeitos por capacidade; não mudar o contrato só com base nesta pesquisa.
4. **Reduzir atividade própria em prioridade:** frame cadence, render-on-demand e cancelamento de tarefas são mais seguros e portáveis que alterar prioridade de processos alheios.
5. **Usar APIs Electron de métricas/throttling como base de observabilidade**, depois de inventariar opções atuais por janela e impactos de webContents compartilhado.
6. **Avaliar EcoQoS somente para background CPU dispensável** e atrás de capability de Windows; validar compatibilidade, reversão e deadline de voz.
7. **Manter PAVISE como referência de design de sessão e restauração**, não integrar/copy; nenhuma automação de registro, serviço, afinidade ou PowerShell privilegiado na Lia sem ameaça/consentimento/gate.
8. **Aproveitar memória/provider/voz que já existem:** medir custo e qualidade antes de acrescentar banco/framework/TTS; respeitar escolha local/remota e licenças de pesos já documentadas.
9. **Registrar os limites dos testes no estado operacional:** hipótese, protótipo, medição com mock e sessão real em jogo são classes distintas.

## 10. Dez oportunidades mais relevantes — impacto, viabilidade, custo

Escala qualitativa: impacto **A/M/B** = alto/médio/baixo; viabilidade **A/M/B** = alta/média/baixa (para validar, não promessa de implementação); custo **B/M/A** = baixo/médio/alto. Estimativas sem benchmark, ordenadas por combinação de valor e reversibilidade.

| # | Oportunidade | Impacto | Viabilidade | Custo | Recomendação |
|---:|---|:---:|:---:|:---:|---|
| 1 | Baseline de RAM/CPU/GPU/FPS por processo e estados de jogo no Windows/RX 580 | A | A | B | **Testar agora**; é pré-requisito de decisão |
| 2 | Reduzir custo do segundo Electron do Stage com A/B de pacote e lifecycle | A | M | A | **Protótipo arquitetural**; respeitar gate e isolamento |
| 3 | Política game/idle através de `presence.set-budget` com efeitos e rollback explícitos | A | M | M | **Adaptar** contrato/política já existente após ler código completo |
| 4 | Cap de FPS/ticker e render-on-demand para avatar oculto/ocluído/estático | M-A | A | M | **Prototipar** Pixi e Three separadamente |
| 5 | Observabilidade local via Electron app metrics + ETW, sem logs pessoais | A | A | M | **Integrar/avaliar** ferramentas de diagnóstico já suportadas |
| 6 | Backpressure e pausa cooperativa de tarefas não interativas durante jogo | M-A | M | M | **Prototipar**, com cancelamento/reinício sem corromper estado |
| 7 | EcoQoS para manutenção/CPU background própria em Windows | M | M | M | **Benchmark**; não aplicar a áudio, UI ou provider ativo |
| 8 | Medir custo de contexto e recall do memory service atual, sem novo DB | M | A | B-M | **Adaptar/testar** solução já existente |
| 9 | UX para budget manual: performance/ambient/quiet e exceções de voz | M | M | M | **Estudar** depois de existir efeito demonstrável e safe defaults |
| 10 | Política de jogo que depende de opt-in/foreground e não de screen capture contínuo | M | A | B-M | **Recomendada** como restrição de privacidade para qualquer protótipo |

## 11. Fontes consultadas

### Fontes locais da Lia (commit `ae46c495d7da7cd33f4b4da8f4e8cc95b0a867b6`)

- `docs/project/CURRENT-STATE.md` — status operacional datado.
- `docs/reports/LIA-DESKTOP-RUNTIME-ARCHITECTURE-DECISION.md` — arquitetura e evidência pendente de runtime.
- `docs/architecture/LIA-AGENT-CONSUMPTION-AUDIT.md` — custo de contexto/skills.
- `docs/architecture/LIA-STAGE-ARCHITECTURE.md` — fronteiras e estado do Stage.
- `lia/core/src/host/contracts.ts` — contratos de capacidade/comandos (`presence.set-budget`, `stage.spawn/stop`).
- `airi/apps/stage-tamagotchi/src/main/services/lia/memory-service.ts` — implementação observada no SHA, não validada em runtime.
- `docs/product/M1-CUSTOM-VOICE-LICENSING.md` — fronteira de distribuição AllTalk/XTTS-v2 e restrições comerciais.

### Fontes externas oficiais

- [PAVISE repository](https://github.com/dulaiduwang003/Pavise-Game) · [README/license/releases](https://github.com/dulaiduwang003/Pavise-Game/blob/pavise3x/LICENSE) · [site](https://pavise.club/en/) · [user guide](https://pavise.club/en/docs/v3/) (consulta do repositório: 14/11/2026; README mostrava última atividade 10/11/2026).
- [Microsoft Quality of Service](https://learn.microsoft.com/en-us/windows/win32/procthread/quality-of-service) · [SetProcessInformation](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-setprocessinformation) · [PROCESS_POWER_THROTTLING_STATE](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/ns-processthreadsapi-process_power_throttling_state).
- [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window) · [WebContents](https://www.electronjs.org/docs/latest/api/web-contents) · [app.getAppMetrics](https://www.electronjs.org/docs/latest/api/app#appgetappmetrics) · [powerMonitor](https://www.electronjs.org/docs/latest/api/power-monitor).
- [PixiJS Ticker](https://pixijs.download/dev/docs/ticker.html) · [Performance Tips v8](https://pixijs.com/8.x/guides/concepts/performance-tips) · [PixiJS source](https://github.com/pixijs/pixijs).

## 12. Síntese final

**Melhor solução encontrada:** não é adicionar dependência; é fechar a lacuna de medição do segundo Electron e estabelecer budget por presença sobre o próprio trabalho da Lia.
**Candidato de terceiros mais útil:** PAVISE como fonte de padrões de sessão/allowlist/restauração; não recomendável para integração pelo privilégio, escopo e GPL-3.0.
**Protótipos prioritários:** baseline Windows real; A/B do runtime duplicado; FPS adaptativo Pixi/Three; política de presença; teste EcoQoS somente para CPU background.
**Não fazer:** migrar para outro runtime por promessa de economia; mexer em prioridade/registro de processos do usuário; forçar modelo pago/remoto; adicionar vetor/framework de memória antes de medir o serviço atual.
