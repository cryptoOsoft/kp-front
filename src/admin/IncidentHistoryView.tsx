import { useCallback, useEffect, useMemo, useState } from 'react'
import { deleteIncident, listIncidents, type IncidentMeta } from '../lib/incidents'
import { appConfig } from '../config/appConfig'
import { ConfirmCard } from '../lib/overlays/ConfirmCard'
import { Card, CopyChip, EmptyState, StatusBadge, Table, fmtDateTime } from './ui'
import { fillTemplate } from '../lib/format'
import { apiGet, apiPost } from '../lib/api'
import type { Out } from '../lib/api/wire'

/** Herkunft in words – the backend stores a slug (`Incident.source`: 'manual', 'divera', an intake
 *  slug …) and printed it raw («MANUAL»). An unknown slug still shows as itself. */
const sourceLabel = (source: string) => appConfig.copy.admin.incidentHistory.sources[source] ?? source

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ok'; data: IncidentMeta[] }

type ArchiveStatus = Out<'IncidentArchiveStatus'>
type ArchiveRow = ArchiveStatus['deliveries'][number]

const archiveTone = (state: ArchiveRow['state']) =>
  state === 'delivered' ? 'on' : state === 'failed' ? 'err' : state === 'paused' ? 'off' : 'warn'

/** «Ablage» (docs/incident-archive.md): where the Einsatz-Ablage stands for one Einsatz – per
 *  destination the state, the folder (copyable), the error while it fails and «Erneut
 *  versuchen»; «Ablegen» for a closed Einsatz the Ablage has not seen (closed before it was on). */
function ArchiveCell({ incident, rows, onRetry }: { incident: IncidentMeta; rows: ArchiveRow[]; onRetry: () => void }) {
  const A = appConfig.copy.admin.incidentHistory.archive
  if (incident.is_exercise) return <span className="adm-ref-note">{A.exercise}</span>
  if (!rows.length) {
    if (!incident.is_archived) return <span className="adm-ref-note">{A.onClose}</span>
    return (
      <span className="adm-archive">
        <span className="adm-ref-note">{A.none}</span>
        <button type="button" className="btn adm-int-btn" onClick={onRetry}>{A.file}</button>
      </span>
    )
  }
  return (
    <span className="adm-archive">
      {rows.map((r) => (
        <span key={r.destination} className="adm-archive-row">
          <StatusBadge label="" state={A.states[r.state]} tone={archiveTone(r.state)} />
          {r.folders.map((f) => <CopyChip key={f} value={f} display={f.split('/').pop() ?? f} />)}
          {r.state === 'delivered' && r.reportVersions === 0 && <span className="adm-ref-note">{A.noReport}</span>}
          {r.state !== 'delivered' && r.lastError && <span className="adm-archive-err">{r.lastError}</span>}
          {r.state === 'failed' && <button type="button" className="btn adm-int-btn" onClick={onRetry}>{A.retry}</button>}
        </span>
      ))}
    </span>
  )
}

