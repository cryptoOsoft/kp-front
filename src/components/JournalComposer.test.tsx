// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { StrictMode } from 'react'
import { act, render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { JournalComposer, type JournalDraft } from './JournalComposer'
import { clearAllDrafts } from '../lib/draftKeep'
import { appConfig } from '../config/appConfig'

afterEach(() => { cleanup(); clearAllDrafts(); vi.unstubAllGlobals() })

vi.mock('../lib/audioImport', async (orig) => ({
  ...(await orig<typeof import('../lib/audioImport')>()),
  // jsdom cannot decode audio — the probe would never settle
  probeAudioDuration: async () => 12,
}))

// a picked picture's position read (lib/photoGeo · photoGeoSettled) — null: nothing pending, as
// almost always; a test sets a promise to hold «Erfassen» in its busy state
let geoWait: Promise<void> | null = null
vi.mock('../lib/photoGeo', async (orig) => ({
  ...(await orig<typeof import('../lib/photoGeo')>()),
  photoGeoSettled: () => geoWait,
}))

/** the time picker draws wheels on a coarse pointer (a phone) and a typed field on a fine one */
function pointer(kind: 'coarse' | 'fine') {
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {})
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes(kind), media: q, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }))
}

const OPEN = [
  { id: 'p1', text: 'Absperrmaterial Kreuzung, Werkhof Oberwil', urgent: true, createdAt: '2026-06-24T03:00:00.000Z' },
  { id: 'p2', text: 'Patient an Sanität übergeben', createdAt: '2026-06-24T03:10:00.000Z' },
]

function setup(over: Partial<React.ComponentProps<typeof JournalComposer>> = {}) {
  const onSubmit = vi.fn<(d: JournalDraft) => void>()
  const onLinkPendenz = vi.fn()
  render(<JournalComposer
    onSubmit={onSubmit} onClose={vi.fn()} openPendenzen={OPEN} onLinkPendenz={onLinkPendenz} {...over} />)
  return { onSubmit, onLinkPendenz }
}

const type = (value: string) => fireEvent.change(screen.getByRole('textbox'), { target: { value } })
const ring = () => document.querySelector('.jc-open') as HTMLButtonElement
const send = () => fireEvent.click(screen.getByRole('button', { name: /Erfassen|Eintragen/ }))
const menuRow = async (name: RegExp) => {
  fireEvent.click(ring())
  return await screen.findByRole('menuitem', { name })
}

describe('JournalComposer · the ○ switch', () => {
  it('marks the entry as an open Pendenz', async () => {
    const { onSubmit } = setup()
    type('Werkhof stellt Absperrmaterial')
    fireEvent.click(await menuRow(/^Neue Pendenz$/))
    await waitFor(() => expect(ring().dataset.state).toBe('1'))
    send()
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ pendenz: { urgent: false } })
  })

  it('…or as a dringende one', async () => {
    const { onSubmit } = setup()
    type('Absperrung sofort')
    fireEvent.click(await menuRow(/Dringende Pendenz/))
    await waitFor(() => expect(ring().dataset.state).toBe('2'))
    send()
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ pendenz: { urgent: true } })
  })

  // ⚠️ An ordinary entry must stay ordinary. The switch is opt-in, and a draft that carried
  // `pendenz` without anyone choosing it would put a line nobody raised onto the Rapport.
  it('leaves an untouched entry with no lifecycle at all', () => {
    const { onSubmit } = setup()
    type('Lüfter im EG gestellt')
    send()
    const d = onSubmit.mock.calls[0][0]
    expect(d.pendenz).toBeUndefined()
    expect(d.noteFor).toBeUndefined()
  })

  it('hangs the entry on an open item instead', async () => {
    const { onLinkPendenz } = setup()
    type('Fahrzeug unterwegs')
    fireEvent.click(await menuRow(/Absperrmaterial Kreuzung/))
    expect(onLinkPendenz).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }))
  })

  // 05.10.2026: two open items the sentence names EQUALLY well went to the tie-break on their
  // creation time — which the workspace never handed over. The composer threw on render
  // («reading 'localeCompare'») mid-sentence, on a busy Einsatz with several Pendenzen.
  it('offers two equally named items without crashing', async () => {
    // the shape the workspace hands over (IncidentWorkspace · openPendenzen)
    setup({ openPendenzen: [
      { id: 'w1', text: 'Werkhof Lüfter holen', createdAt: '2026-06-24T03:10:00.000Z' },
      { id: 'w2', text: 'Werkhof Leiter holen', createdAt: '2026-06-24T03:00:00.000Z' },
    ] })
    type('Werkhof meldet')
    await menuRow(/Werkhof Leiter holen/)
    expect(screen.getByRole('menuitem', { name: /Werkhof Lüfter holen/ })).toBeTruthy()
  })
})

