// The Karte's tool docks and rail: the bottom-centre dock of whichever tool is armed (symbol,
// lasso, line, area, note, team, circle, measure, shape), the tool rail itself (the slim set on a
// locked surface), the symbol palette and the «Welcher Trupp?» picker. Split out of
// IncidentWorkspace (E1, 09.10.2026) verbatim; the tool state and every handler stay the
// workspace's and come in as props (`mapUI` gates each piece exactly as before).

import type { Dispatch, SetStateAction, RefObject } from 'react'
import type { MapRef } from 'react-map-gl/maplibre'
import { ArmedSymbolGlyph, ArmedToolPill } from '../components/ArmedToolPill'
import { type ViewsApi, MapViewsButton } from '../components/MapViewsMenu'
import { MeasurePanel } from '../components/MeasurePanel'
import { Palette } from '../components/Palette'
import { ToolDock } from '../components/ToolDock'
import { ToolRail } from '../components/ToolRail'
import { appConfig } from '../config/appConfig'
import { armedToolIcon, armedToolName } from '../lib/armedTool'
import { isAtemschutzTrupp } from '../lib/atemschutz'
import { formatSymbolName } from '../lib/format'
import { Icon } from '../lib/icons'
import { layerPresetLabel, type LayerPreset } from '../lib/layerPreset'
import { Overlay } from '../lib/overlays'
import type { PlacedTrupp } from '../lib/placedTrupps'
import { ShapeGlyph, SHAPE_DEFS, SHAPE_TWO_POINT } from '../lib/shapes'
import type { useCoordPicker } from '../lib/useCoordPicker'
import { adoptedRelay, type useMeasure } from '../lib/useMeasure'
import type { useSymbols } from '../lib/useSymbols'
import type { LngLat, MapTool, ShapeKind, LineAttachment, Drawing, Trupp, GeoTrailPoint } from '../types'
import type { RailLabels } from '../lib/prefs'

export interface MapToolDocksProps {
  mapUI: boolean
  tool: MapTool
  pending: string | null
  setPending: Dispatch<SetStateAction<string | null>>
  setTool: Dispatch<SetStateAction<MapTool>>
  placeLock: boolean
  setPlaceLock: Dispatch<SetStateAction<boolean>>
  lineMode: 'freehand' | 'nodes'
  /** leave the draft in the hand – asks about a committable one (useMapDrawing · settleDraft) */
  settleDraft: () => void
  setLineMode: Dispatch<SetStateAction<'freehand' | 'nodes'>>
  draftActive: boolean
  /** a Punkte drawing is open in the hand — the armed tile's amber dot */
  draftOpen: boolean
  commitDraft: () => void
  areaMode: 'freehand' | 'nodes'
  setAreaMode: Dispatch<SetStateAction<'freehand' | 'nodes'>>
  setTeamPick: Dispatch<SetStateAction<LngLat | null>>
  placed: PlacedTrupp[]
  setFindTruppOpen: Dispatch<SetStateAction<boolean>>
  measure: ReturnType<typeof useMeasure>
  pendingShape: ShapeKind | null
  setPendingShape: Dispatch<SetStateAction<ShapeKind | null>>
  setRotStart: Dispatch<SetStateAction<LngLat | null>>
  rotStart: LngLat | null
  tacticalLocked: boolean
  createLine: (coords: LngLat[], attachments?: { startAttachment?: LineAttachment; endAttachment?: LineAttachment }, opts?: { select?: boolean; props?: Pick<Drawing, 'hose' | 'relay'> }) => Drawing | null
  createArea: (coords: LngLat[], opts?: { select?: boolean }) => Drawing | null
  replayActive: boolean
  railLabels: RailLabels
  slimMapTools: ({ readonly id: 'select'; readonly icon: 'select'; readonly label: 'Auswahl'; readonly kind: 'tool'; readonly alt: { readonly id: 'lasso'; readonly icon: 'marquee'; readonly label: 'Mehrfach' } } | { readonly id: 'symbol-slot'; readonly slot: true; readonly icon: ''; readonly label: '' } | { readonly id: 'line'; readonly icon: 'pen'; readonly label: 'Linie'; readonly kind: 'tool' } | { readonly id: 'area'; readonly icon: 'area'; readonly label: 'Fläche'; readonly kind: 'tool' } | { readonly id: 'circle'; readonly icon: 'circle'; readonly label: 'Absperrkreis'; readonly kind: 'tool' } | { readonly id: 'note'; readonly icon: 'type'; readonly label: 'Notiz'; readonly kind: 'tool' } | { readonly id: 'team'; readonly icon: 'flag'; readonly label: 'Trupp'; readonly kind: 'tool' } | { readonly id: 'measure'; readonly icon: 'measure'; readonly label: 'Messen'; readonly kind: 'tool' })[]
  pick: (id: string) => void
  panel: 'layers' | null
  layersPreset: LayerPreset
  togglePanel: (name: 'layers') => void
  viewsApi: ViewsApi
  view: { bearing: number; center: LngLat; zoom: number }
  readOnly: boolean
  isEl: boolean
  viewsOpen: boolean
  sharePick: 'ask' | 'pick' | 'rename' | null
  shareParent: 'settings' | 'views' | 'status' | null
  toggleViews: (open: boolean) => void
  coord: ReturnType<typeof useCoordPicker>
  mapRef: RefObject<MapRef | null>
  paletteOpen: boolean
  sym: ReturnType<typeof useSymbols>
  setPaletteOpen: Dispatch<SetStateAction<boolean>>
  pickShape: (kind: ShapeKind) => void
  teamPick: LngLat | null
  trupps: Trupp[]
  /** trupp id → the colour it wears on the Lage / plan (useTruppActions · truppColors) – the
   *  «Welcher Trupp?» rows lead with it as the hollow identity ring */
  truppColors: Record<string, string>
  placeTruppOnMap: (id: string, atCoord?: LngLat, revive?: { id: string; trail: GeoTrailPoint[] }) => string | undefined
  placeGenericTeam: (c: LngLat) => void
}

