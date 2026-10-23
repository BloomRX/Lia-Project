# Lia — verificação Windows em 23/10/2026

Branch `arena/01a10290-lia-project`, partindo de `2228b62`. Baseline funcional
permanece `3ef6d11618f787dae6d197645d440a5775a60ad6`. Release incompleta.
Esta rodada continua o [relatório de 22/10](RELEASE-WINDOWS-2026-10-22.md).
Artefatos locais permanecem em `Tests/runs/release-20261022/`, diretório da
execução iniciada antes da mudança de data. Nenhum artefato foi recolocado na raiz.
Ambiente desta continuação: Windows local, Node 26.8.1 e Python 3.14.7.

## Fronteira de apresentação do raciocínio

No Windows, a janela Chat estava sem snapshot de capacidades, com a preferência
de desenvolvedor desligada e sem o marcador de gerenciamento na query. A
apresentação genérica interpretava essa ausência como uso independente do AIRI
e revelava uma prévia técnica. Isso não era falha do modelo nem do idioma do
conteúdo final.

O contrato explícito `auto`/`visible`/`hidden` entre histórico e resposta permite
ao host decidir a apresentação sem alterar o conteúdo armazenado ou a geração.
O padrão `auto` conserva a apresentação independente. A revisão encontrou que
aplicar a regra Lia incondicionalmente no host também mudava o Stage independente;
essa versão intermediária não foi aprovada.

Os testes RED anteriores mostraram os sentinelas internos no DOM do histórico
e do host. A contraprova retirou apenas a ligação da política no host e voltou
a falhar. Os testes finais aprovaram a distinção explícita entre host gerenciado
e independente. `main/windows/chat/index.ts` agora transmite `lia-managed=true`
pela mesma autoridade `isLauncherManaged()` usada na janela principal. O host
consome o parser de contexto existente; não inicializa voz ou capacidades
para decidir uma regra de apresentação.

### Resultados executados

| Verificação | Resultado |
| --- | --- |
| Browser: histórico/política explícita | PASS automatizado, 5 testes |
| Browser: host Chat gerenciado e independente | PASS automatizado, 17 testes |
| Contratos de contexto e URL | PASS automatizado, 11 testes |
| Montagem happy-dom do host e contratos de envio | PASS automatizado, 28 testes/2 arquivos, exit 0 |
| Stage Node completo após correções das fixtures | PASS automatizado, 1798 testes/4 skips, 144 arquivos, 308,46 s, exit 0 |
| Regressão browser histórico/erros/política | PASS automatizado, 18 testes/3 arquivos, exit 0 |
| Lint dos 10 arquivos do item | PASS automatizado, 8 + 2 arquivos, exit 0 |
| Typecheck Stage UI e Stage | PASS automatizado na repetição com pré-requisitos estáveis, exit 0 |
| Build de produção Stage | PASS automatizado, exit 0 |
| Python desde `tools/` | PASS automatizado, 496 casos/10 skips, 313,937 s, exit 0 |
| Node desde a raiz | PASS automatizado, 267 testes, 245,317 s, exit 0 |
| Launcher | PASS automatizado, 247 testes/2 skips, 18,63 s, exit 0 |

Uma primeira invocação browser duplicou o caminho de configuração; foi corrigida
sem alterar configuração de testes. Houve também TS2307 de pacote Core ausente
durante uma execução de typecheck. A repetição após confirmar `dist/index.mjs`
e `dist/index.d.mts` presentes e nenhum build Core ativo passou. Concorrência
de build é hipótese; não foi isolada como causa confirmada. Saídas FAIL e PASS
permanecem nos artefatos. Avisos existentes de ResizeObserver não foram ocultados.

