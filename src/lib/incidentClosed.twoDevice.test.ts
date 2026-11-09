import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// TWO DEVICES, ONE EINSATZ, CLOSED ON ONE OF THEM (N3, staging walk-through 25.09.2026).
//
// Phone A closes the Einsatz. Phone B was offline at that moment with a Kontakt queued — the
// Tafel save, its «team» row and its `atemschutz.contact` event — plus an ordinary Meldung. The
// REAL engines of phone B (WorkspaceSync, JournalStore, AuditEventStore) run over the REAL fetch
// wrapper (lib/api — so the `{code, message}` refusal is parsed exactly as in the field) against
// ONE in-memory server that implements the backend's contract (incident_service · incident_closed):
// once closed, a live write is 409 `incident_closed`, a record write still lands, and every
// workspace read carries `X-Incident-Open`.
//
// What must hold when phone B comes back: it HEARS the close (from the poll and from its own
// refusals), nothing live reaches the closed record, the Meldung does, every refused write is
// still on the device and in the export, and no outbox is left red or retrying.

type Row = { id: string; kind?: string; [k: string]: unknown }
const server = vi.hoisted(() => ({
  open: true,
  closedAt: null as string | null,
  rev: 1,
  ws: {} as Record<string, unknown>,
  rows: [] as Row[],
  events: [] as { client_id: string; op_type: string }[],
  online: true,
  recordPuts: 0,
}))
const RECORD_KEYS = ['attendance', 'shifts', 'bands', 'mittel', 'checklists', 'reportMeta', 'attachments', 'reportSignatures']
const RECORD_EVENTS = ['attendance.', 'checklist.', 'mittel.', 'report.', 'journal.', 'reminder.', 'weather.', 'shift.']
const LIVE_KINDS = ['team', 'symbol', 'layer', 'vehicle']

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
const lifecycle = (): Record<string, string> =>
  server.open ? { 'X-Incident-Open': '1' } : { 'X-Incident-Open': '0', 'X-Incident-Closed-At': server.closedAt ?? '' }
// the backend's rule (incident_service · happened_after_close): after the close + 120 s, or no stamp
const afterClose = (at: unknown) => {
  const t = typeof at === 'string' ? Date.parse(at) : Number.NaN
  return !Number.isFinite(t) || t > Date.parse(server.closedAt ?? '') + 120_000
}
const VIEW_KEYS = ['activePlanId', 'activeModule', 'layerState', 'recent', 'cameraViews', 'pickedObjectId', 'planBindings', 'intakeReviewedAt', 'schemaVersion']
const refused = () => json(409, { detail: { code: 'incident_closed', message: 'Einsatz ist abgeschlossen – nicht mehr übernommen', closed_at: server.closedAt } })

