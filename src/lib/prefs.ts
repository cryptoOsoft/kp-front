// Small cookie-backed UI preferences — remembers which surface (Lage / Plan) and
// which plan document the user was last on, so a reload returns them there.
// Cookie (not localStorage) by request; it's a tiny, non-sensitive, functional
// preference so it needs no consent banner.

import type { CaptionMode } from '../types'
import { isDaytime, type Coord } from './daylight'

const COOKIE = 'kp-front-prefs'
const MAX_AGE = 60 * 60 * 24 * 365 // 1 year

/** UI colour-scheme preference. 'auto' (the default) tracks local daylight so the app
 *  dims itself after dusk on its own; 'day'/'night' are explicit manual overrides. */
export type ThemeMode = 'auto' | 'day' | 'night'

/** Rail labelling: glyphs only, or the word stacked under each glyph. */
export type RailLabels = 'off' | 'short'

/** LEGACY: one global tactical-symbol size for BOTH surfaces. Superseded by the per-surface
 *  multipliers below (`symbolScaleMap` / `symbolScaleBoard`) — one size could not serve both:
 *  on a Modul-2/3 sheet even 'S' was still too big, on the map 'L' was already too big.
 *  Read only to migrate an older cookie (see symbolScales); never written any more. */
export type SymbolSize = 'S' | 'M' | 'L'

/** The two symbol-size settings: the Lage map (also used by georeferenced Modul boards) and
 *  standalone Plan/Modul boards. A personal legibility preference like `theme`, so it stays a
 *  DEVICE pref — the tablet at the Kommandoposten and the phone in a pocket want different
 *  sizes, and neither may impose one on the other through the synced workspace. */
export type SymbolSurface = 'map' | 'board'

/** Bounds of one Symbolgrösse slider (multipliers, 1 = the tuned default). */
export interface SymbolScaleRange { min: number; max: number; step: number; default: number }

