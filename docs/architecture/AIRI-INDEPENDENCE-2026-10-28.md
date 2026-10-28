# Independência arquitetural da Lia em relação ao AIRI

**Data:** 28/10/2026 · **Natureza:** investigação e planejamento.
**Nada foi alterado, removido ou migrado.** Nenhum build executado.

Complementa, e não repete:
`AIRI-COMPARISON.md` (o que a Lia mudou no AIRI) ·
`LIA-STAGE-ARCHITECTURE.md` (contratos do Stage) ·
`LIA-MIGRATION-PLAN.md` (extrair o Stage) ·
`AIRI-UPDATE-REVIEW-2026-10-28.md` (o que vale do upstream).

Este documento responde a uma pergunta diferente e mais ampla: **o que falta para
remover `airi/` inteira.**

---

## 0. Conflito de autoridade — precisa de decisão antes de executar

`AGENTS.md` §7 define a arquitetura da Lia como:

```
Lia → Adapter/Wrapper/Integration Layer → AIRI → Runtime/Services/Providers
```

E `AGENTS.md` §6 manda reutilizar o AIRI antes de implementar do zero.
**A missão descrita nesta tarefa é o oposto:** eliminar `airi/` do repositório.

Isto **não é um detalhe**. Enquanto `AGENTS.md` §6–§7 disser o que diz, qualquer
agente que siga o rulebook vai reconstruir acoplamento. A decisão de mudar a
arquitetura alvo precisa ser registrada em `AGENTS.md` **antes** da Fase 1 do
plano — não depois. Registro aqui como **B1**.

---

## 1. Estado atual verificado

| Item | Valor | Como |
| --- | --- | --- |
| Branch | `arena/01a10290-lia-project` | `git rev-parse` |
| HEAD | `3a45f2b` (local = remoto) | `git rev-parse` + `ls-remote` |
| Arquivos rastreados | **5 906** | `git ls-files` |
| Arquivos em `airi/` | **5 687 (96%)** | `git ls-files airi` |
| Arquivos fora de `airi/` | **219** | diferença |
| Tamanho de `airi/` | **580 MB** | `du -sh` |
| — dos quais `airi/docs` | **465 MB (462 MB em `content/`)** | `du -sh` |
| Código em `lia/` | 1 063 linhas (11 arquivos `.ts`) | `find` |

**O repositório hoje é, em massa, uma cópia do AIRI.** A Lia são 219 arquivos.

---

## 2. Mapa de dependências — seis camadas

Não basta procurar o texto `airi`. Cada camada tem um tipo de dependência
diferente e quebra de forma diferente.

### Camada 1 — Código da Lia

| Componente | Dependências reais | Veredito |
| --- | --- | --- |
| `apps/lia-app` (Launcher, 53 arq., 11 114 linhas) | `@lia/core`, `vue`, `electron`, Node nativo | **Lia própria** — zero imports do AIRI |
| `packages/lia-core` (`@lia/core`, 63 arq., 12 550 linhas) | `@moeru/std`, `destr`, `yauzl` — **todos npm público** | **Lia própria** |
| `lia/` (contratos, stage-host, launcher) | só Node nativo | **Lia própria** |

O Launcher declara no `package.json`: *"Boots with zero AIRI imports."* **Isso se
confirmou**: a varredura de imports não encontrou um único `@proj-airi/*`.

`@lia/core` cobre `bootstrap`, `brain` (roteamento/decisão), `bridge`, `paths`,
`product` (config), `secrets`, `voice` (Kokoro), `voices`. **Não** cobre avatar,
nem chamada de LLM (ver §2.2).

### Camada 2 — O Stage é o AIRI

```text
apps/stage-tamagotchi   461 arquivos   89 712 linhas   110 dependências
  ├─ 21 pacotes do workspace AIRI
  └─ 89 dependências externas

+ 20 pacotes do workspace que ele arrasta    ~170 158 linhas
= ~260 000 linhas
```

Isto **é** a dependência. O Stage da Lia não é um app separado: é o app do AIRI.

E o instalador confirma: `electron-builder.config.ts` do `stage-tamagotchi` tem
`appId: 'ai.lia.app'` e `productName: 'Lia'`. **O instalador Windows da Lia é o
app AIRI rebatizado.**

### Camada 2b — O que a Lia escreveu *dentro* do Stage

