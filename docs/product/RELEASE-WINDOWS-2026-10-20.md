# Finalização Windows — rodada de 20/10/2026

**Estado: release incompleta.** Esta rodada começou em `7bf9bf9`, na branch
`arena/01a10290-lia-project`. O remoto estava em `8436f91`, com um commit
exclusivo de cada lado. Foi feito fetch para leitura, sem merge ou push.

Mudanças preexistentes preservadas: remoção de
`docs/Concepts/LauncherConcept.png` e plano novo em
`docs/product/PLANO-FINALIZACAO-LIA.md`. O caminho do plano citado no prompt,
`docs/project/PLANO-FINALIZACAO-LIA.md`, não existia.

## Inventário de recursos e comparação dos sete concepts

Os sete PNGs foram abertos. As telas existentes foram localizadas no renderer
do launcher. Home foi observada no Windows. As outras páginas existentes ainda
exigem comparação visual de runtime. Não existem telas de produção para os
concepts restantes.

| Concept | Página/contrato existente | Classificação | Lacuna |
| --- | --- | --- | --- |
| 01 Home | `HomeView.vue`, `home-vm.ts`, IPC `conversar` | parcial | Home real usa monograma L; falta hero canônico, atalhos e composição do concept |
| 02 IA & Recursos | Campos técnicos de IA em `ConfigView.vue`; Brain registry/router em `lia-core` | parcial | Sem página própria; escolhas normais ainda expõem IDs técnicos |
| 03 Voz | `VoiceView.vue`, card de engine, serviços de instalação/perfis | existente sem validação visual completa | Comparar página real; preservar parâmetros suportados e opt-outs |
| 04 Personalidade | `persona.activeCardId` em Configuração | parcial | Sem tela de traços, presets e preview de comportamento |
| 05 Aparência | Stores/seleção de modelo do Stage | parcial | Sem página no Launcher; modelo observado é upstream, não Lia canônica |
| 06 Presença | Controles de janela/hover do Stage | ausente como contrato de produto | Sem escolha persistente Tamagotchi/Livre, movimento e recuperação multi-monitor |
| 07 Ferramentas | Infraestrutura AIRI e permissões de mídia | parcial | Sem página Lia, catálogo de maturidade ou controle canônico de permissões |
| Diagnósticos | `DiagnosticsView.vue`, health/timing/bridge IPC | existente sem validação visual completa | Revisar tradução, logs e informações de privacidade |
| Memória/privacidade | Histórico local e Cloud Sync do AIRI | parcial | Sem promessa de memória semântica; sync v1 tem limitações de imagem/falha |
| Distribuição | Config de electron-builder do Stage | parcial | Launcher sem instalador; feed upstream ainda presente no runtime |

O README dos concepts dizia que Personalidade, Presença e Ferramentas ainda
precisavam ser criados, embora os PNGs já existissem. Isso descrevia referências
visuais, não funcionalidades implementadas.

## Baseline automatizado

Logs locais ficam em `Tests/runs/release-20261019/` (ignorado pelo Git).
O nome da pasta corresponde ao início da sessão no dia 19.

