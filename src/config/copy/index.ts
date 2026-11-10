// Multilingual UI copy (i18n) — the active locale's string catalogue.
//
// Why this exists: domain language is German, but a single kp-front build serves many
// deployments, and per-station + per-operator language is a real need (Swiss-French/Italian
// regions, mixed crews). All user-facing strings already live in one place; this layer turns
// that single German catalogue into a locale-selectable one WITHOUT touching the ~340
// `appConfig.copy.x` read sites: `appConfig.copy` is a getter that returns `getCopy()`.
//
// Design (deliberately dependency-light, offline-first, no i18n library):
//   • German (`de`) is the canonical base and the source of the `Copy` type.
//   • Every other locale is a `Localizable<Copy>` — a deep-partial whose leaves are widened
//     to plain string/number, so a locale only translates what it wants; anything missing
//     deep-merges back to the German string. A half-translated locale is always complete.
//   • Locale is a PER-DEPLOYMENT setting (one brigade = one language), resolved ONCE at boot
//     from the deployment config's `identity.locale`, falling back to 'de-CH'. main.tsx calls
//     applyLocale() after the deployment config loads. It is set in the admin config editor
//     (Station › Identität › Sprache), not per device. The one exception is the public demo,
//     where a device may pick Deutsch or Français before boot resolves it (lib/demoLocale).
//
// To add a language: create ./xx.ts exporting `Localizable<Copy>`, register it in LOCALES,
// and add it to AVAILABLE_LOCALES below. Nothing else changes.

import { de, type Copy } from './de'

export type { Copy } from './de'

/**
 * A translation overlay for `Copy`: same shape, but every string/number/boolean leaf is
 * WIDENED to its base type (so 'Loading…' is assignable where German has the literal
 * 'Lade …'), arrays are replaceable wholesale, functions keep their exact signature, and
 * every key is optional (untranslated keys fall back to German via deepMerge).
 */
export type Localizable<T> =
  T extends (...args: never[]) => unknown ? T
  : T extends string ? string
  : T extends number ? number
  : T extends boolean ? boolean
  : T extends readonly (infer U)[] ? Localizable<U>[]
  : T extends object ? { [K in keyof T]?: Localizable<T[K]> }
  : T

/** National default — the fallback when the deployment doesn't configure a language. */
const DEFAULT_LOCALE = 'de-CH'

/** Registry of translation overlays, keyed by their normalized base tag (see normalizeKey).
 *  `de` is intentionally absent — it IS the base everything merges over. Overlays are
 *  DYNAMIC imports: locale is a per-deployment setting resolved once at boot, so a German
 *  deployment (the overwhelming majority) never downloads or parses the other three
 *  catalogues (~230 KB gzip / ~670 KB of parse they used to cost every single boot). The
 *  chunks are service-worker-precached like the rest of the shell, so a French station's
 *  overlay loads offline too. */
const LOCALE_LOADERS: Record<string, () => Promise<Localizable<Copy>>> = {
  en: () => import('./en').then((m) => m.en),
  fr: () => import('./fr').then((m) => m.fr),
  it: () => import('./it').then((m) => m.it),
}

/** Overlays that already arrived — applyLocale resolves synchronously from here after the
 *  first load, and the boot race guard reads it. */
const loadedOverlays: Record<string, Localizable<Copy>> = {}

/** Languages offered in the admin config editor's Sprache picker (label shown in its own
 *  language). The `id` is stored verbatim in `identity.locale` and resolved via normalizeKey. */
export const AVAILABLE_LOCALES: { id: string; label: string }[] = [
  { id: 'de-CH', label: 'Deutsch' },
  { id: 'en', label: 'English' },
  { id: 'fr', label: 'Français' },
  { id: 'it', label: 'Italiano' },
]

/** A locale tag → registry key: take the primary subtag, lowercase. 'fr-CH' → 'fr',
 *  'de-CH'/'de' → 'de', 'en-US' → 'en'. Unknown tags fall through to the German base. */
function normalizeKey(tag: string | null | undefined): string {
  return (tag ?? '').split('-')[0]!.toLowerCase()
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Recursively overlay `over` onto `base`: plain objects merge key-by-key; primitives,
 *  arrays and functions are replaced wholesale (an `undefined` override keeps the base).
 *  Result is structurally `Copy` because `base` (German) is complete. */
function deepMerge<T>(base: T, over: unknown): T {
  if (over === undefined) return base
  if (!isPlainObject(base) || !isPlainObject(over)) return over as T
  const out: Record<string, unknown> = { ...base }
  for (const k of Object.keys(over)) {
    out[k] = deepMerge((base as Record<string, unknown>)[k], over[k])
  }
  return out as T
}

/** Resolve the active locale id: the deployment's configured language, else the national
 *  default. */
function resolveLocaleId(deploymentLocale?: string | null): string {
  return deploymentLocale || DEFAULT_LOCALE
}

// Module-load default is German; the deployment config loads async (after the module graph),
// so main.tsx AWAITS applyLocale() with the resolved locale before first render (budgeted —
// see the boot sequence) — the getter is therefore correct by the time anything renders.
let activeId = resolveLocaleId()
let active: Copy = de

/** Re-resolve and rebuild the active catalogue from the deployment locale. Awaited once at
 *  boot (main.tsx) after the deployment config loads; German (and any already-loaded
 *  overlay) resolves synchronously. If the overlay chunk cannot be loaded (a network race
 *  the precache didn't cover), the app silently stays German — a complete catalogue in the
 *  wrong language, never a half-rendered one or a blocked boot. */
export async function applyLocale(deploymentLocale?: string | null): Promise<void> {
  activeId = resolveLocaleId(deploymentLocale)
  const key = normalizeKey(activeId)
  const load = LOCALE_LOADERS[key]
  if (!load) { active = de; return } // German or unknown tag — the base, zero cost
  let overlay = loadedOverlays[key]
  if (!overlay) {
    try {
      overlay = loadedOverlays[key] = await load()
    } catch {
      active = de
      return
    }
    // a slower load must not clobber a locale applied while it was in flight
    if (normalizeKey(activeId) !== key) return
  }
  active = deepMerge(de, overlay)
}

/** The active locale's full string catalogue. `appConfig.copy` delegates here, so every
 *  read site is localized; returns the same reference until applyLocale() rebuilds it. */
export function getCopy(): Copy {
  return active
}

/** The active locale id as resolved (e.g. 'de-CH', 'en'), for the picker's current-state. */
export function getLocaleId(): string {
  return activeId
}
