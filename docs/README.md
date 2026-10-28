# docs/ — índice

Índice dos documentos do produto (fora do `airi/` vendado). Cada linha
abaixo tem um papel distinto. Se você procura **onde o projeto está agora**, não
é aqui — é [`project/CURRENT-STATE.md`](project/CURRENT-STATE.md), §0.

Ordem de leitura de uma sessão nova: `CURRENT-STATE.md` §0 → `AGENTS.md` §6 →
o documento da área que você vai tocar.

---

## Estado e processo

| Documento | Papel |
|---|---|
| [`project/CURRENT-STATE.md`](project/CURRENT-STATE.md) | **Fonte de verdade operacional.** §0 é o cabeçalho de estado; o resto é histórico consultável |
| [`project/QUANTO-FALTA.md`](project/QUANTO-FALTA.md) | **O que resta**, separado em "agente faz sozinho" e "exige o Windows do Dev" |
| [`project/DEVFLOW.md`](project/DEVFLOW.md) | O pipeline DevFlow: estágios, marcadores, vereditos, retenção |
| [`qa-benchmark.md`](qa-benchmark.md) | O harness de benchmark Windows (`Tests/LiaBenchmark.bat`) |
| [`airi-modificacoes-registro.md`](airi-modificacoes-registro.md) | O que a Lia modificou no AIRI vendado, e o risco de re-aplicação |
| [`product/RELEASE-WINDOWS-2026-10-20.md`](product/RELEASE-WINDOWS-2026-10-20.md) | Inventário de recursos, gates executados e checklist da finalização Windows |
| [`compatibility/MATRIX.md`](compatibility/MATRIX.md) | Compatibilidade por plataforma, com evidência e limitações |

## Sessão de trabalho

| Documento | Papel |
|---|---|
| [`1-PARA-Lia-Project/LEIA-ME-SESSAO.md`](1-PARA-Lia-Project/LEIA-ME-SESSAO.md) | Entrada da pasta entregue pelo Dev |
| [`1-PARA-Lia-Project/GUIA-LIA-PROJECT.md`](1-PARA-Lia-Project/GUIA-LIA-PROJECT.md) | Como a sessão deve trabalhar (Parte A) e o que construir (Parte B) |
| [`1-PARA-Lia-Project/GLOSSARIO.md`](1-PARA-Lia-Project/GLOSSARIO.md) | Vocabulário do projeto |
| [`1-PARA-Lia-Project/PADRAO-DA-MARCA.md`](1-PARA-Lia-Project/PADRAO-DA-MARCA.md) | Identidade visual da Lia |
| [`product/HANDOFF-PROMPT.md`](product/HANDOFF-PROMPT.md) | Prompt de handoff copiável + armadilhas históricas |

## Skills de agentes

| Documento | Papel |
|---|---|
| [`architecture/AGENT-SKILLS-CATALOG.md`](architecture/AGENT-SKILLS-CATALOG.md) | Auditoria por conteúdo das 28 skills do AIRI, conflitos, decisões de migração e skills independentes da Lia |

## Arquitetura

