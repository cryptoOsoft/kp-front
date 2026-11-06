// Checklists — a third working surface alongside Lage / Plan.
//
// Two checklist kinds with different behaviour:
//  • action / rapport — stateful, checkable task lists (FU phases, Lagerapport).
//    Ticking is timestamped, rides the workspace blob (offline cache + LWW sync),
//    and milestone ticks push a Verlauf row + an audit event.
//  • reference — read-only tactical guidance (the EL playbook), searchable and
//    keyword-indexed so an Einsatz's Stichwort can surface the matching tactics page.
//  • manual — an Anleitung (05.10.2026): read-only numbered steps for ONE device (Hebekissen,
//    Stromerzeuger), with optional warning/hint lines and step images. Never ticked, no state;
//    grouped by `device` in the picker. Its images are prefetched for offline (warmManualImages).
//
// Templates are STATION DATA served from the reference registry (`checklists:<id>` datasets,
// pushed by `admin_checklists` from the private data repo) — never bundled. The loader fetches
// them from /api/reference, caches them in IndexedDB for offline, and falls back to a bundled
// neutral example when a deployment has none. The per-incident tick state lives in the `Saved`
// blob (App.tsx). This file owns the schema, the loader, and the pure logic (progress, search,
// Stichwort match) so it stays unit-testable.

/*
 * **Anleitungen are a checklist kind, not a second pipeline** (05.10.2026). `kind: "manual"`
 * rides `checklists:<id>` + `checklists:<id>:p<N>` images, the same manifest, CLI, admin page and
 * SharePoint folder; format in [`docs/CONFIGURATION.md` §9f](docs/CONFIGURATION.md). It is READ,
 * never ticked: no tick state, no progress, nothing in the Verlauf/Rapport — tickable means
 * `isTickable` (action/rapport) only, so check new kind switches against it. They are shown as
 * DEVICES (`manualGroups`, 19.10.2026): a tile per `device`, a page of chapters, the reader
 * `ManualReader` with «Kapitel k von n» (`chapterOf`) – components/DeviceManuals, used by the
 * Einsatz rail and by the Karte's Checkliste surface (ChecklistLibrary, `searchLibrary`). Step pictures are prefetched into the SW's
 * `checklist-assets` cache when the templates load (`warmManualImages`), because a manual is
 * opened when it is needed — offline, for the first time. A step image the manifest has no
 * asset for is refused by `admin_checklists validate`.
 */

import { apiGet } from './api'
import { readThrough } from './idb'
import genericAction from '../data/checklists/generic-action.json'
import type { FormTrend } from './boardForm'

// --- template schema (matches the bundled JSON) ----------------------------------

/** `visit` = an Objektbesuch checklist (docs/object-visits.md): same distribution, answered on the
 *  Objektbesuche surface only — every INCIDENT surface leaves it out (`loadTemplates`). */
export type ChecklistKind = 'action' | 'reference' | 'rapport' | 'manual' | 'visit'

/** How a `visit` item is answered (docs/object-visits.md · «Checklist templates of kind visit»).
 *  Missing = `check`. Incident checklists ignore it: their items are ticked. */
export type ItemInput = 'check' | 'yesno' | 'text' | 'number' | 'choice' | 'photo'
export type HazardColor = 'red' | 'orange' | 'green' | 'yellow' | 'blue'

export interface Item {
  id: string
  text: string
  /** subtle condition tag, e.g. "bei Grossereignis" — shown, never auto-applied */
  when?: string
  /** deep-link affordance into an existing surface (best-effort wiring in App) */
  action?: 'journal' | 'plan' | 'draw' | null
  /** ticking this pushes a Verlauf row + audit event; non-milestones stay silent */
  milestone?: boolean
  /** `visit` templates: the answer type (absent = `check`) */
  input?: ItemInput
  /** `visit` · `choice`: the options, by stable id */
  options?: { id: string; label: string }[]
  /** `visit` · `number`: the unit shown after the field («Stk.») */
  unit?: string
  /** `visit`: an unanswered required item asks «trotzdem abschliessen?» — nothing else */
  required?: boolean
}

