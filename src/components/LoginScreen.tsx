import { LoadingStatus } from './ShellLoader'
import { useEffect, useRef, useState } from 'react'
import { apiGet, ApiError } from '../lib/api'
import { useAuth, type RosterEntry } from '../lib/auth'
import { Brand } from './Brand'
import { demoNote, getDeploymentConfig, isDemoMode } from '../lib/deploymentConfig'
import { demoInTranslation } from '../lib/demoLocale'
import { DemoLanguagePicker } from './DemoLanguage'
import { IconSprite, Icon } from '../lib/icons'
import { fillTemplate, initials, roleLabel } from '../lib/format'
import { appConfig } from '../config/appConfig'
import { isValidPin, PinPad } from './PinPad'
import { Button } from './Button'
import { cx } from '../lib/cx'
import { cacheRoster, readCachedRoster, unsentAccounts, unsentLines, type UnsentAccount } from '../lib/unsentAccounts'
import s from './LoginScreen.module.css'

const NEUTRAL_COLOR = '#6c7686' // --ink-faint, for roster tiles without an assigned colour

// Kiosk login gate. Built for fast, gloved 3am use on shared station/vehicle
// tablets: pick a face (no typed identity), then tap a PIN and confirm with ✓.
// Matches the "Karte Minimal" dark tactical language.
export function LoginScreen() {
  const { login } = useAuth()
  const [roster, setRoster] = useState<RosterEntry[] | null>(null)
  // The whole error, not just its headline: what happened, what to do about it, and the raw
  // status for whoever ends up on the phone to the person running the server.
  const [rosterError, setRosterError] = useState<RosterError | null>(null)
  const [selected, setSelected] = useState<RosterEntry | null>(null)
  // Retry nonce: the roster fetch is the very first thing the operator depends on, and on a
  // flaky fireground link it can simply fail. Without a retry the login screen was a dead end —
  // an error line with nothing to tap, escapable only by knowing to kill the app.
  const [attempt, setAttempt] = useState(0)
  // Why a Microsoft sign-in came back without a session (backend auth/microsoft · `?msLogin=`) —
  // read once, then taken out of the address bar so a reload does not repeat it.
  const [msError] = useState(takeMicrosoftError)
  // Whose unsent work this device holds, and the roster it last saw (lib/unsentAccounts) — read
  // once per visit to the gate, so going to a PIN pad and back does not ask again.
  const [unsent, setUnsent] = useState<{ accounts: UnsentAccount[]; cached: RosterEntry[] } | null>(null)
  useEffect(() => {
    let alive = true
    void Promise.all([unsentAccounts(), readCachedRoster()])
      .then(([accounts, cached]) => { if (alive) setUnsent({ accounts, cached }) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    let alive = true
    setRosterError(null)
    setRoster(null)
    apiGet<RosterEntry[]>('/api/auth/roster')
      .then((r) => { cacheRoster(r); if (alive) setRoster(r) })
      .catch((e: unknown) => {
        if (!alive) return
        setRosterError(e instanceof ApiError
          // status 0 is the offline path and has no HTTP code to quote — showing "Fehlercode 0"
          // would invent a server answer that never came.
          ? { detail: e.detail, hint: rosterHint(e), code: e.status > 0 ? e.status : undefined }
          : { detail: appConfig.copy.login.connectionFailed })
      })
    return () => { alive = false }
  }, [attempt])

  // («Sitzung zurücksetzen» stood here until 02.09.: a dead Einsatz-Link cookie made the roster
  // answer 403, and the only way past it was shedding that cookie from this screen. The login
  // screen now tells the server it is not a link page — lib/linkMode — so a link cookie cannot
  // reach this request at all, and the rescue had nothing left to rescue.)

  return (
    <div className="login">
      <IconSprite />
      <div className="login-card">
        <Brand sub={selected ? appConfig.copy.login.pinEnter : appConfig.copy.login.subtitle} />

        {/* the demo note is the deployment's own text (German); a translated demo adds that its
            fire-service terms are not checked yet, where every visitor reads it before signing in */}
        {(demoNote() || demoInTranslation()) && (
          <p className="login-demo-note">
            {demoNote() && <span>{demoNote()}</span>}
            {demoInTranslation() && <span className="login-demo-unverified">{appConfig.copy.demo.unverified}</span>}
          </p>
        )}

        {/* once the roster has answered either way, so the lines do not gain their buttons late */}
        {!selected && unsent && (roster || rosterError) && (
          <UnsentBanner accounts={unsent.accounts} roster={roster} cached={unsent.cached} onPick={setSelected} />
        )}

        {selected
          ? <LoginPinPad user={selected} onLogin={login} onBack={() => setSelected(null)} />
          : <Roster roster={roster} error={rosterError} onPick={setSelected} onRetry={() => setAttempt((n) => n + 1)} />}

        {!selected && <MicrosoftLogin error={msError} />}

        {/* before the login, like KP Rück's: a picker behind a login you cannot read is none */}
        {!selected && isDemoMode() && <div className="login-lang"><DemoLanguagePicker /></div>}
      </div>
    </div>
  )
}

type MicrosoftError = keyof typeof appConfig.copy.login.microsoftErrors

function takeMicrosoftError(): MicrosoftError | null {
  const url = new URL(window.location.href)
  const reason = url.searchParams.get('msLogin')
  if (reason === null) return null
  url.searchParams.delete('msLogin')
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
  return reason in appConfig.copy.login.microsoftErrors ? reason as MicrosoftError : 'failed'
}

/** «Mit Microsoft anmelden» — a second door onto the same named accounts, drawn ONLY when the
 *  station set it up (`integrations.microsoftLoginConfigured`) and the device is online: it is a
 *  round trip to Microsoft, and offline it could only fail. The PIN tiles stay the way in. */
function MicrosoftLogin({ error }: { error: MicrosoftError | null }) {
  if (!getDeploymentConfig().integrations?.microsoftLoginConfigured || !navigator.onLine) return null
  const C = appConfig.copy.login
  return (
    <div className="login-ms">
      {error && <p className="login-ms-error" role="alert">{C.microsoftErrors[error]}</p>}
      <a className="ip-btn block" href="/api/auth/microsoft/start">
        <svg viewBox="0 0 16 16" aria-hidden>
          <rect width="7.5" height="7.5" fill="#f25022" /><rect x="8.5" width="7.5" height="7.5" fill="#7fba00" />
          <rect y="8.5" width="7.5" height="7.5" fill="#00a4ef" /><rect x="8.5" y="8.5" width="7.5" height="7.5" fill="#ffb900" />
        </svg>
        {C.microsoft}
      </a>
    </div>
  )
}

/**
 * «Ungesendete Änderungen von {Name}» above the grid (sweep 09.11.2026, UX.2 — owner pick «5B»):
 * this device holds edits that only reach the server when THEIR account signs in here, and on a
 * shared tablet the next person would otherwise tap their own face without ever learning that.
 * One line per account, most recent first; «Als {Name} anmelden» opens that person's PIN pad.
 * The grid below is untouched — anybody else can still sign in, and that harms nothing: the edits
 * stay parked under their owner's key (api/workspaceSync · ownerCacheKey).
 *
 * `roster` is the live one (null when it could not be loaded): only an account on it can be signed
 * in, so only its line carries the button. Without it the names come from the roster this device
 * last saw (`cached`); an account on neither is «einem früheren Konto».
 */
function UnsentBanner({ accounts, roster, cached, onPick }: {
  accounts: readonly UnsentAccount[]
  roster: RosterEntry[] | null
  cached: readonly RosterEntry[]
  onPick: (r: RosterEntry) => void
}) {
  const C = appConfig.copy.login
  const { lines, more } = unsentLines(accounts, roster ?? cached)
  if (!lines.length) return null
  return (
    <section className={cx('form-warn form-warn-amber', s.unsent)} role="status">
      {lines.map(({ key, entry }, i) => (
        <div key={key} className={s.line}>
          <p className={s.title}>
            <Icon id="warn" />
            <span>{fillTemplate(C.unsentTitle, { name: entry?.display_name ?? C.unsentFormer })}</span>
          </p>
          {entry && roster && (
            // the one filled action is the most recent account's; a second account's is framed
            <Button variant={i === 0 ? 'primary' : 'secondary'} size="lg" block onClick={() => onPick(entry)}>
              {fillTemplate(C.unsentLogin, { name: entry.display_name })}
            </Button>
          )}
        </div>
      ))}
      {more > 0 && <p className={s.more}>{fillTemplate(C.unsentMore, { n: more })}</p>}
      <p className={s.body}>{C.unsentBody}</p>
    </section>
  )
}

/** The instruction under a failed roster load. One case gets login-specific wording: offline,
 *  where the shared «Gespeicherte Einsätze bleiben offline verfügbar» is not true from a screen
 *  the device only reaches when it is NOT signed in. */
function rosterHint(e: ApiError): string | undefined {
  if (e.status === 0) return appConfig.copy.login.offlineHint
  return e.hint
}

/** A failed roster load, as much of it as we can put on screen. */
interface RosterError {
  detail: string
  hint?: string
  /** HTTP status, when there was one — absent for a network failure. */
  code?: number
}

function Roster({ roster, error, onPick, onRetry }: {
  roster: RosterEntry[] | null
  error: RosterError | null
  onPick: (r: RosterEntry) => void
  onRetry: () => void
}) {
  if (error) {
    return (
      <div className="login-state login-state-err">
        <div className="login-err-head">
          <Icon id="warn" />
          <span>{error.detail}</span>
        </div>
        {error.hint && <p className="login-err-hint">{error.hint}</p>}
        {error.code !== undefined && (
          <p className="login-err-code">{fillTemplate(appConfig.copy.errors.httpCode, { code: error.code })}</p>
        )}
        <button type="button" className="ip-btn" onClick={onRetry}>{appConfig.copy.login.retry}</button>
      </div>
    )
  }
  if (!roster) {
    return <div className="login-state"><LoadingStatus>{appConfig.copy.login.loadingRoster}</LoadingStatus></div>
  }
  if (roster.length === 0) {
    return <div className="login-state">{appConfig.copy.login.noUsers}</div>
  }
  // A single registered user gets one prominent, centred tile (not a lonely cell in a
  // 2-up grid); more than one keeps the gloved-friendly grid.
  const solo = roster.length === 1
  return (
    <>
      <div className="login-hint">{appConfig.copy.login.whoAreYou}</div>
      <div className={`roster ${solo ? 'roster-solo' : ''}`}>
        {roster.map((r) => (
          <button key={r.id} className="roster-tile" onClick={() => onPick(r)}>
            <span className="roster-avatar" style={{ background: r.color ?? NEUTRAL_COLOR }}>
              {initials(r.display_name)}
            </span>
            <span className="roster-meta">
              <span className="roster-name">{r.display_name}</span>
              <span className={`roster-role ${r.role}`}>{roleLabel(r.role)}</span>
            </span>
            <span className="roster-go" aria-hidden><Icon id="chevron" /></span>
          </button>
        ))}
      </div>
    </>
  )
}

/** Per-device memory of each account's PIN LENGTH, learned only from a SUCCESSFUL login —
 *  what lets the pad submit by itself at that length (field ask 07.09.: «auto-login with the
 *  correct password, don't require the manual checkmark»). localStorage, never the prefs
 *  cookie: a cookie rides to the server on every request, and a PIN's length belongs to this
 *  device alone. Silent-guessing every length ≥6 instead was ruled out on purpose — the
 *  cooldown ladder admits 5 free failures per (account, source), so a 12-digit PIN would 429
 *  on its own correct entry. */
const PIN_LEN_KEY = 'kp.pinlen'
const knownPinLen = (userId: string): number | undefined => {
  try { return (JSON.parse(localStorage.getItem(PIN_LEN_KEY) ?? '{}') as Record<string, number>)[userId] } catch { return undefined }
}
const rememberPinLen = (userId: string, len: number) => {
  try {
    const all = JSON.parse(localStorage.getItem(PIN_LEN_KEY) ?? '{}') as Record<string, number>
    localStorage.setItem(PIN_LEN_KEY, JSON.stringify({ ...all, [userId]: len }))
  } catch { /* private mode / storage disabled — the ✓ keeps working */ }
}

// The login gate's use of the shared pad (src/components/PinPad.tsx): the ✓ key (or Enter)
// submits, and on a device that has signed this account in before, reaching the REMEMBERED
// length submits by itself — the pad still paints no empty slots, and a first login (or a
// changed PIN) still goes through the ✓. The idle screen betrays nothing it did not before:
// an onlooker watching a successful ✓ login could always count the dots.
//
// A miss at the remembered length keeps the jump armed for the retry: it is almost always a
// mistyped digit, and disarming on the FIRST miss (07.09.–22.10.) is why the auto-login seemed
// to work «sometimes, not always» – every retry after a typo needed the ✓. A second miss there
// means the PIN itself changed length, and the ✓ takes over for this visit to the pad.
const AUTO_MISSES_BEFORE_DISARM = 2
function LoginPinPad({ user, onLogin, onBack }: {
  user: RosterEntry
  onLogin: (userId: string, pin: string) => Promise<void>
  onBack: () => void
}) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // read once per mount; repeated misses at it disarm it for this visit to the pad, or a PIN
  // that grew LONGER after a reset could never be typed past its old remembered length
  const autoLen = useRef<number | undefined>(knownPinLen(user.id))
  const autoMisses = useRef(0)
  // disabled until this monotonic timestamp (ms) — drives the 429 cooldown lock
  const [lockedUntil, setLockedUntil] = useState(0)
  const [, force] = useState(0) // re-render to release the lock when the cooldown elapses
  const submitting = useRef(false)

  const locked = Date.now() < lockedUntil
  const disabled = busy || locked

  // tick once a second while locked so the pad re-enables itself on time
  useEffect(() => {
    if (!locked) return
    const t = setInterval(() => force((n) => n + 1), 500)
    return () => clearInterval(t)
  }, [locked])

  const submit = async (value: string) => {
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    setError(null)
    try {
      await onLogin(user.id, value)
      // success unmounts the whole LoginScreen via the auth gate — remember the length that
      // just proved itself, so the next login on this device needs no ✓
      rememberPinLen(user.id, value.length)
    } catch (e: unknown) {
      if (value.length === autoLen.current && ++autoMisses.current >= AUTO_MISSES_BEFORE_DISARM) {
        autoLen.current = undefined // stop auto-firing at a length that keeps failing
      }
      setPin('') // wipe the failed attempt so the next try starts clean
      if (e instanceof ApiError) {
        setError(e.detail)
        if (e.status === 429) {
          const secs = e.retryAfter ?? 5
          setLockedUntil(Date.now() + secs * 1000)
        }
      } else {
        setError(appConfig.copy.login.loginFailed)
      }
    } finally {
      setBusy(false)
      submitting.current = false
    }
  }

  return (
    <PinPad
      value={pin}
      onChange={(next) => {
        setError(null); setPin(next)
        if (next.length === autoLen.current && isValidPin(next)) void submit(next)
      }}
      onSubmit={(full) => void submit(full)}
      disabled={disabled}
      message={error ?? (locked ? appConfig.copy.login.pleaseWait : undefined)}
      header={
        <button className="pin-backuser" onClick={onBack}>
          <Icon id="chevron" />
          <span className="pin-avatar" style={{ background: user.color ?? NEUTRAL_COLOR }}>{initials(user.display_name)}</span>
          <span className="pin-username">{user.display_name}</span>
        </button>
      }
    />
  )
}
