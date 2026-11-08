# Lia — retomada da finalização no Windows

Rodada de 07/11, continuada em 08/11/2026. **Release NÃO APROVADA.** Baseline funcional
continua `3ef6d11`. Branch `arena/01a10290-lia-project`; preflight local e remoto
em `40326d7`, sem divergência. Nenhum reset, clean, stash, troca de branch,
rebase ou descarte foi realizado. `Lia.bat` e `DevKit.bat` preservados.

## Implementação recuperada e revisão

Os arquivos da execução interrompida foram preservados e integrados, incluindo
novos testes. Declaração de conclusão de worker não foi aceita como gate.
Estado detalhado e prioridades no
[plano de conclusão](../project/LIA-APP-COMPLETION-PLAN.md).

Defeitos encontrados e tratados nesta retomada:

- Restauração Tamagotchi podia sair da tela ao desconectar monitor. Regressão
  vermelha observada; agora a restauração usa área disponível e preserva proporção.
- Troca de endereço/chave concorria com abertura do Stage. Host compartilha
  exclusão entre save/start/conversar; registro desabilitado por CAS antes da
  chave, com recuperação fail-closed persistente quando rollback falha.
- Primeiro uso gerenciado não ativava o par salvo: sua ativação só existia na
  Home antiga, que o fluxo gerenciado bloqueia. Boot passa a ativar a seleção
  canônica após hidratação no leader.
- Essa ativação expôs outro defeito: invalidação de cache chamava descarte
  terminal. `invalidate` cancela a geração antiga permitindo nova execução;
  `dispose` continua terminal e cancela ID tardio uma única vez.
- Os novos painéis só estavam na Home antiga. Rota própria `/settings/lia`
  e entrada em configurações tornam os contratos acessíveis no fluxo gerenciado.
- Idioma do Stage vinha do estado legado. A integração passa a usar a preferência
  canônica; falha de confirmação recebe feedback seguro.
- Escrita de voz reconstruía o documento omitindo presença, setup e Brain.
  Regressão verifica preservação dos três domínios.
- Rodapé técnico aparecia nas telas comuns do Launcher. Agora só aparece em
  Diagnósticos; revisão visual confirmou a correção.

A fila transacional das preferências Main foi corrigida e revisada: alterações
rejeitadas não contaminam gravações posteriores. Os três escritores de provider,
voz e engine de voz usam a mesma fila. O estado em memória só é publicado após
`rename`; o temporário próprio é removido em falha. Regressão presença rejeitada
→ idioma salvo → reinício passou. Contraprova publicando antecipadamente falhou.
Reexecução focada final: 91/91, exit 0 (`completion-atomic-final.log`).

## Resultados já observados

Ambiente: Windows 10.0.26200, Node 24.22.2, pnpm 11.24.0, Electron oficial
43.4.1. PowerShell 5.1 e 7 disponíveis. Dados sintéticos e perfis separados;
credenciais do usuário não foram usadas.

