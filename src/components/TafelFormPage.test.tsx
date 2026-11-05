// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { StrictMode, useState } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { TafelFormPage } from './TafelFormPage'
import { newFormPage, putLine, putRow, writtenRows, type BoardFormData } from '../lib/boardForm'
import { colMinScale, type TableSection } from '../lib/boardTemplate'
import { BUNDLED_TEMPLATES } from '../lib/boardTemplates'
import { getLocaleId } from '../config/copy'
import { appConfig } from '../config/appConfig'
import s from './TafelFormPage.module.css'

afterEach(cleanup)

const FKS = BUNDLED_TEMPLATES[0]
const EF = FKS.pages.find((p) => p.id === 'ef')!

/** the page with its own state, the way the Whiteboard holds it — and every commit counted,
 *  because a commit is a ↶ step */
function Harness({ onCommit, vehicles = ['TLF 1'] }: { onCommit: (d: BoardFormData) => void; vehicles?: string[] }) {
  const [data, setData] = useState(() => newFormPage(FKS, EF, { vehicles }, '2026-10-10T09:24:00.000Z'))
  return (
    <TafelFormPage pageKey="fm-test" data={data} readOnly={false} isPhone={false} onRemove={() => {}}
      inset={{ top: 0, left: 0, right: 0, bottom: 0 }}
      onChange={(d) => { onCommit(d); setData(d) }} />
  )
}

const active = () => document.activeElement as HTMLTextAreaElement
const box = (id: string) => document.querySelector(`[data-box="${id}"]`)!
const type = (text: string) => fireEvent.change(active(), { target: { value: text } })
const key = (k: string, opts: Partial<KeyboardEventInit> = {}) => act(() => { fireEvent.keyDown(active(), { key: k, ...opts }) })

