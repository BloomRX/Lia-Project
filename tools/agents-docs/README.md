# agents-docs — medição dos arquivos de instrução

Ferramenta de **portão**, não de produto. Existe para que toda etapa da
reorganização do `AGENTS.md` mostre um número antes e depois, medido pela mesma
régua.

## Régua

BPE `o200k_base` (js-tiktoken, offline — os ranks vêm embutidos no pacote, não
há download em tempo de execução).

**O Claude não usa este tokenizador.** O número absoluto é um proxy. O que vale
é:

- a comparação **antes/depois pela mesma régua**;
- a **proporção** entre trechos.

Por que não dividir chars por uma constante: o `AGENTS.md` tokeniza a ~5,3
chars/tok (linha curta, diagrama ASCII, 99 repetições de `====`), enquanto o
`CURRENT-STATE.md` fica em ~3,7 (prosa e tabelas em português). Um divisor único
erra o `AGENTS.md` em ~50%.

## Uso

```sh
cd tools/agents-docs
npm install          # node_modules/ fica fora do git

# custo de um arquivo, ou de um intervalo de linhas dele
node measure.mjs ../../AGENTS.md
node measure.mjs ../../docs/project/CURRENT-STATE.md --lines 1-70

# extrai as seções com o custo de cada uma; --expect é portão
node extract.mjs --expect 99
node extract.mjs --json secoes.json

# contabilidade dos quatro baldes
node classify.mjs
```

## `extract.mjs --expect N`

Reporta dois modos de propósito:

| modo | cabeçalho aceito |
|---|---|
| estrito | `====` + `N. TITULO` + `====` |
| tolerante | `N. TITULO` + `====` |

A diferença entre os dois é **detector de defeito**. A seção 87 nasceu sem o
`====` de abertura: o modo estrito achava 98 seções e o tolerante 99. Um
fatiador que separa por delimitador fundiria a 87 na 86 e a perderia como
unidade — sem erro e sem aviso.

`--expect 99` falha (exit 1) se os dois modos não concordarem. Rode antes de
qualquer fatiamento.

## `classify.mjs`

A → B **não economiza nada**: os dois baldes são carregados sempre. Mover de um
para o outro é só organização. Toda economia vem de C e D.

O script também mede o **anexo da seção 0**: a seção custa ~180 tok de texto,
mas é uma ordem de ler o `CURRENT-STATE.md`. O custo efetivo do núcleo é
`A + esse anexo`, não `A`.
