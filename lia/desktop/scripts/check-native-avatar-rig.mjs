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
const blinkSilenceMs = 4_650
const idleObservationMs = 450

function createArmClip(bytes, authoredBlink = true) {
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
  if (authoredBlink) {
    const weights = [0, blinkWeight, 0]
    addTrack(node, 'weights', appendAccessor([...weights, ...weights, ...weights], 'SCALAR', 1))
  }

  const binary = Buffer.concat(buffers)
  const textureSize = Math.ceil(Math.sqrt(gltf.skins[0].joints.length * 4) / 4) * 4
  return { bytes: packAvatar(bytes, jsonEnd, gltf, binary), jointIndices, textureSize }
}

function writeEyeClosure(gltf, binary, { node, index }) {
  const [primitive] = gltf.meshes[gltf.nodes[node].mesh].primitives
  const positions = gltf.accessors[primitive.attributes.POSITION]
  const colors = gltf.accessors[primitive.attributes.COLOR_0]
  const delta = gltf.accessors[primitive.targets[index].POSITION]
  const positionOffset = gltf.bufferViews[positions.bufferView].byteOffset
  const colorOffset = gltf.bufferViews[colors.bufferView].byteOffset
  const deltaOffset = gltf.bufferViews[delta.bufferView].byteOffset
  const eyes = []
  for (let vertex = 0; vertex < positions.count; vertex++) {
    const red = binary.readFloatLE(colorOffset + vertex * 16)
    const y = binary.readFloatLE(positionOffset + vertex * 12 + 4)
    // The two yellow eye blocks sit above the robot's yellow mouth.
    if (red === 1 && y > 1.57)
      eyes.push({ vertex, y })
  }
  assert.equal(eyes.length, 48)
  const heights = eyes.map(({ y }) => y)
  const center = (Math.min(...heights) + Math.max(...heights)) / 2
  const offsets = eyes.map(({ y }) => Math.fround((center - y) * 0.94))
  binary.fill(0, deltaOffset, deltaOffset + delta.count * 12)
  for (const [index, { vertex }] of eyes.entries())
    binary.writeFloatLE(offsets[index], deltaOffset + vertex * 12 + 4)
  delta.min = [0, Math.min(...offsets), 0]
  delta.max = [0, Math.max(...offsets), 0]
}

function createStaticAvatar(bytes, withBlink) {
  const jsonEnd = 20 + bytes.readUInt32LE(12)
  const gltf = JSON.parse(bytes.subarray(20, jsonEnd))
  const binary = Buffer.from(bytes.subarray(jsonEnd + 8))
  if (withBlink) {
    const { preset } = gltf.extensions.VRMC_vrm.expressions
    const { morphTargetBinds } = preset.happy
    gltf.extensions.VRMC_vrm.expressions.preset = { blink: { morphTargetBinds } }
    writeEyeClosure(gltf, binary, morphTargetBinds[0])
  }
  delete gltf.animations
  return packAvatar(bytes, jsonEnd, gltf, binary)
}

function packAvatar(bytes, jsonEnd, gltf, binary) {
  gltf.buffers[0].byteLength = binary.length
  const json = Buffer.from(JSON.stringify(gltf))
  const aligned = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)])
  const header = Buffer.from(bytes.subarray(0, 20))
  const binaryHeader = Buffer.from(bytes.subarray(jsonEnd, jsonEnd + 8))
  header.writeUInt32LE(header.length + aligned.length + binaryHeader.length + binary.length, 8)
  header.writeUInt32LE(aligned.length, 12)
  binaryHeader.writeUInt32LE(binary.length, 0)
  return Buffer.concat([header, aligned, binaryHeader, binary])
}

