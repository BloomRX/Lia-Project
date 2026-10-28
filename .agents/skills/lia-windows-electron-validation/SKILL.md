---
name: lia-windows-electron-validation
description: Valida o comportamento real do Launcher e do Stage Electron da Lia no Windows, incluindo janela visível, processos filhos, logs e encerramento limpo. Use para congelamentos, janela branca, falha ao conversar ou antes de declarar a aplicação funcional.
compatibility: A validação E2E exige Windows e o checkout local. Automação CDP/browser não substitui a inspeção de runtime nem os passos que exigem interação humana.
---

# Validação Windows/Electron da Lia

## 1. Ler as regras existentes

- Leia `.agents/skills/stage-runtime-debugging/SKILL.md`.
- Leia `.agents/skills/lia-release-gate/SKILL.md` se o resultado for usado para decidir release.
- Para automação do renderer, leia `airi/.agents/skills/agent-browser/SKILL.md` e, se necessário, `airi/.agents/skills/agent-browser-electron/SKILL.md`.
- Confirme o comando de inicialização atual em `AGENTS.md` e nos scripts do repositório; não reutilize comandos antigos sem verificar.

## 2. Antes do teste

Registre branch, HEAD, estado do Git, hora, comando exato e processos Electron/Node já existentes. Não encerre processos que já existiam antes da sessão. Confirme que o ambiente e as dependências correspondem à documentação atual.

## 3. Validar o caminho do usuário

1. Inicie o Launcher pelo caminho documentado.
2. Confirme que o Launcher aparece e permanece responsivo.
3. Acione **Conversar com a Lia** pela interface real.
4. Confirme a sequência de build/pré-requisito, spawn, sinal de ready e criação da janela.
5. Confirme que o renderer carrega, que a personagem/conteúdo esperado aparece e que a interface responde a uma interação segura.
6. Colete logs do Launcher e Stage, código de saída e identificadores de processo relevantes.
7. Encerre pela interface normal e confirme que os processos criados pela sessão foram encerrados.

Processo existente, porta aberta, HTTP 200, build concluído ou sinal de ready isolado não prova que o usuário consegue conversar com a Lia.

## 4. Diagnóstico de janela/renderer

- Use CDP/agent-browser somente se o processo tiver sido iniciado com a configuração de depuração apropriada.
- Não suponha que a porta padrão está ativa; inspecione o comando de inicialização.
- Em Electron com várias janelas, identifique o alvo CDP correto e verifique-o com snapshot ou screenshot.
- Se o alvo não existir, confirme se a janela foi criada e se o renderer foi carregado antes de culpar a automação.
- Registre erros de console, falhas de carregamento e o URL/rota observados, sem expor tokens ou dados privados.

## 5. Evidência e veredito

Use PASS somente para os passos realmente executados. Marque como BLOCKED o que exige hardware, credencial ou ambiente ausente; como NOT RUN o que não foi tentado; e como FAIL o que foi executado e falhou. Anexe logs e screenshots quando disponíveis, sem afirmar que foram coletados se não foram.

Não altere timeout, suprima exceções ou mate processos alheios para forçar um resultado verde. Se o problema não for reproduzível ou exigir o PC do usuário, STOP AND REPORT com o próximo experimento seguro.
