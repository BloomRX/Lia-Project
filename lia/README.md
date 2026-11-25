# `lia/` — código próprio da Lia

Este diretório contém os pacotes oficiais da Lia. A instalação, o build,
os gates e o empacotamento usam os lockfiles próprios a partir de `Lia.bat`
e dos comandos documentados abaixo.

```
lia/
├── assets/     ícones e imagem da marca (já existiam)
├── core/       @lia/contracts — contratos, zero dependências
├── desktop/    Launcher Electron, com lockfile próprio
├── launcher/   decisão e fronteira do Launcher
├── runtime/    @lia/core — produto, cofre, voz e roteamento
└── stage/      conversa, avatar, presença, voz e ciclo de vida
```

---

## `lia/runtime` — `@lia/core`

Com `lia/core` também presente na árvore, execute em `lia/runtime`:

```bash
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm run build
corepack pnpm run typecheck
corepack pnpm run test
```

## `lia/desktop` — Launcher Electron

Execute em `lia/desktop`:

```bash
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm run build
corepack pnpm run typecheck
corepack pnpm run test
corepack pnpm run lint
```

Use `Lia.bat` na raiz para preparar o Launcher e o Stage próprios juntos.
O botão **Conversar com Lia** abre o Stage próprio. Para iterar com
`corepack pnpm run dev` no Launcher, prepare primeiro o Stage com
`Lia.bat -PrepareOnly`.

## Por que ao lado e não dentro

`airi/` é uma cópia do upstream `moeru-ai/airi` em `2c1e223` com 353 arquivos da
Lia injetados. Qualquer coisa dentro de `airi/` é sobrescrevível por um
`subtree pull`. `lia/` não é: o AIRI não sabe que ele existe.

E não entra no workspace pnpm do AIRI por um motivo concreto — se entrasse,
`@lia/contracts` passaria a depender do catálogo e do `pnpm install` do AIRI.
Ela perde a única propriedade que a torna útil: **rodar sem instalar nada**.

---

## `lia/core` — `@lia/contracts`

| Módulo | Conteúdo |
| --- | --- |
| `src/lifecycle.ts` | fases do Stage, tabela de transições legais, histórico, `snapshot()` |
| `src/protocol.ts` | envelope, versão, `negotiate()`, `parseEnvelope()` que nunca lança |

Sem dependências, sem build, sem transpilador. Usa `node --test` e o
`--experimental-strip-types` do Node 22.

```bash
cd lia/core && node --experimental-strip-types --test "test/*.test.ts"
# 154 testes de contratos e runtime
```

O pacote roda sozinho em uma cópia de `lia/`. Para verificar também
os imports dos aplicativos do workspace legado, execute na raiz do
repositório `node --test Tests/tools/lia-contract-consumers.test.mjs`.

**Restrição do strip-types:** o Node recusa sintaxe que só existe em TypeScript
— parameter properties, `enum`, `namespace`, decorators. O código usa
`readonly #campo` com atribuição no construtor. Não adicionar transpilador:
isso arrastaria o install do AIRI.

---

## `lia/stage` — Stage próprio em desenvolvimento

O ponto de entrada Electron tem lockfile próprio. Em `lia/stage`,
instale com `corepack pnpm install --frozen-lockfile --ignore-scripts` e
execute `corepack pnpm run dev`. O build e a janela foram verificados no
Windows com Electron 43.4.1. O Launcher abre o Stage próprio para
conversa. A janela do Stage próprio permite enviar mensagem ao
provedor local configurado no produto. No Electron foram validados
resposta de um serviço HTTP controlado, cancelamento, preservação do
rascunho e retorno de foco. O Main mantém até seis turnos concluídos em
memória por conversa e descarta o contexto ao mudar de modelo ou endereço.
A janela oferece prévia local de VRM, presença de avatar no desktop
e histórico de conversa opcional.

O envio de imagem aceita um PNG ou JPEG de até 3 MiB com texto. O Main
só encaminha o anexo quando a regra de visão do produto seleciona uma
rota do provedor já configurado. Trocas com imagem ficam fora do
histórico salvo. No Electron Windows, a recusa sem rota passou e um
serviço HTTPS local confirmou imagem com texto, seguido de texto
simples, com credencial sintética protegida por DPAPI. O CI inclui
`scripts/check-native-vision.mjs` em `lia/desktop`. Esse gate recebe os
caminhos do certificado e da chave TLS sintéticos de loopback.
O envio a um provedor externo continua pendente.

