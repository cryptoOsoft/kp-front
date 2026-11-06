import { useEffect } from 'react'
import { useTutorial, type TutorialInput } from '../../lib/tutorials/useTutorial'
import { TutorialLayer } from './TutorialLayer'

// The tutorial runner as a component, so the runner, its steps and its UI are their own chunk
// (components/tutorial/lazy – the boot path carries none of it). IncidentWorkspace mounts it only
// while a session exists, in the full layout with its layer and while covered without one: a run
// started from «Karte & Objekte» still binds and opens its Lern-Übung. The workspace's FAB yields
// to the done card, so `onEndCard` says when that card stands (and false again when it goes).

export function TutorialRunner({ layer, onEndCard, ...input }: TutorialInput & {
  /** the pill, the Sprechblase, the step list, the done card – off while the Einsatz is covered */
  layer: boolean
  onEndCard?: (shown: boolean) => void
}) {
  const run = useTutorial(input)
  const end = run?.phase === 'end'
  useEffect(() => {
    if (!end || !onEndCard) return
    onEndCard(true)
    return () => onEndCard(false)
  }, [end, onEndCard])
  return run && layer ? <TutorialLayer run={run} /> : null
}
