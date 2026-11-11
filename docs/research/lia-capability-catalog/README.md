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

---

## Revisão 2 — 11/11/2026 (commit seguinte a `cf1d9ce`)

O Dev revisou `cf1d9ce` e apontou lacunas. A revisão não refez a pesquisa: cada
ponto foi conferido na **fonte primária** e corrigido onde divergia. O que mudou:

| Documento | O que mudou |
|---|---|
| [`06-ERRATA-E-REVISAO.md`](06-ERRATA-E-REVISAO.md) | **novo** — resposta ponto a ponto às 7 observações, com veredito e fonte de cada uma |
| [`07-CATALOGO-ESTRUTURADO.md`](07-CATALOGO-ESTRUTURADO.md) | **novo** — rastreabilidade: catalogados / descobertos / validados, e como um sobe de nível |
| [`08-BANCADA-DE-MEDICAO.md`](08-BANCADA-DE-MEDICAO.md) | **novo** — ficha de execução, ordem de testes, conjuntos PT-BR, RX 580 explícita |
| [`02-CATALOGO-MESTRE.md`](02-CATALOGO-MESTRE.md) | Fish Audio em 3 camadas; F5-TTS confirmado; Qwen3.5-4B *instruct* vs `-Base`; tamanhos reais do Qwen3.8-27B; vozes PT do Kokoro; AGPL do VoiceStudio |
| [`03-ESQUEMA-E-DADOS.md`](03-ESQUEMA-E-DADOS.md) | §3.8 com os 11 campos pedidos; §3.9 capacidades visuais decompostas; §3.10 orquestração em 9 componentes |
| [`04-MATRIZES-E-PRIORIDADES.md`](04-MATRIZES-E-PRIORIDADES.md) | `p*` para híbridos em Vulkan; §4.1.3b RX 580; AGPL e NC com nuance |
| [`catalog.data.json`](catalog.data.json) | `schemaVersion: 2` — `licenseScope`, `variant`, `revision`, `validation`, `hardwareConstraints`; **44 entradas** (39 + 5 separadas pela revisão) |

**Estado do catálogo:** 44 catalogados · ~131 descobertos · **0 validados**.
Nada aqui autoriza implementação.

**Primeira bancada executável:** [`tools/stt-bench/`](../../../tools/stt-bench/README.md)
— faster-whisper small em CPU/int8/pt, até 10 amostras, com JSON validado por
schema e regra explícita de que medição em Linux não promove nada no catálogo.
