# Lia — Rodada 22

| Verificação | Estado | Evidência |
| --- | --- | --- |
| OIDC desligado no Stage | PASS automatizado | Flag antiga não habilita o bridge nem a persistência no Renderer desktop. |
| OIDC pelo owner do Main | PASS focado | PKCE com owner simulado valida o sucesso sem payload. O owner de sessão também passou sua suíte própria. |
| Validação criptográfica da identidade OIDC | PASS focado | JWKS obtido por HTTP em loopback e tokens assinados no ensaio. O owner recusa nonce inválido antes de gravar e aceita a identidade verificada. |
| Ciclo OIDC com emissor assinado sob controle do teste | PASS Windows no gate de componentes | Electron com preload de produção, autorização por HTTP, callback de loopback, PKCE, renovação, perfil e revogação pelo Main. |
| OIDC integrado aos serviços do Stage | BLOCKED | Conta, HTTP e streaming ainda precisam dos adaptadores Main ligados ao ciclo de vida do Stage. O preload continua anunciando OFF. |
| OIDC com emissor externo | NOT RUN | Nenhum login em emissor externo executado. |
| Consentimento STT nativo | PASS focado | Aceite por gravação antes de acesso ao cofre. Recusa, cancelamento tardio, mudança de configuração e perda da autorização da janela bloqueiam envio. |
| Canal HTTPS de STT sujeito a consentimento | PASS Windows no gate de componentes | TLS na mesma máquina e decisão injetada no Main. Diálogo nativo e serviço em outra máquina continuam NOT RUN. |
| STT em loopback | PASS Windows | Gate Electron de providers com IPC, cofre e serviço HTTP local. Artefatos em `Tests/artifacts/provider-runtime-electron/1794960227815/`. |
| Alternativas de STT no Renderer desktop | PASS focado | Sem executor de gravação registrado no Main, o Stage recusa a transcrição. Web Speech e streaming legado ficam indisponíveis também nas prévias e no DevTools Aliyun. O transporte Apple Speech exclusivo de macOS ficou fora da validação Windows. |
| SEC-04 no cofre do Stage | PASS Windows | O IPC histórico de leitura responde vazio sem abrir o cofre, inclusive com uma chave sintética em escopo legado. |
| SEC-04 nos demais caminhos do Renderer | Pendente | Persistência e clientes legados fora do IPC do cofre ainda exigem isolamento ou migração. |
| SEC-05 no TTS HTTP nativo do Stage | PASS Windows | Electron 43.4.1, serviço HTTP em loopback e credenciais sintéticas. |
| SEC-05 no chat nativo e STT com chave compartilhada | PASS Windows no gate de componentes | A mesma chave de chat serve a ambos somente na origem cadastrada. |
| Chat Launcher → Stage, perfis distintos | PASS Windows | Launcher grava no cofre cifrado e o Stage responde via SSE com serviço HTTP local e credencial sintética. |
| Stage após fechar e reabrir o Launcher | PASS Windows | Novo envio autenticado com Launcher fechado, mesma instância reconhecida ao reabrir e parada cooperativa pela Home. |
| Primeiro uso do Launcher sem chave | PASS Windows | Seleção explícita da IA local, descoberta, teste em texto e resposta completa no Stage com Qwen3.5-9B, sem autenticação. |
| SEC-05 nos consumidores legados | Pendente | A validação dos transportes nativos não cobre os clientes que ainda executam no Renderer. |
| SEC-05 nos adaptadores dedicados de gravação | PASS Windows | Electron com HTTP em loopback e chaves sintéticas. O diálogo remoto ainda é NOT RUN. |
| G-AUD | BLOCKED | O ensaio físico e a prova de consentimento para todos os caminhos ainda faltam. |
| G-ARCH | NOT RUN | C0–C8 aguardam execução no Windows com o build integrado. |

O STT nativo usa um diálogo da janela Electron para cada envio remoto. A
tela informa o provedor, a URL efetiva e que o áudio sairá do computador.
Cancelar é a ação padrão. Cancelar após o início do upload interrompe a
operação local e a espera pela resposta. Bytes já recebidos pelo serviço
permanecem sujeitos à política do destinatário. O Main resolve o destino
com base na configuração persistida e rejeita redirecionamentos.

No Windows, o corte de OIDC passou em 30 testes focados do Stage,
24 do Stage UI, 156 do Core e 358 do Launcher com 2 skips.
O corte STT passou em 102 testes focados e no gate Electron local.
O ensaio do diálogo com provedor remoto é NOT RUN.

