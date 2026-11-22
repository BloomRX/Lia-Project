import { defineInvokeEventa } from '@moeru/eventa'

export type OidcAccountOperation
  = | { kind: 'get-profile' | 'list-linked-accounts' | 'request-password-reset' }
    | { kind: 'update-name', name: string }
    | { kind: 'change-password', currentPassword: string, newPassword: string }
    | { kind: 'delete-account', confirmationEmail: string }
    | { kind: 'unlink-account', provider: 'github' | 'google' | 'steam' }

export interface OidcAccountProfile {
  id: string
  name: string
  email: string
  image: string | null
}

export interface OidcLinkedAccount {
  providerId: string
  createdAt: string
}

export type OidcAccountError
  = | 'invalid-request' | 'unauthenticated' | 'confirmation-required' | 'cancelled' | 'rejected' | 'unavailable'
    | 'invalid-password' | 'password-too-short' | 'password-too-long' | 'password-unset' | 'last-sign-in-method'

export type OidcAccountResult
  = | { ok: true, profile: OidcAccountProfile }
    | { ok: true, linkedAccounts: OidcLinkedAccount[] }
    | { ok: true }
    | { ok: false, code: OidcAccountError }

export const electronLiaOidcAccount = defineInvokeEventa<OidcAccountResult, OidcAccountOperation>('eventa:invoke:lia:oidc:account')