async function fakeFetch(input: string, init: RequestInit = {}): Promise<Response> {
  if (!server.online) throw new TypeError('Failed to fetch')
  const url = new URL(input, 'http://kp.test')
  const method = init.method ?? 'GET'
  const body = init.body ? JSON.parse(String(init.body)) : undefined
  const path = url.pathname.replace(/^\/api\/incidents\/[^/]+/, '')
  if (path === '/workspace' && method === 'GET') {
    const since = url.searchParams.get('since')
    if (since !== null && Number(since) === server.rev) return new Response(null, { status: 304, headers: lifecycle() })
    return json(200, { workspace: structuredClone(server.ws), workspace_rev: server.rev }, lifecycle())
  }
  if (path === '/workspace' && method === 'PUT') {
    if (body.base_rev !== server.rev) return json(409, { detail: { message: 'Workspace wurde zwischenzeitlich geändert', server_rev: server.rev } })
    if (!server.open) {
      const keys = new Set([...Object.keys(server.ws), ...Object.keys(body.workspace)])
      const changed = [...keys].filter((k) => !RECORD_KEYS.includes(k) && !VIEW_KEYS.includes(k) && JSON.stringify(server.ws[k]) !== JSON.stringify(body.workspace[k]))
      if (changed.length && afterClose(body.edited_at)) return refused()
    }
    server.ws = structuredClone(body.workspace)
    server.rev += 1
    return json(200, { workspace: null, workspace_rev: server.rev })
  }
  if (path === '/journal' && method === 'POST') {
    const entries = body.entries as Row[]
    const have = new Set(server.rows.map((r) => r.id))
    if (!server.open && entries.some((e) => LIVE_KINDS.includes(e.kind ?? '') && !e.conflict && !have.has(e.id) && afterClose(e.at))) return refused()
    const accepted = entries.filter((e) => !have.has(e.id))
    server.rows.push(...accepted)
    return json(201, { entries: accepted.map((row) => ({ seq: server.rows.indexOf(row) + 1, row })), latest_seq: server.rows.length })
  }
  if (path === '/journal' && method === 'GET') {
    const since = Number(url.searchParams.get('since_seq') ?? 0)
    return json(200, { entries: server.rows.slice(since).map((row, i) => ({ seq: since + i + 1, row })), latest_seq: server.rows.length })
  }
  if (path === '/events' && method === 'POST') {
    const events = body.events as { client_id: string; op_type: string }[]
    if (!server.open && events.some((e) => !RECORD_EVENTS.some((p) => e.op_type.startsWith(p)) && afterClose((e as { occurred_at?: string }).occurred_at))) return refused()
    server.events.push(...events)
    return json(201, [])
  }
  // the trupp slice (api/incidents · put_workspace_trupps): an editor's Trupp-only save goes here
  // too (workspaceSync · onlyTruppsChanged). The close is judged FIRST, then the revision.
  if (path === '/workspace/trupps' && method === 'PUT') {
    if (!server.open && afterClose(body.edited_at)) return refused()
    if (body.base_rev !== server.rev) return json(409, { detail: { message: 'Workspace wurde zwischenzeitlich geändert', server_rev: server.rev } })
    server.ws = { ...server.ws, trupps: structuredClone(body.trupps) }
    server.rev += 1
    return json(200, { workspace: null, workspace_rev: server.rev })
  }
  if (path === '/workspace/record' && method === 'PUT') {
    if (body.base_rev !== server.rev) return json(409, { detail: { message: 'Workspace wurde zwischenzeitlich geändert', server_rev: server.rev } })
    server.recordPuts++
    server.ws = { ...server.ws, ...structuredClone(body.workspace) }
    server.rev += 1
    return json(200, { workspace: null, workspace_rev: server.rev })
  }
  if (path === '' && method === 'PATCH') {
    if (body.is_archived === true && server.open) { server.open = false; server.closedAt = '2026-09-25T12:45:00+00:00' }
    if (body.is_archived === false) server.open = true // «Wieder öffnen» — closed_at is kept, as on the server
    return json(200, { id: 'inc', is_archived: !server.open, status: 'offen', closed_at: server.closedAt })
  }
  return json(404, { detail: 'Einsatz nicht gefunden' })
}

const { serverRoundTrip } = await import('./jsonb.test-utils')
const { __resetIdbForTests } = await import('./idb')
const { WorkspaceSync } = await import('./api/workspaceSync')
const { pollWorkspaceSince } = await import('./api/workspace')
const { archiveIncident, reactivateIncident } = await import('./api/incidents')
const { JournalStore } = await import('./journalStore')
const { AuditEventStore } = await import('./auditEventStore')
const { onIncidentClosed, onIncidentReopened } = await import('./incidentClosed')

