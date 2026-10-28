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

A arquitetura e o código devem permitir que Launcher e Stage da Lia vivam sob `lia/`. Componentes do AIRI ou de terceiros podem ser reutilizados quando houver benefício técnico, compatibilidade de licença e limites claros; a interface de produto e os contratos da Lia não devem depender de copiar indiscriminadamente o Stage upstream.

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

Os estados abaixo são conservadores e refletem os documentos de estado e o relatório de finalização disponíveis na criação desta especificação. Atualizar as evidências quando o código ou os testes mudarem.

| Área | Estado documentado | Próxima lacuna principal |
|---|---|---|
| Launcher / Home | Parcial; abertura e fluxo básico validados em Windows | Consolidar UX de produto e validar visualmente todas as páginas |
| Configuração de IA | Parcial | Página própria e opções normais sem expor IDs técnicos |
| Conversa textual | Base implementada; teste real de resposta 42 aprovado | Continuar regressões e UX de falhas |
| Streaming e preservação de texto | Correções testadas, incluindo whitespace | Manter cobertura real do serviço separada do transporte sintético |
| Compreensão de imagens | **Gate de conteúdo FAIL/pendente** | Corrigir e passar o teste de conteúdo no app real |
| Chamada de ferramentas | Parcial | Validar loop completo ponta a ponta |
| STT / cadeia de voz gerenciada | PASS histórico no Windows | Novo teste humano de microfone e validação da experiência completa |
| Compreensão direta de áudio | Não iniciada | Definir escopo e provider compatível |
| TTS / escolha de engine | Infraestrutura parcial/em evolução | Validar opções, idiomas, qualidade, hardware e licença |
| Personalidade | Parcial | Tela de traços, presets e prévia |
| Aparência | Parcial | Seleção e assets canônicos da Lia |
| Presença Tamagotchi | Base existente | Validar e preservar durante a migração |
| Presença livre/multimonitor | Ideia; contrato incompleto | Especificar e implementar em `lia/stage/` |
| Ferramentas e permissões | Infraestrutura parcial | UX de catálogo, consentimento e teste E2E |
| Histórico | Base existente | Validar consistência e ações de usuário |
| Memória semântica | Não prometida/não confirmada | Só especificar após decisão explícita de produto |
| Cloud Sync | Parcial, com limitações registradas | Definir dados, anexos, conflitos e falhas |
| Diagnósticos | Página existente | Revisar tradução, privacidade e orientação de recuperação |
| Instalador/release Windows | **Não validado como release final** | Teste limpo de instalação e fluxo completo |

Referências de estado: [CURRENT-STATE.md](../project/CURRENT-STATE.md), [QUANTO-FALTA.md](../project/QUANTO-FALTA.md), [relatório de finalização Windows](RELEASE-WINDOWS-2026-10-20.md) e [índice de documentos](../README.md). Se houver divergência, `CURRENT-STATE.md` é a fonte de verdade operacional para o estado de execução, e esta especificação é a fonte de intenção de produto.

## 4. O que existe, o que reutilizar e o que construir como Lia

### 4.1 Reutilizar quando comprovado

- Lógica e serviços do AIRI que já resolvem um problema real e podem ser separados por interfaces estáveis.
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
- Isolar integrações reutilizadas por adaptadores/contratos para permitir substituir AIRI ou engines individuais.
- A migração deve ser incremental e reversível. O Stage atual só pode ser removido depois que o Stage Lia abrir, comunicar-se, encerrar-se e passar pelos testes equivalentes.
- Atualizar a documentação de modificações do AIRI e a comparação com upstream para cada decisão de manter, portar ou descartar uma mudança.

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
