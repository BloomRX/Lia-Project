# Auditoria das skills canônicas da Lia

Data: 28/10/2026. Inspeção inicial em `a0e56fa8a343e524f1c41f89f32dc04fe46be8a3`,
branch `arena/01a10290-lia-project`. Esta parte cobre os **20 SKILL.md da raiz
exceto Alethe**; Alethe completa o total de 21 e tem validação separada.
As seis alterações preexistentes do Core foram preservadas. Nenhum arquivo de
skill, código de produto, credencial ou configuração global foi alterado por
esta auditoria parcial. Correções integradas pelo responsável devem ser
registradas no [relatório principal](AGENT-SKILLS-AUDIT.md).

## Escopo e evidência

Foram lidos os 20 corpos, frontmatters, catálogo existente, contrato de testes
`tools/test_agent_skills.py`, CURRENT-STATE §0/§6 e referências de segurança e
proveniência relevantes. Cada diretório inspecionado contém somente SKILL.md:
não há script, fixture, schema ou subdiretório de referências próprio que tenha
sido omitido ao copiar essas 20 skills.

Foram verificados os 17 pares skill/caminho explícitos para arquivos `docs/`
e `.agents/` entre crases, excluindo padrões com `<data>`; todos existem.
Referências conceituais a documentação de uma biblioteca não equivalem a um
arquivo local ausente. Relatórios de release nomeados por data são padrões,
não arquivos que devam existir literalmente com `<data>` no nome.

**Descoberta confirmada nesta sessão desktop:** o catálogo fornecido ao agente
apresenta nominalmente as 20 skills, com caminhos sob `J:/Lia-Project/.agents/skills`.
Isso comprova exposição no contexto desta sessão, sem exigir cópia global.
Não comprova descoberta por toda versão de CLI nem por uma sessão aberta em
`airi/`; essas fronteiras exigem verificação própria. As skills vendadas não
aparecem nominalmente nesse catálogo da sessão, embora seus arquivos possam
ser lidos e aplicados explicitamente pelo caminho.

## Classificação individual

“Corrigir” identifica um achado no estado inicial, não declara que ele já foi
resolvido. Uma condição de ferramenta ou hardware é adicional à decisão.