A revisão também encontrou duas fixtures happy-dom sem query de janela: 27
falhas e 1 aprovação na execução dirigida antes do ajuste. Elas agora representam
o Chat gerenciado real e restauram a URL após cada caso. O parser de produção
permanece estrito. A execução completa inicial do Stage Node, iniciada durante
essa correção, terminou FAIL (20 falhas, 1778 aprovações, 4 skips): 18 falhas
dessas fixtures e duas fixtures antigas de sucesso sem evento de texto no
`execution-reporter.test.ts`. A execução dirigida do reporter confirmou
10 PASS/2 FAIL por proteção contra stream vazio, introduzida antes deste item.
Essa dívida foi corrigida em commit separado `f752ff2`: os dois sucessos emitem
texto e fim pelo callback real. Primeira rejeição, resolver, deduplicação e todas
as asserções originais foram preservados. 12 testes do reporter e lint PASS.
O import de tipo inicial dessa fixture não era dependência direta do Stage e
produziu TS2307; foi corrigido pelo reexport público existente do Stage UI,
sem nova dependência. Typecheck Stage completo, os 12 testes e lint passaram.
A repetição completa do Stage Node ficou verde conforme a tabela. Nenhum
fallback de produção ou proteção contra resposta vazia foi alterado.
Correção do import de tipo: commit `ec36846`, após typecheck completo aprovado.

Repetição final antes do commit de apresentação: Python 496/10 skips em
292,390 s, Node 267 em 220,649 s e Launcher 247/2 skips em 22,03 s, todos
exit 0. Logs `reasoning-final-{python,node,launcher}.log`. A raiz continua
sem diretórios `.devkit-*`; saídas temporárias permanecem sob `Tests/`.

### Windows real

`Lia.bat` original → Launcher → Conversar com Lia → Stage → Open Chat →
Conversas → Nova. Pergunta sintética de 19 + 23 enviada ao serviço configurado
real, **sem sonda de transporte**: resposta final **42**. Às
`2026-10-23T12:52:26.824Z`, query gerenciada true, preferência de desenvolvedor
false, raciocínio presente no store e ausente do DOM. Campo “Escreva uma
mensagem...” em pt-BR. Captura `captures/reasoning-hidden-real.png` aprovada
na revisão visual restrita a esses critérios: **PASS Windows real**.

Nenhuma preferência de desenvolvedor foi alterada para esse gate. O teste de
reatividade e de preservação do conteúdo original permanece automatizado;
não foi apresentado como alternância manual de preferência no Windows.

Pré-requisito Core concluiu às `12:48:55.326Z`. Encerramento pelo Launcher às
`12:54:23.461Z`: Stage parado em 584 ms, Launcher saiu com código 0
e nenhum Electron do checkout permaneceu. A conexão CDP tentada antes de
o Stage ficar disponível expirou; conectou após a inicialização sem mudar
timeout de produto. O modo de QA abriu DevTools, fechado antes da captura.

Arquivos de produto/teste: `stage-tamagotchi/src/main/windows/chat/index.ts`,
`renderer/components/InteractiveArea.vue` e seu browser test,
seus testes `InteractiveArea.correlation.test.ts`/`InteractiveArea.brain-shadow.test.ts`,
`renderer/window-context.test.ts`; `stage-ui/src/components/scenarios/chat/components/`
`history.vue`, `assistant-item.vue`, `response-part.vue` e
`history.reasoning.browser.test.ts`. Logs `reasoning-*`,
`launcher-reasoning.log` e metadados `reasoning-windows-real.json` estão no
diretório local da rodada. Os resultados essenciais acima são versionados.

### Comandos

PowerShell; `$cp` representa o shim existente
`$env:LOCALAPPDATA/Lia-DevTools/node_modules/.bin/corepack.cmd`. Cada execução
salvou saída em `Tests/runs/release-20261022/` e preservou `$LASTEXITCODE`.

