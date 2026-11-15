# Lia Runtime E2E — 30/10/2026

## Resultado

**Entrega concluída no escopo de componentes; release não aprovada.** Dois IDs
de configuração compatível executam transporte próprio. Um defeito confirmado
de cancelamento infinito foi corrigido. A integração de renderer, main, IPC,
cofre criptografado e transporte foi executada em Electron real no Windows,
com servidor HTTP local e credenciais sintéticas. Nenhum serviço externo,
modelo de IA, áudio, personagem ou instalador foi aprovado por esse teste.

Branch `arena/01a10290-lia-project`; HEAD inicial local/remoto
`eb38005d4c63a584d1fae345e82ff9a4bb8ef7a2`; origin
`https://github.com/BloomRX/Lia-Project`. Main permanece
`db99c709059a6d074b18361bfb32c9f144620632`. Baseline funcional permanece
`3ef6d11618f787dae6d197645d440a5775a60ad6`.

Os seis arquivos Core preexistentes foram preservados por SHA-256 e excluídos
do commit. Testes do host usam esse working tree e seus artefatos Core; não
comprovam checkout limpo sem essas alterações. Stage UI compartilhado, BATs,
Persona, TTS, política de fallback, dependências e lockfile não foram alterados.

## Caminho efetivo e credenciais

```text
Renderer → resolução da factory Lia → registry/cache Lia
         → resolver → preload/Eventa → main → vault/safeStorage
         ← chave do escopo solicitado, transitória
         → fetch Lia → HTTP → corpo/erro seguro → SDK → renderer
```

O transporte permanece no renderer; o main atende os canais existentes de
cofre/configuração. O teste importa handlers e cofre de produção, usa preload
compilado e verifica `contextIsolation=true`, `nodeIntegration=false` e
`webSecurity` ativo. Não simula IPC nem cifra. O wrapper de observação do cofre
registra somente IDs de escopo, nunca chaves. A ponte do teste chama o SDK real,
sem montar toda a aplicação Stage/Pinia; os testes de stores exercitam esse
despacho separadamente. Não se declara o percurso completo Launcher → Stage.

Garantias verificadas:

- Nenhuma leitura de chave antes da primeira operação; sequência dos quatro
  primeiros acessos corresponde às operações genérico/genérico/genérico/local.
- Cabeçalhos autenticados com sentinelas diferentes por serviço. A fixture
  rejeita autenticação errada, inclusive depois do reinício real do processo.
- Cifra em `lia-secrets.json` sem sentinela em texto; `safeStorage` disponível.
  Reinício restaura seleção/modelo do documento de produto e descriptografa chave.
- Nenhuma sentinela em mensagens HTTP/SSE públicas, DOM, localStorage, documento
  de produto ou stdout/stderr/console coletados. Erros injetados contêm a própria
  sentinela para provar que o corpo privado não chega à interface.
- Chaves não entram na factory/cache; resolução por operação e descarte cobertos
  pelos testes nativos. Factory antiga após troca de endereço continua recusada.

O renderer recebe a chave transitoriamente, como no modelo anterior. Não há
promessa de zeroização de strings ou proteção contra todo código comprometido
nesse renderer. Nenhuma configuração ou credencial pessoal foi lida pelo gate.
Perfil e crash dumps usam diretório temporário próprio fora do repositório.

## Correção confirmada de vida útil

Antes, o consumidor cancelava o corpo e o runtime encerrava o prazo antes de
aguardar `reader.cancel()`. Uma fonte cujo cancelamento nunca resolve deixava
a operação pendente sem prazo. Experimento independente confirmou operação
pendente depois do prazo, apesar do contador ativo zerado.

Agora o prazo/descarte permanecem ativos enquanto a limpeza está pendente, o
reader perde a trava antes da espera, e timeout/dispose encerram a promessa.
O observador de abort é removido imediatamente; rejeições tardias são observadas
sem log privado. Erros secundários não substituem o erro primário seguro.
Contraprova: **RED 6 FAIL / 29 PASS → GREEN 35 PASS** de provider; mais 1 HTTP
local, e **62 PASS** no núcleo completo. Revisão independente confirmou ausência
de trava e retorno `timeout`. Não foi aumentado timeout de produção.

## Migração adicional e matriz atual de dependências

Escolhido o ID persistido `lm-studio` por reutilizar exatamente o protocolo já
implementado, atender mais um consumidor existente e evitar adapter de protocolo
fictício. Não há nova URL, porta ou catálogo fixos. É um identificador histórico
de compatibilidade, não uma seleção por marca no núcleo.

