---
name: lia-ui-quality-review
description: Revisa telas e fluxos da Lia quanto a clareza, acessibilidade, consistência visual e usabilidade para pessoas não técnicas.
---
# Revisão de qualidade da interface Lia
1. Leia as especificações em `docs/product/`, `docs/design/` e a implementação atual. Identifique público, tarefa principal e estados de sucesso, erro, carregamento, vazio e cancelamento.
2. A Lia deve explicar opções em linguagem clara, mostrar consequências e evitar exigir conhecimento de Node/Electron/provedores em tarefas comuns.
3. Verifique rótulos, defaults seguros, próximos passos após erro, prevenção de perda de dados, confirmação de ações destrutivas, navegação por teclado, foco, nomes acessíveis, contraste, responsividade e escala DPI.
4. Use pt-BR na experiência principal salvo decisão explícita de produto.
5. Para automação/evidência, leia `.agents/skills/lia-browser-automation/SKILL.md` e `.agents/skills/lia-visual-evidence/SKILL.md` quando as ferramentas estiverem disponíveis. Siga a especificação e o design system da Lia, não regras específicas do AIRI.
6. Screenshot não prova teclado, acessibilidade nem comportamento de controles. Não declare conformidade sem os testes correspondentes.
7. Liste achados por severidade, arquivo/fluxo, impacto e correção mínima. Separe defeitos observados de sugestões subjetivas; evite reformulação ampla fora do escopo.
