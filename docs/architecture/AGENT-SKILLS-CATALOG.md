# Catálogo de skills de agentes da Lia

Este documento distingue skills disponíveis no repositório, skills próprias da Lia e referências externas. Ele não afirma que todas as skills foram ativadas pelo agente: a descoberta depende do runtime/CWD e deve ser verificada no ambiente real.

## Princípios

- A raiz `.agents/skills/` contém skills específicas da Lia que o agente deve conseguir descobrir a partir da raiz do repositório.
- `airi/.agents/skills/` contém skills vendadas do AIRI. Elas são reutilizáveis, mas um agente iniciado na raiz pode não descobri-las automaticamente; leia-as explicitamente por caminho quando relevante.
- Não copiar uma skill externa sem verificar origem, licença, compatibilidade e scripts/efeitos colaterais.
- Uma skill de agente de desenvolvimento não é automaticamente uma habilidade executável da Lia em runtime. A execução de capacidades da Lia exige ferramentas, permissões e controles de segurança no produto.

## Skills próprias na raiz

| Skill | Finalidade |
|---|---|
| `lia-safe-change` | Preservar mudanças existentes, escopo limitado e evidência antes/depois |
| `lia-test-discipline` | Selecionar a suíte certa e evitar falsos verdes |
| `lia-regression-investigation` | Reproduzir e investigar uma variável por vez |
| `lia-release-gate` | Veredito honesto de release, incluindo validação Windows |
| `lia-windows-electron-validation` | Validar janela, renderer, processos e encerramento no Windows |
| `stage-runtime-debugging` | Diagnosticar startup/runtime/IPC do Stage |
| `lia-agent-evaluation` | Avaliar qualidade do modelo e regressões de ferramentas/visão |
| `lia-voice-diagnostics` | Isolar etapas de captura, STT, modelo, TTS e reprodução |
| `lia-ui-quality-review` | Revisar UX, acessibilidade, estados e linguagem da interface |
| `lia-security-review` | Revisar ferramentas, permissões, arquivos, segredos e fronteiras de confiança |
| `airi-upstream-integration` | Integrar seletivamente mudanças do AIRI sem perder patches da Lia |

## Skills já vendadas no AIRI

Localizadas em `airi/.agents/skills/` na branch verificada:

- `enforce-rules-for-vitest`: regras para testes Vitest no monorepo AIRI. A skill raiz `lia-test-discipline` já aponta para ela.
- `agent-browser` e `agent-browser-electron`: automação de navegador/renderer e diagnóstico de alvos CDP Electron. Leia antes de instalar outro mecanismo de automação.
- `web-design-guidelines`: referência de revisão de UI; a skill raiz `lia-ui-quality-review` complementa com requisitos específicos da Lia.
- `simple-english`: linguagem simples para conteúdo em inglês; não substitui o requisito de pt-BR da interface Lia.
- `vue-testing-best-practices`, `vue-best-practices`, `vue`, `pinia`, `unocss`, `tsdown`, `xsai`, `pnpm` e outras skills específicas: usar apenas quando a tarefa envolver essas tecnologias.

A versão vendada consultada **não contém** `enforce-rules-for-typescript` nem `analyze-io-traces`. Não assuma que skills existentes no AIRI upstream estão presentes localmente. Se forem necessárias, compare com o upstream atual e revise conteúdo/licença antes de incorporá-las.

## Referências externas para avaliar, não instalar às cegas

| Projeto/recurso | Uso possível na Lia | Decisão |
|---|---|---|
| [OpenAI skills](https://github.com/openai/skills) | Referências para segurança e workflows de agente | Adaptar somente após revisar licença e compatibilidade |
| [Vercel Agent Skills](https://github.com/vercel-labs/agent-skills) | Regras de UI/design e boas práticas web | Priorizar diretrizes aplicáveis à stack Vue/Electron; não importar regras específicas de React/Next sem necessidade |
| [Anthropic webapp-testing](https://github.com/anthropics/skills/tree/main/skills/webapp-testing) | Referência de teste de aplicações web com Playwright | Comparar com `agent-browser` já vendado antes de adicionar dependências |
| [Microsoft winappCli UI automation](https://github.com/microsoft/winappCli) | Referência para automação da UI Windows/Electron | Usar apenas se a ferramenta estiver disponível e validada no ambiente |
| [skills.sh](https://skills.sh/) | Descobrir skills comunitárias | Catálogo comunitário: auditar origem, scripts, licença e permissões antes de confiar |

## Habilidades futuras da Lia em runtime

Essas capacidades são ideias de produto, não skills de runtime implementadas por este catálogo:

1. Organização de arquivos com prévia de mudanças e confirmação antes de mover, sobrescrever ou apagar.
2. Leitura e resumo de documentos com referências às páginas/trechos de origem.
3. Pesquisa web com fontes, data e incertezas explícitas.
4. Planejamento, tarefas e lembretes com confirmação para ações externas.
5. Assistência de código com escopo de projeto limitado e execução de testes sob autorização.
6. Configuração e diagnóstico de voz, respeitando privacidade e consentimento.

Antes de implementar um sistema de skills em runtime, definir manifestos de ferramentas/permissões, política de confirmação, isolamento de execução, auditoria, falhas e versionamento. Instruções em `SKILL.md` não são uma fronteira de segurança por si só.

## Verificação

A lista foi conferida na branch `arena/01a10290-lia-project`. A presença de arquivos não prova que o agente local os descobriu ou ativou. Confirmar isso no agente efetivamente usado e registrar a versão/ambiente quando for validado.
