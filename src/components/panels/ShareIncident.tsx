import { ShellLoader } from '../ShellLoader'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { appConfig } from '../../config/appConfig'
import { Icon } from '../../lib/icons'
import { cx } from '../../lib/cx'
import { confirmDialog, toast } from '../../lib/ui'
import { createShareLink, fetchShareLink, revokeShareLink, shareDoors, viewLinkUrl, type ShareLink, type ShareLinkKind } from '../../lib/viewLink'
import { Segmented } from '../Segmented'
import { Modal } from './_shared'
import { PresentCard } from '../Presentation'

// «Teilen» — every way this app hands an Einsatz to somebody, in one file.
//
// ONE SHEET, TWO TABS (03.09.)
// ----------------------------
// «Teilen» opens THIS surface directly, and the tab decides which link you get. There is no
// chooser step in front of it any more: a menu whose rows lead to a sheet that then shows the
// same choice again is one question asked twice.
//
// It used to be three links, and the top two said the same sentence — «der ganze Einsatz, nur
// lesen» — differing only in how long they lasted. So they are one link now, and it is the one
// that always works: the `view` link carries a secret of its own on the incident row, so it
// needs no station key AND it survives the Abschluss. (The alerting gateway's JWT still exists
// on the wire and in every alarm text — nothing mints one by hand any more; see lib/viewLink.)
//
// The two doors (see lib/viewLink · shareDoors; one-line labels since 27.09.2026):
//   · «Einsatz · lesen»    — Karte, Pläne, Verlauf, Fotos, Zeiten. For the Zentrale, den EL or a
//                            Nachbarwehr mid-Einsatz, and for der Gemeinde or a Nachbarwehr
//                            afterwards: it outlives the Abschluss.
//   · «Trupps · bedienen»  — the Überwachungstafel of this one Einsatz on somebody else's phone,
//                            and they operate it. Dies at the Abschluss.
//
// Where this surface is reached from, and why each is contextual rather than a link of its own:
//   · «Teilen» im Einsatzkopf and on der Einsatz-Karte — the plain way in, opens on the
//     read-only tab;
//   · the Rapport's «Weitergeben» section renders `ShareIncident` INLINE — it is this surface,
//     not a second door to it, and handing the finished Einsatzakte out belongs exactly there;
//   · the QR beside the Atemschutz bell lands straight on «Nur Atemschutz», because standing on
//     the Tafel deciding to hand it over, that is the only thing it could have meant.
//
// Everything below the tabs — QR, address, Senden, Aufheben — is the same block for both; only
// the sentences differ, because what the link hands over is the ONE thing somebody has to have
// read before sending it on.
//
// The QR is what makes the handover work at all. The realistic handover in an Einsatz is
// «Tablet hinhalten», not «Adresse kopieren» — and the code is drawn from the address as soon
// as there is one. Lazily: `qrcode` otherwise ships only in the admin chunk, and there is no
// reason for every field device to carry it. Its absence is never fatal — no QR still leaves
// the address, which is the part that always works.

/** ONE address, presented the one way this app presents an address to hand over: the QR that
 *  makes «Tablet hinhalten» work, the whole URL as the copy target, and the device's own Teilen
 *  sheet where that exists. `children` takes whatever else belongs on that row — both links put
 *  «Link aufheben» there.
 *
 *  The QR is drawn lazily: `qrcode` otherwise ships only in the admin chunk, and there is no
 *  reason for every field device to carry it. Its absence is never fatal — no QR still leaves the
 *  address, which is the part that always works. */
function ShareLinkCode({ url, children }: { url: string; children?: React.ReactNode }) {
  const C = appConfig.copy.preflight
  // keyed by the address it encodes, so a revoked-then-reminted link can never flash the old
  // code — and so nothing has to be reset when the address goes away
  const [qr, setQr] = useState<{ url: string; src: string } | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!url) return
    let alive = true
    void import('qrcode')
      .then(({ toDataURL }) => toDataURL(url, { width: 512, margin: 1 }))
      .then((src) => { if (alive) setQr({ url, src }) })
      .catch(() => { /* no QR is not no link — the address below it still works */ })
    return () => { alive = false }
  }, [url])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard blocked (http / permissions) — the address stays selectable */ }
  }

  // The phone's own «Teilen» sheet, where the Threema/WhatsApp group actually is. Absent on
  // desktop browsers that have no share target, rather than offered and then doing nothing.
  const canSend = typeof navigator.share === 'function'

  return (
    <>
      {qr?.url === url && (
        <div className="esh-qr">
          {/* decorative: the address right below it is the accessible copy of the same thing */}
          <img src={qr.src} alt="" />
          <span className="esh-qr-cap">{C.shareScan}</span>
        </div>
      )}
      <div className="esh-row">
        {/* the whole address is the copy target — a 12px «Kopieren» beside a URL is a miss
            waiting to happen with a glove on (same call as the Formular rows) */}
        <button type="button" className={cx('esh-url', copied && 'copied')} onClick={() => void copy()}
          title={copied ? C.shareCopied : C.shareCopy} aria-label={C.shareCopy}>
          <code>{url}</code>
          <span className="esh-copy" aria-hidden><Icon id={copied ? 'check' : 'copy'} /></span>
        </button>
        {canSend && (
          <button type="button" className="ip-btn esh-send" onClick={() => { void navigator.share?.({ url }).catch(() => {}) }}>
            <Icon id="share-ios" />{C.shareSend}
          </button>
        )}
        {children}
      </div>
    </>
  )
}

