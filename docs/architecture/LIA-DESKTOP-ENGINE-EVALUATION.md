# Lia Desktop — avaliação de engines e presença

Data da pesquisa: 07/11/2026. Estado: estudo técnico; nenhuma migração aprovada ou executada. Escopo: Windows desktop, personagem 2D/3D e convivência com jogos. Nenhuma engine, ferramenta ou dependência foi instalada; nenhum build ou benchmark foi executado.

## 1. Conclusão para decisão

**Recomendação de engenharia, ainda sem medição:** manter Electron/Three.js/Live2D como referência funcional e medir primeiro o custo da presença atual. Se a presença continuar cara depois de controlar resolução, atualização, física e ociosidade, o primeiro experimento comparável deve ser um renderer Godot 4 independente, com Shell/Core existentes preservados. Bevy/Rust é uma alternativa para equipe disposta a manter renderização e integração nativa; Tauri 2 deve ser avaliado como troca de Shell, separadamente da troca de renderer.

Nenhuma fonte consultada demonstra que uma dessas alternativas consumirá menos na Lia com o mesmo avatar, animação, resolução, áudio e serviços. Popularidade, tamanho do instalador, linguagem nativa e mínimo de RAM da loja não respondem a essa pergunta.

Não se recomenda reescrever o produto em Unity ou Win32/DirectX nesta rodada. Unity merece experimento se suas ferramentas de animação e ecossistema de avatar resolverem uma necessidade concreta que justifique a integração e os termos comerciais. Win32/DirectX só merece renderer próprio se a equipe aceitar assumir importação, materiais, animação, recuperação de dispositivo e manutenção. Integração Windows nativa pequena pode coexistir com qualquer renderer sem exigir essa reescrita.

Esta é uma proposta de critérios e experimentos, não uma alteração da arquitetura operacional ou do baseline. O Stage continua como está.

## 2. Qualidade e limites da evidência

- **Fato documental:** capacidade ou comportamento declarado por fonte primária; não significa validação no hardware da Lia.
- **Fato local:** observado por leitura do checkout, sem executar o produto.
- **Inferência/recomendação:** julgamento de engenharia derivado desses fatos, precisa ser validado quando afetar produto.
- **Desconhecido:** engine interna, comportamento ou custo sem evidência suficiente. Não preencher com suposição.

As páginas `latest`, `stable` e branches `main` são móveis. Os links registram o material consultado nesta data; um protótipo deve fixar versão, commit e dependências. Resultados de busca, snippets e metadados de rastreamento podem apresentar datas inconsistentes: não foram usados para declarar uma versão futura como estável.

Preflight local: branch `arena/01a10290-lia-project`, HEAD `40326d7bc1d134f567d908434cb47028577b925e`, baseline funcional registrado `3ef6d11`. Árvore já continha alterações e arquivos novos de outras frentes. Eles foram somente lidos, sem sobrescrita; não são resultados desta pesquisa. Leitura inicial: `AGENTS.md`, `CURRENT-STATE.md` §0/§6, `lia-safe-change` e contrato de orquestração §2–§5. Faixa solicitada T3; capacidade efetiva não verificável.

## 3. Produtos reais: o que ensinam e o que não provam

