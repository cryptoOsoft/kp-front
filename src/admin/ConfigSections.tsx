import { ShellLoader } from '../components/ShellLoader'
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { AlarmGroup, DeploymentConfig, DeploymentFleet, FleetVehicle } from '../lib/deploymentConfig'
import { legacyFleetToAttributeLists, DEFAULT_MODULES } from '../lib/deploymentConfig'
import { CONTACT_BOUNDS } from '../lib/workspace'
import { geoDatasetId, geoLayerUrl, inspectGeojson, listReference, uploadReference, type ReferenceDataset } from '../lib/incidents'
import { ApiError, apiGet } from '../lib/api'
import { useConfig, getPath } from './ConfigContext'
// No `Field` any more: every setting on these pages is a row of the settings table now, and
// the list editors' records are a divider plus their fields as rows of the same grid.
import {
  Card, ConfirmButton, InlineRecord, InlineRecords, NameCombo, Offer, RecordRows, RecordTable, Select, SettingRow,
  SettingsGroup, SettingsNote, SettingsSheet, fmtDate, standardNote,
} from './ui'
import { AVAILABLE_LOCALES } from '../config/copy'
import { FleetAttributesViewer } from './FleetAttributesViewer'
import { ModulesViewer } from './ModulesViewer'
import { ObjectPlansView } from './ObjectPlansView'
import { ObjectCategoriesCard } from './ObjectCategoriesCard'
import { GeodataView } from './DataView'
import { BrandingFields } from './BrandingFields'
import { allAuftragTypes, appConfig } from '../config/appConfig'
import { fillTemplate, compareText } from '../lib/format'
import { DEFAULT_HOURS_ROUNDING, fmtHours, roundedMinutes } from '../lib/attendanceHours'
import { DEFAULT_ATTENDANCE_MERGE_GAP_MIN } from '../lib/attendanceIntervals'
import { HOSE_SIZES, RELAY_HOSE_SIZES, SHIPPED_HOSE } from '../lib/hydraulics'
import {
  isOpenableUrl, linkTokenValues, resolveLinkUrl, REPORT_LINK_TOKENS,
  type ReportLink, type ReportLinkFacts,
} from '../lib/reportLinks'
import { Icon } from '../lib/icons'
import { StringList } from './StringList'
import { lv95ToWgs84, wgs84ToLV95 } from '../lib/geo'
import type { DeploymentExternalLink, DeploymentReferenceLayer } from '../lib/deploymentConfig'

// The five "Station" pages. Each edits one facet of the single config document via the
// shared ConfigContext (draft + Save live in the provider, not here). Section-level help
// that merely repeated the caption was dropped; field-level tips stay where they teach.

// Number-field value → store. Empty input becomes `null` (NOT 0), so clearing a field
// never silently writes a zero doctrine value.
function numOrNull(raw: string): number | null {
  if (raw.trim() === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}
// A machine key typed by a human: the Kennung of a vehicle or of an alarm group. Both are keys a
// milestone webhook joins recorded times on, so both are lowercase and dashed — and in both
// editors the field FOLLOWS the Bezeichnung until somebody edits it by hand.
const slugId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

function numStr(v: number | null | undefined): string {
  return v == null ? '' : String(v)
}

/**
 * What `backend/app/schemas.py` accepts in one number box.
 *
 * ⚠️ The config is ONE document with a 700 ms autosave, so a single 422 stops the autosave for
 * every Station page at once — the field being typed AND the four pages nobody is looking at.
 * Every bounded number is therefore checked against the real schema BEFORE it enters the draft:
 * a value the API would refuse stays in local state with a German line saying why, and the
 * stored value (plus every other section) is left alone meanwhile.
 *
 * ⚠️ `nullable` is the schema's `| None`, NOT «the box may be empty». `doctrine.*` is nullable —
 * clearing it goes back to the shipped doctrine. `report.hoursRounding.stepMin` and the two
 * numbers beside it are plain `int` with a default, always populated by the GET projection:
 * backspacing «30» to type «60» wrote `null` into a field that has no null and wedged the whole
 * document for as long as the box was empty.
 */
export interface NumberGuard {
  /** `int` on the backend — 8.5 is an `int_from_float` error there, not a rounding */
  kind: 'int' | 'decimal'
  min?: number
  max?: number
  /** the schema's `gt` rather than `ge` (doctrine.cylinderLiters: gt=0, le=30) */
  exclusiveMin?: boolean
  /** the schema accepts `null` here, so an empty box is a value rather than a refusal */
  nullable?: boolean
}

/** The value to store, or `undefined` when the API would refuse it. */
function guardedNumber(raw: string, g: NumberGuard): number | null | undefined {
  if (raw.trim() === '') return g.nullable ? null : undefined
  const n = Number(raw)
  if (!Number.isFinite(n)) return undefined
  if (g.kind === 'int' && !Number.isInteger(n)) return undefined
  if (g.min != null && (g.exclusiveMin ? n <= g.min : n < g.min)) return undefined
  if (g.max != null && n > g.max) return undefined
  return n
}

/** Why the typed value is not stored, in the operator's language. ⚠️ Covers the three shapes the
 *  config schema actually has: a bounded int, an unbounded int, and a decimal with an exclusive
 *  lower bound. A new shape needs its own sentence rather than the closest one. */
function guardMessage(g: NumberGuard): string {
  const N = appConfig.copy.admin.numbers
  if (g.min == null || g.max == null) return N.integer
  const bounds = { min: g.min, max: g.max }
  if (g.kind === 'decimal') return fillTemplate(N.decimalOver, bounds)
  return fillTemplate(N.integerRange, bounds)
}

/**
 * A number box bound to a config path, following the rule above.
 *
 * A hook returning a plain JSX helper — NOT a nested component, which would remount on every
 * keystroke and lose the focus mid-typing. The typed text lives in one bag keyed by path, so a
 * refused value stays legible on screen while the draft keeps the last value the API accepted.
 */
function useNumberField() {
  const { draft, set } = useConfig()
  const [editing, setEditing] = useState<Record<string, string>>({})
  return function numberField(opts: {
    path: (string | number)[]
    label: string
    tip?: string
    guard: NumberGuard
    /** what the app runs on while the document stores nothing (the shipped doctrine) */
    fallback?: number
    placeholder?: string
    /** a section with its own wording for the refusal (Alarme & Einsätze) */
    message?: string
    /** what the Standard column names when the stored value deviates from it. Defaults to
     *  `fallback`; a field whose default is not one of those (Rapport: a schema default the GET
     *  projection always fills in) passes it here. */
    standard?: number
    /** Keep coupled fields valid when this accepted value changes their meaning. */
    onAccepted?: (value: number | null) => void
  }) {
    const key = opts.path.join('.')
    const stored = numStr(getPath<number>(draft, opts.path) ?? opts.fallback)
    const text = editing[key] ?? stored
    const value = guardedNumber(text, opts.guard)
    // ⚠️ The DOCUMENT's value, not `text`: a half-typed number is not a deviation yet, and the
    // Standard column must not flicker on every keystroke.
    const standard = standardNote(getPath<number>(draft, opts.path), opts.standard ?? opts.fallback)
    return (
      <Fragment key={key}>
        <SettingRow label={opts.label} tip={opts.tip} standard={standard}>
          <input
            className="adm-input adm-input-mono adm-input-num"
            type="number"
            step={opts.guard.kind === 'int' ? 1 : 'any'}
            min={opts.guard.min} max={opts.guard.max}
            placeholder={opts.placeholder}
            value={text}
            aria-invalid={value === undefined ? true : undefined}
            onChange={(e) => {
              const raw = e.target.value
              setEditing((s) => ({ ...s, [key]: raw }))
              const v = guardedNumber(raw, opts.guard)
              if (v !== undefined) {
                set(opts.path, v)
                opts.onAccepted?.(v)
              }
              // else: the stored number stays as it is, and the warning below says why
            }}
          />
        </SettingRow>
        {value === undefined && (
          <SettingsNote tone="warn">{opts.message ?? guardMessage(opts.guard)}</SettingsNote>
        )}
      </Fragment>
    )
  }
}

/** Which entry of AVAILABLE_LOCALES a stored `identity.locale` actually resolves to, or ''
 *  when the deployment has chosen nothing this app recognises.
 *
 *  ⚠️ Must follow copy/index.ts · normalizeKey: the running app matches on the PRIMARY SUBTAG,
 *  so 'de' and 'de-CH' are both Deutsch and 'fr-CH' is Français, while anything unknown falls
 *  back to German. The picker has to say what the app does, not what the string looks like. */
function resolveLocaleChoice(stored: string | null | undefined): string {
  const base = (stored ?? '').split('-')[0]!.toLowerCase()
  if (!base) return ''
  return AVAILABLE_LOCALES.find((l) => l.id.split('-')[0]!.toLowerCase() === base)?.id ?? ''
}

/** Hex, the four CSS forms, `#` optional — the SAME rule the API enforces
 *  (backend/app/schemas.py · _ACCENT_HEX) and the narrowest consumer needs (the PWA manifest's
 *  `theme_color` is hex-only; webmanifest.py · _HEX_COLOR). Keep the three in step. */
const HEX_COLOR = /^#?(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
/** What `--accent` falls back to when the station has chosen nothing (styles/01-tokens.css). */
const DEFAULT_ACCENT = '#e8392b'

/** Normalised for storage: lowercase, always with the `#`. */
const canonicalHex = (raw: string) => `#${raw.trim().replace(/^#/, '').toLowerCase()}`

/** …and as `<input type="color">` needs it: exactly six digits, no alpha. A 3-digit hex is
 *  expanded and an 8-digit one loses its alpha — otherwise the picker silently shows BLACK for
 *  a colour that is perfectly valid everywhere else. */
function pickerHex(raw: string): string {
  const v = raw.trim().replace(/^#/, '').toLowerCase()
  if (v.length === 3 || v.length === 4) return `#${v.slice(0, 3).split('').map((c) => c + c).join('')}`
  return `#${v.slice(0, 6)}`
}

/**
 * Akzentfarbe — the swatch picker and the text field beside it, as ONE value.
 *
 * ⚠️ Same rule as the map centre below: a value that is not a colour must never enter the
 * config document. It used to be free text with no check anywhere — «nicht-eine-farbe» was
 * answered with 200 and «Gespeichert», the swatch went black, and the value went on to the
 * login screen, the splash and the Rapport letterhead. The API refuses it now; this field says
 * so in German BEFORE it is ever sent, and — like the centre — leaves the stored colour alone
 * meanwhile, so the half-typed «#e83» blocks nothing else on the page.
 *
 * The picker is the honest answer to «what may I type here», and it was already here; what was
 * missing is that the text field accepted anything and the swatch claimed the result was black.
 */
export function AccentColorField() {
  const { draft, set } = useConfig()
  const C = appConfig.copy.admin.identity
  const stored = getPath<string>(draft, ['identity', 'accentColor'])
  // The colour as it is being TYPED. Null until the first edit, so one arriving from elsewhere
  // (config import, history restore, CLI push) still shows through.
  const [editing, setEditing] = useState<string | null>(null)
  const text = editing ?? stored ?? ''
  const cleared = text.trim() === ''
  const usable = HEX_COLOR.test(text.trim())
  /** Why the colour on screen is not in the document, or null when it is. */
  const problem = cleared || usable ? null : C.accentColorInvalid

  const write = (next: string) => {
    setEditing(next)
    if (next.trim() === '') set(['identity', 'accentColor'], null)
    else if (HEX_COLOR.test(next.trim())) set(['identity', 'accentColor'], canonicalHex(next))
    // else: the stored colour stays as it is, and `problem` says why
  }

  return (
    <>
    <SettingRow
      label={C.accentColor} hint={C.accentColorHint} tip={C.accentColorTip}
      standard={standardNote(stored, DEFAULT_ACCENT)}
    >
      <div className="adm-color-row">
        <input
          className="adm-color-swatch"
          type="color"
          // never the unusable text: a swatch that paints black for «nicht-eine-farbe» claims
          // somebody chose black. Unset or unusable both show the fallback that is ACTUALLY live.
          value={usable ? pickerHex(text) : DEFAULT_ACCENT}
          onChange={(e) => write(e.target.value)}
          aria-label={C.pickAccentColor}
        />
        <input
          className="adm-input adm-input-mono"
          type="text"
          value={text}
          onChange={(e) => write(e.target.value)}
          placeholder={DEFAULT_ACCENT}
          aria-invalid={problem ? true : undefined}
        />
      </div>
    </SettingRow>
    {problem && <SettingsNote tone="warn">{problem}</SettingsNote>}
    </>
  )
}

/**
 * The Personalstamm's display names, for the fields that name a person (today: Kommandant).
 *
 * ⚠️ Read from the roster, never typed, because the ORDER is the whole problem. On the 03.09.
 * Rapport the Kommandant printed as «Paul Hauptmann» beside an Einsatzleiter called «Hauptmann
 * Paul» — one person, two conventions, because this page had a free text box while every name
 * that reaches the Rapport from the roster is «Nachname Vorname». Offering the roster's own
 * strings makes the mismatch unavailable.
 *
 * Fails to an EMPTY list, which is a plain text field: a station configuring itself for the
 * first time has no roster yet, and a page that refuses to take a name until one exists would
 * be a setup order nobody chose.
 */
function useRosterNames(): string[] {
  const [names, setNames] = useState<string[]>([])
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const people = await apiGet<{ display_name: string; active?: boolean; is_active?: boolean }[]>('/api/personnel')
        if (!alive) return
        setNames(people
          .filter((p) => p.is_active ?? p.active ?? true)
          .map((p) => p.display_name)
          .sort(compareText))
      } catch { /* no roster (yet) → free text, see above */ }
    })()
    return () => { alive = false }
  }, [])
  return names
}

