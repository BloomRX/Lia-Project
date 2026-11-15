import type { createLiaProductConfig } from '../../configs/lia'

import { all, resolveSupportedLocale } from '@proj-airi/i18n'

const supported = Object.keys(all)

/** The managed Stage and Launcher share this product preference. */
export function createProductLanguage(config: Pick<ReturnType<typeof createLiaProductConfig>, 'get' | 'updateAndSave'>) {
  return {
    async get(): Promise<string> {
      return resolveSupportedLocale(config.get()?.preferences?.language, supported, 'pt-BR')
    },
    async set(locale: unknown): Promise<string> {
      if (typeof locale !== 'string' || !supported.includes(locale))
        throw new TypeError('Idioma não suportado.')
      await config.updateAndSave(current => ({
        ...current,
        preferences: { ...current.preferences, language: locale },
      }))
      return locale
    },
  }
}
