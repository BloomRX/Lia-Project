import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import { AnimationMixer, Box3, Color, DirectionalLight, HemisphereLight, LoadingManager, OrthographicCamera, Scene, Vector3, WebGLRenderer } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

import { validateLocalAvatar } from './avatar-file.js'

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
  let mixer
  let avatar
  let timer
  let previousFrame

  function render() {
    if (!bounds || !canvas.clientWidth || !canvas.clientHeight)
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
    renderer.render(scene, camera)
  }
  function stopAnimation() {
    clearInterval(timer)
    timer = undefined
  }

  function updateAnimation() {
    stopAnimation()
    if (!mixer || document.hidden)
      return
    previousFrame = performance.now()
    timer = setInterval(() => {
      const now = performance.now()
      const elapsed = Math.min((now - previousFrame) / 1000, 0.1)
      previousFrame = now
      mixer.update(elapsed)
      avatar.update(elapsed)
      renderer.render(scene, camera)
    }, 1000 / 24)
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
      avatar = undefined
    }
  }

  document.addEventListener('visibilitychange', updateAnimation)
  const resize = new ResizeObserver(render)
  resize.observe(canvas)
  return {
    async load(bytes) {
      validateLocalAvatar(bytes)
      const gltf = await loader.parseAsync(bytes, '')
      const vrm = gltf.userData.vrm
      if (!vrm || disposed) {
        VRMUtils.deepDispose(gltf.scene)
        throw new Error('avatar-model')
      }
      VRMUtils.rotateVRM0(vrm)
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
      const clip = gltf.animations.find(animation => animation.duration > 0 && Number.isFinite(animation.duration))
      if (clip) {
        mixer = new AnimationMixer(model)
        mixer.clipAction(clip).play()
      }
      render()
      updateAnimation()
    },
    dispose() {
      disposed = true
      resize.disconnect()
      document.removeEventListener('visibilitychange', updateAnimation)
      releaseModel()
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}
