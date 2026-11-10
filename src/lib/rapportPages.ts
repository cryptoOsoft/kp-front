// The Rapport GROUP — Rapport · Anwesenheit · Material — and the device-side memory of which of
// the three this Einsatz was last left on. Pure and storage-injectable so the rules are
// node-testable: NavRail owns the pixels (the tile and its chooser), this file owns the policy.
//
// Why a group at all: on a phone the bottom bar holds five tiles (18.09.2026), and these three
// were the group that had to give two of them up. They stayed three ORDINARY, separate full
// pages — folding Anwesenheit and Material into the Rapport as extra tabs was tried the same day
// and thrown out: a whole surface mounted under the Rapport's own tab strip put three
// navigations on one screen, one above the other. So the bar keeps ONE tile for the three, it
// opens the page you were last on, and a second tap or a hold on it opens the list of three —
// exactly the way the «Pläne» tile opens its documents (components/GroupChooser).

/** One of the three pages the phone's «Rapport» tile stands for. These are `mode` values — the
 *  same ones the vertical rail sets with three tiles of its own. */
export type RapportPage = 'rapport' | 'anwesenheit' | 'mittel'

/**
 * The chooser's order: the Rapport first, then the two pages it is filled in from.
 *
 * ⚠️ The Rapport leads because it is the page the tile is NAMED after and the one the group is
 * about — the other two are where its numbers come from. It is also the stable anchor: whichever
 * of the three you are standing on, «Rapport» is in the same place.
 */
export const RAPPORT_PAGES: RapportPage[] = ['rapport', 'anwesenheit', 'mittel']

/** Is this `mode` one of the three? Used both to light the bar's tile and to decide whether the
 *  chooser's rows can mark the page that is standing. */
export function isRapportPage(mode: string): mode is RapportPage {
  return (RAPPORT_PAGES as string[]).includes(mode)
}

/** Per-incident and per-DEVICE. ⚠️ localStorage since 20.09.2026 – it was session-scoped, on
 *  the reasoning that a reload should come back to the page you were on while last week's choice
 *  should not decide where a fresh Einsatz opens. But an installed PWA that iOS killed, or was
 *  simply refreshed, starts a NEW session: the memory was gone exactly when it was wanted, and
 *  with nobody checked in yet the first-open rule sent «Einsatz» to Anwesenheit every time
 *  (field report). The box is keyed by incident id, so it still cannot leak into another
 *  Einsatz – which was the only thing the session scope was protecting (cf. lib/chooserOffer). */
const KEY = 'kp-front-rapport-page'

/** Storage-shaped for tests; `localStorage` in the app. */
type Store = Pick<Storage, 'getItem' | 'setItem'>

const store = (s?: Store): Store | undefined =>
  s ?? (typeof localStorage === 'undefined' ? undefined : localStorage)

/** the page this device last left the group on for THIS Einsatz, or null. Another incident always
 *  reads as null: the stamp is part of the record, so yesterday's page cannot open tonight's
 *  alarm. */
export function readRapportPage(incidentId: string, s?: Store): RapportPage | null {
  try {
    const raw = store(s)?.getItem(KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as { incidentId?: string; page?: string }
    if (v.incidentId !== incidentId) return null
    return v.page && isRapportPage(v.page) ? v.page : null
  } catch { return null } // private mode, or a box written by an older build
}

export function writeRapportPage(incidentId: string, page: RapportPage, s?: Store): void {
  try { store(s)?.setItem(KEY, JSON.stringify({ incidentId, page })) } catch { /* private mode */ }
}

/**
 * Which of the three the bar's «Rapport» tile opens.
 *
 * 0. the Rapport, always, where `rapportFirst` says so (EL phone sweep B3, 10.11.2026): for the
 *    `el` role, whose main thing it is, and on a closed Einsatz, where the Anwesenheit is a
 *    read-only «0 anwesend» and the tile's badge counts the Rapport's open points;
 * 1. the one this device last left the group on, for this Einsatz — the Appell is «tile →
 *    correct a name → away → tile», several times over, and a tap that always landed on the
 *    Rapport would cost an extra one on every single round trip;
 * 2. else, with NOBODY marked present yet, «Anwesenheit» — at that moment the Rapport has
 *    nothing in it to read and the crew is arriving, so the arrival minutes are the only thing
 *    anybody opens this group for;
 * 3. else the Rapport itself, which is what the tile says.
 */
export function initialRapportPage(
  { incidentId, presentCount, rapportFirst = false, store: s }:
  { incidentId: string; presentCount: number; rapportFirst?: boolean; store?: Store },
): RapportPage {
  if (rapportFirst) return 'rapport'
  return readRapportPage(incidentId, s) ?? (presentCount === 0 ? 'anwesenheit' : 'rapport')
}
