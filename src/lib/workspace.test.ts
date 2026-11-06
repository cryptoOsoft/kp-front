import { describe, expect, it, vi } from 'vitest'
import { autoActivateLayers, CONTACT_BOUNDS, demoClockAnchor, DEMO_SEED_REV, demoSeedRebase, deriveInitial, isBoardAnno, latestTruppStamp, normalizeBoard, numberTrupps, rebaseDemoClocks, gateReport, sanitizeWorkspace, WORKSPACE_SCHEMA_VERSION, type Saved } from './workspace'
import type { LayerDef, Trupp } from '../types'

// Inject one station reference layer with a category rule so the auto-activation path is
// exercisable (the bundled demo layers carry no autoActivate).
vi.mock('./deploymentConfig', () => ({
  getDeploymentConfig: () => ({}),
  referenceLayersFromConfig: (): LayerDef[] => [{
    id: 'hydrant', group: 'Wasser', label: 'Hydranten', icon: 'drop', base: false, visible: false,
    opacity: 100, geojson: '/api/reference/geo:hydrant', vectorKind: 'point', autoActivate: ['Brandbekämpfung'],
  }],
}))

// deriveInitial turns a persisted (or absent) workspace blob into App's initial state. It's the
// load path every incident open runs through, so its normalisation — orphan-reference cleanup,
// legacy-shape migration, layer reconciliation, remembered-plan scoping — is exactly where a
// silent data-shape regression would corrupt a freshly opened incident. These lock it in.

// The heavy domain types (Entity/TimelineEvent/BoardAnno/LayerDef) carry many fields irrelevant
// here; build minimal shapes and cast, like the sibling merge tests do.
const ws = (partial: Partial<Saved>): Saved => partial as Saved

const T = (min: number) => new Date(Date.UTC(2026, 0, 1, 12, min, 0)).toISOString()

describe('rebaseDemoClocks — demo SCBA clocks slide to page-load', () => {
  it('shifts every Trupp timestamp so the newest contact lands at now, gaps preserved', () => {
    const blob = ws({ trupps: [
      { id: 'A', entryTime: T(0), lastContactTime: T(20), readings: [{ t: T(10) }, { t: T(20) }] },
      { id: 'B', entryTime: T(5), lastContactTime: T(25), readings: [{ t: T(25) }] }, // 25 = newest
    ] as unknown as Saved['trupps'] })
    const now = Date.UTC(2026, 6, 1, 9, 0, 0)
    const out = rebaseDemoClocks(blob, now)
    const t = out.trupps!
    expect(Date.parse(t[1].lastContactTime)).toBe(now)                  // newest → now
    expect(now - Date.parse(t[0].entryTime)).toBe(25 * 60_000)          // A entered 25 min before newest
    expect(now - Date.parse(t[0].readings![1].t)).toBe(5 * 60_000)      // readings shifted too
    expect(blob.trupps![1].lastContactTime).toBe(T(25))                 // pure: original untouched
  })
  it('leaves a workspace with no valid Trupp clocks unchanged (same ref)', () => {
    const blob = ws({ trupps: [{ id: 'X', entryTime: '', lastContactTime: '' }] as unknown as Saved['trupps'] })
    expect(rebaseDemoClocks(blob, 123)).toBe(blob)
  })
})

// A contact clock that jumps BACKWARDS is the one failure a monitoring surface must not have: it
// makes the time since the last Funkkontakt look shorter than it is. Re-deriving the demo offset
// on every page load did exactly that on refresh (0:35 → 0:08), so the anchor is now remembered.
describe('demoClockAnchor — the rebase is pinned once, not on every load', () => {
  const store = (): Storage => {
    const m = new Map<string, string>()
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => { m.set(k, v) },
      removeItem: (k: string) => { m.delete(k) },
      clear: () => m.clear(),
      key: () => null,
      get length() { return m.size },
    } as unknown as Storage
  }

  it('returns the first instant again for the same incident + seed (a refresh keeps its clocks)', () => {
    const s = store()
    const first = demoClockAnchor('inc1', 1000, 5_000, s)
    expect(first).toBe(5_000)
    expect(demoClockAnchor('inc1', 1000, 5_000 + 27_000, s)).toBe(5_000) // 27 s later: unchanged
  })

  it('re-anchors when the server has reset the demo (a new seed stamp)', () => {
    const s = store()
    demoClockAnchor('inc1', 1000, 5_000, s)
    expect(demoClockAnchor('inc1', 2000, 90_000, s)).toBe(90_000)
  })

  it('anchors each incident separately', () => {
    const s = store()
    demoClockAnchor('inc1', 1000, 5_000, s)
    expect(demoClockAnchor('inc2', 1000, 90_000, s)).toBe(90_000)
  })

  it('falls back to now when storage is unavailable — an un-anchored demo still works', () => {
    const broken = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } } as unknown as Storage
    expect(demoClockAnchor('inc1', 1000, 7_000, broken)).toBe(7_000)
  })

  it('reads the seed stamp from the newest of all Trupp clocks', () => {
    const blob = ws({ trupps: [
      { id: 'A', entryTime: T(0), lastContactTime: T(20), readings: [{ t: T(10) }] },
      { id: 'B', entryTime: T(5), lastContactTime: T(25), readings: [{ t: T(25) }] },
    ] as unknown as Saved['trupps'] })
    expect(latestTruppStamp(blob)).toBe(Date.parse(T(25)))
    expect(latestTruppStamp(ws({ trupps: [] }))).toBeNull()
  })
})

