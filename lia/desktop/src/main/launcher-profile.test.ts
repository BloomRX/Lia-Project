import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { launcherProfilePath, sameProfileDirectory } from './launcher-profile'

describe('launcher cipher profile', () => {
  it('keeps the original profile rather than changing cipher when package name changes', () => {
    const data = join('fixture', 'AppData')
    const previous = join(data, '@lia', 'lia-app')
    expect(launcherProfilePath(data, path => path === previous)).toBe(previous)
  })
  it('separates a fresh Launcher from the Stage product root', () => {
    const data = join('fixture', 'AppData')
    const profile = launcherProfilePath(data, () => false)
    expect(profile).toBe(join(data, 'Lia', 'launcher-profile'))
    expect(sameProfileDirectory(profile, join(data, 'Lia'))).toBe(false)
    expect(sameProfileDirectory(profile, profile.toUpperCase())).toBe(true)
  })
})
