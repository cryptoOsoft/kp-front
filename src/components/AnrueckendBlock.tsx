import { Fragment, useCallback, useMemo, useState } from 'react'
import { Icon } from '../lib/icons'
import { appConfig } from '../config/appConfig'
import { fillTemplate } from '../lib/format'
import { buildAnrueckend } from '../lib/diveraResponses'
import { getDiveraResponses, type DiveraResponses } from '../lib/incidents'
import { useResumingPoll } from '../lib/useResumingPoll'
import type { AttendanceState, Person } from '../types'
import { RankBadge } from './RankBadge'
import { Button } from './Button'
import s from './Anwesenheit.module.css'

/** How often the open block re-reads what the SERVER already has. It never makes the server call
 *  Divera (the server's poll does that, 30 s for the first ten minutes after an alarm — backend ·
 *  divera.RESPONSE_WINDOW_SECONDS), so a faster read here could only re-fetch the same answers. */
export const ANRUECKEND_POLL_MS = 30_000

/** Per Einsatz, for this app session only — never persisted: who said they would come is not
 *  ours to keep on a device. */
const lastKnown = new Map<string, DiveraResponses>()

/**
 * «Anrückend» — who answered the Divera alarm, above the Anwesenheit's crew list (X1).
 *
 * YES / NO AND NAMES, NOTHING ELSE (owner, 09.10.2026: «just yes/no is enough. We don't need
 * details on when the response was written, what specifics they said»). The question it answers
 * is the first one of every Einsatz: «wer kommt noch». The answers come from Divera; the people
 * from the Mannschaftsliste.
 *
 * ⚠️ Rules this block keeps:
 * - A Divera answer is NEVER presence. Nobody becomes anwesend because they pressed «komme»; the
 *   «da» button on a row is the ordinary check-in (`onMarkPresent`), one tap, by a person here.
 *   Once somebody is recorded they leave this block and stand in the list below.
 * - «kommt nicht» is a COUNT in the head line, never a list (owner, 11.11.2026: «the people not
 *   here are useless» – eleven muted rows pushed the crew list off the phone). Somebody who
 *   misclicked and turns up anyway is checked in on the crew list below, like anybody.
 * - Nothing to show → nothing rendered: a station without Divera, or an Einsatz no Divera alarm
 *   belongs to, never sees an empty frame.
 *
 * It fetches while it is MOUNTED, and it is mounted only on the crew list of a running Einsatz on a
 * station with Divera, for the EL and the editors (AnwesenheitView · diveraResponsesFor) — a closed
 * Einsatz, a replay, a link session, a viewer and every other tab cost nothing. Offline it keeps
 * the last answers it had.
 */
export function AnrueckendBlock({ incidentId, people, attendance, canEdit, onMarkPresent, initial }: {
  incidentId: string
  people: Person[]
  attendance: AttendanceState
  canEdit: boolean
  onMarkPresent: (p: Person) => void
  /** test seam: a first answer without the network */
  initial?: DiveraResponses | null
}) {
  const R = appConfig.copy.anrueckend
  const [resp, setResp] = useState<DiveraResponses | null>(initial ?? lastKnown.get(incidentId) ?? null)
  const [open, setOpen] = useState(true)

  const refresh = useCallback(async () => {
    // a hidden tab reads nothing; the resume on return catches up (useResumingPoll)
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    // offline: keep what is on screen, ask again once the device is back
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    const next = await getDiveraResponses(incidentId)
    lastKnown.set(incidentId, next)
    setResp(next)
  }, [incidentId])
  useResumingPoll(initial === undefined, refresh, { pollMs: ANRUECKEND_POLL_MS, resumeGapMs: 10_000 })

  const data = useMemo(() => buildAnrueckend(resp, people, attendance), [resp, people, attendance])
  if (!data) return null

  // the head line: one count per answer, zeros left out — «9 kommen · 2 kommen nicht · 3 da»
  const parts = [
    data.counts.coming > 0 && R.coming(data.counts.coming),
    data.counts.notComing > 0 && R.notComing(data.counts.notComing),
    data.here > 0 && R.here(data.here),
  ].filter(Boolean) as string[]
  // each count stays whole; the separator stays OUTSIDE the unbreakable span (inside it, the line
  // had no break opportunity left and pushed the block past a phone's edge)
  const summary = parts.map((t, i) => (
    <Fragment key={t}>{i > 0 ? ' · ' : ''}<span className={s.anrPart}>{t}</span></Fragment>
  ))

  const row = (p: Person) => (
    <li key={p.id} className={s.anrRow}>
      <div className={s.anrWho}>
        <RankBadge rank={p.rank} />
        <span className={s.name}>{p.displayName}</span>
      </div>
      {canEdit && (
        <Button
          className={s.anrDa}
          icon={<Icon id="check" />}
          onClick={() => onMarkPresent(p)}
          aria-label={fillTemplate(R.checkInLabel, { name: p.displayName })}
          title={fillTemplate(R.checkInLabel, { name: p.displayName })}
        >
          {R.checkIn}
        </Button>
      )}
    </li>
  )

  return (
    <section className={s.anr} aria-label={R.title}>
      <button type="button" className={s.anrHead} aria-expanded={open} onClick={() => setOpen((v) => !v)}
        title={open ? R.collapse : R.expand}>
        <span className={s.anrTitle}>
          {R.title}
          {data.coming.length > 0 && <span className={s.anrCount}>{data.coming.length}</span>}
        </span>
        <span className={s.anrSummary}>{summary}</span>
        <span className={s.anrSource}>{R.sourceBare}</span>
        <Icon id="chevron-down" className="chev" />
      </button>
      {open && (
        <div className={s.anrBody}>
          {data.coming.length > 0
            ? <ul className={s.anrList}>{data.coming.map(row)}</ul>
            : <p className={s.anrFoot}>{R.allHere}</p>}
          {/* the one sentence the block owes: an answer is not a check-in */}
          <p className={s.anrFoot}>
            {data.unmapped > 0 && <>{R.unmapped(data.unmapped)} · </>}
            {R.hint}
          </p>
        </div>
      )}
    </section>
  )
}
