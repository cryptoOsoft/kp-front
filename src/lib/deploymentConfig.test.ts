import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { alarmProviderName, atemschutzDoctrine, incidentCategories, atemschutzEquipment, carrySessionOnly, demoNote, getDeploymentConfig, loadDeploymentConfig, bootDeploymentConfig, mapReferenceLayers, moduleAlignment, moduleViewer, personnelProviderName, reportLinks, stripLocality } from './deploymentConfig'
import { idbSet, __resetIdbForTests } from './idb'

describe('mapReferenceLayers', () => {
  it('returns [] for missing/empty input', () => {
    expect(mapReferenceLayers(undefined)).toEqual([])
    expect(mapReferenceLayers([])).toEqual([])
  })

  it('maps a geojson point layer with its symbol + colours', () => {
    const [l] = mapReferenceLayers([
      {
        id: 'hydrant', group: 'Wasser', label: 'Hydranten', icon: 'drop', kind: 'geojson',
        geojson: '/api/reference/geo:hydrant', vectorKind: 'point', symbol: 'SI Ueberflurhydrant',
        color: '#0f52b5', nightColor: '#5b9bff', opacity: 100, attribution: '© FireGIS',
      },
    ])
    expect(l).toMatchObject({
      id: 'hydrant', group: 'Wasser', label: 'Hydranten', base: false, visible: false,
      geojson: '/api/reference/geo:hydrant', vectorKind: 'point', symbol: 'SI Ueberflurhydrant',
      color: '#0f52b5', nightColor: '#5b9bff', opacity: 100,
    })
  })

  it('defaults vectorKind to line and supplies group/label/icon fallbacks', () => {
    const [l] = mapReferenceLayers([{ id: 'leitung', kind: 'geojson', geojson: '/api/reference/geo:leitung' }])
    expect(l).toMatchObject({ id: 'leitung', group: 'Referenz', label: 'leitung', icon: 'map', vectorKind: 'line' })
  })

  it('passes autoActivate through, dropping an empty list', () => {
    const [a, b] = mapReferenceLayers([
      { id: 'hydrant', kind: 'geojson', geojson: '/api/reference/geo:hydrant', autoActivate: ['Brandbekämpfung'] },
      { id: 'leitung', kind: 'geojson', geojson: '/api/reference/geo:leitung', autoActivate: [] },
    ])
    expect(a.autoActivate).toEqual(['Brandbekämpfung'])
    expect(b.autoActivate).toBeUndefined()
  })

  it('maps a wms/wmts layer to a raster overlay with tiles', () => {
    const [l] = mapReferenceLayers([
      { id: 'flood', group: 'Gefahren', label: 'Hochwasser', kind: 'wms', tiles: ['https://x/{z}/{x}/{y}'], opacity: 65 },
    ])
    expect(l).toMatchObject({ id: 'flood', base: false, tiles: ['https://x/{z}/{x}/{y}'], opacity: 65 })
    expect(l.geojson).toBeUndefined()
  })

  it('skips entries missing an id or their required source', () => {
    expect(mapReferenceLayers([
      { group: 'Wasser', kind: 'geojson', geojson: '/x' },                  // no id
      { id: 'no-url', kind: 'geojson' },                                    // geojson layer, no url
      { id: 'inline', kind: 'geojson', geojson: { type: 'FeatureCollection' } }, // inline object unsupported
      { id: 'no-tiles', kind: 'wms', tiles: [] },                           // wms, no tiles
    ])).toEqual([])
  })
})

