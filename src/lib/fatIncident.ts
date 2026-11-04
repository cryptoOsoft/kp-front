/**
 * A synthetic, deterministic «fat» incident for measuring how the app holds up as an Einsatz
 * grows — larger (more on the map, more people, more Trupps) and longer (more Verlauf, more saves,
 * more audit events). MEASUREMENT TOOLING ONLY: the app never imports this; the benches
 * (`fatIncident.bench.ts`) and the browser measurement (`e2e/fat-incident.perf.ts`) do.
 *
 * ⚠️ Calibrated against the real record, not guessed (read-only look at prod, 26.09.2026):
 * `scale: 1, hours: 5` is the biggest incident on record — Brand Fahrzeug 03.09. ran 5½ h with
 * 1 458 saves (one snapshot each) and 1 754 audit events; Feueralarm 23.09. carried 14 map
 * symbols, 28 plan annotations, ~25 people in the Anwesenheit and 233 Verlauf rows; the biggest
 * blob was 79 KB. So «10×» below means ten times the busiest real Einsatz, not ten times a toy.
 *
 * Shape follows today's app: the Verlauf lives in the journal table (not in the blob, which is
 * why `workspace.timeline` is empty), the blob carries schema-2 `objects` beside its legacy views
 * (both are written on every save), and the audit chain is dominated by `workspace.save`.
 *
 * Two knobs, because they grow different things:
 *   - `scale` — what is standing at once: symbols, lines, plan annotations, people, Trupps
 *   - `hours` — what accumulates: Verlauf rows, Trupp readings and trails, Mittel, saves, events
 * Everything carries a creation instant, so `stateAt(f)` is the blob as it stood at fraction `f`
 * of the incident — what a device held, and saved, at that moment.
 */
import type { AttendanceState, BoardAnno, BoardDoc, BoardPoint, BuildingDoc, CameraView, Drawing, Entity, LngLat, MittelEntry, TimelineEvent, Trupp, TruppReading } from '../types'
import type { TacticalObject } from './tacticalObjects'
import type { Saved } from './workspace'
import type { ReplayEvent } from './replay'
import type { ChecklistState } from './checklists'

export interface FatOptions {
  /** × the busiest real incident's standing content (default 1) */
  scale?: number
  /** incident duration in hours (default 5) */
  hours?: number
  /** RNG seed — same seed, same incident (default 1) */
  seed?: number
  /** alarm instant (default 20.09.2026 14:00 UTC) */
  start?: string
  /** Schadenplatz (default: Oberwil BL) */
  center?: LngLat
}

/** The sizes worth measuring. `real` is the record to beat; the others are what a Grossereignis or
 *  an Unwetter day would plausibly add up to. */
export const FAT_PRESETS = {
  real: { scale: 1, hours: 5 },
  long: { scale: 1, hours: 24 },
  large: { scale: 10, hours: 8 },
  extreme: { scale: 25, hours: 24 },
} as const satisfies Record<string, FatOptions>
export type FatPreset = keyof typeof FAT_PRESETS

export interface FatIncident {
  options: Required<Omit<FatOptions, 'center'>> & { center: LngLat }
  startedAt: string
  endedAt: string
  /** the blob at the end of the incident */
  workspace: Saved
  /** the Verlauf, oldest first (journal table rows) */
  journal: TimelineEvent[]
  /** the audit chain, oldest first — `seq` from 1, one `workspace.save` per save */
  events: ReplayEvent[]
  /** how many full-blob saves a real crew would have produced (~290 per hour, from the record) */
  saves: number
  /** the blob as it stood at fraction `f` (0…1) of the incident */
  stateAt(f: number): Saved
}

// --- calibration (per ×1, per 5 h unless noted) -------------------------------------------------

const BASE = {
  symbols: 10, vehicles: 3, notes: 2, shapes: 1, teams: 4,
  lines: 3, areas: 1, circles: 1,
  planAnnos: 28, people: 25, concurrentTrupps: 3, cameraViews: 2,
}
const PER_HOUR = {
  journal: 60, mittel: 2, saves: 290, weather: 10, tacticalEvents: 55,
  /** Trupps are not in all the time: the record shows ~5 Atemschutz registrations in a 5 h Einsatz,
   *  so each concurrent slot sees a new Trupp about every two hours */
  truppStartsPerSlot: 0.4,
}

