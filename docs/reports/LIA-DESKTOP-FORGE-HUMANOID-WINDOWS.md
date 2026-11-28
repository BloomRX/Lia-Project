# Lia Desktop · animação humanoide do Forge no Windows

O Stage toca o primeiro clipe glTF embutido de duração positiva no VRM. Na base `bae77237`, o Robô Pêndulo abriu e animou a antena. Ao aplicar uma trilha no braço, `VRM.update()` copiava a pose normalizada por cima das rotações que o `AnimationMixer` já havia aplicado às juntas usadas pelo skinning. No Electron, o cosseno de `leftUpperArm` era `1` onde a trilha de −60° previa `0,5`.

O Stage impede essa cópia quando o clipe tem trilha de posição ou rotação em uma junta humanoide. O mixer aplica o primeiro quadro no carregamento. O avatar conserva a pose de repouso das juntas sem trilha e o ajuste de braços para avatares sem clipe. A atualização do VRM continua processando expressões e os demais componentes. Nas malhas com morphs animados também controlados pelo VRM, o Stage soma as duas contribuições durante o desenho e restaura o valor do clipe ao terminar o quadro. Isso preserva a piscada durante a reação ao chat e a fala, inclusive quando duas expressões usam o mesmo alvo.

## Como entregar um avatar pelo Forge

