# M1 Phase 2 — Investigação QA: Tamanho da janela / Home ↔ Stage

> **M1 Phase 2 · Novo achado QA → investigação (sem alteração de código)**
> Data: 07/09/2026 · Branch: `arena/01a07b6d-lia-project` · Commit validado: `ec0caee`
> **Status:** investigação concluída. **NÃO implementar.** Aguardar aprovação da solução proposta.

---

## Contexto do blocker

A Home (launcher, `/home`) e o Stage (experiência da personagem, `/`) rodam na **mesma janela**
Electron (main window). A Home foi projetada como um launcher pequeno; o Stage, como uma cena
imersiva que **preenche** a janela (canvas/responsivo). Durante a validação, para ler os logs a Home
teve a janela ampliada manualmente; ao clicar **CONVERSAR**, o Stage abriu na mesma janela já
ampliada → sobra espaço/aparência inadequada. Necessidades de composição diferentes exigem tratar
como problema de **experiência da janela**, não só CSS.

Escopo desta rodada (respeitado):
- Investigar no código real (tamanho/default/min-max/bounds/resize/setSize/setBounds/lifecycle,
  navegação `/home` ↔ `/`, layout do Stage, comportamento responsivo, mecanismos AIRI de resize).
- **Não** criar segunda janela p/ o Stage (manter Home→main window e Stage→main window).
- **Não** alterar: Stage renderer, câmera, VRM, Live2D, avatar positioning, runtime AIRI.
- **Não** escalar a personagem antes de entender o gerenciamento da janela.
- **NÃO implementar solução.** PARE após a investigação.

---

## 1. Onde o tamanho da main window é definido

`airi/apps/stage-tamagotchi/src/main/windows/main/index.ts` (na criação do `BrowserWindow`):

```ts
width:  mainWindowConfig?.width  ?? 450,
height: mainWindowConfig?.height ?? 600,
x:      mainWindowConfig?.x,
y:      mainWindowConfig?.y,
```

- **Default:** `450×600` (o template `stage-tamagotchi` é uma janela companheira pequena).
- **Min/max:** o main window **não** define `minWidth/minHeight/maxWidth/maxHeight` e **não**
  passa `resizable` (default `true`) → **livremente redimensionável**, inclusive para tamanhos
  inutilizavelmente pequenos (o caminho manual aplica um piso de 100×200, ver §2).
- **Bounds persistidos/restaurados:** `createConfig('app', 'config.json', appConfigSchema, { default:
  { windows: [] } })`. Na criação lê `windows[]` com `title:'AIRI' && tag:'main'`; e `window.on('resize'/'move')`
  → `handleNewBounds` grava x/y/width/height no config. Ou seja, **a janela reabre no último tamanho
  do usuário** (é isso que faz o tamanho ampliado vazar da Home para o Stage).
- `transparentWindowConfig()` (`src/main/windows/shared/window.ts`) aplica `frame:false` (+
  `transparent:true`, `hasShadow:false`); é **frameless** → sem bordas nativas (resize via handles
  próprios, §2). Sempre-no-topo (`setWindowAlwaysOnTop`), fecha→esconde (`close` → `hide()`).

## 2. Onde o AIRI controla resize / bounds

### Camada principal (processo principal)
- `src/main/services/electron/window.ts` → `createWindowService({ context, window })` registra
  invokes **para a main window**:
  - `electron.window.getBounds` → `window.getBounds()`
  - `electron.window.setBounds` → `window.setBounds(newBounds[0])`  ← **resize absoluto disponível**
  - `electron.window.resize` → `resizeWindowByDelta({ deltaX, deltaY, direction })`
  - `setAlwaysOnTop`, `setIgnoreMouseEvents`, `setVibrancy`, `setBackgroundMaterial`, `close`
  - além de um loop `bounds` (estado reativo de bounds no renderer) e `electronGetWindowLifecycleState`.
- Esse serviço é ligado à main window por `src/main/windows/main/rpc/index.electron.ts` →
  `setupBaseWindowElectronInvokes` (`src/main/windows/shared/window.ts`).
- `resizeWindowByDelta` (`src/main/windows/shared/window.ts`): redimensiona por delta com piso
  default `minWidth=100 / minHeight=200` (params opcionais `minWidth/minHeight`).

