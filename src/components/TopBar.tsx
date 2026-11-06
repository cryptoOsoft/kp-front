import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Popover, PopoverClose } from '../lib/overlays'
import { fmtMMSS } from '../lib/format'
import { formatTime, fillTemplate } from '../lib/format'
import { EntryGlyph, Icon } from '../lib/icons'
import { fmtClock, type AtemschutzAlarmState } from '../lib/atemschutz'
import { serverNow } from '../lib/serverClock'
import type { Incident, WeatherData } from '../types'
import { appConfig } from '../config/appConfig'
import { CLOCK_ICON, useEinsatzuhr } from '../lib/einsatzuhr'
import { EinsatzuhrMenu } from './Einsatzuhr'
import { useIsPhone } from '../lib/useIsPhone'
import { useKeyHints } from '../lib/useDevicePrefs'
import { PANEL_KEY } from '../lib/hotkeys'
import { useHoldEntry } from '../lib/useHoldEntry'
import { useLiveBearing } from '../lib/liveBearing'
import { HoldChargeRing, HoldTargets } from './HoldTargets'
import { useHeadFit } from '../lib/useHeadFit'
import { parseWeatherTime } from '../lib/weatherTime'

/* ── Weather helpers ───────────────────────────────────────────────────────────────────────────
 * The wind/condition maths, kept beside its only reader. It used to live in a `WindBadge`
 * component that nothing has rendered since the readout moved into this bar (and into the
 * phone's `.phone-wx` float); the file was deleted on 05.09. and these came with it. */

const cardinalIndex = (deg: number) => Math.round((((deg % 360) + 360) % 360) / 45) % 8

/** German cardinal for a FROM bearing, e.g. 225° → «aus SW». */
export function fromLabel(deg: number): string {
  const w = appConfig.copy.weather
  return `${w.from} ${w.cardinals[cardinalIndex(deg)]}`
}

/** Spelled-out German cardinal for a FROM bearing, e.g. 225° → «aus Südwest». */
export function fromLabelLong(deg: number): string {
  const w = appConfig.copy.weather
  return `${w.from} ${w.cardinalsLong[cardinalIndex(deg)]}`
}

/** CSS rotation (deg) for the wind arrow. The arrow's SVG points DOWN at rest (bearing 180°),
 *  and we want it pointing where the wind blows TOWARD = the FROM bearing + 180. toward − 180 =
 *  dir, so rotating by `dir` aims the arrow downwind on a north-up map. When the map is rotated
 *  to a bearing, a compass direction θ appears on screen at θ − bearing, so the arrow follows the
 *  map's rotation (like the compass needle) by subtracting it. */
export function windArrowRotation(dir: number, bearing = 0): number {
  return dir - bearing
}

/** WMO present-weather code → a single condition icon + localized label. */
export function condition(code: number | null): { icon: string; label: string } | null {
  if (code == null) return null
  const c = appConfig.copy.weather.conditions
  if (code === 0) return { icon: 'sun', label: c.clear }
  if (code === 1) return { icon: 'wx-partly', label: c.fair }
  if (code === 2) return { icon: 'wx-partly', label: c.partly }
  if (code === 3) return { icon: 'wx-cloud', label: c.overcast }
  if (code === 45 || code === 48) return { icon: 'wx-fog', label: c.fog }
  if (code >= 51 && code <= 57) return { icon: 'wx-rain', label: c.drizzle }
  if (code >= 61 && code <= 67) return { icon: 'wx-rain', label: c.rain }
  if (code >= 71 && code <= 77) return { icon: 'wx-snow', label: c.snow }
  if (code >= 80 && code <= 82) return { icon: 'wx-rain', label: c.rainShowers }
  if (code === 85 || code === 86) return { icon: 'wx-snow', label: c.snowShowers }
  if (code >= 95) return { icon: 'wx-storm', label: c.thunder }
  return { icon: 'wx-cloud', label: c.cloudy }
}

