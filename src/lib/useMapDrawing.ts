import { type SetStateAction, useRef, useState } from 'react'
import { appConfig } from '../config/appConfig'
import { detachDrawings, flipLine, wireFreed, withDetach } from './lineAttachments'
import { flippedRelay } from './hydraulics'
import { drawingEditChanges, drawingLogName, pumpWarningRows } from './drawingEdit'
import type { Doc } from './workspace'
import type { Drawing, LineAttachment, LineEndpoint, LngLat, MapTool, TimelineEvent } from '../types'
import { confirmDialog, toast } from './ui'
import { fillTemplate } from './format'
import { newId } from './ids'
import { canDropVertex, insertAt, minPoints, removeVertex } from './vertexOps'
import { askOpenDraft, draftActive as isDraftActive, finishKind, releaseDraft } from './draftMachine'
import { onSiteCoords, revertCoords } from './gpsReturn'
import { GRUNDRISS_STYLE, wallRolePatch, wallRoleWire } from './grundriss'

/** The style every new line / Fläche is born with – never the last edited line's
 *  (3am sweep §2, 23.10.2026). The Plan's inks use the same rule (usePlanDraft · INK_DEFAULTS). */
export const DRAW_DEFAULTS = { color: appConfig.drawing.defaultColor, width: 4, dashed: false, marker: '', arrow: false } as const

// same settle window as the workspace's noteEntityEdit / Rapportangaben logger
// (IncidentWorkspace · META_LOG_SETTLE_MS) — a burst of taps on the editor is one row
const DRAW_LOG_SETTLE_MS = 4000

/** One GPS end to let go of: which line, which end, and where the screen shows it now. */
export interface GpsDetach { id: string; endpoint: LineEndpoint; fallback?: LngLat }

interface MapDrawingDeps {
  drawings: Drawing[]
  resolvedDrawings?: Drawing[]
  selectedDrawingId: string | null
  tacticalLocked: boolean
  tool: MapTool
  setTool: (id: MapTool) => void
  commit: (updater: (d: Doc) => Doc, opts?: { gesture?: boolean }) => void
  setDocRaw: (updater: (d: Doc) => Doc) => void
  beginDrag: () => void
  endDrag: () => void
  emit: (op: string, payload?: Record<string, unknown>) => void
  log: (icon: string, text: string, kind?: TimelineEvent['kind'], audioUrl?: string, entityId?: string, opts?: { rowId?: string; subjectId?: string }) => void
  setSelectedDrawingId: (id: string | null) => void
  setSelectedId: (id: string | null) => void
  setSelectedDrawIds: (ids: string[]) => void
  setSelectedEntityIds: (ids: string[]) => void
  /** A Leitung end just docked onto something — handed back so the workspace can join the hose to
   *  an Atemschutz-Trupp when the thing it docked onto is that Trupp's marker (useTruppActions ·
   *  linkLineToAttachedTrupp). Fired for a freshly drawn line's ends and for an end dragged onto
   *  a target; detaching deliberately reports nothing, because letting go never unlinks. */
  onLineAttached?: (lineId: string, attachment: LineAttachment) => void
  /** …and the reverse (15.09.): an end let go of what it was coupled to – editor «Lösen» or a
   *  drag-off. Handed up with the coupling it HAD, so the workspace can drop the Trupp link that
   *  coupling made (useTruppActions · unlinkLineFromDetachedTrupp). */
  onLineDetached?: (lineId: string, previous: LineAttachment) => void
}

/**
 * The Lage-map drawing surface, lifted out of App's god-component. It owns the in-progress draft
 * (the line/area node taps), the line tool's freehand/nodes mode, the sticky next-line style,
 * and every Drawing CRUD + on-canvas edit (commit a draft, create a
 * line/circle, reshape/move/insert/delete vertices, drag a line's label, patch style, delete).
 *
 * It deliberately does NOT own the undoable doc (Drawings live there) nor the shared selection
 * state — both are threaded in via deps so the handlers stay byte-for-byte equivalent to their
 * former inline selves; the only change is where they live. Symbol/shape placement, measure and
 * the marquee/group handlers (which span entities too) remain in App.
 */