| Verificação | Comando e diretório | Resultado real |
| --- | --- | --- |
| Baseline Python | `python -m unittest discover -s . -p "test_*.py" -t .`, `tools/` | PASS automatizado: 498, 10 skips, exit 0; entradas Python não alteradas nesta retomada |
| Harness Node | `node --test "Tests/tools/*.test.mjs"`, raiz | PASS automatizado: 267, exit 0; repetido na retomada |
| Core independente | `node --experimental-strip-types --test "lia/core/test/*.test.ts"`, raiz | PASS automatizado final: 92, exit 0, inclui canal Main |
| Produto/presença canônica | `vitest run src/product/config.test.ts src/product/config-write.test.ts`, `airi/packages/lia-core/` | PASS automatizado: 60, exit 0 |
| Launcher | `corepack pnpm run test`, `airi/apps/lia-app/` | PASS automatizado final: 279, 2 skips preexistentes, 28 arquivos, exit 0 |
| Stage ampliado, primeira tentativa | `vitest run --project node src/main/services/lia src/renderer/services/lia src/renderer/stores/lia`, Stage | FAIL: 1655 PASS/3 FAIL; duas guardas estruturais antigas e um scanner excedeu seus 5 s |
| Guardas corrigidas | `vitest run --config vitest.node.config.ts src/main/services/lia/brain-correlation-observer.test.ts src/main/services/lia/brain-send-terminal-report-listener.test.ts`, Stage | PASS automatizado: 74, exit 0, sem aumentar timeout ou alterar allowlist do scanner |
| Memória/personalidade Chromium | `vitest run --project browser src/renderer/components/lia-config/sections/MemorySection.browser.test.ts src/renderer/components/lia-config/sections/PersonalitySection.browser.test.ts`, Stage | PASS automatizado: 10, exit 0 |
| Presença/monitores simulados | `vitest run --project node presence-service.test.ts`, Stage | PASS automatizado: 4, exit 0; não é multimonitor físico |
| Escrita de voz preserva domínios | `vitest run --config vitest.node.config.ts src/main/services/lia/voice-config-service.test.ts`, Stage | PASS automatizado: 14, exit 0, antes da revisão transacional |
| Build Launcher | `corepack pnpm run build`, Launcher | PASS build, exit 0; último build contém o rodapé restrito |
| Build Stage | `corepack pnpm run build`, Stage | PASS build, exit 0; precisa repetir após correções recentes |
| Typecheck intermediário | `corepack pnpm exec vue-tsc --noEmit`, Stage | FAIL exit 2 em tipo de fixture de activation.test.ts; correção em revisão |

Não se transforma execução agregada com falha em PASS. O scanner passou
isolado em 330 ms e depois no conjunto de 74; a causa exata da demora inicial
não foi confirmada. Logs intermediários preservados em `J:/lia-evidence/` com
prefixo `completion-` e `completion-resume-`.

## Windows real: evidência e limites

Automação Playwright no Electron oficial, perfil vazio e serviço HTTP sintético:

- Configuração salva pela UI, chave removida do campo, modelos descobertos e
  teste de ferramenta em duas rodadas com marcador no resultado: PASS Windows
  para essa integração local, **não valida provedor externo**.
- Stage abriu e o avatar terminou de carregar, com captura real em
  `J:/lia-evidence/completion-resume-runtime-1794074495990/captures/03-stage.png`.
  O modelo de exemplo não é prova de identidade visual final da Lia.
- Conversa pelo chat ainda FAIL na tentativa
  `completion-resume-runtime-1794074578934`; não houve HTTP de chat, motivando
  as correções de boot e invalidação descritas acima. Não houve aumento de timeout.
- Uma tentativa anterior selecionou BeatSync oculto; outra excluiu a janela
  principal por seus parâmetros de URL. São falhas do roteiro preservadas,
  não prova de falha de criação da janela principal.
- Revisão visual: Home/IA legíveis, sem chave visível ou rodapé técnico após a
  correção; Stage com sombra ciano deslocada no modelo de exemplo. Mapa estático
  encontrou `DropShadowFilter` colorido, blur 0/distância 20; isso é hipótese da
  origem visual, não prova de compatibilidade gráfica.

Não executados ainda nesta retomada: gate físico de voz, serviço externo,
imagem + texto externo, multimonitor/DPI físico, jogo em primeiro plano e
execução prolongada. O endereço anteriormente informado do serviço local não
estava acessível na tentativa anterior; isso não autoriza usar chaves privadas.

## Bloqueio criptográfico entre Launcher e Stage

O primeiro uso com chave sintética falhou após ativação correta de provider/model
e aceite do job pelo Main. A chamada de HTTP nem chegou ao serviço local;
o resultado era `network`. A leitura de credencial pode lançar erro de
decifragem: agora isso é reportado como `credentials`, sem detalhes privados.
Teste vermelho reproduziu `network`; correção e conjunto de 76 casos passaram.
Não foi alterado ciphertext, configuração de proteção do Windows ou perfil do usuário.

