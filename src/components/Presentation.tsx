// The Präsentationsmodus on screen (mock 8B, owner pick 05.11.2026; docs/presentation.md):
//   · PresentationPill – bottom centre, the floating family of the armed-tool pill:
//       presenting «BA Du präsentierst · 4 folgen · ◎◎◎ · Zeigen · Beenden»
//       invited    «BA Bastian präsentiert · Folgen» (a link holder gives a name first, once)
//       following  «BA Folgst Bastian · Zeigen · ✕»
//       detached   the pill itself becomes the chip «BA Wieder folgen»
//   · MapRings / BoardRings / PageMarks – the fading named rings and lines, on the Karte (inside
//     MapLibre's container, so they pan with it), on a plan (inside the board, in plan space) and
//     on a Tafel form page (anchored to its rows, lib/presentAnchor – a form reflows per screen)
//   · EdgeArrows – a small named arrow at the edge for a ring or a line that stands outside what
//     this screen shows (owner pick 06.11.2026: «Fit + edge arrows»). Every mark carries
//     `data-present-mark`; its surface `data-present-host` – the arrows measure one against the
//     other, the same way on all three surfaces.
//   · PresentCard – «Präsentieren · Starten» in the «Einsatz teilen» sheet, under the read link
// State and transport: workspace/usePresentation. Every word: appConfig.copy.presentation.

import { useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { MapRef } from 'react-map-gl/maplibre'
import { appConfig } from '../config/appConfig'
import { PHONE_QUERY } from '../lib/breakpoints'
import { rowLift, type Box } from '../lib/floatRow'
import { Icon } from '../lib/icons'
import { anchorAt, anchorPoint } from '../lib/presentAnchor'
import { edgeArrow, initials, personTone, placeTags, type Rect, type Ring, type Stroke, type TagPlace } from '../lib/presentation'
import { useZeigen } from '../lib/useZeigen'
import { PresentationContext, storedPresentName, type BoardPresentation, type Presentation } from '../workspace/usePresentation'
import { Chip } from './Chip'

const ringLabel = (r: { name: string; link: boolean }) => (r.link ? `${r.name} · ${appConfig.copy.presentation.link}` : r.name)

/** A person's initials in their colour. A link holder's wears the chain badge (review
 *  06.11.2026): its name is self-chosen, so «Führungsunterstützung» from a forwarded link must
 *  not pass as the FU on the presenter's row – a tooltip says nothing on a touch screen. */
function Avatar({ name, tone, link = false }: { name: string; tone: number; link?: boolean }) {
  return (
    <span className="present-av" data-tone={tone} data-link={link || undefined} aria-hidden>
      {initials(name)}
      {link && <span className="present-av-link"><Icon id="link" /></span>}
    </span>
  )
}

/** What shares the bottom-centre slot with the pill, or stands in its row (09-whiteboard ·
 *  .wb-botleft: «Messungen», the Gebäude chip, the Tafel's page strip). */
const PILL_OBSTACLES = '.wb-botleft > *, .armed-pill-row, .sel-bar, .coord-read'

/**
 * Keeps the pill clear of the chips and pills of its row on a tablet or laptop (owner's laptop
 * screenshot 06.11.2026: «Du präsentierst» over «Messungen»): measured like the phone's floating
 * row (lib/floatRow · rowLift) – it rises only past what overlaps it sideways, so it stays on its
 * line wherever the line is free. On a phone it is the other way round: it stands on the bars'
 * baseline (08-toasts · @media --phone), it is an obstacle of the chip row (floatRow ·
 * OBSTACLE_SEL), and the chips rise above it.
 */
function usePillLift(on: boolean) {
  const rowRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const row = rowRef.current
    if (!on || !row) return
    let raf = 0
    const place = () => {
      row.style.setProperty('--present-lift', '0px')
      const pill = row.lastElementChild?.getBoundingClientRect()
      if (!pill || row.closest('.phone-tools') || window.matchMedia(PHONE_QUERY).matches) return
      const box = (r: DOMRect): Box => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })
      const obstacles = [...document.querySelectorAll(PILL_OBSTACLES)].map((el) => el.getBoundingClientRect()).filter((r) => r.width && r.height).map(box)
      row.style.setProperty('--present-lift', `${rowLift(box(pill), obstacles)}px`)
    }
    const soon = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(place) }
    place()
    // chips and pills come and go as DOM (attributes are not observed – the map moves its
    // markers by style every frame of a pan)
    const mo = new MutationObserver(soon)
    mo.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', soon)
    return () => { cancelAnimationFrame(raf); mo.disconnect(); window.removeEventListener('resize', soon) }
  }, [on])
  return rowRef
}

