# M1 Phase 2 — Validation / QA runbook (máquina real)

> **M1 Phase 2 · Lia Home / Launcher — gate de validação**
> Data: 07/09/2026 · Branch: `arena/01a07b6d-lia-project`
> **Objetivo:** confirmar que a Home funciona como launcher e que **não houve regressão** no Stage
> AIRI. Este gate **só pode ser executado na máquina real** (`J:\Lia-Project`) — o sandbox não tem
> `pnpm`/`node_modules`. Este documento é o runbook + planilha de resultado.

---

## 0. Estado do código a validar

- Branch `arena/01a07b6d-lia-project` (série de commits da Fase 2: `feat(lia): add launcher home`,
  `fix(M1-phase2): add draggable TitleBar + scrollable/theme-safe Home layout`,
  `fix(lia): add contextual window sizing`).
- Mudanças da Fase 2 resumidas nos docs/commits (rota `/home` landing; CONVERSAR→Stage `/`;
  preview do modelo ativo + fallback Lia; status de apresentação; i18n pt-BR/en-US mínimo;
  TitleBar arrastável na Home; layout de logs rolável; **resize contextual Home↔Stage por rota**).
- **Baseline conhecido:** `pnpm typecheck` = 56/57 (1 falha isolada em
  `stage-ui-live2d .../live2d-zip-loader.test.ts`, já corrigida upstream `d8e62f12` — **não portar,
  não corrigir**).

---

## 1. Comandos

> Rodar em `J:\Lia-Project` (diretório com o monorepo `airi/`).

```bash
# 1. instalar (se preciso) e validar ferramenta
pnpm install

# 2. typecheck
pnpm typecheck

# 3. testes
pnpm test

# 4. build web
pnpm build:web

# 5. desktop dev
pnpm dev:tamagotchi
```

**Interpretação de falha nova:** se algo falhar além do baseline conhecido, classificar a origem em:
(a) baseline AIRI · (b) patch de identidade (Fase 1) · (c) Home (Fase 2) · (d) i18n (Fase 2). **Não
corrigir automaticamente** — registrar o problema e informar antes de mexer.

---

## 2. Checklist funcional — Home

- [ ] Home é a landing inicial ao abrir o app.
- [ ] Identidade "Lia" aparece.
- [ ] Presença/avatar preview aparece (ver §4).
- [ ] Greeting funciona (pt-BR e en-US).
- [ ] Status (Tudo pronto / Preparando / Indisponível) funciona.
- [ ] Botão **CONVERSAR** funciona e leva ao Stage.
- [ ] Atalho **Personagem** (→ Settings/models) funciona.
- [ ] Atalho **Configurações** (→ Settings) funciona.
- [ ] Atalho **Diagnósticos** (→ Settings/system/developer — stand-in até Phase 7) funciona.
- [ ] **Mostrar logs** expande/colapsa.
- [ ] Nenhum elemento da Home quebrado (console sem erros relevantes).

## 3. Checklist i18n

- [ ] UI = pt-BR → Home inteira em pt-BR (navigation/greeting/buttons/status/logs).
- [ ] UI = en-US → Home inteira em inglês.
- [ ] Nenhuma string técnica inesperada na Home.
- [ ] Demais locais do AIRI intactos (en/es/…) e Advanced pode seguir en-US.

## 4. Checklist Stage / Preview (teste mais importante)

- [ ] Ao abrir a Home, o runtime pesado do Stage **não** roda no fluxo visual da Home.
- [ ] **CONVERSAR** abre o Stage existente (`/`, index.vue) corretamente.
- [ ] No Stage: avatar · VRM/Live2D · áudio · controles · conversa funcionam.
- [ ] **Sem duplicação** de Stage/renderer e **sem** 2ª instância desnecessária.
- [ ] **Preview:** modelo com `previewImage` → usa preview; modelo sem → usa asset Lia; asset
      indisponível → placeholder. Nenhum caso quebra a Home.

