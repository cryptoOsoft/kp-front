import { useEffect, useState } from 'react'
import { appConfig } from '../config/appConfig'
import { applyUpdateNow, onUpdateAvailable } from '../lib/swUpdate'
import { canApplyInPlace } from '../lib/updatePolicy'
import { getInstallPlatform } from '../lib/installPrompt'
import { useMeldung } from '../lib/useMeldung'

// Non-blocking "a new build is ready" message. registerType is 'prompt', so a fresh deploy
// installs and WAITS instead of reloading the app mid-incident; updates found at boot apply
// silently (swUpdate), so this only appears for deploys that land while the operator is already
// working. It ANNOUNCES only: the new version becomes active on the next app start (full close +
// reopen) — the in-place «Neu laden» was removed because skipWaiting activation is unreliable on
// iOS standalone, while a restart always works (decision 2026-07-09). Dismissible, and it
// re-appears on the next deploy. Self-contained: it owns its visibility off the swUpdate
// subscription, so the workspace only has to mount it.
//
// Rank 6 of 7 in the Meldeleiste: the calmest thing there is, and the reason the strip ranks by
// CLASS rather than arrival — it used to sit at the bottom edge on the same coordinate as three
// other cards, and a deploy landing at 3am must never be what the operator reads first.
export function UpdateBanner() {
  const [available, setAvailable] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [applying, setApplying] = useState(false)

  // A fresh waiting build re-shows the message even if a previous one was dismissed; an
  // update that resolves on its own (the announced worker took over) retracts it.
  // ⚠️ Announced AGAIN, the row is tappable again: an in-place apply that gave up (swUpdate's
  // backstop) re-announces, and the row used to stay on a disabled «Wird aktualisiert …» with
  // no ✕ for good (sweep 09.11.2026, UX.11).
  useEffect(() => onUpdateAvailable((avail) => {
    setAvailable(avail)
    if (avail) { setDismissed(false); setApplying(false) }
  }), [])

  // read per-render (not module-load) so the resolved locale is applied — see config/copy
  const C = appConfig.copy.update
  // ⚠️ …and on everything but iOS the message carries the apply itself (16.09.2026). «App
  // schliessen & neu öffnen» is true but not sufficient there: a waiting build activates only
  // once EVERY client of the origin is gone, so an installed app swiped away while a browser tab
  // still holds the site simply stays on the old build — reported from a Samsung, reproduced by
  // the lifecycle. iOS keeps the restart wording, where the in-place path wedges.
  const inPlace = canApplyInPlace(getInstallPlatform())
  useMeldung(!available || dismissed ? null : {
    id: 'update',
    kind: 'update',
    tone: 'calm',
    icon: 'info',
    title: C.available,
    sub: inPlace ? C.hintApply : C.hint,
    // the sub-line IS the instruction — cut at 390px the iPhone read «Wird beim Neustart aktiv – App
    // schliess…», losing exactly what to do (owner, review round 7). Two lines at 390 in every language.
    wrap: true,
    ...(inPlace ? {
      actions: [{
        label: applying ? C.applying : C.apply,
        icon: 'rotate',
        busy: applying,
        disabled: applying,
        primary: true,
        onClick: () => { setApplying(true); void applyUpdateNow() },
      }],
    } : {}),
    // ⚠️ no ✕ while the reload is on its way: the row is about to go with the page, and a
    // dismiss that raced it left the app looking like nothing had happened
    ...(applying ? {} : { dismiss: { label: C.dismiss, onClick: () => setDismissed(true) } }),
  })
  return null
}
