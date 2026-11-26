import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import { _electron } from 'playwright'

import { defaultPresence } from '../../core/src/presence/index.ts'

function createFixture(externalTexture = false) {
  const bones = {
    hips: null,
    spine: 'hips',
    head: 'spine',
    leftUpperArm: 'spine',
    leftLowerArm: 'leftUpperArm',
    leftHand: 'leftLowerArm',
    rightUpperArm: 'spine',
    rightLowerArm: 'rightUpperArm',
    rightHand: 'rightLowerArm',
    leftUpperLeg: 'hips',
    leftLowerLeg: 'leftUpperLeg',
    leftFoot: 'leftLowerLeg',
    rightUpperLeg: 'hips',
    rightLowerLeg: 'rightUpperLeg',
    rightFoot: 'rightLowerLeg',
  }
  const names = Object.keys(bones)
  const nodes = names.map(name => ({ name, children: [], translation: [0, 0.1, 0] }))
  names.forEach((name, i) => {
    if (bones[name])
      nodes[names.indexOf(bones[name])].children.push(i)
  })
  const positions = Buffer.from(new Float32Array([-0.4, 0, 0, 0.4, 0, 0, 0, 1.5, 0]).buffer)
  const times = Buffer.from(new Float32Array([0, 0.5, 1]).buffer)
  const translations = Buffer.from(new Float32Array([0, 0, 0, 0.15, 0, 0, 0, 0, 0]).buffer)
  const binary = Buffer.concat([positions, times, translations])
  const document = {
    asset: { version: '2.0' },
    extensionsUsed: ['VRMC_vrm'],
    extensions: {
      VRMC_vrm: {
        specVersion: '1.0',
        meta: { name: 'Fixture de QA', authors: ['Lia'], licenseUrl: 'https://vrm.dev/licenses/1.0/' },
        humanoid: { humanBones: Object.fromEntries(names.map((name, node) => [name, { node }])) },
      },
    },
    scene: 0,
    scenes: [{ nodes: [0, nodes.length] }],
    nodes: [...nodes, { mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [{ doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [0.2, 0.85, 0.3, 1], metallicFactor: 0 } }],
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteLength: positions.length },
      { buffer: 0, byteOffset: positions.length, byteLength: times.length },
      { buffer: 0, byteOffset: positions.length + times.length, byteLength: translations.length },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-0.4, 0, 0], max: [0.4, 1.5, 0] },
      { bufferView: 1, componentType: 5126, count: 3, type: 'SCALAR', min: [0], max: [1] },
      { bufferView: 2, componentType: 5126, count: 3, type: 'VEC3' },
    ],
    animations: [{
      samplers: [{ input: 1, output: 2, interpolation: 'LINEAR' }],
      channels: [{ sampler: 0, target: { node: nodes.length, path: 'translation' } }],
    }],
    ...(externalTexture ? { images: [{ uri: 'https://example.invalid/texture.png' }] } : {}),
  }
  const raw = Buffer.from(JSON.stringify(document))
  const json = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 0x20)
  raw.copy(json)
  const header = Buffer.alloc(20)
  header.writeUInt32LE(0x46546C67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(header.length + json.length + 8 + binary.length, 8)
  header.writeUInt32LE(json.length, 12)
  header.writeUInt32LE(0x4E4F534A, 16)
  const binaryChunk = Buffer.alloc(8)
  binaryChunk.writeUInt32LE(binary.length, 0)
  binaryChunk.writeUInt32LE(0x004E4942, 4)
  return Buffer.concat([header, json, binaryChunk, binary])
}

