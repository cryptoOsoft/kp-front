// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  ageMinutes, personSymbolSvg, positionsSignature, usePersonPositions,
  EMPTY_POLL_EVERY, PERSON_STALE_AFTER_MS, type LivePerson,
} from './usePersonPositions'

const AT = Date.parse('2026-08-05T10:00:00Z')

const live = (id: string, lng = 7.5, lat = 47.5, at = AT): LivePerson => ({
  personId: id,
  displayName: `Meier ${id}`,
  coord: [lng, lat],
  at,
  accuracyM: 12,
})

describe('positionsSignature (re-render short-circuit)', () => {
  it('is stable when only the fix TIME advances', () => {
    // The crew is standing at the Weiher and the phones keep re-reporting the same spot. The
    // map draws exactly the same picture, so it must not be told to re-render — this is the
    // shape of the battery bug this app has already paid for once.
    const a = live('1', 7.5, 47.5, AT)
    const b = live('1', 7.5, 47.5, AT + 60_000)
    expect(positionsSignature([a])).toBe(positionsSignature([b]))
  })

  it('changes when somebody actually moves', () => {
    const base = positionsSignature([live('1', 7.5, 47.5)])
    expect(positionsSignature([live('1', 7.6, 47.5)])).not.toBe(base)
    expect(positionsSignature([live('1', 7.5, 47.6)])).not.toBe(base)
  })

  it('changes when somebody starts or stops sharing', () => {
    expect(positionsSignature([live('1')])).not.toBe(positionsSignature([live('1'), live('2', 7.6)]))
  })

  it('is empty for nobody sharing (so the first real poll always renders)', () => {
    expect(positionsSignature([])).toBe('')
  })
})

describe('the glyph', () => {
  // ⚠️ THE SAME initials the avatar shows (lib/format · initials). This module used to mint its
  // own, so one person had two labels: «Meier» read «ME» on the avatar and «M» on the map dot.
  it('labels the dot with the avatar initials', () => {
    expect(personSymbolSvg('Meier Hans')).toContain('>MH<')
    expect(personSymbolSvg('Meier')).toContain('>ME<')
    // umlaut-folded, so a name with an Ä does not get a glyph the map font may not carry
    expect(personSymbolSvg('Bär')).toContain('>BA<')
    expect(personSymbolSvg('  ')).toContain('>?<')
  })

  it('is not a tactical symbol — a person dot must never read as a deployed unit', () => {
    const svg = personSymbolSvg('Meier Hans')
    expect(svg).toContain('<circle')
    // the vehicle glyph's body/chevron path vocabulary must not appear here
    expect(svg).not.toContain('M -1,0.4 L -1,-0.4')
  })

  it('dims a position that has stopped updating', () => {
    expect(personSymbolSvg('Meier Hans', true)).not.toBe(personSymbolSvg('Meier Hans', false))
  })
})

describe('ageMinutes', () => {
  it('floors to whole minutes and never goes negative on a skewed phone clock', () => {
    expect(ageMinutes(AT, AT)).toBe(0)
    expect(ageMinutes(AT, AT + 119_000)).toBe(1)
    expect(ageMinutes(AT + 60_000, AT)).toBe(0)
  })
})

const dto = (id: string, over: Record<string, unknown> = {}) => ({
  person_id: id,
  display_name: `Meier ${id}`,
  lat: 47.5,
  lng: 7.5,
  accuracy_m: 12,
  ts: new Date(AT).toISOString(),
  ...over,
})

describe('usePersonPositions polling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(AT)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('polls its incident and maps rows onto the personen layer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([dto('p1')]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { result, unmount } = renderHook(() => usePersonPositions('inc-1', true))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    expect(fetchMock).toHaveBeenCalledWith('/api/incidents/inc-1/positions', expect.anything())
    expect(result.current.people).toHaveLength(1)
    const e = result.current.people[0]
    expect(e.id).toBe('pos-p1')
    expect(e.kind).toBe('person')
    expect(e.layer).toBe('personen')
    expect(e.live).toBe(true)          // read-only: not draggable, not persisted
    expect(e.coord).toEqual([7.5, 47.5]) // [lng, lat], not the API's [lat, lng] order
    expect(result.current.byPerson.get('p1')?.displayName).toBe('Meier p1')

    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    unmount()
  })

  it('asks a third as often while nobody shares, and is back on every tick with the first position', async () => {
    // perf sweep 09.11.2026: an idle tablet spent a third of its requests on an empty answer
    const answer = (rows: unknown[]) => new Response(JSON.stringify(rows), { status: 200 })
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(answer([])))
    vi.stubGlobal('fetch', fetchMock)
    const { result, unmount } = renderHook(() => usePersonPositions('inc-1', true))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // empty: two ticks pass, the third asks
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000 * (EMPTY_POLL_EVERY - 1)) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // somebody starts sharing: found on the next slow round, then every tick again
    fetchMock.mockImplementation(() => Promise.resolve(answer([dto('p1')])))
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000 * EMPTY_POLL_EVERY) })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.current.people).toHaveLength(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(fetchMock).toHaveBeenCalledTimes(5)
    unmount()
  })

  it('says where every dot came from, so a self-report never reads as a placed symbol', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([dto('p1')]), { status: 200 })))
    const { result, unmount } = renderHook(() => usePersonPositions('inc-1', true))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.people[0].subtitle).toContain('Selbstauskunft')
    unmount()
  })

  it('keeps a position that stopped updating, and dates it', async () => {
    // The phone went in a pocket. The last fix is still the best answer anyone has, so it
    // stays on the map — but it must stop looking as current as one from ten seconds ago.
    const old = new Date(AT - PERSON_STALE_AFTER_MS - 60_000).toISOString()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([dto('p1', { ts: old })]), { status: 200 })))
    const { result, unmount } = renderHook(() => usePersonPositions('inc-1', true))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    expect(result.current.people).toHaveLength(1)
    expect(result.current.people[0].subtitle).toMatch(/vor \d+ min/)
    unmount()
  })

  it('stops for good when this session may not read the crew picture (403)', async () => {
    // A link-scoped phone is refused server-side by design — it reports its own position and
    // reads nobody else's. Retrying that every 15 s would be a heartbeat of 403s.
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)
    const { result, unmount } = renderHook(() => usePersonPositions('inc-1', true))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current.people).toHaveLength(0)
    unmount()
  })

  it('never polls at all when disabled', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { result, unmount } = renderHook(() => usePersonPositions('inc-1', false))
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.people).toHaveLength(0)
    unmount()
  })

  it('empties the picture when the caller loses the right to look', async () => {
    // A dot nobody is refreshing is worse than no dot.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([dto('p1')]), { status: 200 })))
    const { result, rerender, unmount } = renderHook(
      ({ on }: { on: boolean }) => usePersonPositions('inc-1', on),
      { initialProps: { on: true } },
    )
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.people).toHaveLength(1)

    rerender({ on: false })
    expect(result.current.people).toHaveLength(0)
    unmount()
  })

  it('keeps polling through a transient failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)
    const { result, unmount } = renderHook(() => usePersonPositions('inc-1', true))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.error).toBe('HTTP 500')
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    unmount()
  })
})