// The Verlauf is a Funkprotokoll — «wer sagt was zu wem» is the shape of nearly every line in it,
// and today everyone writes that relation differently («meldet», «an», «:», nothing).
describe('JournalComposer · the arrow', () => {
  const VOCAB = [
    { name: 'EL', kind: 'person' as const, word: true },
    { name: 'Sanität', kind: 'partner' as const },
  ]
  const field = () => screen.getByRole('textbox') as HTMLTextAreaElement
  const arrow = () => screen.queryByRole('button', { name: /Pfeil einsetzen – wer an wen/ })
  const back = () => screen.queryByRole('button', { name: /Pfeil einsetzen – wer von wem/ })

  it('is offered once the sentence has named somebody, and writes the character', () => {
    setup({ vocab: VOCAB })
    type('EL')
    fireEvent.click(arrow()!)
    expect(field().value).toBe('EL → ')
  })

  // ⚠️ A Funkprotokoll has both directions, and rewriting «Sanität meldet an EL» as an outgoing
  // order means reversing the sentence that was just heard.
  it('offers the incoming direction too', () => {
    setup({ vocab: VOCAB })
    type('EL')
    fireEvent.click(back()!)
    expect(field().value).toBe('EL ← ')
  })

  it('is not offered before a name, nor twice in a row', () => {
    setup({ vocab: VOCAB })
    type('Rückmeldung')
    expect(arrow()).toBeNull()
    type('EL → ')
    expect(arrow()).toBeNull()
    type('EL ← ')
    expect(arrow()).toBeNull()
  })

  // ⚠️ The space after the name still counts — nobody writes a name and then stops mid-air.
  it('keeps the Tab arrow shortcut to one step, then allows focus navigation', async () => {
    setup({ vocab: VOCAB })
    type('EL ')
    expect(fireEvent.keyDown(field(), { key: 'Tab' })).toBe(false)
    expect(field().value).toBe('EL → ')
    // the field is FOCUSED from the moment it attaches (20.09.2026), as it always was in the app
    // a frame later: the accepted text's caret is placed on the next frame (accept · rAF), and no
    // hand presses Tab twice inside one – so the second press is made where a real one would be
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))) })
    field().setSelectionRange(5, 5); fireEvent.select(field())
    expect(fireEvent.keyDown(field(), { key: 'Tab' })).toBe(true)
    expect(field().value).toBe('EL → ')
  })

  it('stays through the space after the name', () => {
    setup({ vocab: VOCAB })
    type('EL ')
    expect(arrow()).toBeTruthy()
  })

  // …and goes again once the sentence has moved on: the arrow means «and now the other side», so
  // a chip that never leaves is one more thing competing with the Textbausteine for the row.
  it('goes away once other words follow the name', () => {
    setup({ vocab: VOCAB })
    type('EL → San')
    expect(arrow()).toBeNull()
    type('EL → Sanität: Patient stabil')
    expect(arrow()).toBeNull()
    // …and comes back for the term that ends the sentence
    type('EL → Sanität')
    expect(arrow()).toBeTruthy()
  })
})

// ⚠️ NOT a return of the static chip strip that was dropped on 02.07.: these exist only while the
// field is empty, and the row they sit in was standing empty anyway.
describe('JournalComposer · what an empty field offers', () => {
  const VOCAB = [{ name: 'EL', kind: 'person' as const, word: true }]
  const TL = [{ id: 'e1', t: '22:00', at: '2026-08-17T20:00:00.000Z', icon: 'type', text: 'Polizei aufgeboten', kind: 'journal' as const, surface: 'map' as const }]

  it('leads with the post and adds what this Einsatz keeps writing', () => {
    setup({ vocab: VOCAB, timeline: TL })
    const chips = [...document.querySelectorAll('.jc-phrases button')].map((b) => b.textContent)
    expect(chips[0]).toBe('EL →')
    expect(chips).toContain('Polizei aufgeboten')
  })

  it('keeps EL first even before the incident vocabulary arrives', () => {
    setup({ vocab: [], timeline: TL })
    expect(document.querySelector('.jc-phrases button')?.textContent).toBe('EL →')
  })

  // ⚠️ The row STAYS after its own first tap — «EL →» is exactly the moment the second chip becomes
  // useful, and a row that empties itself offers help once and then takes it away.
  it('writes the opener and keeps the row, so the next chip appends to it', () => {
    setup({ vocab: VOCAB, timeline: TL })
    const field = () => screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.click(screen.getByRole('button', { name: 'EL →' }))
    expect(field().value).toBe('EL → ')
    expect(screen.queryByRole('button', { name: 'EL →' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Polizei aufgeboten' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Polizei aufgeboten' }))
    expect(field().value).toBe('EL → Polizei aufgeboten')
  })

  // …and the first keystroke is what hands the row over to the ordinary suggestions
  it('gives way as soon as somebody types, and comes back on an emptied field', () => {
    setup({ vocab: VOCAB, timeline: TL })
    type('Lüfter')
    expect(document.querySelector('.jc-phrase-starter')).toBeNull()
    type('')
    expect(document.querySelector('.jc-phrase-starter')).toBeTruthy()
  })

  // a Meldung is an ordinary entry with a link — same row, same chips
  it('offers them while writing a Meldung too', () => {
    setup({ vocab: VOCAB, timeline: TL, noteOn: { id: 'p1', text: 'Absperrmaterial' } })
    expect(document.querySelector('.jc-phrase-starter')).toBeTruthy()
  })
})

