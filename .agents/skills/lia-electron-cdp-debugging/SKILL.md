---
name: lia-electron-cdp-debugging
description: Descobre a janela renderer correta de um app Electron por CDP quando há várias janelas, rotas duplicadas ou alvos criados sob demanda.
---
# Diagnóstico CDP para Electron
1. Confirme que o processo foi iniciado com a opção de depuração aprovada. Não habilite CDP em produção como atalho.
2. Consulte `/json/version` e `/json/list` na porta real da sessão.
3. Ignore alvos `worker` e `devtools://` quando o objetivo for uma janela de produto.
4. Associe alvo a URL, título, rota e estado visível. URLs duplicadas exigem screenshot/snapshot ou leitura do código de janelas.
5. Em janelas criadas sob demanda, acione a interface real e enumere os alvos novamente.
6. Conecte agent-browser ao alvo escolhido e confirme URL, título e snapshot antes de agir.
7. Se o alvo não aparece, diferencie janela não criada, renderer não carregado e alvo não exposto.
8. Não navegue um renderer desconhecido para uma rota esperada; isso pode mascarar a janela errada.
Registre alvo e estado. Feche somente sessões e processos criados para o teste. Eval que altera estado interno não prova que o fluxo do usuário funciona.
