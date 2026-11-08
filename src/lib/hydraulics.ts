import type { HoseSize, RelayPumpOverride, RelaySettings, RelaySource } from '../types'
import { getDeploymentConfig } from './deploymentConfig'
import type { ProfilePoint } from './profile'

// Wassertransport — the pressure along a hose relay and where its pumps go. No React, no copy:
// Messen › Strecke and the Leitung editor both drive it through lib/useRelay, and the validated
// click prototype (proto/wassertransport-prototype.html, 03.11.2026) is its origin. Pure but for
// ONE read: `hoseDefaults()`, the station's doctrine for the Ø a Leitung or a Messen relay
// starts on (deployment config `doctrine.defaultLineHose` / `defaultRelayHose`).
//
// ⚠️ Which default a Leitung without a stored Ø reads as (`lineHose`, lead 05.11.2026): one that
// carries a Wassertransport (`relay`) is a TRANSPORT line and reads as the relay default (75) –
// the Leitungen laid since #536 (04.11.2026) were computed on it and must not re-plan to 40; a
// plain one reads as the Linie default (40). A Ø picked by hand always wins. Adding a relay in
// the line editor writes the Ø out in the same edit (`relayAddPatch`), so the «Schlauch» row
// never jumps from 40 to 75 under the operator's finger.
//
// ⚠️ The numbers are doctrine, not tuning. Friction: AGV Kantonale Beilage Basiswissen KB 06.06
// (55 mm), 06.07 (75 mm), 06.08 (110 mm), «Druckverlust in bar» per 100 m by the flow in ONE line.
// The AGV set has no 40 mm table; that one is GVB «Behelf für den Einsatz von TLF und MS» (2023),
// «Wassertransport · Tabellen», the ø 40 table's 100 m column — its ø 55 and ø 75 tables are the
// AGV values row for row, so it is the same doctrine. Height: 1 bar per 10 m (FKS Reglement 06.29). A pump needs
// at least 2 bar at its inlet (FKS 06.42) — which is where an automatic pump is placed. It is a
// PLANUNGSHILFE: the surfaces say so and name these sources (components/WaterRelay).

/** A hose's inner diameter (mm) — what the friction table is keyed by. */
type HoseDiameter = 40 | 55 | 75 | 110

/** bar per 100 m of ONE line, by flow in that line (l/min) — [flow, bar] rows */
const AGV: Record<HoseDiameter, readonly (readonly [number, number])[]> = {
  // GVB Behelf TLF/MS (see above). The table ends at 500 l/min: a 40 mm line is a Druckleitung to
  // one Strahlrohr, never a Transportleitung, so beyond that the loss is extrapolated and flagged.
  40: [[100, .32], [150, .75], [200, 1.35], [250, 2.25], [300, 3.35], [350, 4.70], [400, 6.15], [450, 7.90], [500, 10.00]],
  55: [[100, .13], [150, .25], [200, .40], [250, .60], [300, .82], [350, 1.10], [400, 1.40], [450, 1.70], [500, 2.10], [600, 2.90], [700, 3.85], [800, 5.05], [900, 6.40], [1000, 7.85]],
  75: [[200, .07], [250, .11], [300, .16], [350, .22], [400, .28], [450, .35], [500, .42], [600, .58], [700, .77], [800, .98], [900, 1.25], [1000, 1.50], [1100, 1.75], [1200, 2.05], [1300, 2.35], [1400, 2.68], [1500, 3.05], [1600, 3.45], [1700, 3.85], [1800, 4.25], [1900, 4.70], [2000, 5.20]],
  110: [[600, .11], [700, .14], [800, .17], [900, .21], [1000, .25], [1100, .29], [1200, .33], [1300, .38], [1400, .44], [1500, .49], [1600, .55], [1700, .61], [1800, .67], [1900, .73], [2000, .80], [2100, .87], [2200, .94], [2300, 1.02], [2400, 1.09], [2500, 1.18], [2600, 1.26], [2700, 1.34], [2800, 1.43], [2900, 1.53], [3000, 1.63]],
}

