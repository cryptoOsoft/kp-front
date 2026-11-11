import { describe, expect, it } from 'vitest'
import { MAX_MENU_H, MIN_MENU_H, placeComboMenu, type MenuRoom } from './comboPlacement'

/** A 1024×768 tablet, no keyboard, no modal frame; the trigger 200×40 at `top`. */
const room = (top: number, over: Partial<MenuRoom> = {}): MenuRoom => ({
  trigger: { left: 700, top, bottom: top + 40, width: 200 },
  visTop: 0, visBottom: 768, viewH: 768, frameBottom: null, barsTop: null, viewW: 1024,
  ...over,
})

describe('placeComboMenu', () => {
  it('opens a short detail panel\'s field DOWN with the full ceiling – the screen is the room', () => {
    // «Bezeichnung» in a content-sized `.ctx` at y≈300: the panel ends right under it, the
    // screen has 768 − 340 − 12 = 416px. No modal frame, so the panel's own edge does not count.
    expect(placeComboMenu(room(300))).toMatchObject({ up: false, top: 340, maxH: 416 })
    expect(placeComboMenu(room(100)).maxH).toBe(MAX_MENU_H)
  })

  it('flips up only when below has run out and above offers more', () => {
    // 768 − 740 − 12 = 16 below, 688 above
    expect(placeComboMenu(room(700))).toMatchObject({ up: true, top: 700, maxH: MAX_MENU_H })
    // 120 below is short, but the 136 above is not a list – stays down, given the floor
    expect(placeComboMenu(room(148, { visBottom: 320 }))).toMatchObject({ up: false, maxH: MIN_MENU_H })
  })

  it('measures below against the keyboard, and then leaves the safe area alone', () => {
    // keys up: the usable screen ends at 420 → 420 − 240 − 12 = 168 below, 188 above → up
    expect(placeComboMenu(room(200, { visBottom: 420 }))).toMatchObject({ up: true, maxH: 188 })
    // a down menu that stops at the keys has no home indicator under it
    expect(placeComboMenu(room(100, { visBottom: 420 }))).toMatchObject({ up: false, maxH: 268, footInset: false })
  })

  it('takes the home-indicator inset off a down menu sized by the screen\'s foot', () => {
    expect(placeComboMenu(room(300)).footInset).toBe(true)
    // capped by the ceiling, the foot is not in reach
    expect(placeComboMenu(room(100)).footInset).toBe(false)
  })

  it('keeps a modal sheet\'s bottom edge as the floor of a DOWN menu, never of an UP one', () => {
    // a 400px centred sheet: 400 − 140 − 12 = 248 below — sized off the sheet, not the 616
    expect(placeComboMenu(room(100, { frameBottom: 400 }))).toMatchObject({ up: false, maxH: 248, footInset: false })
    // a short bottom sheet's first field: 176 below in the sheet, 528 above over the backdrop
    expect(placeComboMenu(room(540, { frameBottom: 768 }))).toMatchObject({ up: true, maxH: MAX_MENU_H })
  })

  it('stops at the phone\'s bottom bars – and opens UP over the form when they leave no list', () => {
    // the Rapport's Einsatzleiter on a 390×844 phone, the tab strip + nav bar from y=690:
    // 690 − 600 − 12 = 78 below the field, 548 above it
    const phone = { trigger: { left: 16, top: 560, bottom: 600, width: 358 }, visBottom: 844, viewH: 844, viewW: 390, barsTop: 690 }
    expect(placeComboMenu(room(0, phone))).toMatchObject({ up: true, maxH: MAX_MENU_H })
    // higher up, a down menu ends at the bars and owes the home indicator nothing
    expect(placeComboMenu(room(0, { ...phone, trigger: { ...phone.trigger, top: 200, bottom: 240 } })))
      .toMatchObject({ up: false, maxH: 438, footInset: false })
    // a modal sheet stands over the bars: its own frame is the floor
    expect(placeComboMenu(room(0, { ...phone, frameBottom: 844 })).up).toBe(false)
  })

  it('grows to its minimum width from the trigger\'s left and steps left to stay on screen', () => {
    expect(placeComboMenu(room(100))).toMatchObject({ width: 300, left: 700 })
    // a trigger near the right edge: 1024 − 12 − 300
    expect(placeComboMenu(room(100, { trigger: { left: 900, top: 100, bottom: 140, width: 100 } }))).toMatchObject({ width: 300, left: 712 })
  })
})
