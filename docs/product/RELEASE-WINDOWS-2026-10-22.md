# Validação de streaming — 22/10/2026

Branch `arena/01a10290-lia-project`; HEAD inicial `452089b`.
Baseline funcional permanece `3ef6d11`. Windows, Node 26.8.1, pnpm 11.24.0,
Python 3.14.7. Continuidade da [organização de 21/10](RELEASE-WINDOWS-2026-10-21.md).
A raiz permanece sem `.devkit-*`; artefatos novos ficam em `Tests/runs/`.

## Defeito reproduzido e correção

O contrato anterior, com três chunks, passa no código antigo. Um caso novo no
harness real do orchestrator envia um caractere por delta: o código antigo
produz `Umcírculoazul.Outralinhacomespaços.` em vez de
`Um círculo azul.\nOutra linha com espaços.`. Portanto, a hipótese antes
refutada para aquele particionamento não podia ser generalizada.

O parser mantém uma cauda de segurança, mas pode emitir whitespace sozinho
quando recebe deltas pequenos. A guarda `speechOnly.trim()` descartava esses
literais. Agora só literais vazios são descartados. A mesma sequência preserva
conteúdo, slices, histórico e hooks usados na sincronização entre janelas.
O filtro de reasoning continua anterior à guarda; não mudou Persona, política
de fallback, configuração ou implementação de voz.

Contraprova: após a correção, retornar temporariamente à guarda antiga faz o
teste falhar novamente pelo mesmo conteúdo sem espaços. A guarda corrigida
foi restaurada antes das verificações finais. Também foram corrigidas duas
referências possivelmente indefinidas no teste de contrato anterior; o
typecheck havia encontrado TS18048 nessas referências.

## Resultados automatizados

| Diretório / comando | Veredito |
| --- | --- |
| `airi`: `./node_modules/.bin/vitest run --root packages/core-agent --project @proj-airi/core-agent` | PASS: 145 testes, exit 0 |
| `airi/packages/stage-ui`: vitest node dos contratos Chat, retry, overrides, reasoning e provider runtime | PASS: 255 testes, exit 0 |
| `airi/packages/stage-ui`: vitest browser `context-bridge.contract.browser.test.ts` | PASS: 15 testes, exit 0 |
| `airi`: `moeru-lint` nos dois arquivos core-agent alterados | PASS: exit 0 |
| `airi`: `corepack pnpm --filter @proj-airi/core-agent typecheck` | PASS: exit 0 |
| `airi`: `corepack pnpm --filter @proj-airi/core-agent build` | PASS: exit 0 |
| `tools`: `python3 -m unittest discover -s . -p "test_*.py" -t .` | PASS: 496 casos, 10 skips, exit 0 |
| raiz: `node --test "Tests/tools/*.test.mjs"` | PASS: 267 testes, exit 0 |
| `airi/apps/lia-app`: `../../node_modules/.bin/vitest run` | PASS: 247 testes, 2 skips, exit 0 |

Logs de RED, contraprova, lint, typecheck, build e integrações:
`Tests/runs/release-20261021/spacing-*.log`.
Retomada final: `Tests/runs/release-20261022/spacing-core-final.log`;
Launcher repetido na retomada em `release-20261021/spacing-launcher.log`.
Avisos experimentais de localStorage apareceram na suíte Stage UI, sem falha.
O problema de configuração de lint das ferramentas da raiz registrado em 21/10
não foi reclassificado como resolvido; ele é separado do lint destes arquivos.

## Windows: UI real, transporte sintético

`Lia.bat` original → botão Conversar → pré-requisito concluído → Node real →
Stage → Chat → nova conversa pelo botão `+ New`. Uma sonda temporária de fetch
respondeu apenas ao prompt de QA com um SSE sintético de um caractere por delta.
Não usou serviço externo nem alterou configuração ou fonte da aplicação.

**PASS Windows com transporte de teste:** palavras separadas no Chat e conteúdo
salvo exatamente igual à resposta, incluindo newline. O Markdown exibiu o
newline como espaço visual; não houve promessa de duas linhas visuais. Uma
requisição de QA foi interceptada; a sonda foi restaurada e confirmou ausência
da própria instrumentação. Revisões independentes de código e screenshot
aprovadas, com esse limite de escopo.

Evidências locais ignoradas em `Tests/runs/release-20261022/`:
`spacing-visible.png`, `captures/spacing-visible.png` (cópia com mesmo SHA-256),
`spacing-stored.json`, `spacing-probe-restored.json`, `launcher-spacing.log`.
O screenshot contém apenas a conversa sintética de QA.