export function IdentitySection() {
  const { draft, set, applyServerAssets } = useConfig()
  const C = appConfig.copy.admin.identity
  const rosterNames = useRosterNames()
  // An unset `identity.locale` used to render as «Deutsch», which claimed a decision nobody had
  // made — and Select falls back to its FIRST option for any value it does not know, so a
  // legacy or misspelt tag claimed it too. Show the default AS a default instead of silently
  // writing one: this page PUTs the whole config document, so a value materialised on render
  // would save a language the operator never picked (see ConfigContext · the full-document PUT).
  // The extra option exists only while nothing is chosen, so it cannot linger as a duplicate.
  const localeChoice = resolveLocaleChoice(getPath<string>(draft, ['identity', 'locale']))
  const localeOptions = [
    ...(localeChoice ? [] : [{ value: '', label: C.languageDefault }]),
    ...AVAILABLE_LOCALES.map((l) => ({ value: l.id, label: l.label })),
  ]
  return (
    <>
    {/* Titled, because this page is four surfaces: this sheet plus the three MapSection renders
        below. «Station» and «Karte» are the two halves of the page's own title, one on each
        group — a page with more than one card titles every card (ui · Card). */}
    <SettingsSheet title={C.groupStation}>
      <SettingRow label={C.appName} tip={C.appNameTip}>
        <input
          className="adm-input"
          type="text"
          value={getPath<string>(draft, ['identity', 'appName']) ?? ''}
          onChange={(e) => set(['identity', 'appName'], e.target.value || null)}
          placeholder="KP Front"
        />
      </SettingRow>
      {/* the Karte's menu button label (review round 5; schemas · SHORT_NAME_MAX). `maxLength`
          holds the cap here so the server's 422 is only ever a hand-written document's */}
      <SettingRow label={C.shortName} hint={C.shortNameHint} tip={C.shortNameTip}>
        <input
          className="adm-input"
          type="text"
          maxLength={8}
          value={getPath<string>(draft, ['identity', 'shortName']) ?? ''}
          onChange={(e) => set(['identity', 'shortName'], e.target.value || null)}
        />
      </SettingRow>
      <AccentColorField />
      <SettingRow label={C.language} hint={C.languageHint} tip={C.languageTip}>
        <Select
          value={localeChoice}
          onChange={(v) => set(['identity', 'locale'], v || null)}
          options={localeOptions}
          ariaLabel={C.pickLanguage}
        />
      </SettingRow>
      {/* ⚠️ The Personalstamm first, free text last (04.09., Rapport-Review). Typed by hand
          this became «Paul Hauptmann» on a Rapport whose Einsatzleiter read «Hauptmann Paul» —
          the same person in two orders, because every other name on that sheet comes from the
          roster and this one did not. Picking from the list makes the order unavailable and
          carries a Kommandantenwechsel along; typing still works, for the station that has no
          roster loaded yet and for a Kommandant who is not in this one's list. */}
      <SettingRow label={C.kommandant} tip={C.kommandantTip}>
        <NameCombo
          value={getPath<string>(draft, ['identity', 'kommandant']) ?? ''}
          onChange={(v) => set(['identity', 'kommandant'], v || null)}
          options={rosterNames}
          placeholder={C.kommandantPlaceholder}
          ariaLabel={C.kommandant}
        />
      </SettingRow>
      {/* The first paragraph of «Was kann KP Front?» — the one text every new AdF reads, and
          until now the only way to write it was a JSON file and a terminal. Free text: the API
          takes any string (schemas.py · IdentityConfig.helpIntro), so there is nothing to hold
          back and nothing that can 422 the rest of the document. The placeholder is the
          SHIPPED text, not an invented example, so «leer heisst das hier» is readable.
          `span`: four rows of prose need the Wert AND Standard columns, but they are still this
          setting's value and belong beside its label like every other one. */}
      <SettingRow label={C.helpIntro} tip={C.helpIntroTip} span>
        <textarea
          className="adm-input adm-textarea"
          rows={4}
          value={getPath<string>(draft, ['identity', 'helpIntro']) ?? ''}
          placeholder={appConfig.copy.help.introFallback}
          onChange={(e) => set(['identity', 'helpIntro'], e.target.value || null)}
        />
      </SettingRow>
      {/* ⚠️ `applyServerAssets`, NOT a full re-seed: the upload endpoint answers with the whole
          document, and adopting it threw away everything typed on this page but not yet saved
          (see ConfigContext · applyServerAssets). */}
      <SettingsNote>
        <BrandingFields
          assets={getPath<DeploymentConfig['identity']>(draft ?? {}, ['identity'])?.assets}
          onApplied={applyServerAssets}
        />
      </SettingsNote>
    </SettingsSheet>
    <MapSection />
    </>
  )
}

/** The two CRS the centre may be typed in. Only ONE of them is ever stored. */
type CenterCrs = 'wgs84' | 'lv95'

/** Is this pair a usable centre in that CRS?
 *
 *  The LV95 window is deliberately the Swiss one and not the EPSG:2056 domain: the mistake this
 *  catches is a station pasting LV03 (600 000 / 200 000), which is a perfectly well-formed number
 *  pair that would put the Lage in the Gulf of Guinea once converted. */
function centerUsable(crs: CenterCrs, a: number, b: number): boolean {
  return crs === 'lv95'
    ? a >= 2_400_000 && a <= 2_900_000 && b >= 1_000_000 && b <= 1_400_000
    : Math.abs(a) <= 180 && Math.abs(b) <= 90
}

/** Round to the precision that CRS is worth typing in: ~10 cm in metres, ~10 cm in degrees. */
const roundFor = (crs: CenterCrs, v: number) => Number(v.toFixed(crs === 'lv95' ? 1 : 6))

/**
 * Startansicht der Lagekarte.
 *
 * The centre is ONE value — a `[lng, lat]` pair (schemas.py · MapDefaultView) — even though it
 * is typed into two boxes. So it is validated BEFORE it enters the config document, exactly the
 * way FleetVehiclesEditor and ReportLinksEditor treat their half-typed rows.
 *
 * ⚠️ Half a pair must never reach the draft. Writing the two boxes as two separate paths meant
 * the document held a lone longitude for as long as it took to type the latitude — and because
 * Verwaltung PUTs the WHOLE document, that 422 refused every other section's edits with it: a
 * setup session lost «Name der Wehr», Markenfarbe and Kommandant to a coordinate still being
 * typed. An incomplete pair now stays on screen with a warning until it is worth saving.
 *
 * ⚠️ …and `center` / `centerLv95` are MUTUALLY EXCLUSIVE (schemas.py · MapDefaultView._one_crs):
 * a document carrying both is refused, and this page PUTs the whole document, so that would wedge
 * every other Station page too. Hence ONE control with a form switch rather than two fields that
 * can disagree — switching converts what is already typed and writes the other path back to null,
 * so the pair on screen is always the pair that is stored, in the form it is stored in. A Swiss
 * station's own coordinates are LV95; up to now the browser only offered WGS84.
 */
export function MapSection() {
  const { draft, set } = useConfig()
  const C = appConfig.copy.admin.map
  // Array.isArray, not `?? []`: the document can also be written straight into the DB by the
  // `admin_config` CLI, and a hand-edited `center: {}` must not white-screen the one page
  // somebody would come to in order to fix it.
  const rawWgs = getPath<unknown>(draft, ['map', 'defaultView', 'center'])
  const rawLv95 = getPath<unknown>(draft, ['map', 'defaultView', 'centerLv95'])
  const storedWgs = Array.isArray(rawWgs) ? (rawWgs as (number | null)[]) : []
  const storedLv95 = Array.isArray(rawLv95) ? (rawLv95 as (number | null)[]) : []
  // Which form the document is in decides which form the boxes show — until somebody switches.
  const storedCrs: CenterCrs = storedLv95.length > 0 ? 'lv95' : 'wgs84'
  const [crsChoice, setCrsChoice] = useState<CenterCrs | null>(null)
  const crs = crsChoice ?? storedCrs
  const storedPair = crs === 'lv95' ? storedLv95 : storedWgs
  // The pair as it is being TYPED. Null until the first edit, so a centre arriving from
  // elsewhere (CLI push, config import, history restore) still shows through.
  const [editing, setEditing] = useState<{ a: string; b: string } | null>(null)
  const pair = editing ?? { a: numStr(storedPair[0]), b: numStr(storedPair[1]) }

  const a = numOrNull(pair.a)
  const b = numOrNull(pair.b)
  const cleared = pair.a.trim() === '' && pair.b.trim() === ''
  const complete = a != null && b != null
  const usable = complete && centerUsable(crs, a, b)
  /** Why the centre on screen is not in the document, or null when it is. */
  const problem = cleared || usable
    ? null
    : !complete ? C.centerIncomplete
      : crs === 'lv95' ? C.centerLv95OutOfRange : C.centerOutOfRange
  /** The stored centre as WGS84, whichever form it is stored in — for the bbox helper below. */
  const centreWgs84: [number, number] | null =
    storedWgs.length === 2 && storedWgs[0] != null && storedWgs[1] != null
      ? [storedWgs[0], storedWgs[1]]
      : storedLv95.length === 2 && storedLv95[0] != null && storedLv95[1] != null
        ? lv95ToWgs84(storedLv95[0], storedLv95[1])
        : null

  /** Write the pair in `useCrs`, and NULL the other form in the same edit — two `set` calls,
   *  both functional updates on the same draft, so they cannot land as two documents. */
  const write = (next: { a: string; b: string }, useCrs: CenterCrs = crs) => {
    setEditing(next)
    const x = numOrNull(next.a)
    const y = numOrNull(next.b)
    if (next.a.trim() === '' && next.b.trim() === '') {
      set(['map', 'defaultView', 'center'], null)
      set(['map', 'defaultView', 'centerLv95'], null)
      return
    }
    // ⚠️ The whole pair, in one write — never index 0 and index 1 as two paths.
    if (x != null && y != null && centerUsable(useCrs, x, y)) {
      set(['map', 'defaultView', 'center'], useCrs === 'wgs84' ? [x, y] : null)
      set(['map', 'defaultView', 'centerLv95'], useCrs === 'lv95' ? [x, y] : null)
    }
    // else: the stored centre stays as it is, and `problem` says why
  }

  /** Switch the form the centre is typed in — converting what is on screen, so nobody has to
   *  look a coordinate up twice. An unusable pair is not converted (there is nothing to
   *  convert); it stays on screen with its warning. */
  const switchCrs = (next: CenterCrs) => {
    if (next === crs) return
    setCrsChoice(next)
    if (!complete || !usable) { setEditing(pair); return }
    const [x, y] = crs === 'wgs84' ? wgs84ToLV95(a, b) : lv95ToWgs84(a, b)
    write({ a: String(roundFor(next, x)), b: String(roundFor(next, y)) }, next)
  }

  return (
    <>
    <SettingsSheet title={appConfig.copy.admin.nav.karte.title}>
      <SettingRow label={C.crs} tip={C.crsTip}>
        <Select
          value={crs}
          onChange={(v) => switchCrs(v as CenterCrs)}
          options={[{ value: 'wgs84', label: C.crsWgs84 }, { value: 'lv95', label: C.crsLv95 }]}
          ariaLabel={C.pickCrs}
        />
      </SettingRow>
      {/* ⚠️ Two rows, ONE value — see the doc comment above. Neither box has a «Standard»: a
          station's own map centre is not a value anything ships. */}
      <SettingRow
        label={crs === 'lv95' ? C.centerE : C.centerLon}
        tip={crs === 'lv95' ? C.centerETip : C.centerLonTip}
      >
        <input
          className="adm-input adm-input-mono"
          type="number"
          step="any"
          value={pair.a}
          onChange={(e) => write({ ...pair, a: e.target.value })}
        />
      </SettingRow>
      <SettingRow
        label={crs === 'lv95' ? C.centerN : C.centerLat}
        tip={crs === 'lv95' ? C.centerNTip : C.centerLatTip}
      >
        <input
          className="adm-input adm-input-mono"
          type="number"
          step="any"
          value={pair.b}
          onChange={(e) => write({ ...pair, b: e.target.value })}
        />
      </SettingRow>
      {problem && <SettingsNote tone="warn">{problem}</SettingsNote>}
      <SettingRow label={C.zoom} tip={C.zoomTip}>
        <input
          className="adm-input adm-input-mono"
          type="number"
          step="any"
          value={numStr(getPath<number>(draft, ['map', 'defaultView', 'zoom']))}
          onChange={(e) => set(['map', 'defaultView', 'zoom'], numOrNull(e.target.value))}
        />
      </SettingRow>
    </SettingsSheet>
    <GeocoderCard centre={centreWgs84} />
    <ExternalLinksCard centre={centreWgs84} />
    <ObjectCategoriesCard />
    </>
  )
}

/** A plausible Swiss point, so the external-link preview reads as a real URL on a station that
 *  has not set a centre yet. North-west Switzerland, the same reference the geo tests use. */
const SAMPLE_CENTRE: [number, number] = [7.5547, 47.5072]

/** Half-width of the bbox the «aus dem Kartenzentrum» button derives, in metres. Five kilometres
 *  is the Einzugsgebiet of a village Wehr plus its Nachbarhilfe — wide enough that the next
 *  village still ranks, narrow enough to beat the same street name three cantons away. */
const BBOX_HALF_M = 5_000

/** Four LV95 numbers, «minE,minN,maxE,maxN», or null when the text is not that. */
function parseBboxLv95(raw: string): [number, number, number, number] | null {
  const parts = raw.split(',').map((p) => Number(p.trim()))
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null
  const [minE, minN, maxE, maxN] = parts as [number, number, number, number]
  if (minE >= maxE || minN >= maxN) return null
  if (!centerUsable('lv95', minE, minN) || !centerUsable('lv95', maxE, maxN)) return null
  return [minE, minN, maxE, maxN]
}

/**
 * Adresssuche — the two fields that decide whether «Hauptstrasse 3» finds the station's own
 * Hauptstrasse or one of the two hundred others in the country.
 *
 * Both are read server-side (backend/app/geocode.py · _resolve_bias) and both were CLI-only.
 * The locality is free text (nothing to validate); the bbox is four LV95 numbers passed
 * STRAIGHT to swisstopo as a query parameter, so a malformed one silently un-biases every
 * search rather than failing loudly — which is exactly the class of value that has to be
 * checked here rather than discovered during an Einsatz. The API accepts any string
 * (schemas.py · MapGeocoder), so the check is ours alone to make.
 */
