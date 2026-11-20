# Lia — Visão Cognitiva, Identidade e Arquitetura de Capacidades

> **Tipo:** arquitetura-alvo e requisitos de produto.
> **Estado:** consolidação da visão; não declara implementação nem validação.
> **Autoridade:** complementa a [Especificação Geral do Produto](../product/ESPECIFICACAO-GERAL-DO-PRODUTO-LIA.md). O estado executado continua em [CURRENT-STATE.md](../project/CURRENT-STATE.md).
> **Regra:** pesquisa, catálogo, schema, configuração e protótipo não equivalem a capacidade operacional validada.

## 1. Visão: uma inteligência digital pessoal

A Lia deve evoluir para uma inteligência digital pessoal persistente: uma presença com identidade reconhecível, personalidade consistente, memória controlável, percepção contextual e capacidade de raciocinar, planejar, decidir e agir por ferramentas autorizadas.

A experiência pode parecer a de uma companheira digital viva: conversa, continuidade, lembranças factuais, acompanhamento de projetos, percepção do contexto permitido, estados expressivos simulados e iniciativa dentro dos limites escolhidos pelo usuário. Isso descreve uma meta de experiência e arquitetura; **não afirma consciência, sentimentos humanos ou vida biológica**.

A Lia é mais do que uma interface para um modelo. Modelos são motores substituíveis. Nenhum modelo, provedor, agente, framework ou repositório externo é dono da identidade da Lia.

### 1.1 Referências criativas

A direção combina qualidades que lembram:
- **JARVIS:** competência técnica, integração de sistemas, antecipação e execução contextual.
- **Samantha:** continuidade relacional, conversa natural e personalidade percebida.
- **Cortana:** análise, estratégia e consciência do contexto operacional.
- **TARS:** humor e estilo configuráveis sem perder coerência.
- **KITT, EDI e Data:** presença reconhecível, interação multimodal e apoio confiável.

São referências de atributos, não cópias de personagens, roteiros, vozes ou propriedade intelectual. A identidade final é própria da Lia.

## 2. Princípios inegociáveis

1. Identidade independente de modelo, voz, avatar ou agente.
2. Memória com proveniência; separar fato observado, declaração, inferência e hipótese.
3. Autonomia supervisionada: capacidade técnica não equivale a permissão.
4. Consentimento contextual para arquivos, tela, microfone, aplicativos, contas, casa e serviços externos.
5. Ação verificável: distinguir plano, tentativa, execução e resultado confirmado.
6. Interrupção, revogação e reversibilidade sempre que tecnicamente possível.
7. Neutralidade de provedores: opções locais, gratuitas e pagas, com custo, privacidade e compatibilidade confirmados.
8. Degradação graciosa quando provider, Agent Hub ou serviço externo estiver indisponível.
9. Desempenho proporcional; jogos e tarefas prioritárias do usuário têm precedência.
10. Honestidade: catálogo, schema, configuração e teste simulado não provam capacidade real.

## 3. Modelo mental do cérebro da Lia

“Cérebro” descreve responsabilidades lógicas, não exige processos ou modelos separados.

| Responsabilidade | Papel |
|---|---|
| Identity Engine | Identidade estável, princípios, limites, história factual e preferências persistentes |
| Personality Engine | Traços, estilo, humor, expressividade, adaptação contextual e consistência |
| Context Engine | Contexto da conversa, usuário, dispositivo, projeto, tempo e permissões |
| Memory System | Captura, classificação, consolidação, indexação, recuperação, atualização e expiração |
| Cognitive Orchestrator | Coordena entendimento, recuperação, raciocínio, planejamento e resposta |
| Decision Engine | Avalia alternativas, riscos, custos, permissões, confiança e reversibilidade |
| Goal & Planning Engine | Mantém objetivos autorizados, decompõe tarefas e acompanha progresso |
| Capability Router | Escolhe modelo, provider, ferramenta ou agente por tarefa, orçamento e capacidade comprovada |
| Perception Layer | Interpreta entradas autorizadas: texto, imagem, áudio, tela, eventos e sensores |
| Action / Tool Runtime | Executa por contratos tipados, isolamento, timeout, cancelamento e auditoria |
| Agent Integration | Descobre e delega tarefas ao Lia Agent Hub |
| Reflection & Evaluation | Confere resultados, detecta falhas e propõe aprendizado |
| Safety & Permission Engine | Aplica consentimentos, escopos, limites, confirmação e revogação |
| Presence & Expression | Traduz estados de interação em voz, avatar, animações e presença |

