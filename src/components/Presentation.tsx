// The Präsentationsmodus on screen (mock 8B, owner pick 05.11.2026; docs/presentation.md):
//   · PresentationPill – bottom centre, the floating family of the armed-tool pill:
//       presenting «BA Du präsentierst · 4 folgen · ◎◎◎ · Zeigen · Beenden»
//       invited    «BA Bastian präsentiert · Folgen» (a link holder gives a name first, once)
//       following  «BA Folgst Bastian · Zeigen · ✕»
//       detached   the pill itself becomes the chip «BA Wieder folgen»
//   · MapRings / BoardRings – the fading named rings, on the Karte (inside MapLibre's container,
//     so they pan with it) and on a plan (inside the board, in plan space)
//   · PresentCard – «Präsentieren · Starten» in the «Einsatz teilen» sheet, under the read link
// State and transport: workspace/usePresentation. Every word: appConfig.copy.presentation.

import { useContext, useEffect, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { MapRef } from 'react-map-gl/maplibre'
import { appConfig } from '../config/appConfig'
import { Icon } from '../lib/icons'
import { initials, personTone, type Ring } from '../lib/presentation'
import { PresentationContext, storedPresentName, type Presentation } from '../workspace/usePresentation'
import { Chip } from './Chip'

const ringLabel = (r: Ring) => (r.link ? `${r.name} · ${appConfig.copy.presentation.link}` : r.name)

function Avatar({ name, tone }: { name: string; tone: number }) {
  return <span className="present-av" data-tone={tone} aria-hidden>{initials(name)}</span>
}

/** The pill. Renders nothing while no presentation is running or this device is offline. */
export function PresentationPill({ p }: { p: Presentation }) {
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

  if (!p.available || !p.state) return null
  const s = p.state
  const presenter = s.presenter?.name ?? ''
  const zeigen = (
    <Chip selected={p.zeigen} className="present-zeigen" icon={<Icon id="tap" />}
      onClick={() => { setHintAt(p.zeigen ? 0 : Date.now()); p.toggleZeigen() }}>{C.zeigen}</Chip>
  )

  if (p.follow.kind === 'detached') {
    return (
      <div className="present-row" role="region" aria-label={C.pill}>
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
          {shown.map((x) => <Avatar key={x.client} name={x.name} tone={personTone(x.client, s.presenter?.client)} />)}
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
    body = <form className="present-ask" onSubmit={(e) => { e.preventDefault(); setAsking(false); p.followNow(name) }}>
      <label className="present-who"><b>{C.askName}</b>
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
    <div className="present-row" role="region" aria-label={C.pill}>
      {hint && <span className="present-hint" role="status">{C.hint}</span>}
      <div className="present-pill">{body}</div>
    </div>
  )
}

function RingMark({ r, presenter, style }: { r: Ring; presenter: string | null; style: CSSProperties }) {
  return (
    <span className="present-ring" data-tone={personTone(r.client, presenter)} style={style}>
      <span className="present-ring-dot" />
      <span className="present-ring-name">{ringLabel(r)}</span>
    </span>
  )
}

/** The rings on the Karte, drawn inside MapLibre's own container so they sit on the map. The
 *  points are projected in the map's own `move` (never while rendering), one frame late at most. */
export function MapRings({ mapRef, rings, presenter }: { mapRef: React.RefObject<MapRef | null>; rings: Ring[]; presenter: string | null }) {
  const [drawn, setDrawn] = useState<{ host: HTMLElement; at: Record<string, { x: number; y: number }> } | null>(null)
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !rings.length) return
    let raf = 0
    const project = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const at: Record<string, { x: number; y: number }> = {}
        for (const r of rings) if (r.at.lng != null && r.at.lat != null) at[r.key] = map.project([r.at.lng, r.at.lat])
        setDrawn({ host: map.getContainer(), at })
      })
    }
    project()
    map.on('move', project)
    map.on('resize', project)
    return () => { cancelAnimationFrame(raf); map.off('move', project); map.off('resize', project) }
  }, [mapRef, rings])
  if (!drawn || !rings.length) return null
  return createPortal(
    <div className="present-rings" aria-hidden>
      {rings.map((r) => {
        const pt = drawn.at[r.key]
        return pt ? <RingMark key={r.key} r={r} presenter={presenter} style={{ left: pt.x, top: pt.y }} /> : null
      })}
    </div>,
    drawn.host,
  )
}

/** The rings on a plan: children of the board, placed in plan space (`mapY` stacks storeys). */
export function BoardRings({ rings, presenter, mapY }: { rings: Ring[]; presenter: string | null; mapY: (floor: number | undefined, y: number) => number }) {
  if (!rings.length) return null
  return (
    <div className="present-rings" aria-hidden>
      {rings.map((r) => r.at.x == null || r.at.y == null ? null : (
        <RingMark key={r.key} r={r} presenter={presenter}
          style={{ left: `${r.at.x * 100}%`, top: `${mapY(r.at.floor ?? 0, r.at.y) * 100}%` }} />
      ))}
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
