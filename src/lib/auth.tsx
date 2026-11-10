import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { apiGet, apiPost, ApiError, isDenial, isUnverifiable, SESSION_EXPIRED_EVENT, SESSION_RESTORED_EVENT } from './api'
import { onReachable } from './connectivity'
import { idbGet, idbSet, idbDel } from './idb'
import { getDeploymentConfig, isDemoMode, loadDeploymentConfig } from './deploymentConfig'
import { notifyAccountKnown } from './accountKnown'
import { syncMediaCacheAuth } from './authMediaCache'
import { denyWorkspaceCache, setWorkspaceCacheOwner } from './api/workspaceSync'
import { linkPageOwnsSession } from './linkMode'

// The demo's public PIN (shown to every visitor) — used to auto-sign-in on demo instances so
// there's no login screen. Only ever sent when isDemoMode() is true; real stations never use it.
const DEMO_PIN = '000000'

// Authenticated user as returned by the backend. role === 'editor' grants
// edit rights; 'viewer' is read-only (can pan / zoom / inspect, never mutate).
export interface AuthUser {
  id: string
  username: string
  display_name: string
  role: 'editor' | 'el' | 'viewer'
  color: string | null
  last_login: string | null
  /** start this login in the Einsatzleiter view (frontend default; device pref overrides) */
  el_view_default?: boolean
  /** when this device's login lapses unless renewed (the refresh token's expiry, ISO) — the
   *  «Anmeldung» row of «Alarm auf diesem Gerät» (lib/alarmReadiness). Absent on a link session. */
  session_until?: string | null
  /** this is an Einsatz-Link session (/l/<token>), not a login: a viewer narrowed to ONE
   *  incident, whose backend surface is an allowlist of reads (see incidentLink.ts). Surfaces
   *  gate on it to hide what would 403 — reports, printing, alarms, and every write. */
  link_scoped?: boolean
  /** the one incident that session may see — the app opens it directly instead of listing */
  link_incident_id?: string
  /** WHICH link this session came in on. `alarm`, `view` and `terminal` (the enrolled
   *  Stations-PC) are read-only; `atemschutz` is the Atemschutz-Link (the QR a non-FU scans to
   *  run only the Überwachungstafel of this one Einsatz) and `atemschutz-standing` its
   *  station-level twin (the laminated QR — same surface, standing credential). Both MAY
   *  write — the trupp slice of the workspace, journal rows of kind 'team', and `atemschutz.*`
   *  events. Everything else still 403s, so the app renders those sessions as the lite board
   *  and nothing more (IncidentWorkspace · `asLink`). */
  link_kind?: 'alarm' | 'view' | 'atemschutz' | 'atemschutz-standing' | 'terminal'
}

/** The two Atemschutz-link kinds behave identically in the app — only the credential (and its
 *  revocation lever) differs, which is the backend's business. One predicate, so a surface
 *  cannot honour one and forget the other. */
export const isAtemschutzLinkKind = (kind: AuthUser['link_kind']): boolean =>
  kind === 'atemschutz' || kind === 'atemschutz-standing'

// One tappable roster tile from GET /api/auth/roster (no PIN / username here —
// identity is chosen by tapping, then confirmed by the PIN pad).
export interface RosterEntry {
  id: string
  display_name: string
  role: 'editor' | 'el' | 'viewer'
  color: string | null
}

