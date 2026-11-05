// One row of the Rapport's right-hand column («wer und was war da»: Anwesenheit, Mittel,
// Partner, Unterschriften, Beilagen …) — a label with its done/open mark after it, a one-line
// summary, and the row's own content under it. Used by ReportPreflight and ReportSignatures.

import type { ReactNode } from 'react'
import { Icon } from '../lib/icons'
import type { PhoneTab } from './useReportPlace'

/** THE Rapport's status mark, set right after a label: open = broken amber ring, done = grey disc
 *  (13-incident · .rp-check-dot). Every eyebrow with an open/done state wears it – the CheckRows,
 *  the form's section heads – and the phone tab that still holds an open Mindestangabe. Render it
 *  INSIDE the label's text element: it is an inline box that centres itself on that text's font. */
export function StatusMark({ done }: { done: boolean }) {
  return <span className={`rp-check-dot${done ? ' done' : ''}`} aria-hidden="true" />
}

export function CheckRow({ done, label, sub, onGo, anchor, tab, children }: {
  done: boolean
  label: string
  sub: string
  onGo?: () => void
  /** the Abschluss step this row answers — the «noch offen» chips scroll to it (see jumpToStep) */
  anchor?: string
  /** which phone tab this row belongs to — inert above 600px (see PhoneTab) */
  tab?: PhoneTab
  children?: ReactNode
}) {
  return (
    <div className="rp-check" data-step={anchor} data-tab={tab}>
      <button type="button" className="rp-check-main" onClick={onGo} disabled={!onGo}>
        {/* the mark FOLLOWS the label, so every card's eyebrow text starts at one inset; hollow = open,
            filled = done. INSIDE the label, inline, so it centres on the label's own capitals
            (13-incident · .rp-check-dot) */}
        <span className="rp-check-label">{label}<StatusMark done={done} /></span>
        <span className="rp-check-sub">{sub}</span>
        {onGo && <Icon id="chevron" className="rp-check-go" />}
      </button>
      {children}
    </div>
  )
}
