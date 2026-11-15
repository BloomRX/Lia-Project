---
name: lia-ai-sdk-integration
description: Avalia integrações de geração de texto, streaming, ferramentas, saída estruturada, embeddings, imagem ou voz com xsAI/APIs compatíveis. Use ao integrar geração, streaming ou ferramentas com o SDK já presente.
---
# Integrações de SDK de IA
- Inspecione dependências e imports antes de escolher SDK. Preserve a integração atual salvo motivo técnico demonstrado.
- xsAI é voltado a APIs compatíveis com OpenAI; não presuma suporte a APIs específicas de qualquer provedor.
- Prefira pacote granular; use pacote agregado quando várias capacidades forem necessárias ou o projeto já o usar.
- Para streaming, trate cancelamento, erros e conclusão. Valide saídas estruturadas com schema antes de usá-las.
- Nunca coloque chaves em código, logs, exemplos versionados ou renderer sem proteção.
- Não use localStorage para credenciais, mesmo que uma receita upstream recomende. Reutilize o resolver/vault existente sem alterar secrets nesta auditoria.
- Ferramentas chamadas pelo modelo precisam validar argumentos e permissões na camada de execução; prompts não são controle de acesso.
- Não troque SDK/provedor nem instale dependências sem comparar compatibilidade, licença, manutenção, tamanho e custo de migração.
- Consulte a documentação da versão instalada e execute testes de integração apropriados.
