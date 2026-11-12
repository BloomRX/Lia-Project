# Lia Desktop — decisão de arquitetura de runtime

**Data:** 12/11/2026
**Branch:** `arena/01a10290-lia-project`
**HEAD na abertura da rodada:** `ee0172e` (sincronizado com o remoto)
**Status:** **decisão registrada — Cenário C (híbrido), Electron retido**. Nenhuma migração
aprovada nesta rodada. Protótipos comparativos e medições C0–C4: **NOT RUN** neste
ambiente (ver §6). Nenhum credencial foi cadastrada, nenhum provider foi ampliado.

Este documento cumpre a Etapa 0 do plano mestre. Ele **não** aprova release, não muda o
baseline funcional e não substitui o estudo de engines de 07/11
([`LIA-DESKTOP-ENGINE-EVALUATION.md`](../architecture/LIA-DESKTOP-ENGINE-EVALUATION.md)),
que permanece válido e é referenciado aqui.

---

## 1. Método e qualidade da evidência

Três classes de afirmação, sempre identificadas:

- **Fato local** — lido no checkout desta branch (código, configuração, contagens). Reexecutável.
- **Fato documental** — declarado por fonte primária (documentação oficial do projeto citado).
- **NÃO EXECUTADO** — o que exigiria Windows, display ou toolchain ausente neste sandbox.

O que foi executado nesta rodada: inspeção estática do código e das configurações de build,
contagens de acoplamento, leitura dos relatórios Windows já existentes (PROMPT-38/40 e
coleta de 08/11) e consulta às fontes primárias listadas em §9.

O que **não** foi executado: nenhuma medição nova de Electron, nenhum protótipo Tauri/Qt/
Flutter/WinUI, nenhuma medição de GPU/FPS/energia/multimonitor, nenhuma interação com a
interface. O sandbox é Linux, sem `DISPLAY`, sem GTK, sem binário do Electron instalado e
sem `cargo`, `qmake`, `flutter` ou `dotnet` — portanto **não é possível** rodar qualquer
um dos finalistas aqui, e números de máquinas diferentes não seriam comparáveis.

---

## 2. Arquitetura atual (fato local)

### 2.1 Componentes e fronteiras

| Componente | Onde vive | Depende de Electron? | Observação |
|---|---|---|---|
| Contratos (`@lia/contracts`) | `lia/core/src` | **Não** — zero dependências | Protocolo versionado, ciclo de vida, catálogo de providers |
| Core de produto (`@lia/core`) | `airi/packages/lia-core/src` | **Não** — só builtins do Node (`fs`, `crypto`, `net`, `path`) | Config canônica, vault, voz, caminhos |
| Launcher Main | `airi/apps/lia-app/src/main` | **Sim, em 2 arquivos** (`index.ts`, `ipc.ts`) | 4.088 LOC não-teste; 26 canais IPC; supervisor de processos |
| Launcher Preload | `airi/apps/lia-app/src/preload` | Sim (é a ponte) | `contextIsolation: true`, `nodeIntegration: false` |
| Launcher Renderer | `airi/apps/lia-app/src/renderer` | **Não** | Vue 3 + Vite; 5 telas; fala só com o preload |
| Stage Main | `airi/apps/stage-tamagotchi/src/main` | **Sim, em 74 arquivos** | 25.345 LOC não-teste; 16 famílias de janelas |
| Stage Renderer | `airi/apps/stage-tamagotchi/src/renderer` | **Não** | 52.031 LOC; Three.js/VRM, Live2D/Pixi, áudio, UI |
| Hosts de ciclo de vida | `lia/launcher`, `lia/stage` | **Não** — plataforma injetada | Protótipos headless, sem Electron por import |
| Runtime de voz | gerenciado pelo Launcher | Não | Processo próprio (Kokoro), supervisado pelo host |

Contagens de acoplamento (grep, não-teste):

- `from 'electron'` no Stage Main: **74 arquivos**; superfície: `session` 391, `BrowserWindow`
  210, `screen` 106, `ipcMain` 98, `protocol` 78, `globalShortcut` 22, `systemPreferences` 11,
  `powerMonitor` 10, `Tray` 2 (ocorrências).