| Área | Arquivos | Acoplamento |
| --- | --- | --- |
| `main/services/lia` | 70 | leve: `@lia/core`, `@moeru/eventa`, `shared/eventa`, `@proj-airi/stage-shared` |
| `renderer/{stores,services,components}/lia*` | 56 | **profundo**: 14 imports de `stage-ui/stores/providers`, 11 de `stores/modules/speech`, 11 de `chat-provider-runtime`, 9 de `providers/config`, `settings`, `consciousness`, `hearing`, `airi-card` |

O main-process é portátil com pouco trabalho. O renderer está **costurado** nos
stores do `stage-ui` (109 638 linhas).

### Camada 3 — Toolchain e scripts

| Arquivo | Dependência | Quebra se `airi/` sumir |
| --- | --- | --- |
| `Lia.bat` | `airi/pnpm-workspace.yaml`, `airi/node_modules`, `pnpm dev:lia` | **sim — é o ponto de entrada** |
| `DevKit.bat` | `tools/lia_dev.py` (indireto) | funciona, mas o diagnóstico reporta ausência |
| `tools/lia_dev.py` | `airi/packages/core-agent/dist`, `airi/node_modules` | **sim** |
| `tools/project_cli.py` | `airi/packages/lia-core/dist` | **sim** |
| `tools/devflow/preflight.py` | 3 requisitos, 2 dentro de `airi/` | **sim — falha fechada** |
| `tools/devflow/lia_core_prereq.py` | `WORKSPACE_DIR = 'airi'` | **sim** |
| `tools/devflow/sync.py` | `ALLOWED_SOURCE_ROOTS` inclui `'airi/'` | degrada |
| `tools/kokoro-smoke.mjs` | `airi/packages/lia-core/dist` | **sim** |
| `Tests/tools/*.mjs` (11 arq.) | benchmark roda `pnpm` dentro de `airi/` | **sim** |
| `tools/devflow/rounds/m3_0b.json` | caminhos em `airi/` | **sim** |

### Camada 4 — Workspace e build

`airi/pnpm-workspace.yaml` traz **495 entradas de catálogo**. `@lia/core` e
`@lia/lia-app` usam `catalog:` para tudo — inclusive `electron`, `vite`,
`typescript`. Fora do workspace, **os dois não constroem** sem um catálogo novo.

`@lia/core` usa `tsdown` como bundler. O Launcher usa `electron-vite`.

### Camada 5 — CI

`.github/workflows/devflow-ci.yml` roda **apenas** testes Python e
`compileall tools`. **Não constrói nem testa `airi/`.** Portanto o CI não quebra
ao remover `airi/` — mas também **não valida nada do app hoje**. É uma lacuna,
não uma proteção.

### Camada 6 — Documentação

`airi/docs` = **462 MB, 968 arquivos**. **Zero referências executáveis** de
`lia/` ou `tools/`. É a documentação do AIRI, não da Lia.
Classificação: **referência descartável**.

---

## 3. Classificação dos componentes

| Componente | Classe | Evidência |
| --- | --- | --- |
| `apps/lia-app` (Launcher) | **Lia própria** | nenhum import `@proj-airi` |
| `packages/lia-core` | **Lia própria** (amarrada ao workspace) | deps só npm público |
| `lia/*` | **Lia própria** | Node nativo |
| `apps/stage-tamagotchi` | **Dependência executável** | é o Stage e o instalador |
| `packages/stage-ui` | **Dependência executável** | 774 arq., usado por 56 arquivos da Lia |
| `packages/stage-pages` / `stage-layouts` | **Dependência executável** | telas do Stage |
| `stage-ui-{three,live2d,mmd,spine}`, `ui` | **Dependência executável** | avatar e componentes |
| `packages/core-agent` | **Adaptável** | LLM via `@xsai/*`, que é npm público MIT |
| `packages/pipelines-audio` | **Adaptável** | tem defeito próprio (ver §6) |
| `packages/i18n` | **Adaptável** | locale pt-BR da Lia está nele |
| `airi/docs` | **Referência descartável** | 462 MB, zero uso |
| `airi/server`, `airi/integrations`, `airi/services`, `airi/plugins`, `airi/examples` | **Referência descartável** (a confirmar) | nada da Lia importa |
| `airi/engines`, `airi/evals` | **Indeterminado** | não verificado |
| Fontes (`font-*`) | **Adaptável** | 3 pacotes de 1 linha |

**Nenhum arquivo caiu em "indeterminado" nas camadas 1–3** exceto `engines` e
`evals`, que não inspecionei.

---

## 4. O que quebra se `airi/` for removida hoje

