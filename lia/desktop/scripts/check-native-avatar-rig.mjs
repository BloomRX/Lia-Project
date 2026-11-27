import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import { _electron } from 'playwright'

const stage = fileURLToPath(new URL('../../stage/', import.meta.url))
const fixture = join(stage, 'test', 'fixtures', 'robo-pendulo.vrm')
const fixtureSha256 = '3ba9d71609c70a28ee9e67727b23421f284ac0747cead73a85ea64e1e45eb0f7'
const arms = { leftUpperArm: -Math.PI / 3, rightUpperArm: Math.PI / 6 }
const alternateRightArm = Math.PI / 3
const blinkWeight = 0.35
const overlayBlinkBind = 0.5

function createArmClip(bytes) {
  const jsonEnd = 20 + bytes.readUInt32LE(12)
  const gltf = JSON.parse(bytes.subarray(20, jsonEnd))
  const buffers = [bytes.subarray(jsonEnd + 8)]
  function appendAccessor(values, type, elements, limits) {
    const data = Buffer.alloc(values.length * 4)
    values.forEach((value, index) => data.writeFloatLE(value, index * 4))
    const bufferView = gltf.bufferViews.push({
      buffer: 0,
      byteOffset: buffers.reduce((size, buffer) => size + buffer.length, 0),
      byteLength: data.length,
    }) - 1
    buffers.push(data)
    return gltf.accessors.push({ bufferView, componentType: 5126, type, count: values.length / elements, ...limits }) - 1
  }
  const clip = gltf.animations[0]
  const time = appendAccessor([0, 0.5, 1], 'SCALAR', 1, { min: [0], max: [1] })
  function addTrack(node, path, output) {
    const sampler = clip.samplers.push({ input: time, output, interpolation: 'STEP' }) - 1
    clip.channels.push({ sampler, target: { node, path } })
  }
  const { humanoid, expressions } = gltf.extensions.VRMC_vrm
  const jointIndices = {}
  for (const [bone, angle] of Object.entries(arms)) {
    const { node } = humanoid.humanBones[bone]
    jointIndices[bone] = gltf.skins[0].joints.indexOf(node)
    assert.ok(jointIndices[bone] >= 0)
    const alternate = bone === 'rightUpperArm' ? alternateRightArm : angle
    const rotations = [angle, alternate, alternate].flatMap(value => [0, 0, Math.sin(value / 2), Math.cos(value / 2)])
    addTrack(node, 'rotation', appendAccessor(rotations, 'VEC4', 4))
  }
  const [{ node }] = expressions.preset.happy.morphTargetBinds
  const primitive = gltf.meshes[gltf.nodes[node].mesh].primitives[0]
  primitive.targets.push(primitive.targets[0], primitive.targets[0])
  expressions.preset.blink = { morphTargetBinds: [{ node, index: 1, weight: 1 }] }
  expressions.preset.happy.morphTargetBinds.push({ node, index: 1, weight: overlayBlinkBind })
  expressions.preset.aa = { morphTargetBinds: [{ node, index: 2, weight: 1 }] }
  const weights = [0, blinkWeight, 0]
  addTrack(node, 'weights', appendAccessor([...weights, ...weights, ...weights], 'SCALAR', 1))

  const binary = Buffer.concat(buffers)
  gltf.buffers[0].byteLength = binary.length
  const json = Buffer.from(JSON.stringify(gltf))
  const aligned = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)])
  const header = Buffer.from(bytes.subarray(0, 20))
  const binaryHeader = Buffer.from(bytes.subarray(jsonEnd, jsonEnd + 8))
  header.writeUInt32LE(header.length + aligned.length + binaryHeader.length + binary.length, 8)
  header.writeUInt32LE(aligned.length, 12)
  binaryHeader.writeUInt32LE(binary.length, 0)
  const textureSize = Math.ceil(Math.sqrt(gltf.skins[0].joints.length * 4) / 4) * 4
  return { bytes: Buffer.concat([header, aligned, binaryHeader, binary]), jointIndices, textureSize }
}

