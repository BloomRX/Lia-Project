---
name: lia-agent-evaluation
description: Monta comparacao controlada de qualidade do modelo na Lia - imagem, ferramentas, streaming SSE, argumentos invalidos, respostas vazias e espaco no texto - mudando uma variavel por vez e registrando o que foi provado. Use ao investigar resposta errada, resposta vazia, ferramenta nao chamada, imagem mal interpretada ou regressao de visao e de formato.
compatibility: Requer acesso ao provedor configurado. Sem credencial, o item e BLOCKED - nao FAIL.
---

# Avaliar o comportamento do modelo

Este projeto já pagou caro por avaliação mal desenhada. O protocolo abaixo existe
para que cada conclusão custe **uma** variável, não cinco.

## 1. O que conta como evidência

| Evidência | Vale? |
| --- | --- |
| `HTTP 200` | **Não.** Resposta vazia também é 200. |
| Um token EOS e nada mais | **Não** — é o sintoma, não sucesso. |
| Descrição correta do conteúdo da imagem | Sim |
| Texto idêntico ao esperado, com o espaço preservado | Sim |
| `finishReason: 'stop'` com conteúdo não vazio | Sim, mas não prova correção semântica |

Registre sempre: modelo, provedor, número de ferramentas habilitadas, `strict`,
limite de tokens de saída, e `correlationId` + horário quando vier da UI.

## 2. Protocolo de comparação controlada

Fixe **tudo** e mude **uma** coisa:

```
fixo:  imagem sintética 240x160, retângulo vermelho à esquerda, círculo azul à direita
fixo:  pergunta determinística sobre o conteúdo
fixo:  caminho SSE real, out-limit, in-tokens
varia: UMA de { nº de ferramentas, strict true/false, modelo }
```

A matriz que este projeto já usou:

| Rodada | Ferramentas | `strict` | Resultado observado |
| --- | --- | --- | --- |
| A | 1 | `true` | HTTP 200, **stop vazio** / um EOS |
| B | 1 | `false` | descrição **correta** |
| C | 7 | `false` | resposta aparece, mas **"quadrado"** no lugar de retângulo |

A comparação válida é **B contra C**: mesma imagem, mesmo `strict`, mesmo limite,
sete ferramentas em vez de uma. Nenhum outro par isola a variável.

Não troque duas coisas na mesma rodada. Se trocar, a rodada não conclui nada.

## 3. Nunca fazer

- **Resposta fixa** ou detector da imagem de teste. Se a correção só funciona
  para aquele PNG, ela não existe.
- **Heurística** que só faz o caso passar (ex.: procurar "retângulo" na saída).
- **Remover ferramenta** para o modelo acertar. As sete ferramentas são
  requisito de produto; a validação local de argumentos (Zod) fica.
- Concluir pelo **provedor mínimo** que a UI funciona. Requisição mínima prova o
  provedor, não o caminho da aplicação.
- Tratar `strict=true` vazio como falha de rede. É comportamento do schema.

## 4. Sintomas que parecem um e são dois

| Sintoma | Investigar separado |
| --- | --- |
| "quadrado" no lugar de retângulo | vocabulário geométrico do modelo |
| palavra colada: `círculoazul` | perda do delta de espaço entre tokens |

Já houve tentativa de unificar os dois e a hipótese caiu. Cada sintoma tem seu
próprio estado: aberto, causa provada, corrigido com teste vermelho, ou refutado.

## 5. Erros de provedor: classificar, não confundir

| Código | Significado | Veredito |
| --- | --- | --- |
| 429 | quota de tokens de saída (observado ~1000/min) | **BLOCKED**, não FAIL |
| 413 | limite de tokens de entrada (observado ~7000/min) | **BLOCKED**; reduzir o caso |
| 401 | credencial inválida/incompatível | **BLOCKED** — problema de acesso |

Nunca imprimir chave, cabeçalho de autorização ou URL com credencial. Registre
"configurado" e o identificador do provedor.

## 6. Ferramentas e streaming

- Argumento de ferramenta inválido deve ser **recusado localmente**, antes do
  despacho, e a recusa precisa aparecer — não virar chamada silenciosa.
- Stream vazio tem que produzir erro em pt-BR e terminal `failed`, preservando
  rascunho e anexos. Aprovar só o `HTTP 200` do serviço é erro.
- Um loop completo de ferramentas contra serviço real **não** foi validado. O
  transporte e o gate de compatibilidade não são o loop.

## 7. Latência

O contrato de telemetria **exclui timing por desenho**. Não infira latência de
logs que não a registram e não converta duração de teste em latência de produto.
Medição de latência é item separado, hoje NOT RUN.

## 8. Voz

B1/B1.1 está fechado. Não reabra por regressão de teste automatizado nem por
mudança de código: reabre só com evidência de hardware real. Nunca use Web
Speech como fallback automático.

## 9. Registrar

Para cada rodada: o que foi fixado, o que variou, saída relevante de fixture
sintética sem dados privados, veredito
(PASS / FAIL / BLOCKED / NOT RUN) e o que **não** foi provado. Entregue ao
`lia-release-gate` — ele é quem decide se isso aprova alguma coisa.

Não grave payloads reais, credenciais, prompts privados ou conteúdo pessoal.
Para tráfego real, registre apenas metadados seguros e o resultado do critério.