const INC = 'inc'
const TRUPP = { id: 'tr2', name: 'Trupp 2', status: 'drin', lastContactTime: '2026-09-25T12:40:00Z' }
/** made after the close (12:45) + the clock tolerance */
const LATE = '2026-09-25T12:50:00Z'
/** made before it — true, and recorded, however late it arrives */
const EARLY = '2026-09-25T12:44:00Z'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  __resetIdbForTests()
  Object.assign(server, {
    open: true, closedAt: null, rev: 1, rows: [], events: [], online: true, recordPuts: 0,
    ws: { trupps: [TRUPP], reportMeta: { kurzbericht: 'Brand gelöscht' }, entities: [] },
  })
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('a close on phone A reaches phone B, and B’s late Tafel writes are refused and kept', () => {
  it('B hears it, nothing live lands in the record, the Meldung does, everything refused is kept', async () => {
    const heard: { source: string; closedAt?: string | null }[] = []
    const off = onIncidentClosed((s) => { if (s.incidentId === INC) heard.push(s) })

    // phone B opens the running Einsatz
    const sync = new WorkspaceSync(INC, { debounceMs: 60_000 })
    const { workspace, rev } = await sync.init()
    expect(rev).toBe(1)
    const journal = new JournalStore(INC, false)
    await journal.init([])
    const audit = new AuditEventStore(INC, 'user-b:login', false)
    audit.start()
    let shown: Record<string, unknown> = workspace ?? {}
    sync.onApplyMerged = (ws) => { shown = ws }

    // …loses the network and taps «Kontakt» on Trupp 2, then writes a Meldung
    server.online = false
    const kontakt = { ...TRUPP, lastContactTime: LATE }
    sync.save({ ...shown, trupps: [kontakt] })
    journal.append({ id: 'r-kontakt', t: '14:50', at: LATE, icon: 'radio', text: 'Trupp 2 – Kontakt bestätigt', kind: 'team' })
    journal.append({ id: 'r-meldung', t: '14:47', at: '2026-09-25T12:47:00Z', icon: 'type', text: 'Hauswart informiert', kind: 'journal' })
    audit.append({ client_id: 'ev-kontakt', op_type: 'atemschutz.contact', payload: { id: 'tr2' }, occurred_at: LATE })
    await sync.flush()
    await journal.flush()
    await audit.flush()
    expect(sync.hasUnsynced).toBe(true)
    expect(journal.pendingCount).toBe(2)

    // phone A closes the Einsatz (useIncidentLifecycle · completeRapport's archive, over the same wrapper)
    server.online = true
    await archiveIncident(INC)
    expect(server.open).toBe(false)

    // phone B is back: its live poll answers with the lifecycle — the 304 included
    expect(await pollWorkspaceSince(INC, sync.rev)).toBeNull()
    expect(heard.some((s) => s.source === 'poll')).toBe(true)

    // …and its outboxes deliver what they queued
    await sync.flush()
    for (let i = 0; i < 4; i++) await journal.flush()
    await audit.flush()
    await new Promise((r) => setTimeout(r, 0))

    // nothing live reached the closed record; the Meldung did
    expect((server.ws.trupps as typeof TRUPP[])[0].lastContactTime).toBe('2026-09-25T12:40:00Z')
    expect(server.rev).toBe(1)
    expect(server.rows.map((r) => r.id)).toEqual(['r-meldung'])
    expect(server.events).toEqual([])
    expect(heard.filter((s) => s.source === 'refusal').length).toBeGreaterThanOrEqual(3)
    expect(heard.find((s) => s.source === 'refusal')?.closedAt).toBe('2026-09-25T12:45:00+00:00')

    // every refused write is still on the device, in the export, and not owed
    expect(sync.refusedCount).toBe(1)
    expect(sync.refusedRecoveryData()[0].workspace.trupps).toEqual([kontakt])
    expect(journal.refusedCount).toBe(1)
    expect(journal.recoveryData().refused.map((r) => r.id)).toEqual(['r-kontakt'])
    expect(audit.closedCount).toBe(1)
    expect(audit.getRecoveryData().closed?.map((e) => e.client_id)).toEqual(['ev-kontakt'])
    expect(sync.syncStatus).toBe('synced')
    expect(journal.syncStatus).toBe('synced')
    expect(audit.status).toBe('synced')
    expect(sync.hasUnsynced).toBe(false)

    // the screen shows the RECORD again, not the Kontakt that never reached it
    expect((shown.trupps as typeof TRUPP[])[0].lastContactTime).toBe('2026-09-25T12:40:00Z')

    // …and a reload of phone B still holds the refused Tafel save
    sync.dispose()
    const reopened = new WorkspaceSync(INC)
    await reopened.init()
    await reopened.loadRefused()
    expect(reopened.refusedCount).toBe(1)
    expect(reopened.hasUnsynced).toBe(false)
    reopened.dispose()

    audit.stop()
    journal.dispose()
    off()
  })
})

describe('a refused save sends the record part only when the record changed', () => {
  // sweep 09.11.2026 · CODE.6: the server keeps the blob as JSONB and hands every object back with
  // its keys re-sorted. The park compared by `JSON.stringify`, so a record slice this device
  // never touched read as «changed» and was PUT again to the closed Einsatz.
  it('the same reportMeta in another key order is not a change', async () => {
    const reportMeta = { kurzbericht: 'Brand gelöscht', einsatzleiter: 'Meier' }
    server.ws = { ...server.ws, reportMeta: serverRoundTrip(reportMeta) }
    const sync = new WorkspaceSync(INC, { debounceMs: 60_000 })
    const { workspace } = await sync.init()

    // offline: a Kontakt, with the record slice as this device's own code orders its keys
    server.online = false
    sync.save({ ...workspace, trupps: [{ ...TRUPP, lastContactTime: LATE }], reportMeta: { einsatzleiter: 'Meier', kurzbericht: 'Brand gelöscht' } })
    await sync.flush()
    server.online = true
    await archiveIncident(INC)
    await sync.flush()

    expect(sync.refusedCount).toBe(1) // the Kontakt was refused and parked …
    expect(server.recordPuts).toBe(0) // … and nothing of the record was sent again
    expect(server.rev).toBe(1)
    sync.dispose()
  })

  it('a record slice that did change still lands', async () => {
    const sync = new WorkspaceSync(INC, { debounceMs: 60_000 })
    const { workspace } = await sync.init()
    server.online = false
    sync.save({ ...workspace, trupps: [{ ...TRUPP, lastContactTime: LATE }], reportMeta: { kurzbericht: 'Brand gelöscht, Nachkontrolle 16:00' } })
    await sync.flush()
    server.online = true
    await archiveIncident(INC)
    await sync.flush()

    expect(server.recordPuts).toBe(1)
    expect(server.ws.reportMeta).toEqual({ kurzbericht: 'Brand gelöscht, Nachkontrolle 16:00' })
    sync.dispose()
  })
})

