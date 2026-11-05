// One row of the Rapport's right-hand column («wer und was war da»: Anwesenheit, Mittel,
// Partner, Unterschriften, Beilagen …) — a label with its done/open ring after it, a one-line
// summary, and the row's own content under it. Used by ReportPreflight and ReportSignatures.

import type { ReactNode } from 'react'
import { Icon } from '../lib/icons'
import type { PhoneTab } from './useReportPlace'

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
        <span className="rp-check-label">{label}</span>
        {/* the ring FOLLOWS the label, so every card's eyebrow text starts at one inset (13-incident · .rp-check-dot) */}
        <span className={`rp-check-dot${done ? ' done' : ''}`}>
          <Icon id={done ? 'check' : 'minus'} />
        </span>
        <span className="rp-check-sub">{sub}</span>
        {onGo && <Icon id="chevron" className="rp-check-go" />}
      </button>
      {children}
    </div>
  )
}
