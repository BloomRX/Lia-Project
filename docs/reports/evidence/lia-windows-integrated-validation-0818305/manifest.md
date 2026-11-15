# Evidências — validação integrada Windows

- Rodada: 13/11/2026; horário local UTC-03.
- Código sob teste: `08183053d0c0ffbfe3bc0cfe3e613e1aa21f8dab`, branch
  `arena/01a10290-lia-project`.
- Resultado detalhado: [relatório integrado](../../LIA-WINDOWS-INTEGRATED-VALIDATION.md).
- Perfil isolado usado no boot: [lia-product.json](./test-profile/lia-product.json).
  Contém apenas locale `pt-BR` e `voice.enabled=false`; nenhum segredo/token.
- Boot pelo `.\Lia.bat`: janela “Lia” responsiva, log `renderer-ready` em +791 ms.
  Fechamento gracioso, exit code 0; nenhum PID Electron associado à sessão permaneceu.
- A saída completa dos testes/builds não foi arquivada como log bruto nesta pasta. As
  contagens, skips e limitações foram transcritas do resultado observado e estão na §B do
  relatório; não reconstruir logs que não foram preservados.
- Perfil real `%APPDATA%\Lia`: ausência de `lia-product.json` e `lia-secrets.json` na
  inspeção; nenhum conteúdo de credencial foi lido.
- Worktree inicial já possuía alterações não commitadas. As mudanças OIDC/chat e os
  artefatos fora desta rodada foram preservados e não fazem parte do commit documental.
- Nenhum screenshot foi capturado. Computer Use não estava disponível; CDP não configurado;
  `agent-browser` não instalado.
