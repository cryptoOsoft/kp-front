import { describe, expect, it } from 'vitest'
import { MERGE_POLICY, mergeById, mergeRecord, mergeWorkspace, splitDuplicateTruppIds, type RecordConflict } from './mergeWorkspace'
import { conflictWhat } from './attendanceConflict'
import { truppRenumberings } from './truppNumbers'
import { nextTruppNo } from './placedTrupps'
import type { Saved } from './workspace'
import { serverRoundTrip } from './jsonb.test-utils'

const o = (id: string, extra: Record<string, unknown> = {}) => ({ id, ...extra })

describe('duplicate crew repair', () => {
  it('retains the original list when IDs are unique and collapses exact JSON copies', () => {
    const list = [o('a', { name: 'Alpha' }), o('b', { name: 'Bravo' })]
    expect(splitDuplicateTruppIds(list).list).toBe(list)
    expect(splitDuplicateTruppIds(list).repaired).toBe(0)
    expect(splitDuplicateTruppIds([list[0], { name: 'Alpha', id: 'a' }])).toEqual({ list: [list[0]], repaired: 1 })
  })

  it('keeps different crews under deterministic IDs without colliding with existing suffixes', () => {
    const list = [o('a', { name: 'Alpha' }), o('a', { name: 'Bravo' }), o('a~2'), o('a', { name: 'Charlie' }), o('a', { name: 'Bravo' })]
    const repaired = splitDuplicateTruppIds(list)
    expect(repaired).toEqual({ list: [list[0], o('a~3', { name: 'Bravo' }), list[2], o('a~4', { name: 'Charlie' })], repaired: 3 })
    expect(splitDuplicateTruppIds(repaired.list)).toEqual({ list: repaired.list, repaired: 0 })
    expect(list.map((crew) => crew.id)).toEqual(['a', 'a', 'a~2', 'a', 'a'])
  })
})

