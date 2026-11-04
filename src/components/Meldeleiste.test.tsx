// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { getMeldeleisteHost, registerMeldeleisteHost } from '../lib/meldeleisteHost'
import { readFileSync } from 'node:fs'
import { Meldeleiste } from './Meldeleiste'
import { useMeldung } from '../lib/useMeldung'
import type { Meldung } from '../lib/meldungen'

// What variant B promises, and nothing else: every pending message is a row of the same kind, in
// rank order, each carrying its own buttons — and the row BODY is inert, which is the complaint
// that started the rework (a tap meant to read a message took an alarm).
//
// Since 23.08. that rule is one notch narrower: the TITLE of a message that has somewhere to go
// is a control (Meldung · onOpen). Everything else in the body — the sub-line, the glyph, the
// space beside them — still does nothing, and these tests pin both halves of that.

/** publishes up to three messages and renders the strip that orders them */
function Host({ items }: { items: (Meldung | null)[] }) {
  useMeldung(items[0] ?? null)
  useMeldung(items[1] ?? null)
  useMeldung(items[2] ?? null)
  return <Meldeleiste />
}

const alarm: Meldung = {
  id: 'alarm:1', kind: 'alarm', tone: 'alarm', icon: 'bell', title: 'Neuer Alarm — Brand',
  actions: [{ label: 'Übernehmen', primary: true, onClick: () => {} }],
  dismiss: { label: 'Ausblenden', onClick: () => {} },
}
const reminder = (actions: Meldung['actions']): Meldung => ({
  id: 'reminder', kind: 'reminder', tone: 'warn', icon: 'bell', title: '1 Erinnerung fällig', actions,
})
const update: Meldung = {
  id: 'update', kind: 'update', tone: 'calm', icon: 'info', title: 'Update bereit',
  actions: [{ label: 'Später', onClick: () => {} }],
}

const rows = () => Array.from(document.querySelectorAll<HTMLElement>('.ml .ml-row'))

afterEach(cleanup)