describe('stripLocality — home town off compact addresses', () => {
  it('strips the Divera prefix form «Town (KT), street»', () => {
    expect(stripLocality('Musterdorf (BL), Schlossgasse 9', '4104 Musterdorf BL')).toBe('Schlossgasse 9')
    expect(stripLocality('Musterdorf BL, Bachweg 1', 'Musterdorf (BL)')).toBe('Bachweg 1')
  })

  it('strips the swisstopo suffix form «street, PLZ Town»', () => {
    expect(stripLocality('Bachweg 3, 4104 Musterdorf', '4104 Musterdorf BL')).toBe('Bachweg 3')
    expect(stripLocality('Dorfplatz 12, Musterdorf', 'Musterdorf')).toBe('Dorfplatz 12')
  })

  it('leaves OUT-of-town addresses untouched (they should stand out)', () => {
    expect(stripLocality('Nachbarwil (BL), Bahnhofstrasse 2', '4104 Musterdorf BL')).toBe('Nachbarwil (BL), Bahnhofstrasse 2')
    expect(stripLocality('Muristrasse 5, 4054 Basel', '4104 Musterdorf BL')).toBe('Muristrasse 5, 4054 Basel')
  })

  it('never matches inside a longer word (Musterdorferstrasse stays intact)', () => {
    expect(stripLocality('Musterdorferstrasse 5, 4054 Basel', 'Musterdorf')).toBe('Musterdorferstrasse 5, 4054 Basel')
  })

  it('degrades safely: empty locality, and a town-only address returns itself', () => {
    expect(stripLocality('Musterdorf (BL), Bachweg 1', null)).toBe('Musterdorf (BL), Bachweg 1')
    expect(stripLocality('Musterdorf (BL)', '4104 Musterdorf BL')).toBe('Musterdorf (BL)')
  })
})

// bootDeploymentConfig is the ONE await on the config before createRoot. A device that has booted
// before must not wait for the network at all (a round trip per launch, cold-start sweep
// 01.11.2026); a first boot must settle within its budget.
describe('bootDeploymentConfig — the launch never waits for /api/config it already has', () => {
  const CACHE_KEY = 'kp-front-deployment-config'
  const fetchMock = vi.fn()

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    __resetIdbForTests()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })
  afterEach(() => { vi.unstubAllGlobals() })

  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

  it('serves the cached config at once and hands the fresh one to onFresh', async () => {
    await idbSet(CACHE_KEY, { identity: { appName: 'Cached' } })
    let answer!: (r: Response) => void
    fetchMock.mockReturnValueOnce(new Promise<Response>((res) => { answer = res }))
    const onFresh = vi.fn()
    const cfg = await bootDeploymentConfig(2_000, onFresh)
    expect(cfg.identity?.appName).toBe('Cached')
    // the synchronous accessor is seeded too, so read sites get the STATION's config from the
    // very first render
    expect(getDeploymentConfig().identity?.appName).toBe('Cached')

    answer(json({ identity: { appName: 'Fresh' } }))
    await vi.waitFor(() => expect(onFresh).toHaveBeenCalledWith({ identity: { appName: 'Fresh' } }))
    expect(getDeploymentConfig().identity?.appName).toBe('Fresh')
  })

  it('waits for the network on a first boot', async () => {
    fetchMock.mockResolvedValueOnce(json({ identity: { appName: 'Fresh' } }))
    const cfg = await bootDeploymentConfig(2_000, () => {})
    expect(cfg.identity?.appName).toBe('Fresh')
  })

  it('settles with what it has on a stalled first boot — never hangs', async () => {
    fetchMock.mockReturnValueOnce(new Promise(() => {}))
    // what it has: `{}` on a real first boot; the module singleton outlives single tests here
    await expect(bootDeploymentConfig(30, () => {})).resolves.toBe(getDeploymentConfig())
  })

  it('never lets a late anonymous response replace the authenticated demo config', async () => {
    let resolveAnonymous!: (response: Response) => void
    let resolveAuthenticated!: (response: Response) => void
    fetchMock
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveAnonymous = resolve }))
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveAuthenticated = resolve }))

    const anonymous = loadDeploymentConfig()
    const authenticated = loadDeploymentConfig()
    resolveAuthenticated(json({ identity: { demoMode: true }, integrations: { cartoBasemapKey: 'session-key' } }))
    await authenticated
    expect(getDeploymentConfig().integrations?.cartoBasemapKey).toBe('session-key')

    resolveAnonymous(json({ identity: { demoMode: true } }))
    await anonymous
    expect(getDeploymentConfig().integrations?.cartoBasemapKey).toBe('session-key')
  })
})