// «Info» is picked from the start (29.09.2026): the Art is one of three, never «none of them» —
// and an entry left on it files exactly what an untouched composer filed before, no entryType.
describe('JournalComposer · the Art', () => {
  const chip = (name: string) => screen.getByRole('button', { name })

  it('starts on «Info», and an untouched entry files without an entryType', () => {
    const { onSubmit } = setup()
    expect(chip('Info').getAttribute('aria-pressed')).toBe('true')
    expect(chip('Auftrag').getAttribute('aria-pressed')).toBe('false')
    type('Lüfter im EG gestellt')
    send()
    const d = onSubmit.mock.calls[0][0]
    expect(d.entryType).toBeUndefined()
    expect(d.text).toBe('Lüfter im EG gestellt')
  })

  it('is one of three: a lit chip stays lit, «Info» is the way back', () => {
    const { onSubmit } = setup()
    fireEvent.click(chip('Auftrag'))
    fireEvent.click(chip('Auftrag'))
    expect(chip('Auftrag').getAttribute('aria-pressed')).toBe('true')
    expect(chip('Info').getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(chip('Info'))
    expect(chip('Info').getAttribute('aria-pressed')).toBe('true')
    type('Strom abgestellt')
    send()
    expect(onSubmit.mock.calls[0][0].entryType).toBeUndefined()
  })
})

// ⚠️ There is no «Eintrag · Erinnerung» mode any more: a due time is a property of ANY entry, so
// «Auftrag erteilt» and «um 22:10 nachfassen» are one row rather than two rows about one thing.
describe('JournalComposer · the clock', () => {
  const clock = () => document.querySelector('.jc-due-btn') as HTMLButtonElement
  const dueRow = async (name: RegExp) => {
    fireEvent.click(clock())
    return await screen.findByRole('menuitem', { name })
  }

  it('gives an ordinary entry a due time — with its Art and its media intact', async () => {
    const { onSubmit } = setup()
    type('Lüfter im Treppenhaus prüfen')
    fireEvent.click(screen.getByRole('button', { name: 'Auftrag' }))
    fireEvent.click(await dueRow(/in 10 min/))
    send()
    const d = onSubmit.mock.calls[0][0]
    expect(d.entryType).toBe('auftrag')
    expect(Date.parse(d.dueAt!)).toBeGreaterThan(Date.now())
  })

  // ⚠️ A Fälligkeit on a line nobody can tick off would fire a banner with no way to answer it,
  // so the clock opens the ring — and closing the ring takes the clock with it.
  it('opens the ring with it, and drops the time when the ring is closed again', async () => {
    const { onSubmit } = setup()
    type('Lüfter prüfen')
    fireEvent.click(await dueRow(/in 30 min/))
    await waitFor(() => expect(ring().dataset.state).toBe('1'))

    fireEvent.click(ring())
    fireEvent.click(await screen.findByRole('menuitem', { name: /Nicht offen halten/ }))
    send()
    const d = onSubmit.mock.calls[0][0]
    expect(d.dueAt).toBeUndefined()
    expect(d.pendenz).toBeUndefined()
  })

  it('leaves an untouched entry without one', () => {
    const { onSubmit } = setup()
    type('Lüfter im EG gestellt')
    send()
    expect(onSubmit.mock.calls[0][0].dueAt).toBeUndefined()
  })

  // «Uhrzeit …» opens THE time picker, the one every other clock in the app uses — not a dialog
  // with a ± stepper of its own (owner, 08.10.2026: «to avoid having another one»).
  it('«Uhrzeit …» opens the shared time picker, titled, with a day and without «Jetzt»', async () => {
    pointer('fine')
    setup()
    type('Lüfter prüfen')
    fireEvent.click(await dueRow(/Uhrzeit/))
    const pop = await screen.findByRole('dialog', { name: 'Erinnern um' })
    expect(pop.className).toContain('wheelpop')
    expect(pop.querySelector('.jc-time')).toBeNull() // the stepper is gone
    // today and the six days after it — never a day that already ended
    const days = within(pop).getByRole('combobox', { name: 'Tag' }) as HTMLSelectElement
    expect(days.options.length).toBe(7)
    // «Jetzt» is never a Wiedervorlage: it would fire the moment it is saved
    expect(within(pop).queryByRole('button', { name: 'Jetzt' })).toBeNull()
  })

  // ⚠️ The day is picked, not inferred. «HH:MM, and if that is already past, tomorrow» was right
  // most of the time and silent the rest — on the one surface where a Wiedervorlage set for the
  // wrong day is a check nobody makes.
  it('carries a day, refuses a moment that has passed, and saves the one that was picked', async () => {
    // ⚠️ The clock is PINNED. The picker opens at now+5 min, so a run at 23:58 opens it on
    // tomorrow and «13:00» lands in the future — the test would pass all day and fail on the
    // night shift, which is when this app is used.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 7, 17, 14, 0, 0))
    pointer('fine')
    const { onSubmit } = setup()
    type('Lüfter prüfen')
    fireEvent.click(await dueRow(/Uhrzeit/))
    const pop = await screen.findByRole('dialog', { name: 'Erinnern um' })
    const ok = () => within(pop).getByRole('button', { name: 'OK' }) as HTMLButtonElement
    const field = within(pop).getByRole('textbox') as HTMLInputElement
    expect(field.value).toBe('14:05')
    expect(pop.textContent).toContain('Heute')
    expect(ok().getAttribute('aria-disabled')).toBe('false')

    // an hour back is today, an hour ago — the picker says so and refuses to save it: «OK» is
    // aria-disabled (UX sweep F2 — a tap on it rings the note instead of closing)…
    fireEvent.change(field, { target: { value: '13:00' } })
    expect(pop.textContent).toContain('Zeitpunkt liegt in der Vergangenheit')
    expect(ok().getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(ok())
    expect(screen.queryByRole('dialog', { name: 'Erinnern um' })).toBeTruthy()
    // …Enter included, which reaches the commit without the button
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(screen.queryByRole('dialog', { name: 'Erinnern um' })).toBeTruthy()

    // …and the next day makes the same clock time a real Wiedervorlage again
    fireEvent.change(within(pop).getByRole('combobox', { name: 'Tag' }), { target: { value: '1' } })
    expect(pop.textContent).toContain('Morgen')
    expect(ok().getAttribute('aria-disabled')).toBe('false')
    fireEvent.click(ok())
    send()
    expect(onSubmit.mock.calls[0][0].dueAt).toBe(new Date(2026, 7, 18, 13, 0).toISOString())
    vi.useRealTimers()
  })

  // the phone: wheels, and the day is a wheel too
  it('takes the day off the day wheel on a phone', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 7, 17, 14, 0, 0))
    pointer('coarse')
    const { onSubmit } = setup()
    type('Lüfter prüfen')
    fireEvent.click(await dueRow(/Uhrzeit/))
    const pop = await screen.findByRole('dialog', { name: 'Erinnern um' })
    const dayWheel = within(pop).getByRole('listbox', { name: 'Tag' })
    fireEvent.click(within(dayWheel).getAllByRole('option')[1]) // tomorrow
    fireEvent.click(within(pop).getByRole('button', { name: 'OK' }))
    send()
    expect(onSubmit.mock.calls[0][0].dueAt).toBe(new Date(2026, 7, 18, 14, 5).toISOString())
    vi.useRealTimers()
  })
})