- `from 'electron'` no Launcher Main: **2 arquivos** (`index.ts`, `ipc.ts`).
- Renderer: nenhum import de `electron` ou de builtin do Node fora dos testes estáticos.

### 2.2 Diagrama atual

```text
┌──────────────────────────── Windows 11 ─────────────────────────────┐
│  Lia.exe  (Electron 43.4.1 · Chromium 150.0.7871.224 · Node 24.18.1) │
│   ├─ main  — config canônica, vault, voz, 26 canais IPC, supervisor │
│   ├─ preload — contextIsolation, superfície tipada mínima           │
│   └─ renderer (Vue 3 + Vite) — Home · IA & Recursos · Voz · Diag.   │
│             │ spawn (processo filho, não iframe)                    │
│             ▼                                                       │
│  LiaStage.exe  (SEGUNDO runtime Electron/Chromium/Node)             │
│   ├─ main — janelas, tela, atalhos, energia, protocolo, sessão      │
│   └─ renderer — Three.js/VRM + Live2D/Pixi + áudio + chat           │
└─────────────────────────────────────────────────────────────────────┘
        │ HTTPS (Main do Stage)                │ spawn
        ▼                                      ▼
   provider de IA (Groq…)              runtime de voz (Kokoro) e
                                       serviços auxiliares
```

**Fatos estruturais que importam para a decisão:**

1. O Core **já é independente de runtime**: `@lia/core` não importa Electron e
   `@lia/contracts` não tem dependência alguma. A lógica de produto não está presa ao Electron.
2. O Launcher **já é um supervisor**: o Stage é um processo separado, com sinal de pronto,
   teardown ordenado e teste de ausência de órfãos (PROMPT-40: PASS).
3. O Stage é a parte pesada e a única realmente acoplada: 74 arquivos chamam APIs Electron,
   incluindo transparência, clique atravessável (`setIgnoreMouseEvents`), tela, atalhos,
   energia e protocolo.
4. **O produto empacotado carrega dois runtimes Electron.** O `electron-builder` do Launcher
   copia `stage-tamagotchi/dist/lia-windows/win-unpacked` como `resources/stage` e o host
   executa `LiaStage.exe`, validando `resources/app.asar` e `icudtl.dat` — arquivos de um app
   Electron completo. Isso é o custo arquitetural mensurável mais concreto de hoje, e **não
   é intrínseco ao Electron**: é uma escolha de empacotamento.

---

## 3. O que o runtime precisa entregar (derivado do produto)

| Requisito | Evidência no código/produto |
|---|---|
| Janela transparente, sem moldura, always-on-top, com clique atravessável por pixel | `windows/desktop-overlay/window-contract.ts` (`transparent`, `frame:false`, `setIgnoreMouseEvents`) e `caption` |
| Avatar 2D/3D acelerado (Live2D/Pixi, VRM/Three.js) | `stage-ui-live2d`, `stage-ui-three`, `three`, `@tresjs` |
| Áudio: captura, reprodução, dispositivos, barge-in, STT/TTS | módulos de voz do Stage + runtime Kokoro gerenciado |
| Várias janelas (chat, configurações, legenda, overlay, spotlight, widgets) | 16 famílias em `src/main/windows` |
| Multimonitor/DPI, tray, atalhos globais, eventos de energia | `screen` 106, `globalShortcut` 22, `powerMonitor` 10, `Tray` |
| Supervisão de processos, single-instance, shutdown sem órfãos | `single-instance.ts`, `shutdown-coordinator.ts`, `airi-stage-manager.ts` |
| IPC tipado e isolado; segredo nunca no renderer | preload minimalista, vault no Main, `contextIsolation: true` |
| Instalador/atualização, assinatura | `electron-builder` (NSIS), `electron-updater` no ecossistema |
| Rodar em Windows 11 / Ryzen 5 5500 / 16 GB / RX 580 2048SP sem CUDA ou ROCm | Exigência do produto; o avatar usa D3D11/ANGLE via Chromium |

---

## 4. Alternativas avaliadas

Todas as afirmações abaixo são **documentais** e citadas em §9. Nenhuma alternativa foi
executada neste ambiente; nenhuma recebe nota. Onde não há dado, está escrito **não medido**.

