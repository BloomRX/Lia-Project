# Pesquisa de pesos: Ornith AI

**Data da consulta:** 14/11/2026 (UTC)  
**Escopo:** pesquisa documental dos pesos públicos da Ornith AI e adequação preliminar à Lia. Não baixei pesos, não rodei inferência, não reproduzi benchmarks e não alterei código. O usuário indicou [ornith.ai](https://ornith.ai/) e [Hugging Face `ornith-ai`](https://huggingface.co/ornith-ai).

## Resumo executivo

Ornith é uma família de modelos de linguagem voltada principalmente a coding e agentes, não um modelo único. O site do projeto apresenta Ornith-1.5 em três escalas-base: 9B denso, 35B MoE e 397B MoE. A organização HF também lista variantes quantizadas, GGUF, MLX, FP8/NVFP4, além de derivados/checkpoints adicionais. A existência de pesos quantizados amplia a possibilidade de execução local, mas **não prova suporte em runtime/hardware nem qualidade para a Lia**.

Para a máquina de referência documentada da Lia (Ryzen 5 5500, RX 580 8 GB, 16 GB RAM), apenas Ornith-1.5-9B-GGUF Q4_K_M parece uma hipótese razoável para um teste CPU/Vulkan, e mesmo assim é apertado: o arquivo é 5,78 GB, antes de KV cache, buffers/runtime, contexto e concorrência com Stage/desktop. Não há evidência consultada de benchmark RX 580, compatibilidade Vulkan confirmada para esse checkpoint, nem de qualidade em português/uso geral da Lia. Recomendação: **candidato experimental de baixa prioridade para comparação de LLM local**, não padrão nem promessa de execução. As versões 35B/122B/397B não são compatíveis com o orçamento de memória da máquina de referência sem infraestrutura substancialmente maior.

## Família e pesos observados

O site descreve Ornith-1.0 como modelos de 9B Dense, 31B Dense, 35B MoE e 397B MoE; Ornith-1.5 como 9B Dense, 35B MoE e 397B MoE. A organização Hugging Face apresentava, na consulta, 36 modelos e quatro coleções; entre os modelos recentes aparecem também Ornith-1.5-122B, variantes GGUF/FP8/NVFP4 e MLX. Os números de modelos/variantes e tamanhos são fotografia do Hub, sujeitos a mudanças.

| Variante / artefato observado | Formato / tamanho reportado | Implicação prática |
|---|---|---|
| [Ornith-1.5-9B-GGUF](https://huggingface.co/ornith-ai/Ornith-1.5-9B-GGUF) | Q4_K_M 5,78 GB; Q5_K_M 6,64 GB; Q6_K 7,56 GB; Q8_0 9,79 GB; BF16 18,4 GB. | Q4 é o único desses arquivos que poderia caber nominalmente em VRAM de 8 GB, mas não deixa margem operacional para KV cache/contexto, buffers, driver e renderização; offload para RAM/CPU e contexto curto seriam hipóteses a medir. Q5/Q6 excedem 8 GB antes de overhead. |
| [Ornith-1.5-9B](https://huggingface.co/ornith-ai/Ornith-1.5-9B) | Checkpoint Transformers; model card declara cerca de 19 GB em BF16. | Requer mais que a RAM de 16 GB do PC de referência mesmo antes do restante do processo; não é candidato BF16 local nesse alvo. Quantização altera a necessidade, mas não garante qualidade/velocidade. |
| [Ornith-1.5-35B-A3B-GGUF](https://huggingface.co/ornith-ai/Ornith-1.5-35B-A3B-GGUF) | Repositório reporta 181 GB totais de artefatos: Q4_K_M 21,2 GB; Q5_K_M 24,7 GB; Q6_K 28,5 GB; Q8_0 36,9 GB; BF16 69,4 GB. Ativa ~3B parâmetros/token segundo o card do modelo base. | “3B ativos” reduz computação por token, não o armazenamento/residência dos pesos MoE. Nenhuma quantização listada cabe na RX 580 de 8 GB; fora do alvo. |
| Ornith-1.5-122B e 397B, com variantes GGUF, FP8/NVFP4/MLX no Hub | O tamanho varia por checkpoint e quantização; o card 122B relata implantação em GPU classe 80 GB para versão original. | Escalas de servidor/estação de trabalho, não o PC Lia de referência. MLX é focado no ecossistema Apple; NVFP4 pressupõe compatibilidade NVIDIA/runtime. Não inferir compatibilidade AMD. |

Tamanhos são valores exibidos pelo Hub/model cards, não medições desta pesquisa. GB do arquivo não equivalem à memória total de inferência. No MoE, parâmetros ativos por token não equivalem a pesos totais residentes. Contexto grande aumenta KV cache; limites publicados de 262K ou recomendações de servir em GPU de 80 GB não se transferem para RX580.

## Capacidades, runtime e adequação ao produto

- O fornecedor posiciona a família para coding/agentes e publica resultados próprios em benchmarks como Terminal-Bench e SWE-bench. Esses números são do fornecedor e dos harnesses descritos no model card; não são comparação independente nem teste de chat, persona, conversa em português ou uso do produto Lia.
- O card 9B descreve modelo de reasoning que emite bloco `<think>` antes da resposta final e declara tool calls expostos via formatos/parsers específicos em Transformers/vLLM/SGLang. A documentação pede versões recentes (Transformers ≥5.8.1, vLLM ≥0.19.1, SGLang ≥0.5.9) e os exemplos do 9B usam servidores de GPU e contextos longos. Isso não demonstra que a versão instalada de llama.cpp/llama-server parseie corretamente o template, reasoning e ferramentas.
- O repositório GGUF indica compatibilidade com llama.cpp e comandos de exemplo, mas isso não certifica backend Vulkan na RX580, taxa de tokens, RAM, estabilidade, concorrência ou fallback. O primeiro teste deveria usar um runtime/versão fixos, quant Q4, contexto modesto e CPU baseline; medir memória total, tokens/s, first-token latency, qualidade, template/tool-call correctness e impacto em Stage.
- O foco coding pode ser útil para uma capacidade de programação/agente, mas não garante desempenho adequado como assistente geral/personagem. Não há, nas fontes consultadas, resultado PT-BR nem comparação com LFM3, Qwen pequeno ou modelos já listados no catálogo da Research.
- Os comandos do fornecedor expõem endpoint OpenAI-compatible. Para a Lia, isso só é uma possibilidade de adapter: autorização de tools continua sendo responsabilidade do host, sem confiar no modelo; reasoning interno deve ser tratado como dado não confiável e a UI não deve presumir que o servidor forneça um campo secreto seguro.

## Licença e proveniência

O site e o Hub foram consultados como fontes primárias para família e artefatos. A organização/landing page não constitui por si só uma licença por checkpoint. Uma busca pelo arquivo `LICENSE` no checkpoint 9B consultado retornou 404; por isso **não classifico aqui os pesos como MIT, Apache ou outra licença** apenas a partir de afirmações promocionais ou do nome da organização. A licença do código de runtime, a licença dos pesos derivados e as licenças dos modelos-base/treino são itens distintos. Ornith-1.5 declara ter sido desenvolvido sobre Qwen3.5 e Gemma 4 com continuação de pré-treino, mid-training e post-training; isso torna indispensável verificar o `LICENSE`, model card e condições dos modelos-base na revisão exata antes de redistribuir ou uso comercial. Não é parecer jurídico.

Antes de qualquer download/uso:
1. Fixar commit SHA imutável do repositório HF e verificar `LICENSE`, metadata (`license`), arquivos e avisos do modelo-base no mesmo revision.
2. Confirmar termos de uso comercial, redistribuição, atribuição, uso de saída e eventuais restrições; registrar separadamente licença de código, pesos, tokenizer e artefatos.
3. Obter hash SHA-256 dos arquivos baixados e usar fonte oficial; evitar mirrors/quantizações da comunidade sem origem/licença verificadas.
4. Rever `trust_remote_code` e código do runtime, se aplicável; executar isolado e sem acesso desnecessário a segredos ou rede.

## Recomendação para o catálogo Lia

Classificação provisória: **B — comparar em POC de LLM coding local, condicional; C para assistente geral até avaliação PT-BR e integração de template/tool use.** Incluir como candidato documental, não como escolha aprovada.

1. Preferir inicialmente Ornith-1.5-9B Q4_K_M GGUF em CPU e Vulkan como duas configurações separadas; o Vulkan na RX580 é hipótese não validada. Começar com contexto conservador, pois 256K consome memória adicional e não é necessário para um smoke test.
2. Comparar sob o mesmo conjunto de prompts/tarefas e settings com os candidatos já citados no catálogo da Lia, incluindo LFM3-1.7B e um Qwen pequeno; adicionar testes PT-BR, tool schema e instruções ordinárias, além de coding. Não usar ranking de benchmark do fornecedor como substituto.
3. Medir tamanho do download, RAM/VRAM residente e pico, CPU, tokens/s e latência, comportamento com Stage aberto, estabilidade do backend, qualidade de saída e correção de tool calls. Fazer teste de segurança do fluxo de tools antes de qualquer uso agente.
4. Não baixar nem empacotar 35B/122B/397B para o PC de referência. Não recomendar quantização com base apenas em quantidade de parâmetros ativos.
5. Manter esta pesquisa datada e atualizar quando modelos, licenças, quantizações ou runtimes mudarem.

## Fontes consultadas

- [Ornith AI — site e recursos](https://ornith.ai/)
- [Ornith-1.5 — artigo do projeto](https://ornith.ai/ornith_1_5.html)
- [Organização `ornith-ai` no Hugging Face](https://huggingface.co/ornith-ai)
- [Model card Ornith-1.5-9B](https://huggingface.co/ornith-ai/Ornith-1.5-9B)
- [Pesos Ornith-1.5-9B-GGUF](https://huggingface.co/ornith-ai/Ornith-1.5-9B-GGUF)
- [Model card Ornith-1.5-35B-A3B](https://huggingface.co/ornith-ai/Ornith-1.5-35B-A3B)
- [Pesos Ornith-1.5-35B-A3B-GGUF](https://huggingface.co/ornith-ai/Ornith-1.5-35B-A3B-GGUF)
