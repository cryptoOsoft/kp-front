import { useCallback, useEffect, useRef, useState } from 'react'
import { listIncidentsShared, type IncidentMeta } from './incidents'
import { freshAlarmCandidate, loadDismissedIncidents, saveDismissedIncident } from './incidentAlerts'
import { useResumingPoll, WATCH_POLL_MS, WATCH_RESUME_GAP_MS } from './useResumingPoll'

/**
 * Always-on incident-list watch. With alarm auto-open, a new Einsatz can appear with no
 * human in the loop (Divera auto-take, generic /api/alarms intake, or a colleague's take
 * on another device) — this hook keeps the open-incident list fresh on a 30 s tick and
 * surfaces the newest such arrival for the «Neuer Einsatz» banner. It never switches the
 * active incident itself: announcing is this hook's job, switching is the user's.
 */
export function useIncidentWatch(
  enabled: boolean,
  activeId: string | null,
  onList: (list: IncidentMeta[]) => void,
): { fresh: IncidentMeta | null; dismiss: () => void } {
  const [fresh, setFresh] = useState<IncidentMeta | null>(null)
  // ids seen on the first poll of this session: pre-existing incidents never banner (the
  // cold-start pick already handled them), only mid-session arrivals do.
  const baseline = useRef<Set<string> | null>(null)

  // Read through a ref: as a dependency of `refresh` it rebuilt the poll on every Einsatz open or
  // switch, and a rebuilt poll starts with a round of its own (09.11.2026).
  const activeIdRef = useRef(activeId)
  useEffect(() => { activeIdRef.current = activeId }, [activeId])

  // The cadence, the foreground resume and the one-round-at-a-time guard are useResumingPoll's;
  // this is only what a round does. The first round shares the boot's request (listIncidentsShared).
  const refresh = useCallback(async () => {
    const { list } = await listIncidentsShared()
    onList(list)
    if (baseline.current === null) {
      baseline.current = new Set(list.map((i) => i.id))
      return
    }
    setFresh(
      freshAlarmCandidate(list, {
        activeId: activeIdRef.current,
        baselineIds: baseline.current,
        dismissed: loadDismissedIncidents(),
        now: Date.now(),
      }),
    )
  }, [onList])

  useResumingPoll(enabled, refresh, { pollMs: WATCH_POLL_MS, resumeGapMs: WATCH_RESUME_GAP_MS })

  // a watch that is off announces nothing
  useEffect(() => { if (!enabled) setFresh(null) }, [enabled])

  // switching to the announced incident (banner tap or any other way) retires the banner
  useEffect(() => {
    if (fresh && fresh.id === activeId) setFresh(null)
  }, [fresh, activeId])

  const dismiss = useCallback(() => {
    setFresh((f) => {
      if (f) saveDismissedIncident(f.id)
      return null
    })
  }, [])

  return { fresh, dismiss }
}