/** The one place the relay's thresholds and defaults live — the chart zones, the warnings and
 *  the steppers all read them from here. */
export const RELAY = {
  /** pump inlet minimum (FKS 06.42): an automatic pump stands where the pressure reaches it */
  minInletBar: 2,
  /** above this the pressure is «gut»; between minInletBar and this it is «knapp» */
  okBar: 3,
  /** what a pump puts out unless set otherwise per pump */
  defaultPumpBar: 10,
  /** height term (FKS 06.29): 1 bar per 10 m */
  barPerMHeight: 0.1,
  /** more pumps than this gets the «mehr als üblich» warning */
  manyPumps: 3,
  /** a moved pump keeps this far from its neighbours and the line's end (m) */
  pinGapM: 5,
  defaultFlow: 800,
  defaultSource: 'hydrant' as RelaySource,
  defaultHydrantBar: 6,
  /** the Wasser picker's presets (l/min); any other amount is typed, within flowMin..flowMax */
  flows: [400, 600, 800, 1000, 1200, 1600],
  flowMin: 100,
  flowMax: 3000,
  /** the Eingangsdruck / Ausgangsdruck steppers' ± step (bar); a typed value keeps one decimal */
  barStep: 0.5,
  hydrantBarMax: 16,
  pumpBarMin: 3,
  pumpBarMax: 16,
} as const

/** The symbol a Leitung's pumps are drawn as on the Karte and the printed Kroki («Pumpen auf
 *  Karte», lib/linePumps): the pack's Motorspritze, «MS 2» in the FKS blue box (tools/gen_symbols.py ·
 *  «VKF Pumpe Typ2»; its palette aliases are Motorspritze / Wassertransport / MS). */
export const RELAY_PUMP_SYMBOL = 'VKF Pumpe Typ2'

/** What each hose choice is: its diameter, and how many identical lines share the flow. */
export const HOSES: Record<HoseSize, { d: HoseDiameter; lines: 1 | 2 }> = {
  '40': { d: 40, lines: 1 },
  '55': { d: 55, lines: 1 },
  '75': { d: 75, lines: 1 },
  '2x75': { d: 75, lines: 2 },
  '110': { d: 110, lines: 1 },
}
/** Every Ø a Leitung can carry — the line editor's «Schlauch» row and the load gate. */
export const HOSE_SIZES = ['40', '55', '75', '2x75', '110'] as const satisfies readonly HoseSize[]
/** The Ø a Wassertransport is OFFERED on (Messen's Schlauch-Ø row, the «what the other hoses
 *  would need» hint, the station's relay default): every one but 40 mm, a Druckleitung whose
 *  table ends below the relay's usual flows. A Leitung that IS 40 mm still computes as one. */
export const RELAY_HOSE_SIZES = ['55', '75', '2x75', '110'] as const satisfies readonly HoseSize[]

/** The shipped Ø: a plain Linie is a 40 mm Druckleitung, a Wassertransport a 75 mm
 *  Transportleitung (owner 05.11.2026). A station overrides both (`hoseDefaults`). */
export const SHIPPED_HOSE = { line: '40', relay: '75' } as const satisfies Record<string, HoseSize>

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => (list as readonly unknown[]).includes(v)

/** The Ø a Leitung that stores none reads as (`line`), and the one a Wassertransport in Messen
 *  starts on (`relay`) — the station's doctrine, else `SHIPPED_HOSE`. A value this build does not
 *  know falls back too. Call at use, never at module level (the config resolves at boot). */
export function hoseDefaults(): { line: HoseSize; relay: HoseSize } {
  const { defaultLineHose: line, defaultRelayHose: relay } = getDeploymentConfig().doctrine ?? {}
  return {
    line: isOneOf(HOSE_SIZES, line) ? line : SHIPPED_HOSE.line,
    relay: isOneOf(RELAY_HOSE_SIZES, relay) ? relay : SHIPPED_HOSE.relay,
  }
}

