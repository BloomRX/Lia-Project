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
