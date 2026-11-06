// Three-way merge of two divergent workspace blobs against their common ancestor (the last
// revision both devices shared). This is what turns concurrent multi-device editing from
// "one whole snapshot wins, the other's work is lost" into a real merge, the way Miro/Figma
// resolve it:
//   - independent additions to different objects all survive (ordered by server appearance);
//   - edits to the SAME object are last-writer-wins (the device flushing later wins) — except
//     Trupps, which merge field-level (mergeTrupp) because an SCBA record must never lose a
//     pressure reading to a concurrent radio contact, and Anwesenheit entries, Zeitplan shifts
//     and a live vehicle's override row, which merge per field (mergeFields) so two devices
//     saving different fields of one record in the same second both keep their edit;
//   - a delete BEATS a concurrent edit — the object stays gone, no resurrection;
//   - two devices that minted the same «Trupp N» at once end with ONE holder of the number, the
//     others renumbered from the one counter (lib/truppNumbers — the last step of mergeWorkspace).
//
// The `base` ancestor is the crux: it lets us tell "I deleted X" (present in base, absent in
// mine) apart from "I never had X" (absent in both base and mine). Without it a naive union
// can't honor deletes and would resurrect everything the other device removed.

/*
 * **Anwesenheit entries and Zeitplan shifts merge PER FIELD** (staging r4 D3, 25.09.2026):
 * two saves in the same second share one ancestor, and whole-object LWW dropped one device's
 * field. `mergeWorkspace · mergeFields` resolves unit by unit — an entry's presence
 * (`status`/`intervals`/`checkedInAt`/`leftAt`) is ONE unit, the Funktion (`note` + `noteAt`)
 * another, `source`/`displayNameSnapshot` are quiet bookkeeping. Only a unit both sides
 * changed differently is a divergence; it is reported as two whole entries differing only in
 * that unit, so the row names only it and settling either side keeps the other edits. A shift
 * whose merged from/to would not be a block keeps mine's pair. Reproduced end-to-end with two
 * engines on the 409 path (`workspaceSync.sameSecond.test.ts`).
 *
 * *Merges compare JSON, not key order* (staging r3 F11): the server's JSONB re-sorts keys, so
 * `mergeWorkspace · eq` ignores key order; an Anwesenheit divergence is reported only when the
 * sides differ in more than `noteAt`.
 */

import { formDelta, isFormData, type BoardFormData } from './boardForm'
import { atomLabel, mergeFormData } from './boardFormMerge'
import { labelText } from './boardTemplate'
import { followerOnlyChange } from './gpsReturn'
import { objectsFromLegacy, viewsOf, type ObjectViews, type TacticalObject } from './tacticalObjects'
import { mergeIncidentPlanBindings, type IncidentPlanBinding } from './incidentPlanBindings'
import { landedClaims, resolveTruppNumbers, unwindUnlanded, type NumberScope } from './truppNumbers'
import type { TruppTrail } from './truppTrails'
import type { BoardAnno, BoardDoc, Drawing, Entity, Reading, Trupp } from '../types'
import type { InitialState, Saved } from './workspace'
import { jsonEqual } from './jsonEqual'
import { unionCrewFiled } from './crewFiling'

type Id = string
/** One id-keyed row as the merge walks it: an id plus whatever fields the blob holds. Indexable,
 *  so the field-level resolvers read and write it as a plain record without a double cast. */
