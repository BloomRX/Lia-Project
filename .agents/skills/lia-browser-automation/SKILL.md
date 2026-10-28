---
name: lia-browser-automation
description: Automatiza navegador e renderer de Electron com agent-browser/CDP para investigação, testes exploratórios e QA. Use somente quando a ferramenta estiver instalada e a aplicação tiver sido iniciada com depuração acessível.
compatibility: Requer agent-browser instalado e endpoint CDP ativo; não instala ferramentas automaticamente.
---
# Automação de navegador e renderer
1. Leia AGENTS.md e confirme comando, porta CDP e perfil isolado da aplicação.
2. Confirme a CLI com `agent-browser --help` e leia `agent-browser skills get core` antes de usar comandos.
3. Não assuma a porta padrão. Descubra-a pelo comando de inicialização real.
4. Para Electron, enumere `/json/list` no endpoint CDP e escolha o alvo por URL, título e estado visível. Não confie só na ordem das abas.
5. Use snapshots de acessibilidade e seletores semânticos antes de CSS ou coordenadas. Refaça snapshots após mudanças de tela.
6. Para várias janelas, mapeie alvos CDP e confirme URL, título e snapshot antes de agir.
7. Não altere o estado interno via eval para fazer um teste passar. Instrumentação diagnóstica não prova o fluxo do usuário.
8. Upload, processamento, persistência e renderização são verificações separadas.
9. Use perfis de teste e dados sintéticos. Não exponha cookies, tokens, transcrições ou nomes privados nos logs.
10. Feche sessões e encerre apenas processos iniciados para o teste. Não use `close --all` contra sessões compartilhadas ou de outros agentes.
Registre comando, alvo, estado esperado, resultado e erros. Screenshot não prova teclado, acessibilidade ou backend. Se CDP não estiver disponível, reporte BLOCKED; não alegue que a UI foi testada.
