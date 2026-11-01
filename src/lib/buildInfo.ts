// Build stamp, surfaced in the app menu so a tablet in the field can be matched to a known deploy.
// The version is compiled in (vite `define`, it changes only with a release); the commit and the
// build time are read from index.html's `<meta name="kp-build">` (vite.config.ts · buildStampMeta),
// so they never change a chunk's hash. No document (unit tests) reads as 'dev'.
const stamp = typeof document === 'undefined'
  ? ''
  : document.querySelector<HTMLMetaElement>('meta[name="kp-build"]')?.content ?? ''
const [sha = '', time = ''] = stamp.split('@')
export const APP_VERSION = __APP_VERSION__
export const GIT_SHA = sha || 'dev'
export const BUILD_TIME = time

/** Compact, human-readable build label, e.g. "v0.1.0 · 922dba9 · 22.06.2026". */
export function buildLabel(): string {
  const date = new Date(BUILD_TIME)
  // a technical identifier, matched against a deploy by whoever reads it, so ONE spelling on every
  // station whatever its language: dd.mm.yyyy, spelled out rather than borrowed from a locale (it
  // was a literal 'de-CH', which printed exactly this). No lib/format import: this module sits
  // under reportError and swUpdate, at the bottom of the boot graph.
  const p2 = (n: number) => String(n).padStart(2, '0')
  const d = isNaN(date.getTime())
    ? ''
    : `${p2(date.getDate())}.${p2(date.getMonth() + 1)}.${date.getFullYear()}`
  return [`v${APP_VERSION}`, GIT_SHA, d].filter(Boolean).join(' · ')
}