export interface Branch {
  id: string
  title: string
  items: Item[]
}

export interface Phase {
  id: string
  title: string
  role?: string
  note?: string
  /** a `problems` template: the Bereich the phase's problems land in on the Tafel – the id of a
   *  box of the Tafel's problem quad and an option of its problem table's `area` column
   *  (docs/CONFIGURATION.md §9f, lib/problemLink). Absent: on the problem table only. */
  area?: string
  items: Item[]
  /** mutually-exclusive role branches (e.g. FU "ohne C-FU" vs "mit C-FU") */
  branches?: Branch[]
}

export type ContentBlock =
  | { type: 'heading'; text: string }
  | { type: 'bullet'; text: string; emphasis?: 'red' | 'bold'; level?: number }
  | { type: 'note'; text: string }
  | { type: 'image'; page: number; caption?: string }
  /** tabular reference data (Gewichte/Flussraten, Aufgebotskonzept) — rows of cells,
   *  optional header row. Kept as strings; the renderer lays them out as a real table. */
  | { type: 'table'; head?: string[]; rows: string[][]; caption?: string }

export interface RefEntry {
  id: string
  title: string
  keywords: string[]
  /** words matched against the Einsatz title (its Stichwort) for the rail's «Passend» group –
   *  whole words or a word's ending («Kellerbrand» → BRAND), never inside a word (matchEntries) */
  diveraKeywords?: string[]
  hazardColor?: HazardColor
  content: ContentBlock[]
}

/** One picture on an Anleitung step: an asset page (`checklists:<template>:p<page>`) — a photo or a
 *  page of the device's PDF manual exported as an image. */
export interface ManualImage { page: number; caption?: string }

/** One numbered step of an Anleitung. `warning` is the red line (what hurts people or the
 *  device), `hint` the quiet one (a tip). Both optional. */
export interface ManualStep {
  text: string
  /** sub-points of the step, in order («Becken 1 – grober Schmutz entfernen», …) — the second
   *  list level of the station's Word Anleitungen, kept as such rather than flattened into steps */
  details?: string[]
  warning?: string
  hint?: string
  images?: ManualImage[]
}

export interface ChecklistTemplate {
  id: string
  kind: ChecklistKind
  title: string
  subtitle?: string
  version: number
  source: string
  /** rail sort order, stamped from the manifest by admin_checklists — the station's single
   *  place to reorder checklists. Absent → sorts last (then action/rapport before reference). */
  order?: number
  /** action templates: a tick means «this is a problem» (Problemerfassung, 05.11.2026) – the row
   *  then offers a Tendenz ➚ = ➘, and every ticked item stands on the Tafel's problem surfaces
   *  (lib/problemLink). Absent = an ordinary task list. */
  problems?: boolean
  /** action / rapport templates */
  phases?: Phase[]
  /** reference templates */
  entries?: RefEntry[]
  /** manual templates: the device the Anleitung is for — the picker groups by it */
  device?: string
  /** manual templates: when the content was last checked («Stand»), `YYYY-MM-DD` */
  updated?: string
  /** manual templates: extra search words (model names, «Generator» for a Stromerzeuger) */
  keywords?: string[]
  /** manual templates */
  steps?: ManualStep[]
  /** manual templates: the asset page the device card and page show (a step picture or a photo
   *  no step shows) – absent = the first step picture (`deviceCover`) */
  cover?: number
  /** visit templates: where they may be used — at a catalogue object, at a place (a pin or an
   *  address without one), or both. Absent = `['object']` (docs/object-visits.md). */
  targets?: ('object' | 'location')[]
  /** NOT in the JSON: stamped by `loadTemplates` from the registry list – each asset page's
   *  `current_version`, which makes its URL a fixed address (`checklistAssetUrl`) */
  assetVersions?: Record<number, number>
}

