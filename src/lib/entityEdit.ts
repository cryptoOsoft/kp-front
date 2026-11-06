import { appConfig } from '../config/appConfig'
import { fillTemplate } from './format'
import { floorLabel } from './whiteboard'
import type { Entity } from '../types'
import { jsonEqual } from './jsonEqual'

/**
 * What changed on a tactical symbol, in words — the Verlauf line for editing the Kroki.
 *
 * The Kroki is the picture the Einsatz is led from, and until now the record said only that a
 * symbol had been PLACED, MOVED or REMOVED. Everything that happens to it in between — the
 * Stockwerk it turns out to be on, the name of the Einsatzleiter typed into its field, the
 * Anzahl going from one Person to three, an Ausbreitung appearing — was written straight into
 * the document with no row at all. So the Verlauf recorded the moment a symbol appeared and
 * then nothing, while the picture it describes went on changing for two hours.
 *
 * Pure, and it names the VALUE, never just the field: «Stockwerk geändert» sends a reader to the
 * replay to find out what it became, which is the one thing a printed record cannot do.
 *
 * ⚠️ Geometry is deliberately absent. Dragging, rotating and resizing happen continuously while
 * somebody arranges the picture; a row per nudge would bury the four or five edits that carry
 * meaning. `objectMoved` still logs a move as its own event, and the replay holds every frame.
 */
/** Prose as ONE Verlauf line: a note is typed with line breaks, and the Verlauf, the Rapport and
 *  the hash chain all read a row as a single string. Never truncated — the point of quoting the
 *  note is that the record holds what it said. */
const oneLine = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

export function entityEditChanges(prev: Entity, next: Entity): string[] {
  const L = appConfig.copy.log
  const out: string[] = []

  // ── the roster/attribute fields typed onto a symbol («Name», «Fahrer», «Stoff», «Status») ──
  // These are the ones somebody asks about afterwards: who was named as Einsatzleiter, and when.
  //
  // ⚠️ A field may be named after the symbol it sits on. «FW Gefahr allgemein» is labelled
  // «Gefahr» and its one preset field is called «Gefahr» too, and the caller wraps these lines
  // in `log.entityEdited` («{name}: {changes}») — so the record read «Gefahr: Gefahr: Wassertiefe
  // 10m». Where the field label IS the object's name the line names only what happened to it;
  // the name is already the first word of the row. General, not a rule about one symbol.
  const logName = entityLogName(next).trim().toLowerCase()
  const before = prev.fields ?? {}
  const after = next.fields ?? {}
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = (before[key] ?? '').trim()
    const b = (after[key] ?? '').trim()
    if (a === b) continue
    // Dropped from the TEMPLATE, not from the finished string: every locale's three templates
    // lead with {field}, so an empty one leaves exactly the statement («auf X geändert»,
    // «geleert»). `fieldSet` is «{field}: {value}» — minus the field that IS the bare value.
    const selfNamed = !!logName && key.trim().toLowerCase() === logName
    const field = selfNamed ? '' : key
    if (!b) out.push(fillTemplate(L.fieldCleared, { field }).trim())
    else if (selfNamed && !a) out.push(b)
    else out.push(fillTemplate(a ? L.fieldChanged : L.fieldSet, { field, value: b }).trim())
  }

  if ((prev.label ?? '').trim() !== (next.label ?? '').trim()) {
    const v = oneLine(next.label)
    // ⚠️ A Notiz keeps its TEXT in `label` — «Beschriftung «Gasflaschen im Keller»» is the record
    // calling the note's contents a caption. Same field, different thing, so a different word.
    const set = next.kind === 'note' ? L.noteWritten : L.labelSet
    const cleared = next.kind === 'note' ? L.notesCleared : L.labelCleared
    out.push(v ? fillTemplate(set, { value: v }) : cleared)
  }

  // ── Stockwerk: a single storey, or the range a Treppe/Lift covers ──
  if (prev.floor !== next.floor) {
    out.push(next.floor == null ? L.floorCleared : fillTemplate(L.floorSet, { value: floorLabel(next.floor) }))
  }
  if (prev.floorFrom !== next.floorFrom || prev.floorTo !== next.floorTo) {
    const from = next.floorFrom, to = next.floorTo
    out.push(from == null && to == null
      ? L.floorRangeCleared
      : fillTemplate(L.floorRangeSet, {
          from: from == null ? '–' : floorLabel(from),
          to: to == null ? '–' : floorLabel(to),
        }))
  }

  if ((prev.count ?? 1) !== (next.count ?? 1)) {
    out.push(fillTemplate(L.countSet, { n: String(next.count ?? 1) }))
  }

  // Ausbreitung is a statement about how the damage is developing — the shape of it belongs in
  // the picture, but that it was recorded at all belongs in the record.
  if (!jsonEqual(prev.spread ?? null, next.spread ?? null)) {
    out.push(next.spread ? L.spreadSet : L.spreadCleared)
  }

  // Free notes on a symbol — QUOTED (reversed 11.08.). They used to be «said, never quoted», on
  // the reasoning that the Verlauf is not a second copy of the picture. But a note is not part of
  // the picture: it is a sentence somebody wrote because the symbol could not say it, and «Notiz
  // erfasst» is a row announcing that a sentence exists somewhere else. On the printed Rapport —
  // where the picture is a static Kroki nobody can click — that row carried no information at all.
  if ((prev.notes ?? '').trim() !== (next.notes ?? '').trim()) {
    const v = oneLine(next.notes)
    out.push(v ? fillTemplate(L.noteWritten, { value: v }) : L.notesCleared)
  }

  return out
}

