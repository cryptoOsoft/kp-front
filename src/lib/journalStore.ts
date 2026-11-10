/*
 * A disposed journal store must never publish a late snapshot over its replacement.
 */

import { ApiError, apiBeacon, apiGet, apiPost, LONG_POLL_TIMEOUT_MS } from './api'
import { idbDel, idbKeys, idbRead, idbSet } from './idb'
import { journalSlot as KEY, legacyJournalSlot as LEGACY_KEY } from './journalSlots'
import { newId } from './ids'
import { rowPhotos, swapUrl } from './verlauf'
import type { TimelineEvent } from '../types'
import type { SyncStatus } from './api/workspaceSync'
import { isIncidentClosedRefusal, refusalClosedAt, reportIncidentClosed } from './incidentClosed'

/**
 * Journal (Verlauf) client store — the row-based replacement for the in-blob timeline.
 *
 * Rows are append-only records on the server (see backend/app/api/journal.py); this store
 * keeps the incident's local copy: fetched server rows (with their seq cursor), an offline
 * OUTBOX of rows not yet accepted (IDB-persisted, retried on poll/online + a keepalive
 * beacon at page teardown — the mediaQueue pattern), and a session-only overlay for blob:
 * URLs that must never be persisted.
 *
 * Invariants that matter (each guards a reviewed data-loss window):
 * - `latestSeq` (the pull cursor) is advanced ONLY by pull(), never by a flush response —
 *   a flush that jumped the cursor would skip rows other devices appended in between, and
 *   a lost-response retry (idempotent skip, empty accepted list) would skip our own.
 * - Legacy blob rows are echoed into every save FOREVER (bounded: the frozen pre-migration
 *   set). Shipping an empty timeline instead would merge as deletions and wipe the Verlauf
 *   on old-app devices mid-incident. New incidents start with no legacy → empty echo.
 * - A row the server REJECTS (4xx validation) must not wedge the outbox: flush drops to
 *   single-row mode to isolate it, dead-letters the poisoned row (kept visible locally),
 *   and keeps the rest flowing.
 * - persist() is skipped while read-only, so a demoted/viewer tab can never clobber the
 *   editing tab's persisted outbox under the shared IDB key.
 * - persist() writes ONCE per task, however many rows the task touched (see persist).
 */

/** What one live-follow round achieved: rows adopted · the server said «nothing» · no answer
 *  at all (offline, or the round was aborted). See JournalStore.pull. */
export type PullResult = 'new' | 'none' | 'failed'

interface ServerRow { seq: number; row: TimelineEvent }
interface JournalPage { entries: ServerRow[]; latest_seq: number }
/** `refused` (25.09.2026, N3): rows the server turned down because the Einsatz had been CLOSED by
 *  the time they arrived — a Kontakt tapped on a device that had not heard yet, the alarm clock's
 *  «Überfällig», a Tafel row queued offline. Unlike `dead` they are not an error anybody can fix:
 *  no retry delivers them while the Einsatz stays closed, so they are not part of the sync status
 *  and «Erneut versuchen» does not re-send them. They are not in the Verlauf either — the closed
 *  record is what it shows, and these rows are not in it. Kept, never dropped: persisted here,
 *  carried by `recoveryData` («Einträge sichern»), counted for the notice that says why — and
 *  sent again once the Einsatz runs again (`requeueRefused`, «Wieder öffnen»). Absent in older
 *  caches. */
interface Persisted { rows: ServerRow[]; latestSeq: number; outbox: TimelineEvent[]; dead?: TimelineEvent[]; refused?: TimelineEvent[] }

/** Whose outbox a store keeps: `key` is the identity (`<user id>:<link kind or 'login'>`), and
 *  `adoptsLegacy` says whether it takes over the shared pre-owner slot (the device login only). */
export interface JournalOwner { key: string; adoptsLegacy: boolean }

/** Merge snapshot `from` into `into`: rows by id; outbox, refused and dead deduped against what
 *  the server accepted and against each other. */
function mergePersisted(into: Persisted, from: Persisted): void {
  const rowIds = new Set(into.rows.map((r) => r.row.id))
  for (const r of from.rows ?? []) if (!rowIds.has(r.row.id)) into.rows.push(r)
  into.rows.sort((a, b) => a.seq - b.seq)
  const accepted = new Set(into.rows.map((r) => r.row.id))
  const pending = new Map([...(from.outbox ?? []), ...into.outbox].map((r) => [r.id, r]))
  into.outbox = [...pending.values()].filter((r) => !accepted.has(r.id))
  const refused = new Map([...(from.refused ?? []), ...(into.refused ?? [])].map((r) => [r.id, r]))
  into.refused = [...refused.values()].filter((r) => !accepted.has(r.id))
  for (const r of into.refused) pending.delete(r.id)
  into.outbox = into.outbox.filter((r) => !refused.has(r.id))
  const dead = new Map([...(from.dead ?? []), ...(into.dead ?? [])].map((r) => [r.id, r]))
  into.dead = [...dead.values()].filter((r) => !accepted.has(r.id) && !pending.has(r.id) && !refused.has(r.id))
  into.latestSeq = Math.max(into.latestSeq, from.latestSeq ?? 0)
}
const FLUSH_BATCH = 400
/** How soon a hydration whose IndexedDB read FAILED is tried again (see JournalStore.hydrate). */
const REREAD_MS = 5_000
// Same-page handoff only: rows entered before hydration have no safe full snapshot yet.
// The next writable store OF THE SAME SLOT (identity) merges them with its current cache;
// disposed stores never write.
const hydrationHandoffs = new Map<string, Map<string, TimelineEvent>>()

