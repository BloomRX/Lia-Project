---
name: lia-eventa-ipc
description: Usa @moeru/eventa para eventos tipados, RPC ou streaming quando a dependência estiver presente.
license: MIT
---
# Eventa e fronteiras IPC
1. Confirme que `@moeru/eventa` está instalado e que a versão local expõe os imports necessários. Não adicione a biblioteca por padrão.
2. Defina eventos e contratos compartilhados num módulo comum; mantenha tipos de requisição/resposta explícitos.
3. Valide payloads na fronteira. Eventa transporta dados, mas não substitui validação, autorização nem controle de acesso.
4. Trate erros, cancelamento, timeout, fechamento de canal e limpeza de listeners. Em streaming, preserve ordem e teste cancelamento.
5. Evite handlers duplicados para o mesmo evento/RPC no mesmo contexto.
6. Em Electron, proteja a fronteira main/renderer e não exponha APIs genéricas privilegiadas ao renderer.
7. Escreva testes de contrato e falha de transporte; mock não prova que IPC real funciona.