describe('mergeById — three-way object merge', () => {
  it('keeps independent additions from both sides, server order then mine', () => {
    const base = [o('a')]
    const theirs = [o('a'), o('b')] // they added b
    const mine = [o('a'), o('c')] // I added c
    expect(mergeById(base, mine, theirs).map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })

  it('same object edited on both sides → last writer (mine) wins', () => {
    const base = [o('a', { x: 0 })]
    const theirs = [o('a', { x: 1 })]
    const mine = [o('a', { x: 2 })]
    expect(mergeById(base, mine, theirs)).toEqual([o('a', { x: 2 })])
  })

  it('delete beats a concurrent edit (theirs edits, I delete → stays gone)', () => {
    const base = [o('a', { x: 0 })]
    const theirs = [o('a', { x: 9 })] // they moved it
    const mine: ReturnType<typeof o>[] = [] // I deleted it
    expect(mergeById(base, mine, theirs)).toEqual([])
  })

  it('delete beats a concurrent edit (I edit, they delete → stays gone)', () => {
    const base = [o('a', { x: 0 })]
    const theirs: ReturnType<typeof o>[] = [] // they deleted it
    const mine = [o('a', { x: 5 })] // I moved it
    expect(mergeById(base, mine, theirs)).toEqual([])
  })

  it('my new add is never mistaken for a delete (absent in base AND theirs)', () => {
    expect(mergeById([], [o('new')], [])).toEqual([o('new')])
  })

  it('an untouched object survives even if absent on my side but present in base+theirs only when I deleted it', () => {
    // present in base+theirs, absent in mine, theirs unchanged → I deleted it → drop
    expect(mergeById([o('a')], [], [o('a')])).toEqual([])
  })

  it('is idempotent: merging an already-merged superset against itself is stable', () => {
    const base = [o('a')]
    const merged = mergeById(base, [o('a'), o('c')], [o('a'), o('b')])
    // re-merge the result against itself (both sides equal, base = previous server)
    expect(mergeById(base, merged, merged)).toEqual(merged)
  })
})

describe('mergeRecord — three-way key/value merge', () => {
  it('unions new keys and LWW-mine on shared keys both changed', () => {
    expect(mergeRecord({ a: 1 }, { a: 2, c: 3 }, { a: 9, b: 8 })).toEqual({ a: 2, b: 8, c: 3 })
  })
  it('honors a removed shared key (delete wins)', () => {
    // key a in base+theirs, removed in mine → dropped
    expect(mergeRecord({ a: 1 }, {}, { a: 1 })).toEqual({})
  })
  it('takes THEIRS for a key the resolver left at the ancestor (no cross-domain clobber)', () => {
    // base a=1; mine untouched (a=1); theirs changed a=2 → take theirs, not mine's stale 1
    expect(mergeRecord({ a: 1 }, { a: 1 }, { a: 2 })).toEqual({ a: 2 })
  })
  it('keeps MINE for a key only the resolver changed', () => {
    expect(mergeRecord({ a: 1 }, { a: 5 }, { a: 1 })).toEqual({ a: 5 })
  })
})

/* Schema 2: the unified `objects` collection is the authoritative tactical store; the legacy
 * entities/drawings/board come out of the merge as DERIVED VIEWS of it. A legacy side (an
 * un-updated device's save, which drops `objects`) is unified before merging. */
describe('mergeWorkspace — unified objects (schema 2)', () => {
  const ent = (id: string, x = 0) => ({ id, kind: 'symbol', layer: 'taktisch', coord: [7.55, 47.51], x })
  const geoObj = (id: string, x = 0) => ({ id, entity: ent(id, x) })
  const sheetObj = (id: string, planId = 'modul2') => ({ id, sheet: { planId, anno: { id, kind: 'symbol', x: 0.5, y: 0.5 } } })

  it('merges objects per id and derives the views from the merged result', () => {
    const base = { objects: [geoObj('a')] }
    const theirs = { objects: [geoObj('a'), sheetObj('s1')] } // they drew on a sheet
    const mine = { objects: [geoObj('a', 2)] } // I moved the map object
    const out = mergeWorkspace(base, mine, theirs) as Record<string, unknown>
    const objects = out.objects as { id: string }[]
    expect(objects.map((x) => x.id).sort()).toEqual(['a', 's1'])
    expect((out.entities as { id: string; x: number }[])).toEqual([ent('a', 2)])
    expect((out.board as Record<string, { id: string }[]>).modul2.map((x) => x.id)).toEqual(['s1'])
  })

  it('unifies a legacy side before merging — its board anno arrives as one object', () => {
    const base = {}
    const theirs = { entities: [ent('a')], board: { modul2: [{ id: 's1', kind: 'symbol', x: 0.1, y: 0.1 }] } } // old client
    const mine = { objects: [geoObj('b')] }
    const out = mergeWorkspace(base, mine, theirs) as Record<string, unknown>
    expect((out.objects as { id: string }[]).map((x) => x.id).sort()).toEqual(['a', 'b', 's1'])
  })

  /* ⚠️ The hazard the unification exists to close: the old transfer was delete-in-one +
   * add-in-the-other with the SAME id, and the independently merged collections could
   * resurrect the object on both sides. As one record it cannot split any more — and a
   * legacy blob already carrying the duplicate heals into one sheet-anchored object. */
  it('a legacy transfer duplicate heals into ONE object, never two surfaces', () => {
    const theirs = { entities: [ent('x1')], board: { modul2: [{ id: 'x1', kind: 'symbol', x: 0.5, y: 0.5 }] } }
    const out = mergeWorkspace({}, { objects: [] }, theirs) as Record<string, unknown>
    expect((out.objects as { id: string }[]).map((x) => x.id)).toEqual(['x1'])
    // ONE record, drawn on both surfaces — the sheet from its anno, the Karte from its map
    // body. What the heal removes is the second RECORD, not the second picture.
    expect((out.entities as { id: string }[]).map((x) => x.id)).toEqual(['x1'])
    expect((out.board as Record<string, { id: string }[]>).modul2.map((x) => x.id)).toEqual(['x1'])
  })
})

describe('mergeWorkspace — a Messpunkt history both tablets appended to', () => {
  const mp = (fields: Record<string, string>, readings: { t: number; v: Record<string, string> }[]) =>
    ({ id: 'm1', entity: { id: 'm1', kind: 'symbol', layer: 'taktisch', coord: [7.55, 47.51], symbol: 'FW Messpunkt', fields, readings } })
  const r1 = { t: 1000, v: { CO: '20' } }
  const rMine = { t: 2000, v: { CO: '45' } }
  const rTheirs = { t: 2500, v: { CO: '44' } }
  const readingsOut = (out: Record<string, unknown>) => (out.objects as { entity: { readings: unknown[] } }[])[0].entity.readings

  it('keeps both radio reports in time order, not just the whole-object winner\'s', () => {
    const out = mergeWorkspace({ objects: [mp({ CO: '20' }, [r1])] }, { objects: [mp({ CO: '45' }, [r1, rMine])] }, { objects: [mp({ CO: '44' }, [r1, rTheirs])] }) as Record<string, unknown>
    expect(readingsOut(out)).toEqual([r1, rMine, rTheirs])
  })

  it('a row one side undid stays gone', () => {
    const out = mergeWorkspace({ objects: [mp({ CO: '45' }, [r1, rMine])] }, { objects: [mp({ CO: '20', Ex: '1' }, [r1])] }, { objects: [mp({ CO: '45', Raum: 'Gang' }, [r1, rMine])] }) as Record<string, unknown>
    expect(readingsOut(out)).toEqual([r1])
  })
})

describe('mergeWorkspace — whole blob', () => {
  it('merges collections by id and keeps the local view/config (activePlanId)', () => {
    const base = { entities: [o('e1')], drawings: [], activePlanId: 'p1' }
    const theirs = { entities: [o('e1'), o('e2')], drawings: [o('d1')], activePlanId: 'p1' } // they added e2 + a drawing
    const mine = { entities: [o('e1')], drawings: [o('d2')], activePlanId: 'p2' } // I added a drawing, switched plan
    const merged = mergeWorkspace(base, mine, theirs)
    expect((merged.entities as { id: string }[]).map((x) => x.id)).toEqual(['e1', 'e2'])
    expect((merged.drawings as { id: string }[]).map((x) => x.id)).toEqual(['d1', 'd2'])
    expect(merged.activePlanId).toBe('p2') // my active plan is not yanked by the merge
  })

  it('merges per-plan board annotations independently', () => {
    const base = { board: { p1: [o('a1')] } }
    const theirs = { board: { p1: [o('a1'), o('a2')] } }
    const mine = { board: { p1: [o('a1')], p2: [o('b1')] } }
    const merged = mergeWorkspace(base, mine, theirs) as { board: Record<string, { id: string }[]> }
    expect(merged.board.p1.map((x) => x.id)).toEqual(['a1', 'a2'])
    expect(merged.board.p2.map((x) => x.id)).toEqual(['b1'])
  })

  it('clear-board (delete-all) wins over an untouched plan on the other side', () => {
    const base = { board: { p1: [o('a1'), o('a2')] } }
    const theirs = { board: { p1: [o('a1'), o('a2')] } } // unchanged
    const mine = { board: { p1: [] } } // I cleared the board
    const merged = mergeWorkspace(base, mine, theirs) as { board: Record<string, { id: string }[]> }
    // since schema 2 the board is a VIEW of the merged objects: an emptied plan simply has
    // no key any more — «no annos on p1» either way, which is the semantic this test pins
    expect(merged.board.p1 ?? []).toEqual([])
  })
})

describe('mergeWorkspace — task-scoped cross-domain merges (no clobbering)', () => {
  // The headline guarantee: two operators on the SAME incident working DIFFERENT domains both keep
  // their work. The resolver ("mine") is the device flushing; "theirs" is the server holding the
  // other operator's concurrent edit. Each case = one operator edited domain X while the resolver
  // touched only domain Y and left X at the ancestor.

  it('Atemschutz (trupps) on one device + Anwesenheit (attendance) on another — both survive', () => {
    const base = { trupps: [o('t1')], attendance: {} }
    const theirs = { trupps: [o('t1')], attendance: { p1: { present: true } } } // they marked p1 present
    const mine = { trupps: [o('t1'), o('t2')], attendance: {} }                  // I added a Trupp
    const merged = mergeWorkspace(base, mine, theirs) as { trupps: { id: string }[]; attendance: Record<string, unknown> }
    expect(merged.trupps.map((x) => x.id)).toEqual(['t1', 't2']) // my Trupp add
    expect(merged.attendance).toEqual({ p1: { present: true } }) // their attendance NOT clobbered
  })

  it('one device plans the Zeitplan while another ticks Anwesenheit — both survive', () => {
    // the exact split the Schichtenplanung invites: the Einsatzleiter plans the night on one
    // tablet while the AdFU ticks arrivals on another
    const base = { shifts: [o('sh1')], attendance: {} }
    const theirs = { shifts: [o('sh1')], attendance: { p1: { status: 'present' } } }
    const mine = { shifts: [o('sh1'), o('sh2')], attendance: {} }
    const merged = mergeWorkspace(base, mine, theirs) as { shifts: { id: string }[]; attendance: Record<string, unknown> }
    expect(merged.shifts.map((x) => x.id)).toEqual(['sh1', 'sh2'])
    expect(merged.attendance).toEqual({ p1: { status: 'present' } })
  })

  it('a deleted shift stays deleted against a concurrent edit of it', () => {
    const base = { shifts: [o('sh1'), o('sh2')] }
    const theirs = { shifts: [{ id: 'sh1' }, { id: 'sh2', to: '2026-07-27T02:00:00Z' }] } // they moved sh2
    const mine = { shifts: [o('sh1')] } // I deleted sh2
    const merged = mergeWorkspace(base, mine, theirs) as { shifts: { id: string }[] }
    expect(merged.shifts.map((x) => x.id)).toEqual(['sh1'])
  })

  it('a settings change on one device is not reverted by an unrelated map edit on another', () => {
    const base = { entities: [o('e1')], settings: { contactIntervalMin: 10 } }
    const theirs = { entities: [o('e1')], settings: { contactIntervalMin: 20 } } // they changed doctrine
    const mine = { entities: [o('e1'), o('e2')], settings: { contactIntervalMin: 10 } } // I only drew on the map
    const merged = mergeWorkspace(base, mine, theirs) as { entities: { id: string }[]; settings: { contactIntervalMin: number } }
    expect(merged.entities.map((x) => x.id)).toEqual(['e1', 'e2'])
    expect(merged.settings.contactIntervalMin).toBe(20) // their settings change survives
  })

  it('toggling an existing person\'s presence survives a concurrent edit elsewhere', () => {
    const base = { attendance: { p1: { present: true } }, drawings: [] }
    const theirs = { attendance: { p1: { present: false } }, drawings: [] } // they signed p1 out
    const mine = { attendance: { p1: { present: true } }, drawings: [o('d1')] } // I drew a line
    const merged = mergeWorkspace(base, mine, theirs) as { attendance: Record<string, { present: boolean }> }
    expect(merged.attendance.p1.present).toBe(false) // their toggle isn't reverted by my stale copy
  })

  it('independent plan calibrations on two devices both survive', () => {
    const base = { planScale: {} }
    const theirs = { planScale: { modul1: 1.5 } } // they calibrated modul1
    const mine = { planScale: { modul2: 2.0 } }   // I calibrated modul2
    const merged = mergeWorkspace(base, mine, theirs) as { planScale: Record<string, number> }
    expect(merged.planScale).toEqual({ modul1: 1.5, modul2: 2.0 })
  })

  it('a building edit on one device survives a map edit on another (whole-doc three-way)', () => {
    const base = { building: { floors: [{ id: 'f0' }] }, entities: [] }
    const theirs = { building: { floors: [{ id: 'f0' }, { id: 'f1' }] }, entities: [] } // they added a floor
    const mine = { building: { floors: [{ id: 'f0' }] }, entities: [o('e1')] }           // I drew on the map
    const merged = mergeWorkspace(base, mine, theirs) as { building: { floors: { id: string }[] } }
    expect(merged.building.floors.map((f) => f.id)).toEqual(['f0', 'f1']) // their building edit survives
  })

  it('merges target movement concurrently with attachment/style editing on a different line object', () => {
    const attachment = { target: { kind: 'object', id: 'pump' }, routing: 'direct' }
    const base = { entities: [o('pump', { coord: [7, 47] })], drawings: [o('hose', { coords: [[7, 47], [7.1, 47.1]], color: 'blue', startAttachment: attachment })] }
    const theirs = { ...base, entities: [o('pump', { coord: [7.01, 47.01] })] }
    const mine = { ...base, drawings: [o('hose', { coords: [[7, 47], [7.1, 47.1]], color: 'red', startAttachment: attachment })] }
    const merged = mergeWorkspace(base, mine, theirs) as { entities: { coord: number[] }[]; drawings: { color: string; startAttachment: unknown }[] }
    expect(merged.entities[0].coord).toEqual([7.01, 47.01])
    expect(merged.drawings[0]).toMatchObject({ color: 'red', startAttachment: attachment })
  })

  it('the shared picked Einsatzobjekt propagates when the resolver did not change it', () => {
    const base = { pickedObjectId: undefined }
    const theirs = { pickedObjectId: 'obj-7' } // they picked an object
    const mine = { pickedObjectId: undefined, entities: [o('e1')] } // I only drew
    expect(mergeWorkspace(base, mine, theirs).pickedObjectId).toBe('obj-7')
  })

  // ⚠️ The device that is still SHOWING the review banner saves without the stamp — if this fell
  // through to «mine» it would unset what the tablet at the desk just confirmed, and the banner
  // would come back on every device.
  it('the «Einsatzdaten geprüft» stamp survives a save from a device that has not reviewed', () => {
    const base = {}
    const theirs = { intakeReviewedAt: '2026-08-25T20:10:00Z' } // they tapped «Passt»
    const mine = { entities: [o('e1')] } // I only drew
    expect(mergeWorkspace(base, mine, theirs).intakeReviewedAt).toBe('2026-08-25T20:10:00Z')
  })

  it('same singleton edited on both sides stays last-writer-wins (mine)', () => {
    const base = { settings: { contactIntervalMin: 10 } }
    const theirs = { settings: { contactIntervalMin: 20 } }
    const mine = { settings: { contactIntervalMin: 30 } }
    const merged = mergeWorkspace(base, mine, theirs) as { settings: { contactIntervalMin: number } }
    expect(merged.settings.contactIntervalMin).toBe(30)
  })

  // Schichtbänder: the columns of the Schichten grid. They ride the blob as a plain id-keyed
  // collection, which is the entire reason creating one must write no shifts — see below.
  it('two devices each defining a shift band keep both', () => {
    const base = { bands: [] as { id: string }[] }
    const theirs = { bands: [o('bd1', { label: 'Früh', from: '2026-07-28T05:00:00Z', to: '2026-07-28T10:00:00Z' })] }
    const mine = { bands: [o('bd2', { label: 'Spät', from: '2026-07-28T10:00:00Z', to: '2026-07-28T15:00:00Z' })] }
    const merged = mergeWorkspace(base, mine, theirs) as { bands: { id: string; label: string }[] }
    expect(merged.bands.map((b) => b.label)).toEqual(['Früh', 'Spät'])
  })

  it('deleting a band beats a concurrent rename, and its shifts are untouched by the merge', () => {
    // «Band löschen lässt seine Schichten stehen» is enforced by useBandActions (it strips
    // bandId); the merge only has to not resurrect the band and not lose the shifts.
    const sh = o('sh1', { personId: 'p1', from: 'a', to: 'b' })
    const base = { bands: [o('bd1', { label: 'Früh' })], shifts: [o('sh1', { personId: 'p1', from: 'a', to: 'b', bandId: 'bd1' })] }
    const theirs = { bands: [o('bd1', { label: 'Frühschicht' })], shifts: base.shifts }
    const mine = { bands: [] as { id: string }[], shifts: [sh] } // I deleted the band; the shift stayed, freihändig
    const merged = mergeWorkspace(base, mine, theirs) as { bands: unknown[]; shifts: Record<string, unknown>[] }
    expect(merged.bands).toEqual([])
    expect(merged.shifts).toEqual([sh])
    expect(merged.shifts[0].bandId).toBeUndefined()
  })

  it('still keeps local view state (activePlanId) on the resolver side', () => {
    const merged = mergeWorkspace({ activePlanId: 'p1' }, { activePlanId: 'p2' }, { activePlanId: 'p3' })
    expect(merged.activePlanId).toBe('p2') // my view is never yanked by a merge
  })
})

describe('mergeWorkspace – checklist ticks merge per tick (05.11.2026)', () => {
  const tick = (t: string, extra: Record<string, unknown> = {}) => ({ t, by: 'EL', ...extra })
  const ticksOf = (m: Record<string, unknown>) => ((m.checklists as Record<string, { ticks: Record<string, unknown> }>).pe.ticks)

  it('two devices ticking different items of one list both keep their tick', () => {
    const base = { checklists: { pe: { ticks: { a: tick('1') } } } }
    const mine = { checklists: { pe: { ticks: { a: tick('1'), b: tick('2') } } } }
    const theirs = { checklists: { pe: { ticks: { a: tick('1'), c: tick('3') } } } }
    expect(Object.keys(ticksOf(mergeWorkspace(base, mine, theirs))).sort()).toEqual(['a', 'b', 'c'])
  })

  it('the first ticks in a list on two devices (no ancestor for the list) both stand', () => {
    const mine = { checklists: { pe: { ticks: { b: tick('2') } } } }
    const theirs = { checklists: { pe: { ticks: { c: tick('3') } } } }
    expect(Object.keys(ticksOf(mergeWorkspace({}, mine, theirs))).sort()).toEqual(['b', 'c'])
  })

  it('an un-tick on one device and a trend on another item both stand; an un-tick beats a trend on the same item', () => {
    const base = { checklists: { pe: { ticks: { a: tick('1'), b: tick('2') } } } }
    const mine = { checklists: { pe: { ticks: { b: tick('2', { trend: 'up' }) } } } } // un-ticked a, trend on b
    const theirs = { checklists: { pe: { ticks: { a: tick('1', { trend: 'down' }), b: tick('2') } } } } // trend on a
    expect(ticksOf(mergeWorkspace(base, mine, theirs))).toEqual({ b: tick('2', { trend: 'up' }) })
  })

  it('a branch picked on one device and a tick on another both stand', () => {
    const base = { checklists: { fu: { ticks: {}, activeBranch: {} } } }
    const mine = { checklists: { fu: { ticks: { a: tick('1') }, activeBranch: {} } } }
    const theirs = { checklists: { fu: { ticks: {}, activeBranch: { p1: 'mit' } } } }
    expect(mergeWorkspace(base, mine, theirs).checklists).toEqual({ fu: { ticks: { a: tick('1') }, activeBranch: { p1: 'mit' } } })
  })
})

describe('mergeById — documented LWW data-loss (whole-object replacement, non-Trupp collections)', () => {
  // For every collection EXCEPT trupps, attendance and shifts the merge is per-OBJECT LWW with
  // WHOLE-OBJECT replacement — it does NOT merge field-by-field within a single object. So when
  // two devices concurrently edit DIFFERENT fields of the SAME object, the later writer
  // ("mine") replaces the object wholesale and the other device's field change is silently
  // lost. These lock that documented limitation in (see memory: KP Front sync limitations /
  // per-object LWW). Trupps are the deliberate exception — see the field-level suite below.
  it('loses one side when two devices edit different fields of the same object', () => {
    const base = [o('a', { label: 'Tank', floor: 0 })]
    const theirs = [o('a', { label: 'Tank', floor: 3 })] // they only changed floor
    const mine = [o('a', { label: 'TLF', floor: 0 })]    // I only changed the label
    const [merged] = mergeById(base, mine, theirs)
    // mine wins wholesale: my label survives but THEIR floor edit is gone (not 3).
    // The whole object is replaced, so floor is my 0, NOT their concurrent 3.
    expect(merged).toEqual(o('a', { label: 'TLF', floor: 0 }))
  })

  it('whole-blob: a concurrent field edit on the same entity is dropped at the workspace level too', () => {
    const base = { entities: [o('e1', { label: 'A', rotation: 0 })] }
    const theirs = { entities: [o('e1', { label: 'A', rotation: 90 })] } // they rotated it
    const mine = { entities: [o('e1', { label: 'B', rotation: 0 })] }    // I renamed it
    const merged = mergeWorkspace(base, mine, theirs) as { entities: { label: string; rotation: number }[] }
    expect(merged.entities).toHaveLength(1)
    expect(merged.entities[0].label).toBe('B')      // my rename survives
    expect(merged.entities[0].rotation).toBe(0)     // their concurrent rotation is lost (not 90)
  })
})

// Trupps are SCBA crew monitoring — losing a pressure reading from the board to a concurrent
// radio contact is safety-relevant, so they are the one collection merged FIELD-level
// (mergeTrupp) instead of whole-object LWW. The everyday case under test: the Truppüberwacher
// books a Druckmeldung on the tablet while the EL's phone books the Funkkontakt.
describe('mergeWorkspace — trupps: field-level three-way merge', () => {
  const E = '2026-09-01T20:00:00.000Z'  // entry
  const T2 = '2026-09-01T20:10:00.000Z' // my Druckmeldung
  const T3 = '2026-09-01T20:12:00.000Z' // their (later) Funkkontakt
  const baseTrupp = {
    id: 't1', name: 'Meier', status: 'aktiv', entryPressureBar: 300, entryTime: E,
    lastContactTime: E, lowestBar: 300,
    readings: [{ t: E, bar: 300, kind: 'entry' }],
  }
  const ws = (trupp: Record<string, unknown>) => ({ trupps: [trupp] })
  const mergedTrupp = (mine: Record<string, unknown>, theirs: Record<string, unknown>) =>
    (mergeWorkspace(ws(baseTrupp), ws(mine), ws(theirs)) as { trupps: Record<string, unknown>[] }).trupps[0]
  // …and with an explicit ancestor, for the cases whose base is not the shared fixture
  const mergedTrupp2 = (base: Record<string, unknown>, mine: Record<string, unknown>, theirs: Record<string, unknown>) =>
    (mergeWorkspace(ws(base), ws(mine), ws(theirs)) as { trupps: Record<string, unknown>[] }).trupps[0]

  it('keeps pressure paired with its later timestamp and the lowest confirmed pressure from either device', () => {
    const mine = { ...baseTrupp, lastPressureTime: T2, lastPressureBar: 180, lowestBar: 180 }
    const theirs = { ...baseTrupp, lastPressureTime: T3, lastPressureBar: 220, lowestBar: 220 }
    for (const [m, t] of [[mine, theirs], [theirs, mine]]) {
      expect(mergedTrupp(m, t)).toMatchObject({ lastPressureTime: T3, lastPressureBar: 220, lowestBar: 180 })
    }
  })

  it('keeps a one-sided correction of a shared pressure reading while merging unrelated crew edits', () => {
    const reading = { t: T2, bar: 200, kind: 'pressure' }
    const ancestor = { ...baseTrupp, readings: [...baseTrupp.readings, reading] }
    const mine = { ...ancestor, name: 'Changed' }
    const theirs = { ...ancestor, funkkanal: 3, readings: [...baseTrupp.readings, { ...reading, bar: 180 }] }
    for (const [m, t] of [[mine, theirs], [theirs, mine]]) {
      expect(mergedTrupp2(ancestor, m, t).readings).toEqual([...baseTrupp.readings, { ...reading, bar: 180 }])
    }
  })

  it('a Druckmeldung and a Funkkontakt from two devices both survive, readings union intact', () => {
    const mine = { ...baseTrupp, lastPressureBar: 150, lastPressureTime: T2, lastContactTime: T2, lowestBar: 150,
      readings: [...baseTrupp.readings, { t: T2, bar: 150, kind: 'pressure' }] }
    const theirs = { ...baseTrupp, lastContactTime: T3,
      readings: [...baseTrupp.readings, { t: T3, bar: 300, kind: 'contact' }] }
    const t = mergedTrupp(mine, theirs)
    expect(t.lastPressureBar).toBe(150)  // my pressure reading survives …
    expect(t.lastPressureTime).toBe(T2)
    expect(t.lowestBar).toBe(150)
    expect(t.lastContactTime).toBe(T3)   // … and so does their (later) radio contact
    // readings union, chronological: entry, my pressure, their contact — nothing dropped
    expect((t.readings as { t: string; kind: string }[]).map((r) => r.kind)).toEqual(['entry', 'pressure', 'contact'])
  })

  /* ── the kind discriminator (types · TruppKind, 03.09.) ────────────────────────────────────
   * `kind` decides whether a Trupp is watched at all — its contact clock, its Alarmdruck, its
   * place on the Atemschutz page of the Rapport and the server-side überfällig push all hang off
   * it. It is written once and never edited (see Trupp.kind), so the ONLY thing this merge has to
   * promise is that a concurrent edit somewhere else on the object cannot drop it or invent one. */
  it('carries `kind` through a two-device edit, and never invents one for a Trupp that has none', () => {
    const plainBase = { ...baseTrupp, kind: 'einfach', entryPressureBar: 0, lowestBar: 0, readings: [] }
    // the AdFU renames the Trupp on the tablet while the EL sets its Funkkanal on the phone
    const t = mergedTrupp2(plainBase, { ...plainBase, name: 'Verkehr' }, { ...plainBase, funkkanal: 3 })
    expect(t.kind).toBe('einfach')
    expect(t.name).toBe('Verkehr')
    expect(t.funkkanal).toBe(3)
    // …and a Trupp recorded before the field existed keeps no field at all: ABSENT means
    // «unter Atemschutz» (lib/atemschutz · isAtemschutzTrupp), so a stray default would be a
    // change of meaning smuggled in by a sync
    const pa = mergedTrupp({ ...baseTrupp, name: 'Meier T.' }, { ...baseTrupp, funkkanal: 11 })
    expect('kind' in pa).toBe(false)
  })

  /* ── the Atemschutznotfall (F1, 08.10.2026) ───────────────────────────────────────────────── */
  it('a Notfall raised on one device and a Kontakt on another both survive', () => {
    const N = '2026-09-01T20:11:00.000Z'
    const mine = { ...baseTrupp, notfallAt: N, readings: [...baseTrupp.readings, { t: N, bar: 300, kind: 'notfall' }] }
    const theirs = { ...baseTrupp, lastContactTime: T3, readings: [...baseTrupp.readings, { t: T3, bar: 300, kind: 'contact' }] }
    const t = mergedTrupp(mine, theirs)
    expect(t.notfallAt).toBe(N)
    expect(t.lastContactTime).toBe(T3)
    expect((t.readings as { kind: string }[]).map((r) => r.kind)).toEqual(['entry', 'notfall', 'contact'])
  })

  it('two devices holding «Notfall» at once raise ONE Notfall, from the EARLIER hold', () => {
    const early = '2026-09-01T20:11:00.000Z'
    const late = '2026-09-01T20:11:04.000Z'
    expect(mergedTrupp({ ...baseTrupp, notfallAt: late }, { ...baseTrupp, notfallAt: early }).notfallAt).toBe(early)
    expect(mergedTrupp({ ...baseTrupp, notfallAt: early }, { ...baseTrupp, notfallAt: late }).notfallAt).toBe(early)
    // …and ONE `notfall` row in the Trupp's log — the losing hold's goes with it
    const held = (at: string) => ({ ...baseTrupp, notfallAt: at, readings: [...baseTrupp.readings, { t: at, bar: 300, kind: 'notfall' }] })
    for (const [mine, theirs] of [[held(late), held(early)], [held(early), held(late)]]) {
      const rows = mergedTrupp(mine, theirs).readings as { t: string; kind: string }[]
      expect(rows.filter((r) => r.kind === 'notfall')).toEqual([{ t: early, bar: 300, kind: 'notfall' }])
    }
  })

  it('«Notfall beendet» on one device is not undone by an unrelated edit on another', () => {
    const N = '2026-09-01T20:11:00.000Z'
    const running = { ...baseTrupp, notfallAt: N }
    const { notfallAt: _n, ...ended } = running
    const t = mergedTrupp2(running, ended, { ...running, funkkanal: 7 })
    expect('notfallAt' in t).toBe(false)
    expect(t.funkkanal).toBe(7)
  })

  it('dedupes a reading row present on both sides (it appears once)', () => {
    const shared = { t: T2, bar: 150, kind: 'pressure' } // reached both devices via an earlier sync
    const mine = { ...baseTrupp, readings: [...baseTrupp.readings, shared] }
    const theirs = { ...baseTrupp, lastContactTime: T3,
      readings: [...baseTrupp.readings, shared, { t: T3, bar: 150, kind: 'contact' }] }
    const t = mergedTrupp(mine, theirs)
    expect((t.readings as { kind: string }[]).map((r) => r.kind)).toEqual(['entry', 'pressure', 'contact'])
  })

  it('the contact clock never moves backwards: the later lastContactTime wins in both directions', () => {
    const at = (iso: string) => ({ ...baseTrupp, lastContactTime: iso,
      readings: [...baseTrupp.readings, { t: iso, bar: 300, kind: 'contact' }] })
    expect(mergedTrupp(at(T2), at(T3)).lastContactTime).toBe(T3) // theirs is later
    expect(mergedTrupp(at(T3), at(T2)).lastContactTime).toBe(T3) // mine is later — not "mine wins"
  })

  it('a one-sided field edit passes through while the other device edits a different field', () => {
    const mine = { ...baseTrupp, ziel: '2. OG links' }
    const theirs = { ...baseTrupp, funkkanal: 12 }
    const t = mergedTrupp(mine, theirs)
    expect(t.ziel).toBe('2. OG links')
    expect(t.funkkanal).toBe(12)
  })

  it('reports the concurrent Trupp edit via onTruppConflict — and only a genuine one', () => {
    const conflicts: { key: string }[] = []
    const mine = { ...baseTrupp, ziel: '2. OG links' }
    const theirs = { ...baseTrupp, funkkanal: 12 }
    mergeWorkspace(ws(baseTrupp), ws(mine), ws(theirs), undefined, (c) => conflicts.push(c))
    expect(conflicts.map((c) => c.key)).toEqual(['t1'])
    // one side untouched → no report (and no false alarm on every ordinary sync)
    conflicts.length = 0
    mergeWorkspace(ws(baseTrupp), ws(baseTrupp), ws(theirs), undefined, (c) => conflicts.push(c))
    expect(conflicts).toEqual([])
  })

  // The state machine merges as ONE unit when both sides moved the status (review 02.09.):
  // a per-field resolution paired «aktiv» with the other device's exitTime — and any exitTime
  // reads as raus (deriveTruppLive), so the contact clock went silent on a crew inside.
  it('«Eingerückt» racing «Draussen» stays in the field — never aktiv-with-exitTime', () => {
    const E2 = '2026-09-01T20:15:00.000Z'
    const X = '2026-09-01T20:14:00.000Z'
    const paused = { ...baseTrupp, status: 'pause' }
    const mine = { ...paused, status: 'aktiv', entryTime: E2, lastContactTime: E2 }
    const theirs = { ...paused, status: 'raus', exitTime: X }
    const t = mergedTrupp2(paused, mine, theirs)
    expect(t.status).toBe('aktiv')
    expect(t.entryTime).toBe(E2)
    expect(t.exitTime).toBeUndefined() // the chimera this test exists for
    // …and in the other direction the in-field side still wins (not "mine wins")
    const t2 = mergedTrupp2(paused, theirs, mine)
    expect(t2.status).toBe('aktiv')
    expect(t2.exitTime).toBeUndefined()
  })

  it('a status conflict between two out-of-field states keeps LWW-mine, stamps included', () => {
    const X = '2026-09-01T20:14:00.000Z'
    const mine = { ...baseTrupp, status: 'raus', exitTime: X }
    const theirs = { ...baseTrupp, status: 'angemeldet' }
    const t = mergedTrupp2(baseTrupp, mine, theirs)
    expect(t.status).toBe('raus')
    expect(t.exitTime).toBe(X)
  })
})

// Rapport-Beilagen merge like every other id-keyed collection. Worth its own case because the
// Rapport is typically assembled on ONE device while the Lage is still being worked on another:
// the two saves must not eat each other's photos.
describe('mergeWorkspace — Rapport-Beilagen', () => {
  it('keeps a Beilage each device added independently', () => {
    const base = { attachments: [] }
    const mine = { attachments: [{ id: 'a1', url: '/api/media/1' }] }
    const theirs = { attachments: [{ id: 'a2', url: '/api/media/2' }] }
    const out = mergeWorkspace(base, mine, theirs) as { attachments: { id: string }[] }
    expect(out.attachments.map((a) => a.id).sort()).toEqual(['a1', 'a2'])
  })

  it('lets a delete beat a concurrent caption edit', () => {
    const base = { attachments: [{ id: 'a1', url: '/api/media/1' }] }
    const mine = { attachments: [] } // I removed it
    const theirs = { attachments: [{ id: 'a1', url: '/api/media/1', caption: 'Ausweis' }] }
    const out = mergeWorkspace(base, mine, theirs) as { attachments: unknown[] }
    expect(out.attachments).toEqual([])
  })
})

// The Alarmierungs-/Ausrückzeiten grid has a writer the app does not control: the alarm
// pipeline pushes per-vehicle milestones straight into the SERVER's blob. Before 31.08. the
// two arrays were merged flat — one typed time on the tablet took the whole array with it and
// the webhook's rows vanished, while the Verlauf still carried the «PIO vor Ort» row the
// webhook writes only when it actually stores the value.
describe('mergeWorkspace — reportMeta Zeiten grid', () => {
  it('keeps a webhook-written vehicle row when the operator types a time for another one', () => {
    const base = { reportMeta: { fahrzeuge: [] } }
    const theirs = { reportMeta: { fahrzeuge: [{ id: 'pio', vorOrt: '2026-08-31T20:14:00Z' }] } }
    const mine = { reportMeta: { fahrzeuge: [{ id: 'tlf', ausgerueckt: '2026-08-31T20:05:00Z', manual: true }] } }
    const out = mergeWorkspace(base, mine, theirs) as { reportMeta: { fahrzeuge: { id: string }[] } }
    expect(out.reportMeta.fahrzeuge.map((f) => f.id).sort()).toEqual(['pio', 'tlf'])
  })

  it('lets the operator’s hand-typed time win on the SAME vehicle', () => {
    const base = { reportMeta: { fahrzeuge: [{ id: 'pio' }] } }
    const theirs = { reportMeta: { fahrzeuge: [{ id: 'pio', vorOrt: '2026-08-31T20:14:00Z' }] } }
    const mine = { reportMeta: { fahrzeuge: [{ id: 'pio', vorOrt: '2026-08-31T20:11:00Z', manual: true }] } }
    const out = mergeWorkspace(base, mine, theirs) as { reportMeta: { fahrzeuge: { vorOrt: string }[] } }
    expect(out.reportMeta.fahrzeuge[0].vorOrt).toBe('2026-08-31T20:11:00Z')
  })

  it('merges the Gruppen rows the same way', () => {
    const base = { reportMeta: { gruppen: [] } }
    const theirs = { reportMeta: { gruppen: [{ id: 'g1', alarmedAt: '2026-08-31T20:01:00Z' }] } }
    const mine = { reportMeta: { gruppen: [{ id: 'g2', alarmedAt: '2026-08-31T20:03:00Z', manual: true }] } }
    const out = mergeWorkspace(base, mine, theirs) as { reportMeta: { gruppen: { id: string }[] } }
    expect(out.reportMeta.gruppen.map((g) => g.id).sort()).toEqual(['g1', 'g2'])
  })

  it('clearing the last field of a row still removes it', () => {
    const base = { reportMeta: { fahrzeuge: [{ id: 'pio', vorOrt: '2026-08-31T20:14:00Z' }] } }
    const mine = { reportMeta: { fahrzeuge: [] } } // operator cleared the field
    const theirs = base
    const out = mergeWorkspace(base, mine, theirs) as { reportMeta: { fahrzeuge?: unknown[] } }
    expect(out.reportMeta.fahrzeuge ?? []).toEqual([])
  })
})

describe('mergeWorkspace — a server blob this app did not write', () => {
  it('entities: {} merges without throwing and yields an empty list', () => {
    const out = mergeWorkspace({}, { entities: [] }, { entities: {} }) as { entities: unknown[] }
    expect(out.entities).toEqual([])
  })

  it('a non-array collection, a string record, an object gruppen grid, an object readings log: none throws', () => {
    const base = { trupps: [o('tr', { name: 'A', readings: [] })] }
    const mine = { trupps: [o('tr', { name: 'A', readings: [{ t: '10:00', bar: 280, kind: 'entry' }] })], attendance: { p1: { present: true } } }
    const theirs = {
      trupps: [o('tr', { name: 'B', readings: {} })], // both changed the Trupp → mergeTrupp → mergeReadings
      drawings: 'x',
      attendance: '',
      board: { modul1: 'not-a-list' },
      reportMeta: { gruppen: {}, linksDone: 'no' },
    }
    const out = mergeWorkspace(base, mine, theirs) as Record<string, unknown>
    expect(out.drawings).toEqual([])
    expect(out.attendance).toEqual({ p1: { present: true } })
    expect(out.board).toEqual({}) // the corrupt plan list reads as empty → no key in the derived view
    expect(out.reportMeta).toEqual({})
    const tr = (out.trupps as { readings: unknown[] }[])[0]
    expect(tr.readings).toEqual([{ t: '10:00', bar: 280, kind: 'entry' }]) // my row survives, their `{}` reads as empty
  })

  it('a collection entry without an id is not a merge participant', () => {
    const out = mergeWorkspace({}, { entities: [o('a')] }, { entities: [null, 'junk', { noId: 1 }, o('b')] }) as { entities: { id: string }[] }
    expect(out.entities.map((e) => e.id)).toEqual(['b', 'a'])
  })
})

describe('mergeWorkspace — every field of the blob has a declared merge policy', () => {
  // Typed Record<keyof Saved, …> like MERGE_POLICY itself: a field added to `Saved` without a
  // policy fails tsc there AND here, and this list is what the runtime checks below walk.
  const FIELDS: Record<keyof Saved, true> = {
    entities: true, drawings: true, recent: true, objects: true, layerState: true, timeline: true,
    board: true, activePlanId: true, activeModule: true, pickedObjectId: true, planScale: true,
    building: true, vehicleOverrides: true, checklists: true, trupps: true, attendance: true,
    mittel: true, shifts: true, bands: true, cameraViews: true, trails: true, reportMeta: true,
    attachments: true, reportSignatures: true, planBindings: true, settings: true, intakeReviewedAt: true, weather: true,
    schemaVersion: true,
  }
  const keys = Object.keys(FIELDS) as (keyof Saved)[]
  const local = keys.filter((k) => MERGE_POLICY[k] === 'local')

  it('names exactly the fields of Saved — none missing, none stale', () => {
    expect(Object.keys(MERGE_POLICY).sort()).toEqual([...keys].sort())
  })

  it('keeps exactly the device/view state local', () => {
    expect(local.sort()).toEqual(['activeModule', 'activePlanId', 'layerState', 'recent', 'schemaVersion', 'weather'])
  })

  it('a local field is mine verbatim even when only the server changed it, and absent stays absent', () => {
    for (const k of local) {
      expect(mergeWorkspace({ [k]: 'base' }, { [k]: 'base' }, { [k]: 'server' })[k]).toBe('base')
      expect(k in mergeWorkspace({ [k]: 'base' }, {}, { [k]: 'server' })).toBe(false)
    }
  })

  it('every merged field is written, even when no side has it', () => {
    const merged = mergeWorkspace({}, {}, {})
    for (const k of keys.filter((k) => MERGE_POLICY[k] !== 'local')) expect(k in merged).toBe(true)
  })

  it('a key this build does not know rides with mine, as before the policy map', () => {
    expect(mergeWorkspace({ future: 1 }, { future: 1 }, { future: 2 }).future).toBe(1)
  })
})

// «Neuer Trupp» on three ONLINE devices within one second (field scenario, 24.09.2026): each
// minted «Trupp 1» from its own view of the counter, and the merge kept all three. The merge now
// settles the number (lib/truppNumbers); these replay the server's 409 sequence the way
// WorkspaceSync · resolveConflict runs it — every device's save 409s against whoever landed first
// and merges against the ancestor all three shared.
describe('mergeWorkspace — three devices mint «Trupp 1» at the same moment', () => {
  type Tr = { id: string; no?: number; name: string; members: string[]; readings: { t: string; bar: number; kind: string }[] }
  type Ws = { trupps?: Tr[]; objects?: { id: string; entity?: { label?: string } }[]; entities?: { id: string; label?: string }[] }
  const reg = (id: string, ms: number): Tr => {
    const t = new Date(Date.UTC(2026, 8, 25, 10, 0, 0, ms)).toISOString()
    return { id, no: 1, name: `GF ${id}`, members: [], readings: [{ t, bar: 300, kind: 'registered' }, { t, bar: 300, kind: 'crew' }] }
  }
  const team = (id: string) => ({ id, entity: { id, kind: 'team', layer: 'ops', coord: [8, 46], label: 'Trupp 1' } })
  const numbers = (ws: Ws) => Object.fromEntries((ws.trupps ?? []).map((t) => [t.id, t.no]))
  const labels = (ws: Ws) => Object.fromEntries((ws.objects ?? []).map((x) => [x.id, x.entity?.label]))
  /** the devices land in `order`; each merges its own blob over the server's current one */
  const land = (base: Ws, devices: Ws[], order: number[]) => {
    let server: Ws = devices[order[0]]
    for (const i of order.slice(1)) server = mergeWorkspace(base, devices[i], server) as Ws
    return server
  }

  const base: Ws = { trupps: [] }
  const A = { trupps: [reg('trA', 10)] }, B = { trupps: [reg('trB', 20)] }, C = { trupps: [reg('trC', 30)] }

  it('the Trupps end up 1, 2, 3 — the first to LAND keeps 1, and nobody moves twice', () => {
    const ids = ['trA', 'trB', 'trC']
    for (const order of [[0, 1, 2], [2, 1, 0], [1, 2, 0], [2, 0, 1]]) {
      const out = land(base, [A, B, C], order)
      expect(out.trupps).toHaveLength(3) // nothing lost — the merge keeps every record
      // equal weight: the number already on the server stays with its holder (N16)
      expect(numbers(out)[ids[order[0]]]).toBe(1)
      expect(new Set(Object.values(numbers(out)))).toEqual(new Set([1, 2, 3]))
      for (const t of out.trupps ?? []) expect((t as { formerNos?: number[] }).formerNos ?? []).toEqual(t.no === 1 ? [] : [1])
    }
  })

  // N16 (staging, 25.09.2026): a merge that 409s is merged again from its OWN result, whose
  // freshly handed-out number is not a claim — nothing was pushed, shown or written under it
  it('a re-merge takes back its own un-landed renumbering instead of moving a landed Trupp again', () => {
    // «Trupp 1» stands; three devices mint «2» from that view — K2's lands first
    const K = reg('K', 0)
    const server1 = { trupps: [K] }
    const K2 = { ...reg('K2', 0), no: 2 }
    const E = { ...reg('trE', 20), no: 2 }, G = { ...reg('trG', 10), no: 2 }
    const s1 = { trupps: [K, K2] }
    // E's and G's merges both run against that same server copy, and both hand out 3
    const e1 = mergeWorkspace(server1, { trupps: [K, E] }, s1) as Ws
    const g1 = mergeWorkspace(server1, { trupps: [K, G] }, s1) as Ws
    expect(numbers(e1).trE).toBe(3)
    expect(numbers(g1).trG).toBe(3)
    // E lands; G's PUT 409s and G re-merges ITS OWN result over the new server copy
    const g2 = mergeWorkspace(s1, g1, e1) as Ws
    expect(numbers(g2)).toEqual({ K: 1, K2: 2, trE: 3, trG: 4 }) // E stays: it moved once
    const byId = Object.fromEntries((g2.trupps ?? []).map((t) => [t.id, (t as { formerNos?: number[] }).formerNos]))
    expect(byId.trE).toEqual([2])
    expect(byId.trG).toEqual([2]) // 2 → 4 in ONE move: 3 was never G's, and never on paper
  })

  it('a landed Trupp that already moved once keeps its number over an earlier-minted newcomer', () => {
    const X = { ...reg('trX', 50), no: 2, formerNos: [1] } // moved 1 → 2 by an earlier merge, on the server
    const K = { ...reg('K', 0), no: 1 }
    const server = { trupps: [K, X] }
    const Y = { ...reg('trY', 5), no: 2 } // minted «2» offline before X existed
    const out = mergeWorkspace({ trupps: [K] }, { trupps: [K, Y] }, server) as Ws
    expect(numbers(out)).toEqual({ K: 1, trX: 2, trY: 3 })
  })

  it('two re-merging at once (both merged against the first, one lands, the other re-merges) still ends distinct', () => {
    const b1 = mergeWorkspace(base, B, A) as Ws // B's merge against A…
    const c1 = mergeWorkspace(base, C, A) as Ws // …and C's, at the same time, against the same A
    expect(numbers(b1)).toEqual({ trA: 1, trB: 2 })
    expect(numbers(c1)).toEqual({ trA: 1, trC: 2 })
    // B lands; C's PUT 409s and C re-merges over it — its ancestor is now the server copy it
    // merged against (A), exactly as resolveConflict re-bases
    const c2 = mergeWorkspace(A, c1, b1) as Ws
    expect(numbers(c2)).toEqual({ trA: 1, trB: 2, trC: 3 })
    // …and nobody moves again: a further merge of the landed state is a no-op for the numbers
    expect(numbers(mergeWorkspace(c2, c2, c2) as Ws)).toEqual(numbers(c2))
  })

  it('every device that showed «Trupp 1» can say what it is called now — and says the same thing', () => {
    const out = land(base, [A, B, C], [0, 1, 2])
    const told = [A, B, C].flatMap((mine) => truppRenumberings(mine, out))
    expect(told.map((r) => [r.id, r.from, r.to])).toEqual([['trB', 1, 2], ['trC', 1, 3]])
  })

  it('three loose markers dropped on the Karte at once get three names, and the Karte views follow', () => {
    const chips = [0, 1, 2].map((i) => ({ objects: [team(`trupp17587944000${i}0-0${i}ab`)] }))
    const out = land({ objects: [] }, chips, [1, 2, 0]) as Ws
    expect(Object.values(labels(out)).sort()).toEqual(['Trupp 1', 'Trupp 2', 'Trupp 3'])
    expect(labels(out)['trupp1758794400010-01ab']).toBe('Trupp 1') // landed first
    // the legacy `entities` view is DERIVED from the relabelled objects, never left behind
    expect(Object.fromEntries((out.entities ?? []).map((e) => [e.id, e.label]))).toEqual(labels(out))
  })

  it('a marker and a Trupp registered at once: the Trupp keeps 1, the marker is relabelled', () => {
    const marker = { objects: [team('trupp1758794400000-00ab')] } // minted EARLIER than the Trupp
    const out = mergeWorkspace({ objects: [], trupps: [] }, { trupps: [reg('trX', 50)] }, marker) as Ws
    expect(numbers(out)).toEqual({ trX: 1 })
    expect(labels(out)).toEqual({ 'trupp1758794400000-00ab': 'Trupp 2' })
  })

  it('a later Trupp does not collide with the renumbered ones — the counter reads the merged record', () => {
    const out = land(base, [A, B, C], [0, 1, 2])
    expect(nextTruppNo(out.trupps ?? [], [])).toBe(4)
  })
})

/* staging r3 F11, 25.09.2026: the server keeps the blob as JSONB and hands every object back with
 * its keys RE-SORTED, while this device's own entries keep the order the code built them in. The
 * merge compared entries as JSON strings, so an entry this device never touched read as «changed
 * here» against its re-sorted ancestor — and when another device really changed it, «both
 * changed» went LWW-mine and the other device's edit was thrown away. Every policy that compares
 * values is walked here: base and theirs are what the server sent back, mine is this device's
 * untouched copy. */
describe.each(['jsonb', 'alphabetical'] as const)('mergeWorkspace — a server round trip re-sorts keys (%s): key order is no edit', (order) => {
  const server = <T,>(v: T): T => serverRoundTrip(v, order)
  /** base = the server's copy of `mine`; theirs = the server's copy of the other device's edit */
  const roundTrip = (field: string, mine: unknown, theirs: unknown) =>
    mergeWorkspace(server({ [field]: mine }), { [field]: mine }, server({ [field]: theirs }))[field]

  const collections: [string, Record<string, unknown>, Record<string, unknown>][] = [
    ['timeline', { id: 'r1', t: '17:09', text: 'Lage erkundet', icon: 'note', at: '2026-09-25T17:09:00Z' }, { text: 'Lage erkundet, 2. OG' }],
    ['mittel', { id: 'm1', label: 'Schaummittel', unit: 'l', qty: 20, at: '2026-09-25T17:30:00Z' }, { qty: 40 }],
    ['shifts', { id: 'sh1', personId: 'p1', from: '2026-09-25T17:00:00Z', to: '2026-09-25T19:00:00Z', bandId: 'bd1' }, { to: '2026-09-25T21:00:00Z' }],
    ['bands', { id: 'bd1', label: 'Nacht', from: '2026-09-25T22:00:00Z', to: '2026-09-26T06:00:00Z' }, { label: 'Nacht 1' }],
    ['cameraViews', { id: 'cv1', name: 'Übersicht', center: [7.55, 47.51], zoom: 17, bearing: 0 }, { zoom: 18 }],
    ['trails', { id: 'ght-a', sourceId: 'a', truppNo: 1, points: [{ lng: 7.55, lat: 47.51, t: '2026-09-25T17:10:00Z' }] }, { removedAt: '2026-09-25T18:00:00Z' }],
    ['attachments', { id: 'att1', url: '/api/media/att1', caption: 'Schaden', at: '2026-09-25T17:20:00Z' }, { caption: 'Schaden Küche' }],
  ]

  it.each(collections)('%s: another device\'s edit to an entry this device never touched survives', (field, entry, edit) => {
    expect(JSON.stringify(server(entry))).not.toBe(JSON.stringify(entry)) // the round trip really re-sorted
    const theirs = { ...entry, ...edit }
    expect(roundTrip(field, [entry], [theirs])).toEqual([theirs])
  })

  it('objects: another device\'s move of a map object survives, in the object and in its view', () => {
    const entity = { id: 'a', kind: 'symbol', layer: 'taktisch', coord: [7.55, 47.51], label: 'TLF' }
    const theirs = { id: 'a', entity: { ...entity, coord: [7.56, 47.52] } }
    const merged = mergeWorkspace(server({ objects: [{ id: 'a', entity }] }), { objects: [{ id: 'a', entity }] }, server({ objects: [theirs] }))
    expect(merged.objects).toEqual([theirs])
    expect((merged.entities as { coord: number[] }[])[0].coord).toEqual([7.56, 47.52])
  })

  const values: [string, unknown, unknown][] = [
    ['vehicleOverrides', { tlf: { coord: [7.55, 47.51], rotation: 90, fahrer: 'Tst Jan' } }, { tlf: { coord: [7.55, 47.51], rotation: 180, fahrer: 'Tst Jan' } }],
    ['checklists', { brand: { activeBranch: { p1: 'ohne' }, ticks: { erkunden: { by: 'EL', at: '17:10' } } } }, { brand: { activeBranch: { p1: 'mit' }, ticks: { erkunden: { by: 'EL', at: '17:10' } } } }],
    ['settings', { contactIntervalMin: 10, contactGraceSec: 60, defaultFunkkanal: 11 }, { contactIntervalMin: 10, contactGraceSec: 60, defaultFunkkanal: 12 }],
    ['attendance', { p1: { status: 'present', displayNameSnapshot: 'Tst Jan', intervals: [{ from: '2026-09-25T17:09:00Z' }] } },
      { p1: { status: 'left', displayNameSnapshot: 'Tst Jan', intervals: [{ from: '2026-09-25T17:09:00Z', to: '2026-09-25T19:00:00Z' }], leftAt: '2026-09-25T19:00:00Z' } }],
    ['reportMeta', { partnerContacts: [{ org: 'Polizei', name: 'Wache', phone: '117' }], linksDone: { l1: '2026-09-25T18:00:00Z' }, fahrzeuge: [{ id: 'tlf', vorOrt: '2026-09-25T17:08:00Z', manual: true }] },
      { partnerContacts: [{ org: 'Polizei', name: 'Wache', phone: '112' }], linksDone: { l1: '2026-09-25T18:00:00Z' }, fahrzeuge: [{ id: 'tlf', vorOrt: '2026-09-25T17:07:00Z', manual: true }] }],
    ['building', { ring: [[0, 0], [1, 0], [1, 1]], ringAspect: 1.5, floors: [0, 1], floorNames: { 0: 'EG' } }, { ring: [[0, 0], [1, 0], [1, 1]], ringAspect: 1.5, floors: [0, 1], floorNames: { 0: 'EG / ZWG' } }],
    ['trupps', [{ id: 't1', no: 1, status: 'aktiv', crew: [{ personId: 'p1', name: 'Tst Jan', role: 'TF' }] }],
      [{ id: 't1', no: 1, status: 'aktiv', crew: [{ personId: 'p1', name: 'Tst Jan', role: 'TF' }, { personId: 'p2', name: 'Tst Eva', role: 'TM' }] }]],
  ]

  it.each(values)('%s: another device\'s edit to a value this device never touched survives', (field, mine, theirs) => {
    expect(JSON.stringify(server(mine))).not.toBe(JSON.stringify(mine)) // the round trip really re-sorted
    expect(roundTrip(field, mine, theirs)).toEqual(theirs)
  })

  it('and this device\'s own edit still wins over an entry the other device never touched', () => {
    const sh = { id: 'sh1', personId: 'p1', from: '2026-09-25T17:00:00Z', to: '2026-09-25T19:00:00Z' }
    const mine = { ...sh, to: '2026-09-25T20:00:00Z' }
    expect(mergeWorkspace(server({ shifts: [sh] }), { shifts: [mine] }, server({ shifts: [sh] })).shifts).toEqual([mine])
  })
})

// 05.11.2026: a live vehicle's Fahrer and Herkunft live in ONE override row, so as a whole row
// the tablet naming the driver and the phone setting the Herkunft in the same second lost one.
describe('vehicleOverrides — one vehicle, two devices, different fields', () => {
  const base = { tlf: { rotation: 90 } }
  it('keeps the Fahrer from one side and the Herkunft from the other', () => {
    const merged = mergeWorkspace({ vehicleOverrides: base },
      { vehicleOverrides: { tlf: { rotation: 90, fahrer: 'Tst Jan' } } },
      { vehicleOverrides: { tlf: { rotation: 90, herkunft: 'Stützpunkt' } } })
    expect(merged.vehicleOverrides).toEqual({ tlf: { rotation: 90, fahrer: 'Tst Jan', herkunft: 'Stützpunkt' } })
  })
  it('a field both sides changed keeps mine; a «GPS» reset (row gone) still wins', () => {
    const both = mergeWorkspace({ vehicleOverrides: base },
      { vehicleOverrides: { tlf: { rotation: 90, herkunft: 'Zivilschutz' } } },
      { vehicleOverrides: { tlf: { rotation: 90, herkunft: 'Stützpunkt' } } })
    expect(both.vehicleOverrides).toEqual({ tlf: { rotation: 90, herkunft: 'Zivilschutz' } })
    const reset = mergeWorkspace({ vehicleOverrides: base }, { vehicleOverrides: {} },
      { vehicleOverrides: { tlf: { rotation: 90, herkunft: 'Stützpunkt' } } })
    expect(reset.vehicleOverrides).toEqual({})
  })
})

/* staging r3 F11: four tablets filed the same Link crew under the same derived id, and every
 * person got «abweichende Angaben zusammengeführt – bitte prüfen» with two identical sides. Key
 * order is not a difference, nor is the moment a device wrote the same Funktion. */
describe('attendance conflicts — only when the two sides say something different', () => {
  const entry = { status: 'present', displayNameSnapshot: 'Tst Jan', intervals: [{ from: '2026-09-25T17:09:00Z' }], checkedInAt: '2026-09-25T17:09:00Z', note: 'AS-GF' }

  it('two devices filing the same person under the same derived id collapse silently, whatever the key order', () => {
    const conflicts: unknown[] = []
    const merged = mergeWorkspace({ attendance: {} }, { attendance: { 'g-t1-x': entry } }, { attendance: { 'g-t1-x': serverRoundTrip(entry) } },
      (c) => conflicts.push(c)) as { attendance: Record<string, unknown> }
    expect(conflicts).toEqual([])
    expect(merged.attendance['g-t1-x']).toEqual(entry)
  })

  it('an entry neither device changed raises nothing after a round trip', () => {
    const conflicts: unknown[] = []
    mergeWorkspace(serverRoundTrip({ attendance: { p1: entry } }), { attendance: { p1: entry } }, serverRoundTrip({ attendance: { p1: entry } }), (c) => conflicts.push(c))
    expect(conflicts).toEqual([])
  })

  it('a difference only in noteAt is no divergence; a different Funktion still is', () => {
    const conflicts: unknown[] = []
    mergeWorkspace({ attendance: {} }, { attendance: { p1: { ...entry, noteAt: '2026-09-25T17:09:01Z' } } },
      { attendance: { p1: serverRoundTrip({ ...entry, noteAt: '2026-09-25T17:09:03Z' }) } }, (c) => conflicts.push(c))
    expect(conflicts).toEqual([])
    mergeWorkspace({ attendance: {} }, { attendance: { p1: entry } }, { attendance: { p1: { ...entry, note: 'AS' } } }, (c) => conflicts.push(c))
    expect(conflicts).toHaveLength(1)
  })
})

/* staging r4 D3: two devices saving DIFFERENT fields of one person or one shift in the same second
 * both build on the same ancestor; merged as whole objects, one of the two edits was lost. The
 * end-to-end reproduction with two sync engines is workspaceSync.sameSecond.test.ts. */
describe('mergeWorkspace — Anwesenheit entries merge per fact', () => {
  const base = { status: 'present', displayNameSnapshot: 'Tst Emil', checkedInAt: '2026-09-25T21:36:00Z', intervals: [{ from: '2026-09-25T21:36:00Z' }], source: 'kp' }
  const von = (from: string) => ({ checkedInAt: from, intervals: [{ from }] })
  const merge = (mine: object, theirs: object) => {
    const conflicts: RecordConflict[] = []
    const merged = mergeWorkspace({ attendance: { p1: base } }, { attendance: { p1: { ...base, ...mine } } },
      serverRoundTrip({ attendance: { p1: { ...base, ...theirs } } }), (c) => conflicts.push(c)) as { attendance: Record<string, Record<string, unknown>> }
    return { entry: merged.attendance.p1, conflicts }
  }

  it('a «von» on one device and a Bemerkung on the other both stand, and nothing is reported', () => {
    const { entry, conflicts } = merge({ note: 'Fahrer TLF', noteAt: '2026-09-25T21:38:30Z' }, von('2026-09-25T21:38:00Z'))
    expect(entry).toEqual({ ...base, ...von('2026-09-25T21:38:00Z'), note: 'Fahrer TLF', noteAt: '2026-09-25T21:38:30Z' })
    expect(conflicts).toEqual([])
  })

  it('the Ort and the presence are separate facts too', () => {
    const { entry, conflicts } = merge({ ort: 'station' }, { status: 'left', leftAt: '2026-09-25T23:00:00Z', intervals: [{ from: base.checkedInAt, to: '2026-09-25T23:00:00Z' }] })
    expect(entry).toMatchObject({ ort: 'station', status: 'left', leftAt: '2026-09-25T23:00:00Z' })
    expect(conflicts).toEqual([])
  })

  it('a Bemerkung cleared on one device stays cleared while the other moves the time', () => {
    const withNote = { ...base, note: 'AS', noteAt: '2026-09-25T21:37:00Z' }
    const merged = mergeWorkspace({ attendance: { p1: withNote } }, { attendance: { p1: { ...base } } },
      { attendance: { p1: { ...withNote, ...von('2026-09-25T21:30:00Z') } } }) as { attendance: Record<string, Record<string, unknown>> }
    expect(merged.attendance.p1).toEqual({ ...base, ...von('2026-09-25T21:30:00Z') })
  })

  it('presence is ONE fact: a «von» against a check-out keeps mine whole and reports only the times', () => {
    const leaving = { status: 'left', leftAt: '2026-09-25T23:00:00Z', intervals: [{ from: base.checkedInAt, to: '2026-09-25T23:00:00Z' }] }
    const { entry, conflicts } = merge({ ...leaving, note: 'Maschinist', noteAt: '2026-09-25T22:00:00Z' }, von('2026-09-25T21:30:00Z'))
    // never status «left» with the other side's open block and first arrival
    expect(entry).toMatchObject({ ...leaving, checkedInAt: base.checkedInAt, note: 'Maschinist' })
    expect(conflicts).toHaveLength(1)
    expect(conflictWhat(conflicts[0])).toBe('Status abweichend · unterschiedliche Zeiten')
    // the two sides differ ONLY in the diverging fact — settling on either keeps the Bemerkung
    expect(conflicts[0].mine).toEqual(entry)
    expect(conflicts[0].theirs).toMatchObject({ ...von('2026-09-25T21:30:00Z'), status: 'present', note: 'Maschinist' })
    expect((conflicts[0].theirs as Record<string, unknown>).leftAt).toBeUndefined()
  })

  it('two different Funktionen are still a divergence — named alone, even when a time moved beside it', () => {
    const { entry, conflicts } = merge({ note: 'Maschinist TLF', noteAt: '2026-09-25T21:40:01Z' },
      { note: 'Maschinist', noteAt: '2026-09-25T21:40:00Z', ...von('2026-09-25T21:42:00Z') })
    expect(entry).toMatchObject({ note: 'Maschinist TLF', ...von('2026-09-25T21:42:00Z') })
    expect(conflicts).toHaveLength(1)
    expect(conflictWhat(conflicts[0])).toBe('zwei Funktionen – «Maschinist TLF» und «Maschinist»')
  })

  it('where the entry was last written is bookkeeping, never a divergence', () => {
    const { entry, conflicts } = merge({ source: 'capture', note: 'AS' }, { source: 'kp', ...von('2026-09-25T21:30:00Z') })
    expect(entry).toMatchObject({ source: 'capture', note: 'AS', ...von('2026-09-25T21:30:00Z') })
    expect(conflicts).toEqual([])
  })
})

describe('mergeWorkspace — Zeitplan shifts merge per field', () => {
  const sh = { id: 'sh1', personId: 'p1', from: '2026-09-25T23:00:00Z', to: '2026-09-26T04:00:00Z', bandId: 'bd1' }
  const merge = (mine: object, theirs: object, base: object = sh) =>
    (mergeWorkspace({ shifts: [base] }, { shifts: [{ ...sh, ...mine }] }, serverRoundTrip({ shifts: [{ ...sh, ...theirs }] })).shifts as object[])

  it('one device\'s «von» and the other\'s «bis» both stand', () => {
    expect(merge({ from: '2026-09-26T01:00:00Z' }, { to: '2026-09-26T07:00:00Z' })).toEqual([{ ...sh, from: '2026-09-26T01:00:00Z', to: '2026-09-26T07:00:00Z' }])
  })

  it('«eingeteilt» and a moved end both stand; a field removed on one side stays removed', () => {
    expect(merge({ confirmed: true }, { to: '2026-09-26T06:00:00Z' })).toEqual([{ ...sh, confirmed: true, to: '2026-09-26T06:00:00Z' }])
    const loose = { ...sh }
    delete (loose as { bandId?: string }).bandId
    expect(mergeWorkspace({ shifts: [sh] }, { shifts: [loose] }, { shifts: [{ ...sh, confirmed: true }] }).shifts).toEqual([{ ...loose, confirmed: true }])
  })

  it('the same field on both sides stays last-writer-wins (mine)', () => {
    expect(merge({ to: '2026-09-26T05:00:00Z' }, { to: '2026-09-26T07:00:00Z' })).toEqual([{ ...sh, to: '2026-09-26T05:00:00Z' }])
  })

  it('a start and an end that together would not make a block keep my pair', () => {
    // I moved the whole shift to the morning; they stretched the old end. 07:00→04:00 is no shift.
    const mine = { from: '2026-09-26T07:00:00Z', to: '2026-09-26T09:00:00Z' }
    expect(merge(mine, { from: '2026-09-25T22:00:00Z' })).toEqual([{ ...sh, ...mine }])
    expect(merge({ from: '2026-09-26T02:00:00Z' }, { to: '2026-09-26T01:00:00Z' })).toEqual([{ ...sh, from: '2026-09-26T02:00:00Z' }])
  })
})

/* Audit F04 + Codex review (26.10.2026): a cached blob from before the load gate can still hold two
 * different Trupps under one id when a cold reopen merges it with a newer server copy. The merge
 * splits them first, with the same derived id the load gate mints, so neither crew vanishes. */
describe('Trupps under one id — split before the keyed merge', () => {
  const tr = (name: string) => ({ id: 'T1', name, status: 'aktiv', entryPressureBar: 300, entryTime: '', lastContactTime: '' })
  it('keeps both crews and derives the same id on every side', () => {
    const out = mergeWorkspace({}, { trupps: [tr('A'), tr('B')] } as unknown as Saved, { trupps: [] } as unknown as Saved) as Record<string, unknown>
    expect((out.trupps as { id: string; name: string }[]).map((t) => [t.id, t.name])).toEqual([['T1', 'A'], ['T1~2', 'B']])
  })
})