O Launcher não redireciona o perfil Chromium em `src/main/index.ts`, embora o
cofre de produto use o diretório Lia. O Stage redireciona `app.userData` para
esse diretório. Um probe separado no Electron oficial sobre o **cofre sintético**
registrou `available:true`, uma entrada e `decrypts:false` no perfil Stage
(`J:/lia-evidence/synthetic-vault-check.log`). A divergência de perfis e a
impossibilidade de decifrar foram observadas; não se presume que compartilhar
o arquivo de cofre compartilhe sua chave de proteção.
Leitura local dos metadados `Local State` confirmou apenas três booleanos:
ambos os perfis possuem chave protegida e os valores protegidos diferem.
Nenhum valor dessas chaves foi impresso ou versionado.

A correção inicial ainda precisava de um proprietário de credenciais; ele foi
implementado em 08/11, com contrato e limites na seção seguinte. Não foram copiados materiais criptográficos, compartilhado um perfil
Chromium ativo entre hosts ou enviados segredos ao Renderer para contornar o
problema. A documentação [oficial de safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
explica a proteção do sistema; ela não é evidência de interoperabilidade entre
estes dois hosts da Lia.

**FAIL Windows inicial: primeiro uso autenticado Launcher → Stage.** Voz/STT que usem
credenciais escritas por outro host também precisam dessa verificação; gates
do mesmo processo não a substituem. Serviço externo permanece BLOCKED: nova
tentativa de `http://localhost:20128/v1/models` expirou em 4 s.

**PASS Windows, limitado ao serviço local explicitamente sem chave:** no perfil
`completion-resume-runtime-1794086283857`, a UI escolheu a opção sem chave,
descobriu o modelo, verificou a ferramenta e abriu Stage. O texto enviado pelo
chat produziu uma requisição SSE Main com o modelo selecionado e uma resposta
visível. A variante keyless não aprova a variante autenticada. O roteiro desse
perfil escreveu a palavra `authenticated` em um rótulo genérico; a autoridade
é `authentication:explicit-keyless-local-service`, sem header de autorização.
O roteiro seguinte corrigiu esse rótulo para `credentialPolicyPassed`.

O restante desse roteiro falhou ao localizar o botão Settings por capitalização
do nome acessível; conversa já observada não aprova memória/personalidade.

Rodada posterior `completion-resume-runtime-1794086536193` usou foco e Enter no
botão de configurações. A variante de clique por ponteiro encontrou o controle
em animação e depois removido do DOM; não foi usado `force:true` para aprová-la.
Com serviço local sem chave:

- PASS Windows: salvar lembrança, ativar seu uso, enviar conversa e verificar
  a lembrança na requisição real Main. Opt-out seguido de novo envio não levou
  a lembrança. Histórico e opt-in continuam contratos separados.
- PASS Windows: editar Energia pela UI, salvar e enviar outra mensagem mudou
  a assinatura do contexto de sistema recebido pelo fixture. Não mede a
  personalidade subjetiva de um modelo de IA.
- O primeiro roteiro de presença encontrou método CDP de janela indisponível;
  essa falha era de instrumentação, não gate do produto. A rodada
  `completion-resume-runtime-1794086695215` usou leitura de dimensões reais do
  Renderer e encontrou erro ao salvar Livre; **presença real ficou FAIL nessa rodada**.
  Tamagotchi foi preservado; o teste não confirmou multimonitor nem jogos.

Revisão visual independente da captura
`completion-resume-runtime-1794085702958/captures/03-stage.png`: contornos ciano
removidos, sem deformação aparente. A Lia pede sombra neutra suave por uma
propriedade opcional do renderer, preservando a preferência de ligar/desligar
e o visual padrão dos demais consumidores. Isso não substitui avatar oficial,
animação prolongada ou teste gráfico em outras GPUs.

Idioma: Main/Renderer usam o contrato canônico gerenciado, mas a tradução
pt-BR do Stage ainda era parcial. Foram adicionados os controles da personagem
e removido o atalho de login externo da superfície gerenciada. Verificação
integral de todas as páginas/janelas continua NÃO EXECUTADA.

## Continuação de 08/11 — resultados que substituem as falhas iniciais

### Credenciais entre os processos Main

[Contrato implementado](../architecture/LIA-CREDENTIAL-OWNER.md): proprietário
Launcher, pipe local aleatório/capability por execução, validação e limites,
cancelamento e revogação; bootstrap removido do ambiente antes dos renderers.
Novas gravações gerenciadas de `apiKey` vão ao dono; leitura de entrada antiga
do Stage só usa seu cipher original quando o dono reporta ciphertext ilegível.
Não há cache, cópia de material criptográfico ou exportação ao Renderer.
Leitores legados permanecem dívida explícita; não há declaração de segurança global.

Revisão independente encontrou e corrigiu duas corridas de integração: escrita
enfileirada após revogação e leitura de chave sem referência no primeiro cadastro
de voz. A escrita revalida o sinal dentro da fila. Credencial órfã ganha uma
referência CAS desabilitada antes de ser lida e só é habilitada ao concluir o
save; falha preserva a chave e deixa a referência inerte. Contraprovas e testes
ficam em `completion-owner-revoke-red.log`, `completion-owner-speech-first-red.log`
e `completion-owner-orphan-red.log`; não se aumentou timeout.

**PASS Windows com HTTP local autenticado por chave sintética:**
`completion-resume-runtime-1794114829064`, saída 0, sem erros. UI salvou a chave,
descobriu o modelo, completou ferramenta/resultado/resposta e abriu o Stage.
Chat SSE Main chegou ao fixture com autenticação e modelo corretos; resposta
visível. Memória opt-in/opt-out e alteração de personalidade chegaram às
requisições. Isso **não é um provedor de IA externo autenticado aprovado**.

**PASS Windows com HTTP local explicitamente sem chave:**
`completion-resume-runtime-1794114964249`, saída 0. Mesmo fluxo integrado,
acrescido de colocação dentro do segundo monitor conectado (1920×1080 e
1360×768 observados), movimento após despausar, pausa e gravação explícita de
Home. Livre ficou 240×360 e retornou ao tamanho Tamagotchi. O Launcher observou
parada; o filho de desenvolvimento retornou exit 1 ao ser encerrado, portanto
não se declara saída natural exit 0 de aplicativo instalado.

Comando reproduzível na raiz, depois de build Launcher e com aplicativos fechados:

```powershell
$env:LIA_EVIDENCE_ROOT = 'J:/lia-evidence'
node Tests/windows/completion-runtime.mjs
node Tests/windows/completion-runtime.mjs --without-key --presence-more
```

[Roteiro e limites de isolamento](../../Tests/windows/README-completion.md).
[Evidência resumida versionada e hashes das capturas](evidence/2026-11-08-completion-runtime.json).
Os perfis de produto e do Stage são novos; as rodadas citadas preservaram o
perfil Chromium original do Launcher. Agora esse perfil é selecionado
explicitamente quando existente; instalações novas usam `Lia/launcher-profile`.
O nome empacotado não pode trocar o cipher nem compartilhar a pasta ativa do
Stage. Testes cobrem seleção e recusa de colisão; nunca se afirmou isolamento
integral de todos os perfis do roteiro.

### Voz, enquadramento e persistência

A regressão agregada interrompida terminou em **FAIL: 2336 PASS, 7 FAIL, 4 skip,
192 arquivos** (`completion-freeze-stage-tests.log`). Não foi convertida em PASS.
As sete falhas eram guardas antigas: quatro abas em vez de seis, projeção de
personalidade agora feita por helper, seleção nativa explícita de voz/modelo,
catálogo pelo runtime e novo callback de prontidão. Foram atualizadas mantendo
as proibições de catálogo inventado, edição direta da prosa e prontidão falsa.
Também faltavam títulos/resumos de memória/presença em pt-BR/en: adicionados.
Os testes dirigidos passaram; o agregado final é registrado ao concluir a rodada.

A falha do catálogo de voz não provou regressão de TTS: o teste esperava a
mensagem legada `needsConfiguration` numa definição que agora usa configuração
Main-native e ID explícito. A asserção foi corrigida para esse contrato real;
testes do editor mantêm a cobertura de credenciais ausentes do caminho legado.
Voz física continua NÃO EXECUTADA.

Presença tinha outro defeito: o Home retornado virava Proxy reativo e o próximo
IPC falhava no structured clone. Teste RED confirmou, cópia plain-data corrigiu;
sete testes focados passaram. O enquadramento antigo mostrava metade do corpo.
Agora Livre pede corpo inteiro com margem e ignora temporariamente o zoom/offset
de retrato, sem alterar os valores salvos. Teste de dimensões/reatividade e
contraprova RED passaram. Revisão visual independente aprovou a captura
`completion-resume-runtime-1794089122206/captures/08-free-stage.png`: cabelo e
sapatos visíveis, proporções preservadas e sem ciano. O fundo preto não aprova
transparência ou qualidade de sombra escura.

O EPERM na substituição do documento ocorreu em J: e C:. O Restart Manager
identificou o Launcher mantendo o arquivo aberto. Cada linha de log causava
uma releitura completa; logs agora só atualizam Diagnósticos e mudanças de
estado têm evento próprio. Nas rodadas seguintes a falha não se repetiu.
Isso reduz uma amplificação comprovada; não demonstra a causa de kernel de
todos os possíveis EPERM. O destino nunca é apagado para contornar rename.

Serviço externo informado: nova consulta a `http://localhost:20128/v1/models`
em 08/11 expirou em quatro segundos, `TaskCanceledException`: **BLOCKED**.
Não foram usadas chaves privadas. Monitor desconectado, DPI alterado, jogos,
hover/click-through, voz física e ensaio prolongado continuam NÃO EXECUTADOS.

## Empacotamento privado (estado em andamento)

### Verificações finais antes da cópia

| Verificação | Comando | Resultado |
| --- | --- | --- |
| Stage agregado sequencial | `vitest run --project node`, Stage | PASS automatizado: 2350, 4 skips, 193 arquivos, exit 0 |
| Stage após API aditiva de rollback Core | `vitest run --project node src/main/services/lia/credential-owner-access.test.ts src/main/services/lia/secrets.test.ts src/main/services/lia/transport-execution-service.test.ts src/main/services/lia/transcription-service.test.ts src/main/services/lia/speech-config-service.test.ts`, Stage | PASS automatizado: 92, exit 0 |
| Core produto/cofre | `vitest run src/product/config.test.ts src/product/config-write.test.ts src/secrets/vault-backup.test.ts`, pacote lia-core | PASS automatizado: 64, exit 0 |
| Chromium Stage | `vitest run --project browser`, Stage | PASS automatizado: 54, 9 arquivos, exit 0; console emitiu `ResizeObserver loop` preservado no log |
| Chromium editor compartilhado | `vitest run --config vitest.credential-editor.config.ts`, Stage | PASS automatizado: 6, exit 0 |
| Draft compartilhado | `vitest run --project node src/stores/providers/generic-credential-draft.test.ts`, stage-ui | PASS automatizado: 5, exit 0 |
| Typechecks | `corepack pnpm run typecheck` em Launcher, Stage e stage-pages | PASS, exit 0; Launcher declara `tsc`, Stage/páginas declaram `vue-tsc` |
| Lint dos arquivos tocados | `moeru-lint --fix <arquivos>`, airi | PASS, exit 0; avisos de oxlint preservados, sem suprimir regra global |
| Builds estáveis | `corepack pnpm run build` em Launcher, i18n e Stage, sequencialmente | PASS, exit 0; build Launcher também executa build do Core |
| Componentes Electron PS 5.1 | `powershell.exe -NoProfile -File ./scripts/provider-runtime-electron/run-gate-windows.ps1 -SkipBuild -ExportRoot J:/lia-evidence -ElectronZip C:/Users/lucas/AppData/Local/Temp/lia-electron-official-670c18ee-5d18-4b64-893c-ccfdbfa2c3d4.zip`, Stage | PASS Windows, exit 0; pacote `26120a57-5c10-48fa-a46f-376148bad581` |
| Componentes Electron PS 7 | mesmo comando com `pwsh.exe` | PASS Windows, exit 0; pacote `f909f0dc-5b99-45b5-8b2d-9d87915c2391` |

Os dois pacotes de componentes estão em `J:/lia-evidence/<id>/`, cada um com
`report.json` e `electron.log`. Runtime oficial 43.4.1 e ZIP SHA-256
`c2ef9a5f65472c34d14bd3e67b7d14e66b0c01f124aba45263d6a4232160e13a`.
O gate não foi substituído; usa seus grupos reais sobre HTTP local e verifica
ausência de sentinelas nos logs. Não aprova voz física ou serviço de IA externo.

A primeira repetição do Stage junto de typecheck terminou com um timeout de
15 s no import dinâmico de `image-journal.test.ts`: 2349 PASS/1 FAIL/4 skip.
Isolado, esse teste passou (2/2); depois o agregado sequencial passou inteiro.
Não se mudou o teste, seu timeout ou a implementação de imagem para aprová-lo.
Há correlação com concorrência de carga, sem causa de sistema confirmada.

Compatibilidade adicional corrigida antes de congelar: substituição explícita
de chave indecifrável agora usa backup opaco de uma entrada, sem decifrar o valor
antigo. Restore relê o container estritamente, preserva outras entradas e recusa
sobrescrever container corrompido. Se o CAS final falhar, seleção de serviço/modelo,
estratégia e estado anterior também são restaurados antes de reabilitar a rota;
falha da recuperação mantém a rota desabilitada. As contraprovas RED e testes
host/Core estão em `completion-opaque-*` e `completion-selection-*`.

O teste de interlock antigo injetava erro em `setSecret(oldPlaintext)`; foi
adaptado para a nova operação de restore opaco, mantendo os asserts de bloqueio,
reinício e reparo explícito. Não se retirou cobertura da falha.

Revisão do editor encontrou perda de campos não salvos quando a migração de
chave substituía o registro. Novo teste com registry reativo falhou antes da
correção; watcher compara configuração não secreta e identidade no caminho
nativo, preservando rascunho e comportamento legado. Seis testes Chromium PASS.
O PNG Livre possui alpha 0–255 e canto transparente; composição/input nativos
com hover continuam sem gate completo.

Pipeline privado criado, com Stage oficial incluído no Launcher e seleção por
`resources/stage/LiaStage.exe`. Não depende de Node/pnpm no caminho instalado.
Updater upstream desabilitado para Stage gerenciado e identidade `lia-stage`.

Primeira execução real de `node airi/apps/lia-app/scripts/package-windows.mjs
--internal-test`: **INTERROMPIDA, não aprovada**. O builder estava ativo em
CPU/I/O, sem ciclo ou download confirmados, quando se constatou que o teste
Launcher dev havia reconstruído Main/preload durante a cópia. Somente o builder
da sessão, por identidade e parentesco conferidos, foi encerrado. Outputs
provisórios preservados; não são instalador validado. Próxima execução exige
Stage encerrado e novo build completo, sem dev concorrente.

Distribuição pública bloqueada por licenças de produto/assets e gates de
instalação/atualização. A flag interna não aprova distribuição pública.

## Engines e medições

[Comparação técnica](../architecture/LIA-DESKTOP-ENGINE-EVALUATION.md), fontes
primárias, seis engines, fronteiras propostas, riscos e critérios reversíveis.
[Coletor Windows](../../tools/desktop-benchmark/README.md) validado por
auto-observação de cinco segundos em PowerShell 5.1 e 7. **Nenhum benchmark
comparativo da Lia foi produzido; nenhuma engine foi migrada.** GPU CIM
indisponível foi registrada como tal, nunca como consumo zero.

## Preservação

Core anteriormente rastreado intacto na retomada; presença é adição separada.
Relatórios locais de auditoria preservados (ignorados neste checkout):

- `LIA-AGENT-CONSUMPTION-AUDIT.md` SHA-256
  `324e8d799719e14d69e7b058af80fbc129175a6be064badc78ab429f4389604a`.
- `LIA-AGENT-CONSUMPTION-AUDIT.local.md` SHA-256
  `49e41d5237ed116ea8069ffb3a255a242112508fe0e45c0367100f0a87590462`.

Não se inclui `node_modules`, perfil de teste, instalador ou log bruto em Git.
O aviso LF→CRLF é de política do checkout; não foi feita normalização em massa.

## Definition of Done

Checklist vinculante ainda aberto no plano de conclusão. Esta rodada só poderá
marcar os gates efetivamente executados; testes unitários, canvas criado,
sinal ready e geração de pacote não equivalem a release funcional.
