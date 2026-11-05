// @vitest-environment jsdom
/**
 * The selected Trupp pill and its join sheet — the ONE copy every surface renders. What is pinned
 * here is what the sheet offers and what it calls; the surfaces' own wiring is covered by the
 * Whiteboard / MapMarkers tests.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { appConfig } from '../config/appConfig'
import type { Trupp } from '../types'
import { TwinTeamPill } from './TwinTeamPill'

afterEach(cleanup)

const A = appConfig.copy.atemschutz
const TRUPPS: Trupp[] = [
  { id: 't1', no: 2, name: 'Meier Anna', status: 'aktiv', members: [], readings: [] } as unknown as Trupp,
]

describe('the join sheet of a loose Trupp marker', () => {
  it('offers «Neuer Trupp» last, and it asks the surface to register one for THIS marker', () => {
    const newTrupp = vi.fn()
    const pick = vi.fn()
    render(<TwinTeamPill name="Trupp 3" color="#c00" raus={false} trailCount={0} trailShown={false} trupps={TRUPPS}
      acts={{ pick, newTrupp, clearTrail: () => {}, remove: () => {} }} />)
    fireEvent.click(screen.getByRole('button', { name: A.markerLabel }))
    const items = screen.getAllByRole('menuitem').map((el) => el.textContent)
    // no «Kein Trupp» on a marker that hangs on no hose (15.09.): the entry exists only on a hose
    expect(items).toEqual(['Meier Anna', appConfig.copy.whiteboard.newTeam])
    fireEvent.click(screen.getByRole('menuitem', { name: appConfig.copy.whiteboard.newTeam }))
    expect(newTrupp).toHaveBeenCalledTimes(1)
    expect(pick).not.toHaveBeenCalled()
  })

  it('has no «Neuer Trupp» row where the surface does not offer it', () => {
    render(<TwinTeamPill name="Trupp 3" color="#c00" raus={false} trailCount={0} trailShown={false} trupps={TRUPPS}
      acts={{ pick: () => {}, clearTrail: () => {}, remove: () => {} }} />)
    fireEvent.click(screen.getByRole('button', { name: A.markerLabel }))
    expect(screen.queryByRole('menuitem', { name: appConfig.copy.whiteboard.newTeam })).toBeNull()
  })
})

describe('the selected pill of a bound Trupp', () => {
  // the «#N» badge lives on the Atemschutz card only (docs/trupp-naming.md §2, 14.09.)
  it('shows the leader name alone — no «#N» badge', () => {
    const { container } = render(<TwinTeamPill name="Meier Anna" color="#c00" raus={false} truppId="t1" trailCount={0} trailShown={false} trupps={TRUPPS} />)
    expect(container.querySelector('.trupp-no')).toBeNull()
    expect(container.textContent).not.toContain('#2')
  })
})

// 18.09.2026
describe('the action bar and the trail', () => {
  const W = appConfig.copy.whiteboard
  const openTrash = () => fireEvent.click(screen.getByRole('button', { name: appConfig.copy.remove }))

  // ONE trash. The bar carried a second, footprint-glyphed «Spur löschen» button for a day, and
  // the building outline did not read as a delete — so the trash asks WHICH of the two goes.
  it('asks which of the two goes, and each row does exactly that', () => {
    const remove = vi.fn()
    const clearTrail = vi.fn()
    const removeWithTrail = vi.fn()
    render(<TwinTeamPill name="Müller" color="#c00" raus={false} trailCount={4} trailShown trupps={TRUPPS}
      acts={{ clearTrail, remove, removeWithTrail }} />)
    openTrash()
    expect(screen.getAllByRole('menuitem').map((el) => el.textContent))
      .toEqual([W.removeMarker, W.clearTrail, W.removeMarkerTrail])
    // …and the two that destroy the record are danger rows
    expect(screen.getByRole('menuitem', { name: W.removeMarker }).className).not.toContain('ui-menu-danger')
    for (const name of [W.clearTrail, W.removeMarkerTrail]) {
      expect(screen.getByRole('menuitem', { name }).className).toContain('ui-menu-danger')
    }

    fireEvent.click(screen.getByRole('menuitem', { name: W.removeMarker }))
    expect(remove).toHaveBeenCalledTimes(1)
    expect(clearTrail).not.toHaveBeenCalled()
    expect(removeWithTrail).not.toHaveBeenCalled()

    openTrash()
    fireEvent.click(screen.getByRole('menuitem', { name: W.clearTrail }))
    expect(clearTrail).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledTimes(1)

    openTrash()
    fireEvent.click(screen.getByRole('menuitem', { name: W.removeMarkerTrail }))
    expect(removeWithTrail).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledTimes(1)
    expect(clearTrail).toHaveBeenCalledTimes(1)
  })

  // nothing to ask about: the trash is the trash
  it('removes straight away where the marker carries no trail', () => {
    const remove = vi.fn()
    const clearTrail = vi.fn()
    render(<TwinTeamPill name="Müller" color="#c00" raus={false} trailCount={0} trailShown={false} trupps={TRUPPS}
      acts={{ clearTrail, remove, removeWithTrail: () => {} }} />)
    openTrash()
    expect(screen.queryAllByRole('menuitem')).toEqual([])
    expect(remove).toHaveBeenCalledTimes(1)
    expect(clearTrail).not.toHaveBeenCalled()
  })

  // …and the footprint button is gone: one delete, one glyph
  it('draws no second trail button beside the trash', () => {
    const { container } = render(<TwinTeamPill name="Müller" color="#c00" raus={false} trailCount={4} trailShown trupps={TRUPPS}
      acts={{ clearTrail: () => {}, remove: () => {} }} />)
    expect(container.querySelector('.wb-pa-trail')).toBeNull()
    expect(screen.queryByRole('button', { name: W.clearTrail })).toBeNull()
  })

  // a surface that does not offer the combined door draws two rows, not three — the same «a
  // missing writer draws no button» rule every other action here follows
  it('leaves «Marker und Spur löschen» out where the surface has no such writer', () => {
    render(<TwinTeamPill name="Müller" color="#c00" raus={false} trailCount={4} trailShown trupps={TRUPPS}
      acts={{ clearTrail: () => {}, remove: () => {} }} />)
    openTrash()
    expect(screen.getAllByRole('menuitem').map((el) => el.textContent)).toEqual([W.removeMarker, W.clearTrail])
  })
})

// a locked surface (viewer, el, Führungsansicht) passes only the two doors that change nothing
// (RBAC audit 22.10.2026): the jump to the Trupp's card and this device's trail toggle
describe('the view-only bar', () => {
  it('offers «Im Atemschutz zeigen» and «Spur ein/aus», and no trash', () => {
    const showTrupp = vi.fn()
    const toggleTrail = vi.fn()
    render(<TwinTeamPill name="Meier Anna" color="#c00" raus={false} truppId="t1" trailCount={3} trailShown trupps={TRUPPS}
      acts={{ showTrupp, toggleTrail }} />)
    expect(screen.queryByRole('button', { name: appConfig.copy.remove })).toBeNull()
    expect(screen.queryByRole('button', { name: A.markerLabel })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: appConfig.copy.whiteboard.showTrupp }))
    expect(showTrupp).toHaveBeenCalledWith('t1')
    fireEvent.click(screen.getByRole('button', { name: appConfig.copy.whiteboard.trails }))
    expect(toggleTrail).toHaveBeenCalledTimes(1)
  })
})

describe('the storey badge', () => {
  it('states the Geschoss the Trupp is working on, signed like a Leitung’s floor tag', () => {
    const { container } = render(<TwinTeamPill name="Müller" color="#c00" raus={false} floor={2} trailCount={0} trailShown={false} trupps={TRUPPS} />)
    expect(container.querySelector('.team-floor')?.textContent).toBe('+2')
    cleanup()
    // EG and a Untergeschoss read as themselves — a Trupp is as often in the Keller as upstairs
    const eg = render(<TwinTeamPill name="Müller" color="#c00" raus={false} floor={0} trailCount={0} trailShown={false} trupps={TRUPPS} />)
    expect(eg.container.querySelector('.team-floor')?.textContent).toBe('0')
    cleanup()
    const ug = render(<TwinTeamPill name="Müller" color="#c00" raus={false} floor={-1} trailCount={0} trailShown={false} trupps={TRUPPS} />)
    expect(ug.container.querySelector('.team-floor')?.textContent).toBe('−1')
  })

  it('says nothing for a Trupp that is on no storey — a «0» would assert an EG nobody stated', () => {
    const { container } = render(<TwinTeamPill name="Müller" color="#c00" raus={false} trailCount={0} trailShown={false} trupps={TRUPPS} />)
    expect(container.querySelector('.team-floor')).toBeNull()
  })
})
