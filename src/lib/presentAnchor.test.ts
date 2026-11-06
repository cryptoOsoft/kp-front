// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { anchorPoint, pathTo, resolvePath, scrollToAnchor, topAnchor } from './presentAnchor'

/** jsdom lays nothing out: each element gets the box it is given */
function box(el: Element, top: number, height: number) {
  el.getBoundingClientRect = () => ({ top, bottom: top + height, height, left: 0, right: 300, width: 300, x: 0, y: top, toJSON: () => ({}) })
}

describe('a place in a scrolled surface', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('is named by the nearest keyed element and found again in another layout', () => {
    // a laptop's two columns…
    document.body.innerHTML = `<div id="a"><div class="grid"><div><section data-sec="front"><p>x</p><p id="t">y</p></section></div></div></div>`
    const a = document.getElementById('a')!
    const path = pathTo(a, document.getElementById('t')!)
    expect(path).toEqual(['data-sec=front', '1'])
    // …and a phone's one column, one wrapper less: the key still finds it
    document.body.innerHTML = `<div id="b"><section data-sec="ordnung"></section><section data-sec="front"><p>x</p><p id="u">y</p></section></div>`
    expect(resolvePath(document.getElementById('b')!, path)).toBe(document.getElementById('u'))
    expect(resolvePath(document.getElementById('b')!, ['data-sec=gone'])).toBeNull()
  })

  it('a row this layout lacks lands in its section, not nowhere', () => {
    // the laptop's table has ten ruled rows, the phone's one: a ring on row 5 stands in the table
    document.body.innerHTML = `<div id="c"><section data-sec="massnahmen"><div id="row0"></div></section></div>`
    const sec = document.querySelector('[data-sec]')!
    box(sec, 100, 200)
    expect(anchorPoint(document.getElementById('c')!, { path: ['data-sec=massnahmen', '5'], x: 0.5, y: 0.25, r: 0 })).toEqual({ x: 150, y: 150, w: 300 })
    expect(anchorPoint(document.getElementById('c')!, { path: ['data-sec=gone'], x: 0.5, y: 0.5, r: 0 })).toBeNull()
  })

  it('a follower scrolls the presenter\'s top row to its own top edge', () => {
    document.body.innerHTML = `<div id="s"><div data-ev="e1"></div><div data-ev="e2"></div><div data-ev="e3"></div></div>`
    const s = document.getElementById('s')!
    // the presenter: scrolled so e2 (at 100–160 in content) is a third under the top edge
    box(s, 0, 300)
    const rows = [...s.children]
    rows.forEach((r, i) => box(r, i * 60 - 80, 60))
    const a = topAnchor(s)
    expect(a.path).toEqual(['data-ev=e2'])
    expect(a.y).toBeCloseTo(20 / 60)
    // the follower: e2 stands at 150 px below its edge, rows 90 px high (a narrower screen)
    rows.forEach((r, i) => box(r, i * 90 + 60, 90))
    s.scrollTop = 0
    expect(scrollToAnchor(s, a)).toBe(true)
    expect(s.scrollTop).toBeCloseTo(150 + 30)
  })
})
