import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { cdp, page, userEvent } from 'vitest/browser'

import App from '../App.vue'
import HomeView from './HomeView.vue'

import '../styles.css'
import '../styles/lia-tokens.css'

function status(phase: string, pid?: number) {
  return { ai: { ready: true }, stage: { state: { phase, pid } } }
}

function button(container: HTMLElement, label: string) {
  const result = [...container.querySelectorAll('button')].find(item => item.textContent?.trim() === label)
  expect(result, `button ${label}`).toBeDefined()
  return result!
}

function renderHome(props: Record<string, unknown> = {}) {
  return render(HomeView, { props: { api: {}, status: undefined, setup: { completed: true }, ...props } })
}

function mountLauncherApi(homeStatus: () => Promise<unknown>) {
  const api = {
    homeStatus,
    aiProviders: vi.fn().mockResolvedValue([]),
    productConfig: vi.fn().mockResolvedValue({ status: 'ok', snapshot: { setup: { completed: true } } }),
    voiceProvisioningState: vi.fn().mockResolvedValue({ state: 'disabled' }),
  }
  Object.assign(window, { liaApi: api })
  return api
}

afterEach(() => {
  Reflect.deleteProperty(window, 'liaApi')
})

describe('Home readiness and launch', () => {
  it('shows progress while readiness is unknown and exposes setup only when needed', async () => {
    const conversar = vi.fn()
    const openAi = vi.fn()
    const screen = await renderHome({ api: { conversar }, onOpenAi: openAi })
    const checking = button(screen.container, 'Verificando prontidão…')
    expect(checking.disabled).toBe(true)
    expect(checking.getAttribute('aria-busy')).toBe('true')
    await expect.element(screen.getByRole('progressbar')).toBeVisible()
    checking.click()
    expect(conversar).not.toHaveBeenCalled()

    await screen.rerender({ status: { ai: { ready: false } } })
    const cta = button(screen.container, 'Conversar com Lia')
    expect(cta.disabled).toBe(true)
    expect(cta.getAttribute('aria-describedby')?.split(' ')).toContain('home-readiness-hint')
    expect(screen.container.querySelector('#home-readiness-hint')?.textContent).toContain('IA & Recursos')
    await expect.element(screen.getByRole('progressbar')).not.toBeInTheDocument()
    await screen.getByRole('button', { name: 'Configurar IA', exact: true }).click()
    expect(openAi).toHaveBeenCalledTimes(1)
    expect(conversar).not.toHaveBeenCalled()
  })

  it('starts once, shows progress, and exposes stop when the Stage becomes active', async () => {
    const start = Promise.withResolvers<{ ok: true }>()
    const conversar = vi.fn(() => start.promise)
    const refreshed = vi.fn()
    const screen = await renderHome({ api: { conversar }, status: status('stopped'), onRefresh: refreshed })
    await expect.element(screen.getByText('Pronta para conversar', { exact: true })).toBeVisible()
    const cta = button(screen.container, 'Conversar com Lia')
    cta.click()
    cta.click()
    expect(conversar).toHaveBeenCalledTimes(1)
    await expect.element(screen.getByRole('progressbar')).toBeVisible()
    expect(cta.disabled).toBe(true)
    expect(refreshed).not.toHaveBeenCalled()

    await screen.rerender({ status: status('starting') })
    start.resolve({ ok: true })
    await vi.waitFor(() => expect(refreshed).toHaveBeenCalledTimes(1))
    expect(button(screen.container, 'Abrindo o palco…').disabled).toBe(true)
    await screen.rerender({ status: status('running') })
    await expect.element(screen.getByRole('progressbar')).not.toBeInTheDocument()
    expect(button(screen.container, 'Encerrar conversa').disabled).toBe(false)
  })

  it('offers recovery after a blocked start while keeping the conversation retry available', async () => {
    const conversar = vi.fn()
      .mockResolvedValueOnce({ ok: false, code: 'connection-inconsistent', detail: 'PRIVATE_SENTINEL' })
      .mockResolvedValueOnce({ ok: true })
    const openDiagnostics = vi.fn()
    const screen = await renderHome({ api: { conversar }, status: status('stopped'), onOpenDiagnostics: openDiagnostics })
    const start = screen.getByRole('button', { name: 'Conversar com Lia', exact: true })
    await start.click()
    await expect.element(screen.getByRole('alert')).toHaveTextContent('Não foi possível verificar a conexão de IA.')
    expect(screen.container.textContent).not.toContain('PRIVATE_SENTINEL')
    await screen.getByRole('button', { name: 'Diagnósticos', exact: true }).click()
    expect(openDiagnostics).toHaveBeenCalledTimes(1)
    await start.click()
    expect(conversar).toHaveBeenCalledTimes(2)
    await expect.element(screen.getByRole('alert')).not.toBeInTheDocument()
  })

  it('reports unavailable status and clears the error after the shell refresh succeeds', async () => {
    const api = mountLauncherApi(vi.fn().mockRejectedValueOnce(new Error('PRIVATE_SENTINEL')).mockResolvedValueOnce(status('stopped')))
    const screen = await render(App)
    await expect.element(screen.getByRole('alert')).toBeVisible()
    expect(screen.container.textContent).not.toContain('PRIVATE_SENTINEL')
    expect(screen.container.querySelector<HTMLButtonElement>('.home-action')?.disabled).toBe(true)
    await screen.getByRole('button', { name: 'Atualizar estado', exact: true }).click()
    expect(api.homeStatus).toHaveBeenCalledTimes(2)
    await expect.element(screen.getByRole('alert')).not.toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: 'Conversar com Lia', exact: true })).toBeEnabled()
  })

  it('dismisses the last action error when explicitly checking status again', async () => {
    const refresh = vi.fn()
    const conversar = vi.fn().mockRejectedValue(new Error('PRIVATE_SENTINEL'))
    const screen = await renderHome({ api: { conversar }, status: status('stopped'), onRefresh: refresh })
    await screen.getByRole('button', { name: 'Conversar com Lia', exact: true }).click()
    await expect.element(screen.getByRole('alert')).toBeVisible()
    await screen.getByRole('button', { name: 'Atualizar estado', exact: true }).click()
    expect(refresh).toHaveBeenCalledTimes(2)
    await expect.element(screen.getByRole('alert')).not.toBeInTheDocument()
  })
})

