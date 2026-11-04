import type { NoteSize } from '../types'

/**
 * One place for everything a free-text note needs to agree on across the four renderers that
 * draw it: the Lage map (MapMarkers), the Plan whiteboard (Whiteboard), the client-side PDF
 * (reportPdfDirect) and the server-side sheet (backend/app/kroki.py). The Python side mirrors
 * these numbers — see `NOTE_SIZE_SCALE` / `_note_lines` there; a change here needs a change
 * there, or paper stops matching the screen.
 *
 * A note is a one-line pill until it has a WIDTH, at which point it wraps and grows downwards.
 * Width is per-surface because the surfaces scale differently: `BoardAnno.wN` is a fraction of
 * the plan width (so it survives zoom and prints 1:1), `Entity.noteW` is screen px (map notes
 * are pinned to a constant screen size). Everything else lives on the shared `SymbolProps`.
 */

/** Multiplier on each surface's base text size. 'm' is the default when `noteSize` is absent. */
export const NOTE_SIZE_SCALE: Record<NoteSize, number> = { s: 0.8, m: 1, l: 1.45 }

/** Text size multiplier for a note, tolerating an absent / unknown value. */
export const noteScale = (size?: NoteSize) => NOTE_SIZE_SCALE[size ?? 'm'] ?? 1

/** Plan text-box width, as a fraction of the plan width. `def` is what "Zu Textfeld" seeds. */
export const NOTE_WN = { min: 0.06, max: 0.6, def: 0.2 } as const
/** Map text-box width, in screen px. */
export const NOTE_W_PX = { min: 90, max: 420, def: 220 } as const

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

/** Clamp a dragged plan width into [min,max] so a shaky drag can't make a sliver or a band. */
export const clampNoteWN = (w: number) => clamp(w, NOTE_WN.min, NOTE_WN.max)
/** Clamp a dragged map width (screen px) into [min,max]. */
export const clampNoteWPx = (w: number) => Math.round(clamp(w, NOTE_W_PX.min, NOTE_W_PX.max))

/**
 * EVERY note is a wrapping text box. There used to be a second "Einzeilig" shape that grew
 * sideways forever, and it was a steady source of trouble: it ran out of its own paper on the
 * map, it disagreed with the panel about line breaks, and it made "which mode am I in?" a
 * question you had to answer before typing. One shape, one behaviour.
 *
 * A stored note from before this (or from the Einzeilig era) simply has no width — it falls
 * back to the surface default here rather than needing a migration.
 */
export const noteWidth = (width: number | undefined, def: number) =>
  typeof width === 'number' && width > 0 ? width : def
/** Plan-space width of a note, falling back to the default. */
export const noteWN = (wN?: number) => noteWidth(wN, NOTE_WN.def)
/** Map-space (screen px) width of a note, falling back to the default. */
export const noteWPx = (w?: number) => noteWidth(w, NOTE_W_PX.def)

// --- auto width (a fresh note sizes itself to what is typed) ---------------------------------
//
// A note is placed mid-sentence and then TYPED. Seeding every one at the surface default meant a
// three-word Notiz sat in a box wide enough for a paragraph, and the operator had to drag it
// narrower to get the picture back — for the most common note there is. So a fresh note follows
// its text: it grows from the minimum until it hits the maximum, at which point it wraps as
// before. The moment the width is dragged by hand that decision stands (`noteAutoW` is cleared)
// and nothing resizes under the operator again.
//
// The measured result is still STORED as a plain width. That is deliberate: the client PDF and
// the server sheet (backend/app/kroki.py) lay a note out from its width, and neither can run a
// browser text measurement — so «auto» has to collapse to a number here, at edit time, or paper
// would stop matching the screen.

/** The note box's own chrome: `padding: .38em .7em` + a 1 px border on each side (see app.css
 *  `.note-pill` / `.wb-text-label`) — em-based, so it scales with the font like the text does. */
const NOTE_PAD_EM = 0.7 * 2
const NOTE_BORDER_PX = 2

let measureCtx: CanvasRenderingContext2D | null | undefined
let bodyFont: string | undefined

/** Width in px of the widest line of `text` at `fontPx`, in the note's own font. Falls back to a
 *  per-character estimate wherever there is no canvas (tests, SSR) — the caller clamps anyway. */
export function measureNoteTextPx(text: string, fontPx: number): number {
  const lines = text.split('\n')
  if (measureCtx === undefined) {
    measureCtx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
    bodyFont = typeof document === 'undefined' ? undefined
      : getComputedStyle(document.body).getPropertyValue('--body').trim() || undefined
  }
  if (!measureCtx) return Math.max(...lines.map((l) => l.length)) * fontPx * 0.55
  measureCtx.font = `600 ${fontPx}px ${bodyFont || 'system-ui, sans-serif'}`
  return Math.max(...lines.map((l) => measureCtx!.measureText(l).width))
}

/** Box width for a note that follows its text: the widest line + the box padding. Unclamped —
 *  the surface helpers below apply their own range. */
export function autoNoteBoxPx(text: string, fontPx: number): number {
  return Math.ceil(measureNoteTextPx(text, fontPx) + NOTE_PAD_EM * fontPx + NOTE_BORDER_PX)
}

/** Map note (screen px): the width this text wants, clamped to the map range. */
export const autoNoteWPx = (text: string, size?: NoteSize) =>
  clampNoteWPx(autoNoteBoxPx(text, 12 * noteScale(size)))

/** Plan note: the same, expressed as the fraction of the plan width the plan stores. `fontPx` and
 *  `planWPx` are the CURRENT rendered values, so the zoom scale cancels out of the ratio. */
export const autoNoteWN = (text: string, fontPx: number, planWPx: number) =>
  planWPx > 0 ? clampNoteWN(autoNoteBoxPx(text, fontPx) / planWPx) : NOTE_WN.def

// --- the Gebäude stack's floor ---------------------------------------------------------------
//
// On a module sheet a note's text AND its width both follow the paper (Whiteboard · txtBase is a
// fraction of the sheet width), so a stored `wN` is always the same number of words wide. The
// Gebäude stack sets its text at a constant size, like the Lage map does, but `wN` still means
// «a fraction of the board» — and the stack's board is one narrow storey column. A default note
// (0.2) came out ~34 px wide at 10 px text: a word every one to three letters, a yellow strip
// running down through three storeys (hill climb r1, 04.11.2026). So on the stack the rendered
// box never wraps narrower than its own text needs, up to the Lage note's default measure
// (`NOTE_W_PX.def` at the map's 12.5 px ≈ 17.6 em). Only the RENDERING widens: `wN` is stored
// and printed as it is, because the paper lays the note out from it.

/** The stack note's minimum measure, in em of its own text (≈ the Lage's default note). */
export const STACK_NOTE_MIN_EM = 16

/** Rendered px width of a note on the Gebäude stack: the stored width, widened to fit the
 *  text on one line where that is shorter than STACK_NOTE_MIN_EM, else to that measure. */
export const stackNoteBoxPx = (storedPx: number, text: string, fontPx: number) =>
  Math.max(storedPx, Math.min(autoNoteBoxPx(text, fontPx), STACK_NOTE_MIN_EM * fontPx))
