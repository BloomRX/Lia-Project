import { describe, expect, it } from 'vitest'

import { shouldInstallRealChatObserver } from './gate'

/**
 * The dev gate is the whole security property of the Lia diagnostics: it is
 * what keeps request and prompt capture out of a packaged build.
 *
 * Regression: the observer used to install whenever
 * `localStorage['lia:diag:real-chat'] === '1'`, in any build. A value in
 * user-writable storage is not an authorization boundary, so a packaged app
 * could be talked into logging request metadata. The build mode now decides,
 * and the flag only refines behaviour inside dev.
 */
describe('lia diagnostics dev gate', () => {
  it('installs in dev by default', () => {
    expect(shouldInstallRealChatObserver(true, null)).toBe(true)
    expect(shouldInstallRealChatObserver(true, undefined)).toBe(true)
  })

  it('lets dev opt out explicitly', () => {
    expect(shouldInstallRealChatObserver(true, '0')).toBe(false)
  })

  it('ignores the flag value inside dev apart from the opt-out', () => {
    expect(shouldInstallRealChatObserver(true, '1')).toBe(true)
    expect(shouldInstallRealChatObserver(true, 'anything')).toBe(true)
  })

  it('never installs outside dev, whatever the stored flag says', () => {
    // The regression: '1' used to unlock the observer in a packaged build.
    expect(shouldInstallRealChatObserver(false, '1')).toBe(false)
    expect(shouldInstallRealChatObserver(false, null)).toBe(false)
    expect(shouldInstallRealChatObserver(false, undefined)).toBe(false)
    expect(shouldInstallRealChatObserver(false, '0')).toBe(false)
    expect(shouldInstallRealChatObserver(false, 'true')).toBe(false)
  })
})