### Helpers de geometria (processo principal)
- `src/main/windows/shared/display.ts` reúne utilidades maduras (usadas por outras janelas AIRI):
  `computeCenteredWindowBounds`, `centerWindowOnDisplay`, `currentDisplayBounds`,
  `computeResizedBoundsAnchoredToDominantDisplay`, `mapForBreakpoints`, `widthFrom`/`heightFrom`,
  `computeAdjacentPosition`, `findDominantDisplayArea` (em `shared/utils/electron/display`). São a
  base natural para **centralizar e ajustar a work area** ao aplicar um tamanho contextual.
- Referência de **min/max sólidos**: `src/main/windows/widgets/index.ts` faz clamp e chama
  `window.setMinimumSize/min/maximumSize`; `onboarding` (400×500 min) e `devtools`/`editor` também
  definem mínimos. O main window hoje **não** segue esse padrão.

### Camada do renderer (resize manual de janela frameless)
- `src/renderer/App.vue` renderiza `ResizeHandler.vue` (exceto janelas spotlight):
  `src/renderer/components/ResizeHandler.vue` põe **8 handles** fixos (n/s/e/w/ne/nw/se/sw) na borda;
  cada um chama `useElectronWindowResize().handleResizeStart($event, dir)`.
- `packages/electron-vueuse/src/composables/use-electron-window-resize.ts`: no `mousedown` de um
  handle (somente Windows), acompanha o mouse e invoca `electron.window.resize` (delta) →
  `resizeWindowByDelta`. Por isso o usuário **consegue** ampliar/encolher a janela livremente.
- `packages/electron-vueuse/src/composables/use-electron-window-bounds.ts`: assina `bounds` e
  expõe `{x,y,width,height}` reativos (`useElectronWindowBounds()`).

**Conclusão mecânica:** o AIRI já possui **IPC/eventa de resize** (`electron.window.setBounds`) e
**uma infra de geometria/centralização** no main. **Nenhum código hoje altera o tamanho da janela de
acordo com a rota** — o resize atual é só manual (handles) + persistência.

## 3. Como `/home` e `/` são renderizados

- A main window carrega **um único renderer** com `createWebHashHistory` + rotas automáticas +
  layouts: `src/renderer/main.ts` → `createRouter({ history: createWebHashHistory(), routes:
  setupLayouts(routes) })`, com `<RouterView/>` em `App.vue`.
- Landing inicial = **`/home`**: `src/main/windows/main/index.ts` →
  `load(window, withHashRoute(baseUrl(...), '/home', { query: { 'synced-leader': 'true' } }))`.
- **Home** = `src/renderer/pages/home.vue` (rota `/home`); **Stage** = `src/renderer/pages/index.vue`
  (rota `/`), que monta o `WidgetStage` (Tres/Three canvas) + `ControlsIsland` +
  `ResourceStatusIsland`, **todo `h-full w-full` e responsivo** (preenche a janela; composição da cena
  vive no canvas do `WidgetStage`).
- **Navegação:** a Home faz `router.push('/')` (`goConversar` em `home.vue`). Como é a **mesma
  janela/webContents**, ao ir para o Stage a janela **mantém as dimensões atuais** (as que o usuário
  deixou ampliadas) → origem do sintoma de "espaço vazio" no Stage e do tamanho inadequado.

## 4. É possível resize contextual?

**Sim, mecanicamente.** Caminhos existentes (já disponíveis na main window):

- **Renderer → main:** `useElectronEventaInvoke(electron.window.setBounds)([bounds, animate])` com
  `bounds` absoluto em coordenadas lógicas (DIP). O handler `createWindowService` já aceita e aplica.
- **Renderer:** `useElectronWindowBounds()` fornece o estado atual; `electron.screen.getAllDisplays`
  (via `useElectronAllDisplays`) dá as `workArea`s por display no renderer.
- **Main:** `screen.getDisplayMatching/getDisplayNearestPoint` + `computeCenteredWindowBounds` /
  `computeResizedBoundsAnchoredToDominantDisplay` já existem para centralizar e clampar à work area.

O que **não** existe é qualquer gatilho/mapeamento que reaja à rota (`/home` vs `/`) e aplique um
tamanho. Fica a cargo da solução.

## 5. Solução de menor risco (proposta — NÃO implementada)