describe('the refused slot is never overwritten blind', () => {
  // CodeRabbit on #235: a failed read of the refused slot was taken for an empty one, and the next
  // park wrote over what an earlier session had parked there. A failed IndexedDB read is not a miss.
  it('a park after a failed read goes to its own slot, and the earlier saves stay', async () => {
    const idb = await import('./idb')
    const KEY = `kp-front-ws-${INC}::__refused__`
    const earlier = [{ workspace: { trupps: [TRUPP] }, baseRev: 1, refusedAt: 1 }]
    await idb.idbSet(KEY, earlier)
    const realRead = idb.idbRead
    const read = vi.spyOn(idb, 'idbRead').mockImplementation(((key: string) =>
      key === KEY ? Promise.resolve({ ok: false, error: new Error('io') }) : realRead(key)) as typeof idb.idbRead)
    try {
      server.open = false
      server.closedAt = '2026-09-25T12:45:00+00:00'
      const write = vi.spyOn(idb, 'idbSet')
      const sync = new WorkspaceSync(INC, { debounceMs: 60_000 })
      await sync.init()
      sync.save({ ...server.ws, trupps: [{ ...TRUPP, lastContactTime: '2026-09-25T12:50:00Z' }] })
      await sync.flush()
      expect(sync.hasUnsynced).toBe(false)
      read.mockRestore()
      expect(await idb.idbGet(KEY)).toEqual(earlier) // untouched
      const parkedTo = write.mock.calls.map((c) => c[0]).filter((k) => k.startsWith(KEY))
      expect(parkedTo).toHaveLength(1)
      expect(parkedTo[0]).toMatch(new RegExp(`^${KEY}:\\d+$`))
      expect(sync.refusedCount).toBe(1)
      write.mockRestore()
      sync.dispose()
    } finally { read.mockRestore() }
  })
})

describe('«Wieder öffnen» on phone A reaches phone B the same way back', () => {
  it('B hears the reopen and SENDS what was parked (as Nachträge); new writes land again', async () => {
    const reopenedHeard: string[] = []
    const offReopen = onIncidentReopened((s) => { if (s.incidentId === INC) reopenedHeard.push(s.source) })

    // phone B: a Kontakt and its row made AFTER the close, queued offline
    const sync = new WorkspaceSync(INC, { debounceMs: 60_000 })
    const { workspace } = await sync.init()
    const journal = new JournalStore(INC, false)
    await journal.init([])
    const audit = new AuditEventStore(INC, 'user-b:login', false)
    audit.start()
    server.online = false
    sync.save({ ...(workspace ?? {}), trupps: [{ ...TRUPP, lastContactTime: LATE }] })
    journal.append({ id: 'r-kontakt', t: '14:50', at: LATE, icon: 'radio', text: 'Trupp 2 – Kontakt bestätigt', kind: 'team' })
    audit.append({ client_id: 'ev-kontakt', op_type: 'atemschutz.contact', payload: { id: 'tr2' }, occurred_at: LATE })
    server.online = true
    await archiveIncident(INC)
    await sync.flush()
    await journal.flush()
    await audit.flush()
    expect([sync.refusedCount, journal.refusedCount, audit.closedCount]).toEqual([1, 1, 1])

    // phone A reopens it; phone B's poll answers «open» again
    await reactivateIncident(INC)
    expect(server.open).toBe(true)
    expect(await pollWorkspaceSince(INC, sync.rev)).toBeNull()
    expect(reopenedHeard).toContain('poll')

    // the Einsatz runs again: what was parked is sent (IncidentWorkspace calls exactly these)
    await journal.requeueRefused()
    await audit.requeueClosed()
    await sync.requeueRefused()
    expect(server.rows.map((r) => r.id)).toContain('r-kontakt')
    expect(server.events.map((e) => e.client_id)).toContain('ev-kontakt')
    expect((server.ws.trupps as typeof TRUPP[])[0].lastContactTime).toBe(LATE)
    expect([sync.refusedCount, journal.refusedCount, audit.closedCount]).toEqual([0, 0, 0])
    // …and a reload finds nothing parked any more (the slots were emptied)
    const again = new WorkspaceSync(INC)
    await again.loadRefused()
    expect(again.refusedCount).toBe(0)
    again.dispose()

    // a Kontakt tapped now lands like any other
    sync.save({ ...server.ws, trupps: [{ ...TRUPP, lastContactTime: '2026-09-25T13:10:00Z' }] })
    journal.append({ id: 'r-kontakt-2', t: '15:10', at: '2026-09-25T13:10:00Z', icon: 'radio', text: 'Trupp 2 – Kontakt bestätigt', kind: 'team' })
    await sync.flush()
    await journal.flush()
    expect((server.ws.trupps as typeof TRUPP[])[0].lastContactTime).toBe('2026-09-25T13:10:00Z')
    expect(server.rows.map((r) => r.id)).toContain('r-kontakt-2')
    expect([sync.syncStatus, journal.syncStatus, audit.status]).toEqual(['synced', 'synced', 'synced'])

    sync.dispose()
    audit.stop()
    journal.dispose()
    offReopen()
  })
})