### 4.1 Electron (atual)

- **Como funciona:** Chromium + Node empacotados; processo main (Node) + renderer por janela
  + processos GPU/utility; preload com privilégio intermediário. Versão atual do projeto:
  **43.4.1**, que corresponde a **Chromium 150.0.7871.224, Node 24.18.1, V8 15.0.245.28**
  (release de 18/08/2026). O npm registra **45.3.1** como latest em 12/11/2026.
- **Política de suporte:** as **3 últimas majors**, cadência de **8 semanas**; versões saem
  de suporte em ~6 meses. O projeto está na mais antiga das três suportadas hoje — a próxima
  major (46) empurra a 43 para fora. Isso é um custo de manutenção real e recorrente.
- **Pontos fortes para a Lia:** entrega todos os requisitos da §3 hoje, com
  comportamento idêntico entre máquinas; transparência/clique atravessável validados no
  Windows real; WebGL/D3D11 funciona na RX 580 (provado por PROMPT-37/38/40); ecossistema de
  build/instalação já integrado.
- **Custo:** dois runtimes Electron no pacote (ver §2.2); instalador e memória maiores;
  atualização de segurança obrigatória a cada ~8 semanas; `sandbox: false` nas janelas do
  Launcher e do Stage (endurecimento pendente).

### 4.2 Tauri 2

- **Como funciona (fonte oficial):** processo *core* em Rust com acesso total ao SO; uma ou
  mais *WebView processes*; no Windows usa **WebView2** (Edge/Chromium), que **não é
  empacotado** com o app — vem do sistema. O modelo de processos é explicitamente
  multi-processo "similar ao Electron".
- **Consequência para a Lia:** a UI Vue pode ser reaproveitada, mas **o avatar continua em
  Chromium** (WebView2), com o mesmo custo de WebGL/GPU; e o WebView2 mantém browser,
  renderer, GPU e processo de áudio próprios. O ganho plausível é não duplicar o Chromium e
  trocar o main Node por um main Rust — **não medido na Lia**.
- **Custo de migração:** reescrever em Rust os 26 canais IPC, diálogos, `screen`, `session`,
  atalhos, energia, tray, atualização e empacotamento; e **ou** portar o Stage (74 arquivos,
  25.345 LOC de main) **ou** manter o Stage em Electron — o que recria dois runtimes e
  anula parte do ganho.
- **Licença:** MIT/Apache-2.0 (projeto); WebView2 é componente separado do sistema.
- **Veredito:** único candidato com chance real de reduzir o *shell*; **não autorizado** sem
  protótipo comparável e sem antes eliminar a duplicação de runtime dentro do Electron.

### 4.3 Qt 6 / Qt Quick

- **Como funciona:** toolkit nativo C++/QML; renderização própria (RHI: D3D11/Vulkan/OpenGL),
  sem Chromium.
- **Licença (fonte oficial):** dupla — **LGPLv3/GPLv3** ou comercial. LGPLv3 exige link
  dinâmico, entrega do código da biblioteca, possibilidade de religar e aviso visível; há
  módulos só em GPL/comercial.
- **Custo para a Lia:** reescrever toda a UI (5 telas + Stage) em QML **e** reimplementar o
  avatar (Live2D Cubism Native SDK é outro produto, proprietário; VRM exigiria engine 3D).
  Não há caminho de reuso do renderer atual.
- **Veredito:** custo máximo, ganho não demonstrado, obrigação LGPL. Rejeitado nesta rodada.

### 4.4 Flutter Desktop

- **Como funciona (fonte oficial):** runner Win32 em C++ hospeda a engine; app em Dart;
  interop por `dart:ffi`. Desktop Windows está no canal estável; desde 3.47 o **Impeller é o
  renderer padrão também no desktop**, com alvo em Vulkan no Windows.
- **Custo para a Lia:** reescrever UI e avatar em Dart; não existe caminho direto para o
  stack Three.js/Live2D atual; e Vulkan na RX 580 (Polaris) não foi validado no produto.
- **Veredito:** mesma classe de custo do Qt, com menos maturidade de ecossistema para avatar.
  Rejeitado nesta rodada.

### 4.5 WinUI 3 / Windows App SDK

