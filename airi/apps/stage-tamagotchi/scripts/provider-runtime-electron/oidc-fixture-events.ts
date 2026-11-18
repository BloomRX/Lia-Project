import type { OidcAccountResult } from '../../src/main/services/airi/oidc-account'

import { defineInvokeEventa } from '@moeru/eventa'

export const oidcFixtureProfile = defineInvokeEventa<OidcAccountResult>('eventa:invoke:lia:gate:oidc-profile')
