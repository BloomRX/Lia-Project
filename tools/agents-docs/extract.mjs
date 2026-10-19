#!/usr/bin/env node
/**
 * Extracao das secoes do AGENTS.md da Lia, com custo em tokens de cada uma.
 *
 * Uso:
 *   node extract.mjs [<arquivo>] [--expect N] [--json <saida>]
 *
 * O arquivo usa secoes no formato:
 *
 *   ==================================================
 *   N. TITULO EM CAIXA ALTA
 *   ==================================================
 *
 * DOIS modos sao reportados de proposito:
 *
 *   estrito  = "====" + "N. TITULO" + "===="   (o formato documentado)
 *   tolerante= "N. TITULO" + "===="            (aceita cabecalho sem o "====" de abertura)
 *
 * A diferenca entre os dois e um DETECTOR DE DEFEITO: a secao 87 nasceu sem o
 * "====" de abertura, entao o modo estrito acha 98 secoes e o tolerante acha 99.
 * Qualquer fatiador que separe por delimitador fundiria a 87 na 86 e a perderia
 * como unidade - sem erro e sem aviso. Use --expect 99 como portao: se o modo
 * estrito nao achar o mesmo numero que o tolerante, ha um cabecalho quebrado.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { getEncoding } from 'js-tiktoken'

const ENCODING = 'o200k_base'
const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_TARGET = resolve(HERE, '..', '..', 'AGENTS.md')

const argv = process.argv.slice(2)
let target = DEFAULT_TARGET
let expect = null
let jsonOut = null
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--expect') expect = Number(argv[++i])
  else if (argv[i] === '--json') jsonOut = argv[++i]
  else target = argv[i]
}

const raw = readFileSync(target, 'utf-8')
const lines = raw.split('\r\n')
const enc = getEncoding(ENCODING)

const isRule = l => /^={10,}$/.test(l)
const headOf = l => /^(\d+)\.\s+(.+?)\s*$/.exec(l)

function scan(requireLeadingRule) {
  const found = []
  for (let i = 0; i < lines.length - 1; i++) {
    const m = headOf(lines[i])
    if (!m || !isRule(lines[i + 1])) continue
    if (requireLeadingRule && !(i > 0 && isRule(lines[i - 1]))) continue
    found.push({ n: Number(m[1]), title: m[2], start: i })
  }
  return found
}

function withTokens(found) {
  return found.map((s, k) => {
    const end = k + 1 < found.length ? found[k + 1].start : lines.length
    const body = lines.slice(s.start, end).join('\r\n')
    return {
      n: s.n,
      title: s.title,
      line: s.start + 1,
      bytes: Buffer.byteLength(body, 'utf-8'),
      tokens: enc.encode(body).length,
    }
  })
}

const strict = withTokens(scan(true))
const loose = withTokens(scan(false))

const strictNums = strict.map(s => s.n)
const looseNums = loose.map(s => s.n)
const missingInStrict = looseNums.filter(n => !strictNums.includes(n))
const dup = looseNums.filter((n, i) => looseNums.indexOf(n) !== i)

const gaps = []
if (looseNums.length) {
  for (let n = looseNums[0]; n <= looseNums.at(-1); n++)
    if (!looseNums.includes(n)) gaps.push(n)
}

const report = {
  file: target,
  encoding: ENCODING,
  total_tokens: enc.encode(raw).length,
  strict_count: strict.length,
  loose_count: loose.length,
  broken_headers: missingInStrict,
  duplicated_numbers: dup,
  numbering_gaps: gaps,
  sections: loose,
}

if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2))

process.stdout.write(`arquivo: ${target}\n`)
process.stdout.write(`total: ${report.total_tokens} tok\n`)
process.stdout.write(`secoes - estrito: ${strict.length} | tolerante: ${loose.length}\n`)
if (missingInStrict.length)
  process.stdout.write(`CABECALHO QUEBRADO (sem "====" de abertura): secoes ${missingInStrict.join(', ')}\n`)
if (dup.length) process.stdout.write(`NUMEROS DUPLICADOS: ${dup.join(', ')}\n`)
if (gaps.length) process.stdout.write(`LACUNAS NA NUMERACAO: ${gaps.join(', ')}\n`)

if (expect !== null) {
  const ok = strict.length === expect && loose.length === expect
  process.stdout.write(
    ok
      ? `PORTAO OK: --expect ${expect} satisfeito nos dois modos\n`
      : `PORTAO FALHOU: esperado ${expect}, estrito=${strict.length}, tolerante=${loose.length}\n`,
  )
  if (!ok) process.exit(1)
}

if (!jsonOut) {
  process.stdout.write('\n  n | linha |   tok | titulo\n')
  for (const s of loose)
    process.stdout.write(
      `${String(s.n).padStart(3)} | ${String(s.line).padStart(5)} | ${String(s.tokens).padStart(5)} | ${s.title}\n`,
    )
}
