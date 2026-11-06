import { useEffect, useState } from 'react'
import type { LngLat } from '../types'
import { cachedProfile, loadProfile, profileKey, type ProfileResult } from './profile'

/**
 * swisstopo height profile for a path — debounced, and shared by every place that shows one: the
 * Messen tool (which re-fetches while the operator is still setting points), the line editor's
 * Höhenprofil section (which fetches once, when the section is opened) and the pumps a Leitung
 * draws on the map (components/RelayPumpMarkers · LinePumpMarkers). The answers live in
 * lib/profile's cache, so a path asked for twice is fetched once, and a cached one arrives
 * without the debounce.
 *
 * `enabled` false — tool inactive, section collapsed, fewer than two points — clears the result
 * without a request. A null result is not an error: outside Switzerland, or offline, there simply
 * is no profile, and the caller shows «Kein Höhenprofil verfügbar» next to the distance.
 * While the path changes, the LAST profile stays (the chart and the pumps do not blank on a drag).
 */
export function useLineProfile(coords: LngLat[], enabled: boolean, debounceMs = 450): { profile: ProfileResult | null; loading: boolean } {
  const [profile, setProfile] = useState<ProfileResult | null>(null)
  const [loading, setLoading] = useState(false)
  // The effect keys off a value signature rather than the array identity — a caller that derives
  // its coords per render (the selected drawing) would otherwise re-fetch on every render — and
  // reads the path back out of that signature, so the request can never lag the key it ran for.
  const key = enabled && coords.length >= 2 ? profileKey(coords) : ''

  useEffect(() => {
    if (!key) { setProfile(null); setLoading(false); return }
    const path = key.split(' ').map((p) => p.split(',').map(Number) as LngLat)
    const hit = cachedProfile(path)
    if (hit) { setProfile(hit); setLoading(false); return }
    setLoading(true)
    let live = true
    const t = setTimeout(() => {
      void loadProfile(path).then((res) => {
        if (!live) return
        setProfile(res); setLoading(false)
      })
    }, debounceMs)
    return () => { live = false; clearTimeout(t) }
  }, [key, debounceMs])

  return { profile, loading }
}
