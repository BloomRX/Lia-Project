# LIA-IDENTITY-PATCH — Registro do rebrand de identidade (M1 · Fase 1)

> **M1 Phase 1 · Electron identity** · Data: 07/09/2026 · Branch: `arena/01a07b6d-lia-project`
> **Escopo:** aplicar **somente** a identidade necessária para que o desktop seja reconhecido como
> **Lia**, tratando cada mudança como um **patch pontual e reversível** (regra de M1/AGENTS §94).
> **Decisões:** `docs/architecture/LIA-INTEGRATION-PLAN.md` §9 · **Blueprint:** `M1-IMPLEMENTATION-PLAN.md`.

---

## 1. Identidade escolhida

| Campo | Upstream AIRI | Lia (esta fase) |
|---|---|---|
| `appId` (electron-builder) | `ai.moeru.airi` | **`ai.lia.app`** |
| `productName` (electron-builder) | `AIRI` | **`Lia`** |
| Windows `AppUserModelID` (`setAppUserModelId`) | `ai.moeru.airi` | **`ai.lia.app`** |
| Ícones do app | arte AIRI | **placeholder Lia** (tile gradiente + monograma) — a substituir por arte final |

---

## 2. Arquivos do AIRI modificados (todos pequenos e aditivos)

1. `airi/apps/stage-tamagotchi/electron-builder.config.ts`
   - `appId: 'ai.lia.app'`, `productName: 'Lia'` (2 linhas). Comentário curto de contexto adicionado.
2. `airi/apps/stage-tamagotchi/src/main/index.ts`
   - `electronApp.setAppUserModelId('ai.lia.app')` (1 token + 2 linhas de comentário).

## 3. Arquivos de identidade/assets novos/substituídos

- `airi/apps/stage-tamagotchi/resources/icon.png` — substituído (placeholder Lia 1024, usado em
  tempo de execução pelas janelas/tray/editor via `?asset`).
- `airi/apps/stage-tamagotchi/resources/icon-512.png` — substituído (512).
- `airi/apps/stage-tamagotchi/resources/icon.svg` — substituído por vetor equivalente (fonte).
- `airi/apps/stage-tamagotchi/build/icon.png` — substituído (1024, ícone de empacotamento PNG).
- `airi/apps/stage-tamagotchi/build/icon-512.png` — substituído (512).
- `airi/apps/stage-tamagotchi/build/icon.ico` — regenerado (256/128/64/48/32/16, identidade Windows).

> Os placeholders foram gerados programaticamente (gradiente índigo→violeta→rosa + monograma "L"),
> determinísticos e fáceis de substituir pela arte final. **Não há visão automática** deste ícone no
> fluxo de edição; deve ser confirmado visualmente na máquina real antes do release de identidade.

---

## 4. Explicitamente NÃO alterado (diferido / intocado nesta fase)

Por decisão (evitar escopo e meias-mudanças; documentar > mexer):

- **`executableName: 'airi'`** (win/mac/linux) — diferido para a fase de identidade de distribuição.
- **`extraMetadata.name: 'ai.moeru.airi'`** (nome npm empacotado) — técnico; intocado.
- **Feed de publish/auto-updater** (`owner: 'moeru-ai'`, `repo: 'airi'`, `channel`), dirs de cache
  `ai.moeru.airi-updater` — feed/updater intocados (updater é uma fase própria de distribuição).
- **Guard de single-instance** — intocado (regra explícita do M1).
- **`ai.moeru.airi.metainfo.xml` / `ai.moeru.airi.flatpak.yml`** — distribuição Linux/AppStream
  **diferida** (decisão: Linux/flatpak fora desta fase).
- **`build/icon.icns`, `build/icon.icon/` (macOS), `resources/tray-icon-macos.png`** — assets de
  empacotamento técnico por plataforma preservados (regra §4 "preservar recursos técnicos de
  packaging"; mac/distor diferenidos).
- **Textos de marca visíveis** (About `highlight="AIRI"`, strings de descrição, tray) — ficam para as
  fases **i18n pt-BR / UI** (Fases 2–4), onde "Lia" vira consistente em todas as línguas — evita
  meias-mudanças monolíngues e duplicação com o sistema i18n.
- **Nomes de pacotes `@proj-airi/*`, internals** (core-agent, stage-ui, consciousness, speech, etc.) —
  intocados. Lia = produto; AIRI = implementação/foundation.

---

## 5. Confirmação de que NENHUM core AIRI foi alterado

Nenhum boot/lifecycle/DI/IPC/window architecture/runtime/órgão foi tocado. As únicas edições foram:
`productName`/`appId` (config de identidade), 1 `AppUserModelID` e os **assets de ícone**.
Tudo é reversível via `git revert`/restauração dos assets. Não foi feita correção/backport de
`d8e62f12` nem refactor.

---

## 6. Build/testes — nota de validação

- **typecheck/build:** o sandbox não dispõe de `pnpm` nem de `airi/node_modules` (mesma limitação da
  M0), portanto **não executáveis aqui**. Validar na máquina real (`J:\Lia-Project`, pasta `airi/`):
  `pnpm dev:tamagotchi` (abrir app e conferir nome/ícone) e, se aplicável, um `build` do pacote para
  conferir appId/productName. Esperado: 56/57 typecheck baseline inalterado (falha upstream isolada
  intacta), **sem novas falhas** deste patch.
- Ícone placeholder deve ser **conferido visualmente** na máquina real.

---

## 7. Próximo passo

Após validação desta Fase 1, iniciar **Fase 2 — Lia shell / Home** (sem duplicar chat/avatar).

*Fim do documento `LIA-IDENTITY-PATCH.md`.*