// ⚠️ Copy must never hard-code «Divera». Every station saw «übernimm einen Divera-Alarm» — the
// ones on another source, and the ones entering every Einsatz by hand, who were being pointed at
// a product they do not have. The neutral sentence is the default; naming a source is the
// exception, and `null` here is what selects it.
describe('naming the Alarm-/Personalquelle only where there is one', () => {
  const load = async (cfg: unknown) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(cfg), {
      status: 200, headers: { 'content-type': 'application/json' },
    })))
    await loadDeploymentConfig()
  }
  afterEach(() => { vi.unstubAllGlobals() })

  it('is null on a station with no integrations at all — the hand-entry case', async () => {
    await load({})
    expect(alarmProviderName()).toBeNull()
    expect(personnelProviderName()).toBeNull()
  })

  it('is null when a provider is registered but NOT configured', async () => {
    // «registered» is a code capability; «configured» is env. Only the second one means a
    // station can actually take an alarm, and unset must not look like working.
    await load({ integrations: { alarms: { provider: 'divera', configured: false, capabilities: [] } } })
    expect(alarmProviderName()).toBeNull()
  })

  it('names whichever provider this station runs, not Divera by default', async () => {
    await load({ integrations: { alarms: { provider: 'ilias', configured: true, capabilities: ['pool', 'take'] } } })
    expect(alarmProviderName()).toBe('Ilias')
  })

  it('is null for a webhook-only station — its Einsätze open by themselves, nothing to take', async () => {
    // ⚠️ The sentence this feeds is «übernimm einen X-Alarm», and the generic webhook has no
    // pool: `admin/DataView` renders no Alarmquelle list for it and the app renders no «Alarm
    // übernehmen». Naming it pointed the operator at an affordance that does not exist.
    await load({
      integrations: {
        alarms: {
          provider: 'webhook', configured: true,
          capabilities: ['generic-webhook', 'auto-open', 'lifecycle'],
        },
      },
    })
    expect(alarmProviderName()).toBeNull()
  })

  it('is null for a configured provider that declares no capabilities at all', async () => {
    await load({ integrations: { alarms: { provider: 'ilias', configured: true, capabilities: [] } } })
    expect(alarmProviderName()).toBeNull()
  })

  it('still answers for an older backend that only sends the legacy flag', async () => {
    await load({ integrations: { diveraConfigured: true } })
    expect(alarmProviderName()).toBe('Divera')
    expect(personnelProviderName()).toBe('Divera')
  })

  it('keeps the two sources apart — a station can sync people without taking alarms', async () => {
    await load({ integrations: { personnel: { provider: 'divera', configured: true, capabilities: [] } } })
    expect(personnelProviderName()).toBe('Divera')
    expect(alarmProviderName()).toBeNull()
  })
})

/* The Ausrüstung list a Trupp picks from (types · Trupp.equipment): the station's own where it
 * has one, the shipped three otherwise — never a mix, and never nothing. */
describe('demoNote — only on a demo deployment', () => {
  const load = async (cfg: unknown) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(cfg), {
      status: 200, headers: { 'content-type': 'application/json' },
    })))
    await loadDeploymentConfig()
  }
  afterEach(() => { vi.unstubAllGlobals() })
  const note = 'Demo-Zugang · PIN 000000 für alle'

  it('shows the note while demoMode is on', async () => {
    await load({ identity: { demoMode: true, demoNote: note } })
    expect(demoNote()).toBe(note)
  })

  it('hides it once demoMode is off, even though the field is still set', async () => {
    await load({ identity: { demoMode: false, demoNote: note } })
    expect(demoNote()).toBeNull()
    await load({ identity: { demoNote: note } })
    expect(demoNote()).toBeNull()
  })
})

