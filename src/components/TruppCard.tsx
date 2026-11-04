// One Trupp on the Atemschutz board: the phone row (`TruppRow`) and the card it grows into
// (`TruppCard`), drawn from the same pieces (`RowLine` + `TruppPair`) on every board. Rendered by
// AtemschutzView, which owns the data and the mutations (all via props).
// Rules for this area: docs/atemschutz-board.md.

import { Fragment, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { Icon } from '../lib/icons'
import { appConfig } from '../config/appConfig'
import { fillTemplate } from '../lib/format'
import { confirmDialog, toast } from '../lib/ui'
import { cx } from '../lib/cx'
import { Button } from './Button'
import { Menu } from '../lib/overlays'
import { NotfallHold } from './AtemschutzNotfall'
import { alarmBarFor, currentRunStart, notfallOffered, truppInNotfall, isStandDownExit, estimatePressure, fmtDuration, isAtemschutzTrupp, pressureAlarm, truppHeadName, truppNeverDeployed, type TruppAlarm, type TruppLive } from '../lib/atemschutz'
import { readingBarShown, truppAuftragLabel, truppEquipmentLabels, truppStatusLabel } from '../lib/report'
import type { Trupp, TruppReading } from '../types'
import { atemschutzDoctrine } from '../lib/deploymentConfig'
import s from './Atemschutz.module.css'
import { collapsedClock, fmtTime, tierMark } from './truppCardText'

/** Non-AS Trupp wording — APP ONLY (09.09., field ask). A work squad reports a task done, not a
 *  radio check, so the app says «Auftrag erledigt» / «Ohne Auftrag» / «Ohne Auftrag seit» for
 *  one, instead of borrowing Atemschutz vocabulary. The handed-over link board (`lite`) keeps
 *  today's words for EVERY Trupp on it, plain ones included — it is the one screen an outside
 *  operator was handed, and it must keep meaning what it always meant.
 *  `truppStatusLabel` (lib/report.ts) stays AS vocabulary — it also prints the Rapport — so this
 *  only swaps its plain «Draussen» result at the view layer, never «Nicht eingesetzt» / «Von
 *  Tafel entfernt», which read true for a work squad exactly as they are. */
function plainWords(t: Trupp, lite: boolean) {
  const az = appConfig.copy.atemschutz
  const plain = !lite && !isAtemschutzTrupp(t)
  return {
    exit: plain ? az.actExitPlain : az.actExit,
    outFor: plain ? az.outForPlain : az.outFor,
    status: (label: string) => (plain && label === az.status.raus ? az.statusPlainOut : label),
  }
}

// (`PressureInline`, the tablet card's ± Druck stepper with its own «Bestätigen», went on
// 29.09.2026 with the tablet card: every board's Druck is the pressure tile → PressureSheet.)
/** A day-long clock drawn compact (30.09.2026, owner: «the group leader name needs more space»):
 *  «3 d 9 h» in the clock's mono spent a full character on every space and every unit, the widest
 *  thing on the card's head after the name. The digits stay mono; each unit is a small letter in
 *  the body face hard against its number, and the groups stand a third of an em apart — «3d 9h»,
 *  about two thirds the width. Every other clock passes through as it is. The card's foot draws its
 *  day-long Einsatzzeit / «Draussen seit» through here too, so one card never shows both spellings;
 *  mm:ss and «17:00 min» are untouched. */
export function ClockVal({ val }: { val: string }) {
  const m = /^(\d+) d (\d+) h$/.exec(val)
  if (!m) return <>{val}</>
  // the space rides in the unit's small face, so the text (and what a screen reader reads) is «3d 9h»
  return <>{m[1]}<span className={s.clockUnit}>d </span><span className={s.clockGroup}>{m[2]}<span className={s.clockUnit}>h</span></span></>
}

export function TruppRow({
  t, live, alarm, color, canEdit, onContact, onPressure, onEnter, onOpen, focusNonce, focusScroll = true, flashSeen, onFlashed, lite, conflict = false,
}: {
  t: Trupp; live: TruppLive; now: number; color?: string; canEdit: boolean
  /** «Im Einsatz» on a Trupp still at the door — stands where its empty clock would (RowLine) */
  onEnter?: (id: string) => void
  /** named by the double-assignment band (DoubleAssignmentBanner) — a steady amber ring */
  conflict?: boolean
  /** the shared tier (lib · truppAlarm) — the SAME number the tone, the chip and the card use */
  alarm: TruppAlarm
  onContact: (id: string) => void
  /** open the PressureSheet for this Trupp — the row's second action since 24.09.2026 */
  onPressure: (id: string) => void
  onOpen: () => void
  focusNonce?: number
  /** ring, but do NOT scroll — the badge marks every alarmed Trupp and only ONE of them may own
   *  the scroll port (see `focusNonceOf`); two smooth scrolls at once land nowhere in particular */
  focusScroll?: boolean
  /** the ring has run its full 1.9s — the board writes the nonce down so a later expand/collapse
   *  REMOUNT of this Trupp does not replay a gesture that already landed (see `focusNonceOf`) */
  onFlashed?: () => void
  /** …and this is where the remount reads it back: true = this nonce already rang here */
  flashSeen?: () => boolean
  /** the handed-over «Tafel pur» (see TruppCard) — only gates plain-Trupp WORDING here
   *  (plainWords); the row itself carries no lite-only controls. */
  lite: boolean
}) {
  const az = appConfig.copy.atemschutz
  const status = live.status
  const words = plainWords(t, lite)
  // the same derivations the card makes, so a row and its card never disagree about state
  const inField = t.status === 'aktiv' || t.status === 'rueckzug'
  // forced to 0 off the Atemschutz section — see TruppCard for why no work squad may ever wear
  // one of the alarm tones, whatever a future alarm rule computes for it
  const sev = isAtemschutzTrupp(t) ? alarm.sev : 0
  const monitored = isAtemschutzTrupp(t)
  /* ⚠️ The row says NAME and TIME, nothing else (24.09.2026, maintainer: «drop the blabla, just
   * the time»). The Schätzung line, the state word and the clock caption went: the section
   * heading carries in/ready/out, and the pressure is one tap away on the card. What the row
   * gained is the second action — «Druck» — and words on both buttons, which is why a Trupp inside
   * takes TWO lines on the phone (`.trowTwo`): at 360px a full name, a clock and two worded
   * buttons do not share one.
   * ⚠️ …except the TIER, which only a screen reader hears: the word (tierMark) is in the row's
   * aria-label. No glyph at the clock since 30.10.2026 (owner: «we don't need the triangle thing.
   * red and notfall is already enough»): the red / amber digits carry überfällig / fällig. */
  const acts = monitored && canEdit && inField
  // ⚠️ «Draussen» and «angemeldet» are NOT one tone. They were both `trowIdle` (blue) while the
  // list still had a «Raus»-Abschnitt to tell them apart — and that section is gone (17.08.), so a
  // spent Trupp now sits between two running ones and has to say so by itself. Grey and dimmed,
  // the same reading the card gives it (.st-raus); blue stays what it means everywhere else on
  // this board: registered, still to come.
  // ⚠️ A Trupp WITHOUT Atemschutz gets the SAME row — same height, same columns, same tap — so a
  // phone board reads as one list rather than two kinds of thing. What differs is only what the
  // row can truthfully say: its clock is the Einsatzzeit, not a contact clock; it carries no
  // Schätzung and no «Kontakt», because there is nothing to check in and no cylinder to run down.
  const tone = rowTone(t, status, sev)
  const tier = tierMark(alarm, sev)
  const rowRef = useRef<HTMLButtonElement>(null)
  // A nonce, not a boolean: tapping the same alarm again must replay the pointing gesture.
  // `onFlashed` rides in a ref so its (per-render) identity never restarts the flash effect.
  const onFlashedRef = useRef(onFlashed)
  const flashSeenRef = useRef(flashSeen)
  useEffect(() => { onFlashedRef.current = onFlashed; flashSeenRef.current = flashSeen }, [onFlashed, flashSeen])
  useEffect(() => {
    const el = rowRef.current
    if (focusNonce == null || !el || flashSeenRef.current?.()) return
    if (focusScroll) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.remove(s.cardFlash)
    void el.offsetWidth
    el.classList.add(s.cardFlash)
    const timer = window.setTimeout(() => { el.classList.remove(s.cardFlash); onFlashedRef.current?.() }, 1900)
    // ⚠️ the cleanup UNDOES the mark, it does not merely cancel its removal: an interrupted flash
    // (focusNonce changing — or going away — inside the 1.9s window) would otherwise drop the timer
    // and leave the class on. Under prefers-reduced-motion `.cardFlash` is a STATIC ring with no
    // animation to end, so that stuck class is a permanent one.
    return () => { window.clearTimeout(timer); el.classList.remove(s.cardFlash) }
  }, [focusNonce, focusScroll])
  return (
    <button ref={rowRef} type="button" className={cx(s.trow, acts ? s.trowTwo : s.trowOne, tone, conflict && s.cardConflict)} onClick={onOpen}
      aria-label={[t.name, tier, words.status(status === 'raus' ? truppStatusLabel(t) : (az.status[status] ?? status)),
        t.status === 'rueckzug' ? az.status.rueckzug : '']
        .filter((w, i, all) => w && all.indexOf(w) === i).join(' — ')}>
      <RowLine t={t} live={live} color={color} lite={lite}
        act={canEdit && onEnter ? <RowEnter onEnter={() => onEnter(t.id)} /> : null} />
      {/* ⚠️ always rendered, even when there is no button in it: these are fixed grid tracks, so a
          missing cell would pull every column after it out of line on that one row */}
      <span className={cx(s.trowAct, acts && s.trowActs)}>
        {/* nested: the row itself opens the card, and the two things you must be able to do
            without opening anything are the Druckmeldung and the radio check */}
        {acts && <TruppPair t={t} live={live} sev={sev} nested onPressure={onPressure} onContact={onContact} />}
      </span>
      {/* DOWN, not right: this expands the card in place, it does not navigate anywhere. The
          collapse control it turns into points back up, so the pair reads as one toggle. */}
      <span className={s.trowChevron}><Icon id="chevron-down" /></span>
    </button>
  )
}

/** The phone row's tone (left edge + wash) — the collapsed row's and, since 26.09.2026, the opened
 *  card's too, so a Trupp keeps its colour when it is opened. See TruppRow for why each is what it is. */
function rowTone(t: Trupp, status: TruppLive['status'], sev: number): string {
  const inField = t.status === 'aktiv' || t.status === 'rueckzug'
  if (!isAtemschutzTrupp(t)) return status === 'raus' ? s.trowOut : status === 'angemeldet' ? s.trowIdle : s.trowPlain
  return sev >= 2 ? s.trowCrit : sev === 1 ? s.trowWarn : inField ? '' : status === 'raus' ? s.trowOut : s.trowIdle
}

/** The phone row's first line — dot · name, and the clock — drawn by the collapsed row AND by the
 *  opened card's head (26.09.2026, owner: «keep the same UI whether the card is collapsed or
 *  not»). One drawing, so opening a Trupp never moves, resizes or recolours the line the thumb
 *  just pressed; the chevron beside it is the caller's, because it points the other way. */
function RowLine({ t, live, color, lite, act }: { t: Trupp; live: TruppLive; color?: string; lite: boolean
  /** what stands in the clock's place while the Trupp is still at the door (see `waiting`) */
  act?: ReactNode
}) {
  const az = appConfig.copy.atemschutz
  const words = plainWords(t, lite)
  const team = (t.members ?? []).filter(Boolean).join(' / ')
  const clock = collapsedClock(t, live)
  // ⚠️ Defence in depth: `collapsedClock`'s own `!isAtemschutzTrupp` branch already returns an
  // empty sub for a plain Trupp that is out (it has no break clock to show — see the function's
  // doc comment), so this swap is a no-op today. It stays here so a future edit to that branch
  // cannot silently leak «Draussen seit» onto a work squad's row without also failing the app-only
  // wording test below.
  const clockSub = clock.sub === az.outFor ? words.outFor : clock.sub
  const inNotfall = truppInNotfall(t)
  /* ⚠️ A Trupp still at the door has no clock — «–:––» was an empty time where the next act
   * belongs (owner, 30.10.2026: «for all trupps already show the next action (i.e. im einsatz)
   * rather than the empty time»). The phone row puts «Im Einsatz» there (`act` = RowEnter, the
   * Sicherungstrupp row's button); the opened card leaves the cell empty, because its «Im Einsatz»
   * tile stands right under this line, and a viewer has nothing to press. The link board's page
   * says «Bereit» there instead (TruppCard · `page`, R1 30.10.2026). */
  const waiting = live.status === 'angemeldet'
  // the RECORDED status: an overdue crew on Rückzug overlays live.status to `ueberfaellig`, and
  // it is still on its way out – the badge stays next to the red clock
  const rueckzug = t.status === 'rueckzug' && isAtemschutzTrupp(t)
  const rueckzugLabel = az.status.rueckzug
  return (
    <>
      <span className={s.trowId}>
        <span className={s.trowName}>
          {/* no colour, no dot: the handed-over Tafel never shows the Lage, so a Truppfarbe there
              carries no identity (round 2 review) — and an empty 11px slot would indent the name */}
          {/* ⚠️ a crew in a NOTFALL wears the banner's ⚠ in the dot's place (owner round 4,
              10.10.2026): the banner at the top and this card read as the same crew at a glance */}
          {inNotfall ? <Icon id="warn" className={s.nfGlyph} />
            : color && <span className={s.trowDot} style={{ background: color }} />}
          <span className={s.trowNameTxt}>{truppHeadName(t)}</span>
          {/* ⚠️ «Rückzug» is a badge, not a chip (owner, 31.10.2026): an icon-only filled amber
              circle after the name — the Rückzug tile's own glyph — so it reads on the row, the
              card and the page alike. It is not a tier: the side line stays reserved for «Fällig».
              `flex: none` (.rueckzugBadge) — a long name ellipsises before the badge is squeezed. */}
          {rueckzug && <span className={s.rueckzugBadge} role="img" aria-label={rueckzugLabel} title={rueckzugLabel}><Icon id="undo" /></span>}
          {/* ⚠️ Name only — no «#N», no «SiTr», on the row AND the opened card (owner, staging
              26.09. and 30.09.2026: «the group leader name needs more space … drop the number #»).
              The number stays in the TruppFinder and in the Verlauf's «Trupp N» rows. */}
        </span>
        {team && <span className={s.trowTeam}>{team}</span>}
      </span>
      {/* one derivation with the card's band (collapsedClock) — the row used to freeze a work
          squad's Einsatzzeit after the exit and show «–:––» for an out crew's break clock */}
      <span className={s.trowClock}>
        {/* the tier is the digits' colour (red / amber) – no glyph since 30.10.2026; the word is the
            row's aria-label and the card's status line, for a screen reader */}
        {waiting ? act : (
          <>
            <span className={s.trowClockLine}>
              <span className={s.trowClockVal}><ClockVal val={clock.val} /></span>
            </span>
            <span className={s.trowSub}>{clockSub}</span>
          </>
        )}
      </span>
    </>
  )
}

/** «Im Einsatz» on a ROW — the Bereit rows (RowLine · `waiting`) and the Sicherungstrupp's
 *  (AtemschutzView · SafetyRow): one filled button in the clock's place. Inside the row's own
 *  button a <button> may not stand, so it is a span with the button role, and a tap on it does
 *  not also open the card (same as TruppPair · `nested`). */
export function RowEnter({ onEnter }: { onEnter: () => void }) {
  return (
    <span role="button" tabIndex={0} className={s.rowEnter}
      onClick={(e) => { e.stopPropagation(); onEnter() }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onEnter() } }}>
      {appConfig.copy.atemschutz.actEnter}
    </span>
  )
}

