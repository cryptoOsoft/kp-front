// @vitest-environment jsdom
//
// The phone's three tabs (ReportPreflight · PhoneTab). jsdom applies no stylesheet, so what is
// asserted here is the pair the CSS keys off — `data-phone-tab` on the body and `data-tab` on
// each block — not pixels. That pair IS the mechanism: get it wrong and a section either never
// appears or appears in all three tabs.
import { act, render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

vi.mock('./KrokiFramingPanel', () => ({ KrokiFramingPanel: () => null }))

import { ReportPreflight, requestReportStep } from './ReportPreflight'

// The Rapport asks whether it is on a phone (useIsPhone → matchMedia) to decide whether the
// Kroki map may be mounted; jsdom implements no matchMedia. Pinned to «not a phone», which is
// the surface these tests are about.
beforeAll(() => {
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})


afterEach(cleanup)

const START = new Date(2026, 7, 14, 19, 42)
const INCIDENT = {
  id: 'i1', title: 'Brand Gebäude', address: 'Musterstrasse 3',
  started_at: START.toISOString(), closed_at: null,
} as unknown as React.ComponentProps<typeof ReportPreflight>['incident']

function setup() {
  const r = render(
    <ReportPreflight
      incident={INCIDENT}
      reportMeta={{ alarmiertAt: START.toISOString() }}
      events={[]}
      annotatedPlanCount={0} truppCount={0} attendanceCount={0} mittelCount={0}
      mapContentCount={0}
      onSaveMeta={vi.fn()}
    />,
  )
  return { ...r, body: () => document.querySelector('.report-preflight-body') as HTMLElement }
}

const tabOf = (step: string) =>
  document.querySelector(`[data-step="${step}"]`)?.closest('[data-tab]')?.getAttribute('data-tab')

const isChecked = (el: HTMLElement) => el.getAttribute('aria-checked') === 'true'

describe('Einsatzrapport · phone tabs', () => {
  it('opens on «Bericht»', () => {
    const { body } = setup()
    expect(body().dataset.phoneTab).toBe('bericht')
  })

  it('files every Mindestangabe in exactly one tab', () => {
    setup()
    // the form half…
    expect(tabOf('kurzbericht')).toBe('bericht')
    expect(tabOf('einsatzleiter')).toBe('bericht')
    expect(tabOf('kontaktperson')).toBe('bericht')
    expect(tabOf('zeiten')).toBe('bericht')
    expect(tabOf('rueckmeldung')).toBe('bericht')
    // …and the round-up that gets read out at the Appell
    expect(tabOf('anwesenheit')).toBe('werwas')
    expect(tabOf('mittel')).toBe('werwas')
  })

  it('switches when a tab is picked', () => {
    const { body } = setup()
    fireEvent.click(screen.getByRole('button', { name: /Personal & Mittel/ }))
    expect(body().dataset.phoneTab).toBe('werwas')
  })

  // ⚠️ The Kontrolle chip's «Noch offen» rows name what is still missing and jump to the field.
  // On a phone that field may sit in a tab that is not on screen — and a jump that scrolls to a
  // `display: none` element lands nowhere at all, silently. So the row has to change tabs first.
  it('a «Noch offen» row carries the tab with it', async () => {
    const { body } = setup()
    fireEvent.click(screen.getByRole('button', { name: /\d+ offen/ }))
    const list = await waitFor(() => {
      const el = document.querySelector('.rp-control-open') as HTMLElement | null
      if (!el) throw new Error('popover not open')
      return el
    })
    expect(within(list).getByText('Noch offen')).toBeTruthy()
    fireEvent.click(within(list).getByRole('button', { name: /Anwesenheit/ }))
    await waitFor(() => expect(body().dataset.phoneTab).toBe('werwas'))
  })

  // …and the separate 18px chips under the title are gone at every width (23.09.2026)
  it('draws no «noch offen» chips under the title — the one chip counts them', () => {
    setup()
    expect(document.querySelector('.rp-head-open-go')).toBeNull()
    expect(screen.getByRole('button', { name: /^\d+ offen$/ })).toBeTruthy()
  })

  // ── the strip moved to the FOOT of the page on phones (19.09.2026) ──
  // It is the same element and the same <Segmented> it always was; only 15-mobile.css changed,
  // and jsdom applies no stylesheet. What IS testable — and what the dock depends on — is that
  // the strip is a sibling of the scrolling body rather than a block inside it: a strip that
  // scrolled with the page could not be pinned above the nav bar at all.
  it('keeps the strip out of the scrolling body, so it can be docked', () => {
    const { body } = setup()
    const tabs = document.querySelector('.rp-tabs') as HTMLElement
    expect(tabs).toBeTruthy()
    expect(body().contains(tabs)).toBe(false)
    expect(tabs.parentElement).toBe(body().parentElement)
  })

  // ⚠️ …and the jump from OUTSIDE the surface (the Abschluss confirm's rows, the Einsatz-Menü —
  // see requestReportStep) still has to change tab before it scrolls. With the strip at the foot
  // it is the same two beats it always was, and this is the path that queues while the surface
  // is not even mounted.
  it('an outside «zeig mir diesen Punkt» ask still carries the tab with it', async () => {
    requestReportStep('anwesenheit')       // queued: nothing is mounted yet
    const { body } = setup()
    await waitFor(() => expect(body().dataset.phoneTab).toBe('werwas'))
    // …and again with the surface standing, through the live listener
    act(() => requestReportStep('kurzbericht'))
    await waitFor(() => expect(body().dataset.phoneTab).toBe('bericht'))
  })

  // ⚠️ iOS Safari reveals a focused field itself, `preventScroll` or not: focused while the sheet
  // was still scrolling, the Kurzbericht landed with its label hidden under the head (11.11.2026).
  // So the field takes focus only once the sheet's scroll has settled.
  /** the Kurzbericht 600px down a sheet that can scroll 1400px; `scrollTo` recorded, not run */
  const jumpSetup = () => {
    const { body } = setup()
    const step = document.querySelector('[data-step="kurzbericht"]') as HTMLElement
    vi.spyOn(step, 'getBoundingClientRect').mockReturnValue({ top: 600 } as DOMRect)
    Object.defineProperty(body(), 'scrollHeight', { value: 2000 })
    Object.defineProperty(body(), 'clientHeight', { value: 600 })
    const scrollTo = vi.fn()
    body().scrollTo = scrollTo as unknown as HTMLElement['scrollTo']
    return { body: body(), scrollTo, field: step.querySelector('textarea') as HTMLTextAreaElement }
  }
  it('focuses the named field only after the jump has finished scrolling', async () => {
    const { body, scrollTo, field } = jumpSetup()
    act(() => requestReportStep('kurzbericht'))
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 588 })))
    expect(document.activeElement).not.toBe(field)
    act(() => { body.dispatchEvent(new Event('scrollend')) })
    expect(document.activeElement).toBe(field)
  })
  // …and a tap of the operator's own while it scrolls wins: a late focus would take their typing
  it('drops the pending focus when the operator taps something else first', async () => {
    const { body, scrollTo, field } = jumpSetup()
    act(() => requestReportStep('kurzbericht'))
    await waitFor(() => expect(scrollTo).toHaveBeenCalled())
    act(() => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })) })
    act(() => { body.dispatchEvent(new Event('scrollend')) })
    expect(document.activeElement).not.toBe(field)
  })

  // ⚠️ The same box carries WHAT WILL PRINT. The surface unmounts on every hop to
  // Anwesenheit/Mittel/Verlauf — the documented working loop — and the print-section toggles
  // used to be plain state: switch «Einsatzjournal» off, step away to fix a name, come back and
  // the journal is silently back in the PDF, with the answer buried in the ▾ menu.
  // Its own incident id, so the box this writes cannot seed the tests above.
  it('keeps a print section switched off across the hop to another surface', () => {
    const incident = { ...(INCIDENT as object), id: 'i-print' } as typeof INCIDENT
    const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Weitere Druckoptionen' }))
    const journal = () => screen.getByRole('menuitemcheckbox', { name: 'Einsatzjournal' })

    const first = render(
      <ReportPreflight
        incident={incident} reportMeta={{ alarmiertAt: START.toISOString() }} events={[]}
        annotatedPlanCount={0} truppCount={0} attendanceCount={0} mittelCount={0}
        mapContentCount={0} onSaveMeta={vi.fn()}
      />,
    )
    openMenu()
    expect(isChecked(journal())).toBe(true)
    fireEvent.click(journal())
    expect(isChecked(journal())).toBe(false)
    first.unmount()

    render(
      <ReportPreflight
        incident={incident} reportMeta={{ alarmiertAt: START.toISOString() }} events={[]}
        annotatedPlanCount={0} truppCount={0} attendanceCount={0} mittelCount={0}
        mapContentCount={0} onSaveMeta={vi.fn()}
      />,
    )
    openMenu()
    expect(isChecked(journal())).toBe(false)
  })

  // After «Einsatz abschliessen» the kept place is forgotten – and the surface unmounting
  // afterwards must not write it back, or reopening the completed rapport lands on the old
  // tab with the old print choices.
  it('reopens fresh after the Abschluss, even though the surface unmounts after it', async () => {
    const incident = { ...(INCIDENT as object), id: 'i-done' } as typeof INCIDENT
    const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Weitere Druckoptionen' }))
    const journal = () => screen.getByRole('menuitemcheckbox', { name: 'Einsatzjournal' })
    const sheet = (onComplete?: () => Promise<boolean>) => (
      <ReportPreflight
        incident={incident} reportMeta={{ alarmiertAt: START.toISOString() }} events={[]}
        annotatedPlanCount={0} truppCount={0} attendanceCount={0} mittelCount={0}
        mapContentCount={0} onSaveMeta={vi.fn()} onComplete={onComplete}
      />
    )

    const onComplete = vi.fn(async () => true)
    const first = render(sheet(onComplete))
    fireEvent.click(screen.getByRole('button', { name: /Personal & Mittel/ }))
    openMenu()
    fireEvent.click(journal())
    fireEvent.click(screen.getAllByRole('button', { name: 'Einsatz abschliessen' })[0])
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    await act(async () => {})
    first.unmount()

    const second = render(sheet())
    expect((second.container.querySelector('.report-preflight-body') as HTMLElement).dataset.phoneTab).toBe('bericht')
    openMenu()
    expect(isChecked(journal())).toBe(true)
  })
})