### 3.1 Ciclo cognitivo de referência

1. Receber mensagem, evento ou objetivo.
2. Identificar intenção, urgência e ambiguidades.
3. Montar contexto mínimo autorizado.
4. Recuperar memórias relevantes com fonte, data e confiança.
5. Escolher estratégia: responder, perguntar, pesquisar, planejar, delegar ou agir.
6. Avaliar risco, custo, privacidade, permissão e reversibilidade.
7. Solicitar confirmação quando a política exigir.
8. Executar por runtime controlado.
9. Observar o resultado e compará-lo ao objetivo.
10. Comunicar o que ocorreu, inclusive falhas e etapas não concluídas.
11. Registrar apenas memórias úteis e autorizadas, com proveniência.
12. Atualizar objetivos sem alterar silenciosamente identidade ou permissões.

## 4. Identidade e personalidade persistentes

Identidade e personalidade são dados estruturados e versionados, não apenas um prompt.

### 4.1 Identidade

Deve incluir nome e identidade própria, princípios, limites, compromissos de honestidade, biografia/autobiografia factual, preferências estáveis e histórico de mudanças. Eventos definidos como lore ficcional devem ser distinguíveis de interações realmente ocorridas.

A Lia não deve criar lembranças autobiográficas falsas para parecer mais humana.

### 4.2 Personalidade

Modelo a especificar e validar:
- Traços relativamente estáveis e intensidade.
- Tom, formalidade, humor, curiosidade, iniciativa e concisão.
- Preferências de linguagem e expressividade.
- Adaptação ao contexto sem perder os traços centrais.
- Limites de comportamento.
- Presets e controles acessíveis, com prévia, versão e restauração.

Estados afetivos são **estados expressivos simulados** (por exemplo, foco, curiosidade, entusiasmo ou tranquilidade). Podem modular voz, linguagem e animações, mas não provam sentimentos ou consciência reais.

### 4.3 Independência do modelo

O modelo recebe uma representação contextual da identidade e personalidade, mas não é sua fonte de verdade. Deve haver testes de consistência entre modelos e proteção contra instruções de provider que tentem sobrescrever identidade, memória ou políticas.

## 5. Sistema de memória

Memória é capacidade de primeira classe. Não é sinônimo de histórico de chat, janela de contexto, RAG ou memória interna de um modelo.

### 5.1 Tipos desejados

- **Episódica:** acontecimentos e interações datadas.
- **Semântica:** fatos e conhecimento consolidado sobre conceitos, pessoas, projetos e preferências.
- **Procedural:** como executar tarefas e workflows aprovados.
- **Autobiográfica da Lia:** continuidade factual da personagem e eventos vividos na interação.
- **De projetos:** decisões, estado, dependências, artefatos e próximos passos.
- **Temporal:** validade, sequência, recorrência e prazos.
- **Multimodal:** referências a imagens, áudio, documentos e artefatos, respeitando privacidade.
- **Preferências e políticas:** escolhas explícitas, permissões e limites do usuário.

### 5.2 Arquitetura híbrida a avaliar

