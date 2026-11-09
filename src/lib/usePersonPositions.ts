import { useEffect, useMemo, useRef, useState } from 'react'
import type { Entity, LngLat } from '../types'
import { appConfig } from '../config/appConfig'
import { isDemoMode } from './deploymentConfig'
import { stepWalkers, syncWalkers, type Walker } from './demoCrewWalk'
import { formatTime, initials } from './format'
import { xmlEscape } from './svg'
import { useFeedPoll } from './useFeedPoll'

const cfg = appConfig.personGps

/** One self-reported position as the backend serves it. */
export interface PersonPositionDto {
  person_id: string
  display_name: string
  lat: number
  lng: number
  accuracy_m?: number | null
  ts: string
}

/** What the Anwesenheit list reads — position plus how old it is. */
export interface LivePerson {
  personId: string
  displayName: string
  coord: LngLat
  /** device fix time (ms epoch) */
  at: number
  accuracyM: number | null
}

/* (initials come from lib/format · `initials`, the same function the avatars use. This module
   had its own, which folded no umlauts and gave a one-word name a single letter — so «Meier»
   was «ME» on their avatar and «M» on their map dot, and «Bär» was «BÄ» and «B». One person,
   two labels, in the two places you compare them.) */

/**
 * The glyph for a person who is sharing their position.
 *
 * Deliberately NOT a tactical symbol: a VKF glyph on the Lage means "this unit is deployed
 * here" — a command decision somebody made. This means "a phone told us where its owner is",
 * which is a different kind of fact and must not be mistaken for the first at a glance. So:
 * a plain ringed dot with initials, no VKF vocabulary, in its own colour.
 *
 * `dimmed` renders the same glyph for a position that has stopped updating (see
 * PERSON_STALE_AFTER_MS) — recognisably the same person, visibly not current.
 */
export function personSymbolSvg(name: string, dimmed = false): string {
  const label = xmlEscape(initials(name))
  // SOLID fill, white initials. The first version drew thin amber strokes on a light-amber
  // wash, which measured about 1.9:1 against the marker's white chip — legible on a monitor
  // at rest, and gone on a phone held at arm's length over a pale basemap. A filled disc
  // carries its own contrast whatever the map does underneath, and the white ring keeps it
  // separated from dark tiles and from a symbol it happens to overlap.
  const fill = dimmed ? '#6b7280' : '#b45309'
  return (
    `<svg viewBox="-1.3 -1.3 2.6 2.6" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">` +
    `<circle cx="0" cy="0" r="1.02" fill="#fff" fill-opacity="0.92"/>` +
    `<circle cx="0" cy="0" r="0.92" fill="${fill}"/>` +
    `<text x="0" y="0" dy="0.34em" font-size="0.78" fill="#fff" text-anchor="middle" font-family="Arial,sans-serif" font-weight="bold">${label}</text>` +
    `</svg>`
  )
}

/**
 * When a position stops counting as current. Phones only report while the app is in the
 * foreground, so a locked phone goes quiet within seconds — which is normal, not a fault.
 * Five minutes is long enough that pocketing the phone between two radio calls doesn't grey
 * everyone out, short enough that "he's at the Weiher" isn't asserted off a half-hour-old fix.
 */
export const PERSON_STALE_AFTER_MS = 5 * 60_000

/** 403 = this session may not look (a link-scoped responder phone), 404 = the route isn't there
 *  (an older backend). Neither answer changes by asking again, so the poll stops for good. */
const POSITIONS_DEAD_STATUSES = [403, 404] as const

/** While the last answer held nobody, only every n-th cadence tick asks: 45 s at the 15 s
 *  cadence. A tick count, not a second timer, so the poll itself is never rebuilt. */
export const EMPTY_POLL_EVERY = 3

/** How old a fix reads as, in whole minutes ("vor 12 min"); 0 = just now. */
export const ageMinutes = (at: number, now: number): number => Math.max(0, Math.floor((now - at) / 60_000))

function toEntity(p: LivePerson, now: number): Entity {
  const stale = now - p.at > PERSON_STALE_AFTER_MS
  const mins = ageMinutes(p.at, now)
  const fields: Record<string, string> = {}
  const fixed = new Date(p.at)
  if (!Number.isNaN(fixed.getTime())) fields[cfg.copyFields.lastFix] = formatTime(fixed, true)
  if (p.accuracyM != null) fields[cfg.copyFields.accuracy] = `±${Math.round(p.accuracyM)} m`
  return {
    id: `pos-${p.personId}`,
    kind: 'person',
    layer: cfg.layerId,
    coord: p.coord,
    symbolSvg: personSymbolSvg(p.displayName, stale),
    label: p.displayName,
    // Always says where it came from. A dot on the Lage that looks placed but wasn't is the
    // one misreading worth spending a subtitle on.
    subtitle: stale ? `${cfg.selfReported} · vor ${mins} min` : cfg.selfReported,
    live: true,
    fields,
  }
}

export interface PersonPositionsApi {
  /** map entities for the `personen` layer */
  people: Entity[]
  /** keyed by roster person id — what the Anwesenheit rows read */
  byPerson: Map<string, LivePerson>
  error: string | null
}

/**
 * A signature of only what the map draws — id and coordinates per person. Two polls with the
 * same signature render identically, so the whole map/overlay tree can be left alone between
 * them. Ages are deliberately NOT in it: a crew standing still would otherwise re-render every
 * poll for a minute counter, which is the exact shape of the battery bug this app already paid
 * for once. Staleness is recomputed on the `now` tick instead, which advances once a minute.
 */
export function positionsSignature(people: LivePerson[]): string {
  return people.map((p) => `${p.personId}@${p.coord[0]},${p.coord[1]}`).join('|')
}

