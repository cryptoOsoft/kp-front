// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setTutorialSession } from '../../lib/tutorials/session'
import { stepsOf } from '../../lib/tutorials/steps'
import { TutorialRunner } from './TutorialRunner'

// The workspace's FAB yields to the done card through `onEndCard` – the one thing the runner says
// back across its lazy boundary.

afterEach(() => { cleanup(); setTutorialSession(null); sessionStorage.clear() })

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
