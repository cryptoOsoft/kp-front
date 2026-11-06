import { useEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { Icon } from '../lib/icons'
import { appConfig } from '../config/appConfig'
import { fillTemplate, formatTime } from '../lib/format'
import { cx } from '../lib/cx'
import { confirmDialog } from '../lib/ui'
import { useMeldung } from '../lib/useMeldung'
import { serverNow } from '../lib/serverClock'
import { fmtClock, notfallFacts, safetyInside, safetyReady, truppHeadName, truppInNotfall, truppLogName } from '../lib/atemschutz'
import { notfallFactLine, notfallWho, type NotfallStrip as NotfallStripModel } from '../lib/notfall'
import { NODE_HOLD_ARM_MS, useNodeHold } from '../lib/nodeHold'
import type { Trupp } from '../types'
import s from './Atemschutz.module.css'

// The Atemschutznotfall (F1, 08.10.2026) — ONE Trupp in distress, said by a person.
//
// Five pieces live here, because they describe the same emergency and must never word it twice
// (the last two are the handed-over phone board's, the Atemschutz-Link redesign R1 of 30.10.2026):
//  · `NotfallHold` — the held tile on the Trupp's card that raises it, and the same tile that ends
//    it («Notfall beendet»). The hold is `lib/nodeHold`, the app's one deliberate hold (250 ms of
//    stillness, then the whole tile fills to 825 ms) — a Notfall is never one brushed tap away,
//    and neither is silencing one.
//  · `NotfallBanner` — the top of the Tafel on every board while a Notfall runs: who, the clock,
//    what the record last knew (place, Druck with its age, Kanal), and the first thing to do:
//    «Sicherungstrupp einsetzen» (the board's existing Sicherungstrupp, its ordinary Eintritt).
//  · `AtemschutzNotfallMeldungen` — the same, as the TOP row of the Meldeleiste on every other
//    surface (MELDUNG_RANK.notfall = 0, above the überfällig row and a fresh dispatch).
//  · `NotfallPageHead` / `NotfallPageSafety` — on the link board the Notfall Trupp's own page IS
//    the Notfall: its head (information) and its Sicherungstrupp act (at the page's foot, E3).
//  · `NotfallStrip` — on any other tab of the link board, the red strip that leads to it.
// The banner and the page offer the Sicherungstrupp through ONE act (`safetyAct`).
// The wording is deliberately neutral and short — it mirrors the AS emergency procedure
// (FwDV 7 / FKS) and the station's AS instructors check it (copy · atemschutz.notfall).

/** How long a plain tap's «Gedrückt halten» stands in the tile's place of its word. */
export const NOTFALL_TAP_HINT_MS = 1600
/** …and how long a completed hold shows the tile full, before it turns into its other face. */
export const NOTFALL_FIRED_MS = 450

/**
 * The held tile — «Notfall» on a crew inside, «Notfall beendet» on a crew in one.
 *
 * The WHOLE TILE is the progress (owner feedback 10.10.2026 — a 24px ring around the glyph was
 * the hold's only feedback and read as «loading»): a fill sweeps left→right across the tile's
 * background in step with `hold.armed.progress` (`--hold`, a `scaleX` on a pseudo layer — no
 * reflow, the word never moves), red for «Notfall», green for «Notfall beendet». A completed hold
 * shows the tile full for a beat (`NOTFALL_FIRED_MS`, in the face that fired), so the hand sees
 * that it counted before the tile becomes its other face.
 *
 * ⚠️ A TAP does nothing but say how: the tile's own word becomes «Gedrückt halten» for
 * `NOTFALL_TAP_HINT_MS`, in place — no toast — because the deliberate act is the hold, and a tap
 * that raised the loudest alarm in the app would be raised by every glove that brushes the card.
 * A click with no pointer behind it (keyboard, switch access: `detail === 0`) cannot hold, so it
 * asks ONE question instead, the safe answer focused.
 * ⚠️ `data-holdaction` rides in on the hold's props, so the app-wide hold-tooltip never claims the
 * press (docs/ui-conventions.md · Touch vocabulary).
 */
export function NotfallHold({ end = false, onFire, className }: {
  /** the «Notfall beendet» face of the tile */
  end?: boolean
  onFire: () => void
  className?: string
}) {
  const nf = appConfig.copy.atemschutz.notfall
  const hold = useNodeHold()
  // when the press began — read in the click that ends it: a press long enough to have armed the
  // fill was a HOLD (fired or let go), never a tap asking how
  const downAt = useRef(0)
  // a tap's «Gedrückt halten» (a nonce, so a second tap restarts its time) and the fired beat
  const [tapHint, setTapHint] = useState(0)
  const [fired, setFired] = useState<'act' | 'end' | null>(null)
  useEffect(() => {
    if (!tapHint) return
    const id = setTimeout(() => setTapHint(0), NOTFALL_TAP_HINT_MS)
    return () => clearTimeout(id)
  }, [tapHint])
  useEffect(() => {
    if (!fired) return
    const id = setTimeout(() => setFired(null), NOTFALL_FIRED_MS)
    return () => clearTimeout(id)
  }, [fired])
  // the face on screen: the one that just fired keeps the tile for its beat
  const isEnd = fired ? fired === 'end' : end
  const label = end ? nf.end : nf.act
  const hint = end ? nf.endHint : nf.actHint
  const press = hold.press(end ? 'notfall-end' : 'notfall', () => { setFired(end ? 'end' : 'act'); onFire() })
  const progress = fired ? 1 : hold.armed?.progress ?? 0
  return (
    <button type="button"
      className={cx(s.actBtn, isEnd ? s.actNotfallEnd : s.actNotfall, (hold.armed || fired) && s.actHolding, fired && s.actFired, className)}
      style={{ '--hold': progress } as CSSProperties}
      aria-label={`${label} – ${hint}`} title={hint}
      {...press}
      onPointerDown={(e) => { downAt.current = Date.now(); setTapHint(0); press.onPointerDown(e) }}
      onClick={(e) => {
        if (e.detail !== 0 && Date.now() - downAt.current >= NODE_HOLD_ARM_MS) return // the end of a hold
        if (e.detail === 0) {
          void confirmDialog({ title: label, message: hint, confirmLabel: label, cancelLabel: appConfig.copy.cancel, safeAnswer: 'cancel', danger: !end })
            .then((ok) => { if (ok) onFire() })
          return
        }
        setTapHint((n) => n + 1)
      }}>
      {/* the glyph keeps the 24px box the ring had, so the resting tile did not move a pixel */}
      <span className={s.holdGlyph} aria-hidden><Icon id={isEnd ? 'check' : 'warn'} /></span>
      <span>{tapHint && !fired ? nf.holdHint : isEnd ? nf.end : nf.act}</span>
    </button>
  )
}

/** One second of the deployment's clock, for a surface that shows a running Notfall clock and
 *  ticks nothing else (the Meldeleiste publisher). Runs only while `on`. */
function useSecondTick(on: boolean): number {
  const [now, setNow] = useState(() => serverNow())
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => setNow(serverNow()), 1000)
    return () => clearInterval(t)
  }, [on])
  return now
}

