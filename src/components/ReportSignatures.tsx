// The Rapport's «Unterschriften» card and the sheet a line is signed in (15.10.2026,
// docs/rapport.md · Unterschriften). Rendered by ReportPreflight in its right-hand column, after
// the Partnerorganisationen — where the Visum sits on the paper. Optional: nothing asks for it,
// nothing waits for it. A signature that still holds locks the form; one that no longer holds
// says «ungültig» and a tap signs anew (owner: no explanation box). The lock itself is decided
// above the form (useReportSignatures · useSignatureLock).

import type { ComponentProps } from 'react'
import { appConfig } from '../config/appConfig'
import { fillTemplate, hhmm } from '../lib/format'
import { Icon } from '../lib/icons'
import { confirmDialog } from '../lib/ui'
import { SIGNATURE_ROLES, type SignatureRole } from '../lib/reportSignature'
import { Button } from './Button'
import { CheckRow } from './ReportCheckRow'
import { SignatureImage } from './SignaturePad'
import { SignatureSheet } from './SignatureSheet'
import type { LiveSignatures } from './useReportSignatures'

/** what the signing sheet needs beyond the card's own state */
type SheetProps = Omit<ComponentProps<typeof SignatureSheet>, 'open' | 'onClose' | 'initialRole' | 'signedRoles' | 'elName' | 'kdtName'>

export function ReportSignatures({ closed, maySign, canSign, signedLock, liveSigs, sigValid, elName, kdtName, onVoidSignatures, sheet, signFor, setSignFor }: {
  /** the Einsatz is closed — the only time a Rapport is signed */
  closed: boolean
  /** this session signs Rapporte at all (not a viewer, a link, an archived view) */
  maySign: boolean
  /** …and can sign NOW (the Einsatz is closed) */
  canSign: boolean
  signedLock: boolean
  liveSigs: LiveSignatures
  sigValid: (r: SignatureRole) => boolean
  /** the names an empty line offers: the Rapport's Einsatzleiter, the station's Kommandant */
  elName: string
  kdtName: string
  /** «Ändern» on a signed Rapport — absent where this session may not */
  onVoidSignatures?: () => void
  sheet: SheetProps
  /** «Rapport unterschreiben»: which line the sheet is open for (null = closed). The Rapport
   *  owns it, so its strip under the head opens the same sheet (ReportPreflight · showSignBand). */
  signFor: SignatureRole | null
  setSignFor: (r: SignatureRole | null) => void
}) {
  const S = appConfig.copy.signature
  const changeSigned = async () => {
    if (await confirmDialog({ title: S.changeTitle, message: S.changeMsg, confirmLabel: S.changeConfirm })) onVoidSignatures?.()
  }
  const stale = SIGNATURE_ROLES.filter((r) => liveSigs[r] && !sigValid(r))
  const valid = SIGNATURE_ROLES.filter(sigValid)
  const sub = !closed ? S.optional
    : stale.length ? S.invalid
    : valid.length ? fillTemplate(S.count, { n: valid.length }) : S.optional
  const nameOf = (r: SignatureRole) => (r === 'el' ? elName : kdtName)
  const roleLabel = (r: SignatureRole) => (r === 'el' ? S.roleEl : S.roleKdt)
  // A session that never signs reads signatures, it is not asked for them: no card at
  // all until one exists – «nach dem Abschluss hier unterschreiben» and two empty lines
  // were an instruction to a driver (RBAC audit 22.10.2026).
  if (!maySign && (!closed || !SIGNATURE_ROLES.some((r) => liveSigs[r]))) return null
  return (
    <>
      <CheckRow tab="werwas" done={closed && valid.length > 0 && !stale.length} label={S.cardTitle} sub={sub}>
        <div className="rp-check-extra rp-sign">
          {!closed ? <p className="rp-sign-hint">{S.runningHint}</p> : SIGNATURE_ROLES.map((r) => {
            const g = liveSigs[r]
            const who = (
              <span className="rp-sign-who">
                <span className="rp-sign-role">{roleLabel(r)}</span>
                <span className="rp-sign-name">{g?.name || nameOf(r) || '–'}</span>
              </span>
            )
            if (g && sigValid(r)) return (
              <div className="rp-sign-row" key={r}>
                {who}
                <SignatureImage strokes={g.strokes} className="rp-sign-img" />
                <span className="rp-sign-time">{hhmm(new Date(g.at))}</span>
              </div>
            )
            // a signature that no longer holds: a tap signs anew – for a session that
            // cannot sign, the same row as a read-out (no dead button, no chevron)
            if (g && !canSign) return (
              <div className="rp-sign-row rp-sign-void" key={r}>
                {who}
                <SignatureImage strokes={g.strokes} className="rp-sign-img" />
                <span className="rp-sign-bad"><Icon id="warn" />{S.invalid}</span>
              </div>
            )
            if (g) return (
              <button type="button" className="rp-sign-row rp-sign-void" key={r}
                aria-label={`${roleLabel(r)} – ${S.resign}`} onClick={() => setSignFor(r)}>
                {who}
                <SignatureImage strokes={g.strokes} className="rp-sign-img" />
                <span className="rp-sign-bad"><Icon id="warn" />{S.invalid}</span>
                <Icon id="chevron" className="rp-sign-go" />
              </button>
            )
            return (
              <div className="rp-sign-row" key={r}>
                {who}
                {canSign && <Button onClick={() => setSignFor(r)}>{S.sign}</Button>}
              </div>
            )
          })}
          {signedLock && (
            <div className="rp-sign-foot">
              <span className="rp-sign-locked"><Icon id="signature-lock" />{S.locked}</span>
              {onVoidSignatures && <Button onClick={() => void changeSigned()}>{S.change}</Button>}
            </div>
          )}
        </div>
      </CheckRow>
      {/* a portalled sheet (lib/overlays · Sheet): where it sits in the tree changes nothing on screen */}
      {signFor && (
        <SignatureSheet
          {...sheet}
          open onClose={() => setSignFor(null)}
          initialRole={signFor}
          signedRoles={Object.fromEntries(SIGNATURE_ROLES.filter(sigValid).map((r) => [r, hhmm(new Date(liveSigs[r]!.at))]))}
          elName={{ name: elName }}
          kdtName={{ name: kdtName }}
        />
      )}
    </>
  )
}
