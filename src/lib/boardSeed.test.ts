import { describe, expect, it } from 'vitest'
import { boardSeedFrom } from './boardSeed'
import type { Entity } from '../types'

describe('what a new Tafel page may know', () => {
  it('reads the header and the vehicles off what the workspace holds — nothing invented', () => {
    const s = boardSeedFrom({
      title: 'Zimmerbrand', address: 'Schlossgasse 9', alarmIso: '2026-10-08T09:24:00Z', einsatzleiter: 'Oblt Meier',
      fahrzeuge: [{ id: 'tlf', ausgerueckt: '2026-10-08T09:27:00Z' }, { id: 'mtf' }],
      fleet: [{ id: 'tlf', label: 'TLF 1' }, { id: 'mtf', label: 'MTF' }],
      entities: [{ id: 'v', kind: 'vehicle', coord: [7.5, 47.5], label: 'ADL' } as Entity],
    })
    expect(s.alarm).toMatch(/^\d\d:\d\d$/)
    expect([s.title, s.address, s.einsatzleiter]).toEqual(['Zimmerbrand', 'Schlossgasse 9', 'Oblt Meier'])
    expect(s.vehicles).toEqual(['TLF 1', 'ADL']) // the MTF never went out
  })
  it('a vehicle from elsewhere carries its Herkunft into the Formation cell', () => {
    const s = boardSeedFrom({
      title: 'X',
      entities: [
        { id: 'a', kind: 'symbol', layer: 'taktisch', symbol: 'VKF Fahrzeug', coord: [7.5, 47.5], label: 'TLF', fields: { Herkunft: 'Stützpunkt' } },
        { id: 'b', kind: 'symbol', layer: 'taktisch', symbol: 'VKF Fahrzeug', coord: [7.5, 47.5], label: 'TLF', fields: { Herkunft: '' } },
      ] satisfies Entity[],
    })
    expect(s.vehicles).toEqual(['TLF (Stützpunkt)', 'TLF'])
  })
  it('a bad alarm time is no alarm time', () => {
    expect(boardSeedFrom({ title: 'X', alarmIso: 'nope' }).alarm).toBeNull()
  })
})
