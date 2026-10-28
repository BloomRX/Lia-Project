---
name: lia-vue-testing
description: Escreve e depura testes de componentes Vue, composables, stores Pinia e interfaces DOM. Use ao escrever ou investigar testes de Vue e Pinia.
---
# Testes Vue na Lia
1. Confirme runner, versão, projeto Vitest e comando local. Leia `.agents/skills/lia-test-discipline/SKILL.md`.
2. Para regressões, escreva primeiro um teste que falhe pelo motivo relatado, não por import quebrado ou fixture inválida.
3. Teste comportamento público: texto, estados, eventos e efeitos observáveis. Não dependa de detalhes internos nem de snapshots isolados.
4. Para composables com lifecycle/injection, monte-os num wrapper apropriado.
5. Configure Pinia de teste conforme a implementação atual. Faça mocks nas fronteiras externas (IPC, rede, SO), sem mockar indiscriminadamente componentes Vue ou Pinia.
6. Para APIs reais de DOM/Web Platform, prefira ambiente browser se já estiver configurado. Mocks de globals internos podem criar estados impossíveis.
7. Não use `as unknown as`, import alternativo ou mocks para esconder falhas de exports, efeitos de import ou dependências circulares.
8. Quando útil e seguro, confirme que o teste falha com o código antigo. Se continuar verde, não prova a correção.
9. Rode a suíte correta e relate contagens, skips, falhas e ambiente. Não declare E2E se só executou unitários.
