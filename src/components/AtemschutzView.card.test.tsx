// @vitest-environment jsdom
// The card and the phone row: the Druckmeldung, the contact clock and the Verlauf, the tier a
// row says, the lifecycle row, the frozen board of a closed Einsatz, pointing to a Trupp.
// Shared setup: AtemschutzView.setup.tsx.
//
// The 29.08. card rework, as it stands after the same-day revision: the contact clock folds
// its timing rows and the Verlauf footer previews the latest event and expands the log — both
// OPEN-ONLY (showing never logs, never counts as Kontakt). The Druck stepper is back inline
// (a Druckmeldung must never cost an opening tap); its ± only stages a pending value and the
// explicit «Bestätigen» commits.
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { AtemschutzView } from './AtemschutzView'
import { useIsPhone } from '../lib/useIsPhone'
import s from './Atemschutz.module.css'
import { registerAtemschutzViewHooks, az, druckName, dz, iso, aktivTrupp, propsFor, mount } from './AtemschutzView.setup'
import type { Trupp } from '../types'

vi.mock('../lib/useIsPhone', async (original) => ({ ...await original<typeof import('../lib/useIsPhone')>(), useIsPhone: vi.fn(() => false) }))
registerAtemschutzViewHooks()

/* The tablet's inline ± stepper with its own «Bestätigen» is GONE (29.09.2026): every board's
 * Druck is the pressure tile, and the tile opens the ONE picker — a tap on a number saves. */
describe('the Druckmeldung on the tablet card', () => {
  it('opens the pressure picker from the tile, and a tap on a number saves it', () => {
    const props = mount()
    expect(document.querySelector(`.${s.stepBtn}`)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: `${az.actPressure} 240 bar` }))
    expect(props.recordPressure).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '200' }))
    expect(props.recordPressure).toHaveBeenCalledWith('tr1', 200)
  })
})

/* The timing rows used to hide behind a tap on the clock itself — an affordance findable only by
 * knowing that five grey characters at the band's edge meant «tap me». They are the head of the
 * Verlauf now, behind a word, and the band went back to being a display. */
