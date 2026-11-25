# Validação integrada da Lia no Windows

Na raiz, com os pré-requisitos de Node.js e Corepack disponíveis, prepare o
desktop e execute as verificações próprias em sequência.

```powershell
.\Lia.bat -PrepareOnly
node --experimental-strip-types lia/desktop/scripts/check-native-stage.mjs
node lia/desktop/scripts/check-native-history.mjs
node --experimental-strip-types lia/desktop/scripts/check-native-presence.mjs
```

Interrompa se algum comando retornar código diferente de zero. Os gates
abrem o Electron real e usam perfis isolados. O primeiro verifica abertura
e encerramento do Stage pelo Launcher. O segundo envia mensagens a um
serviço HTTP local sintético e verifica histórico, memória, personalidade
e autorização de ferramenta. O terceiro exercita o avatar e a janela de
presença. Os scripts registram resultados em diretórios próprios de
evidências. No histórico e na presença, esses diretórios contêm relatórios
e capturas.

Para validar o instalador privado, execute os comandos abaixo com a prévia
desinstalada no usuário de teste. Substitua o caminho pela versão recém-gerada.

```powershell
node lia/desktop/scripts/package-windows.mjs --internal-test
.\lia\desktop\scripts\check-native-install.ps1 -Installer '<caminho do instalador>' -RequireAttribution
```

Se o NSIS falhar em `!include` para um arquivo existente dentro de
`node_modules/.pnpm`, confira o comprimento do caminho completo e repita
o build em um checkout separado próximo à raiz do volume. Na candidata
derivada de `67a633b8`, o NSIS falhou ao abrir uma inclusão de 267
caracteres. O mesmo arquivo-fonte foi extraído em um caminho curto e
o empacotamento concluiu. Preserve os dois logs para comparar.

O gate de instalação verifica a instalação limpa, o ciclo Launcher–Stage,
uma troca sintética na janela do Stage que o Launcher abriu, a saída dos processos do pacote e
a desinstalação. Os cenários com voz e visão usam gates separados no
[CI Windows](../../.github/workflows/lia-native-windows.yml). O serviço
sintético não comprova disponibilidade de um provedor externo. O gate
`check-native-speech.mjs <certificado> <chave>` usa um serviço HTTPS local com
credencial sintética e respostas de consentimento injetadas. Ele confirma que
o botão Parar áudio fecha uma requisição de síntese pendente, libera a interface
sem atribuir uma fonte ao player e permite uma nova reprodução silenciada.
O caso de um adaptador devolver áudio apesar do cancelamento é coberto
separadamente em `lia/stage/test/stage-voice.test.ts`. Os testes
de presença não medem FPS nem impacto em jogos.

A sessão Windows do CI não encontrou o campo de mensagem pelo UI Automation
no gate `45621582056`. O CI seleciona `-DirectStageConversation` para
exercitar, via Playwright, a conversa no executável instalado após validar
o Launcher. O relatório marca `conversationThroughLauncher: false` nesse
modo. Execute o gate padrão numa sessão Windows interativa para provar a
troca na janela aberta pelo Launcher.

Para testar inferência no Stage instalado, execute o mesmo comando de
instalação limpa com `-LocalModelPort <porta>` e `-LocalModel <id>`.
O servidor deve escutar em `127.0.0.1` com a API de chat em `/v1`.
O relatório identifica o serviço fornecido pelo operador separadamente da
resposta sintética padrão. No Windows, o pacote privado de `07dd9ef9` passou
com llama.cpp 12424 e Qwen3.5-9B-Q4_K_M em CPU, incluindo desinstalação.
O cenário usa uma pergunta sintética e nunca lê um perfil do usuário.

O roteiro legado e sua documentação podem ser reproduzidos em um checkout
separado no commit [5cba44cc](https://github.com/BloomRX/Lia-Project/tree/5cba44ccfb721b5301c3ed3c0796c92aba30c9ef/Tests/windows).
Os resultados e comandos históricos em relatórios anteriores se referem
àquele código. Para novas medições por PID, use o
[coletor Windows](../../tools/desktop-benchmark/README.md).
