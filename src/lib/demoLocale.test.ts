// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootLocale, readDemoLocale, saveDemoLocale } from './demoLocale'

// The demo's language switch is the one exception to «locale is per deployment»: the device's
// pick may win ONLY in demo mode – a station's configured language must never be overridden by
// something left in a browser.
describe('bootLocale', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('applies the device pick in demo mode', () => {
    saveDemoLocale('fr')
    expect(bootLocale({ locale: 'de-CH', demoMode: true })).toBe('fr')
  })

  it('keeps the deployment locale in demo mode until the device picks one', () => {
    expect(bootLocale({ locale: 'de-CH', demoMode: true })).toBe('de-CH')
  })

  it('ignores a stored pick on a station that is not a demo', () => {
    saveDemoLocale('fr')
    expect(bootLocale({ locale: 'de-CH', demoMode: false })).toBe('de-CH')
    expect(bootLocale({ locale: 'it' })).toBe('it')
    expect(bootLocale(undefined)).toBeUndefined()
  })

  it('ignores a stored value the demo does not offer', () => {
    localStorage.setItem('kp-demo-locale', 'it')
    expect(readDemoLocale()).toBeNull()
    expect(bootLocale({ locale: 'de-CH', demoMode: true })).toBe('de-CH')
  })

  it('falls back to the deployment locale when storage is refused', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError') })
    expect(bootLocale({ locale: 'de-CH', demoMode: true })).toBe('de-CH')
  })
})