describe('Meldeleiste', () => {
  // The ✕ column is alignment, not decoration: it exists to make every row's buttons end on one
  // line. With nothing dismissible in the strip there is no line to align to, and holding it open
  // only pads the right edge with 44px of nothing — which is what Bastian saw and asked about.
  it('holds the ✕ column open only when some row has a ✕', () => {
    render(<Host items={[reminder([{ label: 'Erledigt', primary: true, onClick: () => {} }])]} />)
    expect(document.querySelector('.ml .ml-x')).toBeNull()
    cleanup()
    render(<Host items={[alarm, reminder([{ label: 'Erledigt', primary: true, onClick: () => {} }])]} />)
    // the alarm's real ✕, and a held-open column on the row that has none
    expect(document.querySelectorAll('.ml .ml-x')).toHaveLength(2)
    expect(document.querySelectorAll('.ml .ml-x.ghost')).toHaveLength(1)
  })

  it('does not exist while nothing is pending', () => {
    render(<Host items={[]} />)
    expect(document.querySelector('.ml')).toBeNull()
  })

  it('shows every pending message as a row, ranked — nothing is folded away', () => {
    render(<Host items={[update, alarm, reminder([{ label: 'Erledigt', primary: true, onClick: () => {} }])]} />)
    expect(rows().map((r) => r.querySelector('.ml-title')?.textContent))
      .toEqual(['Neuer Alarm — Brand', '1 Erinnerung fällig', 'Update bereit'])
    // one live region for the layer, not one per message
    expect(document.querySelectorAll('[aria-live]')).toHaveLength(1)
  })

  it('carries every row\'s own actions, so the second message is erledigt where it stands', () => {
    const done = vi.fn()
    const snooze = vi.fn()
    render(<Host items={[alarm, reminder([
      { label: 'Erledigt', primary: true, onClick: done },
      { label: '+10 min', onClick: snooze },
    ])]} />)

    const row = screen.getByText('1 Erinnerung fällig').closest('.ml-row')!
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Erledigt' }))
    expect(done).toHaveBeenCalledOnce()
    expect(snooze).not.toHaveBeenCalled()
  })

  it('leaves the row body inert — reading a message can never run it', () => {
    const take = vi.fn()
    render(<Host items={[{
      ...alarm, sub: 'Hauptstrasse 12, Oberwil',
      actions: [{ label: 'Übernehmen', primary: true, onClick: take }],
    }]} />)

    const title = screen.getByText('Neuer Alarm — Brand')
    // a message with nowhere to go has no control in its body at all
    expect(title.closest('button')).toBeNull()
    fireEvent.click(title)
    fireEvent.click(screen.getByText('Hauptstrasse 12, Oberwil'))
    fireEvent.click(rows()[0])
    expect(take).not.toHaveBeenCalled()
  })

  // The narrow version of the same rule, and the reason it is narrow: the words the operator is
  // reading are what they can follow, everything else around them stays dead.
  it('makes the TITLE the way in where the message has one — and only the title', () => {
    const open = vi.fn()
    const take = vi.fn()
    render(<Host items={[{
      ...alarm, sub: 'Hauptstrasse 12, Oberwil',
      actions: [{ label: 'Übernehmen', primary: true, onClick: take }],
      onOpen: { label: 'In Verlauf öffnen', onClick: open },
    }]} />)

    const title = screen.getByText('Neuer Alarm — Brand').closest('button')!
    expect(title).not.toBeNull()
    fireEvent.click(title)
    expect(open).toHaveBeenCalledOnce()

    // the sub-line and the rest of the row are still dead, and no third button appeared
    fireEvent.click(screen.getByText('Hauptstrasse 12, Oberwil'))
    fireEvent.click(rows()[0])
    expect(open).toHaveBeenCalledOnce()
    expect(take).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'In Verlauf öffnen' })).toBeNull()
  })

  // Voice control is spoken against what is on screen, so the accessible name has to contain the
  // visible words (WCAG 2.5.3) — and the visible words alone never say what following them does.
  it('names the title control with both halves: what the message is, and where it leads', () => {
    render(<Host items={[{ ...alarm, onOpen: { label: 'In Verlauf öffnen', onClick: () => {} } }]} />)
    const title = screen.getByRole('button', { name: 'Neuer Alarm — Brand · In Verlauf öffnen' })
    expect(title.title).toBe('In Verlauf öffnen')
  })

  it('holds the ✕ column open on a row that may not be dismissed, so the buttons line up', () => {
    // a due Wiedervorlage is erledigt or verschoben, never waved away — but its row still ends
    // on the same vertical line as the alarm's
    render(<Host items={[alarm, reminder([{ label: 'Erledigt', primary: true, onClick: () => {} }])]} />)
    const [alarmRow, reminderRow] = rows()
    expect(alarmRow.querySelector('button.ml-x')).not.toBeNull()
    expect(reminderRow.querySelector('button.ml-x')).toBeNull()
    expect(reminderRow.querySelector('.ml-x.ghost')).not.toBeNull()
  })
})

/* staging r3: on the Trupp-Tafel two rows sat on the first crew's clock. There the strip folds to
 * its most urgent row plus a COUNT (CSS, 08-toasts · .az-tafel), and publishes its height so the
 * Tafel can stand below it. What is pinned here is the markup that CSS reads. */
