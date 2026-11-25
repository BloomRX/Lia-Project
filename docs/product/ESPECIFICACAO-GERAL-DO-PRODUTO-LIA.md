# Especificação Geral do Produto Lia

> **Tipo:** documento vivo de produto — consolidação inicial, não aprovação de todas as funcionalidades.
> **Objetivo:** preservar a visão do produto e dar a agentes e desenvolvedores uma fonte única para saber o que a Lia deve fazer, o que já existe, o que precisa ser construído e como validar a conclusão.
> **Regra de evidência:** “planejado”, “implementado” e “validado” são estados diferentes. Automatizado verde não prova funcionamento no Windows real; ideias e referências visuais não são funcionalidades implementadas.

## 1. Visão do produto

A Lia deve ser uma assistente de desktop acessível a pessoas não técnicas, com identidade visual e comportamento próprios. O usuário deve conseguir instalar, configurar, conversar e personalizar a Lia sem precisar entender detalhes internos de provedores, runtimes, dependências ou modelos.

O produto deve combinar:
- **Launcher próprio:** ponto central para iniciar a Lia, configurar recursos, acompanhar instalação/estado e diagnosticar problemas.
- **Stage próprio:** personagem e presença de desktop, com ciclo de vida controlado pelo Launcher.
- **Experiência de assistente:** conversa, voz, compreensão multimodal e ferramentas, conforme a capacidade efetivamente suportada pelos componentes selecionados.
- **Configuração compreensível:** opções em linguagem normal, explicações junto às escolhas, recomendações compatíveis com o hardware e controles claros de permissões.
- **Identidade Lia:** interface, linguagem, personalidade, padrões e comportamento reconhecíveis como Lia, não apenas uma troca de marca do AIRI.

O Launcher e o Stage próprios vivem em `lia/` e são preparados pela raiz.
A `main` retirou a cópia vendorizada do AIRI em `d6eb8b81`. As integrações
usam contratos da Lia e dependências versionadas com licenças verificadas
conforme o escopo de distribuição.

## 2. Como cada funcionalidade deve funcionar para a pessoa usuária

### 2.1 Launcher e início

- A Home explica o que a Lia pode fazer e apresenta uma ação primária clara para iniciar/conversar.
- O Launcher mostra estados compreensíveis: pronto, preparando, iniciado, falhou e tentando novamente.
- Se uma dependência precisar ser instalada ou preparada, explicar o que vai acontecer, o progresso, o espaço/rede quando conhecido, e como cancelar ou tentar novamente.
- Erros devem ser seguros, localizados em português brasileiro por padrão, acionáveis e sem expor segredos, tokens ou logs brutos.
- O encerramento deve fechar de forma gerenciada os processos iniciados pela Lia, sem deixar processos órfãos.
- A experiência deve continuar utilizável por alguém que não conhece nomes de modelos, APIs, Node, Electron ou provedores.

### 2.2 IA, provedores e modelos

- Apresentar opções por finalidade e resultado esperado; nomes técnicos podem aparecer em detalhes avançados.
- Explicar limitações relevantes, por exemplo suporte a texto, imagem, áudio, ferramentas, idioma, rede e custo, apenas quando confirmadas.
- Permitir selecionar e configurar um provedor/modelo suportado, validar a configuração sem revelar credenciais e mostrar erros de autenticação de forma segura.
- Recomendações automáticas devem ser explicáveis e não podem alterar preferências explícitas silenciosamente.
- Não anunciar capacidades como disponíveis se não passaram pelos testes correspondentes.

### 2.3 Conversa

- Oferecer histórico e seleção de conversas consistentes entre as janelas pertinentes.
- Mostrar respostas progressivamente quando o transporte suportar streaming, preservando espaços, quebras de linha e conteúdo final.
- Diferenciar sucesso, resposta vazia, erro recuperável, erro permanente e pedido recusado por limite; não tratar stream vazio como resposta bem-sucedida.
- Preservar rascunho, anexos e contexto ao falhar ou tentar novamente, salvo se o usuário decidir descartá-los.
- Exibir texto técnico de raciocínio interno apenas conforme política explícita de produto; não o misturar à resposta normal nem mostrar placeholders técnicos ao usuário.
- Evitar que falhas de um pedido contaminem a conversa seguinte.

### 2.4 Imagens, áudio e multimodalidade

