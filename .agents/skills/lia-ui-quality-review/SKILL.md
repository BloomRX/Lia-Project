---
name: lia-ui-quality-review
description: Revisa telas e fluxos da Lia quanto a clareza, acessibilidade, consistência visual e usabilidade para pessoas não técnicas. Use ao criar ou alterar o Launcher, configurações, diálogos, onboarding ou estados de erro.
---

# Revisão de qualidade da interface Lia

## 1. Entender o fluxo

Leia as especificações relevantes em `docs/product/`, `docs/design/` e a implementação atual. Identifique o público, a tarefa principal, o estado inicial e o que acontece em sucesso, erro, carregamento e cancelamento.

A Lia deve explicar opções em linguagem clara, mostrar consequências relevantes e evitar exigir conhecimento de Node, Electron, provedores ou nomes internos para tarefas comuns.

## 2. Revisar os estados

Para cada fluxo alterado, verifique:

- estado inicial, carregamento, sucesso, erro, vazio e indisponibilidade;
- rótulos objetivos, explicações junto à opção e valores padrão seguros;
- mensagens que indiquem o que aconteceu e qual próximo passo é possível;
- prevenção de perda de dados e confirmação antes de ações destrutivas;
- navegação por teclado, foco visível, nomes acessíveis e contraste adequado;
- layout responsivo e escala de janela/DPI do Windows;
- consistência com o design system e idioma pt-BR, incluindo strings longas.

## 3. Evidência visual e funcional

Quando possível, execute a aplicação e valide o fluxo real. Use a skill `web-design-guidelines` em `airi/.agents/skills/web-design-guidelines/SKILL.md` como referência complementar, e as skills `agent-browser`/`agent-browser-electron` para automação quando disponíveis.

Screenshots estáticos ajudam a revisar aparência, mas não provam foco, teclado, estados de erro nem comportamento de controles. Não declare acessibilidade conforme sem testes correspondentes.

## 4. Escopo

Liste problemas por severidade e indique arquivo/fluxo afetado, impacto para o usuário e correção mínima recomendada. Separe defeitos observados de sugestões subjetivas. Não faça uma reformulação ampla de design se a tarefa pede uma correção pontual.

## 5. Idioma

Use pt-BR para a experiência principal da Lia, salvo decisão explícita de produto. Preserve termos técnicos somente quando necessários e explique-os. Se mexer em internacionalização, leia a dívida de i18n e as regras locais do AIRI antes de alterar catálogos.