/** What a Leitung's Ø is read from: the stored pair (Drawing / BoardAnno · hose, relay). */
export interface LineHoseFields { hose?: HoseSize; relay?: RelaySettings }

/** The Ø a Leitung computes and shows with: its own; else, carrying a Wassertransport, the
 *  station's relay default; else its Linie default (the rule in this module's header). */
export const lineHose = ({ hose, relay }: LineHoseFields): HoseSize => {
  const d = hoseDefaults()
  return hose ?? (relay ? d.relay : d.line)
}

/** What adding a Wassertransport to a Leitung writes, as ONE edit (one undo step): an empty
 *  `relay` – so the Leitung shows it from then on, as an adopted Strecke does – and, where no Ø
 *  was picked, the relay default written out. A picked Ø is never touched. Null: nothing to write. */
export function relayAddPatch({ hose, relay }: LineHoseFields): LineHoseFields | null {
  if (hose && relay) return null
  return { ...(relay ? null : { relay: {} }), ...(hose ? null : { hose: hoseDefaults().relay }) }
}

export interface Loss {
  /** bar per 100 m of one line */
  bar: number
  /** the flow is a row of the table, or between two of its rows */
  inTable: boolean
  /** the flow is ABOVE the table — the value is an estimate the surface must flag */
  above: boolean
}

/**
 * bar/100 m for ONE line of diameter `d` carrying `q` l/min. Linear between table rows; outside
 * the table quadratic in flow from the nearest row (FKS: doppelte Menge = vierfacher Verlust).
 * Only ABOVE the table is flagged: below it the loss is tiny and the estimate harmless.
 */
export function lossPer100m(d: HoseDiameter, q: number): Loss {
  const t = AGV[d]
  const [q0, b0] = t[0]
  if (q <= q0) return { bar: b0 * (q / q0) ** 2, inTable: q === q0, above: false }
  const [qn, bn] = t[t.length - 1]
  if (q >= qn) return { bar: bn * (q / qn) ** 2, inTable: q === qn, above: q > qn }
  const i = t.findIndex(([qi]) => q <= qi)
  const [qa, ba] = t[i - 1], [qb, bb] = t[i]
  return { bar: ba + ((q - qa) / (qb - qa)) * (bb - ba), inTable: true, above: false }
}

export interface RelayPump {
  /** metres from the source along the route */
  dist: number
  /** altitude m ü.M. (0 without a profile) */
  alt: number
  inBar: number
  outBar: number
  /** moved by hand — it stands exactly there */
  pinned: boolean
  /** a moved pump whose inlet is below the minimum (an automatic one never is) */
  low: boolean
}

export interface RelayPlan {
  /** the height profile was used */
  terrain: boolean
  /** the profile scaled onto the route length (flat two points without terrain) */
  prof: ProfilePoint[]
  /** the pressure line for the chart: (dist, bar), a pump is two points at the same dist */
  line: { dist: number; bar: number }[]
  pumps: RelayPump[]
  endBar: number
  loss: Loss
  /** the calculation gave up: a pump puts out no more than the minimum, or the pumps ran away */
  stuck: boolean
}

export interface RelayRequest {
  /** along the route, or null ⇒ no height (offline / outside CH) */
  profile: readonly ProfilePoint[] | null
  /** route length; the profile's distances are scaled onto it */
  lengthM: number
  hose: HoseSize
  /** l/min wanted at the end */
  flow: number
  /** pressure at the source: Hydrant Ruhedruck, 0 for a Löschweier, a pump's output */
  startBar: number
  /** per-pump output overrides, by pump index */
  pumpBars?: readonly (number | null | undefined)[]
  /** per-pump positions (m from the source), by pump index — a pump moved by hand */
  pins?: readonly (number | null | undefined)[]
}