- **Como funciona (fonte oficial):** UI nativa Windows sobre Windows App SDK; mínimo Windows
  10 1809+; recomendado pela Microsoft para novos apps Windows.
- **Custo para a Lia:** reescrever UI e avatar, prender o produto ao Windows (o repositório
  mantém caminhos Linux/macOS no build do Stage) e assumir C#/C++/WinRT.
- **Veredito:** rejeitado para o produto inteiro; pode ser considerado no futuro apenas como
  **adaptador pontual** de integração Windows (tray, atalhos, DPI), não como runtime.

### 4.6 Arquitetura híbrida com runtime independente da interface

- **Como funciona:** Core com contratos versionados e sem dependência de UI; um ou mais
  *hosts* de desktop (Launcher e Presence) que implementam os contratos.
- **Estado atual:** **já é parcialmente verdade** — `@lia/core` e `@lia/contracts` são
  agnósticos; `lia/launcher` e `lia/stage` provam ciclo de vida headless com plataforma
  injetada; o protocolo `1.0.0` define envelope e negociação.
- **O que falta para ser híbrido de verdade:** o IPC real do produto ainda é
  `ipcMain`/`ipcRenderer`; não há contrato de transporte que permita trocar o host sem
  reescrever a ponte; e o Stage depende de APIs Electron diretamente.
- **Veredito:** é o desenho-alvo, implementável **incrementalmente** e sem migração ampla.

---

## 5. Comparação por critério

Legenda: **✔** atende hoje com evidência; **~** atende parcialmente / depende de trabalho;
**?** não medido; **✘** não atende sem reescrita.

| Critério | Electron (atual) | Tauri 2 | Qt 6 | Flutter | WinUI 3 | Híbrido (Core + hosts) |
|---|---|---|---|---|---|---|
| RAM em repouso | ~ 2,0–2,2 GiB no pacote de 08/11, incluindo 2 Electron + serviços; **não isolado** | ? (WebView2 tem browser+renderer+GPU+áudio) | ? | ? | ? | Depende do host; Core não adiciona |
| CPU em repouso | 8,49% médio / 11,56% pico (máquina inteira, 08/11) | ? | ? | ? | ? | Depende do host |
| Inicialização | +483 ms janela, +1311 ms renderer-ready (12/11) | ? | ? | ? | ? | Depende do host |
| Latência UI↔Core | IPC local em processo distinto; não medida | ? | ? | ? | ? | Contrato explícito; medível |
| GPU / AMD | D3D11/ANGLE; RX 580 funcionou nos testes reais; FPS **não medido** | WebView2, mesmo caminho Chromium | RHI próprio; não validado na RX 580 | Vulkan/Impeller; não validado na RX 580 | D3D nativo; reescrita | Igual ao host |
| Multimonitor | `screen` + presença multi-monitor já PASS no Windows | Reimplementar | Reimplementar | Reimplementar | Reimplementar | Contrato de presença |
| Áudio | Web Audio + dispositivos; validação física parcial | Reimplementar captura/rotas | Reimplementar | Reimplementar | Reimplementar | Host + serviço |
| Voz (STT/TTS/streaming) | Kokoro + serviços atuais funcionam | Portar ou sidecar | Portar | Portar | Portar | Serviço fora do host |
| Ferramentas locais | Main do Stage com permissões; tool calling **ainda não provado** | Comandos Rust + permissões | C++/QML | Dart FFI | C#/C++ | Core como autoridade |
| Segurança | `contextIsolation`, sem Node no renderer; `sandbox:false` (dívida) | Capacidades/permissões; sem Node no frontend | Nativo | Nativo | Nativo | Vault/Core no host confiável |
| Distribuição | NSIS pronto; **dois** Electron (~2× Chromium no disco) | Instalador pequeno; WebView2 do sistema | Dependências Qt | Engine própria | Windows-only | Depende |
| Portabilidade | Windows/Linux/macOS | Windows/Linux/macOS | Win/Linux/macOS | Win/macOS/Linux | **Windows** | Depende |
| Manutenção | Upgrade obrigatório a cada ~8 semanas; 2 stacks | Rust + ecossistema jovem | Toolkit maduro, licença | Engine + Dart | SDK Microsoft | Menor acoplamento |
| Liberdade (trocar UI/host) | Baixa hoje (IPC Electron) | Média | Baixa (reescrita) | Baixa (reescrita) | Baixa | **Alta** (é o objetivo) |
| Evolução | Fácil para o que já existe | Custo alto agora | Custo máximo | Custo máximo | Custo máximo | Incremental |

