# Transcrição nativa, cancelamento e credenciais — 07/11/2026

Base de revisão: `e152900`, branch `arena/01a10290-lia-project`.
O baseline funcional do aplicativo permanece `3ef6d11`.

## Implementação

Antes, somente a gravação do alvo derivado padrão passava pelo Main. A
invalidação de uma sessão descartava o texto no Renderer, mas não cancelava
a requisição. Os demais clientes de gravação ainda montavam HTTP no Renderer.

Agora a gravação recebe um `AbortSignal` do ticket da sessão. Parar a escuta,
descartar o scope, trocar a mídia, iniciar uma gravação substituta ou trocar
de sessão cancela o ticket. Trocar provedor/modelo também cancela a operação
do pipeline. A gravação nova substitui a anterior; não há agregação implícita
de frases de gravações substituídas.

`createMainTranscription` gera UUID antes do envio e acompanha o pedido
enquanto aguarda IPC. Abort/dispose encerra a espera, envia cancelamento uma
vez e observa resolução/rejeição tardia sem publicar texto. Uma porta
descartada recusa novas operações. O sinal é verificado antes/depois de ler
o arquivo, sem tentar serializar `AbortSignal` por IPC.

No Main, o handler registra UUID e `WebContents` antes de aguardar o serviço.
Somente o dono pode cancelar. Destruição/crash da janela e dispose abortam
suas operações. Limites: oito pedidos por janela, 32 no total. Sinais distintos
preservam concorrência entre janelas. A deadline continua em 30 segundos,
separada do código `cancelled` solicitado pelo usuário. Repository, fetch e
leitura da resposta são interrompíveis mesmo quando uma dependência não
resolve; listeners e timers são retirados ao terminar.

Há um defeito reproduzido no produtor multipart do Node 24.22.2: cancelar
imediatamente um stream FormData com Blob pode causar enqueue após fechamento
(`ERR_INVALID_STATE`). O serviço conclui a codificação local, limitada pelos
24 MiB do áudio, antes de ligar o sinal ao HTTP. Cancelar durante essa fase
encerra a operação e impede o envio; a codificação já iniciada pode terminar
localmente. A deadline não foi aumentada. O cancelamento durante HTTP foi
verificado contra servidor local real, incluindo fechamento da conexão.

## Adaptadores e configuração

Os nomes abaixo são identidades persistidas existentes, não um catálogo novo.

| Adaptador | Caminho e particularidades | Situação |
| --- | --- | --- |
| Alvo derivado padrão | Multipart, registro de chat existente, cofre Main | Main com cancelamento |
| `openai-audio-transcription` | Multipart `audio/transcriptions`, Bearer | Main |
| `openai-compatible-audio-transcription` | Mesmo protocolo, endereço/modelo escolhidos | Main |
| `comet-api-transcription` | Mesmo protocolo multipart | Main |
| `mimo-audio-transcription` | JSON `chat/completions`, áudio base64, header `api-key`, texto de `choices` | Main |
| `app-local-audio-transcription` | Multipart, chave opcional em loopback | Main; editor específico continua WIP |
| `browser-local-audio-transcription` | Indisponível no Stage Windows | Preservado, não migrado |
| `aliyun-nls-transcription` | Token assinado, WebSocket PCM e sessões | Legado pendente |
| `official-provider-transcription` | HTTP contínuo/SSE, autenticação por sessão | Legado pendente |
| Web Speech / Apple Speech | API do navegador / plugin nativo darwin | Preservados; Apple não executável neste Windows |

Os cinco adaptadores de gravação usam protocolo `audio-transcription` no mesmo
repository `lia-transports.json`. Instâncias com ID personalizado usam
`definitionId` para selecionar o adaptador e seu próprio `credentialRef`.
Não há segundo registry de endpoints. Migração não sobrescreve registros,
não ressuscita tombstones e mantém a adoção/limpeza transacional já existente
para chaves históricas. Um conflito histórico preserva os dados e exige
salvamento explícito; não autoriza sobrescrever o cofre silenciosamente.

O pedido contém áudio, modelo, formato, idioma, prompt e temperatura validados;
não aceita endpoint, header ou credencial. Multipart preserva opções e
`verbose_json`; o adaptador JSON mantém seu formato legado e suas opções
efetivamente suportadas, sem presumir capacidades adicionais. O filtro de
confiança funciona também no caminho nativo. Playground de arquivo usa o
mesmo executor Main, sem construir cliente autenticado no Renderer.