```powershell
# J:/Lia-Project/tools
python3 -m unittest discover -s . -p "test_*.py" -t .
# J:/Lia-Project
node --test "Tests/tools/*.test.mjs"
# J:/Lia-Project/airi/apps/lia-app
../../node_modules/.bin/vitest run
# J:/Lia-Project/airi
& $cp pnpm exec vitest run --root packages/stage-ui --project browser src/components/scenarios/chat/components/history.reasoning.browser.test.ts
& $cp pnpm exec vitest run --root apps/stage-tamagotchi --project browser src/renderer/components/InteractiveArea.browser.test.ts
& $cp pnpm exec vitest run --root apps/stage-tamagotchi --project node src/renderer/window-context.test.ts src/main/libs/electron/location.test.ts
& $cp pnpm exec vitest run --root apps/stage-tamagotchi --project node src/renderer/components/InteractiveArea.correlation.test.ts src/renderer/components/InteractiveArea.brain-shadow.test.ts
./node_modules/.bin/vitest run --root apps/stage-tamagotchi --project node
./node_modules/.bin/vitest run --root packages/stage-ui --project browser src/components/scenarios/chat/components/history.browser.test.ts src/components/scenarios/chat/components/history.reasoning.browser.test.ts src/components/scenarios/chat/components/error-item.browser.test.ts
& $cp pnpm --filter @proj-airi/stage-ui run typecheck
& $cp pnpm --filter @proj-airi/stage-tamagotchi run typecheck
& $cp pnpm --filter @proj-airi/stage-tamagotchi run build
./node_modules/.bin/moeru-lint.cmd packages/stage-ui/src/components/scenarios/chat/components/history.vue packages/stage-ui/src/components/scenarios/chat/components/assistant-item.vue packages/stage-ui/src/components/scenarios/chat/components/response-part.vue packages/stage-ui/src/components/scenarios/chat/components/history.reasoning.browser.test.ts apps/stage-tamagotchi/src/renderer/components/InteractiveArea.vue apps/stage-tamagotchi/src/renderer/components/InteractiveArea.browser.test.ts apps/stage-tamagotchi/src/main/windows/chat/index.ts apps/stage-tamagotchi/src/renderer/window-context.test.ts
```

## Limitações obrigatórias

- Gate de interpretação da imagem: **FAIL de conteúdo**, conforme o reteste de
  22/10; o texto bruto já descrevia formas incorretas. Não foi reclassificado.
- Serviço local alternativo: último envio **BLOCKED 401**, autenticação ainda
  necessária. Não foram procuradas nem transferidas chaves para contornar.
- Loop real completo de ferramentas: **NÃO EXECUTADO**. A validação atual por
  ping é insuficiente para aprovar esse contrato.
- Novo gate humano de microfone: **NÃO EXECUTADO**; voz mantém evidência histórica.
- Presença Livre/múltiplos monitores e instalação limpa: **NÃO EXECUTADOS**.
- Instalador Lia: composição de Launcher/Stage e dependências ainda pendente;
  build do Stage sozinho não é instalador de produto.
- Logs brutos de erro no Core: dívida mapeada, sem correção nesta etapa.

## Definition of Done da release

- [x] Caminho de desenvolvimento Launcher → Stage visível e encerramento
  comprovados nas rodadas anteriores; baseline preservado.
- [x] Espaços em streaming, erro humano e retry cobertos por regressões e
  verificações Windows descritas no relatório de 22/10.
- [x] Apresentação de reasoning da janela Lia validada nesta rodada, com 42
  do serviço real e raciocínio oculto por padrão; preservação standalone automatizada.
- [ ] Gate real de conteúdo da imagem aprovado.
- [ ] Loop real de ferramentas e failover em rede aprovados.
- [ ] Launcher completo com preferências de efeito real e persistência.
- [ ] Presença Livre, monitores e recuperação validados no Windows.
- [ ] Build de produto, instalador, instalação limpa e atualização aprovados.
- [ ] Revisão final de privacidade, licenças, assets e troubleshooting concluída.

Nenhum item pendente equivale a PASS automatizado ou Windows real.
