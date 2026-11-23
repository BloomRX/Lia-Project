import type { LiaMemoryMutation, LiaMemoryResult } from '../../../../../../lia/core/src/memory/contracts.ts'

import { defineInvokeEventa } from '@moeru/eventa'

export type { LiaMemoryEntry, LiaMemoryMutation, LiaMemoryResult, LiaMemoryState } from '../../../../../../lia/core/src/memory/contracts.ts'
export { LIA_MEMORY_LIMITS } from '../../../../../../lia/core/src/memory/contracts.ts'

export const electronLiaMemoryGet = defineInvokeEventa<LiaMemoryResult>('eventa:invoke:lia:memory:get')
export const electronLiaMemoryMutate = defineInvokeEventa<LiaMemoryResult, LiaMemoryMutation>('eventa:invoke:lia:memory:mutate')
export const electronLiaMemoryRecall = defineInvokeEventa<LiaMemoryResult<string>, { query: string }>('eventa:invoke:lia:memory:recall')
