# M1-IMPLEMENTATION-PLAN — Blueprint da implementação (M1 Part 2)

> **M1 · Lia Shell / Product Foundation · Plano de implementação concreto**
> **Data:** 07/09/2026 · **Branch:** `arena/01a07b6d-lia-project`
> **Decisões normativas:** `docs/architecture/LIA-INTEGRATION-PLAN.md` §6/§9 (aprovadas) ·
> **Escopo:** `docs/product/M1-SCOPE.md` · **UX:** `docs/product/UX.md`.
> **Estado:** documento de planejamento — **aguarda revisão/aprovação. Nenhum código ainda.**

---

## 0. Premissas que regem tudo

1. **Lia vive dentro de `airi/`**, nos workspaces existentes; `apps/stage-tamagotchi` é a **base
   direta** (transformação `stage-tamagotchi → reidentificado como Lia`).
2. **Nada de `apps/lia-shell`**, **nada de dezenas de `packages/lia-*`**, **nada de renomear
   diretórios** por estética.
3. Rebrand = **somente identidade** (`appId`, `productName`, ícones, metadados de distribuição,
   identifiers de branding). **Não** toca boot/lifecycle/DI/IPC/window architecture/runtime.
4. **Não** modificar core-agent/core-character/órgãos para a Home. **Não** duplicar chat/
   consciousness/speech/hearing/memory/vision/providers/avatar/MCP.
5. Não portar `d8e62f12`; não corrigir/refatorar o AIRI.
6. Logging: **investigar e reutilizar** o que o AIRI já tem antes de criar.

---

## 1. Árvore final (recorte relevante) — `[A]` intocado · `[M]` modificado · `[N]` novo (Lia)

```
airi/
├─ apps/stage-tamagotchi/                      # base direta da Lia (Electron)
│  ├─ electron-builder.config.ts               [M] appId/productName → Lia
│  ├─ ai.moeru.airi.metainfo.xml               [M] id/nome de distribuição Lia (nome do arquivo mantido p/ diff mínimo)
│  ├─ ai.moeru.airi.flatpak.yml                [M] app id Lia
│  ├─ resources/ (icon.png, icon-512.png, icon.svg, tray-icon-macos.png)  [M] assets → identidade Lia
│  ├─ build/ (icon.ico/.icns/.icon/.png)       [M] assets → identidade Lia
│  └─ src/
│     ├─ main/
│     │  ├─ index.ts                           [M] 1 registro aditivo: provider/module Lia (config/status)
│     │  ├─ configs/global.ts                  [A] NÃO tocar
│     │  ├─ services/lia/                      [N] config Lia (namespace 'lia'), agregação de status, acesso a log
│     │  │  └─ (config.ts · status.ts · log.ts · index.ts)
│     │  └─ windows/ …                         [A] exceto main/windows/main/index.ts [M] landing da Home (1 linha de rota)
│     ├─ preload/                              [A] (já expõe eventa via index.ts; contratos Lia vão por shared/eventa)
│     ├─ shared/eventa/lia/                    [N] contratos IPC Lia (status, config, log, abrir Home/Advanced)
│     └─ renderer/
│        ├─ main.ts · App.vue                  [A] (registro de i18n/router já cobre; sem mudança obrigatória)
│        ├─ pages/lia-home/ (index.vue …)      [N] HOME launcher (persona + status + ações)
│        ├─ pages/advanced/ (…/diagnostics)    [N] Advanced / Diagnostics (nível M1) + log colapsável
│        ├─ components/lia/ (…)                [N] kit de UI Lia (status chips, estado, progress, log panel)
│        ├─ stores/lia-status.ts               [N] mapeia estado dos órgãos → status amigável (apresentação)
│        └─ modules/i18n.ts                    [A] (já resolve locale via messages — pt-BR automático após registro)
├─ packages/i18n/src/
│  ├─ index.ts                                 [M] registrar pt-BR em all + localeRemap (pt-BR/pt/pt-PT)
│  └─ locales/
│     ├─ index.ts                              [M] registrar pt-BR
│     └─ pt-BR/                                [N] espelho parcial de en/ (base/settings/stage/tamagotchi/…) p/ primeira prioridade
├─ docs/
│  ├─ product/UX.md · M1-SCOPE.md              [M] refletem decisões
│  ├─ architecture/LIA-INTEGRATION-PLAN.md     [M] decisões resolvidas
│  ├─ architecture/M1-IMPLEMENTATION-PLAN.md   [N] este documento
│  └─ upstream/LIA-IDENTITY-PATCH.md           [N] registro do "Lia identity patch" (rebrand)
└─ (demais apps/, packages/, plugins/, server/, engines/, integrations/, services/)   [A] intocados
```