describe('the contact times (the head of the Verlauf)', () => {
  it('folds the timing rows out of the Verlauf — and the band is no longer a control', () => {
    const props = mount()
    expect(screen.queryByRole('button', { name: new RegExp(az.clockOk) })).toBeNull()
    expect(screen.queryByText(az.lastContactAt)).toBeNull() // collapsed by default
    const row = screen.getByRole('button', { name: new RegExp(az.verlauf) })
    fireEvent.click(row)
    expect(screen.getByText(az.lastContactAt)).toBeTruthy()
    expect(screen.getByText(az.nextContactDue)).toBeTruthy()
    expect(props.recordContact).not.toHaveBeenCalled()
    fireEvent.click(row)
    expect(screen.queryByText(az.lastContactAt)).toBeNull()
  })

  // …but NOT on the Link-Tafel (08.09., field ask): the phone at the Eingang works off the
  // ticking clock on the card, and the Verlauf there is the ABLESUNGEN, nothing else.
  it('keeps the Link-Tafel’s Verlauf to the Ablesungen — no Letzter/Nächster rows', () => {
    mount({ lite: { subtitle: 'Brand' } })
    fireEvent.click(screen.getByRole('button', { name: new RegExp(az.verlauf) }))
    expect(screen.queryByText(az.lastContactAt)).toBeNull()
    expect(screen.queryByText(az.nextContactDue)).toBeNull()
    // …and the Ablesungen ARE there — the list itself, which since 09.09. carries no title of
    // its own (it holds one list and every row of it is a time and a bar)
    expect(document.querySelector(`.${s.logList}`)?.children.length).toBeGreaterThan(0)
  })

  /* ── The Sockel folds in here too (09.09., maintainer pick — mock 02 with Bastian's variant) ─
   * The card carried a standing strip of look-up rows between the actions and this expander —
   * Einsatzzeit, Geschätzter Druck with its provenance line, Druck, Tiefster — ~70px permanently
   * on a card that did not fit a 375×667 phone. It folds into the expander it was sitting on
   * top of, and exactly two numbers stay out on ONE line: the Einsatzzeit and the Schätzung.
   * ⚠️ The Schätzung staying visible is the safety half of this trade and is asserted first.
   */
  describe('the Sockel, folded into the same expander', () => {
    it('leaves the Einsatzzeit and the Schätzung standing on one line', () => {
      mount()
      const line = document.querySelector(`.${s.metaLine}`)!
      // the Einsatzzeit as a duration that says so («30:00 min») — terse, no «Einsatzzeit» word
      expect(line.textContent).toMatch(/\d+:\d{2} min/)
      // the short form of «Geschätzter Druck» — see copy/de/atemschutz.ts · estimatedShort. ⚠️ It KEEPS its word
      // on the terse line (owner 29.09.2026: «the schätzung clearly visible»)
      expect(line.textContent).toContain(az.estimatedShort)
      expect(line.textContent).toMatch(/≈ \d+ bar/)
    })

    it('puts the provenance and the tiefster Druck behind the tap, not on the card', () => {
      // ⚠️ the «Tiefster» row exists only while the crew is ABOVE its own low-water mark — a
      // fresh bottle after «Wieder in den Einsatz», which is the case it was written for
      // ⚠️ the card reads these off the RECORD (lib/atemschutz · deriveTruppLive), not off the
      // readings array — a fixture that only lists readings has no low-water mark at all
      mount({ trupps: [{ ...aktivTrupp(), lowestBar: 200, lastPressureBar: 260, readings: [
        { t: iso(30 * 60_000), bar: 300, kind: 'entry' as const },
        { t: iso(12 * 60_000), bar: 200, kind: 'pressure' as const },
        { t: iso(4 * 60_000), bar: 260, kind: 'pressure' as const },
      ] }] })
      expect(screen.queryByText(az.lowestPressure)).toBeNull()
      expect(screen.queryByText(/Druckwerten|angenommen/)).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: new RegExp(az.verlauf) }))
      expect(screen.getByText(/Druckwerten|angenommen/)).toBeTruthy()
      expect(screen.getByText(az.lowestPressure)).toBeTruthy()
    })

    /* ⚠️ …and the opened panel says the Schätzung's NUMBER nowhere (09.09., field review: «rather
     * messy»). It used to print «Geschätzter Druck ≈ 31 bar» ~80px under the «≈ 31 bar» that is
     * already standing on the line above — a number said twice at one moment is a number somebody
     * will one day read as two. The panel carries only where the number comes FROM. */
    it('never states the Schätzung twice — the panel carries its provenance, not its number', () => {
      mount()
      fireEvent.click(screen.getByRole('button', { name: new RegExp(az.verlauf) }))
      const bars = screen.queryAllByText(/≈ \d+ bar/)
      expect(bars).toHaveLength(1)
      expect(bars[0].closest(`.${s.metaLine}`)).toBeTruthy()
      // the panel's own row is labelled and explains, in the footnote voice, never in mono
      expect(screen.getByText(/Druckwerten|angenommen/).className).toContain(s.zoneNote)
    })

    /* The «zuletzt: 16:48 Druck 270 bar» preview is GONE on every board (26.09.2026 on the phone,
     * the tablet 29.09.2026 — T2): its bar was the pressure tile's number a second time, and its
     * content is the Verlauf's first row anyway. The line is values only, and it is the toggle. */
    it('carries no «zuletzt» preview — the line is the toggle', () => {
      mount()
      const row = screen.getByRole('button', { name: new RegExp(az.verlauf) })
      expect(row.textContent).not.toMatch(/zuletzt/)
      expect(row.textContent).not.toContain('240 bar')
      fireEvent.click(row)
      expect(document.querySelector(`.${s.logList}`)).toBeTruthy()
    })

    // …and the one line never goes with it: closing the Verlauf must not take the two numbers
    // that were the whole point of keeping a line at all.
    it('keeps the line while the Verlauf opens and closes', () => {
      mount()
      const row = screen.getByRole('button', { name: new RegExp(az.verlauf) })
      const text = () => document.querySelector(`.${s.metaLine}`)?.textContent ?? ''
      expect(text()).toContain(az.estimatedShort)
      fireEvent.click(row)
      expect(text()).toContain(az.estimatedShort)
      fireEvent.click(row)
      expect(text()).toContain(az.estimatedShort)
    })

    /* The ONE value that is allowed to join the line, and only where nothing else shows it: a
     * viewer has no pressure tile, so «240 bar» would otherwise be a tap away on the surface a
     * life depends on. With the tile live, the number is already on it and the line must not say
     * it twice. */
    it('adds the aktueller Druck for a viewer, and never beside the live pressure tile', () => {
      mount({ canEdit: false })
      expect(document.querySelector(`.${s.metaLine}`)!.textContent).toContain('240 bar')
      cleanup()
      mount({ canEdit: true })
      const line = document.querySelector(`.${s.metaLine}`)!.textContent!
      expect(line).not.toMatch(/(^|[^≈] )240 bar/)
      expect(line).toContain(az.estimatedShort)
    })
  })
})

/* The three things the card says about a STATE rather than a tier. Each of them was reachable
 * only in code for a while after the card redesign — the band's tier ladder had swallowed the
 * lifecycle word — and each is a fact a viewer, who has no action bar to read it off, would
 * otherwise get from a 5px border colour alone. */