interface HasId {
  id: Id
  [k: string]: unknown
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const hasId = (v: unknown): v is HasId => isObj(v) && typeof v.id === 'string'
/** An id-keyed collection as the merge can walk it: anything else (a `{}`, a string, a null)
 *  reads as empty. `base`/`theirs` come off the server and the cached ancestor, neither of
 *  which this app alone writes (capture posts, admin edits, other versions), and one `.map` on
 *  a non-array here used to escape as an unhandled rejection that re-threw on every retry. */
const asList = (v: unknown): HasId[] => (Array.isArray(v) ? v.filter(hasId) : [])
/** `asList` read as a typed collection: only the id is checked, like everywhere in this merge. */
const listOf = <T extends { id: Id }>(v: unknown): T[] => (Array.isArray(v) ? v.filter((x): x is T => hasId(x)) : [])
/** A key→value record as mergeRecord can walk it; a non-object reads as empty. */
const asRecord = (v: unknown): Record<string, unknown> => (isObj(v) ? v : {})
/** A board (planId → annotations) with every doc coerced to a list. */
const asBoard = (v: unknown): BoardDoc =>
  Object.fromEntries(Object.entries(asRecord(v)).map(([k, docs]) => [k, listOf<BoardAnno>(docs)]))

/** Structural equality for plain JSON data (the only thing the blob holds). Used to tell "I
 *  changed this field" from "I left it as the ancestor" in the three-way field/record merges.
 *
 *  ⚠️ KEY ORDER DOES NOT COUNT (staging r3 F11). This used to say key order was stable because
 *  buildPayload writes every value — but `base` and `theirs` come back from the server's JSONB,
 *  which re-sorts every object's keys. An entry this device never touched read as «changed
 *  here» against its re-sorted ancestor, so when another device changed it for real, «both
 *  changed» went LWW-mine and the other device's edit was thrown away (a Zeitplan shift, any
 *  whole-object collection). See lib/jsonEqual. */
const eq = jsonEqual

/** Three-way merge of ONE non-collection value: if the resolver (mine) left it at the common
 *  ancestor it yields to the server's value (so the other device's concurrent change survives);
 *  if the resolver changed it, mine wins (last-writer-wins). This is what stops a save in one
 *  domain from reverting a singleton (settings/building/…) edited concurrently in another. */
function pick3<T>(base: T, mine: T, theirs: T): T {
  return eq(mine, base) ? theirs : mine
}

/**
 * Two Trupps under ONE id, made two again (audit F04, 25.10.2026). Every merge keys on the id
 * (`mergeById` builds Maps), so a second crew under the same id vanished at the next sync. An
 * exact copy is one crew and goes; a different one is kept under a DERIVED id, `<id>~2` (`~3` …),
 * the same on every device, so they converge instead of each minting its own. Runs at the load
 * gate (workspace · sanitizeWorkspace) AND on all three sides of the Trupp merge below — a cached
 * blob from before the gate (a cold reopen after the server moved on) is merged before it is
 * sanitized (Codex review, 26.10.2026). `repaired` counts removed copies and renamed crews.
 */
export function splitDuplicateTruppIds<T extends { id: Id }>(list: T[]): { list: T[]; repaired: number } {
  const ids = new Set(list.map((t) => t.id))
  const seen = new Map<Id, T[]>()
  const out: T[] = []
  let repaired = 0
  for (const t of list) {
    const same = seen.get(t.id)
    if (!same) { seen.set(t.id, [t]); out.push(t); continue }
    repaired++
    if (same.some((x) => eq(x, t))) continue
    let n = same.length + 1
    while (ids.has(`${t.id}~${n}`) || seen.has(`${t.id}~${n}`)) n++
    const id = `${t.id}~${n}`
    same.push(t)
    seen.set(id, [])
    out.push({ ...t, id })
  }
  return repaired ? { list: out, repaired } : { list, repaired }
}

/**
 * Merge one id-keyed collection three ways. `mine` is the local (later) writer, so on a
 * same-id divergence it wins. If only one side changed an object, that change survives. An
 * object present in `base` but dropped on a side is a delete, and a
 * delete beats the other side's edit. Output order is server (theirs) order first, then my
 * new additions — deterministic, so every device converges on the same array after merging.
 *
 * `resolveBoth` (optional) replaces the whole-object LWW for the one case where BOTH sides
 * changed the same object to different values — used by the Trupp merge to go field-level
 * instead of dropping one device's safety record wholesale. It runs only with a real ancestor
 * (a concurrent same-id ADD stays LWW-mine: there is no base to diff against).
 */
export function mergeById<T extends { id: Id }>(
  base: T[],
  mine: T[],
  theirs: T[],
  resolveBoth?: (ancestor: T, mine: T, theirs: T) => T,
): T[] {
  const baseIds = new Set(base.map((o) => o.id))
  const baseMap = new Map(base.map((o) => [o.id, o]))
  const mineMap = new Map(mine.map((o) => [o.id, o]))
  const theirsMap = new Map(theirs.map((o) => [o.id, o]))

  // What survives for a given id, or null if it should be dropped (a delete won).
  const survives = (id: Id): T | null => {
    const inMine = mineMap.has(id)
    const inTheirs = theirsMap.has(id)
    if (inMine && inTheirs) {
      const mine = mineMap.get(id)!, theirs = theirsMap.get(id)!, ancestor = baseMap.get(id)
      if (!ancestor) return mine // concurrent same-id add → last-writer-wins (mine)
      if (eq(mine, ancestor)) return theirs // only the server changed it
      if (eq(theirs, ancestor)) return mine // only I changed it
      if (eq(mine, theirs)) return mine // both made the identical change — nothing to resolve
      return resolveBoth ? resolveBoth(ancestor, mine, theirs) : mine // both changed it → resolver, else LWW-mine
    }
    if (inMine) return baseIds.has(id) ? null : mineMap.get(id)! // theirs deleted → drop; else my add
    if (inTheirs) return baseIds.has(id) ? null : theirsMap.get(id)! // I deleted → drop; else their add
    return null
  }

  const out: T[] = []
  const taken = new Set<Id>()
  for (const o of theirs) {
    const r = survives(o.id)
    if (r && !taken.has(o.id)) { out.push(r); taken.add(o.id) }
  }
  for (const o of mine) {
    if (taken.has(o.id)) continue
    const r = survives(o.id)
    if (r) { out.push(r); taken.add(o.id) }
  }
  return out
}

/** A true same-key divergence in a merged record: BOTH sides changed the key relative to the
 *  ancestor, to different values — the merge stays last-writer-wins (mine), but callers can
 *  surface it (e.g. the attendance conflict note in the Verlauf) instead of staying silent. */
export interface RecordConflict {
  key: string
  mine: unknown
  theirs: unknown
}

/** Three-way merge of a plain key→value record (vehicleOverrides by entity id, a checklist's
 *  ticks by item id, attendance by Person id, planScale by plan id, and the flat settings/reportMeta
 *  singletons). Per key: a delete (present in base, gone on one side) wins; otherwise the side
 *  that actually CHANGED the value relative to the ancestor wins, and if both changed it's
 *  last-writer-wins (mine). Crucially, a key the resolver left untouched takes the server's value
 *  — so a value another device changed in a different domain is not silently reverted.
 *  `onConflict` (optional) fires for every key BOTH sides changed to different values — the
 *  LWW result is unchanged, the divergence is merely reported.
 *  `resolveBoth` (optional) replaces that LWW for a key both sides changed against a real
 *  ancestor — the per-field merge of an Anwesenheit entry. It reports its own divergences, so
 *  `onConflict` does not fire for a key it resolved. A concurrent same-key ADD stays LWW-mine. */
export function mergeRecord<V>(
  base: Record<string, V>,
  mine: Record<string, V>,
  theirs: Record<string, V>,
  onConflict?: (c: RecordConflict) => void,
  resolveBoth?: (ancestor: V, mine: V, theirs: V, key: string) => V,
): Record<string, V> {
  const out: Record<string, V> = {}
  base = base ?? {}
  mine = mine ?? {}
  theirs = theirs ?? {}
  for (const k of new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)])) {
    const inBase = k in base, inMine = k in mine, inTheirs = k in theirs
    if (inBase && (!inMine || !inTheirs)) continue // a shared key removed on either side → delete wins
    if (!inMine && !inTheirs) continue // never existed / removed on both
    if (inMine && (!inBase || !eq(mine[k], base[k]))) {
      // I added/changed it → mine wins. If THEIRS also moved off the ancestor to something
      // different, that's a genuine both-sides divergence — report it (LWW stays).
      const bothChanged = inTheirs && !eq(mine[k], theirs[k]) && (!inBase || !eq(theirs[k], base[k]))
      if (bothChanged && inBase && resolveBoth) { out[k] = resolveBoth(base[k], mine[k], theirs[k], k); continue }
      if (onConflict && bothChanged) onConflict({ key: k, mine: mine[k], theirs: theirs[k] })
      out[k] = mine[k]
    }
    else if (inTheirs) out[k] = theirs[k] // I left it at the ancestor → take theirs (their change or unchanged)
    else out[k] = mine[k]
  }
  return out
}

// --- Per-field merge of ONE record both sides changed (Anwesenheit entries, Zeitplan shifts) ---
//
// ⚠️ staging r4 D3 (25.09.2026): two devices saving DIFFERENT fields of the same person or the
// same shift within one second both build on the same revision; the first lands, the second
// 409s and merges against that shared ancestor. As whole objects that is «both changed» →
// LWW-mine, so the phone's «von 23:38» vanished under the tablet's Bemerkung (and the tablet's
// untouched Funktion read as a second one in a «zwei Funktionen … bitte prüfen» row), and a
// shift's «bis 07:00» vanished under the other device's «von 01:00» without any row at all.
// Merged per field against the ancestor, edits to different fields both survive; only a field
// BOTH sides changed to different values is a divergence, and it keeps the old rule (mine).

