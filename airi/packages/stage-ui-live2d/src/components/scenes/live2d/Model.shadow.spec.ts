import type { Application } from '@pixi/app'

import { createPinia, defineStore, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, h, markRaw, nextTick, reactive, ref } from 'vue'

import Model from './Model.vue'

// These boundaries are unrelated to shadow scheduling: the native beat channel,
// GPU SDK, and motion/expression controllers cannot run in the Node renderer.
vi.mock('@proj-airi/stage-shared/beat-sync', () => ({ listenBeatSyncBeatSignal: () => () => {} }))
vi.mock('@proj-airi/ui', () => ({ useTheme: () => ({ isDark: ref(false) }) }))
vi.mock('pixi-filters', () => ({ DropShadowFilter: class {} }))
vi.mock('pixi-live2d-display/cubism4', () => ({ Live2DFactory: {}, Live2DModel: class {}, MotionPriority: {} }))
vi.mock('../../../composables/live2d', () => ({
  createBeatSyncController: () => ({ scheduleBeat() {} }),
  createLive2DMotionSpring: () => ({ output: ref({}) }),
  useExpressionController: () => ({ dispose() {} }),
}))
vi.mock('../../../composables/live2d/fit-model', () => ({ useFitModel: () => ref({ scale: 1, x: 0, y: 0 }) }))
vi.mock('../../../stores', () => ({
  useL2dViewControl: () => ({ position: ref({ x: 0, y: 0 }), scale: ref(1) }),
  getLive2DMotionControlModelOffset: () => ({ x: 0, y: 0 }),
  useLive2DMotionControl: defineStore('shadow-test-motion', () => ({ breathControl: ref({}), control: ref({}) })),
  useLive2dParams: defineStore('shadow-test-params', () => ({
    currentMotion: ref({ group: 'Idle', index: 0 }),
    availableMotions: ref([]),
    motionMap: ref({}),
    modelParameters: ref({}),
    onShouldUpdateView: () => () => {},
  })),
}))

// Vue's real mounting, props, watchers and unmounting, with a GPU-free host.
interface HostNode { children: HostNode[], parent?: HostNode }
const node = (): HostNode => ({ children: [] })
const renderer = createRenderer<HostNode, HostNode>({
  createElement: node,
  createText: node,
  createComment: node,
  insert(child, parent, anchor) {
    child.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, child)
  },
  remove(child) {
    const siblings = child.parent?.children
    if (siblings)
      siblings.splice(siblings.indexOf(child), 1)
    child.parent = undefined
  },
  setText() {},
  setElementText() {},
  parentNode: child => child.parent ?? null,
  nextSibling: child => child.parent?.children[child.parent.children.indexOf(child) + 1] ?? null,
  patchProp() {},
})

describe('model dynamic shadow lifetime', () => {
  let pending: Map<number, FrameRequestCallback>
  let nextId: number
  let unmount: (() => void) | undefined

  beforeEach(() => {
    setActivePinia(createPinia())
    pending = new Map()
    nextId = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++nextId
      pending.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => pending.delete(id))
  })

  afterEach(() => {
    unmount?.()
    unmount = undefined
    vi.unstubAllGlobals()
  })

  function mount(paused = false) {
    // This GPU boundary only needs a stage marker and the pause/start methods:
    // no model source is supplied, so the SFC never allocates or renders a model.
    const gpuApp = markRaw({ stage: {}, start() {}, stop() {} } as unknown as Application)
    const props = reactive({ app: gpuApp, width: 400, height: 600, themeColorsHueDynamic: true, live2dShadowEnabled: true, paused })
    const app = renderer.createApp({ render: () => h(Model, props) })
    app.mount(node())
    unmount = () => app.unmount()
    return props
  }

  function frame() {
    const callbacks = [...pending.values()]
    pending.clear()
    callbacks.forEach(callback => callback(0))
  }

  it('keeps one frame while active and cancels it on unmount', () => {
    mount()
    expect(pending.size).toBe(1)
    frame()
    expect(pending.size).toBe(1)
    unmount!()
    unmount = undefined
    expect(pending.size).toBe(0)
  })

  it('does not start paused and resumes a single loop', async () => {
    const props = mount(true)
    expect(pending.size).toBe(0)
    props.paused = false
    await nextTick()
    expect(pending.size).toBe(1)
    frame()
    expect(pending.size).toBe(1)
  })

  it('cancels during pause and ignores a late cancelled frame after resume', async () => {
    const props = mount()
    const stale = [...pending.values()][0]
    props.paused = true
    await nextTick()
    expect(pending.size).toBe(0)
    props.paused = false
    await nextTick()
    expect(pending.size).toBe(1)
    stale(0)
    expect(pending.size).toBe(1)
    frame()
    expect(pending.size).toBe(1)
  })

  it('ignores a late cancelled frame after unmount', () => {
    mount()
    const stale = [...pending.values()][0]
    unmount!()
    unmount = undefined
    stale(0)
    expect(pending.size).toBe(0)
  })

  it('stops when dynamic hue or shadows are disabled and restarts once', async () => {
    const props = mount()
    props.themeColorsHueDynamic = false
    await nextTick()
    expect(pending.size).toBe(0)
    props.themeColorsHueDynamic = true
    await nextTick()
    expect(pending.size).toBe(1)
    props.live2dShadowEnabled = false
    await nextTick()
    expect(pending.size).toBe(0)
    props.live2dShadowEnabled = true
    await nextTick()
    expect(pending.size).toBe(1)
  })
})
