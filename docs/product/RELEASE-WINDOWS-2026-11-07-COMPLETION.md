# Lia — retomada da finalização no Windows

Rodada em andamento, 07/11/2026. **Release NÃO APROVADA.** Baseline funcional
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
| Core independente | `node --experimental-strip-types --test "lia/core/test/*.test.ts"`, raiz | PASS automatizado: 82, exit 0 |
| Produto/presença canônica | `vitest run src/product/config.test.ts src/product/config-write.test.ts`, `airi/packages/lia-core/` | PASS automatizado: 60, exit 0 |
| Launcher | `corepack pnpm run test`, `airi/apps/lia-app/` | PASS automatizado: 269, 2 skips preexistentes, exit 0; mudanças posteriores precisam verificação focada |
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

A correção arquitetural ainda exige um proprietário de credenciais e migração
segura. Não foram copiados materiais criptográficos, compartilhado um perfil
Chromium ativo entre hosts ou enviados segredos ao Renderer para contornar o
problema. A documentação [oficial de safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
explica a proteção do sistema; ela não é evidência de interoperabilidade entre
estes dois hosts da Lia.

**FAIL Windows: primeiro uso autenticado Launcher → Stage.** Voz/STT que usem
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

## Empacotamento privado (estado em andamento)

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
