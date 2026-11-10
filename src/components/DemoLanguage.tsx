import { appConfig } from '../config/appConfig'
import { activeDemoLocale, DEMO_LOCALES, saveDemoLocale, type DemoLocaleId } from '../lib/demoLocale'
import { Segmented } from './Segmented'

/** Switches to the picked language: remembered on this device, then a reload, because the boot
 *  resolves the language once before first paint (lib/demoLocale). */
function pick(id: DemoLocaleId) {
  if (id === activeDemoLocale()) return
  saveDemoLocale(id)
  window.location.reload()
}

/**
 * «Deutsch | Français» for the public demo – on the login card and in Einstellungen › Gerät.
 * The caller shows it only when `isDemoMode()`; a station's language is its deployment's, set in
 * /admin, and never offered here. Each label is in its own language, so a visitor who cannot
 * read the current one still finds theirs.
 */
export function DemoLanguagePicker() {
  return (
    <Segmented<DemoLocaleId> ariaLabel={appConfig.copy.demo.language} value={activeDemoLocale()} onChange={pick}
      options={DEMO_LOCALES.map((l) => ({ value: l.id, label: <span lang={l.id}>{l.label}</span> }))} />
  )
}