describe('Atemschutz equipment list', () => {
  const load = async (doctrine: unknown) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ doctrine }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })))
    await loadDeploymentConfig()
  }
  afterEach(() => { vi.unstubAllGlobals() })

  it('ships Retthaube · WBK · Multiwarn when the station lists nothing', async () => {
    await load({})
    expect(atemschutzEquipment().map((e) => e.id)).toEqual(['retthaube', 'wbk', 'multiwarn'])
  })

  it('lets the station’s own list win outright, dropping entries without id or label', async () => {
    await load({ equipment: [{ id: 'wbk', label: 'Wärmebildkamera' }, { id: '', label: 'x' }, { label: 'no id' }] })
    expect(atemschutzEquipment()).toEqual([{ id: 'wbk', label: 'Wärmebildkamera' }])
  })

  it('falls back to the default when the station’s list is empty after cleaning', async () => {
    await load({ equipment: [{ id: ' ', label: '' }] })
    expect(atemschutzEquipment().map((e) => e.id)).toEqual(['retthaube', 'wbk', 'multiwarn'])
  })
})

describe('incidentCategories — the server owns the Kategorien', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('offers the served German labels in the served order, and nothing before they arrive', async () => {
    const serve = async (body: unknown) => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
        status: 200, headers: { 'content-type': 'application/json' },
      })))
      await loadDeploymentConfig()
    }
    await serve({ categoryLabels: { strassenrettung: 'Strassenrettung', brandbekaempfung: 'Brandbekämpfung' } })
    expect(incidentCategories()).toEqual(['Strassenrettung', 'Brandbekämpfung'])
    await serve({})
    expect(incidentCategories()).toEqual([])
  })
})

describe('Atemschutz pressure-alarm doctrine', () => {
  const load = async (doctrine: unknown) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ doctrine }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })))
    await loadDeploymentConfig()
  }
  afterEach(() => { vi.unstubAllGlobals() })

  it('disables both pressure alarms when the demo uses an Alarmdruck of 0', async () => {
    await load({ alarmBar: 0, alarmBarRueckzug: 50 })
    expect(atemschutzDoctrine()).toMatchObject({ alarmBar: 0, alarmBarRueckzug: 0 })
  })

  it('keeps the shipped Rückzug line for an ordinary Alarmdruck', async () => {
    await load({ alarmBar: 100 })
    expect(atemschutzDoctrine()).toMatchObject({ alarmBar: 100, alarmBarRueckzug: 50 })
  })

  it('clamps the shipped Rückzug line to a lower custom Alarmdruck', async () => {
    await load({ alarmBar: 40 })
    expect(atemschutzDoctrine()).toMatchObject({ alarmBar: 40, alarmBarRueckzug: 40 })
  })

  it('also clamps a stale explicit Rückzug line above the active Alarmdruck', async () => {
    await load({ alarmBar: 40, alarmBarRueckzug: 60 })
    expect(atemschutzDoctrine()).toMatchObject({ alarmBar: 40, alarmBarRueckzug: 40 })
  })

  // the Eingangsdruck minimum (24.09.2026): the station's number, else the shipped 270 — and a
  // stored 0 stays 0, because that is how a station switches the question off
  it('reads the Eingangsdruck minimum off the station, with 270 as the shipped default', async () => {
    await load({})
    expect(atemschutzDoctrine().entryPressureMin).toBe(270)
    await load({ entryPressureMin: 250 })
    expect(atemschutzDoctrine().entryPressureMin).toBe(250)
    await load({ entryPressureMin: 0 })
    expect(atemschutzDoctrine().entryPressureMin).toBe(0)
  })
})

