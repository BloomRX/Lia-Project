# Decisões de produto e arquitetura

1. **Lia independente:** AIRI é referência de pesquisa, não dependência estrutural nem base de runtime obrigatória.
2. **Arquitetura própria:** contratos, domínio, segurança, IPC, Launcher e Stage devem evoluir sob autoridade da Lia.
3. **Provider-neutral:** selecionar por capacidade e protocolo, não por marca; endpoint e autenticação pertencem à configuração.
4. **Segurança de credenciais:** segredo deve permanecer no host confiável; não enviar access/refresh/ID tokens ao renderer.
5. **Fail-closed:** seleção gerenciada, credenciais e consistência devem ser validadas antes de executar transporte.
6. **Experiência simples:** esconder infraestrutura no fluxo normal e oferecer opções avançadas sem obrigar o usuário comum a entendê-las.
7. **Hardware inclusivo:** AMD/Vulkan/CPU devem ser considerados; não presumir ROCm/CUDA.
8. **Integração controlada:** um responsável integra; branches de sessão são isoladas; main recebe somente mudanças aprovadas.

Estas decisões podem ser revisadas quando houver evidência técnica nova, mudança explícita de produto ou ADR aprovado. Não reabrir por preferência isolada.