Após fechar os caminhos alternativos, passaram 30 testes focados do
Stage UI e 66 do Stage no Windows. Os testes comprovam que o bloqueio
ocorre antes de construir o reconhecedor, consumir o stream ou invocar
o cliente de rede. O executor de gravação local permanece selecionável
pelo mesmo contrato do Main.
Lint, typecheck do Stage e build de produção passaram. O gate Electron
com HTTP em loopback passou novamente, com artefatos em
`Tests/artifacts/provider-runtime-electron/1794960626907/`.

### Vínculo de origem no TTS HTTP nativo do Stage

O Main grava a chave no slot cifrado existente junto à origem HTTP
(protocolo, host e porta) e ao escopo do provedor. A execução exige que
ambos correspondam à configuração. Uma chave legada permanece preservada
e precisa ser informada novamente na tela de conexão. A reutilização da
chave já vinculada é permitida ao alterar apenas o caminho na mesma origem.
Set e Adopt genéricos recusam os slots dos dois provedores de síntese.

- **PASS automatizado** em 94 testes focados do Stage e typecheck do Stage.
- **PASS Windows** em 16 grupos do gate Electron com serviço local. Confirma
  síntese com chave sintética, recusa de troca de origem sem nova chave e
  recusa de leitura de configuração de voz pela segunda janela. O relatório
  registrou ausência das sentinelas de chave nos logs. Artefatos em
  `Tests/artifacts/provider-runtime-electron/1794960965814/`.
- **PASS** no lint das alterações em TypeScript e YAML. O lint abrangendo o
  script `gate.test.mjs` registrou **FAIL** por sete ocorrências já presentes
  na base, incluindo imports exigidos pelo runner Node.
- **NOT RUN** em serviço externo. G-AUD e G-ARCH continuam abertos.

### Regressão ampliada no Windows

Windows 11 Home build 26200, Ryzen 5 5500 e Radeon RX 580 2048SP
com driver 31.0.21925.1001. Build testado a partir de `ad718b3`.

| Comando | Resultado |
| --- | --- |
| `corepack pnpm test` em `lia/core` | PASS, 156 testes. |
| `../../node_modules/.bin/vitest run` no Launcher | PASS, 358 testes e 2 skips. |
| `corepack pnpm run build` no Stage | PASS, build de produção. |
| `../../node_modules/.bin/vitest run` no Stage | FAIL inicial, 2 falhas, 2.573 passaram e 4 skips. |
| Vitest Node com `brain-correlation-observer` e `transcription-service` | PASS, 89 testes após o ajuste na composição do diálogo STT. |
| Vitest Node com `voice-preview-credentials.probe` | PASS, 10 testes após atualizar a credencial sintética para o formato vinculado. |
| Vitest Chromium com `VoiceSection`, `SttCredential` e `native-provider-runtime` | PASS, 11 testes em 3 arquivos. |
| Vitest `run --project node` no Stage | PASS, 2.521 testes e 4 skips, 206 arquivos. |
| Vitest `run --project browser` no Stage | PASS, 54 testes, 9 arquivos. |
| `corepack pnpm run typecheck` no Stage e lint dos dois ajustes | PASS. |

As duas falhas iniciais tiveram correções pontuais. O nome do parâmetro
do diálogo STT acionava uma verificação estática sobre a composição do
observador de diagnóstico. A fixture de prévia devolvia um slot secreto
legado, que a síntese agora recusa. O teste continua exigindo que a chave
seja lida apenas no Main e que o áudio chegue à prévia.

Os logs registraram erros `ResizeObserver` no Chromium e recusas de
conexão em loopback na porta 3000. A coleta desses sintomas não determina
sua causa. Logs em `J:/lia-evidence/round22-stt/`. Os artefatos do pnpm
gerados no diretório do Core durante o teste foram preservados nessa
pasta de evidências, fora do checkout.

O protocolo para G-ARCH permanece em
`docs/architecture/decisions/BENCHMARK-C0-C8-windows.md`. Nenhuma medição
C0–C8 foi coletada nesta regressão. O G-AUD ainda exige captura e
reprodução no dispositivo físico e os critérios AV no mesmo SHA.

### Vínculo de origem na transcrição dedicada de gravações

O IPC de configuração recebe o identificador, a revisão e o endereço
esperados, mais a chave digitada. O Main só aceita a gravação quando a
janela é autorizada e o registro persistido corresponde à revisão e ao
endereço. O Main deriva a origem do registro e grava o vínculo no slot
cifrado. A revisão do slot protege contra exclusão ou substituição
concorrente no cofre compartilhado. Um transporte local sem chave segue
disponível. Chaves antigas permanecem no cofre até serem substituídas e
precisam ser informadas novamente para uso nos adaptadores dedicados.