export interface Prefs {
  mode?: 'map' | 'plans' | 'checklists' | 'atemschutz' | 'anwesenheit' | 'mittel' | 'rapport'
  /** The Einsatz `mode` was last chosen in. The remembered surface only applies when the SAME
   *  Einsatz reopens (a mid-Einsatz reload lands back where the operator was); a different —
   *  above all a NEW — Einsatz starts on the Karte (Feldtest Manuel, 07.09.: a fresh alarm
   *  opened on yesterday's Atemschutz tab). See `initialMode`. */
  modeIncidentId?: string
  activePlanId?: string
  /** last active incident id, so a reload reopens it */
  incidentId?: string
  /** when `incidentId` was chosen BY HAND (epoch ms). A boot auto-open does not stamp it, so it
   *  answers exactly one question: had the operator already decided, at the time this alarm
   *  arrived? An alarm older than that decision must not override it (lib/incidentAlerts ·
   *  pickBootIncident). */
  incidentChosenAt?: number
  /** when the operator closed an Einsatz on this device and landed on the launcher (epoch ms).
   *  Until they open one by hand, a cold start stays on the launcher too — only an alarm that
   *  arrived AFTER the close may open by itself (lib/incidentAlerts · pickBootIncident). Without
   *  it the boot fell back to the first open Einsatz, so every launch after an Abschluss stood
   *  inside whatever Übung was still open. */
  landedAt?: number
  /** LEGACY: the manually-picked Einsatzobjekt now lives in the synced workspace blob
   *  (Saved.pickedObjectId), per incident + shared across devices. Kept only so deriveInitial
   *  can one-time import an in-flight cookie pick on upgrade; cleared at boot afterwards. */
  pickedObject?: { incidentId: string; objectId: string }
  /** REMOVED — the Anwesenheit tab now lives in sessionStorage, stamped with the incident (see
   *  AnwesenheitView · TAB_KEY). Coming back to your tab across a reload is worth keeping; a
   *  choice made last week deciding where a fresh launch lands is not, and it must not follow
   *  you into the next Einsatz. Left documented rather than silently dropped: a stale cookie
   *  from an older build may still carry the field, and it is simply ignored. */
  /** UI colour scheme — see ThemeMode. Default 'auto' (daylight-driven). */
  theme?: ThemeMode
  /** LEGACY global tactical-symbol size — see SymbolSize. Kept (and never deleted) so a cookie
   *  written by an older build still resolves to the size its owner picked, and so rolling that
   *  build back finds what it wrote. Migration is lazy: see symbolScales. */
  symbolSize?: SymbolSize
  /** tactical-symbol size on the Lage map — a multiplier on the symPx band (lib/mapView · symPx).
   *  Absent → migrated from `symbolSize`, else 1. See SYMBOL_SCALE for the band. */
  symbolScaleMap?: number
  /** tactical-symbol size on standalone Plan/Modul boards — a multiplier on the plan symbol
   *  base (components/Whiteboard · symBase). A georeferenced board follows `symbolScaleMap`,
   *  because it is now another scaled view of the Lage. Absent → migrated from `symbolSize`,
   *  else the board default. */
  symbolScaleBoard?: number
  /** on-canvas symbol captions (metadata printed under each glyph) — a personal legibility
   *  preference like `symbolSize`. Default falls to appConfig.symbols.captionDefault ('auto'). */
  symbolCaptions?: CaptionMode
  /** Words under the glyphs in both rails. Off by default — the icons ARE the rail for anybody who
   *  uses this app regularly, and the labels cost 10px of map for good.
   *  ⚠️ Not the same thing as the rails' expand chevron: that one widens the rail and puts the word
   *  BESIDE the glyph, and it is a transient state (nothing remembers it). This is a device
   *  preference and stacks the word UNDER the glyph, which is what a first-timer needs on a rail
   *  of seven surfaces and nine tools with no words at all. Default 'off' — on a PHONE 'short'
   *  (29.09.2026, owner: «at least on mobile default to "Wörter" so that all toolbars and views
   *  are always labelled»); see `railLabelsFor`. */
  railLabels?: RailLabels
  /** the device's own hand set `railLabels` in the Einstellungen. Until then the stored value is
   *  only the default the app saved along with everything else, and a phone reads 'short'. */
  railLabelsChosen?: boolean
  /** «Tastenkürzel anzeigen» (31.10.2026): the shortcut letter badge (K · C · A … V · L · F …) on
   *  every tile of both rails. A DEVICE pref – it is about the keyboard in front of THIS device,
   *  never synced and never station config. Default ON (absent = on, see `keyHintsFor`); `false`
   *  hides them. It only ever shows on a fine pointer with hover (CSS · 04b-rail.css): a touch-only
   *  device has no keyboard to read them for, whatever this says. */
  keyHints?: boolean
  /** radius (metres) of the box cached around the incident by "Alles für offline laden".
   *  Device pref — each device decides how much to store. Default 1200. */
  offlineRadiusM?: number
  /** Offline-Vorbereitung: the installed app quietly runs «Alles für offline laden» itself,
   *  shortly after an Einsatz is opened, so devices are simply ready without anybody pressing
   *  the button (28.08. field feedback — the button relies on someone remembering it).
   *  Default TRUE. `false` = «Aus» (manual only). Two states, deliberately no «nur WLAN» tier:
   *  Safari/iPadOS exposes no network-type API, so a WLAN gate could not work on the primary
   *  devices and would be a setting that lies. A station worried about SIM data opts out. */
  offlineAuto?: boolean
  /** keep the screen awake (Screen Wake Lock) while an incident is open. Default true — a
   *  command tablet at the scene must not dim mid-operation — but a personal device idling in the
   *  background may prefer to let the screen sleep, so it's a per-device toggle. */
  keepScreenOn?: boolean
  /** «Standort zu Fotos»: a photo without its own EXIF position takes this device's position
   *  (lib/devicePosition). ABSENT = never asked — the first such photo asks, once, with the
   *  reason; the Einstellungen sheet switches it either way afterwards. */
  photoPosition?: boolean
  /** last Verwaltung (admin) section id, so reopening /admin returns to the same page.
   *  Kept loose (string) so prefs.ts doesn't depend on the admin's SectionId union. */
  adminSection?: string
  /** LEGACY: Objektbesuche · «Von» was kept here until 05.10.2026. It moved to localStorage
   *  (`objectVisits/devicePrefs`, Safari caps this script cookie at seven days); read only as the
   *  fallback for a name an older build left behind, never written any more. */
  ovWith?: string
  /** RETIRED (05.10.2026): the per-device Führungsansicht toggle. The Führungsansicht is now the
   *  login's alone (AuthUser.el_view_default, set in the admin's Benutzer). Left documented rather
   *  than dropped: a cookie written by an older build may still carry it, and it is ignored —
   *  nothing reads it, so a device that once switched it on is not stuck hands-off. */
  elView?: boolean
  /** what the top Einsatzuhr shows — tap it to cycle. Default 'elapsed' (running duration). */
  clockMode?: 'elapsed' | 'now' | 'start'
  /** How the Atemschutz board is ordered. Default 'manuell' — «wie gesetzt», the hand-set order,
   *  so a card keeps its slot and «Trupp 2 is the second one» stays true for the whole Einsatz.
   *  A device pref because it is a way of LOOKING at the board; the hand-set order itself is
   *  synced (Trupp.order), so «wie gesetzt» shows the same thing on every device.
   *  ⚠️ «Wie gesetzt» keeps EVERY card in its slot, an überfälliger Trupp included: on the tablet
   *  the board does not rearrange itself under the operator (owner, 23.10.2026). The derived
   *  sorts float an überfälliger Trupp to the top; the phone board has no order choice and
   *  always sorts by urgency, because there a card can hide off-screen (AtemschutzView). */
  atemschutzOrder?: 'dringlichkeit' | 'manuell' | 'auftrag' | 'name'
  /** Standort teilen — this device's standing PERMISSION to use its position for it, plus
   *  who it reports as. A DEVICE preference by design: it is the phone's owner deciding about
   *  their own phone, so it must not ride the synced workspace where another editor could
   *  flip it.
   *
   *  Deliberately NOT "currently sharing". Sharing is an act, switched on per Einsatz from the
   *  compass menu and off again when that Einsatz ends — so nobody's phone starts broadcasting
   *  because of something they agreed to months ago. */
  sharePosition?: SharePositionPref
  /** Georeferenz twin layers that have been switched OFF on this device, keyed by their Ebenen
   *  row id (lib/georefTwins · twinPlanImageLayerId). Absent or `true` = shown, which is
   *  the default: a georeference exists because somebody deliberately made one, and seeing both
   *  pictures at once is what they made it for.
   *
   *  A DEVICE pref, exactly like the map's own layer visibility — that rides the workspace blob
   *  but `mergeWorkspace` keeps `layerState` local, so «which layers am I looking at» has never
   *  been something one device imposes on another. Same rule, kept in the same place a twin row
   *  can actually reach: the plan ids are per object and would have no home in the fixed
   *  `LayerDef` list `layerState` is reconciled against (lib/workspace · deriveInitial). */
  twinLayers?: Record<string, boolean>
  /** Transparency (0..100) of opt-in georeferenced plan rasters on the Lage map. */
  twinLayerOpacity?: Record<string, number>
  /** The Karte's «Niederschlag (Radar)» row in Ebenen (components/WeatherLayer): the id of the
   *  Einsatz it is switched on in (workspace/useKarteWeather · einsatzRadarStore). A device pref
   *  like the plan rasters – what this screen looks at, not the Einsatz's tactical picture – but
   *  only for that one Einsatz: every other starts without it, the radar is something you look
   *  at on purpose. */
  weatherRadarIn?: string
  /** its transparency (0..100), the Ebenen panel's own slider */
  weatherRadarOpacity?: number
}

