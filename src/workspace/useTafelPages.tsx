// The Tafel's pages, as the Whiteboard needs them from the workspace (10.10.2026): what a new page
// may be pre-filled with (lib/boardSeed) and the scene the «Lagekarte» box's mini Karte draws.
// The template set itself is the Whiteboard's to load (it reads it when the Tafel is first shown).
// Since 05.11.2026 also the Einsatz's problems from the Checklisten (lib/problemLink): the
// checklist templates (warmed with the Einsatz, lib/checklists · warmTemplates), the tick state,
// the way the Tafel writes ticks, and the undo timeline's handle for one-step acts and the
// deletion toast.
// ⚠️ Nothing here is lazy-imported: a new dynamic import out of the App chunk made rollup split
// half a dozen shared modules into chunks of their own, +10 requests on the cold start.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { TafelPagesProps } from '../components/Whiteboard'
import { boardSeedFrom } from '../lib/boardSeed'
import { warmTemplates, type ChecklistState, type ChecklistTemplate } from '../lib/checklists'
import type { TickWrite } from '../lib/problemLink'
import { getDeploymentConfig } from '../lib/deploymentConfig'
import type { FahrzeugZeit } from '../lib/workspace'
import type { CaptionMode, Drawing, Entity, LayerDef, LayerId, LngLat, Trupp } from '../types'

export interface TafelPagesSources {
  /** false for an Einsatz-Link session: bound to one object, it gets the free sheet only */
  enabled: boolean
  title: string
  address?: string | null
  alarmIso?: string | null
  einsatzleiter?: string | null
  fahrzeuge?: readonly FahrzeugZeit[] | null
  /** the Karte's own objects (the seed reads the placed vehicles off them) */
  docEntities: Entity[]
  /** …and what the Karte DRAWS, for the mini Karte */
  mapEntities: Entity[]
  drawings: Drawing[]
  layers: LayerDef[]
  isVisible: (id: LayerId) => boolean
  byName: Record<string, string>
  center: LngLat
  symMul: number
  captionMode: CaptionMode
  trupps: Trupp[]
  openKarte: () => void
  /** the Checklisten's tick state – the checklist problems the pages show */
  checklists: ChecklistState
  /** the Tafel's writes into the ticks (useChecklistActions · applyTickWrites), read at the write */
  writeTicks: (writes: readonly TickWrite[]) => void
  /** the undo timeline (IncidentWorkspace · undoHist / stepHistory), read at the act */
  history: NonNullable<TafelPagesProps['history']>
}

export function useTafelPages(src: TafelPagesSources): TafelPagesProps | undefined {
  // the seed is read at the TAP, so it sees the Einsatz as it is then — through a ref
  const latest = useRef(src)
  useEffect(() => { latest.current = src })
  const { mapEntities, drawings, layers, isVisible, byName, center, symMul, captionMode, trupps, checklists, enabled } = src
  // the checklist templates: already warm when the Einsatz opened, so this resolves at once
  const [templates, setTemplates] = useState<readonly ChecklistTemplate[]>([])
  useEffect(() => {
    if (!enabled) return
    let alive = true
    void warmTemplates().list.then((t) => { if (alive) setTemplates(t) })
    return () => { alive = false }
  }, [enabled])
  const problems = useMemo(() => ({
    source: { templates, checklists },
    writeTicks: (w: readonly TickWrite[]) => latest.current.writeTicks(w),
  }), [templates, checklists])
  const history = useMemo<NonNullable<TafelPagesProps['history']>>(() => ({
    group: () => latest.current.history.group(),
    top: () => latest.current.history.top(),
    undo: () => latest.current.history.undo(),
  }), [])
  const scene = useMemo(() => ({ entities: mapEntities, drawings, layers, isVisible, byName, center, symMul, captionMode, trupps }),
    [mapEntities, drawings, layers, isVisible, byName, center, symMul, captionMode, trupps])
  return useMemo(() => (enabled ? {
    seed: () => {
      const s = latest.current
      return boardSeedFrom({
        title: s.title, address: s.address, alarmIso: s.alarmIso, einsatzleiter: s.einsatzleiter,
        fahrzeuge: s.fahrzeuge, fleet: getDeploymentConfig().fleet?.vehicles, entities: s.docEntities,
      })
    },
    scene,
    onOpenKarte: () => latest.current.openKarte(),
    title: () => latest.current.title,
    problems,
    history,
  } : undefined), [enabled, scene, problems, history])
}
