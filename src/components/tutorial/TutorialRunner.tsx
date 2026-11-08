import { useEffect } from 'react'
import { appConfig } from '../../config/appConfig'
import { toast } from '../../lib/ui'
import { tutorialMeta } from '../../lib/tutorials/catalogue'
import { openLernUebung } from '../../lib/tutorials/sandbox'
import { getTutorialHost, getTutorialSession, setTutorialSession, useTutorialSession } from '../../lib/tutorials/session'
import { canRunInEinsatz, notYet, useTutorial, type TutorialInput } from '../../lib/tutorials/useTutorial'
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

/**
 * A run started where no Einsatz is mounted to carry it – home with nothing running, the sheet's
 * «Fortsetzen», a Hilfe «Ausprobieren» (08.11.2026, owner: «I don't see any tooltips»: the session
 * was set and nothing else happened). App mounts this while a session waits for its Übung and no
 * IncidentWorkspace stands; it asks the door for the Lern-Übung and has App open it in front, where
 * the workspace's runner binds the run. Renders nothing. A run no build can carry yet says so.
 */
export function TutorialLauncher() {
  const session = useTutorialSession()
  useEffect(() => {
    if (!session || session.host || session.incidentId) return
    if (!canRunInEinsatz(session.id) || tutorialMeta(session.id).sandbox !== 'uebung') { notYet(session.id); return }
    let stale = false
    openLernUebung(session.id).then(({ incidentId }) => {
      if (stale || getTutorialSession() !== session) return
      setTutorialSession({ ...session, incidentId })
      getTutorialHost()?.open(incidentId)
    }).catch(() => {
      if (stale || getTutorialSession() !== session) return
      toast(appConfig.copy.tutorialRun.sandboxRefused, { icon: 'warn', tone: 'warn' })
      setTutorialSession(null)
    })
    return () => { stale = true }
  }, [session])
  return null
}
