# ADR-0001 — Runtime desktop D+: dois processos Electron com fronteiras fechadas

| Campo | Valor |
|---|---|
| **Status** | Aceito com condições ([`D-01`](DECISION-RECORD-2026-11-16.md#d-01--adotar-d-electron-nos-dois-processos-com-fronteiras-fechadas)) — sign-off pendente |
| **Data** | 16/11/2026 |
| **Substitui** | Decisão provisória "Cenário C" de 12/11/2026 (`LIA-DESKTOP-RUNTIME-ARCHITECTURE-DECISION.md`) |
| **Relacionados** | D-02 (runtime único rejeitado), D-04 (lifecycle), D-05 (superfície do Core), D-06 (binário), D-07 (gate) |

---

## 1. Contexto

A Lia é composta por dois aplicativos Electron e um pacote de regras:

| Componente | O que é hoje | Evidência |
|---|---|---|
| **Launcher** (`airi/apps/lia-app`) | 4.344 LOC de main, 4.487 de renderer, 1 janela, 27 canais IPC, `sandbox: true`, perfil próprio | build de 16/11: `out/` = 2,28 MB |
| **Stage/Runtime** (`airi/apps/stage-tamagotchi`) | 25.388 LOC de main, 52.069 de renderer, 15 janelas, tray, áudio, Live2D/VRM | §2.3 da auditoria |
| **Core** (`airi/packages/lia-core`) | 6.027 LOC, 3 dependências, **sem Electron** | `runtime-boundary.test.ts` |
| **Contratos** (`lia/core`) | 1.944 LOC, zero dependências, **sem consumidor** | §2.1 da auditoria |

Quatro forças pressionam a arquitetura:

1. **Produto** quer Launcher leve e Runtime com a personagem, com ciclos de vida separados.
2. **Código** já separa processos (Stage é filho, sempre), mas **fecha** o Runtime quando o
   Launcher fecha (`index.ts:241-258`) — o oposto do que o produto pediu.
3. **Runtime** custa caro: dois Electron completos, 143,2 MiB cada (payload publicado).
4. **Manutenção**: Electron 43.4.1 está na borda das 3 majors suportadas (cadência de 8 semanas).

A pergunta não é "qual framework é moderno", é **onde está o custo e o que pode ser corrigido sem
reescrever 77 mil linhas de renderer**.

---

## 2. Decisão

**Adotar D+:** manter Electron no Launcher e no Runtime, como **dois processos independentes**,
e fechar cinco fronteiras que hoje são convenção:

| Fronteira | Como fica |
|---|---|
| **Processo** | Launcher e Runtime independentes; fechar um não encerra o outro |
| **Contrato** | Comunicação por canal autenticado e versionado; nenhum comando arbitrário |
| **Pacote** | Consumo de `@lia/core` só por subpath público; import relativo proibido por teste |
| **Dados** | Perfil Chromium ≠ dados de produto, nos dois apps |
| **Política** | Uma capacidade = um dono de política (matriz do §4) |

**O que D+ não é:** não é "Electron venceu". É "o custo de trocar o host é maior que o ganho, e o
ganho real está em corrigir o que está errado hoje". O gate G-4 (D-07) existe justamente para
reabrir a comparação com número.

---

## 3. Alternativas consideradas

| Alternativa | Por que não agora |
|---|---|
| **A. WinUI 3 / Windows App SDK** | Reescreve 8.831 LOC de Launcher em XAML/C#, exige sidecar Node para o Core, e **não reduz nada do Stage** (que continua Electron) |
| **B. Tauri 2** | Mesmo problema de Core: precisaria de sidecar Node; o ganho é 1 GPU process + disco no Launcher, com custo de Rust/WebView2/updater |
| **C. WebView2 + .NET** | Custo de B com menos reuso (bridge não é Vue) e dependência de runtime do sistema |
| **D. Electron atual otimizado (D+)** | **Escolhida** |
| **E1. Binário compartilhado, dois processos** | Complementar a D+, não alternativa: vira experimento (D-06) |
| **E2. Runtime único (um processo)** | **Rejeitada** (D-02): quebra 4 invariantes e não reduz os renderers |

**Critério de descarte rápido:** qualquer alternativa que exija reescrever o Stage está fora —
15 janelas, `setIgnoreMouseEvents`, 20 arquivos dependentes de `screen`, `uiohook-napi`,
`electron-click-drag-plugin`.

---

## 4. Matriz de responsabilidades (uma capacidade, um dono de política)

| Capacidade | Política | Execução |
|---|---|---|
| Instalação/reparo do Runtime | Launcher | Launcher |
| Providers e modelos | Launcher | Stage (executa transporte) |
| Credenciais | Launcher (cipher) | Launcher escreve; Stage consome por canal |
| Voz: instalação | Launcher | Launcher |
| Voz: configuração | **Launcher** (D-03, ajuste C) | Stage aplica |
| Voz: síntese | Core (orquestra) | Stage main |
| Voz: captura/reprodução | Stage | Stage |
| Permissões de SO | **Launcher** (D-03, ajuste D) | Stage concede na sessão |
| Personagem/animação/jogos | Stage | Stage |
| Multimonitor/overlay | Stage | Stage |
| Memória | Stage | Stage |
| Ciclo de vida do Runtime | Launcher | Runtime (cooperativo) |
| Diagnóstico | Launcher (visão) | ambos |
| Orçamento | — (**não existe**, D-08) | — |

---

## 5. Invariantes (o que prova que a arquitetura está de pé)

| ID | Invariante | Prova |
|---|---|---|
| **I-1** | `@lia/core` não importa `electron` | teste existente (`runtime-boundary.test.ts`) |
| **I-2** | Nenhum `import`/`export` aponta para `lia/core/src/**` fora do pacote | **teste novo** (PLAN-core §5) |
| **I-3** | Todo consumo do Core usa subpath de `exports` | **teste novo** + `tsc` com `moduleResolution: bundler` |
| **I-4** | Renderer sem Node/Electron | teste existente |
| **I-5** | Superfície Electron do main do Launcher restrita aos arquivos de host | teste existente |
| **I-6** | Fechar o Launcher não encerra o Runtime; encerrar o Runtime não encerra o Launcher | **teste novo** (SPEC §9) |
| **I-7** | Só há adoção de Runtime após handshake autenticado + instância + versão | **teste novo** |
| **I-8** | Perfil Chromium ≠ dados de produto, nos dois apps | **teste novo** |
| **I-9** | Um dono de cipher por sessão gerenciada; escrita nunca local no Stage gerenciado | teste existente + **teste novo** |
| **I-10** | Nenhuma capacidade tem dois donos de política | revisão da matriz §4 + canais IPC |

**Regra:** invariante sem teste é intenção. Nenhuma delas pode ser declarada "cumprida" com base
em leitura de código depois da implementação.

---

## 6. Consequências

**Positivas**

- Preserva 77 mil linhas de UI/áudio/3D e todas as capacidades de janela do Stage.
- Permite entregar D-04 (ciclo de vida) e D-05 (Core) **sem** risco de plataforma.
- Mantém um único toolchain (Vue + TS) e um único modelo de segurança (preload +
  `contextIsolation` + `sandbox`).
- Deixa a comparação A/B/C viva, com gatilho numérico em vez de opinião.

**Negativas**

- O pacote continua com dois runtimes (até D-06 provar o contrário).
- Upgrade de Electron vira tarefa dupla (Launcher + Stage) a cada ~6 meses.
- A percepção "Launcher leve" só se sustenta com **medição** (C0) e redução real — não com
  retórica.

**Neutras**

- O Core continua sendo a fonte de regras; nada migra para Rust/C#.

---

## 7. Riscos e mitigação (resumo; completo em `RISKS-DEPENDENCIES-GATES.md`)

| Risco | Mitigação |
|---|---|
| Implementar "fechar ≠ parar" sem adoção → Runtime órfão | CCR + adoção no **mesmo** incremento (SPEC §5) |
| Credencial morre com o Launcher | sessão de credencial com cache em memória (SPEC §6) |
| Superfície do Core quebrar o Stage | ondas com `export` antes de `import` (PLAN-core §4) |
| "D+" virar desculpa para não medir | G-4 com número e prazo de decisão |
| Duplicar a máquina de estados de `lia/` | Q-01 decidida antes de F1 |

---

## 8. Critérios de aceitação do ADR

| # | Critério | Status |
|---|---|---|
| 1 | Decisão registrada com status e condições | **PASS** |
| 2 | Alternativas com motivo de descarte | **PASS** (§3) |
| 3 | Invariantes testáveis | **PASS** (§5) — testes ainda **não escritos** |
| 4 | Consequências negativas declaradas | **PASS** (§6) |
| 5 | Nenhuma implementação feita nesta rodada | **PASS** |
| 6 | Gate de framework continua aberto | **PASS** (D-07) |

---

## 9. Reversão

D+ é o estado atual **mais** fronteiras. Reverter qualquer fase é reverter um commit de
documentação/contrato; nenhuma fase remove o AIRI, o Stage ou o Electron. A única mudança de
comportamento (D-04) nasce atrás de flag e volta com um restart.

---

## 10. Referências

- Auditoria: [`docs/reports/LIA-DESKTOP-ARCHITECTURE-AUDIT-2026-11-16.md`](../../reports/LIA-DESKTOP-ARCHITECTURE-AUDIT-2026-11-16.md)
- Decisão anterior: [`docs/reports/LIA-DESKTOP-RUNTIME-ARCHITECTURE-DECISION.md`](../../reports/LIA-DESKTOP-RUNTIME-ARCHITECTURE-DECISION.md)
- Contrato existente sem consumidor: [`lia/core/src/lifecycle.ts`](../../../lia/core/src/lifecycle.ts), [`lia/core/src/protocol.ts`](../../../lia/core/src/protocol.ts)
- Plano de migração histórico: [`docs/architecture/LIA-MIGRATION-PLAN.md`](../LIA-MIGRATION-PLAN.md)