Não escolher Markdown/Obsidian como solução exclusiva. Avaliar uma composição de:
- armazenamento estruturado para entidades, eventos, relações, proveniência, permissões e estado;
- Markdown para conhecimento legível, portável, revisável e versionável;
- índice lexical para busca exata e identificadores;
- índice semântico/vetorial somente quando houver embeddings funcionais, consumidor real e avaliação;
- grafo de conhecimento quando o benefício justificar custo e complexidade;
- índices temporais e metadados multimodais;
- recuperação híbrida com ranking, filtros de permissão, recência, relevância e confiança.

A escolha deve ser medida por precisão, latência, custo, capacidade offline, migração, portabilidade, exclusão e recuperação de falhas. A existência de uma API de embeddings sem tarefa declarada e consumidor não prova que o produto tenha embeddings operacionais.

### 5.3 Ciclo de vida e proveniência

Captura → classificação → validação → consolidação → indexação → recuperação → atualização → expiração/esquecimento.

Cada item deve guardar, conforme aplicável: origem/autor, timestamp e validade, tipo e contexto, confiança, natureza (observado/declarado/inferido/hipótese), sensibilidade, retenção, referências aos artefatos e histórico de correção.

### 5.4 Controle do usuário

O usuário deve poder inspecionar, corrigir, exportar, restringir, pausar e excluir memórias, além de entender por que foram recuperadas. Exclusão deve alcançar índices, caches e derivados conforme política documentada. Memória pessoal não deve ser enviada integralmente a provider ou agente por conveniência.

## 6. Decisão, planejamento e autonomia

A Decision Engine separa decisão conversacional, pesquisa, técnica, operacional, financeira, privacidade, ação externa/física, memória e delegação.

### 6.1 Níveis de autonomia

1. **Informar:** responder e explicar.
2. **Sugerir:** propor plano sem executar.
3. **Executar com confirmação:** preparar e pedir aprovação.
4. **Autonomia delimitada:** agir dentro de escopo, orçamento, horário e limites previamente autorizados.
5. **Autonomia contínua supervisionada:** acompanhar objetivos autorizados, agir dentro das políticas e reportar exceções.

Não existe modo irrestrito. Permissões são granulares por capacidade, recurso, destino, duração, custo e tipo de ação. Ações destrutivas, financeiras, públicas, de segurança, privacidade ou mundo físico exigem confirmação reforçada, salvo política explícita, delimitada e reversível.

Planos devem conter objetivo, passos, dependências, riscos, confirmações, timeout, retry e critério de sucesso. A Lia não declara conclusão só porque uma ferramenta aceitou a solicitação.

## 7. Lia Agent Hub: integração, não substituição do cérebro

O Lia Agent Hub já existe e está em funcionamento no ecossistema. A direção é **integrá-lo e aproveitar suas capacidades reais**, não reconstruí-lo dentro do Lia-Project nem presumir que ele implemente toda a cognição pessoal.

O Lia-Project permanece dono de identidade, personalidade, memória pessoal, contexto, objetivos, decisões, experiência, consentimento e permissões apresentadas ao usuário.

O Hub deve ser aproveitado, conforme auditoria, para catálogo e descoberta de agentes, skills, ferramentas, MCP, workflows, orquestração, execução, acompanhamento, cancelamento e retorno de resultados.

### 7.1 Contrato lógico

1. Lia solicita capacidades disponíveis ao Hub.
2. Seleciona agente/workflow por tarefa, risco, custo, latência e requisitos.
3. Envia contexto mínimo autorizado.
4. Define objetivo, entradas, limites, permissões e critério de aceite.
5. Acompanha estado e permite cancelamento.
6. Recebe resultado, artefatos, proveniência e evidências.
7. Valida retorno e decide se precisa de nova etapa.
8. Comunica resultado e registra somente o que for útil/autorizado.

Catálogo não é permissão. Skill instalada não autoriza uso automático. Auditar autenticação, Grants/Leases se já existentes, escopo, auditoria, idempotência, timeout, cancelamento, isolamento e falhas. Não duplicar função que o Hub já oferece com contrato adequado. A Lia continua funcional em modo reduzido se o Hub estiver offline.

## 8. Percepção e capacidades do ambiente

