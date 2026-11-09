/**
 * «An account is known on this page» — after the boot probe, a login, the demo's auto-login, a
 * link page's own `/me`. main.tsx registers the station plan calibration here (its route needs
 * a session); lib/auth · AuthProvider fires it.
 *
 * A callback in a module of its own, not an import from lib/auth: that module is in the entry
 * chunk, and importing the calibration from it pulled the whole drawing graph in with it
 * (+25 % on the bundle budget).
 */
let listener: (() => void) | null = null

export function onAccountKnown(fn: () => void): void {
  listener = fn
}

export function notifyAccountKnown(): void {
  listener?.()
}