interface AuthContextValue {
  user: AuthUser | null
  /** true until the initial /me probe settles, so the gate can hold a splash */
  loading: boolean
  /** the initial probe left `user` null because the server could not be ASKED (offline, timeout,
   *  restarting) — as opposed to it having said «no». The Einsatz-Link door reads this so a phone
   *  that merely lost signal is told so, instead of «Dieser Link gilt nicht mehr». */
  probeUnreachable: boolean
  /** the session died mid-use and the transparent refresh could not repair it (api ·
   *  SESSION_EXPIRED_EVENT). `user` stays set while that is all we know — the workspace keeps
   *  working on its local cache — so a surface has to SAY it; this is the one flag that surface
   *  reads. It is withdrawn once the server has ANSWERED: a live /me or a successful refresh
   *  clears it, and a refusal ends the session outright (see the listener below). Cleared by a
   *  fresh login or a logout. */
  sessionExpired: boolean
  login: (userId: string, pin: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

// Cache the last-known user so the PWA stays usable OFFLINE: when the /me probe fails
// because the server could not be asked (offline, timeout, restarting — not a 401), the
// httpOnly cookie is still present in the browser but unverifiable, so we optimistically
// restore the cached identity instead of bouncing to the login screen. A real 401 (online,
// session gone) clears it.
// A link session is deliberately NEVER cached (and landing on one CLEARS the cache): the
// offline restore above is a promise that the httpOnly cookie is still good — true for a
// station tablet whose 8h/90d session simply can't be verified right now, false for an
// Einsatz-Link, which stops being valid the moment the Einsatz is closed or the link expires,
// with nothing on the device able to notice. Cached, a responder's phone would keep re-opening
// a read-only Einsatz view long after that Einsatz ended, and no online probe would ever come
// to correct it. It is also not the case the cache exists for: a personal phone opening a link
// from an alert isn't the installed PWA that must survive a cellar with no signal.
const USER_CACHE = 'kp-front-user'
function readCachedUser(): Promise<AuthUser | null> {
  return idbGet<AuthUser>(USER_CACHE)
}
function writeCachedUser(u: AuthUser | null) {
  void (u && !u.link_scoped ? idbSet(USER_CACHE, u) : idbDel(USER_CACHE))
}

/** The /me bound when a cached user is waiting behind it. The default 20 s is right for a
 *  request nothing else can answer — but here the cached user IS the answer until the server
 *  speaks (the boot opens on it at once, see the probe below), so a half-open link need not hold
 *  a request open for long; the next poll corrects a slow-but-alive server. */
const CACHED_PROBE_TIMEOUT_MS = 7_000

/** how long the boot probe waits for the session-bearing config re-read before mounting the app */
const SESSION_CONFIG_BUDGET_MS = 4_000

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [probeUnreachable, setProbeUnreachable] = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)

  /** Set the session AND tell the offline caches whose it is, in ONE step. Deliberately not an
   *  effect: App mounts INSIDE this provider, so its own effects (opening the boot Einsatz off
   *  the cache) run before ours would, and would read against a stale owner. */
  const adoptUser = useCallback((u: AuthUser | null) => {
    setWorkspaceCacheOwner(u?.id ?? null)
    setUser(u)
  }, [])

  // Cross-tab denial. The session cookie is shared by every tab, so a refusal in one tab must lock
  // the others too — otherwise a second tab keeps serving cached reads, and can even re-grant the
  // media worker on a service-worker controllerchange, until its OWN next server contact notices
  // (that convergence-on-next-401 still stands — api · SESSION_EXPIRED_EVENT — this only makes it
  // immediate). One BroadcastChannel carries the denial; a receiver runs the same lockdown locally,
  // minus the re-broadcast. Proportionate: no shared state, no leader, just a one-shot signal.
  const denialChannel = useRef<BroadcastChannel | null>(null)

  /** Bumped by EVERY local denial (a logout, a broadcast from another tab, a confirmed refusal).
   *  The boot probe captures it before its `/me` await and re-checks after: a denial that fires
   *  WHILE the probe is in flight must win, so the offline-fallback restore cannot resurrect the
   *  very session that was just ended (SEC-10 — denial resurrection). */
  const denialEpoch = useRef(0)

