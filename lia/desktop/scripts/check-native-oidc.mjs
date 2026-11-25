import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import { _electron, chromium } from 'playwright'

assert.equal(process.platform, 'win32')
const root = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'lia-native-oidc-'))
const appdata = join(root, 'appdata')
await mkdir(appdata)
console.log(`Evidências em ${root}`)
const clientId = 'lia-electron-fixture'
const profile = { id: 'account-fixture', email: 'lia@example.test', name: 'Conta sintética', image: null }
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const access = randomUUID()
const renewed = randomUUID()
const refresh = randomUUID()
const code = randomUUID()
let idToken
let origin
let authorization
let refreshCalls = 0
let revoked = false
let fixtureFailure = false

function json(response, value) {
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(value))
}

function signedIdentity(nonce) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  const iat = Math.floor(Date.now() / 1_000)
  const message = `${encode({ alg: 'ES256', kid: 'fixture' })}.${encode({
    iss: `${origin}/api/auth`, aud: clientId, sub: profile.id, iat, exp: iat + 60, nonce,
  })}`
  const signature = sign('sha256', Buffer.from(message), { key: privateKey, dsaEncoding: 'ieee-p1363' })
  return `${message}.${signature.toString('base64url')}`
}

async function handle(request, response) {
  const url = new URL(request.url, origin)
  switch (url.pathname) {
    case '/api/auth/oauth2/authorize': {
      const params = url.searchParams
      assert.ok(params.get('client_id') === clientId && params.get('code_challenge_method') === 'S256')
      assert.ok(params.get('redirect_uri') === `${origin}/api/auth/oidc/electron-callback`)
      const [port, state] = params.get('state').split(':')
      authorization = params
      const callback = new URL(`http://127.0.0.1:${port}/callback`)
      callback.search = new URLSearchParams({ state, code })
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      response.end(`<!doctype html><title>OIDC fixture</title><p id="result">pending</p>
        <script>
          fetch(${JSON.stringify(callback.href)}).then(response => {
            document.querySelector('#result').textContent = response.ok ? 'delivered' : 'failed'
          }).catch(() => { document.querySelector('#result').textContent = 'failed' })
        </script>`)
      return
    }
    case '/api/auth/jwks':
      return json(response, { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'fixture' }] })
    case '/api/auth/oauth2/token':
    case '/api/auth/oauth2/revoke': {
      const chunks = []
      for await (const chunk of request)
        chunks.push(chunk)
      const fields = new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
      assert.ok(fields.get('client_id') === clientId)
      if (url.pathname.endsWith('/revoke')) {
        assert.ok(fields.get('token') === refresh)
        revoked = true
        response.writeHead(204).end()
        return
      }
      if (fields.get('grant_type') === 'authorization_code') {
        assert.ok(fields.get('code') === code)
        assert.ok(createHash('sha256').update(fields.get('code_verifier')).digest('base64url') === authorization.get('code_challenge'))
        idToken = signedIdentity(authorization.get('nonce'))
        return json(response, { access_token: access, refresh_token: refresh, id_token: idToken, expires_in: 2 })
      }
      assert.ok(fields.get('grant_type') === 'refresh_token' && fields.get('refresh_token') === refresh)
      refreshCalls++
      return json(response, { access_token: renewed, expires_in: 60 })
    }
    case '/api/auth/get-session': {
      assert.ok([access, renewed].some(token => request.headers.authorization === `Bearer ${token}`))
      return json(response, { user: profile, session: { token: access, refreshToken: refresh, idToken } })
    }
    default:
      response.writeHead(404).end()
  }
}

const server = createServer((request, response) => {
  void handle(request, response).catch(() => {
    fixtureFailure = true
    response.writeHead(500).end()
  })
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
origin = `http://127.0.0.1:${server.address().port}`
const launcher = fileURLToPath(new URL('../out/main/index.js', import.meta.url))
const executablePath = fileURLToPath(new URL('../../stage/node_modules/electron/dist/electron.exe', import.meta.url))
const env = { ...process.env, APPDATA: appdata, LIA_USER_DATA: root, LIA_OIDC_TEST_ORIGIN: origin, LIA_OIDC_TEST_CLIENT_ID: clientId }
const start = () => _electron.launch({ executablePath, args: [launcher], env })
let app
let browser
try {
  app = await start()
  browser = await chromium.launch()
  await app.evaluate(({ shell }) => {
    globalThis.fixtureAuthorization = Promise.withResolvers()
    shell.openExternal = async url => globalThis.fixtureAuthorization.resolve(url)
  })
  let page = await app.firstWindow()
  assert.deepEqual(await page.evaluate(() => window.liaApi.oidcStatus()), { ok: true, available: true })
  await page.getByRole('button', { name: 'Configuração', exact: true }).click()
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  const authorizationUrl = await app.evaluate(async () => {
    let timer
    try {
      return await Promise.race([
        globalThis.fixtureAuthorization.promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Missing authorization URL')), 10_000) }),
      ])
    }
    finally {
      clearTimeout(timer)
    }
  })
  assert.ok(new URL(authorizationUrl).origin === origin)
  const browserPage = await browser.newPage()
  await browserPage.goto(authorizationUrl)
  await browserPage.getByText('delivered', { exact: true }).waitFor({ timeout: 10_000 })
  await browserPage.close()
  await page.getByText(`${profile.name} · ${profile.email}`, { exact: true }).waitFor()
  await page.getByRole('region', { name: 'Conta' }).screenshot({ path: join(root, 'account-panel.png') })
  assert.deepEqual(await page.evaluate(() => window.liaApi.oidcProfile()), { ok: true, profile })
  const stored = await readFile(join(root, 'lia-secrets.json'), 'utf8')
  assert.ok([access, refresh, idToken].every(value => !stored.includes(value)))
  await app.close()
  app = undefined
  await delay(2_100)
  app = await start()
  page = await app.firstWindow()
  assert.deepEqual(await page.evaluate(() => window.liaApi.oidcProfile()), { ok: true, profile })
  assert.equal(refreshCalls, 1)
  await page.getByRole('button', { name: 'Configuração', exact: true }).click()
  await page.getByRole('button', { name: 'Sair da conta', exact: true }).click()
  await page.getByText('Você está desconectado.', { exact: true }).waitFor()
  assert.equal(revoked, true)
  assert.deepEqual(await page.evaluate(() => window.liaApi.oidcProfile()), { ok: false, code: 'unauthenticated' })
  assert.equal(fixtureFailure, false)
  const report = { electron: true, accountControls: true, issuer: 'synthetic loopback', browser: 'isolated Chromium via injected opener', pkce: true, profileProjection: true, encryptedAtRest: true, restoredAndRefreshed: true, revokedAndCleared: true }
  await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
}
finally {
  try {
    try {
      await app?.close()
    }
    finally {
      await browser?.close()
    }
  }
  finally {
    server.closeAllConnections()
    await new Promise(resolveClose => server.close(resolveClose))
  }
}
