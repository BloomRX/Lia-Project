/**
 * Runtime de teste: um processo de verdade, não um mock.
 *
 * Usado pelo teste de integração para provar as duas afirmações centrais do
 * contrato de ciclo de vida:
 *   1. o Runtime vive sozinho — nada no Launcher precisa estar de pé;
 *   2. ele só sai por pedido autenticado (ou por força, depois do prazo).
 *
 * O cofre aqui é em memória de propósito: o que este teste prova é o canal e o
 * ciclo de vida, não a criptografia do cofre (que tem testes próprios).
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

import { startRuntimeControlServer } from '../../src/runtime/control.ts'
import { createCredentialHandler } from '../../src/runtime/credentials.ts'
import { createRuntimeRecord, runtimeEndpointFor } from '../../src/runtime/instance.ts'
import { createRuntimeRegistry } from '../../src/runtime/registry.ts'
import { runCooperativeExit } from '../../src/runtime/shutdown.ts'

const stateDir = process.argv[2]
if (!stateDir) {
  console.error('missing state dir')
  process.exit(2)
}

const instanceId = globalThis.crypto.randomUUID()
const endpoint = runtimeEndpointFor(process.platform, stateDir, instanceId)
const registry = createRuntimeRegistry(stateDir)
const secrets = new Map<string, string>([['groq/apiKey', 'sk-runtime-owned']])
let revision = 0

const revisionOf = (scope: string, key: string) => `rev-${secrets.get(`${scope}/${key}`) ?? ''}`

/**
 * O cofre do Runtime. `changeSecret` exige a revisão esperada — a mesma regra
 * do cofre real — para que two-writer não sobrescreva às cegas.
 */
const store = {
  async changeSecret(scope: string, key: string, value: string | undefined, options: { expectedRevision: string }) {
    if (revisionOf(scope, key) !== options.expectedRevision)
      return undefined
    if (value === undefined)
      secrets.delete(`${scope}/${key}`)
    else
      secrets.set(`${scope}/${key}`, value)
    return { revision: `rev-${++revision}` }
  },
  async deleteSecret(scope: string, key: string) {
    secrets.delete(`${scope}/${key}`)
    return true
  },
  getSecret: (scope: string, key: string) => secrets.get(`${scope}/${key}`),
  hasSecret: (scope: string, key: string) => secrets.has(`${scope}/${key}`),
  secretRevision: revisionOf,
  async setSecret(scope: string, key: string, value: string) {
    secrets.set(`${scope}/${key}`, value)
    return true
  },
}

const credentials = createCredentialHandler(store)

const server = await startRuntimeControlServer({
  endpoint,
  handle: async (request, signal) => {
    if (request.command === 'runtime.ping')
      return { instanceId, pid: process.pid, uptimeMs: 0 }
    if (request.command === 'runtime.status')
      return { instanceId, pid: process.pid, uptimeMs: 0, windows: 0 }
    if (request.command === 'runtime.shutdown')
      return { accepted: true }
    return await credentials(request, signal)
  },
  instanceId,
  onShutdownRequested: async () => {
    // A saída é anunciada ao processo pai por stdout, não inferida por quem
    // observa: o teste sabe que o caminho cooperativo rodou de verdade.
    const report = await runCooperativeExit({
      forceExit: code => process.exit(code),
      hooks: [{ name: 'flush', run: async () => await writeFile(join(stateDir, 'flushed.marker'), 'ok') }],
      requestExit: async () => {
        await registry.remove(instanceId)
        // `close()` devolve Promise: passar callback aqui deixaria o pedido
        // pendurado até o prazo e o teste provaria o caminho FORÇADO.
        await server.close()
        console.log('runtime:exited')
        process.exit(0)
      },
      timeoutMs: 5_000,
    })
    if (report.timedOut)
      process.exit(1)
  },
})

await mkdir(stateDir, { recursive: true })
await registry.publish(createRuntimeRecord({
  appVersion: '0.0.0-test',
  endpoint,
  instanceId,
  pid: process.pid,
  publicKey: server.publicKey,
  startedBy: 'launcher',
}))

console.log('runtime:ready')
// Mantém o processo vivo sem timers: o servidor já segura o event loop.