| Produto e identidade | Fatos sustentados por fonte primária | Engine, consumo e reaproveitamento |
| --- | --- | --- |
| TBH: Task Bar Hero — Steam `3678970`, Nugem Studio/Tesseract Studio | Produto se apresenta como RPG idle na barra de tarefas. É referência de presença compacta e consulta rápida. [Loja oficial](https://store.steampowered.com/app/3678970/TBH/) | Engine e mecanismo da janela não confirmados nas fontes primárias consultadas. Não extrapolar desempenho de sprites para VRM/Live2D, nem tratar requisitos mínimos como consumo medido. Sem licença de código identificada para reutilização. |
| Sua mãe / Your Mother — Steam `3399950`, M for Mother | Companion de desktop, com Workshop. [Página oficial](https://store.steampowered.com/app/3399950/) | Engine e custo desconhecidos. Tags de usuários não são especificação técnica. Não confundir com o produto seguinte. |
| Sua mãe / Your Mom — Steam `4147820`, Mom Game | Descrição confirma arrastar, rotacionar, zoom, olhar acompanhando mouse e importar danças VMD. [Descrição oficial](https://store.steampowered.com/app/4147820/) | Engine não comprovada. Demonstra gestos e animação no desktop como referência de UX; não estabelece portabilidade da implementação nem direitos sobre modelos. |
| Desktop Mascot Engine — Steam `821060`, GamerzDan | Anúncios do desenvolvedor relatam mascotes 2D/3D, problemas de transparência/input/múltiplos monitores e uma troca do sistema de render que reduziu uso, mas rompeu compatibilidade antiga. [Loja](https://store.steampowered.com/app/821060/), [anúncios oficiais](https://steamcommunity.com/app/821060/announcements/) | Não foi encontrada confirmação primária suficiente da engine. O relato histórico é qualitativo, sem números comparáveis. É evidência de custo de manutenção, não recomendação de copiar a stack. |
| DPET: Desktop Pet Engine — Steam `1980920` | Anúncios oficiais registram Workshop com formato Shimeji, pets reagindo ao teclado e trabalho de otimização de carregamento. [Canal oficial](https://steamcommunity.com/app/1980920/allnews/) | A loja redirecionou para a home durante esta pesquisa; isso não prova remoção global nem disponibilidade regional. Engine desconhecida. O repositório homônimo `aphkyle/dpet` não foi identificado como código deste produto. Não confundir identidades. |
| Desktop Homunculus — `not-elm/desktop-homunculus` | O projeto declara Bevy, VRM/VRMA, múltiplos personagens/monitores, janela transparente, interação e limitação dinâmica de FPS. Declara alpha e alerta de transparência Windows/NVIDIA. [Repositório do autor](https://github.com/not-elm/desktop-homunculus) | Rust: MIT ou Apache-2.0; TypeScript: MIT; assets/documentação: CC-BY-4.0. A UI de MODs documenta CEF, logo esse desenho pode carregar Chromium junto com Bevy. [UI WebView](https://not-elm.github.io/desktop-homunculus/mod-development/webview-ui/overview/) |
| AIRI Stage Godot | Existe engine separada e integração de empacotamento ao app Electron. A introdução foi explicitamente experimental. [Engine](https://github.com/moeru-ai/airi/blob/main/engines/stage-tamagotchi-godot/README.md), [builder](https://github.com/moeru-ai/airi/blob/main/apps/stage-tamagotchi/electron-builder.config.ts), [introdução](https://github.com/moeru-ai/airi/actions/runs/25830082910) | Referência de sidecar e fronteira host/renderer, não prova de economia nem autorização para adicionar dependência Lia→AIRI. Copiar a engine inteira exigiria avaliar licença de cada componente e contrariaria a direção de redução do legado. |

**Inferência:** as boas ideias reutilizáveis são manter presença pequena, oferecer interação direta, pausar quando inconveniente e separar avatar de serviços. O produto funcionar visualmente no desktop não revela sua engine ou seu uso em repouso. Não houve inspeção de binários, instalação desses produtos ou comparação de telemetria.

## 4. O que existe no checkout

Observações estáticas da árvore local, incluindo arquivos ainda não versionados de outras frentes:

| Área | Evidência no código | Implicação e limite |
| --- | --- | --- |
| Janela Stage | `airi/apps/stage-tamagotchi/src/main/windows/main/index.ts` cria `BrowserWindow`; `windows/shared/window.ts` retorna `frame: false`, `transparent: true`, sem sombra | Já existe caminho de transparência Electron. Isso não prova comportamento de driver nem eficiência. |
| VRM | `airi/packages/stage-ui-three/src/components/ThreeScene.vue` usa `TresCanvas`, clear alpha zero, DPR configurável, luzes e pós-processamento | Resolução, materiais e efeitos são variáveis que precisam ser igualadas no benchmark; não atribuir todo custo ao Shell. |
| Live2D | `airi/packages/stage-ui-live2d/src/components/scenes/live2d/Canvas.vue` configura Pixi com alpha, `preserveDrawingBuffer: true` e `ticker.maxFPS`; padrão de `maxFps` é zero | Existe controle de FPS; zero não representa renderização parada. Não alterar buffer ou ticker sem prova de efeito e compatibilidade. |
| Hit testing 3D | `airi/packages/stage-ui-three/src/composables/render-target.ts` contém render target e leitura de pixels | Medir custo e frequência reais antes de atribuir gargalo; presença de uma função não prova que rode em todo frame. |
| Godot legado | `airi/apps/stage-tamagotchi/src/main/services/airi/godot-stage/index.ts` contém spawn, WebSocket local com token, ready/fatal, timeout e shutdown | Há um exemplo concreto de lifecycle de sidecar; não foi iniciado nem validado. |
| Contratos Lia | `lia/core/package.json` declara pacote de contratos sem dependências; `lia/core/src/presence/index.ts` descreve presença, limites e monitores | Parte pura pode orientar contrato independente de engine. Arquivo novo na árvore não equivale a baseline publicado. |
| Serviço de presença em andamento | `airi/apps/stage-tamagotchi/src/main/services/lia/presence-service.ts` usa interfaces de janela/tela, eventos de monitor e timer de 100 ms | Política de movimento é separável do render. A consulta `win.isFullScreen()` é da própria janela: não comprova detecção de jogo externo. Opacidade zero não comprova suspensão de render/input. |

**Inferência:** a alternativa de menor risco é desacoplar contratos e políticas gradualmente, preservando o pipeline já funcional. Mudar Electron para Tauri sem mudar renderer não remove automaticamente animações, shaders, timers, WebGL, áudio ou GPU do trabalho executado.

## 5. Comparação de engines

As capacidades abaixo são documentais; custos e adequação são inferências. Não há ranking de RAM, watts ou FPS medidos.

| Opção | Transparência e input | Renderização/repouso | Avatar e integração | Reuso e manutenção |
| --- | --- | --- | --- | --- |
| Electron + Three.js/Pixi | Janela transparente e click-through explícito. Alpha visual não torna regiões automaticamente clicáveis através. [Electron](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles) | Three admite render sob demanda; animação contínua pede frames. Controlar DPR/FPS/física/timers é trabalho do produto. [Three](https://threejs.org/manual/pages/rendering-on-demand.html) | Mantém renderizadores 3D/Live2D e serviços Node atuais; APIs Electron atendem janelas/telas/tray | Maior reuso imediato. Manter Chromium e suas atualizações tem custo, mas é a referência funcional existente. |
| Tauri 2 + WebView2 | Transparência e `setIgnoreCursorEvents`; detalhes Windows dependem da combinação WebView/janela. [Tauri Window](https://v2.tauri.app/reference/javascript/api/namespacewindow/), [WebView](https://v2.tauri.app/fr/reference/javascript/api/namespacewebview/) | Continua WebGL/Chromium no Windows. WebView2 tem processos browser, renderer, GPU e áudio. [Microsoft](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-model) | UI Vue/Three pode ser adaptada; IPC Electron, Node, cofre, lifecycle, áudio e captura exigem adaptadores Rust/sidecar | Menor binário do Shell é plausível ao usar runtime do sistema; RAM menor não está provada. Testar atualização WebView2 e instalação offline. |
| Godot 4 | Window/DisplayServer oferecem overlay, transparência e passagem de mouse; requer configurar janela e viewport. [Aplicações overlay](https://docs.godotengine.org/en/latest/tutorials/ui/creating_applications.html) | `OS.low_processor_usage_mode` permite refresh quando necessário. Animações/física ainda geram trabalho. [OS](https://docs.godotengine.org/en/stable/classes/class_os.html) | Engine 2D/3D completa; VRM/Live2D requerem integração e paridade de materiais, expressões, spring bones e áudio | Boa candidata a renderer separado. UI Vue e serviços não viram código Godot automaticamente; Shell preservado evita reescrever tudo. |
| Bevy/Rust | API possui transparência/composição e nível de janela. Validação do backend/driver continua necessária. [Window](https://docs.rs/bevy/latest/bevy/window/struct.Window.html) | `WinitSettings::desktop_app` usa atualização reativa; redraw contínuo anula a ociosidade. [WinitSettings](https://docs.rs/bevy/latest/bevy/winit/struct.WinitSettings.html) | Boa base ECS/3D; Homunculus mostra aplicação VRM real. Integrações 2D/Live2D e ferramentas de edição não devem ser presumidas | Controle fino com mais engenharia. Bevy avisa sobre APIs em evolução e migrações frequentes. [Projeto](https://github.com/bevyengine/bevy) |
| Unity | Transparência e click-through desktop exigem integração apropriada; UniWindowController é exemplo real. [Plugin do autor](https://github.com/kirurobo/UniWindowController) | `targetFrameRate` e OnDemandRendering existem; render menos frequente não suspende por si só lógica/áudio. [FPS](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/Application-targetFrameRate.html), [on demand](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/Rendering.OnDemandRendering.html) | Ecossistema de animação, UniVRM e SDK Cubism Unity. Interop com Core/serviços e janelas segue necessário | Benefício depende da necessidade de produção de animação; novo toolchain, empacotamento e termos comerciais. Não presumir que jogo famoso use Unity sem prova. |
| Win32 + DirectX/DirectComposition | Controle direto de HWND, hit test e composição alpha; são responsabilidades diferentes. [Janelas](https://learn.microsoft.com/en-us/windows/win32/winmsg/window-features), [composição](https://learn.microsoft.com/en-us/windows/win32/directcomp/bitmap-surfaces) | Pode apresentar apenas quando necessário, mas app precisa implementar scheduling, device lost e recursos. [Swap chain](https://learn.microsoft.com/en-us/windows/win32/desktop/api/dxgi1_2/nf-dxgi1_2-idxgifactory2-createswapchainforcomposition) | Não traz sistema VRM/Live2D, animação, editor, UI, updater ou serviços prontos | Máximo controle Windows e máximo custo próprio. Melhor primeiro como adaptador pontual de WindowsIntegration do que engine inteira. |

### 5.1 Limites comuns de desktop

**Fato documental:** Godot alerta para overlays em fullscreen exclusivo e problemas de transparência em alguns arranjos de GPU híbrida. Borderless fullscreen e fullscreen exclusivo não são equivalentes. [Documentação](https://docs.godotengine.org/en/latest/tutorials/ui/creating_applications.html)

**Requisitos propostos para todas as candidatas:**

- Tela transparente, hit test e click-through são três verificações distintas. Testar clicar num ícone atrás da região vazia, interagir no corpo, arrastar e recuperar o menu pelo tray. Esconder por opacidade não equivale a remover input.
- Vários monitores exigem coordenadas negativas, DPI por monitor, taskbar em lados diferentes, hotplug e zonas vazias entre monitores. Monitor escolhido desaparecendo deve resultar em reposicionamento recuperável.
- Não competir com fullscreen exclusivo nem usar injeção em jogos/anti-cheat. Oferecer pausa/ocultação automática conservadora e botão explícito de recuperação. Um retângulo de janela cobrindo monitor é heurística, não prova universal de jogo.
- O desktop seguro/UAC e telas bloqueadas não são superfícies para a personagem ultrapassar. Bloqueio/suspensão devem parar captura e trabalho visual desnecessário, preservando cancelamento e retomada.
- Presence não deve ler teclas de outras aplicações para descobrir atividade por padrão. Atalhos explícitos e eventos de janela/energia são suficientes para muitos fluxos; observação do usuário depende de permissão separada.
- Continuar chat/voz em background não obriga renderizar avatar a 60 FPS. Definir a política de cada serviço, e testar interrupção mesmo com Shell fechado ou renderer pausado.

### 5.2 Licenças e distribuição

| Componente | Evidência e consequência |
| --- | --- |
| Electron e Three.js | MIT nos projetos; manter avisos e inventário das dependências efetivamente distribuídas. [Electron](https://github.com/electron/electron/blob/main/LICENSE), [Three](https://github.com/mrdoob/three.js/blob/dev/LICENSE) |
| Tauri e WebView2 | Tauri publica MIT/Apache-2.0; runtime Windows é componente separado. [Tauri](https://github.com/tauri-apps/tauri), [runtime](https://v2.tauri.app/reference/webview-versions/). Validar termos e instalação do runtime para a versão adotada; o frontend não deixa de depender de Chromium. |
| Godot | MIT, com obrigações de aviso; o conteúdo tem licença própria. [Licença oficial](https://godotengine.org/license/) |
| Bevy / Homunculus | Bevy MIT/Apache-2.0 com exceções por arquivo; Homunculus separa Rust, TS e assets. [Bevy](https://github.com/bevyengine/bevy), [Homunculus](https://github.com/not-elm/desktop-homunculus). Não herdar a licença de código para modelos/documentação. |
| Unity | Proprietária, termos por plano/uso. Cancelamento de Runtime Fee foi anunciado oficialmente; isso não torna Unity open source nem comprova elegibilidade do produto companion a um plano específico. [Termos/explicação oficial](https://unity.com/blog/terms-update-runtime-fee-cancellation). Verificar contrato aplicável antes de distribuir. |
| VRM / Live2D | UniVRM é MIT; licenças de cada avatar continuam independentes. Cubism Core é proprietário e tem regras próprias de distribuição/publicação. [UniVRM](https://github.com/vrm-c/UniVRM/blob/master/Packages/VRM/LICENSE.md), [Cubism Unity](https://docs.live2d.com/en/cubism-sdk-manual/cubism-sdk-for-unity/), [plataformas Cubism](https://docs.live2d.com/en/cubism-sdk-manual/platform/) |
| Win32 / DirectX | Uso de SDK/runtime depende dos termos Microsoft e dos componentes escolhidos. Não há licença única que cubra assets e bibliotecas de avatar incorporadas. |

Licença permissiva da engine não autoriza redistribuir personagem de jogo, modelo do Workshop, voz, textura ou animação sem a licença correspondente. Essa verificação é requisito de distribuição, sem bloquear esta pesquisa documental.

## 6. Fronteiras propostas: Core, Shell, Presence e WindowsIntegration

**Desenho proposto, não implementação entregue:**

```text
Lia Core — estado, personagem, memória, tarefas, cancelamento, permissões
  | contratos de aplicação versionados
  +-- Lia Shell — launcher, setup, configurações, conversa e diagnostics
  +-- Lia Presence — avatar, animação, expressões, lip sync e render budget
  +-- WindowsIntegration — monitores/DPI, foco, tray, hotkeys, energia e hit test
  +-- serviços de IA/voz/ferramentas — executados pelo host autorizado
```

- **Core:** autoridade de configuração e da sessão. Personalidade é dado; renderer não escolhe provider nem tem chave. Contratos TS puros são reutilizáveis diretamente em hosts TS; outro idioma reutiliza esquema e semântica, com validação equivalente, não imports TS por mágica.
- **Shell:** interface humana. Fechar/minimizar não deve matar a sessão por acidente, e encerrar a Lia precisa encerrar seus filhos. UI técnica permanece em Advanced/Diagnostics.
- **Presence:** recebe aparência, estado emocional, movimento autorizado e envelope de áudio/visemas com timestamp. Emite intenção de interação. Não executa ferramentas nem lê memória/credenciais arbitrariamente. Se falhar, Shell oferece recuperação sem perder conversa.
- **WindowsIntegration:** um dono coordena bounds, DPI e input, evitando duas engines disputarem posição/foco da mesma janela. Detecta bloqueio/energia e observa somente o mínimo necessário. APIs privilegiadas ficam atrás de comandos específicos, sem interface de execução arbitrária.

Contrato candidato: `hello(protocolVersion, capabilities)`, `ready`, `loadCharacter(assetHandle)`, `setPresenceState`, `setAnimationState`, `setAudioEnvelope`, `setRenderBudget`, `pause/resume`, `interactionIntent`, `error(code)`, `shutdown/ack`. Isso é lista de responsabilidades a refinar, não nova API pública aprovada.

Se houver sidecar: autenticação por sessão, escopo de asset validado, limites de tamanho/frequência, correlação e revisão de permissões; named pipe/IPC local com controle de acesso ou transporte local autenticado. Não reutilizar automaticamente o WebSocket legado. Rejeitar versão incompatível, descartar mensagens de sessão encerrada e matar apenas processo cuja identidade pertença à sessão. Não serializar frames de vídeo ou áudio PCM volumoso em JSON por padrão: medir banda/latência e preferir controle mais envelopes compactos. Escolher um único dono da reprodução de áudio para evitar fala duplicada e preservar barge-in.

## 7. Benchmark reproduzível — ainda NÃO EXECUTADO

### 7.1 Manifesto antes da medição

Registrar commit, diff, engine e dependências fixadas, Windows/build, CPU/RAM, GPU/adaptador selecionado, VRAM quando disponível, driver, monitores/DPI/refresh/HDR/VRR, plano de energia, tomada/bateria e temperatura/condição térmica. Não registrar segredos. Identificar processos por PID e instante de criação; incluir Main, renderers, GPU/audio, WebView2/CEF e sidecars. Medir carga de IA/voz separadamente.

Usar **o mesmo arquivo e hash** de um VRM e o mesmo pacote Live2D licenciado em cada engine que suporte o formato. Mesmo número de personagens, texturas, resoluções, transparência, câmera, luzes, sombras, antialiasing, animação, física e lip sync. Incluir uma cena 2D simples de sprites e uma janela vazia como controles. Se um backend não suportar o mesmo material/recurso, registrar como **não comparável** ou apresentar ensaio reduzido separado. Não favorecer uma engine removendo spring bones/expressões da cena dela.

Fixar tamanho físico do render target e tamanho visível; documentar DPR. Avatar 240×360 e janela desktop inteira não são a mesma carga. Medir primeiro apenas Presence, depois **produto completo** com o mesmo Shell e os mesmos serviços. Um renderer nativo junto com Electron/CEF pode acrescentar custo ao total.

### 7.2 Cenas e estados

| Caso | Procedimento comum |
| --- | --- |
| C0 — controle | Desktop sem Lia; depois Shell aberto sem avatar; depois renderer vazio transparente. |
| C1 — repouso estático | Avatar carregado sem animação/física ativa, sem fala ou serviço de IA em atividade; medir política sob demanda. |
| C2 — repouso animado | Mesmo idle/piscar/respiração/física a 15 e 30 FPS; teste opcional 60, identificado separadamente. |
| C3 — interação | Roteiro fixo de olhar, clique, arraste, emoção, menu e 60 s de fala por arquivo de áudio idêntico. Medir retomada e lip sync. |
| C4 — invisível | Oculto por tray, minimizado, coberto e pausa explícita são ensaios diferentes. Verificar frames, timers, captura e áudio esperados. |
| C5 — monitores | Mover entre DPI/refresh diferentes, coordenadas negativas e desconectar monitor durante movimento. Validar input e recuperação. |
| C6 — jogo | Mesmo jogo/cena/benchmark e preset, primeiro sem Lia, depois com Lia e depois com política de pausa. Separar janela, borderless e exclusivo. |
| C7 — lifecycle | Inicialização fria/quente, troca de avatar, renderer falhando, bloqueio/desbloqueio, suspensão/retomada e saída completa. |

Protocolo proposto: aquecimento de 60 s, janela de 180 s para estados estáveis, cinco repetições por combinação, ordem alternada/randomizada e pausa suficiente para estabilizar temperatura. Guardar dados brutos, duração real, mediana, dispersão e p95/p99 quando houver amostras suficientes. Esses números são **parâmetros propostos do ensaio**, não resultados. Captura de vídeo e DevTools alteram carga; obter evidência visual em passagem separada.

### 7.3 Métricas e interpretação

- CPU por árvore de processos: tempo de CPU dividido pelo tempo de parede; declarar normalização por núcleo ou pela máquina inteira.
- Memória: private bytes e working set por processo e total, picos de carga/troca e tendência em ensaio prolongado; soma de working sets pode contar memória compartilhada mais de uma vez.
- GPU: engines 3D/copy/compute, memória dedicada e compartilhada, adaptador e DWM. Não somar percentuais de engines de forma ingênua. Ferramenta sem contador disponível resulta em **N/A**, não zero.
- Frames apresentados e frame time, latência da interação e de retomar a animação; FPS visual e taxa de simulação são coisas distintas. [PresentMon](https://github.com/GameTechDev/PresentMon) é ferramenta candidata, não instalada/executada nesta rodada. Se o contador não capturar o caminho de composição, declarar a lacuna.
- Energia: comparar mesma máquina sob condições controladas; contador de potência ausente não autoriza estimar watts. Medir delta também no sistema total para incluir compositor e serviços.
- Jogos: comparar média e p95/p99 de frame time, 1% low se a metodologia estiver definida, falhas de foco/input e tempo para a pausa ser aplicada. Não rodar carga de IA variável durante comparação do renderer.
- Distribuição: tamanho do app e runtime necessário em máquina limpa, inicialização fria/quente, falha/reparo do runtime e saída sem processos residuais. Installer pequeno não é medição de memória.

### 7.4 AMD e fallback

Incluir AMD antigo disponível e uma configuração AMD atual quando houver acesso; registrar modelo/driver exatos em vez de generalizar para a marca. Incluir Intel integrada e, se disponível, GPU discreta de outro fabricante; GPU híbrida é um cenário separado. Testar backend que cada engine efetivamente suporta naquela placa: não presumir Vulkan/DirectX moderno, ROCm ou CUDA. Essa avaliação de presença gráfica não exige runtime de inferência GPU.

No Godot, avaliar Compatibility e outros renderers disponíveis sem alterar qualidade silenciosamente; em Bevy fixar backend wgpu; em Electron/WebView2 registrar backend/aceleração efetivos. Falha de transparência, compilação de shader ou device lost entra como falha de compatibilidade, mesmo que a média de FPS nos outros testes seja boa. Modo sem aceleração tem ensaio próprio e pode resultar em presença estática/2D reduzida; não prometer VRM fluido por CPU. Hardware não acessível fica **NOT RUN**.

## 8. Critérios de manter, investigar ou migrar

**Critérios propostos para aprovação futura; não são novos gates de release publicados.** Antes do piloto, o responsável deve fixar orçamento absoluto por máquina de referência e benefício mínimo, evitando escolher a régua depois de ver o resultado.

| Porta | Evidência exigida |
| --- | --- |
| Manter Electron | Satisfaz orçamento de repouso, jogo e interação no hardware-alvo após ajustes medidos, com paridade funcional e lifecycle. Sem dado contrário, preservar o caminho funcional. |
| Abrir protótipo | Pelo menos um custo relevante reproduzível atribuído ao renderer/Shell por controles C0–C4; hipótese específica sobre como a candidata reduz esse custo. |
| Autorizar piloto | Mesmo modelo/cenas, transparência e input corretos, VRM e Live2D demonstrados ou escopo de suporte explicitamente decidido; nenhuma perda em voz/cancelamento/monitores; licença e instalação verificadas. |
| Trocar por desempenho | Redução repetível no **total do produto**, além da dispersão, no recurso que motivou a troca; sem regressão material nos demais. Exemplo de limiar a negociar: pelo menos 20% no gargalo e nenhuma piora superior a 5% no p95 do jogo. Estes percentuais são proposta, não medição nem aceite já concedido. |
| Trocar por capacidade | Requisito bloqueador demonstrado, impossível ou excessivamente caro no atual, com paridade dos requisitos existentes. Não exigir economia falsa para justificar ferramenta de animação necessária. |
| Não migrar | Só melhora cena reduzida, depende de hardware fora do alvo, mantém dois stacks sempre ligados sem benefício total, ou exige portar serviços/credenciais durante o experimento de render. |

Comparar custo de manutenção por entregáveis, sem estimativas de prazo inventadas: adaptador de janela/input, importação dos dois formatos, paridade visual e física, áudio/visemas, IPC/lifecycle, isolamento de privilégios, empacotamento/atualização, QA Windows/GPU e suporte. Medir esforço do primeiro protótipo para estimar os próximos. Manter duas engines em produção exige uma matriz de testes maior; prazo, número de pessoas e economia financeira são desconhecidos nesta rodada.

## 9. Caminho gradual reversível

1. Medir o Stage atual, distinguindo Shell, renderer, compositor e serviços. Registrar os gargalos, sem supor que memória observada no Gerenciador de Tarefas pertence só ao avatar.
2. Especificar contratos pequenos da Lia e adaptar a presença atual a eles somente em tarefa autorizada. Preservar conversas, configuração e cofre como autoridades únicas.
3. Executar um protótipo isolado Godot com os mesmos assets, sem importar engine inteira do AIRI. Usar a integração experimental externa para estudo de responsabilidades e falhas, não como dependência nova.
4. Comparar Bevy apenas se controle nativo/arquitetura ECS ou o resultado do protótipo justificarem. Avaliar Tauri em experimento separado para não confundir ganho do Shell com ganho do renderer.
5. Se os critérios passarem, disponibilizar seleção controlada de renderer com retorno ao atual e dados no mesmo formato; a escolha de implementação não precisa aparecer no fluxo Beginner.
6. Só remover o renderer anterior depois de paridade, installer/atualização, recuperação e matriz de hardware/jogos aprovados. Uma prova visual isolada não fecha esses gates.

Esta pesquisa não alterou configuração, código de runtime, Stage, dependências ou documentos de estado operacional. Benchmarks, protótipos, instaladores e QA físico permanecem **NOT RUN**. A entrega verificável é este documento e suas fontes primárias.
