# Lia Desktop · animação humanoide do Forge no Windows

O Stage toca o primeiro clipe glTF embutido de duração positiva no VRM. Na base `bae77237`, o Robô Pêndulo abriu e animou a antena. Ao aplicar uma trilha no braço, `VRM.update()` copiava a pose normalizada por cima das rotações que o `AnimationMixer` já havia aplicado às juntas usadas pelo skinning. No Electron, o cosseno de `leftUpperArm` era `1` onde a trilha de −60° previa `0,5`.

O Stage impede essa cópia quando o clipe tem trilha de posição ou rotação em uma junta humanoide. O mixer aplica o primeiro quadro no carregamento. O avatar conserva a pose de repouso das juntas sem trilha e o ajuste de braços para avatares sem clipe. A atualização do VRM continua processando expressões e os demais componentes. Nas malhas com morphs animados também controlados pelo VRM, o Stage soma as duas contribuições durante o desenho e restaura o valor do clipe ao terminar o quadro. Isso preserva a piscada durante a reação ao chat e a fala, inclusive quando duas expressões usam o mesmo alvo.

## Como entregar um avatar pelo Forge

1. Exporte um VRM autocontido com extensão de avatar, texturas incorporadas e o clipe glTF no próprio arquivo. As trilhas de rotação e posição apontam para os nós do rig desse arquivo. Em um rig diferente é preciso reaplicar a animação antes da exportação.
2. No Forge, use **Modelo 3D portátil**, revise o conteúdo e escolha **Lia Desktop · avatar VRM**. Confira o SHA-256 do `.vrm` indicado por `files` no manifesto do pacote.
3. No Stage, abra **Avatar → Abrir avatar VRM** e importe o `.vrm` conferido. Use **Mostrar no desktop** para verificar a mesma animação na presença. **Lembrar este avatar** guarda uma cópia no perfil local. O [exemplo original sob MIT](https://github.com/BloomRX/Lia-Forge/tree/5b460111fe3584ef0242f3e647ba5291234f72b6/examples/production) fornece o modelo e o manifesto.

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