| # | Funcionalidade | Situação |
| --- | --- | --- |
| 1 | Iniciar a Lia (`Lia.bat`) | **quebra** — depende do workspace |
| 2 | Build de `@lia/core` e do Launcher | **quebra** — sem catálogo |
| 3 | Stage (janela, chat, avatar, voz) | **desaparece** — é o app AIRI |
| 4 | Conversa com IA | **desaparece** — `core-agent` + `@xsai` dentro do Stage |
| 5 | Voz: TTS/STT, Kokoro, barge-in | **desaparece** — `pipelines-audio` + `stage-ui` |
| 6 | Avatar (VRM/Live2D/MMD/Spine) | **desaparece** — `stage-ui-{three,live2d,mmd,spine}` |
| 7 | Instalador Windows | **desaparece** — electron-builder do `stage-tamagotchi` |
| 8 | Tooling: preflight, prereq, DevFlow, QA benchmark | **quebra** — caminhos fixos |
| 9 | `lia/stage` (o Stage mínimo novo) | sobrevive, mas hoje é **placeholder** |
| 10 | Documentação e contratos | sobrevivem |

**Sobrevive sem perda:** Launcher (código), `@lia/core` (código), `lia/`,
documentação.
**Não sobrevive:** toda a experiência do usuário.

---

## 5. Alternativas para cada dependência importante

Separação decisiva, verificada no registro npm em 28/10/2026:

| Pacote | No npm? | Versão / licença |
| --- | --- | --- |
| `@xsai/stream-text` | **sim** | 0.5.1, MIT |
| `@moeru/eventa` | **sim** | 1.0.2, MIT |
| `@moeru/std` | **sim** | 0.1.0-beta.20, MIT |
| `@proj-airi/stage-ui` | **não (HTTP 404)** | só workspace |
| `@proj-airi/core-agent` | **não (HTTP 404)** | só workspace |
| `@lia/core` | não (404) | é nossa, será publicada ou local |

**Consequência:** a infraestrutura que a Lia precisa (chamar LLM, IPC, utilidades)
existe como **biblioteca independente MIT**. A camada de experiência
(`stage-ui`, `stage-pages`, avatar) **não existe fora do monorepo** — só pode ser
copiada ou reescrita. Não há terceira via.

| Dependência | Opção recomendada | Justificativa |
| --- | --- | --- |
| Chamada de LLM (`core-agent`) | **Reimplementar sobre `@xsai/*`** | é exatamente o que o `core-agent` faz; `@xsai` é MIT e independente |
| `@lia/core` | **Extrair do workspace** | código já é nosso; só precisa de catálogo próprio |
| Launcher | **Extrair** | idem, e sem imports do AIRI |
| `pipelines-audio` | **Reimplementar** (médio prazo) | 4 293 linhas; interface de fila + TTS é conhecida |
| `stage-ui` (109k linhas) | **Não copiar** | copiar contradiz o objetivo; ver §5.1 |
| Avatar (three/live2d) | **Substituir por lib independente** | `@pixiv/three-vrm` e `pixi-live2d-display` são npm público; o AIRI só embrulha |
| `i18n` | **Reimplementar** | a Lia só precisa do pt-BR |
| `airi/docs`, `server`, `integrations` | **Descartar** | sem uso |

### 5.1 O problema do `stage-ui` — a decisão que não pode ser adiada

`stage-ui` são 109 638 linhas de componentes e stores Vue. A Lia usa 56 arquivos
que importam 25 caminhos distintos dele. Há três saídas e **nenhuma é gratuita**:

- **A. Reescrever a UI da Lia** — caro, mas alinhado ao objetivo.
- **B. Copiar `stage-ui` para dentro da Lia** — resolve hoje, contradiz "não
  querer uma cópia do AIRI", e herda o dever de sincronizar com o upstream.
- **C. Híbrido** — reescrever o que a Lia usa de fato e só copiar o resto.

Recomendo **C**, com uma ressalva honesta: não medi quanto do `stage-ui` a Lia
realmente alcança. Sem essa medição, C é hipótese, não plano fechado. → **B2**.

---

## 6. Arquitetura-alvo proposta

```text
Lia-Project/
├── core/        @lia/core  — brain, product, secrets, voice, paths
├── launcher/    shell Electron + IPC          (de apps/lia-app)
├── stage/       janela, ciclo de vida, render (de lia/stage)
├── ui/          componentes próprios          (novo, substitui stage-ui)
├── shared/      @lia/contracts                (já existe)
├── tools/  Tests/  docs/
└── (sem airi/)
```

Regras:

1. `@lia/core`, `@lia/contracts` e o launcher **não importam nada de UI**.
2. LLM atrás de uma porta `LiaChatPort`, implementada sobre `@xsai/*`.
3. Cada dependência externa entra declarada e justificada (`AGENTS.md` §73).
4. O AIRI deixa de ser dependência e passa a ser **referência histórica** citada
   em `docs/upstream/`.

