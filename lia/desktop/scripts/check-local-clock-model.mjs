import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createStageChat } from '../../stage/src/main/stage-chat.ts'

const [port, modelId] = process.argv.slice(2)
assert.ok(/^\d{1,5}$/.test(port ?? '') && Number(port) > 0 && Number(port) <= 65535 && modelId,
  'Informe a porta local e o ID do modelo do servidor de teste.')
const root = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'lia-clock-model-'))
console.log(`Evidências em ${root}`)
const baseUrl = `http://127.0.0.1:${port}/v1`
const providerId = 'local-chat'
const requestBodies = []
const responses = []
const send = createStageChat({
  async fetch(url, options) {
    assert.equal(String(url), `${baseUrl}/chat/completions`)
    requestBodies.push(JSON.parse(options.body))
    const response = await fetch(url, options)
    responses.push({ status: response.status })
    return response
  },
  async readProduct() {
    return { status: 'ok', filePath: '', value: { provider: { chat: { preferred: { providerId, modelId } } } } }
  },
  async readTransports() {
    return {
      schemaVersion: 1, revision: 1, tombstones: [], migration: { version: 1, imported: [] },
      records: [{
        id: providerId, providerId, definitionId: providerId, type: 'http', protocol: 'chat-completions',
        baseUrl, enabled: true, modelIds: [modelId], adapterOptions: { localOnly: true, allowUnauthenticated: true },
        metadata: {}, credentialRef: { scope: providerId, key: 'apiKey' },
      }],
    }
  },
})

const result = await send(
  'Use a ferramenta de hora local para consultar o relógio deste computador. Responda somente com o horário consultado em HH:MM:SS.',
  new AbortController().signal, undefined, true,
)
const sentTime = requestBodies[1]?.messages.at(-1)?.content?.match(/\d{2}:\d{2}:\d{2}/)?.[0]
const report = {
  modelId,
  requestCount: requestBodies.length,
  httpStatus: responses.map(response => response.status),
  toolOffered: requestBodies[0]?.tools?.[0]?.function?.name === 'lia_local_time',
  toolResultSent: Boolean(sentTime),
  finalReplyMatchesClock: result.ok && Boolean(sentTime && result.text.includes(sentTime)),
  error: result.ok ? null : result.code,
}
await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
assert.equal(report.requestCount, 2)
assert.equal(report.finalReplyMatchesClock, true)
