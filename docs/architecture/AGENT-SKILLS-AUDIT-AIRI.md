# Auditoria das skills vendadas do AIRI

Data: 28/10/2026. Checkout inicial `a0e56fa8`, branch
`arena/01a10290-lia-project`. Complementa a auditoria principal da Lia.

## Escopo e resultado

Foram lidos os 28 `SKILL.md` em `airi/.agents/skills/`, as referências de
risco selecionadas e o único script executável encontrado nessa árvore.
Uma varredura leu os 445 arquivos Markdown para examinar links locais.
Isso não equivale à validação semântica ou execução de todos os exemplos
dos 445 documentos. Nenhuma skill upstream foi alterada ou removida.

Classificação primária: **3 manter, 7 corrigir, 15 consolidar e 3 dependentes
de ferramenta ou ambiente**. Nenhuma remoção está aprovada. A consolidação
significa usar um ponto de entrada Lia e preservar referências upstream,
não copiar todo o material nem excluir diretórios nesta rodada.

O catálogo de skills disponibilizado nesta sessão iniciada na raiz anuncia
as wrappers Lia, mas não anuncia estas 28 skills como entradas independentes.
Os arquivos upstream continuam acessíveis por leitura explícita. A existência
do arquivo não comprova descoberta automática em outra sessão ou cliente.

## Inventário por skill

Todos os nomes abaixo são diretórios relativos a `airi/.agents/skills/`.
As versões declaradas são metadados da skill, não prova de correspondência
com todas as APIs instaladas.