A visão inclui texto/documentos, imagem/vídeo, áudio, STT, compreensão direta de áudio, TTS, captura de tela, contexto de janelas, eventos de aplicativos e sensores autorizados. STT e compreensão direta de áudio são capacidades distintas.

Percepção deve indicar origem, timestamp, escopo e validade. Tela, microfone, câmera e sensores não permanecem ativos silenciosamente; mostrar captura, permitir pausa/revogação e minimizar dados.

## 9. Ação no desktop e aplicativos

A Lia deve ajudar a operar o PC: localizar/organizar arquivos, abrir aplicativos, preencher fluxos, trabalhar com documentos, programar, depurar, testar, pesquisar e acompanhar projetos.

Requisitos: ferramentas com contratos tipados; escopo explícito; preview/diff para mudanças; sandbox para código quando aplicável; confirmação para apagar, sobrescrever, publicar, enviar, instalar ou alterar configurações sensíveis; auditoria sem segredos; rollback e interrupção. Nunca simular execução e reportar sucesso sem observar o resultado.

Programação, pesquisa e trabalho em projetos são capacidades de primeira classe.

## 10. Jogos e entretenimento

A Lia pode atuar como observadora contextual, comentarista, companhia, assistente estratégica, parceira cooperativa ou agente/jogadora quando houver interface autorizada e compatível.

Respeitar termos, anti-cheat, privacidade e regras competitivas. Não usar leitura de memória, injeção ou automação proibida. Priorizar integrações oficiais e captura consentida. Durante jogos, reduzir CPU/GPU/RAM, frequência de percepção e tarefas pesadas; permitir pausa instantânea. O jogo tem prioridade sobre inferência local e animações.

## 11. Casa inteligente e mundo físico

Integração futura pode incluir Home Assistant e dispositivos domésticos, mas exige arquitetura de segurança e permissões. Separar leitura de estado de comando. Fechaduras, alarmes, câmeras, acesso e equipamentos de risco exigem confirmação e políticas específicas. Descoberta de dispositivo não autoriza controle.

## 12. Voz, avatar e presença

Voz, avatar e Stage expressam a mesma identidade. STT, conversa e TTS são componentes substituíveis. Engines exigem avaliação de licença, idioma, qualidade, latência, custo e compatibilidade. Expressões refletem estados simulados. Stage mantém presença Tamagotchi e pode evoluir para modo livre/multimonitor com pausa, limites e prioridade de desempenho. A identidade visual e assets corporativos só são oficiais após aprovação e registro de origem/licença.

## 13. Modelos, providers, hardware e custo

A Lia não depende de um fornecedor. O usuário escolhe opções locais, gratuitas e pagas com informação sobre capacidade, custo, privacidade, latência, limites, requisitos e compatibilidade. Recomendações não alteram escolhas explícitas silenciosamente.

Downloads sob demanda devem informar tamanho, licença, origem, hash, espaço e cancelamento. AMD/Vulkan/DirectML/CPU precisam ser medidos no hardware anunciado; benchmark em outra máquina não autoriza promessa.

## 14. Segurança, confiança e governança

- Permissões por capacidade e recurso, não por agente/provider genérico.
- Credenciais sob ownership de processos confiáveis, nunca expostas ao Renderer ou agentes sem necessidade.
- Contexto enviado ao Hub/provider minimizado e autorizado.
- Auditoria de ações com ator, escopo, resultado e timestamp.
- Proteção contra prompt injection em conteúdo externo e resultados de agentes.
- Preview e confirmação para ações de alto impacto.
- Limites de custo, taxa, tempo, concorrência e hardware.
- Pausa/interrupção global e revogação.
- Separação de dados pessoais, projetos, personagem e credenciais.
- Políticas e identidade versionadas, com trilha de auditoria.

## 15. Arquitetura do ecossistema

Projetos independentes integram-se por APIs, contratos e artefatos versionados, não por acoplamento de diretórios.

