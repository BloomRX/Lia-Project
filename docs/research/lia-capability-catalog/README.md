# Catálogo de capacidades e modelos da Lia — pesquisa

**Data da pesquisa:** 11/11/2026
**Natureza:** pesquisa e documentação. **Nenhuma integração foi implementada.**
**Branch:** `arena/01a10290-lia-project`
**Base:** `29999aff3105a7c41501cad75bc65cf6a2544a95`

Este conjunto de documentos responde a uma pergunta de produto: **que modelos,
pesos, runtimes e provedores a Lia pode oferecer ao usuário escolher?** — sem
transformar nenhum deles em dependência obrigatória da arquitetura central.

## Regra que vale para todos os documentos

Três estados nunca se confundem:

| Estado | Significado |
|---|---|
| **Pesquisado** | encontrado em fonte oficial, com link e data |
| **Verificado** | metadado conferido na fonte primária (licença, tamanho, data) |
| **Testado** | executado nesta máquina, com medição registrada |

**Nada nesta pasta foi testado.** Nenhum peso foi baixado, nenhuma inferência
foi executada, nenhuma API foi chamada. O que existe é pesquisa com fonte, e
toda afirmação de desempenho é atribuída a quem a publicou — nunca tratada como
medição nossa.

## Documentos

| Documento | O que responde |
|---|---|
| [`01-ESTADO-DA-ARQUITETURA.md`](01-ESTADO-DA-ARQUITETURA.md) | O que a Lia **já tem** (classificado 1–5), e o que o catálogo pode reaproveitar sem criar segunda arquitetura |
| [`02-CATALOGO-MESTRE.md`](02-CATALOGO-MESTRE.md) | Todos os candidatos por capacidade (A–M), com licença, tamanho, runtime e link oficial |
| [`03-ESQUEMA-E-DADOS.md`](03-ESQUEMA-E-DADOS.md) | Schema do catálogo selecionável, estados de ciclo de vida e registros de exemplo |
| [`04-MATRIZES-E-PRIORIDADES.md`](04-MATRIZES-E-PRIORIDADES.md) | Comparações por categoria, compatibilidade modelo × runtime × SO × hardware, melhores candidatos por critério |
| [`05-PLANO-DE-TESTES-E-RISCOS.md`](05-PLANO-DE-TESTES-E-RISCOS.md) | Como validar, o que ainda não sabemos, licenças problemáticas, riscos e próximos passos |
| [`catalog.data.json`](catalog.data.json) | Dados de pesquisa em formato consumível — **não** é configuração de produção |

## Três conclusões que já valem

1. **A Lia já tem o encaixe certo e ele é pequeno.** `lia/core/src/brain/` possui
   um contrato de capacidades de 9 booleanos, um registro de engines, resolução
   de rotas e política de seleção. O catálogo novo **não precisa de um segundo
   sistema** — precisa de mais *descritores* alimentando o que já existe.
2. **O gargalo real não é o modelo, é a execução local.** Windows + GPU AMD é o
   caso pior: `vLLM` e `TensorRT-LLM` não são caminho; `llama.cpp` (Vulkan/CPU) é.
   Todo candidato local precisa ser avaliado primeiro por *"roda no parque
   instalado do usuário?"*.
3. **Licença elimina candidatos antes de qualidade.** AGPL (`ChatTTS`, `Skyvern`,
   `Ultralytics`, `ComfyUI`), CC-BY-NC (`F5-TTS` em pesos, a confirmar) e
   licenças de pesos restritivas (`Llama 4`, `HunyuanVideo`, `LivePortrait`,
   `MuseTalk`, `Wav2Lip`) mudam a decisão de distribuição, não a de qualidade.

## O que este catálogo **não** é

- Não é uma lista de permissão. Um modelo listado não está instalado, configurado
  nem aprovado.
- Não é um ranking único. Modelos que fazem coisas diferentes não são comparados
  entre si.
- Não é um compromisso de implementação. Ver `05-PLANO-DE-TESTES-E-RISCOS.md` §7.
