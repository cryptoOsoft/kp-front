// The Kroki's time machine: WHEN the printed Kroki shows. The live picture is the default and the
// common case; a past instant is what makes a rapport able to show the Rettung that has since
// left, or the moment the Lage was at its worst. Reconstructed locally from the event journal
// (lib/replay), the same fold the Wiedergabe uses — so the paper and the replay can never
// disagree. Used by ReportPreflight (the Stand slider of the KrokiFramingPanel).

import { useEffect, useMemo, useRef, useState } from 'react'
import { appConfig } from '../config/appConfig'
import { fillTemplate } from '../lib/format'
import { toast } from '../lib/ui'
import { activityMoments, loadReplay, stateAt, vehiclesAt, type ReplayBundle } from '../lib/replay'
import { autoRotation, vehicleSymbolSvg } from '../lib/useVehiclePositions'
import type { Drawing, Entity, TimelineEvent } from '../types'

export type PastScene = { entities: Entity[]; drawings: Drawing[] }

/** The instant a freshly mounted Rapport opens on: the Stand kept across the hop to Anwesenheit
 *  (useReportPlace · rapportKept) when there is one — even «live» — else the last print's. */
export function initialKrokiAt(kept: { krokiAt: number | null } | null, lastPrintAt: string | undefined): number | null {
  if (kept) return kept.krokiAt
  return lastPrintAt ? Date.parse(lastPrintAt) || null : null
}

/** The vehicles at `at`, drawn from the recorded GPS samples like the Wiedergabe draws them. */
function replayVehicles(bundle: ReplayBundle, at: number): Entity[] {
  return vehiclesAt(bundle.samples, at).map((v) => ({
    id: `replay-veh-${v.deviceId}`, kind: 'vehicle', layer: appConfig.gps.layerId,
    coord: v.coord, symbolSvg: vehicleSymbolSvg(String(v.deviceId), autoRotation(v.course), v.course != null),
    label: fillTemplate(appConfig.copy.replay.vehicle, { id: v.deviceId }), live: true, directed: v.course != null,
  }))
}

/**
 * The chosen instant, the Lage reconstructed for it, and the slider's tick marks.
 *
 * @param startedAt the Einsatz's start — the replay window opens there
 * @param initialAt the instant the sheet opens on (`initialKrokiAt`), read at mount only
 * @param shown     the Kroki panel is on screen — the tick marks load then, not on the first drag
 * @param events    the live Verlauf, whose timed rows are ticks too
 *
 * `printedAt` is the instant to STAMP on the paper: only when the reconstruction for it is
 * actually what prints. `pastScene` is null while the reconstruction is in flight and after one
 * fails, and the Kroki then falls back to the LIVE Lage — a caption saying «Stand 21:14» over a
 * picture of 23:00 is a false statement on a document that is a legal record. No caption is the
 * honest fallback.
 */
export function useKrokiMoment({ incidentId, startedAt, initialAt, shown, events }: {
  incidentId: string
  startedAt: string
  initialAt: number | null
  shown: boolean
  events: TimelineEvent[]
}) {
  const [at, setAt] = useState<number | null>(initialAt)
  const [pastScene, setPastScene] = useState<PastScene | null>(null)
  const [busy, setBusy] = useState(false)
  // WHEN anything happened, for the Stand slider's tick marks. Derived from the SAME source the
  // replay bar uses, so the two surfaces cannot disagree about where the Einsatz has substance:
  // the recorded actions plus the Verlauf rows that carry an absolute time.
  const [auditMoments, setAuditMoments] = useState<number[]>([])
  // One bundle per sheet, shared by both effects below. The PROMISE is kept, not the result: a
  // sheet opened on a kept Stand with the panel on screen asks from both in the same tick, and a
  // result cached only after the await downloaded the whole journal twice. A failed load is
  // dropped, so the next ask tries again.
  const bundleRef = useRef<Promise<ReplayBundle> | null>(null)
  const loadBundle = () => {
    bundleRef.current ??= loadReplay(incidentId, Date.parse(startedAt), Date.now())
      .catch((e: unknown) => { bundleRef.current = null; throw e })
    return bundleRef.current
  }
  useEffect(() => {
    if (at == null) { setPastScene(null); return }
    let alive = true
    setBusy(true)
    void (async () => {
      try {
        const bundle = await loadBundle()
        const ws = await stateAt(bundle, at)
        if (!alive) return
        setPastScene({ entities: [...(ws?.entities ?? []), ...replayVehicles(bundle, at)], drawings: ws?.drawings ?? [] })
      } catch {
        if (alive) { setPastScene(null); toast(appConfig.copy.preflight.krokiAtFailed, { icon: 'warn', tone: 'warn' }) }
      } finally {
        if (alive) setBusy(false)
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- incident/start are stable per sheet
  }, [at])

  // Loaded when the crop becomes visible, not on the first drag: the ticks exist to aim that
  // drag, so arriving after it would be arriving too late. Best-effort — a replay bundle that
  // will not load costs the marks, never the slider.
  useEffect(() => {
    if (!shown) return
    let alive = true
    void (async () => {
      try {
        const bundle = await loadBundle()
        if (alive) setAuditMoments(activityMoments(bundle.events))
      } catch { /* no marks from the audit side; the slider still works */ }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the panel becoming visible
  }, [shown, incidentId])
  // ⚠️ The journal moments come from the LIVE timeline (the same rows the Verlauf's own strip
  // ticks) and are derived REACTIVELY: the effect above runs once when the panel becomes
  // visible, and the rows routinely arrive after that (the journal store loads async since the
  // Verlauf moved out of the blob) — a one-shot read latched an empty barcode (19.08.).
  const moments = useMemo(
    () => [...auditMoments, ...activityMoments([], events)],
    [auditMoments, events],
  )

  const printedAt = at != null && pastScene ? new Date(at).toISOString() : null
  return { at, setAt, busy, pastScene, moments, printedAt }
}
