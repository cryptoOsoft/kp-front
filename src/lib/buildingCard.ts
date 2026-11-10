// What the Gebäude card (components/BuildingCard) draws, decided here so it can be pinned without
// mounting anything: the chips in order, which of them are hazards, the one line of sources, and
// whether there is anything to show at all.
//
// The rules (KP Front card F5, 3am tenet):
//   · hazards first, and a hazard is a GLYPH + a WORD — never colour only (gas, oil, PV);
//   · nothing that nags: a source that failed, a building without a register entry, an object
//     without notes simply draws nothing, and a card with nothing in it is not drawn;
//   · every fact says where it came from and when (the sources line), and the card as a whole
//     says «Register-Hinweis», because the register can be years behind the building.
import { appConfig } from '../config/appConfig'
import { fillTemplate } from './format'
import type { BuildingGwr, BuildingInfo, BuildingSystem } from './api/building'

export interface BuildingChip {
  key: string
  text: string
  /** a hazard: drawn with the warn glyph and the amber tag */
  hazard: boolean
  /** a hazard's one word for the closed chip («Gas», «PV») – buildingChipSummary */
  word?: string
  title?: string
}

/** Energy keys that put fuel on site — the gas main valve, the oil tank. */
export const HAZARD_ENERGY = new Set(['gas', 'oil'])

/** «2026-10-07» or a full ISO timestamp → «07.10.2026»; '' when it does not parse. */
export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (m) return `${m[3]}.${m[2]}.${m[1]}`
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}

function energyWord(key: string): string | null {
  if (key === 'unknown') return null
  const words = appConfig.copy.building.energy as Record<string, string>
  return words[key] ?? words.other
}

function fmtKw(kw: number): string {
  const n = kw >= 100 ? Math.round(kw) : Math.round(kw * 10) / 10
  return fillTemplate(appConfig.copy.building.kw, { n: String(n) })
}

const HEAT_PUMP_ENERGY = new Set(['air', 'geothermal', 'water'])

/** The heating / hot-water systems; a device's card cached before 20.10.2026 has only the energy keys. */
function systems(listed: BuildingSystem[] | undefined, energies: string[]): BuildingSystem[] {
  return listed ?? energies.map((energy) => ({ energy, generator: null, shared: false }))
}

/** «Gas, Heizkessel für mehrere Gebäude» – the fuel with what burns it; null when it names nothing.
 *  The energy words already say «Wärmepumpe (Luft)», so a heat pump on air/ground/water adds no word. */
function systemWords(sys: BuildingSystem): string | null {
  const C = appConfig.copy.building
  const e = sys.energy ? energyWord(sys.energy) : null
  const gen = sys.generator && !(sys.generator === 'heat_pump' && sys.energy && HEAT_PUMP_ENERGY.has(sys.energy))
    ? (C.generator as Record<string, string>)[sys.generator] ?? null
    : null
  const detail = gen ? (sys.shared ? fillTemplate(C.generatorShared, { g: gen }) : gen) : sys.shared ? C.sharedOnly : null
  if (e && detail) return fillTemplate(C.systemWith, { e, d: detail })
  return e ?? gen
}

/** One system's chip – a hazard when it puts fuel on site, with that fuel as its word. */
function systemChip(key: string, template: string, sys: BuildingSystem): BuildingChip | null {
  const w = systemWords(sys)
  if (!w) return null
  const fuel = sys.energy != null && HAZARD_ENERGY.has(sys.energy) ? energyWord(sys.energy) ?? undefined : undefined
  return { key, text: fillTemplate(template, { e: w }), hazard: !!fuel, word: fuel }
}

/** Hot water «differs» from the heating unless one heating system burns the same energy in the
 *  same kind of generator (an unnamed generator matches any – the old cached cards). */
const sameSystem = (a: BuildingSystem, b: BuildingSystem) =>
  a.energy === b.energy && (a.generator == null || b.generator == null || a.generator === b.generator)

/** «EG 3 · 1. OG 6 (Maisonette)» – per storey only from two flats up; one flat has no layout to read. */
function storeyLine(g: BuildingGwr): string[] {
  const C = appConfig.copy.building
  const rows = g.flats_by_floor ?? []
  if (rows.reduce((n, r) => n + r.flats, 0) < 2) return []
  return rows.map((r) => {
    const s = r.level === 0 ? C.storeyGround : fillTemplate(r.level > 0 ? C.storeyUp : C.storeyDown, { n: Math.abs(r.level) })
    const p = fillTemplate(C.storeyFlats, { s, n: r.flats })
    if (!r.maisonettes) return p
    return r.maisonettes === r.flats ? fillTemplate(C.storeyMaisonette, { p }) : fillTemplate(C.storeyMaisonettes, { p, m: r.maisonettes })
  })
}