| Comando | Resultado |
| --- | --- |
| `corepack pnpm install --ignore-scripts`, em `airi/` | PASS automatizado, pnpm 11.24.0 |
| `corepack pnpm --filter @lia/core run build`, em `airi/` | PASS automatizado |
| `python3 -m unittest discover -s . -p "test_*.py" -t .`, em `tools/` | Baseline FAIL: 487 casos, 1 erro de limpeza; repetição após seleção PASS automatizado: 487 casos, 10 skips |
| `node --test Tests/tools/*.test.mjs` | PASS automatizado: 267 aprovados |
| `vitest run`, em `airi/apps/lia-app/` | PASS automatizado: baseline 246 + 2 skips; após correção 247 + 2 skips |
| Vitest: `airi-stage-manager`, `node-runtime`, `stage-build-prerequisite` | PASS automatizado: 43 aprovados |
| `moeru-lint` nos arquivos alterados do Stage manager e seleção de sessão | PASS automatizado |
| Vitest da seleção de sessão: projeto browser / projeto node | PASS automatizado: 5 / 20 aprovados |
| `pnpm --filter @proj-airi/stage-ui typecheck` | PASS automatizado |
| Vitest `--project @proj-airi/core-agent` após proteção contra resposta vazia | PASS automatizado: 143 aprovados, 13 arquivos |
| Vitest Stage UI `--project node src/stores/chat` após proteção | PASS automatizado: 255 aprovados, 17 arquivos |
| Lint dos três arquivos da proteção; typecheck core-agent e Stage UI; build core-agent | PASS automatizado |
| `tsc --noEmit -p apps/lia-app/tsconfig.json`, em `airi/` | PASS automatizado |
| `pnpm --filter @lia/lia-app build`, em `airi/` | PASS automatizado; build de aplicação, não instalador |

O patch `stage-node-runtime-c52c995.patch` foi lido e comparado ao código.
A reversão de teste com `git apply --reverse --check` não se aplica integralmente
porque há correções posteriores. Não foi reaplicado. `node-runtime.ts`, a
seleção de Node real e a remoção da variável Electron no filho já existem.

## Fase 1 — inicialização e erro terminal

Roteiro executado no Windows:

1. Executar o `Lia.bat` original, sem alterá-lo.
2. Observar a Home e clicar em “Conversar com Lia”.
3. Observar o término do build e a personagem no Stage.
4. Abrir a janela Chat pelo controle do Stage.
5. Fechar o Launcher pelo fluxo normal.
6. Observar os logs de shutdown e verificar os processos do checkout.

Resultados: abertura e encerramento **PASS Windows real**. O build passou de
`starting` para `succeeded` entre `02:47:08.363Z` e `02:47:11.985Z`.
O Stage foi filho de um Node real, PID 17716. A personagem apareceu depois do
carregamento do renderer. O encerramento levou 606 ms e terminou com código 0.
Após encerrar, não havia o PID 17716, filhos diretos ou Electron do checkout.

Arquivos de evidência local: `launcher-runtime.log`, `home-before.png` e
`stage-visible.png`. A imagem do Stage transparente inclui o fundo visível;
isso não representa a composição final do Launcher.

Bug adicional reproduzido: uma rejeição inesperada de `prerequisite.run()`
escapava sem estado terminal. O novo teste falhou antes da correção. Agora o
manager retorna erro, emite `state=failed reason=unexpected-error`, não registra
o corpo da exceção e permite nova tentativa. O teste também prova o retry.

## Seleção local de conversa — corrigida

Um snapshot do índice sincronizado reaplicava a sessão padrão do líder à janela
Chat, substituindo a escolha local. Agora o índice só restaura a seleção quando
a sessão local não é válida para o usuário e a personagem atuais. Não foi
alterado nem apagado o histórico do Dev.

O teste com dois contextos Pinia e sincronização real reproduziu o erro antes
da correção e passou depois. No Electron, uma conversa nova respondeu **42**
a “19 + 23” e permaneceu selecionada: **PASS Windows real**. Evidências:
`text-after-selection-fix.png`, `launcher-debug-runtime.log`, correlação
`b8e7c765` às `03:11:08.543Z` na rota GPT-OSS.

## Resposta vazia — correção e diagnóstico

Uma sondagem temporária, apenas com metadados, observou HTTP 200, três chunks,
`finish_reason=stop`, um token de saída e nenhum texto, raciocínio ou ferramenta.
Isso prova ausência de conteúdo naquela resposta recebida, não a causa do
comportamento do modelo. O runtime tratava esse caso como sucesso sem mensagem.
Agora ele rejeita um stream sem conteúdo nem ferramentas, preserva o tratamento
de geração obsoleta e usa o caminho de erro já existente. Não altera fallback,
Persona, credenciais ou voz.