describe('a Tafel page by keyboard, like a spreadsheet', () => {
  it('Enter writes line after line in a box; Enter on its empty line moves on to Massnahmen', () => {
    const commits: BoardFormData[] = []
    render(<StrictMode><Harness onCommit={(d) => commits.push(d)} /></StrictMode>)
    act(() => { box('front').querySelector<HTMLTextAreaElement>('[data-kn]')!.focus() })
    for (const t of ['Rettungen Haus 19', 'Rettungen Haus 21']) { type(t); key('Enter') }
    expect(commits).toHaveLength(2) // one ↶ step per committed line
    expect(commits[1].values.problem.lines?.front?.map((l) => l.text)).toEqual(['Rettungen Haus 19', 'Rettungen Haus 21'])
    expect(active().getAttribute('data-kn')).toBe('problem|front|+new|')
    key('Enter')
    expect(active().getAttribute('aria-label')).toBe('Was/Wo')
    expect(commits).toHaveLength(2) // leaving an empty line writes nothing
  })

  it('Tab goes across the columns; Enter stamps an empty «Wann» and goes down in the same column', () => {
    const commits: BoardFormData[] = []
    render(<Harness onCommit={(d) => commits.push(d)} />)
    const was = screen.getAllByLabelText('Was/Wo')[0] as HTMLTextAreaElement
    act(() => { was.focus() })
    type('Personensuche 1. OG'); key('Tab')
    expect(active().getAttribute('aria-label')).toBe('Wer')
    type('AS Trupp 1'); key('Enter')
    expect(active().getAttribute('aria-label')).toBe('Wer')
    expect(active().getAttribute('data-kn')).toBe('massnahmen||+new|wer')
    const row = commits[commits.length - 1].values.massnahmen.rows![0]
    expect(row.cells.was).toBe('Personensuche 1. OG')
    expect(row.cells.wer).toBe('AS Trupp 1')
    expect(row.cells.wann).toMatch(/^\d\d:\d\d$/)
    key('Tab', { shiftKey: true })
    expect(active().getAttribute('aria-label')).toBe('Was/Wo')
    key('Tab', { shiftKey: true })
    expect(active().getAttribute('aria-label')).toBe('Wann') // the row above, last column
  })

  it('«1124» in a Wann is 11:24; Esc puts the stored value back', () => {
    const commits: BoardFormData[] = []
    render(<Harness onCommit={(d) => commits.push(d)} />)
    const mittel = document.querySelector('[data-sec="mittel"]')!
    const wann = mittel.querySelectorAll<HTMLTextAreaElement>('[aria-label="Wann"]')[0] // Mittel's first row (TLF 1)
    act(() => { wann.focus() })
    type('1124'); key('Tab')
    expect(commits[commits.length - 1].values.mittel.rows![0].cells.wann).toBe('11:24')
    const auftrag = mittel.querySelectorAll<HTMLTextAreaElement>('[aria-label="Auftrag/Wo"]')[0]
    act(() => { auftrag.focus() })
    type('Riegel'); key('Escape')
    expect(auftrag.value).toBe('')
  })

  it('the Abspracherapport: six printed rows with their Signaturen (only «Ort» typed), and a row under them that types the rest', () => {
    const commits: BoardFormData[] = []
    render(<Harness onCommit={(d) => commits.push(d)} />)
    const abs = document.querySelector('[data-sec="absprachen"]')!
    expect(abs.querySelectorAll('svg').length).toBe(6)
    expect(abs.querySelectorAll('textarea[aria-label="Ort"]').length).toBe(7)
    // every box drawn is writable: the row under «Warteraum» names itself (owner, round 2)
    const bez = abs.querySelectorAll<HTMLTextAreaElement>('textarea[aria-label="Bezeichnung"]')
    expect(bez.length).toBe(1)
    expect(abs.textContent?.replace(/\u00ad/g, '')).toContain('Sammelstelle Unverletzte')
    expect(abs.textContent).not.toContain('Wasserbezug') // a station switch, off in the FKS poster
    act(() => { bez[0].focus() })
    type('Helikopterlandeplatz'); key('Tab')
    type('Sportplatz'); key('Enter')
    const row = commits[commits.length - 1].values.absprachen.rows!.find((r) => !r.id.startsWith('patienten') && r.cells.bez)!
    expect(row.cells).toEqual({ bez: 'Helikopterlandeplatz', ort: 'Sportplatz' })
  })

  it('every ruled empty row is a tap target — and writing lands directly under the last entry', () => {
    render(<Harness onCommit={() => {}} />)
    const mass = document.querySelector('[data-sec="massnahmen"]')!
    // 11 rulings on the poster: ONE empty row you type in, the ten under it lead into it
    expect(mass.querySelectorAll('textarea[aria-label="Was/Wo"]').length).toBe(1)
    const ghosts = mass.querySelectorAll<HTMLElement>('[role="presentation"]')
    expect(ghosts.length).toBe(10)
    act(() => { fireEvent.click(ghosts[7].querySelector('[data-col="wer"]')!) })
    expect(active().getAttribute('data-kn')).toBe('massnahmen||+new|wer')
  })

  it('a focused cell that was only passed through never writes its old text back over a remote change', () => {
    const commits: BoardFormData[] = []
    const { rerender } = render(<Harness onCommit={(d) => commits.push(d)} />)
    void rerender
    const was = document.querySelector<HTMLTextAreaElement>('[data-sec="massnahmen"] [data-kn$="|was"]')!
    act(() => { was.focus() })
    key('Tab') // nothing typed: no write
    key('Tab', { shiftKey: true })
    act(() => { (document.activeElement as HTMLElement).blur() })
    expect(commits).toHaveLength(0)
  })

  it('every write carries its edit time — a typed line and a trend tap alike (what settles a two-device clash)', () => {
    const commits: BoardFormData[] = []
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    try {
      render(<Harness onCommit={(d) => commits.push(d)} />)
      act(() => { box('front').querySelector<HTMLTextAreaElement>('[data-kn]')!.focus() })
      type('Rauch'); key('Enter')
      const id = commits[0].values.problem.lines!.front![0].id
      const atom = `l|problem|front|${id}`
      expect(commits[0].t).toEqual({ [atom]: 1_000_000, [`${atom}|#ord`]: 1_000_000 })
      now.mockReturnValue(1_005_000)
      act(() => { fireEvent.click(box('front').querySelector('[data-trend]')!) })
      const last = commits[commits.length - 1]
      expect(last.values.problem.lines!.front![0].trend).toBe('up')
      expect(last.t).toEqual({ [atom]: 1_005_000, [`${atom}|#ord`]: 1_000_000 })
    } finally { now.mockRestore() }
  })

  it('the page carries the deployment locale, so typed words hyphenate like the language they are in', () => {
    render(<Harness onCommit={() => {}} />)
    expect(document.querySelector('[data-testid="tafel-page"]')!.getAttribute('lang')).toBe(getLocaleId())
  })

  // owner, 10.10. evening
  it('a tap on the 8th ruling under three entries writes in the 4th — directly under them; Enter goes on down', () => {
    const commits: BoardFormData[] = []
    render(<Harness vehicles={['TLF', 'ADF', 'MTF']} onCommit={(d) => commits.push(d)} />)
    const mittel = document.querySelector('[data-sec="mittel"]')!
    const formation = () => [...mittel.querySelectorAll<HTMLTextAreaElement>('textarea[aria-label="Formation"]')]
    expect(formation().map((t) => t.value)).toEqual(['TLF', 'ADF', 'MTF', ''])
    // the 8th ruling is an empty ruling under the empty row: the caret goes to the 4th
    act(() => { fireEvent.click(mittel.querySelectorAll('[role="presentation"]')[3].querySelector('[data-col="formation"]')!) })
    type('Test 1'); key('Enter')
    expect(formation().map((t) => t.value)).toEqual(['TLF', 'ADF', 'MTF', 'Test 1', ''])
    expect(active()).toBe(formation()[4]) // the next free line
  })

  it('a Problemerfassung line emptied in the middle closes up — the lines below move up', () => {
    const commits: BoardFormData[] = []
    render(<Harness onCommit={(d) => commits.push(d)} />)
    act(() => { box('front').querySelector<HTMLTextAreaElement>('[data-kn]')!.focus() })
    for (const t of ['Rauch', 'Rettung', 'Dach']) { type(t); key('Enter') }
    const lines = () => [...box('front').querySelectorAll<HTMLTextAreaElement>('textarea')].map((t) => t.value)
    expect(lines()).toEqual(['Rauch', 'Rettung', 'Dach', ''])
    act(() => { box('front').querySelectorAll<HTMLTextAreaElement>('textarea')[0].focus() })
    type(''); key('Enter')
    expect(lines()).toEqual(['Rettung', 'Dach', ''])
  })

  it('Alt+↓ / Alt+↑ moves the entry — one ↶ step each, with what was typed — and the caret stays in it', () => {
    const commits: BoardFormData[] = []
    render(<Harness onCommit={(d) => commits.push(d)} />)
    act(() => { box('front').querySelector<HTMLTextAreaElement>('[data-kn]')!.focus() })
    for (const t of ['Rauch', 'Rettung', 'Dach']) { type(t); key('Enter') }
    const lines = () => [...box('front').querySelectorAll<HTMLTextAreaElement>('textarea')].map((t) => t.value)
    act(() => { box('front').querySelectorAll<HTMLTextAreaElement>('textarea')[0].focus() })
    const n = commits.length
    key('ArrowDown', { altKey: true })
    expect(lines()).toEqual(['Rettung', 'Rauch', 'Dach', ''])
    expect(commits).toHaveLength(n + 1)
    expect(active().value).toBe('Rauch')
    type('Rauch Dach'); key('ArrowDown', { altKey: true })
    expect(lines()).toEqual(['Rettung', 'Dach', 'Rauch Dach', ''])
    expect(commits).toHaveLength(n + 2) // the edit and the move are one step
    key('ArrowDown', { altKey: true }) // already last: nothing moves, nothing written
    expect(commits).toHaveLength(n + 2)
    key('ArrowUp', { altKey: true }); key('ArrowUp', { altKey: true })
    expect(lines()).toEqual(['Rauch Dach', 'Rettung', 'Dach', ''])
  })

  it('a table row moves too — the fixed Absprachepunkte stay where they are', () => {
    const commits: BoardFormData[] = []
    render(<Harness vehicles={['TLF', 'ADF', 'MTF']} onCommit={(d) => commits.push(d)} />)
    const formation = () => [...document.querySelectorAll<HTMLTextAreaElement>('[data-sec="mittel"] textarea[aria-label="Formation"]')]
    act(() => { formation()[2].focus() })
    key('ArrowUp', { altKey: true })
    expect(formation().map((t) => t.value)).toEqual(['TLF', 'MTF', 'ADF', ''])
    // a written row under the Abspracherapport can move among the written ones only
    const abs = document.querySelector('[data-sec="absprachen"]')!
    const bez = () => [...abs.querySelectorAll<HTMLTextAreaElement>('textarea[aria-label="Bezeichnung"]')]
    act(() => { bez()[0].focus() }); type('Heli'); key('Enter')
    act(() => { bez()[1].focus() }); type('Depot'); key('Enter')
    act(() => { bez()[1].focus() })
    key('ArrowUp', { altKey: true }); key('ArrowUp', { altKey: true })
    expect(bez().map((t) => t.value)).toEqual(['Depot', 'Heli', ''])
    expect(abs.textContent).toMatch(/Warteraum[\s\S]*Depot/) // still under the six
  })

  it('Shift+Enter is a line break inside a Problemerfassung entry, kept on commit', () => {
    const commits: BoardFormData[] = []
    render(<Harness onCommit={(d) => commits.push(d)} />)
    act(() => { box('front').querySelector<HTMLTextAreaElement>('[data-kn]')!.focus() })
    const ev = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true, bubbles: true })
    act(() => { active().dispatchEvent(ev) })
    expect(ev.defaultPrevented).toBe(false) // the textarea makes the break itself
    type('Rauch\nBrand Dach'); key('Enter')
    expect(commits[commits.length - 1].values.problem.lines!.front![0].text).toBe('Rauch\nBrand Dach')
  })

  it('beside a taller neighbour a table gets more rulings of the standard height — never a stretched row', () => {
    // the browser's layout, as jsdom has none: the Verbindungen' leftover is 240px, a ruling 45px
    class RO { constructor(private cb: () => void) {} observe() {} disconnect() {} }
    vi.stubGlobal('ResizeObserver', RO)
    const ch = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.fill === 'verbindungen' ? 240 : this.dataset.fill ? 20 : 0
    })
    const oh = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => 45)
    try {
      const commits: BoardFormData[] = []
      render(<Harness onCommit={(d) => commits.push(d)} />)
      const fillBox = document.querySelector('[data-fill="verbindungen"]')!
      expect(fillBox.querySelectorAll('[role="presentation"]').length).toBe(5) // 240 / 45 → five whole rulings
      // less than one ruling left: plain space, no row
      expect(document.querySelector('[data-fill="massnahmen"]')!.children.length).toBe(0)
      // no row anywhere is given a height of its own
      expect([...document.querySelectorAll<HTMLElement>('[role="row"]')].every((r) => !r.style.height && !r.style.minHeight)).toBe(true)
      // …and a tap on one of them writes in the empty row, directly under the entries
      act(() => { fireEvent.click(fillBox.querySelectorAll('[role="presentation"]')[2].querySelector('[data-col="kanal"]')!) })
      type('K1'); key('Enter')
      const rows = commits[commits.length - 1].values.verbindungen.rows!
      expect(rows.map((r) => r.cells.kanal)).toEqual(['K1'])
    } finally { ch.mockRestore(); oh.mockRestore(); vi.unstubAllGlobals() }
  })

  it('«Drucken» sits next to the delete: this page — and with more pages, «Alle Seiten» too', () => {
    const printed: boolean[] = []
    const data = newFormPage(FKS, EF, {}, '2026-10-10T09:24:00.000Z')
    const props = { pageKey: 'p', data, readOnly: true, isPhone: false, onChange: () => {}, onRemove: () => {}, inset: { top: 0, left: 0, right: 0, bottom: 0 }, onPrint: (all: boolean) => printed.push(all) }
    const { rerender } = render(<TafelFormPage {...props} pageCount={1} />)
    // on a closed Einsatz too: the paper is a reading
    act(() => { fireEvent.click(screen.getByRole('button', { name: /Drucken/ })) })
    expect(printed).toEqual([false])
    rerender(<TafelFormPage {...props} pageCount={3} />)
    act(() => { fireEvent.click(screen.getByRole('button', { name: /Drucken/ })) })
    act(() => { fireEvent.click(screen.getByRole('menuitem', { name: 'Alle Seiten (3)' })) })
    expect(printed).toEqual([false, true])
  })

  // RBAC audit 22.10.2026: a locked page READS the Tendenz — the arrow in full tone, no button,
  // and nothing to tap where none was set
  it('a locked page shows a line’s Tendenz as a read-out, not a faded button', () => {
    let data = newFormPage(FKS, EF, {}, '2026-10-10T09:24:00.000Z')
    data = putLine(data, 'problem', 'front', 'l1', { text: 'Rauch', trend: 'up' })
    data = putLine(data, 'problem', 'front', 'l2', { text: 'Wasser' })
    render(<TafelFormPage pageKey="p" data={data} readOnly isPhone={false} onChange={() => {}} onRemove={() => {}}
      inset={{ top: 0, left: 0, right: 0, bottom: 0 }} />)
    const front = within(box('front') as HTMLElement)
    expect(front.queryAllByRole('button')).toEqual([])
    const arrow = front.getByRole('img', { name: appConfig.copy.tafel.trendUp })
    expect(arrow.getAttribute('data-trend')).toBe('up')
    expect(box('front').querySelectorAll('[data-trend]')).toHaveLength(1)
  })

  // re-review of #338
  it('a cell holds 2000 characters and says so calmly when it is full', () => {
    render(<Harness onCommit={() => {}} />)
    const was = document.querySelector<HTMLTextAreaElement>('[data-sec="massnahmen"] [data-kn$="|was"]')!
    expect(was.maxLength).toBe(2000)
    act(() => { was.focus() })
    type('x'.repeat(2000))
    expect(screen.getByRole('status').textContent).toMatch(/2000 Zeichen/)
  })

  // re-review of #338
  it('typing over a value another device wrote meanwhile: the later stands, and it is said', () => {
    const base = putRow(newFormPage(FKS, EF, {}, '2026-10-10T09:24:00.000Z'), 'massnahmen', 'm1', { cells: { was: 'Riegel' } })
    const clashes: string[][] = []
    const props = { pageKey: 'p', readOnly: false, isPhone: false, onRemove: () => {}, inset: { top: 0, left: 0, right: 0, bottom: 0 }, onChange: () => {}, onConflict: (w: string, k: string, l: string) => clashes.push([w, k, l]) }
    const { rerender } = render(<TafelFormPage {...props} data={base} />)
    const was = () => document.querySelector<HTMLTextAreaElement>('[data-sec="massnahmen"] [data-k="massnahmen||m1|was"]')!
    act(() => { was().focus() })
    type('Riegel Seite C')
    // …meanwhile the other tablet's «Riegel Seite B» lands for the same cell
    rerender(<TafelFormPage {...props} data={putRow(base, 'massnahmen', 'm1', { cells: { was: 'Riegel Seite B' } })} />)
    key('Enter')
    expect(clashes).toEqual([['Massnahmen · Was/Wo', 'Riegel Seite C', 'Riegel Seite B']])
    // a cell nobody else touched writes quietly
    act(() => { was().focus() })
    type('Riegel Seite D'); key('Enter')
    expect(clashes).toHaveLength(1)
  })

  // review of #339
  it('a drag commits against the data as it stands at the drop, not as it was at the grab', () => {
    const MN = EF.sections.find((x) => x.id === 'massnahmen') as TableSection
    let base = newFormPage(FKS, EF, {}, '2026-10-10T09:24:00.000Z')
    for (const [id, was] of [['m1', 'A'], ['m2', 'B'], ['m3', 'C']]) base = putRow(base, 'massnahmen', id, { cells: { was } }, 1)
    const commits: BoardFormData[] = []
    const props = { pageKey: 'p', readOnly: false, isPhone: false, onRemove: () => {}, inset: { top: 0, left: 0, right: 0, bottom: 0 }, onChange: (d: BoardFormData) => commits.push(d) }
    const { rerender } = render(<TafelFormPage {...props} data={base} />)
    const grip = document.querySelector<HTMLElement>('[data-ord-list][data-ord-id="m1"] button[aria-label^="Verschieben"]')!
    // A grabbed and dragged below C (jsdom has no layout: every row's middle is 0)
    act(() => { fireEvent.pointerDown(grip, { clientY: 0 }) })
    act(() => { window.dispatchEvent(new MouseEvent('pointermove', { clientY: 100 }) as PointerEvent) })
    // …meanwhile another device rewrites B and adds D
    const remote = putRow(putRow(base, 'massnahmen', 'm2', { cells: { was: 'B2' } }, 2), 'massnahmen', 'm4', { cells: { was: 'D' } }, 2)
    rerender(<TafelFormPage {...props} data={remote} />)
    act(() => { window.dispatchEvent(new MouseEvent('pointerup', { clientY: 100 }) as PointerEvent) })
    expect(commits).toHaveLength(1)
    const rows = writtenRows(commits[0], MN)
    // nothing of the other device's is lost, and A lands right after C, where it was dropped
    expect(rows.map((r) => r.cells.was)).toEqual(['B2', 'C', 'A', 'D'])
  })

  it('Alt+Enter is a line break inside the cell, not a move', () => {
    render(<Harness onCommit={() => {}} />)
    act(() => { box('ordnung').querySelector<HTMLTextAreaElement>('[data-kn]')!.focus() })
    type('R-Achse')
    const el = active()
    el.setSelectionRange(7, 7)
    key('Enter', { altKey: true })
    expect(active()).toBe(el)
    expect(el.value).toBe('R-Achse\n')
  })
})

