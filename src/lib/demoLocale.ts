// The public demo's language switch – the ONE exception to «locale is per deployment».
//
// A real station runs in the language its deployment config names (`identity.locale`, set in
// /admin). The demo is one German instance shown to visitors from every region, so a visitor may
// pick German or French for THIS device: the login card and Einstellungen › Gerät offer the
// switch, the choice sits in localStorage, and the page reloads so the boot resolves it before
// first paint (main.tsx · applyLocale(bootLocale(…))). Only the interface changes – the demo data
// (Musterdorf, Checklisten, Tafel) and everything the server writes (Rapport-PDF, Excel) stay
// German. Outside demo mode nothing here is read or shown.

import { getLocaleId } from '../config/copy'
import { isDemoMode } from './deploymentConfig'

const KEY = 'kp-demo-locale'

/** The languages the demo offers, labelled in their own language like the admin's picker
 *  (config/copy · AVAILABLE_LOCALES). */
export const DEMO_LOCALES = [
  { id: 'de-CH', label: 'Deutsch' },
  { id: 'fr', label: 'Français' },
] as const

export type DemoLocaleId = (typeof DEMO_LOCALES)[number]['id']

const isDemoLocale = (v: string | null): v is DemoLocaleId => DEMO_LOCALES.some((l) => l.id === v)

/** The language this device picked for the demo, or null when it never picked one (or storage
 *  is refused – private mode, cleared site data). */
export function readDemoLocale(): DemoLocaleId | null {
  try {
    const v = localStorage.getItem(KEY)
    return isDemoLocale(v) ? v : null
  } catch {
    return null
  }
}

/** Remembers the pick; the caller reloads so the boot applies it everywhere at once. */
export function saveDemoLocale(id: DemoLocaleId): void {
  try { localStorage.setItem(KEY, id) } catch { /* storage refused – the reload stays German */ }
}

/** The locale the boot applies: in demo mode the device's pick wins over the deployment's
 *  language; every other installation keeps exactly its configured `identity.locale`. */
export function bootLocale(identity: { locale?: string | null; demoMode?: boolean | null } | undefined) {
  if (identity?.demoMode === true) return readDemoLocale() ?? identity.locale
  return identity?.locale
}

/** Which of the demo's languages is on screen now (whatever the boot applied). */
export function activeDemoLocale(): DemoLocaleId {
  return getLocaleId().toLowerCase().startsWith('fr') ? 'fr' : 'de-CH'
}

/** True while the demo runs in a translation – the moment to say that its fire-service terms
 *  have not been checked yet (`copy.demo.unverified`). */
export function demoInTranslation(): boolean {
  return isDemoMode() && activeDemoLocale() !== 'de-CH'
}