/** The Wohnungen chip: the count, the flats per storey and the Zimmer range, ONE line («9 Wohnungen
 *  · EG 3 · 1. OG 6 (Maisonette) · 2–4 Zi.»). The count drops out when the Gebäudeklasse already
 *  says it («Einfamilienhaus» + «1 Wohnung»). */
function flatsText(g: BuildingGwr): string | null {
  const C = appConfig.copy.building
  const parts: string[] = []
  const saidByClass = (g.building_class === 'single_family' && g.flats === 1) || (g.building_class === 'two_family' && g.flats === 2)
  if (g.flats != null && !saidByClass) parts.push(g.flats === 1 ? C.flatsOne : fillTemplate(C.flats, { n: g.flats }))
  parts.push(...storeyLine(g))
  const lo = g.rooms_min, hi = g.rooms_max
  if (lo != null && hi != null) parts.push(lo === hi ? fillTemplate(C.rooms, { n: lo }) : fillTemplate(C.roomsRange, { a: lo, b: hi }))
  return parts.length ? parts.join(' · ') : null
}

export function buildingChips(b: BuildingInfo | null): BuildingChip[] {
  if (!b) return []
  const C = appConfig.copy.building
  const hazards: BuildingChip[] = []
  const facts: BuildingChip[] = []
  const g = b.gwr_status === 'ok' ? b.gwr : null
  if (g) {
    const heaters = systems(g.heaters, g.heating)
    // each heating system with what makes the heat; a second one only when the register names one
    const chips = heaters.map((sys, i) => systemChip(`heat-${i}`, C.heating, sys))
    // hot water only when it differs from the heating – a gas boiler for the tap behind a heat
    // pump is exactly the valve nobody would look for
    for (const [i, sys] of systems(g.water_heaters, g.hot_water).entries()) {
      if (!heaters.some((h) => sameSystem(h, sys))) chips.push(systemChip(`water-${i}`, C.hotWater, sys))
    }
    for (const c of chips) if (c) (c.hazard ? hazards : facts).push(c)
  }
  if (b.pv_status === 'ok') {
    // ONE PV tag per building, however many registrations its roof has (an extension is a second
    // plant in the register): the crew needs «PV, this much», not the paperwork
    const pv = b.plants.filter((p) => p.kind === 'pv')
    if (pv.length) {
      const total = pv.every((p) => p.power_kw != null) ? pv.reduce((sum, p) => sum + (p.power_kw ?? 0), 0) : null
      const first = pv.map((p) => p.since).filter((d): d is string => !!d).sort()[0]
      hazards.push({
        key: 'pv',
        text: total != null ? fillTemplate(C.pv, { kw: fmtKw(total) }) : C.pvBare,
        hazard: true,
        word: C.pvBare,
        title: fillTemplate(C.pvTitle, { since: first ? fillTemplate(C.pvSince, { d: fmtDay(first) }) : '' }),
      })
    }
    for (const [i, p] of b.plants.entries()) {
      if (p.kind === 'pv') continue
      if (p.label) {
        facts.push({ key: `plant-${i}`, text: p.power_kw != null ? `${p.label} ${fmtKw(p.power_kw)}` : p.label, hazard: false })
      }
    }
  }
  if (g) {
    const lead: BuildingChip[] = []
    if (g.status) {
      const word = (C.status as Record<string, string>)[g.status]
      if (word) lead.push({ key: 'status', text: word, hazard: false })
    }
    const kind = g.building_class ? (C.buildingClass as Record<string, string>)[g.building_class] : undefined
    if (kind) lead.push({ key: 'class', text: kind, hazard: false })
    if (g.floors != null) lead.push({ key: 'floors', text: g.floors === 1 ? C.floorsOne : fillTemplate(C.floors, { n: g.floors }), hazard: false })
    const flats = flatsText(g)
    if (flats) lead.push({ key: 'flats', text: flats, hazard: false })
    if (g.year != null) lead.push({ key: 'year', text: fillTemplate(C.year, { y: g.year }), hazard: false })
    else if (g.period) lead.push({ key: 'year', text: fillTemplate(C.period, { p: g.period }), hazard: false })
    if (g.shelter) lead.push({ key: 'shelter', text: C.shelter, hazard: false })
    facts.unshift(...lead)
  }
  return [...hazards, ...facts]
}

