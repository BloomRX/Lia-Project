import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const liaRoot = fileURLToPath(new URL('../../lia/', import.meta.url))
const routingSymbols = /\b(?:brainRequirementForChatTurn|LiaChatTurnBrainFacts|decideBrainRoute\w*|createProductionBrain\w*)\b/
const descriptorSymbols = /\b(?:groqBrainDescriptors|LiaBrainDescriptorSet)\b/

function mapConsumers() {
  const routing = []
  const descriptors = []
  for (const app of ['desktop', 'stage']) {
    const sourceRoot = join(liaRoot, app, 'src')
    for (const entry of readdirSync(sourceRoot, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(?:[cm]?[jt]sx?|vue)$/.test(entry.name) || entry.name.includes('.test.'))
        continue
      const file = join(entry.parentPath, entry.name)
      const source = readFileSync(file, 'utf8')
      const name = relative(liaRoot, file).replaceAll('\\', '/')
      if (routingSymbols.test(source))
        routing.push(name)
      if (descriptorSymbols.test(source))
        descriptors.push(name)
    }
  }
  return { routing: routing.sort(), descriptors: descriptors.sort() }
}

test('native desktop keeps Brain routing in Main and consumes no raw provider descriptors', () => {
  assert.deepEqual(mapConsumers(), {
    routing: ['desktop/src/main/lia-host.ts', 'stage/src/main/stage-chat.ts'],
    descriptors: [],
  })
})
