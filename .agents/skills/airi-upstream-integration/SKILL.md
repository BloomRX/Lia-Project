---
name: airi-upstream-integration
description: Consulta a antiga integração do AIRI como referência histórica para investigar uma regressão ou comparar uma implementação. Use quando a tarefa citar o Stage legado ou pedir a origem de um comportamento herdado.
---

# Consultar o AIRI histórico

A implementação operacional fica em `lia/`. Consulte `docs/airi-modificacoes-registro.md` para localizar patches e decisões anteriores. Para ler um arquivo legado a partir da raiz:

```powershell
git show 'd6eb8b81^:airi/package.json'
```

Para comparar com outro commit, use o histórico Git ou o backup verificado da árvore anterior à remoção. Identifique o comportamento observável e seus testes antes de adaptar código próprio. Preserve a licença e os créditos de material reaproveitado. Valide a mudança no Launcher e no Stage atuais, sem recriar o workspace legado como pré-requisito.
