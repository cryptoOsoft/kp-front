import { appConfig } from '../config/appConfig'
import { getDeploymentConfig } from './deploymentConfig'
import { formatSymbolName } from './format'
import { doneStatusText } from './objectDone'
import { serverNow } from './serverClock'
import type { CaptionMode, Reading, SymbolControl, SymbolProps } from '../types'

const presets = appConfig.symbols.presets
/** The vehicle's «Herkunft» field key (appConfig.symbols.originField). */
const ORIGIN = appConfig.symbols.originField

/** Deployment suggestion-list override for a given symbol+field — returns the configured
 *  list ONLY when it's non-empty; an empty/absent list falls through to the static preset.
 *  The data-driven `fleet.attributeLists` win; the legacy fixed fields are consulted as a
 *  fallback so pre-migration stored configs keep working (/api/config fleet.*). */
function fleetOptionsFor(name?: string, field?: string): string[] | undefined {
  const fleet = getDeploymentConfig().fleet
  if (!fleet || !name) return undefined
  // data-driven attribute lists take precedence
  const al = fleet.attributeLists?.find((a) => a.symbol === name && a.field === field)
  if (al && al.options.length) return al.options
  // legacy fixed fields (back-compat, only until the config is re-saved through the editor)
  let list: string[] | undefined
  if (name === 'VKF Fahrzeug' && field === 'title') list = fleet.vehicleTypes
  else if (name === 'VKF Luefter mobil' && field === 'Typ') list = fleet.luefterTypes
  else if (name === 'FW Kleinloeschgeraet' && field === 'Typ') list = fleet.kleinloeschTypes
  else if (name === 'VKF Bereich Feuerwehr' && field === 'Einheit') list = fleet.partner?.feuerwehr
  else if (name === 'VKF Bereich Sanitaet' && field === 'Einheit') list = fleet.partner?.sanitaet
  else if (name === 'VKF Bereich Polizei' && field === 'Einheit') list = fleet.partner?.polizei
  return list && list.length ? list : undefined
}

/** The curated preset for a symbol — exact name first, then its category. */
const presetFor = (name?: string, cat?: string) =>
  (name ? presets.byName[name] : undefined) ?? (cat ? presets.byCat[cat] : undefined)

/** A detail field that holds a number, and which kind ContextPanel draws for it: 'count' (the
 *  preset's `fieldKinds`, e.g. the Rettung's «Anzahl Tiere») gets the ± stepper, 'measured' (a
 *  `readout` gas, the Messpunkt's «CO») a text field with the decimal keypad – text, so the
 *  «20,9» of a radio report types as said (measuredNumber reads the comma). */
export function symbolFieldKind(name: string | undefined, key: string): 'count' | 'measured' | undefined {
  const p = name ? presets.byName[name] : undefined
  const k = key.trim()
  return p?.fieldKinds?.[k] ?? (p?.readout?.includes(k) ? 'measured' : undefined)
}

/** What a count field's stored string means to its stepper: `null` while empty, the number for a
 *  plain whole number, `undefined` for anything else — free text typed before the field became a
 *  stepper («2 Katzen»), which keeps its text field so nothing written is hidden or rewritten. */
export function countFieldValue(raw: string): number | null | undefined {
  const t = raw.trim()
  if (!t) return null
  return /^\d+$/.test(t) ? Number(t) : undefined
}

/** Names of every directional symbol (preset lists 'rotation'). This is the ONE
 *  source for both the on-canvas drag-to-rotate handle (MapView / Whiteboard) and
 *  the editor's Drehung stepper, so the two can never drift apart. */
export const ROTATABLE: Set<string> = new Set(
  Object.entries(presets.byName)
    .filter(([, p]) => p.controls?.includes('rotation'))
    .map(([name]) => name),
)

/** A placed directional symbol that supports drag-to-rotate (ladders, fans, vehicles…) — ONE
 *  predicate for both surfaces: typed on the shape an Entity and a BoardAnno share, so the Karte
 *  (lib/mapView re-exports it) and the Plan (Whiteboard) cannot drift apart on which glyphs wear
 *  a rotor. */