// ── the head→first-card distance, which has to be the same on all three tabs ──────────────
//
// jsdom measures nothing, so this reads the REAL rules out of 13-incident.css (every rule keyed
// on `[data-phone-tab]` that hides — `display: none`) and asks the DOM which of them match.
// That is the whole mechanism: a block is off screen iff one of those selectors matches it or an
// ancestor. What is then asserted is structural and is exactly what the gap bug was —
//
//   the body is a flex column with `gap: 12px`, and a wrapper WITHOUT `data-tab` whose every
//   child belongs to another tab is not absent, it is a zero-height flex item that still pays
//   the gap. The `.rp-col-form` column did that on «Personal & Mittel» and on «Beilagen», so
//   their first card sat one 12px gap lower than «Bericht»'s.
//
// So: on each tab the FIRST child of the body that is not hidden must be the column the tab's
// content lives in, and nothing empty may stand between the top of the body and the first card.
const phoneTabCss = (() => {
  // …from the repo root: under jsdom `import.meta.url` is an http URL, not a file one
  const css = readFileSync(`${process.cwd()}/src/styles/13-incident.css`, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  const out: string[] = []
  for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!sel.includes('[data-phone-tab')) continue
    // every one of them hides — except the one that only drops the hairline over a tab's first
    // section (one surface, 30.09.2026), which must never touch `display`. Anything else keyed
    // on the tab means this test has to be re-read.
    const flat = body.replace(/\s/g, '')
    if (flat === 'border-top:0;padding-top:0;') continue
    expect(flat).toBe('display:none;')
    out.push(...sel.split(',').map((s) => s.trim()).filter(Boolean))
  }
  return out
})()