describe('the count the Tafel folds the rest into', () => {
  it('is a button naming how many more, that opens them all and closes them again', () => {
    render(<Host items={[alarm, reminder([]), update]} />)
    const more = screen.getByRole('button', { name: '+2 weitere Meldungen' })
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('.ml')!.classList.contains('ml-all')).toBe(false)
    fireEvent.click(more)
    expect(document.querySelector('.ml')!.classList.contains('ml-all')).toBe(true)
    expect(screen.getByRole('button', { name: 'Weniger anzeigen' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('is not there for a single row, and the strip publishes its height while it stands', () => {
    const { unmount } = render(<Host items={[alarm]} />)
    expect(document.querySelector('.ml-more')).toBeNull()
    expect(document.documentElement.style.getPropertyValue('--ml-h')).toMatch(/px$/)
    unmount()
    expect(document.documentElement.style.getPropertyValue('--ml-h')).toBe('')
  })
})

/* staging r4 W1: at 820 an alarm row lay over the Anwesenheit's tabs — a tap on «Zeitplan» landed
 * on «Zum Trupp». Every full page stands BELOW the strip: the shared shell moves down by
 * `--ml-push`, which the strip's own stylesheet derives from its height while it stands. The
 * geometry itself is the browser's; what is pinned here is that no shell rule forgets the push. */
describe('the pages stand below the strip', () => {
  const css = (path: string) => readFileSync(`${process.cwd()}/${path}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  it('every inset of the shared shell includes --ml-push', () => {
    const insets = [...css('src/components/Surface.module.css').matchAll(/:where\(\.shell\)\s*\{([^}]*)\}/g)]
      .map(([, body]) => body).filter((b) => /\binset\s*:/.test(b))
    expect(insets.length).toBeGreaterThanOrEqual(2) // the tablet one and the phone one
    for (const b of insets) expect(b).toContain('var(--ml-push')
  })

  it('the push is derived from the strip\'s measured height, and only while a strip stands', () => {
    const rules = [...css('src/styles/08-toasts.css').matchAll(/([^{}]+)\{([^{}]*--ml-push[^{}]*)\}/g)]
    expect(rules.length).toBeGreaterThanOrEqual(2)
    for (const [, sel, body] of rules) {
      expect(sel).toContain(':root:has(.ml)')
      expect(body).toContain('var(--ml-h')
    }
  })
})

/* p8 (08.10.2026): on a phone, four rows ran the strip under the Eintrag FAB and «Jetzt
 * aktualisieren» lay half under the circle. The strip's foot is THE message lane's baseline
 * (15-mobile · --msg-lane-bottom = the floating row + its gap above the highest bar), never a guess. */
describe('the phone strip ends above the floating row', () => {
  const css = readFileSync(`${process.cwd()}/src/styles/08-toasts.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  it('caps its height at the message lane, so it never reaches the FAB or a bar', () => {
    const phone = css.slice(css.indexOf('@media (--phone)', css.indexOf(':root:has(.as-link-shell) .ml')))
    const rule = /(?:^|[\s}])\.ml\s*\{([^}]*)\}/.exec(phone)?.[1] ?? ''
    // (`--nudge-reserve`: under the Karte home's alarm card while it stands, 31.10.2026)
    expect(rule).toMatch(/top:\s*calc\(72px \+ var\(--nudge-reserve, 0px\) \+ env\(safe-area-inset-top\)\)/)
    expect(rule).toMatch(/max-height:\s*calc\(100dvh - 72px - var\(--nudge-reserve, 0px\) - env\(safe-area-inset-top\) - var\(--msg-lane-bottom\)\)/)
  })
})

/* staging r5 N3: at 820 the alarm row lay over the open Einsatz menu's card — a tap on the card
 * landed on «Zum Trupp». `.app` is position:fixed, so it is its own stacking context, and a strip
 * beside it at App root outranked everything in it, the top bar's menus included. The strip paints
 * INSIDE the open Einsatz's `.app` (lib/meldeleisteHost), where its 54 sits under the top bar's 56. */
describe('the strip paints inside the open Einsatz', () => {
  it('portals into the registered host, and comes back to where it is mounted when the host goes', () => {
    const app = document.createElement('div')
    app.className = 'app'
    document.body.appendChild(app)
    const { container } = render(<Host items={[alarm]} />)
    expect(container.querySelector('.ml')).not.toBeNull() // no Einsatz open: inline
    let release: (() => void) | undefined
    act(() => { release = registerMeldeleisteHost(app) })
    expect(app.querySelector('.ml')).not.toBeNull()
    expect(container.querySelector('.ml')).toBeNull()
    act(() => { release?.() })
    expect(container.querySelector('.ml')).not.toBeNull()
    app.remove()
  })

  it('a cleanup of an element that is no longer the host does not unregister its successor', () => {
    const a = document.createElement('div')
    const b = document.createElement('div')
    const releaseA = registerMeldeleisteHost(a)
    const releaseB = registerMeldeleisteHost(b)
    releaseA?.()
    expect(getMeldeleisteHost()).toBe(b)
    releaseB?.()
    expect(getMeldeleisteHost()).toBeNull()
  })
})