// The demo Einsatz is SHARED — edits persist and sync across visitors — so the arrival rebase may
// only ever touch the untouched server seed. A phone joining a demo somebody is already working
// re-pinned every contact clock to its own arrival (0:00 against the PC's 4:19) and then pushed
// those stamps back into the shared record. See workspace · demoSeedRebase.
describe('demoSeedRebase — only the untouched seed slides', () => {
  const blob = () => ws({ trupps: [
    { id: 'A', entryTime: T(0), lastContactTime: T(20), readings: [{ t: T(20) }] },
  ] as unknown as Saved['trupps'] })
  const now = Date.UTC(2026, 6, 1, 9, 0, 0)

  it('pins the newest contact to the visitor’s arrival on a freshly seeded demo', () => {
    const out = demoSeedRebase(blob(), 'inc1', DEMO_SEED_REV, now)
    expect(Date.parse(out.trupps![0].lastContactTime)).toBe(now)
  })

  it('leaves the clocks alone once anyone has saved (rev past the seed)', () => {
    const b = blob()
    const out = demoSeedRebase(b, 'inc1', DEMO_SEED_REV + 1, now)
    expect(out).toBe(b)
    expect(out.trupps![0].lastContactTime).toBe(T(20)) // the real, shared contact time
  })

  it('passes a workspace with no Trupp clocks straight through', () => {
    const b = ws({ trupps: [] })
    expect(demoSeedRebase(b, 'inc1', DEMO_SEED_REV, now)).toBe(b)
  })
})

describe('deriveInitial — fresh / empty incident', () => {
  it('a null workspace yields a blank slate (no demo seed leaks in)', () => {
    const s = deriveInitial(null, 'inc1', {})
    expect(s.doc.entities).toEqual([])
    expect(s.doc.drawings).toEqual([])
    expect(s.timeline).toEqual([])
    expect(s.board).toEqual({})
    expect(s.trupps).toEqual([])
    expect(s.attendance).toEqual({})
    // a brand-new incident opens on Modul 1 (the Übersicht)
    expect(s.activePlanId).toBe('modul1')
  })
})

/* ── Trupp N for records written before the number existed (12.09., docs/trupp-naming.md §6) ── */
/* types · Trupp.equipment: a list of ids, kept as recorded — and only that shape reaches the card
 * and the Rapport. Anything else is dropped and counted at the gate, like every other field. */
describe('sanitizeWorkspace — the Trupp’s Ausrüstung', () => {
  const t = (equipment: unknown) => ({
    id: 'T1', name: 'Meier', entryPressureBar: 300, entryTime: '', lastContactTime: '', status: 'angemeldet', equipment,
  })

  it('keeps a clean list untouched, each id once', () => {
    const g = sanitizeWorkspace(ws({ trupps: [t(['retthaube', 'wbk', 'retthaube']) as unknown as Trupp] }))
    expect(g.ws?.trupps?.[0].equipment).toEqual(['retthaube', 'wbk'])
    expect(g.dropped).toBe(1) // the duplicate
    const clean = sanitizeWorkspace(ws({ trupps: [t(['wbk']) as unknown as Trupp] }))
    expect(clean.ws?.trupps?.[0].equipment).toEqual(['wbk'])
    expect(clean.dropped).toBe(0)
  })

  it('drops what is not a list of ids, and leaves no empty list behind', () => {
    const g = sanitizeWorkspace(ws({ trupps: [t('wbk') as unknown as Trupp, { ...t([3, '', { id: 'x' }]), id: 'T2' } as unknown as Trupp] }))
    expect(g.ws?.trupps?.[0].equipment).toBeUndefined()
    expect(g.ws?.trupps?.[1].equipment).toBeUndefined()
    expect(g.dropped).toBe(2)
  })
})

describe('numberTrupps — the load normaliser', () => {
  const t = (id: string, over: Partial<Trupp> = {}): Trupp => ({
    id, name: id, entryPressureBar: 300, entryTime: '', lastContactTime: '', status: 'angemeldet', ...over,
  })

  it('numbers unnumbered Trupps in registration order, after every number already taken', () => {
    const out = numberTrupps([
      t('late', { readings: [{ t: '2026-09-01T10:30:00Z', bar: 300, kind: 'registered' }] }),
      t('kept', { no: 3 }),
      t('early', { readings: [{ t: '2026-09-01T10:00:00Z', bar: 300, kind: 'registered' }] }),
    ], ['Trupp 5'])
    expect(out.map((x) => [x.id, x.no])).toEqual([['late', 7], ['kept', 3], ['early', 6]])
  })

  it('falls back to list position for a record with no log, and is a no-op when nothing is missing', () => {
    expect(numberTrupps([t('a'), t('b')]).map((x) => x.no)).toEqual([1, 2])
    const done = [t('a', { no: 1 })]
    expect(numberTrupps(done)).toBe(done) // same array — nothing to persist
  })

  it('runs inside deriveInitial, counting the chips standing on the plans and the Karte', () => {
    const blob = ws({
      trupps: [t('x')],
      entities: [{ id: 'e1', kind: 'team', layer: 'ops', coord: [7.5, 47.5], label: 'Trupp 2', trail: [] }],
    })
    expect(deriveInitial(blob, 'inc1', {}).trupps[0].no).toBe(3)
  })
})

