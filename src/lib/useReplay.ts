import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { appConfig } from '../config/appConfig'
import { fillTemplate } from './format'
import { vehicleSymbolSvg, autoRotation } from './useVehiclePositions'
import { normalizeBoard, type Saved } from './workspace'
import type { VehicleAt } from './replay'
import type { BoardDoc, BuildingDoc, Entity } from '../types'

// Time-travel replay (read-only past view), extracted from App's god component. Owns the
// reconstructed-state slices; `active` is what App folds into readOnly/tacticalLocked to
// lock editing. The editor-UI reset on enter stays in App (it owns that state); here we
// just expose setActive + a clean exit.

export interface Replay {
  active: boolean
  setActive: Dispatch<SetStateAction<boolean>>
  ws: Saved | null
  vehicles: VehicleAt[]
  onState: (ws: Saved | null) => void
  onVehicles: (v: VehicleAt[]) => void
  /** leave replay and clear the reconstructed view */
  exit: () => void
  /** reconstructed map entities at the scrubbed instant (past blob + interpolated vehicles) */
  entities: Entity[]
  /** reconstructed Plan board at the scrubbed instant (null when not replaying) */
  board: BoardDoc | null
  /** reconstructed building/floor-stack at the scrubbed instant */
  building: BuildingDoc | null
}

export function useReplay(): Replay {
  const [active, setActive] = useState(false)
  const [ws, setWs] = useState<Saved | null>(null)
  const [vehicles, setVehicles] = useState<VehicleAt[]>([])

  const onState = useCallback((next: Saved | null) => setWs(next), [])
  const onVehicles = useCallback((v: VehicleAt[]) => setVehicles(v), [])
  const exit = useCallback(() => { setActive(false); setWs(null); setVehicles([]) }, [])

  // reconstructed entities/drawings during replay: the past blob's tactical layer plus
  // interpolated vehicle glyphs (empty today — no captured samples). Live GPS is hidden.
  const entities = useMemo<Entity[]>(() => {
    if (!active) return []
    const base = ws?.entities ?? []
    const veh: Entity[] = vehicles.map((v) => ({
      id: `replay-veh-${v.deviceId}`, kind: 'symbol', layer: appConfig.defaults.operationalLayerId,
      coord: v.coord, symbolSvg: vehicleSymbolSvg(String(v.deviceId), autoRotation(v.course), v.course != null),
      label: fillTemplate(appConfig.copy.replay.vehicle, { id: v.deviceId }), live: true,
    }))
    return [...base, ...veh]
  }, [active, ws, vehicles])

  // Plan reconstruction: the Whiteboard reads the past board/building from the same blob
  // that drives the map, so switching to Plan shows the plan as it stood at the instant.
  const board = useMemo(() => (active ? normalizeBoard(ws?.board) : null), [active, ws])
  const building = active ? (ws?.building ?? null) : null

  return { active, setActive, ws, vehicles, onState, onVehicles, exit, entities, board, building }
}
