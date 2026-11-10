import { appConfig } from '../config/appConfig'
import { useMeldung } from '../lib/useMeldung'

// Published while the session cookie has expired mid-Einsatz (lib/auth · sessionExpired, set by
// api.ts's SESSION_EXPIRED_EVENT on a 401 refresh). Until 02.09. every request failed silently
// behind a badge that said «wird erneut versucht», and the only way back was Einsatz-Menü →
// Abmelden → PIN — with nothing pointing there. The row says what is standing still and that
// nothing is lost; its one button IS the way back, and asks «Abmelden?» like every other logout
// (the caller passes the asking one — offline a sign-out locks the running Einsatz away). No ✕:
// the row is withdrawn by the session itself — a sign-in, or the server taking it again
// (auth · sessionExpired).
export function SessionExpiredMeldung({ onRelogin }: { onRelogin: () => void }) {
  // read per-render (not module-load) so the resolved locale is applied — see config/copy
  const C = appConfig.copy.session
  useMeldung({
    id: 'session',
    kind: 'session',
    tone: 'warn',
    icon: 'warn',
    title: C.expiredTitle,
    sub: C.expiredHint,
    actions: [{ label: C.relogin, icon: 'logout', primary: true, onClick: onRelogin }],
  })
  return null
}