describe('Home setup and optional voice', () => {
  it.each([{ label: 'Completa', enabled: true }, { label: 'Somente texto', enabled: false }])('persists $label once without gating conversation', async ({ label, enabled }) => {
    const saved = Promise.withResolvers<{ status: string }>()
    const updateConfig = vi.fn(() => saved.promise)
    const refresh = vi.fn()
    const screen = await renderHome({ api: { updateConfig }, status: status('stopped'), setup: {}, onRefresh: refresh })
    const choice = button(screen.container, label)
    choice.click()
    await vi.waitFor(() => expect(choice.disabled).toBe(true))
    choice.click()
    expect(updateConfig).toHaveBeenCalledTimes(1)
    expect(updateConfig).toHaveBeenCalledWith({ update: { setup: { completed: true }, voice: { enabled } } })
    expect(button(screen.container, 'Conversar com Lia').disabled).toBe(false)
    saved.resolve({ status: 'ok' })
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    await expect.element(screen.getByRole('button', { name: label, exact: true })).not.toBeInTheDocument()
  })

  it('shows unavailable voice and leaves the text conversation available', async () => {
    const screen = await renderHome({ status: status('stopped'), readiness: { state: 'error' } })
    await expect.element(screen.getByText(/voz:\s*erro/i)).toBeVisible()
    await expect.element(screen.getByRole('button', { name: 'Conversar com Lia', exact: true })).toBeEnabled()
  })
})

describe('Home desktop interactions', () => {
  it('keeps the setup action keyboard-accessible across desktop window sizes', async () => {
    const original = { width: window.innerWidth, height: window.innerHeight }
    const api = mountLauncherApi(vi.fn().mockResolvedValue({ ai: { ready: false } }))
    try {
      const screen = await render(App)
      await expect.element(screen.getByRole('button', { name: 'Configurar IA', exact: true })).toBeEnabled()
      const setup = button(screen.container, 'Configurar IA')
      for (const [width, height] of [[1920, 1080], [1366, 768], [880, 660], [440, 330]]) {
        await page.viewport(width, height)
        const main = screen.container.querySelector('main')!
        expect(main.scrollWidth).toBeLessThanOrEqual(main.clientWidth)
        expect(setup.getBoundingClientRect().width).toBeGreaterThan(0)
        expect(setup.getBoundingClientRect().right).toBeLessThanOrEqual(width)
      }
      const navigation = screen.container.querySelector('nav')!
      const lastDestination = [...navigation.querySelectorAll('button')].at(-1)!
      lastDestination.focus()
      await userEvent.tab()
      expect(document.activeElement).toBe(setup)
      expect(setup.matches(':focus-visible')).toBe(true)
      await userEvent.keyboard('{Enter}')
      await vi.waitFor(() => expect(api.aiProviders).toHaveBeenCalledTimes(1))
      await expect.element(screen.getByRole('button', { name: 'IA & Recursos', exact: true })).toHaveAttribute('aria-current', 'page')
      const main = screen.container.querySelector('main')!
      expect(main).toBe(document.activeElement)
      expect(main.scrollTop).toBe(0)
      await screen.getByRole('button', { name: 'Início', exact: true }).click()
      await expect.element(screen.getByRole('button', { name: 'Configurar IA', exact: true })).toBeEnabled()
    }
    finally {
      await page.viewport(original.width, original.height)
    }
  })

  it('disables progress animation and action transitions under reduced motion', async () => {
    const session = cdp()
    try {
      await session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
      const screen = await renderHome()
      const progress = screen.container.querySelector('[role="progressbar"]')!
      expect(getComputedStyle(progress, '::before').animationName).not.toBe('none')
      await session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
      expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true)
      await expect.element(screen.getByRole('progressbar')).toBeVisible()
      expect(getComputedStyle(progress, '::before').animationName).toBe('none')
      const cta = button(screen.container, 'Verificando prontidão…')
      expect(getComputedStyle(cta).transitionDuration.split(',').every(duration => Number.parseFloat(duration) === 0)).toBe(true)
    }
    finally {
      await session.send('Emulation.setEmulatedMedia', { features: [] })
    }
  })
})