- A interface deve indicar o que foi anexado e quais tipos de conteúdo o modelo selecionado consegue processar.
- A Lia só deve afirmar que compreendeu uma imagem/áudio quando a resposta do modelo realmente sustentar essa conclusão; a validação deve incluir perguntas com resposta verificável.
- Respeitar limites de quantidade/tamanho e explicar recusas sem apagar anexos ou texto.
- **Imagem:** gate de conteúdo no aplicativo permanece pendente/reprovado no estado operacional atual; não marcar como concluído até passar o teste real definido em `docs/project/CURRENT-STATE.md`.
- **Áudio de entrada:** distinguir reconhecimento de fala (STT) de compreensão direta de áudio pelo modelo. O suporte direto a áudio não está aprovado só porque STT existe.
- **Voz de saída:** permitir escolher entre as opções realmente suportadas, ouvir prévia quando disponível, testar o dispositivo e recuperar-se de falhas.
- **Voz personalizada:** apresentar requisitos, tempo, espaço, compatibilidade e licenças antes de instalar ou baixar modelos. Não assumir suporte a AMD/Vulkan sem teste no hardware-alvo.

### 2.5 Stage, personagem e presença no desktop

- O Stage deve ser um componente próprio do produto Lia, com fronteira definida entre visual, estado da personagem, conversa e runtime de IA.
- O Launcher deve poder iniciar, observar, reiniciar e encerrar o Stage com resultados explícitos e sem processos órfãos.
- O modo atual inspirado no Tamagotchi pode continuar como opção durante a transição, se for mantido e validado.
- **Modo livre/multimonitor:** ideia de produto já registrada, mas ainda precisa de especificação detalhada. Definir movimento, limites de tela, troca de monitor, DPI/escalas diferentes, múltiplos monitores, recuperação após desconectar monitor, interação com janelas, pausa/retorno e persistência da preferência.
- A escolha de modo de presença deve ser clara, persistente e reversível; não impor o modo livre a quem prefere o comportamento tradicional.
- Aparência, animações e interações da Lia devem ter identidade própria. Não declarar uma aparência canônica antes de escolher e validar os assets e suas licenças.

### 2.6 Voz e interação por microfone

- Permitir configurar entrada e saída de áudio e testar os dispositivos.
- Deixar explícito quando o microfone está ativo; oferecer controles para interromper a captura e revogar a permissão.
- Separar STT, modelo conversacional e TTS na arquitetura, para que trocar uma voz não obrigue a trocar todo o cérebro da Lia.
- Mostrar estado de instalação, carregamento, disponibilidade e falha do mecanismo de voz.
- Voz natural, clonagem/personalização e seleção de engine são áreas em evolução: cada engine precisa de avaliação de qualidade, idioma, latência, hardware, privacidade e licença antes de ser oferecida como opção estável.

### 2.7 Personalidade e aparência

- Oferecer presets de personalidade com descrições compreensíveis do efeito esperado.
- Quando tecnicamente possível, permitir prévia antes de aplicar e voltar ao padrão.
- Distinguir personalidade (tom e comportamento) de aparência (modelo, roupa, expressão, animação).
- Preservar a escolha do usuário e não reescrever histórico ou preferências ao trocar um preset.
- Os controles atuais são parciais; a experiência completa de traços, presets e prévia ainda precisa ser projetada e validada.

### 2.8 Ferramentas e permissões

- Exibir um catálogo de ferramentas com descrição do que cada uma faz, estado de maturidade e permissões necessárias.
- Pedir consentimento claro antes de habilitar capacidades sensíveis; disponibilizar desligamento fácil.
- Mostrar quais ferramentas foram usadas em uma ação quando isso for relevante para compreensão e confiança.
- Uma ferramenta só é considerada funcional quando o ciclo completo — decisão do modelo, validação de argumentos, execução, retorno e tratamento de falhas — estiver testado; transporte ou schema isolados não bastam.
- Não habilitar integração externa por padrão sem explicar dados enviados, permissões e implicações.

### 2.9 Histórico, memória, sincronização e privacidade

- Distinguir histórico de conversas, preferências persistentes e memória semântica. Não prometer memória semântica enquanto ela não estiver implementada e validada.
- Explicar onde os dados ficam armazenados e quais recursos os enviam a serviços externos.
- Sincronização deve declarar claramente quais dados sincroniza e como trata imagens, anexos, conflitos e falhas.
- Fornecer formas compreensíveis de limpar ou exportar dados quando esses recursos forem implementados.
- Nunca registrar ou exibir chaves de API, tokens, segredos ou conteúdo sensível em logs de diagnóstico.

### 2.10 Diagnósticos, atualizações e distribuição

