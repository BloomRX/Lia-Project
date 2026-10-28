import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'

import HomeView from './HomeView.vue'

function status(phase: string, pid?: number) {
  return { ai: { ready: true }, stage: { state: { phase, pid } } }
}

function button(container: HTMLElement, label: string) {
  const result = [...container.querySelectorAll('button')].find(item => item.textContent?.trim() === label)
  expect(result, `button ${label}`).toBeDefined()
  return result!
}

describe('Home conversation shutdown', () => {
  it('waits for a confirmed stop, prevents duplicate actions and restores start from refreshed status', async () => {
    let resolveStop!: (value: { phase: string }) => void
    const stopStage = vi.fn(() => new Promise<{ phase: string }>((resolve) => {
      resolveStop = resolve
    }))
    const conversar = vi.fn()
    const refreshed = vi.fn()
    const screen = await render(HomeView, { props: { api: { stopStage, conversar }, status: status('running'), setup: { completed: true }, onRefresh: refreshed } })
    button(screen.container, 'Encerrar conversa').click()
    await vi.waitFor(() => expect(stopStage).toHaveBeenCalledTimes(1))
    expect(button(screen.container, 'Encerrando…').disabled).toBe(true)
    expect(button(screen.container, 'Conversando…').disabled).toBe(true)
    button(screen.container, 'Encerrando…').click()
    expect(stopStage).toHaveBeenCalledTimes(1)
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
    const screen = await render(HomeView, { props: { api: { stopStage, conversar }, status: status('stopping'), setup: { completed: true } } })
    expect(button(screen.container, 'Encerrando…').disabled).toBe(true)
    expect(button(screen.container, 'Conversar com Lia').disabled).toBe(true)
    button(screen.container, 'Encerrando…').click()
    expect(stopStage).not.toHaveBeenCalled()
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