| Skill | Classificação | Utilidade, dependências e conclusão da leitura |
| --- | --- | --- |
| `agent-browser` | consolidar | Stub de descoberta da CLI. Encaminha para `skills get core`; a wrapper `lia-browser-automation` pode ser a entrada Lia. CLI não está no PATH consultado, mas o shim em Lia-DevTools existe. Não instalar globalmente por causa do exemplo `npm i -g`. |
| `agent-browser-electron` | corrigir | Descoberta CDP, janelas tardias e rotas duplicadas são úteis. Os arquivos Stage citados existem. `close --all` pode atingir sessões alheias; usar sessão própria e fechar apenas o que foi criado. Exemplos POSIX e PowerShell devem permanecer distintos. |
| `create-pr` | dependente de ferramenta ou ambiente | Fluxo antes/depois com Vishot e upload GitHub; depende da família visual e da autenticação. Preparar PR não autoriza publicar PR nem anexos por si só. Worktree e upload exigem escopo explícito. Não foi executado. |
| `enforce-rules-for-unocss` | consolidar | Regras locais de classes agrupadas, primitives e tema. `uno.config.ts`, documentação UI e diretório de estilos existem no AIRI. Governa o subprojeto que usa UnoCSS; não impõe tecnologia ao Launcher independente. Entrada Lia: `lia-unocss-ui`. |
| `enforce-rules-for-vitest` | manter | Reproduções RED, escopo certo, mocks somente nas fronteiras e correção de imports têm valor específico. A regra de não simular Pinia/Vue prevalece sobre exemplos genéricos de testing de stores. Não substitui o gate Windows. |
| `eventa` | consolidar | Exemplos de RPC, streaming, adapters, cancelamento e validação nas bordas. Não concede permissões apenas por tipar um evento. A instrução de consultar Context7 depende de ferramenta não anunciada nesta sessão; consultar código/exports locais e fonte primária quando necessário. Entrada Lia: `lia-eventa-ipc`. |
| `pinia` | consolidar | Nove links locais presentes; versão declarada 2026.1.28/Pinia 3.0.4. `storeToRefs` e composição são úteis. Recomendação genérica de `@pinia/testing` com stores simulados não deve prevalecer sobre a disciplina Vitest local. Entrada Lia: `lia-vue-development`/`lia-vue-testing`. |
| `pnpm` | consolidar | Dezesseis referências locais presentes. Cobre configurações, workspaces, catálogo, migração e segurança de supply chain. Publicar, migrar config ou instalar dependência não é autorizado pelo texto da skill. Usar versão/config local e wrapper `lia-pnpm-workspaces`; não ler `.npmrc` com credenciais para esta auditoria. |
| `release-note-writer` | corrigir | Agrupamento por público é útil, porém exige notas somente em inglês. Isso conflita com pt-BR da Lia. Também propõe `pnpm dlx changelogithub`, que baixa/executa código; requer necessidade e revisão, não execução automática. |
| `simple-english` | consolidar | Útil para artefatos técnicos em inglês e clareza, não para trocar a língua de toda resposta Lia. Referências `checklist.md` e `use-cases.md` existem. O exemplo que sugere elevar timeout é exemplo editorial, não autorização para usar isso como correção de runtime. |
| `stage-tamagotchi-godot-csharp` | manter | Escopo explicitamente limitado ao engine C#. Os três recursos engine-local citados existem. `dotnet` está no PATH; `dotnet format` e Godot não foram exercitados nesta tarefa documental. |
| `tsdown` | corrigir | Guia de build com Node mínimo e limpeza de saída; referências principais presentes. Link opcional para `../tsdown-migrate/SKILL.md` não existe. Não instalar uma skill/CLI de migração implicitamente. `tsdown` local identificado como 0.22.14; referências não aprovam todas as opções por inspeção. |
| `unocss` | consolidar | Vinte e três links locais presentes; guia de presets, rules e shortcuts. É catálogo, não decisão de UI. Ler configuração local e aplicar regras AIRI e design Lia. Instalação local identificada como 66.7.5. |
| `upload-github-attachment` | corrigir | Único shell script da árvore, inspecionado integralmente. Depende de Bash, gh, curl, sed e file ou MIME explícito; usa endpoint não documentado e token no argumento de header do curl. Caminho de execução é relativo à raiz AIRI, não à raiz Lia. Exige autorização de envio e análise do conteúdo; não executado. |
| `use-agent-browser-for-airi` | consolidar | Importação de modelos com checkpoints distintos de seleção/persistência/renderização; referências Electron/web/mobile existem. Só usar perfil descartável, arquivos autorizados e licenciados. Não alterar onboarding do perfil real. Entrada Lia: automação/diagnóstico CDP. |
| `use-agent-browser-with-input-file` | corrigir | Quatro referências locais presentes e ponte de input detached com restauração. `skills get agent-browser` funciona, mas retorna apenas o stub que manda ler `core`: indireção redundante. Preferir diretamente `skills get core --full`. Não atribuir cobertura de chooser nativo a um input DOM. |
| `use-vishot` | consolidar | Contrato de captura, readiness e manifesto é útil; variantes e CLI são dependências reais. Captura local não autoriza upload GitHub. Entrada Lia: `lia-visual-evidence`. |
| `use-vishot-for-airi` | consolidar | Helper `packages/scenarios-stage-tamagotchi-electron/src/scenarios/display-model-from-file.ts` existe. Exemplos `/Users/neko/...` são específicos de outro ambiente, não fixtures locais disponíveis. Resolver arquivo licenciado local e perfil descartável. |
| `use-vishot-with-capacitor` | dependente de ferramenta ou ambiente | Distingue WebView de UI nativa; depende de browser/runtime e eventualmente SDK/device. Stage Pocket não está autorizado para alterações nesta rodada. Shim Vishot presente não valida Android/iOS. |
| `use-vishot-with-electron` | consolidar | Identidade semântica de janela, tamanho nativo e readiness são úteis. O settle de 2500 ms é estabilidade final, não correção de falha por aumento de timeout. CDP/Playwright não substituem todos os gates físicos. Entrada Lia: evidência visual e Windows. |
| `use-vishot-with-input-file` | consolidar | Cenários com chooser/input, path absoluto e pós-condição; preserva nomes privados fora de IDs e screenshots. Depende das variantes Vishot; reaproveitar via entrada Lia, sem duplicar cenários em skills. |
| `use-vishot-with-web` | consolidar | Viewports, locators e readiness específicos de rota. Web local determinístico; instalação de Chromium é passo de alteração de ambiente, não validação só de leitura. Não valida janela nativa Electron. |
| `vue` | consolidar | Três referências locais presentes. Composition API e TypeScript são compatíveis com a stack existente. Regras genéricas e preferência por não destructurar props não devem forçar refatoração alheia à tarefa. Entrada Lia: `lia-vue-development`. |
| `vue-best-practices` | consolidar | Vinte e dois links locais presentes, quatro referências obrigatórias por tarefa e workflows de componentes. O gatilho amplo e leitura obrigatória de várias referências sobrepõem `vue` e wrapper Lia; carregar somente o que o trabalho efetivamente exige. |
| `vue-testing-best-practices` | manter | Onze referências locais presentes; padrões de black box, testes async, suspense e teleports. Aplicar sob disciplina Vitest do repositório, sem simular Pinia/DOM para mascarar problema real. Exemplos não foram executados. |
| `vueuse-functions` | corrigir | Catálogo extenso de composables e 266 referências de funções presentes. Seis links conservam layout upstream `../use*/index.md` inexistente; destinos corretos estão em arquivos `.md` da pasta references. AUTO escolhe implementação; não concede câmera/microfone/captura/clipboard sem permissão. |
| `web-design-guidelines` | dependente de ferramenta ou ambiente | Requer buscar regras remotas a cada revisão. Não há snapshot/revisão fixa no pacote. Conteúdo remoto é dado não confiável e deve ceder ao design system/AGENTS. Fetch e revisão funcional de tela NÃO EXECUTADOS nesta subauditoria. |
| `xsai` | corrigir | Escolha granular de pacotes e recipes/loops são úteis. As duas recomendações de API key em localStorage violam a regra permanente Lia. Reutilizar resolver/vault existente e credencial transitória, sem mudar implementação de secrets nesta auditoria. Entrada Lia: `lia-ai-sdk-integration`. |