A execução compara origem, escopo e finalidade antes de enviar o áudio.
Um identificador reaproveitado também precisa da finalidade de gravação.
As entradas vinculadas no corte anterior de TTS seguem compatíveis. Alterar
somente o caminho preserva o vínculo. O IPC genérico não aceita nem
devolve o formato vinculado. Os consumidores de chat que ainda usam
chaves antigas também recusam esse formato, inclusive no Launcher.

O gate Electron com serviço local verificou recusa de chave antiga, de
revisão e endereço divergentes e de acesso pela segunda janela. Após
trocar a origem, a fixture confirmou ausência de requisição. O retorno à
origem original manteve a transcrição e o cancelamento em HTTP. As
configurações e os logs não expuseram a chave sintética. O roteiro físico
de consentimento está em `docs/architecture/LIA-NATIVE-TRANSCRIPTION.md`.

| Validação deste corte | Resultado |
| --- | --- |
| `node --experimental-strip-types --test 'test/*.test.ts'` em `lia/core` | **PASS**, 156 testes. A execução inicial detectou o subpath ausente do manifesto, registrado antes da repetição. |
| `vitest run` no Launcher | **PASS**, 359 testes e 2 skips. Após o ajuste de finalidade, a suíte focada de conexão passou nos 33 casos. |
| `vitest run` no Stage | **FAIL inicial**, 2.578 passaram, 1 falhou e 4 skips. O arquivo movido durante a execução foi aberto pelo caminho anterior. A checagem isolada passou em 13 casos. |
| Repetição do `vitest run` no Stage | **PASS**, 2.580 testes e 4 skips em 215 arquivos. Iniciada antes dos últimos ajustes de finalidade. |
| Vitest focado após o ajuste de finalidade | **PASS**, 197 testes em 7 arquivos, incluindo chave de TTS antiga e tentativa de reutilizar TTS em gravação. |
| Build do Stage e do Launcher, typecheck dos dois aplicativos | **PASS**. |
| Lint dos arquivos TypeScript em `airi/` | **PASS**. O script do runner Node mantém as ocorrências preexistentes registradas acima. |
| `node --test scripts/provider-runtime-electron/gate.test.mjs` no Stage | **PASS Windows**, Electron 43.4.1, 16 grupos. `Tests/artifacts/provider-runtime-electron/1794962987405/report.json` e `electron.log`. |

Logs adicionais em `J:/lia-evidence/round22-stt/`, com prefixo
`stt-binding-`. O ensaio físico G-AUD e o serviço de transcrição remoto
seguem **NOT RUN**.

### Vínculo no chat nativo e no STT derivado

Launcher e Stage gravam a chave no slot cifrado existente com origem,
escopo e finalidade de chat. O Launcher usa a transação de configuração
existente. No Stage, o IPC exige janela autorizada, registro persistido,
revisão e endereço correspondentes. A revisão do cofre protege a escrita
contra exclusão ou substituição concorrente. Os IPCs genéricos recusam
gravar um valor vinculado enviado pelo Renderer.

Chat, descoberta, teste de conexão e STT derivado verificam a origem
antes de autenticar. O consentimento remoto de STT continua sendo
solicitado antes da consulta à chave. Entradas antigas ficam no cofre
e precisam ser informadas novamente. Configurações sem chave continuam
disponíveis. A configuração de chat e o resultado de prontidão enviados
ao Renderer contêm apenas a presença de uma credencial utilizável.

#### Ensaios integrados Windows

- **PASS** em 16 grupos do gate Electron 43.4.1 com HTTP em loopback.
  Confirmou chat, STT com a mesma chave e nenhuma requisição ao
  trocar a origem. O runner registrou as sentinelas ausentes do log.
  Evidência em `Tests/artifacts/provider-runtime-electron/1795014326176/`.
  Uma tentativa anterior falhou com timeout na captura de tela. A
  repetição passou com o mesmo limite.
- **PASS** no Launcher real, com conexão salva, descoberta de modelo e
  round-trip de ferramenta pelo serviço HTTP sintético.
- **FAIL** no fluxo `node Tests/windows/completion-runtime.mjs`. A
  primeira tentativa encontrou seletores obsoletos no roteiro. Com os
  seletores corrigidos, o Launcher abriu o Stage, mas o Stage consultava
  configuração e transportes no perfil Chromium separado. Corrigi a
  leitura para usar a pasta do produto no modo gerenciado. O Stage
  preserva a recuperação de configuração do modo avulso e deixa
  arquivos canônicos inválidos disponíveis para recuperação.