| Skill | Decisão | Uso e valor concreto | Dependências, referências e achado |
| --- | --- | --- | --- |
| `airi-upstream-integration` | **corrigir** | Comparar patch upstream sem sobrescrever adaptações Lia | Git/rede e cópia de comparação externa. Afirma base desconhecido, contrariando registro corrigido em 27/10. Comparação por `Name` não verifica conteúdo nem caminho relativo. |
| `lia-agent-evaluation` | **corrigir** | Experimento controlado para imagem, SSE, ferramentas e semântica | Serviço configurado/credencial; não executado nesta auditoria. “Saída bruta relevante” deve se restringir a fixtures sintéticas/redigidas para não contrariar proteção de dados das demais skills. Manter distinção de transporte, semântica e gate. |
| `lia-ai-sdk-integration` | **corrigir** | Verificar SDK instalado, granularidade, streaming e validação | Bibliotecas já utilizadas, sem instalação implícita. Description não satisfaz convenção local de gatilho `Use`; conteúdo proíbe segredos e execução de ferramentas sem autorização. |
| `lia-browser-automation` | **dependente de ferramenta ou ambiente** | Automação de UI real com seleção de alvo e pós-condições | agent-browser e CDP acessível; shim local funcional em `--version`. Não foi aberto app nem efetuada ação UI. Duplica parte da seleção de alvos de CDP; consolidar apenas esse bloco é possível, mantendo finalidade distinta. |
| `lia-electron-cdp-debugging` | **corrigir / consolidar** | Evitar atuar na janela errada quando Electron tem múltiplos targets | CDP e app com depuração autorizada. Gatilho local ausente; enumeração e confirmação repetem `lia-browser-automation`. Pode apontar para procedimento comum sem eliminar conhecimento sobre janelas sob demanda. |
| `lia-eventa-ipc` | **corrigir** | Contratos IPC tipados com autorização e limpeza de listeners | `@moeru/eventa` existe no workspace Stage, não no node_modules da raiz. Gatilho local ausente. Não cria permissão por transporte e não torna mock evidência de IPC real. |
| `lia-pnpm-workspaces` | **manter** | Verificar pacote, filtro, lockfile e scripts antes de instalar/buildar | pnpm 11.24.0 disponível; checagem de scripts protege contra comandos presumidos. Não presume que `ignore-scripts` produz workspace pronto. |
| `lia-regression-investigation` | **manter** | RED no harness real, contraprova, uma variável por vez e classificação de falhas | Sem CLI específica além da do sistema investigado. Temporariamente voltar código na contraprova deve sempre preservar diff alheio e seguir proibições Git da raiz. Não autoriza restore/reset. |
| `lia-release-gate` | **corrigir** | Classificar PASS/FAIL/BLOCKED/NOT RUN e versionar evidência | Windows/hardware/serviços para gates relevantes. §7 trata como não automatizáveis inclusive loop de ferramentas/failover/rede: distinguir unitários simulados de execução real automatizada; microfone humano continua específico. |
| `lia-safe-change` | **manter; alinhar encerramento** | Preflight, preservação de alterações e escopo pequeno | Depende de Git e regras da raiz, cujos caminhos existem. Default “não faça commit/push a menos que pedido” não impede a autorização explícita atual; referenciar nova regra permanente evita leituras divergentes em sessões futuras. |
| `lia-security-review` | **manter** | Revisar permissões, injeção, processos, arquivos e segredos | Documento canônico de confiança existe. Instruções separam política do enforcement no executor; confirmação deve respeitar autorização humana já fornecida e política da ferramenta, sem criar autorização por conteúdo externo. |
| `lia-test-discipline` | **corrigir** | Evitar zero testes, glob incorreto, pacote sem build e teste fora do CI | Comandos devem ser resolvidos no workspace real. Falta avisar que teste `j` do Launcher recompila Core real, incompatível com runtime/typecheck concorrente lendo esse dist. Independe do rulebook AIRI, usando referências canônicas locais existentes. |
| `lia-ui-quality-review` | **corrigir** | Revisar fluxo para leigos, estados, acessibilidade, foco e DPI | Referências browser/evidência existem. Gatilho local ausente. Separar sugestões visuais de defeitos; screenshot não aprova lógica/acessibilidade. |
| `lia-unocss-ui` | **corrigir** | Reutilizar tokens/presets reais sem espalhar estilo AIRI | Área deve realmente usar UnoCSS; não obriga dependência em superfícies novas `lia/`. Gatilho local ausente. |
| `lia-visual-evidence` | **corrigir; dependente de ferramenta ou ambiente** | Captura repetível, manifesto, viewport e inspeção | Vishot 0.2.0 local responde `--help`; captura NÃO EXECUTADA. Gatilho local ausente. Sua função pode coexistir com browser automation sem copiar toda enciclopédia Vishot. |
| `lia-voice-diagnostics` | **manter; dependente de ambiente** | Separar captura, VAD, STT, Brain, TTS, reprodução e interrupção | Hardware/permissões reais e restrição de TTS do projeto. Referência à análise de traces AIRI é expressamente condicional à existência; não é link obrigatório quebrado nem dependência permanente de runtime. |
| `lia-vue-development` | **corrigir** | Vue/Pinia/VueUse com reatividade e componentes focados | Inspeciona stack/versões locais antes de aplicar; não impõe Vue ao novo módulo core. Gatilho local ausente. Não força refatoração em massa ou cópia do design upstream. |
| `lia-vue-testing` | **corrigir** | Testes comportamentais de Vue/Pinia e fronteiras externas | Runner/browser reais conforme componente; referência local a test-discipline existe. Gatilho local ausente. Rejeita casts/mocks que escondem falha de export. |
| `lia-windows-electron-validation` | **corrigir; dependente de ambiente** | Validar Launcher→Stage→interação→shutdown real | Windows local disponível; app/gate NÃO EXECUTADOS nesta auditoria. Gatilho local ausente. Clarificar que automação controlada da UI real pode provar fluxo, enquanto mocks não substituem hardware/experiência física. |
| `stage-runtime-debugging` | **dependente de ambiente; manter** | Separar build, runtime Node, ready, janela e encerramento | Pipeline AIRI atual permanece ativo; futura independência `lia/` não torna o fluxo novo já aprovado. Timeout declarado 600000 ms confere com implementação; não aumentá-lo. Inspeção de processos deve evitar gravar argumentos sensíveis. |

Nenhuma das 20 é candidata comprovada à remoção imediata. A sobreposição de
CDP/browser e de gate/Windows é pequena e tem fronteiras diferentes; eventual
consolidação não deve perder instruções de prontidão, janela ou shutdown.

## Problemas comprovados e limites