function GeocoderCard({ centre }: { centre: [number, number] | null }) {
  const { draft, set } = useConfig()
  const C = appConfig.copy.admin.map
  const stored = getPath<string>(draft, ['map', 'geocoder', 'bboxLv95']) ?? ''
  const [editing, setEditing] = useState<string | null>(null)
  // «Nicht jetzt» for this visit only. Deliberately NOT persisted: there is nothing to remember
  // — the offer disappears for good the moment a bbox exists, and an operator who declined it
  // once and came back to set it anyway should find it waiting, not have to hunt the button.
  const [dismissed, setDismissed] = useState(false)
  const text = editing ?? stored
  const problem = text.trim() === '' || parseBboxLv95(text) ? null : C.bboxInvalid

  const writeBbox = (next: string) => {
    setEditing(next)
    if (next.trim() === '') set(['map', 'geocoder', 'bboxLv95'], null)
    else if (parseBboxLv95(next)) set(['map', 'geocoder', 'bboxLv95'], next.trim())
    // else: the stored bbox stays as it is, and `problem` says why
  }

  /** …because nobody knows their own bounding box by heart, and everybody knows where their
   *  Magazin is. Derived from the centre that is already configured, ±5 km. ONE derivation,
   *  shared by the button below and the offer above it — two would drift. */
  const derived = centre
    ? (() => {
        const [e, n] = wgs84ToLV95(centre[0], centre[1])
        return [e - BBOX_HALF_M, n - BBOX_HALF_M, e + BBOX_HALF_M, n + BBOX_HALF_M]
          .map((v) => Math.round(v)).join(',')
      })()
    : null
  const fromCentre = () => { if (derived) writeBbox(derived) }

  // The one moment everything needed is known: a centre is stored, the search area is not.
  // Offering it here beats a button nobody scrolls to — and the value that would be written
  // is on screen before it is.
  const offer = derived && text.trim() === '' && !dismissed

  return (
    <SettingsSheet title={C.groupGeocoder} tip={C.geocoderTip}>
      {offer && (
        <SettingsNote>
        <Offer
          tone="blue" icon="locate"
          title={C.bboxOfferTitle} body={C.bboxOfferBody} preview={derived}
        >
          <button type="button" className="btn adm-save-btn" onClick={fromCentre}>
            {C.bboxOfferApply}
          </button>
          <button type="button" className="btn adm-int-btn" onClick={() => setDismissed(true)}>
            {C.bboxOfferDismiss}
          </button>
        </Offer>
        </SettingsNote>
      )}
      <SettingRow label={C.locality} tip={C.localityTip}>
        <input
          className="adm-input"
          type="text"
          value={getPath<string>(draft, ['map', 'geocoder', 'defaultLocality']) ?? ''}
          placeholder={C.localityPlaceholder}
          onChange={(e) => set(['map', 'geocoder', 'defaultLocality'], e.target.value || null)}
        />
      </SettingRow>
      <SettingRow label={C.bbox} tip={C.bboxTip}>
        <input
          className="adm-input adm-input-mono"
          type="text"
          value={text}
          placeholder={C.bboxPlaceholder}
          aria-invalid={problem ? true : undefined}
          onChange={(e) => writeBbox(e.target.value)}
        />
      </SettingRow>
      {problem && <SettingsNote tone="warn">{problem}</SettingsNote>}
      <SettingsNote>
        <button
          type="button" className="adm-formlink-add" disabled={!centre}
          title={centre ? undefined : C.bboxFromCenterHint}
          onClick={fromCentre}
        >
          <Icon id="locate" />{C.bboxFromCenter}
        </button>
      </SettingsNote>
    </SettingsSheet>
  )
}

/**
 * Externe Kartenportale — the cantonal GIS deep links that appear as buttons in the Datenquellen
 * panel of a running Einsatz (`deploymentConfig · externalMapLinks`).
 *
 * Shaped exactly like ReportLinksEditor, including the placeholder chips and the live preview,
 * because it is the same job: a URL somebody pastes out of a portal's address bar, with the
 * coordinates in it swapped for placeholders. The preview resolves against the station's own
 * centre where there is one, so «did I get the right parameter names» is answerable before an
 * Einsatz asks.
 *
 * ⚠️ Only COMPLETE rows enter the draft — same rule as every other list editor on these pages.
 * Both fields are optional in the schema (`schemas.py · MapExternalLink`), so a blank row does
 * NOT 422; it would simply be a dead button in the panel, which `externalMapLinks` then filters
 * out at render time. Holding it back here keeps what the preview promises and what the panel
 * shows in step.
 */
function ExternalLinksCard({ centre }: { centre: [number, number] | null }) {
  const { draft, set } = useConfig()
  const C = appConfig.copy.admin.map
  const raw = getPath<DeploymentExternalLink[]>(draft, ['map', 'externalLinks'])
  const stored = Array.isArray(raw) ? raw : []
  const [editing, setEditing] = useState<DeploymentExternalLink[] | null>(null)
  const rows = editing ?? stored
  const urlRef = useRef<HTMLTextAreaElement | null>(null)
  const [lng, lat] = centre ?? SAMPLE_CENTRE
  const [sampleE, sampleN] = wgs84ToLV95(lng, lat)
  /** The same substitution `externalMapLinks` performs, so the preview cannot drift from it. */
  const resolve = (t: string) => t
    .replaceAll('{E}', sampleE.toFixed(2)).replaceAll('{N}', sampleN.toFixed(2))
    .replaceAll('{lng}', String(lng)).replaceAll('{lat}', String(lat))

  const write = (next: DeploymentExternalLink[]) => {
    setEditing(next)
    set(['map', 'externalLinks'], next.filter(
      (l) => !!l.label?.trim() && isOpenableUrl(resolve(l.urlTemplate ?? '')),
    ))
  }
  const patch = (i: number, over: Partial<DeploymentExternalLink>) =>
    write(rows.map((r, j) => (j === i ? { ...r, ...over } : r)))

  const insertToken = (i: number, token: string) => {
    const el = urlRef.current
    const url = rows[i]?.urlTemplate ?? ''
    // matched by the field's own row index AND liveness — see ReportLinksEditor for why a
    // detached textarea must never answer for the row that moved up into its place
    const live = el && el.dataset.row === String(i) && el.isConnected ? el : null
    const at = live ? (live.selectionStart ?? url.length) : url.length
    patch(i, { urlTemplate: `${url.slice(0, at)}{${token}}${url.slice(at)}` })
    if (live) {
      const caret = at + token.length + 2
      requestAnimationFrame(() => { live.focus(); live.setSelectionRange(caret, caret) })
    }
  }

  return (
    /* A list editor, not a list of settings: every row is a whole RECORD with its own token
       chips and preview, so it is a RecordTable (ui · RecordTable) rather than a sheet with a
       divider per portal. It was already a card of its own on this page, so lifting it took
       nothing with it. The card's explanation stays in the head's ⓘ like everywhere else. */
    <RecordTable title={C.groupExternal} tip={C.externalTip} recordLabel={C.colExternal} fieldLabel={C.extLabel}>
      {rows.map((row, i) => {
        const preview = resolve(row.urlTemplate ?? '')
        return (
          // index key: an external link has no id of its own, and every value in the row is
          // controlled from `rows` anyway. No meta: a portal has no fact about itself beyond
          // the two fields under it, and the preview row is already the second of them.
          <RecordRows
            key={i}
            name={row.label?.trim() || appConfig.copy.admin.common.newEntry}
            action={(
              <ConfirmButton
                className="adm-formlink-x" ariaLabel={C.extRemove} label={<Icon id="trash" />}
                question={C.extRemoveConfirm} danger
                onConfirm={() => write(rows.filter((_, j) => j !== i))}
              />
            )}
          >
            <SettingRow label={C.extLabel}>
              <input
                className="adm-input" type="text" value={row.label ?? ''}
                placeholder={C.extLabelPlaceholder}
                onChange={(e) => patch(i, { label: e.target.value })}
              />
            </SettingRow>
            <SettingRow label={C.extUrl} tip={C.extUrlTip} span>
              {/* two boxes, one value: the template and the chips that write into it. They stack
                  INSIDE the cell (`.adm-set-col`) rather than leaving the columns. */}
              <div className="adm-set-col">
                <textarea
                  className="adm-input adm-input-mono adm-formlink-url" rows={3}
                  value={row.urlTemplate ?? ''} placeholder={C.extUrlPlaceholder} data-row={i}
                  onFocus={(e) => { urlRef.current = e.currentTarget }}
                  onChange={(e) => patch(i, { urlTemplate: e.target.value })}
                />
                <span className="adm-formlink-tokens" role="group" aria-label={C.extTokens}>
                  {['E', 'N', 'lng', 'lat'].map((t) => (
                    <button type="button" key={t} className="adm-token" onClick={() => insertToken(i, t)}>
                      {`{${t}}`}
                    </button>
                  ))}
                </span>
              </div>
            </SettingRow>
            <SettingRow label={C.extPreview} span>
              {isOpenableUrl(preview) && !!row.label?.trim()
                ? <p className="adm-formlink-preview">{preview}</p>
                : (
                  <p className="adm-hint adm-formlink-warn">
                    {row.label?.trim() ? C.extNoUrl : C.extNoTitle}
                  </p>
                )}
            </SettingRow>
          </RecordRows>
        )
      })}
      <SettingsNote>
        <button
          type="button" className="adm-formlink-add"
          onClick={() => write([...rows, { label: '', urlTemplate: '' }])}
        >
          <Icon id="plus" />{C.extAdd}
        </button>
      </SettingsNote>
    </RecordTable>
  )
}

/**
 * Textbausteine für den Verlauf — a GROUP on the Rapport page, not a page of its own.
 *
 * It was one setting behind its own nav entry, its own sheet head and its own column header,
 * with the sheet title and the row label both reading «Textbausteine»: three headings and a
 * navigation stop for a single textarea. It sits under Rapport because that is where the same
 * question already lives — what this Wehr's own wording does to the record it leaves behind:
 * the Verlauf these phrases write IS what the Rapport prints.
 *
 * ⚠️ The nav entry went with it (AdminShell · NAV), and a device that still remembers
 * `adminSection: 'journal'` is redirected to Rapport rather than dumped on the default page.
 */
