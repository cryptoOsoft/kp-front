import { ShellLoader } from '../components/ShellLoader'
import { useCallback, useEffect, useState } from 'react'
import { ApiError, apiGet, apiPost, CONNECTOR_TIMEOUT_MS } from '../lib/api'
import { Icon } from '../lib/icons'
import { appConfig } from '../config/appConfig'
import { useConfig } from './ConfigContext'
import { SetupChecklist, type SetupState } from './SetupChecklist'
import { fillTemplate, fmtFileSize, formatTime } from '../lib/format'
import { providerLabel, type DeploymentSharePointSource } from '../lib/deploymentConfig'
import { Card, StatusBadge, Metric, UsageBar, ProgressBar, EmptyState, ResultChip, ConfirmButton, fmtDateTime, fmtRelTime } from './ui'
import { useCellLabels } from './useCellLabels'
import { RosterSnapshotDetail, type RosterSnapshotCounts } from './RosterSnapshotDetail'
import { clearTiles, countTiles } from '../lib/tileStore'
import './system.css'

// ─── shapes (plain dict from GET /api/system; resilient — sections may be null) ──

interface SystemVersion {
  release: string
  commit: string
  branch: string | null
  env: string
}
interface SystemDatabase {
  ok: boolean
}
interface SystemMonitoring { heartbeatConfigured: boolean }
interface SystemCounts {
  incidents: number | null
  incidents_open: number | null
  personnel_active: number | null
  users: number | null
  reference_datasets: number | null
}
interface SystemStorage {
  media_dir: string
  used_bytes: number
  file_count: number
  disk_total_bytes: number | null
  disk_free_bytes: number | null
}
interface SystemIntegrations {
  diveraConfigured: boolean
  traccarConfigured: boolean
  personnel?: { provider: string | null; configured: boolean; capabilities: string[] }
  alarms?: { provider: string | null; configured: boolean; capabilities: string[] }
  vehicles?: { provider: string | null; configured: boolean; capabilities: string[] }
  providers?: Array<{
    provider: string
    domain: 'personnel' | 'alarms' | 'vehicles'
    configured: boolean
    active: boolean
    capabilities: string[]
  }>
}
/** Counts one polling connector records about its last run. Shapes differ per connector
 *  (backend · connector_state); only `staleOutstanding` is read here — the rest is recorded for
 *  the log and for whatever asks next. */
