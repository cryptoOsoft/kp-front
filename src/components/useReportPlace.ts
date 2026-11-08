// Where the operator is on the Rapport: the phone's three tabs, the jump to a still-open
// Mindestangabe, and the place (scroll, tab, print choices, Kroki-Stand) kept across the hop to
// Anwesenheit / Mittel / Verlauf. Used by ReportPreflight only; rules in docs/rapport.md.

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { incidentSlot } from '../lib/draftKeep'
import type { AbschlussStep } from '../lib/abschluss'
import type { ReportOptions } from '../lib/report'

/**
 * PHONE ONLY (≤600px, the width at which the rail becomes a bottom bar and every other surface
 * switches too). Stacked, this page is four form sections, a five-part round-up and the Kroki —
 * about five phone screens, and the Anwesenheits-Liste read out at the Appell sits at the far
 * end of them. Three tabs put each of those within one screen.
 *
 * ⚠️ It decides what is SHOWN, never the order: the DOM stays in the printed rapport's order
 * (app/report / admin/capturePdf.ts), and from 601px up the bar is `display: none` and every
 * section is on screen exactly as it is today — the two-column layout at 1080 is untouched.
 *
 * ⚠️ THREE, and only three. Anwesenheit and Material were tried as two more tabs here
 * (18.09.2026) and thrown out the same day: this surface already carries a head, a tab strip and
 * a page, and mounting a whole other surface — with ITS head and ITS own switcher — under the
 * strip stacked three navigations on top of each other. They are separate pages again, reached
 * from the bar's «Rapport» tile and its chooser (NavRail · GroupChooser) and from the rail.
 */
export type PhoneTab = 'bericht' | 'werwas' | 'beilagen'
export const PHONE_TABS: PhoneTab[] = ['bericht', 'werwas', 'beilagen']
/** Which tab a still-open Mindestangabe lives in — the head's «noch offen» chips switch to it
 *  before they scroll, and the tab itself carries the open mark (StatusMark) while one of its steps is open. */
export const STEP_TAB: Record<AbschlussStep, PhoneTab> = {
  zeiten: 'bericht',
  einsatzleiter: 'bericht',
  kontaktperson: 'bericht',
  kurzbericht: 'bericht',
  rueckmeldung: 'bericht',
  anwesenheit: 'werwas',
  mittel: 'werwas',
  // an Anwesenheits-Abweichung is about who was there — it rides with the Anwesenheit it is about
  abweichungen: 'werwas',
}

// The preflight UNMOUNTS while the operator hops to Anwesenheit / Mittel / Verlauf («Zurück
// zum Einsatzrapport» remounts it) — remember the body's scroll position per incident so the
// return lands where they left off, not back at the top. A deliberate close (X / overlay /
// Abbrechen / Abschliessen) resets it, so a later fresh open starts at the top again.
// ⚠️ The phone TAB rides in the same box and for the same reason: the Appell is «Rapport →
// Personal & Mittel → hop to Anwesenheit to correct → back», and a return that landed on «Bericht»
// would cost a tap on every single round trip. A genuinely fresh open — another Einsatz, or
// after Abschliessen — still starts on «Bericht».
// ⚠️ …and so does WHAT WILL PRINT: the print-section toggles (incl. the Kroki's Quer/Hoch and
// its framing) plus the chosen Kroki-Stand. Switching «Einsatzjournal» off, hopping to
// Anwesenheit to fix a name and coming back put every section silently back on — on the one
// surface that decides what leaves the building, and with the choice buried in the ▾ menu where
// nobody would notice it had been undone.
// Only the operator's OWN changes are kept (`optionOverrides`, a patch — see patchOpt), never
// the whole options object: the seeds `kroki` / `atemschutz` follow the LIVE
// data, and a remembered `kroki: false` from a Rapport opened before anything was drawn would
// have dropped the Lageskizze from the sheet for the rest of the Einsatz.
// Module memory, one slot, stamped with the Einsatz (lib/draftKeep · incidentSlot): another
// incident always starts fresh.
export type RapportKept = { top: number; tab: PhoneTab; optionOverrides: Partial<ReportOptions>; krokiAt: number | null }
export const rapportKept = incidentSlot<RapportKept>('rapport-place')

/**
 * «Zeig mir diese offene Angabe» — asked from OUTSIDE the sheet.
 *
 * The Abschluss confirm lists the same Mindestangaben the head's «noch offen» chips do, and
 * since 18.09.2026 its rows are tappable too (lib/abschlussOpen). But it also opens from the
 * Einsatz-Menü, where this surface is not mounted at all — so the ask has to survive the
 * `setMode('rapport')` that follows it. One live listener while the sheet stands, one queued
 * step while it does not; whichever answers, `jumpToStep` does the rest.
 */
let stepListener: ((step: AbschlussStep) => void) | null = null
const queuedStep: { current: AbschlussStep | null } = { current: null }
export function requestReportStep(step: AbschlussStep) {
  if (stepListener) stepListener(step)
  else queuedStep.current = step
}

/**
 * The phone tab, the jump to a step, and the kept place of one mounted Rapport.
 *
 * @param kept     what `rapportKept` held for this Einsatz when the sheet mounted (read once)
 * @param snapshot the rest of the place to keep — read on unmount, the latest render's
 */