// --- per-incident tick state (lives in the Saved workspace blob) ------------------

/** One tick: presence in `ticks` = checked. Records when + who. */
export interface Tick { t: string; by?: string }

export interface TemplateState {
  /** itemId → tick. Absence = unchecked. */
  ticks: Record<string, Tick>
  /** phaseId → chosen branch id (ohne / mit C-FU) */
  activeBranch?: Record<string, string>
  /** a `problems` template: itemId → the problem's Tendenz (the Tafel's own ➚ = ➘), written from the checklist row and from
   *  the Tafel alike, one value in one place. Beside the ticks, not on them (staging review
   *  06.11.2026, owner: un-ticking must not drop the Tendenz): an un-tick leaves it, so a re-tick
   *  – or ↶ – brings it back. Read only for a ticked item (useChecklistActions writes it only
   *  then); absent = no trend. */
  trends?: Record<string, FormTrend>
}

/** templateId → its tick state. Rides the existing offline-cache / sync / LWW. */
export type ChecklistState = Record<string, TemplateState>

// --- loader ----------------------------------------------------------------------

const CACHE_KEY = 'kp-front-checklists'

// Neutral, product-default fallback (bundled, like demoIncident.ts) — shown only when a
// deployment has no checklist datasets yet, or when offline with an empty cache. It keeps the
// Checkliste surface teaching-not-empty out of the box; real station checklists override it the
// moment `admin_checklists` populates the registry.
const FALLBACK: ChecklistTemplate[] = [genericAction as ChecklistTemplate]

function isTemplate(v: unknown): v is ChecklistTemplate {
  if (!v || typeof v !== 'object') return false
  const t = v as Record<string, unknown>
  return typeof t.id === 'string' && typeof t.kind === 'string' && typeof t.title === 'string'
}

/** A `checklists:` reference dataset id is a template (`checklists:fu-aktion`) unless it carries
 *  a further colon segment, which marks a diagram asset (`checklists:el-playbook:p12`). */
export function isChecklistTemplateId(id: string): boolean {
  return id.startsWith('checklists:') && !id.slice('checklists:'.length).includes(':')
}

/** what an asset URL needs of its template */
export type AssetOwner = Pick<ChecklistTemplate, 'id' | 'assetVersions'>

/**
 * Registry URL of a template's image asset (a step picture, a cover, a playbook diagram).
 *
 * Carries the asset's version when the template knows it (`assetVersions`, review round 2,
 * 19.10.2026): the server answers `?v=` = the current version as immutable, so the picture is
 * fetched once and then painted from memory on every open. Without it (`no-cache`, an address
 * whose bytes may change) every mount on the iPhone asked the service worker and the server
 * again, and the device cards popped in on each open of the Checkliste surface. A replaced
 * picture gets a new version, so a new address – nothing stale.
 */
export function checklistAssetUrl(template: AssetOwner, page: number): string {
  const v = template.assetVersions?.[page]
  return `/api/reference/checklists:${template.id}:p${page}${v ? `?v=${v}` : ''}`
}

/** each template with its asset pages' versions, from the registry list (`assetVersions`) */
function stampAssetVersions(templates: ChecklistTemplate[], list: { id: string; current_version?: number }[]): ChecklistTemplate[] {
  const byTemplate = new Map<string, Record<number, number>>()
  for (const d of list) {
    const m = /^checklists:([^:]+):p(\d+)$/.exec(d.id)
    if (!m || !d.current_version) continue
    byTemplate.set(m[1], { ...byTemplate.get(m[1]), [Number(m[2])]: d.current_version })
  }
  return templates.map((t) => (byTemplate.has(t.id) ? { ...t, assetVersions: byTemplate.get(t.id) } : t))
}

const rankKind = (k: ChecklistKind) => (k === 'manual' ? 2 : k === 'reference' ? 1 : 0)
// Sort by the config-driven `order` (from the manifest), then action/rapport before reference as
// a tiebreak for templates without an explicit order. The rail groups by kind, so this order
// governs both the Aufgaben list and the sequence of reference groups (Taktik, Grundlagen, …).
const sortTemplates = (ts: ChecklistTemplate[]) =>
  [...ts].sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || rankKind(a.kind) - rankKind(b.kind))

