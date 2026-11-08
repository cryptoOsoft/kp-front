// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { FeedbackPrompt } from './FeedbackPrompt'
import { FeedbackSheet } from './FeedbackSheet'
import { appConfig } from '../../config/appConfig'
import { readTrouble, type TroubleEvent } from '../../lib/trouble'
import { fetchDiagnostics, saveDiagnostics } from '../../lib/feedbackDiagnostics'
import { MAX_MESSAGE, readDraft, writeDraft } from '../../lib/feedbackDraft'

// The guarantees worth pinning, because breaking any of them turns a helpful prompt into the
// thing the 3am tenet forbids:
//   1. Dismissing starts the cooldown — so this can never become a nag.
//   2. Nothing leaves without a deliberate tap. The app has had no upstream since the ingest
//      was retired, so «leaves» now means «a mail client or a GitHub form opened».
//   3. The Diagnose-Datei is saved on the way out. It is the only reason a bug report is
//      actionable, and a route that forgets it produces «pls fix» with extra steps.

vi.mock('../../lib/feedbackDiagnostics', async (orig) => ({
  ...(await orig<typeof import('../../lib/feedbackDiagnostics')>()),
  fetchDiagnostics: vi.fn(),
  saveDiagnostics: vi.fn(() => 'kp-front-diagnose-2026-09-09.json'),
}))
const mockFetch = vi.mocked(fetchDiagnostics)
const mockSave = vi.mocked(saveDiagnostics)

const cp = appConfig.copy.feedback
const trouble: TroubleEvent = { kind: 'crashLoop', at: 1_800_000_000_000 }

const aBundle = (errors: number) => ({
  generatedAt: '2026-09-09T20:00:00Z',
  app: 'kp-front',
  release: '0.4.1',
  install: 'abc-123',
  device: 'iPad Safari',
  errors: Array.from({ length: errors }, (_, i) => ({ message: `boom ${i}` })),
  errorsKept: 50,
  note: 'nichts Persönliches',
})

/** Wait for the on-open fetch to land, so assertions don't race the error count. */
const settled = () => waitFor(() => expect(mockFetch).toHaveBeenCalled())

// jsdom's Window defines `localStorage` as a getter-only accessor (spec-accurate, same as a
// real browser), so a plain assignment throws — must replace the property descriptor instead.
function installLocalStorage() {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, String(v)) },
      removeItem: (k: string) => { store.delete(k) },
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as unknown as Storage,
  })
}