Regressão reproduzida antes da correção. As fixtures de pedidos bem-sucedidos
em testes de timestamp/fila passaram a emitir uma resposta real. Gate de erro:
**PASS Windows real** — anexo e pergunta preservados, erro em pt-BR visível e
retry disponível, com `sendTerminalOutcome=failed`. Correlação
`556292c8-c31b-4868-8ec3-a75f600b6f41`, `03:47:10.353Z`, evidência
`image-empty-error-visible.png`, inspecionada visualmente.

Alternativa simples avaliada: requisição mínima à Groq já configurada, somente
com a imagem sintética e a pergunta, limite de saída 128. Tanto JSON quanto SSE
retornaram descrição correta do retângulo vermelho e círculo azul. SSE: 1826
tokens de entrada, 18 de saída. Evidência `groq-minimal-stream-vision.json`.
É **PASS de integração direta do serviço**, sem aprovar o gate do aplicativo.
A autenticação foi usada pela instância existente, sem imprimir chaves.

O pedido completo do app contém system de 7182 caracteres, pergunta+imagem e
sete ferramentas, sem limite explícito de saída. Uma comparação conservando o
contexto, retirando ferramentas, limitando saída a 128 e usando JSON respondeu
corretamente, 3758 tokens de entrada/25 de saída. Como há múltiplas variáveis,
a causa **ainda não estava isolada** nessa comparação inicial.