- A repetição confirmou que o Stage passou a carregar a seleção
  canônica. A mensagem continuou sem chegar ao serviço. A prova no
  Electron, usando o cofre sintético do ensaio, confirmou que
  `safeStorage` está disponível no perfil Stage e falha ao decifrar a
  entrada gravada pelo Launcher. Evidências em
  `J:/lia-evidence/round22-stt/completion-resume-runtime-1795015211637/`,
  incluindo `report.json` e `stage-cipher-probe-result.json`.
- Um ensaio isolado do DPAPI de usuário protegeu uma sentinela em
  um processo PowerShell e abriu em outro, com recusa quando o contexto
  de proteção divergiu. Artefato em
  `J:/lia-evidence/round22-stt/shared-cipher-smoke-005fcdd697684ac1a9d727cac370bdf1/result.json`.
  Esse ensaio usa somente dados sintéticos e fica fora do runtime.

#### Regressão automatizada deste corte

- O Core passou com 156 testes. O Launcher passou com 362 testes
  e 2 skips. A integridade do runner Electron passou com 22 testes.
- O Stage passou por projeto com 2.532 testes Node e 4 skips,
  além de 54 testes Chromium. O recorte de pasta canônica passou
  com 40 testes. O agregado inicial do
  Stage apontou fixtures ainda gravadas no formato legado. Elas
  passaram a declarar a origem de configuração independentemente
  do endereço exercitado na chamada e mantiveram as asserções de
  autenticação, isolamento, concorrência e cancelamento.
- A repetição conjunta do Stage registrou 1 falha no Chromium e
  ficou sem progresso após o erro. Encerrei apenas o Chromium do
  próprio runner. O agregado terminou com 2.583 PASS, 4 skips,
  1 FAIL e erro de canal do browser. O Chromium isolado passou
  com o mesmo código. A causa da falha original permanece aberta.
- O build e o typecheck de Launcher e Stage passaram. A dependência
  `@proj-airi/core-agent` precisou de build após um FAIL de resolução
  de pacote em uma repetição do Stage. O lint TypeScript e Vue e
  `git diff --check` passaram. Logs em
  `J:/lia-evidence/round22-stt/`, com prefixo `chat-binding-`.

#### Leitura compartilhada no Windows

O cofre continua no mesmo arquivo, com um perfil Chromium distinto para
cada aplicativo. No Windows, novas entradas são cifradas com AES-256-GCM.
A chave simétrica é protegida pelo DPAPI `CurrentUser` e acompanha a
entrada cifrada. Os processos Main chamam o Windows PowerShell do sistema
com entrada e saída binárias por pipe. Entradas antigas seguem no leitor
`safeStorage` do perfil que as gravou. Uma entrada antiga ilegível no
outro perfil ou sem vínculo de origem exige informar a chave novamente.
As regras de autorização dos IPCs e o escopo de proteção do usuário do
Windows continuam aplicáveis.

- PASS Windows em dois processos independentes com DPAPI real, ausência
  da sentinela no envelope cifrado e falha fechada com formato incompatível.
  Evidência do ensaio compilado em `J:/lia-evidence/round22-stt/chat-shared-dpapi-runtime.json`.
- PASS do primeiro envio na interface real, incluindo credencial sintética,
  descoberta de modelo, conversa SSE, memória com opt-in e opt-out,
  mudança de instrução de personalidade e retorno de Livre para Tamagotchi.
  O primeiro relatório registrou FAIL do roteiro porque aguardava uma
  mensagem transitória apesar de o supervisor informar `stopped`, com
  código de saída 0. Evidência em
  `J:/lia-evidence/round22-stt/completion-resume-runtime-1795016233081/report.json`.
- Uma repetição apresentou a resposta SSE autenticada depois do fechamento
  do Launcher. O runner falhou por esperar texto próprio do ensaio enquanto
  a fixture devolvia a resposta padrão. O encerramento cooperativo do Stage
  após a falha foi confirmado. Evidência em
  `J:/lia-evidence/round22-stt/completion-resume-runtime-1795016803840/report.json`.
- O gate integrado `node Tests/windows/completion-runtime.mjs
  --credential-handoff` terminou com dez verificações aprovadas. Usou
  o endpoint de controle autenticado para confirmar a mesma instância
  do Stage na Home do Launcher reaberto. O botão de encerramento ficou
  disponível e removeu o registro da instância. Evidência em
  `J:/lia-evidence/round22-stt/completion-resume-runtime-1795017104777/report.json`.