/** What the board hands the Notfall's Sicherungstrupp act — the banner's and the link page's. */
export interface SafetyActProps {
  /** the Sicherungstrupps ready to go in (lib/atemschutz · safetyReady), board order */
  ready: Trupp[]
  /** …and the ones already sent in (safetyInside) */
  inside: Trupp[]
  canEdit: boolean
  onDeploySafety: (id: string) => void
  /** several ready: the board's menu that asks which (rendered around the button) */
  pickSafety?: (trigger: ReactElement) => ReactNode
  /** none ready: the board's «Sicherungstrupp bestimmen» menu — every other Atemschutz-Trupp,
   *  bereit · drin · draussen, to be put on «Sichern» (AtemschutzView, lib/atemschutz ·
   *  safetyCandidates; rendered around the button), else straight to the create form (`onDefineSafety`) */
  defineSafety?: (trigger: ReactElement) => ReactNode
  onDefineSafety?: () => void
}

/**
 * The first thing to do in a Notfall — «Sicherungstrupp einsetzen»: the ready one goes in through
 * its ordinary Eintritt (several ⇒ `pickSafety` asks which); none ready ⇒ «Sicherungstrupp
 * bestimmen» with «Kein Sicherungstrupp bereit» under it; one already inside ⇒ who and since when,
 * and nothing offered twice. The primary tile carries its reason as a small second line. Null for
 * a device that cannot write while one stands ready (it is not told «nobody ready»).
 */