## 5. Performance (observar/documentar, sem otimizar)

- [ ] Registrar: tempo de abertura da Home vs tempo do Stage.
- [ ] Registrar: memória/CPU aproximados da Home vs Stage (Task Manager/devtools).
- [ ] Registrar: processos adicionais que a Home NÃO dispara (vs Stage).
- [ ] Objetivo: Home significativamente mais leve que Stage.

## 6. Visual QA (screenshot)

- [ ] Screenshot da Home.
- [ ] Screenshot do Stage (após CONVERSAR).
- [ ] Verificar: layout/alinhação/espaçamento/legibilidade/botões/preview/status.
- [ ] Comportar em 1280x720 e 1920x1080 (+ DPI/scaling).
- [ ] Registrar problemas visuais (sem redesign nesta etapa).

## 7. Regressão

- [ ] Home → Conversar → Stage → voltar (nota: "voltar p/ Home" via reabrir/recarregar janela —
      affordance de retorno é Fase 3).
- [ ] Home → Settings → voltar.
- [ ] Home → Diagnostics → voltar.
- [ ] Home → Logs → fechar.
- [ ] AIRI continua funcional (sem regressão crítica).

---

## 8. Resultado a preencher (após rodar)

| Item | Resultado | Obs. |
|---|---|---|
| typecheck | | esperado 56/57 (baseline) |
| test | | |
| build:web | | |
| dev:tamagotchi | | |
| Home visual | | |
| i18n pt-BR/en-US | | |
| Stage abre via CONVERSAR | | |
| Preview/fallbacks | | |
| Performance Home vs Stage | | |
| Regressão | | |
| Problemas encontrados | | |

**Classificação final:** PHASE 2 PASS / PHASE 2 BLOCKED
(decidir por funcionamento + navegação + visual + i18n + Stage + ausência de regressão crítica —
não apenas por "compilou").

---

## 9. Contextual window sizing (QA blocker #4 — validação)

Mecânica implementada em `fix(lia): add contextual window sizing` (detalhes em
`M1-PHASE2-QA-WINDOW-SIZING.md` §7). Presets iniciais: Home `460×640`, Stage `800×1000`, min `360×480`
(DIP), clampados à work area do display ativo + centralização.

> Rodar em `J:\Lia-Project` com `pnpm dev:tamagotchi`.

**Casos a validar (screenshot de cada):**
- [ ] Home abre no tamanho launcher (460×640 ou override persistido), centralizado.
- [ ] Home→redimensionar→CONVERSAR→Stage aplica Stage bounds (sem espaço absurdo, personagem visível).
- [ ] Home→tamanho padrão→CONVERSAR→Stage aplica Stage bounds.
- [ ] Stage aproveita melhor a janela; nada cortado.
- [ ] Janela permanece dentro da tela (sem sair/negativos) ao trocar modo.
- [ ] **Persistência por modo:** redimensionar a Home (Home fica maior), ir p/ Stage (não herda o
      tamanho da Home); voltar p/ Home quando a Fase 3 conectar o retorno deve restaurar o tamanho da Home.
- [ ] Não há regressão: Home e Stage continuam arrastáveis/redimensionáveis; nada quebrado.

**Resoluções/DPI:** 1280×720 · 1366×768 · 1920×1080 · janela pequena · DPI/scaling.

| Item (window) | Resultado | Obs. |
|---|---|---|
| Preset Home na abertura | | |
| Home→Stage aplica Stage preset | | |
| Sem espaço absurdo no Stage | | |
| Personagem visível / nada cortado | | |
| Janela dentro da tela | | |
| Persistência por modo (sem contaminação) | | |
| Regressão (arraste/resize) | | |

> Ajustar presets se as screenshots mostrarem tamanho inadequado; **não** alterar Stage renderer/
> câmera/avatar para resolver. Retorno **Stage→Home** (restauração) será conectado na **Fase 3**.

*Fim do runbook.*