/** «⌓ 240 bar» | «Kontakt» — the two things a Trupp inside needs from the phone board, drawn ONCE
 *  for the collapsed row and the opened card (26.09.2026): same tiles, same sizes, same colours,
 *  same place, so opening a Trupp only ADDS what stands below them. The pressure tile carries the
 *  last reported bar behind the Manometer glyph (red at or under this Trupp's line) — it is the one
 *  number the band used to show beside it, and on the row it answers «how much air» without
 *  opening. ⚠️ No word «Druck» on it since the slim-down (26.09.2026 evening, owner's screenshot):
 *  «unit, verb, value» — a number with its unit behind a gauge IS the pressure, and the word only
 *  made the tile wider than its neighbour. The word stays its accessible name.
 *  `nested`: inside the row's own button a <button> may not stand, so there they are spans with
 *  the button role, and a tap on them does not also open the card. */
function TruppPair({ t, live, sev, nested = false, onPressure, onContact }: {
  t: Trupp; live: TruppLive
  /** the shared tier — the Kontakt colour, identical on the row and on the card */
  sev: number
  nested?: boolean
  onPressure: (id: string) => void
  onContact: (id: string) => void
}) {
  const az = appConfig.copy.atemschutz
  const low = pressureAlarm(live.currentBar, alarmBarFor(t, atemschutzDoctrine()))
  const pressCls = cx(s.kontaktBtn, s.trowPressBtn)
  const kontaktCls = cx(s.kontaktBtn, s.trowKontakt, sev === 1 && s.kontaktWarn, sev >= 2 && s.kontaktCrit)
  const press = <><Icon id="manometer" /><b className={cx(s.pairBar, low && s.pairBarLow)}>{live.currentBar} bar</b></>
  // the spoken name keeps the word the tile dropped («Druck 240 bar»)
  const pressName = `${az.actPressure} ${live.currentBar} bar`
  const kontakt = <><Icon id="radio" /><span>{az.actContact}</span></>
  if (!nested) {
    return (
      <div className={s.trowActs}>
        <button type="button" className={pressCls} aria-label={pressName} onClick={() => onPressure(t.id)}>{press}</button>
        <button type="button" className={kontaktCls} onClick={() => onContact(t.id)}>{kontakt}</button>
      </div>
    )
  }
  const act = (fn: (id: string) => void) => ({
    role: 'button', tabIndex: 0,
    onClick: (e: MouseEvent) => { e.stopPropagation(); fn(t.id) },
    onKeyDown: (e: ReactKeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); fn(t.id) } },
  })
  return (
    <>
      <span className={pressCls} aria-label={pressName} {...act(onPressure)}>{press}</span>
      <span className={kontaktCls} {...act(onContact)}>{kontakt}</span>
    </>
  )
}

