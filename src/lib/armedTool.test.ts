import { describe, expect, it } from 'vitest'
import { armedToolIcon, armedToolName } from './armedTool'
import { appConfig } from '../config/appConfig'

describe('armedToolName – the readout pill\'s word', () => {
  const map = appConfig.copy.mapTools
  const plan = appConfig.copy.planTools

  it('names the rail\'s tools by their own tile label', () => {
    expect(armedToolName('circle', map)).toBe('Absperrkreis')
    expect(armedToolName('team', map)).toBe('Trupp')
    expect(armedToolName('measure', plan)).toBe('Messen')
  })

  it('Linie and Fläche carry their input mode', () => {
    expect(armedToolName('line', map, { lineMode: 'freehand' })).toBe('Linie · Freihand')
    expect(armedToolName('line', plan, { lineMode: 'nodes' })).toBe('Linie · Punkte')
    expect(armedToolName('area', map, { areaMode: 'nodes' })).toBe('Fläche · Punkte')
  })

  it('a two-state tile answers for its second state (Mehrfach)', () => {
    expect(armedToolName('lasso', map)).toBe('Mehrfach')
    expect(armedToolName('lasso', plan)).toBe('Mehrfach')
  })

  it('the glyph is the rail tile\'s icon', () => {
    expect(armedToolIcon('line', map)).toBe('pen')
    expect(armedToolIcon('lasso', plan)).toBe('marquee')
    expect(armedToolIcon('scale', map)).toBeNull() // a Plan tool the Karte's rail does not carry
  })

  it('the rest state and a tool the rail does not carry are no pill', () => {
    expect(armedToolName('select', map)).toBe('Auswahl') // the caller gates on the rest state
    expect(armedToolName('scale', map)).toBeNull()
  })
})