describe('the state a tier cannot say', () => {
  it('names «Rückzug» as an icon-only amber badge in the head, where the calm clock says nothing about it', () => {
    mount({ trupps: [{ ...aktivTrupp(), status: 'rueckzug' }], canEdit: false })
    expect(screen.queryByText(az.clockOk)).toBeNull()                    // «Kontakt ok» is the green's
    const badge = screen.getByRole('img', { name: az.status.rueckzug })  // …the state is a badge with a name…
    expect(badge.className).toContain(s.rueckzugBadge)
    expect(badge.getAttribute('title')).toBe(az.status.rueckzug)
    expect(badge.textContent).toBe('')                                  // …and no word
    expect(screen.queryByText(az.status.rueckzug)).toBeNull()            // the old text chip is gone
  })

  // PR #530 review: overdue overlays the DERIVED status to «überfällig» – the crew is still on its
  // way out, so the badge (and the row's spoken name) follow the recorded status
  it('keeps the Rückzug badge and names it on the row when the crew on Rückzug is overdue', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.mocked(useIsPhone).mockReturnValue(true)   // the collapsed row is the phone's
      mount({ trupps: [{ ...aktivTrupp(), status: 'rueckzug', lastContactTime: iso(8 * 60_000) }], canEdit: false })
      expect(screen.getByRole('img', { name: az.status.rueckzug })).toBeTruthy()
      expect(document.querySelector(`button.${s.trow}`)!.getAttribute('aria-label')).toContain(az.status.rueckzug)
    } finally { vi.useRealTimers(); vi.mocked(useIsPhone).mockReturnValue(false) }
  })

  it('draws no Rückzug badge on a Trupp that is not in Rückzug', () => {
    mount({ trupps: [aktivTrupp()], canEdit: false })
    expect(screen.queryByRole('img', { name: az.status.rueckzug })).toBeNull()
  })

  /* WHICH time an out card carries depends on whether anybody was ever monitoring it (settled
   * 05.09. evening). An Atemschutz-Trupp that came out of something keeps the BREAK CLOCK: it
   * cannot go back in until it has rested and re-equipped, so «wie lange ist der schon draussen»
   * is the next question about it. No tier and no contact word though — nobody is watching it.
   * And no «Draussen seit» under the word (22.09.): the band read «DRAUSSEN / Draussen seit». */
  it('gives an Atemschutz-Trupp that is out its break clock, and no tier', () => {
    mount({ trupps: [{ ...aktivTrupp(), status: 'raus', exitTime: iso(5 * 60_000) }] })
    // no «Draussen» line on the card (owner, 29.09.2026): the grey card with «Wieder in den Einsatz» says it
    expect(document.querySelector(`.${s.stateLine}`)).toBeNull()
    // «Draussen seit» is the ROW's caption track only — on a card it stays hidden (`.trowHead .trowSub`)
    expect(screen.getByText(az.outFor).closest(`.${s.trowHead}`)).toBeTruthy()
    expect(screen.queryByText(az.clockOk)).toBeNull()
    const clock = document.querySelector(`.${s.trowClockVal}`)!
    expect(clock.textContent).toMatch(/^0?5:00$/)
  })

  /* The break clock is a LONG duration read as one, so past the hour it rolls the way the
   * plinth's Einsatzzeit already does — a Trupp long out read «343:17» on its card while the
   * focus strip below said «5:43:17» (field shot 11.09.). */
  it('rolls a long break clock into hours — 5:43:17, never 343:17', () => {
    mount({ trupps: [{ ...aktivTrupp(), status: 'raus', exitTime: iso(343 * 60_000 + 17_000) }] })
    const clock = document.querySelector(`.${s.trowClockVal}`)!
    expect(clock.textContent).toMatch(/^5:43:1\d$/)
  })

  /* …and a WORK SQUAD that is out gets the word alone. Nothing about it was ever monitored, so
   * there is no recovery time to count down and no reason to put a running number on a card
   * nobody has to act on — «Draussen» is the whole statement. */
  it('gives a work squad that is out its word alone — no clock, no time', () => {
    mount({ trupps: [{ ...aktivTrupp(), kind: 'einfach', status: 'raus', exitTime: iso(5 * 60_000) }] })
    // app-only wording (09.09.): a work squad reports a task done, not a radio check — see the
    // «Ohne Auftrag» / «Auftrag erledigt» describe block below
    expect(screen.getByText(az.statusPlainOut)).toBeTruthy()
    expect(screen.queryByText(az.outFor)).toBeNull()
    expect(screen.queryByText(az.elapsed)).toBeNull()
    const clock = document.querySelector(`.${s.trowClockVal}`)!
    expect(clock.textContent).toBe('')
  })

  /* ⚠️ «Nicht eingesetzt» gets NO running clock (04.09.). A Sicherungstrupp that was stood down
   * without ever going under PA wore the break clock under «Draussen seit» — the card's loudest
   * element, ticking — which claims the crew came out of something AND presses for a recovery
   * nobody has to take. What it has is the moment it was announced: a time, not a duration. */
  it('gives a Trupp that never went in its Anmeldezeit, and no clock at all', () => {
    mount({ trupps: [{
      ...aktivTrupp(), status: 'raus', entryTime: '', exitTime: iso(5 * 60_000),
      readings: [{ t: iso(40 * 60_000), bar: 300, kind: 'registered' }],
    }] })
    expect(screen.getByText(az.statusNotDeployed)).toBeTruthy()
    expect(screen.getByText(az.bandRegisteredAt)).toBeTruthy()
    // the break clock's own caption is exactly what must NOT stand over this card
    expect(screen.queryByText(az.outFor)).toBeNull()
    // …and the value beside it is a wall-clock time, never a running mm:ss
    const clock = document.querySelector(`.${s.trowClockVal}`)!
    expect(clock.textContent).toMatch(/^\d{2}:\d{2}$/)
  })

  /* …and BOTH out states hand the loud type back. The 40px bold number belongs to the crews that
   * are inside — that is the reading order of the whole board — and a break clock in the same
   * weight put a Trupp nobody is watching at the top of the eye's list. */
  it('draws both out states quietly, and leaves the loud clock to the crews inside', () => {
    for (const t of [
      { ...aktivTrupp(), status: 'raus' as const, exitTime: iso(5 * 60_000) },
      { ...aktivTrupp(), status: 'raus' as const, entryTime: '', exitTime: iso(5 * 60_000),
        readings: [{ t: iso(40 * 60_000), bar: 300, kind: 'registered' as const }] },
    ]) {
      cleanup()
      mount({ trupps: [t] })
      expect(document.querySelector(`.${s.trowCard}`)!.className).toContain(s.trowOut)
    }
    cleanup()
    mount() // still inside: this is the one card that keeps the big number
    expect(document.querySelector(`.${s.trowCard}`)!.className).not.toContain(s.trowOut)
  })

  it('keeps «Einrücken» explained on a Trupp under Atemschutz — and only there', () => {
    mount({ trupps: [{ ...aktivTrupp(), status: 'angemeldet' }] })
    expect(screen.getByText(az.preEntryHint)).toBeTruthy()
    // the grid has no «Bereit» section head, so the card says it (TruppCard · `headed`)
    expect(screen.getByText(az.phoneSectionReady)).toBeTruthy()
  })
})

