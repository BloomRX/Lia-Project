# INVESTIGAÇÃO — Controle de posição/câmera do personagem no Stage (p/ compor a Home Lia)

> **M1 Phase 2 · investigação pré-implementação** · Data: 07/09/2026 · Branch: `arena/01a07b6d-lia-project`
> **Escopo:** descobrir, no código real do AIRI, quais controles de apresentação da personagem
> podemos **reutilizar** para uma composição visual da Lia — **sem** criar sistema de câmera/
> posicionamento e **sem** alterar valores do AIRI. Nenhum código foi alterado.
> **Fontes:** inspeção direta de `airi/packages/stage-ui-three`, `stage-ui-live2d`, `stage-ui`.

---

## Respostas diretas

### 1. Onde o AIRI controla a posição do personagem?
- **3D/VRM:** `packages/stage-ui-three/src/stores/view-control.ts` — `modelOffset {x,y,z}` (em
  metros, offset do grupo do modelo à origem da cena) e `modelRotationY` (graus). São aplicados em
  `components/Model/VRMModel.vue` (`watch(modelOffset)` → `vrmGroup.position.set(...)`;
  `watch(modelRotationY)` → `vrmGroup.rotation.y`).
- **Live2D:** `packages/stage-ui-live2d/src/stores/view-control.ts` — `position {x,y}` (em % do
  canvas, relativo ao centro) e `scale` (fator). Aplicados em
  `stage-ui-live2d/src/components/scenes/live2d/Model.vue` (position em px + scale no modelo Pixi).

### 2. Onde controla a câmera?
- **3D/VRM:** `packages/stage-ui-three/src/stores/camera.ts` — `cameraFOV` (graus), `cameraDistance`
  (metros, eixo da câmera ao modelo) e `cameraPosition` (interno). No **primeiro carregamento** há um
  **auto-framing** em `VRMModel.vue → buildSceneBootstrap()` que computa `modelSize/modelCenter`,
  `eyeHeight`, `cameraDistance` e `cameraPosition` a partir do bounding box do VRM + FOV. `OrbitControls`
  e `ThreeScene.vue` consomem esses valores.
- **Live2D:** não há câmera 3D — o "enquadramento" é posição+escala do modelo no canvas (ver #1).
- **Godot** (`settings/model-settings/godot.vue`): gerencia `camera.position/yaw/pitch/fov` próprios.

### 3. Funciona para VRM?
Sim. O `VRMModel.vue` aplica `modelOffset`/`modelRotationY` e consome `cameraFOV/cameraDistance`/
`cameraPosition`; `view-control.ts`/`camera.ts` são os provedores. Há auto-framing inicial por modelo.

### 4. Funciona para Live2D?
Sim, porém por outro mecanismo: `stage-ui-live2d` usa `position` (%) + `scale` (fator), não câmera 3D.
É o mecanismo usado pelo **preset padrão do stage** (`preset-live2d-1` = `settings/stage/model`).

### 5. Quais configurações são persistentes?
Todas via **`useLocalStorage`** (`@vueuse/core`), chaves `settings/stage-ui-three/*` e
`settings/live2d/*`, **globais (não por modelo)**:
- 3D/VRM: `modelOffset`, `modelRotationY`, `cameraFOV`, `cameraDistance`, `cameraPosition`,
  `lookAtTarget`, `eyeHeight`, `modelOrigin`, `modelSize`, luzes/cena/env (direcional, hemi, ambient,
  skybox), `renderScale`, `multisampling`.
- Live2D: `position`, `scale`.
- Seleção do modelo em si: `settings/stage/model` (persistida + synced entre janelas) via
  `stage-ui/src/stores/settings/stage-model.ts`; biblioteca em `display-models.ts`.

> Não existe hoje um conceito de **"preset nomeado de câmera/enquadramento"** persistido por perfil —
> são valores únicos globais no localStorage. Também **não** são por personagem/card.

### 6. Podemos criar um "preset visual da Lia" sem alterar o runtime?
**Possível, e o menor caminho NÃO exige tocar no runtime**, com duas opções de escopo:
- **(a) Reusar o próprio stage** (recomendado para o fluxo de conversa): o preset visual = **só**
  definir valores iniciais dos stores existentes (`modelOffset`, `modelRotationY`, `cameraFOV`,
  `cameraDistance`, ou Live2D `position`/`scale`) ao entrar no stage — ex.: setar o store
  `useThreeViewControl().set(...)` / `useL2dViewControl().set(...)` OU aplicar um vetor de valores ao
  montar. O runtime já lê esses refs e aplica (nada a reescrever).
- **(b) Preview leve na Home**: **não** inicializar 2º runtime VRM/Live2D. Reutilizar o **asset de
  preview estático** que o próprio AIRI já mantém por modelo (`display-models.ts` → `previewImage`;
  `stage-ui/src/assets/{live2d, vrm}/…/preview.png`), ou o ícone/asset da Lia. Isto é um **launcher**:
  clicar → Stage real (runtime único).

### 7. Qual é o menor ponto de extensão?
- **Para o stage (conversa):** os **stores de view-control já exportados**
  (`useThreeViewControl`/`useThreeCamera` para VRM; `useL2dViewControl` para Live2D) + o local onde o
  stage escolhe o modelo (`useSettingsStageModel`). Um "visual Lia" entra **configurando esses refs**
  (defaults/vetor aplicado no momento da entrada) — sem novo sistema.
- **Para a Home (preview):** consumir **`previewImage`/asset estático** (como o seletor de modelos já
  faz) — sem segundo renderer.

---

## Recomendação (p/ decisão antes de codar a Home)
1. **Home = launcher leve** com presença visual por **asset estático** (ícone/arte Lia, ou
   `previewImage` do modelo ativo). **Não** 2º runtime.
2. **CONVERSAR → Stage real** (`/` index.vue), que é o dono do avatar runtime.
3. **Identidade visual "Lia" no stage** = valores aplicados nos stores de view-control existentes
   (sem alterar defaults do AIRI; sobrescrever no momento de entrada), quando implementarmos o fluxo
   de conversa. Pode ser adiado; não bloqueia a Home.
4. Persistência própria do "look Lia" (se quisermos por perfil) caberia como **extensão** via os mesmos
   refs — a tratar em fase posterior, sem criar persistência duplicada agora.

## Arquivos-chave (referência)
- `stage-ui-three/src/stores/{camera,view-control,model-store}.ts`
- `stage-ui-three/src/components/Model/VRMModel.vue` (aplica offset/rotação/câmera)
- `stage-ui-live2d/src/stores/view-control.ts`; `stage-ui-live2d/src/components/scenes/live2d/Model.vue`
- `stage-ui/src/stores/{display-models,settings/stage-model}.ts` (biblioteca/preview/seleção)
- `stage-ui/src/components/scenarios/settings/model-settings/{vrm,live2d,preview-stage}.vue` (UI de ajuste)
- `stage-ui/src/components/scenes/{Stage,ViewControlSlider}.vue` (componente de cena + sliders HUD)

*Fim da investigação.*