export interface SharePositionPref {
  /** the device may use its position for this. false = revoked (or never granted). */
  allowed: boolean
  /** roster person id this device reports as — the name its holder picked */
  personId?: string
  /** display name at the time of picking; shown in the UI so the control can say who you would
   *  be sharing as without waiting for the roster to load */
  displayName?: string
  /** the Einsatz whose holder confirmed «das bin ich» on this device. The name above is
   *  remembered for convenience, the CONFIRMATION is not: a device only reports under a name
   *  for the Einsatz it was confirmed for, so the shared Tablet cannot carry the last
   *  Einsatz's name into the next one. Persisted (not session state) so re-opening the same
   *  Einsatz does not ask again. */
  confirmedIncidentId?: string
  /** opaque random id for this device, so the backend can tell two phones apart (and refuse
   *  a second one claiming a name that is actively sharing). Never a device fingerprint. */
  deviceId?: string
}

/** Bounds for the two Symbolgrösse sliders.
 *
 *  Derived from the S/M/L multipliers they replace (S 0.6 · M 1 · L 1.3), so nothing anyone had
 *  set becomes unreachable and 1 — the tuned default — stays the exact midpoint of both sliders.
 *
 *  The two bands differ on purpose, because the surfaces are not the same problem:
 *   • Karte: a symbol sits on a house and competes with the map under it. 'L' (1.3) was already
 *     at the edge of too big, so the ceiling only goes a touch past it and the floor keeps the
 *     old 'S'.
 *   • Module: a Modul-2/3 sheet is a whole floor on one page. Even 'S' (0.6) was still a symbol
 *     you place two of before they touch — the complaint this rework exists for — so the floor
 *     drops well below it, and the ceiling rises to match for a Modul-1 Übersicht read from
 *     across the room.
 *
 *  0.05 steps: fine enough that the slider feels continuous under a thumb, coarse enough that
 *  two devices set «by eye» land on the same number. */
