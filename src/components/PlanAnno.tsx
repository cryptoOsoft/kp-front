// One annotation on the Plan that is not ink — a symbol, a Form, a Notiz or a Trupp chip — with
// the grips it wears while selected. Lifted out of the Whiteboard's `.map` (sweep A.8, 25.10.2026);
// the Whiteboard renders one per anno (and per storey it covers on the Gebäude stack) and owns
// every state this reads. Lage ↔ Plan parity: the Karte's twin is MapMarkers (docs/tactical-objects.md).

import type React from 'react'
import type { BoardAnno, BoardTool, CaptionMode, Trupp } from '../types'
import type { SymbolsApi } from '../lib/useSymbols'
import { Icon } from '../lib/icons'
import { appConfig } from '../config/appConfig'
import { DEFAULT_INK } from '../lib/lineStyle'
import { lineLabel } from '../lib/lineDecor'
import { teamNoTaken } from '../lib/placedTrupps'
import { fillTemplate } from '../lib/format'
import { toast } from '../lib/ui'
import { TacticalSymbol, compositeSpec, compositePartGlyph, luefterVariant, isHubretter, HubretterBoom, floorBadge } from '../lib/symbolRender'
import { doneBadge } from '../lib/objectDone'
import { vehicleSymbolSvg } from '../lib/useVehiclePositions'
import { placardSvgForSymbol } from '../lib/placard'
import { symbolCaptionText, isMeasuredSymbol, isRotatableSym, isVehicleSym } from '../lib/symbols'
import { softHyphenateText } from '../lib/symbolWrap'
import { TwinTeamPill } from './TwinTeamPill'
import { ShapeGlyph, SHAPE_AXIS_GRIPS, SHAPE_DEFS, SHAPE_TWO_POINT, rotationGripOffPx, shapeAspect } from '../lib/shapes'
import { TEAM_DOT_PX, TEAM_PILL_CAP_PX } from '../lib/mapView'
import { noteScale, autoNoteWN, noteWN, stackNoteBoxPx, stackNoteShiftPx } from '../lib/notes'
import { floorLabel } from '../lib/whiteboard'
import type { useBoardDoc } from './useBoardDoc'
import type { useWbChipDrag } from './useWbChipDrag'
import type { useWbRotor } from './useWbRotor'

const TEAM_COLORS = appConfig.drawing.teamColors // distinct accent per team (cycled)
// a composite symbol (Grosslüfter vehicle+fan, Drehleiter/Hubretter body+ladder/boom): a two-handle
// rotor + two-layer render, like the map. Returns the spec (base/part/scale/label) or undefined.
const annoComposite = (a: BoardAnno) => (a.kind === 'symbol' ? compositeSpec(a.symbol) : undefined)

/** Size a note's textarea to its content, so the editable box is exactly as tall as the note it
 *  replaces (no scrollbar, no jump between "editing" and "done"). Height must be reset first —
 *  scrollHeight never shrinks while an explicit height is still set.
 *
 *  The `> 0` guard is load-bearing: at mount the element has not been laid out yet and
 *  scrollHeight reads 0. Writing `height: 0px` collapses the textarea, and a collapsed element
 *  DROPS FOCUS — which showed up as "the note is placed but I can't type into it", with the
 *  keystrokes falling through to the global hotkeys instead. */
function autoGrow(el: HTMLInputElement | HTMLTextAreaElement | null) {
  if (!el || el.tagName !== 'TEXTAREA') return
  el.style.height = 'auto'
  const h = el.scrollHeight
  if (h > 0) el.style.height = `${h}px`
  else el.style.removeProperty('height')
  // Width comes from React (wN) — every note carries one.
}

// Ref callback that focuses a freshly-mounted text/resource input. Focus synchronously when the
// input mounts — a deferred (setTimeout) focus drops out of the tap's gesture context, so iPadOS
// refuses to open the on-screen keyboard for a freshly placed Notiz. Focusing in the ref callback
// keeps it as close to the gesture as React allows. Module-level, so it is one stable callback.
function focusOnce(el: HTMLInputElement | HTMLTextAreaElement | null) {
  if (!el) return
  // caret AFTER the text, not a full selection: re-opening a note is almost always "add a
  // line", and selecting everything means the next keystroke silently wipes what was written
  el.focus(); el.setSelectionRange?.(el.value.length, el.value.length)
  // size AFTER layout — at ref time scrollHeight is still 0 (see autoGrow). Focus stays
  // synchronous above for the iPadOS keyboard, as the comment block above explains.
  requestAnimationFrame(() => autoGrow(el))
}

