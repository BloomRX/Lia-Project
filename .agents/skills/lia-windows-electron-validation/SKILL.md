---
name: lia-windows-electron-validation
description: Valida o comportamento real do Launcher e do Stage Electron da Lia no Windows, incluindo janela visível, processos filhos, logs e encerramento limpo.
compatibility: Exige Windows e checkout local. Automação CDP não substitui interação real do usuário.
---
# Validação Windows/Electron da Lia
## Ler antes de testar
- Leia `.agents/skills/stage-runtime-debugging/SKILL.md`.
- Para automação, leia `.agents/skills/lia-browser-automation/SKILL.md` e `.agents/skills/lia-electron-cdp-debugging/SKILL.md`.
- Confirme o comando atual em `AGENTS.md` e nos scripts.
## Caminho do usuário
1. Registre branch, HEAD, estado Git, comando e processos Electron/Node preexistentes.
2. Inicie o Launcher pelo caminho documentado e confirme responsividade.
3. Acione **Conversar com a Lia** pela interface real.
4. Confirme build/pré-requisito, spawn, ready, criação de janela e renderer carregado.
5. Confirme personagem/conteúdo esperado e uma interação segura.
6. Registre logs, códigos de saída e PIDs relevantes.
7. Encerre pela interface e confirme que processos criados pela sessão terminaram.
Processo existente, porta aberta, HTTP 200, build concluído ou sinal ready isolado não prova que o usuário consegue conversar com a Lia.
## Evidência
Use CDP apenas quando configurado; não assuma porta padrão. Identifique o alvo correto, registre erros sem segredos e classifique PASS, FAIL, BLOCKED ou NOT RUN conforme os passos realmente executados. Não aumente timeout, suprima exceções ou mate processos alheios. Se exigir o PC do usuário, pare e reporte o experimento manual necessário.