| Área/caminho | Estado atual | Evidência/limite |
| --- | --- | --- |
| Contratos/registry/cache/HTTP/SSE próprios | Independentes de AIRI/SDK/Vue | Núcleo nativo e HTTP local |
| `openai-compatible` | Transporte próprio | Stores, Chromium e Electron/HTTP local |
| `lm-studio`, endereço explícito | Transporte próprio de chat, descoberta e sonda | 6 testes novos, sem chamar factory/definição antiga; Electron JSON com chave própria |
| Mesmo ID sem endereço | Legado preservado | Factory/default anterior mantidos por teste |
| Mesmo ID, endereço explícito inválido | Erro próprio seguro | Sem requisição, leitura de chave ou fallback oculto |
| Outros IDs compatíveis | Factory legada | Não migrados só por compartilharem protocolo |
| Outros protocolos de texto | Factory legada | Exigem adapter e fixtures reais do formato antes de migrar |
| Metadata/validação automática/configuração/ativação | Ainda AIRI/host | Inclusive validação agendada do registro local; não migrada nesta entrega |
| Despacho `getChatProviderInstance` | Port local temporário | Substitui somente action local; instalação depende do host |
| Histórico/ferramentas/parser do chat | Core/xsAI/Stage UI | Transporte próprio não substitui loop de ferramentas |
| IPC de configuração/cofre | Contratos Lia, infraestrutura Eventa/Electron existente | Validado no Electron; sem novo schema |
| Voz/visão/Brain/avatar/presença | Legados, sem alteração | Não aprovados por este gate |
| Build/empacotamento/instalação | Tooling e estrutura legados | Build Stage PASS; instalador não executado |

No host, `stores/providers/provider.ts` continua criando instâncias por
`definition.createProvider(...)`; `stores/lia/provider-runtime.ts` despacha os
ramos migrados e delega os demais. Descoberta/sonda legadas continuam no mesmo
port de rascunho. Não remover dependências usadas por esses caminhos.

## Compatibilidade e verificações

Ambiente: Windows/PowerShell, Node host 26.8.1; Electron **43.4.1**, Node interno
**24.18.1**, Chromium **150.0.7871.224**, Playwright 1.62.1. Somente HTTP loopback
em porta efêmera, perfil temporário e chaves aleatórias sintéticas.

| Cenário | Veredito | Evidência |
| --- | --- | --- |
| Endereço e modelo personalizados, autenticação | PASS Windows real de componentes | URL de fixture e `custom/Electron:Q4` intactos |
| JSON e SSE | PASS Windows real de componentes | Texto exato `Electron Lia\n42` |
| Descoberta | PASS Windows real de componentes | GET models pelo transporte próprio |
| Vazio, HTTP 401, erro dentro do SSE | PASS Windows real de componentes | Estados terminais `empty`, `credentials`, `protocol`; sentinela ausente |
| Cancelamento pelo usuário | PASS Windows real de componentes | Estado `cancelled`, conexão fechada |
| Timeout padrão | PASS Windows real de componentes | Estado `timeout`, **30 034 ms**, pedido sem headers fechado |
| Reinício | PASS Windows real de componentes | Novo processo, seleção/modelo restaurados, autenticação válida |
| Crash do renderer | PASS Windows real de componentes | Evento `render-process-gone`, pedido fechado, processos próprios ausentes |
| Encerramento | PASS Windows real de componentes | Ambas saídas zero, descendentes próprios ausentes; não mata outros processos |
| Limpeza travada de Web Stream | PASS automatizado | Testes de fonte controlada; não simula o cofre |
| Serviço/modelo externo | NÃO EXECUTADO | Nenhuma chamada externa ou paga autorizada nesta missão |
| Launcher/Stage completo, voz/imagem/hardware | NÃO EXECUTADO nesta rodada | Painel fixture explicitamente identificado; não é produto |
| Instalador/instalação limpa/atualização | NÃO EXECUTADO | Não houve empacotamento |

### Comandos executados

Todos os comandos finais abaixo terminaram com saída **0**; nenhum teste foi
omitido nas suítes selecionadas. Python, Node tools e Launcher não foram
reexecutados nesta rodada: não houve mudança nesses caminhos. Não são PASS novos.

| Diretório | Comando | Resultado |
| --- | --- | --- |
| Raiz | `node --experimental-strip-types --test "lia/core/test/*.test.ts"` | PASS automatizado, 62 |
| `airi` | `./node_modules/.bin/vitest.cmd run --config apps/stage-tamagotchi/vitest.config.ts --project node src/renderer/stores/lia` | PASS automatizado, 377 / 32 arquivos |
| `airi` | `./node_modules/.bin/vitest.cmd run --config apps/stage-tamagotchi/vitest.config.ts --project browser LiaProviderConfig.browser.test.ts native-provider-runtime.browser.test.ts` | PASS Chromium, 13 / 2 arquivos |
| Stage | `node --test scripts/provider-runtime-electron/gate.test.mjs` | PASS Windows real de componentes, 1 teste composto / 7 grupos de verificações |
| Raiz | `./airi/node_modules/.bin/tsc.cmd --project lia/core/tsconfig.json --typeRoots ./airi/node_modules/@types --types node` | PASS strict/noEmit |
| Stage | `./node_modules/.bin/vue-tsc.cmd --noEmit` | PASS |
| Stage | `./node_modules/.bin/vue-tsc.cmd --noEmit --project scripts/provider-runtime-electron/tsconfig.json` | PASS |
| Stage | `& "$env:LOCALAPPDATA/Lia-DevTools/node_modules/.bin/corepack.cmd" pnpm run build` | PASS main/preload/renderer |