describe('deriveInitial — timeline orphan-reference cleanup', () => {
  it('strips a timeline event\'s entityId when that entity no longer exists, keeps live ones', () => {
    const blob = ws({
      entities: [{ id: 'e1' }] as Saved['entities'],
      timeline: [
        { id: 't1', entityId: 'e1' },
        { id: 't2', entityId: 'gone' },
        { id: 't3' },
      ] as unknown as Saved['timeline'],
    })
    const { timeline } = deriveInitial(blob, 'inc1', {})
    expect(timeline.find((e) => e.id === 't1')?.entityId).toBe('e1')   // entity still present → kept
    expect(timeline.find((e) => e.id === 't2')?.entityId).toBeUndefined() // orphan → stripped
    expect(timeline.find((e) => e.id === 't3')?.entityId).toBeUndefined() // never had one
  })
})

describe('deriveInitial — legacy board migration (via normalizeBoard)', () => {
  it('migrates the old "trupp" annotation kind to "resource" and assigns a colour', () => {
    const blob = ws({ board: { p1: [{ id: 'a1', kind: 'trupp' }] } as unknown as Saved['board'] })
    const { board } = deriveInitial(blob, 'inc1', {})
    const anno = board.p1[0] as { kind: string; color?: string }
    expect(anno.kind).toBe('resource')
    expect(anno.color).toBeTruthy() // a palette colour was assigned to the colourless legacy team
  })

  it('normalizeBoard leaves an undefined board as an empty map', () => {
    expect(normalizeBoard(undefined)).toEqual({})
  })
})

describe('deriveInitial — picked Einsatzobjekt is synced per incident', () => {
  it('reads the picked object from the workspace blob (the synced source of truth)', () => {
    const s = deriveInitial(ws({ pickedObjectId: 'obj-A' }), 'inc1', {})
    expect(s.pickedObjectId).toBe('obj-A')
  })

  it('defaults to undefined (auto-surface) when the blob has no pick', () => {
    expect(deriveInitial(null, 'inc1', {}).pickedObjectId).toBeUndefined()
  })

  it('the blob value wins over a legacy device-cookie pick', () => {
    const s = deriveInitial(ws({ pickedObjectId: 'obj-blob' }), 'inc1', {
      pickedObject: { incidentId: 'inc1', objectId: 'obj-cookie' },
    })
    expect(s.pickedObjectId).toBe('obj-blob')
  })

  it('one-time imports the legacy cookie pick for THIS incident when the blob has none', () => {
    const s = deriveInitial(null, 'inc1', { pickedObject: { incidentId: 'inc1', objectId: 'obj-cookie' } })
    expect(s.pickedObjectId).toBe('obj-cookie')
  })

  it('ignores a legacy cookie pick belonging to a DIFFERENT incident', () => {
    const s = deriveInitial(null, 'inc2', { pickedObject: { incidentId: 'inc1', objectId: 'obj-cookie' } })
    expect(s.pickedObjectId).toBeUndefined() // no cross-incident bleed — the bug this fix closes
  })
})

describe('deriveInitial — layer state reconciliation', () => {
  it('applies saved visibility/opacity onto the base layer set without dropping layers', () => {
    const blob = ws({ layerState: [{ id: 'taktisch', visible: false, opacity: 40 }] as Saved['layerState'] })
    const { layers } = deriveInitial(blob, 'inc1', {})
    const taktisch = layers.find((l) => l.id === 'taktisch')
    expect(taktisch?.visible).toBe(false)
    expect(taktisch?.opacity).toBe(40)
    // layers not mentioned in the saved state keep their built-in defaults (still present).
    expect(layers.find((l) => l.id === 'markup')).toBeTruthy()
  })

  it('falls back to the first base map when the saved base no longer exists (trimmed defs)', () => {
    // the workspace had a since-removed base (e.g. base-grey) selected and the current
    // default (base-carto) explicitly off — without the guard NO background would render
    const blob = ws({
      layerState: [
        { id: 'base-grey', visible: true, opacity: 100 },
        { id: 'base-carto', visible: false, opacity: 100 },
        { id: 'base-osm', visible: false, opacity: 100 },
        { id: 'base-air', visible: false, opacity: 100 },
      ] as Saved['layerState'],
    })
    const { layers } = deriveInitial(blob, 'inc1', {})
    expect(layers.filter((l) => l.base && l.visible)).toHaveLength(1)
    expect(layers.find((l) => l.base && l.visible)?.id).toBe('base-carto')
  })
})