/** The sentences that differ per kind — everything else about the surface is shared. */
function kindCopy(kind: ShareLinkKind) {
  const C = appConfig.copy.preflight
  return kind === 'atemschutz'
    ? { lede: C.shareAsLede, liveLede: C.shareAsLiveLede, warn: C.shareAsWarn, revokeTitle: C.shareAsRevokeTitle, revokeBody: C.shareAsRevokeBody }
    : { lede: C.shareLede, liveLede: C.shareLiveLede, warn: C.shareWarn, revokeTitle: C.shareRevokeTitle, revokeBody: C.shareRevokeBody }
}

/** ShareIncident's default frame: the action right under the body (the Rapport's inline use). */
const inline = (body: ReactNode, action: ReactNode) => <>{body}{action}</>

/** The surface itself, and the chooser: the tabs ARE how somebody picks which link they are
 *  handing over. Fetches the state of EVERY door it offers on mount, so switching tabs is a pure
 *  render and never a second loading pass (see the effect below).
 *  `onState` reports each door's link back as it arrives — the Atemschutz board's own button
 *  paints its «ein Link läuft» tint from it without a second request.
 *
 *  `archived` drops the Atemschutz tab: that link dies with the Einsatz (404), so after the
 *  Abschluss it is not a choice but a dead end — see `lib/viewLink · shareDoors`. */