> O único estender de package previsto em M1 é **`packages/i18n` (pt-BR)**. Todo o restante da
> camada Lia fica **dentro de `apps/stage-tamagotchi`**, reusando os padrões que o AIRI já tem
> (pages/stores/shared/eventa/main services). Isto satisfaz a regra de criação de pacote.

---

## 2. Arquivos do AIRI que serão **modificados** (mínimo, aditivo)

Identidade (Fase 1 — "Lia identity patch", registrado em `docs/upstream/LIA-IDENTITY-PATCH.md`):
1. `apps/stage-tamagotchi/electron-builder.config.ts` — `appId`, `productName` (→ Lia); mantém
   mecanismo (NSIS/win/mac/linux, auto-update).
2. `apps/stage-tamagotchi/ai.moeru.airi.metainfo.xml` — id/name do produto (distribuição).
3. `apps/stage-tamagotchi/ai.moeru.airi.flatpak.yml` — app id Lia.
4. `apps/stage-tamagotchi/resources/*` e `apps/stage-tamagotchi/build/*` — ícones/asset de marca.
5. (possível) strings de título visível via i18n — ver Fase 4/8; janelas/tray/about lêem i18n/metadata
   (ex.: `packages/i18n/src/locales/en/tamagotchi/electron/tray.yaml`). Confirmar em Fase 1.

Integração aditiva (Fases 2–7) — edições **pequenas e aditivas** em arquivos já existentes:
6. `apps/stage-tamagotchi/src/main/index.ts` — 1 import + 1 chamada para registrar o provider/module
   Lia (config/status/log) no boot DI (sem alterar o fluxo existente).
7. `apps/stage-tamagotchi/src/main/windows/main/index.ts` — landing do main window → rota da Home
   (ou abrir Home como destino — ver §5 risco/decisão de montagem).
8. `packages/i18n/src/index.ts` + `packages/i18n/src/locales/index.ts` — registrar o locale `pt-BR`
   (Fase 4).

> Todos os demais arquivos do AIRI permanecem **intocados** (ver §4). Mudanças acima são rastreadas
> e documentadas para sobreviver a rebase upstream sem virar refactor.

---

## 3. Arquivos **novos** da Lia (que serão de fato criados)

> Dentro de `apps/stage-tamagotchi` (padrões AIRI) + `packages/i18n` (pt-BR).

- **Home / shell (Fase 2):**
  - `src/renderer/pages/lia-home/index.vue` (e `.ts`/componentes) — Home launcher.
  - `src/renderer/components/lia/` — `StatusChips.vue`, `StateBox.vue` (loading/success/error/empty/
    disabled/progress reutilizáveis, alinhados a `UX.md §5/§6`), `PrimaryActions.vue`, `HomeShell.vue`.
- **Navigation (Fase 3):**
  - `src/shared/eventa/lia/index.ts` — contratos IPC Lia (`liaOpenChat/Settings/Advanced/Logs`,
    `liaGetStatus`, `liaGetConfig/UpdateConfig`, `liaGetLogTail`, `liaShowLogs`).
  - Navegação por destino no renderer (Home como hub) reusando `vue-router` existente.
- **pt-BR i18n (Fase 4):**
  - `packages/i18n/src/locales/pt-BR/` — espelho parcial de `en/` priorizando Home/onboarding/
    settings/dialogs/errors/status/navigation; demais chaves caem no fallback `en`.