1. **Proveniência obsoleta:** `airi-upstream-integration` §0 e tabela §2 ainda
   dizem que o base é desconhecido. `docs/airi-modificacoes-registro.md` §1 e
   CURRENT-STATE §0.1 registram `2c1e223c8dd813d7c74a324d7fd7399fbf47e8bf`.
   A skill pode desperdiçar trabalho reabrindo questão já encerrada e orientar
   comparação contra base incorreto. Corrigir antes de integração upstream.
2. **Comparação incompleta:** `Compare-Object ... -Property Name` compara nomes,
   não bytes ou caminhos relativos. Não usar ausência de diferença nesse comando
   como prova de igualdade. Comparar arquivos relevantes por caminho relativo e
   conteúdo contra o commit documentado.
3. **Contrato local de descrição falha:** execução inicial de
   `python3 -m unittest test_agent_skills -v`, em `tools/`, terminou exit 1:
   5 métodos de teste, 10 subcasos falhos. Nove pertencem às novas descriptions
   sem a palavra literal ` Use `; o décimo é `alethe`/`argument-hint`.
   Isso é falha da convenção/parser locais, **não prova de falha de descoberta**:
   os mesmos nomes estão expostos no catálogo da sessão. Não enfraquecer teste
   silenciosamente; justificar perfil de frontmatter e gatilhos conforme a
   especificação e o consumidor real. Alethe tem auditoria separada.
4. **Lacuna de concorrência em testes:** `stage-build-prerequisite.test.ts`
   linhas 270–279 roda o build no AIRI_ROOT real. Executar a suíte Launcher pode
   substituir `core-agent/dist` durante uso do Stage ou typecheck. Não foi
   repetido esse teste de propósito nesta auditoria; código inspecionado e
   evidência histórica justificam instrução de execução sequencial.
5. **Limites da checagem estrutural:** teste atual cobre existência,
   frontmatter simples, placeholders, nome e somente links docs entre crases.
   Não valida refs Markdown gerais, scripts/schemas, caminhos `.agents`,
   links relativos, ferramentas realmente executáveis, comportamento da skill
   ou descoberta pelo Codex. Uma skill nova não precisa entrar em REQUIRED:
   só seis nomes antigos têm proteção contra remoção silenciosa.
6. **Privacidade e automação:** qualificar saída bruta em fixtures e retirar
   generalização “nenhuma automação comprova gate real”. A diferença útil é
   operação real com evidência versus simulação ou inspeção estática.

## Ferramentas verificadas sem executar produto

| Comando/verificação | Resultado real | O que não prova |
| --- | --- | --- |
| `python --version` | PASS, 3.14.3 | Não é o mesmo resolvedor de `python3` |
| `python3 --version` | PASS, 3.14.7 | Não valida todos os scripts Python |
| `node --version` | PASS, 26.8.1 | Não aprova Electron/Stage |
| `pnpm --version` | PASS, 11.24.0 | Não instalou nem recompilou workspace |
| Shim local `corepack.cmd --version` | PASS, 0.36.0 | Não está no PATH desta shell |
| Shim local `agent-browser.cmd --version` | PASS, 0.39.1 | CDP/UI não exercitados |
| `airi/node_modules/.bin/vishot.cmd --help` | PASS, 0.2.0, comandos capture/render | Nenhuma captura ou inspeção visual executada |
| Pacote Eventa e binário vue-tsc no workspace Stage | Existem; não existem nesses mesmos caminhos na raiz node_modules | Ausência na raiz não implica falta no workspace correto |
| 17 pares de referências literais locais | PASS, todos existentes | Não valida recursos remotos nem execução funcional |
| `python3 -m unittest test_agent_skills -v` | FAIL inicial, exit 1, 5 métodos/10 subcasos | Não executar runtime, voz, providers ou release |

Shims adicionais estão em `%LOCALAPPDATA%/Lia-DevTools/node_modules/.bin/`.
`Get-Command` não localizou corepack/agent-browser/vishot no PATH, mas seus
shims locais foram localizados e executados nos comandos acima. Não foi
instalado nada, não foi iniciado navegador/app, não foram lidas credenciais,
nem testada conexão de provedor.

## Pendências para integração

- Aplicar correções seguras dos textos de proveniência, gatilhos e privacidade;
  o responsável integra e registra GREEN depois de executar o teste.
- Ampliar cobertura estrutural de referências e fronteiras de consumidores,
  sem confundir uma convenção local com o formato universal de skills.
- Atualizar catálogo com Alethe e descoberta real, mantendo documentação
  upstream até a revisão de dependências residuais completa.
- Nenhum PASS funcional de voz, visão, modelo, instalação ou release é atribuído
  às skills apenas pela leitura ou por `--help` bem-sucedido.