Lint final, saída 0:

```powershell
# Raiz
./airi/node_modules/.bin/eslint.cmd --config lia/core/eslint.config.mjs lia/core/src/providers/runtime.ts lia/core/test/providers.test.ts
# airi
./node_modules/.bin/moeru-lint.cmd apps/stage-tamagotchi/src/renderer/services/lia/native-provider-runtime.ts apps/stage-tamagotchi/src/renderer/stores/lia/provider.ts apps/stage-tamagotchi/src/renderer/stores/lia/native-provider-migration.test.ts
./node_modules/.bin/eslint.cmd --config apps/stage-tamagotchi/scripts/provider-runtime-electron/eslint.config.mjs apps/stage-tamagotchi/scripts/provider-runtime-electron/
```

O perfil específico libera somente `node:test` nesse runner e extensão `.ts`
no import do próprio perfil; mantém as outras políticas do repositório.

### Roteiro e evidências Windows

1. Compilar Stage para produzir o preload e seus chunks irmãos.
2. No Stage, executar o comando Node do gate acima. Ele compila o painel e o
   main de fixture no temporário, inicia Electron visível e servidor loopback.
3. O runner planta duas chaves sintéticas por IPC, faz os cenários da tabela,
   tira captura, fecha/reabre o processo e provoca crash controlado do renderer.
4. Conferir report, saída zero e ausência dos PIDs observados. Fora de Windows
   o teste registra SKIP explícito; não aprova `safeStorage` em outro sistema.

Última execução completa: `Tests/artifacts/provider-runtime-electron/1793337018084/`
contém `report.json`, `electron.log` e `electron.png`. Duração **33,764 s**;
7 grupos concluídos, exit 0, `logSecretsAbsent=true`. Perfil temporário informado
no report contém apenas dados sintéticos cifrados e dumps de teste.

Logs adicionais (ignorados pelo Git): `Tests/artifacts/provider-runtime-e2e-*-20261030.log`,
`provider-runtime-electron-20261030.log`, `provider-runtime-cancel-*-20261030.log`
e `provider-runtime-migration-*-20261030.log`.

Falhas intermediárias corrigidas: leitura do evento SDK no painel (`text.delta`),
consulta de processo após descarte do objeto Playwright e lint do novo runner.
Eram defeitos do teste; não foram apresentados como falhas do produto. A revisão
encontrou e corrigiu asserções ausentes de autenticação após restart e saída zero;
o gate final foi reexecutado com ambas. Warnings de localStorage do Node e
bundler permanecem nos logs; não são falhas finais. Nenhum timeout foi aumentado.

## Arquivos e Definition of Done desta missão

| Arquivos | Mudança |
| --- | --- |
| `lia/core/src/providers/runtime.ts`, `lia/core/test/providers.test.ts` | Vida útil e 6 regressões de cancelamento |
| `airi/apps/stage-tamagotchi/src/renderer/services/lia/native-provider-runtime.ts` | Segundo ID, seleção por configuração explícita |
| `airi/apps/stage-tamagotchi/src/renderer/stores/lia/provider.ts`, `native-provider-migration.test.ts` no mesmo diretório | Rascunhos e 6 testes de migração |
| `airi/apps/stage-tamagotchi/scripts/provider-runtime-electron/` | Main/renderer/página de fixture, runner, tsconfig e perfil lint |
| Este relatório, `docs/design/LIA-PROVIDER-RUNTIME.md`, relatório arquitetural anterior | Matriz, contrato, roteiro e evidência |
| `docs/project/CURRENT-STATE.md`, `QUANTO-FALTA.md` | Estado real e próximo item |

- [x] Fronteiras Electron reais exercitadas, com escopo de componentes declarado.
- [x] Cofre/canais de produção, isolamento de credenciais e erros seguros testados.
- [x] Transporte em cenários de falha e cancelamento travado corrigido com RED/GREEN.
- [x] Evidência local diferenciada de modelo externo e aplicação completa.
- [x] Migração funcional adicional, defaults antigos preservados e matriz atualizada.
- [x] Núcleo/stores/Chromium/Electron/lint/typecheck/build pertinentes executados.
- [ ] Release completa da Lia: Stage/modelo real, imagem/voz e instalador não validados nesta rodada.
- [ ] Independência completa de AIRI: configuração/ativação, outros protocolos,
      orquestração, voz/avatar e distribuição ainda necessários.

**Próxima dependência a remover:** registro/configuração de transporte do host,
com migração compatível dos documentos antigos antes de cortar a factory legada.
Depois, escolher adapter de protocolo adicional usando fixtures específicas.
Commit/push somente na branch acordada; hash final e igualdade local/remoto
verificados após publicação e informados na entrega, sem hash autorreferente.