Não há coluna vencedora por pontuação. O que a tabela mostra é: **nenhuma alternativa tem
medição na Lia**, e as que evitam Chromium exigem reescrever o renderer e o avatar.

---

## 6. Medições disponíveis e o que continua NÃO EXECUTADO

### 6.1 Linha de base real (Windows, já registrada)

| Coleta | Condição | Working set | Private bytes | CPU (máquina) |
|---|---|---|---:|---:|
| 07/11 — dev | Stage em dev, CDP/DevTools, serviços e ferramentas | 4848,6 MiB médio / 5276,6 pico | 5058,8 / 5740,8 | 10,31% / 16,32% |
| 08/11 — pacote | Stage empacotado, chat/config abertos, CDP ativo, 12 processos | **1997,5 MiB** médio / 2031,9 pico | 2172,7 / 2456,2 | **8,49% / 11,56%** |

Limites declarados na própria coleta: não são o custo do avatar isolado; working sets somam
páginas compartilhadas mais de uma vez; os dois números **não são comparáveis entre si**
(build, serviços e janelas diferentes); GPU/FPS/energia/jogos nunca foram medidos.

Inicialização (Windows, 12/11): `start +95 ms`, `core.ready +152 ms`, `window-created
+483 ms`, `renderer-ready +1311 ms`. Encerramento sem órfãos: PASS.

### 6.2 O que esta rodada não mediu

| Medição exigida pela Etapa 0.4 | Status | Motivo |
|---|---|---|
| RAM do Launcher sem Stage | **NOT RUN** | Sem Electron/display no sandbox |
| RAM com Stage ativo / durante conversa / animação / voz | **NOT RUN** | Idem |
| CPU em repouso e nas mesmas atividades | **NOT RUN** | Idem |
| Tempo de inicialização e encerramento novos | **NOT RUN** | Reaproveitados os logs Windows existentes |
| Número de processos | Parcial (12 no pacote de 08/11) | Contagem estática |
| Tamanho da distribuição | **NOT RECORDED** | Não há artefato NSIS neste checkout |
| Comportamento ao fechar/reabrir conversas | **NOT RUN** | Exige interação real |

### 6.3 Protocolo para a medição no Windows (a executar)

Reutilizar o §7 do estudo de 07/11, sem inventar cenário novo: controles **C0–C4** com o
mesmo avatar, mesma resolução, mesmo áudio e serviços fixados; 60 s de aquecimento, janela
de 180 s, 5 repetições, ordem alternada; registrar commit, versão, driver, monitores/DPI,
plano de energia; private bytes e working set **por processo e por árvore**; GPU por engine
(D3D/ANGLE/DWM); FPS e frame time pelo PresentMon quando disponível; energia apenas se
houver contador. C0–C4 mede primeiro **uma** aplicação; a comparação de runtimes só vale
depois do experimento de runtime único (§8).

---

## 7. Custo de migração (estimativa por entregável, sem prazo inventado)

| Migração | Trabalho concreto | Reuso | Risco |
|---|---|---|---|
| Launcher → Tauri | 26 canais IPC, diálogo, `screen`, `session`, tray, atalhos, energia, single-instance, shutdown, updater, NSIS | Renderer Vue e Core | Médio; regressão de segurança/janela |
| Stage → Tauri | 74 arquivos com APIs Electron, 16 famílias de janelas, transparência/hit-test, protocolo, tela, energia | Renderer (Three/Live2D) | Alto; sem garantia de paridade |
| Stage → Qt/Flutter/WinUI | Reescrever 52k LOC de renderer + stack de avatar + UI | Nenhum significativo | Muito alto; perda de Live2D/Three |
| Core | Nenhum — já é agnóstico | 100% | Baixo |
| Contratos/vault/testes | Nenhum | 100% | Baixo |