export function IncidentHistoryView() {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [query, setQuery] = useState('')
  const [err, setErr] = useState<string | null>(null)
  // the Einsatz whose delete is being asked about – a modal, because this one cannot be re-created
  const [asking, setAsking] = useState<IncidentMeta | null>(null)
  const C = appConfig.copy.admin.incidentHistory
  // the Einsatz-Ablage's state per Einsatz; null = not switched on (or not readable), no column
  const [archive, setArchive] = useState<ArchiveStatus | null>(null)
  const loadArchive = useCallback(() => {
    apiGet<ArchiveStatus>('/api/admin/incident-archive').then(setArchive, () => setArchive(null))
  }, [])
  useEffect(loadArchive, [loadArchive])
  const archiveRows = useMemo(() => {
    const by = new Map<string, ArchiveRow[]>()
    for (const r of archive?.deliveries ?? []) by.set(r.incidentId, [...(by.get(r.incidentId) ?? []), r])
    return by
  }, [archive])
  const retryArchive = async (incidentId: string) => {
    try {
      await apiPost('/api/admin/incident-archive/retry', { incidentId })
    } catch {
      setErr(C.archive.retryFailed)
    }
    loadArchive()
  }

  useEffect(() => {
    let alive = true
    // 500 is the backend's hard page cap — enough history for years of station operation.
    void listIncidents(undefined, 500).then((data) => { if (alive) setState({ kind: 'ok', data }) })
      .catch(() => { if (alive) setState({ kind: 'error' }) })
    return () => { alive = false }
  }, [])

  /** Drop it from the list on success rather than refetching: the row is gone, and a reload
   *  would put a spinner over a table the admin is reading. A failure says so and keeps the row. */
  const remove = async (id: string) => {
    try {
      await deleteIncident(id)
      setState((cur) => (cur.kind === 'ok' ? { kind: 'ok', data: cur.data.filter((i) => i.id !== id) } : cur))
    } catch {
      setErr(C.deleteFailed)
    }
  }

  const rows = useMemo(() => {
    if (state.kind !== 'ok') return []
    const q = query.trim().toLocaleLowerCase()
    // the search finds what the row SAYS («manuell», «Übung») as well as the stored slug
    return q ? state.data.filter((i) => `${i.title} ${i.address ?? ''} ${i.type ?? ''} ${i.source} ${sourceLabel(i.source)} ${i.is_exercise ? appConfig.copy.exerciseBadge : ''}`
      .toLocaleLowerCase().includes(q)) : state.data
  }, [query, state])

  return (
    <Card>
      {state.kind === 'loading' && <EmptyState loading message={C.loading} />}
      {state.kind === 'error' && <EmptyState tone="err" message={C.error} />}
      {err && <EmptyState tone="err" message={err} />}
      {state.kind === 'ok' && (
        <>
          <input className="adm-input adm-view-filter" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder={C.search} aria-label={C.search} />
          {rows.length === 0 ? <EmptyState message={query ? C.noMatches : C.none} /> : (
            <Table columns={[
              { key: 'date', label: C.started }, { key: 'incident', label: C.incident },
              { key: 'status', label: C.status }, { key: 'source', label: C.source },
              { key: 'report', label: C.report },
              ...(archive?.enabled ? [{ key: 'archive', label: C.archive.column }] : []),
              { key: 'updated', label: C.updated },
              { key: 'actions', label: C.actions },
            ]} className="adm-history-table">
              {rows.map((incident) => {
                const closed = incident.is_archived || !!incident.closed_at
                return <tr key={incident.id}>
                  {/* `adm-time`, not `adm-mono`: a date is read as one token, so it stays on one
                      line, and tabular numerals line the columns up without the code face. */}
                  <td className="adm-time">{fmtDateTime(incident.started_at)}</td>
                  {/* an Übung says so in its row – it is the one kind that deletes while still open */}
                  <td className="adm-c-main"><span className="adm-ref-title">{incident.title}</span>
                    {incident.is_exercise && <span className="adm-view-badge adm-view-badge-warn adm-history-exercise">{appConfig.copy.exerciseBadge}</span>}
                    {incident.address && <span className="adm-ref-note">{incident.address}</span>}</td>
                  {/* The badge carries no label of its own — the STATUS column already names it. */}
                  <td className="adm-c-side"><StatusBadge tone={closed ? 'off' : 'on'} label="" state={closed ? C.closed : C.open} /></td>
                  <td><span className="adm-view-badge adm-view-badge-muted">{sourceLabel(incident.source)}</span></td>
                  <td>{incident.report_done_at ? C.complete : C.incomplete}</td>
                  {archive?.enabled && <td>
                    <ArchiveCell incident={incident} rows={archiveRows.get(incident.id) ?? []} onRetry={() => void retryArchive(incident.id)} />
                  </td>}
                  <td className="adm-time">{fmtDateTime(incident.updated_at)}</td>
                  {/* The backend's two doors, mirrored: an Übung (created as one, never marked
                      real) is disposable and goes in any state, a real Einsatz only once it is
                      CLOSED — archiving is the operator saying it is over, and the only moment
                      «löschen» is a decision rather than an accident. A running Einsatz is
                      refused server-side either way (409). */}
                  <td className="adm-c-act">
                    {closed || (incident.is_exercise && incident.exercise_since_creation) ? (
                      <button type="button" className="btn adm-danger-btn"
                        aria-label={fillTemplate(C.deleteAria, { title: incident.title })}
                        onClick={() => setAsking(incident)}>{C.delete}</button>
                    ) : <span className="adm-ref-note">{C.deleteOpenHint}</span>}
                  </td>
                </tr>
              })}
            </Table>
          )}
        </>
      )}
      {/* ⚠️ A modal, not ConfirmButton's inline Ja/Nein: deleting an Einsatz takes its Verlauf,
          Prüfkette and media with it and nothing brings them back (guard ∝ consequence – a
          re-uploadable checklist file already gets a Sheet). The backdrop and Esc cancel. */}
      <ConfirmCard
        open={asking != null}
        title={C.deleteTitle}
        message={asking ? fillTemplate(C.deleteQuestion, { title: asking.title }) : ''}
        note={C.deleteNote}
        confirmLabel={C.delete}
        cancelLabel={appConfig.copy.admin.common2.cancel}
        danger
        onResolve={(confirmed) => {
          const target = asking
          setAsking(null)
          if (confirmed === true && target) void remove(target.id)
        }}
      />
    </Card>
  )
}