interface SystemConnectorCounts {
  /** personnel: leavers the «safe» level counted but deliberately did NOT deactivate */
  staleOutstanding?: number | null
  [key: string]: unknown
}
interface SystemConnector {
  id: string
  direction: 'in' | 'out'
  configured: boolean
  state: 'online' | 'offline' | null
  detail: string | null
  /** when it last TRIED, when it last actually WORKED, and why it did not. Null on the rows that
   *  record no health (webhooks, push, …) — never absent, so «nothing to report» and «this build
   *  does not know» stay distinguishable (backend · `_NO_HEALTH`). */
  lastAttempt?: string | null
  lastSuccess?: string | null
  lastError?: string | null
  counts?: SystemConnectorCounts | null
}
interface SystemResponse {
  version: SystemVersion | null
  database: SystemDatabase | null
  counts: SystemCounts | null
  storage: SystemStorage | null
  integrations: SystemIntegrations | null
  connectors: SystemConnector[] | null
  /** whether this deployment can tell anybody it has died (api/system) — a boolean, never the URL */
  monitoring: SystemMonitoring | null
  /** «Einrichtung», derived server-side — see SetupChecklist. */
  setup: SetupState | null
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Count or "—" when the COUNT query failed server-side. */
function fmtCount(n: number | null | undefined): string {
  return n == null ? '—' : String(n)
}

/** Wall clock to the second — «Stand 17:49:20», the last heartbeat of the print agent.
 *  ⚠️ The DEPLOYMENT's locale (lib/format · formatTime), like every other time in the Verwaltung
 *  (ui · fmtDate / fmtDateTime / fmtRelTime), never the browser's: that printed «05:49:20 PM»
 *  into a German page on any device set to en-US, which is most tablets out of the box. */
function fmtClock(d: Date): string {
  return formatTime(d, true)
}

// ─── connector health ─────────────────────────────────────────────────────────
//
// ⚠️ The server serves the two timestamps RAW and derives no staleness at all, on purpose
// (backend · `_polling_connector`): «der letzte Erfolg war im Juni» is a judgement about how
// often THIS station expects that connector to fire, and a window invented in the backend would
// either call a quiet Traccar dead or call a dead Divera fine. So the windows live here, one per
// connector, each a generous multiple of its own cadence — long enough that a single missed tick
// or a redeploy is not an alarm, short enough that a rotated key is visible the same shift.

/** How long a connector may go without a successful run before the card calls it stale.
 *  Alarms poll every 2 min, Traccar samples every 30 s, the Mannschaft runs nightly. */
const STALE_AFTER_MS: Record<string, number> = {
  divera_alarms: 15 * 60_000,
  traccar: 10 * 60_000,
  divera_personnel: 2 * 24 * 60 * 60_000,
  // Polled hourly by default (roster.snapshotIntervalMin); a quarter of a day without one
  // success is a feed that stopped, not a slow one.
  roster_snapshot: 6 * 60 * 60_000,
}

/** Does this connector record health at all? The polling rows do; the webhook/push rows carry
 *  nulls, and a «zuletzt erfolgreich: —» under those would be a fact they never claimed. */
const pollsFor = (id: string): boolean => id in STALE_AFTER_MS

/** What one polling connector's health READS as. Red = broken (the last attempt failed), amber =
 *  warning (it worked, but too long ago), grey = configured and not yet heard from. */
function connectorHealth(conn: SystemConnector, now: number): {
  tone: 'on' | 'off' | 'warn' | 'err'
  state: string
} {
  const C = appConfig.copy.admin.system
  if (!conn.configured) return { tone: 'off', state: C.notConfigured }
  if (conn.lastError) return { tone: 'err', state: C.connOffline }
  if (!conn.lastSuccess) return { tone: 'off', state: C.connNeverRan }
  const age = now - new Date(conn.lastSuccess).getTime()
  const window = STALE_AFTER_MS[conn.id]
  if (Number.isFinite(age) && window != null && age > window) return { tone: 'warn', state: C.connStale }
  return { tone: 'on', state: C.connOnline }
}

/** Clamp a fraction to [0, 100] for bar widths. */
function pct(part: number | null | undefined, whole: number | null | undefined): number {
  if (part == null || whole == null || !Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return 0
  return Math.max(0, Math.min(100, (part / whole) * 100))
}

// ─── SharePoint connector (GET/POST /api/sharepoint) ──────────────────────────

interface SharePointArea {
  area: string
  path: string
  site: string | null
  /** pending | ok | unchanged | refused | unreachable | auth_failed | error | needs_review */
  status: string
  detail: string | null
  imported: number
  skipped: number
  missing: number
  lastRunAt: string | null
  lastSuccessAt: string | null
}
/** What a RUNNING pull reports (GET /api/sharepoint/progress, app/sync_progress). `running:
 *  false` is the normal answer; everything else is only there while a run is on. */
interface SharePointProgress {
  running: boolean
  startedAt?: string
  area?: string | null
  areasDone?: number
  areasTotal?: number
  done?: number
  total?: number
}
interface SharePointStatus {
  configured: boolean
  credentials: boolean
  intervalMinutes: number
  /** negative once the Azure client secret has expired; null when no date was recorded */
  secretExpiresInDays: number | null
  areas: SharePointArea[]
}

/** How often the card asks how far a running pull has got. Fast enough that a 60-second sync
 *  visibly moves, slow enough that a five-minute one is 250 requests against a dictionary. */
const PROGRESS_POLL_MS = 1200

/** The sentence above the bar: which area, and how much of it — «Objektpläne · 12 von 43
 *  Dateien». Before the first count there is nothing true to say beyond «wird vorbereitet». */
function progressLabel(C: typeof appConfig.copy.admin.system, p: SharePointProgress | null): string {
  if (!p?.area) return C.spProgressStarting
  const area = C.spAreas[p.area] ?? p.area
  const line = p.total
    ? fillTemplate(C.spProgressFiles, { area, done: String(p.done ?? 0), total: String(p.total) })
    : fillTemplate(C.spProgressArea, { area })
  // …and where this area sits in the run, once there is more than one to walk
  return (p.areasTotal ?? 0) > 1
    ? `${line} · ${fillTemplate(C.spProgressAreas, { n: String((p.areasDone ?? 0) + 1), total: String(p.areasTotal) })}`
    : line
}

/** Warn this many days before the Azure client secret lapses. Long enough that a volunteer can
 *  find an afternoon and somebody with tenant access — the renewal is a portal visit, not a
 *  five-minute job, and the failure it prevents is total. */
const SECRET_WARN_DAYS = 60

/** An area's state as a badge tone. `unchanged` is a success — the folder simply had nothing
 *  new in it, which is what almost every poll finds. */
function areaTone(status: string): 'on' | 'off' | 'warn' | 'err' {
  if (status === 'ok' || status === 'unchanged') return 'on'
  if (status === 'auth_failed' || status === 'error') return 'err'
  if (status === 'pending') return 'off'
  return 'warn'
}

/**
 * SharePoint-Anbindung — the card that exists because this connector's likeliest end is silence.
 *
 * An Azure client secret expires after at most 24 months, Graph starts answering 401, and
 * nothing about the app looks different: the plans on the tablets are just the ones from
 * before. So the card leads with the two facts that make that visible — the countdown to the
 * secret's expiry, and the last SUCCESSFUL sync per area, which is deliberately not the same
 * thing as the last run.
 *
 * It renders even when nothing is configured. «Nicht eingerichtet» is a state an operator needs
 * to read; a card that draws nothing looks exactly like one whose fetch failed.
 */
/** Transient result of the «Verbindung testen» probe — same three-way shape DataView's
 *  provider pages use for their own connection tests (ok / off / err), minus the 'off' case:
 *  a probe is only ever offered once credentials exist, so it cannot come back «nicht
 *  konfiguriert». `err` carries the server's own sentence when it has one. */
type ProbeState = { kind: 'idle' } | { kind: 'testing' } | { kind: 'ok' } | { kind: 'err'; text: string }

/**
 * Which folders this deployment pulls — READ-ONLY, the same «Schreibgeschützt – …» shape the
 * Symbol-Auswahllisten and the Modul-Katalog wear (ConfigSections · FleetAttributesViewer /
 * ModulesViewer).
 *
 * ⚠️ The hint names where the folders are edited and does NOT print a command. A command typed
 * onto a settings page goes stale silently and pushes the thing it explains off the screen; the
 * documentation is where it is maintained (same call as the two `uv run python -m app.admin_…`
 * lines that used to stand over ModulesViewer).
 *
 * It renders even where the per-area table above already shows a path: that table is the LAST
 * RUN's view — an area the station configured but the connector has never reached does not
 * appear in it at all, which is precisely the case somebody comes to this card to understand.
 */
function SharePointSources({ sources, intervalMinutes }: {
  sources: DeploymentSharePointSource[]
  intervalMinutes: number | null
}) {
  const tableRef = useCellLabels()
  const C = appConfig.copy.admin.system
  if (sources.length === 0) return null
  return (
    <div className="adm-sys-sources">
      {/* A sub-heading with its one qualifier beside it, not a metric row: «Abgleich alle 60 min»
          is a fact ABOUT this list, and as a right-floating mono value it read as a measurement
          of its own, one line above a table it had nothing to do with. */}
      <div className="adm-sys-subhead">
        <span className="adm-sys-subtitle">{C.spSources}</span>
        <span className="adm-sys-subnote">
          {intervalMinutes != null ? fillTemplate(C.spInterval, { n: intervalMinutes }) : '—'}
        </span>
      </div>
      <div className="adm-table-wrap">
        <table ref={tableRef} className="adm-table">
          <thead>
            <tr>
              <th>{C.spArea}</th>
              <th>{C.spSourceLocation}</th>
              <th>{C.spSourceFolder}</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.area}>
                <td><span className="adm-ref-title">{C.spAreas[s.area] ?? s.area}</span></td>
                {/* Whichever way this station addresses the library: the site's own URL, or the
                    drive id a tenant admin handed over. The library name qualifies either. */}
                <td>
                  <span className="adm-sys-path">{s.siteUrl || s.driveId || '—'}</span>
                  {s.library && <p className="adm-card-cap">{s.library}</p>}
                </td>
                <td>
                  <span className="adm-sys-path">{s.path?.trim() || C.spSourceRoot}</span>
                  {!!s.ignore?.length && (
                    <p className="adm-card-cap">{fillTemplate(C.spSourceIgnored, { folders: s.ignore.join(', ') })}</p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="adm-hint">{C.spSourcesHint}</p>
    </div>
  )
}

function SharePointCard({
  status, sources, intervalMinutes, failed, onReload, onNavigate,
}: {
  status: SharePointStatus | null
  /** `sharepoint.sources` out of the admin's own copy of the config document — shown, never edited */
  sources: DeploymentSharePointSource[]
  intervalMinutes: number | null
  failed: boolean
  onReload: () => Promise<void>
  onNavigate?: (id: string) => void
}) {
  const tableRef = useCellLabels()
  const C = appConfig.copy.admin.system
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)
  const [probe, setProbe] = useState<ProbeState>({ kind: 'idle' })
  const [progress, setProgress] = useState<SharePointProgress | null>(null)

  /** How far the pull has got, while it is running.
   *
   *  The POST answers only when the LAST area is done — up to five minutes on a library that has
   *  changed a lot — so until 16.09.2026 this card had a spinner and nothing else to say. The run
   *  keeps a note in the server's memory (app/sync_progress) and this polls it.
   *
   *  ⚠️ It polls on MOUNT too, not only while this device is the one syncing: the nightly run
   *  goes through the same function, so opening the page at 05:03 now shows that run instead of
   *  a card that looks idle while the plans are being replaced under it.
   *
   *  A failed poll costs the bar and nothing else — it is never allowed to end the run's own
   *  waiting, which is `runNow`'s business. */
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      try {
        const p = await apiGet<SharePointProgress>('/api/sharepoint/progress')
        if (!alive) return
        setProgress(p.running ? p : null)
        // keep asking while something runs — and while OUR run is in flight but has not reached
        // the registry yet (resolving credentials, the first Graph token)
        if (p.running || busy) timer = setTimeout(() => void tick(), PROGRESS_POLL_MS)
      } catch {
        if (alive && busy) timer = setTimeout(() => void tick(), PROGRESS_POLL_MS)
      }
    }
    void tick()
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [busy])