Regra de preservação, se uma migração for autorizada no futuro: Core, contratos de provider,
vault, testes e evidências permanecem; Stage é preservado sempre que tecnicamente viável;
Launcher só é reconstruído se necessário; commits separados por componente; nenhuma
funcionalidade nova durante a migração; caminho de recuperação mantido até o novo runtime
passar nos gates.

---

## 8. Decisão

### 8.1 Cenário escolhido: **C — híbrido, com Electron retido (decisão provisória)**

**Decisão:** manter Electron como runtime de desktop do Launcher e do Stage nesta fase, e
tratar a separação Core ↔ hosts como a prioridade estrutural. Não migrar agora.

**Validade:** a decisão vale até a medição C0–C4 no Windows (§6.3). Ela não afirma que o
consumo atual é aceitável — afirma que **não existe evidência** de que outra opção seja
melhor, e que o único desperdício já identificado (dois runtimes Electron) é corrigível
dentro do próprio Electron. Se um limiar de §8.3 for violado na medição, o Cenário B é
reaberto com protótipo comparável.

**Por quê (demonstração, não preferência):**

1. **Nenhuma alternativa tem ganho comprovado na Lia.** Todas as medições disponíveis são do
   Electron; Tauri, Qt, Flutter, WinUI e Bevy estão **NOT RUN** como protótipo (§6). Trocar
   sem medir violaria a própria regra do plano ("ganhos relevantes e comprováveis").
2. **Tauri não remove o custo dominante.** No Windows, Tauri usa WebView2, que é Chromium e
   mantém browser, renderer, GPU e áudio. O avatar continuaria em WebGL. O ganho possível é
   de *shell*, não de renderer — e exigiria reescrever o Stage ou manter dois runtimes.
3. **Qt, Flutter e WinUI exigem reescrever o que funciona.** O renderer de 52k LOC e o stack
   Live2D/Three não têm caminho de reuso; o custo é máximo e o benefício é hipótese.
4. **O maior desperdício medido é interno ao Electron e corrigível.** O produto empacota
   **dois** runtimes Electron (`Lia.exe` + `LiaStage.exe`). Consolidar isso é uma
   otimização mensurável, reversível e de escopo menor do que qualquer migração.
5. **A fronteira que importa já existe e está provada.** O Core não importa Electron; os
   hosts de ciclo de vida rodam headless; o Stage é processo separado com teardown
   verificado. O que falta é **contrato de transporte**, não troca de tecnologia.

**Limites explícitos da decisão:**

- Electron **não** é declarado definitivo. A decisão é reavaliada quando um gatilho de §8.3
  for observado.
- Nenhuma migração é autorizada nesta rodada — nem parcial, nem "piloto silencioso".
- O Core **não** pode ganhar dependência de Electron, nem o renderer acesso a Node/segredo.
- Não se cria um segundo runtime concorrente sem necessidade; a consolidação de runtime é
  um experimento medido, não uma arquitetura paralela.

### 8.2 Fronteiras e responsabilidades (Cenário C)

**Arquitetura desejada** — o que muda em relação à atual é o **contrato de host**, não a
tecnologia:

```text
┌──────────────────── Lia Core (sem runtime de UI) ────────────────────┐
│  @lia/contracts  · protocolo 1.0.0 · lifecycle · ProviderDefinition  │
│  @lia/core       · config canônica · vault · voz · seleção           │
│  autoridade única: nenhum host escreve config/segredo por conta      │
└───────────────┬───────────────────────────────┬──────────────────────┘
                │ contrato de host (versionado) │
      ┌─────────▼─────────┐          ┌──────────▼──────────┐
      │ Desktop Host      │          │ Presence Host       │
      │ (Electron hoje)   │          │ (Electron/Chromium  │
      │ janelas, spawn,   │          │  hoje; renderer     │
      │ tray, atalhos,    │          │  substituível)      │
      │ energia, updater  │          │ Three/Live2D/áudio  │
      └─────────┬─────────┘          └──────────┬──────────┘
                │                               │
      ┌─────────▼─────────┐          ┌──────────▼──────────┐
      │ Shell / Launcher  │          │ Serviços (voz, IA)  │
      │ config, IA, voz,  │          │ processos próprios, │
      │ diagnóstico       │          │ supervisão do host  │
      └───────────────────┘          └─────────────────────┘
```