// review of #235
describe('what a closed Einsatz still takes is never refused along with the rest', () => {
  it('a Kontakt made BEFORE the close, delivered after it, is recorded — nothing is parked', async () => {
    const sync = new WorkspaceSync(INC, { debounceMs: 60_000 })
    const { workspace } = await sync.init()
    const journal = new JournalStore(INC, false)
    await journal.init([])
    server.online = false
    sync.save({ ...(workspace ?? {}), trupps: [{ ...TRUPP, lastContactTime: EARLY }] })
    journal.append({ id: 'r-early', t: '14:44', at: EARLY, icon: 'radio', text: 'Trupp 2 – Kontakt bestätigt', kind: 'team' })
    server.online = true
    await archiveIncident(INC)
    // the save's own clock says «now»: judged by that, it is after the close — so the SAVE
    // is refused and parked, but its Verlauf row, stamped 14:44, is recorded
    await journal.flush()
    expect(server.rows.map((r) => r.id)).toEqual(['r-early'])
    expect(journal.refusedCount).toBe(0)
    sync.dispose()
    journal.dispose()
  })

  it('a Rapport correction on the same save as a Tafel tap lands through the record route; only the rest is parked', async () => {
    const sync = new WorkspaceSync(INC, { debounceMs: 60_000 })
    let shown: Record<string, unknown> = (await sync.init()).workspace ?? {}
    sync.onApplyMerged = (ws) => { shown = ws }
    await archiveIncident(INC)
    sync.save({ ...shown, trupps: [{ ...TRUPP, lastContactTime: LATE }], reportMeta: { kurzbericht: 'Brand gelöscht, Nachkontrolle 16:00' } })
    await sync.flush()
    // the record part is on the server, the Tafel is not
    expect(server.ws.reportMeta).toEqual({ kurzbericht: 'Brand gelöscht, Nachkontrolle 16:00' })
    expect((server.ws.trupps as typeof TRUPP[])[0].lastContactTime).toBe(TRUPP.lastContactTime)
    expect(server.recordPuts).toBe(1)
    expect(sync.refusedCount).toBe(1)
    // the screen shows exactly what the server holds — at once, without another fetch
    expect(shown.reportMeta).toEqual({ kurzbericht: 'Brand gelöscht, Nachkontrolle 16:00' })
    expect((shown.trupps as typeof TRUPP[])[0].lastContactTime).toBe(TRUPP.lastContactTime)
    expect(sync.rev).toBe(server.rev)
    expect(sync.syncStatus).toBe('synced')
    sync.dispose()
  })

  it('a save that changes only the VIEW (and the record) is taken whole', async () => {
    const sync = new WorkspaceSync(INC, { debounceMs: 60_000 })
    const { workspace } = await sync.init()
    await archiveIncident(INC)
    sync.save({ ...(workspace ?? {}), activePlanId: 'modul2', reportMeta: { kurzbericht: 'korrigiert' } })
    await sync.flush()
    expect(server.ws.activePlanId).toBe('modul2')
    expect(server.ws.reportMeta).toEqual({ kurzbericht: 'korrigiert' })
    expect(sync.refusedCount).toBe(0)
    expect(server.recordPuts).toBe(0)
    sync.dispose()
  })

  it('with no ancestor to put back and the fetch failing, the refused state is never shown as «synced»', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    try {
      const sync = new WorkspaceSync(INC, { debounceMs: 60_000 })
      await sync.init()
      let shown: Record<string, unknown> | null = null
      sync.onApplyMerged = (ws) => { shown = ws }
      await archiveIncident(INC)
      // an entry without `base` (a cache written before ancestors were kept)
      ;(sync as unknown as { entry: { base?: unknown } }).entry.base = undefined
      sync.save({ trupps: [{ ...TRUPP, lastContactTime: LATE }] })
      let gets = 0
      const real = vi.mocked(fetch).getMockImplementation()!
      vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/workspace') && (init?.method ?? 'GET') === 'GET' && gets++ === 0) throw new TypeError('Failed to fetch')
        return real(input as string, init)
      })
      await sync.flush()
      expect(sync.refusedCount).toBe(1)
      expect(sync.syncStatus).toBe('error') // not «synced» over a Kontakt the record does not hold
      await vi.advanceTimersByTimeAsync(5_000)
      expect(sync.syncStatus).toBe('synced')
      expect((shown as Record<string, unknown> | null)?.trupps).toEqual([TRUPP])
      sync.dispose()
    } finally { vi.useRealTimers() }
  })
})

