import { findForms, formHasContent, type BoardFormData } from './boardForm'
import { labelText } from './boardTemplate'
import { problemRegister, problemView, type ProblemSource } from './problemLink'
import type { BoardAnno } from '../types'

// Which of the Tafel's pages go into the Rapport PDF (owner, 09.11.2026 – mock nov09-fks-blaetter,
// picker B): every KIND of page is its own tick in the print menu, beside the Kroki and the Gebäude –
// «Erste Führung», «Rapport (Traktanden)», «Konzept (2)» … – where there used to be one «Tafel –
// Seiten» for all of them. The defaults follow the data: a page prints while something is on it,
// and the Rapport sheet (the agenda for the NEXT rapport, mostly pre-printed) only when asked for.
// The ReportPreflight menu lists `tafelPrintKinds`; reportPdfDirect · tafelPayload filters with
// `tafelKindPrints`, so the menu and the paper can never disagree.

/** The FKS template's page ids that have a fixed place in the menu, present or not. */
export const EF_PAGE_ID = 'ef'
export const RAPPORT_PAGE_ID = 'rapport'

/** One kind of page on the Tafel, as the print menu lists it. `filled`: anything on any page of
 *  that kind – written, a checklist problem shown on it, or a live list (the Pendenzen page). */
export interface TafelPrintKind { id: string; title: string; count: number; filled: boolean }

const pageFilled = (d: BoardFormData) => formHasContent(d) || d.page.sections.some((s) => s.type === 'live' && !s.hidden)

/** The kinds of page on the Tafel, in the order the first of each was added. Filledness is judged
 *  on the page as it is DRAWN (lib/problemLink · problemView), so an Erste Führung whose only
 *  problems are ticked checklist items still counts as filled. */
export function tafelPrintKinds(annos: readonly BoardAnno[], problems?: ProblemSource, locale?: string): TafelPrintKind[] {
  const forms = findForms(annos)
  const register = problemRegister(forms, problems)
  const kinds = new Map<string, TafelPrintKind>()
  for (const a of forms) {
    const { id, title } = a.form.page
    const k = kinds.get(id) ?? { id, title: labelText(title, locale), count: 0, filled: false }
    kinds.set(id, { ...k, count: k.count + 1, filled: k.filled || pageFilled(problemView(a, forms, problems, register)) })
  }
  return [...kinds.values()]
}

/** Whether a kind of page prints: the operator's own tick (`picks`, by page id), else the default.
 *  An empty page never prints (its tick is disabled, like «Fotos (0)») – except the Rapport sheet,
 *  which is a form to fill by hand and so is always offered, but off until ticked. */
export function tafelKindPrints(kind: TafelPrintKind | undefined, picks?: Readonly<Record<string, boolean>>): boolean {
  if (!kind || kind.count === 0) return false
  const isRapport = kind.id === RAPPORT_PAGE_ID
  if (!isRapport && !kind.filled) return false
  return picks?.[kind.id] ?? !isRapport
}

/** The print menu's rows: the Erste Führung first and the Rapport sheet last, both always – a
 *  placeholder with `count: 0` (disabled) when the Tafel has none – and every other kind between
 *  them, in the Tafel's order. */
export function tafelMenuKinds(kinds: readonly TafelPrintKind[]): TafelPrintKind[] {
  const fixed = (id: string) => kinds.find((k) => k.id === id) ?? { id, title: '', count: 0, filled: false }
  return [fixed(EF_PAGE_ID), ...kinds.filter((k) => k.id !== EF_PAGE_ID && k.id !== RAPPORT_PAGE_ID), fixed(RAPPORT_PAGE_ID)]
}