// `reportLinks()` is the boundary the whole «Formulare & Links» feature rests on: whatever it
// returns is rendered on the Rapport and handed to `window.open`. The config document is
// admin-written, but it is still DATA — and it also arrives from the `admin_config` CLI, which
// does not go through the API's validation at all.
describe('reportLinks — what is allowed onto the Rapport', () => {
  const load = async (cfg: unknown) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(cfg), {
      status: 200, headers: { 'content-type': 'application/json' },
    })))
    await loadDeploymentConfig()
  }
  afterEach(() => { vi.unstubAllGlobals() })

  const withLinks = (links: unknown[]) => load({ report: { links } })
  const ok = { id: 'getraenke', title: 'Getränkeabrechnung', url: 'https://forms.example.ch/f' }

  it('is empty on a station that configured none — which is what removes the section', async () => {
    await load({})
    expect(reportLinks()).toEqual([])
    await load({ report: {} })
    expect(reportLinks()).toEqual([])
  })

  it('passes a configured form through untouched, placeholders and all', async () => {
    await withLinks([{ ...ok, url: 'https://forms.example.ch/f?a={ort}', note: 'nur bei Bezug' }])
    expect(reportLinks()).toHaveLength(1)
    expect(reportLinks()[0].url).toBe('https://forms.example.ch/f?a={ort}')
  })

  it('drops a URL this app would refuse to open', async () => {
    // ⚠️ The one that matters: an href out of the config document must never be able to run.
    await withLinks([{ ...ok, url: 'javascript:alert(1)' }])
    expect(reportLinks()).toEqual([])
    await withLinks([{ ...ok, url: 'data:text/html,<script>alert(1)</script>' }])
    expect(reportLinks()).toEqual([])
    await withLinks([{ ...ok, url: '//evil.example' }])
    expect(reportLinks()).toEqual([])
  })

  it('drops a row with nothing to show or nothing to file the tick under', async () => {
    await withLinks([{ ...ok, title: '   ' }])
    expect(reportLinks()).toEqual([])
    await withLinks([{ ...ok, id: '' }])
    expect(reportLinks()).toEqual([])
  })

  it('drops only the bad row, never the good ones beside it', async () => {
    await withLinks([{ ...ok, url: 'javascript:alert(1)' }, { ...ok, id: 'schaden' }])
    expect(reportLinks().map((l) => l.id)).toEqual(['schaden'])
  })

  it('survives junk in the document rather than taking the Rapport down with it', async () => {
    // reachable via `admin_config load` of a hand-edited file
    await withLinks([null, 'nonsense', {}])
    expect(reportLinks()).toEqual([])
  })
})

// `/api/config` withholds the CARTO key and the Rapport links from an anonymous caller without
// saying so — and the boot fetch IS anonymous whenever the access cookie has expired. An answer
// that lacks them where the previous one had them is «withheld», never «removed».
describe('carrySessionOnly — an anonymous answer never downgrades a keyed config', () => {
  type Cfg = Parameters<typeof carrySessionOnly>[0]
  const link = { id: 'l1', url: 'https://x' } as unknown as NonNullable<NonNullable<Cfg['report']>['links']>[number]
  const keyed: Cfg = { integrations: { cartoBasemapKey: 'k1' }, report: { links: [link] } }

  it('carries the key and the links over an answer that withholds them', () => {
    const out = carrySessionOnly(keyed, { identity: { appName: 'FWO' } })
    expect(out.integrations?.cartoBasemapKey).toBe('k1')
    expect(out.report?.links).toHaveLength(1)
    expect(out.identity?.appName).toBe('FWO')
  })

  it('lets a session-bearing answer replace both (a rotated key wins)', () => {
    const out = carrySessionOnly(keyed, { integrations: { cartoBasemapKey: 'k2' }, report: { links: [] } })
    expect(out.integrations?.cartoBasemapKey).toBe('k2')
    // an empty list is indistinguishable from a withheld one, so the previous links stay
    expect(out.report?.links).toHaveLength(1)
  })

  it('is the identity when nothing was known before', () => {
    const next: Cfg = { integrations: {} }
    expect(carrySessionOnly({}, next)).toBe(next)
  })
})

