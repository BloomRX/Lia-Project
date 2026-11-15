import { describe, expect, it } from 'vitest'

import { getProviderCredentialConfigPort, registerProviderCredentialConfigPort } from './credential-config-port'

describe('provider credential configuration port', () => {
  it('is opt-in and restores the previous owner on disposal', () => {
    expect(getProviderCredentialConfigPort('native-stt')).toBeUndefined()
    const first = { owns: (id: string) => id === 'native-stt', has: async () => true, save: async () => true }
    const second = { ...first }
    const undoFirst = registerProviderCredentialConfigPort(first)
    const undoSecond = registerProviderCredentialConfigPort(second)
    try {
      expect(getProviderCredentialConfigPort('web-stt')).toBeUndefined()
      expect(getProviderCredentialConfigPort('native-stt')).toBe(second)
      undoSecond()
      undoSecond()
      expect(getProviderCredentialConfigPort('native-stt')).toBe(first)
    }
    finally {
      undoSecond()
      undoFirst()
    }
    expect(getProviderCredentialConfigPort('native-stt')).toBeUndefined()
  })
})
