import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'

import HearingConfig from './hearing-config.vue'

const audioDeviceMocks = vi.hoisted(() => ({
  componentAskPermission: vi.fn(),
  storeAskPermission: vi.fn(),
}))

function createAudioInput(deviceId: string, label: string): MediaDeviceInfo {
  return {
    deviceId,
    groupId: '',
    kind: 'audioinput',
    label,
    toJSON: () => ({}),
  }
}

vi.mock('../../../../composables/audio', async () => {
  const { computed, ref, shallowRef } = await vi.importActual<typeof import('vue')>('vue')
  const permissionGranted = ref(false)

  audioDeviceMocks.storeAskPermission.mockImplementation(async () => {
    permissionGranted.value = true
  })

  return {
    useAudioDevice: () => ({
      audioInputs: ref([createAudioInput('store-microphone', 'Store microphone')]),
      audioInputOptions: computed(() => [
        { label: 'Store microphone', value: 'store-microphone' },
      ]),
      selectedAudioInput: ref('store-microphone'),
      stream: shallowRef<MediaStream>(),
      deviceConstraints: computed(() => ({ audio: true })),
      permissionGranted,
      askPermission: audioDeviceMocks.storeAskPermission,
      startStream: vi.fn().mockResolvedValue(undefined),
      stopStream: vi.fn(),
    }),
  }
})

vi.mock('../../../../composables', async () => {
  const { ref } = await vi.importActual<typeof import('vue')>('vue')
  const permissionGranted = ref(false)

  audioDeviceMocks.componentAskPermission.mockImplementation(async () => {
    permissionGranted.value = true
  })

  return {
    useAudioAnalyzer: () => ({ volumeLevel: ref(0) }),
    useAudioDevice: () => ({
      audioInputs: ref([createAudioInput('detached-microphone', 'Detached microphone')]),
      permissionGranted,
      askPermission: audioDeviceMocks.componentAskPermission,
    }),
  }
})

vi.mock('../../../../stores', async () => {
  const { useSettingsAudioDevice } = await import('../../../../stores/settings/audio-device')
  return { useSettingsAudioDevice }
})

vi.mock('@proj-airi/ui', async () => {
  const { defineComponent, h } = await vi.importActual<typeof import('vue')>('vue')

  return {
    Callout: defineComponent({ render: () => h('div') }),
    FieldCheckbox: defineComponent({ render: () => h('div') }),
    FieldCombobox: defineComponent({
      props: {
        options: {
          type: Array as () => Array<{ label: string, value: string }>,
          default: () => [],
        },
      },
      setup(props) {
        return () => h('div', { 'data-testid': 'device-options' }, props.options.map(option => option.label).join(','))
      },
    }),
  }
})

function mountHearingConfig() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createApp(HearingConfig, { granted: true })
  app.use(createPinia())
  app.mount(host)

  return { app, host }
}

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

// TEST-ONLY: every test gets its own storage so state cannot leak between tests
// (jsdom/browser localStorage is shared per document, which is not isolation).
function installIsolatedLocalStorage() {
  const storage = new MemoryStorage()
  vi.stubGlobal('localStorage', storage)
  try {
    Object.defineProperty(window, 'localStorage', { configurable: true, value: storage, writable: true })
  }
  catch {}
  return storage
}

describe('hearing config audio device ownership', () => {
  beforeEach(() => {
    audioDeviceMocks.componentAskPermission.mockClear()
    audioDeviceMocks.storeAskPermission.mockClear()
    installIsolatedLocalStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requests microphone permission through the settings store', async () => {
    const { app, host } = mountHearingConfig()
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="Enable microphone input"]')

    button?.click()
    await nextTick()

    expect(audioDeviceMocks.storeAskPermission).toHaveBeenCalledOnce()
    expect(audioDeviceMocks.componentAskPermission).not.toHaveBeenCalled()

    app.unmount()
    host.remove()
  })

  it('renders the device inventory owned by the settings store', () => {
    const { app, host } = mountHearingConfig()

    expect(host.querySelector('[data-testid="device-options"]')?.textContent).toBe('Store microphone')
    expect(host.textContent).not.toContain('Detached microphone')

    app.unmount()
    host.remove()
  })
})
