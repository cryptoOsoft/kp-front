import { Fragment, useEffect, useRef } from 'react'
import type { LayerDef } from '../types'
import { Icon } from '../lib/icons'
import { appConfig } from '../config/appConfig'
import { Chip } from './Chip'
import { Slider } from './Slider'
import { SheetGrab, useSwipeDismiss } from '../lib/overlays'
import type { TwinLayerRow } from '../lib/georefTwins'
import type { LayerPreset } from '../lib/layerPreset'
import { useLayerData, type LayerData } from '../lib/layerData'
import { ShellLoader } from './ShellLoader'
import { fillTemplate, fmtFileSize } from '../lib/format'

/** The «Niederschlag (Radar)» row (components/WeatherLayer) — a device pref routed by id like a
 *  twin, with the colour key under it while it is on. Absent when the deployment serves no
 *  weather layer (WEATHER_LAYER_ENABLED=false): a row that can never show anything is not drawn. */
export interface WeatherLayerRow extends TwinLayerRow {
  attribution: string
  legend: { min_mm_h: number; color: string }[]
}

const NO_GROUPS: readonly string[] = []

interface Props {
  layers: LayerDef[]
  onToggle: (id: LayerDef['id']) => void
  onOpacity: (id: LayerDef['id'], v: number) => void
  /** Georeferenz twin layers (lib/georefTwins): on the Karte one row per georeferenced plan, on
   *  a Plan the two things the map lends the sheet. Rendered as ordinary layer rows in their own
   *  groups — a projection is switched exactly like anything else on this panel — with one extra
   *  quiet line naming the fit it mirrors through. The symbol rows carry NO opacity slider —
   *  a mirrored symbol is either shown or it is not; only the raster backdrop rows (a plan's
   *  own sheet under the map) bring an `opacity`, and those get the same slider as any overlay.
   *  ⚠️ They persist elsewhere than `layers` does (device pref, not the workspace blob), so the
   *  toggle routes by id — see IncidentWorkspace · toggleLayer. */
  twins?: TwinLayerRow[]
  /** the group the twin rows belong BEHIND, by name. On the Karte that is «Lage»: a mirrored
   *  plan symbol is a tactical symbol like the ones in that group, and the panel reads
   *  Lage → Pläne → the deployment's own overlays instead of hiding the twins past Wasser and
   *  Gefahren. Absent ⇒ the twin groups go last, which is right on the Plan surface (where the
   *  only other groups are the sheet's own). */
  twinsAfterGroup?: string
  /** twin groups, by name, that go FIRST after the base map — under the quick-taps and
   *  «Grundkarte», above every other group. «Karte & Objekte» puts its «Station» group there
   *  (owner, review round 4, 17.10.2026: «move "station" up in ebenen all the way to the top»;
   *  round 5, 18.10.: «move grundkarte above station»); the Einsatz passes none, so its order is
   *  unchanged. */
  leadTwinGroups?: readonly string[]
  /** layer groups, by name, drawn right AFTER the anchored twins (`twinsAfterGroup`) instead of
   *  where the layer list has them. The Einsatz puts its «Station» group («Unterirdische Bauten»)
   *  there (owner, review round 6, 18.10.2026: «move unterirdische bauten below pläne in the
   *  emergency version»). Without anchored twins the groups stay where they are. */
  groupsAfterTwins?: readonly string[]
  /** round ✕ in the title row — dock chrome parity with the views popover / tool docks */
  onClose?: () => void
  /** Ebenen quick-taps (field ask 07.09.): flip every overlay at once / return to the Einsatz
   *  category's default set. Karte panels only (the Einsatz's and «Karte & Objekte»'s, there over
   *  its own default set — lib/karte/layerPresets) — the Plan panel's rows are lent twins with their
   *  own persistence, where «alle» has nothing coherent to mean. All three or none. */
  onShowAll?: () => void
  onHideAll?: () => void
  onReset?: () => void
  /** which of the three the layers on screen match (lib/layerPreset): that quick-tap is drawn
   *  selected, none of them for a hand-switched set (05.10.2026, owner: «ebenen should have an
   *  indication when using standard or all on / off») */
  preset?: LayerPreset
  /** the weather radar row, last on the panel (its own group, «Wetter») */
  weather?: WeatherLayerRow
  /** one quiet line above the credits — «Karte & Objekte» says there that its Ebenen are its own */
  note?: string
}

