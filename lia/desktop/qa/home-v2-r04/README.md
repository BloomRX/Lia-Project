# Lia Desktop Home V2 R04

A Home Vue do Launcher usa o retrato oficial de 1672 × 941 já versionado. Seu SHA-256 coincide com o arquivo de origem registrado no handoff R04 (`a6772cb11e20bfa312253dda69a9a8f8a4a4d55a3b42c7b03999b33d9e9126eb`).

O protótipo WIDE fornece o enquadramento do retrato à esquerda e a narrativa à direita. No COMPACT, a narrativa vai para a esquerda e o retrato para a direita. Abaixo de 720 px de largura, a mesma Home empilha o retrato e os controles em uma área rolável. A paleta combina a Foundation V1.2.0-FROZEN com os estados específicos do handoff. A fonte variável Plus Jakarta Sans e sua licença OFL acompanham o Launcher para uso offline. [Fonte distribuída pelo Google Fonts](https://github.com/google/fonts/tree/main/ofl/plusjakartasans)

## Diferenças em relação ao Stitch

- A Home apresenta a prontidão da IA e o estado real da voz. Prontidão indica configuração válida para iniciar uma conversa.
- Sem IA configurada, o CTA de conversa fica desabilitado e **Configurar IA** abre IA & Recursos. O primeiro uso oferece as escolhas de voz ou somente texto e grava a preferência pela API do produto.
- Os estados de falha usam mensagens localizadas do Launcher e oferecem **Atualizar estado** e **Diagnósticos**. O CTA permite nova tentativa se a prontidão permitir. O controle de encerramento acompanha o ciclo real do Stage.
- A navegação conserva os cinco destinos do Launcher, com ícones em SVG e rótulos existentes. O menu selecionado e o foco de teclado têm indicadores distintos.

## Capturas do Electron no Windows

| Cenário | Capturas |
| --- | --- |
| WIDE pronta | [1320 × 860](captures/wide-ready-1320x860.png) · [1366 × 768](captures/wide-ready-1366x768.png) · [1920 × 1080](captures/wide-ready-1920x1080.png) |
| COMPACT pronta | [880 × 660](captures/compact-ready-880x660.png) · [zoom do Electron a 125%](captures/compact-ready-zoom125.png) · [escala de DPI a 125%](captures/compact-ready-dpi125.png) |
| Janela estreita | [660 × 430](captures/narrow-ready-660x430.png) · [440 × 330](captures/narrow-ready-440x330.png) · [CTA em foco após rolagem por Tab](captures/narrow-ready-focus-440x330.png) |
| Configuração e recuperação | [IA a configurar](captures/compact-unconfigured.png) · [primeiro uso](captures/compact-first-run.png) · [falha de leitura de estado](captures/compact-error-readiness-ipc.png) |

O [relatório da Home](home-r04-report.json) registra dimensões, fonte, imagem e resultados de overflow. Os estados prontos usam um perfil de ensaio com conexão local configurada. O estado de falha foi injetado no IPC do processo de teste. A escala de DPI foi aplicada à instância isolada do Electron com `--force-device-scale-factor=1.25`.

A revisão visual independente comparou as capturas normais com as duas exportações R04 do Stitch. O enquadramento do rosto e da mão, a posição da assinatura e a ação principal foram conferidos lado a lado. Os itens do rodapé e o CTA em foco foram conferidos nas capturas finais. O aceite visual da PR cabe à revisão humana.

## Reprodução

Na raiz da worktree, prepare o desktop com `.\Lia.bat -PrepareOnly` e rode `.\lia\Test-Lia.ps1`. Em `lia/desktop`, execute os comandos abaixo.

```powershell
pnpm exec vitest run --config vitest.home.browser.config.ts
node scripts/check-native-home-r04.mjs
node --experimental-strip-types scripts/check-native-stage.mjs --require-independent --verify-foundation
node --experimental-strip-types scripts/check-native-stage.mjs --require-independent --legacy-user-data
```

A suíte Chromium cobre prontidão desconhecida, configuração incompleta, prontidão confirmada, falhas e recuperação, início e encerramento, primeiro uso, voz, localização, teclado, redimensionamento e movimento reduzido. Os gates nativos abrem e encerram o Stage independente pelo Launcher, verificam a remoção do registro e a saída do processo e repetem o ciclo com um perfil histórico preservado. [Ciclo nativo](stage-lifecycle-report.json) · [Perfil histórico](stage-legacy-profile-report.json)

`Test-Lia.ps1` passou no Windows, incluindo build de tipos, lint, 347 testes do Launcher e a checagem de pré-requisitos de empacotamento. Dois testes do Launcher foram pulados pelo runner. Os 27 casos Chromium e os três gates nativos acima também passaram. Os gates nativos exercitaram o Electron de desenvolvimento e o ciclo de janela do Stage com perfis de ensaio.
