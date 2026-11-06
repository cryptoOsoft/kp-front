// One placed entity on the Lage map (sweep A.8): the MapLibre <Marker>, its glyph by kind (Trupp
// dot/pill, Form, Notiz, Foto, Symbol) and the selected entity's grips. MapMarkers renders one per
// visible entity and keeps the gesture machinery (hold-drag, the pile fan, rotor/transform drags,
// the note editor's focus recipe); this file only draws and forwards presses to it.
// Not `React.memo`'d: the press and grip handlers close over the layer's live state, so they are
// new on every render of MapMarkers.

import { useEffect, useRef } from 'react'
import { Marker } from 'react-map-gl/maplibre'
import type { Entity, LngLat } from '../types'
import { appConfig } from '../config/appConfig'
import { thumbUrl } from '../lib/mediaUrl'
import { Icon } from '../lib/icons'
import { LockChip } from './LockChip'
import { TwinTeamPill } from './TwinTeamPill'
import { SHAPE_AXIS_GRIPS, SHAPE_MAX_PX, SHAPE_TWO_POINT, ShapeGlyph, rotationGripOffPx, shapeAspect } from '../lib/shapes'
import { DEFAULT_INK } from '../lib/lineStyle'
import { vehicleSymbolSvg } from '../lib/useVehiclePositions'
import { placardSvgForSymbol } from '../lib/placard'
import { TacticalSymbol, compositeSpec, compositePartGlyph, luefterVariant, isHubretter, HubretterBoom, floorBadge } from '../lib/symbolRender'
import { doneBadge } from '../lib/objectDone'
import { symbolCaptionText, symbolOriginText, isMeasuredSymbol } from '../lib/symbols'
import { softHyphenateText } from '../lib/symbolWrap'
import { markerZ } from '../lib/labelPass'
import { noteScale, noteWPx } from '../lib/notes'
import { pxPerM, symPx, shapePx, isRotatableSym, isVehicleSym, teamDockAnchor, teamStripPx, TEAM_DOT_PX, TEAM_PILL_CAP_PX } from '../lib/mapView'
import type { dockSlots } from '../lib/docking'
import type { MapMarkersProps } from './MapMarkers'

/** Which grip a shape/symbol transform drag started on (MapMarkers · shapeDown). */
export type ShapeGripMode = 'rotate' | 'resize' | 'width' | 'rotate2' | 'cage' | 'endA' | 'endB'

type EntityMarkerProps = Pick<MapMarkersProps,
  'entities' | 'byName' | 'selectedId' | 'zoom' | 'suppressedLabels' | 'draggable' | 'project' | 'unproject'
  | 'onDelete' | 'onRotate' | 'onShapeTransform' | 'onUnlockShape' | 'onNoteEdit' | 'trupps' | 'onShowTrupp'
  | 'onTeamTrupp' | 'onTeamNewTrupp' | 'onTeamMark' | 'onTeamRename' | 'onTeamClearTrail' | 'onTeamRemoveWithTrail'
  | 'hiddenTrails' | 'onToggleTrail' | 'teamLines' | 'onTeamUnlink' | 'onTeamUndock'>
  & Required<Pick<MapMarkersProps, 'groupSelectedIds' | 'networkEntityIds' | 'bearing' | 'symMul' | 'captionMode' | 'readOnly' | 'editNoteId'>> & {
  e: Entity
  /** this marker's offset while its pile is fanned open — and the hairline back to where it
   *  actually is, which is why nothing here is a lie the operator has to remember */
  spoke?: { dx: number; dy: number }
  /** the entity a hold-drag is moving, and the one the finger actually holds (they differ when a
   *  docked Trupp marker drags its host — see MapMarkers · pressMarker) */
  draggingId: string | null
  grabbedId: string | null
  /** the docking slots for the whole layer (lib/docking), and host id → the crews docked on it */
  dockedSlots: ReturnType<typeof dockSlots>
  dockedHosts: ReadonlyMap<string, string[]>
  /** a press on the marker body: tap selects, hold/drag moves (MapMarkers · pressMarker) */
  onPress: (ev: React.PointerEvent<HTMLDivElement>, e: Entity, dockDragStart: () => LngLat | null) => void
  rotDown: (clientX: number, clientY: number, el: HTMLElement, id: string) => void
  rotMove: (clientX: number, clientY: number) => void
  rotUp: () => void
  shapeDown: (clientX: number, clientY: number, el: HTMLElement, id: string, lat: number, mode: ShapeGripMode) => void
  shapeMove: (clientX: number, clientY: number) => void
  shapeUp: () => void
  /** the inline note editor and the team pill's rename field (MapMarkers owns their focus recipes) */
  focusNote: (el: HTMLTextAreaElement | null) => void
  focusTeam: (el: HTMLInputElement | null) => void
  noteChange: (ev: React.ChangeEvent<HTMLTextAreaElement>, id: string) => void
  noteBlur: (ev: React.FocusEvent<HTMLTextAreaElement>, id: string) => void
  noteKeyDown: (ev: React.KeyboardEvent<HTMLTextAreaElement>) => void
  noteDone: (id: string, text: string) => void
}

