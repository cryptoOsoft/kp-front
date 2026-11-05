import { appConfig } from '../config/appConfig'
import { fillTemplate, formatSymbolName } from './format'
import { linePresetLabel } from './lineStyle'
import { floorLabel } from './whiteboard'
import type { BoardAnno, Drawing, Entity, LineContent } from '../types'

/**
 * What changed on a drawing, in words — the Verlauf line for editing a line/Fläche on the Kroki.
 *
 * The same gap entityEditChanges (lib/entityEdit) closed for symbols: a Leitung got one row when
 * it was drawn and one when it went, and everything that gives it MEANING in between — the
 * Schaum letter, the Leitungs-Nummer, the Stockwerk, the Abschluss — changed the picture the
 * Einsatz is led from without a line in the record. Each row names the VALUE, never just the
 * field, because a printed rapport cannot be clicked.
 *
 * ⚠️ Styling and geometry are deliberately absent — colour, width, dash, coordinates, the label
 * offsets, the Wassertransport's `relay` — for the same reason entityEdit skips geometry: they change continuously while
 * somebody arranges the picture, and a row per nudge buries the edits that carry meaning. The
 * LABEL is also absent here: it already writes its own row (useMapDrawing · noteDrawingLabel),
 * and a second one would read as a phantom edit.
 */

/** The one Abschluss a line end shows, derived the way the DrawEditor's radio reads the three
 *  flags (Teilstück replaces the arrow; the Stopp bar rides on the arrow). */
export type LineEnding = 'none' | 'arrow' | 'arrowStop' | 'teilstueck'
export const endingOf = (d: Pick<Drawing, 'arrow' | 'arrowStop' | 'teilstueck'>): LineEnding =>
  d.teilstueck ? 'teilstueck' : d.arrow ? (d.arrowStop ? 'arrowStop' : 'arrow') : 'none'
/** The flags an Abschluss sets — the inverse of `endingOf`, for the live commit (off = absent). */
export const endingFlags = (e: LineEnding): Pick<Drawing, 'arrow' | 'arrowStop' | 'teilstueck'> =>
  ({ arrow: e === 'arrow' || e === 'arrowStop' || undefined, arrowStop: e === 'arrowStop' || undefined, teilstueck: e === 'teilstueck' || undefined })
/** …and as the `draw.edit` the Abschluss sends (IncidentWorkspace · changeMapEnding): all three
 *  flags, an off one as `false` — JSON drops an `undefined`, and replay would keep the old
 *  Abschluss (it lost «Pfeil + Stopp» and every switch back to «Keiner»). */
export const endingWireFlags = (e: LineEnding): Required<Pick<Drawing, 'arrow' | 'arrowStop' | 'teilstueck'>> =>
  ({ arrow: e === 'arrow' || e === 'arrowStop', arrowStop: e === 'arrowStop', teilstueck: e === 'teilstueck' })

export function drawingEditChanges(prev: Drawing, next: Drawing): string[] {
  const L = appConfig.copy.log
  const E = appConfig.copy.drawingEditor
  const out: string[] = []

  // ⚠️ …and it never says the same word twice. A line whose Abschluss is an arrow IS called
  // «Pfeil» (drawingLogName reads the preset off exactly those flags), and the caller wraps these
  // lines in `log.entityEdited` («{name}: {changes}») — so setting that Abschluss printed «Pfeil:
  // Abschluss: Pfeil» on the 03.09. Rapport, which reads as a stutter rather than as a record.
  // Where the VALUE would repeat the name the row already carries, only the field is named: the
  // value is the first word of the line. Same rule entityEdit follows for a field named after its
  // own symbol, one step further along the sentence.
  const logName = drawingLogName(next).trim().toLowerCase()
  const statement = (field: string, value: string, replaced: boolean) =>
    value.trim().toLowerCase() === logName
      ? fillTemplate(replaced ? L.fieldChangedPlain : L.fieldSetPlain, { field })
      : fillTemplate(replaced ? L.fieldChanged : L.fieldSet, { field, value })

  // ── Inhalt: the FKS device letter (S/W/H/P). Unset is not «cleared» — it is Wasser, a value
  // of its own, and the row says so the way the editor does.
  //
  // ⚠️ A REPLACEMENT says so («Typ auf Gegenfeuer geändert»), the same rule every symbol field
  // already follows (lib/entityEdit). Written as a bare «Typ: X» each time, somebody dialling
  // through the presets left three consecutive rows — «Typ: Nasse Haltelinie», «Typ: Gegenfeuer»,
  // «Typ: Wasser» (03.09., 07:52) — that read on paper as three properties holding at once
  // rather than as one line whose type was corrected twice.
  if ((prev.content ?? '') !== (next.content ?? '')) {
    const label = (c: LineContent | undefined) => (c ? (appConfig.copy.lineDecor[c] ?? c) : E.contentPlain)
    out.push(statement(E.content, label(next.content), !!prev.content))
  }

  // ── Schlauch: the Leitung's Ø — what was laid. Its Wassertransport assumptions (`relay`:
  // flow, source, pumps moved by hand) are planning, tweaked tap by tap, and write no row.
  if ((prev.hose ?? '') !== (next.hose ?? '') && next.hose) {
    out.push(statement(E.hose, appConfig.copy.relay.hoseLabels[next.hose], !!prev.hose))
  }

  // ── Leitung Nr.: the identity the Atemschutzüberwachung knows its hose by ──
  if (prev.lineNo !== next.lineNo) {
    out.push(next.lineNo == null
      ? fillTemplate(L.fieldCleared, { field: E.lineNo })
      : fillTemplate(prev.lineNo == null ? L.fieldSet : L.fieldChanged, { field: E.lineNo, value: String(next.lineNo) }))
  }

  // ── Stockwerk badge — same wording as a symbol's storey (lib/entityEdit) ──
  if (prev.floorTag !== next.floorTag) {
    out.push(next.floorTag == null ? L.floorCleared : fillTemplate(L.floorSet, { value: floorLabel(next.floorTag) }))
  }

  // ── Abschnitt: Leiter + Auftrag — the two fields that make a drawn Sektor an Abschnitt
  // (FKS Einsatzführung 3.5.2). Exactly the record the Rapport is later read for: who led
  // which Abschnitt, with what Auftrag, from when.
  if ((prev.abschnittLeiter ?? '') !== (next.abschnittLeiter ?? '')) {
    out.push(!next.abschnittLeiter
      ? fillTemplate(L.fieldCleared, { field: E.abschnittLeiter })
      : fillTemplate(prev.abschnittLeiter ? L.fieldChanged : L.fieldSet, { field: E.abschnittLeiter, value: next.abschnittLeiter }))
  }
  if ((prev.abschnittAuftrag ?? '') !== (next.abschnittAuftrag ?? '')) {
    out.push(!next.abschnittAuftrag
      ? fillTemplate(L.fieldCleared, { field: E.abschnittAuftrag })
      : fillTemplate(prev.abschnittAuftrag ? L.fieldChanged : L.fieldSet, { field: E.abschnittAuftrag, value: next.abschnittAuftrag }))
  }

  // ── Abschluss: arrow / arrow-with-stop / Teilstück, as ONE statement. The Entwicklungsgrenze
  // bar is the row the record is read for — «bis hier, und dort gestoppt» — and it used to
  // appear and vanish silently.
  if (endingOf(prev) !== endingOf(next)) {
    const labels: Record<LineEnding, string> = {
      none: E.endingNone, arrow: E.endingArrow, arrowStop: E.endingArrowStop, teilstueck: E.endingTeilstueck,
    }
    // …and the same «geändert» rule: a line that HAD an Abschluss and got another one is a
    // correction, not a second Abschluss standing beside the first.
    out.push(statement(E.ending, labels[endingOf(next)], endingOf(prev) !== 'none'))
  }

  return out
}