describe('Home conversation shutdown', () => {
  it('waits for a confirmed stop, prevents duplicate actions and restores start from refreshed status', async () => {
    let resolveStop!: (value: { phase: string }) => void
    const stopStage = vi.fn(() => new Promise<{ phase: string }>((resolve) => {
      resolveStop = resolve
    }))
    const conversar = vi.fn()
    const refreshed = vi.fn()
    const screen = await render(HomeView, { props: { api: { stopStage, conversar }, status: status('running'), setup: { completed: true }, onRefresh: refreshed } })
    const start = button(screen.container, 'Conversando…')
    const stop = button(screen.container, 'Encerrar conversa')
    stop.click()
    await vi.waitFor(() => expect(stopStage).toHaveBeenCalledTimes(1))
    expect(stop.disabled).toBe(true)
    expect(stop.textContent?.trim()).toBe('Encerrando…')
    expect(start.disabled).toBe(true)
    stop.click()
    start.click()
    expect(stopStage).toHaveBeenCalledTimes(1)
    expect(conversar).not.toHaveBeenCalled()
    expect(refreshed).not.toHaveBeenCalled()
    resolveStop({ phase: 'stopped' })
    await vi.waitFor(() => expect(refreshed).toHaveBeenCalledTimes(1))
    await screen.rerender({ status: status('stopped') })
    expect(screen.container.textContent).toContain('Conversa encerrada.')
    expect(screen.container.textContent).not.toContain('Encerrar conversa')
    button(screen.container, 'Conversar com Lia').click()
    await vi.waitFor(() => expect(conversar).toHaveBeenCalledTimes(1))
  })

  it.each(['error', 'running', 'stopping'])('does not approve a resolved %s response; supports retry without raw payload', async (phase) => {
    const stopStage = vi.fn().mockResolvedValueOnce({ phase, lastError: 'PRIVATE_SENTINEL https://example.invalid' }).mockResolvedValueOnce({ phase: 'stopped' })
    const screen = await render(HomeView, { props: { api: { stopStage }, status: status('running'), setup: { completed: true } } })
    button(screen.container, 'Encerrar conversa').click()
    await vi.waitFor(() => expect(screen.container.textContent).toContain('Não foi possível encerrar a conversa. Tente novamente.'))
    expect(screen.container.textContent).not.toContain('Conversa encerrada.')
    expect(screen.container.textContent).not.toContain('PRIVATE_SENTINEL')
    await screen.rerender({ status: status('error', 321) })
    button(screen.container, 'Encerrar conversa').click()
    await vi.waitFor(() => expect(stopStage).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(screen.container.textContent).toContain('Conversa encerrada.'))
  })

  it('handles a rejected stop in English and does not expose the error', async () => {
    const screen = await render(HomeView, { props: { api: { stopStage: vi.fn().mockRejectedValue(new Error('PRIVATE_SENTINEL')) }, status: status('running'), language: 'en-US', setup: { completed: true } } })
    button(screen.container, 'End conversation').click()
    await vi.waitFor(() => expect(screen.container.textContent).toContain('Could not end the conversation. Try again.'))
    expect(screen.container.textContent).not.toContain('PRIVATE_SENTINEL')
  })

  it('blocks both actions while stopping and offers no stop for an error without a process', async () => {
    const stopStage = vi.fn()
    const conversar = vi.fn()
    const screen = await render(HomeView, { props: { api: { stopStage, conversar }, status: status('running'), setup: { completed: true } } })
    const start = button(screen.container, 'Conversando…')
    const stop = button(screen.container, 'Encerrar conversa')
    await screen.rerender({ status: status('stopping') })
    expect(stop.disabled).toBe(true)
    expect(stop.textContent?.trim()).toBe('Encerrando…')
    expect(start.disabled).toBe(true)
    stop.click()
    start.click()
    expect(stopStage).not.toHaveBeenCalled()
    expect(conversar).not.toHaveBeenCalled()
    await screen.rerender({ status: status('error') })
    expect(screen.container.textContent).not.toContain('Encerrar conversa')
    expect(button(screen.container, 'Conversar com Lia').disabled).toBe(false)
  })

  it('allows the canonical start path after a stop failure with a historical process identifier', async () => {
    const conversar = vi.fn()
    const stopStage = vi.fn().mockResolvedValue({ phase: 'error', pid: 321 })
    const screen = await render(HomeView, { props: { api: { stopStage, conversar }, status: status('error', 321), setup: { completed: true } } })
    button(screen.container, 'Encerrar conversa').click()
    await vi.waitFor(() => expect(screen.container.textContent).toContain('Não foi possível encerrar a conversa. Tente novamente.'))
    expect(button(screen.container, 'Conversar com Lia').disabled).toBe(false)
    button(screen.container, 'Conversar com Lia').click()
    await vi.waitFor(() => expect(conversar).toHaveBeenCalledTimes(1))
  })
})