Os editores existentes das quatro definições remotas ganham salvamento
explícito de chave por porta opcional do host. A porta é instalada antes dos
componentes em todas as janelas, inclusive settings follower. O campo é
transitório, limpa após envio/unmount e não emite a chave para v-model/config.
Consulta recebe somente booleano. Salvar permite rotação explícita no cofre e
remove cópias históricas somente após sucesso. Endereço editado nesses editores
é enviado explicitamente à persistência Main antes da próxima transcrição.
A validação automática confere prontidão da configuração, não certifica conexão:
a interface orienta transcrever áudio para testar. Web sem porta mantém o contrato
anterior. O editor genérico de instâncias personalizadas ainda exige revisão
específica da entrada de credenciais; isso não foi declarado fechado.

Segurança do HTTP: HTTPS ou HTTP loopback, sem userinfo/query/fragment, sem
redirecionamentos; áudio 24 MiB, resposta 8 MiB, texto/segmentos limitados e
projetados. Erros HTTP não retornam corpo do serviço nem mensagem que possa
ecoar a chave. Dados de autenticação são resolvidos exclusivamente no Main
para os adaptadores migrados.

## Auditoria de credenciais alcançáveis

| Área | Execução atual | Credencial no Renderer? | Situação |
| --- | --- | --- | --- |
| Chat curado e instâncias de transporte nativo | Main | Não pela operação | Migrado |
| Chat fora desses contratos | Renderer legado | Sim, resolver/cofre legado | Pendente |
| Transcrição gravada, cinco definições + alvo derivado | Main | Sem leitura do cofre; digitação transitória no editor remoto | Migrado no caminho de execução |
| STT WebSocket e HTTP contínuo com sessão | Renderer/sessão legado | Autenticação/token pode existir | Pendente |
| Voz automática compatível, duas definições | Main | Não pela operação | Migrado no corte anterior |
| Prévia compatível, mesmas definições | Main | Não pela operação | Migrado no corte anterior |
| Demais vozes remotas | Renderer legado | Resolver normal recusa apiKey; outros mecanismos próprios não certificados | Pendente, sem nova alegação de suporte |
| Motores locais sem credencial | Caminho existente ou multipart Main | Não necessária | Preservado; hardware não exercitado |
| Visão com provider nativo | Mesmo runtime Main de chat | Não pela operação | Migrado |
| Visão/devtools fora do catálogo, outros consumidores | Clientes compartilhados legados | Pode existir | Pendente |

`secretGet` genérico no Main ainda permite scopes legados não protegidos por
records/tombstones. Não foi fechado indiscriminadamente: isso quebraria chat e
protocolos próprios ainda alcançáveis. Os cinco scopes migrados são negados
mesmo antes da migração; scopes personalizados ficam protegidos pelo registro.
O resolver também recusa essas definições. Corrigido bypass adicional:
`withResolvedCredential` agora retira `apiKey` histórico da cópia sempre que
há resolver instalado; somente o retorno explícito do resolver pode fornecê-la.
O original não é apagado, e a aplicação web sem resolver mantém seu comportamento.

Isso não é uma certificação de ausência global de segredos no Renderer.
Permanecem os consumidores acima, possíveis campos próprios de autenticação,
catálogo/editor genérico e cópias históricas divergentes preservadas. Migrar
WebSocket/SSE de sessão exige contrato de sessão bidirecional, renovação de token,
backpressure e autorização própria; tratá-los como upload multipart seria uma
migração incorreta. O Stage continua dependendo dos stores, VAD, UI, sessão e
playback compartilhados; não foi declarado desacoplado do AIRI.

## Evidências automatizadas

Comandos executados no Windows (exit 0 salvo as falhas intermediárias descritas):