const SYMBOLS = ['VKF Feuer', 'VKF Rettungen', 'VKF Gefaehrliche Stoffe', 'VKF KP Front', 'VKF Sammelstelle', 'VKF Einsatzleiter', 'VKF Bereich Sanitaet', 'VKF Luefter mobil', 'FW Elektroanlage', 'SI Unterflurhydrant', 'VKF Rauch']
const WORDS = ['Lage', 'Trupp', 'Angriff', 'Wasser', 'Leitung', 'Rauch', 'Treppenhaus', 'Dach', 'Keller', 'Sanität', 'Polizei', 'Werkhof', 'Zufahrt', 'Absperrung', 'Lüfter', 'Nachlöschen', 'Kontrolle', 'Wärmebild', 'Hydrant', 'Druck', 'gemeldet', 'eingetroffen', 'erledigt', 'unter Kontrolle', 'Personen', 'evakuiert', 'Gebäude', 'Nordseite', 'Westfassade', '2. OG']
// people get names from their own pools, surname first as the app writes them («Brunner Thomas»), so a
// shot of the Anwesenheit or a Trupp card reads like a real crew (they were drawn from WORDS –
// «Absperrung unter Kontrolle» as a person). A Trupp's name IS its leader (lib/atemschutz ·
// truppHeadName). Every pick costs the same draws as before, so everything else stays where it was.
const FIRST_NAMES = ['Anna', 'Beat', 'Claudia', 'Daniel', 'Eva', 'Fabian', 'Lara', 'Lukas', 'Marco', 'Nina', 'Reto', 'Sandra', 'Simon', 'Urs']
const SURNAMES = ['Meier', 'Müller', 'Huber', 'Schmid', 'Weber', 'Brunner', 'Baumann', 'Frei', 'Gerber', 'Fischer', 'Graf', 'Roth', 'Steiner', 'Widmer', 'Moser', 'Wyss', 'Suter', 'Bühler', 'Hofer', 'Lüthi']
const PEOPLE = SURNAMES.flatMap((last) => FIRST_NAMES.map((first) => `${last} ${first}`))
const AUFTRAG = ['loeschen', 'retten', 'absuchen', 'sichern', 'erkunden'] as const

/** mulberry32 — small, fast, good enough for fixtures, and the same on every machine */
function rng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
    words: (lo: number, hi: number, pool: readonly string[] = WORDS) => Array.from({ length: lo + Math.floor(next() * (hi - lo + 1)) }, () => pool[Math.floor(next() * pool.length)]).join(' '),
  }
}

/** `n` per 5 h at ×1, grown by scale and/or duration — never below 1 once the base is non-zero */
const count = (base: number, factor: number) => (base > 0 ? Math.max(1, Math.round(base * factor)) : 0)

