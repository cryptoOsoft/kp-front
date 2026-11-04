import { forkDims } from './lineAttachments'
import { appConfig } from '../config/appConfig'
import type { LineTone } from './truppLines'
import { endTagText } from './endTagSpots'

// FKS hose-line decorations shared by the Lage map (DOM markers over MapLibre) and the Plan
// whiteboard (board-px overlay), so a Druckleitung reads the same on both surfaces.

/** Localized labels for the FKS device letters — for the editor + tooltips. A getter so the
 *  boot-resolved locale applies (never capture appConfig.copy at module load). */
export const CONTENT_LABELS: Record<string, string> = new Proxy(
  {},
  {
    get: (_t, letter: string) => {
      // widened on read: a letter a newer build drew (a passenger) shows as itself
      const labels: Partial<Record<string, string>> = appConfig.copy.lineDecor
      return labels[letter] ?? letter
    },
  },
)

/** A friendly name for a hose line in lists (connected-lines, focus targets) — its FKS
 *  descriptor (Leitung Nr. / content letter) instead of the raw internal id. */
export function lineLabel(a: { label?: string; lineNo?: number; content?: string }): string {
  if (a.label) return a.label
  if (a.lineNo != null) return appConfig.copy.drawingEditor.lineLabelNo.replace('{n}', String(a.lineNo))
  if (a.content) return CONTENT_LABELS[a.content]
  return appConfig.copy.drawingEditor.line
}

/** A line carries any FKS decoration? (gates the per-line decoration render on both surfaces).
 *  An Atemschutz link counts: a hose picked for a Trupp before it was numbered still has a tag
 *  to show. */
export function hasLineDecor(a: { teilstueck?: boolean; content?: string; lineNo?: number; floorTag?: number; truppId?: string }): boolean {
  return !!a.teilstueck || !!a.content || a.lineNo != null || a.floorTag != null || !!a.truppId
}

/** The forward "E"-fork Teilstück coupling: a perpendicular spine at the line tip with three
 *  short prongs pointing the way the line travels. Drawn in a tip-centred viewBox and rotated
 *  by the line's SCREEN angle (deg), so the spine pins to the end point at any map bearing. */
export function TeilstueckFork({ angleDeg, color, width = 5 }: { angleDeg: number; color: string; width?: number }) {
  const { half, prong } = forkDims(width) // spine half-height + forward (+x) prong length
  const sw = Math.max(2, width * 0.9)
  const box = (half + prong) * 2 + 8
  return (
    <svg className="line-fork" width={box} height={box} viewBox={`${-box / 2} ${-box / 2} ${box} ${box}`} aria-hidden style={{ overflow: 'visible' }}>
      <g transform={`rotate(${angleDeg})`} stroke={color} strokeWidth={sw} strokeLinecap="round" fill="none">
        <path d={`M0,${-half} L0,${half}`} />
        <path d={`M0,${-half} L${prong},${-half}`} />
        <path d={`M0,0 L${prong},0`} />
        <path d={`M0,${half} L${prong},${half}`} />
      </g>
    </svg>
  )
}

/** One compact boxed tag at the line end combining the Druckleitung number, FKS content letter,
 *  storey badge and — when an Atemschutz-Trupp works this Leitung — its leader (e.g.
 *  "1 · S · +2 · Müller H."). Keeps the tip uncluttered. Null when empty.
 *
 *  `tone` colours the BOX, never the line: 'warn'/'crit' mirror the Atemschutz contact clock,
 *  'muted' is the record left behind by a Trupp that is out. The tone owns the box colour when
 *  set, so the alarm reads even on a line drawn in some arbitrary colour. */
export function EndTag({ lineNo, content, floorTag, trupp, tone = 'idle', color, oneLine }: {
  lineNo?: number
  content?: string
  floorTag?: number
  /** the Trupp on this Leitung, as its tag text (lib/truppLines · truppTagText — the full name) */
  trupp?: string
  tone?: LineTone
  color: string
  /** Lay the tag out as ONE strip instead of stacking the Trupp under the Leitung's own facts.
   *  `inline-grid` makes each text run its own row, which is the compact tag the map wants over
   *  a live hose — but `kroki.py` joins every part with « · » on a single line, so the print
   *  preview has to say the same thing in the same shape. */
  oneLine?: boolean
}) {
  const facts = endTagText({ lineNo, content, floorTag })
  if (!facts && !trupp) return null
  // tone colours come from the theme tokens (never a frozen rgba), so day/night both read right
  const ink = tone === 'crit' ? 'var(--red)' : tone === 'warn' ? 'var(--amber)' : tone === 'muted' ? 'var(--ink-dim)' : color
  // The Leitung's own facts (number, Inhalt, Stockwerk) stay as they are — the hose is still that
  // hose. Only the NAME is the thing that stopped being true, so on 'muted' (the Trupp is out) it
  // carries the dim + strike its map marker already wears (.team-dot.raus), instead of the whole
  // tag going quiet and taking the Leitung number with it.
  return (
    // the letters are the line's colour taken 30 % toward black: on the near-white plate the
    // plain hue was under AA for blue (4.4:1) and far under for amber; the ring keeps the hue
    <span className={`line-end-tag tone-${tone}${oneLine ? ' one-line' : ''}`} style={{ color: `color-mix(in srgb, ${ink} 70%, #000)`, borderColor: ink }}>
      {facts}
      {trupp && <>{facts ? ' · ' : ''}<span className="line-end-trupp">{trupp}</span></>}
    </span>
  )
}