// Observe data sent to WebGL without replacing app time, clips or model state.
function observeSkin({ jointIndices, textureSize }) {
  const gl = WebGL2RenderingContext.prototype
  const measure = window.fixtureRig = { skin: {}, morph: [], renders: 0 }
  const morphLocations = new WeakSet()
  const getUniformLocation = gl.getUniformLocation
  gl.getUniformLocation = function (program, name) {
    const location = getUniformLocation.call(this, program, name)
    if (location && name === 'morphTargetInfluences[0]')
      morphLocations.add(location)
    return location
  }
  const uniform1fv = gl.uniform1fv
  gl.uniform1fv = function (location, data, ...range) {
    if (morphLocations.has(location))
      measure.morph = Array.from(data)
    return uniform1fv.call(this, location, data, ...range)
  }
  const texSubImage2D = gl.texSubImage2D
  gl.texSubImage2D = function (...args) {
    const [, level, , , width, height, format, type, data] = args
    if (level === 0 && width === textureSize && height === textureSize && format === this.RGBA
      && type === this.FLOAT && data instanceof Float32Array && data.length === textureSize ** 2 * 4) {
      for (const [bone, index] of Object.entries(jointIndices))
        measure.skin[bone] = Array.from(data.slice(index * 16, index * 16 + 16))
    }
    return texSubImage2D.apply(this, args)
  }
  const clear = gl.clear
  gl.clear = function (mask) {
    measure.renders++
    return clear.call(this, mask)
  }
}

function assertNear(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 0.001, `${label}: esperado ${expected}, observado ${actual}`)
}

function assertArms(sample) {
  for (const [bone, initial] of Object.entries(arms)) {
    const matrix = sample.skin[bone]
    const angle = bone === 'rightUpperArm' && Math.abs(matrix[0] - Math.cos(alternateRightArm)) < 0.001 ? alternateRightArm : initial
    assertNear(matrix[0], Math.cos(angle), `${bone} cos`)
    assertNear(matrix[1], Math.sin(angle), `${bone} sin`)
    assertNear(matrix[4], -Math.sin(angle), `${bone} −sin`)
    assertNear(matrix[5], Math.cos(angle), `${bone} cos`)
  }
}