// An imported memo's «Aufnahme begann» is the same field as every other clock (TimeField) — and
// committing it is the confirmation the hard start gate waits for.
describe('JournalComposer · an imported memo\'s start time', () => {
  it('is set with the shared time field and unlocks «Erfassen»', async () => {
    pointer('fine')
    URL.createObjectURL = URL.createObjectURL ?? (() => 'blob:memo')
    URL.revokeObjectURL = URL.revokeObjectURL ?? (() => {})
    const { onSubmit } = setup({ incidentStartAt: new Date(Date.now() - 3600_000).toISOString(), uploadAudio: vi.fn(async () => ({ url: '/media/memo.m4a' })) })
    const input = document.querySelectorAll('input[type=file]')[1] as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'Memo.m4a', { type: 'audio/mp4' })] } })
    const start = await screen.findByRole('button', { name: 'Aufnahme begann' })
    expect(document.querySelector('.jc-time')).toBeNull()
    const save = () => screen.getByRole('button', { name: /Erfassen|Eintragen/ }) as HTMLButtonElement
    expect(save().disabled).toBe(true) // the gate: not until the start is confirmed

    fireEvent.click(start)
    // the popover (the composer itself is a dialog too, so it is found by its frame)
    const pop = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('.wheelpop')
      if (!el) throw new Error('no time picker')
      return el
    })
    // a recording always started SOME time — no «Leeren»
    expect(within(pop).queryByRole('button', { name: 'Leeren' })).toBeNull()
    const t = new Date(Date.now() - 10 * 60_000)
    const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
    fireEvent.change(within(pop).getByRole('textbox'), { target: { value: hhmm } })
    fireEvent.click(within(pop).getByRole('button', { name: 'OK' }))
    expect(start.textContent).toBe(hhmm)
    await waitFor(() => expect(save().disabled).toBe(false))
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('JournalComposer · writing a Meldung', () => {
  const noteOn = { id: 'p1', text: 'Absperrmaterial Kreuzung, Werkhof Oberwil' }

  it('names what it is and what it is about, and submits as a note', () => {
    const { onSubmit } = setup({ noteOn })
    expect(screen.getByText('Meldung')).toBeTruthy()
    expect(screen.getByText(noteOn.text)).toBeTruthy()
    type('Werkhof meldet: Fahrzeug unterwegs')
    send()
    const d = onSubmit.mock.calls[0][0]
    expect(d.noteFor).toEqual({ id: 'p1' })
    expect(d.pendenz).toBeUndefined()
  })

  // ⚠️ The ring stays, and is the ONE place «what is this line?» is asked — with the SAME rows it
  // offers anywhere else. Realising halfway through a sentence that it is its own thing after all
  // is normal, and it used to take two steps.
  it('keeps the ○ switch, and asks the same question it asks everywhere', async () => {
    const onClearNote = vi.fn()
    const { onLinkPendenz } = setup({ noteOn, onClearNote })
    fireEvent.click(ring())
    expect(await screen.findByRole('menuitem', { name: /Verknüpfung lösen/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /^Neue Pendenz$/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /Dringende Pendenz/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('menuitem', { name: /Patient an Sanität/ }))
    expect(onLinkPendenz).toHaveBeenCalledWith(expect.objectContaining({ id: 'p2' }))
  })

  // ⚠️ …and «Neue Pendenz» UNLINKS on the way. `submit` reads `noteFor` before `pendenz`, so a
  // draft still carrying the link would file the line as a Meldung and drop the choice silently.
  it('turning a Meldung into its own item lets the link go first', async () => {
    const onClearNote = vi.fn()
    setup({ noteOn, onClearNote })
    fireEvent.click(ring())
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Neue Pendenz$/ }))
    expect(onClearNote).toHaveBeenCalled()
  })

  it('…and lets go of the link entirely', async () => {
    const onClearNote = vi.fn()
    setup({ noteOn, onClearNote })
    fireEvent.click(ring())
    fireEvent.click(await screen.findByRole('menuitem', { name: /Verknüpfung lösen/ }))
    expect(onClearNote).toHaveBeenCalled()
  })
})

