import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { _electron } from 'playwright'

assert.equal(process.platform, 'win32', 'Este gate usa o Electron para Windows.')

const liaRoot = fileURLToPath(new URL('../../', import.meta.url))
const evidence = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'lia-home-r04-'))
const captures = []
console.log(`Evidências da Home R04 em ${evidence}`)

async function launch(name, setup, extraArgs = []) {
  const root = join(evidence, name)
  const appData = join(root, 'appdata')
  await mkdir(appData, { recursive: true })
  await writeFile(join(root, 'lia-product.json'), JSON.stringify({
    setup: { completed: setup === 'ready' },
    voice: { enabled: false },
    ...(setup === 'ready' ? { provider: { chat: { preferred: { providerId: 'local-chat', modelId: 'local-gate' } } } } : {}),
  }))
  if (setup === 'ready') {
    await writeFile(join(root, 'lia-transports.json'), JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      records: [{
        id: 'local-chat', providerId: 'local-chat', definitionId: 'local-chat',
        type: 'http', protocol: 'chat-completions', baseUrl: 'http://127.0.0.1:1234/v1',
        modelIds: ['local-gate'],
        adapterOptions: { localOnly: true, allowUnauthenticated: true },
        enabled: true, metadata: {}, credentialRef: { scope: 'local-chat', key: 'apiKey' },
      }],
      tombstones: [],
      migration: { version: 1, imported: [] },
    }))
  }
  return _electron.launch({
    executablePath: join(liaRoot, 'stage', 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [...extraArgs, join(liaRoot, 'desktop', 'out', 'main', 'index.js')],
    env: { ...process.env, APPDATA: appData, LIA_USER_DATA: root },
  })
}

async function resize(app, page, width, height) {
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    BrowserWindow.getAllWindows()[0].setContentSize(w, h)
  }, [width, height])
  await page.waitForFunction(([w, h]) => innerWidth === w && innerHeight === h, [width, height], { timeout: 5000 })
}

async function capture(page, filename, fixture) {
  const actual = await page.evaluate(async () => {
    await document.fonts.ready
    const image = document.querySelector('.home img')
    await image.decode()
    const main = document.querySelector('main')
    return {
      width: innerWidth, height: innerHeight, devicePixelRatio,
      documentOverflow: document.documentElement.scrollWidth > innerWidth,
      contentOverflow: main.scrollWidth > main.clientWidth,
      portraitWidth: image.naturalWidth,
      font: Array.from(document.fonts, face => ({ family: face.family, status: face.status })),
    }
  })
  assert.equal(actual.portraitWidth, 1672)
  assert.ok(actual.font.some(face => face.family.includes('Plus Jakarta Sans') && face.status === 'loaded'), 'Fonte local indisponível.')
  assert.ok(!actual.documentOverflow && !actual.contentOverflow, `Overflow horizontal em ${filename}.`)
  await page.screenshot({ path: join(evidence, filename), scale: 'css', animations: 'disabled' })
  captures.push({ filename, fixture, ...actual })
}

const ready = await launch('configured-profile', 'ready')
try {
  const page = await ready.firstWindow()
  await page.getByText('Pronta para conversar', { exact: true }).waitFor()
  const start = page.getByRole('button', { name: 'Conversar com Lia', exact: true })
  assert.ok(await start.isEnabled())
  for (const [width, height, filename] of [
    [1920, 1080, 'wide-ready-1920x1080.png'],
    [1366, 768, 'wide-ready-1366x768.png'],
    [1320, 860, 'wide-ready-1320x860.png'],
    [880, 660, 'compact-ready-880x660.png'],
    [660, 430, 'narrow-ready-660x430.png'],
    [440, 330, 'narrow-ready-440x330.png'],
  ]) {
    await resize(ready, page, width, height)
    await capture(page, filename, 'synthetic-local-configuration')
  }
  await page.getByRole('navigation').getByRole('button', { name: 'Diagnósticos', exact: true }).focus()
  await page.keyboard.press('Tab')
  const focus = await start.evaluate((button) => {
    const bounds = button.getBoundingClientRect()
    return button.matches(':focus-visible') && bounds.top >= 0 && bounds.bottom <= innerHeight && button.closest('main').scrollTop > 0
  })
  assert.ok(focus, 'A ação precisa permanecer visível ao receber foco após rolar a Home estreita.')
  await capture(page, 'narrow-ready-focus-440x330.png', 'synthetic-local-configuration-keyboard-focus')
  await resize(ready, page, 880, 660)
  await ready.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25))
  await page.waitForFunction(() => innerWidth === 704 && innerHeight === 528)
  await capture(page, 'compact-ready-zoom125.png', 'synthetic-local-configuration-electron-zoom')

  // Fault injection confined to this launched process and this test profile.
  await ready.evaluate(({ BrowserWindow, ipcMain }) => {
    ipcMain.removeHandler('lia:home-status')
    ipcMain.handle('lia:home-status', () => { throw new Error('synthetic QA readiness failure') })
    BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1)
  })
  await page.reload()
  await page.getByRole('alert').filter({ hasText: 'Não foi possível verificar a prontidão.' }).waitFor()
  await capture(page, 'compact-error-readiness-ipc.png', 'injected-home-status-rejection')
  await page.getByRole('main').getByRole('button', { name: 'Diagnósticos', exact: true }).click()
  await page.getByRole('heading', { name: 'Diagnósticos', exact: true }).waitFor()
}
finally {
  await ready.close()
}

const empty = await launch('first-run-profile', 'empty')
try {
  const page = await empty.firstWindow()
  const configure = page.getByRole('button', { name: 'Configurar IA', exact: true })
  await configure.waitFor()
  await resize(empty, page, 880, 660)
  await page.getByRole('heading', { name: 'Como você quer começar?', exact: true }).waitFor()
  await capture(page, 'compact-first-run.png', 'fresh-profile-voice-disabled')
  await page.getByRole('button', { name: 'Somente texto', exact: true }).click()
  await page.getByRole('heading', { name: 'Como você quer começar?', exact: true }).waitFor({ state: 'hidden' })
  await capture(page, 'compact-unconfigured.png', 'completed-setup-missing-ai')
  const rail = page.getByRole('navigation')
  await rail.getByRole('button', { name: 'Início', exact: true }).focus()
  await page.keyboard.press('Tab')
  assert.ok(await rail.getByRole('button', { name: /IA.*Recursos/ }).evaluate(button => document.activeElement === button))
  await configure.focus()
  await page.keyboard.press('Enter')
  await page.getByRole('heading', { name: 'Inteligência artificial', exact: true }).waitFor()
}
finally {
  await empty.close()
}

const scaled = await launch('scaled-profile', 'ready', ['--force-device-scale-factor=1.25'])
try {
  const page = await scaled.firstWindow()
  await page.getByText('Pronta para conversar', { exact: true }).waitFor()
  await scaled.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1000, 750))
  await page.waitForFunction(() => innerWidth > 720 && innerWidth <= 1040, null, { timeout: 5000 })
  assert.equal(await page.evaluate(() => devicePixelRatio), 1.25)
  await capture(page, 'compact-ready-dpi125.png', 'synthetic-local-configuration-device-scale')
}
finally {
  await scaled.close()
}

await writeFile(join(evidence, 'home-r04-report.json'), JSON.stringify({ captures }, null, 2))
console.log(`Home R04 validada em ${evidence}`)