/**
 * One Trupp as a card — ONE arrangement, at every width and on every board (03.09.), and since
 * 29.09.2026 ONE DRAWING too: the phone's opened row is the card everywhere.
 *
 * There used to be three drawings of this object: this card, `cardBig` for the handed-over phone
 * board, and `PlainTruppRow` for a Trupp without Atemschutz. Three drawings of one thing drift
 * apart, and these had begun to. This is the card; what varies is only what a Trupp actually HAS.
 *
 * ⚠️ The tablet grid wore its own card until 29.09.2026 (owner: «for the trupps things you can
 * assimilate the tablet / desktop view closer / equal to the mobile view»): a head with the ⋯,
 * a grey Kennzeile sentence with a blue Auftrag, a framed band with the clock in 40px, a
 * full-width Kontakt, a ± Druck stepper with its own Bestätigen, a loud amber «Rückzug melden»
 * beside a ghost «Raus melden», and a Sockel line over a «Verlauf · zuletzt: 11:52 Druck 300 bar»
 * preview — the bar said three times on one card. The phone had slimmed all of that away on
 * 26./27.09. and the owner reviewed that version, so it is the reference and the tablet takes it
 * whole, top to bottom:
 *
 *   1 line       dot · name · the clock (RowLine) — the collapse toggle on the phone board
 *   2 tiles      «⌓ 240 bar | Kontakt» (TruppPair), then Rückzug | Raus in the same tile shape
 *   3 state      the tier in words where colour alone would say it (`stateLine`)
 *   4 Hinweis    the Alarmdruck note, for the case where only the projection has crossed
 *   5 facts      crew · Auftrag · Kanal … as chips, each the door to its sheet (the ⋯ ends the foot)
 *   6 foot       Einsatzzeit · Schätzung, the whole line the Verlauf's toggle
 *
 * The link board's page (`page`) reads the same zones in another order — 1, 3, 4, 5, 6, then the
 * tiles at the page's foot (Notfall · Rückzug | Raus · Druck | Kontakt), see the return below.
 *
 * What the tablet keeps because it has the room: every card open at once in a grid (the phone
 * opens one row at a time because a card is taller than its port), the hand-set order with ‹ ›
 * in the ⋯ (the phone board is arranged by urgency and has none), and its cards' own state words
 * (`headed`: the phone's section heads say Drin / Bereit / Draussen, the grid has no such heads).
 * The Druck is the same `PressureSheet` everywhere — 20-bar steps, a tap saves.
 *
 * ⚠️ In the lifecycle tiles the order is the order the Einsatz runs: Rückzug, then Raus.
 *
 * ⚠️ The secondary controls are a MENU with words, not a row of glyphs. Every one of them
 * already had a German name that only ever surfaced in a `title`: «Platzieren», «Leitung
 * wählen», «Nach oben holen». That a footprint means «platzieren» and a droplet means
 * «Leitung» is exactly the knowledge that is gone after six months without practice.
 */
