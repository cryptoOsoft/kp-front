/*
 * **A symbol whose matter is over is marked, never deleted** (24.09.2026, review item 21b,
 * `lib/objectDone`). «Erledigt», a toggle in the foot of the symbol's editor sheet, sets
 * `done {at, by?}` — a SymbolProps prop, so both bodies share it and every write-through and bake
 * carries it (never `BAKE_PRESERVED`: that list would re-add a cleared value from the map body).
 * ⚠️ It is offered ONLY where being over means something — the damage and hazard categories
 * (`appConfig.symbols.doneCategories`: Schadenlage, Gefahren) and the fire family
 * (`objectDone · offersDone`, decided by the PACK's category, never the editable subtitle). A Fahrzeug, a KP Front, a Hydrant, an Einsatzmittel never gets
 * it (owner's sign-off, 26.09.2026: «we don't need "erledigt" for cars»). A `done` already on
 * another symbol (an older record) keeps rendering and can be reopened, never newly set
 * (`doneAct` refuses).
 * The symbol stays, greyed with its HH:MM top-left, by ONE rule on the Karte, the Plan and the
 * Gebäude (`TacticalSymbol` · `.ts-done`, the `--done-*` tokens) and on paper (`kroki ·
 * _place_symbol`, `DONE_ALPHA`). The pressed tile tapped again («wieder aktiv») clears it; the
 * editor's head says when it was set («Schadenlage · erledigt 20:40»). Both are ordinary undoable
 * prop edits, audited with `done: null` for the clear (JSON drops `undefined`, and the replay would keep it
 * grey). A Feuer is «gelöscht», everything else «erledigt» (`appConfig.symbols.fireFamily`, one
 * copy key `objectDone.word`). The footer's delete reads «Entfernen» — for a mistake — and it
 * writes the Karte's removal row («… entfernt») on the Plan too. Symbols only: a
 * Fläche/Absperrkreis would need greyed ink on four renderers.
 */

import { appConfig } from '../config/appConfig'
import { fillTemplate, formatSymbolName, formatTime } from './format'
import { floorLabel } from './whiteboard'
import type { ObjectDone, SymbolProps } from '../types'

/**
 * «Gelöscht / erledigt» instead of deleting (review item 21b, 24.09.2026).
 *
 * Übung 23.09.2026: the fire on the EG was out, so somebody DELETED the Feuer symbol at 20:40 —
 * and the Rapport's plan no longer showed that there had ever been a fire. A symbol whose matter
 * is over now STAYS on the picture, greyed, with the time it was declared over; «Entfernen» is
 * for a mistake only.
 *
 * `done` is a PROP of the symbol (types · SymbolProps.done), so it is shared vocabulary of both
 * bodies (lib/tacticalObjects): a write-through carries it, the bake carries it, and setting or
 * clearing it is an ordinary undoable prop edit on whichever surface the finger is on. This file
 * is the ONE place that says what it looks like in words — the editor, the Verlauf row, the
 * legend line and the printed badge all read it from here.
 */

/** Which kinds can carry `done` at all. Symbols only: a Fläche/Absperrkreis would need greyed INK
 *  on the Karte's GL layers, the board, the Kroki and the plan pages — not a prop and a badge.
 *  WHICH symbols may newly be marked is `offersDone`. */
export const canBeDone = (kind: string | undefined): boolean => kind === 'symbol'

/** The record's `done`, or null — tolerant of a malformed value from an older/foreign blob, so a
 *  renderer never throws over it (the load gate is shape-based and does not look this deep). */
export function doneOf(props: Pick<SymbolProps, 'done'> | null | undefined): ObjectDone | null {
  const d = props?.done
  if (!d || typeof d !== 'object' || typeof d.at !== 'string' || !Number.isFinite(Date.parse(d.at))) return null
  return d
}

/** A fresh `done` for «now» — the caller hands in the deployment clock's instant. */
export function markDone(atIso: string, by?: string): ObjectDone {
  const who = by?.trim()
  return who ? { at: atIso, by: who } : { at: atIso }
}

/** Is this a FIRE-family symbol — the one that is «gelöscht» rather than «erledigt»? */
export const isFireFamily = (symbol: string | undefined): boolean =>
  !!symbol && appConfig.symbols.fireFamily.includes(symbol)

/** May this symbol be MARKED «Gelöscht / erledigt»? Only the damage and hazard categories
 *  (appConfig.symbols.doneCategories) and the fire family — a Fahrzeug, a KP Front, a Hydrant is
 *  never «over» (owner's sign-off on #226, 26.09.2026). `cat` is the PACK's category (useSymbols),
 *  never the symbol's editable subtitle. A symbol of another type that already CARRIES `done`
 *  (an older record) keeps rendering it and may be reopened — see `doneAct`. */
export const offersDone = (symbol: string | undefined, cat: string | undefined): boolean =>
  isFireFamily(symbol) || (!!cat && appConfig.symbols.doneCategories.includes(cat))