interface Props {
  incident: Incident
  /** ISO incident start — drives the running Einsatzuhr next to the wall clock */
  startedAt?: string | null
  /** ISO end of the Einsatz (declared Einsatzende, else the server's closure). Present ⇒ the
   *  Einsatzdauer is FINAL and stops there instead of counting on from `now`. */
  endedAt?: string | null
  recording: boolean
  recStartedAt: number | null
  journalOpen: boolean
  onToggleJournal: () => void
  /** count of open Wiedervorlagen — shown as a small badge on the Verlauf button */
  reminderCount?: number
  /** quick tap on "Eintrag" — open the composer. Omitted hides the button entirely: a
      session that may not write the Verlauf (an Einsatz-Link) must not be offered it. */
  onAddEntry?: () => void
  /** the hold was released over «Sprachnotiz» (or released without moving) — start the memo */
  onHoldStart?: () => void
  /** tap the recording button — stop + save the voice memo */
  onHoldEnd?: () => void
  /** the hold was released over «Foto» — straight to the camera (see useHoldEntry) */
  onHoldPhoto?: () => void
  /** replaces the static incident title/address (e.g. the incident switcher) */
  titleSlot?: React.ReactNode
  /** ONE undo/redo pair for the whole Einsatz — re-homed here from the old left Rail, and since
   *  08.09.2026 driving the one global timeline rather than whichever surface is showing.
   *  ⚠️ It is handed the EVENT, because the confirmation is anchored at the button that was
   *  pressed (lib/undoFlash): a step taken on another surface is otherwise invisible. */
  onUndo: (e: MouseEvent<HTMLButtonElement>) => void
  onRedo: (e: MouseEvent<HTMLButtonElement>) => void
  canUndo: boolean
  canRedo: boolean
  /** what ↶ would take back, in the operator's words («Kontakt Trupp 2») — the hold-tooltip reads
   *  it off `aria-label`, so naming the action here is all the promise needs. */
  undoLabel?: string | null
  redoLabel?: string | null
  /** viewers (read-only) get inspection but not the editing history controls */
  showHistory?: boolean
  /** phone-only surface controls folded into the bar: a primary view action (locate →
   *  centre on incident on the map; fit → fit-to-view on the plan). Null on desktop,
   *  where these live in the rail footer. */
  mapNav?: { action: { icon: string; label: string; onClick: () => void } } | null
  /** map weather reading, rendered as a readout next to "Eintrag" (replaces the floating
   *  corner badge). Null off the map / while loading. */
  weather?: WeatherData | null
  /** open the MeteoSwiss details for the incident location */
  onOpenWeather?: () => void
  /** live map bearing (deg) — the wind arrow follows the map rotation like the compass */
  bearing?: number
  /** app-wide Atemschutz alarm state — drives the conditional chip (only shown when a Trupp is
   *  fällig/überfällig, so it never crowds the bar in the normal case) */
  azAlarm?: AtemschutzAlarmState
  /** the chip's alarm already has its door on screen — the Trupps board's head badge, or a
   *  Meldeleiste row naming the same Trupp (AtemschutzAlarmMeldung · azChipRedundant, T1) */
  azChipHidden?: boolean
  /** Live GPS feed has gone silent — the vehicles on the map are frozen. */
  gpsStale?: boolean
  /** Age of the last successful GPS poll, for the chip's readout. */
  gpsAgeMs?: number | null
  /** jump to the Atemschutz surface (chip tap) — carries the urgent Trupp's id so the board
   *  can land ON the card the chip names, not merely near it */
  onOpenAtemschutz?: (truppId?: string) => void
  /** «Standort teilen» indicator, when THIS device is reporting its holder's position. It
   *  belongs in the bar rather than behind a menu: a device sharing somebody's location has to
   *  say so on the screen they are already looking at, and it is the only such control a
   *  link-scoped session gets (Einstellungen is hidden for those). */
  shareSlot?: React.ReactNode
}