// review of #235
describe('a re-send never empties a refused slot it could not read', () => {
  it('requeueRefused after a failed read of the main slot sends nothing and leaves the slot', async () => {
    const idb = await import('./idb')
    const KEY = `kp-front-ws-${INC}::__refused__`
    const earlier = [{ workspace: { trupps: [TRUPP] }, baseRev: 1, refusedAt: 1 }]
    await idb.idbSet(KEY, earlier)
    const realRead = idb.idbRead
    const read = vi.spyOn(idb, 'idbRead').mockImplementation(((key: string) =>
      key === KEY ? Promise.resolve({ ok: false, error: new Error('io') }) : realRead(key)) as typeof idb.idbRead)
    try {
      const sync = new WorkspaceSync(INC, { debounceMs: 60_000 })
      await sync.init()
      const puts = server.rev
      await sync.requeueRefused()
      expect(server.rev).toBe(puts) // nothing sent
      read.mockRestore()
      expect(await idb.idbGet(KEY)).toEqual(earlier) // and nothing emptied
      sync.dispose()
    } finally { read.mockRestore() }
  })
})

// N1
describe('a reopen reaches EVERY device showing the Einsatz closed — both orders', () => {
  // staging 26.09.2026: tablet B closed the Einsatz itself; tablet T opened it closed out of «Alle
  // Einsätze». Phone A reopened. B and T stayed «abgeschlossen» — the old rule followed a reopen
  // only where a close SIGNAL had switched the view. Now the answer is the same for both.
  it.each([
    ['B closed it itself, A reopens', true],
    ['T opened it closed from «Alle Einsätze», A reopens', false],
  ])('%s: the poll hears «open» and the closed view is followed back to live', async (_label, closedHere) => {
    const mod = await import('./incidentClosed')
    const heard: string[] = []
    const off = mod.onIncidentReopened((s) => { if (s.incidentId === INC) heard.push(s.source) })
    const closedMeta = {
      id: INC, title: 'x', status: 'offen', is_archived: true, closed_at: '2026-09-25T12:45:00+00:00',
      last_closed_at: '2026-09-25T12:45:00+00:00',
    } as never
    // the close — by this device or before it ever opened the Einsatz
    if (closedHere) await archiveIncident(INC)
    else Object.assign(server, { open: false, closedAt: '2026-09-25T12:45:00+00:00' })
    // …the reopen, on another device
    await reactivateIncident(INC)
    // this device's poll, claiming what its view shows (closed)
    expect(await pollWorkspaceSince(INC, server.rev, { open: false })).toBeNull()
    expect(heard).toContain('poll')
    const fresh = { ...(closedMeta as object), is_archived: false } as never
    expect(mod.reopenedMetaFor(closedMeta, { incidentId: INC, source: 'poll' }, fresh, null)).toBe(fresh)
    off()
  })
})