function safetyAct({ ready, inside, canEdit, onDeploySafety, pickSafety, defineSafety, onDefineSafety }: SafetyActProps): ReactNode {
  const nf = appConfig.copy.atemschutz.notfall
  const primary = (cls: string, word: string, sub: string | undefined, onClick: (() => void) | undefined, icon?: ReactNode) => (
    <button type="button" className={cx(s.actBtn, cls, s.nfPrimary)} onClick={onClick}>
      {icon}
      <span className={s.nfPrimaryTxt}>
        <span>{word}</span>
        {sub && <span className={s.nfPrimarySub}>{sub}</span>}
      </span>
    </button>
  )
  const deployBtn = primary(s.actEnter, nf.sitrDeploy, ready.length === 1 ? ready[0].name : undefined,
    ready.length === 1 ? () => onDeploySafety(ready[0].id) : undefined, <Icon id="flag" />)
  const defineBtn = primary(s.nfDefine, nf.sitrDefine, nf.sitrNone, defineSafety ? undefined : onDefineSafety)
  const canDefine = canEdit && !!(defineSafety || onDefineSafety)
  return inside.length > 0 ? (
    <p className={s.nfNote}>{fillTemplate(nf.sitrInside, {
      name: inside[0].name,
      time: inside[0].entryTime ? formatTime(new Date(inside[0].entryTime)) : '',
    })}</p>
  ) : ready.length > 0 ? (
    !canEdit ? null : ready.length > 1 && pickSafety ? pickSafety(deployBtn) : deployBtn
  ) : canDefine ? (
    defineSafety ? defineSafety(defineBtn) : defineBtn
  ) : (
    <p className={s.nfNote}>{nf.sitrNone}</p>
  )
}

/**
 * The top of the Tafel while a Notfall runs — every board (tablet grid, phone board, the
 * handed-over Tafel). The strip's row steps aside on the board (AtemschutzAlarmMeldung's rule),
 * so this is that row's place here, and it stays put however the board is sorted.
 *
 * The first offered action is «Sicherungstrupp einsetzen»: the Sicherungstrupp standing ready
 * goes in through its ordinary Eintritt (useTruppActions · setTruppStatus, which writes
 * «Sicherungstrupp eingesetzt – Notfall Trupp …, n min nach Auslösung»). Several ready ⇒ the
 * button asks which (`pickSafety`). None ready ⇒ it says so and offers the board's own
 * «Bestimmen» door. One already inside ⇒ it says who and since when, and offers nothing twice.
 *
 * ⚠️ A Trupp card in its alarm state, not a widget of its own (owner feedback 10.10.2026, four
 * rounds — the first banner was ~620 device px of kicker, clock column, wrapped names, facts,
 * notes and two rows of buttons): it is sticky, so every pixel of it covers the board, and beside
 * the cards it must read as one of them. So it IS one — the card's frame and red tone.
 *  · Phone: the card's own head line («⚠ Binggeli Michael … 0:04 ›» — the name the crew's card
 *    shows, `truppHeadName`, so the card below reads as the same crew; the whole line is «Zum
 *    Trupp»), then the one act at the banner's width. No facts line: the card right below shows
 *    Druck and Kanal (the facts stay in the aria label, the Meldeleiste row and the Verlauf).
 *  · Wide boards (`wide`, the tablet / desktop grid): ONE slim row — «⚠ name» + the facts, the act
 *    at its own width, the clock and › at the right (~60px; a full-width strip with a half-width
 *    button under it was mostly empty space).
 * The act carries its reason as a small second line («Kein Sicherungstrupp bereit» under
 * «Sicherungstrupp bestimmen», the ready crew under «… einsetzen»). Several at once (`dense`):
 * no facts. The board measures the stack (AtemschutzView · `--nf-h`) so an opened card parks
 * BELOW it, never under it.
 */