- Após a coordenação das escritas, o mesmo gate passou novamente nas dez
  verificações. Evidência em
  `J:/lia-evidence/round22-stt/completion-resume-runtime-1795017759306/report.json`.
- `node Tests/windows/completion-runtime.mjs --without-key` terminou com
  FAIL na descoberta de modelos, antes da primeira requisição. O arquivo
  do ensaio registrou o provedor Groq com `allowUnauthenticated: false`,
  coerente com a exigência de chave do catálogo. A definição OpenAI-compatível
  está marcada como indisponível no catálogo do Launcher. O uso de serviços
  sem chave em testes de componentes do Stage tem evidência própria.
  `J:/lia-evidence/round22-stt/completion-resume-runtime-1795017807026/report.json`.
- A suíte do Launcher após a correção da Home registrou 363 PASS e 2 skips.
- O Core de `airi/packages/lia-core` teve 383 PASS e 2 timeouts em
  verificações estáticas de chat e Groq na primeira execução. A repetição
  sequencial passou com 385 testes. As causas iniciais permanecem abertas.
  Os logs usam prefixo `chat-shared-dpapi-` em `J:/lia-evidence/round22-stt/`.

#### Coordenação da configuração canônica e escrita de credenciais

Como os dois processos passam a usar `lia-product.json`, Launcher e Stage
adquirem o mesmo lock de produto do sistema operacional antes de ler,
alterar e trocar o arquivo. O cofre mantém seu próprio lock. O Stage recusa
gravar por cima de um documento inválido em modo gerenciado. Uma gravação
de produto falha sem substituir o destino se a gravação temporária ou a
troca falhar. A exclusão do temporário é tentada antes de sair da transação.

- PASS Windows em dois processos Node. O escritor do Launcher entrou na
  transação só depois que o outro processo liberou o lock. A alteração de
  personalidade e a preferência de idioma permaneceram no mesmo arquivo.
  Evidência em `J:/lia-evidence/round22-stt/product-lock-process-MeObln/report.json`.
  O ensaio usa o produto compilado e uma fixture de escrita na outra ponta.
- A escrita e a adoção genéricas de chaves recusam os escopos Main-native,
  inclusive alias protegido. O rascunho para chat e STT usa IPC dedicado que
  vincula a chave ao destino persistido. Os escopos legados continuam sujeitos
  à política de acesso existente. O Stage passou o recorte de 149 testes e o
  Core de `airi/packages/lia-core` passou 386 testes sequenciais.
- Build e typecheck de Core, Launcher e Stage passaram. A suíte final do
  Launcher passou com 363 testes e 2 skips. `git diff --check` passou.
  Logs com prefixo `chat-shared-config-` em `J:/lia-evidence/round22-stt/`.
- PASS Windows no gate de componentes com Electron 43.4.1, HTTP em
  loopback e chaves sintéticas. Os 16 grupos passaram, incluindo recusa
  de escrita genérica antes e depois de salvar pelos IPCs dedicados.
  A integridade do roteiro passou 22 testes. O relatório e o log do
  Electron ficaram em `Tests/artifacts/provider-runtime-electron/1795017906850/`.

#### Retomada da Rodada 22

O preflight encontrou a branch `arena/7fa837f0-lia-project`, HEAD
`602b7859aec64cee7d2252c1be75bbe9b4ba22d1` e remoto
`f2b04ca78cfc8deed47b03461fa76904b058344b`. O índice estava vazio, com
44 caminhos alterados e dois arquivos novos. Os commits locais
`9fa0e47` e `602b785` contêm a cifra compartilhada e a coordenação de
configuração. O diff herdado foi preservado fora do Git em
`J:/lia-evidence/round22-stt/goal-resume-inherited.patch`.

- Dois casos sintéticos de leitura legada falharam antes da correção.
  Depois, o conjunto de bridge e política passou com 42 testes. O gate
  Windows de componentes passou e inclui a recusa de leitura no escopo
  legado com registro cifrado já gravado. Relatório em
  `Tests/artifacts/provider-runtime-electron/1795040255540/report.json`.
- O IPC histórico responde sem segredo e sem acessar o cofre. A presença,
  importação e remoção seguem seus próprios contratos e controles de
  remetente. Provedores que só executam no Renderer perdem acesso à
  chave do cofre até receberem adaptador próprio. Outros caminhos de
  armazenamento e configuração ainda precisam ser auditados.
