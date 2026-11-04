import { useState } from 'react'
import { Icon } from '../../lib/icons'
import { toast } from '../../lib/ui'
import { loadPrefs, savePrefs, applyTheme, resolveTheme, SYMBOL_SCALE, type ThemeMode, type RailLabels, type SymbolSurface } from '../../lib/prefs'
import { appConfig } from '../../config/appConfig'
import type { CaptionMode } from '../../types'
import { getDeploymentConfig } from '../../lib/deploymentConfig'
import { loadRoster } from '../../lib/usePersonnel'
import { Modal } from './_shared'
import { OnOff, Segmented } from '../Segmented'
import { Stepper } from '../Stepper'
import { Slider } from '../Slider'
import { Button } from '../Button'
import { ShellLoader } from '../ShellLoader'
import { compareText } from '../../lib/format'
import { AlarmReadinessRows } from '../karte/AlarmReadiness'
import { useKeyHints } from '../../lib/useDevicePrefs'

/** Percent for a symbol multiplier — «110 %» is a size anyone reads at a glance, «1.1» is not.
 *  No-break space before the sign, so the number and its unit never split across a line. */
const scalePct = (v: number) => `${Math.round(v * 100)}\u00a0%`

/** One Symbolgrösse row: a labelled slider over that surface's band plus its live value.
 *  Continuous under the thumb (0.05 steps) and live — the map and the plan re-render from the
 *  same prop, so the symbols behind the sheet resize while you drag. The app's own `Slider`, not
 *  a native range (sweep 28.10.2026 #18: the range «didn't function like a normal slider» under the
 *  sheet's scroll lock, and gave a finger a 4px-tall target). */
function ScaleRow({ surface, label, sub, value, onChange }: {
  surface: SymbolSurface
  label: string
  sub: string
  value: number
  onChange: (surface: SymbolSurface, v: number) => void
}) {
  const r = SYMBOL_SCALE[surface]
  return (
    <div className="set-row">
      <span className="set-row-l">{label}<small>{sub}</small></span>
      <span className="set-range">
        <Slider value={value} min={r.min} max={r.max} step={r.step} ariaLabel={label} valueText={scalePct(value)}
          onChange={(v) => onChange(surface, v)} />
        <b className="set-range-val">{scalePct(value)}</b>
      </span>
    </div>
  )
}

/** Einstellungen: device prefs only (theme, symbol size, rail words, shortcut letters, offline
 *  radius, screen wake — local cookie) plus per-device utilities. The «Einsatz» doctrine values (Funkkontakt-
 *  Intervall, Nachfrist, Funkkanal) left this sheet 28.08.: station configuration belongs in
 *  /admin, where whoever set it up changes it — not under the finger of an unknowing operator
 *  at 3am (per-incident overrides already written keep working; the doctrine is the source). */