export function NotfallBanner({ t, now, place, dense = false, wide = false, onGo, ...safety }: SafetyActProps & {
  t: Trupp
  now: number
  place?: string
  /** several Notfälle at once: each banner is ONE head row (who + clock) over its acts — the
   *  people and the facts stay on the card and in the Verlauf, or two banners fill a phone */
  dense?: boolean
  /** a wide board (the tablet / desktop grid): one slim row instead of the phone card's head + act */
  wide?: boolean
  onGo: (id: string) => void
}) {
  const nf = appConfig.copy.atemschutz.notfall
  const f = notfallFacts(t, now)
  // the name the crew's own card head shows (the card below must read as the SAME crew); the full
  // «Trupp 1 (…)» is the alert's and the head's accessible name
  const name = truppHeadName(t)
  // the facts: «Notfall seit 11:11 · Löschen · 300 bar (Eingangsdruck) · Kanal 11»
  const facts = [
    ...(t.notfallAt ? [fillTemplate(nf.stateWord, { time: formatTime(new Date(t.notfallAt)) })] : []),
    ...notfallFactLine(t, now, place).slice(1),
  ]
  const act = safetyAct(safety)
  // the facts are the screen reader's on every board (the phone shows them on the card below)
  const label = [`${nf.title}: ${notfallWho(t)}`, ...facts].join(' · ')
  const goLabel = fillTemplate(nf.goToWho, { name: notfallWho(t) })
  const glyphName = (
    <span className={s.trowName}>
      <Icon id="warn" className={s.nfGlyph} />
      <span className={s.trowNameTxt}>{name}</span>
    </span>
  )
  const clock = <span className={s.trowClockVal}>{fmtClock(f.sinceSec)}</span>
  if (wide) {
    // A wide board (the tablet / desktop grid, owner round 4): ONE slim row across the board —
    // «⚠ name» with the facts beside it (under the name when they do not fit, never cut), the
    // act at its own width, the clock and › at the right. The name side and the clock side both
    // lead to the card; the act between them is its own target (a button cannot hold a button,
    // so the clock side is the same «Zum Trupp» again, out of the tab order and hidden from the
    // screen reader, which has the name side).
    return (
      <section className={cx(s.trow, s.trowCard, s.trowCrit, s.nfBanner, s.nfWide)} role="alert" aria-label={label}>
        <button type="button" className={s.nfWideWho} onClick={() => onGo(t.id)} aria-label={goLabel}>
          {glyphName}
          {!dense && facts.length > 0 && <span className={s.nfFacts}>{facts.join(' · ')}</span>}
        </button>
        {act}
        <button type="button" className={s.nfWideWhen} onClick={() => onGo(t.id)} tabIndex={-1} aria-hidden>
          {clock}
          <span className={s.trowChevron}><Icon id="chevron" /></span>
        </button>
      </section>
    )
  }
  return (
    // the frame IS a Trupp card in its alarm tone (`.trow.trowCard.trowCrit`), so the banner reads
    // as one of the cards below it that came to the top, not as a widget of its own
    <section className={cx(s.trow, s.trowCard, s.trowCrit, s.nfBanner)} role="alert" aria-label={label}>
      {/* row 1: the card's own head line — ⚠ where the card has its dot, the name, the clock, and
          the chevron — and the WHOLE line is the way to the card (as the card's head is its toggle).
          No facts line on the phone (owner round 4): the card right below shows Druck and Kanal. */}
      <button type="button" className={cx(s.trowHead, s.nfHead)} onClick={() => onGo(t.id)} aria-label={goLabel}>
        <span className={s.trowId}>{glyphName}</span>
        <span className={s.trowClock}>{clock}</span>
        <span className={s.trowChevron}><Icon id="chevron" /></span>
      </button>
      {/* row 2: the one act, the banner's width */}
      {act && <div className={s.nfActs}>{act}</div>}
    </section>
  )
}

