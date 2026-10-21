---
name: lia-regression-investigation
description: Investiga causa de bug ou regressao na Lia com experimento controlado, uma variavel por vez, teste que falha antes da correcao e refutacao da propria hipotese. Use quando a causa for desconhecida, o sintoma for intermitente, houver suspeita a confirmar, ou depois de uma correcao que "parece certa" mas nao foi provada.
compatibility: Nenhuma. Metodo; serve a qualquer ambiente e a qualquer suite da Lia.
---

# Investigar regressão

Esta skill é sobre **método**, não sobre um bug específico. `lia-release-gate`
responde "podemos publicar"; esta responde "por que isso quebra".

## 1. Reproduzir antes de tocar no código

Reproduza com passos numerados e comando exato. Registre: ambiente, comando,
saída, código de saída. Se não reproduz, você não tem causa — tem palpite.

Reprodução que exige repetição (intermitente) precisa de **contagem**: "N de M
vezes", com o mesmo comando.

## 2. Distinguir os três tipos de falha

Antes de culpar o produto, classifique:

| Tipo | Assinatura |
| --- | --- |
| Falha funcional | o comportamento errado aparece na saída do teste |
| Falha de limpeza | o teste passou; o `tearDown`/remoção falhou depois |
| Problema de ambiente | interpretador errado, permissão, disco, rede |

Confundir limpeza com funcional falhou neste projeto: o erro era
`WinError 32/5` removendo `.devkit-tests-*`, não na lógica testada.

## 3. Teste vermelho, no harness real

1. Escreva o teste **antes** da correção e veja-o **falhar**.
2. Rode-o contra o código **não corrigido** e confirme que falha pelo motivo
   certo — não por `ImportError`, nome errado ou alvo vazio.
3. Só então corrija.

**Armadilha real:** um teste pode falhar porque o campo que ele lê está vazio.
Antes de ler um vermelho como evidência, prove que o alvo da asserção é
populado por um caso que você sabe que funciona.

## 4. Modelo reduzido não prova nada sobre o sistema

Se você reproduz o sintoma num script isolado (`node -e`, um `python -c`, um
harness mínimo), você provou que **o modelo** tem o defeito. Isso **não**
autoriza mudar produção.

Aconteceu exatamente aqui: um modelo isolado mostrou que uma guarda `trim()`
comeria um espaço entre duas partes da resposta, a correção foi aplicada — e o
teste, rodado no harness real, **passou mesmo com o código antigo**. A hipótese
estava morta; a produção foi revertida.

Regra: **nenhuma mudança de produção sai de um modelo reduzido.** O modelo
serve para gerar hipótese, nunca para encerrar investigação.

## 5. Refutar a própria hipótese de propósito

Depois de uma correção, **volte o código ao estado antigo** e rode o teste. Se
continuar verde, o teste não prova a correção e a causa é outra.

Isso custa um comando e evita semanas perseguindo a causa errada.

## 6. Uma variável por vez

Quando houver mais de uma suspeita, compare requisições controladas mudando
**um** parâmetro. Exemplo deste projeto, com o gate de imagem:

| Rodada | Ferramentas | `strict` | Resultado |
| --- | --- | --- | --- |
| A | 1 | `true` | resposta vazia / um EOS |
| B | 1 | `false` | descrição correta |
| C | 7 | `false` | aparece, mas "quadrado" no lugar de retângulo |

C obtém B mais seis ferramentas: a diferença é a contagem de ferramentas. Mudar
duas coisas ao mesmo tempo torna o resultado inútil.

## 7. Investigar causas separadas separadamente

Dois sintomas na mesma tela não são a mesma causa. Neste projeto, perda de
espaço no texto e retângulo descrito como quadrado apareceram juntos, e tratá-los
como um só levou a uma hipótese errada.

Registre cada sintoma com seu próprio estado: **aberto**, **causa provada**,
**corrigido com teste vermelho**, ou **refutado**.

## 8. Intermitente: nunca mascarar

- Repita de forma **limitada** (5 rodadas é o padrão deste projeto) e registre.
- Nunca aumente timeout para "resolver".
- Nunca engula exceção (`ignore_errors`, `except: pass`) — isso transforma
  defeito em lixo invisível.
- Se houver suspeita de handle ou arquivo preso, registre **processo e
  caminho**; não presuma quem é o responsável e não mate processo alheio.
- Falha intermitente que persistiu **não está resolvida** — escreva isso.

## 9. Parar

Aplique **STOP AND REPORT** quando: a causa seguir desconhecida depois de
investigação razoável; o próximo experimento exigir credencial, hardware ou o PC
do Dev; ou a correção exigir contornar uma regra do projeto.

Entregue: o que foi executado, as saídas, a hipótese mais forte, o experimento
que a confirmaria e o que **não** foi provado.