export function MapToolDocks({
  mapUI, tool, pending, setPending, setTool, placeLock, setPlaceLock, lineMode, settleDraft,
  setLineMode, draftActive, draftOpen, commitDraft, areaMode, setAreaMode, setTeamPick, placed, setFindTruppOpen,
  measure, pendingShape, setPendingShape, setRotStart, rotStart, tacticalLocked, createLine,
  createArea, replayActive, railLabels, slimMapTools, pick, panel, layersPreset, togglePanel, viewsApi,
  view, readOnly, isEl, viewsOpen, sharePick, shareParent, toggleViews, coord, mapRef, paletteOpen,
  sym, setPaletteOpen, pickShape, teamPick, trupps, truppColors, placeTruppOnMap, placeGenericTeam,
}: MapToolDocksProps) {
  return (
    <>
      {/* the armed tool's readout — ONE pill, bottom centre, glyph + name (3am sweep point 3,
          23.10.2026). A symbol wears its own SVG and name, the others their rail glyph and word;
          Linie/Fläche say their input mode. The symbol tool has no dock any more: the pill IS
          its readout, «Mehrere platzieren» stands beside it, and the way out is the ✕ beside that
          (27.10.2026), the rail tile or Escape. Never while Messen is armed, on any size – its results
          panel stands in that spot and the pill covered its numbers (sweep 30.10.2026 #3). */}
      {mapUI && tool !== 'select' && tool !== 'measure' && (() => {
        if (tool === 'symbol') {
          if (!pending) return null
          // the ✕ puts it down exactly as Escape does (useMapActions · cancelPlacement) – the Plan's twin
          return <ArmedToolPill glyph={<ArmedSymbolGlyph svg={sym.byName[pending] ?? ''} />} name={formatSymbolName(pending) || pending}
            lock={{ on: placeLock, onToggle: () => setPlaceLock((v) => !v) }}
            onClose={() => { setPending(null); setPendingShape(null); setRotStart(null); setTool('select') }} />
        }
        if (tool === 'shape') {
          if (!pendingShape) return null
          return <ArmedToolPill glyph={<ShapeGlyph kind={pendingShape} color="currentColor" aspect={SHAPE_DEFS[pendingShape].defaultAspect} fit />}
            name={appConfig.copy.shapes.names[pendingShape] ?? appConfig.copy.shapes.kindLabel} />
        }
        const name = armedToolName(tool, appConfig.copy.mapTools, { lineMode, areaMode })
        const icon = armedToolIcon(tool, appConfig.copy.mapTools)
        if (!name || !icon) return null
        return <ArmedToolPill glyph={<Icon id={icon} />} name={name} />
      })()}
      {/* active-tool option docks — the right-edge column (a bottom bar on the phone) */}
      {mapUI && tool === 'lasso' && (
        <ToolDock groups={[
          [{ type: 'close', onClick: () => setTool('select') }],
          [{ type: 'info', text: appConfig.copy.dockHints.lasso }],
        ]} />
      )}
      {mapUI && tool === 'line' && (
        <ToolDock groups={[
          [{ type: 'close', onClick: () => { setTool('select'); settleDraft() } }],
          // input mode: Freihand (drag) ↔ Punkte (tap each vertex, ✓ to finish)
          [
            { type: 'toggle', icon: 'pen', label: appConfig.copy.drawingEditor.modeFreehand, on: lineMode === 'freehand', onClick: () => { setLineMode('freehand'); settleDraft() } },
            { type: 'toggle', icon: 'polygon', label: appConfig.copy.drawingEditor.modeNodes, on: lineMode === 'nodes', onClick: () => setLineMode('nodes') },
            ...(lineMode === 'nodes' ? [{ type: 'go' as const, disabled: !draftActive, onClick: commitDraft }] : []),
          ],
          // «D pur» (09.09.): no colour/width/style here — the finished line lands selected in
          // the DrawEditor (useMapDrawing · one-shot to Select), which is where the styling
          // lives; every new line starts from the plain default (useMapDrawing · DRAW_DEFAULTS)
          [{ type: 'info', text: lineMode === 'nodes' ? appConfig.copy.dockHints.lineNodes : appConfig.copy.dockHints.lineFreehand }],
        ]} />
      )}
      {mapUI && tool === 'area' && (
        <ToolDock groups={[
          [{ type: 'close', onClick: () => { setTool('select'); settleDraft() } }],
          [
            { type: 'toggle', icon: 'pen', label: appConfig.copy.drawingEditor.modeFreehand, on: areaMode === 'freehand', onClick: () => { setAreaMode('freehand'); settleDraft() } },
            { type: 'toggle', icon: 'polygon', label: appConfig.copy.drawingEditor.modeNodes, on: areaMode === 'nodes', onClick: () => setAreaMode('nodes') },
            ...(areaMode === 'nodes' ? [{ type: 'go' as const, disabled: !draftActive, onClick: commitDraft }] : []),
          ],
          // «D pur» like the line dock above: styling happens in the editor afterwards
          [{ type: 'info', text: appConfig.copy.dockHints.area }],
        ]} />
      )}
      {/* Notiz armed — «D pur» (09.09.) here too: a fresh note opens its detail panel with the
          caret already in the text (notePlacedId), and Zettel/Klartext, S/M/L and the colour
          live THERE — where they also write the next note's defaults. */}
      {mapUI && tool === 'note' && (
        <ToolDock groups={[
          [{ type: 'close', onClick: () => setTool('select') }],
          [{ type: 'info', text: appConfig.copy.dockHints.note }],
        ]} />
      )}
      {/* Trupp — the one tool that had NO dock (testing feedback 2026-07-15): every active
          tool shows a ✕ + ⓘ so nobody is stranded wondering what the mode does */}
      {mapUI && tool === 'team' && (
        <ToolDock groups={[
          [{ type: 'close', onClick: () => { setTeamPick(null); setTool('select') } }],
          // ⚠️ «Trupp finden» lives HERE, on the tool the question is about — not in the left
          // rail, which navigates between surfaces. Reaching for the Trupp tool is already the
          // gesture for «etwas mit einem Trupp», and placing one and finding one are the two
          // things that gesture can mean. Disabled rather than hidden while nothing is placed:
          // on the tool's own dock, its absence would read as a tool that lost a button.
          [{
            // its OWN glyph (29.09.2026, T8), not the lens the Suche's tile wears right below
            type: 'action', icon: 'trupp-find', label: appConfig.copy.truppFinder.title,
            disabled: placed.length === 0, onClick: () => setFindTruppOpen(true),
          }],
          [{ type: 'info', text: appConfig.copy.dockHints.team }],
        ]} />
      )}
      {mapUI && tool === 'circle' && (
        <ToolDock groups={[
          [{ type: 'close', onClick: () => setTool('select') }],
          [{ type: 'info', text: appConfig.copy.dockHints.circle }],
        ]} />
      )}
      {mapUI && tool === 'measure' && (
        <ToolDock groups={[
          [{ type: 'close', onClick: () => { measure.reset(); setTool('select') } }],
          [
            { type: 'toggle', icon: 'measure', label: appConfig.copy.measure.modeLine, on: measure.mode === 'line', onClick: () => measure.setMode('line') },
            { type: 'toggle', icon: 'area', label: appConfig.copy.measure.modeArea, on: measure.mode === 'area', onClick: () => measure.setMode('area') },
          ],
          [{ type: 'action', icon: 'trash', label: appConfig.copy.measure.clear, disabled: !measure.path.length, onClick: () => measure.setPath(() => []) }],
          [{ type: 'info', text: appConfig.copy.dockHints.measure }],
        ]} />
      )}
      {mapUI && tool === 'shape' && pendingShape && (
        <ToolDock groups={[
          [{ type: 'close', onClick: () => { setPendingShape(null); setRotStart(null); setTool('select') } }],
          // currentColor, not #fff: the dock is light by day since 20.10.2026 (3am sweep, nit)
          [{ type: 'glyph', node: <ShapeGlyph kind={pendingShape} color="currentColor" aspect={SHAPE_DEFS[pendingShape].defaultAspect} fit /> }],
          // a two-point shape is placed by naming two places, so «mehrere nacheinander» has no
          // meaning for it — the «Mehrere platzieren» toggle is simply not offered
          ...(SHAPE_TWO_POINT[pendingShape] ? [] : [[{ type: 'toggle' as const, icon: 'place-repeat', label: appConfig.copy.keepPlacing, on: placeLock, onClick: () => setPlaceLock((v) => !v) }]]),
          // …and the hint says which of the two taps is due
          [{ type: 'info', text: !SHAPE_TWO_POINT[pendingShape] ? appConfig.copy.dockHints.shape
            : rotStart ? appConfig.copy.dockHints.rotationEnd : appConfig.copy.dockHints.rotationStart }],
        ]} />
      )}
      {mapUI && tool === 'measure' && (
        <MeasurePanel mode={measure.mode} coords={measure.path} profile={measure.profile} profileLoading={measure.loading}
          relay={measure.relay}
          // «Als Linie/Fläche übernehmen»: the measured points become a real line resp. Fläche
          // (createLine/createArea drop into Select with it active, so its editor opens straight
          // away). Hidden on a locked surface — there, Messen is a question the EL may ask, not a
          // way to draw — and while the measurement is still too short to be one. An opened
          // Wassertransport goes WITH the line: its hose, flow, source and the pumps moved by hand
          // – and with «Pumpen auf Karte» on (useMeasure · adoptedRelay, owner 05.11.2026): the
          // pumps Messen showed stay on the map as the Leitung's own (lib/linePumps). The same call is
          // the Wassertransport's «Als Leitung auf die Karte» (MeasurePanel · WaterRelay).
          onAdopt={!tacticalLocked && measure.path.length >= (measure.mode === 'line' ? 2 : 3)
            ? () => {
              const coords = measure.path
              const relay = adoptedRelay(measure.relay)
              measure.reset()
              if (measure.mode === 'line') createLine(coords, undefined, { props: relay })
              else createArea(coords)
            }
            : undefined} />
      )}

      {/* the Verlauf drawer now docks INBOARD of this rail (see .journal-drawer /
          .journal-scrim), so the rail — and its pinned zoom/fit footer — stays put
          instead of being buried + replaced by a floating cluster. */}
      {/* the rail is the SAME object for everyone — a locked surface just gets the slim tool set
          (map: Auswahl · Messen; plan: Auswahl), in the same place, with the same footer. Replay is the exception:
          its scrubber owns the bottom band that the Messen readout would land in. */}
      {mapUI && !replayActive && (
        <ToolRail
          labels={railLabels}
          className="tool-rail"
          primary={appConfig.copy.primarySymbol}
          tools={tacticalLocked ? slimMapTools : appConfig.copy.mapTools}
          /* ⚠️ the armed tool, and nothing else. This used to read
             `voice.recording ? 'audio' : tool`, but there is no 'audio' entry in `mapTools` — so
             starting a Sprachnotiz matched nothing and the armed tool went DARK mid-recording, on
             the surface where «was macht mein nächster Tipp» is the whole question. Recording is
             already stated where it is started: the TopBar +Eintrag button, and the FabEntry on a
             phone. */
          active={tool}
          open={draftOpen}
          onPick={pick}
          footer={(() => {
            const c = appConfig.copy.nav
            return (
              <>
                {/* Ebenen — PINNED so it never scrolls out of reach on short iPads; the
                    Basiskarte choice lives inside its panel (the BaseSwitcher popover and
                    the standalone Koordinaten button are folded away — coords is a row in
                    the compass menu now, testing feedback 2026-07-14) */}
                {/* which preset the Ebenen match is lit in the panel and said in the name — no mark
                    on the glyph (05.10.2026, owner: «no need for this indicator») */}
                <button className={`vrail-nbtn vrail-layers ${panel === 'layers' ? 'on' : ''}`} title={`${appConfig.copy.panels.layers} · ${layerPresetLabel(layersPreset)}`} aria-label={`${appConfig.copy.panels.layers} – ${layerPresetLabel(layersPreset)}`} aria-pressed={panel === 'layers'} onClick={() => togglePanel('layers')}><span className="vrail-glyph"><Icon id="layers" /></span><span className="vrail-label">{appConfig.copy.panels.layers}</span></button>
                {/* multi-purpose compass: always shown, rotates to the live bearing, and opens the
                    saved-views menu (Nach Norden · Einpassen · Standort · Koordinaten · saved
                    framings · Ansicht speichern). `|| isEl` as on MapUtility's twin: saved views
                    live in the shared blob, which the el record slice never pushes. */}
                <MapViewsButton api={viewsApi} bearing={view.bearing} readOnly={readOnly || isEl} variant="rail" btnClassName="vrail-nbtn vrail-views" activeClassName="on" glyphClassName="vrail-compass" label={appConfig.copy.mapViews.title} open={viewsOpen && !(sharePick && shareParent === 'views')} onOpenChange={toggleViews} coordsOn={coord.mode !== 'off'} onToggleCoords={coord.cycle} />
                {/* zoom ±: desktop only (.vrail-zoom is hidden under 1024px). Every touch form
                    factor pinches, and on a tablet the two buttons cost rail space that the
                    tools above need more. «+» on top, as on every map (owner pick C9, 05.11.2026).
                    The pair is its own group, split from the compass by the rails' one hairline
                    (owner pick C12) – a .vrail-zoom itself, so it goes wherever the buttons go. */}
                <span className="vrail-sep rail-sep vrail-zoom" aria-hidden />
                <button className="vrail-nbtn vrail-zoom" title={c.zoomIn} aria-label={c.zoomIn} onClick={() => mapRef.current?.zoomIn()}><span className="vrail-glyph"><Icon id="plus" /></span><span className="vrail-label">{c.zoomIn}</span></button>
                <button className="vrail-nbtn vrail-zoom" title={c.zoomOut} aria-label={c.zoomOut} onClick={() => mapRef.current?.zoomOut()}><span className="vrail-glyph"><Icon id="minus" /></span><span className="vrail-label">{c.zoomOut}</span></button>
              </>
            )
          })()}
        />
      )}

      {mapUI && paletteOpen && sym.ready && (
        <Palette
          sym={sym}
          onPick={(name) => { setTool('symbol'); setPending(name); setPaletteOpen(false) }}
          onPickShape={pickShape}
          // PHONE: Linie · Fläche · Absperrkreis · Notiz · Trupp are the sheet's first section
          // there, because they have left the bar for it (lib/toolFold). `pick` closes the sheet.
          tools={appConfig.copy.mapTools}
          onPickTool={pick}
          onClose={() => setPaletteOpen(false)}
        />
      )}

      {/* map Team tool — «Welcher Trupp?» picker over the tapped spot; the SAME picker
          (markup + classes) the plan's Team tool shows, kept in lockstep. A tracked Trupp
          routes through placeTruppOnMap (one-place rule); «Neues Team» drops an untracked
          marker. One-shot: after placing, drop back to Auswahl with the marker selected. */}
      {mapUI && teamPick && (
        /* ⚠️ Modal → lib/overlays, in lockstep with the plan's twin: focus trap + restore,
           scroll-lock, Esc and backdrop dismissal. The hand-rolled scrim both used to share had
           none of them. (docs/ui-conventions.md · Overlays: the hand-rolled carve-out is the NON-modal tool docks.) */
        <Overlay
          open
          onClose={() => { setTeamPick(null); setTool('select') }}
          className="wb-trupp-pick ui-dialog"
          ariaLabel={appConfig.copy.whiteboard.selectTrupp}
        >
          <div className="wb-trupp-pick-head">{appConfig.copy.whiteboard.selectTrupp}</div>
          {/* A Trupp lives at exactly ONE place, so picking one that is already on the map
              does not add a second marker — it MOVES the existing one, silently, and the
              operator who wanted a second Trupp has just relocated the first. Placed ones
              are greyed out and say where they are instead. A Trupp on a PLAN stays
              selectable: moving it to the map is a real thing to want.
              ⚠️ A Trupp that is OUT is offered too (05.09.). It used to be filtered away, which
              meant the crew standing at the vehicle — the one about to go back in, the one whose
              position somebody is asking about — was the one name the picker refused to show. It
              carries its «Draussen» so the choice is made knowingly; placing a marker changes no
              clock (lib/placedTrupps · the join doctrine). */}
          {trupps.map((t) => {
            const here = !!t.entityId
            return (
              <button
                key={t.id} className={`wb-trupp-opt${here ? ' placed' : ''}`} disabled={here}
                onClick={() => { placeTruppOnMap(t.id, teamPick); setTeamPick(null); setTool('select') }}
              >
                <span className="wb-trupp-ring" style={{ color: truppColors[t.id] }} /><b>{t.name}</b>
                {/* «AS» — see the plan's twin of this picker (Whiteboard · wb-trupp-as) */}
                {isAtemschutzTrupp(t) && <span className="wb-trupp-as" title={appConfig.copy.atemschutz.kindAtemschutz}>{appConfig.copy.atemschutz.asMark}</span>}
                {here
                  ? <i>{appConfig.copy.whiteboard.truppPlacedHere}</i>
                  : t.status === 'raus' ? <i>{appConfig.copy.atemschutz.status.raus}</i>
                  : t.lineNumber ? <i>Ltg {t.lineNumber}</i> : null}
              </button>
            )
          })}
          <button className="wb-trupp-opt wb-trupp-generic" onClick={() => { placeGenericTeam(teamPick); setTeamPick(null); setTool('select') }}>
            <Icon id="plus" />{appConfig.copy.whiteboard.newTeam}
          </button>
        </Overlay>
      )}
    </>
  )
}
