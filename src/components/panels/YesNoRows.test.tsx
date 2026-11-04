// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { appConfig } from '../../config/appConfig'
import { loadPrefs } from '../../lib/prefs'

// ⚠️ The decision this file pins (owner, 28.09.2026): a yes/no is ONE control app-wide — the
// `OnOff` pair, the false answer left and the true one right. The Einstellungen built their own
// pairs with «on» on the LEFT («Ein | Aus», «Erlaubt | Aus», «Automatisch | Nur manuell»), and the
// Übung was a tick-box chip. Same thumb position, opposite answer, depending on the sheet.
// A setting reads «Aus | An»; a question («Übung?») reads «Nein | Ja» on every device (20.10.2026).

vi.mock('../../lib/incidents', () => ({
  createIncident: vi.fn(), patchIncident: vi.fn(),
  getIncident: vi.fn(() => Promise.resolve({ text: '' })),
  listObjects: vi.fn(() => Promise.resolve([])),
  listPersonnel: vi.fn(() => Promise.resolve([])),
  geocodeSearch: vi.fn(() => Promise.resolve([])),
  geocodeReverse: vi.fn(() => Promise.resolve(null)),
}))
vi.mock('../MapPicker', () => ({ MapPicker: () => null }))
// the Einstellungen carry the alarm readiness rows, which read the session – mounted bare here
vi.mock('../../lib/auth', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../lib/auth')>()
  const value = { user: null, loading: false, probeUnreachable: false, sessionExpired: false, login: () => Promise.resolve(), logout: () => Promise.resolve() }
  return { ...mod, useAuth: () => value }
})
vi.mock('./_shared', async (orig) => ({
  ...(await orig<typeof import('./_shared')>()),
  Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const { EinsatzWizard } = await import('./EinsatzWizard')
const { SettingsSheet } = await import('./SettingsSheet')

const D = appConfig.copy.drawingEditor
afterEach(() => { cleanup(); document.cookie = 'kp-front-prefs=; max-age=0; path=/' })

/** the pair's two answers, in screen order, and which one is pressed */
const pair = (label: string) => {
  const group = screen.getByRole('group', { name: label })
  const btns = within(group).getAllByRole('button')
  return { words: btns.map((b) => b.textContent), pressed: btns.map((b) => b.getAttribute('aria-pressed')), btns }
}

describe('Übung on the Einsatz form', () => {
  const ix = appConfig.copy.intake

  const atWidth = (phone: boolean) =>
    vi.stubGlobal('matchMedia', () => ({ matches: phone, addEventListener: () => {}, removeEventListener: () => {} }))
  afterEach(() => vi.unstubAllGlobals())

  for (const phone of [true, false]) {
    it(`answers «Übung?» with Nein | Ja, off for a fresh Einsatz (${phone ? 'phone' : 'tablet'})`, () => {
      atWidth(phone)
      render(<EinsatzWizard onClose={() => {}} onCreated={() => {}} />)
      const p = pair(ix.exerciseLabel)
      expect(p.words).toEqual([D.no, D.yes])
      expect(p.pressed).toEqual(['true', 'false'])
    })
  }

  it('turns on with «Ja», and the words never change', () => {
    render(<EinsatzWizard onClose={() => {}} onCreated={() => {}} />)
    fireEvent.click(pair(ix.exerciseLabel).btns[1])
    const p = pair(ix.exerciseLabel)
    expect(p.words).toEqual([D.no, D.yes])
    expect(p.pressed).toEqual(['false', 'true'])
  })
})

describe('the Einstellungen yes/no rows', () => {
  const cp = appConfig.copy.settings
  const onKeepScreenOn = vi.fn(), onRailLabels = vi.fn()
  const mount = () => render(
    <SettingsSheet onClose={() => {}} symbolScale={{ map: 1, board: 1 }} onSymbolScale={() => {}}
      symbolCaptions="auto" onSymbolCaptions={() => {}} railLabels="off" onRailLabels={onRailLabels}
      offlineRadiusM={1000} onOfflineRadius={() => {}} offlineAuto onOfflineAuto={() => {}}
      keepScreenOn onKeepScreenOn={onKeepScreenOn} themeCoord={null}
      shareAs={null} onSharePosition={() => {}} />)

  it('all read «Aus | An», in that order', () => {
    mount()
    for (const label of [cp.railLabels, cp.keyHints, cp.offlineAuto, cp.keepScreenOn, appConfig.copy.sharePosition.settingsLabel]) {
      expect(pair(label).words, label).toEqual([D.off, D.on])
    }
    expect(pair(cp.keepScreenOn).pressed).toEqual(['false', 'true'])
    expect(pair(cp.railLabels).pressed).toEqual(['true', 'false'])
  })

  // 31.10.2026: «Tastenkürzel anzeigen» – a device pref, ON until switched off, stored in the cookie
  it('show «Tastenkürzel anzeigen» as on by default and store the switch on the device', () => {
    mount()
    expect(pair(cp.keyHints).pressed).toEqual(['false', 'true'])
    fireEvent.click(pair(cp.keyHints).btns[0])
    expect(loadPrefs().keyHints).toBe(false)
    expect(pair(cp.keyHints).pressed).toEqual(['true', 'false'])
  })

  // 05.10.2026: the Führungsansicht is the login's (admin · Benutzer), not a device switch
  it('offer no Führungsansicht toggle', () => {
    mount()
    expect(screen.queryByText('Führungsansicht')).toBeNull()
  })

  // 05.10.2026: who the device reports as is one tap away — the name is on the button
  it('show the Standort name as a button that opens the picker', () => {
    const onChangeShareName = vi.fn()
    render(
      <SettingsSheet onClose={() => {}} symbolScale={{ map: 1, board: 1 }} onSymbolScale={() => {}}
        symbolCaptions="auto" onSymbolCaptions={() => {}} railLabels="off" onRailLabels={() => {}}
        offlineRadiusM={1000} onOfflineRadius={() => {}} offlineAuto onOfflineAuto={() => {}}
        keepScreenOn onKeepScreenOn={() => {}} themeCoord={null}
        shareAs="Muster Felix" onSharePosition={() => {}} onChangeShareName={onChangeShareName} />)
    fireEvent.click(screen.getByRole('button', { name: /Muster Felix/ }))
    expect(onChangeShareName).toHaveBeenCalledTimes(1)
  })

  it('hand the caller the answer', () => {
    mount()
    fireEvent.click(pair(cp.keepScreenOn).btns[0])
    expect(onKeepScreenOn).toHaveBeenCalledWith(false)
    // the rail words keep their stored 'off' | 'short' names behind the pair
    fireEvent.click(pair(cp.railLabels).btns[1])
    expect(onRailLabels).toHaveBeenCalledWith('short')
  })
})