export const isRotatableSym = (a: { kind: string; symbol?: string }) => a.kind === 'symbol' && !!a.symbol && ROTATABLE.has(a.symbol)
/** …and the generic placed vehicle, whose typed name is baked into the glyph (text stays upright). */
export const isVehicleSym = (a: { kind: string; symbol?: string }) => a.kind === 'symbol' && a.symbol === appConfig.symbols.vehicleName

/** Names of every symbol whose preset carries a UN-Nr. field (dot-tolerant, like every other
 *  reader of that key): the Gefahrentafel plus the Gas/Chemie hazard symbols. Derived from the
 *  presets — the ONE source — so the ADR/ERG panel, the Stoff search and the Schutzabstand
 *  rings (lib/ergRings) can never disagree about which symbols speak UN. */
export const UN_CAPABLE: Set<string> = new Set(
  Object.entries(presets.byName)
    .filter(([, p]) => p.fields?.some((f) => f.replace(/\.$/, '') === 'UN-Nr'))
    .map(([name]) => name),
)

/** Names of every DRIVEN vehicle — derived, like ROTATABLE, from the presets rather than a
 *  hand-kept list: a vehicle is a symbol that carries a «Fahrer». That is exactly the set the
 *  config comment already calls the driven vehicles (Fahrzeug, Drehleiter, Hubretter,
 *  Grosslüfter, Boot) and it deliberately excludes the mobile Lüfter and the Drohne, which
 *  nobody drives. Used to put a placed vehicle on the Fahrzeuge layer so it toggles with the
 *  live GPS ones instead of being stuck among the tactical symbols. */
export const VEHICLE_SYMBOLS: Set<string> = new Set(
  Object.entries(presets.byName)
    .filter(([, p]) => p.fields?.includes('Fahrer'))
    .map(([name]) => name),
)

/** Which of the three built-in steppers (rotation / count / floor) make sense for
 *  this symbol — the editor renders only these (intersected with what the surface
 *  supports). Unknown symbols fall back to all three (safe default). */
export function symbolControls(name?: string, cat?: string): Set<SymbolControl> {
  const p = presetFor(name, cat)
  return new Set<SymbolControl>(p ? p.controls ?? [] : ['rotation', 'count', 'floor'])
}

/** Seed the shared editable attributes for a freshly-placed FireGIS symbol —
 *  label (operational name), subtitle (category type-line) and the empty key/value
 *  detail rows from the per-symbol / per-category preset. Used by BOTH the Lage
 *  map and the Plan whiteboard placement paths, so a symbol carries the same
 *  structure wherever it is dropped (previously only the map seeded these).
 *
 *  The generic vehicle is special-cased: it is named by the user (like a GPS
 *  unit), so it drops in empty (no label / subtitle / fields) with rotation 0. */
export function seedSymbolProps(name: string, catalog: { name: string; cat: string }[]): SymbolProps {
  // the generic vehicle is user-named, so it drops in without a label/subtitle — but it
  // still seeds its preset fields (e.g. the Fahrer picker) like any other symbol.
  if (name === appConfig.symbols.vehicleName) {
    const tmpl = presets.byName[name]?.fields
    const fields = tmpl?.length ? Object.fromEntries(tmpl.map((k) => [k, ''])) : undefined
    return { symbol: name, label: '', rotation: 0, fields }
  }
  const cat = catalog.find((x) => x.name === name)?.cat
  const tmpl = presetFor(name, cat)?.fields
  const fields = tmpl?.length ? Object.fromEntries(tmpl.map((k) => [k, ''])) : undefined
  return { symbol: name, label: formatSymbolName(name), subtitle: cat, fields }
}

/** Combobox suggestions for a symbol's TITLE input (e.g. common vehicle types). Sourced ONLY
 *  from the deployment config (`fleet.attributeLists` title entry / legacy `vehicleTypes`) —
 *  there is no code-baked default list; an unconfigured title is free-text. */
export function symbolTitleOptions(name?: string, _cat?: string): string[] | undefined {
  return fleetOptionsFor(name, 'title')
}

/** The preset-seeded field keys for a symbol — these are protected from accidental deletion
 *  in the editor (e.g. the Kleinlöscher Typ row), since they belong to the symbol by doctrine. */
export function symbolPresetFieldKeys(name?: string, cat?: string): string[] {
  return presetFor(name, cat)?.fields ?? []
}