export function useMapDrawing(deps: MapDrawingDeps) {
  const {
    drawings, resolvedDrawings = drawings, selectedDrawingId, tacticalLocked, tool, setTool,
    commit, setDocRaw, beginDrag, endDrag, emit, log,
    setSelectedDrawingId, setSelectedId, setSelectedDrawIds, setSelectedEntityIds, onLineAttached, onLineDetached,
  } = deps

  const [draft, setDraftRaw] = useState<LngLat[]>([])
  const [draftAttachments, setDraftAttachments] = useState<{ startAttachment?: LineAttachment; endAttachment?: LineAttachment }>({})
  const setDraft = (action: SetStateAction<LngLat[]>) => setDraftRaw((prev) => {
    const next = typeof action === 'function' ? action(prev) : action
    if (!next.length) setDraftAttachments({})
    return next
  })
  // Every new drawing starts from the ONE plain default (DRAW_DEFAULTS): colour, width, solid,
  // no marker, no arrowhead. Until 23.10.2026 the DrawEditor's edits were written back here as
  // the next line's template, so an Absperrung's chain marker rode along into the next hose
  // line (3am sweep §2). Styling lives in the editor, after the draw — and stays there.
  const { color: drawColor, width: drawWidth, dashed: drawDashed, marker: drawMarker, arrow: drawArrow } = DRAW_DEFAULTS
  // Fläche: tapped nodes, or a dragged outline. Nodes stay the default — most Flächen are a
  // Sektor or an Absperrung, and those want corners. Freehand exists for the one that does
  // not: a fire's edge, which has no corners and which nobody tapping points can follow
  // (FKS Vegetationsbrand · «vorsehbare Brandentwicklung»).
  const [areaMode, setAreaMode] = useState<'nodes' | 'freehand'>('nodes')
  const [lineMode, setLineMode] = useState<'freehand' | 'nodes'>('freehand')

  // ✓ «Fertig»: a Linie from ≥2 tapped vertices, a Fläche from ≥3 (lib/draftMachine · finishKind);
  // createLine / createArea drop into Select themselves
  const commitDraft = () => {
    const kind = finishKind(tool, draft.length)
    const coords = draft
    setDraft([])
    if (kind === 'line') createLine(coords, draftAttachments)
    else if (kind === 'area') createArea(coords)
  }
  // create an area from a finished ring — the node-tapped draft, or a measured Fläche taken over
  // from the Messen panel. The twin of createLine: same funnel, same one-shot to Select.
  const createArea = (coords: LngLat[], opts?: { select?: boolean }): Drawing | null => {
    if (tacticalLocked) return null // same guard as createLine + the edit handlers
    const id = newId('d')
    // carry the dock's colour/width/dash so the area-tool style controls actually apply
    // (parity with the line tool + the Plan area tool); still fully editable in the DrawEditor.
    const drawing: Drawing = { id, kind: 'area', coords, color: drawColor, width: drawWidth, dashed: drawDashed }
    commit((d) => ({ ...d, drawings: [...d.drawings, drawing] }))
    log('area', fillTemplate(appConfig.copy.log.shapeDrawn, { name: drawingLogName(drawing) }), 'symbol', undefined, undefined, { subjectId: id }); emit('draw.add', { id, kind: 'area', drawing })
    // drop into Select with the new area active so its reshape/move/rotate handles are
    // immediately usable (mirrors symbol/shape placement). Staying in 'area' would keep
    // draftKind set, which suppresses the edit handles → the area looks uneditable.
    // `select: false` is «Speichern» on a drawing being left (settleDraft): there the operator has
    // ALREADY chosen where to be next, and stealing the selection would undo that choice.
    if (opts?.select !== false) { setTool('select'); setSelectedDrawingId(id); setSelectedDrawIds([]); setSelectedEntityIds([]); setSelectedId(null) }
    return drawing
  }
  // create a line from a finished path (freehand stroke OR node-tapped draft), seeded from the
  // sticky style above. EVERY finished line one-shots to Select with the new line active, so
  // its detail editor opens right away for post-draw tweaks — no extra click needed.
  // `props`: a line adopted from Messen carries its Wassertransport (hose + relay) along
  const createLine = (coords: LngLat[], attachments?: { startAttachment?: LineAttachment; endAttachment?: LineAttachment }, opts?: { select?: boolean; props?: Pick<Drawing, 'hose' | 'relay'> }): Drawing | null => {
    if (tacticalLocked) return null // the funnel every finished line goes through — same guard as the edit handlers
    const id = newId('d')
    const drawing: Drawing = {
      id, kind: 'line', coords, color: drawColor, width: drawWidth, dashed: drawDashed || undefined,
      ...(drawMarker ? { marker: drawMarker } : {}), ...(drawArrow ? { arrow: true } : {}), ...attachments,
      ...(opts?.props?.hose ? { hose: opts.props.hose } : {}), ...(opts?.props?.relay ? { relay: opts.props.relay } : {}),
    }
    commit((d) => ({ ...d, drawings: [...d.drawings, drawing] }))
    // named by drawingLogName, so «Rettungsachse gezeichnet» opens what «Rettungsachse gelöscht»
    // closes — before 31.08. every line, whatever it was drawn with, opened on «Zeichnung erstellt»
    log('pen', fillTemplate(appConfig.copy.log.shapeDrawn, { name: drawingLogName(drawing) }), 'symbol', undefined, undefined, { subjectId: id }); emit('draw.add', { id, kind: 'line', drawing })
    // a Wassertransport adopted from Messen arrives with the pump warnings it already stands on –
    // they appear NOW, so they are noted now (later edits note only the ones they bring)
    const warnings = pumpWarningRows(null, drawing)
    if (warnings.length) {
      log('pen', fillTemplate(appConfig.copy.log.entityEdited, { name: drawingLogName(drawing), changes: warnings.join(', ') }), 'symbol', undefined, undefined, { subjectId: id })
    }
    // a stroke that ENDED on a Trupp's marker is that Trupp's Leitung — reported for both ends,
    // because either of them may be the coupling (see MapDrawingDeps · onLineAttached)
    for (const a of [attachments?.startAttachment, attachments?.endAttachment]) if (a) onLineAttached?.(id, a)
    // `select: false` = «Speichern» on a drawing being left (settleDraft) — see the note on createArea
    if (opts?.select !== false) { setTool('select'); setSelectedDrawingId(id); setSelectedDrawIds([]); setSelectedEntityIds([]); setSelectedId(null) }
    return drawing
  }
  // ONE gesture, two outcomes: whichever tool is armed decides whether the dragged path closes
  // into a Fläche or stays a Linie. The path is already thinned by the gesture hook, so an area
  // drawn with a finger arrives with the same handful of editable nodes a tapped one has.
  const onFreehand = (coords: LngLat[], attachments?: { startAttachment?: LineAttachment; endAttachment?: LineAttachment }) => {
    if (tool === 'area') return coords.length >= minPoints('area') ? createArea(coords) : null
    return createLine(coords, attachments)
  }
  /** One node tap's magnet result (MapView · onDraftPointAttachment) — the Plan's rule
   *  (usePlanCreate · node tap): the first tap owns the start, every later tap the END slot, so a
   *  free tap clears what an earlier tap on a symbol banked. */
  const setDraftPointAttachment = (attachment?: LineAttachment) => {
    setDraftAttachments((a) => draft.length === 0 ? { startAttachment: attachment } : { ...a, endAttachment: attachment })
  }
  // Absperrkreis / Gefahrenradius: a dragged circle becomes a real (undoable, synced,
  // journaled) circle Drawing — centre in coords[0], radius in metres. Drops into Select
  // with the new circle active so its radius is tweakable in the DrawEditor right away.
  const createCircle = (center: LngLat, radiusM: number): string => {
    const id = newId('d')
    const drawing: Drawing = { id, kind: 'circle', coords: [center], radiusM, color: appConfig.drawing.circleColor, dashed: true, width: appConfig.drawing.circleLineWidth, fillOpacity: appConfig.drawing.circleFillOpacity }
    commit((d) => ({ ...d, drawings: [...d.drawings, drawing] }))
    log('circle', fillTemplate(appConfig.copy.log.shapeDrawn, { name: drawingLogName(drawing) }), 'symbol', undefined, undefined, { subjectId: id }); emit('draw.add', { id, kind: 'circle', drawing })
    setTool('select'); setSelectedDrawingId(id); setSelectedDrawIds([]); setSelectedEntityIds([]); setSelectedId(null)
    return id
  }
  // (the preset row is gone — 09.09., «das ganze Stil-Ding»: a line's decorations are assembled
  // from the raw controls in the editor, and lib/lineStyle · lineStyleName still NAMES the
  // combinations for the Verlauf, so «Rettungsachse gezeichnet» keeps reading as before)

  /**
   * The draft is being LEFT — another tool or dock, Escape, a selection landing, a mode/surface
   * switch, the tactical lock. A committable draft (area ≥3 points, node line ≥2) asks «Speichern ·
   * Verwerfen · Weiterzeichnen» (owner, 27.10.2026 – it replaced the A6 auto-commit with its
   * «Rückgängig» toast). The leave itself goes through at once and the drawing waits in the
   * question: «Speichern» commits it through the same create funnel the ✓ uses — without stealing
   * the selection the operator just made, one ↶ —, «Verwerfen» drops it, «Weiterzeichnen» hands it
   * back to the hand under its re-armed tool. A fragment below the minimum goes silently.
   * The decision and the question are the Plan's too (lib/draftMachine); the funnel is this surface's.
   */
  const settleDraft = () => {
    // ⚠️ `tacticalLocked` makes every committable draft a discard: once the surface is locked
    // (replay entered, tab lock lost, Führungsansicht) this session may no longer write, and
    // createLine/createArea would rightly refuse — so the honest outcome is the discard toast.
    const release = releaseDraft({ from: tool, lineMode, count: draft.length, locked: tacticalLocked })
    if (release.type === 'keep') return
    const coords = draft
    const attachments = draftAttachments
    const wasTool = tool
    setDraft([])
    if (release.type === 'drop') return
    if (release.type === 'discard') {
      toast(appConfig.copy.toolDock.draftDiscarded, { icon: 'info' })
      return
    }
    const kind = release.kind
    const save = () => { if (kind === 'line') createLine(coords, attachments, { select: false }); else createArea(coords, { select: false }) }
    if (release.type === 'commit') { save(); return } // (the Karte always asks – see releaseDraft)
    void askOpenDraft(kind === 'line' ? appConfig.copy.drawingEditor.line : appConfig.copy.drawingEditor.area).then((answer) => {
      if (answer === 'save') save()
      else if (answer === 'continue') {
        setTool(wasTool)
        if (wasTool === 'line') setLineMode('nodes')
        else setAreaMode('nodes')
        setDraftRaw(coords)
        setDraftAttachments(attachments)
      }
    })
  }

  const selectedDrawing = drawings.find((d) => d.id === selectedDrawingId) ?? null
  // Both patch paths carry the same `tacticalLocked` guard as the coord/vertex handlers below:
  // `commit` alone only stops a VIEWER (readOnly) — in the Führungsansicht it writes, and
  // the emit above it reached the audit stream even when the commit was dropped.
  /**
   * The Verlauf row for NAMING a shape — «Fläche «Sammelplatz»», «Absperrkreis «90 m Chlor»».
   *
   * Only the label. Colour, width, dash and geometry are how the picture is arranged and change
   * constantly while somebody arranges it; the name is the one edit that says what the shape IS,
   * and it used to reach the document silently — the record held «Fläche gezeichnet» and never
   * what that Fläche turned out to be. Same rule as a Notiz (lib/entityEdit).
   */
  const noteDrawingLabel = (before: Drawing | undefined, patch: Partial<Drawing>) => {
    if (!before || !('label' in patch)) return
    const L = appConfig.copy.log
    const was = (before.label ?? '').trim()
    const now = (patch.label ?? '').replace(/\s+/g, ' ').trim()
    if (was === now) return
    const kind = L.drawKinds[before.kind] ?? L.drawKinds.line
    log('pen', now
      ? fillTemplate(L.drawingLabelSet, { kind, value: now })
      : fillTemplate(L.drawingLabelCleared, { kind }), 'symbol', undefined, undefined, { subjectId: before.id })
  }
  /**
   * The label WHILE it is being typed — silent, and one undo step for the whole edit.
   *
   * ⚠️ Every keystroke used to go through `patchDrawing`, so naming a Fläche «Sicherung» wrote
   * eleven Verlauf rows: «Zeichnung «S»», «Zeichnung «Si»», «Zeichnung «Sic»» … The record is read
   * afterwards by somebody looking for what happened, and a name being typed is not something that
   * happened. Same shape as the Notiz and the Einsatz title (IncidentWorkspace · noteTextLive):
   * stream into the doc, snapshot once for undo, and let `commitDrawingLabel` write the one row.
   */
  const labelLive = useRef<{ id: string; before: string } | null>(null)
  const patchDrawingLabelLive = (id: string, label: string) => {
    if (tacticalLocked) return
    if (labelLive.current?.id !== id) {
      const before = drawings.find((dr) => dr.id === id)
      labelLive.current = { id, before: before?.label ?? '' }
      beginDrag()
    }
    setDocRaw((d) => ({ ...d, drawings: d.drawings.map((dr) => (dr.id === id ? { ...dr, label } : dr)) }))
  }
  /** …and the one row + one audit event, on blur. Compares against the label as it stood when the
   *  session started, so «Sicherung» typed over «Sammelplatz» reads as the one change it was. */
  const commitDrawingLabel = (id: string, label: string) => {
    if (tacticalLocked) { labelLive.current = null; return }
    const live = labelLive.current
    labelLive.current = null
    if (!live || live.id !== id) { patchDrawingById(id, { label }); return }
    endDrag()
    noteDrawingLabel({ ...(drawings.find((dr) => dr.id === id) as Drawing), label: live.before }, { label })
    emit('draw.edit', { id, patch: { label } })
  }
  /**
   * The Verlauf row for a SEMANTIC drawing edit — Inhalt (S/W/H/P), Leitung Nr., Stockwerk, the
   * Abschluss (lib/drawingEdit) — written once the editing settles. Same settle-map pattern and
   * the same reason as the workspace's noteEntityEdit: the editor writes per tap, and a burst of
   * taps is ONE edit about one drawing, not a row per tap. Colour/width/dash and geometry stay
   * silent by doctrine (drawingEditChanges ignores them), the label writes its own row
   * (noteDrawingLabel), so calling this on every patch is safe.
   */
  const drawingLogOpen = useRef(new Map<string, { base: Drawing; timer: ReturnType<typeof setTimeout> }>())
  const noteDrawingEdit = (before: Drawing | undefined, patch: Partial<Drawing>) => {
    if (!before) return
    const after = { ...before, ...patch }
    const open = drawingLogOpen.current.get(before.id)
    const base = open?.base ?? before
    if (open) clearTimeout(open.timer)
    const timer = setTimeout(() => {
      drawingLogOpen.current.delete(before.id)
      const changes = drawingEditChanges(base, after)
      if (!changes.length) return
      log('pen', fillTemplate(appConfig.copy.log.entityEdited, {
        name: drawingLogName(after), changes: changes.join(', '),
      }), 'symbol', undefined, undefined, { subjectId: before.id })
    }, DRAW_LOG_SETTLE_MS)
    drawingLogOpen.current.set(before.id, { base, timer })
  }
  const patchDrawing = (patch: Partial<Drawing>) => {
    if (tacticalLocked) return
    const before = drawings.find((dr) => dr.id === selectedDrawingId)
    noteDrawingLabel(before, patch)
    noteDrawingEdit(before, patch)
    emit('draw.edit', { id: selectedDrawingId, patch }); commit((d) => ({ ...d, drawings: d.drawings.map((dr) => (dr.id === selectedDrawingId ? { ...dr, ...patch } : dr)) }))
  }
  // patch a specific drawing by id (e.g. unlock from the on-map lock chip, where the locked
  // shape isn't the selected one)
  const patchDrawingById = (id: string, patch: Partial<Drawing>) => {
    if (tacticalLocked) return
    const before = drawings.find((dr) => dr.id === id)
    noteDrawingLabel(before, patch)
    noteDrawingEdit(before, patch)
    emit('draw.edit', { id, patch }); commit((d) => ({ ...d, drawings: d.drawings.map((dr) => (dr.id === id ? { ...dr, ...patch } : dr)) }))
  }

  // --- direct manipulation of a selected drawing (move body / reshape vertices / delete) ---
  // The move handle and vertex handles both stream new coords continuously, so the whole
  // gesture folds into ONE undo step: 'start' snapshots, 'move' updates silently, 'end' commits.
  const editDrawingCoords = (id: string, coords: LngLat[], phase: 'start' | 'move' | 'end') => {
    if (tacticalLocked) return
    if (phase === 'start') { beginDrag(); return }
    setDocRaw((d) => ({ ...d, drawings: d.drawings.map((dr) => (dr.id === id ? { ...dr, coords } : dr)) }))
    if (phase === 'end') {
      endDrag()
      emit('draw.edit', { id, patch: { coords } })
    }
  }
  // an Absperrkreis's radius, dragged on its ring grip (MapView) — the same phased shape as
  // editDrawingCoords, so the whole drag is one undo step and one Verlauf row
  const editDrawingRadius = (id: string, radiusM: number, phase: 'start' | 'move' | 'end') => {
    if (tacticalLocked) return
    if (phase === 'start') { beginDrag(); return }
    setDocRaw((d) => ({ ...d, drawings: d.drawings.map((dr) => (dr.id === id ? { ...dr, radiusM } : dr)) }))
    if (phase === 'end') {
      endDrag()
      noteDrawingEdit(drawings.find((dr) => dr.id === id), { radiusM })
      emit('draw.edit', { id, patch: { radiusM } })
    }
  }
  // drag a line's distance/text label to a georeferenced anchor (WGS84 [lng,lat]) — stays pinned
  // to the ground at any zoom/bearing; folds into one undo step like editDrawingCoords
  // ('start' snapshots, 'move' streams, 'end' commits).
  const moveLabel = (id: string, at: LngLat | null, phase: 'start' | 'move' | 'end', which: 'label' | 'end' = 'label') => {
    if (tacticalLocked) return
    if (phase === 'start') { beginDrag(); return }
    if (!at) return
    const patch = which === 'end' ? { endLabelAt: at } : { labelAt: at }
    setDocRaw((d) => ({ ...d, drawings: d.drawings.map((dr) => (dr.id === id ? { ...dr, ...patch } : dr)) }))
    if (phase === 'end') { endDrag(); emit('draw.edit', { id, patch }) }
  }
  // insert/delete a vertex are discrete edits → one commit (one undo step) each
  const insertDrawingVertex = (id: string, index: number, c: LngLat) => {
    if (tacticalLocked) return
    const dr = drawings.find((x) => x.id === id); if (!dr) return
    const coords = insertAt(dr.coords, index, c)
    emit('draw.edit', { id, patch: { coords } }); commit((d) => ({ ...d, drawings: d.drawings.map((x) => (x.id === id ? { ...x, coords } : x)) }))
  }
  const deleteDrawingVertex = (id: string, index: number) => {
    if (tacticalLocked) return
    const dr = drawings.find((x) => x.id === id); if (!dr) return
    if (!canDropVertex(dr.kind, dr.coords.length)) return // keep a drawable shape
    const coords = removeVertex(dr.coords, index)
    emit('draw.edit', { id, patch: { coords } }); commit((d) => ({ ...d, drawings: d.drawings.map((x) => (x.id === id ? { ...x, coords } : x)) }))
  }
  /**
   * «Richtung umkehren» — the point order flips, so the Abschluss (arrow / Teilstück-«E») and the
   * end tag move to the other end. The drawn line does not move an inch.
   *
   * ONE undo step for everything the flip touches: this line's own two attachments swap, and every
   * OTHER line hooked to one of its ends is rewritten to the end that kept the coordinate — so a
   * branch on the tip of a hose stays on that tip instead of leaping across the map. The dragged
   * end-tag anchor is dropped: it was pinned beside the OLD end, and the honest fallback is the
   * new one.
   */
  const reverseDrawing = (id: string) => {
    if (tacticalLocked) return
    const dr = drawings.find((x) => x.id === id)
    if (!dr || dr.kind !== 'line' || dr.coords.length < 2) return
    const lines = drawings.filter((d) => d.kind === 'line' && d.coords.length >= 2)
      .map((d) => ({ id: d.id, points: d.coords, startAttachment: d.startAttachment, endAttachment: d.endAttachment }))
    const flip = flipLine({ id, points: dr.coords, startAttachment: dr.startAttachment, endAttachment: dr.endAttachment }, lines)
    // a Wassertransport keeps its water source at the same physical end (lib/hydraulics · flippedRelay)
    const patch: Partial<Drawing> = { coords: flip.points, startAttachment: flip.startAttachment, endAttachment: flip.endAttachment, endLabelAt: undefined,
      ...(dr.relay ? { relay: flippedRelay(dr.relay) } : null) }
    commit((d) => ({ ...d, drawings: d.drawings.map((x) => {
      if (x.id === id) return { ...x, ...patch }
      const mine = flip.incoming.filter((i) => i.lineId === x.id)
      return mine.length
        ? mine.reduce((acc, i) => ({ ...acc, [i.endpoint === 'start' ? 'startAttachment' : 'endAttachment']: i.attachment }), x)
        : x
    }) }))
    // the pinned end label stays with the old end: cleared, as `null` on the wire (JSON drops `undefined`)
    emit('draw.edit', { id, patch: { ...wireFreed(patch), endLabelAt: null } })
    flip.incoming.forEach((i) => emit('draw.edit', { id: i.lineId, patch: { [i.endpoint === 'start' ? 'startAttachment' : 'endAttachment']: i.attachment } }))
  }
  /**
   * «Art: Linie | Wand» on the Karte (sweep 28.10.2026, round 4 – the Plan's row, Lage ↔ Plan
   * parity): the line becomes a Wand in the Grundriss look, or a Linie again – the Plan's own
   * patch (lib/grundriss · wallRolePatch), one ↶, one `draw.edit`. The caller refuses a line
   * `wandBlock` blocks (a Trupp on it, a stack line that climbs storeys). ⚠️ No Verlauf row, like
   * the Plan's switch: it is how the picture is drawn, and noteDrawingEdit would read the hose
   * fields the Wand drops as three edits nobody made («Leitung Nr. entfernt …»).
   */
  const setDrawingWallRole = (id: string, wand: boolean) => {
    if (tacticalLocked) return
    const dr = drawings.find((x) => x.id === id)
    if (!dr || dr.kind !== 'line' || wand === (dr.role === 'wand')) return
    // a Teilstück with lines on its «E» stays one – letting go of them is the Abschluss row's ask
    const hung = !!dr.teilstueck && drawings.some((x) => [x.startAttachment, x.endAttachment].some((a) => a?.target.kind === 'line' && a.target.id === id && a.target.endpoint === 'end'))
    const patch = wallRolePatch(dr, wand, GRUNDRISS_STYLE.wand, DRAW_DEFAULTS, hung)
    emit('draw.edit', { id, patch: wallRoleWire(patch) })
    commit((d) => ({ ...d, drawings: d.drawings.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))
  }
  const deleteDrawing = async (id: string) => {
    if (tacticalLocked) return
    const target = drawings.find((d) => d.id === id)
    const resolvedTarget = resolvedDrawings.find((d) => d.id === id) ?? target
    const incoming = drawings.flatMap((d) => (['start', 'end'] as const).filter((ep) => {
      const a = ep === 'start' ? d.startAttachment : d.endAttachment
      return a?.target.kind === 'line' && a.target.id === id
    }).map((ep) => ({ drawing: d, endpoint: ep })))
    if (incoming.length) {
      const ok = await confirmDialog({
        title: fillTemplate(appConfig.copy.drawingEditor.removeConnectedTitle, { name: target?.label ?? appConfig.copy.drawingEditor.drawing }),
        message: fillTemplate(appConfig.copy.drawingEditor.removeConnectedMessage, { n: incoming.length }),
        confirmLabel: appConfig.copy.remove, cancelLabel: appConfig.copy.cancel, danger: true,
      })
      if (!ok) return
    }
    // one patch per line, both ends in it — applied here and sent as ONE draw.edit (lib/lineAttachments · detachDrawings)
    const released = detachDrawings(drawings.filter((dr) => dr.id !== id), (_, ep, a, coords) => (a.target.kind !== 'line' || a.target.id !== id ? null
      : resolvedTarget?.coords[a.target.endpoint === 'start' ? 0 : resolvedTarget.coords.length - 1] ?? coords[ep === 'start' ? 0 : coords.length - 1]))
    commit((d) => ({ ...d, drawings: d.drawings.filter((dr) => dr.id !== id).map((dr) => withDetach(dr, released)) }))
    emit('draw.delete', { id })
    released.forEach((patch, lineId) => emit('draw.edit', { id: lineId, patch: wireFreed(patch) }))
    if (selectedDrawingId === id) setSelectedDrawingId(null)
    // named like its creation row («Fläche gezeichnet» → «Fläche gelöscht»), not the bare kind-blind
    // «Zeichnung gelöscht» the record used to close on
    log('close', target
      ? fillTemplate(appConfig.copy.log.objectDeleted, { name: drawingLogName(target) })
      : appConfig.copy.log.drawingDeleted, undefined, undefined, undefined, { subjectId: id })
  }

  /** One magnetic attach/detach/retarget gesture = one document checkpoint and one audit event.
   *  The end lands exactly at `fallback` — a hand dragging a followed end off drops it where the
   *  finger let go, and «Hier lösen (Spur behalten)» lets go where the end stands. Only the
   *  explicit «Am Einsatzort» buttons cut a trace back (`releaseGpsOnSite` below). */
  const setDrawingAttachment = (id: string, endpoint: LineEndpoint, attachment: LineAttachment | undefined, fallback: LngLat) => {
    if (tacticalLocked) return
    const key = endpoint === 'start' ? 'startAttachment' : 'endAttachment'
    const previous = drawings.find((dr) => dr.id === id)?.[key]
    commit((d) => ({ ...d, drawings: d.drawings.map((dr) => {
      if (dr.id !== id || dr.kind !== 'line' || dr.coords.length < 2) return dr
      const coords = dr.coords.map((p, i) => i === (endpoint === 'start' ? 0 : dr.coords.length - 1) ? fallback : p)
      return { ...dr, coords, [key]: attachment }
    }) }))
    emit(attachment ? 'draw.attach' : 'draw.detach', { id, endpoint, attachment, fallback })
    // …and an end dragged ONTO a Trupp's marker joins the two, exactly as a fresh stroke's does –
    // and an end let go of that marker parts them again
    if (attachment) onLineAttached?.(id, attachment)
    else if (previous) onLineDetached?.(id, previous)
  }

  /**
   * Detach several GPS ends in ONE store step — the geometry each gets is `shape(drawing, end)`,
   * written with `gesture: false` (restoring or cutting back a line is not a hand placing it: a
   * plan-drawn hose keeps its sheet and storey — docs/tactical-objects.md · «A MACHINE write never flips an
   * anchor»). Returns the lines whose vertices were REMOVED, for the caller's one Verlauf row.
   */
  const detachGpsEnds = (ends: readonly GpsDetach[], shape: (d: Drawing, e: GpsDetach) => { coords: LngLat[]; removed: boolean } | null): Drawing[] | null => {
    if (tacticalLocked || !ends.length) return null
    const work = new Map<string, Drawing>()
    const previous: { id: string; attachment: LineAttachment }[] = []
    const removed = new Map<string, Drawing>()
    const done: GpsDetach[] = []
    for (const e of ends) {
      const cur = work.get(e.id) ?? drawings.find((dr) => dr.id === e.id)
      const key = e.endpoint === 'start' ? 'startAttachment' : 'endAttachment'
      const att = cur?.[key]
      if (!cur || cur.kind !== 'line' || !att) continue
      const next = shape(cur, e)
      if (!next) continue
      work.set(e.id, { ...cur, coords: next.coords, [key]: undefined })
      previous.push({ id: e.id, attachment: att })
      done.push(e)
      if (next.removed && !removed.has(e.id)) removed.set(e.id, cur)
    }
    if (!work.size) return null
    commit((d) => ({ ...d, drawings: d.drawings.map((dr) => {
      const w = work.get(dr.id)
      if (!w) return dr
      const out: Drawing = { ...dr, coords: w.coords }
      for (const e of done) if (e.id === dr.id) out[e.endpoint === 'start' ? 'startAttachment' : 'endAttachment'] = undefined
      return out
    }) }), { gesture: false })
    for (const [id, w] of work) {
      emit('draw.edit', { id, patch: { coords: w.coords } })
      for (const e of done) if (e.id === id) emit('draw.detach', { id, endpoint: e.endpoint, fallback: w.coords[e.endpoint === 'start' ? 0 : w.coords.length - 1] })
    }
    for (const p of previous) onLineDetached?.(p.id, p.attachment)
    return [...removed.values()]
  }

  /**
   * «Am Einsatzort lassen» / «Am Einsatzort lösen»: each end lets go at its ON-SITE point — a
   * followed trace cut back to where it stood before following began (lib/gpsReturn ·
   * onSiteCoords), any other end at `fallback` (the screen's end, on site by the guard). ONE step;
   * a Verlauf row only when a drive was actually taken out of a line (`row` names those lines).
   */
  const releaseGpsOnSite = (ends: readonly GpsDetach[], row: (lines: Drawing[]) => string): boolean => {
    const removed = detachGpsEnds(ends, (d, e) => onSiteCoords(d, e.endpoint, e.fallback ?? d.coords[e.endpoint === 'start' ? 0 : d.coords.length - 1]))
    if (!removed) return false
    if (removed.length) log('pen', row(removed), 'symbol', undefined, undefined, { subjectId: removed[0].id })
    return true
  }

  /**
   * «Zurück auf Stand am Einsatzort»: each line as it stood when following began (`gps.before`),
   * detached right there — ONE store checkpoint (one ↶; the caller names it), ONE Verlauf row
   * (`rowText`), and the snapshot goes with the attachment it lived in. False when none of the
   * ends kept a snapshot.
   */
  const revertGpsFollow = (ends: readonly GpsDetach[], rowText: string): boolean => {
    const done = detachGpsEnds(ends, (d, e) => {
      const coords = revertCoords(d, e.endpoint)
      return coords ? { coords, removed: coords.length < d.coords.length } : null
    })
    if (!done) return false
    log('pen', rowText, 'symbol', undefined, undefined, { subjectId: ends[0].id })
    return true
  }

  /** Several routing patches («Weiter folgen» on every end of one vehicle) — ONE undo step. */
  const patchDrawingsById = (patches: readonly { id: string; patch: Partial<Drawing> }[]) => {
    if (tacticalLocked || !patches.length) return
    for (const { id, patch } of patches) emit('draw.edit', { id, patch })
    commit((d) => ({ ...d, drawings: d.drawings.map((dr) => patches.filter((p) => p.id === dr.id).reduce((acc, p) => ({ ...acc, ...p.patch }), dr)) }))
  }

  // ✓ enabled when the draft is committable: an area needs ≥3 points, a node-mode line ≥2
  const draftActive = isDraftActive(tool, { lineMode, areaMode }, draft.length)
  // node-mode line taps seed the draft (like the area/measure tools), so the freehand gesture is off
  const lineNodes = tool === 'line' && lineMode === 'nodes'
  /** a Punkte drawing is in the hand and not saved yet — its tool tile wears the amber dot */
  const draftOpen = draft.length > 0 && (lineNodes || (tool === 'area' && areaMode === 'nodes'))
  /**
   * WHICH shape the canvas drag lays down right now — a Linie or a Fläche — or null while the drag
   * still pans. The kind, not a bare «armed»: only a Leitung's two ends can carry an attachment
   * (`onFreehand` above hands an area's straight back), so only a line stroke may raise the
   * endpoint magnet (A7 · MapView · onFreehandPointer). It used to be a boolean, the ring was
   * bound unconditionally, and a Fläche drawn across a Hydrant filled a ConnectRing whose
   * attachment was thrown away on release — the Plan has never raised one there.
   */
  const freehandKind: 'line' | 'area' | null =
    tool === 'line' && lineMode === 'freehand' ? 'line'
    : tool === 'area' && areaMode === 'freehand' ? 'area'
    : null

  return {
    draft, setDraft,
    drawColor, drawWidth, drawDashed,
    lineMode, setLineMode, areaMode, setAreaMode,
    draftActive, draftOpen, lineNodes, freehandKind, selectedDrawing,
    commitDraft, settleDraft, noteDrawingEdit, createLine, createArea, onFreehand, setDraftPointAttachment, createCircle,
    /** the claim the node draft's first tap banked — the magnet judges every later tap by it */
    draftStartAttachment: draftAttachments.startAttachment, patchDrawing, patchDrawingById,
    patchDrawingLabelLive, commitDrawingLabel,
    editDrawingCoords, editDrawingRadius, moveLabel, insertDrawingVertex, deleteDrawingVertex, deleteDrawing, reverseDrawing, setDrawingWallRole, setDrawingAttachment, revertGpsFollow, releaseGpsOnSite, patchDrawingsById,
  }
}
