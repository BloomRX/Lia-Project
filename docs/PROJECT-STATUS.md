# Lia — estado conhecido do projeto

**Fotografia documental:** 14/11/2026. Proveniência detalhada em `DOCS_VERSION`.

## Estado reportado na fonte
A fonte `docs/project/CURRENT-STATE.md` na origem descrevia, em 13/11:
- Correções de sandbox do Stage e endurecimento da seleção gerenciada de providers.
- Janelas Electron do Stage e desktop overlay com `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false` e preload controlado.
- Suítes direcionadas, typechecks e builds de Core/Launcher/Stage reportados como aprovados naquela rodada.
- Reteste Stage reportado com 214 arquivos, 2.557 testes e 4 skips.
- A validação ponta a ponta da aplicação Stage pelo fluxo oficial `Lia.bat` ainda não estava comprovada.
- AI Settings, conversa real, tool calling, voz e verificações C0–C4 permaneciam sem prova ponta a ponta na fotografia descrita.
- A Lia não estava aprovada como ponta a ponta.

## Limitações
- Estes dados são um retrato histórico do documento de estado, não uma validação executada por esta branch.
- O HEAD do desenvolvimento deve ser verificado com Git; não inferir o tip pelo documento.
- Mudanças locais não commitadas e arquivos não rastreados podem existir no sandbox de uma sessão e não aparecer no GitHub.
- Para trabalho de implementação ou auditoria de segurança, consulte o código e os relatórios atuais na branch `lia/development` e confirme os resultados.

## Próximo passo recomendado
Antes de qualquer conclusão de prontidão, consultar o `CURRENT-STATE.md` atual e o gate de release/validação Windows correspondente.