/** Per-field combobox suggestions for a symbol: the deployment-configured lists merged with the
 *  Mannschaft roster for the person-name fields (Name / Fahrer). There are NO code-baked default
 *  lists — an unconfigured field stays empty (free typing). Free typing is always allowed. */
export function symbolFieldOptions(name: string | undefined, cat: string | undefined, roster: string[]): Record<string, string[]> {
  const p = presetFor(name, cat)
  const rosterSet = new Set<string>(appConfig.symbols.rosterFields)
  const out: Record<string, string[]> = {}
  // every detail field of the symbol is a key, so a configured (attributeLists or legacy fixed)
  // list applies; plus any extra field a deployment attaches a list to.
  for (const f of p?.fields ?? []) out[f] = []
  for (const a of getDeploymentConfig().fleet?.attributeLists ?? []) {
    if (a.symbol === name && a.field !== 'title') out[a.field] ??= []
  }
  // deployment lists fill the matched field (when non-empty). Roster fields are SKIPPED here:
  // they are person-name pickers and are filled with the Mannschaft below — mixing a category
  // list into them would conflate "who" with "what" (a real reported bug: an Offizier function
  // list bled into the member-name dropdown). Use a separate field.
  for (const key of Object.keys(out)) {
    if (rosterSet.has(key)) continue
    // the symbol's own shipped list first, then a deployment list ON TOP — a station that
    // configures one means it, and a shipped default must never win over what somebody typed
    // into their own config.
    const shipped = p?.fieldOptions?.[key]
    if (shipped?.length) out[key] = shipped
    const override = fleetOptionsFor(name, key)
    if (override) out[key] = override
  }
  // Roster fields → Mannschaft names ONLY (not merged with any configured list).
  for (const key of rosterSet) {
    out[key] = roster
  }
  // …and the Herkunft → the station's ONE list for every vehicle, never a per-symbol one
  if (ORIGIN in out) out[ORIGIN] = vehicleOriginOptions()
  return out
}

/** The «Herkunft» suggestions (`fleet.origins`) – ONE list for every vehicle symbol and every live
 *  GPS vehicle: a Stützpunkt is the same Stützpunkt whether it sends a TLF or a Drehleiter. No
 *  bundled default: which Stützpunkt, which Wache, is station data. Free typing stays possible. */
export function vehicleOriginOptions(): string[] {
  const list = getDeploymentConfig().fleet?.origins
  return Array.isArray(list) ? list.filter((o) => typeof o === 'string' && o.trim()) : []
}

// ─── on-canvas captions: a symbol's metadata printed under its glyph ────────────────
// Mirrors the line-label idea (a Drawing's `label` at its midpoint) for symbols: instead of
// free text, the caption is DERIVED from the symbol's own detail fields, so an operator reads
// "CO₂" under a Kleinlöscher without opening its dashboard (recognition over recall). Shown on
// BOTH surfaces via TacticalSymbol. The Lage map no longer zoom-gates captions — one label
// pass (lib/labelPass) arbitrates them against every other label instead, so a caption is
// shown whole or degrades to a dot rather than the whole class switching off below z16.

/** The detail field that identifies a symbol at a glance — the preset's declared `caption`,
 *  else its first field. Undefined for a fields-less symbol (then only a custom label captions). */
function captionPrimaryKey(name?: string): string | undefined {
  const p = name ? presets.byName[name] : undefined
  return p?.caption ?? p?.fields?.[0]
}

/** The fields of a symbol that are MEASURED VALUES (the preset's `readout`, appConfig). */
const readoutKeys = (props: SymbolProps): readonly string[] =>
  (props.symbol ? presets.byName[props.symbol]?.readout : undefined) ?? []

/** A field value as any reader prints it: a measured value keeps its key («CO 180») — a bare
 *  number names nothing — and everything else stays value-only. */
const keyedValue = (props: SymbolProps, key: string, value: string) =>
  readoutKeys(props).includes(key) ? `${key} ${value}` : value

/** A symbol whose mark is its reading (TacticalSymbol · measured): its preset names measured fields. */
export const isMeasuredSymbol = (props: SymbolProps) => readoutKeys(props).length > 0

/** A measured value as a number – the decimal comma a radio report gets typed with included –
 *  or null when the field holds no number. */
