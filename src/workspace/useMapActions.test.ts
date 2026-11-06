// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useMapActions, type UseMapActionsInputs } from './useMapActions'
import { replayEmits } from '../lib/replay.test-utils'
import type { Doc } from '../lib/workspace'
import type { Drawing, Entity, LineAttachment } from '../types'

vi.mock('../lib/ui', () => ({ toast: vi.fn(), confirmDialog: vi.fn(async () => true), undoToast: vi.fn() }))

const ent = (id: string, coord: [number, number]): Entity => ({ id, kind: 'symbol', layer: 'l', coord, symbol: 'X' }) as Entity
const leitung = (over: Partial<Drawing>): Drawing => ({ id: 'h', kind: 'line', coords: [[0, 0], [5, 5], [9, 9]], ...over }) as Drawing
const onObject = (id: string): LineAttachment => ({ target: { kind: 'object', id }, routing: 'direct' })

// The inputs the delete paths read, over a live doc the commit stub applies to; every other
// input is an inert stub (the hook's mount effects only read refs and flags).
function makeDeps(entities: Entity[], drawings: Drawing[]) {
  let doc = { entities, drawings } as unknown as Doc
  const given = {
    entities, drawings, doc, tacticalLocked: false, liveIds: new Set<string>(), selectedId: null, editNoteId: null,
    planDocs: [], trupps: [], objects: [], selectedDrawIds: [], selectedEntityIds: [], mode: 'map' as const,
    commit: vi.fn((u: (d: Doc) => Doc) => { doc = u(doc) }),
    emit: vi.fn(),
    log: vi.fn(),
  } satisfies Partial<UseMapActionsInputs>
  const deps = new Proxy(given, {
    get: (t, k) => (k in t ? t[k as keyof typeof t] : (k === 'then' ? undefined : vi.fn())),
  }) as unknown as UseMapActionsInputs
  return { deps, given, live: () => doc }
}

afterEach(() => { vi.clearAllMocks() })

// Deleting a symbol lets go of every Leitung end hanging on it. Both ends of one line on the
// deleted object(s) used to go out as two `draw.edit`s, each built from the line's ORIGINAL
// coords — so replay folded the second over the first and put the first end back.
describe('delete — a line with both ends on what goes', () => {
  it('deleteGroup: replay shows both ends moved for a line between two deleted symbols', async () => {
    const entities = [ent('a', [1, 1]), ent('b', [2, 2])]
    const drawings = [leitung({ startAttachment: onObject('a'), endAttachment: onObject('b') })]
    const { deps, given, live } = makeDeps(entities, drawings)
    const { result } = renderHook(() => useMapActions(deps))
    await act(async () => { await result.current.deleteGroup([], ['a', 'b']) })
    expect(live().drawings[0].coords).toEqual([[1, 1], [5, 5], [2, 2]])
    const replayed = await replayEmits({ entities, drawings }, given.emit.mock.calls)
    expect(replayed.drawings[0].coords).toEqual([[1, 1], [5, 5], [2, 2]])
    expect(given.emit.mock.calls.filter(([op]) => op === 'draw.edit')).toHaveLength(1)
  })

  it('deleteEntity: replay shows both ends moved for a line with both ends on the symbol', async () => {
    const entities = [ent('a', [1, 1])]
    const drawings = [leitung({ startAttachment: onObject('a'), endAttachment: onObject('a') })]
    const { deps, given, live } = makeDeps(entities, drawings)
    const { result } = renderHook(() => useMapActions(deps))
    await act(async () => { await result.current.deleteEntity('a') })
    expect(live().drawings[0].coords).toEqual([[1, 1], [5, 5], [1, 1]])
    const replayed = await replayEmits({ entities, drawings }, given.emit.mock.calls)
    expect(replayed.drawings[0].coords).toEqual([[1, 1], [5, 5], [1, 1]])
    expect(given.emit.mock.calls.filter(([op]) => op === 'draw.edit')).toHaveLength(1)
  })
})

// …and the coupling goes with it in replay too: a cleared end used to travel as `undefined`,
// which JSON drops, so the replayed line still hung on the deleted symbols.
describe('delete — replay clears the freed ends\' attachments', () => {
  it('deleteGroup: the replayed line hangs on nothing', async () => {
    const entities = [ent('a', [1, 1]), ent('b', [2, 2])]
    const drawings = [leitung({ startAttachment: onObject('a'), endAttachment: onObject('b') })]
    const { deps, given } = makeDeps(entities, drawings)
    const { result } = renderHook(() => useMapActions(deps))
    await act(async () => { await result.current.deleteGroup([], ['a', 'b']) })
    const [replayed] = (await replayEmits({ entities, drawings }, given.emit.mock.calls)).drawings
    expect(replayed).not.toHaveProperty('startAttachment')
    expect(replayed).not.toHaveProperty('endAttachment')
  })
})
