import { useEffect } from 'react'
import { loadPrefs, applyTheme, resolveTheme, DEVICE_DARK_QUERY } from './prefs'
import type { Coord } from './daylight'

// Keep the day/night theme in step with whatever the colour-scheme preference follows:
// 'auto' tracks local daylight at the incident coordinate — re-checked periodically so the UI
// flips itself at dusk during a long incident, with no action from the EL (the 3am tenet);
// 'device' follows the OS light/dark setting the moment it changes. Explicit 'day'/'night'
// overrides are left untouched. Re-reads the pref on every check so a manual change (or a
// switch back to auto/device) takes effect without extra wiring.
const RECHECK_MS = 10 * 60 * 1000 // 10 min — dusk doesn't need finer granularity

export function useAutoTheme(coord: Coord | null): void {
  const lng = coord?.[0]
  const lat = coord?.[1]
  useEffect(() => {
    const apply = () => {
      const mode = loadPrefs().theme ?? 'auto'
      if (mode !== 'auto' && mode !== 'device') return // manual override wins
      applyTheme(resolveTheme(mode, lng != null && lat != null ? [lng, lat] : null, new Date()))
    }
    apply()
    const id = setInterval(apply, RECHECK_MS)
    const media = window.matchMedia?.(DEVICE_DARK_QUERY)
    media?.addEventListener('change', apply)
    return () => { clearInterval(id); media?.removeEventListener('change', apply) }
  }, [lng, lat])
}