const measuredNumber = (value?: string): number | null => {
  const t = value?.trim().replace(',', '.')
  const n = t ? Number(t) : NaN
  return Number.isFinite(n) ? n : null
}

/** A measured value's alarm stage: calm, Voralarm (A1, amber) or Hauptalarm (A2, red). */
export type ReadingLevel = 'ok' | 'a1' | 'a2'
const LEVEL_RANK: Record<ReadingLevel, number> = { ok: 0, a1: 1, a2: 2 }

const reached = (lim: { atLeast?: number; below?: number } | undefined, n: number) =>
  !!lim && ((lim.atLeast != null && n >= lim.atLeast) || (lim.below != null && n < lim.below))

/** The stage `value` of the measured field `key` has reached – the preset's `alarm` (appConfig),
 *  the higher stage winning. A field without limits, or no number, is calm. */
export function readingLevel(symbol: string | undefined, key: string, value?: string): ReadingLevel {
  const lim = symbol ? presets.byName[symbol]?.alarm?.[key] : undefined
  const n = measuredNumber(value)
  if (!lim || n == null) return 'ok'
  return reached(lim.a2, n) ? 'a2' : reached(lim.a1, n) ? 'a1' : 'ok'
}

/** The panel's colour bar under a measured field (ReadingBar): one band per stretch between two
 *  limits, with the stage a value inside it reaches, and where `value` sits (null when it is no
 *  number). Not to scale on purpose – a calm band gets three times the room of an alarm band: the
 *  bar answers «how close to amber/red», not «how much». Null for a field without limits. */
export function alarmBar(symbol: string | undefined, key: string, value?: string): { zones: { from: number; to: number; level: ReadingLevel }[]; at: number | null } | null {
  const lim = symbol ? presets.byName[symbol]?.alarm?.[key] : undefined
  const cuts = [...new Set([lim?.a1, lim?.a2].flatMap((l) => [l?.below, l?.atLeast]).filter((x): x is number => x != null))].sort((a, b) => a - b)
  if (!cuts.length) return null
  const probes = [cuts[0] - 1, ...cuts.map((c, i) => (i + 1 < cuts.length ? (c + cuts[i + 1]) / 2 : c + 1))]
  const levels = probes.map((x) => readingLevel(symbol, key, String(x)))
  const weights = levels.map((l) => (l === 'ok' ? 3 : 1))
  const total = weights.reduce((a, b) => a + b, 0)
  let from = 0
  const zones = levels.map((level, i) => {
    const z = { from, to: from + weights[i] / total, level }
    from = z.to
    return z
  })
  const n = measuredNumber(value)
  if (n == null) return { zones, at: null }
  // inside its band, between the band's two limits; the first band starts at 0 (no gas is
  // negative), the open last one runs as wide again as the band before it
  const b = cuts.findIndex((c) => n < c) === -1 ? cuts.length : cuts.findIndex((c) => n < c)
  const lo = b === 0 ? Math.min(0, cuts[0]) : cuts[b - 1]
  const hi = b < cuts.length ? cuts[b] : cuts[b - 1] + (cuts[b - 1] - (b >= 2 ? cuts[b - 2] : 0) || 1)
  const f = Math.min(1, Math.max(0, hi > lo ? (n - lo) / (hi - lo) : 0))
  return { zones, at: zones[b].from + f * (zones[b].to - zones[b].from) }
}

/** How far past the limit of the stage it reached a value is – value ÷ limit, ≥ 1; a «below»
 *  limit inverted (limit ÷ value), so further is always bigger: O₂ 15 under a 17 is 1.13. 0 for a
 *  calm value – nothing is past anything there. */
function overLimit(symbol: string | undefined, key: string, value?: string): number {
  const level = readingLevel(symbol, key, value)
  const lim = level === 'ok' || !symbol ? undefined : presets.byName[symbol]?.alarm?.[key]?.[level]
  const n = measuredNumber(value)
  if (!lim || n == null) return 0
  if (lim.atLeast != null && n >= lim.atLeast) return lim.atLeast > 0 ? n / lim.atLeast : 1
  return lim.below != null ? lim.below / Math.max(n, 0.01) : 0
}