/** Fields that are ONE fact and resolve from one side together. `ignore` lists fields that
 *  ride along but do not by themselves make the two sides differ; a `quiet` unit resolves like
 *  any other but is never reported as a divergence (bookkeeping, not a statement). */
interface FieldUnit {
  keys: readonly string[]
  ignore?: readonly string[]
  quiet?: boolean
}

/**
 * Three-way merge of one plain record, unit by unit (`units`; every other field is a unit of
 * its own). A unit only one side changed takes that side's values; a unit both sides changed
 * takes MINE (LWW, as the whole-object merge did) and, if the two differ, is returned in
 * `diverged`. An absent field is a value like any other: a field one side removed stays
 * removed unless the other side changed it too.
 */
function mergeFields(
  a: Record<string, unknown>,
  m: Record<string, unknown>,
  t: Record<string, unknown>,
  units: readonly FieldUnit[] = [],
): { merged: Record<string, unknown>; diverged: FieldUnit[] } {
  const keys = [...new Set([...Object.keys(m), ...Object.keys(t), ...Object.keys(a)])]
  const unitOf = new Map<string, FieldUnit>()
  for (const u of units) for (const k of u.keys) unitOf.set(k, u)
  const pick = new Map<FieldUnit, Record<string, unknown>>()
  const diverged: FieldUnit[] = []
  for (const k of keys) {
    const unit = unitOf.get(k) ?? { keys: [k] }
    if (unitOf.has(k) && pick.has(unit)) continue
    const changedM = unit.keys.some((f) => !eq(m[f], a[f]))
    const changedT = unit.keys.some((f) => !eq(t[f], a[f]))
    pick.set(unit, !changedM ? t : m)
    if (changedM && changedT && !unit.quiet &&
      unit.keys.some((f) => !unit.ignore?.includes(f) && !eq(m[f], t[f]))) diverged.push(unit)
    if (!unitOf.has(k)) unitOf.set(k, unit)
  }
  const merged: Record<string, unknown> = {}
  for (const k of keys) {
    const side = pick.get(unitOf.get(k)!)!
    if (side[k] !== undefined) merged[k] = side[k]
  }
  return { merged, diverged }
}

/** `into` with the fields of `units` taken from `from` — one side of a divergence as a whole
 *  entry, everything else as merged. */
function withUnits(into: Record<string, unknown>, from: Record<string, unknown>, units: readonly FieldUnit[]) {
  const out = { ...into }
  for (const u of units) for (const k of u.keys) {
    if (from[k] !== undefined) out[k] = from[k]
    else delete out[k]
  }
  return out
}

/** How an Anwesenheit entry divides into facts (types.AttendanceEntry). */
const ATTENDANCE_UNITS: readonly FieldUnit[] = [
  // presence is ONE fact: the blocks are the truth and status + the checkedInAt/leftAt pair are
  // derived from them — resolved from two sides they would describe two different people
  { keys: ['status', 'intervals', 'checkedInAt', 'leftAt'] },
  // the Funktion; `noteAt` is when a device wrote it, not what it says (staging r3 F11)
  { keys: ['note', 'noteAt'], ignore: ['noteAt'] },
  // bookkeeping: where the entry was last written, and the name as it stood then
  { keys: ['source'], quiet: true },
  { keys: ['displayNameSnapshot'], quiet: true },
]

/**
 * One Anwesenheit entry both sides changed, merged per fact. A divergence is reported as two
 * WHOLE entries that differ only in the diverging facts — the merged entry (what now stands) and
 * the same with the other device's values for those facts — so the row names only what actually
 * diverged, and settling it on either side keeps every other device's edit.
 */
function mergeAttendanceEntry(ancestor: unknown, mine: unknown, theirs: unknown, key: string,
  report?: (c: RecordConflict) => void): unknown {
  if (!isObj(ancestor) || !isObj(mine) || !isObj(theirs)) {
    report?.({ key, mine, theirs })
    return mine
  }
  const { merged, diverged } = mergeFields(ancestor, mine, theirs, ATTENDANCE_UNITS)
  if (diverged.length) report?.({ key, mine: merged, theirs: withUnits(merged, theirs, diverged) })
  return merged
}

/** One Zeitplan shift both sides changed, merged per field. From and to are separate fields (one
 *  device moves the start, another the end — both stand), but a pair assembled from two sides
 *  must still be a block: one that would end before it starts takes MY from/to together. */
function mergeShift(ancestor: HasId, mine: HasId, theirs: HasId): HasId {
  const m = mine
  const { merged } = mergeFields(ancestor, m, theirs)
  const from = Date.parse(String(merged.from)), to = Date.parse(String(merged.to))
  if (Number.isFinite(from) && Number.isFinite(to) && from >= to) {
    for (const k of ['from', 'to']) {
      if (m[k] !== undefined) merged[k] = m[k]
      else delete merged[k]
    }
  }
  return { ...merged, id: mine.id } // the three share the id (mergeById's key)
}

// --- Trupp merge: field-level three-way, because whole-object LWW loses safety data --------
//
// Trupps are SCBA crew monitoring. The everyday concurrent case — the Truppüberwacher books a
// Druckmeldung on the tablet while the EL's phone books the Funkkontakt — used to be resolved
// object-wide LWW, so the later writer's whole Trupp replaced the other device's: a pressure
// reading from the board silently vanished from the legal record. Merged per field, both edits
// survive; the divergence is still REPORTED (onTruppConflict → Verlauf note) so a human checks.

/** Minimal structural view of a Trupp reading row (types.TruppReading). */
interface Readingish {
  t: string
  bar: number
  kind: string
}

/** Trupp fields that are ISO timestamps where "later" is the only safe answer when both sides
 *  wrote one: a contact clock that moves BACKWARDS would re-arm an überfällig alarm somebody
 *  already answered — or worse, silence one by resurrecting a fresher-looking stale time. */
const TRUPP_TIME_FIELDS = new Set(['entryTime', 'lastContactTime', 'lastPressureTime', 'exitTime', 'removedAt', 'contactRestartedAt', 'pausedFrom', 'contactBeforeRestart'])

