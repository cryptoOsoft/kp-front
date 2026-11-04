// THE shared-control ratchet (20.10.2026, Karte Haus round 3 · reuse audit `component-reuse-2026-10-19`,
// guardrail idea 1) – styleDebt.test.ts's twin for markup. The audit found every duplicate toggle,
// picker and search box arrived with a comment naming the shared piece it copied. Per file in
// src/components and src/workspace this counts the raw controls the shared pieces already are:
//   pressed – a `<button … aria-pressed>`: a toggle         → Segmented, Chip
//   select  – a native `<select>`                           → Menu (lib/overlays), Combo
//   search  – a `type="search"` field                       → SearchField
// and fails when a count goes UP, or a new file brings any. A count that went DOWN is a console
// note (sweep D.10, 23.10.2026) – lower BASELINE below when convenient; it only ever shrinks.
// A raw control that is genuinely right gets its reason in a comment beside it and its +1 here,
// in one commit.
import { globSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

type Metric = 'pressed' | 'select' | 'search'
type Counts = Partial<Record<Metric, number>>
const METRICS: Metric[] = ['pressed', 'select', 'search']

/** the shared pieces themselves: their raw control IS the one implementation */
const SHARED = [
  'src/components/Segmented.tsx',
  'src/components/Chip.tsx',
  'src/components/SearchField.tsx',
  'src/components/ToolDock.tsx',
  'src/components/NavRail.tsx',
]

/** the opening tags of `tag` in TSX – brace-aware, so an arrow's `=>` in an attribute doesn't end it */
function openTags(src: string, tag: string): string[] {
  const out: string[] = []
  for (const m of src.matchAll(new RegExp(`<${tag}\\b`, 'g'))) {
    let depth = 0
    let i = m.index + m[0].length
    for (; i < src.length; i++) {
      const c = src[i]
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
    }
    out.push(src.slice(m.index, i + 1))
  }
  return out
}

export function countControls(src: string): Counts {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const counts: Record<Metric, number> = {
    pressed: openTags(code, 'button').filter((t) => /\baria-pressed\b/.test(t)).length,
    select: openTags(code, 'select').length,
    search: (code.match(/type=["{']*search\b/g) ?? []).length,
  }
  const out: Counts = {}
  for (const m of METRICS) if (counts[m]) out[m] = counts[m]
  return out
}

// 20.10.2026: what stood when the ratchet went in. Lower it as surfaces move onto the shared pieces.
const BASELINE: Record<string, Counts> = {
  'src/components/AnwesenheitView.tsx': { pressed: 1 },
  'src/components/ArmedToolPill.tsx': { pressed: 1 },
  'src/components/AtemschutzView.tsx': { pressed: 1 },
  'src/components/BandGrid.tsx': { pressed: 1 },
  'src/components/ComboMenu.tsx': { pressed: 1 },
  // +1 (31.10.2026): the foot's «Erledigt» toggle – an action tile pressed in place, not a choice
  'src/components/ContextPanel.tsx': { pressed: 3 },
  'src/components/DrawEditor.tsx': { pressed: 1 },
  'src/components/GeorefMode.tsx': { pressed: 4 },
  'src/components/Journal.tsx': { pressed: 1 },
  'src/components/JournalComposer.tsx': { pressed: 1 },
  'src/components/LayerPanel.tsx': { pressed: 3 },
  'src/components/MapUtility.tsx': { pressed: 1 },
  'src/components/MapViewsMenu.tsx': { pressed: 3 },
  'src/components/MittelView.tsx': { pressed: 1 },
  'src/components/ReportPreflight.tsx': { pressed: 1 },
  'src/components/SelectionBar.tsx': { pressed: 2 },
  'src/components/ShapeEditor.tsx': { pressed: 1 },
  'src/components/ToolRail.tsx': { pressed: 2 },
  'src/components/TopBar.tsx': { pressed: 1 },
  'src/components/TruppSheets.tsx': { pressed: 2 },
  'src/components/TruppTeam.tsx': { pressed: 1 },
  'src/components/TwinTeamPill.tsx': { pressed: 2 },
  'src/components/WheelPicker.tsx': { pressed: 2, select: 1 },
  'src/components/karte/KarteApp.tsx': { pressed: 3 },
  'src/components/karte/KartePlans.tsx': { pressed: 3 },
  'src/components/panels/FeedbackSheet.tsx': { pressed: 1 },
  'src/workspace/MapToolDocks.tsx': { pressed: 1 },
}

const files = globSync('src/{components,workspace}/**/*.tsx', { cwd: process.cwd() })
  .filter((f) => !f.includes('.test.') && !f.includes('/admin/') && !SHARED.includes(f)).sort()
const current: Record<string, Counts> = Object.fromEntries(
  files.map((f) => [f, countControls(readFileSync(f, 'utf8'))] as const).filter(([, c]) => Object.keys(c).length))

describe('shared-control ratchet', () => {
  it('counts what it says', () => {
    expect(countControls(`
      // <select> in a comment is no control
      <button type="button" aria-pressed={on} onClick={() => set((o) => !o)}>A</button>
      <button type="button" onClick={go}>B</button>
      <select value={v} onChange={(e) => set(e.target.value)}><option /></select>
      <input type="search" /> <input type={'search'} />
    `)).toEqual({ pressed: 1, select: 1, search: 2 })
  })

  it('finds the components, and the shared pieces it allows are still there', () => {
    expect(files.length).toBeGreaterThan(100)
    for (const f of SHARED) expect(readFileSync(f, 'utf8').length, f).toBeGreaterThan(0)
  })

  it('no file has more raw controls than its baseline', () => {
    const up: string[] = []
    for (const [f, c] of Object.entries(current)) {
      for (const m of METRICS) {
        const was = BASELINE[f]?.[m] ?? 0
        if ((c[m] ?? 0) > was) up.push(`${f}: ${m} ${was} → ${c[m]}`)
      }
    }
    const down: string[] = []
    for (const [f, c] of Object.entries(BASELINE)) {
      for (const m of METRICS) {
        const now = current[f]?.[m] ?? 0
        if ((c[m] ?? 0) > now) down.push(`${f}: ${m} ${c[m]} → ${now}`)
      }
    }
    if (down.length) console.warn(`raw controls went away (${down.length}) – lower BASELINE in controlDebt.test.ts when convenient\n  ${down.join('\n  ')}`)
    expect(up, 'a new raw toggle/select/search: use Segmented/Chip, Menu/Combo or SearchField (docs/ui-conventions · Small roles)').toEqual([])
  })
})
