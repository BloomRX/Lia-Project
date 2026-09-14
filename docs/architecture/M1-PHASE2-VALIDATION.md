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

---

## 10. Correções finais da QA (real machine)

Dois problemas corrigidos nesta rodada. Commits separados:
- `fix(lia): persist home window bounds`
- `fix(lia): connect home log viewer`

### 10.1 Home window persistence (cause → fix)

**Causa:** em `src/main/windows/main/index.ts`, o listener `window.on('resize', () =>
sizing.captureUserBounds())` era registrado imediatamente no arranque. A janela é criada no **preset
da Home** (`460×640`) e só depois `setContext('home')` aplica o override persistido. Como
`currentContext` já era `'home'`, um evento `resize` disparado durante o show/settle com a janela
ainda refletindo o preset de construção fazia `captureUserBounds()` **sobrescrever o override da Home
com 460×640**. O Stage nunca sofre isso porque só é redimensionado quando o usuário navega via
CONVERSAR — daí a assimetria (Stage persiste, Home não).

**Correção** (`window-sizing.ts` + `index.ts` + teste): só *resizes de usuário* são persistidos.
- `captureUserBounds()` ignora resize antes de **armado** e ignora o "rabo" (resize tail) de um
  `setContext` programático (compara com `programmaticTarget`).
- `index.ts` chama `sizing.armUserResizeCapture()` **em `ready-to-show`** (após `show()`), quando o
  arranque já aplicou o tamanho final; nenhum resize transitório de startup pode mais gravar.
- `window-sizing.test.ts` cobre: não persiste antes de armar; persiste resize de usuário da Home;
  separa por modo (Home nunca sobrescreve Stage e vice-versa); restaura override no `setContext`.

**Comportamento esperado:** 1ª execução Home 460×640; usuário redimensiona → Home tamanho customizado;
fechar/abrir → restaura. Stage preserva o dele. Presets **inalterados** (460×640 / 800×1000).

### 10.2 Log viewer vazio (cause → fix)

**Causa:** o painel de logs da Home mostrava um **placeholder estático de i18n** (`logs.empty`) — não
estava conectado a nenhuma fonte real. O AIRI gera logs no **processo principal** via `@guiiai/logg`
(`useLogg(scope)`) e os encaminha por um único hook global `setGlobalHookPostLog` → `FileLogger`
(em `src/main/app/file-logger.ts` e `src/main/index.ts`).

**Fonte de logs reutilizada** (nenhum logger novo, nenhum 2º sistema, sem ler arquivo/polling):
- `src/main/app/main-process-log-bus.ts` (novo, fino): consome o **mesmo** `setGlobalHookPostLog`;
  mantém um **ring buffer sanitizado** (200) e emite linhas novas p/ o renderer da main window.
  Sanitiza **antes** de armazenar/encaminhar: remove ANSI, mascara segredos/tokens comuns
  (`Bearer`/`Authorization`, `api[_-]?key`, `secret`, `client_secret`, `password`, `token`,
  `access/refresh_token`), **colapsa stack traces** (mantém erro + 1º frame, descarta o resto da
  run) e limita o tamanho da linha. Detalhe técnico cru permanece no viewer de diagnóstico/arquivo.
- `src/shared/eventa/index.ts`: `electronMainWindowLogEntry` (push) e `electronGetMainWindowLogs`
  (snapshot) + tipo `MainProcessLogLine`.
- `src/main/windows/main/rpc/index.electron.ts`: registra o invoke (snapshot) e liga o emitter →
  `context.emit` p/ a main window; limpa no `closed`.
- `src/renderer/pages/home.vue`: no mount busca o snapshot e assina o stream; `Mostrar logs` abre o
  painel com as linhas reais; scroll interno, `break-words`, novo log rola ao fim. i18n: adicionada a
  chave `logs.loading` (pt-BR/en).
- Teste `main-process-log-bus.test.ts`: sanitizer (ANSI, Bearer/Authorization, api_key/client_secret/
  password, trim, truncamento).

### 10.3 Testes / build / QA manual

Rodar na máquina real (`J:\Lia-Project`):
```bash
pnpm typecheck        # esperado 56/57 (baseline live2d-zip-loader) — separar BASELINE de LIA REGRESSIONS
pnpm build:web
pnpm dev:tamagotchi
```
Testes direcionados (stage-tamagotchi, Home, window sizing, i18n, logging/viewer): vitest dos
`window-sizing.test.ts`, `main-process-log-bus.test.ts` e testes i18n existentes.

QA manual — Window:
- [ ] 1ª Home abre 460×640 (sem override).
- [ ] Home: redimensionar → fechar → abrir → **tamanho customizado restaurado**.
- [ ] CONVERSAR → Stage 800×1000 (sem override).
- [ ] Stage: redimensionar → fechar → abrir (via CONVERSAR) → restaurado.
- [ ] **Home size ≠ Stage size** e persistências independentes (nenhum modo sobrescreve o outro).

QA manual — Logs:
- [ ] Home → `Mostrar logs` → logs reais aparecem (FileLogger/services/runtime/server-runtime).
- [ ] Gerar atividade → viewer atualiza (novo log aparece/rola ao fim).
- [ ] `Ocultar logs` fecha sem quebrar layout.
- [ ] Sem API keys/tokens/credenciais/stack traces completos no painel da Home.
- [ ] 1280×720 · 1366×768 · 1920×1080 · janela pequena.

**Classificação final:** PHASE 2 READY FOR FINAL APPROVAL
(somente quando ambos os problemas estiverem realmente resolvidos na máquina real).

*Fim do runbook.*