/** The later of two ISO timestamps, or null when either doesn't parse (caller falls back). */
function laterIso(a: unknown, b: unknown): unknown | null {
  const ta = Date.parse(String(a)), tb = Date.parse(String(b))
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null
  return ta >= tb ? a : b
}

/**
 * Three-way merge of one Trupp's `readings` log, keyed by (t, kind). The log is append-only in
 * normal operation — the union keeps every row either device wrote — but two writers can still
 * touch the SAME row: an Undo removes the just-appended row (delete wins, like everywhere
 * else), and the entry-pressure correction (useTruppActions) edits a row's `bar` in place (the
 * side that changed it wins; both-changed stays LWW-mine). Output is chronological, so every
 * device converges on the same printed Journal.
 */
function mergeReadings(base: Readingish[], mine: Readingish[], theirs: Readingish[]): Readingish[] {
  const key = (r: Readingish) => `${r.t}|${r.kind}`
  const bm = new Map(base.map((r) => [key(r), r]))
  const mm = new Map(mine.map((r) => [key(r), r]))
  const tm = new Map(theirs.map((r) => [key(r), r]))
  const out: Readingish[] = []
  for (const k of new Set([...tm.keys(), ...mm.keys()])) {
    const inM = mm.has(k), inT = tm.has(k), inB = bm.has(k)
    if (inM && inT) {
      const b = bm.get(k), m = mm.get(k)!, t = tm.get(k)!
      out.push(!b || !eq(m, b) ? m : t) // a one-sided bar correction wins; both-changed → mine
    } else if ((inM || inT) && !inB) {
      out.push((mm.get(k) ?? tm.get(k))!) // a new row from either side — never dropped
    } // in base but gone on one side → that side's Undo removed it → stays gone
  }
  out.sort((a, b) => (Date.parse(a.t) || 0) - (Date.parse(b.t) || 0)) // stable → same-t keeps insertion order
  return out
}

/**
 * Field-level three-way merge of ONE Trupp both sides changed (mergeById's `resolveBoth` for
 * the trupps collection). Per field, mergeRecord semantics: the side that changed it wins, a
 * removed shared field stays removed (an Undo clearing e.g. `removedAt`). Where BOTH sides
 * changed the same field:
 *   - timestamps (TRUPP_TIME_FIELDS) take the LATER value — a contact clock never moves back;
 *   - `lastPressureBar` rides with `lastPressureTime` (a bar from one reading stamped with the
 *     other reading's time would assert a pressure at a moment it wasn't read);
 *   - `lowestBar` joins at the MIN — it is monotone-min within a run, so the union of what two
 *     devices saw is the lower one, and a low reading is never lost;
 *   - `readings` is the keyed union above;
 *   - `status` + `entryTime` + `exitTime` resolve as ONE unit when both sides moved the status
 *     (see below — a chimera of one side's status with the other's stamps can silence the
 *     contact clock for a crew that is inside);
 *   - everything else keeps the collection-wide LWW-mine precedence.
 */
function mergeTrupp(ancestor: HasId, mine: HasId, theirs: HasId): HasId {
  const a = ancestor, m = mine, t = theirs
  const out: HasId = { id: mine.id } // the three share the id (mergeById's key)
  for (const k of new Set([...Object.keys(m), ...Object.keys(t)])) {
    if (k === 'readings' || k === 'crewFiled') continue // merged below
    const inA = k in a, inM = k in m, inT = k in t
    if (inA && (!inM || !inT)) continue // a shared field removed on either side → delete wins
    if (!inM) { out[k] = t[k]; continue } // their new field
    if (!inT) { out[k] = m[k]; continue } // my new field
    if (eq(m[k], t[k])) { out[k] = m[k]; continue } // same value — nothing to resolve
    if (eq(m[k], a[k])) { out[k] = t[k]; continue } // only theirs changed it
    if (eq(t[k], a[k])) { out[k] = m[k]; continue } // only I changed it
    // both changed it, to different values:
    // ⚠️ …except the Notfall's trigger (F1, 08.10.2026): two devices that held «Notfall» on the
    // same crew within the same seconds raised ONE emergency, and it began at the EARLIER hold —
    // the Notfall clock must never jump forward and lose the seconds the crew has been waiting
    if (k === 'notfallAt') out[k] = laterIso(m[k], t[k]) === m[k] ? t[k] : m[k]
    else if (TRUPP_TIME_FIELDS.has(k)) out[k] = laterIso(m[k], t[k]) ?? m[k]
    else if (k === 'lowestBar' && typeof m[k] === 'number' && typeof t[k] === 'number') {
      out[k] = Math.min(m[k] as number, t[k] as number)
    } else out[k] = m[k] // scalar divergence stays LWW-mine (conservative)
  }
  // lastPressureBar follows the reading that won lastPressureTime when both sides logged one —
  // the generic loop resolves the two fields independently and could pair A's bar with B's time.
  const bothLoggedPressure =
    !eq(m.lastPressureTime, a.lastPressureTime) && !eq(t.lastPressureTime, a.lastPressureTime) &&
    !eq(m.lastPressureTime, t.lastPressureTime)
  if (bothLoggedPressure) {
    const winner = eq(out.lastPressureTime, m.lastPressureTime) ? m : t
    if ('lastPressureBar' in winner) out.lastPressureBar = winner.lastPressureBar
  }
  // The state machine is ONE fact, not three fields. When both sides moved `status` to
  // different values, the generic loop pairs one side's status with the other side's stamps —
  // a tablet's «Eingerückt» racing a phone's «Draussen» converged on {status:'aktiv', exitTime},
  // which deriveTruppLive reads as raus: contact clock and überfällig alarm silently OFF for a
  // crew that was just sent in. Resolve {status, entryTime, exitTime} from ONE side instead:
  // the in-field side when exactly one is in the field (the louder state wins — the same
  // doctrine that lets überfällig beat a manual Rückzug; false «drinnen» keeps the monitoring
  // alive, false «raus» kills it), else mine.
  const statusConflict = 'status' in m && 'status' in t &&
    !eq(m.status, t.status) && !eq(m.status, a.status) && !eq(t.status, a.status)
  if (statusConflict) {
    const inField = (s: unknown) => s !== 'angemeldet' && s !== 'raus' // mirrors deriveTruppLive
    const winner = inField(m.status) ? m : inField(t.status) ? t : m
    for (const k of ['status', 'entryTime', 'exitTime']) {
      if (k in winner) out[k] = winner[k]
      else delete out[k]
    }
  }
  if ('readings' in m || 'readings' in t) {
    const rows = (v: unknown): Readingish[] => (Array.isArray(v) ? (v.filter(isObj) as unknown as Readingish[]) : [])
    out.readings = mergeReadings(rows(a.readings), rows(m.readings), rows(t.readings))
    // ⚠️ Two devices holding «Notfall» at once raised ONE Notfall (the earlier hold, above) — so
    // the losing hold's `notfall` row goes too, or the Trupp's log and the Rapport print it twice
    // (review of #300). Only when both sides raised it: a Notfall ended and raised again keeps both.
    const raisedBoth = typeof m.notfallAt === 'string' && typeof t.notfallAt === 'string' && m.notfallAt !== t.notfallAt
      && !eq(m.notfallAt, a.notfallAt) && !eq(t.notfallAt, a.notfallAt)
    if (raisedBoth) {
      const lost = out.notfallAt === m.notfallAt ? t.notfallAt : m.notfallAt
      out.readings = (out.readings as Readingish[]).filter((r) => !(r.kind === 'notfall' && r.t === lost))
    }
  }
  // The crew filing's one-shot marker (types · Trupp.crewFiled) is GROW-ONLY: a union of all
  // three, never a delete — a key lost here would let a device file again somebody a person took
  // off the Anwesenheit.
  const filed = unionCrewFiled(asStrings(a.crewFiled), asStrings(m.crewFiled), asStrings(t.crewFiled))
  if (filed) out.crewFiled = filed
  return out
}