Regras da arquitetura desejada:

1. O contrato de host deve ser implementável por Electron **ou** por outro runtime sem
   tocar no Core. Hoje o transporte real ainda é `ipcMain`/`ipcRenderer`; torná-lo
   transport-neutral é trabalho da Etapa 1.
2. Cada host declara capacidades (`windows`, `tray`, `audio`, `screen`, `power`, `tools`) e
   o Core não pergunta "qual runtime?" — pergunta "qual capacidade?".
3. O avatar é um renderer atrás do contrato de presença; trocar a engine de render não
   muda a configuração nem o vault.
4. Um único dono por processo: nenhum serviço é iniciado duas vezes por hosts distintos.

Regras:

1. **Core é a autoridade única** de configuração, seleção de provider e credenciais.
2. O **host** implementa plataforma (janelas, spawn, SO); não contém regra de produto.
3. O **renderer** recebe apenas dados não secretos e resultados tipados.
4. O **Stage** não escolhe provider nem lê vault; consome a seleção canônica.
5. O contrato de transporte (hoje IPC Electron) deve poder ser implementado por outro host
   sem tocar no Core — é o trabalho estrutural da Etapa 1.

### 8.3 Gatilhos objetivos para reabrir a decisão

Fixar antes de medir, para não escolher a régua depois do resultado. Valores são **propostas
a aprovar** antes de C0–C4:

| Gatilho | Limiar proposto | O que fazer |
|---|---|---|
| Memória | private bytes somados de Launcher+Stage > **1.500 MiB** em C1 (repouso, sem conversa/voz), após o experimento de runtime único | Autorizar protótipo de shell Tauri |
| Renderer | avatar parado ou animado < **30 FPS** no alvo 240×360 na RX 580, ou falha de transparência/device-lost reproduzível | Autorizar protótipo de renderer (Godot/Bevy) |
| Inicialização | `renderer-ready` > **3.000 ms** frio em máquina limpa, ou > **4.500 ms** com Stage | Otimização obrigatória; migração só se comprovada |
| Distribuição | instalador > **300 MB** ou atualização > **2×** o orçamento definido | Reavaliar empacotamento/runtime |
| Manutenção | necessidade de upgrade de Electron mais de uma vez por ciclo de release | Reavaliar Tauri para o shell |
| Capacidade | requisito bloqueador impossível no Electron, demonstrado por protótipo | Migração pontual documentada |

Nenhum limiar foi medido. Nenhum está aprovado como meta de release.

---

## 9. Plano de execução (Etapa 1 e além)

**Etapa 1 — estabilizar a arquitetura escolhida (executável agora, sem Windows):**

1. Congelar as fronteiras com testes: Core sem Electron; renderer sem Node/Electron; Main do
   Launcher com superfície Electron limitada aos dois arquivos de host. *(feito nesta rodada:
   `runtime-boundary.test.ts`)*
2. Registrar o contrato de transporte como alvo (protocolo já existe; falta o adaptador).
3. Inventariar dependências a isolar (SEC-1: `sandbox:false`; SEC-2: protocolo/atalhos).
4. Validar ciclo de vida offline (já coberto por `lia/core` + `lia/launcher` + `lia/stage`).

**Etapa 1b — experimento de runtime único (Windows, medido):**

- Protótipo: hospedar o renderer do Stage numa janela do próprio processo Electron do
  Launcher, mantendo o Stage Main como módulo do host ou como processo Node (não Electron).
- Medir antes/depois: private bytes por árvore, processos, `renderer-ready`, FPS, teardown.
- Critério de sucesso: redução ≥ **25%** do custo do Stage no repouso, sem regressão de
  funcionalidade, inicialização > 10% pior, ou órfãos. Se não passar, manter dois runtimes e
  registrar o resultado.

**Etapa 2 (depois do gate Windows):** retomar AI Settings — bloqueado por PROMPT-40, não por
arquitetura. O plano end-to-end está em
[`LIA-AI-SETTINGS-END-TO-END-PLAN.md`](../project/LIA-AI-SETTINGS-END-TO-END-PLAN.md).