describe('JournalComposer · the half-written draft', () => {
  const closeX = () => screen.getByRole('button', { name: /schliessen|close/i })

  // ⚠️ This overlay closes on a backdrop press, and on a tablet the sheet is mostly backdrop.
  // ⚠️ …and the WHOLE draft survives, not only the sentence. Keeping `text` alone meant the ring,
  // the Art and the attachments were dropped with nothing said, and the sheet came back looking
  // like an ordinary entry.
  it('hands back the sentence, the Art and the ring after any close', async () => {
    setup()
    type('Halb geschriebener Satz')
    fireEvent.click(screen.getByRole('button', { name: 'Auftrag' }))
    fireEvent.click(await menuRow(/Dringende Pendenz/))
    await waitFor(() => expect(ring().dataset.state).toBe('2'))
    cleanup()

    const { onSubmit } = setup()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Halb geschriebener Satz')
    expect(ring().dataset.state).toBe('2')
    send()
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ entryType: 'auftrag', pendenz: { urgent: true } })
  })

  // ⚠️ The ✕ CLOSES. It used to discard the draft — the one ✕ in the app that destroyed what had
  // been typed, with no confirm and no undo, wearing the same glyph as every other close.
  it('the ✕ closes without throwing the draft away', () => {
    setup()
    type('Halb geschriebener Satz')
    fireEvent.click(closeX())
    cleanup()
    setup()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Halb geschriebener Satz')
  })

  // …and filing the row is what empties it, so the next entry starts on a blank sheet
  it('a sent entry leaves nothing behind', () => {
    setup()
    type('Lüfter im EG gestellt')
    send()
    cleanup()
    setup()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('')
    expect(ring().dataset.state).toBe('0')
  })
})