/** An empty list is no list: a registry with no `checklists:` datasets — and equally a cache
 *  entry that lost its contents — must fall through to the prior cache / bundled example. */
const hasTemplates = (v: unknown): v is ChecklistTemplate[] => Array.isArray(v) && v.length > 0

/** All checklist templates for this deployment, sorted action/rapport first then reference.
 *  Fetches the `checklists:` datasets from the reference registry, caches them for offline, and
 *  falls back to the last cache then the bundled neutral example. NEVER throws — a failed fetch
 *  (offline, fresh deployment) must never leave the Checkliste surface unusable, which is why
 *  this one overrides `readThrough`'s default «only silence falls back». */
export async function loadTemplates(): Promise<ChecklistTemplate[]> {
  const { value } = await readThrough<ChecklistTemplate[]>(
    CACHE_KEY,
    async () => {
      const list = await apiGet<{ id: string; current_version?: number }[]>('/api/reference')
      const ids = (list ?? []).filter((d) => isChecklistTemplateId(d.id)).map((d) => d.id)
      const fetched = await Promise.all(
        ids.map((id) =>
          apiGet<unknown>(`/api/reference/${id}`)
            .then((j) => (isTemplate(j) ? j : null))
            .catch(() => null),
        ),
      )
      // ⚠️ An Objektbesuch checklist is not an Einsatz checklist: it shares the distribution
      // (`checklists:<id>`), never the surface (docs/object-visits.md). Left out HERE, before the
      // cache is written, so no incident surface can ever list one.
      return stampAssetVersions(sortTemplates(fetched.filter((t): t is ChecklistTemplate => t !== null && t.kind !== 'visit')), list ?? [])
    },
    { validate: hasTemplates, fallback: () => FALLBACK, shouldFallback: () => true },
  )
  return value.filter((t) => t.kind !== 'visit')
}

/** The kinds that are ticked: everything that is neither read (reference, manual) nor a visit. */
export const isTickable = (t: ChecklistTemplate) => t.kind === 'action' || t.kind === 'rapport'

/** A template whose ticks are problems for the Tafel (`problems: true` on an action list). */
export const isProblemTemplate = (t: ChecklistTemplate) => t.kind === 'action' && t.problems === true

/** how long a warmed list is handed out before a newer one is asked for behind it */
export const TEMPLATES_FRESH_MS = 5 * 60_000
let warm: { at: number; list: Promise<ChecklistTemplate[]> } | null = null

/**
 * The templates WITHOUT the wait (20.09.2026). `loadTemplates` is network-first, and it was only
 * ever called when the Checkliste surface mounted – so the first thing the surface did, every
 * time it was opened, was wait for the registry; and an Einsatz whose Checkliste tab was first
 * opened offline had never cached anything at all. The workspace now warms this the moment an
 * Einsatz opens, and the surface reads what is already there.
 *
 * `list` is the answer in hand (the running or finished load – it resolves at once when warmed).
 * `newer` is set only when that answer is older than TEMPLATES_FRESH_MS: a background reload the
 * caller may apply when it lands, so a station that corrected a list mid-Einsatz still sees it.
 */
export function warmTemplates(now = Date.now()): { list: Promise<ChecklistTemplate[]>; newer: Promise<ChecklistTemplate[]> | null } {
  if (!warm) { warm = { at: now, list: loadTemplates() }; void warm.list.then(warmManualImages); return { list: warm.list, newer: null } }
  if (now - warm.at <= TEMPLATES_FRESH_MS) return { list: warm.list, newer: null }
  const stale = warm.list
  warm = { at: now, list: loadTemplates() }
  void warm.list.then(warmManualImages)
  return { list: stale, newer: warm.list }
}
/** test seam */
export function resetWarmTemplates() { warm = null }

