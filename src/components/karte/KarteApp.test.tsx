// @vitest-environment jsdom
// «Karte & Objekte» end to end on the surface, with the map as a prop recorder (like the
// IncidentWorkspace harness): an object opens the panel, «Objektbesuch» hands over at the C1
// address and «Melden» asks for the station's Fehlermeldung, a pin becomes a «Meldung» at a place,
// Messen offers NO «Als Linie übernehmen», a plan opens in the Einsatz's reader read-only, and
// nothing the viewer does writes anything but its own view keys. Synthetic Musterdorf data.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { StationObjects, UndergroundSet } from '../../lib/api/stationReference'
import type { BuildingInfo } from '../../lib/api/building'
import type { LayerDef, LngLat } from '../../types'

const rec = vi.hoisted(() => ({ map: [] as Record<string, unknown>[], phone: false, board: [] as Record<string, unknown>[], catalogue: null as null | StationObjects, rules: [] as unknown[], fakeMap: null as null | object, underground: null as null | UndergroundSet, undergroundAsked: 0, building: null as null | BuildingInfo, extraLayers: [] as LayerDef[] }))
const lastMap = () => rec.map[rec.map.length - 1] as { onMapClick: (c: LngLat) => void; measurePoints: LngLat[]; onMeasureDelete?: (i: number) => void; children?: ReactNode }

const CATALOGUE: StationObjects = {
  generatedAt: '2026-10-16T10:00:00Z',
  objects: [
    { id: 'schloss', name: 'Schloss Musterdorf', kind: 'einsatzobjekt', address: 'Schlossgasse 9, 9999 Musterdorf', lat: 47.523773, lng: 7.570188,
      aliases: ['Wasserschloss'], plans: [{ id: 'plan:schloss:modul1', module: 'modul1', code: '1', title: 'Modul 1 · Übersicht', pages: 2, georef: false, version: 1 }],
      floors: [], egid: null, footprint: null, lastVisit: null, measures: 'Zufahrt nur über Schlossgasse', measuresSource: 'Modul 1' },
    // plan-less, at the Schloss's door (a «Schlüsseldepot» kind of its own until review round 3)
    { id: 'depot', name: 'Remise Schloss', kind: 'objekt', address: 'Schlossgasse 9', lat: 47.52402, lng: 7.56985,
      aliases: [], plans: [], floors: [], egid: null, footprint: null, lastVisit: null },
    // named by its address, with none stored (review round 2: the lists said «Schlüsseldepot» there)
    { id: 'box', name: 'Starenstrasse 7', kind: 'objekt', address: null, lat: 47.5232, lng: 7.5712,
      aliases: [], plans: [], floors: [], egid: null, footprint: null, lastVisit: null },
  ],
}