- Diagnósticos devem separar verificações aprovadas, falhas, avisos e itens não testados.
- Oferecer orientação prática para corrigir problemas, sem esconder informação necessária para suporte.
- Atualizações devem mostrar origem, versão, compatibilidade e resultado; preservar configuração e dados pessoais.
- O instalador Windows deve ser testado em uma instalação limpa, com caminhos que incluam espaços e sem depender de ferramentas de desenvolvimento presentes na máquina.
- A release não está concluída até que o fluxo real de instalação, inicialização, conversa, Stage, voz (se anunciada) e encerramento passe nos gates definidos.

## 3. Inventário de funcionalidades e estado conhecido

O quadro descreve o desktop próprio consolidado na `main`. Resultados
históricos do Stage anterior permanecem nos relatórios que os produziram.

| Área | Evidência do desktop próprio | Próxima lacuna principal |
|---|---|---|
| Launcher e IA | Entrada pela raiz e configuração de modelos no Launcher. Gate NSIS confirmou abertura do Stage. | Regressão visual e de acessibilidade de todas as telas. |
| Conversa e histórico | Conversa local com Qwen, retomada, exclusão e múltiplas conversas. A troca sintética também passou na janela aberta pelo Launcher instalado. | Provedores externos reais e equivalência de streaming. |
| Imagem | Anexo e resposta com provedor HTTPS sintético, incluindo rejeição sem rota de visão. | Gate de conteúdo em serviço real. |
| Ferramentas | Relógio local autorizado para um envio e catálogo publicado do Agent Hub em leitura. | Orquestração supervisionada e integração de execução. |
| TTS e STT | Kokoro CPU com reprodução silenciada, Whisper CPU e consentimento de fala remota com serviços sintéticos. | Áudio físico, vozes clonadas e matriz de provedores externos. |
| Personalidade e memória | Traços editáveis, importação textual CCv3 e notas locais sob controle do usuário. | Extensões de cartões e memória semântica. |
| Avatar e presença | VRM, animação embutida, movimento, pausa, ocultação e posicionamento no segundo monitor. | Live2D, tela cheia, desconexão física e métricas com jogos. |
| Conta e dados | Cofre DPAPI, credenciais processadas em Main e consentimento de voz no desktop próprio. | OIDC integrado, revogação com emissor real e sincronização. |
| Distribuição | Instalador NSIS privado e ensaio de upgrade com preservação de perfil sintético e cofre. | Atualização automática, assinatura e direitos para distribuição pública. |


Referências de estado: [CURRENT-STATE.md](../project/CURRENT-STATE.md), [QUANTO-FALTA.md](../project/QUANTO-FALTA.md), [relatório de finalização Windows](RELEASE-WINDOWS-2026-10-20.md) e [índice de documentos](../README.md). Se houver divergência, `CURRENT-STATE.md` é a fonte de verdade operacional para o estado de execução, e esta especificação é a fonte de intenção de produto.

## 4. O que existe, o que reutilizar e o que construir como Lia

### 4.1 Reutilizar quando comprovado

- Implementações históricas avaliadas por comportamento, licença e contrato antes de portá-las para os pacotes próprios.
- Adaptadores de provedores, streaming, STT/TTS, histórico ou ferramentas, após auditoria de dependências, comportamento, licença e testes.
- Infraestrutura e harnesses de teste úteis, sem assumir que testes de componente validam o produto inteiro.

### 4.2 Construir como produto Lia

- Launcher e sua experiência de configuração/onboarding.
- Stage e presença da personagem com identidade e ciclo de vida definidos pela Lia.
- Contratos explícitos entre Launcher, Stage, conversa, voz e runtime.
- Configurações, recomendações, mensagens de erro, permissões e diagnósticos orientados a usuários não técnicos.
- Identidade visual, padrões de interação, presets e defaults de produto.

### 4.3 Regras de arquitetura

- A implementação independente da Lia deve morar em `lia/` conforme o plano de migração, sem mover ou apagar código enquanto o agente de auditoria/migração estiver trabalhando sem antes verificar o estado do checkout.
- Não copiar todo o Stage upstream como atalho sem entender responsabilidades, dependências e licenças.
- Isolar integrações reutilizadas por adaptadores/contratos para permitir substituir engines individuais.
- Alterações em Launcher, Stage e runtime passam por testes de compatibilidade, instalação e encerramento em Windows. As lacunas de equivalência com o legado ficam documentadas.
- Registrar a origem e a atribuição de código ou assets portados, com evidência do comportamento atual.

## 5. Prioridade de produto e versões

Esta ordem é uma proposta inicial para evitar dispersão; não substitui as fases técnicas existentes nem autoriza ignorar bloqueios registrados.