const isBlob = (u: string) => u.startsWith('blob:')

/** blob: object URLs are session-local — never persist them (display via the overlay).
 *  `photoUrls` is filtered ENTRY BY ENTRY: a row with one uploaded and one pending picture
 *  must persist the uploaded one and leave the pending one to the overlay. Dropping the key
 *  when nothing survives keeps a not-yet-uploaded row out of the append-only record. */
function stripSessionUrls(row: TimelineEvent): TimelineEvent {
  const { audioUrl, photoUrl, photoUrls, ...rest } = row
  const keptPhotos = (photoUrls ?? []).filter((u) => !isBlob(u))
  return {
    ...rest,
    ...(audioUrl && !isBlob(audioUrl) ? { audioUrl } : {}),
    ...(photoUrl && !isBlob(photoUrl) ? { photoUrl } : {}),
    ...(keptPhotos.length ? { photoUrls: keptPhotos } : {}),
  }
}

/** A refusal that retrying cannot fix: a malformed row (400/413/422) — or a row this session
 *  may not write at all (403; an Atemschutz-Link may only send «team» rows). Both are parked
 *  in `dead` rather than left at the head of the outbox blocking every row queued behind. */
const isPermanentRejection = (e: unknown): boolean =>
  e instanceof ApiError && (e.status === 400 || e.status === 403 || e.status === 413 || e.status === 422)

/**
 * Order display rows newest-first by the time they were WRITTEN (`at`).
 *
 * WHY: nothing else in the store carries written time. Server rows are ordered by `seq`, i.e.
 * the order the server ACCEPTED them, and the outbox is concatenated after all of them — so a
 * row written offline at 15:01 and flushed at 15:07 printed after everything written at 15:05,
 * and a pending row always printed newest whatever its timestamp. Rows show HH:MM only, so the
 * operator read that as random order within a minute. `at` is a full-precision ISO stamp, so
 * the written order is recoverable exactly — no change to what is stored or displayed.
 *
 * Pass the list in the order the store built it (newest-first, `seq` within a timestamp): the
 * sort is deliberately the plain `Array.prototype.sort`, whose stability ES2019 guarantees, so
 * rows sharing a millisecond keep exactly that incoming order and `seq` stays the tiebreak.
 *
 * A row whose `at` is missing or unparseable (legacy blob rows may carry only `t`) inherits the
 * key of the row before it rather than sorting as 0 — an undated row belongs where it already
 * sits between its neighbours, not flushed to one end of the Verlauf.
 */
/**
 * Verlauf rows this device still holds for the server, summed over the given incidents and read
 * straight off their persisted outboxes — for a surface with no live store to ask (the launcher's
 * «Abmelden», lib/logoutConfirm). Rejected rows count: they are just as unsent. An unreadable
 * slot counts 0 — the answer only PHRASES an ask, it never decides anything.
 */
export async function persistedPendingRows(incidentIds: readonly string[]): Promise<number> {
  const counts = await Promise.all(incidentIds.map(async (id) => {
    // every identity's slot and the legacy one — the ask is about this DEVICE's unsent rows
    const keys = await idbKeys(LEGACY_KEY(id))
    const reads = await Promise.all((keys.ok ? (keys.value ?? []) : [LEGACY_KEY(id)]).map((k) => idbRead<Persisted>(k)))
    return reads.reduce((n, read) => n + (read.ok && read.value ? (read.value.outbox?.length ?? 0) + (read.value.dead?.length ?? 0) : 0), 0)
  }))
  return counts.reduce((a, b) => a + b, 0)
}

export function chronological(rows: readonly TimelineEvent[]): TimelineEvent[] {
  let carry = Number.POSITIVE_INFINITY // a leading undated row has no predecessor: leave it on top
  return rows
    .map((row) => {
      const ms = row.at ? Date.parse(row.at) : Number.NaN
      if (!Number.isNaN(ms)) carry = ms
      return { row, key: carry }
    })
    .sort((a, b) => b.key - a.key)
    .map((d) => d.row)
}