| Documento | Papel |
|---|---|
| [`architecture/LIA-ARCHITECTURE.md`](architecture/LIA-ARCHITECTURE.md) | Arquitetura alvo da Lia |
| [`architecture/AIRI-COMPARISON.md`](architecture/AIRI-COMPARISON.md) | **AIRI limpo × AIRI da Lia**, medido contra clone em `2c1e223`: 353 criados, 95 modificados, 0 removidos |
| [`architecture/LIA-STAGE-ARCHITECTURE.md`](architecture/LIA-STAGE-ARCHITECTURE.md) | Os três níveis do Stage (próprio / reutilizado / terceiro) e os contratos |
| [`architecture/LIA-MIGRATION-PLAN.md`](architecture/LIA-MIGRATION-PLAN.md) | Ordem da migração para `lia/`, critério de rollback e gate honesto |
| [`architecture/AIRI-UPDATE-REVIEW-2026-10-28.md`](architecture/AIRI-UPDATE-REVIEW-2026-10-28.md) | O que a stable `v0.13.0` traz de útil à Lia, classificado; análise, sem integração |
| [`architecture/LIA-INTEGRATION-PLAN.md`](architecture/LIA-INTEGRATION-PLAN.md) | Plano de integração com o AIRI |
| [`architecture/AIRI-ANALYSIS.md`](architecture/AIRI-ANALYSIS.md) | Auditoria da base AIRI (Fase 0) |
| [`architecture/M1-IMPLEMENTATION-PLAN.md`](architecture/M1-IMPLEMENTATION-PLAN.md) | Plano de implementação M1 |
| [`architecture/M1-PHASE2-VALIDATION.md`](architecture/M1-PHASE2-VALIDATION.md) | Validação da Fase 2 |
| [`architecture/M1-PHASE2-QA-FINDINGS.md`](architecture/M1-PHASE2-QA-FINDINGS.md) | Achados de QA da Fase 2 |
| [`architecture/M1-PHASE2-QA-WINDOW-SIZING.md`](architecture/M1-PHASE2-QA-WINDOW-SIZING.md) | Dimensionamento de janela, Fase 2 |
| [`architecture/LIA-HOME-STAGE-VISUAL-INVESTIGATION.md`](architecture/LIA-HOME-STAGE-VISUAL-INVESTIGATION.md) | Investigação visual do Home/Stage |

## Design e UX

| Documento | Papel |
|---|---|
| [`design/LIA-UI-DESIGN-SYSTEM.md`](design/LIA-UI-DESIGN-SYSTEM.md) | Design system |
| [`design/concepts/README.md`](design/concepts/README.md) | Conceitos visuais |
| [`product/UX.md`](product/UX.md) | Princípios de UX |
| [`product/lia-product-ui-spec.md`](product/lia-product-ui-spec.md) | Especificação de UI do produto |
| [`product/lia-ui-implementation-roadmap.md`](product/lia-ui-implementation-roadmap.md) | Roadmap de implementação de UI |

## Produto — especificações vivas

| Documento | Papel |
|---|---|
| [`product/ESPECIFICACAO-GERAL-DO-PRODUTO-LIA.md`](product/ESPECIFICACAO-GERAL-DO-PRODUTO-LIA.md) | **Visão geral do produto:** funcionalidades, estados conhecidos, prioridades e critérios de conclusão |\n| [`product/M1-SCOPE.md`](product/M1-SCOPE.md) | Escopo M1 |
| [`product/M1-I18N-DEBT.md`](product/M1-I18N-DEBT.md) | Dívida de i18n |
| [`product/M1-PERSONAL-VOICE-ARCHITECTURE.md`](product/M1-PERSONAL-VOICE-ARCHITECTURE.md) | Arquitetura de voz pessoal |
| [`product/M1-CUSTOM-VOICE-LICENSING.md`](product/M1-CUSTOM-VOICE-LICENSING.md) | Licenciamento de voz customizada |
| [`product/LIA-SECURITY-PERMISSIONS-WINDOWS-TRUST.md`](product/LIA-SECURITY-PERMISSIONS-WINDOWS-TRUST.md) | Permissões e confiança no Windows |
| [`product/EXTERNAL-BENCHMARKS-NECTAR-ALFRED.md`](product/EXTERNAL-BENCHMARKS-NECTAR-ALFRED.md) | Benchmarks externos de referência |

## Produto — histórico de rodadas

Registro do que foi feito em cada rodada. **Não é estado corrente** — para isso
existe o `CURRENT-STATE.md`. Novos relatórios de rodada entram aqui.

