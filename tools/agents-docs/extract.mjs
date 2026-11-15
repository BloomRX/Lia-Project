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
 * como unidade - sem erro e sem aviso.
 *
 * O PORTAO E INTRINSECO, NAO UM NUMERO FIXO.
 *
 * A primeira versao exigia `--expect 99`. Quando a secao 99 foi escrita no
 * AGENTS.md, o portao passou a reprovar um arquivo correto e o `classify.mjs`
 * passou a abortar com "secoes sem balde: 99". Um numero que precisa ser
 * editado a cada secao nova nao protege nada: ele so transfere o erro para quem
 * esquece de editar. Agora o padrao verifica o que e verdadeiro em qualquer
 * versao do arquivo:
 *
 *   - estrito e tolerante concordam (nenhum cabecalho quebrado);
 *   - nenhum numero duplicado;
 *   - nenhuma lacuna na numeracao;
 *   - a numeracao comeca em 0 e avanca de 1 em 1.
 *
 * `--expect N` continua disponivel como assercao extra, para quem quiser
 * congelar a contagem de proposito (ex.: um commit de reestruturacao que deve
 * terminar com exatamente N secoes). Ele soma ao portao intrinseco; nao o
 * substitui.
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

// A numeracao tem que comecar em 0 e avancar de 1 em 1. Uma secao 0 ausente, ou
// um salto, significa que uma unidade foi fundida ou perdida no caminho.
const firstNumber = looseNums.length ? looseNums[0] : null
const contiguous = looseNums.every((n, i) => n === i)

const problems = []
if (missingInStrict.length)
  problems.push(`cabecalho quebrado (sem "====" de abertura): ${missingInStrict.join(', ')}`)
if (dup.length) problems.push(`numeros duplicados: ${dup.join(', ')}`)
if (gaps.length) problems.push(`lacunas na numeracao: ${gaps.join(', ')}`)
if (firstNumber !== 0)
  problems.push(`numeracao nao comeca em 0: comeca em ${firstNumber}`)
else if (!contiguous)
  problems.push('numeracao fora de ordem ou com salto')

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

if (expect !== null && !(strict.length === expect && loose.length === expect))
  problems.push(`--expect ${expect} nao satisfeito: estrito=${strict.length}, tolerante=${loose.length}`)

if (problems.length) {
  process.stdout.write(`PORTAO FALHOU:\n${problems.map(p => `  - ${p}`).join('\n')}\n`)
  process.exit(1)
}

process.stdout.write(
  `PORTAO OK: ${loose.length} secoes, numeracao 0..${loose.length - 1} continua, estrito e tolerante concordam`
  + `${expect === null ? '' : `, --expect ${expect} satisfeito`}\n`,
)

if (!jsonOut) {
  process.stdout.write('\n  n | linha |   tok | titulo\n')
  for (const s of loose)
    process.stdout.write(
      `${String(s.n).padStart(3)} | ${String(s.line).padStart(5)} | ${String(s.tokens).padStart(5)} | ${s.title}\n`,
    )
}