const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** A Trupp minus its machine-only fields — what a human edited. Two devices that differ only in
 *  the crew-filing marker did not both CHANGE the Trupp in any sense a person should check. */
const humanTrupp = (o: HasId): unknown => {
  const { crewFiled: _m, ...rest } = o
  return rest
}

/**
 * `reportMeta`, with the three NESTED collections merged per entry instead of as opaque values.
 *
 * ⚠️ `linksDone` (the station's Rapport-Formulare, ticked off per Einsatz) is a
 * `Record<linkId, ISO>`, and the flat merge treats a whole object as one value: the AdFU
 * ticking «Getränke» on the tablet while the EL ticks «Schadenmeldung» on the phone would end
 * with one of the two ticks gone, silently — while the field's own doc comment promises that
 * whoever opens the Rapport next sees what is already away. Merged per link id it is a union,
 * and an untick still beats a concurrent tick (delete wins, as everywhere else here).
 *
 * ⚠️ `gruppen` / `fahrzeuge` (the Alarmierungs-/Ausrückzeiten grid) are id-keyed ARRAYS with a
 * writer this app does not control: the alarm pipeline pushes per-vehicle Ausrück-/Vor-Ort-/
 * Zurück-Zeiten straight into the server's blob (backend api/alarms · apply_milestones). Merged
 * flat, the array is one value — so the moment the operator typed a single time into the grid,
 * `fahrzeuge` differed from the ancestor, «mine wins» took the whole array, and every row the
 * webhook had written was gone. That is exactly the report from 31.08.: the Verlauf carried
 * «PIO vor Ort 20:14» (the webhook only logs a row when it WRITES the value) while the grid
 * stayed empty. Merged by id, a machine-written row and a hand-typed one survive each other,
 * and `manual` keeps meaning what it means on the server: human beats machine, per row.
 *
 * Every other reportMeta field is a scalar or a small value object edited as a unit, so the
 * flat merge is right for them and stays.
 */
function mergeReportMeta(
  base: Record<string, unknown>,
  mine: Record<string, unknown>,
  theirs: Record<string, unknown>,
): Record<string, unknown> {
  const out = mergeRecord(base, mine, theirs)
  const done = mergeRecord(asRecord(base.linksDone), asRecord(mine.linksDone), asRecord(theirs.linksDone))
  if (Object.keys(done).length) out.linksDone = done
  else delete out.linksDone
  for (const k of ['gruppen', 'fahrzeuge'] as const) {
    const rows = mergeById(asList(base[k]), asList(mine[k]), asList(theirs[k]))
    if (rows.length) out[k] = rows
    else delete out[k]
  }
  return out
}

// (per-plan board merging is gone — since schema 2 the board is a derived view of the merged
// `objects` collection, so a plan's annos merge as whole objects like everything else)

// --- The merge policy: one row per field of the blob -----------------------------------------
//
// ⚠️ Every field of `Saved` states HOW it merges, and the map is checked against `Saved` at
// compile time (`satisfies Record<keyof Saved, FieldPolicy>`): a field added to the blob without
// a row here fails `tsc`. The old shape — a `...mine` spread with the merged fields listed after
// it — let a new synced field fall through to «this device wins» silently, which is how
// `attendance`, `settings`, `reportMeta` and `intakeReviewedAt` each clobbered concurrent edits
// until they were given a merge of their own. Policy map since 23.09.2026.

/** What a field's merge may need beyond its own three values: the tactical objects (merged ONCE,
 *  up front, because the three legacy views are derived from them) and the two conflict reporters. */
interface MergeCx {
  objects: TacticalObject[]
  views: ObjectViews
  onAttendanceConflict?: (c: RecordConflict) => void
  onTruppConflict?: (c: RecordConflict) => void
}

/** How ONE field of the blob merges.
 *  - `'local'` — genuinely local view/device state: the resolving device's own value, verbatim
 *    (absent stays absent). A merge must never yank the resolving device's active plan or its
 *    layer toggles.
 *  - a function — the three-way merge of that field (base, mine, theirs, each exactly as it
 *    stands in its blob, so possibly malformed or absent); its result is always written. */
type FieldPolicy = 'local' | ((b: unknown, m: unknown, t: unknown, cx: MergeCx) => unknown)

/** An attendance entry minus `noteAt` — WHEN a device wrote the Funktion, not what it says. */
const withoutNoteAt = (v: unknown): unknown => {
  if (!isObj(v) || !('noteAt' in v)) return v
  const { noteAt: _t, ...rest } = v
  return rest
}

const byId = (b: unknown, m: unknown, t: unknown) => mergeById(asList(b), asList(m), asList(t))
const byKey = (b: unknown, m: unknown, t: unknown) => mergeRecord(asRecord(b), asRecord(m), asRecord(t))