  /** The local half of a denial: lock the workspace cache, drop the view to the kiosk login, and
   *  forbid an offline restore. Shared by a locally-detected refusal and one another tab broadcast.
   *  Owner-stamped unsynced work stays on disk, gated to the same account's next sign-in. */
  const denyLocally = useCallback(() => {
    denialEpoch.current++ // invalidate any boot restore whose probe is still awaiting
    denyWorkspaceCache()
    adoptUser(null)       // …and the effect below tells the worker (authMediaCache · «logged-out»)
    writeCachedUser(null) // no offline restore may resurrect a session the server has ended
  }, [adoptUser])

  /** A reachable server refused this session. The device loses its cached VIEW at once — a null
   *  user IS the lock, since the kiosk login is what the gate renders then (main · Gate) — while
   *  everything unsynced stays on disk, gated to the same account's next sign-in
   *  (api/workspaceSync · denyWorkspaceCache). Deleting the operator's unflushed work because
   *  their 8 h token ran out would be the worse failure of the two. Also tells the other tabs. */
  const denySession = useCallback(() => {
    denyLocally()
    denialChannel.current?.postMessage('denied')
  }, [denyLocally])

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return // e.g. an old WebView: falls back to next-401 convergence
    const channel = new BroadcastChannel('kp-auth-denial')
    denialChannel.current = channel
    // Another tab was refused. Do NOT re-broadcast (denyLocally, not denySession) — the sender
    // already told everyone, and echoing would loop.
    channel.onmessage = (e) => { if (e.data === 'denied') denyLocally() }
    return () => { channel.close(); denialChannel.current = null }
  }, [denyLocally]) // stable: one channel for the page's life

  // Demo instances skip the login screen: on a fresh visit (no session) auto-sign-in as the
  // demo editor so a visitor lands straight in the action. Fetch the roster, pick the editor,
  // login with the public demo PIN. Failure falls through to the normal login screen.
  const tryDemoAutoLogin = async (): Promise<AuthUser | null> => {
    if (!isDemoMode()) return null
    // ⚠️ Never on a link page. A `/l/<token>` page speaks only for its own link session (lib/
    // linkMode), so signing an account in there would hand it a login every request then refuses
    // to use — a demo visitor whose link had lapsed would sit inside a fully broken app instead
    // of the honest «Link abgelaufen» card, whose reload re-exchanges the token in the address.
    if (linkPageOwnsSession()) return null
    try {
      const roster = await apiGet<RosterEntry[]>('/api/auth/roster')
      const editor = roster.find((r) => r.role === 'editor') ?? roster[0]
      if (!editor) return null
      const demoUser = await apiPost<AuthUser>('/api/auth/login', { user_id: editor.id, pin: DEMO_PIN })
      // Boot fetched the anonymous config before this session existed. That response deliberately
      // withholds browser capabilities such as the CARTO key; mount the map only after the
      // authenticated refresh or a first-time visitor sees watermarked tiles until reloading.
      try { await loadDeploymentConfig() } catch { /* keep the booted config */ }
      return demoUser
    } catch { return null }
  }

  // On mount, ask the backend who we are. A 401 just means "not logged in" (normal
  // cold-start) — on the demo we then auto-sign-in. A server that could not be asked (offline,
  // timeout, restarting — api · isUnverifiable) keeps the cached user so an installed PWA opens
  // straight into the app with no signal.
  //
  // ⚠️ A device with a cached user opens on it AT ONCE and asks behind the app (cold-start sweep
  // 01.11.2026): waiting for /me put one to three round trips (a lapsed 8 h access cookie means
  // 401 → refresh → /me) in front of every launch, each one a second or more on a phone waking its
  // radio. It shows nothing the offline boot does not already show for as long as there is no
  // signal; a refusal, when it arrives, locks the device exactly as a mid-use one does
  // (denySession).
  //
  // This probe used to answer a 403 by POSTing `/api/auth/logout` and asking once more: a dead
  // Einsatz-Link cookie made every credential-gated route refuse, and the kiosk login was
  // unreachable behind it for up to 12 h. That trap is gone at the root (02.09.) — the ordinary
  // app tells the server it is not a link page, so a link cookie is not read here at all
  // (lib/linkMode · backend auth/incident_link · LINK_MODE_HEADER) — and the repair itself was
  // the coupling the maintainer named: one 403 for any reason at all signed the device out.
  useEffect(() => {
    let alive = true
    void (async () => {
      // Snapshot the denial epoch BEFORE anything awaits: a logout/deny landing during the probe
      // below (this tab, or a broadcast from another) bumps it, and the offline restore must lose
      // to it — see the isUnverifiable branch.
      const denialEpochAtStart = denialEpoch.current
      const cached = await readCachedUser()
      if (cached && alive && denialEpoch.current === denialEpochAtStart) {
        adoptUser(cached)
        setLoading(false)
      }
      const probe = () => apiGet<AuthUser>('/api/auth/me', cached ? { timeoutMs: CACHED_PROBE_TIMEOUT_MS } : undefined)
      try {
        const u: AuthUser = await probe()
        // The boot config was fetched BEFORE this probe, and `/api/config` is public: with the
        // access cookie expired and only the refresh cookie alive it answered as an ANONYMOUS
        // caller — no 401, so no refresh — and silently withheld the CARTO key and the Rapport
        // links (backend api/config · get_config). The probe above is what refreshed the session,
        // so re-read now, before the app mounts and the map builds its tile URLs; the basemap
        // used to print «API key required» for the whole session (field report 02.09.). Only
        // when the booted config shows the withholding, and bounded: a slow link must not hold
        // the splash twice — a late answer still lands in the singleton and the offline cache.
        // Not awaited when the app is already open on the cached user: there is no splash to hold.
        if (!getDeploymentConfig().integrations?.cartoBasemapKey) {
          const reread = loadDeploymentConfig().catch(() => {})
          if (!cached) await Promise.race([reread, new Promise((r) => setTimeout(r, SESSION_CONFIG_BUDGET_MS))])
        }
        if (alive) { adoptUser(u); writeCachedUser(u) }
      } catch (e) {
        if (!alive) return
        if (isUnverifiable(e)) {
          // A logout/deny that fired while this probe was awaiting must WIN: restoring `cached`
          // here re-adopts the user and clears the denial (adoptUser → setWorkspaceCacheOwner),
          // silently reversing the logout. Only a live 200 above may lift a denial; the offline
          // fallback may not. Stay locked and require a fresh login.
          if (denialEpoch.current !== denialEpochAtStart) return
          // unverifiable, not refused — the cached session (adopted above) stays usable
          if (!cached) setProbeUnreachable(true)
        } else if (isDenial(e)) {
          // A reachable refusal, 401 OR 403, clears the cached identity — or a later OFFLINE boot
          // would restore a login the server has already rejected (SEC-10). Only a 401 means
          // «not logged in», so only it lets the demo auto-sign-in; a 403 just lands on the login.
          // The app already open on the cached user is locked like a session refused mid-use.
          if (cached) denySession()
          else writeCachedUser(null)
          if (e instanceof ApiError && e.status === 401) {
            const demoUser = await tryDemoAutoLogin() // demo → straight in; real stations → login screen
            if (alive && demoUser) {
              adoptUser(demoUser)
              writeCachedUser(demoUser)
              // The cold boot's own refused refresh fired SESSION_EXPIRED_EVENT before this
              // login existed, and that flag would banner «Anmeldung abgelaufen» over a
              // session that is seconds old. Lift it exactly as the kiosk login() does.
              setSessionExpired(false)
            }
          }
        }
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [adoptUser, denySession]) // stable: the boot probe runs once per mount

  // The one listener for a session that died mid-use — and the one place that decides what that
  // MEANS. `kp:session-expired` fires when the refresh was REFUSED (api · tryRefresh tells a
  // refusal from a server it could not reach). Still ask once before locking anything:
  //
  //   · a reachable 401/403 → the session is genuinely gone. Lock this device out of its caches
  //     immediately (denySession); unsynced work is kept, not deleted.
  //   · silence (offline, gateway, timeout) → NOTHING has been confirmed. The flag alone stands, the
  //     Meldung says «Änderungen bleiben auf diesem Gerät», and the cached user, the cached media
  //     and the cached workspace are as good as they were a minute ago. A cellar with no signal
  //     must never be answered by signing the tablet out. The question is asked AGAIN once the
  //     server answers anything (connectivity · onReachable), so the row never outlives the doubt.
  //   · a live /me, or a refresh that succeeded meanwhile (SESSION_RESTORED_EVENT) → the session
  //     works: withdraw the warning (sweep 09.11.2026, UX.1 — it used to stand until a sign-in).
  //
  // Single-flight: every failing request re-fires the event, and one answer settles all of them.
  useEffect(() => {
    let alive = true
    let asking = false
    let standing = false
    const withdraw = () => { standing = false; setSessionExpired(false) }
    const ask = () => {
      if (asking) return
      asking = true
      void (async () => {
        try {
          const u = await apiGet<AuthUser>('/api/auth/me', { timeoutMs: CACHED_PROBE_TIMEOUT_MS })
          if (!alive) return
          adoptUser(u)
          writeCachedUser(u)
          withdraw()
        } catch (e) {
          if (alive && isDenial(e)) { standing = false; denySession() }
        } finally {
          asking = false
        }
      })()
    }
    const onExpired = () => {
      standing = true
      setSessionExpired(true)
      ask()
    }
    const offReachable = onReachable(() => { if (standing) ask() })
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    window.addEventListener(SESSION_RESTORED_EVENT, withdraw)
    return () => {
      alive = false
      offReachable()
      window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
      window.removeEventListener(SESSION_RESTORED_EVENT, withdraw)
    }
  }, [adoptUser, denySession]) // stable: one listener for the page's life

  // Whoever needs the session to load something says so through lib/accountKnown.
  const userId = user?.id
  useEffect(() => {
    if (userId) notifyAccountKnown()
  }, [userId])

  // Protected media is cached only for a known real-user client. Do not signal during the
  // initial probe: `user === null` still means "unknown" then, not "logged out". Once the
  // probe settles, logout/session expiry clears media, a user change changes cache ownership,
  // and an Einsatz-Link becomes network-only without consuming the station cache.
  useEffect(() => {
    if (!loading) syncMediaCacheAuth(user)
  }, [loading, user])

  // Throws ApiError on a bad PIN (401) or cooldown (429) so LoginScreen can show
  // the backend's German `detail` (and disable the pad on a Retry-After).
  const login = async (userId: string, pin: string) => {
    const u = await apiPost<AuthUser>('/api/auth/login', { user_id: userId, pin })
    // The account is back: this is what lifts a denial and hands the offline cache — including
    // any edit that never reached the server — to the user who left it there.
    adoptUser(u)
    setSessionExpired(false)
    writeCachedUser(u)
    // ⚠️ Re-read the deployment config now that there IS a session. Parts of it are withheld
    // from anonymous callers (`report.links` — the station's own Formulare, whose URLs are
    // capabilities; see backend api/config · get_config), and the boot fetch necessarily ran
    // before this login. A later boot re-reads too when its config shows the withholding — the
    // boot fetch is anonymous whenever the access cookie has expired (probe effect above).
    // Best-effort: a station that cannot re-read still has the config it booted with, and
    // failing the login over a config refresh would be the worse trade at 3am.
    try { await loadDeploymentConfig() } catch { /* keep the booted config */ }
  }

  const logout = async () => {
    try { await apiPost('/api/auth/logout') } catch { /* best-effort — clear locally regardless */ }
    // Signing out is a refusal the operator asked for: the caches close behind it exactly as
    // they do on a server-side revocation, and unsynced edits wait for the same user's return.
    denySession()
    setSessionExpired(false)
  }

  return (
    <AuthContext.Provider value={{ user, loading, probeUnreachable, sessionExpired, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
