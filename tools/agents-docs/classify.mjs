#!/usr/bin/env node
/**
 * Contabilidade dos quatro baldes do AGENTS.md da Lia.
 *
 * Uso:
 *   node classify.mjs [--extract-json <secoes.json>]
 *
 * Se --extract-json nao for dado, roda a extracao internamente.
 *
 * OS BALDES
 *   A  nucleo literal no CLAUDE.md da raiz  - vale em toda sessao, toda pasta
 *   B  .claude/rules/ SEM paths:            - vale sempre, so sai do arquivo principal
 *   C  .claude/rules/ COM paths:            - so vale quando se toca em arquivo que casa
 *   D  sobra                                - historico / nao e instrucao
 *
 * A CONTA QUE IMPORTA
 *   A -> B NAO economiza nada: os dois sao carregados sempre. Mover de um para
 *   o outro e apenas organizacao. Toda economia vem de C e D. Da para fazer a
 *   separacao inteira, ver o CLAUDE.md encolher e nao ganhar um token.
 *
 * O ANEXO DA SECAO 0
 *   A secao 0 custa ~180 tok de texto, mas e uma ORDEM de ler o
 *   CURRENT-STATE.md, que custa ~12.800 tok. O custo efetivo do nucleo e
 *   A + esse anexo, nao A. Este script mede o anexo de verdade, no arquivo.
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { getEncoding } from 'js-tiktoken'

const ENCODING = 'o200k_base'
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')

const argv = process.argv.slice(2)
let extractJson = null
for (let i = 0; i < argv.length; i++)
  if (argv[i] === '--extract-json') extractJson = argv[++i]

let sections
if (extractJson) {
  sections = JSON.parse(readFileSync(extractJson, 'utf-8')).sections
} else {
  execFileSync(process.execPath, [resolve(HERE, 'extract.mjs'), '--json', resolve(HERE, 'secoes.json')])
  sections = JSON.parse(readFileSync(resolve(HERE, 'secoes.json'), 'utf-8')).sections
}

const tok = Object.fromEntries(sections.map(s => [s.n, s.tokens]))
const title = Object.fromEntries(sections.map(s => [s.n, s.title]))

const A = [0, 2, 3, 6, 7, 62, 64, 65, 66, 71, 72, 73, 76, 77, 78, 79, 90, 93, 94]
const B = [1, 4, 5, 8, 11, 16, 30, 32, 34, 37, 38, 42, 46, 51, 54, 55, 57, 58, 63, 82, 86, 89, 91, 99]
const C = {
  'voz.md            voz/TTS/STT/audio': [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 33, 87],
  'llm.md            provider/routing/chat': [17, 18, 19],
  'ui.md             **/*.vue, componentes': [43, 44, 45, 47, 48, 49, 50, 70, 83, 84, 85],
  'i18n.md           locale/**, **/*.vue': [67, 98],
  'hardware.md       bootstrap/, detection': [12, 13, 14, 15, 52, 81],
  'acessibilidade.md **/*.vue, *.css': [68, 69],
  'testes.md         **/*.test.ts, Tests/**': [80],
  'licencas.md       package.json, docs/licenses': [74, 97],
  'diagnostico.md    diagnostics/, repair': [56, 59, 60, 61],
  'distribuicao.md   installer/, updates': [10, 53, 75],
  'integracoes.md    discord/, vision/, mcp': [31, 35, 36, 39, 40, 41],
  'adr.md            docs/architecture/**': [92],
}
const D = [9, 88, 95, 96]

// O balde E existe para secao que hoje so manda consultar um documento que NAO
// existe: isso e divida aberta, nao regra por caminho, e conta-lo como regra
// inflaria a economia estimada. Esta vazio porque a unica pendencia que ocupava
// o balde (a 81, que manda consultar docs/compatibility/MATRIX.md) foi paga: a
// matriz existe e tem conteudo. A 81 passou para hardware.md no balde C.
// Mantenha o balde vazio, e nao remova: a proxima divida precisa de um lugar.
const E = []