- **Lia-Project:** produto desktop, identidade, experiência, memória pessoal, decisão, presença, permissões e runtime.
- **Lia Agent Hub:** agentes, skills, ferramentas, MCP e orquestração.
- **Lia Research:** evidência e estudos; não é runtime nem aprovação automática.
- **Lia Model Lab:** catálogo e avaliação de modelos, pesos e providers.
- **Lia Forge:** assets e pipelines visuais.
- **Lia Studio:** criação/produção conforme escopo próprio.

Contratos declaram versão, ownership, autenticação, dados, falhas e compatibilidade. Falha de produto auxiliar não compromete a base da Lia.

## 16. Roadmap de maturidade

| Fase | Resultado esperado | Critério de saída |
|---|---|---|
| A — Fundação | Launcher/Stage, conversa, providers e permissões confiáveis | gates operacionais e Windows reais |
| B — Identidade e continuidade | identidade/persona estruturadas e memória controlável | consistência, recuperação, correção e exclusão testadas |
| C — Cognição e decisão | objetivos, planejamento, roteamento e execução verificável | cenários E2E com falhas, cancelamento e confirmação |
| D — Hub e ferramentas | delegação segura ao Agent Hub | escopo, isolamento, cancelamento e retorno auditados |
| E — Percepção e presença | voz, imagem/tela, avatar e Stage evoluídos | consentimento, qualidade, desempenho e UX validados |
| F — Ambiente expandido | desktop avançado, jogos e casa inteligente | integração permitida, segurança e prioridade de recursos |
| G — Autonomia supervisionada | proatividade delimitada | políticas, auditoria, limites e interrupção comprovados |

Não pular a fundação de segurança, memória e permissões para demonstrar autonomia.

## 17. Rastreabilidade obrigatória

Cada capacidade recebe ID, resultado do usuário, fase, estado, requisito, decisão, módulos responsáveis, dependências/licenças, permissões/dados, testes/evidências, limitações e próximo passo.

Estados permitidos: VISION, RESEARCH, PROPOSED, PLANNED, PARTIAL, IMPLEMENTED, PASS AUTOMATED, PASS REAL, BLOCKED e NOT RUN. IMPLEMENTED não significa PASS; PASS AUTOMATED não significa PASS REAL; RESEARCH não significa decisão aprovada. Preencher a matriz por inspeção de código e relatórios, nunca por suposição.

## 18. Relação com documentos existentes

- [Especificação Geral do Produto](../product/ESPECIFICACAO-GERAL-DO-PRODUTO-LIA.md): intenção, UX, prioridades e critérios.
- [Arquitetura do Stage](LIA-STAGE-ARCHITECTURE.md): fronteiras e ciclo de vida; respeitar seus limites não implementados.
- [Auditoria de consumo do Agent Hub](LIA-AGENT-CONSUMPTION-AUDIT.md): evidência da integração existente.
- [Runtime de providers](../design/LIA-PROVIDER-RUNTIME.md): implementação e limites atuais.
- [CURRENT-STATE](../project/CURRENT-STATE.md): estado operacional.
- [Pesquisa de capacidades](../research/lia-capability-catalog/README.md): referências e candidatos.
- [Benchmarks externos](../product/EXTERNAL-BENCHMARKS-NECTAR-ALFRED.md): referências, não requisitos vinculantes.

## 19. Manutenção

1. Este documento descreve direção-alvo; não substitui estado operacional ou relatórios.
2. Antes de criar outro documento de Brain, memória, personalidade ou autonomia, verificar se a matéria já está coberta aqui.
3. Alterações de visão atualizam esta arquitetura e a Especificação Geral na mesma mudança documental.
4. Mudanças de implementação atualizam código, testes, CURRENT-STATE e relatório de evidência.
5. Tecnologia candidata exige avaliação de licença, manutenção, segurança, compatibilidade, custo e benefício.
6. AIRI permanece referência técnica externa; a Lia é produto independente.