// A transform handle (rotate / resize) whose drag is bound with NATIVE pointer listeners that
// stopPropagation, so react-map-gl's marker-drag (a listener on the parent that fires on the same
// pointerdown) never starts alongside it. React's onPointerDown stopPropagation is delegated at
// the document root and runs too late — by then the marker is already dragging. Using the capture
// (setPointerCapture) keeps the move/up events on this element for the whole gesture.
function TransformHandle({ className, icon, title, onStart, onMove, onEnd, style }: {
  className: string; icon: string; title: string
  onStart: (clientX: number, clientY: number, el: HTMLElement) => void
  onMove: (clientX: number, clientY: number) => void
  onEnd: () => void
  style?: React.CSSProperties
}) {
  const ref = useRef<HTMLButtonElement>(null)
  // re-bind each render so the closures see the latest callbacks; it's a single element/listener
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const down = (e: PointerEvent) => {
      e.stopPropagation(); e.preventDefault()
      el.setPointerCapture(e.pointerId)
      onStart(e.clientX, e.clientY, el)
      const move = (ev: PointerEvent) => { ev.stopPropagation(); onMove(ev.clientX, ev.clientY) }
      const end = (ev: PointerEvent) => {
        ev.stopPropagation()
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', end)
        el.removeEventListener('pointercancel', end)
        onEnd()
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', end)
      el.addEventListener('pointercancel', end)
    }
    // MapLibre's Marker starts its drag on mousedown / touchstart (not just pointerdown), so block
    // those at the handle too — otherwise the marker still drags alongside the rotation on touch/stylus
    const block = (ev: Event) => ev.stopPropagation()
    el.addEventListener('pointerdown', down)
    el.addEventListener('mousedown', block)
    el.addEventListener('touchstart', block, { passive: true })
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('mousedown', block)
      el.removeEventListener('touchstart', block)
    }
  })
  // ⚠️ `data-holdaction` and no `title`: a transform grip's press-and-hold IS its gesture, so the
  // global hold-tooltip must not claim it (docs/ui-conventions.md · Touch vocabulary) — asking «what is this»
  // would otherwise start the very drag it is asking about. The name stays for screen readers.
  return <button ref={ref} className={className} style={style} aria-label={title} data-holdaction onClick={(e) => e.stopPropagation()}><Icon id={icon} /></button>
}