/* The lifecycle row stopped being a segmented strip of equal cells on 04.09.: it is `auto` + `1fr`
 * (see `.actions`), so which button is loud and which is quiet is decided by the ORDER in the
 * markup — quiet first. A refactor that reorders these buttons silently swaps their weights, and
 * nothing on screen would say so. */
/* ⚠️ «Raus melden» used to lead this row (the quiet button first). Reversed 04.09. on Manuel's
 * feedback: the row is read while both steps are still ahead, so it runs in the order the Einsatz
 * runs — the crew is called back, then it comes out. */
describe('the lifecycle row: in the order the Einsatz runs', () => {
  it('puts the Rückzug decision before «Raus melden», on both in-field states', () => {
    for (const status of ['aktiv', 'rueckzug'] as const) {
      cleanup()
      mount({ trupps: [{ ...aktivTrupp(), status }] })
      const labels = [...document.querySelectorAll(`.${s.actions} .${s.actBtn}`)].map((b) => b.getAttribute('aria-label') ?? b.textContent)
      expect(labels).toEqual([status === 'aktiv' ? az.actRueckzug : az.actContinue, az.actExit])
    }
  })

  /* ⚠️ Reversed again 07.09. (Feldtest Manuel): the pre-entry row also runs in the order the
   * Einsatz runs — deploying is what usually happens to a waiting Trupp, so «Einrücken» leads and
   * the stand-down sits right, where «Raus melden» also lives. The width flip is CSS
   * (`.actions:has(> .actEnter:first-child)`), so «Einrücken» still takes the room. */
  // «Nicht eingesetzt» left the row for the ⋮ (staging r2, N8): an equal button one tap beside
  // «Im Einsatz» was a reflex away from closing the wrong way
  /* owner review 26.09.2026: «Nicht eingesetzt» is VISIBLE again, but never beside «Im Einsatz»
   * — its own row, a quiet secondary; the ⋮ no longer carries it */
  it('leads the pre-entry row with «Im Einsatz» alone; «Nicht eingesetzt» stands on its own row, not in the ⋮', async () => {
    const setTruppStatus = vi.fn()
    mount({ trupps: [{ ...aktivTrupp(), status: 'angemeldet' }], setTruppStatus })
    const labels = [...document.querySelectorAll(`.${s.actions} .${s.actBtn}`)].map((b) => b.textContent)
    expect(labels).toEqual([az.actEnter])
    const standDown = screen.getByRole('button', { name: az.actNotDeployed })
    expect(standDown.closest(`.${s.standDownRow}`)).not.toBeNull()
    expect(standDown.closest(`.${s.actions}`)).toBeNull()
    fireEvent.click(standDown)
    expect(setTruppStatus).toHaveBeenCalledWith('tr1', 'raus', undefined, { undoToast: true })
    fireEvent.click(screen.getByRole('button', { name: az.cardMenu }))
    await screen.findAllByRole('menuitem')
    expect(screen.queryByRole('menuitem', { name: az.actNotDeployed })).toBeNull()
  })
})

/* T11 (29.09.2026): the tablet's Rückzug / Raus are the phone's equal tiles — both framed grey,
 * «Rückzug» amber ONLY at or under the Trupp's Alarmdruck. It was amber on every card in the field. */
describe('the tablet card wears the phone card', () => {
  it('keeps «Rückzug» grey above the Alarmdruck and turns it amber at the line', () => {
    mount()
    expect(screen.getByRole('button', { name: az.actRueckzug }).className).not.toContain(s.actAlarm)
    cleanup()
    mount({ trupps: [{ ...aktivTrupp(), lastPressureBar: 80, lowestBar: 80 }] })
    expect(screen.getByRole('button', { name: az.actRueckzug }).className).toContain(s.actAlarm)
  })

  it('draws the card with no band, no Kennzeile and no ± stepper — the tiles and the chips', () => {
    mount({ trupps: [{ ...aktivTrupp(), no: 2 }] })
    const card = document.querySelector(`.${s.trowCard}`)!
    // the first line is not a toggle on the grid: every card stands open
    expect(card.querySelector(`.${s.trowHead}`)!.tagName).toBe('DIV')
    expect(card.querySelector(`.${s.trowChevron}`)).toBeNull()
    // no «#N» on the card's head (owner, 30.09.2026: «drop the number #»)
    expect(card.querySelector(`.${s.trowHead}`)!.textContent).not.toContain('#2')
    expect(within(card as HTMLElement).getAllByRole('button', { name: az.actContact })).toHaveLength(1)
    // the ⋯ ends the foot line, beside the Verlauf's ⌄ (29.09.2026, owner pick B)
    expect(card.querySelector(`.${s.vfootRow}`)!.lastElementChild!.getAttribute('aria-label')).toBe(az.cardMenu)
  })

  // T9: the handed-over phone Tafel's add cell carries its word
  it('writes «+ Trupp» in the Tafel strip\'s add cell', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    try {
      mount({ lite: { subtitle: 'Brand' }, trupps: [aktivTrupp()] })
      expect(document.querySelector(`.${s.tabAdd}`)!.textContent).toBe(az.newTruppShort)
    } finally {
      vi.mocked(useIsPhone).mockReturnValue(false)
    }
  })
})

