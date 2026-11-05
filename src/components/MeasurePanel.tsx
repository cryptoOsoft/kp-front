import { LoadingStatus } from './ShellLoader'
import { useState, type ReactNode } from 'react'
import type { LngLat } from '../types'
import type { ProfileResult } from '../lib/profile'
import { pathLengthM, polygonAreaM2, fmtDistance, fmtArea, hoseCount } from '../lib/geo'
import { Icon } from '../lib/icons'
import { appConfig } from '../config/appConfig'
import { cx } from '../lib/cx'
import { ProfileChart, ProfileStats } from './ProfileChart'
import { Button, IconButton } from './Button'
import { MapHelpCard } from './DockInfo'
import { AddRelayButton, WaterRelay } from './WaterRelay'
import { usePublishRelay, useRelay, type RelayValue } from '../lib/useRelay'
import { HOSES, hoseDefaults } from '../lib/hydraulics'
import type { MeasureRelay } from '../lib/useMeasure'
import s from './MeasurePanel.module.css'

/** a module constant, so a host without a relay hands the controller one stable empty value */
const NO_RELAY: RelayValue = {}

/** A placement mode's instruction («Auf die Karte tippen …»), in THE card a map tool explains
 *  itself in — the very one the Messen dock's ⓘ opens (DockInfo · MapHelpCard), at the foot of
 *  the map and in the phone's message lane. It wore a frame and a type of its own until review
 *  round 7, which read as a lesser message beside the ⓘ card (owner, 20.10.2026).
 *  `role="status"`: an instruction that appears because a tool was armed, not because a control
 *  was asked. A MESSAGE still keeps the toast lane, which a placement mode sends to the top
 *  (owner 20.10.2026, lib/toastLane · usePlacementLane). */
export function MapHint({ children }: { children: ReactNode }) {
  return <MapHelpCard role="status">{children}</MapHelpCard>
}