export class JournalStore {
  private state: Persisted = { rows: [], latestSeq: 0, outbox: [], dead: [], refused: [] }
  /** legacy blob rows in CHRONOLOGICAL (oldest-first) order — the blob stores newest-first */
  private legacy: TimelineEvent[] = []
  /** stable echo for buildPayload — recreated ONLY when the legacy set changes, so the
   *  workspace save memo doesn't re-fire (and re-PUT the whole blob) on every journal row */
  private blobEcho: TimelineEvent[] = []
  private overlay = new Map<string, Partial<TimelineEvent>>()
  private flushing: Promise<void> | null = null
  /** somebody asked for a flush while one was in flight — see `flush` */
  private flushRequested = false
  private disposed = false
  private initDone = false
  private preHydrationAppends = new Map<string, TimelineEvent>()
  private initializing: Promise<void> | null = null
  private rehydrateRequested = false
  /** after a 4xx: send rows one at a time to isolate the poisoned one */
  private singleMode = false
  private readOnly: boolean
  private cacheDurable = true
  private writeSeq = 0
  private persisting = false
  /** a snapshot is owed and will be taken at the end of this task (persist · writeSnapshot) */
  private persistQueued = false
  private writeTail: Promise<void> = Promise.resolve()
  private deliveryFailure: 'offline' | 'error' | null = null
  /** The last hydration could not READ the cache (a failed IndexedDB read, not a miss). The
   *  stored snapshot may hold a predecessor's undelivered rows, so nothing is written over it —
   *  persist() is off — and the read is retried every REREAD_MS. Delivery keeps running: the
   *  server is the one place a row is safe while the local copy is unknown. */
  private readFailed = false
  /** the server has answered a pull since this store was made (see rowShown) */
  private pulled = false
  private rereadTimer: ReturnType<typeof setTimeout> | null = null
  onChange?: () => void

  /** this store's IndexedDB slot (KEY) — per identity, see JournalOwner */
  private readonly key: string
  private readonly adoptsLegacy: boolean

  /** `owner` null (no identity settled) keeps the shared legacy slot, as before 22.10.2026. */
  constructor(private readonly incidentId: string, readOnly: boolean, owner: JournalOwner | null = null) {
    this.readOnly = readOnly
    this.key = KEY(incidentId, owner?.key ?? null)
    this.adoptsLegacy = !!owner?.adoptsLegacy
  }

  /** read-only can flip at runtime (viewer role is fixed, but the tab lock isn't) */
  setReadOnly(v: boolean) {
    const was = this.readOnly
    // A write owed from THIS task was asked for while we still owned the tab: issue it now,
    // before the flip turns persist into a no-op (see persist).
    if (v && !was) this.writeSnapshot()
    this.readOnly = v
    // a read-only store writes nothing, so an unread cache no longer puts anything at risk here
    if (v) this.readFailed = false
    if (was && !v) {
      // The previous writer may have accumulated offline rows while this tab was read-only.
      // Re-read them before publishing this tab's own snapshot or starting a flush.
      this.initDone = false
      this.rehydrateRequested = true
      void this.init([...this.legacy].reverse())
    }
  }

  async init(legacyNewestFirst: TimelineEvent[]): Promise<void> {
    if (!this.initializing) this.initializing = (async () => {
      do {
        this.rehydrateRequested = false
        await this.hydrate(legacyNewestFirst)
      } while (this.rehydrateRequested && !this.disposed)
    })().finally(() => { this.initializing = null })
    // Network reads must not hold the hydration gate: promotion needs the current
    // writer's cache immediately, even while an earlier server request is stalled.
    await this.initializing
    await this.pull()
    await this.flush()
  }

  private async hydrate(legacyNewestFirst: TimelineEvent[]): Promise<void> {
    const read = await idbRead<Persisted>(this.key)
    // the shared pre-owner slot, taken over by the device login (JournalOwner · adoptsLegacy). A
    // failed read of it adopts nothing now and deletes nothing — the next hydrate tries again.
    const legacy = this.adoptsLegacy && !this.readOnly && this.key !== LEGACY_KEY(this.incidentId)
      ? await idbRead<Persisted>(LEGACY_KEY(this.incidentId))
      : null
    if (this.disposed) return
    // ⚠️ A failed read is not an empty cache. Read as one, the snapshot persisted below replaced
    // the stored outbox — the predecessor's (or this device's last session's) undelivered rows —
    // with this store's own state (23.09.2026). A read-only store writes nothing, so for it the
    // old «nothing cached» answer stays harmless and the rows come from the server as ever.
    if (!read.ok && !this.readOnly) {
      this.readFailed = true
      this.initDone = true
      this.ingestLegacy(legacyNewestFirst)
      this.emit()
      if (this.rereadTimer) clearTimeout(this.rereadTimer)
      this.rereadTimer = setTimeout(() => {
        this.rereadTimer = null
        if (this.disposed || !this.readFailed) return
        this.rehydrateRequested = true
        void this.init([...this.legacy].reverse())
      }, REREAD_MS)
      return
    }
    this.readFailed = false
    const cached = read.ok ? read.value : null
    // MERGE the snapshot into current state — rows may have been appended while the
    // idbGet was in flight, and replacing the state would silently drop them.
    if (cached) mergePersisted(this.state, cached)
    const adopted = legacy?.ok && legacy.value ? legacy.value : null
    if (adopted) mergePersisted(this.state, adopted)
    if (!this.readOnly) {
      const known = this.knownIds()
      for (const row of hydrationHandoffs.get(this.key)?.values() ?? []) {
        if (!known.has(row.id)) {
          this.state.outbox.push(row)
          this.cacheDurable = false
        }
      }
    }
    this.initDone = true
    this.ingestLegacy(legacyNewestFirst)
    this.persist()
    await this.landed()
    // the adopted rows are in this identity's slot now — only then does the shared one go
    if (adopted && this.cacheDurable && !this.disposed) await idbDel(LEGACY_KEY(this.incidentId))
  }