/** the selectors that drop the hairline over a section (one surface, 30.09.2026): the page's
 *  first (the one-column rule) and each tab's first (the phone rules) */
const noLineCss = (() => {
  const css = readFileSync(`${process.cwd()}/src/styles/13-incident.css`, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  const out: string[] = []
  for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (body.replace(/\s/g, '') !== 'border-top:0;padding-top:0;') continue
    // split on the commas BETWEEN selectors only — `:not(a, b)` carries its own
    let depth = 0, cur = ''
    for (const ch of sel) {
      if (ch === '(') depth++
      if (ch === ')') depth--
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = '' } else cur += ch
    }
    out.push(cur.trim())
  }
  return out.filter(Boolean)
})()

/** off screen because one of the tab rules matches it, or matches something it sits in */
const offScreen = (el: Element): boolean => {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (n.classList.contains('report-preflight-body')) break
    if (phoneTabCss.some((sel) => n!.matches(sel))) return true
  }
  return false
}

/** leaves that are something to look at even with no text of their own */
const DRAWN = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'IMG', 'SVG', 'CANVAS', 'HR'])

/** does this box put ANYTHING on screen — or is it an empty wrapper paying a gap for nothing? */
const shows = (el: Element): boolean => {
  if (offScreen(el)) return false
  const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '')
  if (ownText || DRAWN.has(el.tagName)) return true
  return [...el.children].some(shows)
}