A comparação controlada seguinte manteve exatamente as mesmas mensagens, SSE
e limite de saída 128. Com as sete ferramentas: HTTP 200, stop, zero conteúdo,
6736 tokens de entrada e 1 de saída. Sem ferramentas: HTTP 200, stop, descrição
correta, 3758 de entrada e 28 de saída. Evidência:
`groq-image-controlled-tools.json`. O conjunto de ferramentas altera o resultado
nesse pedido; o defeito específico de schema/modelo ainda não está localizado.
Não foi removida capacidade declarada nem desativado recurso como workaround.
As sondagens de fetch foram restauradas após o experimento. Documentação consultada: [visão Groq](https://console.groq.com/docs/vision)
e [Qwen](https://console.groq.com/docs/model/qwen/qwen3.8-27b).

## A1 — testes dirigidos de failure behavior

**PASS automatizado**: 11 novos casos, 15 aprovados no arquivo
`src/renderer/stores/lia/secret-bridge.test.ts` do Stage. O teste usa o store
Pinia real e a política registrada de produção; somente o IPC e i18n são
simulados, como no harness existente. Não lê nenhuma credencial real.

- 429, 500, 503 e ECONNRESET retornam o próximo destino configurado; ao fim
  da cadeia retornam undefined.
- 400, 401, 403, 404, modelo incompatível e configuração inválida não mudam
  de destino, mesmo com failover habilitado.
- Opt-out bloqueia também um erro recuperável 503.
- Preferência canônica permanece intacta; nenhum salvamento de configuração
  ou leitura de segredo acontece na decisão.

Comandos em `airi/apps/stage-tamagotchi/`: `vitest run --project node
src/renderer/stores/lia/secret-bridge.test.ts` (15 PASS). Typecheck do Stage
`pnpm --filter @proj-airi/stage-tamagotchi typecheck`, com heap 3072 conforme
orientação existente: PASS. `moeru-lint` no arquivo alterado: PASS.
Isso fecha o teste dirigido A1, **não** prova uma recuperação de rede contra dois
serviços reais. O loop de execução é coberto separadamente pelos contratos de
Chat (255 PASS na rodada anterior); E2E de failover em rede segue NÃO EXECUTADO.

Após `457b5b1`, as suítes da raiz repetiram PASS: Node 267; Python 487 casos,
10 skips, em 320,6 s; Launcher 247 + 2 skips. Logs `*-after-empty-stream.log`.

## A2 / 8.0D-M3.1 — preflight de imagens

**PASS automatizado e PASS Windows real da recusa por excesso.** O limite fica
no descritor do modelo (`maxImagesPerRequest`), com 3 no Qwen configurado, e não
no componente. O contador reutiliza a projeção canônica do Core: anexos novos +
imagens do histórico elegível. Turnos falhos e erros não aumentam a contagem.

A autoridade verifica modelos resolvidos nos modos automático e manual antes
de consultar presença de credencial. Excesso gera erro explícito; não retorna
undefined para cair no envio legado. Nenhum conteúdo ou contador novo atravessa
o IPC do Brain. A UI preserva rascunho/anexos, mostra aviso em pt-BR e não move
o aviso para outra sessão. Retry verifica antes de truncar histórico, inclusive
mensagens antigas sem ID: mantém o índice, sem inventar identidade, mas passa
pela mesma autoridade. A captura de voz carrega a contagem do histórico sem
alterar STT/TTS, providers ou o sequenciamento de voz.

Verificações:

| Comando/roteiro | Resultado |
| --- | --- |
| Teste de regressão do resolver antes da implementação | RED: 4 imagens ainda retornavam uma rota |
| Vitest node: brain-shadow, authoritative resolver e retry | PASS automatizado: 76 casos |
| Vitest browser: `InteractiveArea.browser.test.ts` | PASS automatizado: 15 casos; inclui 4 anexos e 3 imagens no histórico + 1 anexo |
| `pnpm --filter @lia/core test` | PASS automatizado: 353 casos |
| `pnpm --filter @lia/core build` | PASS automatizado |
| Typechecks Lia Core e Stage | PASS automatizado |
| `moeru-lint` nos arquivos tocados | PASS automatizado |
| Windows: Lia.bat → Conversar → nova sessão → anexar 4 PNGs → enviar | PASS Windows real: aviso 4 > 3, rascunho e quatro prévias preservados |

Evidências locais: `image-limit-refused.png` (inspecionada visualmente),
`image-limit-before.png`, `image-limit-composer-state.json`,
`image-limit-network-counter.json`, `launcher-image-limit.log` e
`image-limit-*.log`. O contador é restrito ao prompt sintético de QA e mediu
zero requisições desse prompt; conversas de fundo não são contadas nem retidas.
A sondagem foi restaurada. O Launcher foi encerrado normalmente às
`22:50:57.289Z`, em 538 ms; PID 17048 e Electron do checkout estavam ausentes.

O navegador registrou avisos de ResizeObserver, sem falha da suíte. Uma tentativa
de teste foi interrompida por `dist` sendo reconstruído pelo Launcher ao mesmo
tempo; a execução sequencial posterior do resolver passou. Não houve alteração
de timeout, supressão de erro, instalação ou baseline funcional.

Arquivos da A2:

- `airi/packages/lia-core/src/brain/types.ts`
- `airi/packages/lia-core/src/brain/adapters/groq.ts`
- `airi/apps/stage-tamagotchi/src/renderer/services/lia/brain-shadow.ts` e teste
- `airi/apps/stage-tamagotchi/src/renderer/services/lia/lia-authoritative-route-resolver.ts` e teste
- `airi/apps/stage-tamagotchi/src/renderer/services/lia/lia-authoritative-retry.ts` e teste
- `airi/apps/stage-tamagotchi/src/renderer/components/InteractiveArea.vue` e teste browser
- `airi/apps/stage-tamagotchi/src/renderer/pages/index.vue`

Suítes finais após A2: Node 267 PASS; Launcher 247 + 2 skips PASS;
Python 487 casos/10 skips PASS em 272 s (logs `*-after-a2.log`). A repetição
Python imediatamente após A1 havia falhado na limpeza de fixture Git, sem
mudança nessas ferramentas nesta feature. Intermitência continua registrada.

Limites: apenas modelos resolvidos com limite declarado podem ser verificados.
Não é um limitador de tokens/quota da conta, nem prova reconhecimento da imagem.
O gate de imagem+texto na UI continua FAIL por resposta vazia com ferramentas.

## Problemas ativos

- **Imagem — FAIL:** anexo sintético de 240×160, retângulo vermelho à esquerda
  e círculo azul à direita, com pergunta determinística. A rota Qwen foi
  selecionada. Tentativas com contexto receberam limites Groq HTTP 429
  (saída: 1000 tokens/minuto) e HTTP 413 (entrada: 7000 tokens/minuto).
  Em conversa nova, correlação `93e70252-ebbf-41cf-8a8f-c88c88565d0b`
  às `03:18:57.782Z`, o log registrou sucesso, mas **não houve mensagem
  assistant** no store nem resposta visível. O stream vazio foi medido; a causa do comportamento do modelo ainda não está
  isolada. Requisição mínima ao mesmo serviço descreveu a imagem corretamente.
  Evidências: `image-preview.png`, `image-first-result.png` e log do runtime.
- **9router — BLOCKED para envio:** catálogo acessível em
  `http://localhost:20128/v1/models`; requisição com a mesma imagem sintética ao
  modelo `visao` respondeu HTTP 401. Nenhuma credencial foi lida ou exposta.
  O Dev foi solicitado a configurar a autenticação por mecanismo local. Reteste
  nesta retomada manteve 401/invalid_api_key, sem ler nenhuma chave.
  Isso não substitui o gate original da Groq.
- **Python — intermitência:** `python3` da Store: 487 casos, 1 erro de limpeza e
  10 skips. `python` nativo: 487 casos, 3 erros de limpeza e 10 skips.
  Os testes GitFlow isolados variam entre aprovação e erro WinError 32/5
  ao remover fixtures. Uma sondagem imediata com Handle em uma execução
  com falha não encontrou detentor. A causa dos locks continua desconhecida;
  a diferença entre os interpretadores não a comprova. A repetição `python3` após
  o commit de seleção passou: 487 casos, 10 skips, exit 0, em 327,8 s. Logs:
  `python-native-full.log`, `lock-probe-repeat-1.log`, `python-after-session.log`.
- **Lint da raiz:** permanece a dívida registrada no preflight anterior. Nenhum
  arquivo Node de ferramentas foi alterado nesta rodada. O lint dos arquivos
  TypeScript alterados passou pela configuração própria do workspace.

## Checklist de aceite

- [x] PASS Windows real: Launcher abre por `Lia.bat`.
- [x] PASS Windows real: build termina e Stage aparece.
- [x] PASS automatizado: rejeição do pré-requisito termina em erro e permite retry.
- [x] PASS Windows real: encerramento gerenciado sem processo do checkout remanescente.
- [x] PASS Windows real: conversa de texto isolada mantém sessão e resposta 42 visível.
- [x] PASS automatizado e Windows real: stream vazio gera erro visível e estado terminal failed.
- [ ] FAIL: imagem determinística sem resposta visível; texto após imagem ainda NÃO EXECUTADO.
- [ ] NÃO EXECUTADO: novo teste humano de microfone; baseline de voz preservado.
- [x] PASS automatizado: política real de failover recuperável/permanente, fim da cadeia e opt-out.
- [x] PASS automatizado e Windows real: preflight numérico recusa excesso sem perder rascunho/anexos.
- [ ] NÃO EXECUTADO: failover E2E contra serviços reais.
- [ ] NÃO EXECUTADO: loop real de ferramentas e medições de latência/rede.
- [ ] PARCIAL: Launcher corresponde aos concepts e oferece apenas controles funcionais.
- [ ] NÃO EXECUTADO: presença Livre e multi-monitor, persistência e recuperação.
- [ ] PARCIAL: páginas de personalidade, aparência, ferramentas, memória e privacidade.
- [ ] NÃO EXECUTADO: instalador, instalação limpa, atualização e desinstalação.
- [ ] PARCIAL: revisão final de licenças/assets, acessibilidade e DPI.

O baseline funcional permanece `3ef6d11`. Esta rodada não aprova a release.