/* A closed Einsatz is a record, not a situation. A Trupp that was never reported out kept
 * accumulating Einsatzzeit through the night, so the Akte opened the next morning claimed a crew
 * had been inside for eleven hours — and the überfällig alarm went with it (that half is App's,
 * see `azMonitoring`). Frozen, every clock reads what it read when the Einsatz ended. */
describe('an abgeschlossener Einsatz (frozenAt)', () => {
  it('stops every clock at the Einsatzende instead of counting on', () => {
    vi.useFakeTimers()
    try {
      const entry = Date.now() - 10 * 60_000
      const trupp = { ...aktivTrupp(), entryTime: new Date(entry).toISOString() }
      // the Einsatz ended four minutes after this Trupp went in
      mount({ trupps: [trupp], frozenAt: entry + 4 * 60_000 })
      const clock = () => document.querySelector(`.${s.metaLine}`)!.textContent
      const atClose = clock()
      expect(atClose).toContain('4:00')

      // …and a minute of real time later it still reads exactly what it read at the Einsatzende
      vi.advanceTimersByTime(60_000)
      expect(clock()).toBe(atClose)
    } finally {
      vi.useRealTimers()
    }
  })

  it('alarms nothing — no «Alarm» badge, no red card, the band says «Stand beim Abschluss» (R3)', () => {
    // overdue AT the close: on a running Einsatz this is a red card and a «1 Alarm» badge
    const entry = Date.now() - 60 * 60_000
    const trupp = { ...aktivTrupp(), entryTime: new Date(entry).toISOString(), lastContactTime: new Date(entry).toISOString() }
    mount({ trupps: [trupp], frozenAt: entry + 40 * 60_000 })
    expect(document.querySelector(`.${s.overdueBadge}`)).toBeNull()
    expect(document.querySelector(`.${s.trowCrit}`)).toBeNull()
    expect(screen.getByText(az.clockFrozen)).toBeTruthy()
    expect(screen.queryByText(az.clockOverdue)).toBeNull()
    // …and the colours that mean «running» go too (N5): the board wears the frozen tone, whose
    // rules neutralise the red status edge and the green clocks
    expect(document.querySelector(`.${s.surfaceFrozen}`)).toBeTruthy()
    const css = readFileSync(`${process.cwd()}/src/components/Atemschutz.module.css`, 'utf8')
    expect(css).toMatch(/\.surfaceFrozen \.trow \{ border-left-color: var\(--ink-faint\); background: var\(--surface\); \}/)
    expect(css).toMatch(/\.surfaceFrozen \.trowClockVal, \.surfaceFrozen \.tabClock \{ color: var\(--ink-dim\)/)
    // …the SICHERUNGSTRUPP head included — no amber title on a closed Tafel (r6, F3; a head since
    // the slim-down of 26.09.2026)
    expect(css).toMatch(/\.surfaceFrozen \.sectDue \.sectTitle \{ color: var\(--ink-dim\); \}/)
  })
})

/* ⚠️ Field report, 04.09.: opening a Trupp on the phone moved the toggle's chevron from the right
 * edge of the row to the LEFT edge of the card head, «to make room for the ⋯» — and the pixel the
 * thumb had just pressed became the ⋯, whose menu carries «Entfernen». One control drawn twice has
 * to stay in one place; the far-right slot was originally kept clear to shield a bin that has been
 * inside the ⋯ since 03.09. */
describe('the row ⇄ card toggle keeps its place', () => {
  afterEach(() => { vi.mocked(useIsPhone).mockReturnValue(false) })

  it('leaves the collapse chevron at the trailing edge of the same line, and the ⋯ off that line', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ trupps: [aktivTrupp()] })
    // the closed row: the chevron is the row's last child
    const row = document.querySelector(`.${s.trow}`)!
    expect(row.lastElementChild!.className).toContain(s.trowChevron)

    fireEvent.click(row)
    // …opened, the row's first line IS the collapse control, its chevron still the last thing on it
    const head = screen.getByRole('button', { name: new RegExp(az.collapse) })
    expect(head.lastElementChild!.className).toContain(s.trowChevron)
    // …and the ⋯ (whose menu carries «Entfernen») is nowhere on that line, and comes after it
    const menu = screen.getByRole('button', { name: az.cardMenu })
    expect(head.contains(menu)).toBe(false)
    expect(head.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

/* Owner on staging, 26.09.2026: «keep the same UI whether the card is collapsed or not (for
 * Druck/Kontakt)». The opened card drew the clock again in a band, a full-width «Kontakt» and a
 * «Druck» row — the same two buttons in a second shape, one tap after the first. Now the opened
 * card is the row grown downwards: the same line, the same pair, the same tone, in every tier. */
describe('the opened phone card wears the collapsed row’s line and pair', () => {
  afterEach(() => { vi.mocked(useIsPhone).mockReturnValue(false) })
  const tiers: [string, number][] = [['normal', 1], ['fällig', 5.4], ['überfällig', 8]]
  const snapshot = (frame: Element) => ({
    tone: [...frame.classList].filter((c) => [s.trowWarn, s.trowCrit, s.trowIdle, s.trowOut, s.trowPlain].includes(c)),
    line: frame.querySelector(`.${s.trowId}`)!.outerHTML + frame.querySelector(`.${s.trowClock}`)!.outerHTML,
    pair: [...frame.querySelectorAll(`.${s.trowActs} > *`)].map((b) => `${b.className}|${b.textContent}`),
  })

  it.each(tiers)('draws the same line, the same «Druck | Kontakt» and the same tone — %s', (_label, contactAgoMin) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.mocked(useIsPhone).mockReturnValue(true)
      mount({ trupps: [{ ...aktivTrupp(), lastContactTime: iso(contactAgoMin * 60_000) }] })
      const row = document.querySelector(`.${s.trow}`)!
      const closed = snapshot(row)
      fireEvent.click(row)
      const open = snapshot(document.querySelector('[data-az-open]')!)
      expect(open).toEqual(closed)
      // two tiles: the bar behind the gauge (the word «Druck» is its spoken name only since the
      // slim-down of 26.09.2026), «Kontakt» with its word
      expect(open.pair).toHaveLength(2)
      expect(open.pair[0]).toMatch(/\|240 bar$/)
      expect(within(document.querySelector('[data-az-open]') as HTMLElement).getByRole('button', { name: `${az.actPressure} 240 bar` })).toBeTruthy()
      expect(open.pair[1]).toContain(az.actContact)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the due and overdue colours of «Kontakt» on the opened card', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ trupps: [
      { ...aktivTrupp(), id: 'd', name: 'Due Dora', lastContactTime: iso(5.4 * 60_000) },
      { ...aktivTrupp(), id: 'o', name: 'Over Otto', lastContactTime: iso(8 * 60_000) },
    ] })
    for (const [name, tier] of [['Due Dora', s.kontaktWarn], ['Over Otto', s.kontaktCrit]] as const) {
      fireEvent.click(screen.getByText(name).closest(`.${s.trow}`)!)
      const card = document.querySelector('[data-az-open]') as HTMLElement
      expect(within(card).getByRole('button', { name: az.actContact }).className).toContain(tier)
      // …and «Überfällig» never by colour alone for a screen reader: heard once, as the card's
      // status line. No glyph at the head's clock for either tier (owner, 30.10.2026).
      expect(card.querySelector(`.${s.trowHead} use[href="#warn"]`)).toBeNull()
      expect(within(card).getByRole('status').textContent).toBe(tier === s.kontaktWarn ? az.clockWarn : az.clockOverdue)
      fireEvent.click(within(card).getByRole('button', { name: new RegExp(az.collapse) }))
    }
  })

  it('opens without the band, the big Kontakt and the Druck row the card used to add', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    const props = mount({ trupps: [{ ...aktivTrupp(), no: 2 }] })
    fireEvent.click(document.querySelector(`.${s.trow}`)!)
    const card = document.querySelector('[data-az-open]') as HTMLElement
    expect(card.querySelectorAll(`.${s.trowClockVal}`)).toHaveLength(1) // the line's clock, no second one
    expect(within(card).getAllByRole('button', { name: az.actContact })).toHaveLength(1)
    expect(within(card).getAllByRole('button', { name: druckName })).toHaveLength(1)
    // no «#N» on the opened card either (owner, 30.09.2026: «drop the number #») — nor in the chips
    expect(card.querySelector(`.${s.trowHead}`)!.textContent).not.toContain('#2')
    expect(card.querySelector(`.${s.facts}`)!.textContent).not.toContain('#2')
    // …and the pair works the same from here
    fireEvent.click(within(card).getByRole('button', { name: az.actContact }))
    expect(props.recordContact).toHaveBeenCalledWith('tr1')
  })
})