**Migração (somente se um gatilho de §8.3 disparar):** protótipo isolado, mesmas cenas,
mesmos assets, licença verificada, sem funcionalidade nova, commits por componente, validação
Windows e caminho de recuperação. Não declarar vitória porque uma janela abriu.

---

## 10. Critérios de aceitação desta decisão

1. Documento publicado com decisão, evidências, limites e gatilhos. ✔ (este arquivo)
2. Core e contratos comprovadamente livres de Electron — teste automatizado. ✔
3. Renderer comprovadamente sem Node/Electron — teste automatizado. ✔
4. Superfície Electron do Launcher limitada aos arquivos de host — teste automatizado. ✔
5. Nenhuma funcionalidade nova, nenhum credencial, nenhum provider alterado nesta rodada. ✔
6. Medição C0–C4 no Windows com metodologia fixada — **NOT RUN** (bloqueio de ambiente).
7. Experimento de runtime único — **NOT RUN** (depende de 6).

---

## 11. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Electron 43 sair de suporte na próxima major | Plano de upgrade para 45.x com regressão Windows; não bloquear por isso agora |
| `sandbox:false` nas janelas | Endurecer com teste e validação de preload no Windows (SEC-1) |
| Dois runtimes mascararem o custo real | Experimento §9 com medição por árvore de processos |
| Migração futura motivada por moda | Gatilhos objetivos e medição antes de qualquer protótipo |
| Perda de trabalho na migração | Core/contratos/vault/testes intocados; commits por componente |
| Números de fontes diferentes serem comparados | Toda medição registra build, driver, monitores e condições |

---

## 12. O que esta decisão não autoriza

- Cadastrar credenciais ou ampliar providers (regra de continuidade do plano mestre).
- Migrar para Tauri/Qt/Flutter/WinUI sem protótipo e medição nos termos de §8.3.
- Substituir o Stage por outra engine nesta fase.
- Declarar o produto concluído: os gates de AI Settings, tool calling, histórico, visual,
  segurança e distribuição continuam **BLOCKED/NOT RUN** no Windows.

---

## 13. Fontes primárias consultadas

- Electron 43.4.1 — versões de Chromium/Node/V8: <https://releases.electronjs.org/release/v43.4.1>
- Electron — cadência de 8 semanas e suporte às 3 últimas majors:
  <https://www.electronjs.org/docs/latest/tutorial/electron-timelines>
- Electron — modelo de processos (main/renderer/preload):
  <https://www.electronjs.org/docs/latest/tutorial/process-model>
- Tauri 2 — modelo de processos e WebView do sistema:
  <https://v2.tauri.app/concept/process-model/>
- Tauri 2 — WebView2 no Windows (Chromium, não empacotado):
  <https://v2.tauri.app/reference/webview-versions/>
- WebView2 — processo browser, renderers, GPU e áudio:
  <https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-model>
- Qt — obrigações LGPLv3/GPLv3 e licença comercial:
  <https://www.qt.io/development/open-source-lgpl-obligations>
- Flutter — Windows desktop, runner Win32, FFI:
  <https://docs.flutter.dev/platform-integration/windows/building>
- Flutter — Impeller padrão no desktop (3.47):
  <https://flutter.dev/blog/whats-new-in-flutter-3-47>
- Windows App SDK/WinUI 3 — mínimo Windows 10 1809 e recomendação:
  <https://learn.microsoft.com/en-us/windows/apps/get-started/windows-developer-faq>

Versões npm no momento da consulta: `electron` 45.3.1 (latest), `@tauri-apps/cli` 2.12.4.

---

## 14. Resumo para o próximo agente

- **Decisão:** híbrido com Electron; Core agnóstico; sem migração.
- **Maior ganho identificado:** eliminar o **segundo runtime Electron** (`LiaStage.exe`) —
  medir antes/depois no Windows.
- **Bloqueio atual:** nenhuma validação de runtime é possível no sandbox; AI Settings segue
  bloqueado por PROMPT-40 (falta interação humana + chave válida digitada na UI).
- **Não repetir:** pesquisa de engines (já feita em 07/11 e referenciada aqui), PROMPT-39
  (implementado) e PROMPT-40 (já registrado como BLOCKED).