/** The pill (and the edge arrows). Renders nothing while no presentation is running or this
 *  device is offline. */
export function PresentationPill({ p }: { p: Presentation }) {
  return (
    <>
      <PillBody p={p} />
      <EdgeArrows on={p.marks > 0} />
    </>
  )
}

function PillBody({ p }: { p: Presentation }) {
  const C = appConfig.copy.presentation
  const [asking, setAsking] = useState(false)
  const [name, setName] = useState(storedPresentName)
  // the hint above the pill: for a few seconds after «Zeigen» is switched on, then out of the way
  const [hintAt, setHintAt] = useState(0)
  useEffect(() => {
    if (!hintAt) return
    const t = setTimeout(() => setHintAt(0), 4000)
    return () => clearTimeout(t)
  }, [hintAt])
  const hint = p.zeigen && hintAt > 0
  const shown = p.available && !!p.state
  const rowRef = usePillLift(shown)

  if (!shown || !p.state) return null
  const s = p.state
  const presenter = s.presenter?.name ?? ''
  const zeigen = (
    <Chip selected={p.zeigen} className="present-zeigen" icon={<Icon id="tap" />}
      onClick={() => { setHintAt(p.zeigen ? 0 : Date.now()); p.toggleZeigen() }}>{C.zeigen}</Chip>
  )

  if (p.follow.kind === 'detached') {
    return (
      <div ref={rowRef} className="present-row" role="region" aria-label={C.pill}>
        <button type="button" className="present-again" onClick={() => p.followNow()}>
          <Avatar name={presenter} tone={1} />{C.followAgain}
        </button>
      </div>
    )
  }

  let body
  if (p.follow.kind === 'presenting') {
    const n = s.participants.length
    const shown = s.participants.slice(0, 3)
    body = <>
      <Avatar name={presenter} tone={1} />
      <span className="present-who"><b>{C.youPresent}</b>
        <span>{n === 0 ? C.followersNone : n === 1 ? C.followersOne : C.followersMany.replace('{n}', String(n))}</span></span>
      {n > 0 && (
        <span className="present-avs" title={s.participants.map((x) => (x.link ? `${x.name} · ${C.link}` : x.name)).join(', ')}>
          {shown.map((x) => <Avatar key={x.client} name={x.name} link={x.link} tone={personTone(x.client, s.presenter?.client)} />)}
          {n > shown.length && <span className="present-av present-av-more" aria-hidden>+{n - shown.length}</span>}
        </span>
      )}
      {zeigen}
      <button type="button" className="ip-btn danger present-end" onClick={() => void p.end()}><Icon id="stop" />{C.end}</button>
    </>
  } else if (p.follow.kind === 'following') {
    body = <>
      <Avatar name={presenter} tone={1} />
      <span className="present-who"><b>{C.following}</b><span>{presenter}</span></span>
      {zeigen}
      <button type="button" className="ip-btn quiet present-x" onClick={p.leave} aria-label={C.leave} title={C.leave}><Icon id="close" /></button>
    </>
  } else if (asking) {
    // a link holder's name, once per device: it stands beside their pointer on every screen
    // phone: the card takes the row's width, the field the free part of it (owner's iPhone
    // screenshot 06.11.2026 – «Vorname Name» was cut in a 140px field)
    body = <form className="present-ask" onSubmit={(e) => { e.preventDefault(); setAsking(false); p.followNow(name) }}>
      <label className="present-who present-ask-field"><b>{C.askName}</b>
        <input className="present-name" value={name} maxLength={40} autoFocus placeholder={C.namePlaceholder}
          onChange={(e) => setName(e.target.value)} /></label>
      <button type="submit" className="ip-btn primary present-follow"><Icon id="eye" />{C.follow}</button>
    </form>
  } else {
    body = <>
      <Avatar name={presenter} tone={1} />
      {/* «{name} präsentiert»: the name bold, wherever the language puts it */}
      <span className="present-who present-who-line">{C.presents.split('{name}').flatMap((part, i) => (i ? [<b key={i}>{presenter}</b>, part] : [part]))}</span>
      <button type="button" className="ip-btn primary present-follow"
        onClick={() => { if (p.isLink && !storedPresentName()) setAsking(true); else p.followNow() }}>
        <Icon id="eye" />{C.follow}
      </button>
    </>
  }
  return (
    <div ref={rowRef} className="present-row" role="region" aria-label={C.pill} data-asking={asking || undefined}>
      {hint && <span className="present-hint" role="status">{C.hint}</span>}
      <div className="present-pill">{body}</div>
    </div>
  )
}