/** Every image URL the read-only kinds show: an Anleitung's cover and step images and a
 *  reference entry's diagrams. The templates are offline-cached as JSON; these are what
 *  `warmManualImages` fills. */
export function checklistImageUrls(templates: ChecklistTemplate[]): string[] {
  const urls = new Set<string>()
  for (const t of templates) {
    if (t.kind === 'manual' && t.cover !== undefined) urls.add(checklistAssetUrl(t, t.cover))
    for (const step of t.kind === 'manual' ? t.steps ?? [] : []) {
      for (const img of step.images ?? []) urls.add(checklistAssetUrl(t, img.page))
    }
    for (const e of t.kind === 'reference' ? t.entries ?? [] : []) {
      for (const b of e.content ?? []) if (b.type === 'image') urls.add(checklistAssetUrl(t, b.page))
    }
  }
  return [...urls]
}

const imagesStarted = new Set<string>()

/**
 * Fetch every Anleitung step image (and playbook diagram) once in the background, so an
 * Anleitung opened for the first time in a cellar shows its pictures (05.10.2026). The JSON was
 * already offline (`loadTemplates`); the pictures were only cached once LOOKED at, which is the
 * wrong moment for a manual: you read it when you need it, not beforehand.
 *
 * The fetches only pass through the service worker, whose `checklist-assets` route keeps them
 * (vite.config) — same pattern as lib/planTilePrefetch. No controlling worker (dev server, first
 * visit), offline, or «Datensparmodus» → nothing fetched. One at a time; each URL once a session.
 */
export async function warmManualImages(templates: ChecklistTemplate[]): Promise<void> {
  if (typeof navigator === 'undefined' || typeof caches === 'undefined') return
  if (!navigator.serviceWorker?.controller) return
  if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true) return
  for (const url of checklistImageUrls(templates)) {
    if (imagesStarted.has(url)) continue
    if (!navigator.onLine) return
    imagesStarted.add(url)
    try {
      if (await caches.match(url)) continue
      await fetch(url, { credentials: 'same-origin' }).then((r) => r.arrayBuffer())
    } catch {
      imagesStarted.delete(url) // try again on the next warm
    }
  }
}
/** test seam */
export function resetWarmManualImages() { imagesStarted.clear() }

// --- pure logic (unit-tested) ----------------------------------------------------

/** Items of a phase that are live given the chosen branch (if any). When a phase
 *  declares branches, only the selected branch's items count (plus the phase's own
 *  base items); with no selection yet, only the base items count. */
export function phaseItems(phase: Phase, activeBranchId?: string): Item[] {
  const base = phase.items ?? []
  if (!phase.branches?.length) return base
  const branch = phase.branches.find((b) => b.id === activeBranchId)
  return branch ? [...base, ...branch.items] : base
}

export interface Progress { done: number; total: number; pct: number }

function progressOf(items: Item[], ticks: Record<string, Tick>): Progress {
  const total = items.length
  const done = items.reduce((n, it) => n + (ticks[it.id] ? 1 : 0), 0)
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 }
}

/** Per-phase progress, honouring the active branch. */
export function phaseProgress(phase: Phase, state: TemplateState): Progress {
  return progressOf(phaseItems(phase, state.activeBranch?.[phase.id]), state.ticks ?? {})
}

/** How many items a checklist shows when READ (ChecklistReader, «15 Punkte»): each phase with
 *  the variant `picked` for it, or its first one. */
export function readingPoints(template: ChecklistTemplate, picked: Record<string, string> = {}): number {
  return (template.phases ?? []).reduce((n, p) => n + phaseItems(p, picked[p.id] ?? p.branches?.[0]?.id).length, 0)
}

/** Overall progress across all phases (live items only). */
export function templateProgress(template: ChecklistTemplate, state: TemplateState): Progress {
  const phases = template.phases ?? []
  let done = 0
  let total = 0
  for (const p of phases) {
    const pr = phaseProgress(p, state)
    done += pr.done
    total += pr.total
  }
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 }
}