/** the boxes from the top of the body down to the first card, in order */
function pathToFirstCard(body: HTMLElement): Element[] {
  const path: Element[] = []
  let level = [...body.children]
  for (;;) {
    const first = level.find(shows)
    if (!first) return path
    path.push(first)
    // wrappers only: stop at the card itself, which is what we came for
    if (first.classList.contains('rp-col')) { level = [...first.children]; continue }
    if (first.tagName === 'FIELDSET' && first.classList.contains('report-fieldset')) { level = [...first.children]; continue }
    if (first.classList.contains('rp-checks')) { level = [...first.children]; continue }
    return path
  }
}

describe('Einsatzrapport · phone tabs · the first card sits at the same height on all three', () => {
  const pick = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }))

  it.each([
    ['bericht', /Bericht/, '.rp-col-form', '.report-pre-meta'],
    ['werwas', /Personal & Mittel/, '.rp-col-side', '.rp-check[data-step="anwesenheit"]'],
    ['beilagen', /Beilagen/, '.rp-col-side', '.rp-check[data-tab="beilagen"]'],
  ])('opens %s on its own first card, with no empty wrapper above it', (tab, name, col, card) => {
    const { body } = setup()
    pick(name)
    expect(body().dataset.phoneTab).toBe(tab)

    // 1. every child of the body before the first one that shows something is really OFF —
    //    hidden by a rule, not merely emptied by one (that is the bug: an emptied box still
    //    pays the column's 12px gap, so the card below it starts 12px lower)
    const kids = [...body().children]
    const firstShown = kids.findIndex(shows)
    expect(firstShown).toBeGreaterThanOrEqual(0)
    for (const before of kids.slice(0, firstShown)) expect(offScreen(before)).toBe(true)

    // 2. …and the same holds all the way down to the card: the path is wrappers that carry it
    const path = pathToFirstCard(body())
    expect(path[0]).toBe(kids[firstShown])
    expect(path[0].matches(col)).toBe(true)
    expect(path[path.length - 1].matches(card)).toBe(true)
    for (const box of path) {
      const sibs = [...box.parentElement!.children]
      for (const before of sibs.slice(0, sibs.indexOf(box))) expect(offScreen(before)).toBe(true)
    }
  })

  // ONE surface (30.09.2026): the sections sit on the page, a hairline over each — except the
  // first one of the tab, right under the head's own edge. Exactly one section per tab drops it.
  it.each([
    ['bericht', /Bericht/, '.report-pre-meta'],
    ['werwas', /Personal & Mittel/, '.rp-check[data-step="anwesenheit"]'],
    ['beilagen', /Beilagen/, '.rp-check[data-tab="beilagen"]'],
  ])('draws no hairline over the first section of %s, and one over every other', (tab, name, first) => {
    const { body } = setup()
    pick(name)
    expect(body().dataset.phoneTab).toBe(tab)
    const sections = [...body().querySelectorAll('.report-pre-section, .rp-check')].filter((el) => !offScreen(el))
    const bare = sections.filter((el) => noLineCss.some((sel) => el.matches(sel)))
    expect(bare).toHaveLength(1)
    expect(bare[0]).toBe(sections[0])
    expect(bare[0].matches(first)).toBe(true)
  })

  // The three paths are different lengths (a column, a fieldset and four sections on «Bericht»;
  // a column, the checklist and its rows on the other two) — what has to match is the number of
  // 12px gaps paid above the first card, and that is zero on every tab.
  it('pays no gap for a wrapper that holds nothing for the tab on screen', () => {
    const { body } = setup()
    for (const [name, tab] of [[/Bericht/, 'bericht'], [/Personal & Mittel/, 'werwas'], [/Beilagen/, 'beilagen']] as const) {
      pick(name)
      expect(body().dataset.phoneTab).toBe(tab)
      const empties: string[] = []
      for (const box of body().querySelectorAll('.rp-col, .report-fieldset, .rp-checks')) {
        if (!offScreen(box) && !shows(box)) empties.push(box.className)
      }
      expect(empties).toEqual([])
    }
  })
})