// Single-line top bar: incident identity + clock on the left, global journal +
// undo/redo on the right (the surface switch moved to the left NavRail). The clock
// interval lives here so the per-second tick re-renders only the bar, not the map below.
export function TopBar({ incident, startedAt, endedAt, recording, recStartedAt, journalOpen, onToggleJournal, reminderCount = 0, onAddEntry, onHoldStart, onHoldEnd, onHoldPhoto, titleSlot, onUndo, onRedo, canUndo, canRedo, undoLabel, redoLabel, showHistory, mapNav, weather, onOpenWeather, bearing = 0, azAlarm, azChipHidden = false, onOpenAtemschutz, gpsStale, gpsAgeMs, shareSlot }: Props) {
  // The deployment's clock (lib/serverClock), not the device's: the Einsatzdauer counts from a
  // timestamp another device wrote, and the Atemschutz chip below ticks off `contactAt`, which
  // the alarm fold expresses in server time. Reading those with a device clock a few seconds off
  // is how the same Trupp showed two different ages on a phone and a PC. Offline it IS Date.now().
  const [now, setNow] = useState(() => serverNow())
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 1000)
    return () => clearInterval(t)
  }, [])
  const recSec = recording && recStartedAt ? Math.max(0, Math.round((now - recStartedAt) / 1000)) : 0
  const hasWind = weather?.wind_dir_deg != null
  // ⚠️ The pair's word IS its promise. Both buttons are icon-only, so the app-wide hold-tooltip
  // reads exactly this off `aria-label` (lib/holdTooltip · labelOf) — and since ↶ now reaches
  // every surface, a bare «Rückgängig» would be the app declining to say what it is about to do
  // on a surface the operator is not even looking at. Falls back to the bare word when there is
  // nothing to take back, where the button is disabled anyway.
  const undoWord = undoLabel ? fillTemplate(appConfig.copy.undoNamed, { action: undoLabel }) : appConfig.copy.undo
  const redoWord = redoLabel ? fillTemplate(appConfig.copy.redoNamed, { action: redoLabel }) : appConfig.copy.redo

  // Einsatzuhr: the running duration, the wall clock or the start time, from a labelled menu
  // (lib/einsatzuhr). It's the only clock in the bar (the OS status bar covers wall time).
  // ⚠️ Not on a PHONE (07.10.2026, UI sweep · owner pick B3 D): there it is the Einsatz pill's
  // second line, under the Stichwort, and its menu opens from the Einsatz card's Beginn pill
  // (panels/IncidentSwitcher) — the same choice, read and written through the same hook.
  const isPhone = useIsPhone()
  const E = appConfig.copy.einsatzuhr
  const uhr = useEinsatzuhr(startedAt, endedAt, now)
  const clockText = uhr.text

  // Verlauf (J) and Eintrag (E) wear their letter like the rails' tiles do (staging review
  // 06.11.2026, S6): the same `.rail-key` badge, the same device pref «Tastenkürzel anzeigen»
  // (lib/prefs · keyHints), and in CSS only with a mouse and keyboard (10-journal.css · .tb-key).
  // Not on a phone, whose bar is icons only. The tooltip names the key either way.
  const [keyHints] = useKeyHints()
  const keyHint = (k: string) => (keyHints && !isPhone ? <span className="rail-key tb-key" aria-hidden>{k}</span> : null)
  const keyTitle = (label: string, key: string) => fillTemplate(appConfig.copy.journal.keyTitle, { label, key })

  // Eintrag gesture (shared with the mobile FAB so they behave identically). The hook runs
  // unconditionally — hooks can't be skipped — but with the button unrendered nothing ever
  // reaches these handlers, so the no-op fallbacks are only there to satisfy the signature.
  const noop = () => {}
  const { pressing, pressedSince, latched, anchor, pick, handlers } = useHoldEntry({
    recording,
    onTap: onAddEntry ?? noop,
    onHoldStart: onHoldStart ?? noop,
    onHoldStop: onHoldEnd ?? noop,
    onHoldPhoto,
  })

  // the bar's priority ladder (lib/useHeadFit): measured, one step at a time, until it fits
  const barRef = useRef<HTMLDivElement>(null)
  useHeadFit(barRef, [
    incident.title, incident.address, clockText.length, hasWind, gpsStale ? 1 : 0,
    azAlarm?.urgent && !azChipHidden ? `${azAlarm.peak}:${azAlarm.urgent.reason}` : '', recording ? 1 : 0, reminderCount > 0 ? 1 : 0,
  ].join('|'))

  return (
    <div className="topbar" ref={barRef}>
      {titleSlot ?? (
        <>
          <div className="ename">{incident.title}</div>
          <span className="eaddr">{incident.address}</span>
        </>
      )}
      {/* No fixed wall clock in the bar — the OS status bar (iPad navbar) already shows the time,
          and the Einsatzuhr below can be cycled to the wall clock when needed. */}
      {/* Einsatzuhr: the long-incident awareness anchor — tap opens a labelled mode menu */}
      {startedAt && !isPhone && (
        <EinsatzuhrMenu uhr={uhr} startedAt={startedAt} trigger={
          <button
            type="button"
            className="stat tb-einsatzuhr"
            title={fillTemplate(E.title, { t: formatTime(new Date(startedAt)) })}
            aria-label={`${uhr.label[uhr.mode]}: ${clockText}`}
          >
            <Icon id={CLOCK_ICON[uhr.mode]} /><b>{clockText}</b><Icon id="chevron-down" className="tb-uhr-chev chev" />
          </button>
        } />
      )}

      {/* Journal + undo/redo, reachable from both surfaces. Do not open this comment with the
          word "global" — ESLint reads such a block as a globals declaration and then reports
          every word in it as an unused variable. */}
      <div className="tb-actions">
        {mapNav && (
          <button className="tb-act icon" title={mapNav.action.label} aria-label={mapNav.action.label} onClick={mapNav.action.onClick}><Icon id={mapNav.action.icon} /></button>
        )}
        {showHistory && (
          <>
            {/* tb-act-history: a name the stylesheet can aim at. On a phone with an
                überfällig chip in the bar these two are what steps aside — see app.css. Positional
                selectors would have picked the wrong buttons, because the mapNav action ahead of
                them is a .tb-act.icon too and comes and goes with the surface. */}
            <button className="tb-act icon tb-act-history" title={undoWord} aria-label={undoWord} disabled={!canUndo} onClick={onUndo}><Icon id="undo" /></button>
            <button className="tb-act icon tb-act-history tb-act-redo" title={redoWord} aria-label={redoWord} disabled={!canRedo} onClick={onRedo}><Icon id="redo" /></button>
          </>
        )}
        {/* ⚠️ `has-rem` tints the BUTTON, not just its corner. The count badge alone is 17px of amber
            hanging off a 44px icon — and on a phone the next thing in the bar is the Atemschutz
            chip, which is painted after it and simply covered it up. What «12 offen» has to do is
            be noticed from across a Schadenplatz, so the control it belongs to carries the colour
            and the number rides along (see .tb-act.has-rem). */}
        <button className={`tb-act ${journalOpen ? 'on' : ''} ${reminderCount > 0 ? 'has-rem' : ''}`} aria-pressed={journalOpen} onClick={onToggleJournal}
          aria-label={reminderCount > 0 ? appConfig.copy.journal.openCount.replace('{n}', String(reminderCount)) : appConfig.copy.journal.open}
          title={keyTitle(reminderCount > 0 ? appConfig.copy.journal.openCount.replace('{n}', String(reminderCount)) : appConfig.copy.journal.open, PANEL_KEY.journal)}>
          <Icon id="history" /><span>{appConfig.copy.journal.open}</span>{keyHint(PANEL_KEY.journal)}
          {reminderCount > 0 && <span className="tb-rem-count" aria-label={appConfig.copy.journal.openCount.replace('{n}', String(reminderCount))}>{reminderCount}</span>}
        </button>
        {onAddEntry && (
          <button
            className={`tb-act tb-act-add ${recording ? 'rec' : ''} ${latched ? 'cancelling' : ''}`}
            // held at its measured width while it is an ✕, so dropping the label cannot resize it
            style={latched && anchor ? { width: anchor.width } : undefined}
            title={recording ? appConfig.copy.journal.recordStop : keyTitle(appConfig.copy.journal.addHint, PANEL_KEY.composer)}
            data-hold-target="cancel"
            {...handlers}
          >
            {/* below: this button lives in the TOP bar, so the targets open downward */}
            {latched && <HoldTargets placement="below" anchor={anchor} onPick={pick} />}
            {recording
              ? <><span className="tb-stop" /><span className="tb-act-label">{fmtMMSS(recSec)}</span></>
              : <>
                {/* the charge ring rings the glyph — anchored at the right edge it sat ON the
                    label's last letters and read as clutter over the word it was charging */}
                <span className="tb-act-ic">
                  {/* inline path, not a sprite <use> — same defence as FabEntry (29.08.): the
                      field-logging glyph must never render as an empty button when a sprite
                      fails to resolve across remounts. The journal glyph, not «+» (29.09.2026,
                      sweep K2): the rail's «+ Symbol» stands right beside it. */}
                  <EntryGlyph />
                  {pressing && pressedSince != null && <HoldChargeRing since={pressedSince} />}
                </span>
                <span className="tb-act-label">{appConfig.copy.journal.add}</span>
                {keyHint(PANEL_KEY.composer)}
              </>}
          </button>
        )}
        {/* wrapped in a stable class so the phone rule can lift it out of the bar — see
            .tb-share in app.css. The bar's four 44px actions do not fit a 390px screen. */}
        {shareSlot && <span className="tb-share">{shareSlot}</span>}
        {hasWind && <WeatherBadge weather={weather!} onOpenMeteo={onOpenWeather} bearing={bearing} />}
        {/* GPS feed chip. The Fahrzeuge deliberately stay on the map when the feed dies —
            letting them disappear would read as «abgerückt» rather than as «Feed weg». That
            is exactly why the freeze needs a visible caveat: without one, hours-old positions
            look every bit as binding as a position one minute old. */}
        {/* ⚠️ A BUTTON, and a tap opens its sentence (S6, 20.10.2026, owner: tap-to-open). It was a
            span whose explanation lived in `title=`, which neither a tablet nor the hold-tooltip
            ever shows. The popover is the house one (lib/overlays · Popover): non-modal, so the
            map stays live under it and a press elsewhere closes it. */}
        {gpsStale && (
          <Popover side="bottom" align="start" popupClassName="tb-gps-pop" ariaLabel={appConfig.copy.topBar.gpsFrozen} zIndex={201}
            trigger={
              <button type="button" className="tb-gps">
                {/* the app's own position glyph — a speedometer (`gauge`) named nothing about a
                    silent position feed. The amber pill carries the caveat; the icon says WHAT. */}
                <Icon id="locate" />
                <span>{appConfig.copy.topBar.gpsFrozen}</span>
                {gpsAgeMs != null && (
                  <span className="tb-gps-age">{Math.round(gpsAgeMs / 60_000)} min</span>
                )}
              </button>
            }
          >
            <p className="tb-gps-hint">{appConfig.copy.topBar.gpsFrozenHint}</p>
          </Popover>
        )}
        {/* Atemschutz chip — pinned at the far right so it never shifts the other controls.
            AMBER from «Kontakt fällig» on (the quiet lead used to stay board-only, so the first
            the top bar said anything was the red alarm), RED once a Trupp is überfällig or at
            its Alarmdruck. Taps through to the Atemschutz surface. */}
        {/* …and not while its alarm already has a door on screen (29.09.2026, T1): two red
            controls with two numbers for one emergency read as two emergencies */}
        {azAlarm && azAlarm.peak >= 1 && azAlarm.urgent && !azChipHidden && (() => {
          // ⚠️ TWO reasons this chip can be red, and it has to say which. Out of contact ticks a
          // clock; at or below the Alarmdruck it shows the bar. A chip that showed a contact
          // clock for a Trupp whose air is gone would name the wrong emergency.
          const u = azAlarm.urgent
          const crit = azAlarm.peak >= 2
          const lowPressure = u.reason === 'pressure'
          // …and the Atemschutznotfall (F1, 08.10.2026): the chip says «Notfall» and ticks the
          // Notfall clock — `contactAt` is the trigger's moment for this reason (peakAtemschutzAlarm)
          const notfall = u.reason === 'notfall'
          const what = notfall ? appConfig.copy.atemschutz.notfall.title
            : lowPressure
            ? fillTemplate(appConfig.copy.atemschutz.alarmNote, { bar: String(u.bar ?? '') })
            : crit ? appConfig.copy.atemschutz.clockOverdue : appConfig.copy.atemschutz.clockWarn
          return (
            <button
              className={`tb-az ${crit ? 'crit' : 'warn'}`}
              // the chip names ONE Trupp, so the tap lands on that Trupp's card
              onClick={() => onOpenAtemschutz?.(u.id)}
              title={appConfig.copy.atemschutz.chipHint}
              aria-label={`${appConfig.copy.modes.atemschutz}: ${what} — ${u.name}`}
            >
              {/* the Manometer for the Alarmdruck (26.09.2026): the droplet it wore said water */}
              <Icon id={notfall ? 'warn' : lowPressure ? 'manometer' : 'gauge'} />
              <span className="tb-az-name">{notfall ? `${appConfig.copy.atemschutz.notfall.title} · ${u.name}` : u.name}</span>
              {/* the clock ticks off the bar's own 1 Hz tick — the alarm state object stays
                  reference-stable between tier/Trupp transitions (App must not re-render per
                  second). A pressure alarm has no clock to tick: it shows the number. */}
              <span className="tb-az-clock">
                {lowPressure ? `${u.bar} bar` : fmtClock(Math.round((now - u.contactAt) / 1000))}
              </span>
            </button>
          )
        })()}
      </div>
    </div>
  )
}

