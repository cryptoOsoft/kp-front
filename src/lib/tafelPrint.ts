// The Tafel's own print (10.10.2026, owner: «maybe add a print option»): one page — or all of
// them — as a PDF, from the page's «Drucken». The SAME sheets the Rapport carries («Tafel –
// Seiten»: lib/boardForm · formForPdf → backend app/report_board), composed by the server without
// the Rapport around them (POST /api/incidents/{id}/tafel/pdf · app/report · compose_tafel_pdf).
//
// Loaded on the tap (usePlanTafelPages · printPages), never with the Tafel: the Kroki payload builder
// it needs for the Lagekarte box is the Rapport's, and has no business in the board's chunk.
//
// ⚠️ The server draws the paper, so printing needs it: offline this says so, calmly
// (`TafelPrintOffline`), instead of failing — the page itself is saved and syncs as always.

import { appConfig } from '../config/appConfig'
import type { MiniKarteProps } from '../components/MiniKarte'
import { formForPdf, pageStamp, type FormAnno } from './boardForm'
import { pendenzenForPdf } from './pendenzenPage'
import { isOnline } from './connectivity'
import { ApiError } from './api'
import { downloadPdf } from './download'
import { buildKrokiPayload } from './krokiPayload'
import { formatDateTime } from './report'
import type { LiveSection } from './boardTemplate'
import type { TimelineEvent } from '../types'

/** No server to draw the paper: the device is offline (or the request never got an answer). */
export class TafelPrintOffline extends Error {}

/** The request body (backend · TafelPrintPayload). */
export function tafelPrintPayload(
  pages: readonly FormAnno[],
  incident: { id: string; title: string },
  scene?: MiniKarteProps,
  now: Date = new Date(),
  /** what each page is called (lib/boardForm · pageTitles — «Konzept 2») */
  titles?: ReadonlyMap<string, string>,
  /** the Verlauf — what the «Aufträge / Pendenzen» page lists (lib/pendenzenPage) */
  timeline: readonly TimelineEvent[] = [],
): Record<string, unknown> {
  const T = appConfig.copy.tafel
  const live = (s: LiveSection, base: Record<string, unknown>) => pendenzenForPdf(s, base, timeline, now.getTime())
  const boardPages = pages.map((a) => formForPdf(a.form, { up: T.trendUp, same: T.trendSame, down: T.trendDown }, undefined, T.head, titles?.get(a.id), pageStamp(a.form, T), live))
  // the Lagekarte box: the scene as the Rapport prints it — auto-framed, no captions
  const wantsMap = pages.some((a) => a.form.page.sections.some((x) => x.type === 'map' && !x.hidden))
  const map = wantsMap && scene
    ? buildKrokiPayload({
        entities: scene.entities, drawings: scene.drawings.map((d) => ({ ...d, label: undefined })), layers: scene.layers,
        byName: scene.byName, center: scene.center, currentView: null, captionMode: 'off', trupps: scene.trupps ?? [],
      })
    : null
  return {
    incident: { id: incident.id, title: incident.title },
    generatedAt: formatDateTime(now.toISOString()),
    boardPages,
    ...(map ? { boardMap: map } : {}),
  }
}

const filenameOf = (title: string) =>
  `Tafel_${Array.from(title).filter((c) => /[\p{L}\p{N} \-_]/u.test(c)).join('').trim().replace(/\s+/g, '_').slice(0, 60) || 'Einsatz'}.pdf`

/** Print `pages` as one PDF and hand it to the browser. Throws `TafelPrintOffline` when there
 *  is no server to ask, any other error when the server said no. */
export async function printTafelPages(
  pages: readonly FormAnno[],
  incident: { id: string; title: string },
  scene?: MiniKarteProps,
  titles?: ReadonlyMap<string, string>,
  timeline?: readonly TimelineEvent[],
): Promise<void> {
  if (!isOnline()) throw new TafelPrintOffline()
  const form = new FormData()
  form.append('payload', JSON.stringify(tafelPrintPayload(pages, incident, scene, new Date(), titles, timeline)))
  try {
    await downloadPdf(`/api/incidents/${encodeURIComponent(incident.id)}/tafel/pdf`, form, filenameOf(incident.title))
  } catch (e) {
    // no answer at all — a dead connection the browser had not noticed yet
    if (e instanceof ApiError && e.status === 0) throw new TafelPrintOffline()
    throw e
  }
}
