import { VRMExpressionMorphTargetBind, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import { AnimationMixer, Box3, Color, DirectionalLight, HemisphereLight, LoadingManager, OrthographicCamera, PropertyBinding, Scene, Vector3, WebGLRenderer } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

import { validateLocalAvatar } from './avatar-file.js'

const phaseExpressions = new Map([
  ['thinking', { name: 'relaxed', weight: 0.25 }],
  ['responded', { name: 'happy', weight: 0.55 }],
  ['speaking', { name: 'aa', weight: 0.18 }],
])
const frameInterval = 1000 / 24
const blinkInterval = 4_000
const blinkFrames = [0.5, 1, 1, 0.5, 0]

function relaxStaticArms(vrm) {
  for (const side of ['left', 'right']) {
    const shoulder = vrm.humanoid.getNormalizedBoneNode(`${side}UpperArm`)
    const elbow = vrm.humanoid.getNormalizedBoneNode(`${side}LowerArm`)
    if (!shoulder?.parent || !elbow)
      continue
    const elbowPosition = shoulder.parent.worldToLocal(elbow.getWorldPosition(new Vector3()))
    const direction = elbowPosition.sub(shoulder.position)
    if (Math.abs(direction.x) < 0.04 || Math.abs(direction.y) + Math.abs(direction.z) > Math.abs(direction.x) * 0.25)
      continue
    shoulder.rotateZ(-Math.sign(direction.x) * Math.PI / 3)
  }
  vrm.update(0)
}

function prepareEmbeddedClip(vrm, clip) {
  const rawBones = new Set(Object.values(vrm.humanoid.rawHumanBones).map(({ node }) => node))
  const animatedMorphMeshes = new Set()
  for (const track of clip.tracks) {
    const { nodeName, propertyName } = PropertyBinding.parseTrackName(track.name)
    const node = PropertyBinding.findNode(vrm.scene, nodeName)
    // glTF keys target the raw joints. The VRM pose copy would overwrite those keys.
    if ((propertyName === 'position' || propertyName === 'quaternion') && rawBones.has(node))
      vrm.humanoid.autoUpdateHumanBones = false
    if (propertyName === 'morphTargetInfluences' && node?.morphTargetInfluences)
      animatedMorphMeshes.add(node)
  }

  const sharedMorphs = new Map()
  for (const expression of vrm.expressionManager?.expressions ?? []) {
    for (const bind of expression.binds) {
      if (!(bind instanceof VRMExpressionMorphTargetBind))
        continue
      for (const mesh of bind.primitives) {
        if (animatedMorphMeshes.has(mesh))
          sharedMorphs.set(`${mesh.uuid}:${bind.index}`, { weights: mesh.morphTargetInfluences, index: bind.index, authored: 0 })
      }
    }
  }
  return [...sharedMorphs.values()]
}

function hasIdleBlink(vrm, sharedMorphs) {
  let hasTarget = false
  for (const bind of vrm.expressionManager?.getExpression('blink')?.binds ?? []) {
    if (!(bind instanceof VRMExpressionMorphTargetBind) || !(bind.weight > 0))
      continue
    for (const mesh of bind.primitives) {
      const weights = mesh.morphTargetInfluences
      if (!Number.isFinite(weights?.[bind.index]))
        continue
      // A glTF morph track drives the whole vector, including zero weights.
      if (sharedMorphs.some(morph => morph.weights === weights && morph.index === bind.index))
        return false
      hasTarget = true
    }
  }
  return hasTarget
}

export function createAvatarView(canvas) {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  const scene = new Scene()
  scene.add(new HemisphereLight(new Color(0xFFFFFF), new Color(0x514A63), 2))
  const light = new DirectionalLight(0xFFFFFF, 2)
  light.position.set(1, 2, 3)
  scene.add(light)
  const camera = new OrthographicCamera()
  const manager = new LoadingManager()
  manager.setURLModifier((url) => {
    if (!url.startsWith('blob:'))
      throw new Error('avatar-resource')
    return url
  })
  const loader = new GLTFLoader(manager)
  loader.register(parser => new VRMLoaderPlugin(parser))
  let model
  let bounds
  let disposed = false
  let renderingEnabled = true
  let mixer
  let sharedMorphs = []
  let avatar
  let timer
  let blinkTimer
  let blinkEnabled = false
  let blinkWeight = 0
  let previousFrame
  let expressionPhase = 'idle'

  function draw(elapsed = 0) {
    const preset = phaseExpressions.get(expressionPhase)
    const expressions = avatar.expressionManager
    const original = preset ? expressions?.getValue(preset.name) : null
    const hasPreset = typeof original === 'number'
    const originalBlink = blinkWeight > 0 ? expressions?.getValue('blink') : null
    if (hasPreset)
      expressions.setValue(preset.name, Math.max(original, preset.weight))
    if (typeof originalBlink === 'number')
      expressions.setValue('blink', Math.max(originalBlink, blinkWeight))
    for (const morph of sharedMorphs)
      morph.authored = morph.weights[morph.index]
    try {
      avatar.update(elapsed)
      // VRM rebuilds its bound weights from zero; add the embedded clip for this frame.
      for (const { weights, index, authored } of sharedMorphs)
        weights[index] += authored
      renderer.render(scene, camera)
    }
    finally {
      // The mixer may skip writing an unchanged sample on the next frame.
      for (const { weights, index, authored } of sharedMorphs)
        weights[index] = authored
      if (hasPreset)
        expressions.setValue(preset.name, original)
      if (typeof originalBlink === 'number')
        expressions.setValue('blink', originalBlink)
    }
  }

  function render() {
    if (!renderingEnabled || !avatar || !bounds || !canvas.clientWidth || !canvas.clientHeight)
      return
    const center = bounds.getCenter(new Vector3())
    const size = bounds.getSize(new Vector3())
    const aspect = canvas.clientWidth / canvas.clientHeight
    const halfHeight = Math.max(size.y, size.x / aspect, 0.01) * 0.57
    camera.left = -halfHeight * aspect
    camera.right = halfHeight * aspect
    camera.top = halfHeight
    camera.bottom = -halfHeight
    camera.near = 0.001
    camera.far = 4 * Math.max(size.length(), 1)
    camera.position.set(center.x, center.y, center.z + camera.far / 2)
    camera.lookAt(center)
    camera.updateProjectionMatrix()
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)
    draw()
  }
  function stopAnimation() {
    clearInterval(timer)
    timer = undefined
    clearTimeout(blinkTimer)
    blinkTimer = undefined
    blinkWeight = 0
  }

  function scheduleBlink(step = 0) {
    blinkTimer = setTimeout(() => {
      if (!renderingEnabled || document.hidden)
        return
      blinkWeight = blinkFrames[step]
      if (!mixer && canvas.clientWidth && canvas.clientHeight)
        draw()
      scheduleBlink((step + 1) % blinkFrames.length)
    }, step === 0 ? blinkInterval : frameInterval)
  }

  function updateAnimation() {
    stopAnimation()
    if (!renderingEnabled || document.hidden)
      return
    if (blinkEnabled) {
      if (!mixer)
        render()
      scheduleBlink()
    }
    if (!mixer)
      return
    previousFrame = performance.now()
    timer = setInterval(() => {
      const now = performance.now()
      const elapsed = Math.min((now - previousFrame) / 1000, 0.1)
      previousFrame = now
      mixer.update(elapsed)
      draw(elapsed)
    }, frameInterval)
  }

  function releaseModel() {
    stopAnimation()
    if (model) {
      mixer?.stopAllAction()
      mixer?.uncacheRoot(model)
      scene.remove(model)
      VRMUtils.deepDispose(model)
      model = undefined
      mixer = undefined
      sharedMorphs = []
      blinkEnabled = false
      avatar = undefined
    }
  }

  document.addEventListener('visibilitychange', updateAnimation)
  const resize = new ResizeObserver(render)
  resize.observe(canvas)
  return {
    setExpressionPhase(phase) {
      if (disposed || (phase !== 'idle' && !phaseExpressions.has(phase)) || expressionPhase === phase)
        return
      expressionPhase = phase
      if (!mixer)
        render()
    },
    setRenderingEnabled(enabled) {
      if (disposed || renderingEnabled === enabled)
        return
      renderingEnabled = enabled
      if (enabled)
        render()
      updateAnimation()
    },
    async load(bytes) {
      validateLocalAvatar(bytes)
      const gltf = await loader.parseAsync(bytes, '')
      const vrm = gltf.userData.vrm
      if (!vrm || disposed) {
        VRMUtils.deepDispose(gltf.scene)
        throw new Error('avatar-model')
      }
      VRMUtils.rotateVRM0(vrm)
      const clip = gltf.animations.find(animation => animation.duration > 0 && Number.isFinite(animation.duration))
      if (!clip)
        relaxStaticArms(vrm)
      const nextBounds = new Box3().setFromObject(vrm.scene)
      const size = nextBounds.getSize(new Vector3())
      if (nextBounds.isEmpty() || !Number.isFinite(size.length()) || size.y <= 0) {
        VRMUtils.deepDispose(vrm.scene)
        throw new Error('avatar-bounds')
      }
      releaseModel()
      model = vrm.scene
      avatar = vrm
      bounds = nextBounds
      scene.add(model)
      if (clip) {
        sharedMorphs = prepareEmbeddedClip(vrm, clip)
        mixer = new AnimationMixer(model)
        mixer.clipAction(clip).play()
        mixer.update(0)
      }
      blinkEnabled = hasIdleBlink(vrm, sharedMorphs)
      render()
      updateAnimation()
    },
    dispose() {
      if (disposed)
        return
      disposed = true
      resize.disconnect()
      document.removeEventListener('visibilitychange', updateAnimation)
      releaseModel()
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}
