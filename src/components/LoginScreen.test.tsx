// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

// The remembered-length auto-login (07.09.): a device that has signed an account in once
// submits by itself the moment the typed PIN reaches that account's proven length — no ✓.
// First logins, other devices, and a PIN that changed length keep the explicit ✓. A mistype
// keeps the jump armed for the retry; a second miss disarms it so a LONGER new PIN can still
// be typed out.

const login = vi.fn()
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ login }),
}))
vi.mock('../lib/api', () => ({
  apiGet: vi.fn(async () => [{ id: 'u1', display_name: 'Keller Anna', color: null, role: 'editor' }]),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public detail: string, public retryAfter?: number, public hint?: string) { super(detail) }
  },
}))
const cfg = vi.hoisted(() => ({ microsoft: false }))
// what the device holds of unsent work (lib/unsentAccounts) — the store itself is pinned there
const device = vi.hoisted(() => ({
  unsent: [] as { id: string; at: number }[],
  cachedRoster: [] as { id: string; display_name: string; color: null; role: 'editor' }[],
}))
vi.mock(import('../lib/unsentAccounts'), async (importOriginal) => ({
  ...(await importOriginal()),
  unsentAccounts: async () => device.unsent,
  readCachedRoster: async () => device.cachedRoster,
  cacheRoster: () => {},
}))
vi.mock(import('../lib/deploymentConfig'), async (importOriginal) => ({
  ...(await importOriginal()),
  demoNote: () => null,
  deploymentName: () => 'Test',
  getDeploymentConfig: () => ({ integrations: { microsoftLoginConfigured: cfg.microsoft } }),
}))

const { LoginScreen } = await import('./LoginScreen')
const { apiGet, ApiError } = await import('../lib/api')

const typePin = (digits: string) => {
  for (const d of digits) fireEvent.click(screen.getByRole('button', { name: d }))
}

async function openPad() {
  render(<LoginScreen />)
  await act(async () => {}) // roster fetch resolves
  fireEvent.click(screen.getByText('Keller Anna'))
}

// jsdom exposes localStorage as a getter-only accessor in this setup — install the same
// minimal stub ErrorBoundary.test.tsx / storageMigration.test.ts use.
function installLocalStorage() {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() { return store.size },
    } as Storage,
  })
}

beforeEach(() => {
  cfg.microsoft = false
  device.unsent = []
  device.cachedRoster = []
  installLocalStorage()
  login.mockReset().mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('LoginScreen — auto-login at the remembered PIN length', () => {
  it('a first login still needs the ✓, and its length is remembered on success', async () => {
    await openPad()
    typePin('123456')
    expect(login).not.toHaveBeenCalled() // nothing remembered yet — no silent jump
    fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }))
    await act(async () => {})
    expect(login).toHaveBeenCalledExactlyOnceWith('u1', '123456')
    expect(JSON.parse(localStorage.getItem('kp.pinlen')!)).toEqual({ u1: 6 })
  })

  it('the next login on this device submits by itself at that length', async () => {
    localStorage.setItem('kp.pinlen', JSON.stringify({ u1: 6 }))
    await openPad()
    typePin('123456')
    await act(async () => {})
    expect(login).toHaveBeenCalledExactlyOnceWith('u1', '123456')
  })

  const pinWrong = async () => {
    const { ApiError } = (await import('../lib/api')) as unknown as { ApiError: new (status: number, detail: string) => Error }
    return new ApiError(401, 'PIN falsch')
  }

  it('a mistyped PIN still submits by itself on the retry', async () => {
    localStorage.setItem('kp.pinlen', JSON.stringify({ u1: 6 }))
    login.mockRejectedValueOnce(await pinWrong())
    await openPad()
    typePin('123457') // typo — auto-fires and fails
    await act(async () => {})
    typePin('123456') // the retry needs no ✓
    await act(async () => {})
    expect(login).toHaveBeenCalledTimes(2)
    expect(login).toHaveBeenLastCalledWith('u1', '123456')
  })

  it('a second miss disarms the jump, so a longer changed PIN can be typed out', async () => {
    localStorage.setItem('kp.pinlen', JSON.stringify({ u1: 6 }))
    login.mockRejectedValueOnce(await pinWrong()).mockRejectedValueOnce(await pinWrong())
    await openPad()
    typePin('123456') // the old length — auto-fires and fails, twice
    await act(async () => {})
    typePin('123456')
    await act(async () => {})
    expect(login).toHaveBeenCalledTimes(2)

    typePin('12345678') // the new, longer PIN — must survive digit 6 without a third auto-fire
    expect(login).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }))
    await act(async () => {})
    expect(login).toHaveBeenCalledTimes(3)
    expect(login).toHaveBeenLastCalledWith('u1', '12345678')
    expect(JSON.parse(localStorage.getItem('kp.pinlen')!)).toEqual({ u1: 8 }) // re-learned
  })

  it('ends the pad with ⌫ on the left and ✓ on the right of the 0', async () => {
    await openPad()
    const lastRow = [...document.querySelectorAll('.pin-grid > *')].slice(-3)
    expect(lastRow.map((k) => k.getAttribute('aria-label') ?? k.textContent)).toEqual(['Löschen', '0', 'Anmelden'])
  })
})

