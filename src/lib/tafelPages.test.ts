// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { SKIZZE, pickedTafelPage, resetTafelPageMemory, setTafelPage, stepPage, useTafelPage } from './tafelPages'
import { readFileSync } from 'node:fs'

describe('which Tafel page this device has open', () => {
  it('is remembered per Einsatz across a reload (IndexedDB), never shared', async () => {
    resetTafelPageMemory()
    const a = renderHook(() => useTafelPage('inc-1'))
    expect(a.result.current[0]).toBe(SKIZZE)
    act(() => a.result.current[1]('fm-ef'))
    expect(a.result.current[0]).toBe('fm-ef')
    a.unmount()
    // a reload: the session memory is gone, the device's store is not
    resetTafelPageMemory()
    const b = renderHook(() => useTafelPage('inc-1'))
    await waitFor(() => expect(b.result.current[0]).toBe('fm-ef'))
    // another Einsatz starts on the Skizze
    const c = renderHook(() => useTafelPage('inc-2'))
    expect(c.result.current[0]).toBe(SKIZZE)
  })
  it('a device that never picked a page sees the fallback (the demo\'s first page); a pick wins over it', async () => {
    resetTafelPageMemory()
    const a = renderHook(({ fb }) => useTafelPage('inc-demo', fb), { initialProps: { fb: undefined as string | undefined } })
    expect(a.result.current[0]).toBe(SKIZZE) // a real Einsatz: no fallback given
    a.rerender({ fb: 'fm-demo-ef' }) // the pages arrived with the workspace
    expect(a.result.current[0]).toBe('fm-demo-ef')
    act(() => a.result.current[1](SKIZZE)) // the visitor taps «Skizze»
    expect(a.result.current[0]).toBe(SKIZZE)
    a.unmount()
    // …and a reload keeps that choice over the fallback
    resetTafelPageMemory()
    const b = renderHook(() => useTafelPage('inc-demo', 'fm-demo-ef'))
    await waitFor(() => expect(b.result.current[0]).toBe(SKIZZE))
  })
  it('a page set from outside the strip (a presenter followed) shows on every mounted board', () => {
    resetTafelPageMemory()
    const a = renderHook(() => useTafelPage('inc-3'))
    const b = renderHook(() => useTafelPage('inc-3'))
    expect(pickedTafelPage('inc-3')).toBeNull()
    act(() => setTafelPage('inc-3', 'fm-ef'))
    expect([a.result.current[0], b.result.current[0], pickedTafelPage('inc-3')]).toEqual(['fm-ef', 'fm-ef', 'fm-ef'])
    act(() => a.result.current[1]('fm-2'))
    expect(b.result.current[0]).toBe('fm-2')
  })
  it('PageUp / PageDown stop at the ends', () => {
    expect([stepPage(['s', 'a', 'b'], 'a', 1), stepPage(['s', 'a', 'b'], 'b', 1), stepPage(['s', 'a'], 's', -1)]).toEqual(['b', 'b', 's'])
  })
})

/* owner, before the release: «move the skizze/führung thing to the same place where the location
 * change button is on the other pages». The strip stands in the plan's bottom-left row — where the
 * Objekt chip says «which place» — which already clears the rail, the phone's bars and the FAB, and
 * which the board's fit already keeps free; it wears that row's floating look. */
describe('the page strip stands in the row where a plan says «which place»', () => {
  const css = readFileSync(`${process.cwd()}/src/styles/09-whiteboard.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  it('wears the floating family, not a bar of its own', () => {
    const tps = /\.tps \{([^}]*)\}/.exec(css)?.[1] ?? ''
    for (const t of ['--float-h', '--float-bg', '--float-edge', '--r-sm']) expect(tps).toContain(t)
    expect(tps).not.toMatch(/position:\s*absolute|top:/)
  })
  it('on a phone the row of a Tafel page stands on the nav bar — the page has no tool bar under it', () => {
    const m = readFileSync(`${process.cwd()}/src/styles/15-mobile.css`, 'utf8')
    // the bars end at the nav bar there, and a dock does not lift the row's reserve either
    expect(m).toMatch(/:root:has\(\.phone-tools \.wb-tafel-page\)[^{]*\{\s*--float-bars: calc\(var\(--rail-h\) \+ 8px/)
    expect(m).toMatch(/:root:has\(\.phone-tools \.wb-dock\):not\(:has\(\.phone-tools \.wb-tafel-page\)\) \{ --float-base: calc\(var\(--rail-h\) \* 3/)
  })
})
