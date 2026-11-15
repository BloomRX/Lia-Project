# Runtime de providers da Lia

Implementação de 30/10/2026. Estado e evidências em
[`LIA-PROVIDER-RUNTIME-2026-10-30.md`](../architecture/LIA-PROVIDER-RUNTIME-2026-10-30.md).
Evolução de configuração e execução no main:
[`Transport Configuration`](../product/RELEASE-WINDOWS-2026-10-30-TRANSPORT-CONFIGURATION.md).

## Contrato e implementação próprios

`lia/core/src/providers/` não importa Vue, Pinia, SDK ou código AIRI. Contém:

- Contratos de configuração, credenciais por operação, modelos, requisições,
  resposta, streaming, capacidades, cancelamento e erro seguro.
- `ProviderRegistry`: definições por ID de serviço/protocolo, sem catálogo de
  modelos como permissão. Novos serviços do mesmo protocolo são registrados sem
  modificar o executor.
- `ProviderRuntime`: instâncias por configuração efetiva, HTTP, autenticação,
  descoberta, texto, SSE incremental, timeout e descarte.

O protocolo implementado é **chat-completions**. `baseUrl` é obrigatório e
explícito; não existem endereços ou marcas de serviços no núcleo. A credencial
é resolvida por operação, nunca guardada no cache ou devolvida na instância.

Capacidades descrevem operações do adaptador, não aprovação de um modelo em rede.
IDs personalizados são enviados intactos. Listagem é opcional para uso manual.

## Integração efetiva nesta fatia

```text
Editor / lia-product.json
  → ativação e estado de conversa existentes
  → action de resolução do host (ponte Lia, instalada no renderer líder)
  → factory e registry Lia para o ID genérico persistido
  → Core/xsAI montam mensagens e loop de ferramentas
  → fetch da Lia → IPC de execução → ProviderRuntime no main → serviço configurado
```

A ponte `native-provider-runtime.ts` fornece apenas `{model, baseURL, fetch}` ao
SDK, sem chave. Na integração de produção, esse fetch usa o port
`main-transport-execution.ts`: start, cabeçalho, pulls de bytes e cancelamento.
O main lê o endereço habilitado do repositório próprio, confere o endereço esperado
e resolve a referência exata do cofre. O corpo existente de chat/ferramentas é
preservado; autenticação nunca precisa voltar ao renderer nesse caminho.

Os IDs persistidos `openai-compatible` e `lm-studio` identificam os dois alvos
migrados. São compatibilidade com a configuração existente, não um catálogo do
núcleo. O segundo exige endereço explícito; registros históricos sem endereço
preservam o executor/default legado. Rascunhos explícitos de descoberta/sonda
usam o runtime próprio. Endereço explícito inválido falha com erro seguro, sem
fallback oculto para a fábrica antiga. Outros IDs preservam o executor anterior.

Após mudança de endereço, factories antigas são recusadas antes de consultar o
vault. Isso impede uma rodada tardia de enviar a chave atual ao endereço antigo
ou de cancelar as operações do endereço novo ao ressuscitar o cache anterior.

## Estados, segurança e vida útil

- Descoberta e teste do editor mantêm estados e textos pt-BR/en existentes.
- Sondas do editor mantêm limite de 15 s. Operações normais próprias usam 30 s
  por padrão, com prazo configurável no contrato; nenhum timeout foi aumentado
  como correção.
- Timeout e cancelamento abrangem resolução da credencial, fetch e consumo do
  corpo. Descarte aborta operações e remove instâncias.
- Se a fonte nunca concluir `cancel()`, o prazo e o descarte continuam ativos;
  o reader é liberado antes de aguardar a limpeza. Erro secundário de limpeza
  não substitui o erro primário nem expõe a exceção do transporte.
- SSE exige MIME próprio, UTF-8 válido e eventos limitados a 1 MiB. Envelopes de
  erro são recusados antes de chegar ao SDK; frames normais preservam bytes.
- Erros contêm somente código fechado e status HTTP opcional. Status é mantido
  para a política de falha existente, sem devolver corpo do serviço ou `cause`.
- A API normalizada `stream()` própria fornece texto e conclusão. O executor de
  ferramentas continua sendo o loop existente, não essa API normalizada.

## O que permanece temporário

Endpoint, protocolo, opções e habilitação dos registros migrados pertencem a
`userData/lia-transports.json`, com dono singleton no main, CAS por revisão e
substituição atômica. O renderer mantém apenas cópias de leitura e não aceita
respostas de revisão inferior à já observada. A ativação visual/metadata e o
despacho ainda usam o host legado. Core/xsAI continuam responsáveis por histórico,
interpretação do stream e ferramentas. Voz, visão/Brain, avatar e demais
protocolos não foram migrados.

Esta implementação não conclui a independência do aplicativo ou a remoção do
Stage. O próximo passo é migrar seletivamente as outras capacidades e retirar
o getter de credenciais dos consumidores legados antes de aprovar confidencialidade
global. Novos protocolos precisam de adapters e fixtures próprios.

## Fronteira Electron validada

O transporte autenticado dos registros migrados roda no main. A rede do renderer
não é usada pelo port de produção. O getter antigo é negado para seus escopos,
inclusive após remoção/reinício. O histórico de proteção guarda provider IDs
separadamente dos IDs de transporte. O runtime não usa aliases de voz.

Jobs têm dono `WebContents` obtido do IPC real; outra janela não pode ler ou
cancelá-los. Limites: 32 jobs totais, 8 por janela, pulls de até 64 KiB e corpo
de requisição de até 16 MiB. Os prazos são 30 s no envio e 15 s na sonda, cobrindo
cofre, rede e corpo. Cancelamento, fechamento/crash, alterações do registro e
descarte do store encerram operações.

Rascunho com endereço diferente do salvo não recebe a chave do cofre: usa somente
uma chave digitada explicitamente ou autenticação ausente. Chave digitada existe
transitoriamente no formulário antes de ser enviada ao main; não é uma leitura
do cofre. Os consumidores legados ainda podem usar o getter anterior fora dos
escopos protegidos. **Isso impede afirmar confidencialidade global de todo o app.**

O teste reproduzível `scripts/provider-runtime-electron/gate.test.mjs` usa janela
Electron real, preload compilado, handlers de produção, `safeStorage` real e HTTP
local autenticado. Perfil e dumps ficam isolados no temporário do Windows; logs
e captura ficam em `Tests/artifacts/provider-runtime-electron/`. O painel de teste
não substitui o Stage. [Resultados e limites atuais](../product/RELEASE-WINDOWS-2026-10-30-TRANSPORT-CONFIGURATION.md).