export function SettingsSheet({
  onClose, symbolScale, onSymbolScale, symbolCaptions, onSymbolCaptions, railLabels, onRailLabels, offlineRadiusM, onOfflineRadius, offlineAuto, onOfflineAuto, keepScreenOn, onKeepScreenOn, photoPosition, onPhotoPosition, themeCoord, onFeedback,
  shareAs, onSharePosition, onChangeShareName,
}: {
  onClose: () => void
  /** tactical-symbol size per surface, as multipliers (lib/prefs · SYMBOL_SCALE) */
  symbolScale: Record<SymbolSurface, number>
  onSymbolScale: (surface: SymbolSurface, v: number) => void
  /** on-canvas symbol captions (Aus/Auto/Alle) — device pref like the symbol sizes */
  symbolCaptions: CaptionMode
  onSymbolCaptions: (m: CaptionMode) => void
  /** words under the rail glyphs — device pref, off by default, ON on a phone (lib/prefs ·
   *  railLabelsFor, 29.09.2026). Both rails at once: they are one decision («soll da Text
   *  stehen»), not two. */
  railLabels: RailLabels
  onRailLabels: (v: RailLabels) => void
  /** radius (m) cached around the incident for offline + scope of the Leitungskataster layers */
  offlineRadiusM: number
  onOfflineRadius: (m: number) => void
  /** quiet self-warm shortly after opening an Einsatz (lib/prefs · offlineAuto). Default true;
   *  false = «Aus» (manual only) — the button in the Offline-Bereitschaft sheet stays either way. */
  offlineAuto: boolean
  onOfflineAuto: (v: boolean) => void
  /** keep the screen awake while an incident is open — device pref, default on */
  keepScreenOn: boolean
  onKeepScreenOn: (v: boolean) => void
  /** «Standort zu Fotos» (lib/devicePosition) — a device preference. Omitted where this session
   *  writes no record (viewer, link) → the row is hidden. */
  photoPosition?: boolean
  onPhotoPosition?: (v: boolean) => void
  themeCoord: [number, number] | null
  /** open the Rückmeldung composer (the caller closes this sheet first — two stacked modals is
   *  not a thing we do). Omitted → the row is hidden. */
  onFeedback?: () => void
  /** Standort teilen: the name this device currently reports as, or null when it is not
   *  sharing. Omitting `onSharePosition` hides the row (no open incident to report into). */
  shareAs?: string | null
  /** true → open the name picker; false → stop sharing and delete the reported position */
  onSharePosition?: (on: boolean) => void
  /** open the name picker to change WHO this device reports as — the name row under «Standort
   *  verwenden», shown while the permission stands. Omitted → no name row. */
  onChangeShareName?: () => void
}) {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => loadPrefs().theme ?? 'auto')
  const [keyHints, setKeyHints] = useKeyHints()
  const setTheme = (m: ThemeMode) => {
    setThemeMode(m)
    savePrefs({ ...loadPrefs(), theme: m })
    applyTheme(resolveTheme(m, themeCoord, new Date()))
  }
  const sp = appConfig.copy.sharePosition

  const themeOpts: { m: ThemeMode; label: string }[] = [
    { m: 'auto', label: appConfig.copy.nav.autoMode },
    { m: 'day', label: appConfig.copy.nav.dayMode },
    { m: 'night', label: appConfig.copy.nav.nightMode },
  ]
  const captionOpts: { m: CaptionMode; label: string }[] = [
    { m: 'off', label: appConfig.copy.settings.captionsOff },
    { m: 'auto', label: appConfig.copy.settings.captionsAuto },
    { m: 'all', label: appConfig.copy.settings.captionsAll },
  ]

  const cp = appConfig.copy.settings

  // Leeres Erfassungsblatt — per-device utility ACTION (not a setting): an AdFU can produce
  // a fresh paper hand-fill sheet in the field. Same generator as the admin's Erfassung view;
  // the jsPDF chunk loads lazily so it stays out of the critical bundle. Offline it prints the
  // last roster this device held (usePersonnel · loadRoster); with none at all it still yields a
  // usable sheet with blank guest lines.
  const [sheetBusy, setSheetBusy] = useState(false)
  const downloadBlankSheet = async () => {
    if (sheetBusy) return
    setSheetBusy(true)
    let names: string[] = []
    try {
      names = (await loadRoster())
        .filter((p) => p.active)
        .map((p) => p.displayName)
        .sort(compareText)
    } catch { /* roster unavailable → the blank guest lines still make a usable sheet */ }
    try {
      const { downloadSheetPdf } = await import('../../admin/capturePdf')
      const dc = getDeploymentConfig()
      downloadSheetPdf({
        stationName: dc.identity?.appName ?? 'KP Front',
        names,
        catalogue: dc.mittel?.catalogue ?? appConfig.mittel.catalogue,
        groups: dc.alarms?.groups ?? [],
        vehicles: dc.fleet?.vehicles ?? [],
        partnerOrgs: dc.report?.partnerOrgs ?? [],
      })
    } catch {
      toast(cp.blankSheetFailed, { icon: 'warn', tone: 'warn' })
    } finally { setSheetBusy(false) }
  }

  return (
    <Modal title={cp.title} onClose={onClose}>
      <div className="set-sheet">
        <section className="set-group">
          <h3 className="set-group-t">{cp.deviceGroup}</h3>
          {/* «Alarm auf diesem Gerät» (3am sweep §1, 23.10.2026): the same line as the Karte home's
              «Auf diesem Gerät», so the fix is also where somebody looks for a switch — one line
              that opens, no heading of its own (sweep 28.10.2026, 17A) */}
          <AlarmReadinessRows className="set-alarm" />
          <div className="set-card">
            <div className="set-row">
              <span className="set-row-l">{cp.colorScheme}</span>
              <Segmented<ThemeMode> ariaLabel={cp.colorScheme} value={themeMode} onChange={setTheme}
                options={themeOpts.map(({ m, label }) => ({ value: m, label }))} />
            </div>
            {/* Two sliders, not one S/M/L segment: an unlinked Modul sheet and the Lage never
                wanted the same size. Once the sheet is georeferenced it follows Karte instead;
                the subtitles make that automatic hand-off visible before somebody drags. */}
            <ScaleRow surface="map" label={cp.symbolSizeMap} sub={cp.symbolSizeMapSub}
              value={symbolScale.map} onChange={onSymbolScale} />
            <ScaleRow surface="board" label={cp.symbolSizeBoard} sub={cp.symbolSizeBoardSub}
              value={symbolScale.board} onChange={onSymbolScale} />
            <div className="set-row">
              <span className="set-row-l">{cp.symbolCaptions}<small>{cp.symbolCaptionsSub}</small></span>
              <Segmented<CaptionMode> ariaLabel={cp.symbolCaptions} value={symbolCaptions} onChange={onSymbolCaptions}
                options={captionOpts.map(({ m, label }) => ({ value: m, label }))} />
            </div>
            <div className="set-row">
              <span className="set-row-l">{cp.railLabels}<small>{cp.railLabelsSub}</small></span>
              {/* a yes/no too («soll da Text stehen»), so the same `OnOff` (28.09.2026) – it said
                  «Aus | Wörter»; the stored value keeps its 'off' | 'short' names */}
              <OnOff ariaLabel={cp.railLabels} value={railLabels === 'short'} onChange={(v) => onRailLabels(v ? 'short' : 'off')} />
            </div>
            <div className="set-row">
              <span className="set-row-l">{cp.keyHints}<small>{cp.keyHintsSub}</small></span>
              {/* its own device-pref store (useKeyHints), not a prop: the rails read it too and the
                  sheet sits over them – no parent threads it, nothing remounts */}
              <OnOff ariaLabel={cp.keyHints} value={keyHints} onChange={setKeyHints} />
            </div>
            <div className="set-row">
              <span className="set-row-l">{cp.offlineRadius}<small>{cp.offlineRadiusSub}</small></span>
              <Stepper value={offlineRadiusM} min={500} max={3000} step={250} format={(v) => (v < 1000 ? `${v} m` : `${v / 1000} km`)} onChange={onOfflineRadius} ariaLabel={cp.offlineRadius} />
            </div>
            {/* The yes/no rows below are the ONE binary idiom, `OnOff` – «Aus | An», in that
                order (28.09.2026). They each built their own pair, «Ein | Aus» or «Erlaubt | Aus»,
                with «on» on the LEFT – the mirror image of every editor sheet's switch, so the same
                thumb-position meant «on» here and «off» there. */}
            <div className="set-row">
              <span className="set-row-l">{cp.offlineAuto}<small>{cp.offlineAutoSub}</small></span>
              <OnOff ariaLabel={cp.offlineAuto} value={offlineAuto} onChange={onOfflineAuto} />
            </div>
            <div className="set-row">
              <span className="set-row-l">{cp.keepScreenOn}<small>{cp.keepScreenOnSub}</small></span>
              <OnOff ariaLabel={cp.keepScreenOn} value={keepScreenOn} onChange={onKeepScreenOn} />
            </div>
            {onPhotoPosition && (
              <div className="set-row">
                <span className="set-row-l">{appConfig.copy.photoGeo.settingsLabel}<small>{appConfig.copy.photoGeo.settingsHint}</small></span>
                <OnOff ariaLabel={appConfig.copy.photoGeo.settingsLabel} value={!!photoPosition} onChange={onPhotoPosition} />
              </div>
            )}
            {/* No Führungsansicht row (05.10.2026): it is the LOGIN's, set by the admin
                (Benutzer · «Startet in Führungsansicht»), not a per-device switch. */}
            {/* Standort verwenden — the standing PERMISSION only, never the act of sharing:
                that is switched on per Einsatz from the compass menu on the map. A device
                preference, so it belongs in this group and NOT in the synced incident settings,
                where a second editor could grant it on somebody else's behalf. */}
            {onSharePosition && (
              <div className="set-row">
                <span className="set-row-l">
                  {sp.settingsLabel}
                  <small>{sp.settingsHint}</small>
                </span>
                <OnOff ariaLabel={sp.settingsLabel} value={!!shareAs} onChange={onSharePosition} />
              </div>
            )}
            {/* WHO the device reports as — its own row with the name ON the button, so changing it
                is one tap (05.10.2026, owner: «have the selected person … be immediately
                editable»). It was a grey «Als …» under the switch, and the only way to another
                name was off, on, and the consent sheet all over again. */}
            {onSharePosition && shareAs && onChangeShareName && (
              <div className="set-row">
                <span className="set-row-l">{sp.settingsName}<small>{sp.settingsNameSub}</small></span>
                <Button className="set-name" icon={<Icon id="pen" />} onClick={onChangeShareName}
                  aria-label={`${sp.settingsName}: ${shareAs} – ${sp.change}`}>
                  <span className="set-name-v">{shareAs}</span>
                </Button>
              </div>
            )}
          </div>
          <p className="set-group-foot">{cp.deviceFoot}</p>
        </section>

        {/* The «Einsatz» group (Funkkontakt-Intervall, Nachfrist, Funkkanal) left this sheet
            28.08.: station doctrine belongs in /admin, where whoever set it up changes it — not
            under the finger of an unknowing operator at 3am. The per-incident override plumbing
            (IncidentSettings) stays for values already written; the doctrine is the source. */}

        <section className="set-group">
          <h3 className="set-group-t">{cp.utilityGroup}</h3>
          <div className="set-card">
            <div className="set-row">
              <span className="set-row-l">{cp.blankSheet}<small>{cp.blankSheetSub}</small></span>
              {/* the roster fetch and the PDF chunk take a moment: the loader says it is working (28.10.2026) */}
              <Button icon={sheetBusy ? <ShellLoader /> : <Icon id="doc" />} disabled={sheetBusy} aria-busy={sheetBusy || undefined} onClick={() => void downloadBlankSheet()}>
                {cp.blankSheetDownload}
              </Button>
            </div>
            {onFeedback && (
              <div className="set-row">
                <span className="set-row-l">{cp.feedbackRow}<small>{cp.feedbackRowSub}</small></span>
                <Button icon={<Icon id="mail" />} onClick={onFeedback}>
                  {cp.feedbackOpen}
                </Button>
              </div>
            )}
          </div>
        </section>
      </div>
    </Modal>
  )
}
