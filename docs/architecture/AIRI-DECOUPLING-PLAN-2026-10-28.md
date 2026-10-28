# Plano de execução — desacoplar a Lia do AIRI

**Data:** 28/10/2026 · **Natureza:** planejamento. **Nada foi implementado.**
Report principal: [`AIRI-INDEPENDENCE-2026-10-28.md`](AIRI-INDEPENDENCE-2026-10-28.md).

Este documento transforma as conclusões daquele relatório em etapas executáveis,
cada uma com critério objetivo de conclusão. Não repete a investigação.

---

## Resumo em uma linha

O trabalho **barato** (etapas 1–2, 8) entrega um produto que constrói e roda
sozinho, sem o AIRI. O trabalho **caro** (4–6) é a experiência do usuário. O
Codex só se torna indispensável na **etapa 3**.

---

## Grupo A — Arena.ai

Trabalho mecânico, verificável por build ou por `grep`, com teste claro.

### A1 — Registrar a arquitetura-alvo em `AGENTS.md`

| Campo | Valor |
| --- | --- |
| Resultado | `AGENTS.md` §6–§7 deixa de mandar depender do AIRI e passa a descrevê-lo como referência histórica |
| Arquivos | `AGENTS.md` (§6, §7), `docs/project/CURRENT-STATE.md` §0 |
| Pré-requisito | **decisão do dono** (o rulebook atual contradiz esta missão) |
| Risco | baixo — texto; alto se ficar ambíguo, porque todo agente segue esse arquivo |
| Teste | revisão do dono; nenhum automatizável |
| Concluído quando | o documento e a missão dizem a mesma coisa |
| Independente? | **sim**, e deve ser a primeira |

### A2 — Catálogo e workspace próprios

| Campo | Valor |
| --- | --- |
| Resultado | `@lia/core` e o Launcher constroem com um `pnpm-workspace.yaml` na raiz de `Lia-Project`, sem tocar em `airi/` |
| Arquivos | raiz: `package.json`, `pnpm-workspace.yaml`, `.npmrc`; `core/`, `launcher/` |
| Pré-requisito | A1 |
| Risco | **médio** — 495 entradas de catálogo no AIRI; só as usadas importam |
| Teste | `pnpm install` limpo + `pnpm -F @lia/core build` + `electron-vite build` |
| Concluído quando | os dois constroem numa árvore sem `airi/` |
| Independente? | sim, desde que A1 exista |

### A3 — Tooling apontando para os caminhos novos

| Campo | Valor |
| --- | --- |
| Resultado | preflight, prereq, DevFlow, QA e `kokoro-smoke` deixam de exigir `airi/` |
| Arquivos | `tools/devflow/{preflight,lia_core_prereq,sync}.py`, `tools/devflow/rounds/m3_0b.json`, `tools/{lia_dev,project_cli}.py`, `tools/kokoro-smoke.mjs`, `Tests/tools/*.mjs` (11), `Lia.bat` |
| Pré-requisito | A2 (os caminhos precisam existir antes de apontar) |
| Risco | médio — 20+ arquivos, vários com caminho fixo |
| Teste | `python -m unittest tools.test_lia_dev tools.test_project_cli`; `node --test Tests/tools/*.test.mjs` |
| Concluído quando | `grep -rn "airi/" tools/ Tests/ Lia.bat` não retorna caminho executável |
| Independente? | sim, depois de A2 |

### A4 — Instalador próprio

| Campo | Valor |
| --- | --- |
| Resultado | electron-builder configurado para `lia/`, gerando `Lia-<versão>-setup.exe` |
| Arquivos | novo `electron-builder.config.ts` na raiz ou em `launcher/`; `lia/assets/icons` |
| Pré-requisito | **etapa B2** (precisa haver uma app para empacotar) |
| Risco | médio — assinatura, ícones, caminhos de recurso |
| Teste | gerar o instalador e instalar em Windows real |
| Concluído quando | app instalado abre, conversa e fecha sem órfão |
| Independente? | **não** — depende de B2 |

---

## Grupo B — Codex

Trabalho arquitetural, com risco de regressão em funcionalidade que o dono já
validou.

### B1 — Porta `LiaChatPort` sobre `@xsai/*`