// ── the sheet gives things up in a decided order ──────────────────────────────────────────
// jsdom has no layout, so the numbers the ladder reads are stood in for. What is tested here is
// the WIRING — that the sheet's own height against the room it has is what flips the class; the
// rule itself is lib/composerFit.
describe('JournalComposer · what gives way when the room runs out', () => {
  const sheetHeight = (px: number) =>
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => px })
  const screenHeight = (px: number) => { window.innerHeight = px }
  /** a keyboard: it takes the VISUAL viewport and leaves `innerHeight` alone, the way iOS does */
  const keyboard = (visible: number) => {
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: { height: visible, addEventListener: vi.fn(), removeEventListener: vi.fn() },
    })
  }
  const original = window.innerHeight
  afterEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, value: 0 })
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined })
    window.innerHeight = original
  })

  it('collapses Art and media into one symbol row rather than scrolling the sheet', async () => {
    sheetHeight(386); screenHeight(340) // the full sheet in what a keyboard leaves of a small screen
    setup()
    await waitFor(() => expect(document.querySelector('.journal-composer')?.className).toContain('is-compact'))
    // …and the words are still what the row is CALLED, whatever it now shows
    expect(screen.getByRole('button', { name: 'Sofortmassnahme' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Foto' })).toBeTruthy()
  })

  // ⚠️ The regression this exists for: on a `pointer: fine` tablet the card was capped against the
  // whole screen while the keyboard ate the bottom of it. Nothing overflowed anything, so a rule
  // that only watched the card's own overflow stayed silent — and the sheet ran under the
  // keyboard until iOS scrolled its top off the screen.
  it('…including when only the VISUAL viewport shrank, which is all a keyboard does', async () => {
    sheetHeight(386); screenHeight(820); keyboard(400)
    setup()
    await waitFor(() => expect(document.querySelector('.journal-composer')?.className).toContain('is-compact'))
  })

  // ⚠️ Rendered the way the APP renders it. Both of the rungs' failures in the field were invisible
  // to a plain render: the measure's «one frame is already pending» guard held a cancelled frame
  // id, and StrictMode's mount → clean up → mount is exactly the sequence that leaves one behind,
  // so the ladder never measured again in the real app while every test here passed.
  it('…and still measures after a StrictMode mount, clean-up and mount again', async () => {
    sheetHeight(386); screenHeight(340)
    render(<StrictMode><JournalComposer onSubmit={vi.fn()} onClose={vi.fn()} /></StrictMode>)
    await waitFor(() => expect(document.querySelector('.journal-composer')?.className).toContain('is-compact'))
  })

  // ⚠️ The rows have to BE the frame's children. They sat inside a `display: contents` wrapper —
  // an element the layout does not give a box, so `.journal-composer > * { flex: none }` addressed
  // the wrapper and nothing else: the predictive band was flex-squeezed to 0 in the real app for
  // as long as that rule has existed, which is «the chips are cut off» as reported.
  it('hangs its rows straight off the card, so a `> *` rule reaches them', () => {
    setup()
    for (const row of ['.jc-mode', '.jc-text-wrap', '.jc-phrases', '.jc-controls', '.jc-foot']) {
      expect(document.querySelector(`.journal-composer > ${row}`)).toBeTruthy()
    }
  })

  // ⚠️ Where the paste handler LIVES is the other half of that: it used to ride on the wrapper,
  // and moving it onto the card was silently a no-op at first — Base UI portals this popup, so an
  // effect that reads the ref once finds nothing to attach to. The sheet then took a pasted photo
  // everywhere except in the sheet.
  it('takes a pasted photo — the handler is on the card itself', async () => {
    const createObjectURL = URL.createObjectURL
    URL.createObjectURL = vi.fn(() => 'blob:pasted')
    try {
      setup()
      const card = document.querySelector('.journal-composer') as HTMLElement
      const ev = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(ev, 'clipboardData', {
        value: { files: [new File(['x'], 'shot.png', { type: 'image/png' })] },
      })
      card.dispatchEvent(ev)
      await waitFor(() => expect(document.querySelector('.jc-photo')).toBeTruthy())
      expect(ev.defaultPrevented).toBe(true)
    } finally {
      URL.createObjectURL = createObjectURL
    }
  })

  // a one-time action's busy state (05.11.2026): while a just-picked picture's position is read,
  // «Erfassen» is taken once and cannot be pressed again – it filed the row twice
  it('files a row with a picture whose position is still being read ONCE', async () => {
    const createObjectURL = URL.createObjectURL
    URL.createObjectURL = vi.fn(() => 'blob:fresh')
    let release = () => {}
    geoWait = new Promise<void>((res) => { release = res })
    try {
      const { onSubmit } = setup()
      const card = document.querySelector('.journal-composer') as HTMLElement
      const ev = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(ev, 'clipboardData', { value: { files: [new File(['x'], 'shot.png', { type: 'image/png' })] } })
      card.dispatchEvent(ev)
      await waitFor(() => expect(document.querySelector('.jc-photo')).toBeTruthy())
      const C = appConfig.copy.journal
      fireEvent.click(screen.getByRole('button', { name: C.send }))
      const busy = screen.getByRole('button', { name: C.photoLocating }) as HTMLButtonElement
      expect(busy.disabled).toBe(true)
      fireEvent.click(busy)
      expect(onSubmit).not.toHaveBeenCalled()
      await act(async () => { release(); await geoWait })
      expect(onSubmit).toHaveBeenCalledTimes(1)
    } finally {
      geoWait = null
      URL.createObjectURL = createObjectURL
    }
  })

  it('leaves the sheet alone while it fits', async () => {
    sheetHeight(386); screenHeight(900)
    setup()
    await waitFor(() => expect(document.querySelector('.jc-controls')).toBeTruthy())
    expect(document.querySelector('.journal-composer')?.className).not.toContain('is-compact')
  })
})

describe('JournalComposer · «Wer» is read off the sentence', () => {
  it('takes the first vocabulary name, with no field asking for one', () => {
    const { onSubmit } = setup({ vocab: [{ name: 'Werkhof Oberwil', kind: 'partner' }] })
    type('Werkhof Oberwil stellt Absperrmaterial')
    send()
    expect(onSubmit.mock.calls[0][0].assignee).toBe('Werkhof Oberwil')
  })
})

// Accepting a chip used to end the offer: the term was written and the band went quiet until the
// next fragment matched something again — so the second half of a line everybody writes twenty
// times a night was typed by hand every time.
describe('JournalComposer · what comes next', () => {
  const VOCAB = [
    { name: 'Meier Anna', kind: 'person' as const },
    { name: 'Sanität', kind: 'partner' as const },
  ]
  const TIMELINE = [
    { id: 'e1', t: '20:10', icon: 'note', text: 'Meier Anna → Sanität: Patient stabil' },
    { id: 'e2', t: '20:20', icon: 'note', text: 'Meier Anna meldet Sanität eingetroffen' },
  ]
  const field = () => screen.getByRole('textbox') as HTMLTextAreaElement
  const chip = (name: string) => screen.queryAllByRole('button', { name })[0]

  it('offers what has stood beside the accepted term, and appends it cleanly', async () => {
    setup({ vocab: VOCAB, timeline: TIMELINE })
    type('Meier')
    fireEvent.click(chip('Meier Anna'))
    expect(field().value).toBe('Meier Anna ')
    await waitFor(() => expect(chip('Sanität')).toBeTruthy())
    fireEvent.click(chip('Sanität'))
    // one space between what stood and what was added, and the caret is left ready to write on
    expect(field().value).toBe('Meier Anna Sanität ')
  })

  // ⚠️ Evidence only: an Einsatz that has written nothing offers nothing, and the band is as
  // quiet as it was before the feature existed.
  it('stays quiet on an Einsatz with no rows yet', () => {
    setup({ vocab: VOCAB, timeline: [] })
    type('Meier Anna ')
    expect(chip('Sanität')).toBeUndefined()
  })

  it('continues after an arrow without losing the person who was just named', () => {
    setup({ vocab: VOCAB, timeline: TIMELINE })
    type('Meier Anna → ')
    fireEvent.click(chip('Sanität'))
    expect(field().value).toBe('Meier Anna → Sanität ')
  })

  it('edits at the selected cursor position and leaves the following sentence intact', async () => {
    setup({ vocab: VOCAB })
    type('Meier meldet Rauch. Sanität unterwegs')
    field().focus()
    field().setSelectionRange(3, 3)
    fireEvent.select(field())
    fireEvent.click(chip('Meier Anna'))
    expect(field().value).toBe('Meier Anna meldet Rauch. Sanität unterwegs')
    await waitFor(() => expect(field().selectionStart).toBe(10))
    expect(document.activeElement).toBe(field())
  })

  it('Tab accepts the same highest-ranked suggestion that touch sees first', () => {
    setup({ vocab: [{ name: 'Unterstützung', kind: 'group' }] })
    type('Brand un')
    expect(document.querySelector('.jc-phrases button')?.textContent).toBe('Brand unter Kontrolle')
    fireEvent.keyDown(field(), { key: 'Tab' })
    expect(field().value).toBe('Brand unter Kontrolle')
  })

  it('leaves Tab navigation available when only starters or continuations are visible', () => {
    setup({ vocab: VOCAB, timeline: TIMELINE })
    expect(fireEvent.keyDown(field(), { key: 'Tab' })).toBe(true)
    expect(field().value).toBe('')
    type('Meier Anna → ')
    expect(chip('Sanität')).toBeTruthy()
    expect(fireEvent.keyDown(field(), { key: 'Tab' })).toBe(true)
    expect(field().value).toBe('Meier Anna → ')
  })
})

// The band never wraps and regularly holds more than it can show, so side-scroll is how the rest
// of it is reached — and the finger doing that lifts on whatever chip it stopped over.
//
// ⚠️ That scroll is the BROWSER's since 18.09.2026 (see `.jc-phrases` in 18-audio.css): the row is
// an ordinary `overflow-x: auto` scroller with `touch-action: pan-x pan-y`, so it has momentum and
// rubber-band, and the compositor — not a pointermove handler — decides when a gesture became a
// pan. Suppressing the release click is the browser's job too, and jsdom implements none of it, so
// what is worth testing here is the CONTRACT that makes native scrolling possible: nothing on this
// row may capture a pointer or prevent a touch default, or the band stops panning at all — which
// is the bug it has already had twice.
describe('JournalComposer · swiping the suggestion band', () => {
  const VOCAB = [{ name: 'Meier Anna', kind: 'person' as const }]
  const field = () => screen.getByRole('textbox') as HTMLTextAreaElement
  const chip = () => screen.queryAllByRole('button', { name: 'Meier Anna' })[0]

  it('a still tap picks the chip', () => {
    setup({ vocab: VOCAB })
    type('Meier')
    fireEvent.pointerDown(chip(), { pointerType: 'touch', pointerId: 1, button: 0, clientX: 100, clientY: 200 })
    fireEvent.pointerMove(chip(), { pointerType: 'touch', pointerId: 1, button: 0, clientX: 102, clientY: 201 })
    fireEvent.click(chip(), { detail: 1 })
    expect(field().value).toBe('Meier Anna ')
  })

  // ⚠️ WebKit builds its pointer events on the touch stream, so a cancelled pointerdown cancels the
  // touch's default and the band stops panning at all. Nothing on the row — and nothing on a chip —
  // may consume the gesture; the only default this surface takes is the MOUSEdown that would move
  // focus out of the text field.
  it('leaves the swipe to the browser: no chip consumes the pointer gesture', () => {
    setup({ vocab: VOCAB })
    type('Meier')
    const c = chip()
    c.setPointerCapture = () => { throw new Error('a chip must never capture the pan') }
    expect(fireEvent.pointerDown(c, { pointerType: 'touch', pointerId: 1, button: 0, clientX: 100, clientY: 200 })).toBe(true)
    expect(fireEvent.pointerMove(c, { pointerType: 'touch', pointerId: 1, button: 0, clientX: 160, clientY: 204 })).toBe(true)
    expect(fireEvent.pointerUp(c, { pointerType: 'touch', pointerId: 1, button: 0, clientX: 160, clientY: 204 })).toBe(true)
    expect(fireEvent.touchMove(c, { touches: [{ clientX: 160, clientY: 204 }] })).toBe(true)
  })

  // …and the row it all hangs on is a scroller, not a hand-driven strip.
  it('is a real horizontal scroller', () => {
    setup({ vocab: VOCAB })
    type('Meier')
    const row = chip().parentElement as HTMLElement
    expect(row.className).toContain('jc-phrases')
  })
})


describe('the mobile composer caret', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('keeps the sentence focused through Pendenz and relative-time picks', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }))
    setup()
    const field = screen.getByRole('textbox')
    fireEvent.change(field, { target: { value: 'EL meldet' } })
    field.focus()
    fireEvent.mouseDown(ring())
    fireEvent.click(ring())
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Neue Pendenz$/ }))
    await waitFor(() => expect(document.activeElement).toBe(field))
    const due = document.querySelector('.jc-due-btn')!
    fireEvent.mouseDown(due)
    fireEvent.click(due)
    fireEvent.click(await screen.findByRole('menuitem', { name: /in 5 min/i }))
    await waitFor(() => expect(document.activeElement).toBe(field))
  })
})