- O preflight de empacotamento privado e o runner PowerShell agora
  verificam `out/preload/index.cjs`, o artefato produzido pelo Stage.
  Dois testes de empacotamento e o comando `--internal-test --check`
  passaram. Empacotamento e benchmarks ainda aguardam a nova coleta.

#### Permissões e limite de confiança do cofre

O volume de evidências do Windows herdava permissões de edição para
usuários autenticados. O escritor passou a criar o temporário com uma
DACL protegida, exclusiva para o usuário que executa o Main. O conteúdo
cifrado passa por pipe, é escrito com acesso exclusivo e recebe flush
antes da troca atômica. Em outros sistemas, o temporário é criado com
modo `0600` e criação exclusiva. Arquivos antigos recebem as novas
permissões na próxima gravação bem-sucedida.

DPAPI restringe a abertura da chave de cifra ao contexto da conta Windows.
A DACL restringe o acesso normal ao arquivo novo. Processos sob a mesma
conta, administradores com privilégios de recuperação e máquinas
comprometidas ficam fora desse limite. A Lia preserva as ACLs dos
diretórios escolhidos pelo usuário. Um diretório gravável por terceiros
continua sujeito a exclusão ou substituição do cofre; para preservar
disponibilidade e integridade, use o diretório privado da conta.

A prova isolada do Windows mostrou DACL protegida com uma regra explícita
para a conta atual. `J:/lia-evidence/round22-stt/private-acl-B64uaQ/report.json`.
Os 30 testes focados do cofre passaram, inclusive concorrência, abortos,
revisões e recuperação. O isolamento por uma segunda conta Windows ainda
não foi exercitado.

O gate Electron 43.4.1 confirmou a DACL do arquivo produzido pelo cofre
e terminou com 16/16 grupos aprovados. A verificação do log também
passou para as sentinelas sintéticas. O primeiro ensaio de ACL falhou
ao carregar o módulo do cmdlet `Get-Acl`. A repetição verificou a DACL
pela API do .NET. Evidência em
`Tests/artifacts/provider-runtime-electron/1795043788307/report.json`.

#### Primeiro uso com inferência local

O Launcher oferece **IA local** como escolha explícita para um serviço
OpenAI-compatível já em execução no computador. O Main limita o endereço
a IPs literais de loopback, valida a seleção e dispensa consulta ao cofre.
O Stage usa o registro canônico para abrir a conversa. Este caminho
envia texto pelo Main sem ferramentas nem autenticação. A interface
indica o que preparar quando o serviço ou modelo estiver indisponível.

O primeiro ensaio com Qwen encontrou duas falhas separadas. A ativação
tentou registrar o identificador local em um catálogo externo ao
transporte nativo. Depois da correção, o pedido chegou ao modelo, mas
excedeu 4.096 tokens de contexto pelo volume combinado de instruções
e definições de ferramentas. Com 8.192 tokens, a avaliação do prompt
chegou ao limite de tempo já vigente do transporte. A rota de texto
passou a omitir as definições de ferramentas. O prazo do transporte
permaneceu igual.

**PASS Windows real.** Com o servidor local de ensaio `llama.cpp` e
`Qwen3.5-9B-Q4_K_M.gguf`, contexto de 8.192 tokens e modo texto, a
descoberta e o teste de texto passaram. O Stage exibiu a resposta
completa e o Launcher encerrou o Stage. O runner usou um proxy HTTP
de teste em loopback que registrou a ausência de autenticação e
repassou o fluxo original do modelo. O proxy confirmou HTTP 200 e fim
da transmissão. Nenhuma dependência de serviço externo foi exercitada.

Comando `node Tests/windows/completion-runtime.mjs --local-endpoint=http://127.0.0.1:19081/v1`.
Relatório local em
`J:/lia-evidence/round22-stt/completion-resume-runtime-1795043544156/report.json`.
A captura é evidência local e está fora do Git.

#### ID token no Main

O início da autenticação gera um nonce por tentativa, separado do estado
PKCE. O owner verifica o ID token antes da primeira gravação. Na
renovação, um novo ID token precisa identificar a mesma conta, e um
nonce presente precisa corresponder à sessão. Carregamento, troca e
renovação de tokens usam respostas limitadas e canceláveis. O login por
IPC exige o frame principal da janela proprietária.

