# Evidências — auditoria UI/UX Lia (14/11/2026, revisão 2)

Esta pasta acompanha o relatório [`../../LIA-UI-UX-AUDIT-2026-11-14.md`](../../LIA-UI-UX-AUDIT-2026-11-14.md).

## Artefatos

| Arquivo | O que é | Limite |
|---|---|---|
| `WIREFRAMES-LIA.html` | Wireframes estáticos W1–W8, autocontidos, pt-BR, sem script/CDN. Preservados byte a byte desde `e183cba`. | Proposta visual; não é captura do runtime nem prova de acessibilidade/desempenho. |
| `static-checks.json` | Checagens da primeira rodada, referência histórica `5ec464e`. Preservado byte a byte. | Não é evidência de execução no SHA atual. |
| `static-checks-revision-2.json` | Nova rodada: sincronização Git, gate A-1, preservação de artefatos, relatório, contraste sRGB e view-model puro. | Estático/puro; não substitui navegador/Electron/Windows. |
| `check-revision-2.py` | Gerador da nova rodada, apenas com Python padrão, Git e Node já presentes. | Ferramenta de evidência documental; não altera o produto. |
| `manifest.json` | Proveniência, histórico de SHAs, hashes, mapa dos 11 entregáveis e gates. | Documento de auditoria; não promove baseline. |

## Como abrir

Abra `WIREFRAMES-LIA.html` em um navegador local. Ele não faz requisições externas, não executa script e não se conecta ao produto. Os controles desenhados são ilustrativos; a navegação interna usa apenas âncoras.

O cabeçalho do HTML conserva `5ec464edf410008e390e2da4aff32d32537eb69d` porque o arquivo original foi preservado, não regerado. O estado atual do gate de ferramentas está na seção “Revisão 2” do relatório; W7 é direção futura, não afirmação de que o antigo defeito X-03 continua presente.

## SHA e sincronização

- SHA atual auditado: `ae46c495d7da7cd33f4b4da8f4e8cc95b0a867b6`.
- Referência histórica: `5ec464edf410008e390e2da4aff32d32537eb69d`; primeira entrega preservada em `e183cba5c9882dbfc4e297c3550c6ebdc2f90b9a`.
- Merge normal na branch isolada `arena/250b337a-lia-project`: `1d802cc8229cb133710cb79601e8d58870b3fde8`, com pais `e183cba` e `ae46c49`; sem reset/rebase/force push.
- Histórico da principal: `5ec464e` (auditoria) → `f3facdf` (correção A-1) → `ae46c49` (decisão de produto).
- O delta de UI Launcher/Stage permanece vazio; em `stage-ui`, apenas o gate A-1 e testes mudaram. X-03 é histórico/corrigido; UI de ativação e persistência continuam não implementadas por decisão.

## Reproduzir a rodada estática

Na raiz do repositório:

```sh
python3 docs/reports/evidence/lia-ui-ux-audit-2026-11-14/check-revision-2.py
```

O comando reescreve apenas `static-checks-revision-2.json`. Não instala dependências, não inicia o produto e não executa os testes Vitest do Principal. Os 31 testes reportados em `f3facdf` são HISTORICAL-PASS; a rodada atual verifica código, Git, documentos, artefatos, contraste e funções puras.

## Gates

- Runtime Windows, browser/a11y e desempenho C0–C4: **BLOCKED/NOT TESTED** neste sandbox.
- Esta revisão não criou implementação de produto, UI de ativação, IPC, arquitetura, dependência ou mudança de personalidade/voz/provedores. O merge apenas trouxe o trabalho já publicado pelo Principal.
- A proposta aguarda revisão/autorização do Agente Principal antes de qualquer implementação nova.