/**
 * The head of the Notfall Trupp's OWN page on the handed-over phone board (Atemschutz-Link
 * redesign, owner pick R1, 30.10.2026: «r1 is good but we don't need the triangle thing. red and
 * notfall is already enough»; reduced by owner pick E3, 06.11.2026). The board paints the page's
 * left edge red (AtemschutzView · `.bodyFocusNf`, no wash on the ground) and the head is the
 * information only: the name big and red, the crew line right under it (`crew`, TruppCard's own
 * `crewLine`, so it stays the door to the Trupp sheet), then BOTH clocks named («seit Notfall» red,
 * «seit letztem Kontakt», because two bare clocks on one page are a guess). No «NOTFALL SEIT …»
 * eyebrow (E3): the red name and the «seit Notfall» clock say it. What to press – the
 * Sicherungstrupp act – stands at the page's foot with the Trupp's tiles (`NotfallPageSafety`).
 * Used by TruppCard as its `pageHead(crew)`.
 * ⚠️ No ⚠ glyph here, nor in the strip: red and the word «Notfall» carry it (owner). The TAB keeps
 * its ⚠, because the tab has no word «Notfall».
 */
export function NotfallPageHead({ t, now, sinceContactSec, crew }: {
  t: Trupp
  now: number
  /** the contact clock (TruppLive · sinceContactSec) — the second clock the page names */
  sinceContactSec: number | null
  /** the card's crew line (TruppCard · crewLine), drawn under the name */
  crew?: ReactNode
}) {
  const nf = appConfig.copy.atemschutz.notfall
  const f = notfallFacts(t, now)
  return (
    <div className={s.nfPage}>
      <h3 className={s.nfPageName}>{truppHeadName(t)}</h3>
      {crew}
      <div className={s.nfPageClocks}>
        <span className={s.nfPageSince}>{fmtClock(f.sinceSec)}<small>{nf.pageSince}</small></span>
        {sinceContactSec != null && <span className={s.nfPageContact}>{fmtClock(sinceContactSec)}<small>{nf.pageContact}</small></span>}
      </div>
    </div>
  )
}

/**
 * The Sicherungstrupp act on the Notfall Trupp's own page (`safetyAct`, or its note) — with
 * «Anderer ⌄» beside «Sicherungstrupp einsetzen» (`otherSafety`, the board's candidate menu: any
 * other crew, a busy one included). Since owner pick E3 (06.11.2026) it stands in the page's
 * controls at the foot, right above «Notfall beendet» – everything to press in thumb reach
 * (TruppCard · `pageSafety`, `.pageActs`). Null when there is nothing to say.
 */
export function NotfallPageSafety({ otherSafety, ...safety }: SafetyActProps & {
  /** the board's «Anderer ⌄» menu around its trigger — offered beside a ready Sicherungstrupp */
  otherSafety?: (trigger: ReactElement) => ReactNode
}) {
  const nf = appConfig.copy.atemschutz.notfall
  const act = safetyAct(safety)
  const other = otherSafety && safety.canEdit && safety.inside.length === 0 && safety.ready.length > 0
  if (!act) return null
  return (
    <div className={s.nfPageAct}>
      {act}
      {other && otherSafety(
        <button type="button" className={s.nfOther} aria-label={nf.sitrOtherLabel} title={nf.sitrOtherLabel}>
          <span>{nf.sitrOther}</span><Icon id="chevron-down" />
        </button>,
      )}
    </div>
  )
}

/**
 * A Notfall on ANOTHER tab of the handed-over phone board (R1, 30.10.2026): a solid red strip
 * under the header, «Notfall · Schmid Peter 0:09 ›», and a tap switches to that Trupp's tab,
 * where its page carries the Sicherungstrupp act — the strip has none (20q). Several: one strip
 * per Trupp up to two, from three on one «3 Notfälle ›» to the first (lib/notfall · notfallStrips).
 * An alert like the banner it replaces on this board; no ⚠ glyph (owner).
 */
export function NotfallStrip({ strip, now, onGo }: { strip: NotfallStripModel; now: number; onGo: (id: string) => void }) {
  const nf = appConfig.copy.atemschutz.notfall
  if (strip.kind === 'many') {
    const word = fillTemplate(nf.stripMany, { n: strip.count })
    return (
      <section role="alert" aria-label={word} className={s.nfStripBox}>
        <button type="button" className={s.nfStrip} onClick={() => onGo(strip.goTo)}>
          <span className={s.nfStripTxt}>{word}</span>
          <Icon id="chevron" />
        </button>
      </section>
    )
  }
  const { t } = strip
  return (
    <section role="alert" aria-label={`${nf.title}: ${notfallWho(t)}`} className={s.nfStripBox}>
      <button type="button" className={s.nfStrip} onClick={() => onGo(t.id)} aria-label={fillTemplate(nf.goToWho, { name: notfallWho(t) })}>
        <span className={s.nfStripTxt}>{fillTemplate(nf.stripOne, { name: truppHeadName(t) })}</span>
        <b className={s.nfStripClock}>{fmtClock(notfallFacts(t, now).sinceSec)}</b>
        <Icon id="chevron" />
      </button>
    </section>
  )
}