vi.mock('../../lib/auth', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../lib/auth')>()
  const value = { user: { id: 'u1', username: 'fu', display_name: 'FU Test', role: 'editor' as const, color: null, last_login: null }, loading: false, probeUnreachable: false, sessionExpired: false, login: () => Promise.resolve(), logout: () => Promise.resolve() }
  return { ...mod, useAuth: () => value }
})
vi.mock('../../lib/useSymbols', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/useSymbols')>()), useSymbols: () => ({ ready: true, error: false, reload: () => {}, order: [], symbols: [], byName: {} }) }))
vi.mock('../MapView', async () => {
  const { useImperativeHandle } = await import('react')
  return {
    // the map's handle is null unless a test hands in a stand-in (React 19: `ref` is a prop); the
    // canvas container's class is what the surface's pointer handlers look for
    MapView: (p: Record<string, unknown> & { children?: ReactNode; ref?: React.Ref<unknown> }) => {
      rec.map.push(p)
      useImperativeHandle(p.ref, () => rec.fakeMap, [])
      return <div data-testid="mapview" className="maplibregl-canvas-container">{p.children}</div>
    },
  }
})
// a marker says where it stands (lng/lat), how it hangs there and how far it slid
vi.mock('react-map-gl/maplibre', () => ({
  Marker: ({ children, longitude, latitude, anchor, offset }: { children: ReactNode; longitude: number; latitude: number; anchor?: string; offset?: [number, number] }) => (
    <div data-marker="" data-lng={longitude} data-lat={latitude} data-anchor={anchor ?? ''} data-offset={(offset ?? [0, 0]).join(',')}>{children}</div>
  ),
}))
vi.mock('../../lib/api/stationReference', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/stationReference')>()),
  loadStationObjects: async () => ({ value: rec.catalogue ?? CATALOGUE, source: 'network' as const }),
  loadStationBuilding: async () => (rec.building ? { value: rec.building, source: 'network' as const } : null),
  loadUnderground: async () => { rec.undergroundAsked++; return rec.underground },
}))
vi.mock('../../objectVisits/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../objectVisits/api')>()), listVisits: async () => [] }))
vi.mock('../../lib/api/geo', () => ({
  geocodeSearch: async () => [],
  geocodeReverse: async (lat: number, lng: number) => ({ label: 'Starenstrasse 19, 9999 Musterdorf', lat, lng }),
}))
// the menu button's face (review round 5): the station's mark / short name, per test
const brand = vi.hoisted(() => ({ mark: null as string | null, short: null as string | null, name: 'Feuerwehr Musterdorf' }))
vi.mock('../../lib/deploymentConfig', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/deploymentConfig')>()),
  deploymentMenuMark: () => ({ mark: brand.mark, short: brand.short }),
  deploymentName: () => brand.name,
  objectVisitsConfig: () => ({ enabled: true, captureRoles: ['editor', 'el'] }),
  objectCategoryRules: () => rec.rules,
}))
// a test's own Ebenen beside the built-in ones (the deployment's hydrant layer)
vi.mock('../../lib/workspace', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../lib/workspace')>()
  return { ...orig, defaultLayers: (t?: string | null) => [...orig.defaultLayers(t), ...rec.extraLayers] }
})
vi.mock('../../lib/useWeather', () => ({ useWeather: () => ({ data: null, error: null }) }))
vi.mock('../../lib/ui', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/ui')>()), toast: vi.fn() }))
// the service worker as a switch (review round 7): a waiting build is announced by calling the
// subscription, the way swUpdate · onNeedRefresh does; `landed` is the boot-time «update landed» stamp
const sw = vi.hoisted(() => ({ announce: null as null | ((a: boolean) => void), landed: false, apply: vi.fn(), platform: 'android' }))
vi.mock('../../lib/swUpdate', () => ({
  applyUpdateNow: () => sw.apply(),
  onUpdateAvailable: (cb: (a: boolean) => void) => { sw.announce = cb; return () => { if (sw.announce === cb) sw.announce = null } },
  consumeJustUpdated: () => { const v = sw.landed; sw.landed = false; return v },
}))
vi.mock('../../lib/installPrompt', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/installPrompt')>()), getInstallPlatform: () => sw.platform }))
vi.mock('../../lib/useVehicleLayer', () => ({ useVehicleLayer: () => ({ liveVehicles: [] }) }))
// the Einsatz's plan reader (Whiteboard, lazy) as a prop recorder: what the Karte hands it IS the
// proof that it can write nothing
vi.mock('../../workspace/lazySurfaces', () => ({
  Whiteboard: (p: Record<string, unknown> & { plans: { imageUrl: string }[] }) => { rec.board.push(p); return <div data-testid="pdf">{p.plans[0].imageUrl}</div> },
}))

// the Checkliste surface's library as a recorder: the Karte hosts it and hands it the bar's words
vi.mock('../ChecklistLibrary', () => ({ ChecklistLibrary: ({ query }: { query: string }) => <div data-testid="library">{query}</div> }))

import KarteApp, { type KarteAppProps } from './KarteApp'
import { Meldeleiste } from '../Meldeleiste'
import { toast } from '../../lib/ui'
import { fmtDistance, haversineM } from '../../lib/geo'
import { appConfig } from '../../config/appConfig'
import { __setUnHazardData, type UnHazardEntry } from '../../lib/unHazard'
import adr from '../../../public/un-hazard.json'
import { loadPrefs, savePrefs } from '../../lib/prefs'

class RO { observe() {} unobserve() {} disconnect() {} }
beforeAll(() => {
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= RO
  window.matchMedia = ((q: string) => ({
    matches: rec.phone, media: q, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})
beforeEach(() => {
  rec.map.length = 0
  rec.board.length = 0
  rec.phone = false
  rec.catalogue = null
  rec.rules = []
  rec.fakeMap = null
  rec.underground = null
  rec.undergroundAsked = 0
  rec.building = null
  rec.extraLayers = []
  brand.mark = null; brand.short = null
  sw.announce = null; sw.landed = false; sw.apply.mockClear(); sw.platform = 'android'
  localStorage.clear(); sessionStorage.clear()
  window.history.replaceState(null, '', '/karte')
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.mocked(toast).mockClear() })

/** the fields' words carry invisible word joiners against iOS's contact AutoFill (lib/typingField) */
const PLAIN = { normalizer: (t: string) => t.replace(/\u2060/g, '') }

/** a PointerEvent jsdom will not build itself — `pointerType` is the whole question for the
 *  surface's hold, which only a finger (or a pen) ever starts */
const touchEvent = (type: string, clientX: number, clientY: number, pointerType = 'touch') => {
  const e = new MouseEvent(type, { bubbles: true, clientX, clientY })
  Object.defineProperty(e, 'pointerType', { value: pointerType })
  return e
}
/** a real canvas inside a real container, the way maplibre hands them out: the surface's pointer
 *  handlers listen on `getCanvasContainer()` and only answer presses on the canvas itself. */
const canvasHarness = (at: { lng: number; lat: number } | (() => { lng: number; lat: number })) => {
  const box = document.createElement('div')
  const canvas = document.createElement('canvas')
  box.appendChild(canvas)
  document.body.appendChild(box)
  const where = typeof at === 'function' ? at : () => at
  rec.fakeMap = {
    getCanvas: () => canvas, getContainer: () => box, unproject: () => where(), project: () => ({ x: 200, y: 200 }), getZoom: () => 18,
    getBounds: () => ({ getWest: () => 7.569, getSouth: () => 47.523, getEast: () => 7.572, getNorth: () => 47.525 }),
    getMap: () => ({ on: () => {}, getCanvasContainer: () => box }),
    easeTo: () => {}, jumpTo: () => {}, fitBounds: () => {},
  }
  return { box, canvas }
}
/** finger down and still for longer than the long press (lib/useLongPress · LONG_PRESS_MS) */
const hold = async (canvas: HTMLCanvasElement, x: number, y: number) => {
  act(() => { canvas.dispatchEvent(touchEvent('pointerdown', x, y)) })
  await act(() => new Promise((r) => setTimeout(r, 700)))
}

const mount = (over: Partial<KarteAppProps> = {}) => {
  const onOpenVisits = vi.fn()
  // the launcher's content as App hands it in: a row that closes the sheet, like «Manueller Einsatz»
  const launcherRow = vi.fn()
  const einsaetze = {
    badge: 0,
    render: (close: () => void) => <button type="button" onClick={() => { launcherRow(); close() }}>Manueller Einsatz</button>,
  }
  const onSettings = vi.fn(), onHelp = vi.fn()
  render(<KarteApp einsaetze={einsaetze} onOpenVisits={onOpenVisits} running={[]} onOpenIncident={vi.fn()} onSettings={onSettings} onHelp={onHelp} {...over} />)
  return { onOpenVisits, launcherRow, onSettings, onHelp }
}

describe('KarteApp', () => {
  // Karte Haus round 1 (owner, variant A): a row of houses that is ONE object — a tap opens the
  // object and remembers the house; the switch opens just that house, and the register's «this
  // address is the object's» never throws it back
  it('opens the object from one of its houses, and the switch opens only that house', async () => {
    const sq = (lng: number, lat: number, d: number) => [[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]]
    const west = sq(7.5700, 47.5236, 0.0002), east = sq(7.5702, 47.5236, 0.0002)
    rec.catalogue = { ...CATALOGUE, objects: CATALOGUE.objects.map((o) => (o.id === 'schloss' ? { ...o, footprint: { type: 'MultiPolygon', coordinates: [[west], [east]] } } : o)) }
    // the register names the house by the OBJECT's address — the rule that once opened the object
    rec.building = {
      registers: 'on', egid: '1', address: 'Schlossgasse 9, 9999 Musterdorf', gwr: null, gwr_status: 'none', plants: [], pv_status: 'ok',
      registers_fetched_at: '2026-10-16T10:00:00Z', object: { id: 'schloss', name: 'Schloss Musterdorf' }, visit: null,
    } as unknown as BuildingInfo
    mount()
    await screen.findByRole('button', { name: /Schloss Musterdorf/ })
    type Ov = { id: string; rings?: number[][][] }
    const overlays = () => (lastMap() as unknown as { preparedOverlays: Ov[] }).preparedOverlays
    const level = () => screen.queryByRole('group', { name: 'Objekt oder Haus' })

    act(() => lastMap().onMapClick([7.5703, 47.5237]))
    expect(await screen.findByRole('heading', { name: 'Schloss Musterdorf' })).toBeTruthy()
    // the tapped house dashed, its street on the switch once the register answers
    expect(overlays().find((o) => o.id === 'karte-object-hit')?.rings?.[0]).toEqual(east.slice(0, 4))
    await waitFor(() => expect(within(level()!).getByRole('button', { name: /Schlossgasse 9/ })).toBeTruthy())
    // In der Nähe measures from the tapped house, not the object's catalogue point (owner, 19.10.)
    const remise = within(document.querySelector('[data-section="nearby"]') as HTMLElement).getByRole('button', { name: /Remise Schloss/ })
    expect(remise.textContent).toContain(fmtDistance(haversineM([7.5703, 47.5237], [7.56985, 47.52402])))

    fireEvent.click(within(level()!).getByRole('button', { name: /Schlossgasse 9/ }))
    expect(await screen.findByText('Teil von Schloss Musterdorf')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Schlossgasse 9' })).toBeTruthy()
    // the register has answered with the object's address: still the house
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(screen.queryByRole('heading', { name: 'Schloss Musterdorf' })).toBeNull()
    expect(overlays().find((o) => o.id === 'karte-building')?.rings?.[0]).toEqual(east.slice(0, 4))
    // In der Nähe of a house never lists its own object
    const near = document.querySelector('[data-section="nearby"]') as HTMLElement
    expect(within(near).queryByText('Schloss Musterdorf')).toBeNull()
    expect(within(near).getByText('Remise Schloss')).toBeTruthy()

    // the level sticks while the taps stay on the object: the other house opens as a house
    act(() => lastMap().onMapClick([7.5701, 47.5237]))
    await waitFor(() => expect(overlays().find((o) => o.id === 'karte-building')?.rings?.[0]).toEqual(west.slice(0, 4)))
    // (awaited: the panel's head can follow the outline by a render)
    expect(await screen.findByText('Teil von Schloss Musterdorf')).toBeTruthy()

    // …and one tap goes back to the object
    fireEvent.click(within(level()!).getByRole('button', { name: /^Objekt/ }))
    expect(await screen.findByRole('heading', { name: 'Schloss Musterdorf' })).toBeTruthy()
    expect(within(level()!).getByRole('button', { name: /^Objekt/ }).getAttribute('aria-pressed')).toBe('true')

    // from its tag there is no house: no switch
    fireEvent.click(screen.getAllByRole('button', { name: 'Schloss Musterdorf' }).find((b) => b.closest('[data-marker]'))!)
    await waitFor(() => expect(level()).toBeNull())
    expect(overlays().some((o) => o.id === 'karte-object-hit')).toBe(false)
  })

  // Karte Haus round 1 (owner): «a hover state with cursor change so that I can briefly hover over
  // objects and see that they're clickable» — the mouse's only, never a finger's, never under a tool
  it('hovers with the mouse only: the pointer and the object named over its building', async () => {
    const sq = (lng: number, lat: number, d: number) => [[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]]
    const west = sq(7.5700, 47.5236, 0.0002), east = sq(7.5702, 47.5236, 0.0002)
    rec.catalogue = { ...CATALOGUE, objects: CATALOGUE.objects.map((o) => (o.id === 'schloss' ? { ...o, footprint: { type: 'MultiPolygon', coordinates: [[west], [east]] } } : o)) }
    const box = document.createElement('div')
    const canvas = document.createElement('canvas')
    box.appendChild(canvas)
    document.body.appendChild(box)
    let under = { lng: 7.5703, lat: 47.5237 }
    rec.fakeMap = {
      getCanvas: () => canvas, getContainer: () => box, unproject: () => under, project: () => ({ x: -999, y: -999 }), getZoom: () => 18,
      getBounds: () => ({ getWest: () => 7.569, getSouth: () => 47.523, getEast: () => 7.571, getNorth: () => 47.524 }),
      getMap: () => ({ on: () => {}, getCanvasContainer: () => box }),
    }
    mount()
    await screen.findByRole('button', { name: /Schloss Musterdorf/ })
    act(() => (lastMap() as unknown as { onSettled: () => void }).onSettled())
    type Ov = { id: string; rings?: number[][][] }
    const overlays = () => (lastMap() as unknown as { preparedOverlays: Ov[] }).preparedOverlays
    const move = async (pointerType: string) => {
      const e = new MouseEvent('pointermove', { bubbles: true, clientX: 40, clientY: 40 })
      Object.defineProperty(e, 'pointerType', { value: pointerType })
      await act(async () => { canvas.dispatchEvent(e); await new Promise((r) => requestAnimationFrame(r)) })
    }

    await move('touch')
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(canvas.style.cursor).toBe('')

    await move('mouse')
    expect(screen.getByRole('tooltip').textContent).toBe('EinsatzobjektSchloss Musterdorf')
    expect(canvas.style.cursor).toBe('pointer')
    // ALL its buildings brighten, the one under the cursor gets its own line
    expect(overlays().find((o) => o.id === 'karte-hover-object')?.rings).toHaveLength(2)
    expect(overlays().find((o) => o.id === 'karte-hover-house')?.rings?.[0]).toEqual(east.slice(0, 4))

    under = { lng: 7.6, lat: 47.6 }
    await move('mouse')
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(canvas.style.cursor).toBe('default')
    expect(overlays().some((o) => o.id.startsWith('karte-hover'))).toBe(false)

    // Messen takes the taps: no hover over the building either
    fireEvent.click(screen.getByRole('button', { name: 'Messen' }))
    under = { lng: 7.5703, lat: 47.5237 }
    await move('mouse')
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(canvas.style.cursor).toBe('default')
    box.remove()
  })

  it('colours an object by its category and gives the category an Ebenen row that hides it', async () => {
    // the Schloss stands in a square building of its own (a server footprint) and carries Modul 1
    const sq = (lng: number, lat: number, d: number) => [[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]]
    rec.catalogue = {
      ...CATALOGUE,
      objects: CATALOGUE.objects.map((o) => (o.id === 'schloss' ? { ...o, footprint: { type: 'MultiPolygon', coordinates: [[sq(7.5700, 47.5236, 0.0004)]] } } : o)),
    }
    rec.rules = [{ id: 'm1', label: { de: 'Mit Übersichtsplan', fr: 'Avec plan' }, color: '#2563eb', match: { modules: ['modul1*'] } }]
    mount()
    await screen.findByRole('button', { name: /Schloss Musterdorf/ })
    type Ov = { id: string; color?: string }
    const overlays = () => (lastMap() as unknown as { preparedOverlays: Ov[] }).preparedOverlays
    await waitFor(() => expect(overlays().find((o) => o.id === 'karte-objects-m1')?.color).toBe('#2563eb'))
    // the default red overlay is gone: the only outlined object is in the category
    expect(overlays().some((o) => o.id === 'karte-objects')).toBe(false)
    // its marker wears the colour
    const marker = screen.getByRole('button', { name: /Schloss Musterdorf/ })
    expect(marker.style.getPropertyValue('--cat')).toBe('#2563eb')

    fireEvent.click(screen.getByRole('button', { name: appConfig.copy.karte.tools.layers }))
    const row = await screen.findByRole('button', { name: /Mit Übersichtsplan/ })
    fireEvent.click(row)
    await waitFor(() => expect(overlays().some((o) => o.id === 'karte-objects-m1')).toBe(false))
    expect(screen.queryByRole('button', { name: /^Schloss Musterdorf/ })).toBeNull()
    // the plan-less object (no category) stays
    expect(screen.getByRole('button', { name: /Remise Schloss/ })).toBeTruthy()
  })

  it('opens an object from its tag and hands a visit over at the contract address', async () => {
    const { onOpenVisits } = mount()
    fireEvent.click(await screen.findByRole('button', { name: /Schloss Musterdorf/ }))
    expect(await screen.findByRole('heading', { name: 'Schloss Musterdorf' })).toBeTruthy()
    expect(screen.getByText('Zufahrt nur über Schlossgasse')).toBeTruthy()
    // the address follows the selection, without a history entry
    await waitFor(() => expect(window.location.search).toBe('?objekt=schloss'))
    fireEvent.click(screen.getByRole('button', { name: /Objektbesuch/ }))
    expect(onOpenVisits).toHaveBeenCalledWith('/besuche/neu?object=schloss&from=karte')
    // «Melden» (owner R2): the same visit, with the station's Fehlermeldung asked for
    fireEvent.click(screen.getByRole('button', { name: 'Melden' }))
    expect(onOpenVisits).toHaveBeenLastCalledWith('/besuche/neu?object=schloss&checkliste=fehlermeldung&from=karte')
  })

  // owner R3 (17.10.2026): «do not move the location of the marker» — the tag sits ON the object's
  // point even when its building's south edge (round 1) or the inside of it (round 2) is elsewhere,
  // and it names the object without a plan count
  it('draws the tag on the object\'s point, centred, with no plan count', async () => {
    const sq = (lng: number, lat: number, d: number) => [[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]]
    rec.catalogue = {
      ...CATALOGUE,
      objects: CATALOGUE.objects.map((o) => (o.id === 'schloss'
        ? { ...o, footprint: { type: 'MultiPolygon', coordinates: [[sq(7.5700, 47.5236, 0.0004)]] }, plans: [...o.plans, { ...o.plans[0], id: 'plan:schloss:modul2', module: 'modul2', code: '2' }] }
        : o)),
    }
    mount()
    fireEvent.click(await screen.findByRole('button', { name: /Schloss Musterdorf/ }))
    await screen.findByRole('heading', { name: 'Schloss Musterdorf' })
    const tag = screen.getAllByRole('button', { name: 'Schloss Musterdorf' }).find((b) => b.closest('[data-marker]'))!
    expect(tag.textContent).toBe('Schloss Musterdorf')
    const m = tag.closest('[data-marker]') as HTMLElement
    expect([Number(m.dataset.lng), Number(m.dataset.lat)]).toEqual([7.570188, 47.523773])
    expect(m.dataset.anchor).toBe('center')
    expect(m.dataset.offset).toBe('0,0')
  })

  it('without categories, an object without plans is told apart by its look, not a number', async () => {
    rec.catalogue = {
      ...CATALOGUE,
      objects: [...CATALOGUE.objects, { id: 'halle', name: 'Lagerhalle Feld', kind: 'objekt', address: 'Feldweg 2', lat: 47.5245, lng: 7.5690, aliases: [], plans: [], floors: [], egid: null, footprint: null, lastVisit: null }],
    }
    mount()
    const bare = await screen.findByRole('button', { name: 'Lagerhalle Feld' })
    const planned = screen.getByRole('button', { name: 'Schloss Musterdorf' })
    expect(bare.className).not.toBe(planned.className)
    expect(planned.textContent + bare.textContent).not.toMatch(/\d/)
  })

  it('measures without offering to keep it, and stores nothing of it', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: /Schloss Musterdorf/ }))
    // no «Messen ab hier» in the panel any more (owner R2): Messen is the tool's
    expect(screen.queryByRole('button', { name: /Messen ab hier/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Messen' }))
    act(() => lastMap().onMapClick([7.570188, 47.523773]))
    act(() => lastMap().onMapClick([7.5708, 47.52455]))
    await waitFor(() => expect(lastMap().measurePoints).toHaveLength(2))
    expect(screen.queryByRole('button', { name: /übernehmen/ })).toBeNull()
    // …and no line saying so either (owner-6, 17.10.2026): nothing on this surface is ever saved
    expect(screen.queryByText(/Nur zum Nachschauen/)).toBeNull()
    // only the viewer's own view keys were written — no workspace, no drawing, no measure
    expect(Object.keys(sessionStorage)).toEqual(['kp.karte.view'])
    expect(sessionStorage.getItem('kp.karte.view')).not.toMatch(/7\.5708/)
    expect(Object.keys(localStorage).filter((k) => !k.startsWith('kp.karte') && k !== 'kp.layers.karte')).toEqual([])
  })

  // owner R3-9 (17.10.2026): «I can't delete nodes when measuring because it wants to create a
  // point» — a long press anywhere dropped a pin (and left Messen), and holding a measure node is
  // how a node is removed. The hold came back in review round 7 (20.10.2026) under a narrower
  // rule, so this stays the regression that guards Messen: a tool that takes the map's taps
  // (lib/karte/camera · toolTakesTaps) never arms the surface's hold.
  it('a long press under Messen drops no pin — the held node is still the node\'s', async () => {
    const { canvas, box } = canvasHarness({ lng: 7.5712, lat: 47.5232 })
    mount()
    await screen.findByRole('button', { name: /Schloss Musterdorf/ })
    act(() => (lastMap() as unknown as { onSettled: () => void }).onSettled())
    fireEvent.click(screen.getByRole('button', { name: 'Messen' }))
    act(() => lastMap().onMapClick([7.570188, 47.523773]))
    act(() => lastMap().onMapClick([7.5708, 47.52455]))
    act(() => lastMap().onMapClick([7.5712, 47.5232]))
    await waitFor(() => expect(lastMap().measurePoints).toHaveLength(3))
    // the finger stays down on the middle node (MapView's own hold removes it) …
    await hold(canvas, 200, 200)
    act(() => lastMap().onMeasureDelete?.(1))
    fireEvent(canvas, touchEvent('pointerup', 200, 200))
    // … and the surface did not drop a pin under it, nor leave Messen
    expect(screen.queryByText('Gesetzter Punkt')).toBeNull()
    expect(lastMap().measurePoints).toEqual([[7.570188, 47.523773], [7.5712, 47.5232]])
    box.remove()
  })

  // owner, review round 7 (20.10.2026), points 7 + 11: «also on mobile highlight the building
  // outlines on hold so we know what we're pressing before we let go» + «the point setting option
  // should also occur automatically if you just long press on the map». His own split, in a
  // grilling round the same day: a hold on a building only highlights, a hold on FREE map sets
  // the point.
  it('holds a building to light it and free map to set a point', async () => {
    const sq = (lng: number, lat: number, d: number) => [[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]]
    const house = sq(7.5700, 47.5236, 0.0002)
    rec.catalogue = { ...CATALOGUE, objects: CATALOGUE.objects.map((o) => (o.id === 'schloss' ? { ...o, footprint: { type: 'MultiPolygon', coordinates: [[house]] } } : o)) }
    let under = { lng: 7.5701, lat: 47.5237 }
    const { canvas, box } = canvasHarness(() => under)
    mount()
    await screen.findByRole('button', { name: /Schloss Musterdorf/ })
    act(() => (lastMap() as unknown as { onSettled: () => void }).onSettled())
    const overlays = () => (lastMap() as unknown as { preparedOverlays: { id: string }[] }).preparedOverlays
    const lit = () => overlays().some((o) => o.id === 'karte-hover-object')

    // the finger lands on the Schloss: the outline answers AT ONCE, before the hold is over
    act(() => { canvas.dispatchEvent(touchEvent('pointerdown', 40, 40)) })
    expect(lit()).toBe(true)
    // …and holding it there is still no pin — the release opens the object, as a tap always did
    await act(() => new Promise((r) => setTimeout(r, 700)))
    expect(screen.queryByText('Gesetzter Punkt')).toBeNull()
    act(() => { canvas.dispatchEvent(touchEvent('pointerup', 40, 40)) })
    expect(lit()).toBe(false)

    // a finger that travels is panning: the outline goes out again
    act(() => { canvas.dispatchEvent(touchEvent('pointerdown', 40, 40)) })
    expect(lit()).toBe(true)
    act(() => { canvas.dispatchEvent(touchEvent('pointermove', 80, 90)) })
    expect(lit()).toBe(false)
    act(() => { canvas.dispatchEvent(touchEvent('pointerup', 80, 90)) })

    // free map: the same hold sets the point, and its release is not a tap that undoes it
    under = { lng: 7.57175, lat: 47.52015 }
    await hold(canvas, 40, 40)
    expect(await screen.findByText('bei Starenstrasse 19')).toBeTruthy()
    act(() => { canvas.dispatchEvent(touchEvent('pointerup', 40, 40)); lastMap().onMapClick([7.57175, 47.52015]) })
    expect(screen.getByText('bei Starenstrasse 19')).toBeTruthy()

    // a mouse never holds: it has the hover (which answers a MOVE), so its press lights nothing
    under = { lng: 7.5701, lat: 47.5237 }
    act(() => { canvas.dispatchEvent(touchEvent('pointerdown', 40, 40, 'mouse')) })
    expect(lit()).toBe(false)
    box.remove()
  })

  it('drops a pin with the tool and files a Meldung at that place', async () => {
    const { onOpenVisits } = mount()
    await screen.findByRole('button', { name: /Schloss Musterdorf/ })
    fireEvent.click(screen.getByRole('button', { name: 'Punkt setzen' }))
    act(() => lastMap().onMapClick([7.57175, 47.52015]))
    expect(await screen.findByText('bei Starenstrasse 19')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Melden' }))
    const href = onOpenVisits.mock.calls[0][0] as string
    const q = new URLSearchParams(href.split('?')[1])
    expect(href.startsWith('/besuche/neu?')).toBe(true)
    expect(q.get('label')).toBe('bei Starenstrasse 19')
    expect(q.get('address')).toBe('Starenstrasse 19, 9999 Musterdorf')
    expect(q.get('from')).toBe('karte')
    expect(q.get('checkliste')).toBe('fehlermeldung')
  })

  // owner, 28.10.2026: a dropped point exists only for its panel – closing that takes it away, phone
  // too (a closed object or building sheet keeps the place selected for a second look)
  it('on a phone: closing a dropped point\'s sheet takes the point off the map', async () => {
    rec.phone = true
    mount()
    await screen.findByRole('button', { name: /Schloss Musterdorf/ })
    fireEvent.click(screen.getByRole('button', { name: 'Punkt setzen' }))
    act(() => lastMap().onMapClick([7.57175, 47.52015]))
    expect(await screen.findByText('bei Starenstrasse 19')).toBeTruthy()
    const pinAt = () => document.querySelector('[data-marker][data-lng="7.57175"][data-lat="47.52015"]')
    expect(pinAt()).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: appConfig.copy.closeDialog }))
    await waitFor(() => expect(pinAt()).toBeNull())
    expect(screen.queryByText('bei Starenstrasse 19')).toBeNull()
  })

  it('searches the catalogue on the device, objects with plans first', async () => {
    mount()
    await screen.findByRole('button', { name: /Schloss Musterdorf/ })
    fireEvent.change(screen.getByPlaceholderText('Adresse oder Objekt suchen …', PLAIN), { target: { value: 'schloss' } })
    const options = await screen.findAllByRole('option')
    expect(options[0].textContent).toMatch(/Schloss Musterdorf/)
    expect(options[1].textContent).toMatch(/Remise Schloss/)
  })

  // review round 2
  it('lists an object as glyph · name · address, without its plan count', async () => {
    mount()
    await screen.findByRole('button', { name: /Schloss Musterdorf/ })
    const field = screen.getByPlaceholderText('Adresse oder Objekt suchen …', PLAIN)
    fireEvent.focus(field)
    // nothing typed: the objects nearest the map centre, each with its distance (review round 11)
    const nearest = await screen.findAllByRole('option')
    const schloss = nearest.find((o) => /Schloss Musterdorf/.test(o.textContent ?? ''))
    expect(schloss?.textContent).toContain('Schlossgasse 9, 9999 Musterdorf')
    expect(schloss?.textContent).toMatch(/\d m|\d km/)
    expect(schloss?.textContent).not.toMatch(/Plan|Pläne/)
    fireEvent.change(field, { target: { value: 'starenstrasse' } })
    const [box] = await screen.findAllByRole('option')
    // the name IS the address: printed once, the kind quietly under it — never in its place
    expect(within(box).getByText('Starenstrasse 7')).toBeTruthy()
    expect(within(box).getByText('Stationsobjekt')).toBeTruthy()
    expect(box.textContent).not.toMatch(/keine Pläne/)
  })

  it('switches every Ebene, the station objects included, with «Alle aus» / «Alle ein» / «Standard»', async () => {
    mount()
    await screen.findByRole('button', { name: /Schloss Musterdorf/ })
    fireEvent.click(screen.getByRole('button', { name: 'Ebenen' }))
    const objects = () => screen.getByRole('button', { name: /^Stationsobjekte – / })
    const chip = (name: string) => screen.getByRole('button', { name })
    expect(chip('Standard').getAttribute('aria-pressed')).toBe('true')
    expect(objects().getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(chip('Alle aus'))
    expect(objects().getAttribute('aria-pressed')).toBe('false')
    expect(chip('Alle aus').getAttribute('aria-pressed')).toBe('true')
    // the objects are off the map: no tag to tap
    expect(screen.queryByRole('button', { name: /^Schloss Musterdorf/ })).toBeNull()
    fireEvent.click(chip('Alle ein'))
    expect(objects().getAttribute('aria-pressed')).toBe('true')
    expect(chip('Alle ein').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(chip('Standard'))
    expect(chip('Standard').getAttribute('aria-pressed')).toBe('true')
    // a row switched by hand: none of the three is lit
    fireEvent.click(objects())
    for (const n of ['Alle ein', 'Alle aus', 'Standard']) expect(chip(n).getAttribute('aria-pressed')).toBe('false')
  })

  it('«Unterirdische Bauten»: a Station row, ON when the viewer opens and part of «Standard», drawn dashed under the objects', async () => {
    const sq = (lng: number, lat: number, d: number) => [[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]]
    rec.underground = { fetchedAt: '2026-10-17T03:00:00+00:00', count: 2, geometry: { type: 'MultiPolygon', coordinates: [[sq(7.5701, 47.5237, 0.0002)], [sq(7.5710, 47.5230, 0.0001)]] } }
    rec.catalogue = {
      ...CATALOGUE,
      objects: CATALOGUE.objects.map((o) => (o.id === 'schloss' ? { ...o, footprint: { type: 'MultiPolygon', coordinates: [[sq(7.5700, 47.5236, 0.0004)]] } } : o)),
    }
    mount()
    await screen.findByRole('button', { name: /Schloss Musterdorf/ })
    type Ov = { id: string; color?: string; rings?: LngLat[][]; lineDasharray?: number[]; fillOpacity?: number; minzoom?: number; layer?: string }
    const overlays = () => (lastMap() as unknown as { preparedOverlays: Ov[] }).preparedOverlays
    const visible = (id: string) => (lastMap() as unknown as { isVisible: (l: string) => boolean }).isVisible(id)
    // owner, review round 5: on by default — asked once as the viewer opens, drawn without a tap
    await waitFor(() => expect(overlays().some((o) => o.id === 'karte-underground')).toBe(true))
    expect(rec.undergroundAsked).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Ebenen' }))
    const row = () => screen.getByRole('button', { name: /^Unterirdische Bauten – / })
    const chip = (name: string) => screen.getByRole('button', { name })
    // in the Station group, on, and «Standard» is lit with it on
    const heads = [...document.querySelectorAll('.lgroup')].filter((h) => h.compareDocumentPosition(row()) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(heads[heads.length - 1]?.textContent).toBe('Station')
    expect(row().getAttribute('aria-pressed')).toBe('true')
    expect(chip('Standard').getAttribute('aria-pressed')).toBe('true')
    expect(row().textContent).toMatch(/2 Bauten/)
    const ov = overlays().find((o) => o.id === 'karte-underground')!
    expect(ov.rings).toHaveLength(2)
    expect(ov.rings![0]).toHaveLength(4) // open rings: the map closes them
    expect(ov.lineDasharray).toBeTruthy()
    expect(ov.fillOpacity).toBe(0)
    expect(ov.minzoom).toBe(16)
    expect(visible(ov.layer!)).toBe(true)
    // neutral, never the objects' red; and UNDER them, so an object's own dashed garage stays on top
    const objects = overlays().find((o) => o.id === 'karte-objects')!
    expect(ov.color).not.toBe(objects.color)
    expect(overlays().indexOf(ov)).toBeLessThan(overlays().indexOf(objects))
    // switched off by hand: gone, and «Standard» is no longer lit — it puts it back on
    fireEvent.click(row())
    expect(row().getAttribute('aria-pressed')).toBe('false')
    await waitFor(() => expect(overlays().some((o) => o.id === 'karte-underground')).toBe(false))
    expect(chip('Standard').getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(chip('Standard'))
    expect(row().getAttribute('aria-pressed')).toBe('true')
    await waitFor(() => expect(overlays().some((o) => o.id === 'karte-underground')).toBe(true))
    // «Alle aus» switches it like any row — the set is kept, not asked again
    fireEvent.click(chip('Alle aus'))
    expect(row().getAttribute('aria-pressed')).toBe('false')
    await waitFor(() => expect(overlays().some((o) => o.id === 'karte-underground')).toBe(false))
    fireEvent.click(chip('Alle ein'))
    await waitFor(() => expect(overlays().some((o) => o.id === 'karte-underground')).toBe(true))
    expect(rec.undergroundAsked).toBe(1)
  })

  it('«Unterirdische Bauten» says so when there is nothing to draw, and asks again next time', async () => {
    mount()
    await screen.findByRole('button', { name: /Schloss Musterdorf/ })
    fireEvent.click(screen.getByRole('button', { name: 'Ebenen' }))
    const row = () => screen.getByRole('button', { name: /^Unterirdische Bauten – / })
    await waitFor(() => expect(row().textContent).toMatch(/Nicht verfügbar/))
    expect(rec.undergroundAsked).toBe(1)
    fireEvent.click(row())
    fireEvent.click(row())
    await waitFor(() => expect(rec.undergroundAsked).toBe(2))
  })

  // owner on #383: the Karte (only) never zooms past the visible base's last sharp level
  it('asks the map to stop at the base map\'s last sharp zoom', async () => {
    mount()
    await screen.findByRole('button', { name: /Schloss Musterdorf/ })
    expect((lastMap() as unknown as { zoomCapAtBase?: boolean }).zoomCapAtBase).toBe(true)
  })

  it('opens a deep link on its object — a plan-less one as an object like any other', async () => {
    window.history.replaceState(null, '', '/karte?objekt=depot')
    mount()
    expect(await screen.findByRole('heading', { name: 'Remise Schloss' })).toBeTruthy()
    // owner R3: no «Schlüsseldepot» kicker, note or glyph — the kind word and the register
    expect(screen.getAllByText('Stationsobjekt').length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toMatch(/Schlüsseldepot/)
    expect(document.querySelector('[data-section="register"]')).not.toBeNull()
  })

  // home (variant B): the old launcher card is the menu sheet — App's content, opened here
  it('opens the launcher content as the menu sheet and shuts it when a row acts', async () => {
    brand.short = 'FWM'
    const { launcherRow } = mount({ einsaetze: { badge: 2, render: (close) => <button type="button" onClick={() => { close() }}>Manueller Einsatz</button> } })
    void launcherRow
    // the count is in the name; on the button it is a dot (owner, review round 5)
    const button = screen.getByRole('button', { name: 'Menü – Feuerwehr Musterdorf, 2 offen' })
    expect(button.querySelector('[data-karte-menu-dot]')).not.toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Menü' })).toBeNull()
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Menü' })).getByRole('button', { name: 'Manueller Einsatz' }))
    expect(screen.queryByRole('dialog', { name: 'Menü' })).toBeNull()
    // Escape and a press outside close it too
    fireEvent.click(button)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Menü' })).toBeNull()
    fireEvent.click(button)
    fireEvent.pointerDown(screen.getByTestId('mapview'))
    expect(screen.queryByRole('dialog', { name: 'Menü' })).toBeNull()
  })

  // the app menu's offline row on home is the viewer's own «Auf diesem Gerät» (panels/AppMenuRows)
  it('hands the sheet a door to «Auf diesem Gerät», which shuts the sheet and opens it', async () => {
    mount({ einsaetze: { badge: 0, render: (_close, onDevice) => <button type="button" onClick={onDevice}>Gerät</button> } })
    fireEvent.click(screen.getByRole('button', { name: /^Menü/ }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Menü' })).getByRole('button', { name: 'Gerät' }))
    expect(screen.queryByRole('dialog', { name: 'Menü' })).toBeNull()
    expect(await screen.findByRole('dialog', { name: appConfig.copy.karte.device.title })).toBeTruthy()
  })

  // owner's pick 6A (sweep F.2): the chip names the first REAL Einsatz, not `running[0]`; one «+N»
  // counts every other open one, Übungen included, and opens the menu. Only Übungen → the Übung.
  it('names the first real Einsatz on the running chip and counts the rest in one «+N» that opens the menu', () => {
    type Meta = KarteAppProps['running'][number]
    const inc = (id: string, title: string, is_exercise: boolean) =>
      ({ id, title, address: 'Schlossgasse 9, Musterdorf', is_exercise }) as unknown as Meta
    const onOpenIncident = vi.fn()
    mount({ running: [inc('u1', 'Übung Atemschutz', true), inc('e1', 'Zimmerbrand Schloss', false), inc('e2', 'Ölspur', false)], onOpenIncident })
    const chip = document.querySelector('[data-karte-running-chip]')!
    expect(within(chip as HTMLElement).getByText('Zimmerbrand Schloss')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Einsatz öffnen: Zimmerbrand Schloss' }))
    expect(onOpenIncident).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }))
    const more = screen.getByRole('button', { name: 'Weitere offen: 2 – Menü öffnen' })
    expect(more.textContent).toBe('+2')
    fireEvent.click(more)
    expect(screen.getByRole('dialog', { name: 'Menü' })).toBeTruthy()
    cleanup()
    mount({ running: [inc('u1', 'Übung Atemschutz', true)] })
    expect(screen.getByRole('button', { name: 'Einsatz öffnen: Übung Atemschutz' })).toBeTruthy()
    expect(document.querySelector('[data-karte-running-more]')).toBeNull()
  })

  it('keeps no dot with nothing running and no alarm to take', async () => {
    mount()
    await screen.findByRole('button', { name: /Schloss Musterdorf/ })
    expect(screen.getByRole('button', { name: 'Menü – Feuerwehr Musterdorf' })).toBeTruthy()
    expect(document.querySelector('[data-karte-menu-dot]')).toBeNull()
  })

  // owner, review round 6: «main dropdown fix chevron not moving» — its ▾ carries the app's shared
  // `.chev`, which flips on [aria-expanded=true] like every other dropdown (02-base.css)
  it('flips the menu button’s chevron while the menu is open', () => {
    mount()
    const b = document.querySelector('[data-karte-menu]')!
    expect(b.querySelector('.chev')).not.toBeNull()
    expect(b.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(b)
    expect(b.getAttribute('aria-expanded')).toBe('true')
  })

  // owner, review round 5: «not "Einsätze" as the main top button» → the station's short name
  // and/or mark, ▾; with neither configured a neutral menu symbol — never the word «Einsätze»
  it('wears the station on the menu button: short name, mark, both, or the menu symbol', () => {
    const face = () => {
      const b = document.querySelector('[data-karte-menu]')!
      return { text: b.textContent, img: b.querySelector('img')?.getAttribute('src') ?? null, symbol: !!b.querySelector('use[href="#menu"]') }
    }
    mount()
    expect(face()).toEqual({ text: '', img: null, symbol: true })
    expect(document.body.textContent).not.toMatch(/Einsätze/)
    cleanup()
    brand.short = 'FWM'
    mount()
    expect(face()).toEqual({ text: 'FWM', img: null, symbol: false })
    cleanup()
    brand.mark = '/api/branding/file/mark.svg'
    mount()
    expect(face()).toEqual({ text: 'FWM', img: '/api/branding/file/mark.svg', symbol: false })
    cleanup()
    brand.short = null
    mount()
    expect(face()).toEqual({ text: '', img: '/api/branding/file/mark.svg', symbol: false })
    // a mark that cannot load steps back to the symbol, never a broken image
    fireEvent.error(document.querySelector('[data-karte-menu] img')!)
    expect(face()).toEqual({ text: '', img: null, symbol: true })
  })

  it('comes back from an Einsatz where it was left — object, plan, tool — and says so once', async () => {
    sessionStorage.setItem('kp.karte.view', JSON.stringify({
      center: [7.570188, 47.523773], zoom: 18, bearing: 0, objectId: 'schloss', surface: { plan: 'plan:schloss:modul1' },
      tool: 'layers', label: 'Schloss Musterdorf · Modul 1',
    }))
    window.history.replaceState(null, '', '/karte')
    mount({ announceReturn: true })
    await waitFor(() => expect(vi.mocked(toast)).toHaveBeenCalled())
    expect(vi.mocked(toast)).toHaveBeenCalledWith('Wieder bei Schloss Musterdorf · Modul 1', { icon: 'check' })
    expect(vi.mocked(toast)).toHaveBeenCalledTimes(1)
    // the tool that was open is open again, and the label the Einsatz menu reads is kept
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem('kp.karte.view')!)).toMatchObject({
      objectId: 'schloss', surface: { plan: 'plan:schloss:modul1' }, tool: 'layers', label: 'Schloss Musterdorf · Modul 1',
    }))
  })

  it('says nothing on a plain start (home), only after an Einsatz', async () => {
    window.history.replaceState(null, '', '/')
    sessionStorage.setItem('kp.karte.view', JSON.stringify({ center: [7.57, 47.52], zoom: 16, bearing: 0, objectId: 'schloss', surface: 'karte', label: 'Schloss Musterdorf' }))
    mount()
    expect(await screen.findByRole('heading', { name: 'Schloss Musterdorf' })).toBeTruthy()
    expect(vi.mocked(toast)).not.toHaveBeenCalled()
    // home lives at `/`: the selection does not move it to /karte
    expect(window.location.pathname).toBe('/')
  })

  // owner-4 (17.10.2026): on a phone the plans are rows in the object's sheet — the bar has no
  // «Pläne» tab — and an open plan goes back to the map with its «Zurück» chip
  it('on a phone: no Pläne tab, the plan opens from the sheet and goes back to it', async () => {
    rec.phone = true
    mount()
    const nav = await screen.findByRole('navigation', { name: 'Karte & Objekte' })
    expect(within(nav).queryByRole('button', { name: /Pläne/ })).toBeNull()
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['Karte', 'Checkliste', 'Messen', 'Gefahrgut', 'Ebenen'])
    fireEvent.click(await screen.findByRole('button', { name: /Schloss Musterdorf/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Modul 1' }))
    expect(await screen.findByTestId('pdf')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Schloss Musterdorf' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Zurück/ }))
    expect(await screen.findByRole('heading', { name: 'Schloss Musterdorf' })).toBeTruthy()
    expect(screen.queryByTestId('pdf')).toBeNull()
  })

  // owner, 19.10.2026 (Checkliste on the Karte home, variant A): the bar never changes — the two
  // surfaces │ the map's tools; a tool tapped on the Checkliste goes back to the Karte with it armed
  it('on a phone: Karte · Checkliste │ tools, the bar field feeds the library, a tool goes back armed', async () => {
    rec.phone = true
    mount()
    const nav = await screen.findByRole('navigation', { name: 'Karte & Objekte' })
    const sep = nav.querySelector('.nav-sep')!
    expect(sep.previousElementSibling?.textContent).toBe('Checkliste')
    expect(sep.nextElementSibling?.textContent).toBe('Messen')
    fireEvent.click(within(nav).getByRole('button', { name: 'Checkliste' }))
    expect(screen.getByTestId('library')).toBeTruthy()
    // the map's round search button, the pin and the compass are the map's
    expect(screen.queryByRole('button', { name: 'Suchen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Punkt setzen' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Anleitung oder Checkliste suchen', PLAIN), { target: { value: 'Generator' } })
    expect(screen.getByTestId('library').textContent).toBe('Generator')
    fireEvent.click(within(nav).getByRole('button', { name: 'Messen' }))
    expect(screen.queryByTestId('library')).toBeNull()
    expect(within(nav).getByRole('button', { name: 'Messen' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Suchen' })).toBeTruthy()
  })

  // «Beschriftung» reaches every bar here as in an Einsatz (owner, 07.11.2026) – and the left
  // rail keeps its chevron with the words on (the regression of 20.10.2026 was losing it)
  it('with saved toolbar labels: words on every bar, and the left rail still expands and collapses', async () => {
    const prefs = loadPrefs()
    savePrefs({ ...prefs, railLabels: 'short', railLabelsChosen: true })
    try {
      mount()
      const rail = screen.getByRole('navigation', { name: 'Karte & Objekte' })
      expect(rail.classList.contains('labelled')).toBe(true)
      expect(document.querySelector('aside.tool-rail.labelled')).toBeTruthy()
      expect(document.querySelector('.view-bar.labelled')).toBeTruthy()
      expect(document.documentElement.style.getPropertyValue('--rail-w')).toBe('92px')
      fireEvent.click(within(rail).getByRole('button', { name: 'Ausklappen' }))
      expect(rail.classList.contains('expanded')).toBe(true)
      expect(document.documentElement.style.getPropertyValue('--rail-w')).toBe('216px')
      fireEvent.click(within(rail).getByRole('button', { name: 'Einklappen' }))
      expect(rail.classList.contains('expanded')).toBe(false)
      expect(document.documentElement.style.getPropertyValue('--rail-w')).toBe('92px')
      await act(async () => {})
    } finally {
      savePrefs(prefs)
    }
  })

  it('without them: glyphs only on every bar, the view bar too', async () => {
    const prefs = loadPrefs()
    savePrefs({ ...prefs, railLabels: 'off', railLabelsChosen: true })
    try {
      mount()
      expect(document.querySelector('.labelled')).toBeNull()
      expect(document.querySelector('.view-bar')).toBeTruthy()
      await act(async () => {})
    } finally {
      savePrefs(prefs)
    }
  })

  // the viewer's keyboard (lib/karte/hotkeys): the Einsatz's keys where they mean the same, and
  // its own P · U · / for what the Einsatz has no surface for
  describe('the keyboard', () => {
    const key = (k: string, mod: KeyboardEventInit = {}) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mod })) })
    const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed')

    it('D arms Messen, Escape puts it away; P and U arm Punkt setzen and Gefahrgut', async () => {
      mount()
      await act(async () => {})
      key('d')
      expect(pressed(appConfig.copy.karte.tools.measure)).toBe('true')
      key('Escape')
      expect(pressed(appConfig.copy.karte.tools.measure)).toBe('false')
      key('p')
      expect(pressed(appConfig.copy.karte.tools.pin)).toBe('true')
      key('u')
      expect(pressed(appConfig.copy.karte.tools.erg)).toBe('true')
    })

    it('C opens the Checkliste and K goes back; / focuses the bar\'s search field', async () => {
      mount()
      await act(async () => {})
      key('c')
      expect(document.querySelector('[data-karte-library-surface]')).toBeTruthy()
      key('k')
      expect(document.querySelector('[data-karte-library-surface]')).toBeNull()
      key('/')
      expect(document.activeElement).toBe(screen.getByPlaceholderText('Adresse oder Objekt suchen …', PLAIN))
    })

    it('⌘, and ? hand over to App\'s Einstellungen and Hilfe – and nothing reaches the viewer while App holds the keys', async () => {
      const { onSettings, onHelp } = mount()
      await act(async () => {})
      key(',', { metaKey: true })
      key('?')
      expect(onSettings).toHaveBeenCalledTimes(1)
      expect(onHelp).toHaveBeenCalledTimes(1)
      cleanup()
      const off = mount({ keysOff: true })
      await act(async () => {})
      key('?')
      key('d')
      expect(off.onHelp).not.toHaveBeenCalled()
      expect(pressed(appConfig.copy.karte.tools.measure)).toBe('false')
    })

    it('a key typed into the search is text, not a shortcut', async () => {
      mount()
      await act(async () => {})
      const field = screen.getByPlaceholderText('Adresse oder Objekt suchen …', PLAIN)
      field.focus()
      key('d')
      expect(pressed(appConfig.copy.karte.tools.measure)).toBe('false')
    })
  })

  it('on a tablet: the rail always holds Karte and Checkliste, the plans hang under them; the bar searches the library', async () => {
    mount()
    const rail = () => screen.getByRole('navigation', { name: /Karte & Objekte|Schloss Musterdorf/ })
    // the rail's tiles (its «Ausklappen» chevron and grip are KartePlans.test's)
    const tiles = () => [...rail().querySelectorAll('.nav-item')].map((b) => b.getAttribute('aria-label'))
    expect(tiles()).toEqual(['Karte', 'Checkliste'])
    fireEvent.click(await screen.findByRole('button', { name: /Schloss Musterdorf/ }))
    await waitFor(() => expect(tiles()).toEqual(['Karte', 'Checkliste', 'Modul 1 · Übersicht']))
    expect(document.querySelector('.tool-rail')).toBeTruthy()
    fireEvent.click(within(rail()).getByRole('button', { name: 'Checkliste' }))
    expect(screen.getByTestId('library')).toBeTruthy()
    // as on a plan: no tool rail; and the object's panel waits on the map
    expect(document.querySelector('.tool-rail')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Schloss Musterdorf' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Anleitung oder Checkliste suchen', PLAIN), { target: { value: 'Motorspritze' } })
    expect(screen.getByTestId('library').textContent).toBe('Motorspritze')
    fireEvent.click(within(rail()).getByRole('button', { name: 'Karte' }))
    expect(screen.queryByTestId('library')).toBeNull()
    expect(await screen.findByRole('heading', { name: 'Schloss Musterdorf' })).toBeTruthy()
    // the map's field kept its own words (none)
    expect((screen.getByPlaceholderText('Adresse oder Objekt suchen …', PLAIN) as HTMLInputElement).value).toBe('')
  })

  // owner R6: «When having opened a plan … and then going back to the map, sometimes the object
  // isn't neatly in focus» — a tap selects in place; back from the plan it is framed beside the
  // panel (the pixels: e2e/karte-plan-back-camera.mjs)
  it('on a tablet: back on the map from a plan, the object is framed in the free map beside the panel', async () => {
    const easeTo = vi.fn()
    rec.fakeMap = {
      getContainer: () => document.createElement('div'), getZoom: () => 17, getCenter: () => ({ lng: 7.57, lat: 47.52 }), getPadding: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
      unproject: () => ({ lng: 7.57, lat: 47.52 }), project: () => ({ x: 1100, y: 700 }), // visible: the tap leaves it there
      getBounds: () => ({ getWest: () => 7.5, getSouth: () => 47.5, getEast: () => 7.6, getNorth: () => 47.6 }),
      easeTo, jumpTo: () => {}, fitBounds: () => {}, getMap: () => ({ on: () => {} }),
    }
    mount()
    fireEvent.click(await screen.findByRole('button', { name: /Schloss Musterdorf/ }))
    const panel = await screen.findByRole('region', { name: 'Karte & Objekte' })
    expect(easeTo).not.toHaveBeenCalled()
    fireEvent.click(within(panel).getByRole('button', { name: 'Modul 1' }))
    expect(await screen.findByTestId('pdf')).toBeTruthy()
    fireEvent.click(within(screen.getByRole('navigation', { name: /Schloss Musterdorf/ })).getByRole('button', { name: 'Karte' }))
    await waitFor(() => expect(easeTo).toHaveBeenCalledTimes(1))
    // right of the panel beside the rail, left of the tool rail (lib/karte/camera · besidePanel)
    expect(easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [7.570188, 47.523773], padding: { top: 80, bottom: 0, left: 496, right: 76 } }))
  })

  it('comes back on the Checkliste with the session, unless a deep link asks for an object', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Checkliste' }))
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem('kp.karte.view')!)).toMatchObject({ surface: 'checkliste', label: 'Checkliste' }))
    cleanup()
    mount()
    expect(await screen.findByTestId('library')).toBeTruthy()
    cleanup()
    window.history.replaceState(null, '', '/karte?objekt=schloss')
    mount()
    expect(await screen.findByRole('heading', { name: 'Schloss Musterdorf' })).toBeTruthy()
    expect(screen.queryByTestId('library')).toBeNull()
  })

  // owner R2: «using the normal pdf viewer we have just without the annotation» — the Einsatz's
  // plan reader, and nothing it could write with
  it('opens a plan in the Einsatz\'s reader, read-only, with no writer behind it', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: /Schloss Musterdorf/ }))
    const fetchBefore = vi.mocked(fetch).mock.calls.length
    // the panel's row (the tablet's rail names the same document)
    fireEvent.click(within(await screen.findByRole('region', { name: 'Karte & Objekte' })).getByRole('button', { name: 'Modul 1' }))
    expect(await screen.findByTestId('pdf')).toBeTruthy()
    const p = rec.board[rec.board.length - 1] as Record<string, unknown> & { plans: { id: string; imageUrl: string }[] }
    expect(p.readOnly).toBe(true)
    expect(p.slimTools).toBe(false)
    expect(p.linkViewer).toBe(true)
    expect(p.annos).toEqual([])
    expect(p.plans.map((d) => d.imageUrl)).toEqual(['/api/reference/plan%3Aschloss%3Amodul1?v=1'])
    // no door to anything stored under an Einsatz: none of these is handed in
    for (const k of ['incidentId', 'onCalibrate', 'onObjectSwitch', 'onReorient', 'onPlanLiveMove', 'onLinkTrupp', 'onTeamTrupp', 'tafel', 'historyRef']) expect(p[k]).toBeUndefined()
    // the keyboard's handles are handed (0 Einpassen, + − zoom – useKarteKeys), and the viewer
    // reaches only those two: a tool or a duplicate is never asked for (lib/karte/hotkeys has none)
    expect(p.fitRef).toBeTruthy()
    expect(p.keysRef).toBeTruthy()
    // …and what it must be handed writes nothing
    const keys = () => [Object.keys(localStorage).sort(), Object.keys(sessionStorage).sort()]
    const stored = keys()
    ;(p.onChange as (a: unknown[]) => void)([{ id: 'x', kind: 'text', x: 0.5, y: 0.5 }])
    ;(p.log as (i: string, t: string) => void)('pen', 'gezeichnet')
    ;(p.emit as (op: string) => void)('board.add')
    ;(p.onAddFloor as (d: number) => void)(1)
    expect(keys()).toEqual(stored)
    expect(vi.mocked(fetch).mock.calls.slice(fetchBefore).filter(([, init]) => (init as RequestInit | undefined)?.method && (init as RequestInit).method !== 'GET')).toEqual([])
    expect((rec.board[rec.board.length - 1] as { annos: unknown[] }).annos).toEqual([])
  })

  // owner, review round 4: «gebäude should be literally 1:1 the same as in the normal incident just
  // without editing» — the Einsatz's Whiteboard on its floor stack, fed with the object's pack
  it('opens the Gebäude in the Einsatz\'s own stack, read-only, with no door to an edit', async () => {
    const m6 = { id: 'plan:schloss:modul6', module: 'modul6', code: '6', title: 'Modul 6', pages: 1, georef: false, version: 2 }
    rec.catalogue = {
      ...CATALOGUE,
      objects: CATALOGUE.objects.map((o) => (o.id === 'schloss' ? { ...o, plans: [...o.plans, m6], floors: [{ index: 0, name: null }, { index: 1, name: null }] } : o)),
    }
    const meta = {
      dataset_id: m6.id, plan_version: 2, revision_url: '',
      floors: [{ page: 0, index: 0, name: 'EG', clip: [0, 0, 0.5, 1] }, { page: 0, index: 1, name: null, clip: [0.5, 0, 1, 1] }],
      alignments: [{ id: 3, page: 0, aspect: 1.414, approved_at: '2026-10-01', pairs: [
        { plan: { x: 0.1, y: 0.1 }, lngLat: { lng: 7.57, lat: 47.524 } }, { plan: { x: 0.4, y: 0.4 }, lngLat: { lng: 7.571, lat: 47.523 } }] }],
    }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('modul6/alignments')
      ? new Response(JSON.stringify(meta), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } }))))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: /Schloss Musterdorf/ }))
    fireEvent.click(within(await screen.findByRole('region', { name: 'Karte & Objekte' })).getByRole('button', { name: 'Gebäude' }))
    await waitFor(() => expect(rec.board.some((b) => (b as { building?: unknown }).building)).toBe(true), { timeout: 6000 })
    const p = rec.board[rec.board.length - 1] as Record<string, unknown> & { plans: { id: string; floorStack?: boolean }[]; building: { floors: number[]; pack: { aspect: number }; floorNames?: Record<string, string> }; floorPack: { floors: unknown[] } }
    expect(p.plans.map((d) => [d.id, !!d.floorStack])).toEqual([['gebaeude', true]])
    expect(p.building.floors).toEqual([0, 1])
    expect(p.building.floorNames).toEqual({ 0: 'EG' })
    expect(p.building.pack.aspect).toBe(1.414)
    expect(p.floorPack.floors).toHaveLength(2)
    expect(p.readOnly).toBe(true)
    expect(p.linkViewer).toBe(true)
    // no building pick, no compass turn, no calibration, no Einsatz behind it
    for (const k of ['onBuildingFace', 'onReorient', 'onCalibrate', 'onObjectSwitch', 'incidentId', 'tafel']) expect(p[k]).toBeUndefined()
  }, 10000)

  // owner R2: closing the phone sheet returns to the map with the place still selected, and a
  // second tap on it brings the sheet back
  it('on a phone: ✕ shuts the sheet, the object stays selected, a tap on it reopens', async () => {
    rec.phone = true
    mount()
    fireEvent.click(await screen.findByRole('button', { name: /Schloss Musterdorf/ }))
    const sheet = await screen.findByRole('region', { name: 'Karte & Objekte' })
    expect(sheet.classList.contains('layers-card')).toBe(true)
    const closes = within(sheet).getAllByRole('button', { name: 'Schliessen' })
    fireEvent.click(closes[closes.length - 1])
    expect(screen.queryByRole('heading', { name: 'Schloss Musterdorf' })).toBeNull()
    // still selected: the address keeps it, the tag stays drawn
    expect(window.location.search).toBe('?objekt=schloss')
    fireEvent.click(screen.getByRole('button', { name: /Schloss Musterdorf/ }))
    expect(await screen.findByRole('heading', { name: 'Schloss Musterdorf' })).toBeTruthy()
  })
  // review round 3 (owner's iPhone): the phone's bar has a round search button, the field lives in
  // an Ebenen-style slide-up whose first line it is; picking a row closes it and selects
  it('on a phone: the search is a button that opens a sheet with the field first, focused, no contact AutoFill', async () => {
    rec.phone = true
    mount()
    await screen.findByRole('button', { name: /Schloss Musterdorf/ })
    expect(screen.queryByPlaceholderText('Adresse oder Objekt suchen …', PLAIN)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Suchen' }))
    const sheet = await screen.findByRole('region', { name: 'Suchen' })
    const field = within(sheet).getByPlaceholderText('Adresse oder Objekt suchen …', PLAIN) as HTMLInputElement
    expect(document.activeElement).toBe(field)
    expect(field.name).toBe('search-karte')
    expect(field.getAttribute('autocomplete')).toBe('off')
    expect(field.getAttribute('autocorrect')).toBe('off')
    expect(field.placeholder).not.toContain('Adresse')
    fireEvent.change(field, { target: { value: 'schloss' } })
    const [first] = await within(sheet).findAllByRole('option')
    fireEvent.click(first)
    expect(screen.queryByRole('region', { name: 'Suchen' })).toBeNull()
    expect(await screen.findByRole('heading', { name: 'Schloss Musterdorf' })).toBeTruthy()
  })

  it('on a phone: the search sheet stays when the keyboard goes, and ✕ closes it', async () => {
    rec.phone = true
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Suchen' }))
    const sheet = await screen.findByRole('region', { name: 'Suchen' })
    ;(document.activeElement as HTMLElement).blur()
    expect(screen.getByRole('region', { name: 'Suchen' })).toBe(sheet)
    fireEvent.click(within(sheet).getByRole('button', { name: appConfig.copy.closeDialog }))
    expect(screen.queryByRole('region', { name: 'Suchen' })).toBeNull()
  })

  it('on a phone: Gefahrgut is a slide-up with the UN field as its first line, a number field iOS will not autofill', async () => {
    rec.phone = true
    mount()
    const nav = await screen.findByRole('navigation', { name: 'Karte & Objekte' })
    fireEvent.click(within(nav).getByRole('button', { name: /Gefahrgut/ }))
    const sheet = await screen.findByRole('region', { name: 'Gefahrgut' })
    expect(sheet.classList.contains('layers-card')).toBe(true)
    const field = sheet.querySelector('input') as HTMLInputElement
    expect(field.id).toBe('karte-un')
    expect(field).toMatchObject({ name: 'search-karte-un', inputMode: 'numeric' })
    expect(field.getAttribute('autocomplete')).toBe('off')
    expect(field.getAttribute('spellcheck')).toBe('false')
    fireEvent.change(field, { target: { value: '12a03' } })
    expect(field.value).toBe('1203')
    // the readout replaces the empty card's offline line, under the field
    expect(within(sheet).queryByText(appConfig.copy.karte.ergOffline)).toBeNull()
    expect(sheet.querySelector('input')).toBe(field)
  })
  // owner (review round 3): a tap on «Gefahrgut» with no number opens the sheet with the caret in
  // the UN field (the number pad up); with a number already set it opens on the result, no keyboard
  it('on a phone: Gefahrgut opens with the caret in the UN field, or on its result without one', async () => {
    rec.phone = true
    mount()
    const nav = await screen.findByRole('navigation', { name: 'Karte & Objekte' })
    const tab = within(nav).getByRole('button', { name: /Gefahrgut/ })
    fireEvent.click(tab)
    let sheet = await screen.findByRole('region', { name: 'Gefahrgut' })
    const field = sheet.querySelector('input') as HTMLInputElement
    expect(document.activeElement).toBe(field)
    fireEvent.change(field, { target: { value: '1203' } })
    field.blur()
    fireEvent.click(tab)
    expect(screen.queryByRole('region', { name: 'Gefahrgut' })).toBeNull()
    fireEvent.click(tab)
    sheet = await screen.findByRole('region', { name: 'Gefahrgut' })
    expect((sheet.querySelector('input') as HTMLInputElement).value).toBe('1203')
    expect(document.activeElement).not.toBe(sheet.querySelector('input'))
  })

  // owner R4-6 (17.10.2026): «while measuring we should also be able to measure on top of objects
  // (not have the objects get highlighted)» — a tap tool takes the tap on a tag or dot too
  it('measures over an object: its tag lets the tap through, nothing is selected', async () => {
    mount()
    const tag = await screen.findByRole('button', { name: /Schloss Musterdorf/ })
    fireEvent.click(screen.getByRole('button', { name: 'Messen' }))
    const marker = screen.getByRole('button', { name: /Schloss Musterdorf/ })
    expect(marker.className).toMatch(/through/)
    // a click that reaches it anyway (a keyboard) is the tool's, at the object's point
    fireEvent.click(marker)
    act(() => lastMap().onMapClick([7.5708, 47.52455]))
    await waitFor(() => expect(lastMap().measurePoints).toEqual([[7.570188, 47.523773], [7.5708, 47.52455]]))
    expect(screen.queryByRole('heading', { name: 'Schloss Musterdorf' })).toBeNull()
    expect(window.location.search).toBe('')
    // Messen off: the object is the object's again
    fireEvent.click(screen.getByRole('button', { name: 'Messen' }))
    expect(screen.getByRole('button', { name: /Schloss Musterdorf/ }).className).not.toMatch(/through/)
    expect(tag).toBeTruthy()
  })

  // owner R4-7: «after closing … revert the position again so it doesn't constantly push the map
  // south» (the rule itself: lib/karte/camera.test)
  it('on a phone: closing the sheet eases the camera back to where it was, unless the user moved it', async () => {
    rec.phone = true
    let cam = { center: { lng: 7.56, lat: 47.52 }, zoom: 15.5, padding: { top: 0, bottom: 0, left: 0, right: 0 } }
    const handlers: Record<string, (e: unknown) => void> = {}
    const easeTo = vi.fn((o: { center?: LngLat; zoom?: number; padding?: typeof cam.padding }) => {
      cam = { center: o.center ? { lng: o.center[0], lat: o.center[1] } : cam.center, zoom: o.zoom ?? cam.zoom, padding: o.padding ?? cam.padding }
    })
    const map = {
      getContainer: () => document.createElement('div'), getZoom: () => cam.zoom, getCenter: () => cam.center, getPadding: () => cam.padding,
      unproject: () => ({ lng: 7.56, lat: 47.52 }), project: () => ({ x: 200, y: 700 }), getBounds: () => ({ getWest: () => 7.5, getSouth: () => 47.5, getEast: () => 7.6, getNorth: () => 47.6 }),
      easeTo, jumpTo: () => {}, fitBounds: () => {},
    }
    rec.fakeMap = { ...map, getMap: () => ({ on: (ev: string, h: (e: unknown) => void) => { handlers[ev] = h } }) }
    mount()
    await screen.findByRole('button', { name: /Schloss Musterdorf/ })
    act(() => (lastMap() as unknown as { onSettled: () => void }).onSettled())
    const start = { ...cam }
    fireEvent.click(screen.getByRole('button', { name: /Schloss Musterdorf/ }))
    await screen.findByRole('region', { name: 'Karte & Objekte' })
    // the tap framed it in the strip above the sheet (padding) …
    expect(cam.padding.bottom).toBeGreaterThan(0)
    // … another object from «In der Nähe» while it is open keeps the FIRST camera as the way back
    fireEvent.click(screen.getAllByRole('button', { name: /Starenstrasse 7/ }).find((b) => !b.closest('[data-marker]'))!)
    await screen.findByRole('heading', { name: 'Starenstrasse 7' })
    let sheet = screen.getByRole('region', { name: 'Karte & Objekte' })
    const close = within(sheet).getAllByRole('button', { name: appConfig.copy.closeDialog })
    fireEvent.click(close[close.length - 1])
    expect(easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ center: [start.center.lng, start.center.lat], zoom: start.zoom, padding: start.padding }))

    // the user pans while the sheet is open: closing leaves the map where they put it
    fireEvent.click(screen.getByRole('button', { name: /Schloss Musterdorf/ }))
    sheet = await screen.findByRole('region', { name: 'Karte & Objekte' })
    act(() => handlers.movestart({ originalEvent: new Event('touchstart') }))
    const calls = easeTo.mock.calls.length
    const closeAgain = within(sheet).getAllByRole('button', { name: appConfig.copy.closeDialog })
    fireEvent.click(closeAgain[closeAgain.length - 1])
    expect(easeTo.mock.calls.length).toBe(calls)
  })

  // owner, Karte Haus round 2: a tap on one house of a row (Amselstrasse 30) moved the map to the
  // whole row's label – it reveals the tapped house, like a plain building
  it('on a phone: a tap on one of an object\'s houses reveals that house, not the object\'s point', async () => {
    rec.phone = true
    const sq = (lng: number, lat: number, d: number) => [[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]]
    rec.catalogue = { ...CATALOGUE, objects: CATALOGUE.objects.map((o) => (o.id === 'schloss' ? { ...o, footprint: { type: 'MultiPolygon', coordinates: [[sq(7.5700, 47.5236, 0.0002)], [sq(7.5702, 47.5236, 0.0002)]] } } : o)) }
    const easeTo = vi.fn()
    rec.fakeMap = {
      getContainer: () => document.createElement('div'), getZoom: () => 17, getCenter: () => ({ lng: 7.57, lat: 47.52 }), getPadding: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
      unproject: () => ({ lng: 7.56, lat: 47.52 }), project: () => ({ x: 200, y: window.innerHeight - 10 }), // behind the sheet
      getBounds: () => ({ getWest: () => 7.5, getSouth: () => 47.5, getEast: () => 7.6, getNorth: () => 47.6 }),
      easeTo, jumpTo: () => {}, fitBounds: () => {}, getMap: () => ({ on: () => {} }),
    }
    mount()
    await screen.findByRole('button', { name: /Schloss Musterdorf/ })
    act(() => lastMap().onMapClick([7.5703, 47.5237]))
    expect(await screen.findByRole('heading', { name: 'Schloss Musterdorf' })).toBeTruthy()
    expect(easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ center: [7.5703, 47.5237] }))
  })

  // owner, Karte Haus round 2: «when tapping the closest hydrant, the hydrant ebene should be activated»
  it('a tap on a hydrant row of In der Nähe switches the Hydranten Ebene on', async () => {
    rec.extraLayers = [{ id: 'hydranten', group: 'Referenz', label: 'Hydranten', icon: 'drop', visible: false, geojson: '/hydranten.geojson', vectorKind: 'point' }]
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('hydranten')
      ? new Response(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [7.5703, 47.5239] } }] }), { headers: { 'content-type': 'application/json' } })
      : new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } }))))
    mount()
    const hydrantsOn = () => (lastMap() as unknown as { layers: LayerDef[] }).layers.find((l) => l.id === 'hydranten')?.visible
    fireEvent.click(await screen.findByRole('button', { name: /Schloss Musterdorf/ }))
    const near = await waitFor(() => document.querySelector('[data-section="nearby"]') as HTMLElement)
    const row = await within(near).findByRole('button', { name: /Hydrant/ })
    expect(hydrantsOn()).toBe(false)
    fireEvent.click(row)
    await waitFor(() => expect(hydrantsOn()).toBe(true))
  })

  // owner, Karte Haus round 2: «change the long press on the compass to zoom in to the user's
  // location which is more likely than the entire village» – the village only without a position
  it('holding the compass zooms onto my position, and fits the village when there is none', async () => {
    rec.phone = true
    const easeTo = vi.fn(), fitBounds = vi.fn()
    rec.fakeMap = {
      getContainer: () => document.createElement('div'), getZoom: () => 14, getCenter: () => ({ lng: 7.57, lat: 47.52 }), getPadding: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
      unproject: () => ({ lng: 7.56, lat: 47.52 }), project: () => ({ x: 200, y: 200 }),
      getBounds: () => ({ getWest: () => 7.5, getSouth: () => 47.5, getEast: () => 7.6, getNorth: () => 47.6 }),
      easeTo, jumpTo: () => {}, fitBounds, getMap: () => ({ on: () => {} }),
    }
    let granted = true
    vi.stubGlobal('navigator', { ...navigator, geolocation: {
      getCurrentPosition: (ok: PositionCallback, err: PositionErrorCallback) => (granted
        ? ok({ coords: { longitude: 7.571, latitude: 47.524 } } as GeolocationPosition)
        : err({ code: 1 } as GeolocationPositionError)),
    } })
    mount()
    await screen.findByRole('button', { name: /Schloss Musterdorf/ })
    const hold = async () => {
      const compass = screen.getAllByRole('button', { name: appConfig.copy.mapViews.title })[0]
      fireEvent.pointerDown(compass, { clientX: 0, clientY: 0, button: 0, pointerType: 'touch' })
      await act(async () => { await new Promise((r) => setTimeout(r, 600)) })
    }
    await hold()
    expect(easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ center: [7.571, 47.524], zoom: 17 }))
    expect(fitBounds).not.toHaveBeenCalled()
    granted = false
    await hold()
    expect(fitBounds).toHaveBeenCalledTimes(1)
  })

  // owner R4-3: «for the gefahrgut stuff we also need to know the name (show it as attribute)»
  it('on a phone: Gefahrgut names the substance first («Stoff»)', async () => {
    __setUnHazardData(adr as UnHazardEntry[])
    rec.phone = true
    mount()
    const nav = await screen.findByRole('navigation', { name: 'Karte & Objekte' })
    fireEvent.click(within(nav).getByRole('button', { name: /Gefahrgut/ }))
    const sheet = await screen.findByRole('region', { name: 'Gefahrgut' })
    fireEvent.change(sheet.querySelector('input') as HTMLInputElement, { target: { value: '1203' } })
    // review round 7: the name is the readout's hero line, not a «Stoff» row — first thing in
    // the readout, with the label kept for the screen reader
    const hero = (await within(sheet).findByText(/BENZIN oder OTTOKRAFTSTOFF/)).closest('.un-haz-hero')
    expect(hero).toBeTruthy()
    expect(hero?.textContent).toBe(`${appConfig.copy.contextPanel.unSubstance}: BENZIN oder OTTOKRAFTSTOFF`)
    expect(hero?.previousElementSibling?.className).toContain('ctx-section-label')
  })

  // owner R4-1: «move "station" up in ebenen all the way to the top»
  // review round 7, owner: «on this new landing page we don't get a notification that a new version
  // is ready» — the Einsatz's own row, in the same strip, with the same two faces
  it('announces a waiting build in the Meldeleiste: «Jetzt aktualisieren», dismissible, back for the next deploy', async () => {
    mount()
    render(<Meldeleiste />)
    const U = appConfig.copy.update
    expect(screen.queryByText(U.available)).toBeNull()
    act(() => sw.announce?.(true))
    expect(await screen.findByText(U.available)).toBeTruthy()
    expect(screen.getByText(U.hintApply)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: U.dismiss }))
    await waitFor(() => expect(screen.queryByText(U.available)).toBeNull())
    // the next deploy says it again
    act(() => sw.announce?.(true))
    expect(await screen.findByText(U.available)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: U.apply }))
    expect(sw.apply).toHaveBeenCalledTimes(1)
    // an update that resolves on its own retracts the row
    act(() => sw.announce?.(false))
    await waitFor(() => expect(screen.queryByText(U.available)).toBeNull())
  })

  it('on iOS the waiting build reads «App schliessen & neu öffnen», with nothing to tap but ✕', async () => {
    sw.platform = 'ios'
    mount()
    render(<Meldeleiste />)
    const U = appConfig.copy.update
    act(() => sw.announce?.(true))
    expect(await screen.findByText(U.hint)).toBeTruthy()
    expect(screen.queryByRole('button', { name: U.apply })).toBeNull()
    expect(screen.getByRole('button', { name: U.dismiss })).toBeTruthy()
  })

  it('says «Aktualisiert – v…» once after an update reload lands on the Karte', async () => {
    sw.landed = true
    mount()
    await waitFor(() => expect(vi.mocked(toast)).toHaveBeenCalledWith(expect.stringContaining(appConfig.copy.update.updated.split('{v}')[0]), { icon: 'check', tone: 'success' }))
    expect(vi.mocked(toast)).toHaveBeenCalledTimes(1)
  })

  it('lists «Grundkarte» first and the «Station» group right under it in its Ebenen', async () => {
    mount()
    await screen.findByRole('button', { name: /Schloss Musterdorf/ })
    fireEvent.click(screen.getByRole('button', { name: appConfig.copy.karte.tools.layers }))
    const heads = [...document.querySelectorAll('.layers-card .lgroup')].map((el) => el.textContent)
    expect(heads.slice(0, 2)).toEqual([appConfig.copy.baseMap, appConfig.copy.karte.layerGroupStation])
  })
})