### P0 — Base confiável para uso diário
1. Conversa textual robusta, streaming correto, erros seguros e histórico consistente.
2. Inicialização/encerramento confiáveis no Windows.
3. Configuração de IA compreensível e credenciais protegidas.
4. Stage mínimo próprio com fronteiras e ciclo de vida claros.
5. Diagnósticos úteis e testes de regressão.
6. Passar o gate real de compreensão de imagens antes de anunciar esse recurso como estável.
7. Validar o loop completo de ferramentas antes de anunciar ferramentas como confiáveis.

### P1 — Experiência de companheira
1. Identidade visual própria, aparência selecionável e personalidade com presets.
2. Presença configurável: Tamagotchi e modo livre/multimonitor.
3. Fluxo de voz de ponta a ponta, com seleção de dispositivos, engine e idioma claramente suportados.
4. Páginas próprias para voz, personalidade, aparência, presença e ferramentas.
5. Instalador Windows validado em ambiente limpo.

### P2 — Expansão controlada
1. Novos mecanismos de voz, incluindo opções locais e aceleração AMD/Vulkan apenas após benchmarks reproduzíveis.
2. Compreensão direta de áudio, se houver modelo compatível e benefício comprovado.
3. Memória semântica, exportação e sincronização ampliada, somente após decisões explícitas de privacidade e comportamento.
4. Mais integrações e ferramentas, com permissões, maturidade e falhas documentadas.
5. Melhorias contínuas de animação, interação e suporte a múltiplos monitores.

Prioridades podem mudar por decisão do responsável pelo produto, mas a alteração deve ser registrada aqui e refletida no estado operacional.

## 6. Critérios objetivos para considerar uma funcionalidade concluída

Cada funcionalidade deve ter um pequeno contrato que inclua:

1. **Objetivo do usuário:** qual problema resolve e qual resultado ele observa.
2. **Escopo e limites:** o que faz, o que não faz e quais dependências exige.
3. **UX:** estado normal, carregamento, sucesso, falha, cancelamento, retry e acessibilidade/localização pertinentes.
4. **Privacidade e permissões:** dados acessados/enviados, consentimento e comportamento dos logs.
5. **Implementação:** localização do código, interface pública e adaptadores, quando aplicáveis.
6. **Testes:** testes unitários/contratuais e integração; E2E real quando a capacidade depende de provider, dispositivo, GPU, áudio, rede ou runtime.
7. **Evidência:** comando, ambiente, resultado, data e relatório reproduzível.
8. **Estados explícitos:** `NOT STARTED`, `PLANNED`, `PARTIAL`, `BLOCKED`, `PASS AUTOMATED`, `PASS WINDOWS REAL` ou `FAIL`. Não usar “concluído” sem evidência adequada ao risco.
9. **Recuperação:** erro não deve perder rascunhos, anexos, preferências ou dados já salvos sem decisão explícita do usuário.
10. **Documentação:** atualizar esta especificação, `CURRENT-STATE.md` e o relatório da rodada quando o estado operacional mudar.

### Gates mínimos por tipo

- **Interface:** teste de componentes/contratos + inspeção visual no runtime alvo para declarar a tela validada.
- **Provider/modelo:** requisição real com configuração segura e resultado semanticamente correto; HTTP 200 isolado não basta.
- **Imagem/áudio:** amostras determinísticas e resposta correta no fluxo do aplicativo, não apenas numa chamada direta ao serviço.
- **Ferramenta:** ciclo completo de chamada e retorno, com argumentos inválidos e falhas cobertos.
- **Voz:** teste de microfone/saída real no dispositivo e idioma anunciados; testes simulados são complementares.
- **Stage:** abrir, renderizar, interagir conforme o escopo, sobreviver a falha recuperável e encerrar sem processos órfãos.
- **Instalador:** instalação limpa e execução sem ferramentas de desenvolvimento pré-instaladas.
- **Compatibilidade de hardware:** teste no hardware e backend anunciados; não inferir suporte Vulkan/CUDA/AMD pela dependência compilar.

## 7. Ideias que precisam de decisão explícita

Não considerar estes itens decisões fechadas apenas por constarem na lista:

- Como exatamente a Lia se movimenta no modo livre, e se caminha de um monitor a outro ou apenas se reposiciona.
- Quais animações, expressões e assets serão canônicos.
- Quais presets de personalidade e controles de comportamento serão oferecidos.
- Quais engines de voz serão opções oficiais e quais idiomas/hardwares cada uma suportará.
- Se e como haverá memória semântica, sincronização ampliada e exportação de dados.
- Quais ferramentas externas virão desativadas por padrão e como cada permissão será solicitada.
- Qual conjunto de funcionalidades será o primeiro release público e quais podem ficar em preview.

