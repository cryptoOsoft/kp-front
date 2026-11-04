import { describe, it, expect } from 'vitest'
import { NOTE_SIZE_SCALE, NOTE_WN, NOTE_W_PX, STACK_NOTE_MIN_EM, autoNoteBoxPx, autoNoteWN, autoNoteWPx, clampNoteWN, clampNoteWPx, noteScale, noteWN, noteWPx, stackNoteBoxPx, stackNoteShiftPx } from './notes'

describe('note sizing', () => {
  it('treats an absent size as normal', () => {
    expect(noteScale(undefined)).toBe(1)
    expect(noteScale('m')).toBe(1)
  })

  it('scales small down and large up', () => {
    expect(noteScale('s')).toBeLessThan(1)
    expect(noteScale('l')).toBeGreaterThan(1)
  })

  // the Python renderer hard-codes these same three numbers (kroki.py NOTE_SIZE_SCALE); if
  // they drift, a heading on screen prints as body text
  it('keeps the three steps the print side mirrors', () => {
    expect(NOTE_SIZE_SCALE).toEqual({ s: 0.8, m: 1, l: 1.45 })
  })
})

describe('note width fallback', () => {
  // every note is a wrapping box; one stored before notes had a width (or from the retired
  // «Einzeilig» shape) must still land on a sane box rather than rendering width-less
  it('falls back to the surface default when no width is stored', () => {
    expect(noteWN(undefined)).toBe(NOTE_WN.def)
    expect(noteWN(0)).toBe(NOTE_WN.def)
    expect(noteWPx(undefined)).toBe(NOTE_W_PX.def)
    expect(noteWPx(0)).toBe(NOTE_W_PX.def)
  })

  it('keeps a stored width', () => {
    expect(noteWN(0.35)).toBe(0.35)
    expect(noteWPx(300)).toBe(300)
  })
})

// A freshly placed note follows its text instead of sitting at the surface default — «Dach offen»
// is a small pill, a paragraph fills the box and wraps. Once dragged by hand it stops following
// (that flag lives on the note; here we only check the measurement + the clamps).
describe('auto width (a note that follows what is typed)', () => {
  it('grows with the text and never leaves the surface range', () => {
    const short = autoNoteWPx('Dach offen')
    const long = autoNoteWPx('Dach offen, zweiter Trupp über die Aussentreppe, Nachbargebäude geräumt')
    expect(short).toBeGreaterThanOrEqual(NOTE_W_PX.min)
    expect(short).toBeLessThan(NOTE_W_PX.def) // the whole point: no paragraph box for two words
    expect(long).toBeGreaterThan(short)
    expect(long).toBeLessThanOrEqual(NOTE_W_PX.max) // …and then it wraps, as it always did
  })

  it('is measured per line, so a manual break does not stack up', () => {
    expect(autoNoteWPx('Dach offen\nDach offen')).toBe(autoNoteWPx('Dach offen'))
  })

  it('follows the S/M/L step — the same text needs more room when set larger', () => {
    expect(autoNoteWPx('Dach offen', 'l')).toBeGreaterThan(autoNoteWPx('Dach offen', 's'))
  })

  it('an empty note starts at the minimum, not at the default', () => {
    expect(autoNoteWPx('')).toBe(NOTE_W_PX.min)
  })

  it('expresses the plan width as a fraction of the plan, clamped', () => {
    expect(autoNoteWN('Dach offen', 10, 1000)).toBeLessThan(NOTE_WN.def)
    expect(autoNoteWN('Dach offen', 10, 20)).toBe(NOTE_WN.max) // tiny plan → capped, not absurd
    expect(autoNoteWN('Dach offen', 10, 0)).toBe(NOTE_WN.def) // unmeasured plan → the default
  })
})

describe('width clamps', () => {
  it('stops a shaky drag making a sliver or a sheet-wide band on the plan', () => {
    expect(clampNoteWN(0.0001)).toBe(NOTE_WN.min)
    expect(clampNoteWN(5)).toBe(NOTE_WN.max)
    expect(clampNoteWN(0.25)).toBe(0.25)
  })

  it('does the same on the map, in whole screen px', () => {
    expect(clampNoteWPx(2)).toBe(NOTE_W_PX.min)
    expect(clampNoteWPx(9999)).toBe(NOTE_W_PX.max)
    expect(clampNoteWPx(220.4)).toBe(220)
  })

  it('seeds a default that survives its own clamp', () => {
    expect(clampNoteWN(NOTE_WN.def)).toBe(NOTE_WN.def)
    expect(clampNoteWPx(NOTE_W_PX.def)).toBe(NOTE_W_PX.def)
  })

  // the Gebäude stack (hill climb r1, 04.11.2026): a narrow storey column made a default note a
  // 34 px strip that broke every few letters
  it('never renders a stack note narrower than its words need, up to the Lage measure', () => {
    const long = 'Trupp Angriff Trupp Werkhof Personen Druck Keller Polizei'
    expect(stackNoteBoxPx(34, long, 12.5)).toBe(STACK_NOTE_MIN_EM * 12.5)
    expect(stackNoteBoxPx(34, 'Druck', 12.5)).toBe(autoNoteBoxPx('Druck', 12.5))
    expect(stackNoteBoxPx(400, long, 12.5)).toBe(400) // a stored wider box stands
  })

  // hill climb r4, 04.11.2026: a wide note near the stack's left edge ran its text under «EG»
  it('draws a stack note no further left than the stack edge, and moves nothing else', () => {
    expect(stackNoteShiftPx(60, 200)).toBe(40) // the phone shot: box 200 at centre 60 → starts at 0
    expect(stackNoteShiftPx(100, 200)).toBe(0) // already clear
    expect(stackNoteShiftPx(150, 80)).toBe(0) // fits inside the storey
  })
})