/* Owner, 30.10.2026: «for all trupps already show the next action (i.e. im einsatz) rather than
 * the empty time» — a Bereit row's «–:––» is its «Im Einsatz» now, the SafetyRow's button. */
describe('a Trupp at the door shows its next act where the empty clock stood', () => {
  afterEach(() => { vi.mocked(useIsPhone).mockReturnValue(false) })
  const waiting = (): Trupp => ({ ...aktivTrupp(), id: 'w', name: 'Wait Wendy', status: 'angemeldet', entryTime: '', lastContactTime: '', readings: [] })
  const row = () => screen.getByText('Wait Wendy').closest(`.${s.trow}`) as HTMLElement

  it('«Im Einsatz» in the clock cell goes in without opening the card', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    const setTruppStatus = vi.fn()
    mount({ trupps: [waiting()], setTruppStatus })
    expect(row().querySelector(`.${s.trowClockVal}`)).toBeNull()
    fireEvent.click(within(row().querySelector(`.${s.trowClock}`) as HTMLElement).getByRole('button', { name: az.actEnter }))
    expect(setTruppStatus).toHaveBeenCalledWith('w', 'aktiv')
    expect(document.querySelector('[data-az-open]')).toBeNull()
  })

  it('a viewer gets an empty cell, and the opened card keeps the act to its tile', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ trupps: [waiting()], canEdit: false })
    expect(row().querySelector(`.${s.trowClock}`)!.textContent).toBe('')
    cleanup()
    mount({ trupps: [waiting()] })
    fireEvent.click(row())
    const card = document.querySelector('[data-az-open]') as HTMLElement
    expect(card.querySelector(`.${s.trowHead} .${s.trowClock}`)!.textContent).toBe('')
    expect(within(card).getAllByRole('button', { name: az.actEnter })).toHaveLength(1)
  })
})