// ---- guarda de completude: nenhuma secao pode ficar de fora ou duplicada ----
const seen = new Set()
const take = list => list.forEach((n) => {
  if (seen.has(n)) throw new Error(`secao ${n} em dois baldes`)
  if (!(n in tok)) throw new Error(`secao ${n} nao existe no AGENTS.md`)
  seen.add(n)
})
take(A)
take(B)
Object.values(C).forEach(take)
take(D)
take(E)
const orphans = sections.map(s => s.n).filter(n => !seen.has(n))
if (orphans.length) throw new Error(`secoes sem balde: ${orphans.join(', ')}`)

const sum = a => a.reduce((t, n) => t + tok[n], 0)
const total = sections.reduce((t, s) => t + s.tokens, 0)
const cAll = Object.values(C).flat()

// ---- o anexo da secao 0, medido de verdade ----
const statePath = resolve(ROOT, 'docs', 'project', 'CURRENT-STATE.md')
const stateLines = readFileSync(statePath, 'utf-8').split(/\r?\n/)
// Depois da Etapa 1 a secao 0 manda ler so o CABECALHO: do inicio do arquivo ate o
// '---' que precede a §1. Medir o arquivo inteiro aqui seria reportar um custo que
// a ordem nao cobra mais.
const firstH2 = stateLines.findIndex(l => /^## 1\. /.test(l))
if (firstH2 < 0) throw new Error('CURRENT-STATE.md: inicio da §1 nao encontrado')
let sep = firstH2
while (sep > 0 && !/^---\s*$/.test(stateLines[sep])) sep--
if (sep === 0) throw new Error('CURRENT-STATE.md: separador antes da §1 nao encontrado')
const enc = getEncoding(ENCODING)
const stateHeadTok = enc.encode(stateLines.slice(0, sep).join('\n')).length
const stateTok = enc.encode(stateLines.join('\n')).length

const line = (label, n, t) =>
  `${label.padEnd(38)} ${String(n).padStart(3)} secoes  ${String(t).padStart(6)} tok  ${(100 * t / total).toFixed(1).padStart(5)}%`

process.stdout.write(`AGENTS.md: ${sections.length} secoes, ${total} tok\n`)
process.stdout.write(`CURRENT-STATE.md: ${stateTok} tok no total; cabecalho (§0) = ${stateHeadTok} tok\n\n`)
process.stdout.write(`${line('A) nucleo literal na raiz', A.length, sum(A))}\n`)
process.stdout.write(`${line('B) rules SEM paths:', B.length, sum(B))}\n`)
process.stdout.write(`${line('C) rules COM paths:', cAll.length, sum(cAll))}\n`)
process.stdout.write(`${line('D) sobra', D.length, sum(D))}\n`)
process.stdout.write(`${line('E) divida aberta (nao conta):', E.length, sum(E))}\n\n`)
process.stdout.write(`sempre carregado (A+B) : ${sum(A) + sum(B)} tok\n`)
process.stdout.write(`sai do fixo    (C+D)   : ${sum(cAll) + sum(D)} tok\n\n`)
process.stdout.write(
  `CUSTO EFETIVO DO NUCLEO = A (${sum(A)}) + anexo da secao 0 (${stateHeadTok}) = ${sum(A) + stateHeadTok} tok\n`,
)
process.stdout.write(
  `  -> o texto da ordem custa ${tok[0]} tok; o que ela manda ler custa ${stateHeadTok} tok\n`,
)
process.stdout.write(
  `  -> antes da Etapa 1 o anexo era o arquivo inteiro: ${stateTok} tok\n`,
)

process.stdout.write('\n--- detalhe de C ---\n')
for (const [k, v] of Object.entries(C))
  process.stdout.write(`  ${k.padEnd(42)} ${String(sum(v)).padStart(5)} tok  [${v.join(',')}]\n`)

process.stdout.write('\n--- A ---\n')
A.forEach(n => process.stdout.write(`  ${String(n).padStart(3)} ${String(tok[n]).padStart(5)}  ${title[n]}\n`))
process.stdout.write('\n--- D ---\n')
D.forEach(n => process.stdout.write(`  ${String(n).padStart(3)} ${String(tok[n]).padStart(5)}  ${title[n]}\n`))