| Diretório | Comando / conjunto | Resultado |
| --- | --- | --- |
| `airi/` | `vitest.cmd run --config apps/stage-tamagotchi/vitest.config.ts --project node src/renderer/stores/lia src/renderer/services/lia src/main/services/lia/transcription-service.test.ts src/main/services/lia/transcription-adapters.test.ts src/main/services/lia/transport-config-service.test.ts` | PASS automatizado: 760 testes / 55 arquivos |
| `airi/` | Mesmo config/projeto, `main-transcription.test.ts` após preflight de tamanho | PASS automatizado: 7 testes |
| `airi/` | `vitest.cmd run --config packages/stage-ui/vitest.config.ts --project node voice-input-session.test.ts voice-input-transcription-chain.test.ts hearing.test.ts hearing.analytics.test.ts provider-schema-defaults.test.ts credential-config-port.test.ts` | PASS automatizado: 55 testes / 6 arquivos |
| `airi/` | Mesmo config/projeto, `voice-input-session.test.ts` após caso de troca de sessão | PASS automatizado: 18 testes |
| `airi/` | Config Stage UI, `--project browser provider-api-key-input.browser.test.ts` | PASS automatizado Chromium: 5 testes |
| `airi/` | Config Stage, `--project browser SttCredential.browser.test.ts` | PASS automatizado Chromium: 1 teste |
| Raiz | `node --experimental-strip-types --test "lia/core/test/*.test.ts"` | PASS automatizado: 78 testes |
| Harness | `node --test lib/*.test.mjs gate-integrity.test.mjs` | PASS automatizado: 148 testes após correção do monitor |
| `airi/` | `moeru-lint.cmd` nos arquivos TS/Vue tocados; ESLint específico do harness | PASS automatizado |
| Raiz | ESLint com `lia/core/eslint.config.mjs` nos três arquivos Core alterados | PASS automatizado |
| Stage | `pnpm exec vue-tsc --noEmit`; `pnpm exec vue-tsc --noEmit --project scripts/provider-runtime-electron/tsconfig.json` | PASS automatizado |
| Stage via runner | `electron-vite build` | PASS automatizado, build completo |
| Raiz | `git diff --check` | PASS automatizado |

Logs desta rodada ficam fora do checkout em `J:/lia-evidence/stt-*.log`.
Uma execução compartilhada atingiu o timeout existente ao importar Hearing
com outras verificações em paralelo; a execução isolada (2/2 analytics) e o
conjunto repetido (55/55) passaram sem alterar timeout. Falhas intermediárias
de tipagem e dos testes de regressão foram corrigidas; não foram removidas
asserções para aprovar o resultado.

Captura reproduzível do componente: definir `VITE_LIA_CAPTURE_QA=1` ao executar
`SttCredential.browser.test.ts`. A imagem usa CSS UnoCSS do Stage e é gravada
em `apps/stage-tamagotchi/Tests/artifacts/stt-credential-styled.png`.
Cópia revisada em `J:/lia-evidence/stt-ui/captures/stt-credential-styled-v2.png`.
A primeira captura foi reprovada por falta de contorno visível no campo;
o contraste/borda foi corrigido e a nova captura aprovada. Isso é QA de
componente, não validação visual de toda a aplicação.

### Gate Electron Windows

Electron oficial 43.4.1, 75 arquivos conferidos contra ZIP SHA-256
`c2ef9a5f65472c34d14bd3e67b7d14e66b0c01f124aba45263d6a4232160e13a`.
Runtime existente reutilizado; nenhuma dependência/lockfile foi alterada.
O grupo 4 ganhou transcrição autenticada via IPC/cofre/Main/HTTP local;
o grupo 9 ganhou cancelamento comprovado pelo fechamento da resposta HTTP.
Os 16 grupos e verificações anteriores foram preservados.

A primeira execução 5.1 reprovou o teardown (15/16), pacote
`J:/lia-evidence/caa5aea6-4b9c-4944-8d54-1801535d6809`. Seis processos Discord
foram associados indevidamente a um PID de pai Electron reutilizado: as datas
provam que esses processos antecediam o novo pai. Nenhum foi encerrado.
O monitor passou a verificar a ordem temporal de todas as arestas, fixar a
identidade da raiz e preservar filhos históricos plausíveis e timestamps
indeterminados. Duas rodadas de regressões falharam antes das correções e
passaram depois; não há filtro por nome de executável ou aumento de prazo.
A revisão independente também verificou o caso de filho original sobrevivente
após reutilização do PID. O monitor continua amostral e pode perder processos
que começam e acabam entre consultas; não é equivalente a um Job Object.

Uma execução intermediária 7, com build completo, aprovou 16/16 em
`J:/lia-evidence/29d613f1-610f-429e-b0d7-fc4c1d2f25f8`. As execuções finais
com o monitor revisado são registradas a seguir.