/** The tappable wind/weather readout + its detail popover. Lives in the TopBar on
 *  desktop/tablet; on phones App floats it in the top-right .phone-wx read-out
 *  instead (the bar is too narrow — it clipped at the screen edge). */
export function WeatherBadge({ weather, onOpenMeteo, bearing = 0, popAlignOffset, popInset = 7 }: { weather: WeatherData; onOpenMeteo?: () => void; bearing?: number
  /** the phone's glass cluster wraps the chip in 5px of its own (padding + border) – see Popover · alignOffset */
  popAlignOffset?: number
  /** how far the chip's bottom sits INSIDE the visible control's bottom edge: the popover hangs
   *  8px under that edge, as the app menu (.ip-menu) hangs 8px under the bar — not 8px under the
   *  chip, which left it 1px below the bar (owner, 20.10.2026). Default: the bar's --bar-pad +
   *  its 1px border; the phone's cluster passes its own 5px. */
  popInset?: number }) {
  const cond = condition(weather.weather_code)
  // turns with the finger while the Karte is being rotated, not only once it is let go
  const liveBearing = useLiveBearing(bearing)
  if (weather.wind_dir_deg == null) return null
  return (
    <div className="tb-weather-wrap">
      <Popover
        popupClassName="tb-weather-pop"
        alignOffset={popAlignOffset}
        ariaLabel={appConfig.copy.weather.details}
        side="bottom"
        align="end"
        sideOffset={8 + popInset}
        zIndex={201}
        trigger={
          <button className="tb-weather"
            title={`${cond ? `${cond.label} · ` : ''}${fillTemplate(appConfig.copy.weather.windTitle, { dir: fromLabel(weather.wind_dir_deg), deg: Math.round(weather.wind_dir_deg) })}${appConfig.copy.weather.detailsHint}`}
            aria-label={appConfig.copy.weather.label}>
            {cond && <span className="tb-weather-cond" aria-hidden><Icon id={cond.icon} /></span>}
            {weather.temp_c != null && <b className="tb-weather-temp">{Math.round(weather.temp_c)}°</b>}
            {/* arrow points DOWNWIND (where the wind/smoke is going); follows the map rotation */}
            <span className="tb-wind-arr" style={{ transform: `rotate(${windArrowRotation(weather.wind_dir_deg, liveBearing)}deg)` }} aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 L12 21" /><path d="M6 15 L12 21 L18 15" /></svg>
            </span>
            {weather.wind_speed_kmh != null && <b>{Math.round(weather.wind_speed_kmh)} km/h</b>}
          </button>
        }
      >
        <WeatherDetails weather={weather} cond={cond} onOpenMeteo={onOpenMeteo} />
      </Popover>
    </div>
  )
}