Isso **não** prova que toda perda de espaço observada anteriormente teve esta
causa, nem aprova reconhecimento de imagem, serviço real ou microfone humano.

## Arquivos e aceite

Código: `airi/packages/core-agent/src/runtime/chat-orchestrator-runtime.ts` e
`chat-orchestrator-runtime.test.ts`. Registro de integração upstream, matriz,
roadmap, contagem da skill de testes e documentos de estado atualizados.

- [x] RED no harness real e contraprova contra a guarda antiga.
- [x] Conteúdo, slices, histórico e hooks preservam whitespace no teste.
- [x] UI Windows com fixture SSE mostra palavras separadas e salva conteúdo exato.
- [x] Lint, typecheck, build e suítes pertinentes aprovados.
- [ ] Gate real de conteúdo da imagem: continua aberto.
- [ ] Loop real de ferramentas/failover, presença Livre/multi-monitor e instalação limpa.

Release incompleta; nenhum novo baseline funcional promovido.

## Reteste real de imagem e texto

Primeiro pedido: **BLOCKED**, HTTP 413, entrada estimada 7006 tokens para
limite 7000 da conta. Correlação `0b87c67a-c20e-406c-95ee-bca02060088b`,
`2026-10-23T01:32:26Z` (22/10 à noite no fuso do Dev). Foi mantida a resposta
do serviço intacta; nenhum prompt de sistema, ferramenta ou fallback mudou.

Com pergunta mais curta, na mesma conversa QA, o pedido recebeu HTTP 200,
80 deltas e fim `stop`, pela rota visual configurada. **FAIL de conteúdo:**
o serviço respondeu “quadrado vermelho”, “círculo azul” e outro “quadrado
vermelho”; a imagem tem apenas um retângulo vermelho e um círculo azul.
Correlação `22ca5b5e-0fec-4dad-a6bf-bd967ad3180d`, `01:33:18Z`.

Verificações do pedido real:

- PNG de 842 bytes, 240×160; SHA-256
  `dba7fb9758fda0ef6c9f6d10154fa9ba8b8b4d387a0105d54395819b65c88afd`,
  igual ao arquivo de origem. Não houve recorte/redimensionamento no envio.
- Sete ferramentas presentes; apenas Spark strict=false, como na correção anterior.
- Três deltas compostos só de whitespace foram recebidos. O texto bruto,
  retirando apenas os marcadores de ação, coincide com o texto salvo; espaços
  preservados. Isso não corrige a interpretação geométrica do serviço.
- Sondas de fetch e de file chooser restauradas. Nenhuma chave/cabeçalho de
  autenticação foi retido pela observação; só dados da fixture de QA.

Texto independente em nova conversa: **PASS Windows real funcional**, conteúdo
salvo `42`, HTTP 200, rota `openai/gpt-oss-120b`, sem imagens no pedido.
Screenshot `captures/text-real42.png` confirma o número legível. **FAIL de UX**
na revisão visual: preview de reasoning em inglês truncado/baixo contraste e
placeholder “Say something...”. Esses defeitos permanecem separados do gate
funcional de texto. O erro 413 também expôs JSON técnico na tela; correção de
apresentação/persistência segura iniciada como próximo item, sem alterar routing.

Evidências ignoradas: `vision-wire-final.json`, `vision-stored.json`,
`vision-comparison.json`, `text-wire-final.json`, `text-stored.json`,
`captures/text-real42.png`, `launcher-spacing.log`, no diretório desta rodada.
Não foi salvo screenshot do erro bruto com identificador da conta.

## Erros de envio humanos e persistência segura

O formatter compartilhado agora classifica autenticação/permissão, limite de
entrada, quota, rede, serviço indisponível, resposta vazia e erro genérico.
Números avulsos em um corpo não são tratados como status HTTP. Erros
desconhecidos também recebem texto seguro; nenhum payload é refletido na UI.

Novas mensagens `role:error` guardam apenas um catálogo canônico seguro em
inglês. Esse catálogo é estável para reidratação, sem alteração de schema.
O componente de erro traduz ao renderizar e copiar, acompanhando pt-BR/en ao
vivo; en-US usa fallback en. Histórico antigo não foi regravado: seu conteúdo
bruto é substituído somente na apresentação/cópia. Mantidos identidade, ordem,
retry, rascunhos e exclusão de turnos falhos do contexto futuro.

