#!/usr/bin/env node
/**
 * Medicao de custo de contexto dos arquivos de instrucao da Lia.
 *
 * Uso:
 *   node measure.mjs <arquivo> [<arquivo> ...] [--lines A-B] [--json]
 *
 * Exemplos:
 *   node measure.mjs ../../AGENTS.md
 *   node measure.mjs ../../docs/project/CURRENT-STATE.md --lines 1-70
 *
 * REGUA: BPE `o200k_base` via js-tiktoken (offline, ranks embutidos no pacote).
 * O Claude NAO usa este tokenizador - trate o numero como proxy. O que importa
 * para os portoes e a comparacao antes/depois PELA MESMA REGUA, e a proporcao
 * entre trechos, nao o valor absoluto.
 *
 * Por que nao chars/N: AGENTS.md tokeniza a ~5,3 chars/tok (muita linha curta,
 * diagrama ASCII e 99 repeticoes de "===="), enquanto CURRENT-STATE.md fica em
 * ~3,7 (prosa e tabelas em portugues). Um divisor unico mistura os dois
 * regimes e erra o AGENTS.md em ~50%.
 */
import { readFileSync } from 'node:fs'
import { getEncoding } from 'js-tiktoken'

const ENCODING = 'o200k_base'

function parseArgs(argv) {
  const files = []
  let lines = null
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') json = true
    else if (a === '--lines') lines = argv[++i]
    else if (a.startsWith('--lines=')) lines = a.slice(8)
    else files.push(a)
  }
  return { files, lines, json }
}

function measure(text) {
  const enc = getEncoding(ENCODING)
  const tokens = enc.encode(text).length
  return { chars: text.length, tokens, charsPerToken: +(text.length / tokens).toFixed(2) }
}

function sliceLines(text, spec) {
  const m = /^(\d+)-(\d+)$/.exec(spec ?? '')
  if (!m) throw new Error(`--lines espera A-B, recebeu: ${spec}`)
  const [, a, b] = m.map(Number)
  // O arquivo pode usar CRLF; split por \n preserva o \r e nao muda a contagem
  // de forma relevante, mas cortar no meio de um par CRLF inflaria 1 char por
  // linha. Normaliza so para o fatiamento.
  const all = text.replace(/\r\n/g, '\n').split('\n')
  if (a < 1 || b > all.length || a > b)
    throw new Error(`--lines ${spec} fora do intervalo 1-${all.length}`)
  return all.slice(a - 1, b).join('\n')
}

const { files, lines, json } = parseArgs(process.argv.slice(2))
if (files.length === 0) {
  process.stderr.write('uso: node measure.mjs <arquivo> [...] [--lines A-B] [--json]\n')
  process.exit(2)
}

const rows = []
for (const f of files) {
  const raw = readFileSync(f, 'utf-8')
  const whole = measure(raw)
  const totalLines = raw.replace(/\r\n/g, '\n').split('\n').length
  const row = { file: f, lines: totalLines, ...whole }
  if (lines) {
    const part = measure(sliceLines(raw, lines))
    row.slice = { range: lines, ...part }
  }
  rows.push(row)
}

if (json) {
  process.stdout.write(`${JSON.stringify({ encoding: ENCODING, rows }, null, 2)}\n`)
} else {
  process.stdout.write(`regua: ${ENCODING} (proxy - o Claude usa outro tokenizador)\n\n`)
  for (const r of rows) {
    process.stdout.write(
      `${r.file}\n  inteiro : ${String(r.lines).padStart(5)} linhas  ${String(r.chars).padStart(6)} chars  ${String(r.tokens).padStart(6)} tok  (${r.charsPerToken} chars/tok)\n`,
    )
    if (r.slice) {
      process.stdout.write(
        `  ${r.slice.range.padEnd(8)}: ${String(r.slice.chars).padStart(6)} chars  ${String(r.slice.tokens).padStart(6)} tok  = ${(100 * r.slice.tokens / r.tokens).toFixed(1)}% do arquivo\n`,
      )
    }
  }
}