/* B5, 08.10.2026: the phone row carried überfällig by colour alone – no answer in a screen
 * reader. Since 30.10.2026 (owner: «we don't need the triangle thing. red and notfall is already
 * enough») there is NO glyph at the clock for fällig, überfällig or the Alarmdruck: the digits'
 * colour is the tier for the eye, the row's spoken name carries the word, and the Alarmdruck
 * never reads «Überfällig». */
describe('the phone row says its tier in its spoken name, with no glyph at the clock', () => {
  afterEach(() => { vi.mocked(useIsPhone).mockReturnValue(false) })
  const rowOf = (name: string) => screen.getByText(name).closest(`.${s.trow}`)!

  it('names «Überfällig», «Fällig» and the Alarmdruck for a screen reader and draws no triangle', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    const low = (dz.alarmBar ?? 50) - 10
    mount({ trupps: [
      { ...aktivTrupp(), id: 'k', name: 'Calm Karl' },
      { ...aktivTrupp(), id: 'd', name: 'Due Dora', lastContactTime: iso(5.4 * 60_000) },
      { ...aktivTrupp(), id: 'o', name: 'Over Otto', lastContactTime: iso(8 * 60_000) },
      { ...aktivTrupp(), id: 'p', name: 'Low Paula', lastPressureBar: low, lowestBar: low,
        readings: [{ t: iso(10 * 60_000), bar: 300, kind: 'entry' }, { t: iso(60_000), bar: low, kind: 'pressure' }] },
    ] })
    for (const name of ['Calm Karl', 'Due Dora', 'Over Otto', 'Low Paula']) {
      expect(rowOf(name).querySelector(`.${s.trowClock} use[href="#warn"]`)).toBeNull()
    }
    const spoken = (name: string) => rowOf(name).getAttribute('aria-label')
    expect(spoken('Due Dora')).toContain(az.rowDue)
    expect(spoken('Over Otto')).toContain(az.clockOverdue)
    // a pressure alarm is a different event: it says so, and never «Überfällig»
    expect(spoken('Low Paula')).toContain(az.clockAlarmPressure)
    expect(spoken('Low Paula')).not.toContain(az.clockOverdue)
    expect(spoken('Calm Karl')).not.toMatch(new RegExp(`${az.rowDue}|${az.clockOverdue}|${az.clockAlarmPressure}`))
  })

  it('a crew in a NOTFALL wears the banner’s ⚠ in its dot’s place, the only glyph on its row', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ trupps: [
      { ...aktivTrupp(), id: 'n', name: 'Nora Notfall', lastContactTime: iso(8 * 60_000), notfallAt: iso(60_000) },
      { ...aktivTrupp(), id: 'o', name: 'Over Otto', lastContactTime: iso(8 * 60_000) },
    ] })
    const row = (name: string) => [...document.querySelectorAll<HTMLElement>(`button.${s.trow}`)].find((r) => r.textContent!.includes(name))!
    const nf = row('Nora Notfall')
    expect(nf.querySelector(`.${s.trowName} .${s.nfGlyph} use`)!.getAttribute('href')).toBe('#warn')
    expect(nf.querySelector(`.${s.trowDot}`)).toBeNull()
    expect(nf.querySelectorAll('use[href="#warn"]')).toHaveLength(1)
    // every other crew carries no glyph at all, überfällig or not
    expect(row('Over Otto').querySelector('use[href="#warn"]')).toBeNull()
    // …and the banner names the crew exactly as its row does
    expect(document.querySelector(`section.${s.nfBanner} .${s.trowNameTxt}`)!.textContent).toBe('Nora Notfall')
  })

  it('keeps the row on its two lines — the mark lives in the clock cell', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ trupps: [{ ...aktivTrupp(), lastContactTime: iso(8 * 60_000) }] })
    const row = document.querySelector(`.${s.trow}`)!
    expect([...row.children].map((c) => c.className.split(' ')[0])).toEqual([s.trowId, s.trowClock, s.trowAct, s.trowChevron])
  })
})

/* Field report, 05.09. late: the COLLAPSED views disagreed with the open card — the phone row
 * froze a work squad's Einsatzzeit after the exit and printed «–:––» where the card ticked the
 * break clock. One derivation now (`collapsedClock`, shared with the focus-strip tabs), so the
 * closed and the open view of one Trupp can never tell different times. */