---

## 7. Plano de migração — etapas pequenas

Não é reescrita integral. Cada etapa deixa o app utilizável.

| Fase | Entrega | `airi/` ainda necessário? |
| --- | --- | --- |
| **0** | Registrar a mudança de arquitetura em `AGENTS.md` §6–§7 | sim |
| **1** | Catálogo e workspace próprios; `@lia/core` constrói fora do AIRI | sim |
| **2** | Launcher constrói e roda fora do AIRI | sim |
| **3** | Porta `LiaChatPort` + adaptador sobre `@xsai` | sim |
| **4** | Stage: janela + chat + configuração (sem avatar) | sim |
| **5** | Voz: TTS via Kokoro (já em `@lia/core`) e STT | sim |
| **6** | Avatar por biblioteca independente | sim |
| **7** | Instalador electron-builder próprio | sim |
| **8** | Tooling, CI, DevFlow e QA apontando para os caminhos novos | **não** |
| **9** | Remover `airi/` | — |

A ordem põe valor cedo (1–2 dão um produto que constrói sozinho) e deixa o
trabalho caro (4–6) para depois de a base estar estável.

---

## 8. Critérios objetivos para autorizar a remoção

Remover `airi/` **só** quando **todos** forem verdadeiros e verificados:

1. `Lia.bat` inicia a Lia sem que `airi/` exista na árvore.
2. `pnpm install` + build funcionam a partir da raiz do repositório.
3. `grep -rn "@proj-airi/" --include=*.ts --include=*.vue` retorna **zero** fora
   de documentação.
4. Nenhum script em `tools/`, `Tests/` ou `.github/` referencia um caminho em
   `airi/`.
5. Conversa, voz e avatar funcionando em **Windows real** — não em teste unitário.
6. Instalador gera e o app instalado abre, conversa e fecha sem órfão.
7. `docs/upstream/AIRI-INTEGRATION.md` marcado como histórico.

Critério 5 é o que o projeto já trata como o único gate válido
(`CURRENT-STATE.md` §6).

---

## 9. Riscos e lacunas

| # | Item | Tipo |
| --- | --- | --- |
| **B1** | `AGENTS.md` §6–§7 manda **depender** do AIRI; a missão manda removê-lo | **Bloqueio de decisão** |
| **B2** | Não se sabe quanto do `stage-ui` a Lia realmente usa | **Lacuna** — bloqueia a escolha A/B/C de §5.1 |
| **R1** | Copiar `stage-ui` recria o problema que a tarefa quer resolver | Risco |
| **R2** | CI não valida o app hoje; remover `airi/` não será pego por teste nenhum | Risco |
| **R3** | `@lia/core` e o Launcher só constroem via catálogo do AIRI (495 entradas) | Risco técnico |
| **R4** | A correção de espaço da Lia diverge do upstream e vive em `core-agent` | Risco de regressão (§`AIRI-UPDATE-REVIEW`) |
| **R5** | `tts-chunker.ts:72` descarta grapheme clusters — defeito atual | Risco de qualidade |
| **R6** | Nada desta análise foi executado; sem `node_modules`, sem build | Limite |

**Hipótese não provada:** que o esforço de reescrever a UI seja menor que manter
uma cópia sincronizada. Não medi nenhum dos dois.

---

## 10. O que o Arena.ai faz e o que exige Codex

| Etapa | Quem | Por quê |
| --- | --- | --- |
| 0 — mudar `AGENTS.md` | **Arena** | decisão de texto, revisão do dono |
| 1 — catálogo próprio | **Arena** | mecânico, verificável por build |
| 2 — launcher fora do workspace | **Arena** | sem imports do AIRI, risco baixo |
| 3 — porta `LiaChatPort` | **Codex** | desenho de fronteira, risco de regressão no chat |
| 4 — Stage sem avatar | **Codex** | reescrita de UI, maior superfície |
| 5 — voz | **Codex** | runtime de áudio, difícil de validar sem Windows |
| 6 — avatar | **Codex** | integração 3D/Live2D |
| 7 — instalador | **Arena** depois do 4 | configuração |
| 8 — tooling | **Arena** | ajuste de caminhos |
| 9 — remoção | **Arena**, sob os critérios de §8 | operação mecânica com gate |

O primeiro ponto em que o Codex se torna **realmente** necessário é a **etapa 3**:
definir a fronteira de conversa sem perder as correções já feitas.