- [`M1-AIRI-WELCOME-GATE-REMOVAL`](product/M1-AIRI-WELCOME-GATE-REMOVAL.md)
- [`M1-ALLTALK-INSTALL-AUDIT`](product/M1-ALLTALK-INSTALL-AUDIT.md)
- [`M1-CUSTOM-VOICE-PHASE3-REPORT`](product/M1-CUSTOM-VOICE-PHASE3-REPORT.md)
- [`M1-CUSTOM-VOICE-PHASE4-REPORT`](product/M1-CUSTOM-VOICE-PHASE4-REPORT.md)
- [`M1-CUSTOM-VOICE-PHASE5-REPORT`](product/M1-CUSTOM-VOICE-PHASE5-REPORT.md)
- [`M1-PERSONAL-VOICE-ALLTALK-XTTS`](product/M1-PERSONAL-VOICE-ALLTALK-XTTS.md)
- [`M1-PHASE3-PLAN`](product/M1-PHASE3-PLAN.md)
- [`M1-PHASE3-DEFECTFIX-DESIGN`](product/M1-PHASE3-DEFECTFIX-DESIGN.md)
- [`M1-PHASE4-PLAN`](product/M1-PHASE4-PLAN.md)
- [`M1-PHASE4E2-VOICE-PLAN`](product/M1-PHASE4E2-VOICE-PLAN.md)
- [`M1-PHASE4E2-VOICE-ROUND2-REPORT`](product/M1-PHASE4E2-VOICE-ROUND2-REPORT.md)
- [`M1-PHASE4E2-VOICE-ROUND3-QA`](product/M1-PHASE4E2-VOICE-ROUND3-QA.md)
- [`M1-PHASE5-ARCHIVE-EXTRACTION-FIX`](product/M1-PHASE5-ARCHIVE-EXTRACTION-FIX.md)
- [`M1-PHASE5-R2-RUN-SETUP-AND-PROGRESS-UI`](product/M1-PHASE5-R2-RUN-SETUP-AND-PROGRESS-UI.md)
- [`M1-PHASE5-R3-MINICONDA-SILENT-INSTALL`](product/M1-PHASE5-R3-MINICONDA-SILENT-INSTALL.md)
- [`M1-PHASE5-R4-MINICONDA-EXIT2-E-PROGRESS-UI`](product/M1-PHASE5-R4-MINICONDA-EXIT2-E-PROGRESS-UI.md)
- [`M1-PHASE5-R5-EXIT2-INTEGRIDADE-E-PATH`](product/M1-PHASE5-R5-EXIT2-INTEGRIDADE-E-PATH.md)
- [`M1-PHASE5-R6-RUNTIME-ROOT-SANITIZADO`](product/M1-PHASE5-R6-RUNTIME-ROOT-SANITIZADO.md)
- [`M1-PHASE5-R7-CONTINUACAO-OFICIAL-E-ROOT-LOCAL`](product/M1-PHASE5-R7-CONTINUACAO-OFICIAL-E-ROOT-LOCAL.md)
- [`M1-PHASE5-R7-UI-HOTFIX-ACAO-PRIMARIA`](product/M1-PHASE5-R7-UI-HOTFIX-ACAO-PRIMARIA.md)
- [`M1-PHASE5-R7-UI-HOTFIX3-CLICK-TRACE`](product/M1-PHASE5-R7-UI-HOTFIX3-CLICK-TRACE.md)
- [`M1-PHASE5-R7-UI-HOTFIX4-ROOT-LOCALAPPDATA`](product/M1-PHASE5-R7-UI-HOTFIX4-ROOT-LOCALAPPDATA.md)
- [`M1-VOICE-ROUND4-REPORT`](product/M1-VOICE-ROUND4-REPORT.md)

Todos em [`product/`](product/).

## AIRI upstream

| Documento | Papel |
|---|---|
| [`estudo-airi.md`](estudo-airi.md) | Estudo completo do AIRI `v0.12.0-beta.5` — **fonte de verdade** sobre o upstream |
| [`upstream/AIRI-INTEGRATION.md`](upstream/AIRI-INTEGRATION.md) | M0-A: bootstrap do AIRI no repositório |
| [`upstream/LIA-IDENTITY-PATCH.md`](upstream/LIA-IDENTITY-PATCH.md) | Patch de identidade Lia sobre o AIRI |

## Licenças

| Documento | Papel |
|---|---|
| [`licenses/THIRD-PARTY-NOTICES.md`](licenses/THIRD-PARTY-NOTICES.md) | Avisos de terceiros |
| [`licenses/ASSET-LICENSES.md`](licenses/ASSET-LICENSES.md) | Licenças de assets |

---

Fora de `docs/`: [`../AGENTS.md`](../AGENTS.md) (master agent prompt, 99 seções),
[`../README.md`](../README.md) (status do projeto), [`../Tests/README.md`](../Tests/README.md)
(harness de QA) e [`../tools/README.md`](../tools/README.md) (ferramentas).