/** «GWR Hauptstrasse 10 · Stand 07.10.2026 · Heizung erfasst 29.06.2022 · BFE abgefragt 09.10.2026» */
export function buildingSources(b: BuildingInfo | null): string {
  if (!b) return ''
  const C = appConfig.copy.building
  const parts: string[] = []
  if (b.gwr_status === 'ok' && b.gwr) {
    const street = (b.address ?? '').split(',')[0].trim()
    const d = fmtDay(b.gwr.stand)
    if (d) parts.push(street ? fillTemplate(C.srcGwr, { a: street, d }) : fillTemplate(C.srcGwrNoAddr, { d }))
    if (b.gwr.heating.length && b.gwr.heating_date) parts.push(fillTemplate(C.srcHeating, { d: fmtDay(b.gwr.heating_date) }))
  }
  if (b.pv_status === 'ok' && b.plants.length) {
    parts.push(fillTemplate(C.srcPv, { d: fmtDay(b.pv_kept_from ?? b.registers_fetched_at) }))
  } else if (b.gwr_kept_from) {
    parts.push(fillTemplate(C.srcCached, { d: fmtDay(b.gwr_kept_from) }))
  }
  return parts.join(' · ')
}

/** Stored text → its lines (one measure per line), blank ones dropped. */
export function noteLines(text: string | null | undefined): string[] {
  return (text ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
}

/** Whose notes the card shows, ONLY when they are a neighbour's: «Schloss Musterdorf · in der
 *  Nähe (120 m)» when the object was surfaced by proximity alone — a neighbour's gas valve reads
 *  exactly like ours. The object at this address says nothing: its source line («Schloss
 *  Musterdorf · Modul 1») went (owner, 27.10.2026: «for Sofortmassnahmen, drop the source»). */
export function objectCaption(b: BuildingInfo | null): string {
  const o = b?.object
  if (!o || o.address_match) return ''
  const C = appConfig.copy.building
  return o.distance_m != null
    ? fillTemplate(C.objectNear, { name: o.name, m: Math.round(o.distance_m) })
    : fillTemplate(C.objectNearNoDist, { name: o.name })
}

export function visitLine(b: BuildingInfo | null): string {
  const v = b?.visit
  if (!v || !v.visited_at) return ''
  const C = appConfig.copy.building
  const d = fmtDay(v.visited_at)
  if (!v.findings) return fillTemplate(C.visit, { d })
  return v.findings === 1 ? fillTemplate(C.visitFindingsOne, { d }) : fillTemplate(C.visitFindings, { d, n: v.findings })
}

/** Anything to draw? A card with nothing in it is not drawn — no empty state that nags. */
export function hasBuildingContent(b: BuildingInfo | null): boolean {
  if (!b) return false
  return buildingChips(b).length > 0
    || noteLines(b.object?.measures).length > 0
    || noteLines(b.object?.remarks).length > 0
    || visitLine(b) !== ''
}

/** What the closed chip on the Karte / the plan's chip row says: the hazards as WORDS («Gas · PV»),
 *  or nothing beyond «Gebäude» when there are none. `hazard` drives the warn glyph. */
export interface BuildingChipSummary {
  hazard: boolean
  /** the hazard words, deduplicated, in the chips' order («Gas», «Heizöl», «PV») */
  words: string[]
  /** how many Sofortmassnahmen the Objekt has to be read (0 = none) – the chip's count badge */
  measures: number
  /** the full sentence for aria-label / title */
  label: string
}

export function buildingChipSummary(b: BuildingInfo | null): BuildingChipSummary | null {
  if (!b || !hasBuildingContent(b)) return null
  const C = appConfig.copy.building
  const words: string[] = []
  for (const c of buildingChips(b)) {
    if (!c.hazard) continue
    const w = c.word ?? c.text
    if (!words.includes(w)) words.push(w)
  }
  const measures = noteLines(b.object?.measures).length
  const open = words.length
    ? fillTemplate(C.chipLabelHazards, { h: words.join(', ') })
    : C.chipLabel
  const label = measures ? `${open} · ${fillTemplate(measures === 1 ? C.chipMeasuresOne : C.chipMeasures, { n: measures })}` : open
  return { hazard: words.length > 0, words, measures, label }
}