| Shell | Resultado Windows real — HTTP sintético local | Pacote exportado |
| --- | --- | --- |
| PowerShell 5.1.26100.9711 | PASS, exit 0, 16/16 grupos, 42 requisições | `J:/lia-evidence/8745f206-19d0-4014-ba4b-9a326e2bcce2` |
| PowerShell 7.6.9 | PASS, exit 0, 16/16 grupos, 43 requisições | `J:/lia-evidence/59eb4cf5-50f1-4955-90fe-895819bccf3a` |

Cada pacote tem `report.json`, `electron.log`, `electron.png`, `environment.json`
e `manifest.json`. Tamanhos e SHA-256 dos quatro arquivos foram conferidos
independentemente. Cada execução registrou 11 identidades
encerradas, zero processos vivos/indeterminados no encerramento e
`logSecretsAbsent: true`. Os comandos finais foram, no diretório do harness:

```powershell
powershell.exe -NoProfile -File .\run-gate-windows.ps1 -SkipBuild -ExportRoot J:\lia-evidence -ElectronZip $zip
pwsh.exe -NoProfile -File .\run-gate-windows.ps1 -SkipBuild -ExportRoot J:\lia-evidence -ElectronZip $zip
```

`$zip` apontou ao ZIP oficial verificado já existente no diretório temporário.
O build completo havia passado nas duas execuções anteriores; `-SkipBuild`
reutilizou esse output. Entre o último build e os gates finais mudaram apenas
o monitor do harness, testes/documentação e formatação; o produto compilado
foi preservado. A última correção ESLint do monitor foi somente formatação;
148 testes do harness passaram novamente. O aviso de frame descartado no crash
controlado permanece visível e não foi suprimido.

Os dois relatórios de auditoria existentes permaneceram sem diff. Não houve
remoção de arquivos, alteração em `core-agent`/providers Core preexistentes,
lockfiles, dependências, `Lia.bat` ou `DevKit.bat`. As mudanças Core deste corte
são somente o protocolo de transportes, seu validador e a regressão de persistência.

### Checklist de conclusão deste corte

- [x] Cancelamento Renderer → IPC → Main → HTTP, timeout distinto e respostas tardias.
- [x] Cinco adaptadores de gravação, modelo/idioma, playground e confiança preservados.
- [x] Campo nativo de chave nas quatro páginas remotas; rotação explícita sem raw read.
- [x] Testes, build, lint, typechecks e gates Electron locais 5.1/7 com evidências.
- [x] Matriz de cobertura, limitações e roteiro manual documentados.
- [ ] Migração dos protocolos STT de sessão e fechamento de todos os leitores legados.
- [ ] Validação com serviço autorizado e hardware real.
- [ ] Stage completo, instalador e release funcional do aplicativo.

## Roteiro manual Windows — NÃO EXECUTADO

1. Com um serviço autorizado, escolher o adaptador e endereço. Digitar a chave
   no campo nativo e acionar **Salvar chave**. Reabrir settings; campo vazio e
   presença confirmada. Selecionar modelo e idioma próprios do serviço.
2. Gravar frase e conferir texto. Ativar filtro de confiança quando suportado.
   Repetir com arquivo no playground; confirmar modelo/endereço escolhidos.
3. Durante envio/resposta, desligar microfone, trocar sessão e iniciar outra
   gravação. Confirmar abort na requisição correspondente e que o primeiro texto
   não aparece na sessão/gravação nova. Não basta observar a UI.
4. Abrir duas janelas e cancelar uma operação; a outra deve concluir. Fechar a
   janela com transcrição em curso e conferir encerramento de sua conexão.
5. Trocar endereço e salvar nova chave; revogar a anterior no serviço autorizado
   e confirmar nova transcrição. Não registrar valores em evidência.
6. Testar falha de rede, credencial recusada e serviço que não responde. Timeout
   deve ser distinto de cancelamento, sem ecoar corpo do serviço.
7. Repetir com motor local disponível e verificar microfone, VAD e texto. Conferir
   armazenamento, logs e resultados sem incluir conteúdo privado ou credenciais.

Nenhum serviço externo ou conta foi usado nesta rodada. Microfone real, reconhecimento
real, áudio físico, protocolos de sessão, cena completa e instalador não são
aprovados por fixtures HTTP locais. Próximo corte: fechar autenticação e execução
dos consumidores legados por protocolo, começando pelo editor genérico e chat
fora do catálogo, sem remover as implementações locais.