describe('autoActivateLayers — category-driven layer pre-activation', () => {
  const mk = (over: Partial<LayerDef>): LayerDef =>
    ({ id: 'x', group: 'Referenz', label: 'X', icon: 'map', visible: false, ...over }) as LayerDef

  it('switches matching hidden layers on, leaves the rest untouched', () => {
    const out = autoActivateLayers(
      [mk({ id: 'hydrant', autoActivate: ['Brandbekämpfung'] }), mk({ id: 'other' })],
      'Brandbekämpfung',
    )
    expect(out.find((l) => l.id === 'hydrant')?.visible).toBe(true)
    expect(out.find((l) => l.id === 'other')?.visible).toBe(false)
  })

  it('is additive only — an already-visible layer never flips off for a non-matching category', () => {
    const layers = [mk({ id: 'hydrant', visible: true, autoActivate: ['Brandbekämpfung'] })]
    expect(autoActivateLayers(layers, 'Strassenrettung')).toBe(layers)
  })

  it('returns the SAME array when nothing matches (safe as a setState updater no-op)', () => {
    const layers = [mk({ id: 'hydrant', autoActivate: ['Brandbekämpfung'] })]
    expect(autoActivateLayers(layers, 'Ölwehr')).toBe(layers)
    expect(autoActivateLayers(layers, null)).toBe(layers)
    expect(autoActivateLayers(layers, undefined)).toBe(layers)
  })
})

describe('deriveInitial — category pre-activation is fresh-workspace-only', () => {
  it('a fresh incident of a matching category opens with the layer visible', () => {
    const { layers } = deriveInitial(null, 'inc1', {}, 'Brandbekämpfung')
    expect(layers.find((l) => l.id === 'hydrant')?.visible).toBe(true)
  })

  it('a fresh incident of another category leaves it hidden', () => {
    const { layers } = deriveInitial(null, 'inc1', {}, 'Dienstleistungen')
    expect(layers.find((l) => l.id === 'hydrant')?.visible).toBe(false)
  })

  it('persisted layer state wins — a deliberately hidden layer is never re-forced on reopen', () => {
    const blob = ws({ layerState: [{ id: 'hydrant', visible: false, opacity: 100 }] as Saved['layerState'] })
    const { layers } = deriveInitial(blob, 'inc1', {}, 'Brandbekämpfung')
    expect(layers.find((l) => l.id === 'hydrant')?.visible).toBe(false)
  })
})

describe('deriveInitial — remembered active plan is incident-scoped', () => {
  const blob = ws({ activePlanId: 'modul2' })

  it('honours the remembered plan when reopening the SAME incident', () => {
    const s = deriveInitial(blob, 'inc1', { incidentId: 'inc1', activePlanId: 'modul3' })
    expect(s.activePlanId).toBe('modul3') // the cookie's plan wins for this incident
  })

  it('ignores the remembered plan for a DIFFERENT incident (falls back to the blob/default)', () => {
    const s = deriveInitial(blob, 'inc2', { incidentId: 'inc1', activePlanId: 'modul3' })
    expect(s.activePlanId).toBe('modul2') // not modul3 — a new incident doesn't inherit the last one's plan
  })
})