/**
 * The Notfall's row in the Meldeleiste — the top row on every surface but the Tafel (where the
 * banner above stands instead). One row per Trupp in a Notfall: each is its own emergency with
 * its own clock. No ✕: it stays until «Notfall beendet». The primary is «Sicherungstrupp
 * einsetzen» where exactly one stands ready (it goes in, and the operator lands on the Tafel to see
 * it); with several ready it leads to the Tafel, whose banner asks which; with none, or one
 * already inside, «Zum Trupp» is the one move. A device that cannot write the Tafel gets «Zur
 * Kenntnis genommen», which hides the row on THIS device until the next Notfall.
 */
export function AtemschutzNotfallMeldungen({ trupps, placeOf, canEdit = true, onBoard = false, onAcknowledge, onGoToTrupp, onDeploySafety }: {
  trupps: readonly Trupp[]
  placeOf?: (t: Trupp) => string | undefined
  canEdit?: boolean
  onBoard?: boolean
  onAcknowledge?: () => void
  onGoToTrupp: (id: string) => void
  onDeploySafety?: (id: string) => void
}) {
  const inNotfall = trupps.filter(truppInNotfall)
  const now = useSecondTick(inNotfall.length > 0 && !onBoard)
  const [seen, setSeen] = useState<string[]>([])
  if (onBoard) return null
  const ready = safetyReady(trupps)
  const inside = safetyInside(trupps)
  return <>{inNotfall.filter((t) => !seen.includes(`${t.id}:${t.notfallAt}`)).map((t) => (
    <NotfallMeldung key={t.id} t={t} now={now} place={placeOf?.(t)} ready={ready} insideCount={inside.length}
      canEdit={canEdit} onAcknowledge={onAcknowledge} onGoToTrupp={onGoToTrupp} onDeploySafety={onDeploySafety}
      onAck={canEdit ? undefined : () => setSeen((v) => [...v, `${t.id}:${t.notfallAt}`])} />
  ))}</>
}

function NotfallMeldung({ t, now, place, ready, insideCount, canEdit, onAcknowledge, onGoToTrupp, onDeploySafety, onAck }: {
  t: Trupp; now: number; place?: string; ready: Trupp[]; insideCount: number; canEdit: boolean
  onAcknowledge?: () => void
  onGoToTrupp: (id: string) => void
  onDeploySafety?: (id: string) => void
  onAck?: () => void
}) {
  const az = appConfig.copy.atemschutz
  const nf = az.notfall
  const f = notfallFacts(t, now)
  const go = () => { onAcknowledge?.(); onGoToTrupp(t.id) }
  const deploy = canEdit && insideCount === 0 && ready.length > 0 && onDeploySafety
    ? () => { onAcknowledge?.(); if (ready.length === 1) onDeploySafety(ready[0].id); onGoToTrupp(t.id) }
    : null
  useMeldung({
    id: `notfall:${t.id}`,
    kind: 'notfall',
    tone: 'alarm',
    icon: 'warn',
    title: `${fillTemplate(nf.rowTitle, { name: truppLogName(t) })} · ${fmtClock(f.sinceSec)}`,
    sub: [...notfallFactLine(t, now, place), ...(onAck ? [az.alarmRowReadOnly] : [])].join(' · '),
    // the facts are the message — a row cut at «seit 14:32 · 2. O…» would hide the place
    wrap: true,
    actions: [
      ...(onAck ? [{ label: az.alarmRowAck, onClick: () => { onAcknowledge?.(); onAck() } }] : []),
      ...(deploy ? [{ label: nf.sitrDeploy, primary: true, onClick: deploy }, { label: nf.goTo, onClick: go }]
        : [{ label: nf.goTo, primary: true, onClick: go }]),
    ],
    onOpen: { label: nf.goTo, onClick: go },
  })
  return null
}