/** A measured symbol's alarm scale, as its ⓘ explains it (ReadingParts · ReadingInfo): every
 *  `readout` gas with limits, in preset order, with its A1/A2 – read off the preset the levels
 *  are read off, so a station's own limits explain themselves – and the preset's `staleMin`.
 *  Null for a symbol without limits. */
export function readingScale(symbol?: string) {
  const p = symbol ? presets.byName[symbol] : undefined
  const alarm = p?.alarm
  if (!alarm) return null
  const gases = (p.readout ?? []).flatMap((key) => (alarm[key] ? [{ key, ...alarm[key] }] : []))
  return gases.length ? { gases, staleMin: p.staleMin } : null
}

/** What a measured symbol's mark says (TacticalSymbol · reading). */
export interface SymbolReading {
  /** the gas the mark wears, keyed – «CO 180»; null for a point placed but not yet measured */
  text: string | null
  /** that value's alarm stage – the mark turns amber (A1) or red (A2) */
  level: ReadingLevel
  /** how far that value is past its stage's limit (overLimit) – 0 while calm */
  over: number
  /** when the last reading was taken (epoch ms); null without a history (points from before 27.10.) */
  at: number | null
  /** whole minutes since the last reading; null without a history */
  ageMin: number | null
  /** older than the preset's `staleMin`: the colour moves to the outline and the age shows */
  stale: boolean
}

/**
 * The value a measured symbol wears AS its mark (the Messpunkt, 26./27.10.2026). The WORST gas
 * wins – the highest alarm stage, then the one furthest past its limit (an «Ex 24» over a «CO 65»:
 * 1.2 × its A2 against 1.08 ×), then preset order, which is what decides among calm values – so
 * an «Ex 12» is never hidden behind a harmless «CO 14», and calm says CO first. Null for every
 * symbol without a `readout`.
 *
 * A reading is part of the mark, not a caption: the label pass books it as the glyph's own
 * footprint instead of suppressing it – a hidden reading is a wrong picture of the building.
 */
export function symbolReading(props: SymbolProps, now = Date.now()): SymbolReading | null {
  const keys = readoutKeys(props)
  if (!keys.length) return null
  const fields = props.fields ?? {}
  const rated = keys.filter((k) => fields[k]?.trim()).map((k) => ({
    k, level: readingLevel(props.symbol, k, fields[k]), over: overLimit(props.symbol, k, fields[k]),
  }))
  const worst = rated.reduce<(typeof rated)[number] | undefined>((best, g) => (
    !best || LEVEL_RANK[g.level] > LEVEL_RANK[best.level] || (g.level === best.level && g.over > best.over) ? g : best
  ), undefined)
  const rs = props.readings; const at = rs?.length ? rs[rs.length - 1].t : null
  const ageMin = at != null ? Math.max(0, Math.floor((now - at) / 60_000)) : null
  const staleMin = props.symbol ? presets.byName[props.symbol]?.staleMin : undefined
  return {
    text: worst ? `${worst.k} ${fields[worst.k].trim()}` : null,
    level: worst?.level ?? 'ok',
    over: worst?.over ?? 0,
    at,
    ageMin,
    stale: !!worst && ageMin != null && staleMin != null && ageMin >= staleMin,
  }
}

/** an old reading's age on its pill – «18′», the minute sign standing in for «vor … min» */
export const readingAge = (r: SymbolReading) => (r.ageMin != null ? `${r.ageMin}′` : '')

/** larger first, as a comparator step (0 on a tie, so the next step decides) */
const desc = (a: number, b: number) => (a === b ? 0 : a > b ? -1 : 1)

/**
 * THE order of Messpunkte, worst first – the «Messungen» chip and list (readingsList) and the
 * Gebäude's stack (StackReadings) sort with this one comparator, so the chip's pill is always the
 * list's first row (sweep 28.10.2026 #3: an old «Ex 24» stood in front of a new «Ex 30»). Highest
 * alarm stage, a measured point before one not measured yet, a fresh reading before a stale one,
 * the furthest past its limit, the newest reading; a full tie keeps the caller's order.
 */
export function compareReadings(a: SymbolReading | null, b: SymbolReading | null): number {
  const rank = (r: SymbolReading | null) => (r ? LEVEL_RANK[r.level] : -1)
  return desc(rank(a), rank(b))
    || desc(a?.text ? 1 : 0, b?.text ? 1 : 0)
    || desc(a?.stale ? 0 : 1, b?.stale ? 0 : 1)
    || desc(a?.over ?? 0, b?.over ?? 0)
    || desc(a?.at ?? -Infinity, b?.at ?? -Infinity)
}