Em modo gerenciado, o Stage próprio publica identidade e atende status
e encerramento pelo canal de controle compartilhado com o Stage legado.
No Windows, o ensaio confirmou o handshake, a recusa de leitura de
credenciais e a remoção do registro após a saída cooperativa.

Para preparar e abrir a Lia no Windows, execute
`Lia.bat` na raiz da cópia. O script usa os lockfiles
do Stage e do Launcher, prepara o Electron e abre o Launcher com o Stage
próprio habilitado. Use `-PrepareOnly` para preparar os builds sem abrir
a janela. No Launcher, configure um provedor em **IA & Recursos**.
O Stage usa a preferência `preferences.language` do produto ao abrir a
janela. A interface oferece pt-BR e en-US, com pt-BR como padrão.
Reabra o Stage para aplicar mudanças feitas no Launcher.
**Conversar com Lia** e **Encerrar
conversa** foram verificados no Windows com um registro separado.
O modo experimental oferece conversa com IA local e Groq. O botão
**Ouvir resposta** usa o Kokoro local quando instalado, selecionado
e habilitado. No Electron, a síntese gerou áudio decodificável e a
reprodução avançou. A saída física de áudio ainda não foi verificada.
Use **Parar áudio** para interromper a síntese ou a reprodução. Com
Kokoro instalado no Windows, execute
`node scripts/check-native-history.mjs --voice` em `lia/desktop`
para repetir a validação com o áudio silenciado.
**Ler respostas automaticamente** é uma preferência opcional que
persiste após reiniciar e respeita a desativação global de voz.
Para configurar outra rota de síntese, abra **Voz → Síntese compatível
com OpenAI** no Launcher e informe endereço, modelo, voz e chave.
O Stage pede autorização para cada envio de texto à rota. A opção
**Voltar ao motor local** muda a seleção e preserva a conexão salva.
No caminho autenticado, o Main lê o cofre compartilhado e exige
HTTPS e chave vinculada ao provedor, à origem e à finalidade de chat.
Esse caminho passou em testes com credencial sintética e transporte
simulado. O provedor externo ainda não foi exercitado.

Em **Personalidade → Importar cartão**, selecione o ZIP exportado pelo
Stage legado ou um `card.json` em formato CCv3. O ZIP pode ter até 64 MB
e o JSON, até 128 KB. A importação usa descrição, personalidade e cenário
com IA local. A seleção persiste e pode ser trocada pelo botão
**Usar personalidade padrão**. Para abrir o VRM do mesmo ZIP, selecione
o pacote em **Avatar → Abrir avatar VRM**. A prévia continua sujeita à
validação de recursos incorporados. Use **Lembrar este avatar** para
guardar a seleção no perfil. Instruções técnicas e agentes permanecem
no pacote original.
Em **Editar traços da Lia**, ajuste cada traço na escala de 0 a 100 e
selecione o contexto base. **Salvar traços** aplica uma versão separada da
Lia padrão às conversas com IA local. Os cartões importados ficam guardados.

Em mensagens de texto, a caixa de consulta de data e hora autoriza essa
ferramenta para um único envio a um modelo local compatível com chamadas
de função. A Lia lê a data e a hora do Windows somente se o modelo
solicitar a ferramenta.

O gate do modelo real é `node --experimental-strip-types lia/desktop/scripts/check-local-clock-model.mjs <porta> <id-do-modelo>`, executado da raiz com um servidor compatível em loopback. O ensaio Windows usou llama.cpp 12424 e Qwen3.5-9B-Q4_K_M com `--host 127.0.0.1 --port 18417 --alias qwen-local-clock -ngl 0 -c 4096 -n 96 --reasoning off --jinja`. O gate verifica as duas requisições e compara o horário da resposta com o valor devolvido pela ferramenta.

**Lia Agent Hub → Consultar catálogo** mostra as capacidades ativas
publicadas pelo Hub em `%USERPROFILE%\Lia\Comum\Capacidades\index.json`.
Se o perfil do Hub usa `LIA_AGENTHUB_HOME`, a Lia procura o mesmo caminho
relativo nessa raiz. Essa consulta é local e somente leitura. A execução
de capacidades será integrada separadamente.