// F10 (20.10.2026, owner: «with keyboard / desktop type, otherwise wheel»): a «Wann» under a finger
// opens THE time picker; under a mouse it stays a cell you type «1124» into
describe('a Tafel time cell', () => {
  const W = appConfig.copy.wheel
  const pointer = (coarse: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({
    matches: coarse && q === '(pointer: coarse)', addEventListener: () => {}, removeEventListener: () => {},
  }))
  afterEach(() => vi.unstubAllGlobals())
  const firstWann = () => document.querySelector('[data-sec="mittel"]')!.querySelectorAll<HTMLTextAreaElement>('[aria-label="Wann"]')[0]

  it('opens the wheels on a tap with a coarse pointer, keeps the soft keyboard down, and «Jetzt» is one commit', () => {
    pointer(true)
    const commits: BoardFormData[] = []
    render(<Harness onCommit={(d) => commits.push(d)} />)
    const wann = firstWann()
    expect(wann.getAttribute('inputmode')).toBe('none')
    fireEvent.click(wann)
    const pop = screen.getByRole('dialog')
    expect(within(pop).getByLabelText(W.hour)).toBeTruthy()
    fireEvent.click(within(pop).getByRole('button', { name: W.now }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(commits).toHaveLength(1)
    expect(commits[0].values.mittel.rows![0].cells.wann).toMatch(/^\d\d:\d\d$/)
    expect(wann.value).toBe(commits[0].values.mittel.rows![0].cells.wann)
  })

  // F10 rework (21.10.2026): the line-break key's 48px reserve stayed on a focused time cell and
  // left «--:--» one character per line in the 67px «Wann» column
  it('keeps its width when focused on touch — no line-break reserve', () => {
    pointer(true)
    render(<Harness onCommit={() => {}} />)
    const wann = firstWann()
    fireEvent.focus(wann)
    expect(wann.className).not.toContain(s.cellBreak)
    expect(screen.queryByRole('button', { name: appConfig.copy.tafel.lineBreak })).toBeNull()
  })

  it('stays a typed cell with a fine pointer — no wheels on a click', () => {
    pointer(false)
    render(<Harness onCommit={() => {}} />)
    const wann = firstWann()
    expect(wann.getAttribute('inputmode')).toBe('numeric')
    fireEvent.click(wann)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

// owner, 28.10.2026: «make each column a little bit wider … to not have that many word breaks»
describe('colMinScale · a phone column’s minimum follows its weight', () => {
  it('scales text columns by weight within 1.25×–2.5×; sized columns keep 1×', () => {
    // the Erste Führung's Verbindungen: Funktion 3.3 · Kanal 0.9 · Rufname 2.15 · Wann (time)
    expect(colMinScale([{ id: 'f', label: '', w: 3.3 }, { id: 'k', label: '', w: 0.9 }, { id: 'r', label: '', w: 2.15 }, { id: 'w', label: '', type: 'time' }]))
      .toEqual([2.5, 1.25, 2.39, 1])
    // the Rapport's Traktanden: the index disc stays out of the reference
    expect(colMinScale([{ id: 'n', label: '', type: 'index', w: 0.5 }, { id: 't', label: '', w: 4 }, { id: 'w', label: '', w: 2 }]))
      .toEqual([1, 2, 1.25])
  })
})

// owner pick 7A, 05.11.2026: the bin at the end of the row one stands in; a checklist problem
// wears its mark, keeps the checklist's words, and its deletion is said as an un-tick
describe('deleting a row, and a problem from the checklist', () => {
  const P81 = FKS.pages.find((p) => p.id === 'problem-tendenz')!
  const view = () => {
    const d = putRow(newFormPage(FKS, P81, {}, '2026-11-05T14:00:00.000Z'), 'probleme', 'r1', { cells: { problem: 'Bus 61 blockiert', bereich: 'ordnung' } })
    return { ...d, values: { probleme: { rows: [...d.values.probleme.rows!, { id: 'ck~pe~f3', cells: { problem: 'Energieträger', bereich: 'front' }, src: 'checklist' as const }] } } }
  }

  it('a checklist problem is marked, its words read-only; its bin hands back the page without it, said as from the checklist', () => {
    const onChange = vi.fn()
    render(<TafelFormPage pageKey="fm-p" data={view()} readOnly={false} isPhone={false} onRemove={() => {}} inset={{ top: 0, left: 0, right: 0, bottom: 0 }} onChange={onChange} />)
    const T = appConfig.copy.tafel
    expect(screen.getAllByRole('img', { name: T.fromChecklist })).toHaveLength(1)
    const words = screen.getByDisplayValue('Energieträger') as HTMLTextAreaElement
    expect(words.readOnly).toBe(true)
    expect(screen.getByDisplayValue('Bus 61 blockiert')).toHaveProperty('readOnly', false)
    const row = words.closest('[role="row"]') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: T.deleteRow }))
    expect(onChange).toHaveBeenCalledTimes(1)
    const [next, act] = onChange.mock.calls[0]
    expect((next as BoardFormData).values.probleme.rows!.map((r) => r.id)).toEqual(['r1'])
    expect(act).toEqual({ removed: 'Energieträger', from: 'checklist' })
  })

  it('a typed draft in the deleted row is not written back on its way out', () => {
    const onChange = vi.fn()
    render(<TafelFormPage pageKey="fm-p" data={view()} readOnly={false} isPhone={false} onRemove={() => {}} inset={{ top: 0, left: 0, right: 0, bottom: 0 }} onChange={onChange} />)
    const bus = screen.getByDisplayValue('Bus 61 blockiert') as HTMLTextAreaElement
    act(() => { bus.focus() })
    fireEvent.change(bus, { target: { value: 'Bus 61 und 62 blockiert' } })
    fireEvent.click(within(bus.closest('[role="row"]') as HTMLElement).getByRole('button', { name: appConfig.copy.tafel.deleteRow }))
    expect(onChange).toHaveBeenCalledTimes(1) // the deletion only – no commit of the draft beside it
    expect(onChange.mock.calls[0][1]).toEqual({ removed: 'Bus 61 blockiert' })
  })
})