/** Everything the label pass measures of a reading pill (useLabelPass · lib/mapView SYM_PILL_STYLE). */
export const readingPillText = (r: SymbolReading) => [r.text, r.stale ? readingAge(r) : ''].filter(Boolean).join(' ')

/** The reading's text alone («CO 180») – what the label pass measures and the legend prints. */
export function symbolReadoutText(props: SymbolProps): string | null {
  return symbolReading(props)?.text ?? null
}

/** The measured fields of `fields` that hold a value – one history row's `v`. */
const measuredValues = (props: SymbolProps, fields: Record<string, string>) =>
  Object.fromEntries(readoutKeys(props).flatMap((k) => (fields[k]?.trim() ? [[k, fields[k].trim()]] : [])))

/**
 * The history after the panel changed a measured symbol's fields to `fields`: one more row when
 * the measured values differ from the last row, else the history as it was. ALWAYS appends –
 * never rewrites a row – so a merge of two tablets is a plain union (lib/mergeWorkspace); that one
 * radio report typed gas by gas is ONE reading is a display rule (readingRows).
 */
export function recordReading(props: SymbolProps, fields: Record<string, string>, now = Date.now()): Reading[] | undefined {
  if (!readoutKeys(props).length) return props.readings
  const v = measuredValues(props, fields)
  const last = props.readings?.[props.readings.length - 1]
  const same = (a: Record<string, string>, b: Record<string, string>) =>
    Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, x]) => b[k] === x)
  if (!Object.keys(v).length || (last && same(last.v, v))) return props.readings
  return [...(props.readings ?? []), { t: now, v }]
}

/** The `readings` half of a field commit – empty for every symbol without a measured field and
 *  for a change that left the measured values as they were, so no other object grows the key. */
export function readingPatch(props: SymbolProps, fields: Record<string, string>, now = serverNow()): { readings?: Reading[] } {
  const readings = recordReading(props, fields, now)
  return readings === props.readings ? {} : { readings }
}

/** Rows typed within this long of the next one belong to the same radio report. */
export const READING_BURST_MS = 2 * 60_000

/** The history as the panel lists it: newest first, each burst of edits (one report typed gas by
 *  gas, a typo fixed) folded into its last row. */
export function readingRows(props: SymbolProps): Reading[] {
  const rs = props.readings ?? []
  return rs.filter((r, i) => !(i + 1 < rs.length && rs[i + 1].t - r.t < READING_BURST_MS)).reverse()
}

/** A label worth printing: operator-entered text, NOT the auto-formatted symbol name (which the
 *  glyph already conveys). The user-named vehicle's title ("TLF 1") passes; a plain "Hydrant"
 *  does not. */
function customLabel(props: SymbolProps): string | undefined {
  const l = props.label?.trim()
  if (!l) return undefined
  if (props.symbol && l === formatSymbolName(props.symbol)) return undefined
  return l
}

/**
 * Does this symbol carry the name of a PERSON the operator typed in?
 *
 * The two Führung person symbols (Einsatzleiter, Offizier) seed a 'Name' field, and a filled one
 * is not metadata about a glyph — it is who is standing there. That earns the caption a higher
 * rank in the map's label pass than «CO₂» or «1200 l/min» (lib/labelPass · LABEL_RANK.team):
 * before 31.08. an Offizier's name simply vanished whenever another glyph sat under its caption
 * box, and the only way to read it was to tap the symbol.
 *
 * Keyed off the PRESET's field list, not a symbol-name allowlist, so a Gruppenführer sign added
 * later with a 'Name' field is covered without touching this.
 */
export function isNamedPerson(props: SymbolProps): boolean {
  const fields = props.symbol ? presets.byName[props.symbol]?.fields : undefined
  return !!fields?.includes('Name') && !!props.fields?.['Name']?.trim()
}

