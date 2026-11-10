import { describe, expect, it } from 'vitest'
import { formAnno, newFormPage, putLine } from './boardForm'
import { BUNDLED_TEMPLATES } from './boardTemplates'
import { tafelKindPrints, tafelMenuKinds, tafelPrintKinds } from './tafelPicks'

const FKS = BUNDLED_TEMPLATES[0]
const page = (id: string) => FKS.pages.find((p) => p.id === id)!
const blank = (id: string, at: string) => formAnno(newFormPage(FKS, page(id), {}, at))
const ef = formAnno(putLine(newFormPage(FKS, page('ef'), {}, '2026-11-09T10:00:00.000Z'), 'problem', 'front', 'l1', { text: 'Rauch im Treppenhaus' }))

describe('the Tafel pages in the print menu (picker B, 09.11.2026)', () => {
  it('lists one entry per kind of page, with how many and whether anything is on them', () => {
    const kinds = tafelPrintKinds([ef, blank('konzept', '2026-11-09T10:01:00.000Z'), blank('konzept', '2026-11-09T10:02:00.000Z')])
    expect(kinds.map(({ id, count, filled }) => ({ id, count, filled }))).toEqual([
      { id: 'ef', count: 1, filled: true },
      { id: 'konzept', count: 2, filled: false },
    ])
  })

  it('always offers the Erste Führung first and the Rapport last, as placeholders when absent', () => {
    const rows = tafelMenuKinds(tafelPrintKinds([blank('konzept', '2026-11-09T10:01:00.000Z')]))
    expect(rows.map((k) => [k.id, k.count])).toEqual([['ef', 0], ['konzept', 1], ['rapport', 0]])
    expect(rows.map((k) => tafelKindPrints(k, { ef: true, rapport: true }))).toEqual([false, false, false])
  })

  it('defaults a filled page on, an empty one off for good, and the Rapport off until ticked', () => {
    const [efKind, rapport, emptyEf] = [
      ...tafelPrintKinds([ef, blank('rapport', '2026-11-09T10:05:00.000Z')]),
      ...tafelPrintKinds([blank('ef', '2026-11-09T10:00:00.000Z')]),
    ]
    expect([tafelKindPrints(efKind), tafelKindPrints(rapport), tafelKindPrints(emptyEf)]).toEqual([true, false, false])
    expect([tafelKindPrints(efKind, { ef: false }), tafelKindPrints(rapport, { rapport: true }), tafelKindPrints(emptyEf, { ef: true })]).toEqual([false, true, false])
  })
})