/** One entity's marker on the Lage map — see the file head. */
export function EntityMarker({
  e, entities, byName, selectedId, groupSelectedIds, networkEntityIds, zoom, bearing, symMul, captionMode, suppressedLabels,
  readOnly, draggable, editNoteId, project, unproject, spoke, draggingId, grabbedId, dockedSlots, dockedHosts, onPress,
  rotDown, rotMove, rotUp, shapeDown, shapeMove, shapeUp, focusNote, focusTeam, noteChange, noteBlur, noteKeyDown, noteDone,
  onDelete, onRotate, onShapeTransform, onUnlockShape, onNoteEdit, trupps, onShowTrupp, onTeamTrupp, onTeamNewTrupp,
  onTeamMark, onTeamRename, onTeamClearTrail, onTeamRemoveWithTrail, hiddenTrails, onToggleTrail, teamLines, onTeamUnlink,
  onTeamUndock,
}: EntityMarkerProps) {
  // the glyph's on-screen pixel size — drives the selection halo + handle ring so
  // they sit a fixed distance OUTSIDE the glyph at any zoom (small glyphs push the
  // handles out to a comfortable minimum via --hbox in CSS, big ones track the edge).
  // a shape's box is width × (width · aspect) — the halo/handle anchor (--gpx → --hbox)
  // takes the LARGER side so the ring always encloses the rectangle
  const shpW = e.kind === 'shape' ? shapePx(e.sizeM, e.coord[1], zoom, SHAPE_MAX_PX[e.shape ?? 'square']) : 0
  const shpH = e.kind === 'shape' ? shpW * shapeAspect(e.shape ?? 'square', e.aspect) : 0
  const gpx = e.kind === 'shape' ? Math.max(shpW, shpH)
    : e.kind === 'note' || e.kind === 'photo' || e.kind === 'team' ? 56
    : symPx(e.kind, e.coord[1], zoom, symMul)
  // Selected, multi-selected or mid-drag — the three states that mean «this one, now».
  // They share the halo AND the raised stacking: tapping a symbol that sits under another
  // one has to bring it out, or the panel opens for something the operator cannot see.
  const raised = selectedId === e.id || groupSelectedIds.includes(e.id) || (draggingId === e.id && grabbedId === e.id)
  // ⚠️ A Trupp marker is a STRIP — [dot][gap][name] — and centring the whole strip put half
  // the NAME's width between the dot and the point it states: the dot stood off its own
  // Trupp, and jumped sideways the moment the label pass dropped the name (a symbol dragged
  // past is enough), which read as the label coming off its dot and the dot moving on its
  // own. Anchored by its LEFT edge with half a dot taken back, the dot sits ON the
  // coordinate and the name simply hangs off it — appearing or disappearing moves nothing.
  // The selected pill does the same with its accent cap, so selecting doesn't shift it
  // either. Every other marker is centred on its glyph, as before.
  const teamStrip = e.kind === 'team'
  // Tactical stacking, decided in ONE place (lib/labelPass · MARKER_Z / markerZ). It has to
  // be set HERE, on the marker container: every MapLibre marker is its own stacking context
  // (it carries a transform), so a z-index inside the marker cannot lift it past a sibling.
  const z = markerZ(e.kind, { selected: raised, fanned: !!spoke })
  // A LOCKED shape is click-through, exactly like a locked drawn Fläche: its ink takes no
  // tap at all — placement and selection pass to whatever is beneath — and the centre
  // LockChip (re-enabling its own pointer events) is the only door back in.
  const lockedShape = e.kind === 'shape' && !!e.locked
  // …and a docked Trupp marker is DRAWN on its host's bottom-left corner instead of on its
  // own point (lib/mapView · teamDockAnchor). The stored coordinate is untouched — it is
  // still the drop point, still carried along when the host moves, and still what the
  // marker falls back to the moment the bond is let go.
  // ⚠️ …but NOT while it is being dragged: a marker in the hand follows the finger, or the
  // gesture that undocks it would draw nothing at all until the drop.
  const dockAnchor = draggingId === e.id ? null
    : teamDockAnchor(e, entities, dockedSlots, zoom, symMul, e.kind === 'team' ? teamStripPx(e.label ?? '') : undefined)
  const at = dockAnchor?.host.coord ?? e.coord
  /** …and the drag therefore STARTS from the slot, not from the stored point under it: the
   *  two are up to one dock radius apart, and grabbing a docked marker used to teleport it
   *  there before it moved a pixel. Seeded as the drag's first «where it is now». */
  const dockDragStart = (): LngLat | null => {
    if (!dockAnchor?.host.coord) return null
    const h = project(dockAnchor.host.coord)
    return (h ? unproject({ x: h.x + dockAnchor.dx, y: h.y + dockAnchor.dy }) : null) ?? null
  }
  return (
  <Marker
    longitude={at[0]}
    latitude={at[1]}
    anchor={teamStrip ? 'left' : 'center'}
    offset={teamStrip
      ? [(selectedId === e.id ? -TEAM_PILL_CAP_PX : -TEAM_DOT_PX / 2) + (dockAnchor?.dx ?? 0), dockAnchor?.dy ?? 0]
      : undefined}
    style={{ zIndex: z, ...(lockedShape ? { pointerEvents: 'none' as const } : null) }}
    draggable={false}
    // swallow the synthetic click so it can't reach the map (deselect / placement); selection
    // itself is reported by the hold gesture's onTap, which fires even on a slightly-moved touch
    onClick={(ev) => ev.originalEvent.stopPropagation()}
  >
    <div
      // `dragging` is its own class, not folded into `sel`: the two look the same but mean
      // different things, and only the drag should change the cursor (see .marker.dragging).
      // `marker-shape` takes the square touch pad off a Form: its hit area follows its own
      // box, per axis and turning with it (03-map.css · .shape-glyph::before).
      className={`marker${e.kind === 'note' ? ' marker-note' : ''}${e.kind === 'shape' ? ' marker-shape' : ''}${networkEntityIds.includes(e.id) ? ' network' : ''}${draggingId === e.id ? ' dragging' : ''}${spoke ? ' fanned' : ''} ${raised ? 'sel' : ''}`}
      style={{ ['--gpx' as string]: `${gpx}px`, ...(spoke ? { ['--fan-dx' as string]: `${spoke.dx}px`, ['--fan-dy' as string]: `${spoke.dy}px` } : null) }}
      // Tap selects; press-and-hold (touch) / press-and-drag (mouse) moves. A quick flick stays
      // a map pan/zoom. Not while editing a note's text (the input owns the pointer).
      // canDrag gates the MOVE only — tap-to-select still works in every tool. See useHoldToDrag.
      onPointerDown={!(e.kind === 'note' && editNoteId === e.id) && !lockedShape
        ? (ev) => onPress(ev, e, dockDragStart)
        : undefined}
    >
      {/* the hairline home. Drawn INSIDE the (already offset) marker, so it runs from the
          fanned glyph back to −offset = the true position, with a dot marking it. Purely
          decorative — pointer-events stay off it, or it would eat the tap it exists for. */}
      {spoke && (
        <svg className="fan-spoke" aria-hidden>
          <line x1="0" y1="0" x2={-spoke.dx} y2={-spoke.dy} />
          <circle cx={-spoke.dx} cy={-spoke.dy} r="2.5" />
        </svg>
      )}
      {/* ⚠️ …and never on a FORM (02.09.). A Form is selected to be worked on with its own
          precise grips — the ends, the two axes, the cage — and a 104px ring around a
          metres-true shape says nothing those grips do not already say while covering the
          ground they sit on. Its selection is the grips plus the bar. `note` and `team`
          have always been out for the same reason: they carry their own selected chrome. */}
      {raised && e.kind !== 'note' && e.kind !== 'team' && e.kind !== 'shape' && <div className="sel-halo" />}
      {networkEntityIds.includes(e.id) && selectedId !== e.id && <div className="network-halo" />}
      {e.kind === 'team' ? (() => {
        // resting: a compact team-coloured dot + name (low map clutter); selected: the
        // full pill (the plan board's resource chip, shared wb-resource CSS) with the
        // timestamp. A Trupp marked «raus» on the Atemschutz board dims here too.
        const isRaus = !!e.truppId && !!trupps?.some((t) => t.id === e.truppId && t.status === 'raus')
        const teamCol = e.color || appConfig.drawing.teamColors[0]
        // The Leitung this Trupp works (MapView · teamLineBadges): its ink and, where the
        // hose actually ends here, a coupling. ⚠️ Name only, no Leitung number (11.10.2026,
        // owner — the Gebäude chip's look): the hose's end tag says which Leitung. Absent
        // badge = the marker it always was.
        const badge = teamLines?.get(e.id)
        if (selectedId !== e.id) {
          // the pass could not fit the name without covering something that outranks it:
          // the coloured dot stays (a Trupp is always visible AS a Trupp), and the ink dot
          // says a name is there. One tap on the marker brings it back — a selected object
          // is exempt from suppression.
          const nameHidden = !!e.label && !!suppressedLabels?.has(`team:${e.id}`)
          return (
            <>
              <span className={`team-dot ${isRaus ? 'raus' : ''}${badge ? ' joined' : ''}`}
                style={{ '--team': teamCol, ...(badge ? { '--line': badge.color } : null) } as React.CSSProperties}>
                <i />
                {!nameHidden && <b>{e.label}</b>}
                {/* the storey (18.09.2026) — only where the marker HAS one, which on the
                    Karte means its body was baked off a Gebäude chip (lib/tacticalObjects
                    · bakeGeoBody). A Trupp dropped straight onto the map is on no storey,
                    and a «0» there would assert an EG nobody stated. Tied to the name's
                    visibility: the label pass books one box for [dot][gap][name]. */}
                {!nameHidden && e.floor != null && <em className="team-floor">{floorBadge(e.floor)}</em>}
              </span>
            </>
          )
        }
        // the pill AND its action bar are the ONE shared component (components/TwinTeamPill),
        // the very same one the two mirrors wear — so the Karte, the Plan and both twins
        // can never again answer differently for the same Trupp. The full bar only appears
        // where this surface may write (`draggable`); a read-only Karte keeps the two doors
        // that change nothing — the jump to the Trupp's card and this device's trail
        // toggle — and the bare pill when neither applies.
        // The marker container already owns the press, so no `hit` shell is passed.
        return (
          <TwinTeamPill
            name={e.label ?? ''} time={e.t} color={teamCol}
            raus={isRaus} truppId={e.truppId} floor={e.floor}
            trailCount={e.trail?.length ?? 0}
            trailShown={!hiddenTrails?.has(e.id)} trupps={trupps ?? []}
            line={badge}
            renameRef={focusTeam}
            acts={draggable ? {
              rename: onTeamRename && ((name) => onTeamRename(e.id, name)),
              pick: onTeamTrupp && ((truppId) => onTeamTrupp(e.id, truppId)),
              newTrupp: onTeamNewTrupp && (() => onTeamNewTrupp(e.id)),
              mark: onTeamMark && (() => onTeamMark(e.id)),
              clearTrail: () => onTeamClearTrail?.(e.id),
              remove: () => onDelete(e.id),
              removeWithTrail: onTeamRemoveWithTrail && (() => onTeamRemoveWithTrail(e.id)),
              showTrupp: onShowTrupp,
              toggleTrail: onToggleTrail && (() => onToggleTrail(e.id)),
              unlink: badge && onTeamUnlink && (() => onTeamUnlink(e.id, badge.lineId)),
              undock: e.dockedTo && onTeamUndock ? () => onTeamUndock(e.id) : undefined,
            } : readOnly && ((e.truppId && onShowTrupp) || (e.trail?.length && onToggleTrail)) ? {
              showTrupp: onShowTrupp,
              toggleTrail: onToggleTrail && (() => onToggleTrail(e.id)),
            } : undefined} />
        )
      })() : e.kind === 'shape' ? (
        <>
          <div
            className="shape-glyph"
            style={{ width: shpW, height: shpH, transform: `rotate(${(e.rotation ?? 0) - bearing}deg)` }}
          >
            <ShapeGlyph kind={e.shape ?? 'square'} color={e.color ?? DEFAULT_INK} stop={e.stop} aspect={e.aspect} carrier={e.carrier} reverse={e.reverse} strokeW={e.strokeW} boxPx={shpW} fillOpacity={e.fillOpacity} hatch={e.hatch} sharpCorners={e.sharpCorners} />
          </div>
          {/* the click-through ink's only tap target — outside the rotated box, so the
              chip stays upright (drawings' twin: MapView · lockChips) */}
          {lockedShape && onUnlockShape && (
            <span className="shape-lock-anchor">
              <LockChip onUnlock={() => onUnlockShape(e.id)} />
            </span>
          )}
        </>
      ) : e.kind === 'note' ? (() => {
        // every note is a wrapping box; a stored note with no width falls back to the
        // default. Font size = the fixed 12px base × the size-slider step.
        // Colour applies in BOTH looks. It used to be `notePlain && color`, so on the
        // default pill the whole colour row was decoration: you picked red, nothing
        // changed, and the swatch stayed selected to prove it had been understood.
        // Plain = coloured ink (there is nothing else to colour); pill = tinted paper,
        // mixed in CSS so it holds up in day and night.
        const tinted = !e.notePlain && !!e.color
        const cls = (base: string) => `${base} box${e.notePlain ? ' plain' : ''}${tinted ? ' tinted' : ''}`
        const nStyle = {
          fontSize: 12 * noteScale(e.noteSize), width: noteWPx(e.noteW),
          ...(e.color ? (e.notePlain ? { color: e.color } : { '--note-tint': e.color }) : null),
        } as React.CSSProperties
        return editNoteId === e.id ? (
          <textarea
            className={cls('note-pill note-pill-input')}
            ref={focusNote}
            rows={1}
            style={nStyle}
            value={e.label ?? ''}
            placeholder={appConfig.copy.whiteboard.textPlaceholder}
            onPointerDown={(ev) => ev.stopPropagation()}
            onChange={(ev) => noteChange(ev, e.id)}
            onBlur={(ev) => noteBlur(ev, e.id)}
            // Enter makes a new line — the ✓, Esc and clicking away are the way out (noteKeyDown).
            onKeyDown={noteKeyDown}
          />
        ) : (
          <div className={cls('note-pill')} style={nStyle} onDoubleClick={(ev) => { ev.stopPropagation(); onNoteEdit?.(e.id) }}>
            {e.label || <span className="note-pill-ph">{appConfig.copy.whiteboard.text}</span>}
          </div>
        )
      })() : e.kind === 'photo' ? (
        // 56 px on the map — the small copy, for the same reason as the Verlauf chip
        <div className="ts photo">
          {/* the lens's bearing from the EXIF (lib/photoGeo), as a view cone from the spot
              it was taken on — ground-pinned, so it turns with the map like a vehicle */}
          {e.heading != null && (
            <svg className="photo-cone" viewBox="0 0 120 120" aria-hidden
              style={{ transform: `translate(-50%, -50%) rotate(${e.heading - bearing}deg)` }}>
              <path d="M60 60 L28.4 11.4 A58 58 0 0 1 91.6 11.4 Z" />
            </svg>
          )}
          <img src={thumbUrl(e.photoUrl)} alt="" decoding="async" />
        </div>
      ) : (() => {
        // the generic vehicle bakes its name + heading into the glyph (text stays
        // upright); every other symbol uses its library/static svg
        // A live GPS vehicle is `kind: 'vehicle'` (not a placed 'symbol'), so isVehicleSym
        // said no and it fell through to the generic branch: the chip rotated the ALREADY
        // rotated glyph, which turned the body twice and tilted the baked-in name with it.
        // It is a vehicle for rendering purposes — same treatment as the placed one.
        const veh = isVehicleSym(e) || (e.kind === 'vehicle' && !!e.symbolSvg)
        const comp = compositeSpec(e.symbol)
        const hub = isHubretter(e.symbol)
        // ONLY directional symbols (a rotation handle, or a vehicle/live unit) stay pinned to
        // the ground via − bearing; plain markers (hydrants, KP, command posts, lifts…) stay
        // UPRIGHT at every bearing ("always north"), so they never look crooked on a turned map.
        // The Hubretter body is rotatable (`rotation`), INDEPENDENT of the boom (`rotation2`).
        // ⚠️ A shared PERSON position is live but has no heading — nobody reports which way
        // they are facing, and the glyph is a disc with their initials in it. It was caught
        // by `e.live` and tilted with the map like a truck, which turns the one thing on it
        // that has to be read at a glance upside down. A person is «always north».
        const directional = (veh || !!e.live || isRotatableSym(e)) && e.kind !== 'person'
        const rot = (e.rotation ?? 0) - (directional ? bearing : 0)
        // rebuilt at the bearing-compensated angle; `directed` so a vehicle that has never
        // moved doesn't gain a heading arrow it never reported
        const svg = veh ? vehicleSymbolSvg(e.label ?? '', rot, e.directed ?? true)
          : comp ? (byName[comp.base] ?? '')
          : hub ? (byName[appConfig.symbols.vehicleName] ?? '')   // plain body; the boom is drawn separately
          : (placardSvgForSymbol(e.symbol, e.fields) ?? e.symbolSvg ?? (e.symbol ? byName[luefterVariant(e.symbol, e.extract)!] ?? byName[e.symbol] ?? '' : ''))
        // a composite stacks its part (Grosslüfter fan / Drehleiter ladder) as a separately-
        // rotatable overlay aimed by rotation2; the Lüfter's extract (Absaugen) swaps to the
        // reversed-arrow fan glyph. Ladder scales 1:1 over the body; the fan reads at 60%.
        const overlay = comp ? { svg: byName[compositePartGlyph(comp, e.extract)] ?? byName[comp.part] ?? '', rotation: (e.rotation2 ?? 0) - bearing, scale: comp.scale, offsetX: comp.offsetX } : undefined
        // Hubretter boom: a variable-reach articulated arm drawn behind the body, ground-scaled in
        // metres (reachM) and aimed by rotation2 (−bearing). The cage tip carries the drag handle.
        const boomPx = hub ? Math.max(24, Math.min(900, (e.reachM ?? 18) * pxPerM(e.coord[1], zoom))) : 0
        // The caption is decided by the ONE label pass, not by a zoom threshold: it is
        // printed whole where it fits and replaced by a dot where it does not. Routed
        // through softHyphenateText because a caption is a FIELD VALUE, not a symbol name
        // — «Salpetersäure, rauchend» has to break at the compound seam, not by syllable.
        const capText = symbolCaptionText(e, captionMode)
        // …and the vehicle's Herkunft, the box's grey last line: booked with it (one box, one key)
        const origin = symbolOriginText(e, captionMode)
        const capHidden = !!(capText || origin) && !!suppressedLabels?.has(`cap:${e.id}`)
        // the vehicle glyph rotates its body internally, so the chip must NOT also rotate;
        // every other symbol (incl. a composite body) applies its stored rotation to the chip.
        return (
          <>
            <TacticalSymbol
              svg={svg}
              sizePx={symPx(e.kind, e.coord[1], zoom, symMul)}
              rotation={veh ? 0 : rot}
              overlay={overlay}
              floor={e.floor}
              floorFrom={e.floorFrom}
              floorTo={e.floorTo}
              spread={e.spread}
              count={e.count}
              // the bond seen from the HOST's side (lib/docking): the same `link` glyph the
              // Trupp marker wears, on the one free corner of the tile — storey top-right,
              // count bottom-right, the docked Trupps themselves bottom-left. The crews'
              // names ride as its title; the words «bei «…»» stay off the map.
              docked={dockedHosts.get(e.id)?.join(' · ')}
              // «Gelöscht / erledigt»: grey glyph + the time, the same rule the Plan draws
              done={doneBadge(e)}
              // a vehicle's NAME is already in the glyph — symbolCaptionText drops it and
              // keeps the rest (Fahrer, eigene Felder, Notizen), which only 'Alle' prints
              caption={capHidden || !capText ? null : softHyphenateText(capText)}
              origin={capHidden ? null : origin}
              measured={isMeasuredSymbol(e) ? e : undefined}
            />
            {/* boom AFTER the body → paints on top (mounted on the turntable / roof) */}
            {hub && <HubretterBoom lengthPx={boomPx} deg={(e.rotation2 ?? 0) - bearing} />}
          </>
        )
      })()}
      {/* ⚠️ A selected Notiz carries NO on-canvas grips at all. The inline ✕ and the pen/⚙
          row went on 29.08. (the panel opens on the tap itself — see selectEntity); the
          right-edge width grip followed on 05.09. A note sizes itself to what is typed
          (`noteAutoW` · lib/notes · autoNoteWPx), so the grip only ever un-did that — and it
          sat where a finger reaches for the note itself, on the one object whose everyday
          gesture is «move it out of the way». Width is not a decision the Kroki needs from
          anybody. The body still moves by hold-drag, and double-tap stays the desktop
          shortcut into inline edit. */}
      {/* ✓ Fertig — box mode only, where Enter no longer commits */}
      {e.kind === 'note' && editNoteId === e.id && (
        <button
          className="note-done"
          title={appConfig.copy.notes.done}
          aria-label={appConfig.copy.notes.done}
          // pointerdown, not click: the textarea's blur unmounts this button first
          onPointerDown={(ev) => { ev.preventDefault(); ev.stopPropagation(); noteDone(e.id, e.label ?? '') }}
        >
          <Icon id="check" />
        </button>
      )}
      {/* Rotation is for live VEHICLES (a truck faces somewhere). A person dot carries no
          heading, so a rotate handle on it would invite orienting a fact that has no
          orientation. */}
      {selectedId === e.id && e.live && e.kind !== 'person' && onRotate && (
        <TransformHandle
          className="handle marker-rotate"
          icon="rotate"
          title={appConfig.copy.contextPanel.rotateHint}
          onStart={(x, y, el) => rotDown(x, y, el, e.id)}
          onMove={rotMove}
          onEnd={rotUp}
        />
      )}
      {selectedId === e.id && e.kind === 'shape' && !e.locked && onShapeTransform && (() => {
        // rotor rotates with the shape so the handles stay attached to it: a tethered
        // knob (top) for rotation, a corner grip for resize. The CSS anchors assume a
        // SQUARE --hbox; a stretched shape overrides them inline so the knob rides the
        // real top edge and the grip the real corner (same floors as .marker.sel --hbox).
        const hbW = Math.max(shpW, 56), hbH = Math.max(shpH, 56)
        const axisGrips = SHAPE_AXIS_GRIPS[e.shape ?? 'square']
        // ── A Rotation is its two ENDS, and nothing else ──────────────────────────────
        // Each end sets the run's length AND its bearing, and the width follows the run —
        // so there is no rotate knob and no size grip left to draw. They live in the rotor,
        // which already turns with the shape, so «along the run» is simply left and right.
        // The grips float past the caps (rotationGripOffPx) on a short tether, or they
        // would cover both the loop's own end and whatever the end was dropped on.
        if (SHAPE_TWO_POINT[e.shape ?? 'square']) {
          const runPx = Math.max(0, shpW - shpH)
          const off = rotationGripOffPx(shpH)
          return (
            <div className="shape-rotor" style={{ transform: `rotate(${(e.rotation ?? 0) - bearing}deg)` }}>
              {([['endA', -1], ['endB', 1]] as const).map(([which, sign]) => (
                <TransformHandle
                  key={which}
                  className="handle shape-end"
                  icon="resize-h"
                  style={{ left: `calc(50% + ${sign * (runPx / 2 + off)}px)`, top: '50%' }}
                  title={appConfig.copy.shapes.endHint}
                  onStart={(x, y, el) => shapeDown(x, y, el, e.id, e.coord[1], which)}
                  onMove={shapeMove}
                  onEnd={shapeUp}
                />
              ))}
            </div>
          )
        }
        // ── No rotate knob on a Form (02.09.) ── turning the whole object is the fixed
        // SelectionBar's ⟳ (a drag dials, a tap arms the surface), and a second rotor on the
        // shape's own edge said the same thing twice. Only its SIZE grips stay: they answer
        // «how big», which the bar cannot. The rotor wrapper remains so the grips ride the
        // shape's rotation; directional symbols keep their knob (they are not on the bar).
        return (
        <div className="shape-rotor" style={{ transform: `rotate(${(e.rotation ?? 0) - bearing}deg)` }}>
          {/* ── ONE GRIP PER AXIS on a Rechteck and a Rotation (01.09.) ──
              Both handles used to be corner grips wearing the same «resize» glyph, so
              nothing on screen said which of the two sizes a drag would change. Now the ↔
              sits on the right edge and moves the x-axis, the ↕ sits on the bottom edge and
              moves the y-axis: the grip stands ON the axis it controls and its arrows point
              the way it goes. The Rauch keeps the diagonal corner — a plume is pulled into
              shape, not given a width and a height (lib/shapes · SHAPE_AXIS_GRIPS). */}
          {axisGrips ? <>
            <TransformHandle
              className="handle shape-resize shape-axis-x"
              icon="resize-h"
              style={{ left: `calc(50% + ${hbW / 2 + 3}px)`, top: '50%' }}
              title={appConfig.copy.shapes.boxWidthHint}
              onStart={(x, y, el) => shapeDown(x, y, el, e.id, e.coord[1], 'resize')}
              onMove={shapeMove}
              onEnd={shapeUp}
            />
            <TransformHandle
              className="handle shape-width shape-axis-y"
              icon="resize-v"
              style={{ left: '50%', top: `calc(50% + ${hbH / 2 + 3}px)` }}
              title={appConfig.copy.shapes.boxHeightHint}
              onStart={(x, y, el) => shapeDown(x, y, el, e.id, e.coord[1], 'width')}
              onMove={shapeMove}
              onEnd={shapeUp}
            />
          </> : (
            <TransformHandle
              className="handle shape-resize"
              icon="resize"
              style={{ left: `calc(50% + ${hbW / 2 + 3}px)`, top: `calc(50% + ${hbH / 2 + 3}px)` }}
              title={appConfig.copy.shapes.resizeHint}
              onStart={(x, y, el) => shapeDown(x, y, el, e.id, e.coord[1], 'resize')}
              onMove={shapeMove}
              onEnd={shapeUp}
            />
          )}
        </div>
        )
      })()}
      {selectedId === e.id && isRotatableSym(e) && !compositeSpec(e.symbol) && onShapeTransform && (
        // directional symbol: rotate-only handle (no resize — symbols keep their
        // real-world scale). Tethered knob rotates with the symbol.
        <div className="shape-rotor" style={{ transform: `rotate(${(e.rotation ?? 0) - bearing}deg)` }}>
          <span className="shape-stem" />
          <TransformHandle
            className="handle shape-rotate"
            icon="rotate"
            title={appConfig.copy.shapes.rotate}
            onStart={(x, y, el) => shapeDown(x, y, el, e.id, e.coord[1], 'rotate')}
            onMove={shapeMove}
            onEnd={shapeUp}
          />
        </div>
      )}
      {selectedId === e.id && !!compositeSpec(e.symbol) && onShapeTransform && (
        // composite (Grosslüfter / Drehleiter / Hubretter): TWO tethered rotors — a short blue
        // knob aims the vehicle body, a longer amber knob aims the part (fan / ladder / boom).
        // Each rotor rotates with its own part (− bearing) so the handles stay attached as the
        // map turns.
        <>
          <div className="shape-rotor" style={{ transform: `rotate(${(e.rotation ?? 0) - bearing}deg)` }}>
            <span className="shape-stem" />
            <TransformHandle
              className="handle shape-rotate"
              icon="rotate"
              title={appConfig.copy.contextPanel.rotationVehicle}
              onStart={(x, y, el) => shapeDown(x, y, el, e.id, e.coord[1], 'rotate')}
              onMove={shapeMove}
              onEnd={shapeUp}
            />
          </div>
          <div className="shape-rotor shape-rotor-fan" style={{ transform: `rotate(${(e.rotation2 ?? 0) - bearing}deg)` }}>
            <span className="shape-stem" />
            <TransformHandle
              className="handle shape-rotate shape-rotate-fan"
              icon="rotate"
              title={appConfig.copy.contextPanel[compositeSpec(e.symbol)!.partLabel]}
              onStart={(x, y, el) => shapeDown(x, y, el, e.id, e.coord[1], 'rotate2')}
              onMove={shapeMove}
              onEnd={shapeUp}
            />
          </div>
        </>
      )}
      {selectedId === e.id && isHubretter(e.symbol) && onShapeTransform && (() => {
        // Hubretter cage tip: ONE handle at the boom end. Dragging it sets both the boom bearing
        // (rotation2) and the reach (reachM). Positioned at the tip = centre + reach·(bearing).
        const rad = (((e.rotation2 ?? 0) - bearing) * Math.PI) / 180
        const len = Math.max(24, Math.min(900, (e.reachM ?? 18) * pxPerM(e.coord[1], zoom)))
        return (
          <div className="cage-handle" style={{ left: `calc(50% + ${(Math.cos(rad) * len).toFixed(1)}px)`, top: `calc(50% + ${(Math.sin(rad) * len).toFixed(1)}px)` }}>
            <TransformHandle
              className="handle shape-rotate shape-cage"
              icon="move"
              title={appConfig.copy.shapes.moveHint}
              onStart={(x, y, el) => shapeDown(x, y, el, e.id, e.coord[1], 'cage')}
              onMove={shapeMove}
              onEnd={shapeUp}
            />
          </div>
        )
      })()}
    </div>
  </Marker>
  )
}