/**
 * Plan a relay along a route. Unpinned pumps go where the pressure reaches the minimum inlet. A
 * PINNED pump stands exactly at its pin, even if its inlet falls below the minimum there
 * (flagged `low`), and no automatic pump is slipped in before it; the pumps after it re-plan.
 * A pin beyond the route (the line was shortened after the pump was moved) counts as unpinned.
 */
export function planRelay({ profile, lengthM, hose, flow, startBar, pumpBars = [], pins = [] }: RelayRequest): RelayPlan {
  const { minInletBar: MIN, barPerMHeight, defaultPumpBar } = RELAY
  const terrain = !!profile && profile.length >= 2
  const prof: ProfilePoint[] = profile && terrain
    ? profile.map((p) => ({ dist: p.dist * (lengthM / (profile[profile.length - 1].dist || 1)), alt: p.alt }))
    : [{ dist: 0, alt: 0 }, { dist: lengthM, alt: 0 }]
  const { d, lines } = HOSES[hose]
  const loss = lossPer100m(d, flow / lines)
  const k = loss.bar / 100 // bar of friction per metre
  const pinAt = (i: number) => { const v = pins[i]; return v != null && v <= lengthM ? v : null }
  const pumps: RelayPump[] = []
  const line: { dist: number; bar: number }[] = []
  let p = startBar
  let stuck = false
  const placePump = (dist: number, alt: number) => {
    const i = pumps.length
    const out = pumpBars[i] ?? defaultPumpBar
    // only a MOVED pump can be «too low»: an automatic one stands where the minimum is reached,
    // and the one at a Löschweier (or a weak hydrant) draws from the source — that is its job,
    // moved back onto the source or not
    const pinned = pinAt(i) != null
    pumps.push({ dist, alt, inBar: p, outBar: out, pinned, low: pinned && dist > 0 && p < MIN - 1e-6 })
    line.push({ dist, bar: p }, { dist, bar: out })
    p = out
    if (out <= MIN) stuck = true
  }
  line.push({ dist: 0, bar: p })
  // Löschweier / weak hydrant: the first pump stands at the source — unless it was moved
  if (p < MIN && pinAt(0) == null) placePump(0, prof[0].alt)
  for (let i = 1; i < prof.length && !stuck; i++) {
    const a = prof[i - 1], b = prof[i]
    const dd = b.dist - a.dist
    if (dd <= 0) continue
    const slope = k + (terrain ? ((b.alt - a.alt) / dd) * barPerMHeight : 0) // bar lost per metre
    let x = a.dist
    while (!stuck) {
      // the next pump: at its pin if that falls in this segment, else where the pressure reaches
      // the minimum (if it does in this segment)
      const pin = pinAt(pumps.length)
      let xr: number | null = null
      if (pin != null) { if (pin <= b.dist) xr = Math.max(pin, x) }
      else if (slope > 0 && p - slope * (b.dist - x) < MIN) xr = x + (p - MIN) / slope
      if (xr == null) break
      p -= slope * (xr - x)
      placePump(xr, a.alt + ((xr - a.dist) / dd) * (b.alt - a.alt))
      x = xr
      if (pumps.length > 60) stuck = true
    }
    p -= slope * (b.dist - x)
    line.push({ dist: b.dist, bar: p })
  }
  return { terrain, prof, line, pumps, endBar: p, loss, stuck }
}

/**
 * Where pump `i` may be moved to: after the pump before it, before the next PINNED pump (both by
 * `RELAY.pinGapM`), and on the route. The automatic pumps after it simply re-plan.
 */
export function pumpRange(plan: RelayPlan, pins: readonly (number | null | undefined)[], i: number, lengthM: number): [number, number] {
  const gap = RELAY.pinGapM
  // (on the route even when the pump before stands within the gap of its end: a pin past the end
  // would count as unpinned, and the pump would jump back on release)
  const lo = i > 0 && plan.pumps[i - 1] ? Math.min(lengthM, plan.pumps[i - 1].dist + gap) : 0
  const nextPin = pins.slice(i + 1).find((x) => x != null)
  const hi = Math.min(lengthM - gap, nextPin != null ? nextPin - gap : Infinity)
  return [lo, Math.max(lo, hi)]
}