// sanitizeWorkspace is the read-time crash guard in front of deriveInitial: a stale IDB or
// hand-edited/newer-app server blob must load best-effort — well-formed entries kept, the
// malformed rest dropped AND counted (honesty rule), the version flagged. These lock exactly
// that contract in.
describe('sanitizeWorkspace — load gate', () => {
  it('null / undefined pass through as an absent workspace (no noise)', () => {
    expect(sanitizeWorkspace(null)).toEqual({ ws: null, dropped: 0, newerSchema: false })
    expect(sanitizeWorkspace(undefined)).toEqual({ ws: null, dropped: 0, newerSchema: false })
  })

  it('a non-object blob is rejected entirely and counted', () => {
    const g = sanitizeWorkspace('corrupt')
    expect(g.ws).toBeNull()
    expect(g.dropped).toBe(1)
  })

  it('a well-formed blob passes through with dropped 0 and feeds deriveInitial unchanged', () => {
    const blob = ws({
      entities: [{ id: 'e1', kind: 'symbol', coord: [7.5, 47.5] }] as Saved['entities'],
      drawings: [{ id: 'd1', kind: 'line', coords: [[7.5, 47.5], [7.6, 47.6]] }] as Saved['drawings'],
      trupps: [{ id: 'tr1', name: 'Trupp 1' }] as Saved['trupps'],
      board: { modul1: [{ id: 'a1', kind: 'symbol', x: 0.5, y: 0.5 }] } as unknown as Saved['board'],
      settings: { contactIntervalMin: 10 },
      // the crew-wide «Einsatzdaten geprüft» stamp — dropping it here would put the review
      // banner back up on every device (lib/incidentAlerts)
      intakeReviewedAt: '2026-08-25T20:10:00Z',
      schemaVersion: 1,
    })
    const g = sanitizeWorkspace(blob)
    expect(g.dropped).toBe(0)
    expect(g.newerSchema).toBe(false)
    const s = deriveInitial(g.ws, 'inc1', {})
    expect(s.doc.entities).toHaveLength(1)
    expect(s.trupps).toHaveLength(1)
    expect(s.settings.contactIntervalMin).toBe(10)
    expect(s.intakeReviewedAt).toBe('2026-08-25T20:10:00Z')
  })

  it('drops collection entries without a string id and counts every loss', () => {
    const g = sanitizeWorkspace({
      entities: [{ id: 'e1', kind: 'symbol', coord: [7.5, 47.5] }, { id: 42 }, null, 'junk'],
      trupps: [{ id: 'tr1', name: 'Trupp 1' }, {}],
      mittel: [{ noId: true }],
    })
    expect(g.ws?.entities.map((e) => e.id)).toEqual(['e1'])
    expect(g.ws?.trupps).toHaveLength(1)
    expect(g.ws?.mittel).toHaveLength(0)
    expect(g.dropped).toBe(5) // 3 entities + 1 trupp + 1 mittel
  })

  it('resets wrong-typed fields (array-as-record, record-as-array) instead of crashing', () => {
    const g = sanitizeWorkspace({
      entities: { not: 'an array' },
      attendance: ['not', 'a', 'record'],
      building: 'garbage',
      activePlanId: 7,
    })
    expect(g.ws?.entities).toEqual([])
    expect(g.ws?.attendance).toBeUndefined()
    expect(g.ws?.building).toBeNull() // «no Gebäude» — deriveInitial reads null and undefined alike
    expect(g.ws?.activePlanId).toBeUndefined()
    expect(g.dropped).toBe(3) // entities + attendance + building (a wrong-typed plain string resets uncounted)
  })

  it('board docs keep only array values with object annos (normalizeBoard would crash otherwise)', () => {
    const anno = { id: 'a1', kind: 'text', x: 0.1, y: 0.2, text: 'EG' }
    const g = sanitizeWorkspace({ board: { modul1: [anno, 'junk'], broken: 'not-an-array' } })
    expect(g.ws?.board).toEqual({ modul1: [anno] })
    expect(g.dropped).toBe(2) // one non-object anno + one non-array doc
    expect(() => deriveInitial(g.ws, 'inc1', {})).not.toThrow()
  })

  it('an explicit null building survives (means "no Gebäude", not "absent field")', () => {
    const g = sanitizeWorkspace({ building: null })
    expect(g.ws?.building).toBeNull()
    expect(g.dropped).toBe(0)
  })

  it('flags a NEWER schemaVersion but still loads best-effort', () => {
    const g = sanitizeWorkspace({ entities: [{ id: 'e1', kind: 'symbol', coord: [7.5, 47.5] }], schemaVersion: WORKSPACE_SCHEMA_VERSION + 1 })
    expect(g.newerSchema).toBe(true)
    expect(g.ws?.entities).toHaveLength(1) // best-effort, not refused — 3am rule: degrade, don't block
  })

  // sweep 30.10.2026 #19 (the owner's phone: «neuere App-Version» AND «3 beschädigte Einträge»)
  it('reports what a newer build saved as ONE message: the entries it skipped are not «beschädigt»', () => {
    const unknown = [{ id: 'x1', kind: 'not-yet-invented', coord: [7.5, 47.5] }, { id: 'x2' }, 'x3']
    const newer = sanitizeWorkspace({ entities: unknown, schemaVersion: WORKSPACE_SCHEMA_VERSION + 1 })
    expect(newer.dropped).toBeGreaterThan(0) // the gate still counts them…
    expect(gateReport(newer)).toEqual({ newer: true, skipped: 0 }) // …the report does not call it damage
    const same = sanitizeWorkspace({ entities: unknown, schemaVersion: WORKSPACE_SCHEMA_VERSION })
    expect(gateReport(same)).toEqual({ newer: false, skipped: same.dropped })
  })

  it('current and older stamps do not flag', () => {
    expect(sanitizeWorkspace({ schemaVersion: WORKSPACE_SCHEMA_VERSION }).newerSchema).toBe(false)
    expect(sanitizeWorkspace({}).newerSchema).toBe(false) // pre-versioning blob
  })
})