// Tap-to-open weather detail popover: spells the wind direction out, surfaces the params we
// already fetch but don't fit in the bar (gusts, precip, station, reading time), and is the
// ONLY place the external MeteoSchweiz radar link lives.
// Content of the weather detail popover (the <Popover> primitive supplies the anchored,
// portalled, dismissible shell): spells the wind direction out, surfaces the params we already
// fetch but don't fit in the bar (gusts, precip, station, reading time), and is the ONLY place
// the external MeteoSchweiz radar link lives.
function WeatherDetails({ weather, cond, onOpenMeteo }: {
  weather: WeatherData
  cond: { icon: string; label: string } | null
  onOpenMeteo?: () => void
}) {
  const dir = weather.wind_dir_deg
  // through lib/weatherTime: an Open-Meteo stamp has no zone and is UTC, not device-local
  const observedAt = parseWeatherTime(weather.observed_at)
  const observed = observedAt ? formatTime(observedAt) : null
  const w = appConfig.copy.weather
  return (
    <>
        <div className="wx-pop-head">
          {cond && <span className="wx-pop-cond" aria-hidden><Icon id={cond.icon} /></span>}
          <div className="wx-pop-head-t">
            <b>{cond?.label ?? w.label}</b>
            {weather.temp_c != null && <span>{Math.round(weather.temp_c)} °C</span>}
          </div>
        </div>
        <dl className="wx-pop-rows">
          {dir != null && (
            <div className="wx-pop-row"><dt>{w.windDir}</dt><dd>{fromLabelLong(dir)} · {Math.round(dir)}°</dd></div>
          )}
          {weather.wind_speed_kmh != null && (
            <div className="wx-pop-row"><dt>{w.windSpeed}</dt><dd>{Math.round(weather.wind_speed_kmh)} km/h</dd></div>
          )}
          {weather.wind_gust_kmh != null && (
            <div className="wx-pop-row"><dt>{w.gust}</dt><dd>{Math.round(weather.wind_gust_kmh)} km/h</dd></div>
          )}
          {weather.precip_mm != null && (
            <div className="wx-pop-row"><dt>{w.precip}</dt><dd>{weather.precip_mm} mm/h</dd></div>
          )}
          {weather.station && (
            <div className="wx-pop-row"><dt>{w.station}</dt><dd>{weather.station}</dd></div>
          )}
          {(observed || weather.source) && (
            <div className="wx-pop-row"><dt>{w.source}</dt><dd>{[weather.source, observed].filter(Boolean).join(' · ')}</dd></div>
          )}
        </dl>
        {onOpenMeteo && (
          <PopoverClose className="wx-pop-link" onClick={onOpenMeteo}>
            <Icon id="eye" /><span>{w.meteoRadar}</span>
          </PopoverClose>
        )}
    </>
  )
}