async function run() {
  assert.equal(process.platform, 'win32', 'Este gate usa o Electron para Windows.')
  const stage = fileURLToPath(new URL('../../stage/', import.meta.url))
  const root = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'lia-native-presence-'))
  console.log(`Evidências em ${root}`)
  const fixture = join(root, 'avatar.vrm')
  const invalid = join(root, 'avatar-textura-externa.vrm')
  await Promise.all([
    writeFile(fixture, createFixture()),
    writeFile(invalid, createFixture(true)),
    writeFile(join(root, 'lia-product.json'), JSON.stringify({
      presence: { ...defaultPresence, paused: true, home: { x: 5, y: 5 } },
    })),
  ])
  const app = await _electron.launch({
    executablePath: join(stage, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [join(stage, 'out', 'main', 'index.js')],
    env: { ...process.env, LIA_USER_DATA: root, LIA_STAGE_PROFILE_DIR: join(root, 'profile') },
  })
  try {
    const chat = await app.firstWindow()
    chat.setDefaultTimeout(10_000)
    const rejectedOverlay = await chat.evaluate(() => window.liaStagePresence.open(new Uint8Array(20)))
    assert.equal(rejectedOverlay, false)
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1)
    await chat.getByText('Avatar', { exact: true }).click()
    const picker = chat.getByLabel('Abrir avatar VRM')
    await picker.setInputFiles(invalid)
    await chat.getByText('Não foi possível abrir este avatar.', { exact: false }).waitFor()
    await picker.setInputFiles(fixture)
    await chat.getByText('Avatar carregado.', { exact: true }).waitFor()
    await picker.setInputFiles(join(stage, 'test', 'fixtures', 'personality.ccv3.zip'))
    await chat.getByText('Avatar carregado.', { exact: true }).waitFor()
    assert.equal(JSON.parse(await readFile(join(root, 'lia-product.json'), 'utf8')).persona, undefined)
    await picker.setInputFiles(join(stage, 'test', 'fixtures', 'live2d-reference.ccv3.zip'))
    await chat.getByText('Este cartão usa Live2D. O Stage atual aceita avatares VRM.', { exact: true }).waitFor()
    const openButton = chat.getByRole('button', { name: 'Mostrar no desktop', exact: true })
    const [overlay] = await Promise.all([app.waitForEvent('window', { timeout: 10_000 }), openButton.click()])
    await chat.getByText('Avatar aberto no desktop.', { exact: true }).waitFor()
    await overlay.waitForFunction(() => document.querySelector('canvas')?.height > 150, undefined, { timeout: 10_000 })
    const firstFrame = await overlay.screenshot({ path: join(root, 'overlay.png') })
    await delay(180)
    const nextFrame = await overlay.screenshot({ path: join(root, 'overlay-animated.png') })
    assert.ok(!firstFrame.equals(nextFrame), 'Os dois quadros do VRM animado são iguais.')
    const bounds = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .find(window => window.webContents.getURL().endsWith('/presence.html')).getBounds())
    const initial = await bounds()
    await chat.getByRole('button', { name: 'Salvar posição inicial', exact: true }).click()
    await chat.getByText('Presença atualizada.', { exact: true }).waitFor()
    await chat.getByRole('button', { name: 'Pausar ou retomar', exact: true }).click()
    await chat.getByText('Presença atualizada.', { exact: true }).waitFor()
    const deadline = Date.now() + 5_000
    let moved
    do {
      const current = await bounds()
      moved = current.x !== initial.x || current.y !== initial.y
      if (!moved)
        await delay(100)
    } while (!moved && Date.now() < deadline)
    assert.ok(moved, 'A janela permaneceu parada depois de retomar.')
    await chat.getByRole('button', { name: 'Fixar ou soltar', exact: true }).click()
    await chat.getByText('Presença atualizada.', { exact: true }).waitFor()
    const pinned = await bounds()
    await delay(450)
    assert.deepEqual(await bounds(), pinned)
    await chat.getByRole('button', { name: 'Voltar ao início', exact: true }).click()
    await chat.getByText('Presença atualizada.', { exact: true }).waitFor()
    assert.deepEqual(await bounds(), initial)
    await chat.getByRole('button', { name: 'Alternar ocultação ao passar o mouse', exact: true }).click()
    await chat.getByText('Presença atualizada.', { exact: true }).waitFor()
    const hover = await app.evaluate(async ({ BrowserWindow, screen }) => {
      const overlayWindow = BrowserWindow.getAllWindows()
        .find(window => window.webContents.getURL().endsWith('/presence.html'))
      const { x, y } = overlayWindow.getBounds()
      const originalCursor = screen.getCursorScreenPoint
      const wait = () => new Promise(resolve => setTimeout(resolve, 300))
      try {
        screen.getCursorScreenPoint = () => ({ x: x + 1, y: y + 1 })
        await wait()
        const hidden = overlayWindow.getOpacity() === 0
        screen.getCursorScreenPoint = () => ({ x: x - 1, y: y - 1 })
        await wait()
        return { hidden, visibleAgain: overlayWindow.getOpacity() === 1 }
      }
      finally {
        screen.getCursorScreenPoint = originalCursor
      }
    })
    assert.deepEqual(hover, { hidden: true, visibleAgain: true })
    assert.equal(JSON.parse(await readFile(join(root, 'lia-product.json'), 'utf8')).presence.hideOnHover, true)
    await chat.getByRole('button', { name: 'Alternar ocultação ao passar o mouse', exact: true }).click()
    await chat.getByText('Presença atualizada.', { exact: true }).waitFor()
    const stageFullscreen = await app.evaluate(async ({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows()
      const overlay = windows.find(window => window.webContents.getURL().endsWith('/presence.html'))
      const stage = windows.find(window => window !== overlay)
      async function waitFor(condition) {
        const until = Date.now() + 5_000
        while (!condition() && Date.now() < until)
          await new Promise(resolve => setTimeout(resolve, 50))
        return condition()
      }
      try {
        stage.setFullScreen(true)
        const hidden = await waitFor(() => stage.isFullScreen() && overlay.getOpacity() === 0)
        stage.setFullScreen(false)
        return { hidden, visibleAgain: await waitFor(() => !stage.isFullScreen() && overlay.getOpacity() === 1) }
      }
      finally {
        if (stage.isFullScreen())
          stage.setFullScreen(false)
      }
    })
    assert.deepEqual(stageFullscreen, { hidden: true, visibleAgain: true })
    const displays = await chat.evaluate(() => window.liaStagePresence.displays())
    const secondDisplay = displays.displays.find(({ workArea }) =>
      initial.x < workArea.x || initial.x >= workArea.x + workArea.width
      || initial.y < workArea.y || initial.y >= workArea.y + workArea.height)
    if (secondDisplay) {
      const picker = chat.getByRole('combobox', { name: 'Monitor do avatar' })
      await picker.selectOption(String(secondDisplay.id))
      await chat.getByText('Presença atualizada.', { exact: true }).waitFor()
      const placed = await bounds()
      const area = secondDisplay.workArea
      assert.ok(placed.x >= area.x && placed.y >= area.y
        && placed.x + placed.width <= area.x + area.width
        && placed.y + placed.height <= area.y + area.height)
      assert.equal(JSON.parse(await readFile(join(root, 'lia-product.json'), 'utf8')).presence.monitorId, secondDisplay.id)
    }
    const displayRecovery = await app.evaluate(({ BrowserWindow, screen }) => {
      const overlayWindow = BrowserWindow.getAllWindows()
        .find(window => window.webContents.getURL().endsWith('/presence.html'))
      const before = overlayWindow.getBounds()
      const originalGetDisplays = screen.getAllDisplays
      const primary = screen.getPrimaryDisplay()
      let reduced
      try {
        screen.getAllDisplays = () => [{
          ...primary,
          workArea: { x: primary.workArea.x, y: primary.workArea.y, width: 360, height: 180 },
        }]
        screen.emit('display-metrics-changed')
        reduced = overlayWindow.getBounds()
      }
      finally {
        screen.getAllDisplays = originalGetDisplays
        screen.emit('display-added')
      }
      const recovered = overlayWindow.getBounds()
      return { shrank: reduced.height === 180, restored: recovered.width === before.width && recovered.height === before.height }
    })
    assert.deepEqual(displayRecovery, { shrank: true, restored: true })
    await chat.getByRole('button', { name: 'Ocultar do desktop', exact: true }).click()
    await chat.getByText('Avatar oculto.', { exact: true }).waitFor()
    assert.equal(app.windows().length, 1)
    const [reopened] = await Promise.all([app.waitForEvent('window', { timeout: 10_000 }), openButton.click()])
    await chat.getByText('Avatar aberto no desktop.', { exact: true }).waitFor()
    await Promise.all([reopened.waitForEvent('close', { timeout: 10_000 }), chat.close()])
    const report = { syntheticVrm: true, packagedAvatarOpened: true, live2dLimitationVisible: true, personaUnchanged: true, animatedFramesDiffer: true, invalidOverlayRejected: true, externalTextureRejected: true, moved, pinned: true, home: true, syntheticHover: hover, stageFullscreen, connectedDisplays: displays.displays.length, secondDisplayPlacement: secondDisplay ? 'PASS' : 'NOT RUN', syntheticDisplayRecovery: displayRecovery, hidden: true, closedWithChat: true }
    await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
  }
  finally {
    await app.close()
  }
}

await run()