// The per-object SHAPE gate. Each predicate gets the malformed object that used to reach a
// renderer and throw there (the boundary card for the whole incident, on every device, with
// «Neu laden» and «Lokale Kopie verwerfen» both re-pulling the same poison) — and one valid
// neighbour, to show that only the offending object goes.
describe('sanitizeWorkspace — per-object shape gate', () => {
  const LINE = { id: 'ok', kind: 'line', coords: [[7.5, 47.5], [7.6, 47.6]] }

  it('drawings: the 25.07. poison — a line whose coords is null — goes, its neighbour stays', () => {
    const g = sanitizeWorkspace({ drawings: [LINE, { id: 'bad', kind: 'line', coords: null }] })
    expect(g.ws?.drawings.map((d) => d.id)).toEqual(['ok'])
    expect(g.dropped).toBe(1)
  })

  it('drawings: too few vertices for the kind, a non-finite pair, an out-of-range pair, an unknown kind', () => {
    const g = sanitizeWorkspace({ drawings: [
      LINE,
      { id: 'l1', kind: 'line', coords: [[7.5, 47.5]] },
      { id: 'a2', kind: 'area', coords: [[7.5, 47.5], [7.6, 47.6]] },
      { id: 'nan', kind: 'line', coords: [[7.5, 47.5], [NaN, 47.6]] },
      { id: 'range', kind: 'line', coords: [[7.5, 47.5], [200, 47.6]] },
      { id: 'kind', kind: 'polygon', coords: [[7.5, 47.5], [7.6, 47.6], [7.7, 47.7]] },
    ] })
    expect(g.ws?.drawings.map((d) => d.id)).toEqual(['ok'])
    expect(g.dropped).toBe(5)
  })

  it('drawings: a Leitung with an unknown Ø loses the Ø, not the line (the relay plan would throw)', () => {
    const g = sanitizeWorkspace({ drawings: [{ ...LINE, hose: '2x75' }, { ...LINE, id: 'd40', hose: '40' }, { ...LINE, id: 'odd', hose: '90' }] })
    expect(g.ws?.drawings.map((d) => d.hose)).toEqual(['2x75', '40', undefined])
    expect(g.dropped).toBe(1)
  })

  it('drawings: a relay that is no object goes; pumps that are no list go, the rest of the relay stays', () => {
    const g = sanitizeWorkspace({ drawings: [{ ...LINE, relay: 'x' }, { ...LINE, id: 'p', relay: { flow: 600, pumps: {} } }] })
    expect(g.ws?.drawings.map((d) => d.relay)).toEqual([undefined, { flow: 600 }])
    expect(g.dropped).toBe(2)
  })

  it('drawings: a circle is its centre plus a finite radius', () => {
    const g = sanitizeWorkspace({ drawings: [
      { id: 'c', kind: 'circle', coords: [[7.5, 47.5]], radiusM: 50 },
      { id: 'noR', kind: 'circle', coords: [[7.5, 47.5]] },
      { id: 'nanR', kind: 'circle', coords: [[7.5, 47.5]], radiusM: NaN },
    ] })
    expect(g.ws?.drawings.map((d) => d.id)).toEqual(['c'])
    expect(g.dropped).toBe(2)
  })

  it('entities: [NaN, NaN] (which passed Array.isArray and threw inside the Marker) goes, the rest stays', () => {
    const g = sanitizeWorkspace({ entities: [
      { id: 'ok', kind: 'symbol', coord: [7.5, 47.5] },
      { id: 'nan', kind: 'symbol', coord: [NaN, NaN] },
      { id: 'one', kind: 'symbol', coord: [7.5] },
      { id: 'str', kind: 'symbol', coord: ['7.5', '47.5'] },
      { id: 'kind', kind: 'marker', coord: [7.5, 47.5] },
    ] })
    expect(g.ws?.entities.map((e) => e.id)).toEqual(['ok'])
    expect(g.dropped).toBe(4)
  })

  it('entities: the trail keeps only its valid points — a bad breadcrumb never costs the Trupp marker', () => {
    const g = sanitizeWorkspace({ entities: [
      { id: 't', kind: 'team', coord: [7.5, 47.5], trail: [{ coord: [7.5, 47.5], t: '10:00' }, { coord: null, t: '10:05' }, 'x'] },
    ] })
    expect(g.ws?.entities[0].trail).toEqual([{ coord: [7.5, 47.5], t: '10:00' }])
    expect(g.dropped).toBe(2)
  })

  it('building: {} becomes null (the Kroki would have crashed on floors.length), a real doc survives', () => {
    const bad = sanitizeWorkspace({ building: {} })
    expect(bad.ws?.building).toBeNull()
    expect(bad.dropped).toBe(1)
    const doc = { ring: [[0, 0], [1, 0], [1, 1]], ringAspect: 1, floors: [0, 1, 2] }
    const ok = sanitizeWorkspace({ building: doc })
    expect(ok.ws?.building).toEqual(doc)
    expect(ok.dropped).toBe(0)
    // no storeys, or a footprint of no shape at all, is not a building either
    expect(sanitizeWorkspace({ building: { ...doc, floors: [] } }).ws?.building).toBeNull()
    expect(sanitizeWorkspace({ building: { floors: [0], ringAspect: 1 } }).ws?.building).toBeNull()
    expect(sanitizeWorkspace({ building: { floors: [0, 'EG'], ring: [] } }).ws?.building).toBeNull()
  })

  it('board annos: ink needs finite vertices (a string pts has a .length and then no .map), points need x/y', () => {
    const draw = { id: 'ink', kind: 'draw', pts: [[0.1, 0.1], [0.2, 0.2, 1]] }
    const sym = { id: 'sym', kind: 'symbol', x: 0.5, y: 0.5 }
    const legacy = { id: 'old', kind: 'trupp', x: 0.3, y: 0.3 }
    const g = sanitizeWorkspace({ board: { modul1: [
      draw, sym, legacy,
      { id: 'str', kind: 'draw', pts: 'abc' },
      { id: 'short', kind: 'area', pts: [[0.1, 0.1], [0.2, 0.2]] },
      { id: 'nan', kind: 'draw', pts: [[0.1, 0.1], [NaN, 0.2]] },
      { id: 'noxy', kind: 'symbol' },
      { id: 'kind', kind: 'sticker', x: 0.5, y: 0.5 },
    ] } })
    // 'trupp' migrates in normalizeBoard; a kind this build has never heard of is a PASSENGER — kept
    // untouched, never drawn (review of #338: dropping it made the next save delete it for everybody)
    expect(g.ws?.board?.modul1.map((a) => a.id)).toEqual(['ink', 'sym', 'old', 'kind'])
    expect(g.dropped).toBe(4)
  })

  it('board annos: a resource trail keeps only its valid points', () => {
    const g = sanitizeWorkspace({ board: { modul1: [
      { id: 'r', kind: 'resource', x: 0.5, y: 0.5, trail: [{ x: 0.4, y: 0.4, t: '10:00' }, { x: 'a', y: 0.4, t: '10:05' }] },
    ] } })
    expect(g.ws?.board?.modul1[0].trail).toEqual([{ x: 0.4, y: 0.4, t: '10:00' }])
    expect(g.dropped).toBe(1)
  })

  it('trupps: a Trupp without a name is KEPT with name "" — it is a crew under air, not a corrupt row', () => {
    const g = sanitizeWorkspace({ trupps: [{ id: 'tr1', status: 'aktiv' }, { id: 'tr2', name: 42 }] })
    expect(g.ws?.trupps?.map((t) => t.name)).toEqual(['', ''])
    expect(g.dropped).toBe(1) // only the wrong-typed value counts as a reset; absent is quietly ''
  })

  it('trupps: readings keep only real rows; a non-array readings is removed', () => {
    const g = sanitizeWorkspace({ trupps: [
      { id: 'a', name: 'A', readings: [{ t: '10:00', bar: 280, kind: 'entry' }, { t: '10:05', bar: 'x', kind: 'pressure' }, null] },
      { id: 'b', name: 'B', readings: {} },
    ] })
    expect(g.ws?.trupps?.[0].readings).toEqual([{ t: '10:00', bar: 280, kind: 'entry' }])
    expect(g.ws?.trupps?.[1].readings).toBeUndefined()
    expect(g.dropped).toBe(3)
  })

  it('bands / mittel / timeline: the fields the panels .trim() are coerced to strings, never left undefined', () => {
    const g = sanitizeWorkspace({
      bands: [{ id: 'b', from: 'x', to: 'y' }],
      mittel: [{ id: 'm', menge: 2 }],
      timeline: [{ id: 't', icon: 'flag', text: 42 }],
    })
    expect(g.ws?.bands?.[0].label).toBe('')
    expect(g.ws?.mittel?.[0]).toMatchObject({ label: '', unit: '' })
    expect(g.ws?.timeline[0]).toMatchObject({ text: '', t: '' })
    expect(g.dropped).toBe(1) // the wrong-typed text counts as a reset; the absent fields are quietly ''
  })

  it('settings: a doctrine override that is not a usable number is REMOVED so the station doctrine applies', () => {
    const g = sanitizeWorkspace({ settings: { contactIntervalMin: 'zehn', contactGraceSec: 0, defaultFunkkanal: NaN } })
    expect(g.ws?.settings).toEqual({ contactGraceSec: 0 }) // a Nachfrist of zero is a real setting
    expect(g.dropped).toBe(2)
    expect(sanitizeWorkspace({ settings: { contactIntervalMin: 0 } }).ws?.settings).toEqual({}) // 0 min would alarm at once
    expect(sanitizeWorkspace({ settings: { contactIntervalMin: 15 } }).ws?.settings).toEqual({ contactIntervalMin: 15 })
  })

  it('the whole poisoned blob feeds deriveInitial without throwing', () => {
    const g = sanitizeWorkspace({
      drawings: [{ id: 'd', kind: 'line', coords: null }],
      entities: [{ id: 'e', kind: 'symbol', coord: [NaN, NaN] }],
      building: {},
      board: { modul1: [{ id: 'a', kind: 'draw', pts: 'abc' }] },
      trupps: [{ id: 'tr' }],
    })
    expect(() => deriveInitial(g.ws, 'inc1', {})).not.toThrow()
    expect(g.dropped).toBe(4)
  })
})