Decisões devem registrar alternativas consideradas, escolha, motivo, impacto e data — sem transformar uma hipótese técnica em promessa de produto.

## 8. Como manter este documento

- Antes de iniciar uma funcionalidade: consultar esta especificação, `CURRENT-STATE.md` e o plano específico da área.
- Ao terminar trabalho: atualizar o estado da linha correspondente e registrar evidência no relatório de rodada; atualizar `CURRENT-STATE.md` se o estado operacional ou o próximo passo mudar.
- Se dois documentos divergirem: esta especificação governa intenção e comportamento desejado; `CURRENT-STATE.md` governa o que foi realmente executado/validado; relatórios de rodada guardam evidências históricas.
- Não apagar ideias ainda não implementadas: movê-las para P1/P2 ou para a seção de decisões pendentes.


## 9. Visão ampliada: inteligência digital pessoal

A direção de longo prazo da Lia é ser uma inteligência digital pessoal persistente, com identidade própria, personalidade coerente, memória controlável, percepção contextual, raciocínio, planejamento, decisão e ação por capacidades autorizadas. A experiência pode parecer a de uma companheira digital viva, sem afirmar consciência ou sentimentos humanos reais. Modelos e provedores são motores substituíveis; não definem a identidade da Lia.

A inspiração combina atributos de JARVIS (integração e execução contextual), Samantha (continuidade e conversa natural), Cortana (análise e estratégia), TARS (humor configurável) e outras referências de presença digital. São referências criativas, não especificações para copiar personagens.

A visão completa de cérebro, identidade, personalidade, memória, autonomia, Agent Hub, desktop, jogos, casa inteligente, voz, presença, segurança e roadmap está em [LIA-COGNITIVE-ARCHITECTURE.md](../architecture/LIA-COGNITIVE-ARCHITECTURE.md). Esse documento é arquitetura-alvo e não altera o estado de implementação.

## 10. Requisitos de cognição, memória e autonomia

- Identidade e personalidade devem ser estruturadas, versionadas e independentes do modelo selecionado. Estados afetivos são expressivos/simulados, não alegações de sentimento real.
- Memória deve distinguir histórico, preferências e memória persistente; considerar dimensões episódica, semântica, procedural, autobiográfica factual, de projetos, temporal e multimodal. Nenhuma delas deve ser anunciada como funcional sem implementação e evidência.
- Avaliar arquitetura híbrida de armazenamento estruturado, Markdown portável, busca lexical, índices semânticos/vetoriais e relações/temporalidade. Não escolher Obsidian/Markdown como solução exclusiva nem afirmar embeddings sem consumidor real.
- Decisões devem considerar intenção, alternativas, risco, custo, privacidade, permissão, confiança e reversibilidade. Ações de alto impacto exigem confirmação.
- Autonomia deve ser graduada, delimitada, auditável e interruptível; nunca irrestrita.
- Ação só é concluída quando o resultado é observado e verificado, não quando uma ferramenta apenas aceita o pedido.

## 11. Integração do ecossistema e capacidades futuras

O Lia Agent Hub já é um componente existente do ecossistema e deve ser aproveitado. Lia-Project mantém identidade, personalidade, memória pessoal, objetivos, decisões, permissões e experiência. O Hub fornece capacidades de agentes, skills, ferramentas, MCP e orquestração conforme contratos efetivamente auditados. Contexto enviado deve ser mínimo e autorizado; catálogo não equivale a permissão. A Lia deve continuar funcional quando o Hub estiver indisponível.

A visão inclui programação e trabalho em projetos, operação assistida do desktop, jogos (observadora, comentarista, assistente estratégica ou parceira quando permitido) e casa inteligente. Essas capacidades dependem de integrações seguras, termos de uso, anti-cheat, consentimento, limites e validação específica. Durante jogos, o desempenho do jogo tem prioridade.

Lia-Project, Lia Agent Hub, Lia Research, Lia Model Lab, Lia Forge e Lia Studio permanecem projetos independentes integrados por contratos e artefatos versionados, sem acoplamento indiscriminado.

## 12. Regra de rastreabilidade da visão

Cada capacidade futura deve ligar requisito → decisão arquitetural → módulo/código → teste → evidência e estado. Usar estados distintos para visão, pesquisa, proposta, planejamento, implementação, validação automatizada, validação real, bloqueio e não execução. Pesquisa não é aprovação; implementação não é validação; teste automatizado não substitui prova no ambiente real.