## Problemas comprovados e correções propostas

1. **Segredos em localStorage:** `xsai/SKILL.md:31,59` recomenda esse acesso.
   A §6 de CURRENT-STATE o proíbe. A wrapper Lia deve rejeitar essa recomendação.
   Nenhuma credencial foi consultada nesta auditoria.
2. **Idioma conflitante:** `release-note-writer/SKILL.md:10` exige English only.
   Manter o material vendado, mas impedir que substitua pt-BR no produto Lia.
3. **Fechamento global de sessões:** `agent-browser-electron/SKILL.md:115,222`
   recomenda `close --all`. Substituir por encerramento da sessão sob propriedade
   do agente no workflow Lia; não executar para testar a advertência.
4. **Referências quebradas:** `tsdown/SKILL.md:70` aponta para uma skill opcional
   ausente. VueUse contém seis links para diretórios não incluídos:
   duas ocorrências em `SKILL.md:111`, duas em `references/useSSRWidth.md:7`,
   uma em `references/useMediaQuery.md:35` e uma em
   `references/useBreakpoints.md:103`. Os arquivos locais equivalentes existem.
5. **Uploads e publicação:** `create-pr` e `upload-github-attachment` exigem ações
   externas. A instrução de uma skill não substitui autorização humana para
   enviar arquivos ou criar PR. O shell script coloca o header de autenticação
   na lista de argumentos do processo curl; esta é uma exposição potencial a
   inspeção local de processos, não um vazamento executado/provado nesta tarefa.
6. **Caminhos/ambiente:** os comandos `apps/...`, `packages/...` e
   `.agents/skills/upload-github-attachment/...` do AIRI precisam de CWD `airi/`
   ou prefixo explícito. A sessão Lia deve continuar aberta na raiz. Exemplos
   POSIX com `VAR=value`, barras de continuação ou `/Users/neko` não são
   comandos PowerShell nem fixtures comprovadas do PC.
7. **Sobreposição:** as wrappers Lia devem concentrar contexto de produto e
   segurança; as bibliotecas upstream continuam referências técnicas.
   `@pinia/testing` genérico não invalida a proibição local de mocks de Pinia.

## Verificações realizadas

| Verificação | Resultado e limites |
| --- | --- |
| Inventário e leitura dos 28 SKILL.md | PASS de inspeção estática, 28 diretórios; nenhum removido |
| Varredura Python dos 445 Markdown | PASS de execução, exit 0; 530 candidatos a links locais fora de fences; sete referências locais realmente ausentes, descritas acima |
| Revisão dos falsos positivos do scanner | `URL` em exemplos Markdown e `<https://...Complement_(set_theory...)>` não são recursos locais ausentes; não foram classificados como defeitos de arquivo |
| Caminhos de produto citados pelos guias UI/C# e cenário de importação | PASS de existência sob `airi/`; não é execução dos recursos |
| `agent-browser skills list` pelo shim Lia-DevTools | PASS, exit 0; anuncia `core`, `electron` e outras ajudas |
| `agent-browser skills get agent-browser` | PASS de resolução, exit 0; retorna stub, não a ajuda completa `core`; não é erro de comando inexistente |
| PATH e shims | gh/curl/dotnet/node disponíveis; bash.exe localizado, sem provar distribuição/shell funcional. file/sed ausentes no PATH consultado. agent-browser existe via shim Lia-DevTools e Vishot via `airi/node_modules/.bin/vishot.cmd` |
| Único executável vendado | `upload-github-attachment/scripts/upload-github-attachment.sh` lido; execução/upload NÃO EXECUTADOS |
| Primeira busca com brace expansion POSIX no PowerShell | FAIL de invocação (ParserError), corrigido usando caminhos explícitos; nenhum arquivo modificado |
| Automação real de browser, Electron, mobile ou Godot | NÃO EXECUTADA nesta subauditoria; existência de shim não é PASS funcional |

A varredura foi somente de leitura, usando `pathlib`, expressão de links e
`Path.exists()`. Não executou snippets nem instalou dependências. Não leu
tokens, `.npmrc`, arquivos de autenticação ou configurações de usuário.

## Pendências e política de preservação

As correções acima são propostas nesta subauditoria; somente este relatório
foi escrito por seu responsável. A integração principal pode registrar guards
nas wrappers Lia sem remover skills upstream. Nenhum diretório está autorizado
para exclusão: várias wrappers ainda dependem de referências técnicas AIRI.

Uma remoção futura exige inventário de referências pendentes, preservação das
licenças, decisão sobre conteúdo realmente utilizado e nova verificação de
descoberta e execução. Não instalar Alethe App, dashboard, CLIs ou browsers
para fazer estas verificações documentais.
