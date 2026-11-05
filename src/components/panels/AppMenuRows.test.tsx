// @vitest-environment jsdom
// The app menu's rows, as home's «Einsätze ▾» sheet renders them (no card, alarms to take) —
// the in-Einsatz side is IncidentSwitcher.test.tsx.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { AppMenuRows, type AppMenuAlarms } from './AppMenuRows'
import { appConfig } from '../../config/appConfig'
import type { DiveraAlarm, IncidentMeta } from '../../lib/incidents'

afterEach(cleanup)

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const incident = (id: string, title: string, extra: Partial<IncidentMeta> = {}) => ({
  id, title, address: 'Musterweg 1', started_at: minutesAgo(30), status: 'offen', is_archived: false, is_exercise: false, ...extra,
}) as unknown as IncidentMeta
const alarm = (divera_id: number, title: string): DiveraAlarm => ({
  id: `al-${divera_id}`, divera_id, divera_number: null, title, text: null, address: 'Testgasse 3', lat: null, lng: null, taken_incident_id: null,
  received_at: minutesAgo(1), is_taken: false,
})

type Props = Parameters<typeof AppMenuRows>[0]
function renderHome(extra: Partial<Props> = {}) {
  return render(
    <AppMenuRows
      activeId={null}
      incidents={[]}
      isEditor
      user={{ display_name: 'Muster Anna', color: null, role: 'editor' }}
      onSwitch={() => {}}
      onHistory={() => {}}
      onCreate={() => {}}
      onHelp={() => {}}
      {...extra}
    />,
  )
}
const cs = appConfig.copy.incidentSwitcher
const ci = appConfig.copy.intake

describe('AppMenuRows · home (no card)', () => {
  it('says in one quiet line that nothing is open, then the doors', () => {
    renderHome({ onLogout: () => {} })
    expect(screen.getByText(cs.incidents)).toBeTruthy()
    expect(screen.getByText(cs.noOpenIncidents)).toBeTruthy()
    expect(screen.getByRole('button', { name: cs.allIncidents })).toBeTruthy()
    expect(screen.getByRole('button', { name: ci.titleNew })).toBeTruthy()
    expect(screen.getByRole('button', { name: cs.logout })).toBeTruthy()
    // nothing of the old launcher card
    expect(screen.queryByRole('button', { name: ci.manualIncident })).toBeNull()
    // and no «Einsatz verlassen»: there is no Einsatz to leave
    expect(screen.queryByRole('button', { name: /Einsatz verlassen/ })).toBeNull()
  })

  it('lists every running Einsatz — the one behind the viewer too — and not the closed ones', () => {
    const onSwitch = vi.fn()
    const behind = incident('a', 'Brand Musterhaus')
    renderHome({ incidents: [behind, incident('b', 'Ölspur'), incident('c', 'Vorbei', { is_archived: true })], onSwitch })
    expect(screen.queryByText(cs.noOpenIncidents)).toBeNull()
    expect(screen.queryByRole('button', { name: /Vorbei/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Brand Musterhaus/ }))
    expect(onSwitch).toHaveBeenCalledWith(behind)
  })

  it('locks every row while an Einsatz opens', () => {
    renderHome({ incidents: [incident('a', 'Brand Musterhaus'), incident('b', 'Ölspur')], opening: 'a' })
    expect((screen.getByRole('button', { name: /Brand Musterhaus/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /Ölspur/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('offers «Einsatz eröffnen» to an editor only', () => {
    renderHome({ isEditor: false })
    expect(screen.queryByRole('button', { name: ci.titleNew })).toBeNull()
  })

  it('draws «Üben» right above the Hilfe when handed, and not without', () => {
    const onUeben = vi.fn()
    renderHome({ onUeben })
    const row = screen.getByRole('button', { name: appConfig.copy.tutorials.menu })
    expect(row.nextElementSibling?.textContent).toBe(appConfig.copy.help.menu)
    fireEvent.click(row)
    expect(onUeben).toHaveBeenCalledTimes(1)
    cleanup()
    renderHome()
    expect(screen.queryByRole('button', { name: appConfig.copy.tutorials.menu })).toBeNull()
  })

  it('draws the offline row it is handed, in the App group', () => {
    const onOpen = vi.fn()
    renderHome({ offline: { label: appConfig.copy.karte.device.title, onOpen } })
    fireEvent.click(screen.getByRole('button', { name: appConfig.copy.karte.device.title }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})

// ⚠️ Safety-relevant: the take and the × behave exactly as on the old launcher card — the × hides
// the alarm on this device only and never takes it, and both lock while any take runs.
describe('AppMenuRows · alarms to take', () => {
  const alarms = (extra: Partial<AppMenuAlarms> = {}): AppMenuAlarms => ({
    list: [alarm(41, 'B2 Brand Wohnhaus')], taking: null, onTake: vi.fn(), onDismiss: vi.fn(), ...extra,
  })

  it('takes on the row, hides on the ×, and the × never takes', () => {
    const a = alarms()
    renderHome({ alarms: a, incidents: [incident('a', 'Brand Musterhaus')] })
    const row = screen.getByRole('button', { name: /B2 Brand Wohnhaus/ })
    expect(row.textContent).toContain(ci.newDiveraAlarm)
    expect(row.textContent).toContain(ci.alarmOpen)
    // the running Einsatz first, then the alarm
    expect(screen.getByRole('button', { name: /Brand Musterhaus/ }).compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: ci.dismiss }))
    expect(a.onDismiss).toHaveBeenCalledWith(a.list[0])
    expect(a.onTake).not.toHaveBeenCalled()
    fireEvent.click(row)
    expect(a.onTake).toHaveBeenCalledWith(a.list[0])
  })

  it('locks take and × while a take runs, and says so on that row', () => {
    renderHome({ alarms: alarms({ list: [alarm(41, 'B2 Brand Wohnhaus'), alarm(42, 'Ölwehr')], taking: 41 }) })
    const taking = screen.getByRole('button', { name: /B2 Brand Wohnhaus/ }) as HTMLButtonElement
    expect(taking.disabled).toBe(true)
    expect(taking.textContent).toContain(ci.alarmOpening)
    expect((screen.getByRole('button', { name: /Ölwehr/ }) as HTMLButtonElement).disabled).toBe(true)
    for (const x of screen.getAllByRole('button', { name: ci.dismiss })) expect((x as HTMLButtonElement).disabled).toBe(true)
  })

  it('an alarm alone is not «nothing open»', () => {
    const { container } = renderHome({ alarms: alarms() })
    expect(within(container).queryByText(cs.noOpenIncidents)).toBeNull()
  })
})