/**
 * The Checklisten tick state, merged PER TICK (05.11.2026). It merged per template (`byKey`), so a
 * device ticking «Energieträger» while another ticked «Personenbelegung» in the same list was
 * «both changed one record» → mine, and the other device's tick was gone – on the Problemerfassung,
 * where two officers tick at once and every tick is a line on the Tafel. Now each template's
 * `ticks`, `activeBranch` and `trends` merge key by key (mergeRecord): ticks on different items
 * both stand, the same item changed on both keeps mine. A problem's Tendenz lives in `trends`, not
 * on its tick (06.11.2026), so an un-tick on one device and a Tendenz set on another both stand –
 * the re-tick finds it. Every other key of a template state rides with mine.
 */
export function mergeChecklists(b: unknown, m: unknown, t: unknown): Record<string, unknown> {
  const [B, M, T] = [asRecord(b), asRecord(m), asRecord(t)]
  const out: Record<string, unknown> = {}
  for (const k of new Set([...Object.keys(T), ...Object.keys(M)])) {
    const [sb, sm, st] = [asRecord(B[k]), asRecord(M[k]), asRecord(T[k])]
    const byItem = (key: 'activeBranch' | 'trends') => (key in sm || key in st
      ? { [key]: mergeRecord(asRecord(sb[key]), asRecord(sm[key]), asRecord(st[key])) } : {})
    const ticks = mergeRecord(asRecord(sb.ticks), asRecord(sm.ticks), asRecord(st.ticks))
    out[k] = { ...st, ...sm, ticks, ...byItem('activeBranch'), ...byItem('trends') }
  }
  return out
}

/** Every field of the blob and how it merges (see FieldPolicy). The functions run in this order,
 *  which is also the order their keys are appended to the merged blob. */
export const MERGE_POLICY = {
  // the unified tactical objects (schema 2) — authoritative; merged up front (mergeWorkspace)
  objects: (_b, _m, _t, cx) => cx.objects,
  // … and the three legacy collections, its DERIVED views (see lib/workspace · Saved.objects)
  entities: (_b, _m, _t, cx) => cx.views.entities,
  drawings: (_b, _m, _t, cx) => cx.views.drawings,
  timeline: byId,
  // field-level, not whole-object LWW: see mergeTrupp for why trupps are the exception
  trupps: (b, m, t, cx) => mergeById(...([b, m, t].map((side) => splitDuplicateTruppIds(asList(side)).list) as [HasId[], HasId[], HasId[]]), (ancestor, mi, th) => {
    // reported only when both sides changed what a person edits — a marker stamped on each side
    // (the crew filing, a machine write) is no conflict
    const [ha, hm, ht] = [humanTrupp(ancestor), humanTrupp(mi), humanTrupp(th)]
    if (!eq(hm, ht) && !eq(hm, ha) && !eq(ht, ha)) cx.onTruppConflict?.({ key: mi.id, mine: mi, theirs: th })
    return mergeTrupp(ancestor, mi, th)
  }),
  mittel: byId, // append-only material-use events — merge by event id like timeline
  // Schichtenplanung: planned availability blocks, merged by shift id — and PER FIELD when both
  // sides changed one shift (mergeShift, staging r4 D3)
  shifts: (b, m, t) => mergeById(asList(b), asList(m), asList(t), mergeShift),
  // the Schichten grid's columns. They merge by id like any other collection, which gives exactly
  // the semantics the surface needs for free: a band the AdFU creates at the desk appears on the
  // EL's phone seconds later, two devices each creating one keep both, and a delete beats a
  // concurrent rename. Creating a band writes NO shifts (see types.ShiftBand), so the one
  // resolution this merge can never be asked for is 66 duplicated shifts per device.
  bands: byId,
  cameraViews: byId,
  // Ghost «Spuren» (lib/truppTrails) — the searched area a removed Trupp marker left behind.
  // Merges by id like any collection, and it converges without a resolver because the id is
  // DERIVED from the marker (`ght-<markerId>`): two devices reconciling the same removal write
  // the same row rather than two copies of one walked line, and «Spur löschen» is a `removedAt`
  // stamp (a field edit) rather than a drop, so a delete cannot race a concurrent reconciliation.
  trails: byId,
  // Rapport-Beilagen (document/damage photos) — merge by id like any other collection: two
  // devices each adding one keeps both, and a delete beats a concurrent caption edit.
  attachments: byId,
  // digital signatures: appended, never deleted; the only edit is a void, and two devices voiding
  // the same one keep the EARLIER moment it stopped counting (lib/reportSignature)
  reportSignatures: (b, m, t) => mergeById(asList(b), asList(m), asList(t), (_a, mi, th) => {
    const mv = (mi as { voidedAt?: string }).voidedAt, tv = (th as { voidedAt?: string }).voidedAt
    return !tv || (mv && mv <= tv) ? mi : th
  }),
  board: (_b, _m, _t, cx) => cx.views.board,
  // by entity id — and PER FIELD when both sides changed one vehicle's override: the Fahrer named
  // on the tablet and the Herkunft set on the phone in the same second both stand (05.11.2026).
  // The position is one fact, so `coord` stays one field; a field both changed keeps mine.
  vehicleOverrides: (b, m, t) => mergeRecord(asRecord(b), asRecord(m), asRecord(t), undefined,
    (a, mi, th) => (isObj(a) && isObj(mi) && isObj(th) ? mergeFields(a, mi, th).merged : mi)),
  checklists: mergeChecklists, // per tick, within each template (mergeChecklists)
  // records/singletons that ALSO need three-way merging so a concurrent edit in another domain
  // (the "task-scoped multi-editor" case) isn't clobbered by the resolver's whole blob:
  // per-Person presence — a prime parallel-editor surface. A divergence is REPORTED only when the
  // two sides say something different: `noteAt` is when a device wrote the Funktion, not what it
  // says, and two tablets giving the same crew the same «AS-GF» a second apart agree (staging r3
  // F11). An entry BOTH sides changed merges per fact (mergeAttendanceEntry, staging r4 D3); a
  // concurrent same-person ADD (no ancestor) stays LWW-mine.
  attendance: (b, m, t, cx) => {
    const report = cx.onAttendanceConflict &&
      ((c: RecordConflict) => { if (!eq(withoutNoteAt(c.mine), withoutNoteAt(c.theirs))) cx.onAttendanceConflict!(c) })
    return mergeRecord(asRecord(b), asRecord(m), asRecord(t), report,
      (ancestor, mi, th, key) => mergeAttendanceEntry(ancestor, mi, th, key, report))
  },
  planScale: byKey, // per-plan calibration (planId → scale)
  settings: byKey, // per-incident operational settings (Atemschutz doctrine …)
  reportMeta: (b, m, t) => mergeReportMeta(asRecord(b), asRecord(m), asRecord(t)), // Einsatzrapport bookkeeping text
  // frozen sheet bindings — NOT mergeById: the first server binding fixes the backdrop, and only
  // an override of that same snapshot merges; the rule lives with the binding type
  // (lib/incidentPlanBindings).
  planBindings: (b, m, t) => mergeIncidentPlanBindings(
    listOf<IncidentPlanBinding>(b),
    listOf<IncidentPlanBinding>(m),
    listOf<IncidentPlanBinding>(t),
  ),
  building: pick3, // the Gebäude floor-stack doc (merged whole — same-object stays LWW)
  pickedObjectId: pick3, // the shared picked Einsatzobjekt (one picture across devices)
  // «Einsatzdaten geprüft» stamp — MUST be merged, not left to mine: a device that still shows
  // the review banner saves without it, and «mine» would quietly unset the stamp another device
  // just wrote, bringing the banner back on every device.
  intakeReviewedAt: pick3,
  // genuinely local view/device state:
  activePlanId: 'local',
  activeModule: 'local',
  layerState: 'local',
  recent: 'local',
  // written only by the replay fold, never by a live save — nothing to merge
  weather: 'local',
  // the resolving build's own stamp: the merged blob is what THIS build wrote
  schemaVersion: 'local',
} satisfies Record<keyof Saved, FieldPolicy>

