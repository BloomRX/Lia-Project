import type { createContext } from '@moeru/eventa/adapters/electron/main'

import { join } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { app } from 'electron'

import { createLiaMemoryStore } from '../../../../../../../lia/core/src/memory/store.ts'
import { electronLiaMemoryGet, electronLiaMemoryMutate, electronLiaMemoryRecall } from '../../../shared/eventa/lia-memory'

export { createLiaMemoryStore } from '../../../../../../../lia/core/src/memory/store.ts'

export function registerLiaMemoryBridge(params: {
  context: ReturnType<typeof createContext>['context']
  store?: ReturnType<typeof createLiaMemoryStore>
}): void {
  const store = params.store ?? createLiaMemoryStore({ filePath: join(app.getPath('userData'), 'lia-memory.json') })
  defineInvokeHandler(params.context, electronLiaMemoryGet, () => store.get())
  defineInvokeHandler(params.context, electronLiaMemoryMutate, request => store.mutate(request))
  defineInvokeHandler(params.context, electronLiaMemoryRecall, request => store.recall(request?.query))
}