  /** ⚠️ Two things this button learned the hard way (FWO, 16.09.2026).
   *
   *  The run costs whatever the library changed since the last one — it fetches every changed
   *  plan from Graph before it answers — so it gets CONNECTOR_TIMEOUT_MS instead of the 20 s
   *  field bound. One new 11 MB Modul 6 took 60 s, the default aborted it, and the Verwaltung
   *  was told «Abgleich fehlgeschlagen» over a sync that had imported the sheet correctly.
   *
   *  And when our clock DOES run out, that is not a failure to report as one: the run carries on
   *  server-side. The reload therefore happens in `finally` — on the timeout path it is the
   *  whole point, because the card's own row is the honest answer and it was left showing the
   *  PREVIOUS run's counts, green, next to a red chip saying the opposite.
   */
  const runNow = async () => {
    setBusy(true)
    try {
      await apiPost('/api/sharepoint/sync', {}, undefined, CONNECTOR_TIMEOUT_MS)
      setResult({ tone: 'ok', text: C.spSynced })
    } catch (e) {
      const stillRunning = e instanceof ApiError && e.timedOut
      setResult({ tone: stillRunning ? 'ok' : 'err', text: stillRunning ? C.spSyncStillRunning : C.spSyncFailed })
    } finally {
      await onReload()
      setBusy(false)
    }
  }