describe('LoginScreen — «Mit Microsoft anmelden»', () => {
  const button = () => screen.queryByRole('link', { name: 'Mit Microsoft anmelden' })

  it('is not drawn on a station that has not set it up', async () => {
    render(<LoginScreen />)
    await act(async () => {})
    expect(button()).toBeNull()
  })

  it('is drawn below the roster where set up, and leaves for the backend start route', async () => {
    cfg.microsoft = true
    render(<LoginScreen />)
    await act(async () => {})
    expect(button()?.getAttribute('href')).toBe('/api/auth/microsoft/start')
    fireEvent.click(screen.getByText('Keller Anna'))
    expect(button()).toBeNull() // the PIN pad is the whole screen once a face is picked
  })

  it('is hidden offline even where configured, while the PIN remains available', async () => {
    cfg.microsoft = true
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    render(<LoginScreen />)
    await act(async () => {})
    expect(button()).toBeNull()
    fireEvent.click(screen.getByText('Keller Anna'))
    expect(screen.getByRole('button', { name: 'Anmelden' })).toBeTruthy()
  })

  it('says why a sign-in came back, once, and takes the reason out of the address bar', async () => {
    cfg.microsoft = true
    window.history.replaceState(null, '', '/?msLogin=unknown')
    render(<LoginScreen />)
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toContain('nicht freigeschaltet')
    expect(window.location.search).toBe('')
  })
})

// Sweep 09.11.2026, UX.2 (owner pick «5B»): unsent work of an account waits on this device, and
// the gate says whose — with the one tap that brings that person to their PIN pad.
describe('LoginScreen — «Ungesendete Änderungen von …»', () => {
  const person = (id: string, display_name: string) => ({ id, display_name, color: null, role: 'editor' as const })
  const banner = () => document.querySelector('[role="status"].form-warn')
  const lineTitles = () => [...(banner()?.querySelectorAll('p > span') ?? [])].map((n) => n.textContent)
  const signIns = () => [...(banner()?.querySelectorAll('button') ?? [])].map((b) => b.textContent)

  it('is not drawn while the device holds nobody’s unsent work', async () => {
    render(<LoginScreen />)
    await act(async () => {})
    expect(banner()).toBeNull()
  })

  it('names the account and opens that person’s PIN pad; the grid stays for everybody else', async () => {
    vi.mocked(apiGet).mockResolvedValueOnce([person('u1', 'Keller Anna'), person('u2', 'Graf Jonas')])
    device.unsent = [{ id: 'u2', at: 5 }]
    render(<LoginScreen />)
    await act(async () => {})
    expect(lineTitles()).toEqual(['Ungesendete Änderungen von Graf Jonas'])
    expect(signIns()).toEqual(['Als Graf Jonas anmelden'])
    expect(document.querySelectorAll('.roster-tile')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Als Graf Jonas anmelden' }))
    expect(document.querySelector('.pin-username')?.textContent).toBe('Graf Jonas')
    expect(banner()).toBeNull() // the pad is the whole screen once somebody is picked
  })

  it('several accounts: one line each, most recent first, three at most, then «und n weitere»', async () => {
    const people = ['A', 'B', 'C', 'D', 'E'].map((n) => person(n, `Person ${n}`))
    vi.mocked(apiGet).mockResolvedValueOnce(people)
    device.unsent = ['D', 'A', 'E', 'B', 'C'].map((id, i) => ({ id, at: 100 - i }))
    render(<LoginScreen />)
    await act(async () => {})
    expect(signIns()).toEqual(['Als Person D anmelden', 'Als Person A anmelden', 'Als Person E anmelden'])
    expect(banner()?.textContent).toContain('und 2 weitere')
  })

  it('an account gone from the roster is «einem früheren Konto», with nothing to tap', async () => {
    device.unsent = [{ id: 'gone', at: 5 }]
    render(<LoginScreen />)
    await act(async () => {})
    expect(lineTitles()).toEqual(['Ungesendete Änderungen von einem früheren Konto'])
    expect(signIns()).toEqual([])
  })

  it('without a roster it still names the account from the one the device last saw, but offers no sign-in', async () => {
    vi.mocked(apiGet).mockRejectedValueOnce(new ApiError(0, 'offline'))
    device.unsent = [{ id: 'u2', at: 5 }]
    device.cachedRoster = [person('u2', 'Graf Jonas')]
    render(<LoginScreen />)
    await act(async () => {})
    expect(lineTitles()).toEqual(['Ungesendete Änderungen von Graf Jonas'])
    expect(signIns()).toEqual([])
  })
})