export function useReportPlace(
  incidentId: string,
  bodyRef: RefObject<HTMLDivElement | null>,
  kept: RapportKept | null,
  snapshot: () => Pick<RapportKept, 'optionOverrides' | 'krokiAt'>,
) {
  // The tabs themselves are pure CSS; `isPhone` also controls the Kroki panel's mounting.
  // Seeded from the box that also carries the scroll position, so a hop to Anwesenheit and back
  // returns to the tab it left from; a fresh Einsatz opens on «Bericht», which is the first
  // section of the printed rapport.
  const [phoneTab, setPhoneTab] = useState<PhoneTab>(() => kept?.tab ?? 'bericht')
  /** Picked by hand — each tab starts at ITS top, never at the scroll offset of the one before
   *  (which is a different page of different length). The «noch offen» chips do NOT go through
   *  here: they scroll to their own field instead. */
  const pickTab = (t: PhoneTab) => {
    setPhoneTab(t)
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }

  /**
   * Jump to the section a «noch offen» chip names, and flash it.
   *
   * The chips list what is still missing and were pure text: you read «Zeiten», then hunted for
   * the Zeiten yourself down a page that is four sections long. Naming a problem and not
   * pointing at it is the same failure the überfällig badge had on the Atemschutz board.
   *
   * Anchored on `data-step` rather than on refs: the six steps live in four different shapes
   * (a CheckRow, a labelled field, a grid, a person picker), and one attribute is the only thing
   * they can all carry without being restructured around it.
   */
  const jumpToStep = (step: AbschlussStep) => {
    // On a phone the field may be in a tab that is not on screen, and a hidden element measures
    // as nothing — so switch first and measure a frame later. Above 600px no tab is ever hidden
    // and this is the same jump it always was, one frame later.
    setPhoneTab(STEP_TAB[step])
    requestAnimationFrame(() => requestAnimationFrame(() => flashStep(step)))
  }
  const flashStep = (step: AbschlussStep) => {
    const body = bodyRef.current
    const el = body?.querySelector<HTMLElement>(`[data-step="${step}"]`)
    if (!body || !el) return
    // ⚠️ Scroll the SHEET, not `scrollIntoView`. Three of the six targets are whole `<section>`s
    // taller than the viewport, and `block: 'center'` centres their MIDDLE — which puts the
    // heading the chip just named off the top of the screen, so the jump lands somewhere
    // plausible and unrecognisable. Putting the target's top just under the sheet's top edge is
    // the same thing a reader would do with their thumb.
    const top = el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 12
    // jsdom has no element scrollTo – and the jump is driven from a timer, so a throw there is an
    // unhandled error that fails the whole run rather than one test
    if (typeof body.scrollTo === 'function') body.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
    else body.scrollTop = Math.max(0, top)
    // …and the same two-beat ink ring the Atemschutz board uses when a locked Anwesenheits-Zeile
    // sends you to a card (Atemschutz.module.css · truppFlash). One surface, one way of saying
    // «this one» — a soft 1.2 s background wash read as a rendering artefact rather than a point.
    el.classList.remove('rp-flash')
    void el.offsetWidth // restart the animation when the same chip is tapped twice
    el.classList.add('rp-flash')
    window.setTimeout(() => el.classList.remove('rp-flash'), 2000)
    // the field the step is ABOUT, focused where there is one — a chip that scrolls to a text
    // box the operator then has to tap is one tap short of finishing the job
    el.querySelector<HTMLElement>('textarea, input, button')?.focus({ preventScroll: true })
  }

  // …and the outside ask (see requestReportStep). Through a ref because `jumpToStep` is rebuilt
  // every render while this subscription is mount-only — the sheet must not re-register on each
  // keystroke, and a jump queued before the mount is consumed exactly once.
  const jumpRef = useRef(jumpToStep)
  jumpRef.current = jumpToStep
  useEffect(() => {
    stepListener = (s) => jumpRef.current(s)
    const queued = queuedStep.current
    queuedStep.current = null
    if (queued) jumpRef.current(queued)
    return () => { stepListener = null }
  }, [])

  // Scroll keep-alive across the Anwesenheit/Mittel/Verlauf round trip (see rapportKept):
  // restore before paint on mount, capture on unmount. There is no «close» any more: leaving is
  // choosing another surface in the rail, which unmounts this one and captures the scroll — and
  // «Einsatz abschliessen» forgets the kept place itself, because coming back to a completed
  // rapport should start at the top.
  // The tab and the snapshot are read through refs in the cleanup because the effect below is
  // mount-only and would otherwise capture the values this surface OPENED on.
  const phoneTabRef = useRef(phoneTab)
  const snapshotRef = useRef(snapshot)
  useEffect(() => { phoneTabRef.current = phoneTab; snapshotRef.current = snapshot })
  // ⚠️ `forgetPlace` also stops the cleanup's write: the surface unmounts AFTER the Abschluss
  // (the workspace moves on), and writing the place back then made a reopened, completed rapport
  // land on the old tab with the old print choices.
  const forgotten = useRef(false)
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (el && kept) el.scrollTop = kept.top
    return () => {
      if (el && !forgotten.current) rapportKept.write(incidentId, { top: el.scrollTop, tab: phoneTabRef.current, ...snapshotRef.current() })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  /** Drop the kept place for good – this mount will not write it back on unmount. */
  const forgetPlace = () => {
    forgotten.current = true
    rapportKept.forget()
  }

  return { phoneTab, pickTab, jumpToStep, forgetPlace }
}
