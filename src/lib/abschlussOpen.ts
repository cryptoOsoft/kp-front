import { appConfig } from '../config/appConfig'
import { fillTemplate, formatTime } from './format'
import type { AbschlussStep } from './abschluss'
import type { ConfirmItem } from './overlays/ConfirmCard'
import type { Trupp } from '../types'
import type { ReportMeta } from './workspace'
import { truppLogName } from './atemschutz'

/**
 * The still-open points of «Einsatz abschliessen», as things you can TAP.
 *
 * The print side has said them as links since the `ConfirmItem` list went in: «Noch offen:
 * Zeiten» named the gap, the operator closed the dialog and then hunted for the Zeiten
 * themselves. The Abschluss confirm — the other door onto the same list, and the one that ends
 * the Einsatz — was still plain text (18.09.2026). Same failure, worse moment: it is the last
 * screen before the Akte closes.
 *
 * So the list lives here, once, and both callers ask it for rows — through ONE builder since
 * 31.10.2026 (`abschlussSheet`): same order, same in-place answers on both. The Abschluss knows
 * about two open points the Rapport's own «noch offen» chips do not — a Trupp nobody reported back
 * in, and captures still sitting on this device — and those get targets too.
 */
export type AbschlussOpenPoint =
  | { kind: 'step'; step: AbschlussStep }
  /** Trupps still recorded as being out there (lib/atemschutz · truppStillDeployed) */
  | { kind: 'trupps'; n: number }
  /** photos/audio still in this device's upload queue */
  | { kind: 'media'; n: number }

/** Where each kind of open point is answered. Every kind has one — see the note on `media`. */
export interface AbschlussOpenTargets {
  /** open the Rapport ON that Mindestangabe (ReportPreflight · requestReportStep) */
  step: (step: AbschlussStep) => void
  /** the Atemschutz-Tafel, where a Trupp is reported back in */
  trupps: () => void
  /** ⚠️ Not a surface: an upload is answered by getting a connection, so the target is the
   *  Bereitschaft sheet — the one place that says what is still outstanding and carries «Jetzt
   *  synchronisieren». There is nothing else to point at, and pointing at nothing was the bug. */
  media: () => void
}

export function abschlussOpenPoints(
  missing: AbschlussStep[], truppsStillOut: number, pendingMedia: number,
): AbschlussOpenPoint[] {
  return [
    ...missing.map((step): AbschlussOpenPoint => ({ kind: 'step', step })),
    ...(truppsStillOut > 0 ? [{ kind: 'trupps', n: truppsStillOut } as const] : []),
    ...(pendingMedia > 0 ? [{ kind: 'media', n: pendingMedia } as const] : []),
  ]
}

/** The targets a list needs: `step` always (a step's own button may leave for its field), `trupps`
 *  and `media` only where such a point can be on it — the print's list carries Mindestangaben only,
 *  so it is not asked for a Tafel it never points at. */
export type OpenTargetsFor<P extends AbschlussOpenPoint> = Pick<AbschlussOpenTargets, P['kind'] | 'step'>

/** What a point is CALLED — the same words the Rapport's chips and the print warning use. */
export function abschlussOpenLabel(p: AbschlussOpenPoint): string {
  const P = appConfig.copy.preflight
  switch (p.kind) {
    case 'step': return appConfig.copy.abschluss.steps[p.step]
    case 'trupps': return fillTemplate(P.truppsDeployedConfirm, { n: p.n })
    case 'media': return fillTemplate(P.pendingMediaConfirm, { n: p.n })
  }
}

/**
 * Does this point make the Abschluss an «trotzdem»?
 *
 * ⚠️ Pending media does NOT (unchanged): it is a fact about this device, not a gap in the
 * record, and the Abschluss drains the queue itself before it hands over. It is on the list
 * because the operator is about to walk away, not because something is missing.
 */
export const countsAsOpen = (p: AbschlussOpenPoint): boolean => p.kind !== 'media'

/**
 * Settle a Mindestangabe IN the sheet (3am sweep, 23.10.2026, owner's point 4): the row's button
 * writes the answer to the Rapport and the sheet stays open. `(step, over, answer)` — the caller
 * writes `over` the way the Rapport's own «Entfällt» would and keeps the step as answered with
 * that word (the row stays, done).
 */
export type AbschlussFix = (step: AbschlussStep, over: Partial<ReportMeta>, answer: string) => void