function JournalGroup() {
  const { draft, set } = useConfig()
  const C = appConfig.copy.admin.journal
  // Empty deployment config means the national defaults are effective. Seed the textarea
  // with those actual values (not placeholder text), so editing one line preserves the rest.
  const [raw, setRaw] = useState<string>(
    () => {
      const configured = getPath<string[]>(draft, ['journal', 'quickPhrases']) ?? []
      return (configured.length > 0 ? configured : appConfig.journal.quickPhrases).join('\n')
    },
  )
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.72))}px`
  }, [raw])
  return (
    <>
      {/* The group carries the explanation; the row below it is a page of text, so its control
          spans Wert AND Standard — sixty Textbausteine are short lines, and what they needed was
          height, which `span` gives them without taking the setting out of its own row. */}
      <SettingsGroup title={C.quickPhrases} tip={C.quickPhrasesTip} />
      <SettingRow label={C.quickPhrases} span>
        <textarea
          ref={textareaRef}
          className="adm-input adm-textarea adm-textarea-tall"
          rows={16}
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value)
            const lines = e.target.value.split('\n').map((l) => l.trim()).filter(Boolean)
            set(['journal', 'quickPhrases'], lines)
          }}
        />
      </SettingRow>
    </>
  )
}

export function DoctrineSection() {
  const { draft, set } = useConfig()
  const numberField = useNumberField()
  const C = appConfig.copy.admin.doctrine
  const isDemo = getPath<boolean>(draft, ['identity', 'demoMode']) === true
  // ⚠️ `NonNullable`: `doctrine` is optional on the document, and `keyof (T | undefined)` is
  // `never` — which silently made every key below assignable and the type check decorative.
  // …and NUMBERS only: `doctrine.equipment` is a list both sides carry (14.09.), and a number
  // field must not be offerable for it.
  type NumericAtemschutzKey = { [K in keyof typeof appConfig.atemschutz]: typeof appConfig.atemschutz[K] extends number ? K : never }[keyof typeof appConfig.atemschutz]
  type DoctrineKey = keyof NonNullable<DeploymentConfig['doctrine']> & NumericAtemschutzKey
  // A doctrine number field, wired to its config path. Grouped by type below so related knobs
  // (Funk / Druck / Kontakt) sit together.
  //
  // ⚠️ Every one of these is `int | None` on the backend (schemas.py · DoctrineConfig), so an
  // EMPTY box is a value — it goes back to the shipped doctrine — but «8.5» is not: pydantic
  // refuses a fractional int (`int_from_float`) and that 422 takes the whole document with it.
  // The box therefore steps by 1 and the value is checked before it enters the draft.
  const numField = (label: string, tip: string, key: DoctrineKey, guard: NumberGuard = { kind: 'int', nullable: true }, message?: string) =>
    numberField({ path: ['doctrine', key], label, tip, guard, message, fallback: appConfig.atemschutz[key] })

  // The two default channels stay inside the station's own Funkkanal min/max – the range the
  // Trupp stepper offers. A 999 above a max of 99 was autosaved to every device (sweep F.4,
  // 23.10.2026); out of range it now stays in the box with the field error, like the Rückzug line.
  const funkkanalRange = {
    min: getPath<number>(draft, ['doctrine', 'funkkanalMin']) ?? appConfig.atemschutz.funkkanalMin,
    max: getPath<number>(draft, ['doctrine', 'funkkanalMax']) ?? appConfig.atemschutz.funkkanalMax,
  }
  const funkkanalGuard: NumberGuard = { kind: 'int', ...funkkanalRange, nullable: true }

  // ⚠️ A colour is stored as a KEY of `doctrine.auftragColors` (`dict[str, str] | None`), so
  // «Automatisch» has to REMOVE the key — writing `null` under it is a `string_type` 422, and it
  // was the already-active button on every row: one tap on the control that reads as «leave this
  // alone» wedged the autosave for all five Station pages, with no way back that the button
  // itself suggested. The last colour removed leaves `null`, which is how «none» is said here.
  // The Alarmdruck this station runs on right now — the stored value, or the shipped one while
  // the box is empty. It is the ceiling of the Rückzug line below it (see there).
  const effectiveAlarmBar = getPath<number>(draft, ['doctrine', 'alarmBar']) ?? appConfig.atemschutz.alarmBar
  const rueckzugMax = Math.min(300, effectiveAlarmBar)

  // The Rückzug line the operator actually CHOSE, as opposed to the one currently clamped into
  // the draft.
  //
  // ⚠️ Without it, raising the Alarmdruck destroyed that choice. `onAccepted` fires per
  // KEYSTROKE, and every prefix of a number is itself a valid number: typing 150 over 100 goes
  // through `alarmBar = 1`, where a plain «clamp down» rewrites the Rückzug line to 1 — and the
  // clamp only ever lowers, so 15 and 150 never bring it back. The autosave then persisted
  // «Alarmdruck 150, Rückzug 1», which the API accepts (1 ≤ 150) and which alarms a retreating
  // Trupp at a pressure no cylinder reaches. Clamping the REMEMBERED value each time instead is
  // idempotent across the intermediate states: min(50, 1) → min(50, 15) → min(50, 150) = 50.
  const rueckzugIntentRef = useRef<number | null>(null)
  const storedRueckzug = getPath<number>(draft, ['doctrine', 'alarmBarRueckzug'])
  if (rueckzugIntentRef.current === null && storedRueckzug != null) rueckzugIntentRef.current = storedRueckzug

  const auftragColors = getPath<Record<string, string>>(draft, ['doctrine', 'auftragColors'])
  const setAuftragColor = (id: string, color: string | null) => {
    if ((auftragColors?.[id] ?? null) === color) return // «Automatisch» on an automatic row writes nothing
    const next = { ...(auftragColors ?? {}) }
    if (color) next[id] = color
    else delete next[id]
    set(['doctrine', 'auftragColors'], Object.keys(next).length ? next : null)
  }
  return (
    <SettingsSheet>
      <SettingsGroup title={C.groupFunk} />
      {numField(C.defaultFunkkanal, C.defaultFunkkanalTip, 'defaultFunkkanal', funkkanalGuard,
        fillTemplate(C.funkkanalOutOfRange, funkkanalRange))}
      {/* not in appConfig.atemschutz (its shipped fallback is «same as defaultFunkkanal»),
          so it bypasses the numField helper: the placeholder shows the channel an empty box
          actually yields — the station's AS default, else the shipped one. */}
      {numberField({
        path: ['doctrine', 'defaultFunkkanalEinfach'], label: C.defaultFunkkanalEinfach,
        tip: C.defaultFunkkanalEinfachTip, guard: funkkanalGuard,
        message: fillTemplate(C.funkkanalOutOfRange, funkkanalRange),
        fallback: getPath<number>(draft, ['doctrine', 'defaultFunkkanal']) ?? appConfig.atemschutz.defaultFunkkanal,
      })}
      {numField(C.funkkanalMin, C.funkkanalMinTip, 'funkkanalMin')}
      {numField(C.funkkanalMax, C.funkkanalMaxTip, 'funkkanalMax')}

      <SettingsGroup title={C.groupPressure} />
      {/* The Rückzug line sits BESIDE the Alarmdruck it is bounded by — it was file-only until
          now (schemas.py · DoctrineConfig), so a browser-configured station never got it and a
          CLI-template one silently ran on an invisible 50 bar.
          ⚠️ The only doctrine number with a CROSS-FIELD rule (schemas.py ·
          _rueckzug_line_stays_below_the_bare_alarm): above `alarmBar` the API refuses the whole
          document, which stops the autosave on all five Station pages. So the ceiling is the
          Alarmdruck this station actually runs on — the stored one, or the shipped default while
          that box is empty — and never above the schema's own 300.
          A zero Alarmdruck exists only in the public demo: it disables both pressure alarms, so
          the Rückzug line becomes a read-only 0 there. Station deployments require at least 1. */}
      {numField(C.defaultPressure, C.defaultPressureTip, 'defaultPressureBar')}
      {/* The Eingangsdruck below which the Trupp form asks once (24.09.2026, Übung 23.09.: 60 and
          180 bar went through as entries). It sits under the fill pressure it is read against.
          0 is a real choice here — «never ask» — so the box takes it, unlike the alarm lines. */}
      {numField(C.entryPressureMin, fillTemplate(C.entryPressureMinTip, { n: appConfig.atemschutz.entryPressureMin }),
        'entryPressureMin', { kind: 'int', min: 0, max: 300, nullable: true })}
      {numberField({
          path: ['doctrine', 'alarmBar'],
          label: C.alarmBar,
          tip: isDemo ? C.alarmBarDemoTip : C.alarmBarTip,
          guard: { kind: 'int', min: isDemo ? 0 : 1, max: 300, nullable: true },
          fallback: appConfig.atemschutz.alarmBar,
          onAccepted: (value) => {
            // A zero Alarmdruck (demo only) switches both lines off; the intent is remembered,
            // so raising the Alarmdruck again brings the chosen Rückzug line back.
            if (value === 0) { set(['doctrine', 'alarmBarRueckzug'], null); return }
            // An UNSET Rückzug line needs no clamping and must not be written into the
            // document: the shipped 50 is already read as min(50, alarmBar) on both sides
            // (docs/CONFIGURATION.md · doctrine.alarmBarRueckzug).
            const intent = rueckzugIntentRef.current
            if (intent == null) return
            const clamped = Math.min(intent, value ?? appConfig.atemschutz.alarmBar)
            if (getPath<number>(draft, ['doctrine', 'alarmBarRueckzug']) !== clamped) {
              set(['doctrine', 'alarmBarRueckzug'], clamped)
            }
          },
        })}
      {effectiveAlarmBar === 0 ? (
        <SettingRow label={C.alarmBarRueckzug} tip={C.alarmBarRueckzugDisabledTip}>
          <input className="adm-input adm-input-mono adm-input-num" type="number" value="0" disabled />
        </SettingRow>
      ) : numberField({
          path: ['doctrine', 'alarmBarRueckzug'],
          label: C.alarmBarRueckzug,
          tip: fillTemplate(C.alarmBarRueckzugTip, {
            n: Math.min(appConfig.atemschutz.alarmBarRueckzug, effectiveAlarmBar),
          }),
          guard: { kind: 'int', min: 0, exclusiveMin: true, max: rueckzugMax, nullable: true },
          fallback: Math.min(appConfig.atemschutz.alarmBarRueckzug, effectiveAlarmBar),
          message: fillTemplate(C.alarmBarRueckzugInvalid, { max: rueckzugMax }),
          // Typing here IS the choice — it becomes the value a later Alarmdruck edit restores to.
          onAccepted: (value) => { rueckzugIntentRef.current = value },
      })}
      {numField(C.pressureStep, C.pressureStepTip, 'pressureStep')}
      {numField(C.pressureMax, C.pressureMaxTip, 'pressureMax')}

      <SettingsGroup title={C.groupContact} />
      {/* the station range of the contact clock (lib/workspace · CONTACT_BOUNDS, audit F02) */}
      {numField(C.contactInterval, C.contactIntervalTip, 'contactIntervalMin', { kind: 'int', ...CONTACT_BOUNDS.contactIntervalMin, nullable: true })}
      {numField(C.contactGrace, C.contactGraceTip, 'contactGraceSec', { kind: 'int', ...CONTACT_BOUNDS.contactGraceSec, nullable: true })}

      {/* The air estimate's two inputs. The app has read them from the config all along and the
          card says «geschätzt mit 7 L Flasche und 50 L/min», which reads like a station setting —
          it wasn't one, because the backend dropped both fields on save and there was nowhere to
          type them. A 9-litre cylinder is an ordinary thing for a Wehr to own. */}
      {/* ⚠️ The group's own explanation is the group's ⓘ — it explained the GROUP, never one of
          the two boxes, which is exactly the prose this table was built to get off the page. */}
      <SettingsGroup title={C.groupAir} tip={C.airTip} />
      {/* ⚠️ The two decimals on this page, and the only bounded ones: `gt=0, le=30` / `gt=0,
          le=200` (schemas.py · DoctrineConfig). A 0-litre cylinder is not a smaller cylinder,
          it is a division by zero in the estimate — which is why the API refuses it and why
          this box has to refuse it here, where the operator can still see what happened. */}
      {numField(C.cylinderLiters, C.cylinderLitersTip, 'cylinderLiters',
        { kind: 'decimal', min: 0, exclusiveMin: true, max: 30, nullable: true })}
      {numField(C.estConsumption, C.estConsumptionTip, 'estConsumptionLPerMin',
        { kind: 'decimal', min: 0, exclusiveMin: true, max: 200, nullable: true })}

      {/* How far the auto-surfaced object may lie from the Einsatzadresse before the Plan warns
          «nicht die Einsatzadresse» (useObjectPlans · objectNearbyOnly). Not an Atemschutz
          number, so it bypasses numField. ⚠️ `int = 25` on the backend – no null, so an emptied
          box is held back like Rapport › Rundung instead of being sent. */}
      <SettingsGroup title={C.groupObject} />
      {numberField({
        path: ['doctrine', 'nearbyObjectWarnM'], label: C.nearbyObjectWarnM, tip: C.nearbyObjectWarnMTip,
        guard: { kind: 'int', min: 0, max: 500 }, fallback: appConfig.defaults.nearbyObjectWarnM,
      })}

      {/* The hose Ø a Linie without one reads as, and the one a Messen Wassertransport starts on
          (lib/hydraulics · hoseDefaults, owner 05.11.2026). Unset shows the shipped Ø as chosen,
          like the name order, and writes nothing until a pick. The relay list has no 40 mm. */}
      <SettingsGroup title={C.groupHose} />
      {([
        ['defaultLineHose', HOSE_SIZES, SHIPPED_HOSE.line, C.defaultLineHose, C.defaultLineHoseTip],
        ['defaultRelayHose', RELAY_HOSE_SIZES, SHIPPED_HOSE.relay, C.defaultRelayHose, C.defaultRelayHoseTip],
      ] as const).map(([key, sizes, shipped, label, tip]) => {
        const labels = appConfig.copy.relay.hoseLabels
        const stored = getPath<string>(draft, ['doctrine', key])
        const value = sizes.find((h) => h === stored) ?? shipped
        return (
          <SettingRow key={key} label={label} tip={fillTemplate(tip, { n: labels[shipped] })}
            standard={standardNote(stored == null ? null : labels[value], labels[shipped])}>
            <Select value={value} ariaLabel={label} onChange={(v) => set(['doctrine', key], v)}
              options={sizes.map((h) => ({ value: h, label: labels[h] }))} />
          </SettingRow>
        )
      })}

      {/* Optional station colour per Auftrag. Empty = the default behaviour, where a Trupp's
          colour means IDENTITY (every Trupp a different one from the palette). Filling a row in
          says «read this Lage by role» — every Löschtrupp red — and the EL can still override any
          single Trupp. Left as swatches, not a free colour input: these have to be the SAME ten
          colours the Trupp form and the plan chip offer, or the picture stops agreeing with
          itself.
          ⚠️ BOTH Auftrag lists (config · allAuftragTypes), PA first, each id once: the colour is
          keyed by the stored id and a Trupp ohne Atemschutz wears it exactly like one under PA,
          so offering only the PA words would leave «Verkehr» with no way to be coloured. */}
      <SettingsGroup title={C.groupAuftragColors} tip={C.auftragColorsTip} />
      {allAuftragTypes.map((a) => {
        const value = auftragColors?.[a.id]
        return (
          // `span`: eleven swatches never fitted the Wert column and scrolled sideways instead,
          // which hid the second half of the palette behind a scrollbar nobody looks for.
          <SettingRow key={a.id} label={appConfig.copy.atemschutz.auftragLabels[a.id] ?? a.label} span>
            <div className="adm-colorrow">
              <button
                type="button" className={`adm-swatch-auto${value ? '' : ' on'}`} aria-pressed={!value}
                onClick={() => setAuftragColor(a.id, null)}
              >{appConfig.copy.atemschutz.colorAuto}</button>
              {appConfig.drawing.teamColors.map((c) => (
                <button
                  key={c} type="button" className={`dh-color${value === c ? ' on' : ''}`} style={{ background: c }}
                  aria-pressed={value === c} aria-label={c}
                  onClick={() => setAuftragColor(a.id, value === c ? null : c)}
                />
              ))}
            </div>
          </SettingRow>
        )
      })}
    </SettingsSheet>
  )
}

export function FleetSection() {
  const { draft } = useConfig()
  const C = appConfig.copy.admin.fleet
  const fleet = getPath<DeploymentFleet>(draft, ['fleet'])
  // Two halves, and they are NOT the same kind of surface:
  //  · the vehicle list is edited here. «Einrichtung» sends a fresh station to this page for
  //    «Fahrzeuge hinterlegen», and until now it arrived at a viewer with no inputs — the
  //    checklist's own chevron promised a screen that could not do the thing it asked for.
  //  · the symbol attribute lists stay a read-only viewer (the effective lists are the
  //    configured `attributeLists`, with a pre-migration config shown as its migrated
  //    equivalent) — but the card now says which command edits them, so a reader who arrives
  //    from «Einrichtung» leaves with a next step rather than a shrug.
  const lists = fleet?.attributeLists ?? legacyFleetToAttributeLists(fleet)
  return (
    <>
      {/* ⚠️ A RecordTable, not a SettingsSheet: a vehicle is a RECORD and its fields belong to it
          (ui · RecordTable). The record column carries this surface's own word for what a record
          is — «Fahrzeug» — and the attribute column the «Bezeichnung» its first row already has. */}
      <RecordTable title={C.groupVehicles} tip={C.vehiclesTip} recordLabel={C.colVehicle} fieldLabel={C.vehicleLabel}>
        {/* once per table, not per row: the page autosaves 700 ms after a deleted row and
            nothing else on it says where the previous state went. */}
        <SettingsNote>{appConfig.copy.admin.common.deleteRecovery}</SettingsNote>
        <FleetVehiclesEditor />
      </RecordTable>
      {/* The heading is the CARD's, not an h3 standing over it: this page shows two surfaces, and
          a page with more than one card titles every card (ui · Card). The ⓘ that explained the
          lists rides on that title now, where every other card's does. */}
      <Card title={C.attributesTitle} tip={C.cliTip}>
        <p className="adm-hint">{C.cliHint}</p>
        <FleetAttributesViewer lists={lists} />
      </Card>
    </>
  )
}

/**
 * The station's vehicles — the rows of the «Alarmierungs-/Ausrückzeiten» grid on the Rapport and
 * on the paper Erfassungsblatt (lib/alarmzeiten · fahrzeugRows), and what a milestone webhook
 * matches an incoming vehicle time against. Empty = every vehicle-times surface is hidden, which
 * is a legitimate state, not a broken one.
 *
 * A RecordTable of one record per vehicle (ui · RecordRows), like the Kartenebenen editors. The
 * rule it shares with every other list editor here: a half-typed row must NOT reach the config
 * document. `id`/`label` are `min_length=1` on the backend (schemas.py · FleetVehicle)
 * and Verwaltung PUTs the WHOLE document, so one blank row would 422 every other Station page
 * too, in a 700 ms autosave retry loop. Incomplete rows stay on screen with a warning until they
 * are worth saving.
 */
function FleetVehiclesEditor() {
  const { draft, set } = useConfig()
  const C = appConfig.copy.admin.fleet
  // Array.isArray, not `?? []`: the document can also be written straight into the DB by the
  // `admin_config` CLI, and a hand-edited `vehicles: {}` would otherwise white-screen the one
  // page somebody would come to in order to fix it.
  const raw = getPath<FleetVehicle[]>(draft, ['fleet', 'vehicles'])
  const stored = Array.isArray(raw) ? raw : []
  // The rows as they are being EDITED — the stored ones plus any not finished yet. Null until
  // the first edit, so a config arriving from elsewhere still shows through.
  const [editing, setEditing] = useState<FleetVehicle[] | null>(null)
  const rows = editing ?? stored

  /** Why a row is not stored, or null when it is. ⚠️ Duplicate ids are refused rather than
   *  silently merged: the id is the key recorded Ausrückzeiten and the GPS device name join
   *  on, so two rows sharing one would quietly become one vehicle on the Rapport. */
  const problem = (v: FleetVehicle, i: number, all: FleetVehicle[]): string | null => {
    const id = v.id?.trim()
    if (!id || !v.label?.trim()) return C.vehicleIncomplete
    return all.findIndex((o) => o.id?.trim().toLowerCase() === id.toLowerCase()) === i
      ? null
      : C.vehicleDuplicate
  }

  const write = (next: FleetVehicle[]) => {
    setEditing(next)
    set(['fleet', 'vehicles'], next.filter((v, i) => problem(v, i, next) === null))
  }
  // ⚠️ Merged over the previous row, never replaced: `winfapAlias` — and anything else the CLI
  // wrote that this form does not show — has to survive an edit made here.
  const patch = (i: number, over: Partial<FleetVehicle>) =>
    write(rows.map((r, j) => (j === i ? { ...r, ...over } : r)))

  // A device name is lowercase and dashed ('tlf-1'), which is not what somebody types into
  // «Bezeichnung» — so the Kennung follows the Bezeichnung until it is edited by hand. «It no
  // longer equals the slug of the label» IS that condition, so nothing has to remember it.
  const setLabel = (i: number, label: string) => {
    const row = rows[i]
    const follows = !row.id?.trim() || row.id === slugId(row.label ?? '')
    patch(i, follows ? { label, id: slugId(label) } : { label })
  }

  return (
    <>
      {rows.length === 0 && <SettingsNote>{C.vehiclesEmpty}</SettingsNote>}
      {/* ONE row per vehicle (ui · InlineRecords, UI sweep 07.10.2026): a head card plus a row
          per field repeated «Bezeichnung / Kennung» for every vehicle, and the name twice. */}
      {rows.length > 0 && (
        <InlineRecords
          recordLabel={C.colVehicle}
          columns={[{ label: C.vehicleLabel, tip: C.vehicleLabelTip }, { label: C.vehicleId, tip: C.vehicleIdTip }]}
        >
          {rows.map((row, i) => {
            const warn = problem(row, i, rows)
            return (
              // index key: a vehicle has no identity beyond the `id` the operator is still typing,
              // and every value in the row is controlled from `rows` anyway.
              <InlineRecord
                key={i}
                action={(
                  <ConfirmButton
                    className="adm-formlink-x" ariaLabel={C.vehicleRemove} label={<Icon id="trash" />}
                    question={C.vehicleRemoveConfirm} danger
                    onConfirm={() => write(rows.filter((_, j) => j !== i))}
                  />
                )}
                note={warn && <SettingsNote tone="warn">{warn}</SettingsNote>}
              >
                <input
                  className="adm-input" type="text" value={row.label ?? ''}
                  placeholder={C.vehicleLabelPlaceholder}
                  onChange={(e) => setLabel(i, e.target.value)}
                />
                <input
                  className="adm-input adm-input-mono" type="text" value={row.id ?? ''}
                  placeholder={C.vehicleIdPlaceholder}
                  onChange={(e) => patch(i, { id: e.target.value })}
                />
              </InlineRecord>
            )
          })}
        </InlineRecords>
      )}
      <SettingsNote>
        <button
          type="button" className="adm-formlink-add"
          onClick={() => write([...rows, { id: '', label: '' }])}
        >
          <Icon id="plus" />{C.vehicleAdd}
        </button>
      </SettingsNote>
    </>
  )
}

/** A `referenceLayers` write: the new list, or an updater over the LATEST one. ⚠️ Anything that
 *  writes after an `await` must use the updater — see `LayersSection · write`. */
type LayerUpdate =
  | DeploymentReferenceLayer[]
  | ((prev: DeploymentReferenceLayer[]) => DeploymentReferenceLayer[])

export function LayersSection() {
  const { draft, set } = useConfig()
  const C = appConfig.copy.admin.layers
  // The loaded reference datasets (geo:*) give each configured layer a load-status, back the
  // «Datei ersetzen» control below AND are listed in full at the bottom (the merged Geodaten
  // view). Optional fetch — silent on failure, the status is a nicety. `nonce` also remounts
  // GeodataView, whose own fetch happens on mount: after a replace the dataset's VERSION is the
  // thing that changed, and a page still showing v1 is the one place this would be doubted.
  const [datasets, setDatasets] = useState<ReferenceDataset[]>([])
  // One counter drives both: it re-runs the fetch below AND remounts GeodataView, whose own
  // fetch happens on mount.
  const [nonce, setNonce] = useState(0)
  const reloadDatasets = useCallback(() => setNonce((n) => n + 1), [])
  useEffect(() => {
    let alive = true
    void listReference().then((rows) => { if (alive) setDatasets(rows) }).catch(() => { /* status is a nicety */ })
    return () => { alive = false }
  }, [nonce])

  // ── the ONE local overlay over `referenceLayers`, shared by both editors ─────────────────
  // ⚠️ Both editors on this page write the same array. Each holding its own snapshot meant the
  // first one to be touched kept a copy from BEFORE the other one wrote, and its next keystroke
  // put that copy back — a freshly uploaded GeoJSON layer vanished from the document (its file
  // still in the store) the moment somebody corrected a raster label afterwards.
  const raw = getPath<DeploymentReferenceLayer[]>(draft, ['referenceLayers'])
  // Array.isArray, not `?? []`: a hand-edited `referenceLayers: {}` must not white-screen the
  // one page somebody would come to in order to fix it.
  const stored = Array.isArray(raw) ? raw : []
  // Null until the first edit, so a layer arriving from elsewhere (CLI push, history restore)
  // still shows through.
  const [editing, setEditing] = useState<DeploymentReferenceLayer[] | null>(null)
  const all = editing ?? stored
  // ⚠️ …and the same bug in TIME rather than in space. An upload takes as long as the station's
  // uplink takes — ten seconds on LTE for a replaced hydrant export — and nothing on this page is
  // frozen meanwhile. A writer that hands over the list it captured at CLICK time therefore puts
  // a pre-upload snapshot back: the label corrected while the file was in flight is reverted, a
  // raster layer added meanwhile disappears, and neither is announced. Every write is an UPDATER
  // over the latest list instead, so an async one can only ever change its own row.
  // ⚠️ Assigned during render, not in an effect: an event can fire before the passive effect of
  // the render that produced the list has run (it does, in the Kartenebenen tests), and the
  // updater would then be handed a list from before the config even loaded. The plain
  // latest-value ref, assigned in render.
  const latest = useRef(all)
  latest.current = all
  const write = (next: LayerUpdate) => {
    const list = typeof next === 'function' ? next(latest.current) : next
    latest.current = list
    setEditing(list)
    set(['referenceLayers'], list.filter((l, i) => storableLayer(l, i, list)))
  }

  return (
    <>
      {/* ⚠️ Nothing stands above the two editors, and both omissions are deliberate.
          · The read-only overview that used to open this page listed every layer once and the
            editors below then listed all of them a second time. Since each editor names its own
            records in the head column (ui · RecordTable), it had nothing left to add. Where whole
            manifests go and which command pushes them is docs/CONFIGURATION.md's job.
          · No heading either: the table TITLES itself, and the h3 that used to stand here printed
            the same words again. The Datensätze view below carries its own title now too — a page
            with more than one card titles every card, in the card head (ui · Card), which is what
            retired the `adm-view-subhead` h3s this file used to hang over untitled surfaces. */}
      {/* ⚠️ A RecordTable, not a SettingsSheet: these two are LIST EDITORS, and their rows belong
          to a record (ui · RecordTable). The record column's header is the surface's own word for
          what a record is — «Ebene» — and the attribute column's is the same «Bezeichnung» the
          first row of every record carries. */}
      <RecordTable tip={C.geojsonTip} title={C.geojsonTitle} recordLabel={C.colLayer} fieldLabel={C.geojsonLabel}>
        {/* stands once for BOTH editors on this page — the raster sheet follows directly below */}
        <SettingsNote>{appConfig.copy.admin.common.deleteRecovery}</SettingsNote>
        <ReferenceGeojsonEditor all={all} write={write} datasets={datasets} onUploaded={reloadDatasets} />
      </RecordTable>
      <RecordTable tip={C.rasterTip} title={C.rasterTitle} recordLabel={C.colLayer} fieldLabel={C.rasterLabel}>
        <ReferenceRasterEditor all={all} write={write} />
      </RecordTable>
      <GeodataView key={nonce} title={C.datasetsTitle} />
    </>
  )
}

/** Is this layer one of the two raster kinds? A GeoJSON layer is NOT — it needs a file, which is
 *  a different act, in the editor above it. */
const isRasterLayer = (l: DeploymentReferenceLayer) => l.kind === 'wms' || l.kind === 'wmts'

/** …and its counterpart: a vector layer, i.e. one whose source is a GeoJSON document. An older
 *  hand-written row may carry the URL without the `kind`, which is what the map itself falls back
 *  to reading (deploymentConfig · mapReferenceLayers). */
const isGeojsonLayer = (l: DeploymentReferenceLayer) =>
  l.kind === 'geojson' || (!l.kind && typeof l.geojson === 'string' && !!l.geojson)

/**
 * May this row enter the autosaved draft?
 *
 * ⚠️ This page PUTs the WHOLE config document, so one row the API refuses (schemas.py ·
 * ReferenceLayerConfig · _kind_payload) takes every other section's edits down with it — which is
 * why the half-typed row an «hinzufügen» button necessarily creates is held back until it is
 * complete, and says so on screen meanwhile.
 *
 * ⚠️ …and no stricter than that, for the mirror-image reason: this filter runs over EVERY row on
 * every write, including rows this page never shows. Requiring a label of a GeoJSON row would
 * have deleted a CLI-written, label-less layer the first time somebody edited an unrelated raster
 * URL. A row of neither kind travels through untouched — it is somebody else's to validate.
 */
function storableLayer(l: DeploymentReferenceLayer, i: number, all: DeploymentReferenceLayer[]): boolean {
  const id = l.id?.trim()
  const unique = !id || all.findIndex((o) => o.id?.trim().toLowerCase() === id.toLowerCase()) === i
  if (isRasterLayer(l)) return !!id && unique && !!l.label?.trim() && (l.tiles ?? []).some((t) => t.trim())
  if (isGeojsonLayer(l)) return !!id && unique && typeof l.geojson === 'string' && !!l.geojson.trim()
  return true
}

/** A layer id / dataset slug typed by a human: lowercase and dashed. It is also what a device
 *  remembers its «Ebene eingeschaltet» state under, which is why renaming one is a real decision. */
const layerSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/** The blue the geodata manifest example uses for a hydrant layer — a starting point, not a rule. */
const DEFAULT_LAYER_COLOR = '#0f52b5'
/** ⚠️ `.json` belongs in the picker: a canton's export is as often `hydranten.json` as
 *  `.geojson`, and a filter that hides the file the operator was handed reads as «not supported».
 *  The content is what decides (inspectGeojson), not the extension. */
const GEOJSON_ACCEPT = 'application/geo+json,application/json,.geojson,.json'

/**
 * Raster-Ebenen (WMS/WMTS) — the one reference layer a canton hands over ready-made.
 *
 * The canton publishes a URL template and, until now, there was nowhere in the browser to paste
 * it: the Kartenebenen page is a viewer, and the field app's Datenquellen panel can only add a
 * GeoJSON, because that route starts from a file upload. A raster layer has no file at all.
 *
 * ⚠️ THREE writers share `referenceLayers` — `admin_geodata push`, this page, and the field
 * app's panel (`lib/api/reference · upsertReferenceLayer`). So every row is MERGED over, never
 * rebuilt: `nightColor`, `opacity`, `maxzoom`, `symbol` and `autoActivate` are all fields the CLI
 * writes and this form does not show, and rebuilding a row from the visible fields would delete
 * them the first time somebody fixed a label. (`admin_config load` carries the whole section over
 * for the same reason — admin_config.py · _RUNTIME_SECTIONS.)
 *
 * ⚠️ …and only COMPLETE rows enter the draft — `storableLayer`, which the shared `write` in
 * LayersSection applies. GeoJSON rows travel with the write untouched: they belong to the editor
 * above, and the array is one array.
 */
function ReferenceRasterEditor({ all, write }: {
  all: DeploymentReferenceLayer[]
  write: (next: LayerUpdate) => void
}) {
  const C = appConfig.copy.admin.layers
  const rasterIdx = all.map((l, i) => [l, i] as const).filter(([l]) => isRasterLayer(l))

  /** Why a raster row is not stored, or null when it is. */
  const problem = (l: DeploymentReferenceLayer, i: number): string | null => {
    const id = l.id?.trim()
    if (!id || !l.label?.trim() || !(l.tiles ?? []).some((t) => t.trim())) return C.rasterIncomplete
    return all.findIndex((o) => o.id?.trim().toLowerCase() === id.toLowerCase()) === i
      ? null
      : C.rasterDuplicate
  }

  /** ⚠️ Merged over the previous row, never replaced — see the note above. Written as an updater
   *  so an upload finishing in the editor above cannot be undone by an edit here. */
  const patch = (i: number, over: Partial<DeploymentReferenceLayer>) =>
    write((prev) => prev.map((r, j) => (j === i ? { ...r, ...over } : r)))

  // A layer id is a lowercase handle, not a caption — so it follows the Bezeichnung until it is
  // edited by hand, the same rule the vehicle editor uses.
  const setLabel = (i: number, label: string) => {
    const row = all[i]
    const follows = !row.id?.trim() || row.id === layerSlug(row.label ?? '')
    patch(i, follows ? { label, id: layerSlug(label) } : { label })
  }

  return (
    <>
      {rasterIdx.length === 0 && <SettingsNote>{C.rasterEmpty}</SettingsNote>}
      {rasterIdx.map(([row, i]) => {
        const warn = problem(row, i)
        return (
          // no swatch and no meta: a raster layer has no colour of its own, and everything a
          // reader would put on a meta line here (Typ, Quelle) is already a row of the record
          <RecordRows
            key={i}
            name={row.label?.trim() || appConfig.copy.admin.common.newEntry}
            action={(
              <ConfirmButton
                className="adm-formlink-x" ariaLabel={C.rasterRemove} label={<Icon id="trash" />}
                question={C.rasterRemoveConfirm} danger
                onConfirm={() => write((prev) => prev.filter((_, j) => j !== i))}
              />
            )}
          >
            <SettingRow label={C.rasterLabel}>
              <input
                className="adm-input" type="text" value={row.label ?? ''}
                placeholder={C.rasterLabelPlaceholder}
                onChange={(e) => setLabel(i, e.target.value)}
              />
            </SettingRow>
            <SettingRow label={C.rasterId} tip={C.rasterIdTip}>
              <input
                className="adm-input adm-input-mono" type="text" value={row.id ?? ''}
                placeholder={C.rasterIdPlaceholder}
                onChange={(e) => patch(i, { id: e.target.value })}
              />
            </SettingRow>
            <SettingRow label={C.group}>
              <input
                className="adm-input" type="text" value={row.group ?? ''}
                placeholder={C.rasterGroupPlaceholder}
                onChange={(e) => patch(i, { group: e.target.value })}
              />
            </SettingRow>
            {/* WMS / WMTS are protocol names, not copy — never translated. */}
            <SettingRow label={C.rasterKind}>
              <Select
                value={row.kind ?? 'wms'}
                onChange={(v) => patch(i, { kind: v as 'wms' | 'wmts' })}
                options={[{ value: 'wms', label: 'WMS' }, { value: 'wmts', label: 'WMTS' }]}
                ariaLabel={C.rasterKind}
              />
            </SettingRow>
            {/* One template per line: a canton that publishes several tile hosts hands over
                several URLs, and `tiles` is a list on both sides (schemas.py). */}
            <SettingRow label={C.rasterTiles} tip={C.rasterTilesTip} span>
              <textarea
                className="adm-input adm-input-mono adm-formlink-url" rows={2}
                value={(row.tiles ?? []).join('\n')} placeholder={C.rasterTilesPlaceholder}
                onChange={(e) => patch(i, { tiles: e.target.value.split('\n').map((t) => t.trim()).filter(Boolean) })}
              />
            </SettingRow>
            <SettingRow label={C.attribution}>
              <input
                className="adm-input" type="text" value={row.attribution ?? ''}
                placeholder={C.rasterAttributionPlaceholder}
                onChange={(e) => patch(i, { attribution: e.target.value || null })}
              />
            </SettingRow>
            {warn && <SettingsNote tone="warn">{warn}</SettingsNote>}
          </RecordRows>
        )
      })}
      <SettingsNote>
        <button
          type="button" className="adm-formlink-add"
          onClick={() => write((prev) => [...prev, { id: '', label: '', kind: 'wms', icon: 'map', tiles: [] }])}
        >
          <Icon id="plus" />{C.rasterAdd}
        </button>
      </SettingsNote>
    </>
  )
}

/**
 * GeoJSON-Ebenen (Vektor) — hydrants, a Leitungskataster export, the Gemeinde's Zonenplan: the
 * one dataset a station could not load without a terminal.
 *
 * Uploading does BOTH halves of what `admin_geodata load` does, because either half alone is
 * useless: the file goes into the reference store (`PUT /api/reference/geo:<id>`) AND the render
 * config gets the row that turns it into a map layer. Both writes are admin-only, which is why
 * this lives in /admin and not in the field app — the in-incident «Datenquellen» panel that used
 * to own this act sat behind an open incident and had no way to be opened at all.
 *
 * ⚠️ WGS84 only, checked HERE before a byte is uploaded (`inspectGeojson`) and again by the
 * server (`admin_geodata · _validate_geojson_wgs84`). LV95 is what every Swiss source hands over,
 * and relabelling projected metres as lat/lng puts a station's hydrants in the North Sea. The
 * refusal therefore names the FIX — reproject to EPSG:4326, with the two commands that do it —
 * not just the failure.
 *
 * ⚠️ Replacing a layer's file writes the SAME dataset id, so it updates in place instead of
 * minting a sibling — and the new `current_version` is written into the layer's URL, because that
 * URL is the only cache key the service worker's `reference-data` entry ever sees (see
 * `lib/api/reference · geoLayerUrl`).
 */
function ReferenceGeojsonEditor({ all, write, datasets, onUploaded }: {
  all: DeploymentReferenceLayer[]
  write: (next: LayerUpdate) => void
  datasets: ReferenceDataset[]
  onUploaded: () => void
}) {
  const C = appConfig.copy.admin.layers
  const geoIdx = all.map((l, i) => [l, i] as const).filter(([l]) => isGeojsonLayer(l))
  /** one hidden file input per row — «Datei ersetzen» clicks it */
  const rowInputs = useRef<Record<number, HTMLInputElement | null>>({})

  /** ⚠️ Merged over the previous row, never replaced: `nightColor`, `opacity`, `symbol` and
   *  `autoActivate` are CLI-written and invisible in this form. */
  const patch = (i: number, over: Partial<DeploymentReferenceLayer>) =>
    write((prev) => prev.map((r, j) => (j === i ? { ...r, ...over } : r)))

  /** The same merge, addressed by the layer's OWN id rather than by its position. ⚠️ For the
   *  writes that land after an upload: the row may have moved (or been deleted) in the seconds
   *  the file took, and an index captured at click time would then patch a stranger. */
  const patchRow = (id: string | undefined, over: Partial<DeploymentReferenceLayer>) =>
    write((prev) => prev.map((r) => (r.id != null && r.id === id ? { ...r, ...over } : r)))

  /** Why a row is not (fully) stored, or null when it is. ⚠️ A missing Bezeichnung does NOT hold
   *  the row back — the layer would disappear from the map over a cleared text field, and a
   *  label-less row is perfectly valid to the API. It renders under its Kennung, and says so. */
  const problem = (l: DeploymentReferenceLayer, i: number): string | null => {
    const id = l.id?.trim()
    if (!id) return C.geojsonNoId
    if (all.findIndex((o) => o.id?.trim().toLowerCase() === id.toLowerCase()) !== i) return C.rasterDuplicate
    if (!l.label?.trim()) return C.geojsonNoLabel
    return null
  }

  const renameLayer = (i: number, label: string) => {
    // ⚠️ The Kennung follows the Bezeichnung only while the layer has no file yet. Once one is
    // uploaded the id is a handle two other things point at — the stored dataset and every
    // device's «Ebene eingeschaltet» memory — so renaming it stays a deliberate act.
    const row = all[i]
    const follows = !row.id?.trim() || (!row.geojson && row.id === layerSlug(row.label ?? ''))
    patch(i, follows ? { label, id: layerSlug(label) } : { label })
  }

  // ── the new layer being prepared (never in the draft until its file is stored) ───────────
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [found, setFound] = useState<{ count: number; geometry: 'point' | 'line' } | null>(null)
  const [label, setLabel] = useState('')
  const [id, setId] = useState('')
  const [group, setGroup] = useState('')
  const [color, setColor] = useState(DEFAULT_LAYER_COLOR)
  const [vectorKind, setVectorKind] = useState<'point' | 'line'>('line')
  const [busy, setBusy] = useState(false)
  /** the last refusal (upload or file check) and, where there is one, the instruction */
  const [failed, setFailed] = useState<{ msg: string; hint?: string } | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const addFileRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setOpen(false); setFile(null); setFound(null); setLabel(''); setId(''); setGroup('')
    setColor(DEFAULT_LAYER_COLOR); setVectorKind('line'); setFailed(null)
    if (addFileRef.current) addFileRef.current.value = ''
  }

  /** Read the picked file BEFORE anything is sent: the operator sees what it contains (features,
   *  geometry) and an unusable one is refused here, where the fix is still cheap. */
  const inspect = async (f: File) => {
    setDone(null)
    const res = await inspectGeojson(f)
    if (!res.ok) {
      setFile(null); setFound(null)
      setFailed({ msg: res.msg, hint: res.reason === 'projection' ? C.geojsonReproject : undefined })
      return
    }
    setFailed(null)
    setFile(f)
    setFound({ count: res.count, geometry: res.geometry })
    setVectorKind(res.geometry)
    // the file name is the station's own name for this data — a better first draft of the
    // Bezeichnung than an empty box, and still fully editable
    if (!label.trim()) {
      const stem = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()
      setLabel(stem)
      setId(layerSlug(stem))
    }
  }

  const effectiveId = (id.trim() || layerSlug(label)).toLowerCase()
  const idTaken = all.some((l) => l.id?.trim().toLowerCase() === effectiveId)
  /** A dataset already in the store under this id, with no layer pointing at it: uploading
   *  REPLACES it, which is worth saying out loud before it happens. */
  const datasetTaken = !idTaken && datasets.some((d) => d.id === `geo:${effectiveId}`)
  const ready = !!file && !!label.trim() && !!effectiveId && !idTaken

  const commit = async () => {
    if (!file || !ready) return
    setBusy(true); setFailed(null); setDone(null)
    try {
      const ds = await uploadReference(`geo:${effectiveId}`, file, file.name)
      // ⚠️ Appended to the list as it is NOW, not to the one this form was opened over — the
      // upload took the station's uplink to finish and the page was editable the whole time.
      write((prev) => [...prev, {
        id: effectiveId, label: label.trim(), group: group.trim() || undefined, icon: 'map',
        kind: 'geojson', geojson: geoLayerUrl(ds.id, ds.current_version), vectorKind, color,
      }])
      setDone(fillTemplate(C.geojsonStored, { name: label.trim(), n: ds.feature_count ?? found?.count ?? 0 }))
      reset()
      onUploaded()
    } catch (e) {
      setFailed({ msg: e instanceof ApiError ? e.detail : C.geojsonUploadFailed })
    } finally {
      setBusy(false)
    }
  }

  // ── replacing an existing layer's file (same dataset id → a new VERSION, not a sibling) ──
  const [rowBusy, setRowBusy] = useState<number | null>(null)
  const [rowMsg, setRowMsg] = useState<{ i: number; msg: string; hint?: string; ok?: boolean } | null>(null)
  const replaceFile = async (i: number, rowId: string | undefined, datasetId: string, f: File) => {
    // the row now carries the news; the previous «… gespeichert» line below the list would
    // otherwise still report the feature count of the file that was just replaced
    setRowBusy(i); setRowMsg(null); setDone(null)
    try {
      const res = await inspectGeojson(f)
      if (!res.ok) {
        setRowMsg({ i, msg: res.msg, hint: res.reason === 'projection' ? C.geojsonReproject : undefined })
        return
      }
      const ds = await uploadReference(datasetId, f, f.name)
      // the version is the cache key — the layer's URL has to carry the new one, or every tablet
      // that already fetched this dataset keeps rendering the file that was just replaced
      patchRow(rowId, { geojson: geoLayerUrl(ds.id, ds.current_version) })
      setRowMsg({ i, ok: true, msg: fillTemplate(C.geojsonReplaced, { v: ds.current_version, n: ds.feature_count ?? res.count }) })
      onUploaded()
    } catch (e) {
      setRowMsg({ i, msg: e instanceof ApiError ? e.detail : C.geojsonUploadFailed })
    } finally {
      setRowBusy(null)
    }
  }

  return (
    <>
      {geoIdx.length === 0 && <p className="adm-hint">{C.geojsonEmpty}</p>}
      {geoIdx.map(([row, i]) => {
        const warn = problem(row, i)
        const datasetId = geoDatasetId(row.geojson)
        const ds = datasetId ? datasets.find((d) => d.id === datasetId) : undefined
        const facts = ds
          ? [
              fillTemplate(C.geojsonVersion, { v: ds.current_version }),
              ds.feature_count != null ? fillTemplate(C.features, { n: ds.feature_count }) : null,
              fillTemplate(C.updated, { date: fmtDate(ds.updated_at) }),
            ].filter(Boolean).join(' · ')
          : datasetId ? C.geojsonDatasetMissing : String(row.geojson ?? '')
        const msg = rowMsg?.i === i ? rowMsg : null
        return (
          // ⚠️ The facts (Version · Features · Aktualisiert) live in the HEAD, not in the Datei
          // row: they say what this layer IS, which is what a record head is for, and the Datei
          // row is then just the act. Where there is no dataset behind the layer — a hand-written
          // URL — that URL is the fact, and there is nothing to replace, so no Datei row at all.
          <RecordRows
            key={row.id ?? i}
            name={row.label?.trim() || appConfig.copy.admin.common.newEntry}
            swatch={HEX_COLOR.test(row.color ?? '') ? row.color : undefined}
            meta={facts}
            action={(
              <ConfirmButton
                className="adm-formlink-x" ariaLabel={C.geojsonRemove} label={<Icon id="trash" />}
                question={C.geojsonRemoveConfirm} danger
                onConfirm={() => write((prev) => prev.filter((_, j) => j !== i))}
              />
            )}
          >
            <SettingRow label={C.geojsonLabel}>
              <input
                className="adm-input" type="text" value={row.label ?? ''}
                placeholder={C.geojsonLabelPlaceholder}
                onChange={(e) => renameLayer(i, e.target.value)}
              />
            </SettingRow>
            <SettingRow label={C.geojsonId} tip={C.geojsonIdTip}>
              <input
                className="adm-input adm-input-mono" type="text" value={row.id ?? ''}
                placeholder={C.geojsonIdPlaceholder}
                onChange={(e) => patch(i, { id: e.target.value })}
              />
            </SettingRow>
            <SettingRow label={C.group}>
              <input
                className="adm-input" type="text" value={row.group ?? ''}
                placeholder={C.geojsonGroupPlaceholder}
                onChange={(e) => patch(i, { group: e.target.value })}
              />
            </SettingRow>
            <SettingRow label={C.geometry} tip={C.geojsonGeometryTip}>
              <Select
                value={row.vectorKind === 'point' ? 'point' : 'line'}
                onChange={(v) => patch(i, { vectorKind: v })}
                options={[{ value: 'line', label: C.geometryLine }, { value: 'point', label: C.geometryPoint }]}
                ariaLabel={C.geometry}
              />
            </SettingRow>
            <SettingRow label={C.colorDay}>
              <div className="adm-color-row">
                <input
                  className="adm-color-swatch" type="color"
                  value={HEX_COLOR.test(row.color ?? '') ? pickerHex(row.color!) : DEFAULT_LAYER_COLOR}
                  onChange={(e) => patch(i, { color: e.target.value })}
                  aria-label={C.colorDay}
                />
                <input
                  className="adm-input adm-input-mono" type="text" value={row.color ?? ''}
                  placeholder={DEFAULT_LAYER_COLOR}
                  onChange={(e) => patch(i, { color: e.target.value || null })}
                />
              </div>
            </SettingRow>
            {datasetId && (
              <SettingRow label={C.geojsonFile}>
                <div className="adm-brand-row">
                  <input
                    ref={(el) => { rowInputs.current[i] = el }}
                    type="file" accept={GEOJSON_ACCEPT} className="adm-file-hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      e.target.value = '' // so the same file can be picked again after a refusal
                      if (f) void replaceFile(i, row.id, datasetId, f)
                    }}
                  />
                  <button
                    type="button" className="btn adm-int-btn" disabled={rowBusy === i}
                    onClick={() => rowInputs.current[i]?.click()}
                  >
                    {rowBusy === i ? C.geojsonUploading : C.geojsonReplace}
                  </button>
                </div>
              </SettingRow>
            )}
            {msg && (
              <SettingsNote tone={msg.ok ? undefined : 'warn'}>
                {msg.msg}{msg.hint ? ` ${msg.hint}` : ''}
              </SettingsNote>
            )}
            {warn && <SettingsNote tone="warn">{warn}</SettingsNote>}
          </RecordRows>
        )
      })}

      {open ? (
        // the record being prepared — same shape as the stored ones, so the eye does not have to
        // relearn the page between adding a layer and correcting one
        <RecordRows
          name={label.trim() || appConfig.copy.admin.common.newEntry}
          swatch={HEX_COLOR.test(color) ? color : undefined}
        >
          <SettingRow label={C.geojsonFile} tip={C.geojsonFileTip} span>
            <div className="adm-brand-row">
              <input
                ref={addFileRef} type="file" accept={GEOJSON_ACCEPT} className="adm-file-hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) void inspect(f)
                }}
              />
              <button type="button" className="btn adm-int-btn" disabled={busy} onClick={() => addFileRef.current?.click()}>
                {file ? C.geojsonPickOther : C.geojsonPick}
              </button>
              {file && found && (
                <span className="adm-vfacts">
                  {[
                    file.name,
                    fillTemplate(C.features, { n: found.count }),
                    found.geometry === 'point' ? C.geometryPoint : C.geometryLine,
                  ].join(' · ')}
                </span>
              )}
            </div>
          </SettingRow>
          <SettingRow label={C.geojsonLabel}>
            <input
              className="adm-input" type="text" value={label}
              placeholder={C.geojsonLabelPlaceholder}
              onChange={(e) => {
                setLabel(e.target.value)
                if (!id.trim() || id === layerSlug(label)) setId(layerSlug(e.target.value))
              }}
            />
          </SettingRow>
          <SettingRow label={C.geojsonId} tip={C.geojsonIdTip}>
            <input
              className="adm-input adm-input-mono" type="text" value={id}
              placeholder={C.geojsonIdPlaceholder}
              onChange={(e) => setId(e.target.value)}
            />
          </SettingRow>
          <SettingRow label={C.group}>
            <input
              className="adm-input" type="text" value={group}
              placeholder={C.geojsonGroupPlaceholder}
              onChange={(e) => setGroup(e.target.value)}
            />
          </SettingRow>
          <SettingRow label={C.geometry} tip={C.geojsonGeometryTip}>
            <Select
              value={vectorKind}
              onChange={(v) => setVectorKind(v === 'point' ? 'point' : 'line')}
              options={[{ value: 'line', label: C.geometryLine }, { value: 'point', label: C.geometryPoint }]}
              ariaLabel={C.geometry}
            />
          </SettingRow>
          <SettingRow label={C.colorDay}>
            <div className="adm-color-row">
              <input
                className="adm-color-swatch" type="color"
                value={HEX_COLOR.test(color) ? pickerHex(color) : DEFAULT_LAYER_COLOR}
                onChange={(e) => setColor(e.target.value)}
                aria-label={C.colorDay}
              />
              <input
                className="adm-input adm-input-mono" type="text" value={color}
                placeholder={DEFAULT_LAYER_COLOR}
                onChange={(e) => setColor(e.target.value)}
              />
            </div>
          </SettingRow>
          {/* Nothing here has touched the document yet — the row is written only once its file
              is in the store, which is also the only moment its URL exists. */}
          {idTaken && <SettingsNote tone="warn">{C.rasterDuplicate}</SettingsNote>}
          {datasetTaken && <SettingsNote tone="warn">{C.geojsonDatasetTaken}</SettingsNote>}
          {!ready && !idTaken && <SettingsNote>{C.geojsonIncomplete}</SettingsNote>}
          {failed && (
            <SettingsNote tone="warn">{failed.msg}{failed.hint ? ` ${failed.hint}` : ''}</SettingsNote>
          )}
          <SettingsNote>
            <span className="adm-brand-row">
              <button type="button" className="btn adm-save-btn" disabled={!ready || busy} onClick={() => void commit()}>
                {busy && <ShellLoader />}{busy ? C.geojsonUploading : C.geojsonUpload}
              </button>
              <button type="button" className="btn adm-int-btn" disabled={busy} onClick={reset}>
                {C.geojsonCancel}
              </button>
            </span>
          </SettingsNote>
        </RecordRows>
      ) : (
        <SettingsNote>
          <button type="button" className="adm-formlink-add" onClick={() => { setDone(null); setOpen(true) }}>
            <Icon id="plus" />{C.geojsonAdd}
          </button>
        </SettingsNote>
      )}
      {done && !open && <SettingsNote>{done}</SettingsNote>}
    </>
  )
}

export function ModulesSection() {
  const { draft } = useConfig()
  const C = appConfig.copy.admin.modules
  const configured = draft?.modules ?? []
  const usingDefaults = configured.length === 0
  const modules = usingDefaults ? DEFAULT_MODULES : configured
  return <ObjectPlansView modules={modules} overview={objects =>
    <Card title={C.catalogueTitle}>
      <ModulesViewer modules={modules} objects={objects} usingDefaults={usingDefaults} />
    </Card>
  } />
}

/**
 * Rapport → Rundung. The one setting on this page changes what the Gemeinde is billed, and it
 * lived in a JSON blob reachable only through the CLI. It is shown with a worked example rather
 * than a description: the printed rapport deliberately does NOT carry the rule (it is identical
 * on every sheet a station produces — see docs/CONFIGURATION.md §1b), so this page is the one
 * place somebody can see what the two numbers actually do before changing them.
 */
export function ReportSection() {
  const { draft, set } = useConfig()
  const numberField = useNumberField()
  const C = appConfig.copy.admin.report
  const stepMin = getPath<number>(draft, ['report', 'hoursRounding', 'stepMin']) ?? DEFAULT_HOURS_ROUNDING.stepMin
  const graceMin = getPath<number>(draft, ['report', 'hoursRounding', 'graceMin']) ?? DEFAULT_HOURS_ROUNDING.graceMin
  // the three durations from the docs' own worked example, run through the LIVE rule
  const sample = [67, 23, 178]
  const rule = { stepMin, graceMin }
  const raw = sample.map((m) => fmtHours(m)).join(' · ')
  const rounded = fmtHours(sample.reduce((n, m) => n + roundedMinutes(m, rule), 0))
  return (
    <SettingsSheet>
      <SettingsGroup title={C.groupRounding} tip={C.roundingTip} />
      {/* ⚠️ Both are plain `int` with a default (schemas.py · HoursRoundingConfig) and the GET
          projection always fills them in, so there is no `null` to write back: backspacing «30»
          to type «60» is an EMPTY box for a keystroke or two, and that emptiness used to reach
          the draft and 422 the whole document — every Station page with it. Held locally
          instead, exactly like the map centre and the three Alarm-Uhren. */}
      {numberField({
        path: ['report', 'hoursRounding', 'stepMin'], label: C.stepMin, tip: C.stepMinTip,
        guard: { kind: 'int', min: 1, max: 480 }, placeholder: String(DEFAULT_HOURS_ROUNDING.stepMin),
        standard: DEFAULT_HOURS_ROUNDING.stepMin,
      })}
      {numberField({
        path: ['report', 'hoursRounding', 'graceMin'], label: C.graceMin, tip: C.graceMinTip,
        guard: { kind: 'int', min: 0, max: 479 }, placeholder: String(DEFAULT_HOURS_ROUNDING.graceMin),
        standard: DEFAULT_HOURS_ROUNDING.graceMin,
      })}
      {/* Not a setting — the two numbers above, worked through. It stays a ROW rather than
          moving into an ⓘ, because it is the only thing on the page that changes when they do. */}
      <SettingRow label={C.example}>
        <span className="adm-set-example">{fillTemplate(C.exampleHint, { raw, rounded })}</span>
      </SettingRow>

      {/* The other number that decides what the Personalblatt says about a person's time. It
          belongs beside the rounding rather than in its own card: both are the station's
          convention for turning a recorded presence into a printed figure. */}
      <SettingsGroup title={C.groupMerge} tip={C.mergeTip} />
      {numberField({
        path: ['report', 'attendanceMergeGapMin'], label: C.mergeGapMin, tip: C.mergeGapMinTip,
        guard: { kind: 'int', min: 0, max: 240 }, placeholder: String(DEFAULT_ATTENDANCE_MERGE_GAP_MIN),
        standard: DEFAULT_ATTENDANCE_MERGE_GAP_MIN,
      })}

      {/* Partnerorganisationen — printed as an Ankreuz-Zeile on the Rapport AND on the paper
          Erfassungsblatt (admin/capturePdf). It sat in the config document with no editor, so a
          Wehr could not add one without a JSON file and a terminal. */}
      {/* One setting whose value happens to be a list of words — so it is ONE row, spanning
          Wert+Standard and wrapping, rather than a chip cloud floating under a heading. */}
      <SettingRow label={C.groupPartners} tip={C.partnersTip} span>
        <StringList
          ariaLabel={C.groupPartners}
          value={getPath<string[]>(draft, ['report', 'partnerOrgs']) ?? []}
          onChange={(next) => set(['report', 'partnerOrgs'], next)}
          placeholder={C.partnerAddPlaceholder}
        />
      </SettingRow>

      <SettingsGroup title={C.groupLinks} tip={C.linksTip} />
      <ReportLinksEditor />

      {/* The one switch that only a station with a print relay ever meets — and the one it meets
          every single time, because a face-up printer delivers the Rapport back-to-front and
          somebody re-sorts the stack by hand. Default ON (schemas.py · ReportConfig), so the
          checkbox starts ticked on a station that has never touched it. */}
      <SettingsGroup title={C.groupPrint} tip={C.printTip} />
      {/* Default ON (schemas.py · ReportConfig), so the Standard column speaks only for the
          station that turned it off. */}
      <SettingRow
        label={C.reverseOrder} tip={C.reverseOrderHint}
        standard={standardNote(getPath<boolean>(draft, ['report', 'reversePrintOrder']), true)}
      >
        <input
          className="adm-set-check"
          type="checkbox"
          checked={getPath<boolean>(draft, ['report', 'reversePrintOrder']) ?? true}
          onChange={(e) => set(['report', 'reversePrintOrder'], e.target.checked)}
        />
      </SettingRow>

      {/* …and the Verlauf's own wording, which used to be a whole page for one textarea. */}
      <JournalGroup />
    </SettingsSheet>
  )
}

/**
 * «Alarme & Einsätze» — the three clocks on an Einsatz's life plus the webhooks that tell a
 * second system it started at all. All four were `admin_config`-only.
 *
 * ⚠️ Every one of the three numbers is an `int` with bounds on the backend
 * (schemas.py · AlarmsConfig) and NONE of them is nullable — `autoArchiveDays: int = 7`, not
 * `int | None`. So an emptied box, a decimal and an out-of-range value are each a 422 on the
 * WHOLE document, in a 700 ms autosave retry loop. They are therefore held in local state
 * exactly like a half-typed map centre: what is on screen says why it is not stored, and the
 * stored value — plus every other field on every other Station page — is left alone meanwhile.
 */
export function AlarmsSection() {
  const C = appConfig.copy.admin.alarms
  const numberField = useNumberField()

  // ⚠️ The same rule the whole page follows, in the one shared implementation of it
  // (`useNumberField` at the top of this file) — this section's own wording for the refusal,
  // because these three are days and hours rather than a doctrine number.
  const intField = (key: 'autoArchiveDays' | 'staleIncidentDays' | 'captureWindowHours', label: string, tip: string, min: number, max: number) =>
    numberField({
      path: ['alarms', key], label, tip,
      guard: { kind: 'int', min, max },
      message: fillTemplate(C.numberRange, { min, max }),
    })

  return (
    <>
      {/* ⚠️ A RecordTable, not a SettingsSheet — same reason as the Fahrzeuge above it: an
          Alarmgruppe is a RECORD, and it is named once in its own column instead of on a
          full-width divider the eye loses as soon as it scrolls past. */}
      <RecordTable title={C.groupGroups} tip={C.groupsTip} recordLabel={C.colGroup} fieldLabel={C.groupLabel}>
        <SettingsNote>{appConfig.copy.admin.common.deleteRecovery}</SettingsNote>
        <AlarmGroupsEditor />
      </RecordTable>
      {/* Two sheets, each titled by its group — not one untitled sheet with two dividers in it.
          The page's other three surfaces carry their heading in the card head, and a group divider
          standing in for a card title is the same words one line lower and two sizes smaller. */}
      <SettingsSheet title={C.groupArchive} tip={C.archiveTip}>
        {intField('autoArchiveDays', C.autoArchiveDays, C.autoArchiveDaysTip, 0, 3650)}
        {intField('staleIncidentDays', C.staleIncidentDays, C.staleIncidentDaysTip, 0, 3650)}
      </SettingsSheet>
      <SettingsSheet title={C.groupCapture} tip={C.captureTip}>
        {intField('captureWindowHours', C.captureWindowHours, C.captureWindowHoursTip, 1, 168)}
      </SettingsSheet>
      <SettingsSheet title={C.groupWebhooks} tip={C.webhooksTip}>
        <WebhooksEditor />
      </SettingsSheet>
    </>
  )
}

/**
 * The station's Alarmgruppen — the OTHER half of the «Alarmierungs-/Ausrückzeiten» grid, whose
 * vehicle half is edited on «Fahrzeuge & Symbole» (FleetVehiclesEditor). Without a group here the
 * grid has no group rows at all, on the Rapport (lib/report · gruppenRows → backend/app/report)
 * and on the paper Erfassungsblatt (admin/capturePdf) alike — and there was no way to fix that
 * anywhere but the `admin_config` CLI. `id` is what a milestone webhook reports an Alarmzeit
 * against (backend/app/api/alarms.py · group_labels).
 *
 * A RecordTable exactly like FleetVehiclesEditor, and it obeys the same rule: `id`/`label` are
 * `min_length=1` on the backend (schemas.py · AlarmGroup) and Verwaltung PUTs the WHOLE document,
 * so one blank row would 422 every other Station page too, in a 700 ms autosave retry loop.
 * Incomplete rows stay on screen with a warning until they are worth saving.
 *
 * Three fields exist on the model and only two of them are typed here. `color` IS one of the two
 * — despite its name it is not a colour but the parenthetical printed after the Bezeichnung
 * («Gr. 9 (Tag. Pikett)»), read by lib/report · reportZeiten and admin/capturePdf · downloadSheetPdf.
 * `winfapAlias` and `tagespikett` are read by NOTHING in this repo, so they get no input — and
 * they survive an edit made here, because every row is merged over its predecessor.
 */
function AlarmGroupsEditor() {
  const { draft, set } = useConfig()
  const C = appConfig.copy.admin.alarms
  // Array.isArray, not `?? []`: the document can also be written straight into the DB by the
  // `admin_config` CLI, and a hand-edited `groups: {}` would otherwise white-screen the one page
  // somebody would come to in order to fix it.
  const raw = getPath<AlarmGroup[]>(draft, ['alarms', 'groups'])
  const stored = Array.isArray(raw) ? raw : []
  // The rows as they are being EDITED — the stored ones plus any not finished yet. Null until
  // the first edit, so a config arriving from elsewhere still shows through.
  const [editing, setEditing] = useState<AlarmGroup[] | null>(null)
  const rows = editing ?? stored

  /** Why a row is not stored, or null when it is. ⚠️ Duplicate ids are refused rather than
   *  silently merged: the id is the key an alarmed group's time is recorded against, so two rows
   *  sharing one would quietly become a single line on the Rapport. */
  const problem = (g: AlarmGroup, i: number, all: AlarmGroup[]): string | null => {
    const id = g.id?.trim()
    if (!id || !g.label?.trim()) return C.groupIncomplete
    return all.findIndex((o) => o.id?.trim().toLowerCase() === id.toLowerCase()) === i
      ? null
      : C.groupDuplicate
  }

  const write = (next: AlarmGroup[]) => {
    setEditing(next)
    set(['alarms', 'groups'], next.filter((g, i) => problem(g, i, next) === null))
  }
  // ⚠️ Merged over the previous row, never replaced: `winfapAlias`/`tagespikett` — and anything
  // else the CLI wrote that this form does not show — has to survive an edit made here.
  const patch = (i: number, over: Partial<AlarmGroup>) =>
    write(rows.map((r, j) => (j === i ? { ...r, ...over } : r)))

  const setLabel = (i: number, label: string) => {
    const row = rows[i]
    const follows = !row.id?.trim() || row.id === slugId(row.label ?? '')
    patch(i, follows ? { label, id: slugId(label) } : { label })
  }

  return (
    <>
      {rows.length === 0 && <SettingsNote>{C.groupsEmpty}</SettingsNote>}
      {/* ONE row per group, like the Fahrzeuge (ui · InlineRecords). ⚠️ NO swatch, despite the
          field being called `color`: it holds the parenthetical the Rapport prints («Rot»,
          «Tag. Pikett»), not a colour — see the note above. */}
      {rows.length > 0 && (
        <InlineRecords
          recordLabel={C.colGroup}
          columns={[
            { label: C.groupLabel, tip: C.groupLabelTip },
            { label: C.groupId, tip: C.groupIdTip },
            { label: C.groupNote, tip: C.groupNoteTip },
          ]}
        >
          {rows.map((row, i) => {
            const warn = problem(row, i, rows)
            const note = row.color?.trim()
            return (
              // index key: a group has no identity beyond the `id` the operator is still typing,
              // and every value in the row is controlled from `rows` anyway.
              <InlineRecord
                key={i}
                action={(
                  <ConfirmButton
                    className="adm-formlink-x" ariaLabel={C.groupRemove} label={<Icon id="trash" />}
                    question={C.groupRemoveConfirm} danger
                    onConfirm={() => write(rows.filter((_, j) => j !== i))}
                  />
                )}
                note={warn
                  ? <SettingsNote tone="warn">{warn}</SettingsNote>
                  // «Zusatz» is the one field whose effect is not obvious from its own value, so
                  // the row says what it will print rather than describing it.
                  : note && fillTemplate(C.groupPreview, { zeile: `${row.label?.trim()} (${note})` })}
              >
                <input
                  className="adm-input" type="text" value={row.label ?? ''}
                  placeholder={C.groupLabelPlaceholder}
                  onChange={(e) => setLabel(i, e.target.value)}
                />
                <input
                  className="adm-input adm-input-mono" type="text" value={row.id ?? ''}
                  placeholder={C.groupIdPlaceholder}
                  onChange={(e) => patch(i, { id: e.target.value })}
                />
                <input
                  className="adm-input" type="text" value={row.color ?? ''}
                  placeholder={C.groupNotePlaceholder}
                  onChange={(e) => patch(i, { color: e.target.value || null })}
                />
              </InlineRecord>
            )
          })}
        </InlineRecords>
      )}
      <SettingsNote>
        <button
          type="button" className="adm-formlink-add"
          onClick={() => write([...rows, { id: '', label: '' }])}
        >
          <Icon id="plus" />{C.groupAdd}
        </button>
      </SettingsNote>
    </>
  )
}

/**
 * `alarms.webhooks` — one outbound POST per created Einsatz, to every address in this list
 * (backend/app/webhooks.py). This is how a second system learns an Einsatz exists at all; the
 * kp-rueck QR-slip printer is the one that exists today.
 *
 * The backend takes a bare `list[str]` and checks nothing, so a typo here does not 422 — it
 * simply never delivers, and nobody finds out until the slip printer stays silent during an
 * Einsatz. So the check is ours: only an openable http(s) address enters the document, the same
 * predicate the Rapport's own links use, and a row that fails it stays on screen saying so.
 */
function WebhooksEditor() {
  const { draft, set } = useConfig()
  const C = appConfig.copy.admin.alarms
  // Array.isArray, not `?? []`: a hand-edited `webhooks: {}` must not white-screen the page
  // somebody would come to in order to fix it.
  const raw = getPath<string[]>(draft, ['alarms', 'webhooks'])
  const stored = Array.isArray(raw) ? raw : []
  const [editing, setEditing] = useState<string[] | null>(null)
  const rows = editing ?? stored

  /** Why a row is not stored, or null when it is. Duplicates are refused rather than merged:
   *  the same address twice means the receiver gets every Einsatz twice. */
  const problem = (url: string, i: number, all: string[]): string | null => {
    if (!isOpenableUrl(url.trim())) return C.webhookInvalid
    return all.findIndex((o) => o.trim() === url.trim()) === i ? null : C.webhookDuplicate
  }

  const write = (next: string[]) => {
    setEditing(next)
    set(['alarms', 'webhooks'], next.map((u) => u.trim()).filter((u, i, all) => problem(u, i, all) === null))
  }

  return (
    <>
      {rows.length === 0 && <SettingsNote>{C.webhooksEmpty}</SettingsNote>}
      {rows.map((row, i) => {
        const warn = problem(row, i, rows)
        return (
          // One field per record, so it needs no divider of its own: a webhook IS a row, and
          // the bin travels inside the control rather than costing a fourth column.
          // index key: a webhook has no identity beyond the URL being typed into it
          <div className="adm-formlink" key={i}>
            <SettingRow label={C.webhookUrl} span>
              <span className="adm-set-inline">
                <input
                  className="adm-input adm-input-mono" type="url" value={row}
                  placeholder={C.webhookPlaceholder}
                  onChange={(e) => write(rows.map((r, j) => (j === i ? e.target.value : r)))}
                />
                <ConfirmButton
                  className="adm-formlink-x" ariaLabel={C.webhookRemove} label={<Icon id="trash" />}
                  question={C.webhookRemoveConfirm} danger
                  onConfirm={() => write(rows.filter((_, j) => j !== i))}
                />
              </span>
            </SettingRow>
            {warn && <SettingsNote tone="warn">{warn}</SettingsNote>}
          </div>
        )
      })}
      <SettingsNote>
        <button type="button" className="adm-formlink-add" onClick={() => write([...rows, ''])}>
          <Icon id="plus" />{C.webhookAdd}
        </button>
      </SettingsNote>
    </>
  )
}

/** The Einsatz the link PREVIEW is resolved against — a plausible one, so an admin can read
 *  what a placeholder will turn into without having to open a real incident. */
const SAMPLE_LINK_FACTS: ReportLinkFacts = {
  stichwort: 'Brand Gebäude',
  ort: 'Musterstrasse 3',
  alarmiertAt: '2026-08-14T19:42:00Z',
  endedAt: '2026-08-14T21:05:00Z',
  einsatzleiter: 'Hans Muster',
  kontaktperson: 'Anna Meier',
  kurzbericht: 'Küchenbrand, durch Kleinlöschgerät gelöscht.',
  wehr: 'Feuerwehr Musterdorf',
}

/**
 * «Formulare & Links» — the station's own paperwork as rows on the Rapport (lib/reportLinks).
 *
 * The workflow this is shaped around: in Google Forms press «Link zum Vorausfüllen abrufen»,
 * type sample values, paste the link here — then swap the sample values for placeholders. The
 * chips insert a placeholder AT THE CURSOR, so nobody has to remember their names, and the
 * preview underneath resolves the whole URL against a sample Einsatz: a typo shows up as a
 * `{platzhalter}` still standing in the preview, which is the only way to catch one before an
 * Einsatz does.
 */
function ReportLinksEditor() {
  const { draft, set } = useConfig()
  const C = appConfig.copy.admin.report
  // Array.isArray, not `?? []`: the document can also be written by the `admin_config` CLI
  // straight into the DB, and a hand-edited `links: {}` would otherwise white-screen this page
  // on `.map` — the one config surface somebody would go to in order to FIX that.
  const raw = getPath<ReportLink[]>(draft, ['report', 'links'])
  const stored = Array.isArray(raw) ? raw : []
  // The rows as they are being EDITED — the stored ones plus any that are not finished yet.
  // Null until the first edit, so a config arriving from elsewhere still shows through.
  const [editing, setEditing] = useState<ReportLink[] | null>(null)
  const rows = editing ?? stored
  // the URL field a chip inserts into: the one that was focused last. Held as an element ref
  // rather than an index, because the insert needs its live selection anyway.
  const urlRef = useRef<HTMLTextAreaElement | null>(null)
  // ⚠️ The empty list is written as `[]`, NOT as `null`. `report.links` is a plain
  // `list[ReportLinkConfig]` on the backend (schemas.py), so a `null` fails validation — and
  // because Verwaltung PUTs the WHOLE document, that 422 does not just refuse the deletion:
  // the null stays in the draft and every later edit on every Station page 422s with it, in a
  // 700 ms autosave retry loop, until the tab is reloaded (which throws the edit away). The
  // «a cleared section should look untouched» idea was void anyway — `model_dump` fills the
  // default, so every saved document carries `"links": []` whatever we send.
  const write = (next: ReportLink[]) => {
    setEditing(next)
    // ⚠️ Only COMPLETE rows reach the config document. «Link hinzufügen» necessarily creates an
    // empty row, and the backend refuses a blank title or a non-http URL (schemas.py) — so
    // writing the half-typed row straight into the draft made the whole document invalid. Not
    // just this page: Verwaltung PUTs the WHOLE config, so one empty row 422'd every other
    // Station page too, and the autosave re-sent it every 700 ms until the tab was reloaded.
    // The row stays on screen and keeps its warning («erscheint nicht auf dem Rapport») until
    // it is worth saving; the same predicate `reportLinks()` uses decides that, so what the
    // preview promises and what gets stored cannot drift apart.
    set(['report', 'links'], next.filter((l) => !!l.title?.trim() && isOpenableUrl(l.url ?? '')))
  }
  const patch = (i: number, over: Partial<ReportLink>) =>
    write(rows.map((r, j) => (j === i ? { ...r, ...over } : r)))

  const insertToken = (i: number, token: string) => {
    const row = rows[i]
    const el = urlRef.current
    const url = row?.url ?? ''
    // ⚠️ Matched by link ID, never by row index. The ref is deliberately not cleared on blur
    // (pressing a chip blurs the field, which is the whole point of holding it), so after a row
    // above this one is deleted it still points at a DETACHED textarea — one that, matched by
    // index, would answer to the row that moved up into its place. The token then went in at
    // the caret of a different URL, usually mid-host, and the focus/caret restore silently did
    // nothing because the node was no longer in the document.
    const live = el && el.dataset.id === row?.id && el.isConnected ? el : null
    // nothing focused → append, which is what a chip pressed straight after pasting asks for
    const at = live ? (live.selectionStart ?? url.length) : url.length
    patch(i, { url: `${url.slice(0, at)}{${token}}${url.slice(at)}` })
    if (live) {
      const caret = at + token.length + 2
      requestAnimationFrame(() => { live.focus(); live.setSelectionRange(caret, caret) })
    }
  }

  return (
    <>
      {rows.map((row, i) => {
        const preview = resolveLinkUrl(row.url ?? '', linkTokenValues(SAMPLE_LINK_FACTS))
        return (
          <div className="adm-formlink" key={row.id}>
            <SettingsGroup
              title={row.title?.trim() || appConfig.copy.admin.common.newEntry}
              action={(
                <ConfirmButton
                  className="adm-formlink-x" ariaLabel={C.linkRemove} label={<Icon id="trash" />}
                  question={C.linkRemoveConfirm} danger
                  onConfirm={() => write(rows.filter((_, j) => j !== i))}
                />
              )}
            />
            <SettingRow label={C.linkTitle}>
              <input
                className="adm-input" type="text" value={row.title ?? ''}
                placeholder={C.linkTitlePlaceholder}
                onChange={(e) => patch(i, { title: e.target.value })}
              />
            </SettingRow>
            <SettingRow label={C.linkNote}>
              <input
                className="adm-input" type="text" value={row.note ?? ''}
                placeholder={C.linkNotePlaceholder}
                onChange={(e) => patch(i, { note: e.target.value || null })}
              />
            </SettingRow>
            {/* `span`: a prefill URL is 400 characters whose interesting end is the {…} pairs,
                and the chips that insert them belong directly under it — inside the cell. */}
            <SettingRow label={C.linkUrl} tip={C.linkUrlTip} span>
              <div className="adm-set-col">
                <textarea
                  className="adm-input adm-input-mono adm-formlink-url" rows={3} value={row.url ?? ''}
                  placeholder={C.linkUrlPlaceholder} data-id={row.id}
                  onFocus={(e) => { urlRef.current = e.currentTarget }}
                  onChange={(e) => patch(i, { url: e.target.value })}
                />
                <span className="adm-formlink-tokens" role="group" aria-label={C.linkTokens}>
                  {REPORT_LINK_TOKENS.map((t) => (
                    <button type="button" key={t} className="adm-token" onClick={() => insertToken(i, t)}>
                      {`{${t}}`}
                    </button>
                  ))}
                </span>
              </div>
            </SettingRow>
            {/* What the Rapport will actually open — and, where it would not, WHY.
                ⚠️ This warns on exactly the conditions `reportLinks()` drops a row on, title
                included. Checking only the URL let an admin paste a link, see a correct green
                preview, save without a title, and get a row that never appears on any Rapport
                while Verwaltung said it was fine. */}
            <SettingRow label={C.linkPreview} span>
              {isOpenableUrl(preview) && !!row.title?.trim()
                ? <p className="adm-formlink-preview">{preview}</p>
                : (
                  <p className="adm-hint adm-formlink-warn">
                    {row.title?.trim() ? C.linkPreviewNone : C.linkPreviewNoTitle}
                  </p>
                )}
            </SettingRow>
          </div>
        )
      })}
      <SettingsNote>
        <button
          type="button" className="adm-formlink-add"
          onClick={() => write([...rows, { id: `lnk${Date.now()}-${rows.length}`, title: '', url: '' }])}
        >
          <Icon id="plus" />{C.linkAdd}
        </button>
      </SettingsNote>
    </>
  )
}