/** One open edit window: the state it STARTED in, the freshest state seen, and its timer. */
export interface EditSettle<T> {
  /** report one edit — opens a window, or keeps the open one's base and pushes its close out */
  push(id: string, before: T, after: T): void
}

/**
 * A settle window per object: one Verlauf row per EDIT, written once the editing stops.
 *
 * The inspector writes on every keystroke, so a row per patch is a row per character typed into a
 * name field. The row is composed from the state the editing STARTED in against the freshest one
 * seen — per object, so editing two symbols in the same four seconds stays two rows about two
 * things.
 *
 * ⚠️ `stillEditing` is what makes the window a WINDOW rather than a timeout (04.09.). A plain
 * settle assumes a pause means «done», and a sentence typed on a tablet is nothing but pauses —
 * a Notiz went into the 03.09. Rapport as «Notiz «1 Roller in en»», «…in ennen» and «…innen»,
 * three rows of one sentence. While the caller says the edit is still going on, the window
 * re-arms instead of closing; last value wins. The Rapportangaben logger solved the same problem
 * the same way (IncidentWorkspace · saveReportMeta), which is why this is one mechanism.
 */
export function createEditSettle<T>({ ms, stillEditing, onSettled }: {
  ms: number
  /** is this object still being edited right now? — asked when the window would close */
  stillEditing: (id: string) => boolean
  onSettled: (id: string, base: T, latest: T) => void
}): EditSettle<T> {
  const open = new Map<string, { base: T; latest: T; timer: ReturnType<typeof setTimeout> }>()
  const arm = (id: string): ReturnType<typeof setTimeout> => setTimeout(() => {
    const cur = open.get(id)
    if (!cur) return
    if (stillEditing(id)) { cur.timer = arm(id); return }
    open.delete(id)
    onSettled(id, cur.base, cur.latest)
  }, ms)
  return {
    push(id, before, after) {
      const cur = open.get(id)
      if (cur) clearTimeout(cur.timer)
      open.set(id, { base: cur?.base ?? before, latest: after, timer: arm(id) })
    },
  }
}

/**
 * Which of a symbol's roster fields have to be re-filed against the Anwesenheit after an edit.
 *
 * A name typed into «Fahrer», «Name» or «Stv.» is a job handed to somebody who is standing there,
 * and filing it marks them present and writes their Funktion — which is a Verlauf row. So this
 * has to answer «what actually moved», and nothing else: re-filing an unchanged field re-opens a
 * presence block somebody closed on purpose and re-states a Funktion that never changed.
 *
 * ⚠️ A missing key and an empty one are the SAME thing (04.09.). The panel seeds every preset
 * field as a row, blank ones included, and commits the whole record — so a symbol that had never
 * carried a «Bezeichnung» suddenly carried `''`, `undefined !== ''` said a field had moved, and
 * every roster field on the symbol was re-filed. That is how naming the Einsatzleiter at 08:10
 * re-stated a Stv. set at 08:01.
 *
 * ⚠️ `force`, and a changed NON-roster field, still re-file everybody — deliberately. The
 * Bemerkung a field writes is built from the symbol's label and its other fields («Fahrer TLF»),
 * so when one of those moves, the name beside it has to reach the Anwesenheit again even though
 * the name itself did not change (lib/roleAssignment · rosterFieldRole).
 */
export function rosterFieldsToRefile(
  before: Record<string, string> | undefined,
  fields: Record<string, string>,
  rosterFields: readonly string[],
  opts?: { force?: boolean },
): { key: string; value: string }[] {
  const had = (k: string) => (before?.[k] ?? '').trim()
  // …except the «Herkunft»: no Bemerkung reads it, so naming where a vehicle came from must not
  // re-state its Fahrer's Funktion (and re-open a presence somebody closed)
  const jobChanged = !!opts?.force
    || Object.entries(fields).some(([k, v]) => !rosterFields.includes(k) && k !== appConfig.symbols.originField && had(k) !== v.trim())
  return Object.entries(fields)
    .filter(([k, v]) => rosterFields.includes(k) && !!v.trim() && (jobChanged || had(k) !== v.trim()))
    .map(([key, value]) => ({ key, value }))
}

/** The name a Verlauf row calls this symbol — its own label, else the symbol's name. */
export function entityLogName(e: Entity): string {
  return (e.label ?? '').trim() || e.symbol || appConfig.copy.entities.fallbackObjectName
}
