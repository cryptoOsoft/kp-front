import { describe, expect, it } from 'vitest'
import type { Drawing, Entity } from '../../types'
import type { Snapshot } from './snapshot'
import { stepAnchors, stepDone, stepsOf, stepWords } from './steps'
import { TUTORIALS } from './catalogue'

// T2 «lageZeichnen»: each step's check against the snapshot it began with – done once the learner
// did it, not yet before, and never for what the seeded scene already had.

const tlf: Entity = { id: 'e-tlf', kind: 'symbol', layer: 'tactical', coord: [7.6, 47.5], symbol: 'VKF TLF' } as Entity
const hydrant: Entity = { id: 'e-hy', kind: 'symbol', layer: 'tactical', coord: [7.61, 47.5], symbol: 'VKF Hydrant' } as Entity
const seedLine: Drawing = { id: 'd-seed', kind: 'line', coords: [[7.6, 47.5], [7.61, 47.5]] }

const snap = (over: Partial<Snapshot> = {}, ui: Partial<Snapshot['ui']> = {}): Snapshot => ({
  incident: { id: 'inc', isExercise: true },
  entities: [hydrant], drawings: [seedLine], trupps: [], journalRows: 3, present: 6,
  ui: { mode: 'map', tool: 'select', palette: false, phone: false, night: false, ...ui },
  events: [],
  ...over,
})
const step = (id: string) => {
  const s = stepsOf('lageZeichnen').find((x) => x.id === id)
  if (!s) throw new Error(id)
  return s
}

describe('T2 lageZeichnen · the predicates', () => {
  const start = snap()

  it('place: a new symbol counts, the seeded ones and a note do not', () => {
    expect(stepDone(step('place'), start, start)).toBe(false)
    expect(stepDone(step('place'), snap({ entities: [hydrant, { ...tlf, id: 'n1', kind: 'note' } as Entity] }), start)).toBe(false)
    expect(stepDone(step('place'), snap({ entities: [hydrant, tlf] }), start)).toBe(true)
    expect(stepDone(step('place'), snap({ entities: [hydrant, { ...tlf, kind: 'vehicle' }] }), start)).toBe(true)
  })

  it('move: a symbol that was there and stands elsewhere now', () => {
    const begun = snap({ entities: [hydrant, tlf] })
    expect(stepDone(step('move'), begun, begun)).toBe(false)
    expect(stepDone(step('move'), snap({ entities: [hydrant, { ...tlf, coord: [7.605, 47.501] }] }), begun)).toBe(true)
    // a NEW symbol somewhere is no move
    expect(stepDone(step('move'), snap({ entities: [hydrant, tlf, { ...tlf, id: 'e2', coord: [7.7, 47.6] }] }), begun)).toBe(false)
  })

  it('line: any new line – the seeded Leitung does not count, an area does not either', () => {
    expect(stepDone(step('line'), start, start)).toBe(false)
    expect(stepDone(step('line'), snap({ drawings: [seedLine, { id: 'a1', kind: 'area', coords: [] }] }), start)).toBe(false)
    expect(stepDone(step('line'), snap({ drawings: [seedLine, { id: 'l1', kind: 'line', coords: [] }] }), start)).toBe(true)
  })

  it('circle: a new Absperrkreis', () => {
    expect(stepDone(step('circle'), start, start)).toBe(false)
    expect(stepDone(step('circle'), snap({ drawings: [seedLine, { id: 'c1', kind: 'circle', coords: [[7.6, 47.5]], radiusM: 50 }] }), start)).toBe(true)
  })

  it('note: a new Notiz, not a new symbol', () => {
    expect(stepDone(step('note'), snap({ entities: [hydrant, tlf] }), start)).toBe(false)
    expect(stepDone(step('note'), snap({ entities: [hydrant, { ...tlf, id: 'n1', kind: 'note' } as Entity] }), start)).toBe(true)
  })

  it('undoRedo: ↶ then ↷ since the step began – ↷ alone, ↶ alone or an older ↶ do not', () => {
    const begun = snap({ events: [{ name: 'undo', seq: 4 }] })
    const at = (...ev: ('undo' | 'redo')[]) => snap({ events: [{ name: 'undo', seq: 4 }, ...ev.map((name, i) => ({ name, seq: 5 + i }))] })
    expect(stepDone(step('undoRedo'), at('redo'), begun)).toBe(false)
    expect(stepDone(step('undoRedo'), at('undo'), begun)).toBe(false)
    expect(stepDone(step('undoRedo'), at('undo', 'redo'), begun)).toBe(true)
    // …and the pointer follows: ↶ first, ↷ once the ↶ was seen
    expect(stepAnchors(step('undoRedo'), begun, begun)).toEqual(['top.undo'])
    expect(stepAnchors(step('undoRedo'), at('undo'), begun)).toEqual(['top.redo'])
  })

  it('theme is «Weiter»: never done by itself', () => {
    expect(step('theme').done).toBe('manual')
    expect(stepDone(step('theme'), snap({}, { night: true }), start)).toBe(false)
  })

  it('a step on another surface points at that surface\'s rail tile first', () => {
    expect(stepAnchors(step('line'), snap({}, { mode: 'atemschutz' }), start)).toEqual(['rail.map'])
    expect(stepAnchors(step('line'), start, start)).toEqual(['add.line', 'tool.line', 'tool.add'])
  })
})

describe('the step table', () => {
  it('every step of every tutorial has its words in every field the card reads', () => {
    for (const t of TUTORIALS) {
      for (const st of stepsOf(t.id)) {
        const w = stepWords(t.id, st.id)
        // the fallback has no hint – a step without words would show its bare id
        expect(w.hint, `${t.id}.${st.id}`).not.toBe('')
      }
    }
  })
})