const norm = (s: string) => s.toLowerCase().trim()

/** Filter reference entries by a free-text query over title + keywords. Empty
 *  query returns all entries unchanged. */
export function searchEntries(entries: RefEntry[], query: string): RefEntry[] {
  const q = norm(query)
  if (!q) return entries
  return entries.filter((e) => {
    if (norm(e.title).includes(q)) return true
    return (e.keywords ?? []).some((k) => norm(k).includes(q))
  })
}

/** All reference entries across every reference template, flattened. */
export function allEntries(templates: ChecklistTemplate[]): RefEntry[] {
  return templates.filter((t) => t.kind === 'reference').flatMap((t) => t.entries ?? [])
}

/** a text's words, lowercase: «E-Auto Brand, Schlossgasse 9» → e · auto · brand · schlossgasse · 9 */
const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/** a street name: «Hauptstrasse», «Bahnhofstr.», «Schlossgasse», «Kirchrain» … */
const STREET = /(strasse|straße|str|gasse|weg|allee|rain|ring|platz)$/
const HOUSE_NO = /^\d+[a-z]?$/

/** A title's words, each with whether it may match a keyword by its ENDING («Kellerbrand» →
 *  brand). Not a street name (strasse/«Hauptstrasse»; a word before a house number is one too),
 *  and not a word that is a keyword itself: «Zimmerbrand» is the hit ZIMMERBRAND, not also every
 *  page that lists BRAND. `keywords`: every one-word keyword of the station. */
const titleWords = (title: string, keywords: Set<string>) => {
  const ws = words(title)
  return ws.map((w, i) => ({ w, byEnding: !keywords.has(w) && !STREET.test(w) && !HOUSE_NO.test(ws[i + 1] ?? '') }))
}
type TitleWord = ReturnType<typeof titleWords>[number]

/** whether `kw` (its words) stands in the title: a one-word keyword as a word or – 5+ letters
 *  only (eis/«Kreis», tier/«Quartier», bahn/«Autobahn») – a word's ending; a longer one as whole
 *  words in a row («pkw brand» in «PKW Brand A2») */
const hasKeyword = (hay: TitleWord[], kw: string[]) =>
  kw.length === 1
    ? hay.some(({ w, byEnding }) => w === kw[0] || (byEnding && kw[0].length >= 5 && w.endsWith(kw[0])))
    : kw.length > 1 && hay.some((_, i) => kw.every((k, j) => hay[i + j]?.w === k))

/**
 * The Stichworte for an Einsatz title – the rail's «Passend» group (ChecklistsView), most
 * specific first. A title with none of the `diveraKeywords` gets none.
 *
 * ⚠️ A list, not a single best match (31.08.). One Stichwort routinely has several answers:
 * «VU Strasse» is Verkehrsunfall AND E-Autobrand AND Ölspur auf Strasse, and which of the three
 * the Einsatz turns out to need is not knowable from the alarm text.
 *
 * ⚠️ The TITLE only, in whole words or word endings (sweep 23.10.2026, F.6). It read
 * `title + type`, but `type` is the Kategorie («Brandbekämpfung»), so every fire got four
 * «brand» pages whatever its title said; and a substring hit «gas» in «Schlossgasse». A title
 * word that ENDS in a keyword counts (owner: «Kellerbrand» → brand), a keyword inside a word
 * does not; the endings are guarded against short keywords, street names and words that are a
 * keyword themselves (titleWords).
 *
 * Ranked by the longest keyword hit (the most specific), then by how many keywords hit, then in
 * the station's own order – the Taktik list's (templates are sorted by the manifest), so a tie
 * on a broad «BRAND» leads with «Brand (allgemein)», not alphabetically with «Bauernhof».
 * `limit` keeps the group from turning into a second list.
 */