- **Lia config (Fase 5):**
  - `src/main/services/lia/config.ts` — `createConfig('lia', …)` com `schemaVersion` (só se preciso),
    persistência no namespace Lia; **não** mexe em `configs/global.ts`.
  - `src/shared/eventa/lia/` contratos de config.
- **Status (Fase 6):**
  - `src/main/services/lia/status.ts` — coleta estados de prontidão dos órgãos (consumindo stores/
    sinais AIRI) → payload amigável.
  - `src/renderer/stores/lia-status.ts` — Pinia que traduz para os chips de status da Home
    (apresentação; sem coleta de hardware — isso é M2).
- **Logs / friendly errors (Fase 7):**
  - `src/main/services/lia/log.ts` — leitura de cauda do log técnico existente (reuso do file-logger/
    `@guiiai/logg`); `src/renderer/components/lia/LogPanel.vue` (colapsável) +
    `FriendlyError.vue` (sem stack na Home; "Detalhes" abre o log).
- **Advanced / Diagnostics (Fase 2/7):**
  - `src/renderer/pages/advanced/index.vue` — painel Advanced (nível M1) + Diagnostics básico.
- **Docs:**
  - `docs/upstream/LIA-IDENTITY-PATCH.md` — registro do rebrand (identidade → decisoes).

---

## 4. Arquivos do AIRI que permanecem **intocados**

- `apps/stage-tamagotchi/src/main/libs/*` (bootkit/lifecycle, electron/location, persistence **usado,
  não editado**, i18n main), `configs/global.ts`, `services/airi/**` (channel-server/godot/mcp/plugins/
  auth/widgets), `services/electron/**` (incl. auto-updater, single-instance, screen, shortcuts),
  `windows/**` (exceto 1 linha de landing no `main`), `tray/index.ts`, `preload/**`.
- `packages/stage-ui/**`, `stage-pages/**`, `stage-layouts/**`, `stage-shared/**`, `core-agent/**`,
  `core-character/**`, `ccc/**`, `server-runtime/**`/`server-sdk`/`server-shared`, `memory-pgvector/**`,
  `duckdb-wasm/**`, `audio/**`/`pipelines-audio/**`/`stream-kit/**`, renderizadores de avatar,
  `electron-eventa/**`, providers, i18n **existente** (en/es/…; só se adiciona pt-BR).
- `packages/i18n/src/locales/{en,es,fr,ja,ko,ru,vi,zh-Hans,zh-Hant}/**` — intocados (só se adiciona
  `pt-BR/`).
- Testes upstream (incl. o alvo da falha `d8e62f12` — **não portar**).
- `apps/stage-web`, `server/**`, `plugins/**`, `engines/**`, `integrations/**`, `services/**`.

---

## 5. Decisões de implementação a confirmar na fase (não bloqueiam este plano)

1. **Montagem da Home:** o app abre direto na Home (main window → `#/lia-home`) e "CONVERSAR" volta
   ao stage/chat existente (rota `#/` index.vue ou janela `chat` `#/chat`)? Recomendação: **abrir na
   Home** e ter CONVERSAR navegando para a experiência atual — sem duplicar, reaproveitando os
   openers `electronOpenChat/electronOpenSettings` que o AIRI já registra.
2. **Título/identidade visível** vinda de i18n/metadata vs `app.setName` (userData/single-instance):
   em M1 fica **só apresentação** (i18n/metadata/ícone); **não** mudar chave de single-instance nem
   feed de auto-updater (depende de identidade de distribuição — fase de packaging).
3. **Extensão do pt-BR:** traduzir só a primeira prioridade (Home/onboarding/settings/dialogs/errors/
   status/nav) e deixar Advanced em en-US via fallback, ou estender também o painel técnico em M1.
   Recomendação: primeira prioridade em M1; Advanced permanece en-US até M1.5+.

---

## 6. Ordem dos commits da M1 (ordem proposta)

Seguindo as Fases 1–10 aprovadas, com commits pequenos e atômicos. Cada commit fecha DoD local
(typecheck/lint no escopo + docs afetadas) e é revisável:

1. `docs(M1): decisions recorded — integration plan resolved + implementation blueprint` → atualiza
   `LIA-INTEGRATION-PLAN.md`, `M1-SCOPE.md`, este plano (já entregue; este documento entra como commit).
2. `feat(M1): Lia identity patch (electron rebrand)` → Fase 1 (electron-builder/metainfo/flatpak/
   assets) + `docs/upstream/LIA-IDENTITY-PATCH.md`.
3. `feat(M1): i18n pt-BR locale + register (en fallback)` → Fase 4 (adiciona `pt-BR/`, registra em
   `packages/i18n`).
4. `feat(M1): Lia Home shell (launcher) over stage-tamagotchi` → Fase 2 (Home + componentes + landing).
5. `feat(M1): Lia navigation (destinations) via eventa IPC` → Fase 3.
6. `feat(M1): Lia product config (namespace 'lia') via createConfig` → Fase 5.
7. `feat(M1): Lia friendly status abstraction (presentation only)` → Fase 6.
8. `feat(M1): collapsible logs + friendly errors + basic Advanced/Diagnostics` → Fase 7.
9. `feat(M1): basic settings reorganization (product language)` → Fase 8.
10. `test(M1): unit tests for config/status/i18n-pt/Home` → Fase 9 (conforme §80 do AGENTS).
11. `docs(M1): final M1 documentation + README updates` → Fase 10.
12. (tag/review point) **PARADA** para revisão da M1 antes de qualquer M2.

> Commits são aplicados na branch `arena/01a07b6d-lia-project` (nunca main; DevKit `sync`).

---

## 7. Riscos específicos da implementação

| Risco | Grav. | Mitigação |
|---|---|---|
| Rebrand escorrer para refactor do AIRI (mexer em boot/DI/IPC) | Alta | manter patch de identidade **isolado e documentado**; diff pontual; regra de "não tocar" revisitada em cada commit |
| Editar `main/index.ts`/`windows/main` para Home/registro Lia causar regressão no boot que roda | Alta | mudanças **aditivas** mínimas; validar `dev:tamagotchi` abre e janelas continuam (janela main/chat/settings) |
| Home duplicar ou sequestrar o chat existente | Alta | Home só **navega** para chat/stage via openers existentes; reusa stores AIRI; nenhum pipeline novo |
| Config Lia colidir com schema do AIRI ou com rebase upstream | Média | namespace `'lia'` isolado via `createConfig`; sem mexer em `configs/global.ts`; documentado |
| pt-BR parcial deixar UI "mista" | Média | fallback `en` global do AIRI; escopo claro (Advanced en-US inicial); testes de resolução de locale |
| Criar package novo sem justificativa | Média | regra §10/M1-SCOPE: só criar package se justificado; M1 só estende `packages/i18n` |
| Status depender de sinais internos instáveis do runtime | Média | M1 = só apresentação; ler estados que já existem; coleta de hardware fica para M2 |
| Testes/typecheck da M1 interagindo com a falha upstream `d8e62f12` | Baixa | não portar; validar 56/57 baseline inalterado + código Lia sem novas falhas |
| i18n: registros em dois lugares (renderer e main) ficarem dessincronizados | Baixa | ambos derivam de `packages/i18n` (`Object.keys(messages)`); registro central + teste |
| Rebrand de metainfo/flatpak quebrar pipelines de release upstream | Baixa | alteração local rastreada em `docs/upstream/`; não afeta GitHub Actions do upstream |

---

## 8. Critérios de pronto do plano (gate para M1 Part 2)

1. Decisões registradas em `LIA-INTEGRATION-PLAN.md` §9 (ok).
2. Escopo em `M1-SCOPE.md` atualizado com fases 1–10 (ok).
3. UX em `docs/product/UX.md` alinhada (ok, sem mudança obrigatória).
4. Árvore/arquivos/ordem/riscos neste documento revisados e aprovados.
5. **Sem código escrito ainda** — M1 Part 2 começa somente após esta aprovação.

*Fim do documento `M1-IMPLEMENTATION-PLAN.md`.*