As chaves públicas vêm de `/api/auth/jwks` na origem configurada no
Main, com redirecionamentos recusados. O verificador usa `jose` e valida
assinatura, emissor, audiência, parte autorizada, expiração e nonce.
O ensaio HTTP local usou chaves efêmeras e tokens sintéticos assinados,
incluindo rejeição de alterações de assinatura, emissor, público e
conta. A suíte focada final desta etapa passou com 110 testes.
`J:/lia-evidence/round22-stt/r22-resume-smoke-final.log`.
O preload de produção segue desativado. O fluxo integrado e o emissor
externo continuam pendentes.

#### G-ARCH

O amostrador `tools/desktop-benchmark/sample-c0-c8-windows.ps1`
registra identidade das raízes, repetições e medições brutas. Uma prova
curta executou uma janela de 7 s sobre o próprio PowerShell.
`J:/lia-evidence/round22-stt/20261118T231450851Z-sampler-smoke-028294954f954f1b99fcc3936f5dbec4/`.
Os cenários C0–C8 do produto continuam NOT RUN.

Commits locais desta retomada. `5a4be91` ajusta o preload nos roteiros
Windows, `141227c` versiona o amostrador, `dfe95e4` valida o ID token
no Main, `e7ad3ac` restringe as permissões do cofre e `cdea7c4`
integra a conversa local e os vínculos de credenciais.

#### Revalidação do envio remoto de áudio

O Main confere de novo a revisão aprovada depois da resolução da
credencial e da preparação do áudio. Uma configuração alterada nessa
janela impede o envio. A resposta de transcrição é descartada se o
texto ou os segmentos devolverem a credencial usada no pedido.
Os testes de transcrição e verificação OIDC passaram com 44 casos,
incluindo a mudança de revisão após o aceite e o eco de uma sentinela
inteira ou repartida entre segmentos.
`J:/lia-evidence/round22-stt/r22-stt-revision-egress-final.log`.
O teste com serviço remoto e a captura acústica seguem NOT RUN.
O delta está em `e808574`, após o ajuste de lint OIDC `22e819c`.

#### Regressão Windows e pacote privado

| Comando | Resultado |
| --- | --- |
| `node --experimental-strip-types --test 'lia/core/test/*.test.ts'` | 157 PASS |
| `pnpm exec vitest run --maxWorkers=1` em `airi/packages/lia-core` | 386 PASS |
| `node --test 'Tests/tools/*.test.mjs'` | 275 PASS |
| `python -m unittest discover -s . -p "test_*.py" -t .` em `tools` | 498 descobertos, 488 PASS e 10 SKIP |
| `pnpm exec vitest run --project node --maxWorkers=2` no Stage | 2.537 PASS e 4 SKIP |
| `pnpm exec vitest run --project browser` no Stage | 54 PASS |
| `pnpm exec vitest run --maxWorkers=1` no Launcher | 366 PASS e 2 SKIP |
| `pnpm run typecheck` no Launcher | PASS |
| `pnpm run typecheck` no Stage após o último delta | PASS após ajustar o tipo do mock em `7b028f4` |
| `moeru-lint` nos TypeScript e Vue alterados | PASS após ajuste de estilo |

O agregado Stage registrou tentativas de conexão recusadas na porta
3000, e Chromium emitiu aviso de ResizeObserver. Ambos saíram com
código 0. A reprodução focada de transcrição após o último delta
consta acima. Logs `r22-integration-*` em `J:/lia-evidence/round22-stt/`.
O gate Electron final de componentes também passou nos 16 grupos,
incluindo a DACL e a procura de sentinelas no log.
`Tests/artifacts/provider-runtime-electron/1795044862256/report.json`.

O empacotador `node airi/apps/lia-app/scripts/package-windows.mjs --internal-test --dir`
gerou `Lia.exe` e `LiaStage.exe` com Electron 43.4.1. Ambos estão
sem assinatura. O pacote usou o build anterior a `e808574`.
O ensaio `node Tests/windows/completion-runtime.mjs --packaged --credential-handoff`
passou nas dez etapas com serviço local e credenciais sintéticas.
Relatório em `J:/lia-evidence/round22-stt/completion-resume-runtime-1795044584891/report.json`.
Hashes do pacote em `J:/lia-evidence/round22-stt/r22-package-unpacked-hashes.json`.
Instalação limpa e atualização continuam NOT RUN.

O Windows 11 Home build 26200 tem Ryzen 5 5500, 12 processadores lógicos,
15,89 GiB de RAM e Radeon RX 580 2048SP com driver 31.0.21925.1001.
O plano Atlas Power Scheme e as aplicações em uso foram preservados.
Chrome, Discord e Steam estavam ativos na preparação, então o ambiente
não atende à condição de sessão dedicada do protocolo C0–C8.