**Abordagem:** resize contextual **por rota**, executado no **processo principal** (fonte única de
verdade da geometria, acesso a `screen.workArea`, reuso dos helpers já existentes), disparado quando
o renderer navega entre os dois "modos" de janela. **Sem** tocar no renderer do Stage/câmera/avatar,
**sem** criar segunda janela, **sem** mexer no CSS já aprovado da Home (#2).

1. **Presets por modo** (pequenos, direcionais — números a validar nas resoluções/DPI do QA):
   - Modo **launcher/Home**: tamanho de launcher (ex. ~450–520 de largura × ~600–680 de altura),
     suficiente para o conteúdo da Home (incluindo painel de logs rolável) **sem** exigir janela
     anormalmente grande.
   - Modo **Stage**: preset maior (ex. ~ 60–70% da `workArea`, ou uma faixa explícita a validar),
     centralizado; nunca maior que a `workArea` do display dominante (1280×720/1366×768/1920×1080 +
     DPI — coordenadas DIP, clamp pela work area resolve).
2. **Aplicação com `setBounds`** + **centralização** (reusar `computeCenteredWindowBounds`/
   `centerWindowOnDisplay` ou novo helper de clamp). "Suave/previsível": usar `setBounds(bounds)`
   determinístico e instantâneo (Windows não anima nativamente; o arg `animate` é macOS). Preferir
   resize direto e consistente a transições que pareçam "quebradas".
3. **Min/max na janela** (`src/main/windows/main/index.ts`): definir `minWidth/minHeight` (ex.
   maiores que o piso 100×200 atual) e, se desejado, max razoável → o resize manual do usuário nunca
   deixa a janela inutilizável (padrão já usado em `widgets`/`onboarding`).
4. **Disparo:** um mapeador central rota→modo. Recomendado: no renderer da main window, `watch(route)`
   (em `App.vue` ou um composable `useWindowMode`) detectando `/home` vs `/` (Stage) e invocando um
   novo eventa `electronSetMainWindowContext('home' | 'stage')`; o main aplica o preset + clamp.
   Alternativa mínima: chamar diretamente de `home.vue` (`goConversar`) antes do `push('/')`.
   Nota: hoje **não há botão "voltar à Home" no Stage** (nenhum `push('/home')` encontrado) — a
   "volta" ideal ainda precisa de um affordance no Stage (decisão de produto, fora desta correção de
   janela).

**Por que menor risco:** reusa IPC/helpers existentes, só adiciona um mapeamento de rota no main
window e presets; confinado a `main/windows/main` + um ponto no renderer; não mexe na cena/avatar.

## 6. Arquivos que seriam alterados (proposta — NÃO implementado)

- `src/shared/eventa/index.ts` — novo eventa/invoke p/ o modo de janela (ex. `electronSetMainWindowContext`).
- `src/main/windows/main/index.ts` — presets por modo + handler de resize/centralização; **opcional**
  `minWidth/minHeight` (e clamp) no `BrowserWindow`.
- `src/main/windows/main/rpc/index.electron.ts` — registrar o novo invoke (ou registrar inline no index).
- `src/main/windows/shared/display.ts` — (reuso, sem mudança obrigatória) `computeCenteredWindowBounds`
  / helpers de work area.
- `src/renderer/App.vue` (ou um `src/renderer/composables/use-window-mode.ts` novo) — `watch(route)`
  mapeando `/home` vs `/` e invocando o eventa.
- *(alternativa mínima)* só `src/renderer/pages/home.vue` + `src/renderer/pages/index.vue` chamariam o
  invoke nos pontos de navegação, sem centralizar.
- **Não** alterar: `pages/index.vue` internals do Stage, `WidgetStage`/Three/VRM/Live2D, `home.vue`
  layout (#2 já aprovado), runtime AIRI.

> Números finais dos presets devem ser decididos/aprovados e validados nas 3 resoluções do QA
> (1280×720, 1366×768, 1920×1080) + DPI/scaling + janela pequena, na máquina real. Aqui permanece
> apenas a proposta de mecanismo.

---

## Registro de decisão

- **Não** criar segunda janela para o Stage.
- **Não** alterar Stage renderer/câmera/VRM/Live2D/avatar para resolver isto.
- **Não** escalar a personagem antes do entendimento da janela (agora concluído).
- **Não** desfazer o ajuste do log panel (#2 aprovado).
- **NÃO implementar** resize contextual ainda. PARE e aguardar aprovação desta proposta.

*Fim da investigação — proposta pronta para revisão/aprovação.*
