# Evidências — auditoria UI/UX Lia (14/11/2026)

Esta pasta acompanha o relatório [`../../LIA-UI-UX-AUDIT-2026-11-14.md`](../../LIA-UI-UX-AUDIT-2026-11-14.md).

## Artefatos

| Arquivo | O que é | Limite |
|---|---|---|
| `WIREFRAMES-LIA.html` | Wireframes estáticos W1–W8, autocontidos, pt-BR, sem script/CDN. | Proposta visual; não é captura do runtime nem prova de acessibilidade/desempenho. |
| `static-checks.json` | Checagens estáticas executadas nesta rodada: equivalência de SHA, 11 entregáveis, HTML, contraste sRGB e view-model puro. | Não substitui teste em navegador/Electron/Windows. |
| `manifest.json` | Proveniência, hashes, mapa dos 11 entregáveis e status dos gates. | Documento de auditoria; não promove baseline. |

## Como abrir

Abra `WIREFRAMES-LIA.html` em um navegador local. Ele não faz requisições externas, não executa script e não se conecta ao produto. Os controles desenhados são ilustrativos; a navegação interna usa apenas âncoras.

## SHA e equivalência

- SHA de referência solicitado: `5ec464edf410008e390e2da4aff32d32537eb69d`.
- Checkout local inspecionado: `7cb81720552a822a03f36ac6ce5f2e20b009f84c`.
- O delta completo entre os dois é apenas documental (`docs/project/CURRENT-STATE.md` e `docs/reports/LIA-BRANCH-AUDIT-2026-11-14.md`).
- O delta nos caminhos de UI/código auditados é vazio; por isso os achados de código valem para o SHA de referência.

## Gates

- Runtime Windows, browser/a11y e desempenho C0–C4: **BLOCKED/NOT TESTED** neste sandbox.
- Nenhuma implementação, IPC, arquitetura, componente existente ou tecnologia foi alterada.
- A entrega aguarda revisão do Agente Principal antes de qualquer implementação.