// Observe data sent to WebGL without replacing app time, clips or model state.
function observeSkin({ jointIndices, textureSize, traceMorph, capturePeak }) {
  const gl = WebGL2RenderingContext.prototype
  const measure = window.fixtureRig = { skin: {}, morph: [], renders: 0, morphChanges: [] }
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
    if (morphLocations.has(location)) {
      measure.morph = Array.from(data)
      const weight = measure.morph[traceMorph]
      if (Number.isFinite(weight) && measure.morphChanges.at(-1)?.weight !== weight) {
        measure.morphChanges.push({ weight, mouthWeight: measure.morph[2], frame: measure.renders, ms: performance.now() })
        if (measure.morphChanges.length > 128)
          measure.morphChanges.shift()
      }
    }
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
  if (capturePeak) {
    const drawElements = gl.drawElements
    gl.drawElements = function (...args) {
      const result = drawElements.apply(this, args)
      const weight = measure.morph[traceMorph]
      if (this.canvas.id === 'avatar-canvas' && weight >= 0.8 && !measure.peakCapture) {
        try {
          const dataUrl = this.canvas.toDataURL()
          if (dataUrl.startsWith('data:image/png;base64,'))
            measure.peakCapture = { png: dataUrl.slice('data:image/png;base64,'.length), weight, frame: measure.renders }
        }
        catch (error) {
          measure.peakCapture = { error: error.message }
        }
      }
      return result
    }
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
  const blinkAvatar = join(root, 'robo-pendulo-preset-blink.vrm')
  const blinkBytes = createStaticAvatar(original, true)
  await writeFile(blinkAvatar, blinkBytes)
  const staticControl = join(root, 'robo-pendulo-estatico-sem-blink.vrm')
  await writeFile(staticControl, createStaticAvatar(original, false))
  const armClipWithBlink = join(root, 'robo-pendulo-bracos-preset-blink.vrm')
  const { bytes: armClipWithBlinkBytes } = createArmClip(original, false)
  await writeFile(armClipWithBlink, armClipWithBlinkBytes)
  await writeFile(join(root, 'lia-product.json'), JSON.stringify({ preferences: { language: 'pt-BR' } }))
  const report = { fixtureSha256, expectedAnglesRadians: { ...arms, alternateRightArm }, blinkWeight, rendererErrors: [], exits: [] }
  let app

  async function open(traceMorph = 1, capturePeak = false) {
    app = await _electron.launch({
      executablePath: join(stage, 'node_modules', 'electron', 'dist', 'electron.exe'),
      args: [join(stage, 'out', 'main', 'index.js')],
      env: { ...process.env, LIA_USER_DATA: root, LIA_STAGE_PROFILE_DIR: join(root, 'profile') },
    })
    const chat = await app.firstWindow()
    chat.setDefaultTimeout(10_000)
    chat.on('pageerror', error => report.rendererErrors.push(error.message))
    const options = { ...measurement, traceMorph, capturePeak }
    await chat.evaluate(observeSkin, options)
    await app.context().addInitScript(observeSkin, options)
    await chat.getByText('Avatar', { exact: true }).click()
    return chat
  }

  async function sample(page) {
    await page.waitForFunction(() => window.fixtureRig?.skin.leftUpperArm && window.fixtureRig.renders > 2)
    return page.evaluate(() => window.fixtureRig)
  }

  async function preview(chat, source) {
    await chat.waitForFunction(() => !document.querySelector('#avatar-picker').disabled)
    await chat.getByLabel('Abrir avatar VRM').setInputFiles(source)
    await chat.getByText('Avatar carregado.', { exact: true }).waitFor()
  }

  async function showPresence(chat) {
    const [overlay] = await Promise.all([
      app.waitForEvent('window', { timeout: 10_000 }), chat.getByRole('button', { name: 'Mostrar no desktop', exact: true }).click(),
    ])
    overlay.setDefaultTimeout(10_000)
    overlay.on('pageerror', error => report.rendererErrors.push(error.message))
    await chat.getByText('Avatar aberto no desktop.', { exact: true }).waitFor()
    return overlay
  }

  const fullscreen = value => app.evaluate(({ BrowserWindow }, next) => {
    BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().endsWith('/presence.html')).setFullScreen(next)
  }, value)

  async function observeVisibility(overlay) {
    await overlay.evaluate(() => {
      window.liaStagePresence.onVisibility((visible) => {
        window.fixtureRig.visible = visible
      })
    })
  }

  async function closeStage(chat, overlay) {
    const exit = once(app.process(), 'exit', { signal: AbortSignal.timeout(10_000) })
    const overlayClosed = overlay?.waitForEvent('close', { timeout: 10_000 })
    const [status] = await Promise.all([exit, overlayClosed, chat.close()])
    report.exits.push(status)
    assert.deepEqual(status, [0, null])
    app = undefined
  }

  async function observeBlink(page, label, afterFrame = 0) {
    const pulse = await page.waitForFunction((frame) => {
      const { morphChanges } = window.fixtureRig
      const closing = morphChanges.findIndex(({ frame: current, weight }) => current > frame && weight > 0.1)
      if (closing === -1)
        return false
      const opening = morphChanges.findIndex(({ weight }, index) => index > closing && Math.abs(weight) < 0.001)
      if (opening === -1)
        return false
      const peak = morphChanges.slice(closing, opening).reduce((highest, sample) => sample.weight > highest.weight ? sample : highest)
      return { closing: morphChanges[closing], peak, opening: morphChanges[opening] }
    }, afterFrame, { polling: 50, timeout: 10_000 }).catch((error) => {
      throw new Error(`Preset blink sem ciclo positivo → zero na ${label}.`, { cause: error })
    })
    try {
      return await pulse.jsonValue()
    }
    finally {
      await pulse.dispose()
    }
  }

  async function checkPresetBlink() {
    const chat = await open(0, true)
    await preview(chat, blinkAvatar)
    await chat.waitForFunction(() => window.fixtureRig.morphChanges.length > 0)
    const previewInitial = await chat.evaluate(() => window.fixtureRig.morphChanges[0])
    assertNear(previewInitial.weight, 0, 'Peso inicial da Prévia sem clipe')
    const overlay = await showPresence(chat)
    await overlay.waitForFunction(() => window.fixtureRig.morphChanges.length > 0)
    const presenceInitial = await overlay.evaluate(() => window.fixtureRig.morphChanges[0])
    assertNear(presenceInitial.weight, 0, 'Peso inicial da Presença sem clipe')
    report.presetBlink = {
      fixtureSha256: createHash('sha256').update(blinkBytes).digest('hex'),
      clipCount: 0,
      previewInitial,
      presenceInitial,
    }
    const [previewPulse, presencePulse] = await Promise.all([
      observeBlink(chat, 'Prévia'),
      observeBlink(overlay, 'Presença'),
    ])
    Object.assign(report.presetBlink, { previewPulse, presencePulse })
    await chat.locator('#avatar-canvas').screenshot({ path: join(root, 'preset-blink-repouso.png') })
    const peakCapture = await chat.evaluate(() => window.fixtureRig.peakCapture)
    if (peakCapture?.png) {
      const { png, ...measuredFrame } = peakCapture
      await writeFile(join(root, 'preset-blink-pico.png'), Buffer.from(png, 'base64'))
      report.presetBlink.peakCapture = measuredFrame
    }
    else {
      report.presetBlink.peakCapture = peakCapture?.error ?? 'Nenhuma captura de pico disponível.'
    }

    await observeVisibility(overlay)
    try {
      await fullscreen(true)
      await overlay.waitForFunction(() => window.fixtureRig.visible === false, undefined, { polling: 50 })
      const before = await overlay.evaluate(() => window.fixtureRig.renders)
      await delay(blinkSilenceMs)
      const after = await overlay.evaluate(() => window.fixtureRig.renders)
      assert.equal(after, before, 'A Presença oculta não deve desenhar uma piscada.')
      report.presetBlink.hidden = { before, after, durationMs: blinkSilenceMs }
    }
    finally {
      await fullscreen(false)
    }
    const resumePulse = await observeBlink(overlay, 'Presença após retomada', report.presetBlink.hidden.after)
    report.presetBlink.resumePulse = resumePulse

    const idleFrames = await overlay.evaluate(() => window.fixtureRig.renders)
    await delay(idleObservationMs)
    const idleFramesAfter = await overlay.evaluate(() => window.fixtureRig.renders)
    assert.equal(idleFramesAfter, idleFrames, 'O avatar estático desenhou quadros em repouso.')
    report.presetBlink.idle = { before: idleFrames, after: idleFramesAfter, durationMs: idleObservationMs }

    await preview(chat, staticControl)
    await overlay.waitForFunction(count => window.fixtureRig.renders > count && window.fixtureRig.morph[0] === 0, idleFramesAfter)
    const controlFrames = await overlay.evaluate(() => window.fixtureRig.renders)
    await delay(blinkSilenceMs)
    const controlFramesAfter = await overlay.evaluate(() => window.fixtureRig.renders)
    assert.equal(controlFramesAfter, controlFrames, 'A Presença continuou animando após trocar para avatar sem preset blink.')
    report.presetBlink.staticControl = { before: controlFrames, after: controlFramesAfter, durationMs: blinkSilenceMs }

    await closeStage(chat, overlay)
    assert.deepEqual(report.rendererErrors, [])
  }

  async function checkClipWithPresetBlink() {
    const chat = await open()
    await preview(chat, armClipWithBlink)
    const overlay = await showPresence(chat)
    const before = await sample(overlay)
    assertArms(before)
    await chat.evaluate(() => window.liaStagePresence.publishExpression('speaking'))
    await overlay.waitForFunction(() => Math.abs(window.fixtureRig.morph[2] - 0.18) < 0.001)
    const speechFrame = await overlay.evaluate(() => window.fixtureRig.renders)
    const pulse = await observeBlink(overlay, 'Presença com clipe de braço sem trilha de morph', speechFrame)
    assertNear(pulse.peak.mouthWeight, 0.18, 'Peso da fala durante a piscada automática')
    assertNear(pulse.opening.mouthWeight, 0.18, 'Peso da fala após a piscada automática')
    const after = await sample(overlay)
    assertArms(after)
    assert.ok(after.renders > before.renders, 'O clipe parou de renderizar durante a piscada.')
    report.clipWithPresetBlink = {
      fixtureSha256: createHash('sha256').update(armClipWithBlinkBytes).digest('hex'),
      pulse,
      rendersBefore: before.renders,
      rendersAfter: after.renders,
      armsAfter: after.skin,
    }
    await closeStage(chat, overlay)
    assert.deepEqual(report.rendererErrors, [])
  }

  try {
    if (process.argv.includes('--preset-blink-only')) {
      await checkPresetBlink()
      await checkClipWithPresetBlink()
      report.result = 'PASS'
      return
    }
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

    const overlay = await showPresence(chat)
    report.presence = await sample(overlay)
    assertArms(report.presence)
    await delay(blinkSilenceMs)
    const authoredWindow = await overlay.evaluate(() => ({
      changes: window.fixtureRig.morphChanges,
      renders: window.fixtureRig.renders,
    }))
    assert.ok(authoredWindow.renders > report.presence.renders, 'O clipe da Presença parou de renderizar.')
    assert.ok(authoredWindow.changes.length > 0, 'O WebGL não recebeu o peso da piscada autoral.')
    for (const { weight } of authoredWindow.changes)
      assertNear(weight, blinkWeight, 'O preset não sobrepõe a piscada autoral')
    report.authoredBlink = { ...authoredWindow, durationMs: blinkSilenceMs }
    const overlayWindow = await app.browserWindow(overlay)
    const overlayId = await overlayWindow.evaluate(window => window.id)
    await overlayWindow.dispose()
    await preview(chat, fixture)
    await overlay.waitForFunction(() => Math.abs(window.fixtureRig.skin.leftUpperArm[0] - 1) < 0.001)
    const replaced = await sample(overlay)
    assertNear(replaced.skin.leftUpperArm[1], 0, 'Braço sem trilha após troca na mesma janela')
    await preview(chat, animated)
    await overlay.waitForFunction(expected => Math.abs(window.fixtureRig.skin.leftUpperArm[0] - expected) < 0.001, Math.cos(arms.leftUpperArm))
    const restored = await sample(overlay)
    assertArms(restored)
    assertNear(restored.morph[1], blinkWeight, 'Piscada do clipe após troca')
    const liveWindow = await app.browserWindow(overlay)
    assert.equal(await liveWindow.evaluate(window => window.id), overlayId)
    await liveWindow.dispose()
    assert.equal(app.windows().length, 2)
    report.avatarReplacement = { windowId: overlayId, replaced, restored }
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

    await observeVisibility(overlay)
    try {
      await fullscreen(true)
      await overlay.waitForFunction(() => window.fixtureRig.visible === false, undefined, { polling: 50 })
      const paused = await overlay.evaluate(() => window.fixtureRig.renders)
      await preview(chat, fixture)
      await delay(300)
      assert.equal(await overlay.evaluate(() => window.fixtureRig.renders), paused)
      report.fullscreen = { pausedFrames: paused }
    }
    finally {
      await fullscreen(false)
    }
    await overlay.waitForFunction(count => window.fixtureRig.renders > count, report.fullscreen.pausedFrames)
    const resumed = await sample(overlay)
    assertNear(resumed.skin.leftUpperArm[0], 1, 'Avatar trocado durante a ocultação')
    assertNear(resumed.skin.leftUpperArm[1], 0, 'Braço sem trilha ao retomar')
    report.fullscreen.resumedFrames = resumed.renders
    await preview(chat, animated)
    await overlay.waitForFunction(expected => Math.abs(window.fixtureRig.skin.leftUpperArm[0] - expected) < 0.001, Math.cos(arms.leftUpperArm))

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
    await checkPresetBlink()
    await checkClipWithPresetBlink()
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
