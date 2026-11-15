import type { TransportMutation, TransportResult } from '../../../../../../lia/core/src/transports/contracts'

import { defineInvokeEventa } from '@moeru/eventa'

export const electronLiaTransportsGet = defineInvokeEventa<TransportResult>('eventa:invoke:lia:transports:get')
export const electronLiaTransportsMutate = defineInvokeEventa<TransportResult, TransportMutation>('eventa:invoke:lia:transports:mutate')
