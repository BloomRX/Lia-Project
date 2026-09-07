# M1 Phase 2 — Investigation: Dragging, Log panel layout, Initial language

> **M1 Phase 2 · QA findings → investigation (sem alteração de código)**
> Data: 07/09/2026 · Branch: `arena/01a07b6d-lia-project` · Commit validado: `f258ce5`
> **Objetivo:** apresentar as **causas** dos 3 problemas relatados e a **correção mínima proposta**,
> para revisão/aprovação antes de aplicar. Nenhum código foi alterado nesta rodada.

---

## Estado atual (pós-aprovação)

Aprovação QA recebida — decisões e resultado da aplicação:

| # | Correção | Decisão | Status |
|---|----------|---------|--------|
| 1 | Dragging | **Opção A** — reutilizar `Window/TitleBar.vue` na Home | ✅ **Implementado** (`03f81a5`) |
| 2 | Log panel / layout | Corrigir layout só da Home | ✅ **Implementado** (`03f81a5`) |
| 3 | Initial language | **Não alterar** — locale real não confirma problema | ⏸ **Fechado como investigação** (valores registrados abaixo) |
| 4 | Tamanho da janela Home ↔ Stage | **Novo BLOCKER** — investigação concluída, sem código | 📋 ver `M1-PHASE2-QA-WINDOW-SIZING.md` |

> **Nova rodada QA (máquina real):** além da #3 confirmada, surgiu o blocker #4 (janela única
> compartilhada entre Home-launcher e Stage, com necessidades de composição diferentes). Ver
> `docs/architecture/M1-PHASE2-QA-WINDOW-SIZING.md` para a investigação completa (onde o tamanho é
> definido, mecanismos de resize existentes, rota /home ↔ /, viabilidade de resize contextual,
> solução de menor risco e arquivos afetados). **Nenhuma solução implementada** — PARE após
> investigação.

**O que foi implementado em `home.vue` (commit `03f81a5`):**
- **#1 Dragging:** a Home agora renderiza o `Window/TitleBar.vue` existente no topo (fonte única de
  `drag-region` + `no-drag` nos controles), título \"Lia\". **Sem** novo sistema de arrasto, **sem**
  `app-region: drag` no container inteiro, **sem** mudança de arquitetura Electron (conforme Opção A).
- **#2 Log/layout:** o conteúdo da Home vive num container rolável
  (`absolute top-11 inset-x-0 bottom-0 overflow-y-auto`, compensando a TitleBar fixa `pt-11`) com
  `min-h-full` + `my-auto` internos → **centraliza quando cabe / rola quando estoura** (sem cortar o
  topo). O painel de logs tem `max-h-32 overflow-y-auto` (scroll interno, altura própria) e o botão
  de logs permanece no fluxo normal, **sempre acessível**. Cores ajustadas para tema claro/escuro
  (a Home deixou de depender de fundo escuro da antiga barra).
- **#3 Initial language:** **nada alterado.** Investigação mantida nas seções abaixo; decisão somente
  após você informar idioma de exibição do Windows + `navigator.language` + `navigator.languages`.

> Próximos passos (máquina real): rodar testes direcionados (§7), `build:web`, `dev:tamagotchi` nas
> resoluções do QA e janela pequena; registrar BASELINE vs regressões Lia. Não iniciar Phase 3.

---

## Resumo do processo (regras aplicadas)
- Não iniciei a Phase 3. Não criei features grandes.
- Testes upstream com falhas (`cap-vite`, `plugin-sdk`, `ui-server-auth`, `stage-shared`) são tratados
  como **dívida upstream/baseline** — não corrigir globalmente, não "esverdear".
- `d8e62f12` (live2d-zip-loader) **não** portado.
- Procurei a menor correção; **sem** `-webkit-app-region: drag` global e **sem** sobrescrever idioma
  já persistido.

---

## 1. DRAGGING (janela não pode ser movida) — BLOCKER

### Causa
- O main window é **frameless**: `transparentWindowConfig()` (em
  `src/main/windows/shared/window.ts`) aplica `frame: false` (+ `transparent: true`). Logo, **não há
  barra de título do SO** para arrastar.
- O movimento depende de uma **região `drag-region` no conteúdo** — classe que mapeia (UnoCSS, em
  `uno.config.ts` linha ~214) para `app-region: drag`.
- No AIRI, a área arrastável **vivia no conteúdo**: `pages/index.vue` (o Stage) usa `drag-region`
  (loading/overlay) e a `controls-island` tem um **handle de arrasto** (Windows/mac: `mousedown` →
  `electronStartDraggingWindow` via `electron-click-drag-plugin`; Linux: classe `drag-region`). As
  janelas `chat`/`settings` usam o componente `Window/TitleBar.vue`, que traz `drag-region`.
- **A Home (`pages/home.vue`) não fornece nenhuma região `drag-region` nem handle de arrasto.**
  Landing agora é `/home` num frameless → **não há como agarrar a janela para movê-la.** (A Home não
  usa TitleBar e o `default.vue`/conteúdo não tem `drag-region`.)

