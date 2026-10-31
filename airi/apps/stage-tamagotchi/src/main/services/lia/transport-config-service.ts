import type { createContext } from '@moeru/eventa/adapters/electron/main'

import { join } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { app } from 'electron'

import { createTransportRepository } from '../../../../../../../lia/core/src/transports/repository'
import { electronLiaTransportsGet, electronLiaTransportsMutate } from '../../../shared/eventa/lia-transports'

let applicationRepository: ReturnType<typeof createTransportRepository> | undefined

/** One main-process writer; renderers exchange only validated, secret-free records. */
export function registerLiaTransportConfigBridge(params: {
  context: ReturnType<typeof createContext>['context']
  repository?: ReturnType<typeof createTransportRepository>
}) {
  const repository = params.repository ?? (applicationRepository ??= createTransportRepository(join(app.getPath('userData'), 'lia-transports.json')))
  defineInvokeHandler(params.context, electronLiaTransportsGet, async () => {
    try {
      return { ok: true as const, snapshot: await repository.read() }
    }
    catch {
      return { ok: false as const, code: 'storage' as const }
    }
  })
  defineInvokeHandler(params.context, electronLiaTransportsMutate, async (mutation) => {
    try {
      return await repository.mutate(mutation)
    }
    catch {
      return { ok: false as const, code: 'storage' as const }
    }
  })
}