## Arquivos alterados neste corte

```text
airi/apps/stage-tamagotchi/scripts/provider-runtime-electron/gate.test.mjs
airi/apps/stage-tamagotchi/scripts/provider-runtime-electron/lib/process-monitor.mjs
airi/apps/stage-tamagotchi/scripts/provider-runtime-electron/lib/process-monitor.test.mjs
airi/apps/stage-tamagotchi/scripts/provider-runtime-electron/main.ts
airi/apps/stage-tamagotchi/scripts/provider-runtime-electron/renderer.ts
airi/apps/stage-tamagotchi/src/main/services/lia/transcription-adapters.test.ts
airi/apps/stage-tamagotchi/src/main/services/lia/transcription-adapters.ts
airi/apps/stage-tamagotchi/src/main/services/lia/transcription-service.test.ts
airi/apps/stage-tamagotchi/src/main/services/lia/transcription-service.ts
airi/apps/stage-tamagotchi/src/main/services/lia/transport-config-service.test.ts
airi/apps/stage-tamagotchi/src/main/services/lia/transport-config-service.ts
airi/apps/stage-tamagotchi/src/renderer/components/lia-config/SttCredential.browser.test.ts
airi/apps/stage-tamagotchi/src/renderer/pages/index.vue
airi/apps/stage-tamagotchi/src/renderer/services/lia/main-transcription.test.ts
airi/apps/stage-tamagotchi/src/renderer/services/lia/main-transcription.ts
airi/apps/stage-tamagotchi/src/renderer/services/lia/transport-config.ts
airi/apps/stage-tamagotchi/src/renderer/stores/lia/hearing.test.ts
airi/apps/stage-tamagotchi/src/renderer/stores/lia/hearing.ts
airi/apps/stage-tamagotchi/src/renderer/stores/lia/provider-runtime.ts
airi/apps/stage-tamagotchi/src/renderer/stores/lia/provider.ts
airi/apps/stage-tamagotchi/src/renderer/stores/lia/transcription-bridge.test.ts
airi/apps/stage-tamagotchi/src/renderer/stores/lia/voice-preview-credentials.probe.test.ts
airi/apps/stage-tamagotchi/src/shared/eventa/lia-transcription.ts
airi/apps/stage-tamagotchi/src/shared/lia/transcription-transport.ts
airi/packages/stage-pages/src/pages/settings/providers/transcription/comet-api-transcription.vue
airi/packages/stage-pages/src/pages/settings/providers/transcription/mimo-audio-transcription.vue
airi/packages/stage-pages/src/pages/settings/providers/transcription/openai-audio-transcription.vue
airi/packages/stage-pages/src/pages/settings/providers/transcription/openai-compatible-audio-transcription.vue
airi/packages/stage-ui/src/components/scenarios/providers/provider-api-key-input.browser.test.ts
airi/packages/stage-ui/src/components/scenarios/providers/provider-api-key-input.vue
airi/packages/stage-ui/src/components/scenarios/providers/transcription-provider-settings.vue
airi/packages/stage-ui/src/composables/audio/voice-input-session.test.ts
airi/packages/stage-ui/src/composables/audio/voice-input-session.ts
airi/packages/stage-ui/src/composables/audio/voice-input-transcription-chain.test.ts
airi/packages/stage-ui/src/composables/audio/voice-input-transcription-chain.ts
airi/packages/stage-ui/src/composables/use-provider-validation.ts
airi/packages/stage-ui/src/stores/chat/chat-provider-runtime.ts
airi/packages/stage-ui/src/stores/modules/hearing.ts
airi/packages/stage-ui/src/stores/providers/credential-config-port.test.ts
airi/packages/stage-ui/src/stores/providers/credential-config-port.ts
airi/packages/stage-ui/src/stores/providers/provider-schema-defaults.test.ts
airi/packages/stage-ui/src/stores/providers/provider.ts
docs/architecture/LIA-NATIVE-PROVIDER-COVERAGE.md
docs/architecture/LIA-NATIVE-SPEECH-PREVIEW.md
docs/architecture/LIA-NATIVE-TRANSCRIPTION.md
docs/project/CURRENT-STATE.md
docs/project/QUANTO-FALTA.md
lia/core/src/transports/contracts.ts
lia/core/src/transports/validation.ts
lia/core/test/transports.test.ts
```