beforeEach(() => {
  installLocalStorage()
  mockFetch.mockReset()
  mockFetch.mockResolvedValue(aBundle(3))
  mockSave.mockClear()
  // jsdom implements neither, and both are how the sheet's two routes leave.
  vi.stubGlobal('open', vi.fn())
  Object.defineProperty(window, 'location', { value: { href: '' }, configurable: true, writable: true })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

/** The «Weiter» button — the one exit that actually does something. */
const next = () => screen.getByText(cp.next).closest('button') as HTMLButtonElement
const pick = (label: string) => fireEvent.click(screen.getByText(label))

describe('FeedbackPrompt', () => {
  it('asks about the specific thing that happened, not a generic "any feedback?"', () => {
    render(<FeedbackPrompt trouble={trouble} onOpen={() => {}} onDismiss={() => {}} />)
    expect(screen.getByText(cp.promptFor.crashLoop)).toBeTruthy()
  })

  it('starts the cooldown when dismissed, so the same crash cannot come back next week', () => {
    const onDismiss = vi.fn()
    render(<FeedbackPrompt trouble={trouble} onOpen={() => {}} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByText(cp.promptDismiss))
    expect(onDismiss).toHaveBeenCalled()
    expect(readTrouble().askedAt).toBeTypeOf('number')
  })
})

describe('FeedbackSheet', () => {
  it('shows the operator exactly what would be sent', async () => {
    render(<FeedbackSheet trouble={trouble} onClose={() => {}} />)
    await settled()
    const block = document.querySelector('.fb-tech-block')?.textContent ?? ''
    expect(block).toContain(cp.tech.version)
    expect(block).toContain(cp.tech.device)
    expect(screen.getByText(cp.techNote)).toBeTruthy()
  })

  it('names how many crash logs the file will carry, before anything is decided', async () => {
    render(<FeedbackSheet onClose={() => {}} />)
    await waitFor(() => {
      expect(document.querySelector('.fb-tech-block')?.textContent).toContain(cp.diagLine)
    })
    expect(document.querySelector('.fb-diag-note')?.textContent).toContain('3')
  })

  it('says so plainly when there is nothing to attach, rather than promising a file', async () => {
    mockFetch.mockResolvedValue(aBundle(0))
    render(<FeedbackSheet onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText(cp.diagNoteEmpty)).toBeTruthy())
  })

  it('carries the trouble question through from the prompt', () => {
    render(<FeedbackSheet trouble={trouble} onClose={() => {}} />)
    expect(screen.getByText(cp.promptFor.crashLoop)).toBeTruthy()
  })

  it('opens neither route on its own — every exit needs a deliberate tap', async () => {
    render(<FeedbackSheet onClose={() => {}} />)
    await settled()
    expect(window.open).not.toHaveBeenCalled()
    expect(window.location.href).toBe('')
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('stops typing at the cap rather than letting the issue form truncate it', () => {
    render(<FeedbackSheet onClose={() => {}} />)
    expect((document.querySelector('.fb-input') as HTMLTextAreaElement).maxLength).toBe(MAX_MESSAGE)
  })

  it('will not send an empty report that carries no trouble either', () => {
    render(<FeedbackSheet onClose={() => {}} />)
    expect(next().disabled).toBe(true)
    // ...but a trouble makes even a wordless "yes, this happened to me" worth a report.
    cleanup()
    render(<FeedbackSheet trouble={trouble} onClose={() => {}} />)
    expect(next().disabled).toBe(false)
  })

  it('starts the cooldown when closed without reporting', () => {
    const onClose = vi.fn()
    render(<FeedbackSheet trouble={trouble} onClose={onClose} />)
    fireEvent.click(screen.getByText(cp.cancel))
    expect(onClose).toHaveBeenCalled()
    expect(readTrouble().askedAt).toBeTypeOf('number')
  })

  it('drops the trouble question when opened from Einstellungen', () => {
    render(<FeedbackSheet onClose={() => {}} />)
    expect(screen.queryByText(cp.promptFor.crashLoop)).toBeNull()
    expect(screen.getByText(cp.intro)).toBeTruthy()
  })
})

describe('FeedbackSheet — choosing a route', () => {
  it('defaults to the GitHub issue, the route that can demand structure', async () => {
    render(<FeedbackSheet trouble={trouble} onClose={() => {}} />)
    await settled()
    fireEvent.click(next())
    expect(window.open).toHaveBeenCalled()
    const url = vi.mocked(window.open).mock.calls[0][0] as string
    expect(url).toContain('/issues/new')
    // The form's fields are prefilled by id — a report that arrives empty is one nobody fills in.
    expect(url).toContain('template=bug_report.yml')
    expect(url).toContain('version=')
  })

  it('opens the mail client instead once mail is chosen', async () => {
    render(<FeedbackSheet trouble={trouble} onClose={() => {}} />)
    await settled()
    pick(cp.routeMail)
    fireEvent.click(next())
    expect(window.open).not.toHaveBeenCalled()
    expect(window.location.href).toContain(`mailto:${appConfig.feedback.mailto}`)
  })

  it('carries what the operator typed into the issue', async () => {
    render(<FeedbackSheet onClose={() => {}} />)
    await settled()
    fireEvent.change(document.querySelector('.fb-input')!, { target: { value: 'Trupp gesetzt, dann weg' } })
    fireEvent.click(next())
    // Read the parameter rather than the raw string: URLSearchParams writes a space as `+`,
    // which decodeURIComponent does not undo — a substring match here passes or fails on that
    // detail instead of on whether the operator's words arrived.
    const url = new URL(vi.mocked(window.open).mock.calls[0][0] as string)
    expect(url.searchParams.get('what')).toBe('Trupp gesetzt, dann weg')
  })

  it('saves the Diagnose-Datei on the way out, whichever route was picked', async () => {
    render(<FeedbackSheet trouble={trouble} onClose={() => {}} />)
    await settled()
    fireEvent.click(next())
    expect(mockSave).toHaveBeenCalledOnce()

    cleanup()
    mockSave.mockClear()
    render(<FeedbackSheet trouble={trouble} onClose={() => {}} />)
    await settled()
    pick(cp.routeMail)
    fireEvent.click(next())
    expect(mockSave).toHaveBeenCalledOnce()
  })

  it('does not offer a file when the server had none to give', async () => {
    mockFetch.mockResolvedValue(aBundle(0))
    render(<FeedbackSheet trouble={trouble} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText(cp.diagNoteEmpty)).toBeTruthy())
    fireEvent.click(next())
    // Still reports — a description without traces beats no report at all.
    expect(mockSave).not.toHaveBeenCalled()
    expect(window.open).toHaveBeenCalled()
  })

  it('still reports when the diagnostics fetch failed entirely', async () => {
    mockFetch.mockRejectedValue(new Error('offline'))
    render(<FeedbackSheet trouble={trouble} onClose={() => {}} />)
    await settled()
    fireEvent.click(next())
    expect(window.open).toHaveBeenCalled()
  })

  it('counts as asked once reported, so the same crash is not asked about again', async () => {
    render(<FeedbackSheet trouble={trouble} onClose={() => {}} />)
    await settled()
    fireEvent.click(next())
    expect(readTrouble().askedAt).toBeTypeOf('number')
  })
})

// A stray tap on the backdrop must not cost the operator their words. It still counts as asked
// — that is the cooldown's job and it is right — but the two behaviours are separable and only
// one of them should be destructive.
describe('FeedbackSheet — the draft', () => {
  it('keeps what was typed when the sheet is closed without reporting', () => {
    render(<FeedbackSheet trouble={trouble} onClose={() => {}} />)
    fireEvent.change(document.querySelector('.fb-input')!, { target: { value: 'halber Satz' } })
    fireEvent.click(screen.getByText(cp.cancel))
    expect(readDraft()).toBe('halber Satz')
  })

  it('restores it the next time the sheet opens', () => {
    writeDraft('halber Satz')
    render(<FeedbackSheet onClose={() => {}} />)
    expect((document.querySelector('.fb-input') as HTMLTextAreaElement).value).toBe('halber Satz')
  })

  it('keeps it even after a route was opened, because opening is not delivering', async () => {
    // The regression this pins actually shipped: the sheet cleared the draft the moment it
    // opened a route. GitHub silently drops a prefill whose template is missing from the
    // default branch, so the operator got an empty form AND their words were already gone.
    // Nothing here can confirm delivery, so nothing here may destroy the only copy.
    render(<FeedbackSheet trouble={trouble} onClose={() => {}} />)
    await settled()
    fireEvent.change(document.querySelector('.fb-input')!, { target: { value: 'ist raus' } })
    fireEvent.click(next())
    expect(readDraft()).toBe('ist raus')
  })
})