/**
 * What a step's BUTTON does. Four answer in place («Jetzt setzen», «Nichts verwendet»,
 * «Entfällt» ×2 — the same writes the Rapport's own buttons make, so `normalizeReportMeta`
 * reads them the same way); two need the operator's words or a name and go to the field,
 * focused («Wählen», «Schreiben» — `leaves`). Anwesenheit and Abweichungen have no one-tap
 * answer: a head count is counted and a divergence is decided, both on their own surfaces.
 */
export function abschlussStepAction(step: AbschlussStep, go: Pick<AbschlussOpenTargets, 'step'>, fix: AbschlussFix, now: () => string): ConfirmItem['action'] {
  const F = appConfig.copy.abschluss.fix
  switch (step) {
    case 'zeiten': return { label: F.zeiten, onClick: () => fix(step, { endedAt: now() }, F.zeiten) }
    case 'mittel': return { label: F.mittel, onClick: () => fix(step, { mittelConfirmedNone: true }, F.mittel) }
    case 'kontaktperson': return { label: F.kontaktperson, onClick: () => fix(step, { kontaktperson: undefined, kontaktpersonTelefon: undefined, kontaktpersonNone: true }, F.kontaktperson) }
    case 'rueckmeldung': return { label: F.rueckmeldung, onClick: () => fix(step, { rueckmeldungElz: undefined, rueckmeldungNone: true }, F.rueckmeldung) }
    case 'einsatzleiter': return { label: F.einsatzleiter, onClick: () => go.step(step), leaves: true }
    case 'kurzbericht': return { label: F.kurzbericht, onClick: () => go.step(step), leaves: true }
    case 'anwesenheit':
    case 'abweichungen': return undefined
  }
}

/** The rows the confirm renders. Tapping one resolves the ask `false` (going there is not going
 *  ahead) and then navigates — see overlays/ConfirmCard · ConfirmItem. With a `fix`, each step
 *  row also carries its button (abschlussStepAction); `settled` rows (answered in this sheet)
 *  stay in place as the record of it — a check and the answer's word, still a link. */
export function abschlussOpenItems<P extends AbschlussOpenPoint>(
  points: P[], go: OpenTargetsFor<P>,
  opts?: { fix: AbschlussFix; now: () => string; settled?: ReadonlyMap<AbschlussStep, string> },
): ConfirmItem[] {
  // the signature guarantees a target for every kind in `points`; read as optional only because a
  // generic Pick does not narrow per point
  const to: Partial<AbschlussOpenTargets> = go
  return points.map((p) => {
    const onClick = () => {
      if (p.kind === 'step') go.step(p.step)
      else if (p.kind === 'trupps') to.trupps?.()
      else to.media?.()
    }
    const answer = p.kind === 'step' ? opts?.settled?.get(p.step) : undefined
    if (answer) return { label: abschlussOpenLabel(p), end: answer, done: true, onClick }
    const action = p.kind === 'step' && opts ? abschlussStepAction(p.step, go, opts.fix, opts.now) : undefined
    return { label: abschlussOpenLabel(p), onClick, ...(action ? { action } : {}) }
  })
}

/** One reading of a confirm's open points (`abschlussSheet`). */
export interface AbschlussSheetState {
  items: ConfirmItem[]
  /** something is still open that makes going ahead a «trotzdem» (`countsAsOpen`, minus the
   *  points answered in this sheet or pre-filled) – the caller words its lead, note and button by it */
  anyOpen: boolean
}

/**
 * The ONE list of open points, for BOTH confirms that show it (31.10.2026): «Einsatz
 * abschliessen» (useAbschluss) and «Angaben fehlen noch» in front of a PDF or a print
 * (ReportPreflight). The print built its own plain links, so the Material row said «Nichts
 * verwendet» on one and nothing on the other. Rows, order and in-place answers come from here;
 * the words around the list (title, lead, note, buttons) stay each confirm's own.
 *
 * Returns a READER: call it for the first spec and pass it again as the ask's `refresh`
 * (ConfirmSpec). A row answered in the sheet (`write` ran) stays in place as a done one, its
 * answer at the end — the reader remembers it, because `points` is the caller's render and does
 * not move while the ask stands. Without `write` (a session that may not edit the Rapport) the
 * rows are links only. `prefilled` puts the caller's own row in a step's place and counts that
 * step as answered: the Abschluss's Einsatzende «jetzt 23:41», which the close itself writes.
 */
