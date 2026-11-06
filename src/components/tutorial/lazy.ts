import { lazy } from 'react'

/*
 * «Üben» as its own chunks (06.11.2026): the runner with its steps and its layer (TutorialRunner),
 * and the «Üben» sheet. Nobody's boot path – the App chunk carries only the session store, the
 * progress, the `tut()` anchors and the offer/Hilfe mapping (scripts/check-bundle-size.mjs).
 * IncidentWorkspace mounts the runner while a session exists, App the sheet while it is open.
 * Offline they come out of the precache like every other chunk.
 *
 * ⚠️ A chunk that fails to load (an old tab after a deploy, a flaky line) renders NOTHING instead
 * of throwing into the Einsatz's error boundary – a tutorial must never be what takes the
 * workspace, and its Atemschutz alarm host, down (the weather layer's rule, components/weatherLazy).
 */
type Runner = typeof import('./TutorialRunner')
type Sheet = typeof import('./UebenSheet')
const nothing = () => null

export const TutorialRunner = lazy(() => import('./TutorialRunner').catch(() => null)
  .then((m) => ({ default: m?.TutorialRunner ?? (nothing as unknown as Runner['TutorialRunner']) })))
export const UebenSheet = lazy(() => import('./UebenSheet').catch(() => null)
  .then((m) => ({ default: m?.UebenSheet ?? (nothing as unknown as Sheet['UebenSheet']) })))