/**
 * Polls the backend for the crew positions of one incident.
 *
 * Command post only. A link-scoped session (a responder's phone) is refused this endpoint
 * server-side — it may report its own position and read nobody else's — so the poll is not
 * even started for one, rather than hammering a 403 every 15 s.
 *
 * Like the vehicle feed, the list is fully derived from the backend each poll and is
 * deliberately NOT part of the editable document: these entities cannot be moved, edited or
 * deleted, and they update on their own.
 */
/**
 * DEMO ONLY: who should be walking around the incident, and where it is. Passing this in turns
 * the poll into a browser-local simulation — see lib/demoCrewWalk for why the public demo may not
 * carry real positions. Ignored off the demo.
 */
export interface DemoCrewSim {
  center: LngLat
  crew: { id: string; displayName: string }[]
}

export function usePersonPositions(incidentId: string | null, enabled: boolean, demo?: DemoCrewSim): PersonPositionsApi {
  const [people, setPeople] = useState<LivePerson[]>([])
  const [error, setError] = useState<string | null>(null)
  // Minute-resolution clock for the age labels. Advanced from two callbacks — never from an
  // effect body (the cascading-render pattern this app has already paid a battery bug for):
  // the minute interval below, and every poll that brings data, so the clock is fresh exactly
  // when there is something new to date.
  const [now, setNow] = useState(() => Date.now())
  const lastSig = useRef<string>('')

  // On the demo the same layer is fed by a local simulation instead of the backend (which
  // refuses every position route there). `active` still gates BOTH, so «kein Einsatz offen» and
  // «darf nicht schauen» empty the picture exactly as before.
  const demoSim = isDemoMode() ? demo : undefined
  /** the poll and the simulation are mutually exclusive; both effects gate on this */
  const simulated = !!demoSim
  const active = enabled && !!incidentId && (!isDemoMode() || !!demoSim)
  const walkers = useRef<Walker[]>([])
  // the simulated crew, as a stable string, so the walk re-syncs when somebody starts or stops
  // sharing but NOT on every render that rebuilds the array
  const demoKey = demoSim ? demoSim.crew.map((p) => `${p.id}:${p.displayName}`).join('|') : ''
  const centerKey = demoSim ? `${demoSim.center[0]},${demoSim.center[1]}` : ''

  useEffect(() => {
    if (!active || !demoSim) { walkers.current = []; return }
    const { center } = demoSim
    walkers.current = syncWalkers(walkers.current, demoSim.crew, center)
    const publish = () => {
      setPeople(walkers.current.map((w) => ({
        personId: w.personId, displayName: w.displayName, coord: w.coord,
        at: Date.now(), accuracyM: 8,
      })))
      setNow(Date.now())
    }
    publish()
    const id = window.setInterval(() => {
      walkers.current = stepWalkers(walkers.current, center, cfg.pollMs)
      publish()
    }, cfg.pollMs)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- demoKey/centerKey stand in for demoSim
  }, [active, simulated, demoKey, centerKey])

  const polling = active && !simulated
  useEffect(() => {
    // Nothing to tear down and nothing to clear: what callers SEE is derived from `active`
    // below, so switching off empties the picture without writing state from an effect. The
    // signature is reset so a later reactivation re-publishes rather than dedupes itself away.
    if (!polling) lastSig.current = ''
  }, [polling])

  // Nobody sharing is the normal case, and asking every 15 s for it was a third of an idle
  // device's requests (perf sweep 09.11.2026). After an EMPTY answer only every
  // EMPTY_POLL_EVERY-th tick asks; the first answer with a position is back on every tick.
  // Per incident: a newly opened Einsatz starts on the fast cadence.
  const quiet = useRef({ empty: false, ticks: 0 })
  useEffect(() => { quiet.current = { empty: false, ticks: 0 } }, [incidentId, polling])

  useFeedPoll<PersonPositionDto[]>({
    path: `/api/incidents/${incidentId}/positions`,
    pollMs: cfg.pollMs,
    enabled: polling,
    deadStatuses: POSITIONS_DEAD_STATUSES,
    skipRound: () => {
      const q = quiet.current
      if (!q.empty) return false
      q.ticks = (q.ticks + 1) % EMPTY_POLL_EVERY
      return q.ticks !== 0
    },
    onData: (data) => {
      quiet.current.empty = data.length === 0
      const list: LivePerson[] = data.map((p) => ({
        personId: p.person_id,
        displayName: p.display_name,
        coord: [p.lng, p.lat] as LngLat,
        at: new Date(p.ts).getTime(),
        accuracyM: p.accuracy_m ?? null,
      }))
      const sig = positionsSignature(list)
      if (sig !== lastSig.current) {
        lastSig.current = sig
        setPeople(list)
        // A poll that changed nothing must NOT touch the clock: a parked crew reports the
        // same coordinates every 15 s, and re-dating them would re-render the whole map
        // overlay tree for a minute counter nobody is watching.
        setNow(Date.now())
      }
      setError(null)
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Standorte nicht erreichbar'),
  })

  // Re-render once a minute so the ages advance — only while somebody is sharing, so an empty
  // layer costs nothing at all.
  useEffect(() => {
    if (!people.length) return
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [people.length])

  return useMemo(() => {
    // Leaving the incident (or losing the right to look) empties the picture rather than
    // freezing it on screen — a dot nobody is refreshing is worse than no dot.
    const shown = active ? people : []
    return {
      people: shown.map((p) => toEntity(p, now)),
      byPerson: new Map(shown.map((p) => [p.personId, p])),
      error: active ? error : null,
    }
  }, [active, people, now, error])
}