/** The `Saved` fields that merge (every row of MERGE_POLICY that is not `'local'`). */
export type SyncedKey = { [K in keyof typeof MERGE_POLICY]: (typeof MERGE_POLICY)[K] extends 'local' ? never : K }[keyof typeof MERGE_POLICY]
/* ⚠️ …and each of them must also REACH THE SCREEN: a merged blob only lands through
 * deriveInitial → applyWorkspace, whose setters are typed against InitialState (lib/workspace ·
 * WorkspaceAppliers). So every synced field needs an InitialState slot of the same name, or
 * `entities`/`drawings`, which arrive as its `doc` view. A synced field without one fails `tsc`
 * here (25.09.2026 — a merge that never reached the screen is saved back as a deletion). */
type SyncedWithoutSlot = Exclude<SyncedKey, keyof InitialState | 'entities' | 'drawings'>
const everySyncedFieldHasASlot: [SyncedWithoutSlot] extends [never] ? true : SyncedWithoutSlot = true
void everySyncedFieldHasASlot

/**
 * Both sides changed the same tactical object: whole-object last-writer-wins (mine) — EXCEPT where
 * one side's change is only the live-GPS follower's (traced coords, `lastSafe`, a pause) and the
 * other's is not. Then the hand's change wins, whichever side it came from (24.09.2026, D3):
 * another device polling the same vehicle feed would otherwise write its follower sample over a
 * «Zurück auf Stand am Einsatzort» or an «Am Einsatzort lösen», and the drive came back.
 */
function resolveTactical(ancestor: TacticalObject, mine: TacticalObject, theirs: TacticalObject, onFormConflict?: (c: RecordConflict) => void): TacticalObject {
  // …and a Tafel PAGE is merged cell by cell (lib/boardFormMerge, review of #338): two devices
  // on one page must both keep what they wrote, and a cell both changed goes to the later edit
  const page = (o: TacticalObject) => (o.sheet?.anno.kind === 'form' && isFormData(o.sheet.anno.form) ? o.sheet.anno.form : null)
  const [pa, pm, pt] = [page(ancestor), page(mine), page(theirs)]
  if (pa && pm && pt && mine.sheet && theirs.sheet) {
    const title = labelText(pm.page.title)
    const live = ({ removedAt: _r, ...f }: BoardFormData): BoardFormData => (void _r, f)
    let form: BoardFormData = mergeFormData(live(pa), live(pm), live(pt), (c) => onFormConflict?.({
      key: `${mine.id}|${c.atom}`,
      mine: { page: title, where: c.where, kept: c.kept },
      theirs: { page: title, where: c.where, lost: c.lost },
    }))
    // ⚠️ One device took the page off while another wrote on it (re-review of #338): the page
    // used to vanish with the writing. A removal is a tombstone (`removedAt`), so the merge can
    // weigh it: writing AFTER the removal keeps the page (the removal loses); writing before it
    // loses to the removal — and either way the Verlauf says so, naming the cells.
    const removedNow = (f: BoardFormData) => f.removedAt != null && pa.removedAt == null
    if (removedNow(pm) !== removedNow(pt)) {
      const [remover, writer] = removedNow(pm) ? [pm, pt] : [pt, pm]
      const at = remover.removedAt as number
      const changed = formDelta(live(pa), live(writer))
      const last = Math.max(0, ...changed.map((c) => writer.t?.[c.k] ?? 0))
      if (changed.length && last > at) {
        onFormConflict?.({ key: `${mine.id}|removed`, mine: { kind: 'removedKept', page: title }, theirs: {} })
      } else {
        form = { ...form, removedAt: at }
        if (changed.length) {
          const cells = [...new Set(changed.map((c) => atomLabel(writer, c.k)))].join(', ')
          onFormConflict?.({ key: `${mine.id}|removed`, mine: { kind: 'removedLost', page: title, cells }, theirs: {} })
        }
      }
    } else if (pm.removedAt != null && pt.removedAt != null) {
      form = { ...form, removedAt: Math.min(pm.removedAt, pt.removedAt) }
    } else if (pa.removedAt != null) {
      // removed before: whichever side brought it back (↶) brought it back
      const back = pm.removedAt == null || pt.removedAt == null
      if (!back) form = { ...form, removedAt: pa.removedAt }
    }
    return { ...mine, sheet: { ...mine.sheet, anno: { ...mine.sheet.anno, form } } }
  }
  const mineMachine = followerOnlyChange(ancestor, mine)
  const theirsMachine = followerOnlyChange(ancestor, theirs)
  return withMergedSymbolReadings(mineMachine && !theirsMachine ? theirs : mine, ancestor, mine, theirs)
}

const readingsOf = (o: TacticalObject) => o.entity?.readings ?? o.sheet?.anno.readings

/**
 * A Messpunkt's history (SymbolProps.readings, lib/symbols · recordReading) when both sides changed
 * the object: the whole-object winner would drop the other tablet's radio report, so the rows are a
 * union instead, keyed by (t, values), in time order. Rows are only ever appended, so there is
 * nothing to weigh – except a row the base had and one side no longer has: that side's Undo, gone.
 * The result lands on both bodies of the winner (a sheet-anchored point carries it twice).
 */
