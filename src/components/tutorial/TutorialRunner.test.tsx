// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getTutorialSession, setTutorialHost, setTutorialSession, startTutorial } from '../../lib/tutorials/session'
import { stepsOf } from '../../lib/tutorials/steps'
import { TutorialLauncher, TutorialRunner } from './TutorialRunner'

const openLernUebung = vi.hoisted(() => vi.fn())
vi.mock('../../lib/tutorials/sandbox', () => ({ openLernUebung, renameLernUebung: vi.fn(), deleteLernUebung: vi.fn() }))

// The workspace's FAB yields to the done card through `onEndCard` – the one thing the runner says
// back across its lazy boundary.

afterEach(() => { cleanup(); setTutorialSession(null); setTutorialHost(null); sessionStorage.clear(); openLernUebung.mockReset() })

describe('TutorialRunner', () => {
  it('says when the done card stands, and when it goes', () => {
    const onEndCard = vi.fn()
    setTutorialSession({ id: 'lageZeichnen', step: stepsOf('lageZeichnen').length, host: 'inc-1', startedAt: 1, endedAt: 2 })
    render(
      <TutorialRunner layer={false} onEndCard={onEndCard} enabled
        incident={{ id: 'inc-1', title: 'Lernen · Karte', isExercise: true }}
        entities={[]} drawings={[]} trupps={[]} journalRows={0} present={0}
        mode="map" tool="select" palette={false} phone={false} setMode={vi.fn()} />,
    )
    expect(onEndCard).toHaveBeenLastCalledWith(true)
    act(() => { setTutorialSession(null) })
    expect(onEndCard).toHaveBeenLastCalledWith(false)
  })
})

// A run started with no Einsatz mounted (08.11.2026, owner: «I don't see any tooltips» – started on
// home, the session was set and nothing else happened).
describe('TutorialLauncher', () => {
  const host = () => { const h = { open: vi.fn(), reveal: vi.fn(), leave: vi.fn() }; setTutorialHost(h); return h }

  it('opens the Lern-Übung the door hands out, in front, bound to the run', async () => {
    const h = host()
    openLernUebung.mockResolvedValue({ incidentId: 'lern-1', reused: false })
    startTutorial('lageZeichnen')
    render(<TutorialLauncher />)
    await waitFor(() => expect(h.open).toHaveBeenCalledWith('lern-1'))
    expect(openLernUebung).toHaveBeenCalledWith('lageZeichnen')
    expect(getTutorialSession()).toMatchObject({ id: 'lageZeichnen', step: 0, incidentId: 'lern-1' })
  })

  it('says a tutorial without steps is not ready instead of doing nothing, and asks the door nothing', () => {
    const h = host()
    startTutorial('trupps')
    render(<TutorialLauncher />)
    expect(getTutorialSession()).toBeNull()
    expect(openLernUebung).not.toHaveBeenCalled()
    expect(h.open).not.toHaveBeenCalled()
  })

  it('ends the run when the door refuses – there is no Übung to practise on', async () => {
    const h = host()
    openLernUebung.mockRejectedValue(new Error('403'))
    startTutorial('lageZeichnen')
    render(<TutorialLauncher />)
    await waitFor(() => expect(getTutorialSession()).toBeNull())
    expect(h.open).not.toHaveBeenCalled()
  })
})
