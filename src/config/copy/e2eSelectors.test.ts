import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { de } from './de'

// The e2e specs address the app the way an operator does: by the German words on
// screen. That makes every `getByRole('button', { name: 'Karte' })` a second,
// invisible reference to copy/de.ts — one that nothing type-checks, because it is
// a string literal in a file the app never imports.
//
// Renaming a label therefore breaks the browser suite silently: `pnpm test`, `tsc`
// and `eslint` all stay green and the failure only appears minutes later in CI, as a
// timeout on a locator that no longer matches anything. In kp-rück that cost seven
// red @smoke specs — and because the broken locator sat in a page object, the log
// read like a regression in the surface it guarded rather than a copy change.
//
// This test closes that gap in the cheap suite: every human-readable string the e2e
// specs select by must still exist in the German catalogue. It does not check that
// the RIGHT string is used — only that the string is still one the app can render.

const E2E_DIR = join(import.meta.dirname, '..', '..', '..', 'e2e')

/** Strings the specs pass to a locator that do NOT come from copy/de.ts. Each one
 *  needs a reason: if it is not seed data or a fixture, it belongs in the catalogue. */
const NOT_COPY = new Map<string, string>([
  ['Tafel', 'plan `code` from the seeded object plans (src/data/demoIncident.ts), not copy'],
  ['E2E Smoke Test', 'the incident title the smoke test types in itself'],
  ['Schlüsselhülse zugänglich', 'a checklist item of the visit template object-visits.spec uploads itself'],
  ['Grob gereinigt', 'a checklist item of the visit template object-visits.spec uploads itself'],
  ['Was betrifft es?', 'a checklist item of the place template (Fehlermeldung) object-visits.spec uploads itself'],
  ['Hydrant', 'a choice option of the place template object-visits.spec uploads itself'],
  ['Beschreibung', 'a checklist item of the place template object-visits.spec uploads itself'],
  ['Vor dem nächsten Einsatz nötig?', 'a checklist item of the place template object-visits.spec uploads itself'],
  ['Hydrant · Neuer Hydrant fehlt im Plan', 'the answers object-visits.spec gives the place template, as the visit card sums them up'],
  ['Perf Meldung 10', 'the Meldung the performance journeys type in themselves (e2e/journeys.journey.ts)'],
  ['Lernen · Karte – die Lage zeichnen', 'the Lern-Übung\'s title, composed by the server from «Lernen · » and the tutorial\'s title (backend tutorial_seed · lern_title; both halves are copy)'],
])

/** Locator calls that take a user-visible string. `locator('text=…')` is included
 *  because the smoke spec uses it, and it fails exactly the same way. */
const SELECTOR_CALLS =
  /(?:getByRole\([^)]*?\bname:\s*|getByText\(|getByPlaceholder\(|getByLabel\(|getByTitle\(|getByAltText\(|locator\(\s*['"`]text=)\s*(['"`])(.+?)\1/gs

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return tsFiles(full)
    return entry.endsWith('.ts') ? [full] : []
  })
}

/** Every string the catalogue can render, including the arrays and nested objects. */
function copyValues(node: unknown, out = new Set<string>()): Set<string> {
  if (typeof node === 'string') out.add(node)
  else if (Array.isArray(node)) node.forEach((v) => copyValues(v, out))
  else if (node && typeof node === 'object') Object.values(node).forEach((v) => copyValues(v, out))
  return out
}

/** A copy string carrying {placeholders} can never match a literal, so compare it
 *  as the pattern it is: «Symbol «{name}» gesetzt» matches «Symbol «Brand» gesetzt».
 *
 *  The catch that made the first version of this test useless: templates like
 *  «{role}» or «{group} {n}» are almost entirely placeholder, so as a regex they
 *  match any word and every renamed label looked «known». A template only counts as
 *  evidence when its own words carry the match — at least four fixed characters, and
 *  at least half of what it is being matched against. */
function matchesTemplate(literal: string, template: string): boolean {
  if (!template.includes('{')) return false
  const fixed = template.split(/\{[^}]*\}/)
  const fixedLength = fixed.join('').length
  if (fixedLength < 4 || fixedLength * 2 < literal.length) return false
  const rx = fixed.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+?')
  return new RegExp(`^${rx}$`).test(literal)
}

describe('the e2e specs select by strings the app still renders', () => {
  const values = copyValues(de)
  const templates = [...values].filter((v) => v.includes('{'))

  const used = tsFiles(E2E_DIR).flatMap((file) => {
    const src = readFileSync(file, 'utf8')
    return [...src.matchAll(SELECTOR_CALLS)].map(([, , literal]) => ({
      file: file.slice(file.indexOf('/e2e/') + 1),
      literal,
    }))
  })

  it('finds the selectors at all — a silent zero would make this test a no-op', () => {
    expect(used.length).toBeGreaterThan(5)
  })

  it.each([...new Set(used.map((u) => u.literal))])('«%s» is still in copy/de.ts', (literal) => {
    if (NOT_COPY.has(literal)) return
    const known = values.has(literal) || templates.some((t) => matchesTemplate(literal, t))
    const where = used.filter((u) => u.literal === literal).map((u) => u.file)
    expect(
      known,
      `${[...new Set(where)].join(', ')} selects by «${literal}», which copy/de.ts no longer ` +
        'contains. Point the spec at the new label, or add it to NOT_COPY with a reason.',
    ).toBe(true)
  })
})
