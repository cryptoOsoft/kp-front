import { appConfig } from '../config/appConfig'
import { hhmm } from './format'
import { isVehicleSym } from './symbols'
import type { FleetVehicle } from './deploymentConfig'
import type { FahrzeugZeit } from './workspace'
import type { FormSeed } from './boardForm'
import type { Entity } from '../types'

export interface BoardSeedSources {
  title: string
  address?: string | null
  alarmIso?: string | null
  einsatzleiter?: string | null
  /** the Rapport's Fahrzeugzeiten — a vehicle with any time on it went out on this Einsatz */
  fahrzeuge?: readonly FahrzeugZeit[] | null
  fleet?: readonly FleetVehicle[] | null
  /** the Karte's objects — a placed vehicle (kind or Fahrzeug symbol) names a Formation */
  entities?: readonly Entity[]
}

/**
 * What a Tafel page may know at the moment it is added — only what the app already holds
 * (ported from the staging Plakat's `plakatSeedFrom`, 08.10.2026): the Einsatz header for a page
 * that switched its header on, and the vehicles the Einsatz has seen for a «Mittel» table that
 * asks for them (`seed: "vehicles"`). No new integrations, no guesses: the wind suggestion the
 * staging Plakat put under «Spezialprobleme» is gone with its trend column (strict 1:1 FKS).
 */
export function boardSeedFrom(src: BoardSeedSources): FormSeed {
  const at = src.alarmIso ? new Date(src.alarmIso) : null
  const labels = new Map((src.fleet ?? []).map((v) => [v.id, v.label || v.id]))
  const out = (src.fahrzeuge ?? [])
    .filter((f) => f.ausgerueckt || f.vorOrt || f.zurueck)
    .map((f) => labels.get(f.id) ?? f.id)
  // a vehicle from elsewhere says so in the Formation cell – «TLF (Stützpunkt)» – the way the
  // Karte's grey line does (lib/symbols · symbolOriginText); the own Feuerwehr's stays «TLF»
  const placed = (src.entities ?? [])
    .filter((e) => e.kind === 'vehicle' || isVehicleSym(e))
    .map((e) => {
      const origin = e.fields?.[appConfig.symbols.originField]?.trim()
      return e.label?.trim() && origin ? `${e.label.trim()} (${origin})` : e.label ?? ''
    })
  return {
    title: src.title,
    address: src.address,
    alarm: at && !Number.isNaN(at.getTime()) ? hhmm(at) : null,
    einsatzleiter: src.einsatzleiter,
    vehicles: [...out, ...placed].filter(Boolean),
  }
}