type BoardDoc = ReturnType<typeof useBoardDoc>
type Rotor = ReturnType<typeof useWbRotor>

/** What every anno reads from the board this render: the sheet's geometry, the armed tool, and
 *  the writers. The Whiteboard builds it once per render and hands the same object to each. */
export interface PlanAnnoBoard {
  sW: number
  sH: number
  /** the board's layout zoom — a note's text scales with the paper */
  scale: number
  mapY: (floor: number | undefined, ly: number) => number
  /** the Gebäude floor stack: the tile is the storey, so no storey badge on a symbol */
  stack: boolean
  /** a symbol's constant screen size and a note's base font size (Whiteboard · symBase/txtBase) */
  symBase: number
  txtBase: number
  tool: BoardTool
  readOnly: boolean
  captionMode: CaptionMode
  sym: SymbolsApi
  /** the sheet's drawn annos — a chip's rename checks the names beside it, its pill lists its Leitungen */
  annos: BoardAnno[]
  trupps: Trupp[]
  activeId: string
  /** which note is mid-edit on the canvas — one checkpoint per editing session, board-wide */
  textEditId: React.MutableRefObject<string | null>
  /** a Trupp chip reports its rendered size (components/useWbChipSizes) */
  chipRef: (el: HTMLElement | null) => void
  chipDown: ReturnType<typeof useWbChipDrag>['chipDown']
  setEditId: (id: string | null) => void
  setSelId: (id: string | null) => void
  setNotePanelId: (id: string | null) => void
  pushPast: BoardDoc['pushPast']
  patch: BoardDoc['patch']
  patchCommit: BoardDoc['patchCommit']
  emit: (op: string, payload?: Record<string, unknown>) => void
  log: (icon: string, text: string) => void
  teamNameTaken?: (id: string, label: string) => boolean
  onTeamTrupp?: (annoId: string, truppId: string | undefined) => void
  onTeamNewTrupp?: (annoId: string) => void
  onShowTrupp?: (truppId: string) => void
  /** the selected Trupp chip's bar: stamp its position, clear its trail */
  markPosition: () => void
  clearTrail: () => Promise<void>
  removeWithConnections: (a: BoardAnno) => Promise<boolean>
  removeWithTrail: (a: BoardAnno) => Promise<void>
  toggleTrail: (id: string) => void
  rotDown: Rotor['rotDown']
  rotMove: Rotor['rotMove']
  rotUp: Rotor['rotUp']
}

interface Props {
  a: BoardAnno
  /** the single selection (its grips, a Trupp's full pill) … */
  selected: boolean
  /** … and a member of a Mehrfach group (the halo only) */
  grouped: boolean
  /** part of the selected object's line network (lib/lineAttachments · relationshipNetwork) */
  networked: boolean
  /** a Notiz / Trupp name being typed on the canvas */
  editing: boolean
  trailShown: boolean
  board: PlanAnnoBoard
}