/** The name a Verlauf row calls this drawing — its own label, else what it IS: a line reports the
 *  preset it was drawn with («Rettungsachse», «Pfeil») where that is recoverable, otherwise every
 *  kind falls back to its plain word («Fläche», «Absperrkreis», «Zeichnung»). Mirror of
 *  entityLogName, and the ONE place create, edit and delete rows take a drawing's name from, so
 *  «Rettungsachse gezeichnet» can never close on «Zeichnung gelöscht». */
export function drawingLogName(d: Drawing): string {
  const kinds = appConfig.copy.log.drawKinds
  const own = (d.label ?? '').trim()
  if (own) return own
  if (d.kind === 'line') {
    const preset = linePresetLabel(d)
    if (preset) return preset
  }
  return kinds[d.kind] || kinds.line
}

/**
 * The ONE removal row of a Karte selection (IncidentWorkspace · deleteSelection) — «… entfernt»
 * since 25.09.2026, never «gelöscht», which now means an extinguished Feuer (lib/objectDone).
 * One object is named like its creation row («Fläche entfernt», «Einsatzleiter entfernt»), and
 * a symbol without a label by its display name, not the pack's key; more are counted, because
 * «Zeichnung entfernt» after a lasso over eleven objects is not vague, it is wrong.
 */
export function removalRowText(drawings: readonly Drawing[], entities: readonly Pick<Entity, 'label' | 'symbol'>[]): string {
  const L = appConfig.copy.log
  const gone = drawings.length + entities.length
  if (gone > 1) return fillTemplate(L.selectionDeleted, { n: gone })
  if (drawings.length === 1) return fillTemplate(L.objectDeleted, { name: drawingLogName(drawings[0]) })
  if (entities.length === 1) {
    const e = entities[0]
    const name = (e.label ?? '').trim() || (e.symbol ? formatSymbolName(e.symbol) : appConfig.copy.entities.fallbackObjectName)
    return fillTemplate(L.objectDeleted, { name })
  }
  return L.drawingDeleted
}

/**
 * The name a Verlauf row calls a PLAN annotation — the SAME name the Karte's row gives the same
 * object, so «Entfernen» writes one row, «{name} entfernt», whichever surface the finger was on
 * (review item 21b, 24.09.2026: the plan used to write none at all). A drawing is named by
 * `drawingLogName`, a symbol/Form/Trupp chip by its label or text like `entityLogName`, and a
 * symbol without one by its display name.
 *
 * Null for an EMPTY Notiz: the Karte writes no row for one either (IncidentWorkspace ·
 * deleteEntity) — a note that said nothing is a placement being taken back, not a record.
 */
export function annoLogName(a: BoardAnno): string | null {
  if (a.kind === 'draw' || a.kind === 'area' || a.kind === 'circle') {
    return drawingLogName({ ...a, kind: a.kind === 'draw' ? 'line' : a.kind, coords: [] } as Drawing)
  }
  if (a.kind === 'text') return (a.text ?? '').trim() || null
  const own = (a.kind === 'resource' ? a.text ?? a.label : a.label ?? a.text)?.trim()
  if (own) return own
  if (a.kind === 'symbol' && a.symbol) return formatSymbolName(a.symbol)
  if (a.kind === 'shape' && a.shape) return appConfig.copy.shapes.names[a.shape] ?? appConfig.copy.entities.fallbackObjectName
  return appConfig.copy.entities.fallbackObjectName
}