/** How many lines a Leitung's hose lays side by side (a «2× 75» is two) – the hose count's factor. */
export const hoseLines = (line: LineHoseFields): number => HOSES[lineHose(line)].lines

/** A Leitung's relay once its points are turned round (Richtung umkehren): the water keeps its
 *  physical source, so the calculation flips with the points – and the pumps, measured from that
 *  source, stay where they stand. */
export const flippedRelay = (relay: RelaySettings): RelaySettings => ({ ...relay, reverse: !relay.reverse || undefined })

/** The relay assumptions with every default filled in — what the surfaces show and compute with. */
export interface RelayInput {
  hose: HoseSize
  flow: number
  source: RelaySource
  /** the source's own number: Hydrant Ruhedruck or the source pump's output (unused at a Löschweier) */
  startBar: number
  pumps: readonly (RelayPumpOverride | null)[]
}

/** The default start pressure of each source: a Hydrant's typical Ruhedruck, a pump's output. */
export const defaultStartBar = (source: RelaySource): number =>
  source === 'pumpe' ? RELAY.defaultPumpBar : source === 'weier' ? 0 : RELAY.defaultHydrantBar

/** Fill in the defaults of a stored (or ephemeral) hose + relay pair. `defaultHose` is the
 *  host's: a Leitung's is the station's Linie default, Messen's the relay default (`hoseDefaults`). */
export function resolveRelay(hose: HoseSize | undefined, relay: RelaySettings | undefined, defaultHose: HoseSize): RelayInput {
  const source = relay?.source ?? RELAY.defaultSource
  return {
    hose: hose ?? defaultHose,
    flow: relay?.flow ?? RELAY.defaultFlow,
    source,
    startBar: relay?.startBar ?? defaultStartBar(source),
    pumps: relay?.pumps ?? [],
  }
}

/** The pressure the relay starts with: a Löschweier has none (its suction height is ignored). */
export const sourceBar = (input: RelayInput): number => (input.source === 'weier' ? 0 : input.startBar)

/** Plan a resolved relay along a route of `lengthM` — the one call the surfaces make. */
export function planFor(input: RelayInput, lengthM: number, profile: readonly ProfilePoint[] | null): RelayPlan {
  return planRelay({
    profile, lengthM, hose: input.hose, flow: input.flow, startBar: sourceBar(input),
    pumpBars: input.pumps.map((o) => o?.bar), pins: input.pumps.map((o) => o?.atM),
  })
}

/** Set one field of pump `i`'s override (undefined clears it), dropping empty overrides and the
 *  trailing nulls so an all-automatic relay stores no `pumps` at all. */
export function withPumpOverride(pumps: readonly (RelayPumpOverride | null)[], i: number, patch: RelayPumpOverride): (RelayPumpOverride | null)[] | undefined {
  const next: (RelayPumpOverride | null)[] = Array.from({ length: Math.max(pumps.length, i + 1) }, (_, j) => pumps[j] ?? null)
  const merged = { ...next[i], ...patch }
  const clean: RelayPumpOverride = {
    ...(merged.atM != null ? { atM: merged.atM } : null),
    ...(merged.bar != null ? { bar: merged.bar } : null),
  }
  next[i] = clean.atM != null || clean.bar != null ? clean : null
  while (next.length && next[next.length - 1] == null) next.pop()
  return next.length ? next : undefined
}

/** …and every pin from pump `from` on dropped at once («Alle Pumpen automatisch»), output
 *  overrides kept. */
export function withoutPins(pumps: readonly (RelayPumpOverride | null)[], from = 0): (RelayPumpOverride | null)[] | undefined {
  let out: (RelayPumpOverride | null)[] | undefined = [...pumps]
  for (let i = from; i < pumps.length; i++) out = withPumpOverride(out ?? [], i, { atM: undefined })
  return out?.length ? out : undefined
}