export const SYMBOL_SCALE: Record<SymbolSurface, SymbolScaleRange> = {
  map: { min: 0.6, max: 1.4, step: 0.05, default: 1 },
  // 0.2 is deliberately two thirds of the previous floor: on dense Modul sheets 0.3 still
  // made neighbouring FKS glyphs overlap before their anchors were meaningfully distinct.
  // ⚠️ The DEFAULT is 0.7, not the map's 1. A Modul sheet is a building at 1:200 on an A4 —
  // a symbol sized for the Lage covers a whole room on it, and every station that has used the
  // plan surface has reached for the slider in the same direction on its first Einsatz. The
  // slider still runs to 1.8 for anybody who wants the old size.
  // ⚠️ Only devices that have never moved the slider (and carry no legacy `symbolSize`) are
  // affected — see `symbolScales`, where the stored value wins and nothing is rewritten.
  board: { min: 0.2, max: 1.8, step: 0.05, default: 0.7 },
}

/** Snap a multiplier onto its surface's slider band. Anything unusable — a hand-edited cookie,
 *  a value from a build with different bounds — falls back to that surface's default rather
 *  than rendering symbols at 0× or 40×. */
export const clampSymbolScale = (surface: SymbolSurface, n: number | undefined): number => {
  const r = SYMBOL_SCALE[surface]
  if (typeof n !== 'number' || !Number.isFinite(n)) return r.default
  const snapped = Math.round(n / r.step) * r.step
  // …and back off the binary-float dust 0.05 steps leave behind (0.7000000000000001)
  return Math.min(r.max, Math.max(r.min, Math.round(snapped * 100) / 100))
}

/** LEGACY S/M/L → multiplier, for migration only (see symbolScales).
 *  ⚠️ S is 0.6, not the 0.8 it was until 17.08. */
export const legacySymbolMul = (size: SymbolSize | undefined): number =>
  size === 'S' ? 0.6 : size === 'L' ? 1.3 : 1

/** The multipliers this device sizes tactical symbols with, per surface.
 *
 *  Migration is LAZY and LOSSLESS: a cookie that still carries only the old global `symbolSize`
 *  resolves to that size's multiplier on BOTH surfaces, so a device keeps exactly the size it
 *  had until somebody moves a slider. Nothing rewrites the cookie to achieve it and the old key
 *  is never deleted — a rolled-back build still finds what it wrote. */
export function symbolScales(p: Prefs): Record<SymbolSurface, number> {
  const legacy = p.symbolSize ? legacySymbolMul(p.symbolSize) : undefined
  return {
    map: clampSymbolScale('map', p.symbolScaleMap ?? legacy),
    board: clampSymbolScale('board', p.symbolScaleBoard ?? legacy),
  }
}

/** The multiplier a Plan surface renders with. Once a Modul is georeferenced, it has the map's
 *  real scale and becomes another view of the Lage; its symbols therefore follow the Karte
 *  setting automatically. An unlinked sheet keeps the independently tuned Modul setting. */