O namespace stage pt-BR também traduz entrada, retry, sessões e estados
adjacentes. O texto do erro usa “serviço de IA”, sem marcas ou JSON técnico.
Removido o eco bruto de autenticação em `appendSendError`.

| Verificação | Veredito |
| --- | --- |
| RED anterior à correção | 12 falhas funcionais Node e uma browser expondo sentinela413 |
| Contraprova contra formatter HEAD antigo | RED pelo motivo correto; fonte corrigida restaurada com SHA-256 idêntico |
| Vitest node: send-error, contratos Chat e exclusão de falha | PASS: 111 testes, exit 0 |
| Vitest node: regressão Chat completa, 17 arquivos | PASS: 275 testes, exit 0 |
| Vitest browser: error-item real e histórico | PASS: 13 testes, exit 0 |
| Lint dos nove arquivos e typecheck Stage UI | PASS: exit 0 |
| Build `@proj-airi/i18n` e build de produção Stage | PASS: exit 0 |
| Launcher vitest | PASS: 247 testes, 2 skips, exit 0 |
| Python discover em tools | PASS: 496 casos, 10 skips, exit 0, 297,6 s |
| Node Tests/tools | PASS: 267 testes, exit 0 |

O primeiro teste de cópia tentou abrir um dropdown que não existe no viewport
móvel. Foi corrigido para usar viewport desktop real; o teste de retry móvel
foi mantido. Não aumentou timeout. O primeiro lint encontrou importação fora
de ordem e regex com backtracking; corrigidos. O primeiro typecheck encontrou
import de contexto browser que só o alias Vite resolvia: foi usado o export
público `vitest/browser`, confirmado no package.json. Verificações repetidas
depois dessas correções passaram, sem mocks para esconder fronteiras de import.

Browser registrou eventos de ResizeObserver no console do Vite, sem falha final
da suíte (exit 0), como nas suítes browser anteriores. Isso não foi suprimido.
Logs: `chat-error-{node-red,node-green,browser-red,browser-green,counterproof,
lint,typecheck,i18n-build}.log`, `errors-stage-build.log`, `errors-launcher.log`,
`errors-python.log`, `errors-node.log`, `errors-chat-regression.log`.

**PASS Windows com transporte sintético:** novo envio413 com sentinela, URL
fictícia e limite → erro humano pt-BR, nenhum bruto no novo conteúdo salvo,
rascunho preservado. Botão “Tentar novamente” → SSE200 e “Teste concluído.”.
Contador confirmou duas requisições, depois restauração da sonda. O erro413
legado da execução real também apareceu seguro, sem reescrever o histórico.
Revisão visual restrita aprovada; idioma observado em runtime: pt-BR.

Evidências: `error-new-storage.json`, `error-retry-content.json`,
`error-probe-restored.json`, `legacy-error-visible.json` e capturas
`error-legacy-human.png`, `error-new-human.png`, `error-retry-success.png` em
`captures/`. A primeira sondagem de botão via innerText não encontrou retry
porque o botão é iconográfico; o snapshot acessível confirmou “Tentar novamente”.
Placeholder pt-BR foi confirmado separadamente por atributo, pois o rascunho
preenchido o oculta nas capturas.

Limites: um `console.error` bruto preexistente no core-agent continua fora deste
item; não se declara diagnóstico inteiro saneado. O helper genérico de cópia
de histórico conserva compatibilidade; o menu de erro usa diretamente texto
seguro. Isso não aprova APIs internas futuras que ignorem esse componente.

Arquivos: `stage-ui/src/stores/chat/send-error.ts` e teste, `chat.ts` somente
`appendSendError`, `chat.contract.test.ts`, componente `error-item.vue` e novo
teste browser, `i18n/src/locales/en/stage.yaml`, `pt-BR/stage.yaml` e índice.
Política de fallback, Persona, secrets e TTS não foram alterados.

Execução Windows encerrada pelo Launcher em `01:54:46Z`, 491 ms, exit 0;
PID Stage2356 e Electron do checkout ausentes após fechar. Sondas restauradas.

## Próximo defeito de apresentação confirmado

No Chat, `capabilitySnapshotInstalled=false`, `developerShowsReasoning=false`,
`lia-managed` ausente na query. O componente compartilha uma política que usa
snapshot instalado para reconhecer Lia; nessa janela, cai no caso standalone
e mostra reasoning. Evidência: `reasoning-policy-state.json`, apenas booleanos
e rota, sem conteúdo. Corrigir a apresentação por uma fronteira explícita da
Lia, preservando dados, geração e comportamento standalone. Ainda não corrigido.