async function run() {
  assert.equal(process.platform, 'win32', 'Este gate usa o Electron para Windows.')
  const root = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'lia-native-avatar-rig-'))
  console.log(`Evidências em ${root}`)
  const original = await readFile(fixture)
  assert.equal(createHash('sha256').update(original).digest('hex'), fixtureSha256)
  const { bytes, ...measurement } = createArmClip(original)
  const animated = join(root, 'robo-pendulo-os-bracos.vrm')
  await writeFile(animated, bytes)
  await writeFile(join(root, 'lia-product.json'), JSON.stringify({ preferences: { language: 'pt-BR' } }))
  const report = { fixtureSha256, expectedAnglesRadians: { ...arms, alternateRightArm }, blinkWeight, rendererErrors: [], exits: [] }
  let app

  async function open() {
    app = await _electron.launch({
      executablePath: join(stage, 'node_modules', 'electron', 'dist', 'electron.exe'),
      args: [join(stage, 'out', 'main', 'index.js')],
      env: { ...process.env, LIA_USER_DATA: root, LIA_STAGE_PROFILE_DIR: join(root, 'profile') },
    })
    const chat = await app.firstWindow()
    chat.setDefaultTimeout(10_000)
    chat.on('pageerror', error => report.rendererErrors.push(error.message))
    await chat.evaluate(observeSkin, measurement)
    await app.context().addInitScript(observeSkin, measurement)
    await chat.getByText('Avatar', { exact: true }).click()
    return chat
  }

  async function sample(page) {
    await page.waitForFunction(() => window.fixtureRig?.skin.leftUpperArm && window.fixtureRig.renders > 2)
    return page.evaluate(() => window.fixtureRig)
  }

  async function preview(chat, source) {
    await chat.getByLabel('Abrir avatar VRM').setInputFiles(source)
    await chat.getByText('Avatar carregado.', { exact: true }).waitFor()
  }

  async function closeStage(chat, overlay) {
    const exit = once(app.process(), 'exit', { signal: AbortSignal.timeout(10_000) })
    const overlayClosed = overlay?.waitForEvent('close', { timeout: 10_000 })
    const [status] = await Promise.all([exit, overlayClosed, chat.close()])
    report.exits.push(status)
    assert.deepEqual(status, [0, null])
    app = undefined
  }

  try {
    const chat = await open()
    await preview(chat, fixture)
    report.original = await sample(chat)
    assertNear(report.original.skin.leftUpperArm[0], 1, 'Braço de referência sem trilha')
    assertNear(report.original.skin.leftUpperArm[1], 0, 'Braço de referência sem trilha')
    const canvas = chat.locator('#avatar-canvas')
    await canvas.screenshot({ path: join(root, 'original.png') })
    const previousFrames = report.original.renders
    await preview(chat, animated)
    await chat.waitForFunction(frames => window.fixtureRig.renders > frames + 3, previousFrames)
    report.preview = await sample(chat)
    await canvas.screenshot({ path: join(root, 'bracos.png') })
    assertArms(report.preview)
    assertNear(report.preview.morph[1], blinkWeight, 'Piscada do clipe')
    const nextAngle = Math.abs(report.preview.skin.rightUpperArm[0] - Math.cos(arms.rightUpperArm)) < 0.001
      ? alternateRightArm
      : arms.rightUpperArm
    const nextPose = await chat.waitForFunction(expected =>
      Math.abs(window.fixtureRig.skin.rightUpperArm[0] - expected) < 0.001 && structuredClone(window.fixtureRig), Math.cos(nextAngle))
    report.nextPose = await nextPose.jsonValue()
    await nextPose.dispose()
    assertArms(report.nextPose)
    assertNear(report.nextPose.skin.rightUpperArm[0], Math.cos(nextAngle), 'Movimento do braço direito')
    await canvas.screenshot({ path: join(root, 'bracos-outro-quadro.png') })

    const [overlay] = await Promise.all([
      app.waitForEvent('window', { timeout: 10_000 }), chat.getByRole('button', { name: 'Mostrar no desktop', exact: true }).click(),
    ])
    overlay.setDefaultTimeout(10_000)
    overlay.on('pageerror', error => report.rendererErrors.push(error.message))
    await chat.getByText('Avatar aberto no desktop.', { exact: true }).waitFor()
    report.presence = await sample(overlay)
    assertArms(report.presence)
    for (const [phase, morphIndex, weight] of [['responded', 0, 0.55], ['speaking', 2, 0.18]]) {
      await chat.evaluate(next => window.liaStagePresence.publishExpression(next), phase)
      await overlay.waitForFunction(([i, value]) => Math.abs(window.fixtureRig.morph[i] - value) < 0.001, [morphIndex, weight])
      const current = report[phase] = await sample(overlay)
      assertArms(current)
      const expectedBlink = phase === 'responded' ? blinkWeight + overlayBlinkBind * weight : blinkWeight
      assertNear(current.morph[1], expectedBlink, `Piscada durante ${phase}`)
      await overlay.waitForFunction(frames => window.fixtureRig.renders > frames + 2, current.renders)
      assertNear((await sample(overlay)).morph[1], expectedBlink, `Piscada sem acumular durante ${phase}`)
      await overlay.screenshot({ path: join(root, `${phase}.png`) })
    }
    await chat.evaluate(() => window.liaStagePresence.publishExpression('idle'))
    await overlay.waitForFunction(() => window.fixtureRig.morph[0] === 0 && window.fixtureRig.morph[2] === 0)
    report.idle = await sample(overlay)
    assertNear(report.idle.morph[1], blinkWeight, 'Piscada após expressão do Stage')

    const fullscreen = value => app.evaluate(({ BrowserWindow }, next) => {
      BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().endsWith('/presence.html')).setFullScreen(next)
    }, value)
    await overlay.evaluate(() => {
      window.liaStagePresence.onVisibility((visible) => {
        window.fixtureRig.visible = visible
      })
    })
    try {
      await fullscreen(true)
      await overlay.waitForFunction(() => window.fixtureRig.visible === false, undefined, { polling: 50 })
      const paused = await overlay.evaluate(() => window.fixtureRig.renders)
      await delay(300)
      assert.equal(await overlay.evaluate(() => window.fixtureRig.renders), paused)
      report.fullscreen = { pausedFrames: paused }
    }
    finally {
      await fullscreen(false)
    }
    await overlay.waitForFunction(count => window.fixtureRig.renders > count, report.fullscreen.pausedFrames)
    const resumed = await sample(overlay)
    assertArms(resumed)
    report.fullscreen.resumedFrames = resumed.renders

    await chat.getByRole('button', { name: 'Lembrar este avatar', exact: true }).click()
    await chat.getByText('Avatar salvo neste perfil.', { exact: true }).waitFor()
    await closeStage(chat, overlay)
    const reopened = await open()
    await reopened.getByText('Avatar carregado.', { exact: true }).waitFor()
    report.restarted = await sample(reopened)
    assertArms(report.restarted)
    const removal = reopened.waitForEvent('dialog').then(dialog => dialog.accept())
    await reopened.getByRole('button', { name: 'Esquecer avatar salvo', exact: true }).click()
    await removal
    await reopened.getByText('Avatar removido deste perfil.', { exact: true }).waitFor()
    await closeStage(reopened)
    const withoutAvatar = await open()
    await withoutAvatar.waitForFunction(() => !document.querySelector('#avatar-picker').disabled)
    assert.equal(await withoutAvatar.locator('#avatar-canvas').isVisible(), false)
    report.removalPersisted = true
    assert.deepEqual(report.rendererErrors, [])
    report.runtime = await app.evaluate(() => ({ electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform, arch: process.arch }))
    await closeStage(withoutAvatar)
    report.result = 'PASS'
  }
  catch (error) {
    report.result = 'FAIL'
    report.failure = error.message
    throw error
  }
  finally {
    await writeFile(join(root, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
    await app?.close()
  }
}

await run()