/** One non-ink anno on the Plan, positioned in board px; see the file header. */
export function PlanAnno({ a, selected, grouped, networked, editing, trailShown, board }: Props) {
  const {
    sW, sH, scale, mapY, stack, symBase, txtBase, tool, readOnly, captionMode, sym, annos, trupps, activeId, textEditId,
    chipRef, chipDown, setEditId, setSelId, setNotePanelId, pushPast, patch, patchCommit, emit, log,
    teamNameTaken, onTeamTrupp, onTeamNewTrupp, onShowTrupp, markPosition, clearTrail, removeWithConnections, removeWithTrail,
    toggleTrail, rotDown, rotMove, rotUp,
  } = board
  // a note's box: font size = plan-scaled base × the size-slider step; on the Gebäude stack the
  // box is never narrower than its words need and never drawn into the storey-label gutter
  // (lib/notes · stackNoteBoxPx, stackNoteShiftPx) – the stored x stays the anchor
  const noteFontPx = txtBase * scale * noteScale(a.noteSize)
  const noteStoredPx = noteWN(a.wN) * sW
  const noteBoxPx = stack && a.kind === 'text' ? stackNoteBoxPx(noteStoredPx, a.text || appConfig.copy.whiteboard.text, noteFontPx) : noteStoredPx
  const noteShiftPx = stack && a.kind === 'text' ? stackNoteShiftPx((a.x ?? 0) * sW, noteBoxPx) : 0
  return (
    <div
      ref={a.kind === 'resource' ? chipRef : undefined} data-chip-id={a.kind === 'resource' ? a.id : undefined}
      className={`wb-anno wb-${a.kind}${networked ? ' network' : ''} ${selected || grouped ? 'sel' : ''}`}
      // transform positions the anchor at the (scaled) plan point. SYMBOLS hold a
      // constant screen size (symBase, zoom-independent — 30.08.: they are pins like
      // the map's, and «zoomed in» made them comically dwarf the building); shapes
      // stay sheet-true, text scales with the paper, team pills stay constant.
      // a shape's --gpx (→ halo/handle anchor --hbox) takes the LARGER box side so the
      // selection ring always encloses a stretched rectangle (width × width·aspect)
      // ⚠️ A team chip is a STRIP — [dot][gap][name] — and centring the whole strip put
      // half the NAME's width between the dot and the point it states. It is anchored by
      // its LEFT edge with half a dot taken back (the selected pill takes its accent cap
      // back instead, so selecting doesn't shift it) — the same geometry the Karte's
      // Trupp markers use (MapMarkers · anchor="left" + offset), because a Trupp
      // transferred between the two surfaces must not visibly jump. Everything else
      // stays centred on its glyph.
      // a LOCKED shape is click-through, like a locked drawn Fläche: no tap, no drag,
      // no double-tap — the LockChip (own layer below) is the only door back in
      style={{ left: 0, top: 0, transform: `translate(${(a.x ?? 0) * sW + noteShiftPx}px, ${mapY(a.floor, a.y ?? 0) * sH}px) translate(${a.kind === 'resource' ? `${selected ? -TEAM_PILL_CAP_PX : -TEAM_DOT_PX / 2}px` : '-50%'}, -50%)`, ['--gpx' as string]: `${a.kind === 'shape' ? (a.sizeN ?? 0.1) * sW * Math.max(1, shapeAspect(a.shape ?? 'square', a.aspect)) : symBase}px`, ...(a.kind === 'shape' && a.locked ? { pointerEvents: 'none' as const } : null) }}
      onPointerDown={(e) => chipDown(e, a.id, a.floor)}
      // double-tap still opens the on-surface textarea; the panel steps aside so the
      // two editors for one text never stream keystrokes side by side.
      // ⚠️ `!readOnly` mirrors the editors this arms: on a read-only surface the pill
      // renders without `acts`, so `renaming` mounts no input and nothing ever fires
      // the blur that clears `editId` — a viewer's double-tap latched it for the whole
      // mount. The guard is the fix; do NOT mount the editor here instead (its blur
      // would commit a patch from a read-only session).
      onDoubleClick={(e) => { if ((a.kind === 'text' || a.kind === 'resource') && tool === 'pan' && !readOnly) { e.stopPropagation(); setEditId(a.id); setSelId(a.id); if (a.kind === 'text') setNotePanelId(null) } }}
    >
      {networked && !selected && <span className="network-halo" />}
      {/* selection halo — the same accent ring the Lage map draws, so a selected
          symbol/shape reads identically on the plan (teams keep their own team-colour ring) */}
      {/* ⚠️ Symbols only (02.09.): a Form is selected to be worked with its own ends
          and axes, and a ring around a sheet-sized shape covers the very paper those
          grips work on. Karte parity — MapMarkers excludes it there too. */}
      {(selected || grouped) && a.kind === 'symbol' && <div className="sel-halo" />}
      {a.kind === 'symbol' && (() => {
        // same renderer as the Lage map — so the plan symbol gets the white
        // legibility chip, rotation, and count badge identically. (Floor is
        // encoded by the tile here, so no floor badge is passed.)
        // the generic vehicle bakes its name + heading into the glyph (text
        // stays upright), so its body rotation is in the SVG, not the chip.
        const veh = isVehicleSym(a)
        const comp = annoComposite(a)
        const hub = isHubretter(a.symbol)
        const svg = veh ? vehicleSymbolSvg(a.label ?? '', a.rotation ?? 0)
          : comp ? (sym.byName[comp.base] ?? '')
          : hub ? (sym.byName[appConfig.symbols.vehicleName] ?? '')   // plain body; the boom is drawn separately
          : (placardSvgForSymbol(a.symbol, a.fields) ?? (a.symbol ? sym.byName[luefterVariant(a.symbol, a.extract)!] ?? sym.byName[a.symbol] ?? '' : ''))
        // a composite stacks its part (fan / ladder) as a separately-rotatable overlay aimed
        // by rotation2; the Lüfter's extract (Absaugen) swaps to the reversed-arrow fan.
        const overlay = comp ? { svg: sym.byName[compositePartGlyph(comp, a.extract)] ?? sym.byName[comp.part] ?? '', rotation: a.rotation2 ?? 0, scale: comp.scale, offsetX: comp.offsetX } : undefined
        // Hubretter boom: variable-reach articulated arm mounted on the turntable (drawn ON
        // TOP of the body), sized as a fraction of the plan width (reachN), aimed by rotation2.
        const boomPx = hub ? Math.max(12, (a.reachN ?? 0.12) * sW) : 0
        return (
          <>
            <TacticalSymbol
              svg={svg}
              // symBase WITHOUT × scale (30.08.): a plan symbol is a pin with a
              // constant screen size, exactly like the Lage map's — zooming the sheet
              // must not balloon it past the building. Twins share the same number.
              sizePx={symBase}
              rotation={veh ? 0 : (a.rotation ?? 0)}
              overlay={overlay}
              // the signed Stockwerk badge, same slot and same glyph as on the Lage.
              // `storey`, never `floor` — that one is the stack's tile index.
              floor={stack ? undefined : a.storey}
              floorFrom={stack ? undefined : a.floorFrom}
              floorTo={stack ? undefined : a.floorTo}
              spread={a.spread}
              count={a.count}
              // «Gelöscht / erledigt»: grey glyph + the time — the Karte's rule, on the
              // Modul sheets and on every Gebäude storey alike
              done={doneBadge(a)}
              // a vehicle's NAME is already in the glyph — symbolCaptionText drops it and
              // keeps the rest (Fahrer, eigene Felder, Notizen), which only 'Alle' prints
              // …and the seams come with it: .sym-caption wraps on both surfaces now,
              // and German breaks by syllable unless the curated table is asked first.
              caption={(() => { const c = symbolCaptionText(a, captionMode); return c ? softHyphenateText(c) : c })()}
              measured={isMeasuredSymbol(a) ? a : undefined}
              className="ts-plan"
            />
            {/* boom AFTER the body → paints on top (mounted on the turntable / roof) */}
            {hub && <HubretterBoom lengthPx={boomPx} deg={a.rotation2 ?? 0} />}
          </>
        )
      })()}
      {a.kind === 'shape' && (
        // same glyphs + sizing model as the map: the silhouette scales with the
        // plan (width = sizeN × plan width, height = width × aspect) and rotates as a whole
        <div className="shape-glyph" style={{ width: (a.sizeN ?? 0.1) * sW, height: (a.sizeN ?? 0.1) * sW * shapeAspect(a.shape ?? 'square', a.aspect), transform: `rotate(${a.rotation ?? 0}deg)` }}>
          <ShapeGlyph kind={a.shape ?? 'square'} color={a.color ?? DEFAULT_INK} stop={a.stop} aspect={a.aspect} carrier={a.carrier} reverse={a.reverse} strokeW={a.strokeW} boxPx={(a.sizeN ?? 0.1) * sW} fillOpacity={a.fillOpacity} hatch={a.hatch} sharpCorners={a.sharpCorners} />
        </div>
      )}
      {a.kind === 'text' && (() => {
        // every note is a wrapping box; a stored note with no width falls back to the
        // default. Its font size and width are sized above (noteFontPx, noteBoxPx).
        // colour applies in both looks — see the twin in MapMarkers for why it did not
        const tinted = !a.notePlain && !!a.color
        const cls = (base: string) => `${base} box${a.notePlain ? ' plain' : ''}${tinted ? ' tinted' : ''}`
        const style = {
          fontSize: noteFontPx,
          width: noteBoxPx,
          ...(a.color ? (a.notePlain ? { color: a.color } : { '--note-tint': a.color }) : null),
        } as React.CSSProperties
        return editing
          ? <textarea className={cls('wb-text-input')} ref={focusOnce} value={a.text} placeholder={appConfig.copy.whiteboard.textPlaceholder} rows={1} style={style}
              onPointerDown={(e) => e.stopPropagation()}
              // stream each keystroke live into the note (silent — checkpoint once on the
              // first edit), so the text shows as you type and the note never vanishes
              onChange={(e) => {
                if (textEditId.current !== a.id) { textEditId.current = a.id; pushPast() }
                const v = e.target.value
                patch(a.id, { text: v, ...(a.noteAutoW ? { wN: autoNoteWN(v, noteFontPx, sW) } : null) })
                autoGrow(e.currentTarget)
              }}
              // finalise on blur: keep the note even if empty (a placed note must persist,
              // mirroring the Lage map) and record one audit edit for the whole session
              onBlur={(e) => {
                setEditId(null)
                if (textEditId.current !== a.id) return
                textEditId.current = null
                emit('board.edit', { id: a.id, patch: { text: e.target.value }, planId: activeId })
                // …and the Verlauf gets what it SAYS, not that a note exists (parity with
                // the Lage's map notes, lib/entityEdit). Once per editing session, on the
                // way out — a row per keystroke would be a wall.
                const v = e.target.value.replace(/\s+/g, ' ').trim()
                const was = (a.text ?? '').replace(/\s+/g, ' ').trim()
                if (v !== was) {
                  log('type', v
                    ? fillTemplate(appConfig.copy.log.noteWritten, { value: v })
                    : appConfig.copy.log.notesCleared)
                }
              }}
              // Enter makes a new line — the ✓, Esc and tapping away are the way out
              onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); (e.target as HTMLTextAreaElement).blur() } }} />
          : <span className={cls('wb-text-label')} style={style}>{a.text || appConfig.copy.whiteboard.text}</span>
      })()}
      {/* ✓ Fertig — Enter makes a new line, so a gloved hand needs a visible way out
          (tap-away works but isn't discoverable) */}
      {a.kind === 'text' && editing && (
        <button className="note-done" title={appConfig.copy.notes.done} aria-label={appConfig.copy.notes.done}
          // pointerdown (not click): the textarea's blur would unmount this button first
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setEditId(null) }}><Icon id="check" /></button>
      )}
      {a.kind === 'resource' && (() => {
        // a chip linked to a Trupp that's been marked «raus» (Atemschutz board)
        // dims + strikes through, so the plan reflects that the team is out.
        const isRaus = !!a.truppId && trupps.some((t) => t.id === a.truppId && t.status === 'raus')
        const teamCol = a.color || TEAM_COLORS[0]
        // parity with the Lage map: a compact dot + name at rest, expanding to the full
        // pill (cap · rename · time badge) only when the team is selected.
        if (!selected) {
          return (
            <span className={`team-dot ${isRaus ? 'raus' : ''}`} style={{ '--team': teamCol } as React.CSSProperties}>
              <i /><b>{a.text}</b>
              {/* the storey, at rest as well as selected (18.09.2026): on a stack the
                  tile says it only to whoever is already looking at that tile */}
              {stack && <span className="team-floor" title={floorLabel(a.floor ?? 0)}>{floorBadge(a.floor ?? 0)}</span>}
            </span>
          )
        }
        // the pill AND its action bar are the ONE shared component
        // (components/TwinTeamPill) — the very same one the Karte's own Trupp marker and
        // both mirrors wear, so no surface can answer differently for the same Trupp.
        // The bar only appears while this board may be written on; the anno wrapper
        // already owns the press, so no `hit` shell is passed.
        // ⚠️ No Farbe swatch — and since 04.09. none on the SelectionBar either. The
        // colour is automatic, and the ONE place left to change it is the marker's own
        // bar on the Karte (the same TwinTeamPill, with `acts.color` passed there and
        // nowhere else). A plan chip that offered it too would be a second answer to a
        // question the Lage already owns.
        return (
          <TwinTeamPill
            name={a.text ?? ''} time={a.t} color={teamCol}
            raus={isRaus} truppId={a.truppId} floor={stack ? a.floor ?? 0 : undefined}
            trailCount={a.trail?.length ?? 0}
            trailShown={trailShown} trupps={trupps}
            renameRef={focusOnce}
            // ⚠️ the rename flag stays OUT here: on this surface a chip also enters
            // rename by DOUBLE-CLICK on the anno wrapper (the desktop path), which the
            // pill knows nothing about — so `editId` remains the one source of truth.
            renaming={editing} onRenaming={(on) => setEditId(on ? a.id : null)}
            acts={tool === 'pan' && !readOnly ? {
              // an empty name keeps the old one — a blank chip is nobody
              rename: (name) => {
                // a number somebody else holds is refused, not left for a merge to settle
                const taken = teamNameTaken
                  ? teamNameTaken(a.id, name)
                  : teamNoTaken(name, annos.filter((x) => x.kind === 'resource' && x.id !== a.id).map((x) => x.text))
                if (name && name !== a.text && taken) {
                  toast(fillTemplate(appConfig.copy.whiteboard.teamNameTaken, { name }), { icon: 'warn', tone: 'warn' })
                  return
                }
                patchCommit(a.id, { text: name || a.text })
              },
              pick: onTeamTrupp && ((truppId) => onTeamTrupp(a.id, truppId)),
              newTrupp: onTeamNewTrupp && (() => onTeamNewTrupp(a.id)),
              mark: markPosition,
              clearTrail: () => void clearTrail(),
              remove: () => void removeWithConnections(a),
              removeWithTrail: () => void removeWithTrail(a),
              showTrupp: onShowTrupp,
              toggleTrail: () => toggleTrail(a.id),
            // a locked board keeps the bar's two doors that change nothing, like the
            // Karte's marker (MapMarkers · readOnly): the card jump, the trail toggle
            } : tool === 'pan' && ((a.truppId && onShowTrupp) || a.trail?.length) ? {
              showTrupp: onShowTrupp,
              toggleTrail: () => toggleTrail(a.id),
            } : undefined} />
        )
      })()}
      {a.kind === 'resource' && selected && tool === 'pan' && (() => {
        const connected = annos.filter((line) => [line.startAttachment, line.endAttachment].some((rel) => rel?.target.kind === 'object' && rel.target.id === a.id))
        return connected.length > 0 ? <div className="wb-resource-connections ctx-connections" onPointerDown={(e) => e.stopPropagation()}>
          <span className="ctx-section-label">{appConfig.copy.drawingEditor.connectedLines.replace('{n}', String(connected.length))}</span>
          {connected.map((line) => <button key={line.id} onClick={() => setSelId(line.id)}><span>{lineLabel(line)}</span><span className="ctx-conn-go" aria-hidden>›</span></button>)}
        </div> : null
      })()}
      {/* ⚠️ No floating ✕ on a selected symbol/shape and no grips row on a selected
          note any more (D2 + Notiz-Grammatik, 29.08.): a tap opens the detail panel,
          and Löschen lives there — one delete per object, behind one door, instead of
          a bare ✕ hovering a mis-tap away from the thing it destroys. The team pill's
          trash and the multi-select group trash stay (decided): both are guarded
          (trail lock / connection confirm) and have no panel of their own. */}
      {/* ⚠️ …and no right-edge width grip on a Textfeld either (05.09., with its Karte
          twin — MapMarkers). A note sizes itself to what is typed (`noteAutoW`), so the
          grip only ever un-did that, and it sat where a finger reaches for the note
          itself. Breite is not a decision the Kroki needs from anybody. */}
      {/* generic shape: its size grips, riding the shape's rotation (identical to the
          Lage map). The rotate knob left on 02.09. — the SelectionBar's ⟳ is the one
          way to turn a Form. */}
      {a.kind === 'shape' && selected && tool === 'pan' && !readOnly && !a.locked && (() => {
        // CSS anchors the knob/grip off a SQUARE --hbox; a stretched shape overrides
        // them inline so the knob rides the real top edge and the grip the real
        // corner (identical to the Lage map — MapMarkers' shape rotor)
        const hbW = Math.max((a.sizeN ?? 0.1) * sW, 56)
        const hbH = Math.max((a.sizeN ?? 0.1) * sW * shapeAspect(a.shape ?? 'square', a.aspect), 56)
        // ── A Rotation is its two ENDS, and nothing else (lib/shapes · SHAPE_TWO_POINT) ──
        // Each end sets the run's length AND its bearing, and the width follows the run,
        // so there is no rotate knob and no size grip left to draw. The twin of the Lage
        // map's pair (MapMarkers), down to the tether that keeps a grip off its own cap.
        if (SHAPE_TWO_POINT[a.shape ?? 'square']) {
          const boxW = (a.sizeN ?? SHAPE_DEFS.rotation.defaultSizeN) * sW
          const boxH = boxW * shapeAspect('rotation', a.aspect)
          const runPx = Math.max(0, boxW - boxH)
          const off = rotationGripOffPx(boxH)
          return (
            <div className="shape-rotor" style={{ transform: `rotate(${a.rotation ?? 0}deg)` }}>
              {([['endA', -1], ['endB', 1]] as const).map(([which, sign]) => (
                <button key={which} className="handle shape-end"
                  style={{ left: `calc(50% + ${sign * (runPx / 2 + off)}px)`, top: '50%' }}
                  title={appConfig.copy.shapes.endHint} aria-label={appConfig.copy.shapes.endHint} data-holdaction
                  onPointerDown={(e) => rotDown(e, a.id, which)} onPointerMove={rotMove} onPointerUp={rotUp} onPointerCancel={rotUp}
                  onClick={(e) => e.stopPropagation()}>
                  <Icon id="resize-h" />
                </button>
              ))}
            </div>
          )
        }
        // no rotate knob on a Form (02.09.) — the bar's ⟳ turns it; see MapMarkers
        return (
        <div className="shape-rotor" style={{ transform: `rotate(${a.rotation ?? 0}deg)` }}>
          {/* ── ONE GRIP PER AXIS on a Rechteck and a Rotation (01.09.) ── the ↔ on the
              right edge moves the x-axis, the ↕ on the bottom edge the y-axis: each grip
              stands ON the axis it controls. Identical to the Lage map (MapMarkers); the
              Rauch keeps the diagonal corner (lib/shapes · SHAPE_AXIS_GRIPS). */}
          {SHAPE_AXIS_GRIPS[a.shape ?? 'square'] ? <>
            <button className="handle shape-resize shape-axis-x" style={{ left: `calc(50% + ${hbW / 2 + 3}px)`, top: '50%' }}
              title={appConfig.copy.shapes.boxWidthHint}
              aria-label={appConfig.copy.shapes.boxWidthHint} data-holdaction
              onPointerDown={(e) => rotDown(e, a.id, 'resize')} onPointerMove={rotMove} onPointerUp={rotUp} onPointerCancel={rotUp} onClick={(e) => e.stopPropagation()}>
              <Icon id="resize-h" />
            </button>
            <button className="handle shape-width shape-axis-y" style={{ left: '50%', top: `calc(50% + ${hbH / 2 + 3}px)` }}
              title={appConfig.copy.shapes.boxHeightHint}
              aria-label={appConfig.copy.shapes.boxHeightHint} data-holdaction
              onPointerDown={(e) => rotDown(e, a.id, 'sizeY')} onPointerMove={rotMove} onPointerUp={rotUp} onPointerCancel={rotUp} onClick={(e) => e.stopPropagation()}>
              <Icon id="resize-v" />
            </button>
          </> : (
            <button className="handle shape-resize" style={{ left: `calc(50% + ${hbW / 2 + 3}px)`, top: `calc(50% + ${hbH / 2 + 3}px)` }} title={appConfig.copy.shapes.resizeHint} aria-label={appConfig.copy.shapes.resizeHint} data-holdaction
              onPointerDown={(e) => rotDown(e, a.id, 'resize')} onPointerMove={rotMove} onPointerUp={rotUp} onPointerCancel={rotUp} onClick={(e) => e.stopPropagation()}>
              <Icon id="resize" />
            </button>
          )}
        </div>
        )
      })()}
      {/* directional symbol: tethered rotor knob (rotate-only), identical to
          the Lage map — rotates with the symbol so the handle stays attached */}
      {isRotatableSym(a) && !annoComposite(a) && selected && tool === 'pan' && !readOnly && (
        <div className="shape-rotor" style={{ transform: `rotate(${a.rotation ?? 0}deg)` }}>
          <span className="shape-stem" />
          <button
            className="handle shape-rotate"
            aria-label={appConfig.copy.shapes.rotate} data-holdaction
            onPointerDown={(e) => rotDown(e, a.id)}
            onPointerMove={rotMove}
            onPointerUp={rotUp}
            onPointerCancel={rotUp}
            onClick={(e) => e.stopPropagation()}
          >
            <Icon id="rotate" />
          </button>
        </div>
      )}
      {/* composite (Grosslüfter / Drehleiter / Hubretter): two rotors — blue body knob (short)
          + amber part knob (long), the part = fan / ladder / boom aimed on rotation2 */}
      {annoComposite(a) && selected && tool === 'pan' && !readOnly && (
        <>
          <div className="shape-rotor" style={{ transform: `rotate(${a.rotation ?? 0}deg)` }}>
            <span className="shape-stem" />
            <button className="handle shape-rotate" title={appConfig.copy.contextPanel.rotationVehicle} aria-label={appConfig.copy.contextPanel.rotationVehicle} data-holdaction
              onPointerDown={(e) => rotDown(e, a.id, 'rotate')} onPointerMove={rotMove} onPointerUp={rotUp} onPointerCancel={rotUp} onClick={(e) => e.stopPropagation()}>
              <Icon id="rotate" />
            </button>
          </div>
          <div className="shape-rotor shape-rotor-fan" style={{ transform: `rotate(${a.rotation2 ?? 0}deg)` }}>
            <span className="shape-stem" />
            <button className="handle shape-rotate shape-rotate-fan" title={appConfig.copy.contextPanel[annoComposite(a)!.partLabel]} aria-label={appConfig.copy.contextPanel[annoComposite(a)!.partLabel]} data-holdaction
              onPointerDown={(e) => rotDown(e, a.id, 'rotate2')} onPointerMove={rotMove} onPointerUp={rotUp} onPointerCancel={rotUp} onClick={(e) => e.stopPropagation()}>
              <Icon id="rotate" />
            </button>
          </div>
        </>
      )}
      {/* Hubretter cage tip: ONE amber handle at the boom end (same as the Lage map). Dragging
          it sets the boom bearing (rotation2) + reach (reachN); positioned at the tip. */}
      {isHubretter(a.symbol) && selected && tool === 'pan' && !readOnly && (() => {
        const rad = ((a.rotation2 ?? 0) * Math.PI) / 180
        const len = Math.max(12, (a.reachN ?? 0.12) * sW)
        return (
          <div className="cage-handle" style={{ left: `calc(50% + ${(Math.cos(rad) * len).toFixed(1)}px)`, top: `calc(50% + ${(Math.sin(rad) * len).toFixed(1)}px)` }}>
            <button className="handle shape-cage" title={appConfig.copy.shapes.moveHint} aria-label={appConfig.copy.shapes.moveHint} data-holdaction
              onPointerDown={(e) => rotDown(e, a.id, 'cage')} onPointerMove={rotMove} onPointerUp={rotUp} onPointerCancel={rotUp} onClick={(e) => e.stopPropagation()}>
              <Icon id="move" />
            </button>
          </div>
        )
      })()}
    </div>
  )
}