| Campo | Valor |
| --- | --- |
| Resultado | conversa com IA servida por código da Lia, sem `@proj-airi/core-agent` |
| Arquivos | `core/src/chat/*` (novo), adaptador `@xsai`, consumo no launcher/stage |
| Pré-requisito | A2; entender os patches da Lia em `chat-orchestrator-runtime.ts` |
| Risco | **alto** — é onde vivem as correções caras: perda de espaço, resposta vazia, recusa de imagens, política de falha |
| Teste | os testes atuais de `core-agent` portados; o teste de granularidade do dono **tem** que continuar verde |
| Concluído quando | conversa funciona em Windows real e os patches estão cobertos |
| Independente? | sim, mas é o **primeiro ponto que exige Codex** |

### B2 — Stage próprio: janela, chat e configuração

| Campo | Valor |
| --- | --- |
| Resultado | Stage abre, renderiza, conversa e fecha — sem avatar |
| Arquivos | `lia/stage/*` (hoje placeholder de 22 linhas de HTML) |
| Pré-requisito | B1 (precisa de conversa para exibir) |
| Risco | **alto** — é a superfície de UI |
| Teste | abrir, conversar, fechar; conferir processos no Windows |
| Concluído quando | o fluxo `Lia.bat → janela → conversa → fechar` roda sem AIRI |
| Independente? | não — depende de B1 |

### B3 — Voz

| Campo | Valor |
| --- | --- |
| Resultado | TTS (Kokoro, já em `@lia/core`) e STT no Stage próprio |
| Arquivos | `lia/stage`, `core/src/voice/*` |
| Pré-requisito | B2 |
| Risco | alto — áudio é difícil de validar sem máquina real |
| Teste | ouvir a fala; interromper; conferir que não trava |
| Concluído quando | fala e escuta funcionam em Windows real |
| Independente? | não |

### B4 — Avatar

| Campo | Valor |
| --- | --- |
| Resultado | personagem VRM ou Live2D renderizando sobre biblioteca independente |
| Arquivos | `lia/stage` (renderer) |
| Pré-requisito | B2; **licença do modelo registrada** |
| Risco | alto — 3D, GPU, empacotamento de assets |
| Teste | modelo carrega, anima, fecha sem vazar |
| Concluído quando | personagem aparece e responde |
| Independente? | não |

---

## Grupo C — Bloqueado por decisão ou evidência

| # | Item | O que falta |
| --- | --- | --- |
| **C1** | Aprovar a mudança de arquitetura | decisão do dono — `AGENTS.md` §6–§7 hoje diz o contrário |
| **C2** | Escolher A/B/C para o `stage-ui` | medir quanto do `stage-ui` a Lia realmente alcança |
| **C3** | Remover `airi/` | todos os critérios de §8 do report principal |
| **C4** | Gate de Windows | o dono precisa executar; nenhum agente na nuvem aprova |
| **C5** | Licenças de modelos/avatar | auditoria não feita (`LIA-STAGE-ARCHITECTURE.md` §7) |

`C1` bloqueia **A1**, que bloqueia todo o resto. É o gargalo real do projeto —
não é técnico.

---

## Ordem recomendada

```text
C1 (decisão)
 └─ A1 (AGENTS.md)
     └─ A2 (workspace próprio)   ← primeiro valor: constrói sozinho
         ├─ A3 (tooling)
         └─ B1 (LiaChatPort)     ← primeiro ponto que exige Codex
             └─ B2 (Stage)
                 ├─ B3 (voz)
                 └─ B4 (avatar)
                     └─ A4 (instalador)
                         └─ C3 (remover airi/)
```

### Primeira etapa de baixo risco para começar

**A2** (depois de A1). É mecânica, verificável por um build que passa ou falha,
não toca em nenhuma lógica da Lia e não altera `airi/`. Entrega imediata: a Lia
constrói sem depender do workspace do AIRI.

### Primeiro ponto em que o Codex se torna necessário

**B1** — a porta de conversa. Antes disso, tudo é caminho e configuração. Em B1
começa a decisão sobre o que preservar das correções que o dono já pagou caro
para encontrar (perda de espaço, resposta vazia, recusa de imagens).

---

## O que este plano deliberadamente não faz

- Não estima prazo nem esforço — nada aqui foi cronometrado.
- Não escolhe biblioteca de avatar sem antes medir o que a Lia usa (`C2`).
- Não propõe reescrita integral: cada etapa deixa o app utilizável.
- Não remove `airi/` cedo, mesmo sendo o objetivo final.