export function fatIncident(opts: FatOptions = {}): FatIncident {
  const options = {
    scale: opts.scale ?? 1,
    hours: opts.hours ?? 5,
    seed: opts.seed ?? 1,
    start: opts.start ?? '2026-09-20T14:00:00.000Z',
    center: opts.center ?? ([7.5557, 47.5138] as LngLat),
  }
  const { scale, hours, center } = options
  const r = rng(options.seed)
  const t0 = Date.parse(options.start)
  const t1 = t0 + hours * 3_600_000
  const iso = (ms: number) => new Date(ms).toISOString()
  const hhmm = (ms: number) => { const d = new Date(ms); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` }
  /** an instant weighted towards the first hour, where most of the standing picture is drawn */
  const early = () => t0 + Math.pow(r.next(), 2.2) * (t1 - t0)
  const anytime = () => t0 + r.next() * (t1 - t0)
  // the spread of the Schadenplatz grows with scale: ten times the content is a bigger area,
  // not ten times the density on one building
  const spreadM = 120 * Math.sqrt(scale)
  const mLng = 1 / (111_320 * Math.cos((center[1] * Math.PI) / 180))
  const mLat = 1 / 110_540
  const near = (m = spreadM): LngLat => [center[0] + (r.next() - 0.5) * 2 * m * mLng, center[1] + (r.next() - 0.5) * 2 * m * mLat]
  const walk = (from: LngLat, n: number, stepM: number): LngLat[] => {
    const out: LngLat[] = [from]
    let [x, y] = from
    let dir = r.next() * Math.PI * 2
    for (let i = 1; i < n; i++) {
      dir += (r.next() - 0.5) * 0.9
      x += Math.cos(dir) * stepM * mLng
      y += Math.sin(dir) * stepM * mLat
      out.push([x, y])
    }
    return out
  }
  const born = new Map<string, number>() // id → creation instant, for stateAt
  let idn = 0
  const id = (p: string, at: number) => { const v = `${p}${(++idn).toString(36)}`; born.set(v, at); return v }

  // --- Lage: entities --------------------------------------------------------------------------
  const entities: Entity[] = []
  for (let i = 0; i < count(BASE.symbols, scale); i++) {
    const at = early()
    const symbol = r.pick(SYMBOLS)
    entities.push({
      id: id('s', at), kind: 'symbol', layer: 'taktisch', coord: near(), symbol, label: r.words(1, 4),
      subtitle: r.words(1, 2), fields: r.next() < 0.5 ? { Status: r.words(1, 2) } : {},
      ...(r.next() < 0.4 ? { floor: r.int(-1, 3) } : {}),
      ...(r.next() < 0.3 ? { rotation: r.int(0, 359) } : {}),
    })
  }
  for (let i = 0; i < count(BASE.vehicles, scale); i++) {
    const at = early()
    entities.push({ id: id('v', at), kind: 'vehicle', layer: 'fahrzeuge', coord: near(), symbol: 'VKF Fahrzeug', label: `TLF ${i + 1}` })
  }
  for (let i = 0; i < count(BASE.notes, scale); i++) {
    const at = anytime()
    entities.push({ id: id('n', at), kind: 'note', layer: 'markup', coord: near(), label: r.words(4, 14), ...(r.next() < 0.5 ? { noteW: 180 } : {}) })
  }
  for (let i = 0; i < count(BASE.shapes, scale); i++) {
    const at = early()
    entities.push({ id: id('sh', at), kind: 'shape', layer: 'markup', coord: near(), shape: r.pick(['arrow', 'square'] as const), sizeM: r.int(10, 60), rotation: r.int(0, 359) })
  }

  // --- Atemschutz: Trupps rotate through the whole incident ------------------------------------
  const trupps: Trupp[] = []
  const teamEntities: Entity[] = []
  const slots = count(BASE.concurrentTrupps, scale)
  const startsPerSlot = Math.max(1, Math.round(PER_HOUR.truppStartsPerSlot * hours))
  let truppNo = 0
  for (let s = 0; s < slots; s++) {
    for (let k = 0; k < startsPerSlot; k++) {
      const entry = t0 + ((k + r.next() * 0.3) / startsPerSlot) * (t1 - t0) + 5 * 60_000
      if (entry >= t1) continue
      const exit = Math.min(t1, entry + r.int(18, 30) * 60_000)
      const tid = id('tr', entry - 3 * 60_000)
      const readings: TruppReading[] = [{ t: iso(entry - 3 * 60_000), bar: 300, kind: 'registered' }, { t: iso(entry), bar: 300, kind: 'entry' }]
      let bar = 300
      for (let t = entry + 3 * 60_000; t < exit; t += 3 * 60_000) {
        bar = Math.max(60, bar - r.int(8, 22))
        readings.push({ t: iso(t), bar, kind: r.next() < 0.5 ? 'contact' : 'pressure' })
      }
      const out = exit < t1
      if (out) readings.push({ t: iso(exit), bar, kind: 'exit' })
      const onMap = r.next() < 0.5
      const trupp: Trupp = {
        id: tid, no: ++truppNo, name: r.words(1, 1, PEOPLE), members: [r.words(1, 1, PEOPLE), r.words(1, 1, PEOPLE)],
        auftrag: r.pick(AUFTRAG), ziel: r.words(1, 3), funkkanal: 11, order: truppNo,
        entryPressureBar: 300, entryTime: iso(entry), lastContactTime: readings[readings.length - 1].t,
        lastPressureBar: bar, lastPressureTime: readings[readings.length - 1].t, lowestBar: bar, readings,
        status: out ? 'raus' : 'aktiv', ...(out ? { exitTime: iso(exit) } : {}),
      }
      if (onMap) {
        // a team marker leaves a breadcrumb every ~5 min while it works
        const n = Math.max(2, Math.round((exit - entry) / 300_000))
        const path = walk(near(spreadM * 0.5), n, 8)
        const eid = id('tm', entry)
        teamEntities.push({
          id: eid, kind: 'team', layer: 'taktisch', coord: path[path.length - 1], label: trupp.name, truppId: tid, t: hhmm(exit),
          trail: path.map((coord, j) => ({ coord, t: hhmm(entry + j * 300_000) })),
        })
        trupp.entityId = eid
      }
      trupps.push(trupp)
    }
  }
  entities.push(...teamEntities)

  // --- Lage: drawings ---------------------------------------------------------------------------
  const drawings: Drawing[] = []
  for (let i = 0; i < count(BASE.lines, scale); i++) {
    const at = early()
    drawings.push({
      id: id('d', at), kind: 'line', coords: walk(near(), r.int(6, 40), 6), color: '#1f6feb', width: 4,
      ...(r.next() < 0.5 ? { lineNo: i + 1, content: r.pick(['S', 'W', 'H'] as const) } : {}),
      ...(r.next() < 0.3 ? { arrow: true, label: r.words(1, 3), labelAt: near() } : {}),
    })
  }
  for (let i = 0; i < count(BASE.areas, scale); i++) {
    const at = early()
    const ring = walk(near(), r.int(5, 16), 12)
    drawings.push({ id: id('a', at), kind: 'area', coords: [...ring, ring[0]], color: '#e8392b', fillOpacity: 0.15, label: `Abschnitt ${i + 1}`, abschnittLeiter: r.words(1, 1, PEOPLE), abschnittAuftrag: r.words(3, 8) })
  }
  for (let i = 0; i < count(BASE.circles, scale); i++) {
    const at = early()
    drawings.push({ id: id('c', at), kind: 'circle', coords: [near()], radiusM: r.int(40, 150), color: '#e8392b', fillOpacity: 0.06, locked: true, label: r.words(1, 2) })
  }

  // --- Plan: annotations over a floor stack and two Module sheets -------------------------------
  const board: BoardDoc = {}
  const plans = ['gebaeude', 'modul1', 'modul3']
  const pt = (): [number, number] => [r.next(), r.next()]
  for (let i = 0; i < count(BASE.planAnnos, scale); i++) {
    const at = anytime()
    const planId = r.pick(plans)
    const roll = r.next()
    let anno: BoardAnno
    if (roll < 0.45) {
      anno = { id: id('b', at), kind: 'symbol', x: r.next(), y: r.next(), symbol: r.pick(SYMBOLS), label: r.words(1, 3), floor: r.int(-1, 3), fields: {} }
    } else if (roll < 0.75) {
      // freehand ink is the heaviest thing a sheet carries: dozens of points per stroke
      const [x, y] = pt()
      const pts: BoardPoint[] = Array.from({ length: r.int(20, 90) }, (_, j) => [Math.min(1, x + j * 0.004 + r.next() * 0.01), Math.min(1, y + Math.sin(j / 5) * 0.03)])
      anno = { id: id('b', at), kind: 'draw', pts, color: '#1f6feb', width: 3 }
    } else if (roll < 0.9) {
      anno = { id: id('b', at), kind: 'text', x: r.next(), y: r.next(), text: r.words(2, 8) }
    } else {
      const trail = Array.from({ length: r.int(2, 12) }, () => ({ x: r.next(), y: r.next(), t: hhmm(anytime()), floor: r.int(0, 3) }))
      anno = { id: id('b', at), kind: 'resource', x: r.next(), y: r.next(), text: r.words(1, 2), color: '#1f6feb', floor: r.int(0, 3), trail, t: trail[trail.length - 1].t }
    }
    ;(board[planId] ??= []).push(anno)
  }

  // --- Anwesenheit, Mittel, Kamera-Ansichten, Checklisten, Gebäude ------------------------------
  const attendance: AttendanceState = {}
  for (let i = 0; i < count(BASE.people, scale); i++) {
    const at = early()
    const pid = id('p', at)
    const left = r.next() < 0.3 ? Math.min(t1, at + r.int(60, 240) * 60_000) : null
    attendance[pid] = {
      status: left ? 'left' : 'present', checkedInAt: iso(at), displayNameSnapshot: `${r.words(1, 1, SURNAMES)} ${r.words(1, 1, FIRST_NAMES)}`,
      intervals: [left ? { from: iso(at), to: iso(left) } : { from: iso(at) }], ...(left ? { leftAt: iso(left) } : {}),
      source: r.next() < 0.6 ? 'capture' : 'kp', ...(r.next() < 0.2 ? { note: r.words(2, 5), noteAt: iso(at) } : {}),
    }
  }
  const mittel: MittelEntry[] = []
  for (let i = 0; i < count(PER_HOUR.mittel * hours, scale); i++) {
    const at = anytime()
    mittel.push({ id: id('m', at), materialId: `mat${r.int(1, 40)}`, label: r.words(1, 2), unit: 'Stk', menge: r.int(1, 20), at: iso(at), by: r.words(1, 1, SURNAMES) })
  }
  mittel.sort((a, b) => a.at.localeCompare(b.at))
  const cameraViews: CameraView[] = Array.from({ length: count(BASE.cameraViews, scale) }, (_, i) => ({ id: id('cv', early()), name: `Ansicht ${i + 1}`, center: near(), zoom: 17 + r.next() * 2, bearing: r.int(0, 359) }))
  const ticks = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`step${i}`, { t: iso(early()), by: r.words(1, 1, SURNAMES) }]))
  const checklists: ChecklistState = { brand: { ticks: ticks(12) }, atemschutz: { ticks: ticks(6) } }
  const buildingRing: [number, number][] = Array.from({ length: 32 }, (_, i) => [0.5 + 0.45 * Math.cos((i / 32) * 2 * Math.PI), 0.5 + 0.45 * Math.sin((i / 32) * 2 * Math.PI)])
  const building: BuildingDoc = { ring: buildingRing, ringAspect: 1.4, floors: [-1, 0, 1, 2, 3], rings: [buildingRing], geo: { origin: center, spanM: 24 } }

  // --- Verlauf (journal) -----------------------------------------------------------------------
  const journal: TimelineEvent[] = []
  // one KP writes the Verlauf: ten times the content is more to report, not ten times the writing
  // hands — so the rows grow with √scale, the standing content with scale
  const nJournal = count(PER_HOUR.journal * hours, Math.sqrt(scale))
  for (let i = 0; i < nJournal; i++) {
    const at = anytime()
    const roll = r.next()
    const row: TimelineEvent = {
      id: id('j', at), t: hhmm(at), at: iso(at), icon: roll < 0.5 ? 'note' : roll < 0.8 ? 'hex' : 'team',
      text: r.words(4, 16), kind: roll < 0.5 ? 'journal' : roll < 0.8 ? 'symbol' : 'team',
      ...(roll < 0.2 ? { entryType: 'auftrag' as const } : {}),
    }
    journal.push(row)
    // one in twenty rows is a Pendenz, most of which get done later — two rows, as in the app
    if (r.next() < 0.05) {
      row.reminder = { op: 'created', id: row.id }
      if (r.next() < 0.8) {
        const done = Math.min(t1, at + r.int(5, 90) * 60_000)
        journal.push({ id: id('j', done), t: hhmm(done), at: iso(done), icon: 'check', text: 'Erledigt', kind: 'reminder', reminder: { op: 'done', id: row.id } })
      }
    }
  }
  journal.sort((a, b) => a.at!.localeCompare(b.at!))

  // --- the blob -----------------------------------------------------------------------------------
  const layerState = ['base-carto', 'base-osm', 'base-air', 'taktisch', 'fahrzeuge', 'fahrzeugspuren', 'personen', 'markup'].map((lid) => ({ id: lid, visible: lid !== 'base-osm' && lid !== 'base-air' && lid !== 'fahrzeugspuren', opacity: 100 }))
  const snapshot = (upTo: number): Saved => {
    const alive = (x: { id: string }) => (born.get(x.id) ?? t0) <= upTo
    const byTime = <T extends { t: string }>(xs: T[] | undefined) => xs?.filter((x) => Date.parse(x.t) <= upTo)
    const ents = entities.filter(alive).map((e) => (e.kind === 'team' ? { ...e, trail: e.trail?.filter((_, j) => born.get(e.id)! + j * 300_000 <= upTo) } : e))
    const draws = drawings.filter(alive)
    const brd: BoardDoc = Object.fromEntries(Object.entries(board).map(([p, annos]) => [p, annos.filter(alive)]))
    const tr = trupps.filter(alive).map((t) => {
      const readings = byTime(t.readings)!
      const last = readings[readings.length - 1]
      const exited = t.exitTime && Date.parse(t.exitTime) <= upTo
      return { ...t, readings, lastContactTime: last.t, lastPressureTime: last.t, lastPressureBar: last.bar, lowestBar: last.bar, status: exited ? 'raus' as const : readings.some((x) => x.kind === 'entry') ? 'aktiv' as const : 'angemeldet' as const, exitTime: exited ? t.exitTime : undefined }
    })
    // the schema-2 objects exactly as lib/tacticalObjects · objectsFromLegacy unifies them (a test
    // pins the two together): one record per id, the sheet body carrying the plan anchor
    const objects: TacticalObject[] = [
      ...ents.map((e) => ({ id: e.id, entity: e })),
      ...draws.map((d) => ({ id: d.id, drawing: d })),
      ...Object.entries(brd).flatMap(([planId, annos]) => annos.map((anno) => ({ id: anno.id, sheet: { planId, anno } }))),
    ]
    return {
      entities: ents, drawings: draws, board: brd, objects, recent: SYMBOLS.slice(0, 8), layerState, timeline: [],
      activePlanId: 'gebaeude', building,
      trupps: tr,
      attendance: Object.fromEntries(Object.entries(attendance).filter(([pid]) => born.get(pid)! <= upTo)),
      mittel: mittel.filter((m) => Date.parse(m.at) <= upTo),
      cameraViews: cameraViews.filter(alive), checklists, shifts: [], bands: [], trails: [], attachments: [], reportSignatures: [],
      planScale: {}, settings: {}, vehicleOverrides: {},
      reportMeta: { alarmText: 'Brand Mehrfamilienhaus', startedAt: iso(t0), einsatzleiter: 'Oblt Muster' },
      schemaVersion: 2,
    }
  }

  // --- audit chain -------------------------------------------------------------------------------
  const saves = Math.round(PER_HOUR.saves * hours)
  const raw: Omit<ReplayEvent, 'seq'>[] = [{ occurred_at: iso(t0), op_type: 'incident.create', source: 'status', payload_json: { title: 'Fat incident' } }]
  for (let i = 0; i < saves; i++) raw.push({ occurred_at: iso(t0 + ((i + 1) / saves) * (t1 - t0)), op_type: 'workspace.save', source: 'client', payload_json: { rev: i + 1 } })
  for (let i = 0; i < Math.round(PER_HOUR.weather * hours); i++) raw.push({ occurred_at: iso(t0 + (i / (PER_HOUR.weather * hours)) * (t1 - t0)), op_type: 'weather.observe', source: 'client', payload_json: { weather: { wind_dir_deg: r.int(0, 359), wind_speed_kmh: r.int(0, 30), wind_gust_kmh: null, temp_c: 14, precip_mm: 0, weather_code: 2, observed_at: iso(t0), source: 'meteoswiss', station: 'BAS' } } })
  for (const e of entities) raw.push({ occurred_at: iso(born.get(e.id)!), op_type: 'entity.add', source: 'client', payload_json: { id: e.id, entity: e } })
  for (const d of drawings) raw.push({ occurred_at: iso(born.get(d.id)!), op_type: 'draw.add', source: 'client', payload_json: { id: d.id, drawing: d } })
  for (const [planId, annos] of Object.entries(board)) for (const a of annos) raw.push({ occurred_at: iso(born.get(a.id)!), op_type: 'board.add', source: 'client', payload_json: { planId, anno: a } })
  const tactical = count(PER_HOUR.tacticalEvents * hours, Math.sqrt(scale))
  for (let i = 0; i < tactical; i++) {
    const e = r.pick(entities)
    const at = Math.max(born.get(e.id)!, anytime())
    raw.push(r.next() < 0.5
      ? { occurred_at: iso(at), op_type: 'entity.move', source: 'client', payload_json: { id: e.id, coord: near() } }
      : { occurred_at: iso(at), op_type: 'entity.edit', source: 'client', payload_json: { id: e.id, patch: { label: r.words(1, 4) } } })
  }
  for (const j of journal) raw.push({ occurred_at: j.at!, op_type: 'journal.add', source: 'client', payload_json: { id: j.id, text: j.text.slice(0, 40) } })
  for (const t of trupps) for (const x of t.readings ?? []) raw.push({ occurred_at: x.t, op_type: `atemschutz.${x.kind}`, source: 'client', payload_json: { id: t.id, bar: x.bar } })
  raw.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
  const events: ReplayEvent[] = raw.map((e, i) => ({ ...e, seq: i + 1 }))

  return {
    options, startedAt: iso(t0), endedAt: iso(t1), journal, events, saves,
    workspace: snapshot(t1),
    stateAt: (f: number) => snapshot(t0 + Math.min(1, Math.max(0, f)) * (t1 - t0)),
  }
}