  // «Verbindung testen» — the setupOf()-gated pattern DataView's provider pages use (unconfigured
  // hides the probe and offers Anbindungen, configured-but-unreachable keeps it), applied to a
  // connector whose OWN status already tells credentials and folders apart: here that fact is
  // simply `status.credentials`, since the probe (api/sharepoint · POST /probe) only needs a
  // token — it works with zero folders configured, exactly like this button does.
  const runProbe = async () => {
    setProbe({ kind: 'testing' })
    try {
      const res = await apiPost<{ ok: boolean; detail: string | null }>('/api/sharepoint/probe', {})
      setProbe(res.ok ? { kind: 'ok' } : { kind: 'err', text: res.detail || C.spTestFailed })
    } catch {
      setProbe({ kind: 'err', text: C.spTestFailed })
    }
  }

  if (failed) return <Card title={C.sharepoint} tip={C.sharepointTip}><EmptyState tone="err" message={C.error} /></Card>
  if (status === null) return null

  const days = status.secretExpiresInDays
  // The countdown is a fact about the SECRET, independent of whether a folder is configured yet
  // — a station that set its credentials and stopped there still deserves to know its secret
  // carries no recorded expiry (dossier risk #10), or is close to one.
  const secretBadge = !status.credentials ? null
    : days === null
      ? <StatusBadge tone="warn" label={C.spSecret} state={C.spSecretMissing} />
      : days <= SECRET_WARN_DAYS
        ? (
          <StatusBadge
            tone={days < 0 ? 'err' : 'warn'}
            label={C.spSecret}
            state={days < 0 ? C.spSecretExpired : fillTemplate(C.spSecretExpires, { days: String(days) })}
          />
        )
        : null

  const probeButton = (
    <span className="adm-test">
      <button type="button" className="btn adm-int-btn" disabled={probe.kind === 'testing'} onClick={() => void runProbe()}>
        {probe.kind === 'testing' && <ShellLoader />}{probe.kind === 'testing' ? C.spTesting : C.spTestConnection}
      </button>
      {probe.kind === 'ok' && (
        <ResultChip key="ok" tone="ok" onExpire={() => setProbe({ kind: 'idle' })}>{C.spTestOk}</ResultChip>
      )}
      {probe.kind === 'err' && (
        <ResultChip key="err" tone="err" onExpire={() => setProbe({ kind: 'idle' })}>{probe.text}</ResultChip>
      )}
    </span>
  )