describe('sanitizeWorkspace — Rauch cloud → VKF Rauch symbol migration', () => {
  it('converts a placed cloud (map entity + plan anno) into the VKF Rauch symbol', () => {
    const g = sanitizeWorkspace({
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      entities: [{ id: 'sh1', kind: 'shape', shape: 'cloud', coord: [7.5, 47.5], color: '#6b7280', sizeM: 80, sizeN: 0.18, rotation: 30 }],
      board: { gebaeude: [{ id: 'sha', kind: 'shape', shape: 'cloud', x: 0.5, y: 0.5, floor: 1, color: '#6b7280', sizeN: 0.2, rotation: 10 }] },
    })
    // entities migrate at sanitize; the board migrates via normalizeBoard inside deriveInitial
    const s = deriveInitial(g.ws, 'inc1', {})
    const e = s.doc.entities[0] as unknown as Record<string, unknown>
    expect(e.kind).toBe('symbol')
    expect(e.symbol).toBe('VKF Rauch')
    expect(e.shape).toBeUndefined()
    expect(e.sizeM).toBeUndefined()
    expect(e.sizeN).toBeUndefined()
    expect(e.rotation).toBe(30) // rotation preserved
    const a = s.board.gebaeude[0] as unknown as Record<string, unknown>
    expect(a.kind).toBe('symbol')
    expect(a.symbol).toBe('VKF Rauch')
    expect(a.shape).toBeUndefined()
  })
  it('leaves other shapes (arrow/square) untouched', () => {
    const g = sanitizeWorkspace({ schemaVersion: WORKSPACE_SCHEMA_VERSION, entities: [{ id: 'sh2', kind: 'shape', shape: 'arrow', coord: [7.5, 47.5] }] })
    expect((g.ws!.entities[0] as unknown as Record<string, unknown>).kind).toBe('shape')
  })
})