interface Arrow { key: string; label: string; tone: string; x: number; y: number; angle: number }

/** The part of a mark's surface this screen shows: the surface on screen, less a detail panel
 *  standing over it (beside it, or a bottom sheet). */
function shownRect(host: Element): Rect {
  const r = host.getBoundingClientRect()
  const out = { left: Math.max(0, r.left), top: Math.max(0, r.top), right: Math.min(window.innerWidth, r.right), bottom: Math.min(window.innerHeight, r.bottom) }
  const ctx = document.querySelector('.ctx')?.getBoundingClientRect()
  if (ctx && ctx.width && ctx.left < out.right && ctx.right > out.left && ctx.top < out.bottom && ctx.bottom > out.top) {
    if (ctx.width >= (out.right - out.left) * 0.9) out.bottom = Math.min(out.bottom, ctx.top)
    else out.right = Math.min(out.right, ctx.left)
  }
  return out
}

/** A small named arrow at the screen's edge for every ring or line tip outside what it shows.
 *  Measured every frame while there are marks at all (they live seconds); idle otherwise. */
function EdgeArrows({ on }: { on: boolean }) {
  const [arrows, setArrows] = useState<Arrow[]>([])
  useEffect(() => {
    if (!on) return
    let raf = 0, last = ''
    const tick = () => {
      const out: Arrow[] = []
      for (const el of document.querySelectorAll<HTMLElement>('[data-present-mark]')) {
        const host = el.closest('[data-present-host]')
        if (!host) continue
        const r = el.getBoundingClientRect()
        const a = edgeArrow({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, shownRect(host))
        if (a) out.push({ key: el.dataset.presentMark ?? '', label: el.dataset.label ?? '', tone: el.dataset.tone ?? '1', ...a })
      }
      const sig = out.map((a) => `${a.key}:${Math.round(a.x)}:${Math.round(a.y)}`).join('|')
      if (sig !== last) { last = sig; setArrows(out) }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); setArrows([]) }
  }, [on])
  if (!arrows.length) return null
  return createPortal(
    <div className="present-arrows" aria-hidden>
      {arrows.map((a) => (
        <span key={a.key} className="present-arrow" data-tone={a.tone} data-side={a.x > window.innerWidth / 2 ? 'left' : 'right'}
          style={{ left: a.x, top: a.y }}>
          <span className="present-arrow-head" style={{ transform: `rotate(${a.angle}deg)` }}><Icon id="arrow" /></span>
          <span className="present-arrow-name">{a.label}</span>
        </span>
      ))}
    </div>,
    document.body,
  )
}

function RingMark({ r, presenter, style, tag }: { r: Ring; presenter: string | null; style: CSSProperties; tag?: TagPlace }) {
  return (
    <span className="present-ring" data-tone={personTone(r.client, presenter)} style={style}
      data-present-mark={r.key} data-label={ringLabel(r)}>
      <span className="present-ring-dot" />
      <span className="present-ring-name" data-side={tag?.side} style={tag?.dy ? { transform: `translateY(${tag.dy}px)` } : undefined}>{ringLabel(r)}</span>
    </span>
  )
}

/** The rings' tags, kept off each other (lib/presentation · placeTags), from screen positions. */
function tagsFor(rings: Ring[], at: (r: Ring) => { x: number; y: number } | null, width?: number): Record<string, TagPlace> {
  const placed = rings.flatMap((r) => {
    const pt = at(r)
    return pt ? [{ key: r.key, ...pt, label: ringLabel(r) }] : []
  })
  return placeTags(placed, width)
}

/** A line drawn with «Zeigen»: the person's colour on a light halo, and its tip as a mark (the
 *  edge arrows follow the pen). `d` in the layer's own units (px, or 0..1 with `scaled`). */
function LineMark({ s, presenter, d, tip, scaled = false }: { s: Stroke; presenter: string | null; d: string; tip: { x: number | string; y: number | string } | null; scaled?: boolean }) {
  const tone = personTone(s.client, presenter)
  return (
    <>
      <svg className="present-line" data-tone={tone} data-done={s.line.done || undefined} key={`${s.key}:${s.line.done}`}
        viewBox={scaled ? '0 0 1 1' : undefined} preserveAspectRatio={scaled ? 'none' : undefined}>
        <path className="present-line-halo" d={d} />
        <path className="present-line-ink" d={d} />
      </svg>
      {tip && <span className="present-line-tip" data-tone={tone} data-done={s.line.done || undefined} style={{ left: tip.x, top: tip.y }}
        data-present-mark={s.key} data-label={ringLabel(s)} />}
    </>
  )
}

