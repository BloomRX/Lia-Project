type SocialProvider = 'github' | 'google' | 'steam'

export type OidcAccountOperation
  = | { kind: 'get-profile' | 'list-linked-accounts' | 'request-password-reset' }
    | { kind: 'update-name', name: string }
    | { kind: 'change-password', currentPassword: string, newPassword: string }
    | { kind: 'delete-account', confirmationEmail: string }
    | { kind: 'unlink-account', provider: SocialProvider }

export interface OidcAccountProfile {
  id: string
  name: string
  email: string
  image: string | null
}

interface OidcLinkedAccount {
  providerId: string
  createdAt: string
}

type OidcAccountError
  = | 'invalid-request' | 'unauthenticated' | 'confirmation-required' | 'cancelled' | 'rejected' | 'unavailable'
    | 'invalid-password' | 'password-too-short' | 'password-too-long' | 'password-unset' | 'last-sign-in-method'

export type OidcAccountResult
  = | { ok: true, profile: OidcAccountProfile }
    | { ok: true, linkedAccounts: OidcLinkedAccount[] }
    | { ok: true }
    | { ok: false, code: OidcAccountError }

interface OidcAccountOptions {
  origin: URL
  fetch?: typeof fetch
  withAccess: <T>(signal: AbortSignal, action: (accessToken: string, signal: AbortSignal, containsPrivateValue: (text: string) => boolean) => Promise<T>) => Promise<T | undefined>
}

const responseLimit = 256 * 1024

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
}

function stringWithin(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= limit
}

function parseOperation(value: unknown): OidcAccountOperation | undefined {
  if (!record(value))
    return
  const { kind } = value
  const fields = Object.keys(value)
  const hasFields = (...names: string[]) => fields.length === names.length + 1
    && fields.includes('kind') && names.every(name => fields.includes(name))
  switch (kind) {
    case 'get-profile':
    case 'list-linked-accounts':
    case 'request-password-reset':
      return hasFields() ? { kind } : undefined
    case 'update-name':
      if (hasFields('name') && stringWithin(value.name, 256) && value.name.trim())
        return { kind, name: value.name.trim() }
      return
    case 'change-password':
      if (hasFields('currentPassword', 'newPassword') && stringWithin(value.currentPassword, 256) && stringWithin(value.newPassword, 256))
        return { kind, currentPassword: value.currentPassword, newPassword: value.newPassword }
      return
    case 'delete-account':
      if (hasFields('confirmationEmail') && stringWithin(value.confirmationEmail, 320))
        return { kind, confirmationEmail: value.confirmationEmail.trim().toLowerCase() }
      return
    case 'unlink-account':
      if (hasFields('provider') && (value.provider === 'github' || value.provider === 'google' || value.provider === 'steam'))
        return { kind, provider: value.provider }
  }
}

function discard(response: Response) {
  void response.body?.cancel().catch(() => {})
}

async function readJson(response: Response, signal: AbortSignal, limit = responseLimit): Promise<unknown> {
  if (!response.body)
    throw new Error('Invalid account response')

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const cancel = () => {
    void reader.cancel().catch(() => {})
  }
  signal.addEventListener('abort', cancel, { once: true })
  let length = 0
  let body = ''
  try {
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      signal.throwIfAborted()
      if (done)
        return JSON.parse(body + decoder.decode())
      length += value.byteLength
      if (length > limit)
        throw new Error('Account response too large')
      body += decoder.decode(value, { stream: true })
    }
  }
  finally {
    signal.removeEventListener('abort', cancel)
    cancel()
    reader.releaseLock()
  }
}

function publicProfile(data: unknown): OidcAccountProfile | undefined {
  if (!record(data) || !record(data.user) || !record(data.session))
    return
  const { id, name, email, image } = data.user
  if (!stringWithin(id, 256) || typeof name !== 'string' || name.length > 256 || !stringWithin(email, 320))
    return
  let publicImage: string | null = null
  if (stringWithin(image, 4096) && URL.canParse(image)) {
    const url = new URL(image)
    if (url.protocol === 'https:' && !url.username && !url.password)
      publicImage = url.href
  }
  return { id, name, email, image: publicImage }
}

function date(value: unknown): value is string {
  return stringWithin(value, 64) && Number.isFinite(Date.parse(value))
}

function publicList<T>(data: unknown, project: (value: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(data) || data.length > 256)
    return
  const projected: T[] = []
  for (const value of data) {
    const item = project(value)
    if (!item)
      return
    projected.push(item)
  }
  return projected
}

function publicLinkedAccount(data: unknown): OidcLinkedAccount | undefined {
  if (record(data) && stringWithin(data.providerId, 128) && date(data.createdAt))
    return { providerId: data.providerId, createdAt: data.createdAt }
}

function decodeUrlEscapes(value: string): string {
  return value.replace(/(?:%[\da-f]{2})+/gi, encoded => new TextDecoder().decode(Uint8Array.from(
    encoded.match(/%[\da-f]{2}/gi) ?? [],
    byte => Number.parseInt(byte.slice(1), 16),
  )))
}

function failure(code: OidcAccountError): OidcAccountResult {
  return { ok: false, code }
}

class AccountRequestError extends Error {
  constructor(readonly code: OidcAccountError) {
    super(code)
  }
}

