import type { LiaProductConfig } from '../../configs/lia'

import { describe, expect, it, vi } from 'vitest'

import { createProductLanguage } from './product-language'

function fixture(initial: LiaProductConfig = { schemaVersion: 1, persona: {}, provider: {}, voice: {}, preferences: {} }) {
  let current = initial
  const config = {
    get: () => current,
    updateAndSave: vi.fn(async (mutator: (value: LiaProductConfig) => LiaProductConfig) => {
      current = mutator(current)
    }),
  }
  return { config, language: createProductLanguage(config) }
}

describe('canonical product language', () => {
  it('defaults to pt-BR without creating a document', async () => {
    const { config, language } = fixture()
    expect(await language.get()).toBe('pt-BR')
    expect(config.updateAndSave).not.toHaveBeenCalled()
  })

  it.each(['en', 'pt-BR', 'ja'])('preserves explicit %s in the shared Main handle', async (locale) => {
    const { config, language } = fixture()
    await language.set(locale)
    expect(await createProductLanguage(config).get()).toBe(locale)
    expect(config.get().preferences.language).toBe(locale)
  })

  it('propagates a rejected commit', async () => {
    const { config, language } = fixture()
    config.updateAndSave.mockRejectedValueOnce(new Error('disk failure'))
    await expect(language.set('en')).rejects.toThrow('disk failure')
  })

  it('rejects unsupported IPC payloads without writing', async () => {
    const { config, language } = fixture()
    await expect(language.set({ language: 'en' })).rejects.toThrow('suportado')
    await expect(language.set('unknown')).rejects.toThrow('suportado')
    expect(config.updateAndSave).not.toHaveBeenCalled()
  })
})