### Correção mínima proposta (a decidir)
- **Opção A (recomendada, mais consistente com as demais janelas):** a Home passa a renderizar um
  **topo arrastável** reutilizando o componente **`Window/TitleBar.vue`** (já usado em chat/settings) —
  fornece `drag-region`, título "Lia", e `no-drag` nos controles internos. Barra sutil, alinhada ao
  padrão AIRI. Sem novo sistema.
- **Opção B (mais "launcher", sem barra de título visual):** adicionar na Home uma **faixa fina de
  arrasto no topo** (ex.: `h-6/8`, `drag-region`, `absolute top-0 inset-x-0`, `select-none`) e marcar
  **`no-drag`** qualquer controle que vier a estar sobre ela. Conteúdo central permanece intacto.
- **Opção C (não recomendada):** aplicar `drag-region` ao container inteiro e `no-drag` em cada
  botão/link — risco para acessibilidade/sobreposição; evitar.

> **Recomendação:** **Opção A** por consistência e menor superfície (componente já existente e
> testado). Confirmar e eu aplico + valido `no-drag` nos controles do slot de ações.

### ✅ Decisão (aprovada) e resultado
**Opção A implementada** no commit `03f81a5`. A Home passou a renderizar `Window/TitleBar.vue`
(reuso — `drag-region` + título \"Lia\" + `no-drag` nos controles). A barra é `fixed`; o conteúdo da
Home roda abaixo dela (`top-11`). Nenhuma alteração em `window.ts`/`windows/main/index.ts`.

---

## 2. LOG PANEL (cortado / estoura a janela)

### Causa
- Em `pages/home.vue`: o container de conteúdo é
  `flex flex-1 flex-col items-center justify-center gap-4 px-6 py-8` e o pai é `overflow-hidden`
  (linhas 70–75). `justify-center` centraliza o bloco, mas o **empilhamento vertical** (imagem + nome
  + saudação + status + botão principal + 2ª linha de atalhos + botão de logs + painel expandido)
  **ultrapassa a altura útil** — sobretudo na janela pequena (default 450×600). Como o pai tem
  `overflow-hidden`, **o excesso (painel de logs / parte inferior) é cortado e não há scroll** →
  a caixa "fica cortada/ultrapassa".

### Correção mínima proposta
- Permitir **rolagem vertical no conteúdo** quando ele exceder a altura, sem quebrar o
  centro-quando-cabe:
  - trocar o pai para uma área rolável (`overflow-y-auto`) e usar **auto-margens** no conteúdo
    (`my-auto`) em vez de `justify-center`, para que: quando couber → centra; quando exceder → rola
    (sem cortar topo, padrão conhecido de `min-h-full` + `my-auto` num scroll container);
  - limitar o **painel de logs** a uma altura máxima própria com `overflow-y-auto` (não um sistema de
    logs — só o container do aviso amigável);
  - garantir que o botão "Mostrar/Ocultar logs" permaneça acessível.
- Validar nas 3 resoluções do QA (1280×720, 1366×768, 1920×1080) e em janelas pequenas (a própria
  janela 450×600) + DPI. Mudança **localizada em `home.vue`** apenas.

### ✅ Decisão (aprovada) e resultado
Aprovado o plano acima; **implementado no commit `03f81a5`** em `home.vue`: conteúdo rolável
(`top-11` + `overflow-y-auto` + `min-h-full`/`my-auto`) → centra quando cabe, rola quando estoura;
painel de logs `max-h-32 overflow-y-auto` (scroll interno); botão \"Mostrar/Ocultar logs\" sempre
acessível. Validar resoluções na máquina real (§7).

---

## 3. INITIAL LANGUAGE (primeira execução em inglês) — ⏸ encerrado (sem alteração)

> **Decisão: NÃO alterar o i18n agora.** Os valores da máquina real foram fornecidos e **não**
> confirmam problema de locale:
>
> - idioma de exibição do Windows: *(pendente do usuário confirmar explicitamente; `navigator` indica pt-BR)*
> - `navigator.language` = **`pt-BR`**
> - `navigator.languages` = **`['pt-BR']`**
>
> Portanto **não há evidência de problema no navegador/renderer locale.** A "primeira abertura em
> inglês" fica como **investigação**, se ainda for reproduzível, mas **não é o blocker atual**.
> Nenhum código foi alterado para #3.

### Fluxo atual (verificado)
- `renderer/modules/i18n.ts`: locale inicial = `resolveSupportedLocale(localStorage 'settings/language'`
  **senão** `navigator.language`, fallback `'en'`). `fallbackLocale: 'en'`.
- Store `settings/general.ts`: `language` (localStorage), e em `onMounted` seta `getLanguage()`
  (mesma resolução). `App.vue` usa `useLanguage(language, getMainLocale, setLocale)`.
- `useLanguage.restore()` (em `App.vue` onMounted): se **não** houver idioma persistido no renderer,
  consulta o main (`i18nGetLocale` → config `options.json` `language`); se `undefined` (1ª vez),
  **mantém** o resolvido do renderer e depois faz `setLocale(...)` (persiste no main). **Não sobrescreve**
  escolha persistida.
