import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const workspaceRoot = fileURLToPath(new URL('../../airi/', import.meta.url))

function mapBrainConsumers(patterns) {
  const matches = patterns.map(() => [])
  for (const root of ['apps', 'packages']) {
    for (const workspace of readdirSync(join(workspaceRoot, root), { withFileTypes: true })) {
      if (!workspace.isDirectory() || workspace.name === 'lia-core')
        continue

      const sourceRoot = join(workspaceRoot, root, workspace.name, 'src')
      if (!existsSync(sourceRoot))
        continue
      const entries = readdirSync(sourceRoot, { recursive: true, withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile() || !/\.(?:ts|vue)$/.test(entry.name) || entry.name.includes('.test.'))
          continue
        const file = join(entry.parentPath, entry.name)
        const content = readFileSync(file, 'utf8')
        const sourceName = relative(workspaceRoot, file).replaceAll('\\', '/')
        patterns.forEach((pattern, index) => {
          if (pattern.test(content))
            matches[index].push(sourceName)
        })
      }
    }
  }
  return matches
}

test('chat and provider execution preserve the Brain dependency boundary', () => {
  const chatPath = [
    'packages/stage-ui/src/stores/chat.ts',
    'packages/core-agent/src/runtime/chat-orchestrator-runtime.ts',
    'apps/stage-tamagotchi/src/renderer/components/InteractiveArea.vue',
  ]
  for (const file of chatPath)
    assert.doesNotMatch(readFileSync(join(workspaceRoot, file), 'utf8'), /LiaBrainService|liaBrain\b|decideBrainRoute|brainRequirementForChatTurn/, file)

  const [requirementConsumers, adapterConsumers] = mapBrainConsumers([
    /brainRequirementForChatTurn|LiaChatTurnBrainFacts/,
    /groqBrainDescriptors|LiaBrainDescriptorSet/,
  ])
  assert.deepEqual(requirementConsumers.sort(), [
    'apps/lia-app/src/main/lia-host.ts',
    'apps/stage-tamagotchi/src/main/services/lia/brain-decision-service.ts',
    'apps/stage-tamagotchi/src/shared/eventa/index.ts',
  ])
  assert.deepEqual(adapterConsumers, [])
})

test('the Groq descriptor evidence matches the legacy catalog and chat path', () => {
  const catalog = readFileSync(join(workspaceRoot, 'apps/stage-tamagotchi/src/renderer/stores/lia/provider.ts'), 'utf8')
  assert.ok(catalog.includes("{ id: 'groq', label: 'Groq'"))
  assert.ok(catalog.includes("{ id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B' }"))

  const provider = readFileSync(join(workspaceRoot, 'packages/stage-ui/src/libs/providers/providers/groq/index.ts'), 'utf8')
  assert.ok(provider.includes("id: 'groq'"))
  assert.ok(provider.includes("name: 'Groq'"))
  assert.match(provider, /reasoning/)
  assert.match(provider, /gpt-oss accepts only/)
  assert.match(provider, /tasks: \['chat'\]/)
  assert.doesNotMatch(provider, /tasks: \[[^\]]*vision/)

  const llm = readFileSync(join(workspaceRoot, 'packages/core-agent/src/runtime/llm-service.ts'), 'utf8')
  assert.match(llm, /streamOptionsToolsCompatibilityOk/)
  assert.match(llm, /mergedTools/)
})