// The ink minimums at the load gate — the same «a Linie keeps 2 points, a Fläche 3» the two
// vertex editors enforce, pinned at their exact boundaries before the rule moves to one module.
// A floor-tagged point [x, y, floor] is a valid vertex too.
describe('isBoardAnno — ink vertex minimums', () => {
  const pts = (n: number) => Array.from({ length: n }, (_, i) => [i / 10, i / 20])
  it('a draw needs 2 points: 1 is dropped, 2 is kept', () => {
    expect(isBoardAnno({ id: 'a', kind: 'draw', pts: pts(1) })).toBe(false)
    expect(isBoardAnno({ id: 'a', kind: 'draw', pts: pts(2) })).toBe(true)
  })
  it('an area needs 3 points: 2 is dropped, 3 is kept', () => {
    expect(isBoardAnno({ id: 'a', kind: 'area', pts: pts(2) })).toBe(false)
    expect(isBoardAnno({ id: 'a', kind: 'area', pts: pts(3) })).toBe(true)
  })
  it('a floor-tagged vertex passes, a malformed one sinks the anno', () => {
    expect(isBoardAnno({ id: 'a', kind: 'draw', pts: [[0, 0, 1], [1, 1, 1]] })).toBe(true)
    expect(isBoardAnno({ id: 'a', kind: 'draw', pts: [[0, 0], [1]] })).toBe(false)
    expect(isBoardAnno({ id: 'a', kind: 'draw', pts: [[0, 0], [1, Number.NaN]] })).toBe(false)
  })
  it('a non-ink anno needs only a finite anchor', () => {
    expect(isBoardAnno({ id: 'a', kind: 'symbol', x: 0.1, y: 0.2 })).toBe(true)
    expect(isBoardAnno({ id: 'a', kind: 'symbol', x: 0.1 })).toBe(false)
  })
})

/* Audit 25.10.2026 (F01–F04): what a Trupp's words, crew lists and ids may hold after the gate.
 * Each repair is counted, and whatever the server would now refuse on the crew's next edit is
 * normalised here — otherwise one old row would lock every later save out. */
describe('sanitizeWorkspace — Trupp safety repairs', () => {
  const t = (over: Record<string, unknown>) => ({
    id: 'T1', name: 'Meier', entryPressureBar: 300, entryTime: '2026-10-25T14:00:00Z', lastContactTime: '', status: 'aktiv', ...over,
  }) as unknown as Trupp

  it('removes an unknown kind (absent = Atemschutz) and keeps the known ones', () => {
    const g = sanitizeWorkspace(ws({ trupps: [t({ kind: 'atemschut' }), t({ id: 'T2', kind: 'einfach' })] }))
    expect(g.ws?.trupps?.map((x) => x.kind)).toEqual([undefined, 'einfach'])
    expect(g.dropped).toBe(1)
  })

  it('turns an unknown status into the phase its stamps say', () => {
    const g = sanitizeWorkspace(ws({ trupps: [
      t({ status: 'of fen' }), t({ id: 'T2', status: 'drin', exitTime: '2026-10-25T14:30:00Z' }), t({ id: 'T3', status: '', entryTime: '' }),
    ] }))
    expect(g.ws?.trupps?.map((x) => x.status)).toEqual(['aktiv', 'raus', 'angemeldet'])
    expect(g.dropped).toBe(3)
  })

  it('keeps the crew when a member entry is broken — only the entry goes (F03)', () => {
    const g = sanitizeWorkspace(ws({ trupps: [t({ members: [null, 'Müller Hans', 3], memberPersonIds: { p: 1 }, leaderPersonId: 7 })] }))
    const [kept] = g.ws?.trupps ?? []
    expect(kept.members).toEqual(['Müller Hans'])
    expect(kept.memberPersonIds).toEqual([])
    expect(kept.leaderPersonId).toBeUndefined()
    expect(kept.entryTime).toBe('2026-10-25T14:00:00Z')
    expect(g.dropped).toBe(3)
  })

  it('keeps both crews under one id apart, with an id every device derives alike (F04)', () => {
    const a = t({ name: 'A' }), b = t({ name: 'B' })
    const g = sanitizeWorkspace(ws({ trupps: [a, b, a] }))
    expect(g.ws?.trupps?.map((x) => [x.id, x.name])).toEqual([['T1', 'A'], ['T1~2', 'B']])
    expect(g.dropped).toBe(2) // the copy of A went, B was renamed
    expect(sanitizeWorkspace(ws({ trupps: [a, b, a] })).ws?.trupps).toEqual(g.ws?.trupps)
  })

  it('drops a contact override outside the station range, keeps one inside (F02)', () => {
    const { contactIntervalMin: iv, contactGraceSec: gr } = CONTACT_BOUNDS
    for (const bad of [{ contactIntervalMin: 0 }, { contactIntervalMin: 1e308 }, { contactIntervalMin: iv.max + 1 }, { contactGraceSec: gr.max + 1 }, { defaultFunkkanal: 1.5 }]) {
      const g = sanitizeWorkspace(ws({ settings: bad }))
      expect(g.ws?.settings).toEqual({})
      expect(g.dropped).toBe(1)
    }
    const ok = { contactIntervalMin: iv.max, contactGraceSec: gr.min, defaultFunkkanal: 11 }
    expect(sanitizeWorkspace(ws({ settings: ok })).ws?.settings).toEqual(ok)
  })
})