const pathOf = (pts: readonly { x: number; y: number }[]) => pts.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(4)} ${q.y.toFixed(4)}`).join('')

/** The rings and lines on the Karte, drawn inside MapLibre's own container so they sit on the
 *  map. The points are projected in the map's own `move` (never while rendering), one frame late
 *  at most. */
export function MapRings({ mapRef, rings, strokes = [], presenter }: { mapRef: React.RefObject<MapRef | null>; rings: Ring[]; strokes?: Stroke[]; presenter: string | null }) {
  const [drawn, setDrawn] = useState<{ host: HTMLElement; at: Record<string, { x: number; y: number }>; lines: Record<string, { x: number; y: number }[]>; w: number } | null>(null)
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || (!rings.length && !strokes.length)) return
    let raf = 0
    const project = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const at: Record<string, { x: number; y: number }> = {}
        for (const r of rings) if (r.at.lng != null && r.at.lat != null) at[r.key] = map.project([r.at.lng, r.at.lat])
        const lines: Record<string, { x: number; y: number }[]> = {}
        for (const s of strokes) lines[s.key] = s.line.points.map(([lng, lat]) => map.project([lng, lat]))
        setDrawn({ host: map.getContainer(), at, lines, w: map.getContainer().clientWidth })
      })
    }
    project()
    map.on('move', project)
    map.on('resize', project)
    return () => { cancelAnimationFrame(raf); map.off('move', project); map.off('resize', project) }
  }, [mapRef, rings, strokes])
  const tags = tagsFor(rings, (r) => drawn?.at[r.key] ?? null, drawn?.w)
  if (!drawn || (!rings.length && !strokes.length)) return null
  return createPortal(
    <div className="present-rings" data-present-host="" aria-hidden>
      {strokes.map((s) => {
        const pts = drawn.lines[s.key]
        return pts?.length ? <LineMark key={s.key} s={s} presenter={presenter} d={pathOf(pts)} tip={pts[pts.length - 1]} /> : null
      })}
      {rings.map((r) => {
        const pt = drawn.at[r.key]
        return pt ? <RingMark key={r.key} r={r} presenter={presenter} tag={tags[r.key]} style={{ left: pt.x, top: pt.y }} /> : null
      })}
    </div>,
    drawn.host,
  )
}

/** The rings and lines on a plan: children of the board, placed in plan space (`mapY` stacks
 *  storeys). */
export function BoardRings({ rings, strokes = [], presenter, mapY, size }: {
  rings: Ring[]
  strokes?: Stroke[]
  presenter: string | null
  mapY: (floor: number | undefined, y: number) => number
  /** the board's drawn size (px), so the tags can be kept apart on screen */
  size: { w: number; h: number }
}) {
  const at = (r: Ring) => (r.at.x == null || r.at.y == null ? null : { x: r.at.x * size.w, y: mapY(r.at.floor ?? 0, r.at.y) * size.h })
  const tags = tagsFor(rings, at)
  if (!rings.length && !strokes.length) return null
  return (
    <div className="present-rings" aria-hidden>
      {strokes.map((s) => {
        const pts = s.line.points.map(([x, y]) => ({ x, y: mapY(s.line.floor ?? 0, y) }))
        const last = pts[pts.length - 1]
        return <LineMark key={s.key} s={s} presenter={presenter} d={pathOf(pts)} scaled tip={last ? { x: `${last.x * 100}%`, y: `${last.y * 100}%` } : null} />
      })}
      {rings.map((r) => r.at.x == null || r.at.y == null ? null : (
        <RingMark key={r.key} r={r} presenter={presenter} tag={tags[r.key]}
          style={{ left: `${r.at.x * 100}%`, top: `${mapY(r.at.floor ?? 0, r.at.y) * 100}%` }} />
      ))}
    </div>
  )
}

/**
 * The rings and lines on a Tafel form page, and «Zeigen» on it (Whiteboard renders it beside
 * TafelFormPage). A form reflows from a laptop's two columns to a phone's one, so a place on it
 * is an anchor – the row or box under the finger and where in it (lib/presentAnchor); a line is
 * its first point's anchor and the rest as offsets in that element's widths, so it scales with
 * the row. The layer is the page's visible band (`top`, `bottom`: the form's own insets) and clips what is
 * scrolled away – those stand as edge arrows instead. Positions are read every frame while
 * there are marks (they live seconds), so they ride the page's own scroll.
 */
export function PageMarks({ p, top, bottom }: { p: BoardPresentation; top: number; bottom: string }) {
  const layerRef = useRef<HTMLDivElement>(null)
  const [root, setRoot] = useState<HTMLElement | null>(null)
  useEffect(() => { setRoot(layerRef.current?.parentElement?.querySelector<HTMLElement>('[data-testid="tafel-page"]') ?? null) }, [])
  const base = useRef<{ x: number; y: number; w: number } | null>(null)
  useZeigen(root, p.pointing, (x, y, target) => { if (root) p.onPagePoint(anchorAt(root, x, y, target)) }, {
    onDraw: {
      start: (x, y, target) => {
        if (!root) return
        const a = anchorAt(root, x, y, target)
        base.current = anchorPoint(root, a)
        p.pageDraw.start(a)
      },
      move: (x, y) => { const b = base.current; if (b && b.w) p.pageDraw.add([(x - b.x) / b.w, (y - b.y) / b.w]) },
      end: () => { base.current = null; p.pageDraw.end() },
    },
  })
  const rings = p.pageRings, strokes = p.pageStrokes
  const [drawn, setDrawn] = useState<{ at: Record<string, { x: number; y: number }>; lines: Record<string, { x: number; y: number }[]>; w: number } | null>(null)
  useEffect(() => {
    const layer = layerRef.current
    if (!root || !layer || (!rings.length && !strokes.length)) return
    let raf = 0, last = ''
    const tick = () => {
      const l = layer.getBoundingClientRect()
      const at: Record<string, { x: number; y: number }> = {}
      for (const r of rings) {
        const q = r.at.anchor && anchorPoint(root, r.at.anchor)
        if (q) at[r.key] = { x: q.x - l.left, y: q.y - l.top }
      }
      const lines: Record<string, { x: number; y: number }[]> = {}
      for (const s of strokes) {
        const q = s.line.anchor && anchorPoint(root, s.line.anchor)
        if (q) lines[s.key] = s.line.points.map(([dx, dy]) => ({ x: q.x - l.left + dx * q.w, y: q.y - l.top + dy * q.w }))
      }
      const sig = JSON.stringify([at, lines, l.width])
      if (sig !== last) { last = sig; setDrawn({ at, lines, w: l.width }) }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [root, rings, strokes])
  const tags = tagsFor(rings, (r) => drawn?.at[r.key] ?? null, drawn?.w)
  return (
    <div ref={layerRef} className="present-rings present-page-marks" data-present-host="" aria-hidden style={{ top, bottom }}>
      {drawn && strokes.map((s) => {
        const pts = drawn.lines[s.key]
        return pts?.length ? <LineMark key={s.key} s={s} presenter={p.presenter} d={pathOf(pts)} tip={pts[pts.length - 1]} /> : null
      })}
      {drawn && rings.map((r) => {
        const pt = drawn.at[r.key]
        return pt ? <RingMark key={r.key} r={r} presenter={p.presenter} tag={tags[r.key]} style={{ left: pt.x, top: pt.y }} /> : null
      })}
    </div>
  )
}

/** «Präsentieren» under the read link in «Einsatz teilen». Absent outside an Einsatz (the
 *  Rapport's inline «Weitergeben») and for a session that may not present. */
export function PresentCard() {
  const p = useContext(PresentationContext)
  const C = appConfig.copy.presentation
  if (!p) return null
  const s = p.state
  const mine = p.follow.kind === 'presenting'
  const line = mine ? C.runningMine : s ? C.runningOther.replace('{name}', s.presenter?.name ?? '') : C.lede
  return (
    <div className="present-card">
      <span className="present-card-glyph" aria-hidden><Icon id="present" /></span>
      <span className="present-card-text"><b>{C.title}</b><span>{p.canStart ? line : C.needsServer}</span></span>
      {mine
        ? <button type="button" className="ip-btn danger" onClick={() => void p.end()}><Icon id="stop" />{C.end}</button>
        : p.canStart && (
          <button type="button" className="ip-btn primary" onClick={() => void p.start()}>
            <Icon id="present" />{s ? C.takeOver : C.start}
          </button>
        )}
    </div>
  )
}