async function rejectedAccountRequest(response: Response, path: string, signal: AbortSignal): Promise<OidcAccountError> {
  if (response.status === 400 && (path === 'change-password' || path === 'unlink-account')) {
    // Better Auth has stable codes for these UI cases. Keep its message and
    // any other fields inside Main, and cap the bytes read even on failure.
    const body = await readJson(response, signal, 8 * 1024).catch(() => undefined)
    signal.throwIfAborted()
    const code = record(body) ? body.code : undefined
    if (path === 'unlink-account')
      return code === 'FAILED_TO_UNLINK_LAST_ACCOUNT' ? 'last-sign-in-method' : 'rejected'
    switch (code) {
      case 'INVALID_PASSWORD': return 'invalid-password'
      case 'PASSWORD_TOO_SHORT': return 'password-too-short'
      case 'PASSWORD_TOO_LONG': return 'password-too-long'
      case 'CREDENTIAL_ACCOUNT_NOT_FOUND': return 'password-unset'
      default: return 'rejected'
    }
  }
  discard(response)
  return response.status === 401 ? 'unauthenticated' : response.status < 500 ? 'rejected' : 'unavailable'
}

/** Fixed Better Auth operations for the Desktop account page. Main-only. */
export function createOidcAccountService({ origin, fetch: transport = fetch, withAccess }: OidcAccountOptions) {
  const { protocol, hostname, username, password, pathname, search, hash } = origin
  const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  if ((protocol !== 'https:' && (protocol !== 'http:' || !loopback)) || username || password || pathname !== '/' || search || hash)
    throw new Error('Invalid account origin')
  const server = origin.origin

  async function execute(payload: unknown, callerSignal: AbortSignal): Promise<OidcAccountResult> {
    const operation = parseOperation(payload)
    if (!operation)
      return failure('invalid-request')
    if (callerSignal.aborted)
      return failure('cancelled')

    const deadline = AbortSignal.timeout(30_000)
    const signal = AbortSignal.any([callerSignal, deadline])
    let accessSignal = signal
    try {
      const result = await withAccess<OidcAccountResult>(signal, async (token, sessionSignal, containsPrivateValue) => {
        accessSignal = AbortSignal.any([signal, sessionSignal])
        function project<T extends object>(data: T): T {
          // Check actual field values so JSON escaping cannot obscure a secret.
          if (Object.values(data).some(value => typeof value === 'string' && containsPrivateValue(value)))
            throw new AccountRequestError('unavailable')
          return data
        }

        async function request(path: string, body?: Record<string, unknown>): Promise<unknown> {
          accessSignal.throwIfAborted()
          const response = await transport(new URL(`/api/auth/${path}`, server), {
            method: body ? 'POST' : 'GET',
            headers: { Authorization: `Bearer ${token}`, ...(body && { 'Content-Type': 'application/json' }) },
            body: body ? JSON.stringify(body) : undefined,
            credentials: 'omit',
            redirect: 'error',
            signal: accessSignal,
          })
          if (accessSignal.aborted) {
            discard(response)
            accessSignal.throwIfAborted()
          }
          if (!response.ok)
            throw new AccountRequestError(await rejectedAccountRequest(response, path, accessSignal))
          return await readJson(response, accessSignal)
        }

        async function readProfile() {
          const data = await request('get-session')
          if (data === null)
            throw new AccountRequestError('unauthenticated')
          const profile = publicProfile(data)
          if (!profile || (profile.image && containsPrivateValue(decodeUrlEscapes(profile.image))))
            throw new AccountRequestError('unavailable')
          return project(profile)
        }

        function requireTrue(data: unknown, field: 'status' | 'success') {
          if (!record(data) || data[field] !== true)
            throw new AccountRequestError('unavailable')
        }

        switch (operation.kind) {
          case 'get-profile':
            return { ok: true, profile: await readProfile() }
          case 'list-linked-accounts': {
            const linkedAccounts = publicList(await request('list-accounts'), publicLinkedAccount)
            return linkedAccounts ? { ok: true, linkedAccounts: linkedAccounts.map(project) } : failure('unavailable')
          }
          case 'update-name':
            requireTrue(await request('update-user', { name: operation.name }), 'status')
            break
          case 'change-password': {
            const data = await request('change-password', {
              currentPassword: operation.currentPassword,
              newPassword: operation.newPassword,
              revokeOtherSessions: true,
            })
            if (!record(data) || !record(data.user))
              throw new AccountRequestError('unavailable')
            break
          }
          case 'request-password-reset': {
            const { email } = await readProfile()
            requireTrue(await request('request-password-reset', { email, redirectTo: new URL('/auth/reset-password', server).href }), 'status')
            break
          }
          case 'delete-account': {
            const { email } = await readProfile()
            if (email.trim().toLowerCase() !== operation.confirmationEmail)
              return failure('confirmation-required')
            requireTrue(await request('delete-user', { callbackURL: new URL('/auth/delete-account', server).href }), 'success')
            break
          }
          case 'unlink-account':
            requireTrue(await request('unlink-account', { providerId: operation.provider }), 'status')
            break
        }
        return { ok: true }
      })
      accessSignal.throwIfAborted()
      return result ?? failure('unauthenticated')
    }
    catch (error) {
      if (callerSignal.aborted || (accessSignal.aborted && !deadline.aborted))
        return failure('cancelled')
      return failure(error instanceof AccountRequestError ? error.code : 'unavailable')
    }
  }

  return { execute }
}