  /** Blob-timeline rows arriving at open or via any live-poll/merge inflow. */
  ingestLegacy(newestFirst: TimelineEvent[]) {
    if (this.disposed) return
    const next = [...newestFirst].reverse()
    const changed =
      next.length !== this.legacy.length || next.some((r, i) => r.id !== this.legacy[i]?.id)
    this.legacy = next
    if (changed) this.blobEcho = [...this.legacy].reverse()
    if (!this.readOnly && this.legacy.length) {
      const known = this.knownIds()
      const fresh = this.legacy.filter((r) => !known.has(r.id)).map(stripSessionUrls)
      if (fresh.length) {
        this.state.outbox.push(...fresh) // chronological → server seqs preserve the order
        this.persist()
        void this.flush()
      }
    }
    this.emit()
  }

  /** Append a new row (the single write path — every log/logPlan/composer row lands here). */
  append(row: TimelineEvent) {
    if (this.disposed) return
    // An upload callback may finish after this tab lost ownership. Keep its result for
    // recovery/promotion, but never imply it is durable or overwrite the new writer's cache.
    if (this.readOnly) this.cacheDurable = false
    if (row.audioUrl?.startsWith('blob:')) this.overlaySession(row.id, { audioUrl: row.audioUrl })
    if (row.photoUrl?.startsWith('blob:')) this.overlaySession(row.id, { photoUrl: row.photoUrl })
    // the overlay holds the FULL list (uploaded + pending) — it replaces the field wholesale
    // in display(), so a partial list here would hide the row's already-uploaded pictures
    if (row.photoUrls?.some(isBlob)) this.overlaySession(row.id, { photoUrls: row.photoUrls })
    const clean = stripSessionUrls(row)
    this.state.outbox.push(clean)
    if (!this.initDone || this.readFailed) {
      this.preHydrationAppends.set(clean.id, clean)
      this.cacheDurable = false // memory alone cannot survive page termination
    }
    this.persist()
    this.emit()
    if (this.initDone) void this.flush()
  }