O Windows enumera o microfone fifine e as saídas EDIFIER W830NB.
O gate G-AUD ainda requer fala controlada, confirmação da reprodução,
serviço STT autorizado e o registro AV-01 a AV-15 no mesmo candidato.
O inventário de hardware e as fixtures não estabelecem esses resultados.

#### Consentimento de STT com transporte TLS

O gate Electron 43.4.1 executou o IPC e o HTTPS real em `127.0.0.2`.
Esse endereço permanece local e exige consentimento pela regra do produto.
O driver respondeu pelo processo Main da fixture. O servidor registrou
dois uploads, ambos autorizados individualmente. O primeiro retornou a
transcrição. O segundo teve a resposta encerrada após cancelamento.
Recusa, cancelamento antes do aceite, mudança de revisão e tentativa de
reutilizar um aceite anterior deixaram o contador de requisições intacto.
O pedido de consentimento identificou o provedor e o caminho completo.
O certificado entrou na confiança apenas do Electron de teste.

O gate passou nos 16 grupos e confirmou ausência das sentinelas de
credencial nos logs. A integridade do roteiro passou com 22 testes.
Evidência em `Tests/artifacts/provider-runtime-electron/1795045390548/report.json`.
O diálogo nativo, falhas de rede com um servidor em outra máquina e o
uso de microfone continuam NOT RUN.

#### Ciclo OIDC com emissor local assinado no Electron

O comando `$env:LIA_RUN_OIDC_FIXTURE='1'; node --test scripts/provider-runtime-electron/gate.test.mjs`
no Stage inicia um emissor de teste em loopback. O Main abre a autorização
por HTTP no próprio harness. O emissor entrega o código ao callback real,
com validação PKCE na troca e ID tokens assinados com chave efêmera ES256.
O caminho de produção mantém OIDC desativado. No ensaio inicial o IPC de
perfil existia só no harness. O ensaio posterior usa o contrato de conta
do Stage, registrado quando há um owner Main e o serviço de conta.

Seis callbacks com state adulterado foram recusados. Os seis códigos
válidos chegaram à troca PKCE, e quatro logins foram recusados pela
identidade inválida (emissor, audiência, nonce e expiração). Os logins
válidos comprovaram leitura de perfil pelo Main, renovação após expiração,
revogação no logout e remoção do cofre após `invalid_grant`. O evento de
sucesso voltou vazio e o perfil chegou como DTO público. O gate conferiu
ausência de tokens em claro no cofre e nas superfícies observadas.

Nas primeiras execuções, o ciclo OIDC passou e a tentativa imediata de
gravar a primeira chave de outro provedor foi recusada. A revogação
local invalida a geração antes de concluir a exclusão em disco. O ensaio
agora verifica se a exclusão terminou antes de começar as gravações
seguintes. A recusa por revisão obsoleta continua em vigor.

Evidência inicial completa em
`Tests/artifacts/provider-runtime-electron/1795046019068/report.json`.
O gate final combinou o mesmo ciclo OIDC com o consentimento STT em TLS
e passou com 16 grupos, sem sentinelas nos logs.
`Tests/artifacts/provider-runtime-electron/1795046102726/report.json`.
Também passaram 27 testes focados de auth e sessão, 22 de integridade do
runner, lint direcionado e typecheck do Stage.
#### Contrato IPC de conta no Electron

O mesmo comando aprovou os 16 grupos com Electron 43.4.1 no Windows.
O contrato de conta retornou dois perfis e uma lista de vínculos ao
Renderer. A lista descartou o token extra da resposta de teste e o
IPC recusou uma operação que tentou definir cabeçalhos. Nenhuma
sentinela apareceu nos logs. Evidência em
`Tests/artifacts/provider-runtime-electron/1795046488328/report.json`.

A suíte focada passou 54 testes em quatro arquivos. Ela cobre a
fronteira Main incluindo frame de topo, janela de origem, limite de
concorrência, sanitização de exceções e descarte de respostas após
navegação, crash ou destruição do Renderer. O lint nos TypeScript e no
emissor passou. O lint aplicado ao runner Node também apontou nove
diagnósticos preexistentes em linhas fora do diff.

Emissor externo, telas de conta do Stage e os demais clientes
autenticados continuam NOT RUN. Esse ensaio não aprova SEC-04 ou SEC-05.
A revisão parcial identificou que o helper de carregamento de janela
remove todos os listeners de início de navegação. Antes de ligar o
contrato às janelas de produção, é preciso preservar o listener que
cancela operações de conta ao trocar de documento.