export function ShareIncident({ incidentId, initialKind = 'view', archived, autoCreate, onState, frame = inline }: {
  incidentId: string
  initialKind?: ShareLinkKind
  archived?: boolean
  /** mint the `initialKind` link straight away when the door that opened this sheet already IS
   *  the decision — see the effect below */
  autoCreate?: boolean
  onState?: (kind: ShareLinkKind, link: ShareLink) => void
  /** where the surface stands: `body` is everything read, `action` the one primary («Link
   *  erstellen», only while there is no link). Inline (the Rapport) puts it under the body; the
   *  sheet hands it to its foot — see ShareIncidentSheet. */
  frame?: (body: ReactNode, action: ReactNode) => ReactNode
}) {
  const C = appConfig.copy.preflight
  const doors = shareDoors({ archived })
  const [picked, setPicked] = useState<ShareLinkKind>(initialKind)
  // Derived, never synced: a kind that is not on offer (the Atemschutz link on a closed Einsatz,
  // reached through the QR beside the bell) must not be what the sheet shows — with the tabs
  // gone there would be no way back off it.
  const kind = doors.some((d) => d.kind === picked) ? picked : doors[0].kind
  // Keyed by kind, so switching back to one already fetched is instant instead of a second
  // «noch keiner» flash over a link that exists. Never mints anything — see the effect below.
  const [links, setLinks] = useState<Partial<Record<ShareLinkKind, ShareLink>>>({})
  /* ⚠️ …and «die Frage kam nicht durch» is a THIRD state (04.09., field report: the sheet was
     reopened and stood on «Link erstellen» although a link existed; creating again then showed
     the QR). The mount fetch swallowed its failures in a bare `.catch(() => {})`, which left the
     cache entry undefined for good — so the sheet either sat on «wird geladen» until it was
     closed, or, worse, a stale/partial cache dropped it to the create layout over a link that was
     already handed out. Nothing about a failed GET says there is no link, so this state renders
     neither: it says the load failed and offers the question again. (Minting twice would not
     actually orphan anything — POST hands back the existing secret, api/incidents · idempotent —
     but it is still an answer the sheet has no business inventing.) */
  const [failed, setFailed] = useState<Partial<Record<ShareLinkKind, boolean>>>({})
  const link = links[kind] ?? null
  // ⚠️ «Noch nicht gefragt» and «gibt es keinen» are two different states, and collapsing them
  // into one `null` is what made this sheet flash. See the pending branch below.
  const pending = links[kind] === undefined && !failed[kind]
  const [busy, setBusy] = useState(false)

  // `onState` is read through a ref: a caller passing an inline arrow must not re-run the fetch.
  const report = useRef(onState)
  useEffect(() => { report.current = onState }, [onState])

  const setLink = (k: ShareLinkKind, l: ShareLink) => {
    setLinks((prev) => ({ ...prev, [k]: l }))
    // an answer clears the failure it replaces — a retry that lands must leave no trace of the
    // attempt that did not
    setFailed((prev) => (prev[k] ? { ...prev, [k]: false } : prev))
    report.current?.(k, l)
  }

  // ⚠️ The «still mounted» guard is per COMPONENT, not per effect run. Cancelling the in-flight
  // fetch when the kind changes is what made switching back re-ask: the first answer was thrown
  // away mid-flight and the cache stayed empty, so a second «noch keiner» flashed over a link
  // that existed — which is how somebody mints a second one by mistake.
  const mounted = useRef(true)
  // set on mount, not only cleared on unmount: StrictMode runs mount → cleanup → mount, and a
  // ref left false after that would drop every fetch answer for the life of the sheet
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  /** Ask the server for one door's state. It RECORDS a rejection instead of swallowing it, so
   *  «asked and refused» can never be confused with «not asked yet» — that pair is what the
   *  layouts below branch on, and a bare `.catch(() => {})` is how they got confused in the first
   *  place. Also the retry: the same call the mount makes, so a link that loads on the second try
   *  is in no different a state than one that loaded on the first.
   *  ⚠️ It writes nothing SYNCHRONOUSLY — the mount effect calls it in a loop, and clearing a
   *  stale failure from in here would be a setState inside an effect body. The retry clears its
   *  own, which is the only caller that can have one to clear. */
  const load = (k: ShareLinkKind) => {
    void fetchShareLink(incidentId, k)
      .then((l) => { if (mounted.current) setLink(k, l) })
      .catch(() => { if (mounted.current) setFailed((prev) => ({ ...prev, [k]: true })) })
  }

  /* ⚠️ EVERY door on offer is fetched on MOUNT, not just the one on screen (04.09.). Fetching per
     tab meant that the first switch swapped in a kind nothing was known about yet, so the sheet
     fell back to the whole «noch keiner» layout — lede plus «Link erstellen» — and then jumped to
     the QR block a moment later when the answer arrived. There are at most two doors and the
     request is same-origin: asking for both up front costs one extra call and makes switching a
     pure render. `doorKeys` rather than `doors` as the dep — `shareDoors` builds a fresh array
     every render. */
  const doorKeys = doors.map((d) => d.kind).join(',')
  useEffect(() => {
    for (const d of doors) {
      if (links[d.kind]) continue // already known — switching kinds must not re-ask
      load(d.kind)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `links` is the cache this reads, not a trigger
  }, [incidentId, doorKeys])

  // Empty until there IS a link — `viewLinkUrl` returns '' for a disabled one, and every
  // branch below keys off this rather than off a half-built URL.
  const url = link?.enabled ? viewLinkUrl(link) : ''

  const run = async (fn: () => Promise<ShareLink>, failure: string) => {
    setBusy(true)
    try { setLink(kind, await fn()) } catch { toast(failure) } finally { setBusy(false) }
  }

  /* ONE TAP (18.09.2026). The QR beside the Atemschutz bell is pressed by somebody already
     holding the other phone out — «Überwachung abgeben» IS the decision, and a sheet that then
     asks «Link erstellen?» is the same question a second time (the reasoning that removed the
     chooser step in front of this sheet on 03.09.). So that door mints as soon as the fetch says
     there is none, and what opens is the QR.
     Three guards, all load-bearing: only the kind the door meant (switching tabs by hand is a
     decision of its own and must not mint anything), only once per sheet (`minted`, so «Link
     aufheben» leaves the sheet revoked instead of instantly re-minting), and only on a REAL
     answer — `links[kind] === undefined` is «not asked yet» and `failed[kind]` is «the question
     came back unanswered», neither of which says a link does not exist. */
  const minted = useRef(false)
  useEffect(() => {
    if (!autoCreate || minted.current || busy) return
    if (kind !== initialKind) return
    const known = links[kind]
    if (known === undefined || failed[kind]) return
    if (known.enabled && viewLinkUrl(known)) return
    minted.current = true
    void run(() => createShareLink(incidentId, kind), C.shareCreateFailed)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `run`/`C` are re-made every render
  }, [autoCreate, incidentId, initialKind, kind, links, failed, busy])

  const kc = kindCopy(kind)

  /* ONE LINE per segment (27.09.2026, slim sweep 4b): «Einsatz · lesen» · «Trupps · bedienen».
     It was two lines — «Ganzer Einsatz» over «nur lesen» — the app's only stacked segment; what
     «Ganzer» and «Nur» carried, «lesen / bedienen» say more plainly, so the shared `.useg` track
     is used as it is (`.esh-kind` only stretches it to the sheet's width, 13-incident.css).
     Absent with one door left (an abgeschlossener Einsatz): a chooser offering one choice is a
     question with one answer, and it would read as if something were missing. */
  const picker = doors.length > 1 && (
    <div className="esh-kind">
      <Segmented<ShareLinkKind>
        ariaLabel={C.shareKindLabel}
        value={kind}
        onChange={setPicked}
        options={doors.map((d) => ({ value: d.kind, label: d.label }))}
      />
    </div>
  )

  /* ⚠️ Nothing to press until the answer is in. Drawing the «Link erstellen» layout for a link
     that may well already exist is not just the flash somebody reported — the button offered in
     that window MINTS, so a fast thumb could rotate an address that had already been handed out.
     A quiet row instead, in the place the sentence will take, and no control at all. */
  if (pending) {
    return frame(
      <>
        {picker}
        <p className="esh-lede esh-pending" aria-busy="true">
          <ShellLoader />{C.shareLoading}
        </p>
      </>,
      null,
    )
  }
  /* ⚠️ …and the same restraint when the question came back unanswered. «Konnte nicht geladen
     werden» is not «es gibt keinen»: the ONE thing this branch must never do is offer «Link
     erstellen», because that button mints and the sheet has no idea whether an address is already
     out there. So it says what happened and hands back the same question. Above the create branch
     on purpose — `!url` is true here too, and this is the more specific truth. */
  if (failed[kind]) {
    return frame(
      <>
        {picker}
        <p className="esh-warn" role="status"><Icon id="warn" />{C.shareLoadFailed}</p>
        {/* clearing the failure first is what puts the sheet back on the quiet «wird geladen» row
            while the second attempt is in flight — otherwise the retry looks like it did nothing */}
        <button type="button" className="ip-btn"
          onClick={() => { setFailed((prev) => ({ ...prev, [kind]: false })); load(kind) }}>
          <Icon id="rotate" />{C.shareRetry}
        </button>
      </>,
      null,
    )
  }
  if (!url) {
    return frame(
      <>
        {picker}
        <p className="esh-lede">{kc.lede}</p>
        {kind === 'view' && <PresentCard />}
      </>,
      <button type="button" className="ip-btn primary" disabled={busy}
        onClick={() => void run(() => createShareLink(incidentId, kind), C.shareCreateFailed)}>
        {busy ? <ShellLoader /> : <Icon id="external" />}{busy ? C.shareBusy : C.shareCreate}
      </button>,
    )
  }
  return frame(
    <>
      {picker}
      <p className="esh-lede">{kc.liveLede}</p>
      <ShareLinkCode url={url}>
        <button type="button" className="ip-btn esh-revoke" disabled={busy}
          onClick={() => void confirmDialog({
            title: kc.revokeTitle,
            message: kc.revokeBody,
            confirmLabel: C.shareRevokeConfirm,
            danger: true,
          }).then(async (ok) => { if (ok) await run(() => revokeShareLink(incidentId, kind), C.shareRevokeFailed) })}>
          {C.shareRevoke}
        </button>
      </ShareLinkCode>
      {/* Says what the link actually hands over. It is the one thing somebody has to have read
          BEFORE sending it, so it stands under the address, not behind a tooltip. */}
      <p className="esh-warn"><Icon id="warn" />{kc.warn}</p>
      {/* «Präsentieren» (05.11.2026, mock 8B): under the read link, because whoever follows is
          either on the Einsatz already or holds exactly this link. Absent outside the Einsatz
          (the Rapport's inline «Weitergeben»: no PresentationContext there). */}
      {kind === 'view' && <PresentCard />}
    </>,
    null,
  )
}

/** The plain door: the same surface as a sheet of its own — «Teilen» im Einsatzkopf, «Teilen»
 *  auf der Einsatz-Karte, and the QR beside the Atemschutz bell. `initialKind` is which tab the
 *  door means; only the QR passes one, because standing on the Tafel it is the only link it
 *  could have meant. `fit` — there are at most seven things on it, and the uniform 800px frame
 *  would be mostly empty below them. */
export function ShareIncidentSheet({ incidentId, initialKind, archived, autoCreate, onClose, onState }: {
  incidentId: string
  initialKind?: ShareLinkKind
  archived?: boolean
  autoCreate?: boolean
  onClose: () => void
  onState?: (kind: ShareLinkKind, link: ShareLink) => void
}) {
  // «Link erstellen», the sheet's one primary, stands in THE sheet foot (r36, 06.11.2026 – it sat
  // content-wide at the body's left edge, the one sheet whose primary did); the foot is there only
  // while there is something to create
  return (
    <ShareIncident incidentId={incidentId} initialKind={initialKind} archived={archived} autoCreate={autoCreate} onState={onState}
      frame={(body, action) => (
        <Modal title={appConfig.copy.incidentSwitcher.share} onClose={onClose} fit footer={action}>
          <div className="esh">{body}</div>
        </Modal>
      )} />
  )
}