export function abschlussSheet<P extends AbschlussOpenPoint>(
  points: P[], go: OpenTargetsFor<P>,
  opts: { write?: (over: Partial<ReportMeta>) => void; now: () => string; prefilled?: Partial<Record<AbschlussStep, ConfirmItem>> },
): () => AbschlussSheetState {
  const { write, now, prefilled = {} } = opts
  const settled = new Map<AbschlussStep, string>()
  const fix: AbschlussFix | undefined = write && ((step, over, answer) => {
    write(over)
    settled.set(step, answer)
  })
  const ownRow = (p: AbschlussOpenPoint) => (p.kind === 'step' ? prefilled[p.step] : undefined)
  return () => ({
    items: abschlussOpenItems(points, go, fix && { fix, now, settled }).map((row, i) => ownRow(points[i]) ?? row),
    anyOpen: points.some((p) => countsAsOpen(p) && !(p.kind === 'step' && (settled.has(p.step) || ownRow(p)))),
  })
}

/**
 * The pre-filled Einsatzende (owner's pick, 23.10.2026): «Einsatzende · jetzt 23:41», shown as
 * already set, with «Ändern». The close writes it (useAbschluss); «Ändern» writes it too and goes
 * to the Rapport's field — so the field shows the value being changed, not an empty one.
 */
export function abschlussEndeItem(iso: string, change: () => void): ConfirmItem {
  const A = appConfig.copy.abschluss
  return {
    label: A.ende,
    end: fillTemplate(A.endeNow, { t: formatTime(new Date(iso)) }),
    done: true,
    onClick: change,
    action: { label: A.endeChange, onClick: change, leaves: true },
  }
}

/**
 * The words on the Rapport head's ONE Kontrolle chip (23.09.2026): what is still open for the
 * Abschluss, and how many warnings about the record there are — «4 noch offen», «1 Hinweis»,
 * «2 Hinweise», «4 noch offen · 2 Hinweise». It used to read «{n} Hinweis(e)» for both summed,
 * so four missing Mindestangaben announced themselves as four «Hinweise» — a word for something
 * to note, on the things that have to be filled in.
 */
export function controlChipLabel(open: number, hints: number): string {
  const P = appConfig.copy.preflight
  return [
    open > 0 ? fillTemplate(P.controlOpen, { n: open }) : '',
    hints === 1 ? P.controlHint : hints > 1 ? fillTemplate(P.controlHints, { n: hints }) : '',
  ].filter(Boolean).join(' · ')
}

/**
 * The FIRST question in front of the Abschluss while crews are still inside (staging walk-through
 * 25.09.2026): «3 Trupps sind noch drin: Trupp 1 (…), Trupp 2 (…).» Every Trupp by its number and
 * its whole crew (truppLogName) — who is in the building is the one thing this sentence is for.
 * It used to be the 7th grey row of the paperwork list under a filled «Trotzdem abschliessen».
 */
export function insideAbschlussMessage(trupps: readonly Trupp[]): string {
  const A = appConfig.copy.abschluss
  const list = trupps.map((t) => fillTemplate(A.insideTrupp, { name: truppLogName(t) })).join(', ')
  return trupps.length === 1
    ? fillTemplate(A.insideOne, { list })
    : fillTemplate(A.insideMany, { n: trupps.length, list })
}

/**
 * The question in front of the Abschluss when Atemschutz-Trupps are still ANGEMELDET (24.09.2026,
 * D1 ⑦, lib/atemschutz · truppStillRegistered): «1 Trupp noch angemeldet (#6 Muster Leo,
 * Sicherungstrupp).» Each Trupp by its number and Gruppenführer — the number is what the Rapport
 * prints, the name is what people call it — and a Sicherungstrupp says that it is one, because
 * that is the crew this question almost always is about.
 */
export function registeredAbschlussMessage(trupps: readonly Trupp[]): string {
  const A = appConfig.copy.abschluss
  const list = trupps.map((t) => {
    const who = `${typeof t.no === 'number' ? `#${t.no} ` : ''}${t.name.trim()}`
    return t.auftrag === 'sichern' ? fillTemplate(A.registeredSafety, { name: who }) : who
  }).join(' · ')
  return trupps.length === 1
    ? fillTemplate(A.registeredOne, { list })
    : fillTemplate(A.registeredMany, { n: trupps.length, list })
}