  return (
    <Card title={C.sharepoint} tip={C.sharepointTip}>
      {!status.credentials ? (
        // Unconfigured: no probe offered — it can only fail, and the failure would teach an
        // operator nothing they cannot already read off «nicht eingerichtet». Anbindungen is
        // where this is actually fixed (same move as DataView's OpenCredentials).
        <EmptyState
          message={C.spNotSetUp}
          hint={C.spNotSetUpHint}
          action={onNavigate && (
            <button type="button" className="btn adm-int-btn" onClick={() => onNavigate('zugaenge')}>
              {C.spOpenCredentials}
            </button>
          )}
        />
      ) : !status.configured ? (
        // Credentials exist but no folder does yet — a warn-tone badge, not the neutral
        // «nicht eingerichtet» look, because this is a station one step further along that a
        // silent scheduler.py no-op would otherwise leave looking identical to «off».
        <>
          <StatusBadge tone="warn" label="" state={C.spNoSources} />
          <p className="adm-card-cap">{C.spNoSourcesHint}</p>
          {secretBadge}
          <div className="adm-sys-actions">{probeButton}</div>
        </>
      ) : (
        <>
          {secretBadge}
          <div className="adm-table-wrap">
            <table ref={tableRef} className="adm-table">
              <thead>
                <tr>
                  <th>{C.spArea}</th>
                  <th>{C.status}</th>
                  <th>{C.spLastSuccess}</th>
                </tr>
              </thead>
              <tbody>
                {status.areas.map((a) => (
                  <tr key={a.area}>
                    <td>
                      <span className="adm-ref-title">{C.spAreas[a.area] ?? a.area}</span>
                      {a.path && <p className="adm-sys-path">{a.path}</p>}
                    </td>
                    <td>
                      {/* Label-less: the first cell already names the area, so the badge is
                          dot + state only (same idiom as CredentialsView/MembersView). */}
                      <StatusBadge
                        tone={areaTone(a.status)}
                        label=""
                        state={C.spStates[a.status] ?? a.status}
                      />
                      {/* The server's own sentence — «AADSTS7000222: … expired» is the thing an
                          operator can act on, and translating it would lose the code. */}
                      {a.detail && <p className="adm-card-cap">{a.detail}</p>}
                    </td>
                    <td>
                      <span className="adm-time">{fmtDateTime(a.lastSuccessAt)}</span>
                      <p className="adm-card-cap">
                        {fillTemplate(C.spCounts, {
                          imported: String(a.imported),
                          skipped: String(a.skipped),
                          missing: String(a.missing),
                        })}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="adm-sys-actions">
            <button type="button" className="btn adm-int-btn" disabled={busy} onClick={() => void runNow()}>
              {/* Keep the refresh action recognizable; use the shared trail while it runs. */}
              {busy ? <ShellLoader /> : <Icon id="rotate" />}
              {busy ? C.spSyncing : C.spSyncNow}
            </button>
            {probeButton}
            {result && (
              <ResultChip key={result.text} tone={result.tone} onExpire={() => setResult(null)}>
                {result.text}
              </ResultChip>
            )}
          </div>
          {/* …and what it is doing. Determinate once the area has counted its files; a travelling
              stripe before that, and for a run this card can see but not measure. */}
          {(busy || progress) && (
            <ProgressBar
              done={progress?.done}
              total={progress?.total}
              label={progressLabel(C, progress)}
            />
          )}
        </>
      )}
      {/* Under every branch, including «nicht eingerichtet»: what the config already names is
          worth reading precisely while the connector is not running yet. */}
      <SharePointSources sources={sources} intervalMinutes={intervalMinutes} />
    </Card>
  )
}

// ─── client-side offline cache (this device's PWA storage) ─────────────────────

type CacheInfo = { name: string; entries: number }
type OfflineState =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'ok'; usage: number | null; quota: number | null; caches: CacheInfo[] }

async function readOfflineCache(): Promise<OfflineState> {
  const hasCaches = typeof caches !== 'undefined'
  const hasEstimate = typeof navigator !== 'undefined' && !!navigator.storage?.estimate
  if (!hasCaches && !hasEstimate) return { kind: 'unavailable' }

  let usage: number | null = null
  let quota: number | null = null
  if (hasEstimate) {
    try {
      const est = await navigator.storage.estimate()
      usage = est.usage ?? null
      quota = est.quota ?? null
    } catch { /* keep nulls */ }
  }

  const cacheList: CacheInfo[] = []
  if (hasCaches) {
    try {
      const keys = await caches.keys()
      await Promise.all(
        keys.map(async (name) => {
          try {
            const c = await caches.open(name)
            const reqs = await c.keys()
            cacheList.push({ name, entries: reqs.length })
          } catch {
            cacheList.push({ name, entries: 0 })
          }
        }),
      )
    } catch { /* leave list empty */ }
    // the tiles live in IndexedDB (lib/tileStore), one row per kind
    const kinds = ['map', 'plan', 'manifest'] as const
    const tiles = await Promise.all(kinds.map(async (kind) => ({ name: `kp-tiles/${kind}`, entries: await countTiles(kind) })))
    cacheList.push(...tiles.filter((t) => t.entries > 0))
    cacheList.sort((a, b) => a.name.localeCompare(b.name))
  }

  return { kind: 'ok', usage, quota, caches: cacheList }
}

function OfflineCacheCard() {
  const tableRef = useCellLabels()
  const [state, setState] = useState<OfflineState>({ kind: 'loading' })
  const [clearing, setClearing] = useState(false)
  const [cleared, setCleared] = useState(false)

  const reload = useCallback(async () => {
    setState({ kind: 'loading' })
    setState(await readOfflineCache())
  }, [])

  useEffect(() => { void reload() }, [reload])

  const C = appConfig.copy.admin.system

  // ⚠️ No `window.confirm()` — see BrandingFields for why one is worse than useless in an
  // installed PWA. The ask lives on the button itself now (ConfirmButton · admin/ui).
  const onClear = async () => {
    if (typeof caches === 'undefined') return
    setClearing(true)
    setCleared(false)
    try {
      const keys = await caches.keys()
      const [tiles] = await Promise.all([clearTiles(), ...keys.map((k) => caches.delete(k))])
      if (!tiles) throw new Error('tile store not cleared')
      setCleared(true)
      await reload()
    } catch {
      /* best-effort local maintenance — leave the prior view */
    } finally {
      setClearing(false)
    }
  }

  const totalEntries = state.kind === 'ok'
    ? state.caches.reduce((sum, c) => sum + c.entries, 0)
    : 0

  // ⚠️ The «Lokale Wartung …» paragraph used to sit UNDER the button it explains — the last line
  // of the card, read after the tap it was meant to inform. It is head ⓘ now, next to what the
  // cache itself is: same two sentences, one place, before the decision instead of after it.
  return (
    <Card
      title={C.offlineCache}
      tip={`${C.offlineCacheTip} ${C.offlineCacheCaption}`}
    >
      {state.kind === 'loading' && <EmptyState loading message={C.cacheReading} />}
      {state.kind === 'unavailable' && <EmptyState message={C.cacheUnavailable} />}
      {state.kind === 'ok' && (
        <>
          {/* ⚠️ A browser that reports no estimate says so IN THE ROW. It used to be a centred
              «nicht verfügbar»-block between two lists — the empty-state shape, in the middle of
              a card that is not empty, for one value that is simply unknown. */}
          {state.usage != null && state.quota != null && state.quota > 0 ? (
            <div className="adm-sys-storage">
              <Metric label={C.usedQuota} value={`${fmtFileSize(state.usage)} / ${fmtFileSize(state.quota)}`} />
              <UsageBar pctFilled={pct(state.usage, state.quota)} />
            </div>
          ) : (
            <Metric label={C.usedQuota} value={C.notAvailable} />
          )}

          <div className="adm-sys-caches">
            <Metric label={C.cacheStorage} value={fillTemplate(C.cacheSummary, { caches: state.caches.length, entries: totalEntries })} />
            {state.caches.length > 0 && (
              <div className="adm-table-wrap">
                <table ref={tableRef} className="adm-table">
                  <thead>
                    <tr>
                      <th>{C.cache}</th>
                      <th className="adm-num">{C.entries}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.caches.map((c) => (
                      <tr key={c.name}>
                        <td><span className="adm-mono">{c.name}</span></td>
                        <td className="adm-num adm-mono">{c.entries}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="adm-sys-actions">
            <ConfirmButton
              label={clearing ? C.clearing : C.clearCaches}
              question={C.clearConfirm}
              disabled={clearing || typeof caches === 'undefined'}
              onConfirm={() => void onClear()}
            />
            {cleared && (
              <ResultChip key="cleared" tone="ok" onExpire={() => setCleared(false)}>{C.cleared}</ResultChip>
            )}
          </div>
        </>
      )}
    </Card>
  )
}

// ─── server system status ──────────────────────────────────────────────────────

type ServerState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ok'; data: SystemResponse }

/**
 * System & Wartung — a READ-OUT, not a settings page, and it deliberately stays cards.
 *
 * ⚠️ Nothing here is a setting: Systemzustand, Verbindungen, Bestand and Speicher are
 * measurements the server took, and the only two controls on the page are actions
 * («Aktualisieren», «Caches leeren»). Pouring them into the settings table (ui.tsx ·
 * SettingsSheet) would put an Einstellung | Wert | Standard header over numbers that have no
 * default and cannot be typed — a table promising an edit for every row, none of which exists.
 * Explanatory prose still belongs in a ⓘ, so each card carries its own on the head.
 */
export function SystemView({ onNavigate }: { onNavigate?: (id: string) => void } = {}) {
  const tableRef = useCellLabels()
  const { draft } = useConfig()
  const [state, setState] = useState<ServerState>({ kind: 'loading' })
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const C = appConfig.copy.admin.system

  const load = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const data = await apiGet<SystemResponse>('/api/system')
      setState({ kind: 'ok', data })
      setUpdatedAt(new Date())
    } catch {
      setState({ kind: 'error' })
    }
  }, [])

  /** The same fetch without the loading card — after a button inside the page, so the page
   *  (and the button's own result chip) stays where it is while the new numbers arrive. */
  const reloadQuietly = useCallback(async () => {
    try {
      setState({ kind: 'ok', data: await apiGet<SystemResponse>('/api/system') })
      setUpdatedAt(new Date())
    } catch {
      // the visible numbers stay; the toolbar's «Aktualisieren» is the loud retry
    }
  }, [])

  // Fetched here rather than inside SharePointCard: the Einrichtung checklist needs the same
  // `credentials`/`configured` facts the card renders, and a status this cheap is one fetch
  // shared by both rather than two independent ones racing each other on every page load.
  const [spStatus, setSpStatus] = useState<SharePointStatus | null>(null)
  const [spFailed, setSpFailed] = useState(false)
  const loadSp = useCallback(async () => {
    try {
      setSpStatus(await apiGet<SharePointStatus>('/api/sharepoint/status'))
      setSpFailed(false)
    } catch {
      setSpFailed(true)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadSp() }, [loadSp])

  return (
    <div className="adm-editor">
      <div className="adm-sys-toolbar">
        <span className="adm-sys-updated">
          {updatedAt ? fillTemplate(C.updatedAt, { time: fmtClock(updatedAt) }) : C.liveSnapshot}
        </span>
        <button type="button" className="btn adm-int-btn" onClick={() => void load()} disabled={state.kind === 'loading'}>
          <Icon id="rotate" />
          {C.refresh}
        </button>
      </div>
      {state.kind === 'loading' && (
        <Card><EmptyState loading message={C.loading} /></Card>
      )}
      {state.kind === 'error' && (
        <Card><EmptyState tone="err" message={C.error} /></Card>
      )}

      {state.kind === 'ok' && (() => {
        const { version, database, counts, storage } = state.data
        const isProd = version?.env === 'production'
        /** A version cell's text. One fallback for all three: a server that answered without a
         *  version block says «nicht verfügbar» rather than three dashes that read as empty
         *  fields, and a present-but-blank field is the dash. */
        const vFact = (value: string | null | undefined): string =>
          version ? (value?.trim() ? value : '—') : C.notAvailable
        return (
          <>
            {/* First on the page, above the health read-out: a fresh instance's most useful
                question is «what still needs doing», and the card removes itself once the
                answer is «nothing». */}
            <SetupChecklist
              cfg={draft}
              setup={state.data.setup}
              facts={{
                users: counts?.users ?? null,
                personnelActive: counts?.personnel_active ?? null,
              }}
              onGo={(id) => onNavigate?.(id)}
            />
            {/* «Systemzustand» — the page's ONE primary status surface, and the only place for
                any of these six facts. Server/Datenbank/Umgebung used to sit in a strip and
                Release/Commit/Branch in a card of their own further down: two surfaces saying
                related things about the same running server, and «welcher Stand läuft hier
                gerade» meant reading both.
                ⚠️ Every cell is already labelled, so a badge here is dot + state only — a
                badge that repeats its own row label reads «Umgebung Umgebung Produktion».
                ⚠️ The raw env string («production») never reaches the UI; only the human label
                does. */}
            <Card title={C.healthSummary} tip={C.versionTip}>
              {/* ⚠️ The same key/value row «Bestand» and «Speicher» are built from, not six
                  bordered tiles: three cards standing side by side said the same kind of thing —
                  a label and one value — in two different shapes, and the tiles were the shape
                  that could not line up with anything. Two columns, because six rows of short
                  facts in one column make a tall card out of a glance. */}
              <div className="adm-sys-summary">
                <div className="adm-sys-metric">
                  <span className="adm-sys-metric-label">{C.server}</span>
                  <StatusBadge tone="on" label="" state={C.reachable} />
                </div>
                <div className="adm-sys-metric">
                  <span className="adm-sys-metric-label">{C.database}</span>
                  <StatusBadge tone={database?.ok ? 'on' : 'err'} label="" state={database?.ok ? C.ok : C.error2} />
                </div>
                <div className="adm-sys-metric">
                  <span className="adm-sys-metric-label">{C.environment}</span>
                  <StatusBadge tone={isProd ? 'on' : 'warn'} label="" state={isProd ? C.production : C.development} />
                </div>
                <div className="adm-sys-metric">
                  <span className="adm-sys-metric-label">{C.release}</span>
                  <span className="adm-sys-metric-value adm-mono">{vFact(version?.release ? `v${version.release}` : null)}</span>
                </div>
                <div className="adm-sys-metric">
                  <span className="adm-sys-metric-label">{C.commit}</span>
                  {/* Short hash in the cell, full one on hover: seven characters are what a git
                      command wants, and the full forty would push the label off a third of a row. */}
                  <span className="adm-sys-metric-value adm-mono" title={version?.commit || undefined}>
                    {vFact(version?.commit.slice(0, 7))}
                  </span>
                </div>
                <div className="adm-sys-metric">
                  <span className="adm-sys-metric-label">{C.branch}</span>
                  <span className="adm-sys-metric-value adm-mono">{vFact(version?.branch)}</span>
                </div>
              </div>
            </Card>
            <div className="adm-sys-grid">
            {/* Verbindungen — ONE table for everything this deployment talks to:
                provider integrations (Divera/Traccar) and every consumer/producer
                (print-relay agent with live heartbeat, capture poster, stats export,
                webhooks, web push, STT). Read-only; configured via env/CLI/admin. */}
            <Card title={C.connectors} tip={C.connectorsTip}>
              {state.data.integrations || state.data.connectors?.length ? (
                <div className="adm-table-wrap">
                  <table ref={tableRef} className="adm-table">
                    <thead>
                      <tr>
                        <th>{C.connection}</th>
                        <th>{C.domain}</th>
                        <th>{C.status}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(state.data.integrations?.providers ?? []).map((provider) => (
                        <tr key={`${provider.domain}:${provider.provider}`}>
                          <td><span className="adm-ref-title">{providerLabel(provider.provider)}</span></td>
                          <td>{provider.domain === 'personnel' ? C.personnelProvider : provider.domain === 'alarms' ? C.alarmProvider : C.vehicleProvider}</td>
                          <td>
                            {/* Label-less: the Verbindung cell already names the provider. */}
                            <StatusBadge
                              tone={provider.active ? 'on' : provider.configured ? 'warn' : 'off'}
                              label=""
                              state={provider.active ? C.active : provider.configured ? C.configured : C.notConfigured}
                            />
                          </td>
                        </tr>
                      ))}
                      {(state.data.connectors ?? []).map((conn) => {
                        const label = ({
                          divera_alarms: C.connDiveraAlarms,
                          traccar: C.connTraccar,
                          divera_personnel: C.connDiveraPersonnel,
                          roster_snapshot: C.connRosterSnapshot,
                          print_relay: C.connPrintRelay,
                          capture: C.connCapture,
                          stats: C.connStats,
                          divera_webhook: C.connDiveraWebhook,
                          alarm_webhook: C.connAlarmWebhook,
                          push: C.connPush,
                          stt: C.connStt,
                        } as Record<string, string>)[conn.id] ?? conn.id
                        // The polling rows are judged on their own health (last success + the
                        // per-connector staleness window); everything else still reads off the
                        // configured/state pair the server sends.
                        // A run the deactivation cap HELD is not an outage: the feed works, a
                        // person has to look at it. Its own word, and the cap's sentence below
                        // instead of the server's English refusal line.
                        const snapshot = conn.id === 'roster_snapshot' ? conn.counts as RosterSnapshotCounts | null | undefined : null
                        const held = Boolean(snapshot?.held)
                        const health = held
                          ? { tone: 'warn' as const, state: C.snapHeld }
                          : pollsFor(conn.id)
                          ? connectorHealth(conn, Date.now())
                          : {
                            tone: !conn.configured ? 'off' as const
                              : conn.state === 'offline' ? 'warn' as const : 'on' as const,
                            state: !conn.configured ? C.notConfigured
                              : conn.state === 'online' ? C.connOnline
                              : conn.state === 'offline' ? C.connOffline : C.configured,
                          }
                        // «N Abgänge warten» — what the «safe» level counts but deliberately
                        // does not act on. It is the one connector fact somebody has to GO
                        // somewhere to finish, so it is a link, not a sentence.
                        const leavers = conn.counts?.staleOutstanding ?? 0
                        return (
                          <tr key={conn.id}>
                            <td><span className="adm-ref-title">{label}</span></td>
                            <td>{conn.direction === 'in' ? C.directionIn : C.directionOut}</td>
                            <td>
                              <StatusBadge tone={health.tone} label="" state={health.state} />
                              {conn.id === 'print_relay' && conn.detail && (
                                <p className="adm-card-cap">
                                  {fillTemplate(C.connLastSeen, { time: fmtClock(new Date(conn.detail)) })}
                                </p>
                              )}
                              {pollsFor(conn.id) && conn.configured && conn.lastSuccess && (
                                <p className="adm-card-cap">
                                  {fillTemplate(C.connLastSuccess, { time: fmtRelTime(conn.lastSuccess) })}
                                </p>
                              )}
                              {/* The server's own sentence — «401 Unauthorized», «name or
                                  service not known» — is the searchable half, so it is printed
                                  rather than translated into «Fehler». */}
                              {conn.configured && conn.lastError && !held && (
                                <p className="adm-card-cap">{conn.lastError}</p>
                              )}
                              {conn.id === 'roster_snapshot' && conn.configured && (
                                <RosterSnapshotDetail counts={snapshot} onReload={reloadQuietly} />
                              )}
                              {leavers > 0 && onNavigate && (
                                <button
                                  type="button"
                                  className="btn adm-int-btn adm-sys-nudge"
                                  onClick={() => onNavigate('mannschaft')}
                                >
                                  {fillTemplate(C.connLeavers, { n: leavers })}
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : <EmptyState message={C.notAvailable} />}
            </Card>

            {/* Datenbank has no card of its own: the health strip above carries the same
                `database.ok`, and a card holding one badge added nothing. */}

            {/* Bestand */}
            <Card
              title={C.inventory}
              tip={C.inventoryTip}
            >
              {counts ? (
                <div className="adm-sys-counts">
                  <Metric label={C.incidentsTotal} value={fmtCount(counts.incidents)} />
                  <Metric label={C.incidentsOpen} value={fmtCount(counts.incidents_open)} />
                  <Metric label={C.personnelActive} value={fmtCount(counts.personnel_active)} />
                  <Metric label={C.users} value={fmtCount(counts.users)} />
                  <Metric label={C.referenceData} value={fmtCount(counts.reference_datasets)} />
                </div>
              ) : (
                <EmptyState message={C.notAvailable} />
              )}
            </Card>

            {/* Speicher */}
            <Card
              title={C.storage}
              tip={C.storageTip}
            >
              {storage ? (
                <>
                  <Metric label={C.mediaUsed} value={fmtFileSize(storage.used_bytes)} />
                  <Metric label={C.files} value={String(storage.file_count)} />
                  <Metric label={C.directory} value={storage.media_dir} />
                  {storage.disk_total_bytes != null ? (
                    <div className="adm-sys-storage">
                      <Metric
                        label={C.diskUsed}
                        value={`${fmtFileSize((storage.disk_total_bytes ?? 0) - (storage.disk_free_bytes ?? 0))} / ${fmtFileSize(storage.disk_total_bytes)}`}
                      />
                      <UsageBar
                        pctFilled={pct(
                          (storage.disk_total_bytes ?? 0) - (storage.disk_free_bytes ?? 0),
                          storage.disk_total_bytes,
                        )}
                        tone="amber"
                      />
                      <p className="adm-card-cap">{fillTemplate(C.free, { size: fmtFileSize(storage.disk_free_bytes) })}</p>
                    </div>
                  ) : (
                    // same rule as the cache card: an unknown value is still this row's value
                    <Metric label={C.diskUsed} value={C.notAvailable} />
                  )}
                </>
              ) : (
                <EmptyState message={C.notAvailable} />
              )}
            </Card>

            {/* What the station pulls in from its own SharePoint — and, above all, when it
                last managed to. */}
            <SharePointCard
              status={spStatus}
              sources={draft?.sharepoint?.sources ?? []}
              intervalMinutes={draft?.sharepoint?.intervalMinutes ?? spStatus?.intervalMinutes ?? null}
              failed={spFailed}
              onReload={loadSp}
              onNavigate={onNavigate}
            />

            {/* Client-side offline cache (this device) — a half-row card in the grid. */}
            <OfflineCacheCard />
            </div>
          </>
        )
      })()}

      {/* Offline cache stays reachable even when the server fetch fails. */}
      {state.kind !== 'ok' && <OfflineCacheCard />}
    </div>
  )
}