/**
 * A symbol's line in a PRINTED legend — «Art · Bezeichnung · Status», e.g.
 * «Rettung · 2 Personen vermisst · in Rettung».
 *
 * ⚠️ NOT `symbolCaptionText`. A caption hangs under a glyph the reader is looking at, so it is
 * value-only and as short as it can be («in Rettung») — the glyph says the rest. On paper the
 * words are lifted OFF the picture into a numbered legend (backend · kroki · _number_words), and
 * there the same string is an answer without its question: the 18.09.2026 review's legend read
 * «in Rettung · nicht bestätigt · Widmer Céline» and named not one object. The legend has the
 * room, so the line says what the thing IS first.
 *
 * Every symbol gets one — a bare Lüfter too, so each glyph on the sheet can be looked up. The
 * symbol's own `caption: 'off'` is deliberately NOT read: it declutters a screen, and a legend
 * line clutters nothing. Only the device-wide «Beschriftungen aus» still silences the sheet.
 * 'all' adds the free-text notes, as it does on screen.
 */
export function symbolLegendText(props: SymbolProps, globalMode: CaptionMode): string | null {
  if (globalMode === 'off') return null
  // a Form has no Art to name — it keeps exactly the words the operator gave it. So does a live
  // GPS vehicle (its label is its name), plus the one thing an operator says about it: the Herkunft
  if (!props.symbol) {
    const origin = props.fields?.[ORIGIN]?.trim()
    return [props.label?.trim(), origin && `${ORIGIN}: ${origin}`].filter(Boolean).join(' · ') || null
  }
  const fields = props.fields ?? {}
  const order = presets.byName[props.symbol]?.fields ?? []
  const keys = [...order, ...Object.keys(fields).filter((k) => !order.includes(k))]
  // a vehicle's label IS its name («TLF 1») and never equals the symbol's own, so it passes
  // …and a symbol marked «Gelöscht / erledigt» (lib/objectDone) ends on that STATUS with its time
  // — «Feuer · gelöscht 20:40» — the one word a grey glyph on paper cannot say by itself
  // …and the Herkunft says what it is («Herkunft: Stützpunkt»): beside a Fahrer's name, a bare
  // «Stützpunkt» on paper reads as a place
  const value = (k: string, v: string) => (k === ORIGIN ? `${k}: ${v}` : keyedValue(props, k, v))
  const parts = [formatSymbolName(props.symbol), customLabel(props), ...keys.map((k) => fields[k]?.trim() && value(k, fields[k].trim())), globalMode === 'all' ? props.notes?.trim() : undefined, doneStatusText(props) ?? undefined]
  const seen = new Set<string>()
  // one line: the legend wraps by itself, and a newline would start a second, unnumbered row
  return parts.filter((v): v is string => !!v && !seen.has(v) && !!seen.add(v)).map((v) => v.replace(/\s*\n\s*/g, ' ')).join(' · ')
}

/** The text to print under a symbol's glyph, or null when there's nothing worth showing.
 *  Value-only (the glyph implies the key). `globalMode` is the device default; a symbol's own
 *  `caption` overrides it. 'auto' = the one discriminating value; 'all' = every filled detail
 *  (newline-separated). Pure — the renderer adds the zoom gate. */