/** The ONE word, by family (copy · objectDone.word). `title` opens a line, `inline` sits in one. */
export function doneWord(symbol: string | undefined, form: 'title' | 'inline' = 'title'): string {
  const w = appConfig.copy.objectDone.word
  return (isFireFamily(symbol) ? w.fire : w.other)[form]
}

/** HH:MM of the moment it was declared over, in the device's locale like every Verlauf time. */
export function doneTime(done: ObjectDone): string {
  return formatTime(new Date(done.at))
}

/** «gelöscht 20:40» – the set state: the editor's head beside the type (ContextPanel · doneAt) and
 *  the Status half of a printed legend line (lib/symbols · symbolLegendText). Null when not done. */
export function doneStatusText(props: Pick<SymbolProps, 'done' | 'symbol'>): string | null {
  const d = doneOf(props)
  return d ? fillTemplate(appConfig.copy.objectDone.state, { word: doneWord(props.symbol, 'inline'), time: doneTime(d) }) : null
}

/** The badge on the glyph — only the time; the grey says the rest (and the legend the word). */
export function doneBadge(props: Pick<SymbolProps, 'done'>): string | null {
  const d = doneOf(props)
  return d ? doneTime(d) : null
}

/**
 * WHERE, for the Verlauf row: «EG», «1. OG», or a span «EG–2. OG». A single storey is
 * `from` alone or `from === to`; nothing known ⇒ '' (the Karte's own symbols rarely carry one,
 * and a «0» would claim an EG nobody said). The caller picks the numbers its surface means —
 * the Gebäude's tile, a Modul sheet's `storey`, the Karte's `floor` or its von/bis.
 */
export function donePlace(from: number | undefined, to?: number | undefined): string {
  if (from == null && to == null) return ''
  if (from == null || to == null || from === to) return floorLabel((from ?? to)!)
  return `${floorLabel(from)}–${floorLabel(to)}`
}

/** What a row calls the symbol — its own label (a placed symbol is seeded with its display name,
 *  lib/symbols · seedSymbolProps), else the display name, never the pack's raw key. */
export function doneName(props: Pick<SymbolProps, 'label' | 'symbol'>): string {
  return (props.label ?? '').trim() || (props.symbol ? formatSymbolName(props.symbol) : appConfig.copy.entities.fallbackObjectName)
}

/** «Feuer EG» — the name the row calls the object, with its place when it has one. */
const named = (name: string, place: string) => (place ? `${name} ${place}` : name)

/**
 * The Verlauf row for the act — «Feuer EG gelöscht». A row carries what was said (AGENTS ·
 * append-only), so it names the object and its storey; the WHEN is the row's own timestamp, which
 * is the same instant `done.at` holds (review of PR #226: a bracketed time said it twice).
 */
export function doneRowText(name: string, place: string, symbol: string | undefined): string {
  return fillTemplate(appConfig.copy.objectDone.logDone, { name: named(name, place), word: doneWord(symbol, 'inline') })
}

/**
 * THE act, once for both surfaces (IncidentWorkspace · setEntityDone, Whiteboard · setAnnoDone):
 * the new value, the Verlauf row, and the audit events for BOTH views — the replay folds views,
 * so the act emits the pair the way an anchor flip does. `entity.edit` always (the Karte's own or
 * baked body; a symbol without one folds to nothing there); `board.edit` for the sheet that draws
 * it natively, when there is one. `done: null` for «Wieder aktiv»: JSON drops an `undefined`, and
 * the replay would fold an empty patch and keep the symbol grey.
 *
 * Null when there is nothing to do — not a symbol, or already in that state.
 */
export function doneAct(
  props: Pick<SymbolProps, 'done' | 'label' | 'symbol'> & { id: string; kind: string },
  on: boolean,
  /** `cat`: the pack's category, which decides whether the symbol may be MARKED (`offersDone`);
   *  «Wieder aktiv» is always allowed, so nothing already recorded is stuck grey */
  opts: { atIso: string; by?: string; place: string; sheetPlanId?: string; cat?: string },
): { done: ObjectDone | undefined; text: string; events: [op: string, payload: Record<string, unknown>][] } | null {
  if (!canBeDone(props.kind) || on === !!doneOf(props)) return null
  if (on && !offersDone(props.symbol, opts.cat)) return null
  const done = on ? markDone(opts.atIso, opts.by) : undefined
  const name = doneName(props)
  const text = done ? doneRowText(name, opts.place, props.symbol) : reopenedRowText(name, opts.place)
  const patch = { done: done ?? null }
  const events: [string, Record<string, unknown>][] = [['entity.edit', { id: props.id, patch }]]
  if (opts.sheetPlanId) events.push(['board.edit', { id: props.id, planId: opts.sheetPlanId, patch }])
  return { done, text, events }
}

/** …and its counterpart, «Feuer EG wieder aktiv» — an appended correction, never an edit. */
export function reopenedRowText(name: string, place: string): string {
  return fillTemplate(appConfig.copy.objectDone.logReopened, { name: named(name, place) })
}