function withMergedSymbolReadings(won: TacticalObject, base: TacticalObject, mine: TacticalObject, theirs: TacticalObject): TacticalObject {
  const [rb, rm, rt] = [readingsOf(base), readingsOf(mine), readingsOf(theirs)]
  if (!rm && !rt) return won
  const key = (r: Reading) => `${r.t}|${JSON.stringify(r.v)}`
  const inBase = new Set((rb ?? []).map(key))
  const seen = new Set<string>()
  const keepM = new Set((rm ?? []).map(key)), keepT = new Set((rt ?? []).map(key))
  const readings = [...(rm ?? []), ...(rt ?? [])]
    .filter((r) => {
      const k = key(r)
      if (seen.has(k)) return false
      seen.add(k)
      return !inBase.has(k) || (keepM.has(k) && keepT.has(k))
    })
    .sort((a, b) => a.t - b.t)
  return {
    ...won,
    ...(won.entity && { entity: { ...won.entity, readings } }),
    ...(won.sheet && { sheet: { ...won.sheet, anno: { ...won.sheet.anno, readings } } }),
  }
}

/**
 * Three-way merge of whole workspace blobs, built for TASK-SCOPED multi-editor use: two operators
 * working DIFFERENT domains of one incident (e.g. Atemschutz on one device, Lage/Plan/report on
 * another) must both keep their work. Every operational domain is merged so a save in one domain
 * never clobbers a concurrent edit in another:
 *   - object collections (entities, drawings, timeline, trupps, cameraViews, trails, board) → per-object
 *     three-way by id (independent adds survive, same object is LWW-mine, delete beats edit);
 *   - records (vehicleOverrides, checklists, attendance, planScale) and singletons (settings,
 *     reportMeta, building, pickedObjectId) → three-way by value, so a field the resolver didn't
 *     touch yields to the server's concurrent change instead of being reverted.
 * Only genuinely LOCAL view/device state stays mine (the `'local'` rows of MERGE_POLICY:
 * activePlanId, activeModule, layerState, recent, weather, schemaVersion). A key this build does
 * not know at all rides with mine too, as it always has.
 * (Same-object field-level edits remain LWW-mine for every collection except trupps, attendance and
 * shifts — see the documented limitation in the tests, mergeTrupp and mergeFields.)
 *
 * `onAttendanceConflict` (optional) reports every attendance key BOTH sides changed to different
 * values (same person, divergent entries — e.g. QR capture vs. KP tablet). The merge result is
 * unchanged (LWW); the caller appends a Verlauf note so the divergence is reviewable.
 *
 * `onTruppConflict` (optional) reports every Trupp BOTH sides changed concurrently. Unlike
 * attendance, the merge here is field-level (mergeTrupp) so nothing is silently dropped — but
 * two devices writing the same SCBA crew's record at once is still worth a human look, so the
 * caller appends a Verlauf note the same way. `key` = the Trupp id, mine/theirs = both objects.
 *
 * `base` and `theirs` are coerced first (asList / asRecord): `mine` is this app's own
 * buildPayload and clean, the other two are whatever the server and the cached ancestor hold.
 * A collection that is not an array merges as empty rather than throwing — the throw used to
 * wedge sync silently and forever (badge stuck on «ausstehend», no toast, re-thrown every retry).
 *
 * `opts.numbers` — which «Trupp N» collisions this merge settles (lib/truppNumbers · NumberScope):
 * `all` by default; a slice session passes what its push can carry (WorkspaceSync · numberScope).
 */
export function mergeWorkspace(
  base: Record<string, unknown>,
  mine: Record<string, unknown>,
  theirs: Record<string, unknown>,
  onAttendanceConflict?: (c: RecordConflict) => void,
  onTruppConflict?: (c: RecordConflict) => void,
  opts: { numbers?: NumberScope; onFormConflict?: (c: RecordConflict) => void } = {},
): Record<string, unknown> {
  // The unified objects (schema 2) are the authoritative tactical collection: each side
  // unifies FIRST (a legacy side — an un-updated device's save — derives its objects from
  // its views), the objects merge per id like any collection, and the three legacy views
  // are then DERIVED from the merged result. Merging views independently beside the
  // objects could let the two disagree about the same id — one truth, derived twice.
  const objectsOf = (ws: Record<string, unknown>): TacticalObject[] =>
    Array.isArray(ws.objects)
      ? (ws.objects as TacticalObject[])
      : objectsFromLegacy(
          listOf<Entity>(ws.entities),
          listOf<Drawing>(ws.drawings),
          asBoard(ws.board),
        )
  const objects = mergeById(objectsOf(base), objectsOf(mine), objectsOf(theirs), (a, m, t) => resolveTactical(a, m, t, opts.onFormConflict))
  const cx: MergeCx = { objects, views: viewsOf(objects), onAttendanceConflict, onTruppConflict }
  const out: Record<string, unknown> = { ...mine } // the 'local' rows (and keys this build doesn't know)
  for (const [k, policy] of Object.entries(MERGE_POLICY) as [keyof Saved, FieldPolicy][]) {
    if (policy !== 'local') out[k] = policy(base[k], mine[k], theirs[k], cx)
  }
  // ⚠️ Two devices that minted the same «Trupp N» at the same moment (25.09.2026): the merge kept
  // both records, as it must, and now settles the NUMBER — one keeps it, the others take the next
  // ones (lib/truppNumbers). A chip that lost is relabelled in the objects, so the three legacy
  // views are derived again from them.
  // Two things first (N16, 25.09.2026): this side's own un-landed renumberings are taken back
  // (a re-merge after a 409 starts from its own last result), and the claims the other side
  // already holds are passed along — a number on the server stays with its holder at equal weight.
  const scope = opts.numbers ?? 'all'
  if (scope !== 'off') out.trupps = unwindUnlanded(out.trupps as Trupp[], theirs.trupps)
  const renumbered = resolveTruppNumbers(out.trupps as Trupp[], objects, {
    trails: out.trails as TruppTrail[],
    scope,
    landed: landedClaims({ trupps: theirs.trupps, objects: objectsOf(theirs) }),
  })
  if (renumbered) {
    out.trupps = renumbered.trupps
    if (renumbered.objects.some((o, i) => o !== objects[i])) {
      const views = viewsOf(renumbered.objects)
      out.objects = renumbered.objects
      out.entities = views.entities
      out.drawings = views.drawings
      out.board = views.board
    }
  }
  return out
}
