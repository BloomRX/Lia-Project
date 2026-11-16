# Decisões de arquitetura do desktop — índice

**Rodada:** 16/11/2026 · **Commit base:** `8558c2c` (relatório de auditoria) · **Branch:** `arena/7fa837f0-lia-project`
**Natureza:** documentação e parecer. **Nenhuma implementação funcional foi feita** — nem migração
de framework, nem runtime único, nem orçamento de recursos.

Este pacote transforma os achados de
[`LIA-DESKTOP-ARCHITECTURE-AUDIT-2026-11-16`](../../reports/LIA-DESKTOP-ARCHITECTURE-AUDIT-2026-11-16.md)
em decisões formais, critérios verificáveis e planos executáveis por terceiros.

## Documentos

| # | Documento | Contém |
|---|---|---|
| 1 | [`DECISION-RECORD-2026-11-16.md`](DECISION-RECORD-2026-11-16.md) | **D-01…D-08** com status, condições, consequências e sign-off; **Q-01…Q-06** abertas |
| 2 | [`ADR-0001-desktop-runtime-d-plus.md`](ADR-0001-desktop-runtime-d-plus.md) | ADR da arquitetura-alvo **D+**: contexto, decisão, consequências, invariantes |
| 3 | [`SPEC-launcher-runtime-lifecycle.md`](SPEC-launcher-runtime-lifecycle.md) | Ciclo de vida Launcher↔Runtime, operações, descoberta, canal autenticado, segurança |
| 4 | [`PLAN-core-public-surface.md`](PLAN-core-public-surface.md) | Fechamento da superfície pública do Core: inventário real, subpaths, ondas, testes |
| 5 | [`PLAN-shared-electron-binary-experiment.md`](PLAN-shared-electron-binary-experiment.md) | Experimento do binário compartilhado: desenho, PASS/FAIL, rollback |
| 6 | [`BENCHMARK-C0-C8-windows.md`](BENCHMARK-C0-C8-windows.md) | Protocolo de medição no Windows 11 com o hardware de referência |
| 7 | [`RISKS-DEPENDENCIES-GATES.md`](RISKS-DEPENDENCIES-GATES.md) | Riscos, dependências entre fases, gates G-0…G-5 |

## Como ler

1. Quem decide lê o **registro de decisões** e a seção de sign-off.
2. Quem implementa lê a **SPEC** (lifecycle) e o **PLAN** da sua área.
3. Quem mede lê o **BENCHMARK** e usa o modelo de evidência do §7.
4. Quem coordena lê **RISCOS/DEPENDÊNCIAS/GATES**.

## Legenda de status

| Status | Significado |
|---|---|
| **APPROVED** | Decisão tomada; vigente. Pode não ter código ainda. |
| **APPROVED WITH CONDITIONS** | Decisão tomada **sob condições nomeadas**; nenhuma condição pode ser omitida sem nova decisão. |
| **REJECTED** | Proposta recusada, com motivo e data. Não reabrir sem evidência nova. |
| **OPEN** | Sem decisão. Não implementar. |

## Regra de honestidade

Nenhuma medição de RAM, CPU, GPU, FPS, boot ou encerramento foi produzida nesta rodada: o
ambiente é Linux, sem display e sem GTK, e o Stage não builda aqui. Todo número deste pacote é
**MEDIDO** (com comando reproduzível), **CÓDIGO** (com `arquivo:linha`), **DOCUMENTAL** (fonte
primária citada), **ESTIMATIVA** (base declarada) ou **HIPÓTESE**. O que não existe está escrito
**NÃO EXECUTADO** — e não pode ser preenchido por analogia.