export function symbolCaptionText(props: SymbolProps, globalMode: CaptionMode): string | null {
  const mode = props.caption ?? globalMode
  if (mode === 'off') return null
  // The generic vehicle draws its own name INSIDE the glyph. So it stays silent in 'auto' (the
  // glyph already says everything that discriminates it), and in 'all' it prints everything the
  // operator typed EXCEPT that name — otherwise "TLF 1" would sit twice on the same marker.
  // Without this, a vehicle showed nothing at all in 'all': its Fahrer, its custom Bezeichnungen
  // and its Notizen were unreachable on the map.
  const vehicle = props.symbol === appConfig.symbols.vehicleName
  if (vehicle && mode !== 'all') return null
  // the Herkunft is never part of the caption: it is its own grey line under it (symbolOriginText)
  const { [ORIGIN]: _origin, ...fields } = props.fields ?? {}
  const order = ((props.symbol ? presets.byName[props.symbol]?.fields : undefined) ?? Object.keys(fields)).filter((k) => k !== ORIGIN)
  const label = vehicle ? undefined : customLabel(props)
  if (mode === 'all') {
    // 'all' = EVERYTHING the operator typed on this symbol: the preset detail fields (in canonical
    // order) PLUS any custom key/value rows they added PLUS the free-text notes — not just the
    // pre-defined preset fields. Value-only (the glyph implies the keys), de-duplicated.
    const extraKeys = Object.keys(fields).filter((k) => !order.includes(k))
    const allFilled = [...order, ...extraKeys].map((k) => fields[k]?.trim() && keyedValue(props, k, fields[k].trim())).filter((v): v is string => !!v)
    const notes = props.notes?.trim()
    const seen = new Set<string>()
    const lines = [label, ...allFilled, notes].filter((v): v is string => !!v && !seen.has(v) && !!seen.add(v))
    return lines.length ? lines.join('\n') : null
  }
  // Officer symbols (preset carries BOTH 'Funktion' and 'Name') compose the pair when both are
  // filled — «Front · Meier»: the glyph is one generic figure for many roles, so the Funktion
  // alone answers "what" without the who, and the Name alone the reverse. With only one filled,
  // fall through to the normal single-value rule below.
  const presetFields = props.symbol ? presets.byName[props.symbol]?.fields : undefined
  if (presetFields?.includes('Funktion') && presetFields.includes('Name')) {
    const funktion = fields['Funktion']?.trim()
    const name = fields['Name']?.trim()
    if (funktion && name) return `${funktion} · ${name}`
  }
  // 'auto': the primary discriminating value, else the first filled field, else a custom label.
  // A measured value never: it is already ON the glyph (symbolReadoutText), so under it 'auto'
  // prints only what the readout cannot say — the Messpunkt's Raum.
  const measured = readoutKeys(props)
  const primaryKey = captionPrimaryKey(props.symbol)
  const primary = primaryKey && !measured.includes(primaryKey) ? fields[primaryKey]?.trim() : undefined
  const firstPlain = order.find((k) => !measured.includes(k) && fields[k]?.trim())
  return primary || (firstPlain && fields[firstPlain].trim()) || label || null
}

/** The vehicle's «Herkunft» as the map prints it: a small grey line under the caption
 *  (TacticalSymbol · origin), on the Karte and the Plan alike – or null for the own Feuerwehr
 *  (empty) and wherever captions are off. It ignores 'auto' vs 'all': the one fact that says «not
 *  ours» is worth its line in both. */
export function symbolOriginText(props: SymbolProps, globalMode: CaptionMode): string | null {
  if ((props.caption ?? globalMode) === 'off') return null
  return props.fields?.[ORIGIN]?.trim() || null
}

/** The caption box's text as the label pass measures it: the caption, then the Herkunft line. */
export function symbolCaptionBoxText(props: SymbolProps, globalMode: CaptionMode): string | null {
  const lines = [symbolCaptionText(props, globalMode), symbolOriginText(props, globalMode)].filter(Boolean)
  return lines.length ? lines.join('\n') : null
}

// ─── admin: the configurable symbol/field catalog ──────────────────────────────────
// The Fahrzeuge-&-Geräte viewer browses EVERY library symbol and shows each one's attributes. A
// symbol's attributes are its special 'title' (only the user-titled vehicle) plus each preset
// detail field, flagged for roster (person-name) fields which are auto-filled from the Mannschaft.
// Suggestion lists are NOT code-baked — they come from the deployment config; an unconfigured
// field is free-text.

export interface ConfigurableField {
  key: string
  /** person-name field (Name / Fahrer): filled from the Mannschaft, not config-listable here */
  roster: boolean
  /** the vehicle's «Herkunft»: its list is the station's ONE `fleet.origins`, not a per-symbol one */
  origin?: boolean
}

/** Every attribute a symbol exposes, in display order: the vehicle's special 'title' (only the
 *  user-titled vehicle) then each preset detail field. Returns [] for a label-only symbol. */
export function symbolConfigurableFields(name?: string, cat?: string): ConfigurableField[] {
  const p = presetFor(name, cat)
  const rosterSet = new Set<string>(appConfig.symbols.rosterFields)
  const out: ConfigurableField[] = []
  if (name === appConfig.symbols.vehicleName) out.push({ key: 'title', roster: false })
  for (const f of p?.fields ?? []) out.push({ key: f, roster: rosterSet.has(f), ...(f === ORIGIN ? { origin: true } : {}) })
  return out
}