  /** Later-arriving enrichment (transcript, uploaded media URL) — a NEW row, never an edit.
   *  Clearing a field sends '' (never undefined: JSON.stringify drops undefined keys, and
   *  the clear would un-apply once the outbox copy is replaced by the server row). */
  appendPatch(targetId: string, fields: Partial<Pick<TimelineEvent, 'transcript' | 'transcriptSection' | 'transcriptSectionEdit' | 'audioUrl' | 'photoUrl' | 'photoUrls' | 'photoGeo' | 'textEdit' | 'retracted'>>) {
    const at = new Date().toISOString()
    const clean = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v ?? '']))
    // two patches for one target can land in the same millisecond — on one device (newId's
    // counter) or on two (its random tail; a per-store counter restarted at 0 on each, 24.09.2026)
    this.append({ id: `${newId('tp')}-${targetId}`, t: '', at, icon: '', text: '', patchOf: targetId, ...clean })
  }

  /** Session-only display fields (blob: URLs from a fresh capture / the media-queue restore). */
  overlaySession(id: string, fields: Partial<TimelineEvent>) {
    this.overlay.set(id, { ...this.overlay.get(id), ...fields })
    this.emit()
  }

  /**
   * One picture of a row settled — an upload finished (`to` = server URL) or a queued capture
   * was restored after a reload (`to` = fresh blob: URL). Replaces THAT url and keeps the row's
   * other pictures.
   *
   * The row's current photos are read from the store HERE rather than passed in: between the
   * capture and the upload landing, a caller-captured copy is stale (a React callback holds the
   * rows array of whichever render created it), and folding a one-element list over the row is
   * how a three-photo entry ends up printing one picture.
   */
  swapPhoto(targetId: string, from: string, to: string) {
    const cur = this.display().find((r) => r.id === targetId)
    const next = swapUrl(rowPhotos(cur ?? {}), from, to)
    // pending pictures live in the overlay; once they have all uploaded it must go, or the
    // stale session list would keep winning over the patch in display()
    if (next.some(isBlob)) this.overlaySession(targetId, { photoUrls: next })
    else this.dropOverlayPhotos(targetId)
    const persistent = next.filter((u) => !isBlob(u))
    if (persistent.length && !isBlob(to)) this.appendPatch(targetId, { photoUrls: persistent })
    else this.emit()
  }

  private dropOverlayPhotos(id: string) {
    const cur = this.overlay.get(id)
    if (!cur || !('photoUrls' in cur)) return
    const { photoUrls: _dropped, ...rest } = cur
    if (Object.keys(rest).length) this.overlay.set(id, rest)
    else this.overlay.delete(id)
  }

  /** Concurrent callers await the same drain, including every successful follow-on batch.
   *
   *  ⚠️ A flush asked for WHILE an attempt is in flight is owed its own attempt if that one
   *  fails. The in-flight POST was sent under the old conditions: the `online` event, the poll
   *  round after a reconnect and «Erneut versuchen» all arrive precisely when an attempt that
   *  was doomed a moment ago may still be settling — and merely awaiting it dropped their retry.
   *  The row then sat on this device until the next live-follow round got round to flushing,
   *  which behind a held long poll is ~20 s later (e2e «offline journal entries survive reload
   *  and reconnect», 24.09.2026). One re-run per request, so an offline device does not spin. */
  flush(): Promise<void> {
    if (this.flushing) {
      this.flushRequested = true
      return this.flushing
    }
    if (!this.initDone || this.readOnly || this.disposed || !this.state.outbox.length) return Promise.resolve()
    this.flushing = (async () => {
      do {
        this.flushRequested = false
        if (await this.drain()) return
      } while (this.flushRequested && this.initDone && !this.readOnly && !this.disposed && this.state.outbox.length)
    })().finally(() => { this.flushing = null })
    return this.flushing
  }

  /** Send the outbox batch by batch. `true` = emptied; `false` = a batch failed and the rest
   *  waits for the next poll/online/manual retry. */
  private async drain(): Promise<boolean> {
    while (this.initDone && !this.readOnly && !this.disposed && this.state.outbox.length) {
      if (!(await this.flushBatch())) return false // failures wait for the existing poll/online retry
    }
    if (!this.disposed && !this.readOnly) void this.pull() // converge without moving the push cursor
    return true
  }

  private async flushBatch(): Promise<boolean> {
    let accepted = false
    try {
      const batch = this.state.outbox.slice(0, this.singleMode ? 1 : FLUSH_BATCH)
      const res = await apiPost<JournalPage>(`/api/incidents/${this.incidentId}/journal`, { entries: batch })
      if (this.disposed) return false
      this.deliveryFailure = null
      // the server accepted (or idempotently already held) every row in the batch
      const sent = new Set(batch.map((r) => r.id))
      this.state.outbox = this.state.outbox.filter((r) => !sent.has(r.id))
      this.adoptRows(res.entries) // display only — the pull cursor NEVER advances here
      if (!this.state.outbox.length) this.singleMode = false
      this.persist()
      this.emit()
      accepted = true
    } catch (e) {
      // The Einsatz was closed before these rows arrived (N3): not a failure — park, don't redden.
      // A batch is refused whole, so the refused row is isolated the way a poisoned one is: one
      // row at a time, and the record rows (a Meldung, a patch) still go through beside it.
      if (isIncidentClosedRefusal(e)) {
        if (this.singleMode || this.state.outbox.length === 1) {
          const [refused, ...rest] = this.state.outbox
          this.state.refused = [...(this.state.refused ?? []), refused]
          this.state.outbox = rest
          if (!rest.length) this.singleMode = false
          this.deliveryFailure = null
          this.persist()
          reportIncidentClosed({ incidentId: this.incidentId, closedAt: refusalClosedAt(e), source: 'refusal' })
          this.emit()
          // the next row may be one the closed record still takes — keep draining
          return !this.disposed
        }
        this.singleMode = true
        return !this.disposed
      }
      this.deliveryFailure = e instanceof ApiError && e.status === 0 ? 'offline' : 'error'
      if (isPermanentRejection(e)) {
        if (this.singleMode || this.state.outbox.length === 1) {
          // the poisoned row itself — dead-letter it so the rest of the journal keeps flowing
          // (kept locally + in IDB for diagnosis; the row stays visible on this device)
          const [bad, ...rest] = this.state.outbox
          this.state.dead = [...(this.state.dead ?? []), bad]
          this.state.outbox = rest
          console.error('Journalzeile vom Server abgelehnt — lokal zurückgestellt:', bad?.id, e)
          this.persist()
          this.emit()
        } else {
          this.singleMode = true // isolate the poisoned row one-by-one on the next flushes
        }
      }
      /* transient (offline / 5xx) — outbox stays, retried on the next poll tick or 'online' */
      this.emit()
    }
    return accepted
  }

  /** Last-ditch teardown push (pagehide / app swiped away): the outbox rides a keepalive
   *  beacon the browser completes after the page is gone. Idempotent server → a double
   *  send with the next regular flush is harmless. */
  flushKeepalive(): void {
    if (this.readOnly || this.disposed || !this.state.outbox.length) return
    apiBeacon(`/api/incidents/${this.incidentId}/journal`, { entries: this.state.outbox.slice(0, FLUSH_BATCH) })
  }

  /** Fetch rows newer than our cursor (the live-follow round; an empty page is a few bytes).
   *  The ONLY place the cursor advances — seqs below it are guaranteed fetched.
   *
   *  `wait` asks the server to HOLD the request (~20 s) until a row is appended, instead of
   *  answering «nothing» immediately: a Verlaufszeile dictated on another device lands here as
   *  soon as it commits, and a quiet Verlauf costs one request per 20 s. `signal` aborts that
   *  held request when the loop restarts or tears down.
   *
   *  The outcome is a three-way answer, not a boolean, because the loop treats the two
   *  non-productive cases differently: 'none' means the server answered (go straight into the
   *  next round), 'failed' means it didn't (ease off before retrying). */
  async pull(opts?: { wait?: boolean; signal?: AbortSignal }): Promise<PullResult> {
    if (this.disposed) return 'none'
    const wait = opts?.wait ?? false
    try {
      const res = await apiGet<JournalPage>(
        `/api/incidents/${this.incidentId}/journal?since_seq=${this.state.latestSeq}${wait ? '&wait=1' : ''}`,
        { signal: opts?.signal, timeoutMs: wait ? LONG_POLL_TIMEOUT_MS : undefined },
      )
      if (this.disposed) return 'none'
      // the FIRST answered pull changes `rowShown` from «unknown» to an answer even when it brings
      // nothing — say so, or a receipt waiting on it never replays (Codex review, 26.10.2026)
      const firstPull = !this.pulled
      this.pulled = true
      if (!res.entries.length) {
        if (firstPull) this.emit()
        return 'none'
      }
      this.adoptRows(res.entries)
      this.state.latestSeq = Math.max(this.state.latestSeq, res.latest_seq)
      // another device may have pushed rows we still hold in the outbox (migration overlap)
      const server = new Set(this.state.rows.map((r) => r.row.id))
      this.state.outbox = this.state.outbox.filter((r) => !server.has(r.id))
      this.state.dead = (this.state.dead ?? []).filter((r) => !server.has(r.id))
      this.state.refused = (this.state.refused ?? []).filter((r) => !server.has(r.id))
      this.persist()
      this.emit()
      return 'new'
    } catch {
      /* offline (or the round was aborted) — the cached copy stands */
      return 'failed'
    }
  }

  /** What buildPayload embeds in the blob: the FROZEN legacy echo (bounded — pre-migration
   *  rows only, so old-app devices in a mixed-version incident never see a merge-deletion
   *  of their Verlauf). New rows never enter the blob; new incidents echo nothing. Stable
   *  identity so the workspace save memo doesn't re-fire per journal row. */
  blobTimeline(): TimelineEvent[] {
    return this.blobEcho
  }

  /** rows waiting for the server (report preflight / sync hints) */
  get pendingCount(): number {
    return this.state.outbox.length
  }

  get rejectedCount(): number {
    return this.state.dead?.length ?? 0
  }

  /** rows the closed Einsatz no longer took — parked, not owed (see Persisted · refused) */
  get refusedCount(): number {
    return this.state.refused?.length ?? 0
  }

  /** The Einsatz runs again («Wieder öffnen»): the parked rows go back into the outbox, oldest
   *  first, and out — they print as Nachträge. A fresh refusal (closed again meanwhile) parks
   *  them again; nothing is dropped either way. */
  async requeueRefused(): Promise<void> {
    if (this.initializing) await this.initializing
    if (this.readOnly || this.disposed || !this.state.refused?.length) return
    const queued = new Set(this.state.outbox.map((r) => r.id))
    this.state.outbox.push(...this.state.refused.filter((r) => !queued.has(r.id)))
    this.state.refused = []
    this.singleMode = false
    this.persist()
    this.emit()
    await this.landed()
    await this.flush()
  }

  /** A synced workspace must not hide an unsent or undurable journal. */
  get syncStatus(): SyncStatus {
    // an unread cache may hold undelivered rows: nothing can be called acknowledged yet
    if (this.readFailed) return 'storage'
    if (!this.pendingCount && !this.rejectedCount) return 'synced'
    if (!this.cacheDurable) return 'storage'
    if (this.persisting) return 'pending'
    if (this.rejectedCount) return 'error'
    return this.deliveryFailure ?? 'pending'
  }

  /** Retry with the original row IDs, including explicitly rejected rows. */
  async retry(): Promise<void> {
    if (this.initializing) await this.initializing
    if (this.readOnly || this.disposed) return
    this.state.outbox.push(...(this.state.dead ?? []))
    this.state.dead = []
    this.singleMode = false
    this.deliveryFailure = null
    this.persist()
    this.emit()
    await this.landed()
    await this.flush()
    await this.landed()
  }

  /** Portable recovery copy; exporting never acknowledges or removes queued work. */
  recoveryData() {
    return {
      version: 1,
      incidentId: this.incidentId,
      entries: [...this.state.outbox, ...(this.state.dead ?? [])],
      // not in `entries`: those are owed, these the closed Einsatz refused (Persisted · refused)
      refused: [...(this.state.refused ?? [])],
    }
  }

  /** The UI's timeline: union (server ∪ legacy-not-yet-on-server ∪ outbox ∪ dead-lettered),
   *  patches folded, session overlays applied, and finally ordered newest-first by written
   *  time (`chronological`) — the union order is `seq` per source, which is acceptance order,
   *  not the order the operator wrote the rows. */
  display(): TimelineEvent[] {
    const out: TimelineEvent[] = []
    const seen = new Set<string>()
    const push = (r: TimelineEvent) => {
      if (!seen.has(r.id)) { seen.add(r.id); out.push(r) }
    }
    for (const r of this.state.rows) push(r.row)
    for (const r of this.legacy) push(r)
    for (const r of this.state.outbox) push(r)
    for (const r of this.state.dead ?? []) push(r)
    // fold enrichment patches onto their targets, hide the patch rows
    const patched = new Map(out.filter((r) => !r.patchOf).map((r) => [r.id, r]))
    for (const p of out) {
      if (!p.patchOf) continue
      const target = patched.get(p.patchOf)
      if (!target || target.id.startsWith('sys')) continue // server boundaries cannot be corrected by a client patch
      const { id: _i, t: _t, at: _a, icon: _ic, text: _tx, patchOf: _p, textEdit, transcriptSection, transcriptSectionEdit, ...fields } = p
      const folded = patched.get(p.patchOf)!
      patched.set(target.id, {
        ...folded,
        ...fields,
        // a text correction rides in `textEdit` (patch rows carry a filler text: '') — and the
        // patch's own time comes along as `correctedAt`, so the Verlauf can say the line was
        // corrected instead of silently showing different words than were written (see types).
        // `textOriginal` keeps the FIRST wording across any number of corrections — the printed
        // rapport shows original + latest and skips the intermediates.
        ...(textEdit ? { text: textEdit, correctedAt: p.at, textOriginal: folded.textOriginal ?? folded.text } : {}),
        // transcript sections ACCUMULATE (each patch carries one; its id addresses the section),
        // sorted by offset so the subtitle list reads in recording order however they arrived
        ...(transcriptSection
          ? { transcriptSections: [...(folded.transcriptSections ?? []), { id: p.id, ...transcriptSection }].sort((a, b) => a.at - b.at) }
          : {}),
        // …and an edit REPLACES one section's words in place (empty text removes it). No
        // «korrigiert» mark: the recording is the original; its transcription may be fixed.
        ...(transcriptSectionEdit
          ? {
              transcriptSections: (folded.transcriptSections ?? [])
                .map((s) => (s.id === transcriptSectionEdit.id ? { ...s, text: transcriptSectionEdit.text } : s))
                .filter((s) => s.text.trim() !== ''),
            }
          : {}),
      })
    }
    // retracted rows fold out of display entirely (the record keeps original + retraction)
    const rows = out.filter((r) => !r.patchOf).map((r) => patched.get(r.id)!).filter((r) => !r.retracted)
    // session overlay last (blob: URLs beat everything for display)
    const withOverlay = rows.map((r) => (this.overlay.has(r.id) ? { ...r, ...this.overlay.get(r.id) } : r))
    // reverse first (newest-first, `seq` within), then order by written time — the reverse is
    // what makes `seq` descending, which is the tiebreak the stable sort then preserves
    return chronological(withOverlay.reverse())
  }

  dispose() {
    if (this.disposed) return
    this.writeSnapshot() // the last append of this task was asked for before the close
    if (this.preHydrationAppends.size) {
      const pending = hydrationHandoffs.get(this.key) ?? new Map<string, TimelineEvent>()
      for (const [id, row] of this.preHydrationAppends) pending.set(id, row)
      hydrationHandoffs.set(this.key, pending)
      this.preHydrationAppends.clear()
    }
    if (this.rereadTimer) { clearTimeout(this.rereadTimer); this.rereadTimer = null }
    this.disposed = true
  }

  /** Is this store shut down? React StrictMode mounts an effect, tears it down and mounts it
   *  again — and the store lives in a ref that survives that, so the second mount would inherit
   *  a DISPOSED store whose `append` silently drops every row. See `revive`. */
  get isDisposed(): boolean {
    return this.disposed
  }

  /** Bring a disposed store back for a re-mount of the same incident. Only the StrictMode
   *  double-mount does this in practice; a real unmount is followed by a new store. */
  revive() {
    this.disposed = false
  }

  /** merge fetched/accepted rows into the local set — display state, no cursor movement */
  private adoptRows(entries: ServerRow[]) {
    const have = new Set(this.state.rows.map((r) => r.row.id))
    for (const e of entries) {
      // the journal API validates no row shape — a row without a string id is not a row, and
      // `text`/`t` are what the Verlauf trims and prints, so they are coerced rather than trusted
      const row = e?.row as Partial<TimelineEvent> | undefined
      if (!row || typeof row.id !== 'string') continue
      if (typeof row.text !== 'string') row.text = ''
      if (typeof row.t !== 'string') row.t = ''
      if (!have.has(row.id)) { have.add(row.id); this.state.rows.push(e) }
    }
    this.state.rows.sort((a, b) => a.seq - b.seq)
  }

  /**
   * Does the display show this row NOW? `false` = loaded, and it does not: retracted, parked, or
   * no such row anywhere. `undefined` = cannot tell yet: the cache is not read (or that read
   * failed), or the server has not answered a pull. For a late enrichment (useMediaOutbox ·
   * receipts, audit F06): a rendered `rows` copy hides a retracted row exactly like one that has
   * not loaded — or not rendered — yet, and only the first must not be waited for forever.
   */
  rowShown(id: string): boolean | undefined {
    if (this.display().some((r) => r.id === id)) return true
    return this.initDone && !this.readFailed && this.pulled ? false : undefined
  }

  private knownIds(): Set<string> {
    const s = new Set(this.state.rows.map((r) => r.row.id))
    for (const r of this.state.outbox) s.add(r.id)
    for (const r of this.state.dead ?? []) s.add(r.id)
    for (const r of this.state.refused ?? []) s.add(r.id)
    return s
  }

  /**
   * Ask for the state to be written to IndexedDB.
   *
   * ⚠️ Coalesced to ONE write per task (perf sweep 23.09.2026). Every write is a structured
   * clone of the WHOLE Verlauf plus an IDB put, and it used to run per row: a burst — a pulled
   * page, a batch of legacy rows, an action that logs several lines, a patch cascade — cloned
   * and rewrote everything once per row. Now the snapshot is taken in a microtask at the end
   * of the task that asked, so the burst costs one. Deliberately a MICROTASK and not a timer:
   * the transaction is still created inside the task that made the edit, i.e. while this tab
   * still owns it (see writeSnapshot), and nothing — a tab handover, a page teardown — can run
   * in between. The few paths that end ownership or wait for the write in the SAME task
   * (setReadOnly, dispose, landed) issue it on the spot.
   *
   * «Saved» stays truthful: `persisting` is raised HERE, at the ask, and `syncStatus` says
   * 'pending' from that moment until the write that carries it has landed.
   */
  private persist() {
    // a read-only store (viewer, or an editor tab demoted by the tab lock) must never
    // write the shared per-incident IDB key — it would clobber the editing tab's outbox.
    // Disposal blocks new snapshots; already-issued IDB writes still finish below.
    if (this.readOnly || !this.initDone || this.readFailed || this.disposed) return
    this.persisting = true
    if (this.persistQueued) return
    this.persistQueued = true
    queueMicrotask(() => this.writeSnapshot())
  }

  /** Issue the owed write NOW, and resolve once every write issued so far has landed. */
  private landed(): Promise<void> {
    this.writeSnapshot()
    return this.writeTail
  }

  /** Take the owed snapshot and write it (a no-op when none is owed). */
  private writeSnapshot() {
    if (!this.persistQueued) return
    this.persistQueued = false
    // owed while we were the writer, but the store has since been shut or demoted by a path
    // that did not land it first, or a re-hydration has since failed to READ the slot (see
    // readFailed: nothing is written over it) — the rows are in memory only, and the status
    // must say so
    if (this.readOnly || !this.initDone || this.readFailed || this.disposed) { this.persisting = false; this.cacheDurable = false; this.emit(); return }
    const snapshot = structuredClone(this.state)
    const seq = ++this.writeSeq
    // Start the transaction while we still own the tab. IDB orders these writes; deferring
    // its creation until an earlier write settles can cross a tab handover and lose the last edit.
    const write = idbSet(this.key, snapshot)
    this.writeTail = Promise.all([this.writeTail, write]).then(([, durable]) => {
      // a newer write — issued, or owed and about to be — decides the status, not this one
      if (seq !== this.writeSeq || this.persistQueued) return
      this.cacheDurable = durable
      if (durable) {
        // Clear only rows actually contained in this committed snapshot. A new append can
        // arrive during another hydration while an older write is still settling.
        const ids = new Set([...snapshot.rows.map((r) => r.row.id), ...snapshot.outbox.map((r) => r.id), ...(snapshot.dead ?? []).map((r) => r.id), ...(snapshot.refused ?? []).map((r) => r.id)])
        const handed = hydrationHandoffs.get(this.key)
        for (const id of ids) { this.preHydrationAppends.delete(id); handed?.delete(id) }
        if (handed?.size === 0) hydrationHandoffs.delete(this.key)
      }
      this.persisting = false
      this.emit()
    })
  }

  private emit() {
    this.onChange?.()
  }
}