describe('a collapsed row tells the same time as the open card', () => {
  afterEach(() => { vi.mocked(useIsPhone).mockReturnValue(false) })

  it('ticks «Draussen seit» on the closed row of an out Atemschutz-Trupp', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ trupps: [{ ...aktivTrupp(), status: 'raus', exitTime: iso(5 * 60_000) }] })
    const row = document.querySelector(`.${s.trow}`)!
    expect(row.querySelector(`.${s.trowSub}`)!.textContent).toBe(az.outFor)
    expect(row.querySelector(`.${s.trowClockVal}`)!.textContent).toMatch(/^0?5:00$/)
  })

  // 30.09.2026
  it('draws a day-long clock compact — «2d 3h», the units small against their numbers', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ trupps: [{ ...aktivTrupp(), status: 'raus', exitTime: iso((2 * 24 + 3) * 3600_000 + 60_000) }] })
    const val = document.querySelector(`.${s.trow} .${s.trowClockVal}`)!
    expect(val.textContent).toBe('2d 3h')
    expect([...val.querySelectorAll(`.${s.clockUnit}`)].map((u) => u.textContent)).toEqual(['d ', 'h'])
  })

  it('…and the card\'s foot spells a day-long duration the same way, mm:ss and «min» untouched', () => {
    // tablet grid: every card stands open, so the foot is drawn
    mount({ trupps: [{ ...aktivTrupp(), entryTime: iso((3 * 24 + 10) * 3600_000 + 60_000) }] })
    const foot = document.querySelector(`.${s.metaLine}`)!
    expect(foot.textContent).toContain('3d 10h')
    expect(foot.textContent).not.toMatch(/\d d \d+ h/)
  })

  it('shows no time at all on the closed row of an out work squad', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ trupps: [{ ...aktivTrupp(), kind: 'einfach', status: 'raus', exitTime: iso(5 * 60_000) }] })
    const row = document.querySelector(`.${s.trow}`)!
    expect(row.querySelector(`.${s.trowClockVal}`)!.textContent).toBe('')
    expect(row.querySelector(`.${s.trowSub}`)!.textContent).toBe('')
    // ⚠️ …and never the AS break-clock word either, app-side or link-board-side (`plainWords`'
    // defensive swap in TruppRow guards this even though `collapsedClock` itself already never
    // reaches `az.outFor` for a plain Trupp — see its own `!isAtemschutzTrupp` early return).
    expect(row.querySelector(`.${s.trowSub}`)!.textContent).not.toBe(az.outFor)
    expect(row.querySelector(`.${s.trowSub}`)!.textContent).not.toBe(az.outForPlain)
  })
})

describe('the Verlauf footer (the removed «Draussen: hh:mm» line, generalised)', () => {
  // ⚠️ no preview of the latest event since 29.09.2026 (T2) — see «carries no «zuletzt» preview»
  it('expands the full log in place, newest first', () => {
    mount()
    const row = screen.getByRole('button', { name: az.verlauf })
    expect(row.textContent).not.toContain('2 Einträge')
    // the older entry row is behind the fold until the footer is tapped
    expect(screen.queryByText(az.readingKind.entry)).toBeNull()
    fireEvent.click(row)
    expect(screen.getByText(az.readingKind.entry)).toBeTruthy()
    expect([...document.querySelectorAll(`.${s.logKind}`)].map((e) => e.textContent)[0]).toBe(az.readingKind.pressure)
  })
})

describe('pointing to a Trupp', () => {
  it('replays the whole-card highlight when the same notification is tapped again', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    const one = propsFor({ focus: { id: 'tr1', nonce: 1 } })
    const view = render(<AtemschutzView {...one} />)
    expect(scroll).toHaveBeenCalledTimes(1)
    view.rerender(<AtemschutzView {...one} focus={{ id: 'tr1', nonce: 2 }} />)
    expect(scroll).toHaveBeenCalledTimes(2)
    scroll.mockRestore()
  })

  /* Since the slim-down (26.09.2026) the gap opens the one sheet that answers it — the Auftrag
   * sheet with the six tiles (components/TruppSheets) — not the whole form on its Auftrag field. */
  it('opens the missing Auftrag («+ Auftrag») on the Auftrag sheet, tiles ready', () => {
    mount({ trupps: [{ ...aktivTrupp(), auftrag: undefined }] })
    fireEvent.click(screen.getByRole('button', { name: az.auftragAdd }))
    const sheet = screen.getByRole('dialog', { name: new RegExp(`^${az.editFieldLabels.auftrag}`) })
    expect(within(sheet).getByRole('group', { name: az.editFieldLabels.auftrag })).toBeTruthy()
    expect(within(sheet).getByRole('button', { name: 'Löschen' })).toBeTruthy()
  })

  // RBAC audit V2 (22.10.2026): a viewer's gap handed the tap to the whole Trupp form, whose phone
  // sheet pins the due Trupps with a live «Kontakt» – a clock reset on that one tablet only
  it('a viewer sees the missing Auftrag as a read-out, not a door into the Trupp form', () => {
    mount({ canEdit: false, trupps: [{ ...aktivTrupp(), auftrag: undefined }] })
    expect(screen.getByText(az.auftragAdd)).toBeTruthy()
    expect(screen.queryByRole('button', { name: az.auftragAdd })).toBeNull()
  })
})
