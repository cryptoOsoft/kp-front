import { useEffect, useMemo, useState } from 'react'
import { appConfig } from '../../config/appConfig'
import { buildLabel } from '../../lib/buildInfo'
import { deploymentName } from '../../lib/deploymentConfig'
import { Icon } from '../../lib/icons'
import { toast } from '../../lib/ui'
import {
  buildReport, buildSubject, buildTechBlock, githubIssueUrl, mailtoUrl, readEnv, type ReportInput,
} from '../../lib/feedbackReport'
import {
  fetchDiagnostics, saveDiagnostics, type DiagnosticsBundle,
} from '../../lib/feedbackDiagnostics'
import { markTroubleAsked, type TroubleEvent } from '../../lib/trouble'
import { MAX_MESSAGE, readDraft, writeDraft } from '../../lib/feedbackDraft'
import { Modal } from './_shared'
import { localeDateTime } from '../../lib/format'

/** Which way the report leaves. GitHub first because it is the one that can demand structure
 *  — the issue form has required fields and a status the reporter can follow — and mail
 *  second because it is the one that always works. */
type Route = 'github' | 'mail'

/** Rückmeldung composer. Opened either from Einstellungen (no `trouble`) or from the launcher
 *  prompt after something went wrong (`trouble` set, so the question can be specific).
 *
 *  The app does not transmit this: there is no «Senden» button and no ingest to send to.
 *  What the sheet does is prepare a report properly and hand it to the operator: pick a
 *  route, and the sheet fills in the form or the mail and saves the Diagnose-Datei to attach.
 *
 *  That file is the point of the whole screen. Prose plus a build number says «es ist
 *  abgestürzt»; the Diagnose-Datei carries the station's own sanitised crash traces, which is
 *  the half that makes a bug findable. It is fetched when the sheet opens so the count can be
 *  shown honestly before anyone commits to anything — «3 Fehlerprotokolle» is a fact the
 *  operator can check, and an empty buffer says so rather than promising a file with nothing
 *  in it.
 *
 *  A photo, if one helps, is attached the same way the file is: in the mail or in the issue. */