export function planSymbolScale(scales: Record<SymbolSurface, number>, georeferenced: boolean): number {
  return scales[georeferenced ? 'map' : 'board']
}

function readCookie(name: string): string | null {
  const match = document.cookie.split('; ').find((row) => row.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null
}

/** The surface a just-opened Einsatz starts on. An Atemschutz-Link session has exactly one
 *  surface; everyone else gets the remembered `mode` only when it was chosen in THIS Einsatz —
 *  otherwise the Karte, because a new emergency must open on the Lage, not on whatever tab the
 *  last one ended on (Feldtest Manuel, 07.09.). */
export function initialMode(prefs: Prefs, incidentId: string, asLink: boolean): NonNullable<Prefs['mode']> {
  if (asLink) return 'atemschutz'
  return prefs.modeIncidentId === incidentId ? (prefs.mode ?? 'map') : 'map'
}

/**
 * «Beschriftung der Werkzeugleisten» as this device reads it (29.09.2026, sweep T8). A phone
 * defaults to the words: its nav bar and tool bar are five even tiles with room for a word under
 * each, and a gloved first-timer at 3am cannot hover for a tooltip. A tablet keeps the glyphs
 * (the words there widen the rails into the map). A device that chose keeps its choice.
 * ⚠️ The app saved `railLabels: 'off'` with every other pref long before anyone could choose, so
 * a stored 'off' without `railLabelsChosen` is the old default, not a choice — a phone reads
 * 'short' over it. A stored 'short' is always a choice (it was never a default before).
 */
export function railLabelsFor(p: Pick<Prefs, 'railLabels' | 'railLabelsChosen'>, phone: boolean): RailLabels {
  if (p.railLabelsChosen || p.railLabels === 'short') return p.railLabels ?? 'off'
  return phone ? 'short' : 'off'
}

/** «Tastenkürzel anzeigen» as this device reads it: ON until somebody switches it off. */
export const keyHintsFor = (p: Pick<Prefs, 'keyHints'>): boolean => p.keyHints ?? true

export function loadPrefs(): Prefs {
  try {
    const raw = readCookie(COOKIE)
    if (!raw) return {}
    const v = JSON.parse(raw)
    return v && typeof v === 'object' ? v : {}
  } catch { return {} }
}

export function savePrefs(prefs: Prefs) {
  try {
    const value = encodeURIComponent(JSON.stringify(prefs))
    document.cookie = `${COOKIE}=${value}; path=/; max-age=${MAX_AGE}; samesite=lax`
  } catch { /* ignore */ }
}

// theme-color for the browser/PWA chrome, matched to each scheme's app background.
// Day mirrors the original index.html value; night uses the dark canvas backdrop.
const THEME_COLOR: Record<'day' | 'night', string> = {
  day: '#eef3f7',
  night: '#0d1118',
}

/**
 * Apply a colour scheme: flips the `<html data-theme>` attribute (CSS tokens key
 * off it) and updates `<meta name="theme-color">` so the system browser bar matches.
 * Pure DOM side-effects — does not persist; callers persist via savePrefs.
 */
export function applyTheme(theme: 'day' | 'night') {
  if (theme === 'night') document.documentElement.dataset.theme = 'night'
  else delete document.documentElement.dataset.theme // 'day' is the default :root
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', THEME_COLOR[theme])
  // Leave the resolved scheme where the next cold start can read it synchronously: the inline
  // boot script in index.html paints the splash before any of this module exists, and 'auto'
  // (the default) needs a daylight computation it cannot do. localStorage, not the prefs cookie,
  // because this is a derived boot hint rather than a user preference — and because the boot
  // script must read it without parsing JSON. Best-effort: private mode may refuse.
  try { localStorage.setItem('kp.theme.boot', theme) } catch { /* boot falls back to the OS */ }
}

/** Resolve a ThemeMode to the concrete scheme to apply: explicit modes pass through,
 *  'auto' (and any legacy/absent value) resolves from daylight at `coord` (or the
 *  brigade region when no incident coordinate is known yet). */
export function resolveTheme(mode: ThemeMode | undefined, coord: Coord | null, now: Date): 'day' | 'night' {
  if (mode === 'day' || mode === 'night') return mode
  return isDaytime(coord, now) ? 'day' : 'night'
}
