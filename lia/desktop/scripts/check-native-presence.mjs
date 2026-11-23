import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
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
    buffers: [{ byteLength: positions.length }],
    bufferViews: [{ buffer: 0, byteLength: positions.length }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-0.4, 0, 0], max: [0.4, 1.5, 0] }],
    ...(externalTexture ? { images: [{ uri: 'https://example.invalid/texture.png' }] } : {}),
  }
  const raw = Buffer.from(JSON.stringify(document))
  const json = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 0x20)
  raw.copy(json)
  const header = Buffer.alloc(20)
  header.writeUInt32LE(0x46546C67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(header.length + json.length + 8 + positions.length, 8)
  header.writeUInt32LE(json.length, 12)
  header.writeUInt32LE(0x4E4F534A, 16)
  const binaryChunk = Buffer.alloc(8)
  binaryChunk.writeUInt32LE(positions.length, 0)
  binaryChunk.writeUInt32LE(0x004E4942, 4)
  return Buffer.concat([header, json, binaryChunk, positions])
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
    const openButton = chat.getByRole('button', { name: 'Mostrar no desktop', exact: true })
    const [overlay] = await Promise.all([app.waitForEvent('window', { timeout: 10_000 }), openButton.click()])
    await chat.getByText('Avatar aberto no desktop.', { exact: true }).waitFor()
    await overlay.waitForFunction(() => document.querySelector('canvas')?.height > 150, undefined, { timeout: 10_000 })
    await overlay.screenshot({ path: join(root, 'overlay.png') })
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
    await chat.getByRole('button', { name: 'Ocultar do desktop', exact: true }).click()
    await chat.getByText('Avatar oculto.', { exact: true }).waitFor()
    assert.equal(app.windows().length, 1)
    const [reopened] = await Promise.all([app.waitForEvent('window', { timeout: 10_000 }), openButton.click()])
    await chat.getByText('Avatar aberto no desktop.', { exact: true }).waitFor()
    await Promise.all([reopened.waitForEvent('close', { timeout: 10_000 }), chat.close()])
    const report = { syntheticVrm: true, invalidOverlayRejected: true, externalTextureRejected: true, moved, pinned: true, home: true, hidden: true, closedWithChat: true }
    await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
  }
  finally {
    await app.close()
  }
}

await run()