export function FeedbackSheet({ trouble, onClose }: {
  trouble?: TroubleEvent
  onClose: (reason: 'cancel' | 'complete') => void
}) {
  const cp = appConfig.copy.feedback
  // Restored, not empty: the sheet is dismissable by Esc and by a backdrop tap, and what was
  // typed must survive both — see lib/feedbackDraft.
  const [message, setMessage] = useState(readDraft)
  const [route, setRoute] = useState<Route>('github')
  const [bundle, setBundle] = useState<DiagnosticsBundle | null>(null)

  // Fetched on open, not on Weiter: the count belongs in front of the decision, and a sheet
  // that only discovers at the last moment that it has nothing to attach has already told the
  // operator otherwise. A failure here is silent and simply leaves `bundle` null — the routes
  // still work, and a report without traces beats no report.
  useEffect(() => {
    let live = true
    fetchDiagnostics().then((b) => { if (live) setBundle(b) }).catch(() => { /* no file, no note */ })
    return () => { live = false }
  }, [])

  // Snapshot once on open: the report should describe the moment the operator started writing,
  // not shift under them if the network flaps mid-sentence.
  const env = useMemo(() => readEnv(buildLabel(), appConfig.locale), [])
  // the station's wordmark, as everywhere else – not the code default «Incident Map» (sweep C.4)
  const appName = deploymentName()
  const repo = appConfig.feedback.github

  const input: ReportInput = {
    env,
    message,
    ...(trouble ? { trouble: { kind: trouble.kind, at: trouble.at } } : {}),
    fmtTime: (at) => localeDateTime(at, {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    }),
  }

  const errorCount = bundle?.errors.length ?? 0
  const countLabel = errorCount === 1
    ? cp.diagCountOne
    : cp.diagCount.replace('{n}', String(errorCount))
  const techBlock = bundle
    ? `${buildTechBlock(input)}\n${cp.diagLine}${countLabel}`
    : buildTechBlock(input)

  // Asking counts as asked, whether or not they send anything — otherwise the same crash comes
  // back on the next launch and the prompt becomes the nag we set out not to build. The DRAFT
  // deliberately does not follow that rule: the cooldown is about how often we ask, the draft
  // is about not destroying someone's words, and only one of those should survive a stray tap.
  const finish = (reason: 'cancel' | 'complete') => { markTroubleAsked(); onClose(reason) }

  const onMessage = (text: string) => { setMessage(text); writeDraft(text) }

  /** Save the file, then open the route. In that order, and both in the same user gesture:
   *  a download started after a `location.href` to a mailto: has, on iPadOS, a good chance of
   *  never happening at all. */
  const go = () => {
    if (bundle && errorCount > 0) {
      try {
        toast(cp.diagSaved.replace('{name}', saveDiagnostics(bundle)), { icon: 'check' })
      } catch {
        // The report is still worth sending without it — say so and carry on rather than
        // stopping the operator at the last step over the attachment.
        toast(cp.diagFailed, { icon: 'warn', tone: 'warn' })
      }
    }
    if (route === 'github' && repo) {
      window.open(githubIssueUrl(repo, input), '_blank', 'noopener')
    } else {
      location.href = mailtoUrl(appConfig.feedback.mailto, buildSubject(input, appName), buildReport(input))
    }
    // The draft SURVIVES, deliberately. Opening a mail client or an issue form is a handoff,
    // not a delivery: the mail client may not be configured, and GitHub silently discards a
    // prefill whose template is missing from the default branch — in both cases the operator
    // lands on an empty form. Clearing here used to be safe because the server answered 202
    // first; nothing answers anything now, so the only honest options are to keep the words
    // or to lose them. It stays until they next write over it.
    finish('complete')
  }

  // An empty report with no trouble behind it is a blank row in someone's issue tracker. With
  // a trouble it still says «ja, das ist mir passiert», which is worth having.
  const canSend = message.trim().length > 0 || !!trouble

  const routeOption = (id: Route, icon: string, title: string, badge: string, note: string) => (
    <button
      type="button"
      className={`fb-route${route === id ? ' pick' : ''}`}
      aria-pressed={route === id}
      onClick={() => setRoute(id)}
    >
      <span className="fb-route-ico"><Icon id={icon} /></span>
      <span className="fb-route-body">
        <span className="fb-route-t">
          {title}
          <span className={`ip-badge ${id === 'github' ? 'ip-badge-ok' : 'ip-badge-arch'}`}>{badge}</span>
        </span>
        <span className="fb-route-s">{note}</span>
      </span>
    </button>
  )

  return (
    // the buttons are THE sheet foot (Modal · footer, r35 06.11.2026) – they stood inside the body,
    // right-aligned at their words' width on the phone too, the one sheet that did
    <Modal title={cp.title} onClose={() => finish('cancel')} fit footer={(
      <>
        <button type="button" className="ip-btn" onClick={() => finish('cancel')}>{cp.cancel}</button>
        <button type="button" className="ip-btn primary" onClick={go} disabled={!canSend}>
          {cp.next}
        </button>
      </>
    )}>
      <div className="fb-sheet">
        {trouble && <p className="fb-q">{cp.promptFor[trouble.kind]}</p>}
        <p className="fb-intro">{cp.intro}</p>

        {/* No autoFocus: on a tablet it raises the on-screen keyboard over the very block we
            are asking the operator to read before deciding. They tap the field when they are
            ready to write. */}
        <textarea
          className="fb-input"
          rows={5}
          value={message}
          maxLength={MAX_MESSAGE}
          placeholder={cp.placeholder}
          onChange={(e) => onMessage(e.target.value)}
          aria-label={cp.title}
        />
        {/* Only near the ceiling, and digits only — no copy key needed, correct in every
            locale. Without it the cap is invisible until the text is already truncated. */}
        {message.length > MAX_MESSAGE * 0.9 && (
          <p className="fb-count">{message.length}/{MAX_MESSAGE}</p>
        )}

        {/* Collapsed, unlike before: the technical block used to sit open because it was the
            only thing standing between the operator and an automatic transmission. Nothing
            transmits now — they are about to read the whole report in their own mail client
            or in a GitHub form — so the block is one tap away and the routes get the space. */}
        <details className="fb-tech">
          <summary>{cp.techTitle}<Icon id="chevron-down" className="chev" /></summary>
          <pre className="fb-tech-block">{techBlock}</pre>
          <p className="fb-tech-note">{cp.techNote}</p>
        </details>

        <div className="fb-routes">
          {repo && routeOption('github', 'external', cp.routeGithub, cp.routeGithubBadge, cp.routeGithubNote)}
          {routeOption('mail', 'mail', cp.routeMail, cp.routeMailBadge, cp.routeMailNote)}
        </div>

        <p className="fb-diag-note">
          {errorCount > 0 ? cp.diagNote.replace('{n}', countLabel) : cp.diagNoteEmpty}
        </p>

        <p className="fb-privacy"><Icon id="info" /> {cp.privacy}</p>
      </div>
    </Modal>
  )
}