// Oberwil's Wasser 1/2/3 arrive as `modul5-wasser1…3` (the sub-slot capture keeps its trailing
// number, or the second waterplan overwrites the first). They opened viewer-only — no drawing,
// no «Karte verknüpfen» — because only the unnumbered `modul5-wasser` was in the catalogue and
// the siblings fell through to the `modul5` family default.
describe('moduleViewer — a numbered sub-slot is still its own slot', () => {
  const CATALOGUE = [
    { id: 'modul3', code: 'M3', viewer: false },
    { id: 'modul2-3', code: '2/3', viewer: false, combinedWith: ['modul2', 'modul3'] },
    { id: 'modul5', code: 'M5', family: true, viewer: true },
    { id: 'modul5-pv', code: 'PV', viewer: true },
    { id: 'modul5-wasser', code: 'W', viewer: false },
  ]
  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ modules: CATALOGUE }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })))
    await loadDeploymentConfig()
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('reads the numbered waterplans off `modul5-wasser`, not off the family', () => {
    expect(moduleViewer('modul5-wasser')).toBe(false)
    expect(moduleViewer('modul5-wasser1')).toBe(false)
    expect(moduleViewer('modul5-wasser3')).toBe(false)
  })

  it('keeps a numbered sibling of a viewer slot viewer-only', () => {
    expect(moduleViewer('modul5-pv15')).toBe(true)
  })

  it('leaves an unconfigured sub-slot on the family default', () => {
    expect(moduleViewer('modul5-rwa')).toBe(true)
    expect(moduleViewer('modul5-evak2')).toBe(true)
  })

  it('never mistakes a module number or a combined sheet for a sibling', () => {
    expect(moduleViewer('modul5')).toBe(true)   // the family's own id
    expect(moduleViewer('modul2-3')).toBe(false) // a combined sheet, not «modul2» + a number
  })
})

describe('moduleAlignment — the catalogue decides which sheets the server may propose for', () => {
  it('defaults to auto for Modul 1/2/2-3 and none elsewhere, with the shipped catalogue or none at all', () => {
    expect(moduleAlignment(undefined, 'modul1')).toBe('auto')
    expect(moduleAlignment([], 'modul2-3')).toBe('auto')
    expect(moduleAlignment(undefined, 'modul6')).toBe('none')
  })
  it('honours an explicit choice and lets a family sub-slot inherit its family', () => {
    const catalogue = [{ id: 'modul2', alignment: 'manual' as const }, { id: 'modul5', family: true, alignment: 'auto' as const }, { id: 'modul6' }]
    expect(moduleAlignment(catalogue, 'modul2')).toBe('manual')
    expect(moduleAlignment(catalogue, 'modul5-wasser1')).toBe('auto')
    expect(moduleAlignment(catalogue, 'modul6')).toBe('none')
    expect(moduleAlignment(catalogue, 'modul1')).toBe('auto')
  })
})

describe('Modul 5 – Zusatz is read, not marked up', () => {
  // a station without its own catalogue: the national defaults decide
  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })))
    await loadDeploymentConfig()
  })
  afterEach(() => { vi.unstubAllGlobals() })
  it('opens viewer-only by default, while a numbered Wasser sibling stays annotatable', () => {
    expect(moduleViewer('modul5-zusatz')).toBe(true)
    expect(moduleViewer('modul5-wasser1')).toBe(false)
    expect(moduleViewer('modul6')).toBe(true)
  })
})

describe('a module can step behind the Gebäude', () => {
  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ modules: [
      { id: 'modul6', code: 'M6', viewer: true, hideWhenGebaeude: true },
      { id: 'modul5', code: 'M5', family: true, hideWhenGebaeude: true },
      { id: 'modul5-wasser', code: 'W' },
    ] }), { status: 200, headers: { 'content-type': 'application/json' } })))
    await loadDeploymentConfig()
  })
  afterEach(() => { vi.unstubAllGlobals() })
  it('resolves exact, sibling and family like the viewer flag; default off', async () => {
    const { moduleHiddenWithGebaeude } = await import('./deploymentConfig')
    expect(moduleHiddenWithGebaeude('modul6')).toBe(true)
    expect(moduleHiddenWithGebaeude('modul5-pv')).toBe(true) // family
    expect(moduleHiddenWithGebaeude('modul5-wasser2')).toBe(false) // the numbered sibling's own slot
    expect(moduleHiddenWithGebaeude('modul1')).toBe(false)
  })
})