export function MeasurePanel({ mode, coords, profile, profileLoading, metrics, showProfile = true, blocked = false, hint, onAdopt, onCalibrate, calibrateLabel, recalibrateLabel, scaleNote, relay, onPlacePumps, className }: {
  mode: 'line' | 'area'
  coords: LngLat[]
  profile: ProfileResult | null
  profileLoading: boolean
  /** pre-computed distance/area (e.g. the Plan's calibrated metres); falls back to geodesic
   *  computation from `coords` when absent (the Lage map). */
  metrics?: { lengthM: number; areaM2: number; perimeterM: number }
  /** hide the elevation-profile section — a Plan sheet has no height data. */
  showProfile?: boolean
  /** force the hint (e.g. "calibrate first") regardless of point count. */
  blocked?: boolean
  /** override the not-enough-points hint text. */
  hint?: string
  /** turn the measurement into a real, drawn object — the measured points become the nodes of a
   *  line (line mode) or of a Fläche (area mode). Absent ⇒ the action is hidden: a read-only
   *  surface measures but never draws, and so does one whose measurement is still just a hint. */
  onAdopt?: () => void
  /** Plan only: start (or redo) the scale calibration straight from the panel. Absent when the
   *  scale is DERIVED from the Kartenverknüpfung — see `scaleNote`. */
  onCalibrate?: () => void
  calibrateLabel?: string
  recalibrateLabel?: string
  /** Where these metres come from, when it is not a calibration anybody made here. A quiet
   *  reading in place of the button, so a sheet that is already tied to the map does not offer
   *  «Neu kalibrieren» — which reads as «this is not calibrated» on a plan that is. */
  scaleNote?: string
  /** the Strecke's Wassertransport (useMeasure · relay) — the Karte surfaces pass it, a Plan
   *  sheet does not (no ground, no height profile), and its fold then has no such section */
  relay?: MeasureRelay
  /** the Wassertransport's «Pumpen als Symbole setzen», every pump's spot at once – the Lage,
   *  where symbols may be placed */
  onPlacePumps?: (coords: LngLat[]) => void
  /** the host's own placement (the Karte's phone stack has one bar fewer than an Einsatz's) —
   *  `.measure-panel` is a hashed module class, so a host cannot reach it by name */
  className?: string
}) {
  // read per-render (not module-load) so the resolved locale is applied — see config/copy
  const C = appConfig.copy.measure
  const lengthM = metrics ? metrics.lengthM : pathLengthM(coords)
  // area mode closes the ring for perimeter; needs 3+ points to be meaningful
  const areaM2 = metrics ? metrics.areaM2 : mode === 'area' ? polygonAreaM2(coords) : 0
  const perimeterM = metrics ? metrics.perimeterM : mode === 'area' && coords.length >= 3 ? lengthM + (coords[0] && coords.length ? pathLengthM([coords[coords.length - 1], coords[0]]) : 0) : 0

  const enough = mode === 'line' ? coords.length >= 2 : coords.length >= 3
  // A linked Plan already has everything the tool needs to measure in metres. On open, the
  // useful fact is where that scale comes from — «Ref. automatisch» — not the generic geometry
  // instruction «Mind. 2 Punkte». Once the first point exists the instruction becomes useful
  // again, so only the genuinely empty automatic state yields to the source note below.
  const emptyAutomatic = !blocked && coords.length === 0 && !!scaleNote
  // #1: keep the panel slim — the Höhenprofil (chart + gain/loss) is collapsed by default and
  // opens on the ↕ toggle, so the summary bar barely covers the map.
  const [profileOpen, setProfileOpen] = useState(false)
  const hasProfile = showProfile && (profileLoading || !!profile)
  const readout = !emptyAutomatic && !blocked && enough
  // ⚠️ ONE ROW by default (10.10.2026, owner's iPhone: «Als Linie übernehmen» took a whole row of
  // its own under the two numbers). Once there is a measurement the panel is the readout, the
  // adopt action beside it and the ▾ — and everything else it can carry (the Höhenprofil, the
  // Plan's «Neu kalibrieren» or the note where its metres come from) folds behind that ▾. Before
  // there is a measurement the hint stands alone and the calibration stays in view: on an
  // uncalibrated Plan it IS the next step.
  const calibration = onCalibrate ? (
    <Button variant={blocked ? 'primary' : 'quiet'} className={s['mp-cal-btn']} icon={<Icon id="measure" />} onClick={onCalibrate}>
      {blocked ? calibrateLabel : recalibrateLabel}
    </Button>
  ) : scaleNote ? (
    <div className={s['mp-cal-note']} role="status"><Icon id="measure" />{scaleNote}</div>
  ) : null
  // Wassertransport (components/WaterRelay): ADDED from a button under the Höhenprofil, closed by
  // its own × (owner 04.11.2026 – it no longer replaces the profile behind a second fold). Open,
  // its chart is the profile with the pressure over it, so the plain Höhenprofil steps aside and
  // the panel widens into two columns (round 3 mock F-A: chart and pump card left, inputs, result
  // and «Als Leitung auf die Karte» right). Its pumps stand on the map and their count joins the
  // folded readout — a plain distance measurement stays exactly as it was.
  const hasRelay = !!relay && mode === 'line'
  const relayOpen = hasRelay && relay.open
  // a Strecke is no Leitung yet: it starts on the station's relay Ø (75 mm shipped), not the Linie's
  const ctrl = useRelay({ coords, profile, profileLoading, value: relay?.value ?? NO_RELAY, defaultHose: hoseDefaults().relay, onChange: relay?.onChange })
  usePublishRelay(ctrl, readout && relayOpen)
  const folds = readout && (hasProfile || !!calibration || hasRelay)
  const open = folds && profileOpen

  const stats = mode === 'line' ? (
    <div className={s['mp-stat-row']}>
      <div className={s['mp-stat']}><span className={s['mp-k']}>{C.distance}</span><b className={s['mp-v']}>{fmtDistance(lengthM)}</b></div>
      {/* three numbers do not fit beside the adopt button with the long label: «Schläuche» alone
          then (the panel is also a little wider with the Wassertransport open — .mp-wide) */}
      <div className={s['mp-stat']}><span className={s['mp-k']}>{relayOpen && !open ? C.hoses : `${C.hoses} à ${appConfig.drawing.hoseLengthM} m`}</span><b className={s['mp-v']}>{hoseCount(lengthM, relayOpen ? HOSES[ctrl.input.hose].lines : 1)}</b></div>
      {/* folded, the opened Wassertransport answers with its pump count – open, its chart shows them */}
      {relayOpen && !open && (
        <div className={s['mp-stat']}><span className={s['mp-k']}>{appConfig.copy.relay.pumps}</span><b className={cx(s['mp-v'], s.pump)}>{ctrl.plan ? ctrl.plan.pumps.length : '–'}</b></div>
      )}
    </div>
  ) : (
    <div className={s['mp-stat-row']}>
      <div className={s['mp-stat']}><span className={s['mp-k']}>{C.area}</span><b className={s['mp-v']}>{fmtArea(areaM2)}</b></div>
      <div className={s['mp-stat']}><span className={s['mp-k']}>{C.perimeter}</span><b className={s['mp-v']}>{fmtDistance(perimeterM)}</b></div>
    </div>
  )
  // «Als Linie übernehmen» — the measured path becomes a drawn line, with the measured points as
  // its nodes (and «Als Fläche übernehmen», its twin: the measured ring becomes a drawn Fläche).
  // Without it the only way to KEEP a Strecke was to draw it a second time by hand over the top of
  // the one just measured. ⚠️ On the row it is the GLYPH alone — the line tool's pen, the Fläche's
  // own outline — with the whole sentence as its name and hold tooltip (IconButton): beside the two
  // numbers and the ▾ even «Als Linie» left the readout no room on a 360px phone or the 320px
  // tablet panel, and «1.23 km» broke onto two lines.
  const adoptLabel = mode === 'line' ? C.adoptLine : C.adoptArea
  const adopt = onAdopt && (
    <IconButton variant="secondary" label={adoptLabel} className={s['mp-adopt-btn']} onClick={onAdopt}>
      <Icon id={mode === 'line' ? 'pen' : 'area'} />
    </IconButton>
  )

  return (
    // data-float-stack: it stands in the phone's bottom stack (lib/floatRow measures it)
    <div className={cx(s['measure-panel'], relayOpen && s['mp-wide'], open && relayOpen && s['mp-tall'], open && relayOpen && s['mp-wider'], className)} data-float-stack="">
      {!readout ? (
        <>
          {!emptyAutomatic && (
            <div className={s['mp-hint']}>{blocked && hint ? hint : mode === 'line' ? C.hintLine : C.hintArea}</div>
          )}
          {calibration}
        </>
      ) : (
        <>
          {/* ⚠️ The WHOLE ROW opens the fold, not the ▾ (18.09.2026). The chevron was a 40px
              target at the far right of a 320px panel, and the two numbers beside it — which is
              what anyone reaches for — did nothing. Where a section can be folded, the header IS
              the button and the chevron is decoration; the same shape the Zeichnung editor's
              «Messung» row already has (DrawEditor · .de-group-toggle). The adopt button sits ON
              that row, between the numbers and the ▾, as its own control: the toggle spans the
              row underneath it (a subgrid, MeasurePanel.module.css · .mp-row). Nothing to fold
              ⇒ the row stays a plain readout. */}
          <div className={cx(s['mp-row'], !folds && s['mp-row-flat'])}>
            {folds ? (
              <button type="button" className={s['mp-row-btn']} aria-expanded={open} onClick={() => setProfileOpen((o) => !o)}>
                {stats}
                <span className={s['mp-prof-toggle']} aria-hidden><Icon id="chevron-down" className="chev" /></span>
              </button>
            ) : stats}
            {adopt}
          </div>
          {/* the Wassertransport chart carries the terrain itself, so it stands in for the Höhenprofil */}
          {open && hasProfile && !relayOpen && (profileLoading ? (
            <div className={s['mp-prof-msg']}><LoadingStatus>{C.profileLoading}</LoadingStatus></div>
          ) : profile ? (
            <>
              <div className={s['mp-prof-title']}>{C.profile}</div>
              <ProfileChart p={profile} path={coords} />
              <ProfileStats p={profile} />
            </>
          ) : (
            <div className={s['mp-prof-msg']}>{C.profileNone}</div>
          ))}
          {open && hasRelay && !relayOpen && (
            <AddRelayButton onClick={() => relay.setOpen(true)} />
          )}
          {open && relayOpen && (
            <WaterRelay ctrl={ctrl} showHose wide onClose={() => relay.setOpen(false)}
              onAdoptLine={onAdopt} onPlacePumps={onPlacePumps} />
          )}
          {open && calibration}
        </>
      )}
    </div>
  )
}