export function matchEntries(templates: ChecklistTemplate[], title: string | undefined, limit = 4): RefEntry[] {
  const entries = allEntries(templates)
  const oneWord = entries.flatMap((e) => (e.diveraKeywords ?? []).map(words)).filter((k) => k.length === 1)
  const hay = titleWords(title ?? '', new Set(oneWord.map(([k]) => k)))
  if (!hay.length) return []
  const hits: { entry: RefEntry; at: number; len: number; n: number }[] = []
  entries.forEach((entry, at) => {
    const found = (entry.diveraKeywords ?? []).filter((k) => hasKeyword(hay, words(k)))
    if (found.length) hits.push({ entry, at, len: Math.max(...found.map((k) => norm(k).length)), n: found.length })
  })
  hits.sort((a, b) => b.len - a.len || b.n - a.n || a.at - b.at)
  return hits.slice(0, limit).map((h) => h.entry)
}

// --- Anleitungen (kind: manual) ------------------------------------------------------

export interface DeviceGroup { device: string; manuals: ChecklistTemplate[] }

/** The Anleitungen matching a free-text query over title, device and keywords, grouped by
 *  device. Devices AND their chapters keep the template order (the manifest's `order`, 19.10.2026
 *  – it was by name), so the station decides both which device leads and that «Aufbau» comes
 *  before «Abbau». A device's chapters are numbered in this order (DevicePage). */
export function manualGroups(templates: ChecklistTemplate[], query: string): DeviceGroup[] {
  const q = norm(query)
  const groups = new Map<string, ChecklistTemplate[]>()
  for (const t of templates) {
    if (t.kind !== 'manual') continue
    const device = deviceOf(t)
    if (q && ![t.title, device, t.subtitle ?? '', ...(t.keywords ?? [])].some((w) => norm(w).includes(q))) continue
    groups.set(device, [...(groups.get(device) ?? []), t])
  }
  return [...groups.entries()].map(([device, manuals]) => ({ device, manuals }))
}

/** the device an Anleitung belongs to – its own title when the manifest names none */
export const deviceOf = (t: ChecklistTemplate) => (t.device ?? '').trim() || t.title

/** The device's picture for its card, row and page: the `cover` of the first chapter that names
 *  one (review round 2, 19.10.2026 – a photo the Feldweibel picks), otherwise the first step
 *  image of its chapters, in chapter order. null = none has a picture. */
export function deviceCover(group: DeviceGroup): string | null {
  const covered = group.manuals.find((t) => t.cover !== undefined)
  if (covered?.cover !== undefined) return checklistAssetUrl(covered, covered.cover)
  for (const t of group.manuals) {
    const img = (t.steps ?? []).flatMap((s) => s.images ?? [])[0]
    if (img) return checklistAssetUrl(t, img.page)
  }
  return null
}

/** `2026-09-14` → `14.09.2026`; anything else verbatim (the server only lets dates through). */
export const fmtDay = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso
}

/** The newest «Stand» among a device's chapters (`YYYY-MM-DD`), or null. */
export function deviceUpdated(group: DeviceGroup): string | null {
  return group.manuals.reduce<string | null>((max, t) => (t.updated && (!max || t.updated > max) ? t.updated : max), null)
}

/** Where an Anleitung stands among its device's chapters – «Kapitel k von n» and the neighbours
 *  the reader's foot offers. null for a device with a single Anleitung: it has no chapters. */
export function chapterOf(groups: DeviceGroup[], manualId: string):
  { group: DeviceGroup; k: number; n: number; prev: ChecklistTemplate | null; next: ChecklistTemplate | null } | null {
  for (const group of groups) {
    const i = group.manuals.findIndex((t) => t.id === manualId)
    if (i < 0) continue
    if (group.manuals.length < 2) return null
    return { group, k: i + 1, n: group.manuals.length, prev: group.manuals[i - 1] ?? null, next: group.manuals[i + 1] ?? null }
  }
  return null
}

// --- one search over everything (the Karte's Checkliste surface, ChecklistLibrary) ----------

