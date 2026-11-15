---
name: lia-agent-orchestration
description: Divide trabalho entre agentes, subagentes ou workers com escopo e contexto mínimos, escolhe a capacidade adequada à tarefa e evita conflito de escrita e retrabalho. Use ao delegar, paralelizar, dividir uma tarefa grande em etapas, escolher modelo ou nível de raciocínio, ou ao revisar o que um worker devolveu.
compatibility: A seleção de modelo e esforço depende do runner e não é garantida pelo repositório. Alethe exige CLI externa instalada e autenticada.
---
# Orquestração de agentes na Lia

Política completa e a medição que a sustenta: `docs/project/AGENT-ORCHESTRATION.md`.
Se as duas divergirem, a política vence e este arquivo é o defeito.

## Quando isto vale

Vale quando há mais de um agente, mais de uma etapa, ou uma escolha de capacidade
a fazer. **Não vale** para tarefa mecânica de um arquivo só: execute, teste com o
L1 e entregue.

## 1. O brief tem oito campos

Sem qualquer um deles, o brief volta para quem escreveu:

1. objetivo em uma frase verificável;
2. contexto indispensável — fatos, não histórico da conversa;
3. caminhos exatos, marcados **leitura** ou **escrita**;
4. restrições (o que não tocar, não instalar, não publicar);
5. critério de conclusão;
6. comando de teste e o que conta como evidência;
7. formato de retorno (abaixo);
8. faixa de capacidade desejada (T0 econômica … T5 avançada com raciocínio alto).

Não copie o contexto inteiro de um agente para outro. Se a informação não muda o
que o agente faz, ela não entra no brief.

## 2. O retorno tem seis campos

o que investigou/implementou · arquivos alterados · decisões · testes (comando →
resultado → código de saída) · problemas e limites · próximo passo.

Sem despejo de log, sem "tudo certo" sem comando, sem conclusão que o worker não
verificou. `NÃO EXECUTADO` com motivo é uma resposta válida; inventar PASS não é.

## 3. Propriedade

Um escritor por caminho, por rodada. Investigue read-only; só escreve quem recebeu
caminho de escrita. Quem precisa sair do próprio conjunto **para e reporta**.
`AGENTS.md`, `docs/project/` e `.github/` têm um dono: o agente principal.

## 4. Capacidade por evidência

Faixa alta só por: tentativa anterior falhou com causa identificada, ambiguidade
em que errar custa mais que demorar, ou segredo/permissão/perda de dados.
"É importante" não é motivo. Tarefa mecânica em faixa alta é desperdício — quebre
em unidades e mande na baixa.

## 5. Testes sem retrabalho

L1 sempre · L2 quando atravessa módulo · L3 só em ponto de validação. Um resultado
vale enquanto commit, comando, diretório e árvore não mudarem. Nunca `--fix` global
com escritor paralelo. Nunca `| tail` escondendo código de saída.

## 6. Alethe

Antes de usar: `python3 .agents/skills/alethe/scripts/orchestrate.py doctor`.
`installedProviders` vazio significa que não há worker — divida a tarefa e execute
direto. Não instale CLI para deixar checklist verde. Orçamento de tokens do Alethe
é contabilizado depois: limite real é `--max-calls` e prazo.