export function TruppCard({
  t, live, alarm, now, color, canEdit, intervalMin, frozen = false, focusNonce, focusScroll = true, flashSeen, onFlashed, onContact, onStatus, onStandDown, onAskExit, onAskPressure, onEdit, onQuick, onReenter, onDelete, onPlace, onShowPlan, onMove, onShowLine, hasLine, drawnLineNo, dockedAt, onCollapse, headed = false, lite = false, page = false, pageHead, onNotfall, onNotfallEnd, conflict = false,
}: {
  /** the card IS the page (the handed-over phone board, AtemschutzView · focusMode): drawn flat by
   *  the board, and a crew at the door says «Bereit» where its clock would stand (Atemschutz-Link
   *  redesign R1, 30.10.2026); its tiles stand at the page's foot, Druck | Kontakt lowest
   *  (31.10.2026, «read at the top, tap at the bottom») */
  page?: boolean
  /** replaces the head line on such a page — the Notfall Trupp's own page wears
   *  AtemschutzNotfall · NotfallPageHead, which also says the Notfall in words */
  pageHead?: ReactNode
  /** named by the double-assignment band (DoubleAssignmentBanner) — a steady amber ring */
  conflict?: boolean
  /** the held «Notfall» on a crew inside, and the held «Notfall beendet» on a crew in one (F1,
   *  AtemschutzNotfall · NotfallHold). Absent for a viewer and on a closed Einsatz. */
  onNotfall?: () => void
  onNotfallEnd?: () => void
  /** the mini sheets (26.09.2026 — components/TruppSheets): a tap on the Kanal opens the Kanal
   *  sheet, a tap on the Auftrag / Ziel / a missing Auftrag the Auftrag sheet, a tap on the crew or
   *  the Ausrüstung the Trupp sheet. Absent for a viewer. */
  onQuick?: (kind: 'kanal' | 'auftrag' | 'trupp') => void
  t: Trupp; live: TruppLive; now: number; canEdit: boolean
  /** the shared tier (lib · truppAlarm) — the SAME number the tone, the chip and the row use */
  alarm: TruppAlarm
  /** the Funkkontakt-Intervall (min) — the Verlauf's timing head names the next due time */
  intervalMin: number
  /** the Einsatz is closed: the clock stands at the close and the band says so (R3) */
  frozen?: boolean
  /** the colour this Trupp wears on the Lage / plan (useTruppActions · truppColors) — set for
   *  every Trupp, automatic ones included */
  color?: string
  onContact: (id: string) => void
  onStatus: (id: string, status: Trupp['status']) => void
  /** «Nicht eingesetzt» — the stand-down of a Trupp that never went in, with its undo toast */
  onStandDown: (id: string) => void
  /** «Raus melden» asks the Restdruck first (PressureSheet) — absent = straight out, as before */
  onAskExit?: (id: string) => void
  /** the pressure tile's door: the PressureSheet (24.09.2026 on the phone, every board since
   *  29.09.2026 — the tablet's inline ± stepper is gone) */
  onAskPressure?: (id: string) => void
  /** the board's own section heads name the lifecycle state (the phone board's Drin / Bereit /
   *  Draussen) — then the card does not say «Bereit» / «Draussen» a second time. The tablet grid
   *  and the handed-over Tafel have no such heads, so their cards do. */
  headed?: boolean
  /** this is the card somebody was just sent to — scroll it under their eyes and mark it */
  focusNonce?: number
  /** ring, but do NOT scroll — the header badge marks every alarmed Trupp and only ONE of them
   *  may own the scroll port (see `focusNonceOf`) */
  focusScroll?: boolean
  /** see TruppRow — the completed ring reports back so a remount does not replay it */
  onFlashed?: () => void
  flashSeen?: () => boolean
  onEdit: (focus?: 'auftrag') => void
  onReenter: () => void
  onDelete: (id: string) => void
  /** present only while the hand-set order is the one on screen (see AtemschutzView) */
  onMove?: (id: string, dir: -1 | 1) => void
  onPlace: (id: string) => void
  onShowPlan: (id: string) => void
  /** jump to the drawn Leitung (Lage or Plan) — the counterpart of «auf Plan zeigen» */
  onShowLine: (id: string) => void
  /** is there actually a hose drawn for this Trupp? Decides whether the chip is a jump or plain
   *  text — a button that goes nowhere is worse than no button. */
  hasLine: boolean
  /** the symbol the Trupp's marker is docked to («bei «Hydrant»») – see AtemschutzView.dockedAt */
  dockedAt?: string
  /** the number the Trupp's drawn hose carries right now — wins over the stored copy */
  drawnLineNo?: number
  /** set only on the phone board, where this card was opened from a row — collapses back to it:
   *  the card's first line is then the toggle, with the chevron in the pixel that opened it */
  onCollapse?: () => void
  /** the handed-over «Tafel pur» (see AtemschutzView · lite): drop every control that points at
   *  a surface this session cannot reach — Platzieren, auf Plan zeigen, Leitung zeigen,
   *  and the board-order rows. Kontakt, Druck, Rückzug, Draussen, Bearbeiten and Entfernen all
   *  stay: they are what the board was handed over FOR. */
  lite?: boolean
}) {
  const az = appConfig.copy.atemschutz // read per-render so the resolved locale applies
  const status = live.status
  /* A Trupp WITHOUT Atemschutz has no contact clock, no Druck and no Schätzung. It gets this same
   * card with those zones empty — and never a tint, never an alarm colour, never a «Kontakt»
   * button. That restraint is the statement: nothing on it may look like something being
   * monitored. What it does have — who, what, where, how long — sits exactly where the monitored
   * card carries the same facts, so the two read as one board rather than two. */
  const monitored = isAtemschutzTrupp(t)
  const words = plainWords(t, lite)
  // «Draussen» on a Trupp that never went under PA claims it came out of something. Only that
  // one word differs — the state, the section and the actions are the same (truppNeverDeployed).
  // ⚠️ `words.status` swaps ONLY the plain «Draussen» result, app-side, into «Ohne Auftrag» —
  // see `plainWords`.
  const statusLabel = words.status(status === 'raus' ? truppStatusLabel(t) : (az.status[status] ?? status))
  const [logOpen, setLogOpen] = useState(false)
  // ⚠️ The jump has to LAND. Switching to the Überwachung and leaving a wall of cards was the
  // complaint: on a long list the Trupp somebody was sent to was off-screen, so the answer to
  // «why can I not tick this person» was still a search. The nonce replays both scroll and ring
  // when the same notification is tapped again while this card remains mounted.
  const cardRef = useRef<HTMLDivElement>(null)
  // `onFlashed` rides in a ref so its (per-render) identity never restarts the flash effect.
  const onFlashedRef = useRef(onFlashed)
  const flashSeenRef = useRef(flashSeen)
  useEffect(() => { onFlashedRef.current = onFlashed; flashSeenRef.current = flashSeen }, [onFlashed, flashSeen])
  useEffect(() => {
    const el = cardRef.current
    if (focusNonce == null || !el || flashSeenRef.current?.()) return
    if (focusScroll) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.remove(s.cardFlash)
    void el.offsetWidth
    el.classList.add(s.cardFlash)
    const timer = window.setTimeout(() => { el.classList.remove(s.cardFlash); onFlashedRef.current?.() }, 1900)
    // ⚠️ same as TruppRow: the cleanup must REMOVE the class, not just clear the timer. A flash cut
    // short (focusNonce changing or clearing inside the 1.9s window) otherwise leaves the mark on
    // the card for good — visibly so under prefers-reduced-motion, where `.cardFlash` is a static
    // ring rather than an animation that ends by itself.
    return () => { window.clearTimeout(timer); el.classList.remove(s.cardFlash) }
  }, [focusNonce, focusScroll])
  const inField = t.status === 'aktiv' || t.status === 'rueckzug'
  const auftrag = truppAuftragLabel(t.auftrag)
  // ⚠️ forced to 0 off the Atemschutz section rather than trusted from `alarm`: every tint, every
  // border and every button colour on this card keys off `sev`, and a work squad must never be
  // able to wear one of them, whatever a future alarm rule decides to compute for it.
  const sev = monitored ? alarm.sev : 0
  const dz = atemschutzDoctrine()
  // Planungshilfe: measured consumption history wins; the configured assumption is used only
  // until enough confirmed Druck values exist. It never replaces a reading or drives an alarm.
  const estimate = monitored && inField ? estimatePressure(t, now, dz.cylinderLiters, dz.estConsumptionLPerMin) : null
  const readings = t.readings ?? []
  // Alarmdruck – EITHER the logged Druck or the expected-pressure Schätzung is enough. Air burns
  // down between radio checks, so a reading that still looked fine at the last Kontakt is exactly
  // how a Trupp slips past its turn-back pressure unnoticed. Visual only: the contact clock stays
  // the single audible alarm (see lib/atemschutz).
  // …against THIS Trupp's line: in Rückzug it is the lower one (lib/atemschutz · alarmBarFor)
  const line = alarmBarFor(t, dz)
  const pressureLow = monitored && pressureAlarm(live.currentBar, line)
  const estimateLow = pressureAlarm(estimate?.bar ?? null, line)
  /* The MEASURED crossing is the alarm and it lives in the band above, where the card's loudest
   * element is. This strip is what is left: the case where only the PROJECTION has crossed — a
   * Planungshilfe, which must never look like a logged reading and must never raise the tier
   * (lib/atemschutz · truppAlarm). */
  const airNote = monitored && inField && estimateLow && !pressureLow
    ? fillTemplate(az.alarmNoteEst, { bar: line })
    : null


  /* The state words (29.09.2026: there is no band any more, on any board — see the zone list
   * above). The clock stands on the card's first line, its colour and the Kontakt tile's carry the
   * tier, and what colour may never carry ALONE is said in words, once, under the tiles. */
  const pressureCrit = monitored && alarm.reason === 'pressure'
  const preEntry = status === 'angemeldet'
  /* ⚠️ «Draussen» does NOT get a contact word. A Trupp that has come out has no running clock
     (deriveTruppLive) and no tier; its first line carries the break clock in the quiet tone
     (RowLine · collapsedClock, `.trowOut`) — for ATEMSCHUTZ only: a crew that has been under PA
     cannot go back in until it has rested, so «wie lange ist der schon draussen» is the next
     operational question about it. A work squad has no such rule and no clock stands there. */
  const out = status === 'raus'
  /* ⚠️ «Nicht eingesetzt» gets NO running clock (04.09.): a Sicherungstrupp stood down without
     ever going under PA shows the moment it was announced, a TIME that does not tick
     (collapsedClock · truppRegisteredAt), and its state line says «Nicht eingesetzt». */
  const neverDeployed = out && truppNeverDeployed(t)

  /* What the band said in WORDS — the tier as text, which colour may never carry alone — is ONE
   * line directly under the tiles (`stateLine`; 26.09.2026 on the phone, every board since
   * 29.09.2026), and only where there is something to say: fällig / überfällig / Alarmdruck, the
   * stopped clock of a closed Einsatz, «Nicht eingesetzt» (the one out state the «Draussen»
   * heading cannot say), and a work squad's state (its section has no state headings).
   * «Kontakt ok» says nothing the green does not, and «Rückzug» is a fact chip of its own.
   * ⚠️ On a board WITHOUT state heads (`!headed`: the tablet grid, the handed-over Tafel) the card
   * also says «Bereit» and «Draussen» in the quiet tone — on the phone those are the section it
   * stands in, and there they would be the same word twice. */
  const rowMode = !!onCollapse
  /* ⚠️ 29.09.2026 (owner on staging): «drop the überfällig – if the card is red it's pretty obvious»,
   * and «the draussen subtitle is probably not even required». So fällig / überfällig are not a
   * state LINE: überfällig is the red clock and edge, fällig its amber digits (no glyph since
   * 30.10.2026), and this line stays for a screen reader only (`hidden`). An out Trupp's «Draussen» goes on every board — its card
   * is the grey one with «Wieder in den Einsatz» on it. What stays in words is what colour cannot
   * carry: the Alarmdruck with its limit, the stopped clock, «Nicht eingesetzt», «Bereit», a work
   * squad's state. */
  const rowWord: { text: string; tone?: string; hidden?: boolean } | null = !monitored ? { text: statusLabel, tone: s.kennQuiet }
    // the Notfall in words, with the moment it was raised — red is not enough to say «Notfall» (F1)
    : alarm.reason === 'notfall' && t.notfallAt ? { text: fillTemplate(az.notfall.stateWord, { time: fmtTime(t.notfallAt) }), tone: s.kennCrit }
    : out ? (neverDeployed ? { text: statusLabel, tone: s.kennQuiet } : null)
    : preEntry ? (headed ? null : { text: az.phoneSectionReady, tone: s.kennQuiet })
    : frozen ? { text: az.clockFrozen, tone: s.kennQuiet }
    : pressureCrit ? { text: `${az.clockAlarmPressure} · ${fillTemplate(az.clockAlarmLimit, { bar: line })}`, tone: s.kennCrit }
    : sev >= 2 ? { text: az.clockOverdue, hidden: true }
    : sev === 1 ? { text: az.clockWarn, hidden: true }
    : null

  // The Leitung chip: the numeric field, else the free text an older record still carries. Shown
  // as typed either way — an incident is a legal record, so nothing rewrites what was entered.
  // ⚠️ The DRAWN hose's number wins over the Trupp's stored copy: renumbering the Leitung in the
  // picture used to leave this chip saying «Ltg 1» beside a hose tagged «Ltg 3» (19.08.). The
  // copy stays the fallback — a Trupp whose hose was deleted keeps the number it worked on —
  // and an older record's free-text designation is still never rewritten.
  const lineTag = drawnLineNo != null ? String(drawnLineNo)
    : t.lineNo != null ? String(t.lineNo) : t.lineNumber?.trim()

  // «Raus» happens immediately, no blocking dialog. The way back is the global ↶ pair (the
  // undo lives in the action, setTruppStatus, so it restores the full pre-raus Trupp — status
  // + clocks — not just re-open a dead-ended card).
  // ⚠️ …except for ONE question on a crew under Atemschutz: its Restdruck (24.09.2026). On 23.09.
  // there was nowhere to put it, so it went into «Eingangsdruck korrigieren» and the Rapport
  // printed entries of 60 and 180 bar. The sheet saves on the tap of a number, and «Ohne Druck
  // raus» is its own button, so the exit still costs one more tap at most and never blocks.
  const askExit = () => (monitored && onAskExit ? onAskExit(t.id) : onStatus(t.id, 'raus'))
  // delete-now, no blocking dialog and — since 09.09. — no Rückgängig toast either: the board
  // raised a pill over itself for every action, and the steady popping read as noise. The two
  // doors back are the global ↶ pair (deleteTrupp registers there) and the non-expiring
  // «Entfernte Trupps» menu; both restore the full record, only the plan/map placement is gone.
  // ONE ask since 11.09. (field wish): an angemeldeter Atemschutz-Trupp that never went in is
  // offered «nicht eingesetzt» first — the honest close-out for a Sicherungstrupp that stood
  // ready (the same stand-down the card's «Nicht eingesetzt» action performs, same gate:
  // preEntry && monitored, so it logs and prints as one). «Entfernen» stays a button away for
  // the erroneous Anmeldung; dismissing does nothing.
  const doDelete = async () => {
    // a Trupp in a Notfall leaves the board only after «Notfall beendet» (useTruppActions · deleteTrupp)
    if (truppInNotfall(t)) { toast(az.notfall.removeBlocked, { icon: 'warn', tone: 'warn' }); return }
    /* ⚠️ A crew that is INSIDE is asked about first (staging walk-through 25.09.2026, N4): one tap
       on «Entfernen» took a crew under PA off the board and out of every alarm, with no question.
       What the operator almost always means is «they are out» — so «Raus melden» is the filled,
       focused answer, and removing them anyway is the quiet one. */
    if (inField) {
      const a = await confirmDialog({
        title: fillTemplate(az.removeInsideTitle, { name: t.no != null ? `${t.no}` : t.name }),
        message: az.removeInsideMsg,
        confirmLabel: az.remove,
        altLabel: words.exit,
        cancelLabel: az.cancel,
        safeAnswer: 'alt',
      })
      if (a === 'alt') { askExit(); return }
      if (a !== true) return
      onDelete(t.id)
      return
    }
    if (preEntry && monitored) {
      const a = await confirmDialog({
        title: az.removeUnusedTitle,
        message: fillTemplate(az.removeUnusedMsg, { name: t.name }),
        confirmLabel: az.actNotDeployed,
        altLabel: az.remove,
        altDanger: true,
      })
      if (a === true) { onStandDown(t.id); return }
      if (a !== 'alt') return
    }
    onDelete(t.id)
  }

  /* ── the ⋯ menu ────────────────────────────────────────────────────────────────────────────
   * The same conditions the four icon buttons carried, now as sentences. Two of them are PAIRS
   * that used to share one glyph and mean opposite things depending on state — nothing placed
   * yet ⇒ put it down, placed ⇒ go there — which is precisely the kind of thing an icon cannot
   * say and a word says for free.
   *
   * «Entfernen» is last, behind a rule, and red. */
  /* ⚠️ «Bearbeiten» in EVERY status, `raus` included (09.09., Feldentscheid). The other two
   * gates below act on a LIVE deployment — placing a symbol for a crew that has come out, or
   * handing it a hose — and keep theirs. This one edits the RECORD, and the record is exactly
   * what stays wrong otherwise: a crew member never entered, a typo in the Auftrag, the wrong
   * Gruppenführer — all of it prints on the Rapport, and the Trupp is `raus` by the time
   * anybody reads it back. Correcting an Eingangsdruck here rewrites the finished run's entry
   * reading, which is the point (useTruppActions · editTrupp · pressurePatch, and the form
   * says so under the field). Everything it writes reaches the Verlauf exactly as a live edit
   * does — one `logEditFields` row naming what changed.
   * ⚠️ On the PHONE it is the LAST resort, not the first row (26.09.2026, phone card slim-down ⑤):
   * every fact the form edits has its own chip and sheet on that card — the crew, the Auftrag,
   * the Ziel, the Leitung, the Kanal, the Ausrüstung — so the form is left for what has no sheet,
   * the Art and the Eingangsdruck-Korrektur. It stands after the jumps,
   * above the rule that separates the closing actions — on the tablet too since 29.09.2026, which
   * wears the same chips (it kept «Bearbeiten» first while its Kennzeile was a sentence). */
  const editItem = canEdit ? [{ label: az.edit, onClick: () => onEdit() }] : []
  const menuItems = [
    ...(lite ? [] : (t.annoId || t.entityId)
      ? [{ label: t.entityId ? az.showOnMap : az.showOnPlan, onClick: () => onShowPlan(t.id) }]
      : canEdit && status !== 'raus' ? [{ label: az.place, onClick: () => onPlace(t.id) }] : []),
    // «Leitung wählen» (tap a hose on the Karte) is gone (15.09.): a Leitung is joined from the
    // form's Ltg-Nr. quick-picks, from the line's own editor, or by snapping a hose end to the
    // Trupp's marker – never from an armed, invisible tap mode.
    ...(lite || !hasLine ? [] : [{ label: az.lineShow, onClick: () => onShowLine(t.id) }]),
    ...editItem,
    // Only while the hand-set order is the one on screen: moving a card under any other sort
    // would rearrange something the sort is about to rearrange back.
    ...(onMove && canEdit && !lite ? [
      { kind: 'sep' as const },
      { label: az.moveBack, onClick: () => onMove(t.id, -1) },
      { label: az.moveForward, onClick: () => onMove(t.id, 1) },
    ] : []),
    /* («Nicht eingesetzt» is a visible button on its own row again — see the Aktionen zone; the
     * ⋮ no longer carries it, owner review 26.09.2026.) */
    ...(canEdit ? [{ kind: 'sep' as const }, { label: az.remove, onClick: doDelete, danger: true }] : []),
  // ⚠️ a separator may never LEAD. On a Trupp that has come out and was never placed, every row
  // above «Entfernen» is withheld and the menu opened on a bare rule.
  ].filter((it, i, all) => !('kind' in it && it.kind === 'sep') || all.slice(0, i).some((p) => !('kind' in p)))

  const crewNames = t.members?.filter(Boolean) ?? []
  /** the Ausrüstung as Kürzel (copy · equipmentShort), in the order it was recorded; an id
   *  without a Kürzel prints the word the Rapport prints (lib/report · truppEquipmentLabels) */
  const equipmentTags = (t.equipment ?? []).map((id) => ({ id, tag: az.equipmentShort[id] ?? truppEquipmentLabels([id])[0] ?? id }))

  /* ── The one line the Sockel leaves standing (09.09.) ──────────────────────────────────────
   * See the markup at «6 + 7» below for what folded and why. This is the part that may not:
   * the two clocks-and-numbers somebody reads WHILE a Trupp is inside, in one compact,
   * label-and-value line instead of four stacked rows.
   * ⚠️ The aktueller Druck joins it only where the pressure tile is NOT showing it. That is not
   * a saving, it is the guard on one: hiding a viewer's only pressure readout behind a chevron
   * would make this pass cost exactly the kind of number it exists to keep in view.
   * ⚠️ Built as data rather than markup so the separators are the LINE's business (CSS), not
   * four call sites each remembering to print a «·» — and so «what stays out» is one list to
   * read when somebody asks that question again. */
  const sockelLine: { key: string; label: string; value: string; alarm?: boolean; labelled?: boolean; title?: string }[] = [
    ...(monitored && t.entryTime
      // a DURATION that says so — «23:39» read at 23:58 was taken for a clock time (staging r4)
      ? [{ key: 'elapsed', label: az.elapsed, value: fmtDuration(live.elapsedSec) }] : []),
    ...(live.outSec != null && !out
      ? [{ key: 'out', label: words.outFor, value: fmtDuration(live.outSec), labelled: true }] : []),
    ...(monitored && !(canEdit && inField)
      ? [{ key: 'bar', label: az.currentPressure, value: `${live.currentBar} bar`, alarm: pressureLow }] : []),
    ...(estimate
      ? [{
        key: 'est',
        label: az.estimatedShort,
        value: `≈ ${estimate.bar} bar`,
        // ⚠️ never red (owner, 24.10.2026, sweep M3): a crossed Schätzung is said once, by the
        // Alarmdruck note with its limit — the red «≈ 0 bar» at the foot said it a second time.
        // A MEASURED Druck on this line (`bar` above) keeps its red.
        // …and it keeps its WORD on the terse line (29.09.2026): on a line that can also carry a
        // MEASURED «240 bar», an unnamed «≈ 0 bar» is exactly the mix-up this guards against — the
        // word does it now, not a dimmed grey that also made the number easy to read past
        labelled: true,
        // the Planungshilfe caveat travels with the number, exactly as it did on the old row
        title: estimate.source === 'history'
          ? az.estimatedHintHistory
          : fillTemplate(az.estimatedHint, { liters: dz.cylinderLiters, rate: dz.estConsumptionLPerMin }),
      }] : []),
  ]
  /* ⚠️ A Trupp WITHOUT Atemschutz has no cylinder, so every row of its log carries a bar of 0 —
   * the `entryPressureBar` a work squad was never asked for (useTruppActions · createTrupp). The
   * Verlauf printed «Eingerückt 0 bar» on a card that otherwise says nothing about pressure at
   * all, which reads as a measurement rather than as the absence of one. The Rapport already
   * leaves these Trupps off the Atemschutz page for exactly this reason (lib/reportPdfDirect);
   * the board now says as little about their Druck as the paper does. The rows themselves stay:
   * angemeldet / eingerückt / draussen is this Trupp's chronology and the log is the record.
   * ⚠️ The zero check inside `readingBarShown` is what carries this after an UPGRADE: those same
   * 0-bar rows survive into a Trupp that IS monitored now, where `monitored` no longer hides
   * them (useTruppActions · editTrupp · kindPatch). */
  const barShown = (r: Pick<TruppReading, 'kind' | 'bar' | 'measured'>) => monitored && readingBarShown(r)
  /**
   * What a reading row is CALLED — «Eingerückt», and on a Trupp without Atemschutz «Eingerückt –
   * ohne Atemschutz» (04.09., Feldtest Manuel: «Atemschutz beendet» and then a bare «Eingerückt»
   * left the reader unable to say what had gone in).
   *
   * ⚠️ The ENTRY row only, and by the Trupp's CURRENT Art. The same two decisions the Verlauf
   * line makes (copy · atemschutz.logEntryNoAs, readingNoAs): every row would be wallpaper, and a
   * Trupp whose Art was changed mid-run carries `paOn`/`paOff` rows right there in this list,
   * which say it more precisely than a re-labelled Eintritt could.
   */
  const readingLabel = (r: Pick<TruppReading, 'kind' | 'crew'>, idx: number) => {
    // a crew row IS its names — «Meier Anna / Frei Nina» says who the Trupp was from then on
    if (r.kind === 'crew' && r.crew) return [r.crew.name, ...r.crew.members].map((n) => n.trim()).filter(Boolean).join(' / ')
    // …and the close of a run that never went in is «Nicht eingesetzt», never an «Austritt» (N8)
    if (isStandDownExit(readings, idx)) return az.statusNotDeployed
    const what = az.readingKind[r.kind] ?? r.kind
    return !monitored && r.kind === 'entry' ? fillTemplate(az.readingNoAs, { what }) : what
  }
  // the folded timing rows: they were a tap ZONE on the clock itself, findable only by knowing
  // that five grey characters at the band's edge meant «tap me». They are now the head of the
  // Verlauf, behind a word — and the band went back to being a display, not a button.
  const timesShown = monitored && live.sinceContactSec != null
  const lastContactAt = live.sinceContactSec != null ? now - live.sinceContactSec * 1000 : null
  const hm = (ms: number) => fmtTime(new Date(ms).toISOString())
  /* The two conditional groups of the opened Verlauf's look-up panel, named here so the markup
   * below can ask ONE question per row and the panel itself can ask «is there anything at all».
   * ⚠️ `lowestShown` is deliberately narrow: the tiefster Druck is only a fact of its own once
   * the Trupp has come back UP (a fresh bottle after «Wieder in den Einsatz»). While it is still
   * descending, `lowestBar === currentBar` and the row would restate the number the card already
   * shows in 19px mono. */
  const lowestShown = monitored && live.lowestBar < live.currentBar
  const timingShown = timesShown && lastContactAt != null && !lite

  const menu = menuItems.length > 0 && (
    <Menu
      trigger={
        <button type="button" className={s.footMore} aria-label={az.cardMenu} title={az.cardMenu}>
          <Icon id="more" />
        </button>
      }
      popupClassName="rp-print-menu"
      itemClassName={() => 'rp-print-menu-item'}
      items={menuItems}
    />
  )
  /* ── The facts as CHIPS (26.09.2026 evening, phone card slim-down, ③; every board 29.09.2026) ──
   * The entries the tablet's grey Kennzeile sentence carried until 29.09.2026 («Meier Anna· Löschen·
   * 2. OG· Kanal 11», its Auftrag in blue), each a 36px chip with one 1px edge and no colour of
   * its own — a strip of things to TAP, where the sentence was a line to read: the crew → Trupp
   * sheet, «Löschen · Test» → Auftrag sheet, «Kanal 11» → Kanal sheet, «Ltg 1» → the drawn hose
   * (else the Auftrag sheet), the Ausrüstung → Trupp sheet (the ⋯ moved to the foot line on 29.09.2026). The one
   * thing allowed a colour is the GAP: a dashed amber «+ Auftrag» where the Auftrag is missing —
   * a Trupp with no job is a question the Überwacher must be able to see. No chip for a missing
   * Leitung (it lives in the Auftrag sheet), no small-caps labels, no «#N» (dropped 30.09.2026, see TruppNo).
   * `chip(key, node, onTap, cls)`: a button when it has somewhere to go, a plain chip otherwise
   * (a viewer's card, the lite board's jumps).
   * ⚠️ The crew chip wraps BETWEEN people (31.10.2026, owner: names are never cut): each name is
   * its own nowrap span and the « · » is the break (`.crewName`), so the chip grows in lines.
   * «Rückzug» is not a chip: it is the amber badge in the card head (RowLine · `rueckzug`), which
   * a viewer — who has no Rückzug tile — sees too. It also lowers the turn-back pressure
   * (alarmBarFor), so it is never colour alone. */
  const chip = (key: string, node: ReactNode, onTap?: () => void, cls?: string) => onTap
    ? <button key={key} type="button" className={cx(s.fact, cls)} onClick={onTap}>{node}</button>
    : <span key={key} className={cx(s.fact, cls)}>{node}</span>
  const facts = (
    <div className={s.facts}>
      {!!crewNames.length && chip('crew', <span className={s.crewTxt}>{crewNames.map((n, i) => (
        <Fragment key={i}>{i > 0 && ' · '}<span className={s.crewName}>{n}</span></Fragment>
      ))}</span>, onQuick && (() => onQuick('trupp')), s.factCrew)}
      {auftrag
        ? chip('auftrag', <span className={s.factTxt}>{auftrag}{t.ziel ? ` · ${t.ziel}` : ''}</span>, onQuick && (() => onQuick('auftrag')))
        : <>
            {chip('auftrag', az.auftragAdd, onQuick && (() => onQuick('auftrag')), s.factDash)}
            {t.ziel && chip('ziel', <span className={s.factTxt}>{t.ziel}</span>, onQuick && (() => onQuick('auftrag')))}
          </>}
      {dockedAt && chip('docked', <>{fillTemplate(az.dockedAt, { host: dockedAt })}{!lite && <Icon id="chevron" />}</>,
        lite ? undefined : () => onShowPlan(t.id), s.factGo)}
      {lineTag && chip('line', <>{fillTemplate(az.lineChip, { n: lineTag })}{hasLine && !lite && <Icon id="chevron" />}</>,
        hasLine && !lite ? () => onShowLine(t.id) : onQuick && (() => onQuick('auftrag')), hasLine && !lite ? s.factGo : undefined)}
      {t.funkkanal != null && chip('kanal', `${az.funkkanalUnit} ${t.funkkanal}`, onQuick && (() => onQuick('kanal')))}
      {equipmentTags.map(({ id, tag }) => chip(`eq-${id}`, tag, onQuick && (() => onQuick('trupp'))))}
    </div>
  )
  /* the card says in WORDS what its line and its Kontakt say in colour — one line under the tile
   * grid, red or amber with the tier (26.09.2026 — see `rowWord`) */
  const stateLine = rowWord && (rowWord.hidden
    ? <span className="sr-only" role="status">{rowWord.text}</span>
    : <div className={cx(s.stateLine, rowWord.tone)} role={monitored ? 'status' : undefined}>{rowWord.text}</div>)
  const noteZone = (
    <>
      {/* ── 4 Hinweis ─────────────────────────────────────────────────────────────────────────
          Usually empty, and then it costs nothing (`.noteZone:empty`). */}
      <div className={s.noteZone}>
        {/* «… drücken» names a button only a writer has (actZone below) */}
        {canEdit && monitored && preEntry && <div className={s.preHint}>{az.preEntryHint}</div>}
        {airNote && (
          <div className={s.airNote} role="status" aria-live="polite">
            <span>{airNote}</span>
          </div>
        )}
      </div>
    </>
  )
  /* ── The Atemschutznotfall's door (F1, 08.10.2026): ONE held tile, the full width — «Notfall» on
     a crew inside, «Notfall beendet» on a crew in one. Held, never tapped (AtemschutzNotfall ·
     NotfallHold): the loudest act on this board must not be a reflex away, and neither may
     silencing it. Never beside Kontakt: the thumb working the radio checks must not land on it —
     so on a card it stands UNDER Rückzug | Raus, and on the link board's page (its tiles at the
     foot, Druck | Kontakt lowest) it leads the group, two rows above the thumb's resting spot. */
  const nfRow = (onNotfall && monitored && notfallOffered(t)) || (onNotfallEnd && truppInNotfall(t)) ? (
    <div className={cx(s.actions, s.nfRow)}>
      {truppInNotfall(t) ? <NotfallHold end onFire={onNotfallEnd!} /> : <NotfallHold onFire={onNotfall!} />}
    </div>
  ) : null
  const actZone = (
    <>
      {/* ── 5 Aktionen: the lifecycle bar stays explicit — only these buttons commit a status ── */}
      <div className={s.actZone}>
        {page && nfRow}
        {canEdit && preEntry && (
          <div className={s.actions}>
            {/* ⚠️ IN THE ORDER THE EINSATZ RUNS (07.09., Feldtest Manuel — same rule as the
                in-field row below): «Im Einsatz» first, because deploying is what usually happens
                to a waiting Trupp, and the stand-down right — where «Raus melden» also lives, so
                the exit is always the right-hand column. «Im Einsatz» keeps its primary weight. */}
            <button className={cx(s.actBtn, s.actEnter)} onClick={() => onStatus(t.id, 'aktiv')}>
              <Icon id="flag" /><span>{az.actEnter}</span>
            </button>
          </div>
        )}
        {/* «Nicht eingesetzt» — VISIBLE, but never beside «Im Einsatz» (owner review 26.09.2026,
            after staging N8 had put it behind ⋮): two equal buttons side by side, one of which
            closes the Trupp in a tap, are a reflex away from the wrong one, and hidden behind ⋮
            nobody found it. So: its own row, a quiet secondary at the far edge, a full 44 px,
            and the tap answers with a confirm-with-undo toast («Trupp N: nicht eingesetzt ·
            Rückgängig»). The row it writes still says «nicht eingesetzt», never «Austritt». */}
        {canEdit && preEntry && monitored && (
          <div className={s.standDownRow}>
            <Button variant="quiet" icon={<Icon id="logout" />} onClick={() => onStandDown(t.id)}>
              {az.actNotDeployed}
            </Button>
          </div>
        )}
        {canEdit && inField && (
          <div className={s.actions}>
            {/* ⚠️ IN THE ORDER THE EINSATZ RUNS (04.09., Feldtest Manuel): Rückzug first, «Raus
                melden» after it — the crew is called back, then it comes out. It used to be the
                other way round, on the argument that the exit belongs in the quiet left column;
                but this row is read while both steps are still ahead, and a row that runs
                backwards is read backwards. Each button keeps its own weight and icon, so nothing
                about which is which changed. On a Trupp without Atemschutz «Raus melden» is still
                the only button, and then it takes the whole row.
                Rückzug is an Atemschutz manoeuvre — it lowers the turn-back pressure (alarmBarFor)
                and there is no pressure to lower on a Trupp without a cylinder. */}
            {/* ⚠️ These are the second row of the tile grid (26.09.2026 on the phone, every board
                since 29.09.2026 — T11): the same 48px tiles as «⌓ 240 bar | Kontakt» above them,
                the verb alone («Rückzug», «Raus» — `tileRueckzug`/`tileExit`; the long form stays
                the spoken name), both framed grey, and colour only by state — Rückzug amber-tinted
                while the Trupp is at or under its Alarmdruck (`actAlarm`), nothing else tinted.
                The tablet's always-amber «Rückzug melden» beside a ghost «Raus melden» said
                «warning» about a Trupp at 300 bar. */}
            {monitored && (t.status === 'aktiv' ? (
              <button className={cx(s.actBtn, s.actRueckzug, pressureLow && s.actAlarm)} aria-label={az.actRueckzug}
                onClick={() => onStatus(t.id, 'rueckzug')}>
                <Icon id="undo" /><span>{az.tileRueckzug}</span>
              </button>
            ) : (
              <button className={cx(s.actBtn, s.actContinue)} onClick={() => onStatus(t.id, 'aktiv')}>
                <Icon id="redo" /><span>{az.actContinue}</span>
              </button>
            ))}
            <button className={cx(s.actBtn, s.actExit)} aria-label={monitored ? words.exit : undefined} onClick={askExit}>
              <Icon id="logout" /><span>{monitored ? az.tileExit : words.exit}</span>
            </button>
          </div>
        )}
        {!page && nfRow}
        {/* No exit timestamp line here: the exit event is in the per-Trupp Verlauf and on the
            Rapport, and what the Überwacher needs NOW is the running break clock in the band. */}
        {status === 'raus' && canEdit && (
          <div className={s.actions}>
            <button className={cx(s.actBtn, s.actReenter)} onClick={onReenter}>
              {/* a crew that was never in goes «In den Einsatz», not «wieder» (N8) */}
              <Icon id="flag" /><span>{neverDeployed ? az.actEnterFirst : az.actReenter}</span>
            </button>
          </div>
        )}
      </div>
    </>
  )
  const footZone = (
    <>
      {/* ── 6 + 7 Sockel und Verlauf, EIN Block (09.09., Maintainer-Entscheid) ────────────────
          The Sockel used to be a standing stack of look-up rows between the actions and the
          Verlauf — «Einsatzzeit», «Geschätzter Druck» with its provenance line under it,
          «Druck», «Tiefster» — ~70px that were permanently on screen on a card that does not
          fit a 375×667 phone. It is the quiet end of the card by its own description: things
          one LOOKS UP, not things one reads while a Trupp is inside.
          So it folds into the expander that was already sitting under it, and what stays out is
          one compact line:
            · the Einsatzzeit, because it is the second clock of this card;
            · the geschätzter Druck, because it is safety-adjacent and must never be a tap away
              (mock 02 kept it as a chip for exactly this reason — here it keeps its own words);
            · the aktueller Druck, but ONLY where nothing else on the card shows it (a viewer, or
              a Trupp that is out) — where the ± block above is live, the number is already there
              in 19px mono and saying it twice on one card is what this pass exists to stop.
          Behind the tap: the Schätzung's provenance («aus 2 Druckwerten · Stand 18:03»), the
          tiefster Druck, and the timing rows that were already there.
          ⚠️ The break clock stays OUT of the fold: it is a ticking number, and the one record it
          appears for (exitTime set while the status is not `raus`, legacy data) is exactly the
          case the band does not cover. A running clock behind a chevron is not a readout.
          ⚠️ The line WRAPS rather than ellipsizing. Three items only meet on a read-only card,
          and a cut «≈ 20…» is a wrong number where a second line is merely a second line. */}
      <div className={s.vfoot}>
        {/* ⚠️ The Sockel line and the Verlauf head are ONE line (26.09.2026 on the phone, every board
            since 29.09.2026 — T2): «8:18 min · Schätzung ≈ 241 bar ⌄» — the values with their
            units, no «Einsatzzeit» / «Verlauf» words, no «zuletzt: 11:52 Druck 300 bar» preview (its
            content is the Verlauf's first row anyway, and its bar was the pressure tile's number a
            second time), and the whole line is the tap that opens the Verlauf. A viewer's Druck
            and «Draussen seit» join in the same terse form. With nothing to say (a Trupp at the
            door) the line says «Verlauf», so the tap still has a word.
            ⚠️ The Schätzung KEEPS its word and full ink (owner, 29.09.2026: «we still need the
            schätzung clearly visible»): it is the one number on the card that is not a reading,
            and «≈ 0 bar» dimmed at the card's foot was easy to read past. The word is what keeps
            it from being taken for a logged Druck — the dimming that used to do that is gone. */}
        {/* ⚠️ The ⋯ ends THIS line (29.09.2026, owner pick B): as the facts' last chip it wrapped
            onto a row of its own on most cards, 44px of height for one glyph. Beside the Verlauf's
            ⌄ it costs nothing, stands at the same place on every card and every board, and the
            FAB guard (`data-az-foot` on the row, AtemschutzView · the parking effect) keeps both
            clear of the Eintrag button. */}
        <div className={s.vfootRow} data-az-foot="">
        <button type="button" className={cx(s.vrow, s.vrowTerse)} aria-expanded={logOpen} aria-label={az.verlauf}
          onClick={() => setLogOpen((o) => !o)}>
          <span className={s.metaLine}>
            {sockelLine.length > 0 ? sockelLine.map((it) => (
              <span key={it.key} title={it.title}>
                {it.labelled && <i>{it.label}</i>}
                {/* the Einsatzzeit / «Draussen seit» past a day in the head's compact «3d 10h» — one card, one spelling */}
                <b className={cx(it.alarm && s.metaAlarm)}><ClockVal val={it.value} /></b>
              </span>
            )) : <span><i>{az.verlauf}</i></span>}
          </span>
          <Icon id="chevron-down" className={cx('chev', s.logChev)} />
        </button>
        {menu}
        </div>
            {logOpen && (
              <div className={s.vopen}>
                {/* ── ONE panel of look-up rows, then the list (09.09., maintainer review) ────
                    It was two panels and a floating footnote, and it said the Schätzung twice
                    within 80px: «≈ 31 bar» on the line above and «Geschätzter Druck ≈ 31 bar»
                    here. A number stated twice at the same moment is a number somebody will one
                    day read as two.
                    So the value is said ONCE — up on `.metaLine`, where it also survives the
                    collapse — and this panel carries only what the line cannot: where the
                    Schätzung comes FROM, how deep the Trupp has already been, and (on the FU
                    tablet) the contact timing. The provenance is that row's own value, sitting
                    against the label it explains instead of floating under both.
                    ⚠️ «Tiefster» is conditional and stays that way: `lowestBar < currentBar` is
                    only true once a Trupp has come back UP — a fresh bottle after «Wieder in den
                    Einsatz». On a normal descent the tiefster Druck IS the current one, and a
                    row restating it would be the very duplication this rework removes.
                    ⚠️ The timing rows keep their `!lite` gate (08.09., field ask): the phone at
                    the Eingang works off the ticking clock on the card. */}
                {(estimate || lowestShown || timingShown) && (
                  <div className={s.zonePanel}>
                    {estimate && (
                      <div className={s.zonePanelRow}>
                        <span>{az.estimatedShort}</span>
                        <em className={s.zoneNote} title={estimate.source === 'history'
                          ? az.estimatedHintHistory
                          : fillTemplate(az.estimatedHint, { liters: dz.cylinderLiters, rate: dz.estConsumptionLPerMin })}>
                          {estimate.source === 'history'
                            ? fillTemplate(az.estimatedSourceHistory, { count: estimate.sampleCount, time: fmtTime(estimate.basedAt) })
                            : fillTemplate(az.estimatedSourceFallback, { rate: dz.estConsumptionLPerMin, time: fmtTime(estimate.basedAt) })}
                        </em>
                      </div>
                    )}
                    {lowestShown && (
                      <div className={s.zonePanelRow}>
                        <span>{az.lowestPressure}</span><b>{live.lowestBar} bar</b>
                      </div>
                    )}
                    {timingShown && (
                      <>
                        <div className={s.zonePanelRow}><span>{az.lastContactAt}</span><b>{hm(lastContactAt!)}</b></div>
                        <div className={s.zonePanelRow}><span>{az.nextContactDue}</span><b>{hm(lastContactAt! + intervalMin * 60_000)}</b></div>
                        <div className={s.zonePanelRow}><span>{az.contactIntervalLabel}</span><b>{fillTemplate(az.contactIntervalValue, { min: intervalMin })}</b></div>
                      </>
                    )}
                  </div>
                )}
                {readings.length > 0 && (() => {
                  // ⚠️ The log spans EVERY deployment since 18.08. («Wieder einrücken» appends
                  // rather than starting a new one, so the first bottle still prints on the
                  // Rapport). The card's own numbers, though, are about the crew that is inside
                  // NOW — Eingangsdruck, tiefster Druck. Without a boundary the two contradict
                  // each other: «tiefster Druck 300» over a row reading 120. Everything before
                  // the current run is dimmed and gets a line.
                  const from = currentRunStart(readings)
                  return (
                    <>
                      {/* ⚠️ No «ABLESUNGEN» head since 09.09. (field review). The list is the
                          only list this fold contains and every row of it carries a time and a
                          bar — it names itself. What the head really did was draw the rule
                          between the look-up panel and the readings, so `.logList` draws that
                          rule now and the section keeps its seam without its title. */}
                      <ul className={s.logList}>
                        {[...readings].reverse().map((r, i) => {
                          const idx = readings.length - 1 - i
                          return (
                            <li key={idx} className={cx(s.logRow, idx < from && s.logRowPast, idx === from && from > 0 && s.logRowRunStart)}>
                              <span className={s.logTime}>{fmtTime(r.t)}</span>
                              {/* …and the same on the board: a Kontakt shows no bar, because the
                                  one it carries is the last reported value, not a fresh reading —
                                  and a Trupp without Atemschutz shows none at all (barShown) */}
                              <span className={s.logBar}>{barShown(r) ? `${r.bar} bar` : ''}</span>
                              <span className={s.logKind}>{readingLabel(r, idx)}</span>
                            </li>
                          )
                        })}
                      </ul>
                    </>
                  )
                })()}
              </div>
            )}
      </div>
    </>
  )

  /* ── The card IS the phone's row, grown downwards (26.09.2026, owner on staging) ─────────────────
   * «Keep the same UI whether the card is collapsed or not.» The card used to swap the row's line
   * and its «Druck | Kontakt» pair for a head, a band with the clock again in 40px, a full-width
   * Kontakt and a Druck row — the same two buttons in a second shape, one tap after the first.
   * Now the card IS the row, grown downwards: the same frame and tone, the same line (RowLine),
   * the same pair (TruppPair), at the same place; opening only adds what stands below.
   * On the phone board the line itself is the collapse control, as the row was the open control,
   * so the chevron stays in the pixel the thumb just pressed; on the tablet grid and the handed-
   * over Tafel nothing collapses (every card stands open) and the line is just the line.
   * ⚠️ ORDER since the slim-down (26.09.2026 evening, owner: «unit, verb, value»): the line, then
   * ONE 2×2 tile grid — the pair on top, Rückzug / Raus under it (`actZone`, styled as the same
   * tiles here) — then the state in words where there is one, the note, the facts with the ⋯,
   * and the one-line foot. The actions stand ABOVE the facts: what a thumb does on this card is
   * the four tiles, and they stand together under the clock.
   * ⚠️ ONE drawing on every board since 29.09.2026 — see the zone list above TruppCard.
   * ⚠️ …except the ORDER on the link board's page (`page`; owner pick «A – Tasten nach unten»,
   * 31.10.2026: «read at the top, tap at the bottom»): the head, the state words, the note, the
   * facts and the foot stand on top, and the SAME tiles at the page's foot, over the tab rail —
   * Notfall first, then Rückzug | Raus (or whatever the state puts there), then «Druck | Kontakt»
   * lowest, where the thumb rests. In the DOM, not by CSS `order`, so the tab order is the visual
   * one. `.pageActs` (Atemschutz.module.css) pushes the group down with `margin-top: auto`. */
  const pair = monitored && canEdit && inField && (
    <TruppPair t={t} live={live} sev={sev} onPressure={(id) => onAskPressure?.(id)} onContact={onContact} />
  )
  // a page has room to say the waiting state as a word where the row puts its «Im Einsatz»
  const pageAct = page ? <span className={s.pageReady}>{az.phoneSectionReady}</span> : undefined
  const head = pageHead ?? (rowMode ? (
    <button type="button" className={s.trowHead} aria-expanded="true" onClick={onCollapse}
      aria-label={`${t.name} — ${az.collapse}`}>
      <RowLine t={t} live={live} color={lite ? undefined : color} lite={lite} />
      <span className={s.trowChevron}><Icon id="chevron-down" className="chev" /></span>
    </button>
  ) : (
    <div className={cx(s.trowHead, s.trowHeadStatic)}>
      <RowLine t={t} live={live} color={lite ? undefined : color} lite={lite} act={pageAct} />
    </div>
  ))
  return (
    <div ref={cardRef} data-az-open={rowMode ? '' : undefined} className={cx(s.trow, s.trowCard, rowTone(t, status, sev), conflict && s.cardConflict)}>
      {head}
      {page ? (
        <>
          {/* the page head says the Notfall in words already («Notfall seit 12:12») */}
          {!pageHead && stateLine}
          {noteZone}
          {facts}
          {footZone}
          <div className={s.pageActs}>{actZone}{pair}</div>
        </>
      ) : (
        <>
          {pair}
          {actZone}
          {stateLine}
          {noteZone}
          {facts}
          {footZone}
        </>
      )}
    </div>
  )
}