Em **Voz → Reconhecimento de fala compatível com OpenAI**, informe o
endereço HTTPS da API, o modelo e a chave. **Salvar reconhecimento** seleciona
essa rota para o Stage. A escolha de voz de saída permanece independente.
Ao transcrever, a Lia pede autorização antes de enviar cada gravação.
Se mudar a origem do serviço, informe a chave novamente.

Para usar um servidor local compatível com `/audio/transcriptions`, escolha
**Servidor neste computador** e informe o endereço local e o modelo. A Lia
aceita `127.0.0.1` ou `[::1]` e envia sem chave. O servidor de transcrição
precisa estar em execução e aceitar gravações WebM.

O ensaio Windows de inferência usa o [whisper.cpp 1.8.4](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.8.4),
o [modelo multilíngue ggml-tiny](https://huggingface.co/ggerganov/whisper.cpp/blob/main/ggml-tiny.bin),
a [amostra jfk.wav](https://github.com/ggml-org/whisper.cpp/tree/v1.8.4/samples)
e FFmpeg disponível no PATH para converter WebM. SHA-256 do ZIP x64
`74f973345cb52ef5ba3ec9e7e7af8e48cc8c71722d1528603b80588a11f82e3e`.
SHA-256 do modelo
`be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21`.
SHA-256 da amostra
`59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e`.

Com Launcher e Stage compilados, execute o comando abaixo a partir da raiz.

```powershell
node lia/desktop/scripts/check-native-whisper-cpu.mjs <whisper-server.exe> <ggml-tiny.bin> <jfk.wav> 18573
```

O script inicia o servidor em loopback, configura a rota pelo Launcher,
grava a amostra em inglês pelo microfone virtual do Chromium no Stage e
confere o texto no rascunho. O log e o relatório ficam na pasta temporária
impressa pelo script. O motor, o modelo e a amostra ficam fora do pacote.

Para repetir a amostra pt-BR, gere `smoke-c.wav` pelo ensaio
`node tools/kokoro-smoke.mjs <diretório-de-evidências>` com Kokoro instalado.
Converta para PCM de 16 bits, mono e 16 kHz com FFmpeg
(`-ac 1 -ar 16000 -c:a pcm_s16le`). Passe o WAV convertido no lugar de
`jfk.wav` e acrescente `--pt-br` depois da porta. O WAV convertido do
ensaio local tem SHA-256
`d05cf14991a213194ec2bff33b25d4f9b9d35e7c2d3dcb470efcea5d771ec8bf`.



Para repetir o gate de abertura e encerramento no Windows, prepare
os builds e instale o Electron do Stage. Em `lia/desktop`, execute
`node --experimental-strip-types scripts/check-native-stage.mjs`.
Em uma cópia contendo apenas `lia/`, acrescente `--require-independent`
para exigir a ausência de `airi/`.
O gate grava `report.json` em `lia-native-stage-*` no diretório temporário.

Para empacotar a Lia para uso privado, em `lia/desktop` execute
`node scripts/package-windows.mjs --internal-test`.
O padrão é o Stage próprio. O artefato mantém a identidade NSIS
`Lia Preview` para substituir instalações anteriores dessa edição.
Acrescente `--dir` para gerar apenas a versão descompactada e rode
`node --experimental-strip-types scripts/check-native-stage.mjs --packaged`
para verificar esse executável. A prévia depende dos builds de
`lia/desktop` e `lia/stage` e do Electron oficial instalado no Stage.
Para executar o mesmo gate sobre uma instalação da prévia, passe
`--installed-executable=<caminho absoluto de Lia.exe>`. A instalação
limpa, o ciclo Launcher–Stage e a desinstalação já passaram em uma
pasta isolada de teste.

O script PowerShell `scripts/check-native-install.ps1` executa o ensaio
com `-Installer <arquivo>`. Em uma árvore sem AIRI, acrescente
`-RequireIndependent`. Use `-PreviousInstaller <arquivo>` para instalar
uma edição anterior antes do pacote atual. O teste verifica a substituição
do Stage pelos hashes, compara os arquivos de configuração, transportes
e histórico de um perfil sintético isolado e confirma que o Stage abre
o histórico antes e depois. O ensaio passou no Windows de 0.0.1 para uma
compilação privada 0.0.2 feita em cópia isolada. Os resultados ficam em
`report.json` no diretório de evidências. O ensaio também compara o hash do cofre e verifica se a mesma conta Windows
recupera uma credencial sintética via DPAPI após a atualização. Ainda faltam
ensaios de atualização automática, preservação dos demais dados e sessão
externa autenticada após o upgrade.
Para empacotar, use um checkout com
caminho curto. No Windows, o NSIS falhou ao abrir um include em um caminho
de 267 caracteres e o mesmo build passou a partir de uma raiz curta.

O workflow `lia-native-windows.yml` usa `git archive HEAD lia Lia.bat` para
instalar, compilar e testar a Lia sem acesso à árvore legada.
Ele executa a suíte completa dos contratos e do runtime, incluindo os
testes multiprocesso do cofre, além das verificações do Launcher e do Stage.
Ele também executa a abertura e o encerramento pelo Launcher no Windows.

O serviço HTTP de transcrição e seus adaptadores agora ficam em
`lia/core/src/transcription`. O Stage legado usa esse mesmo serviço
com seu cofre, adaptador de rede e confirmação por gravação. O Stage
próprio recebe gravações pelo IPC. Ele usa a seleção do produto para
transcrição local sem chave ou para um adaptador dedicado via HTTPS.
No caminho remoto, o Main pede confirmação a cada gravação, mantém
a credencial vinculada ao destino no cofre e invalida a confirmação
se a seleção de modelo ou a revisão dos transportes mudar.
Os testes automatizados cobrem confirmação, recusa, cancelamento e
alteração de configuração. O gate Electron Windows usa HTTPS local
com áudio e credencial sintéticos. Execute em `lia/desktop`
`node --experimental-strip-types scripts/check-native-stt-consent.mjs <certificado> <chave>`
com certificado sintético que inclua o IP 127.0.0.2. O modo automatizado
injeta a resposta do diálogo. Acrescente `--native-dialog` para
exercitar o diálogo interativamente. Esse modo ainda precisa de validação.
No percurso local anterior, o Electron transcreveu áudio sintético
e cancelou uma requisição. A interface recebe permissão temporária para o
microfone após o clique, libera a captura antes de transcrever e
insere o texto no rascunho para revisão. O percurso foi exercitado
no Electron com microfone sintético. O microfone físico segue pendente.

`src/main/stage-host.ts` concentra o ciclo de vida da janela sem importar
Electron. A plataforma entra por `StageHostDeps`. O ponto de entrada e
o preload são as fronteiras Electron. Chat, voz e transcrição têm
serviços próprios no Main.

O armazenamento e a busca lexical da memória ficam em `lia/core/src/memory`.
O Stage legado usa esse módulo por meio do IPC existente. Na prévia própria,
as notas ficam no perfil da prévia e a consulta começa desativada. A pessoa
pode salvar ou remover notas e escolher se entram na conversa local.
O Electron no Windows, com serviço HTTP local sintético, confirmou
persistência após reinício e ausência do contexto após desativar a opção.
Na primeira abertura sem memória própria, o Stage importa as notas e a
preferência do perfil gerenciado legado. Se o perfil da prévia já contém
um arquivo de memória, ambos os arquivos são preservados sem fusão.

O controle de presença em `lia/core/src/presence/service.ts` recebe as
operações de janela, tela e persistência por contrato. A prévia usa esse
controle em uma janela transparente separada, com passagem de cliques.
O chat abre e oculta o avatar e oferece controles de pausa, fixação e
posição inicial, além da ocultação ao passar o ponteiro. A janela de
presença encerra junto com a janela de chat.
As preferências são gravadas na configuração canônica do produto.

A prévia de avatar usa [Three.js](https://github.com/mrdoob/three.js)
e [three-vrm](https://github.com/pixiv/three-vrm), ambos MIT, nas versões
fixadas no lockfile. A renderização é carregada sob demanda, sem processo
extra e sem loop de quadros para a imagem estática. Se o arquivo contiver
uma animação glTF, a prévia toca a primeira faixa válida, com alvo de
24 quadros por segundo enquanto o documento estiver visível. A janela lê apenas o
VRM escolhido pela pessoa, limita o arquivo a 64 MB e recusa recursos
externos. O renderer permanece isolado e sem acesso à rede. Nenhum
modelo de terceiros é distribuído junto com a prévia.
**Lembrar este avatar** guarda uma cópia no perfil local da prévia.
Abrir a seção Avatar em outra sessão recupera essa cópia. **Esquecer
avatar salvo** remove a cópia após confirmação. A presença no desktop
continua sendo aberta explicitamente pelo chat.

No Electron no Windows, um VRM sintético abriu, renderizou e voltou a
abrir após fechar a prévia. O mesmo teste recusou uma textura externa.
O ensaio da janela de presença confirmou movimento, fixação, retorno,
ocultação e encerramento junto com o chat. Coordenadas sintéticas
confirmaram a mudança de opacidade ao entrar e sair da área do avatar.
Com dois monitores físicos conectados, o ensaio confirmou que a seleção
do segundo confinou o avatar à área de trabalho escolhida e persistiu.
Com mudança simulada da área útil, a janela reduziu e recuperou a
escala configurada assim que voltou a dispor de espaço.
O gate comparou dois quadros de uma animação incorporada sintética.
Dois modelos VRM texturizados de referência renderizaram de corpo
inteiro no Windows. Modelos estáticos em pose T recebem uma postura
relaxada. O ensaio usou arquivos locais já existentes e os modelos
ficam fora da distribuição da prévia.
Animações externas, fullscreen e recuperação após
desconexão física de monitor seguem pendentes.

Para repetir o ensaio em Windows, compile o Stage, instale o Electron
com `corepack pnpm exec install-electron` em `lia/stage` e execute
`node --experimental-strip-types scripts/check-native-presence.mjs`
em `lia/desktop` após instalar suas dependências. O script gera seu
próprio VRM sintético, registra o resultado e salva uma captura em um
diretório temporário. O CI executa esse ensaio na árvore extraída sem AIRI.

```bash
cd lia/stage
corepack pnpm run build
corepack pnpm run typecheck
corepack pnpm run test
```

O histórico do Stage próprio começa desativado. Se habilitado, guarda
até 24 trocas de texto no perfil local. Até seis trocas da mesma
conexão podem compor o contexto da próxima requisição. Respostas
geradas com notas pessoais ficam visíveis no histórico, mas ficam
fora do contexto reutilizado. O Electron Windows, com serviço HTTP
local sintético, confirmou recuperação, retomada e confirmação da
limpeza. Com histórico ativo, **Importar conversa legada** aceita o
JSON exportado pelo Stage anterior. A prévia traz as trocas textuais
mais recentes da última conversa atualizada até completar 24 trocas
no perfil. O texto importado é exibido para leitura local. Anexos,
metadados e outras conversas ficam no arquivo original.

O ensaio de histórico usa os mesmos pré-requisitos Windows do gate de
presença. Em `lia/desktop`, execute `node scripts/check-native-history.mjs`.
O CI inclui os dois ensaios e publica os relatórios e capturas disponíveis.

Ainda faltam animações, presença em múltiplos monitores
e paridade com os provedores do Stage legado.

---

## `lia/launcher`

`src/resolve-stage-target.ts` isola **a decisão** de qual Stage subir
(`packaged` × `development`, com `LIA_STAGE_MODE` vencendo a inferência). A
decisão é função pura justamente porque o defeito caro do Launcher não foi
chamar o executável errado — foi decidir errado em qual modo entrar e não
perceber que o processo criado não ficou pronto.

```bash
cd lia/launcher && node --experimental-strip-types --test "test/*.test.ts"
# 8 testes, 8 pass
```

---

## O que está verificado e o que não está

| Item | Estado |
| --- | --- |
| Contratos (154 testes) | **PASS**, executado em cópia sem `airi/` |
| Stage próprio (16 testes) | **PASS**, executado |
| Seleção de alvo (`lia/launcher`, 8 testes) | **PASS**, executado |
| Teste de mutação do Stage | **detecta** o bug de declarar pronto antes da hora |
| Janela inicial do Stage próprio | **PASS** no Electron 43.4.1 no Windows |
| Encerramento cooperativo do Stage próprio no Windows | **PASS** para o processo principal e a remoção do registro |
| Microfone e saída de áudio físicos | **NÃO EXECUTADO** |

Este projeto exige Windows real para o gate visual. Teste unitário verde **não**
é esse gate.

---

## Documentos

- `docs/architecture/AIRI-COMPARISON.md` — o AIRI limpo × o AIRI da Lia, medido
- `docs/architecture/LIA-STAGE-ARCHITECTURE.md` — os três níveis e os contratos
- `docs/architecture/LIA-MIGRATION-PLAN.md` — ordem da migração e rollback