- `packages/i18n` agora inclui `pt-BR` registrado e `localeRemap` para `pt`/`pt-BR`/`pt-PT` (Fase 2).

### Análise com os dados da máquina real
- Como `navigator.language = 'pt-BR'` e `navigator.languages = ['pt-BR']`, **a hipótese anterior
  (navegador reportando `en-US`/`en`) NÃO se confirma**: o renderer deveria resolver para `pt-BR` já
  na 1ª execução (regra `localStorage` → `navigator.language` → `en`).
- Logo, um "primeiro uso em inglês", se ainda reproduzível, não viria de `navigator.language`.
  Causas possíveis a manter em investigação: o boot do renderer resolvendo o idioma **antes** de o
  main restaurar a configuração (`useLanguage.restore()` só roda em `onMounted`), ou o `watch(language)`
  / `setLocale` persistindo um valor indevido no main (padrão Issue #1658 já comentado no fluxo).
  Nada disso é **blocker** e nada será alterado agora.
- **Não é uma regressão do i18n da Home** (as chaves pt-BR/en funcionam; pt-BR↔en foi validado).

### Correção (apenas se o problema for reproduzido de novo)
- Ajustar a detecção de 1ª execução para derivar do **locale do Electron main process**
  (`app.getLocale()` / `app.getPreferredSystemLanguages()`), refletindo o SO de forma mais confiável
  que `navigator.language` do renderer.
- Cadeia de prioridade a preservar: **escolha persistida (localStorage/config) > locale do SO (via
  main) > `navigator.language` > `en`**. Não alterar/sobrescrever o que o usuário já escolheu.
- **Decisão: NÃO implementar.** Reabrir a investigação somente se o "primeiro uso em inglês" for
  reproduzível na máquina real, quando então coletaremos: idioma de exibição do Windows + valor
  persistido de `language` no `config`/localStorage + `navigator.language(s)` no boot.

---

## 4. DevTools (janela extra) — documentação

- Em dev, `windows/main/index.ts` abre `webContents.openDevTools({ mode: 'detach' })` quando
  `is.dev`/`APP_DEBUG` (existente). O `Vue DevTools http://localhost:5173/__devtools__/` é **exclusivo
  de development** (plugin `vite-plugin-vue-devtools` no `electron.vite.config.ts`). **Não é UX normal
  da Lia.** Sem solução complexa agora — registrar como comportamento dev-only. Não afeta build/packaged.

---

## 5. Audio status (classificação)

- Sem provider configurado: **TTS/STT/VAD/Barge-in = UNKNOWN** (não validados).
- `Stage audio infrastructure: observado/funcionando`. Não implementar áudio nesta fase.

---

## 6. Home functionality (já validado manualmente — não reimplementar)
Home aparece · preview aparece · CONVERSAR→Stage · Settings abre · logs show/hide · pt-BR↔English.

---

## 7. Testes direcionados (a rodar na máquina real)
Escopo = mudanças da Phase 2 (stage-tamagotchi + i18n + Home). Sugestões (pnpm workspace):
- i18n: `pnpm --filter @proj-airi/i18n test` (cobre locales/`resolveSupportedLocale`); confirmar
  `pt-BR` em `Object.keys(messages)`.
- stage-tamagotchi (renderer/relevantes): rodar vitest em `apps/stage-tamagotchi` filtrando por
  arquivos da Home/i18n/windows-main; ex.: `pnpm --filter @proj-airi/stage-tamagotchi vitest run <caminhos>`.
- typecheck: confirmar **sem novas falhas além do baseline** `live2d-zip-loader.test.ts` (`d8e62f12`).
- Falhas upstream não-Phase-2 → registrar como baseline, **não** corrigir.

---

## 8. Alterações (consolidadas) — status de aplicação
1. **home.vue — arrastável (Opção A: TitleBar)** — ✅ **aplicado** (`03f81a5`).
2. **home.vue — layout rolável + painel de logs com altura própria (scroll)** — ✅ **aplicado** (`03f81a5`).
3. **i18n 1ª execução** — ⏸ **não aplicado** (aguardando confirmação do OS/locale na máquina real).
   Detectaria locale do SO via main (`app.getLocale`) com cadeia de fallback preservando escolha
   persistida. Provável toque em main (evento IPC p/ obter locale do sistema) + renderer
   `modules/i18n.ts`/`general.ts`.
4. Documentação: este documento atualizado com decisões/resultado; atualizar `M1-SCOPE`/runbook após
   a validação na máquina real.

**Próximos passos (máquina real):** validar #1/#2 nas resoluções do QA (§7), rodar testes
direcionados + `build:web` + `dev:tamagotchi`. Para #3, enviar idioma de exibição do Windows e
`navigator.language`/`navigator.languages`.

*Investigação e correções #1/#2 concluídas. #3 permanece pendente de dados da máquina real.*
