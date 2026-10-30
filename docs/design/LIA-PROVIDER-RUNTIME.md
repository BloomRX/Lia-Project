# Runtime de providers da Lia

Implementação de 30/10/2026. Estado e evidências em
[`LIA-PROVIDER-RUNTIME-2026-10-30.md`](../architecture/LIA-PROVIDER-RUNTIME-2026-10-30.md).

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
  → fetch da Lia → ProviderRuntime → serviço configurado
```

A ponte `native-provider-runtime.ts` fornece apenas `{model, baseURL, fetch}` ao
SDK, sem chave. O fetch ignora o destino fornecido pelo SDK e usa o endereço
validado da instância própria; preserva corpo JSON, ferramentas, partes de imagem
e opções de transporte. Autenticação e cancelamento são aplicados dentro dele.

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

Configuração de endpoint/registro visual, sincronização, ativação e ponto de
despacho ainda usam os stores do host legado. Core/xsAI continuam responsáveis
por histórico, interpretação do stream no chat e ciclo de ferramentas. Voz,
visão/Brain, avatar e demais protocolos não foram migrados.

Esta implementação não conclui a independência do aplicativo ou a remoção do
Stage. O próximo passo é definir configuração própria de transporte/protocolo
para substituir o registro legado sem perder compatibilidade, seguido por
adapters específicos com fixtures de seus protocolos reais.

## Fronteira Electron validada

O transporte roda no renderer. O main atende configuração e cofre pelos canais
Eventa existentes; não é um executor de geração novo. O resolver devolve somente
a chave do escopo solicitado, transitoriamente para montar a requisição. Ela não
entra na factory, cache, config, localStorage ou erros públicos. Isso preserva o
modelo de confiança existente; não promete isolamento da chave de todo código
do renderer nem apagamento verificável de strings pelo coletor de lixo.

O teste reproduzível `scripts/provider-runtime-electron/gate.test.mjs` usa janela
Electron real, preload compilado, handlers de produção, `safeStorage` real e HTTP
local autenticado. Perfil e dumps ficam isolados no temporário do Windows; logs
e captura ficam em `Tests/artifacts/provider-runtime-electron/`. O painel de teste
não substitui o Stage. [Resultados e limites](../product/RELEASE-WINDOWS-2026-10-30-RUNTIME-E2E.md).