1. Exporte um VRM autocontido com extensão de avatar, texturas incorporadas e o clipe glTF no próprio arquivo. As trilhas de rotação e posição apontam para os nós do rig desse arquivo. Em um rig diferente é preciso reaplicar a animação antes da exportação.
2. No Forge, use **Modelo 3D portátil**, revise o conteúdo e escolha **Lia Desktop · avatar VRM**. Confira o SHA-256 do `.vrm` indicado por `files` no manifesto do pacote.
3. No Stage, abra **Avatar → Abrir avatar VRM** e importe o `.vrm` conferido. Use **Mostrar no desktop** para verificar a mesma animação na Presença. Se a janela já estiver aberta, importar outro VRM atualiza as duas superfícies. **Lembrar este avatar** guarda uma cópia no perfil local. O [exemplo original sob MIT](https://github.com/BloomRX/Lia-Forge/tree/5b460111fe3584ef0242f3e647ba5291234f72b6/examples/production) fornece o modelo e o manifesto.

A importação avulsa de VRMA, `motion.gltf` e pacotes Forge V1 exige outro fluxo. Retargeting entre rigs, seleção de clipe e compatibilidade com o avatar oficial ficam fora do ensaio. O gate usa o Robô Pêndulo MIT e cria a variante animada somente na pasta de evidências.

## Validação reproduzível

Na raiz da worktree, prepare a árvore com `Lia.bat -PrepareOnly` e rode `powershell.exe -NoProfile -File .\lia\Test-Lia.ps1`. Para executar o gate humanoide a partir da raiz, rode:

```powershell
corepack pnpm@11.24.0 --dir lia/stage run build
node lia/desktop/scripts/check-native-avatar-rig.mjs
```

O gate abre o Stage próprio em Electron 43.4.1 e Chromium 150.0.7871.224 no Windows 11 x64. Cria um perfil temporário vazio, entrega o arquivo ao campo de importação pelo Playwright e confirma a remoção pelo diálogo do Stage. O observador WebGL mede as matrizes enviadas para o skinning e os pesos enviados ao shader. O relatório JSON e as capturas PNG ficam em `RUNNER_TEMP`, ou na pasta temporária do Windows se a variável estiver ausente.

| Verificação | Evidência |
| --- | --- |
| Regressão antes da correção | Cosseno esquerdo esperado `0,5` e observado `1`. Com juntas corrigidas e antes da composição dos morphs, piscada esperada `0,35` e observada `0`. |
| Braços no preview e na presença | Braço esquerdo em −60°, direito alternando +30° e +60°. O gate mede as duas poses e compara cosseno e seno das matrizes. |
| Expressões simultâneas | Piscada de `0,35`, reação `happy` de `0,55` que também contribui para o alvo da piscada e boca `aa` de `0,18` durante fala. O WebGL recebeu 0,625 no alvo compartilhado durante a reação e voltou a 0,35 na fala e em repouso, sem acumulação entre quadros. |
| Ciclo de vida | Zero quadros novos durante a pausa em tela cheia e retomada ao sair. O perfil reabre o arquivo e preserva sua animação. Após remoção, o avatar permanece ausente ao reiniciar. Stage e presença encerram normalmente, sem exceções no renderer. |
| Regressões integradas | Launcher, presença, conversa, memória Markdown, STT e síntese em Electron Windows. A conversa usou HTTP sintético. Kokoro local reproduziu áudio silenciado, com cancelamento e leitura automática opt-in. A síntese HTTPS usou serviço local sintético, e o STT usou captação Chromium sintética. Hardware de áudio e serviços externos ficaram fora do ensaio. |

A execução local retornou código 0 no build do Stage e em todos os sete gates Electron. O script de suítes retornou código 0 com 163 testes Core, 430 do Runtime, 60 do Stage, 350 do Launcher com 2 skips e 5 do empacotador. Também passaram typecheck, lint e pré-requisitos do empacotamento privado. O gate do avatar usa os artefatos de desenvolvimento. A instalação do desktop com a correção segue fora deste ensaio.

A fixture em `lia/stage/test/fixtures/robo-pendulo.vrm` corresponde ao SHA-256 `3ba9d71609c70a28ee9e67727b23421f284ac0747cead73a85ea64e1e45eb0f7`. Sua [licença MIT](../../lia/stage/test/fixtures/robo-pendulo.LICENSE) acompanha o arquivo.

## Troca com a Presença aberta

Na base `cce10e41`, trocar o VRM mudava a Prévia e a Presença continuava exibindo o avatar anterior até ser aberta novamente. O Main agora encaminha cada troca validada para a janela que já existe e aguarda a confirmação dessa janela. A confirmação de carregamento vem depois da troca, inclusive quando a renderização está pausada. A janela mantém a posição e o estado de visibilidade. Se o renderer deixa de responder, o Main fecha a janela e libera os controles para uma nova abertura explícita.

O gate do Robô Pêndulo executa uma troca com a Presença visível e outra em tela cheia, com o desenho pausado. No Electron 43.4.1 no Windows, a janela reteve o mesmo identificador, o cosseno do braço esquerdo mudou entre `1` e `0,5` conforme o modelo e a piscada voltou após restaurar o clipe. Durante a ocultação, o contador de quadros ficou em `20` e aumentou ao retomar com o avatar trocado. Os três encerramentos registraram código 0 e o renderer ficou sem exceções.

O ensaio separado com `AvatarSample_A.vrm` e `AvatarSample_B.vrm` passou com arquivos locais e perfil isolado. A→B e B→A renderizaram na Prévia e na mesma janela da Presença. Um VRM inválido foi recusado e B permaneceu nas duas superfícies. A ação **Lembrar este avatar** salvou B. Uma troca posterior para A sem salvar preservou a cópia de B, restaurada na Prévia após reiniciar e na Presença ao abri-la pelo botão. Os dois encerramentos retornaram código 0 e o renderer ficou sem exceções. As capturas e os modelos de amostra ficaram na máquina de teste.

`node --experimental-strip-types lia/desktop/scripts/check-native-presence.mjs` passou no mesmo ambiente, incluindo colocação em um segundo monitor conectado, pausa em tela cheia e simulação de recuperação da área de trabalho. A suíte do Stage passou com 61 testes, incluindo a validação do tamanho do buffer copiado entre os processos. Build, typecheck e lint passaram.

## Piscada automática do preset VRM

O Stage aplica pulsos curtos ao preset `blink` quando ele tem um vínculo de morph válido. A espera entre piscadas é de quatro segundos. Quando o clipe selecionado anima os pesos em uma primitiva vinculada à piscada, o Stage conserva a trilha do clipe. As expressões do VRM continuam passando pelo gerenciador do modelo.

Em um avatar estático, o Stage desenha os quadros do pulso e volta a repousar. Ocultar a Presença cancela o pulso. Ao retomar, o modelo volta à pose de repouso e começa uma nova espera. Uma troca de avatar libera os temporizadores do anterior.

O gate do Robô Pêndulo passou no Electron 43.4.1 no Windows. Ele gera uma variante sem clipe que comprime os olhos, outra que combina braços animados com o preset e um controle com a trilha de pesos autoral. Execute o gate completo ou isole a regressão nova com `node lia/desktop/scripts/check-native-avatar-rig.mjs --preset-blink-only`.

| Verificação | Medição no Electron Windows |
| --- | --- |
| Prévia e Presença sem clipe | Peso `0 → 1 → 0` nos dados enviados ao WebGL. O pico registrado no framebuffer corresponde ao fechamento sintético dos olhos. |
| Clipe de braço sem trilha de pesos | Matrizes do braço preservadas. No pico da piscada, o peso da fala simulada permaneceu em `0,18`. |
| Clipe com trilha de pesos | O peso autoral permaneceu em `0,35` durante os 4,65 s observados. |
| Pausa, retomada e troca | Nenhum quadro novo durante 4,65 s com a Presença oculta. A piscada voltou ao exibir. Após trocar para uma variante estática sem `blink`, o contador ficou estável por 4,65 s. |
| Regressões | Amostras A e B mantiveram troca e restauração. O pacote do Forge com GLB do Blender preservou o VRM e sua animação. O gate separado de chat, memória e Kokoro local silenciado passou. |

A verificação do novo preset cobriu o Robô Pêndulo MIT. A revisão artística do avatar oficial permanece independente.