export function LayerPanel({ layers, onToggle, onOpacity, twins = [], twinsAfterGroup, leadTwinGroups = NO_GROUPS, groupsAfterTwins = NO_GROUPS, onClose, onShowAll, onHideAll, onReset, preset, weather, note }: Props) {
  /* One transparency row, for a real `LayerDef` and for a Georeferenz twin alike — the twin ids
     are not `LayerDef` ids and persist elsewhere (georefTwins · isTwinLayerId → the device's
     `twinLayerOpacity`), but the row is the panel's, so both go through the same control and the
     same `onOpacity(id, …)`. The value reads out live beside it while the finger moves. */
  const opacityRow = (id: string, opacity: number, label: string) => (
    <div className="opacity" onClick={(e) => e.stopPropagation()}>
      <Slider value={opacity} onChange={(v) => onOpacity(id, v)}
        ariaLabel={`${label} – ${appConfig.copy.layerPanel.opacity}`} valueText={`${opacity} %`} />
      {/* the live read-out — its own class, never a bare `span`: the row's styling would
          otherwise reach into the Slider's own spans (see 05-navrail.css · .opacity-v) */}
      <span className="opacity-v">{opacity}%</span>
    </div>
  )
  /* What a GeoJSON Ebene is doing, in its own row (owner, review round 7: «Leitungen loads quite
     a lot of data … I need some sort of loading state»). The app fetches those files itself
     (lib/layerData), so the row can name the bytes and fill a bar — the app's own loader where
     the eye looks for one, the figures inline in the row, nothing added under it. A loading row
     stays a button: switching the layer off again must not wait for the download. */
  const loads = useLayerData()
  const L = appConfig.copy.layerPanel
  const loadNote = (load: LayerData): { sub: string; pct: number | null } | null => {
    if (load.state === 'loading') {
      return {
        sub: load.total
          ? fillTemplate(L.loadingOf, { done: fmtFileSize(load.loaded), total: fmtFileSize(load.total) })
          : L.loading,
        pct: load.total ? Math.min(100, Math.round((load.loaded / load.total) * 100)) : null,
      }
    }
    if (load.state === 'empty') return { sub: L.loadEmpty, pct: null }
    if (load.state === 'failed') return { sub: L.loadFailed, pct: null }
    return null
  }
  /* The row's icon slot carries the snail while its file is on the way; the status line and the
     determinate bar sit in the name column, so the row keeps its height and its tap target. */
  const loadRow = (l: LayerDef) => {
    const load = l.geojson && l.visible ? loads.get(l.id) : undefined
    const note = load ? loadNote(load) : null
    return { loading: load?.state === 'loading', note }
  }
  const bases = layers.filter((l) => l.base)
  // What the map on screen is made of, credited: every VISIBLE layer's attribution, split at its
  // commas so «© OpenStreetMap-Mitwirkende» from two layers is named once. On a phone this is
  // the only place the credits show – the map's own ⓘ is hidden there (15-mobile.css).
  const credits = [...new Set([...layers.filter((l) => l.visible && l.attribution).map((l) => l.attribution!),
    ...(weather?.visible ? [weather.attribution] : [])]
    .flatMap((a) => a.split(/,\s*/)).map((c) => c.trim()).filter(Boolean))]
    // …and a «©» never ends a line on its own: it is glued to the name it belongs to
    .map((c) => c.replace(/^©\s+/, '©\u00a0'))
  const groups = layers.filter((l) => !l.base).reduce<Record<string, LayerDef[]>>((acc, l) => {
    (acc[l.group] ??= []).push(l)
    return acc
  }, {})
  const twinGroups = twins.reduce<Record<string, TwinLayerRow[]>>((acc, t) => {
    (acc[t.group] ??= []).push(t)
    return acc
  }, {})
  /* the Georeferenz twins — same row, same eye, same keyboard path as every layer above; the
     second line names the fit, because «gespiegelt» without «wie gut» is a claim without a
     measurement (see georefTwins · twinFitNote). Built once and dropped in wherever
     `twinsAfterGroup` says they belong. */
  const twinBlock = ([group, rows]: [string, TwinLayerRow[]]) => (
    <Fragment key={`twin:${group}`}>
      <div className="lgroup">{group}</div>
      {rows.map((t) => (
        <Fragment key={t.id}>
          <button
            type="button"
            className={`lrow lrow-twin ${t.visible ? '' : 'off'}`}
            style={{ appearance: 'none', WebkitAppearance: 'none', border: 'none', width: '100%', textAlign: 'left', font: 'inherit', color: 'inherit' }}
            aria-pressed={t.visible}
            aria-label={`${t.label} – ${t.visible ? appConfig.copy.layerPanel.stateVisible : appConfig.copy.layerPanel.stateHidden}`}
            onClick={() => onToggle(t.id)}
          >
            <span className="ic" style={t.swatch ? { color: t.swatch } : undefined}><Icon id={t.icon} /></span>
            <span className="name">{t.label}{t.sub && <small>{t.sub}</small>}</span>
            <span className="eye"><Icon id={t.visible ? 'eye' : 'eyeoff'} /></span>
          </button>
          {t.opacity !== undefined && t.visible && opacityRow(t.id, t.opacity, t.label)}
        </Fragment>
      ))}
    </Fragment>
  )
  const twinEntries = Object.entries(twinGroups)
  const leadBlocks = twinEntries.filter(([g]) => leadTwinGroups.includes(g)).map(twinBlock)
  const twinBlocks = twinEntries.filter(([g]) => !leadTwinGroups.includes(g)).map(twinBlock)
  /* …unless the anchor group is not on this panel at all (a deployment without it, or the Plan
     surface): then they still have to appear, so they go last. */
  const twinsAnchored = !!twinsAfterGroup && twinBlocks.length > 0 && twinsAfterGroup in groups
  // the groups that follow the twins: lifted out of their place and set right after the anchor
  // group, whose fragment ends with the twins — so they read «… Lage · Pläne · Station …»
  const groupEntries = (() => {
    const all = Object.entries(groups)
    if (!twinsAnchored || !groupsAfterTwins.length) return all
    const moved = all.filter(([g]) => groupsAfterTwins.includes(g) && g !== twinsAfterGroup)
    const rest = all.filter(([g]) => !moved.some(([m]) => m === g))
    const at = rest.findIndex(([g]) => g === twinsAfterGroup)
    return [...rest.slice(0, at + 1), ...moved, ...rest.slice(at + 1)]
  })()

  // opening the panel (e.g. via the [[B]] shortcut) drops focus onto the first layer row so the
  // whole list is immediately Tab/Enter navigable from the keyboard — the rows are real buttons.
  const cardRef = useRef<HTMLDivElement>(null)
  useEffect(() => { cardRef.current?.querySelector<HTMLButtonElement>('.lrow')?.focus() }, [])
  /* On a phone the card IS a bottom sheet (29.09.2026, owner: «ebenen, search, etc. should be a
     slide-up rather than a modal» — 15-mobile · .layers-card): push it down and it goes, like every
     other phone sheet. The gesture measures that the card sits on the bottom edge, so the tablet's
     side card never has it. */
  const swipe = useSwipeDismiss({ onClose: onClose ?? (() => {}), enabled: !!onClose })

  // `lc-panel` tells Ebenen apart from the other cards that wear `.layers-card` (the Karte's
  // Gefahrgut): it is opened from the view bar, so on a tablet it opens upward from there (05-navrail)
  return (
    <div className="layers-card lc-panel" ref={cardRef} {...swipe}>
      <SheetGrab />
      <div className="lc-title">
        {appConfig.copy.panels.layers}
        {onClose && <button type="button" className="ip-x lc-x" aria-label={appConfig.copy.closeDialog} onClick={onClose}><Icon id="close" /></button>}
      </div>
      <div className="lc-body">
        {/* quick-taps under the title: the whole panel in one gesture — all on, all off, back to
            the Einsatz default. Rows stay the fine control; these answer «too much on the map»
            and «where did everything go» without ten taps. */}
        {onShowAll && onHideAll && onReset && (
          <div className="lc-quick">
            {/* words only (22.09.2026): three columns of the dock (264px then) gave each button ~67px, and the
                eye / eye-off / undo glyphs took 20 of them — «Standard» ran past its edge and even
                «Alle ein» broke in two. The rows' eyes already say what «ein / aus» means. */}
            <Chip selected={preset === 'all'} onClick={onShowAll}>{appConfig.copy.layerPanel.showAll}</Chip>
            <Chip selected={preset === 'none'} onClick={onHideAll}>{appConfig.copy.layerPanel.hideAll}</Chip>
            <Chip selected={preset === 'standard'} onClick={onReset}>{appConfig.copy.layerPanel.reset}</Chip>
          </div>
        )}

        {/* Basiskarte as the panel's first group — the base IS a layer; this replaced the separate
            BaseSwitcher popover so one pinned button covers all of it. A ONE-OF-N choice between
            three named maps reads as a row of tiles, not as three full-width rows: it says «pick
            one» at a glance and hands ~90px of sheet height back to the layers below it, which
            matters most on the phone, where the sheet is the whole screen. The grid auto-fits, so
            a deployment with two or four bases still lays out. */}
        {bases.length > 0 && (
          <>
            <div className="lgroup">{appConfig.copy.baseMap}</div>
            <div className="lbases" role="radiogroup" aria-label={appConfig.copy.baseMap}>
              {bases.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className={`lbase ${b.visible ? 'on' : ''}`}
                  role="radio"
                  aria-checked={b.visible}
                  /* the full name stays reachable for anyone who doesn't know the short one */
                  title={b.label}
                  onClick={() => onToggle(b.id)}
                >
                  <span className="lbase-ic"><Icon id={b.icon} /></span>
                  <span className="lbase-t">{b.shortLabel ?? b.label}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* the lead twin groups («Karte & Objekte»'s «Station») right under the base map (owner,
            review round 5, 18.10.2026: «move grundkarte above station») */}
        {leadBlocks}

        {groupEntries.map(([group, rows]) => (
          <Fragment key={group}>
            <div className="lgroup">{group}</div>
            {rows.map((l) => {
              const { loading, note } = loadRow(l)
              return (
              <Fragment key={l.id}>
                {/* a real <button> so the toggle is keyboard-operable + focusable; the inline
                    resets strip native button chrome without touching .lrow's :hover rule */}
                <button
                  type="button"
                  className={`lrow ${l.visible ? '' : 'off'}`}
                  style={{ appearance: 'none', WebkitAppearance: 'none', border: 'none', width: '100%', textAlign: 'left', font: 'inherit', color: 'inherit' }}
                  aria-pressed={l.visible}
                  /* …and what it is doing is part of what the row announces — the status line
                     itself is NOT a live region: at one update per 120 ms it would read the
                     megabytes out loud over and over. */
                  aria-label={`${l.label} – ${l.visible ? appConfig.copy.layerPanel.stateVisible : appConfig.copy.layerPanel.stateHidden}${note ? ` – ${note.sub}` : ''}`}
                  onClick={() => onToggle(l.id)}
                >
                  {/* `ShellLoader`, not the boot mascot: in-workspace activity is what it is
                      for (components/ShellLoader, 01.10.2026) — it traces the mascot's own shell
                      spiral, it already travels in this chunk, and the full `SnailLoader` here
                      cost cold start two preloaded chunks for a loader nobody sees at launch. */}
                  <span className={`ic ${loading ? 'ic-loading' : ''}`}>
                    {loading ? <ShellLoader /> : <Icon id={l.icon} />}
                  </span>
                  <span className="name">
                    {l.label}
                    {note && <small>{note.sub}</small>}
                    {note?.pct != null && (
                      <span className="lload-bar"><i style={{ width: `${note.pct}%` }} /></span>
                    )}
                  </span>
                  {l.locked && <span className="lock"><Icon id="lock" /></span>}
                  <span className="eye"><Icon id={l.visible ? 'eye' : 'eyeoff'} /></span>
                </button>
                {l.opacity !== undefined && l.visible && opacityRow(l.id, l.opacity, l.label)}
              </Fragment>
              )
            })}
            {twinsAnchored && group === twinsAfterGroup && twinBlocks}
          </Fragment>
        ))}

        {!twinsAnchored && twinBlocks}

        {/* the weather radar: its own group, last — reference data about the sky, not about the
            Einsatz. Same row, same eye, same transparency slider as every overlay above; the
            colour key under it while it is on, because a colour nobody can read is decoration. */}
        {weather && (
          <>
            <div className="lgroup">{weather.group}</div>
            <button
              type="button"
              className={`lrow lrow-twin ${weather.visible ? '' : 'off'}`}
              style={{ appearance: 'none', WebkitAppearance: 'none', border: 'none', width: '100%', textAlign: 'left', font: 'inherit', color: 'inherit' }}
              aria-pressed={weather.visible}
              aria-label={`${weather.label} – ${weather.visible ? appConfig.copy.layerPanel.stateVisible : appConfig.copy.layerPanel.stateHidden}`}
              onClick={() => onToggle(weather.id)}
            >
              <span className="ic"><Icon id={weather.icon} /></span>
              <span className="name">{weather.label}{weather.sub && <small>{weather.sub}</small>}</span>
              <span className="eye"><Icon id={weather.visible ? 'eye' : 'eyeoff'} /></span>
            </button>
            {weather.visible && weather.opacity !== undefined && opacityRow(weather.id, weather.opacity, weather.label)}
            {weather.visible && weather.legend.length > 0 && (
              <div className="lc-wx-key" aria-hidden>
                <span className="lc-wx-ramp" style={{ background: `linear-gradient(to right, ${weather.legend.map((step) => step.color).join(', ')})` }} />
                <span className="lc-wx-words">
                  <span>{appConfig.copy.weatherLayer.legendLight}</span>
                  <span>{appConfig.copy.weatherLayer.legendHeavy}</span>
                </span>
                <span className="lc-wx-unit">{appConfig.copy.weatherLayer.legendUnit}</span>
              </div>
            )}
          </>
        )}

        {note && <p className="lc-credits">{note}</p>}
        {credits.length > 0 && <p className="lc-credits">{credits.join(', ')}</p>}
      </div>
    </div>
  )
}