/** Why a hit matched when its title does not say so: one of its keywords, or a line of its
 *  text (a step, a checklist item, a Stichwort's paragraph). null = the title or device did. */
export type HitReason = { keyword: string } | { text: string } | null
export interface LibraryHit<T> { item: T; why: HitReason }
export interface LibraryHits {
  manuals: LibraryHit<ChecklistTemplate>[]
  checklists: LibraryHit<ChecklistTemplate>[]
  /** per reference template (Taktik · Stichworte, Grundlagen · Infos), in template order */
  references: { template: ChecklistTemplate; entries: LibraryHit<RefEntry>[] }[]
}

/** first of `texts` containing q, as a reason */
const firstText = (texts: (string | undefined)[], q: string): HitReason => {
  const hit = texts.find((t) => t && norm(t).includes(q))
  return hit ? { text: hit } : null
}
const blockText = (b: ContentBlock): string[] =>
  b.type === 'table' ? [...(b.head ?? []), ...b.rows.flat(), b.caption ?? ''] : b.type === 'image' ? [b.caption ?? ''] : [b.text]

/** whether `t` matches q, and why: the names first, then keywords, then the body */
function reason(names: string[], keywords: string[], body: () => (string | undefined)[], q: string): HitReason | false {
  if (names.some((n) => norm(n).includes(q))) return null
  const kw = keywords.find((k) => norm(k).includes(q))
  if (kw) return { keyword: kw }
  return firstText(body(), q) ?? false
}

/**
 * ONE search over everything the library shows (19.10.2026, owner: «Eine Suche über alles –
 * Gerät, Titel, Stichworte, Schritte»): an Anleitung by its title, device, keywords and step
 * text; a checklist by its title, phases and items; a Stichwort by its title, keywords and
 * content. Each hit says why it matched when its name does not. Empty query → nothing (the
 * surface shows its home instead). The Einsatz rail keeps its narrower title/keyword search.
 */
export function searchLibrary(templates: ChecklistTemplate[], query: string): LibraryHits {
  const q = norm(query)
  const out: LibraryHits = { manuals: [], checklists: [], references: [] }
  if (!q) return out
  for (const t of templates) {
    if (t.kind === 'manual') {
      const why = reason([t.title, deviceOf(t)], t.keywords ?? [], () =>
        [t.subtitle, ...(t.steps ?? []).flatMap((s) => [s.text, ...(s.details ?? []), s.warning, s.hint])], q)
      if (why !== false) out.manuals.push({ item: t, why })
    } else if (isTickable(t)) {
      const why = reason([t.title], [], () =>
        [t.subtitle, ...(t.phases ?? []).flatMap((p) => [p.title, ...[...p.items, ...(p.branches ?? []).flatMap((b) => b.items)].map((i) => i.text)])], q)
      if (why !== false) out.checklists.push({ item: t, why })
    } else if (t.kind === 'reference') {
      const entries = (t.entries ?? []).flatMap((e) => {
        const why = reason([e.title], e.keywords ?? [], () => (e.content ?? []).flatMap(blockText), q)
        return why === false ? [] : [{ item: e, why }]
      })
      if (entries.length) out.references.push({ template: t, entries })
    }
  }
  return out
}

/** A line of text cut to about `len` characters around the first match of q, with «…» where it
 *  was cut – the reason a search hit shows under its title. */
export function snippet(text: string, query: string, len = 48): string {
  const q = norm(query)
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= len) return t
  const at = Math.max(0, norm(t).indexOf(q))
  let start = Math.max(0, Math.min(at - Math.floor((len - q.length) / 2), t.length - len))
  let end = start + len
  // whole words only: start after a space, end before one – never further in than the match
  if (start > 0) { const sp = t.indexOf(' ', start); if (sp >= 0 && sp < at) start = sp + 1 }
  if (end < t.length) { const sp = t.lastIndexOf(' ', end); if (sp > at + q.length) end = sp }
  return `${start > 0 ? '…' : ''}${t.slice(start, end).trim()}${end < t.length ? '…' : ''}`
}
