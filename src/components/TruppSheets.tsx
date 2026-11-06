/*
 * *The four mini sheets are one sheet* (29.09.2026): Druck · Kanal · Auftrag · Mannschaft are
 * `TruppSheets · MiniSheet` — a bottom sheet with the grab bar and the swipe on a phone, a
 * centred card on a tablet — with ONE head: the title is the QUESTION («Druck», «Restdruck» at
 * «Raus melden», «Kanal», «Auftrag», «Mannschaft»), the line under it is whose
 * (`truppSheetSub`: «Keller Laura · Trupp 3»). A field label that repeats the title goes. The
 * hint under a pad/grid says what a tap does and never repeats a value the grid already marks
 * (no «Zuletzt 240 bar» beside the ringed 240). A new per-Trupp quick sheet uses `MiniSheet`.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon } from '../lib/icons'
import { appConfig } from '../config/appConfig'
import { fillTemplate, stripUnprintable } from '../lib/format'
import { cx } from '../lib/cx'
import { Overlay, SheetFoot, SheetGrab } from '../lib/overlays'
import { atemschutzDoctrine } from '../lib/deploymentConfig'
import { abbreviateName, personIdForName, rosterFromList, rosterIdByName, truppSlots } from '../lib/personnel'
import { atemschutzEquipment } from '../lib/deploymentConfig'
import type { TruppTransferState } from '../lib/atemschutz'
import { auftragSheetFields, fileGuestSlots, kanalPad, kanalSheetFields, leitungChoices, quickAuftragTypes, teamConflict, truppSheetFields, truppSheetSub, type CrewSlot } from '../lib/truppQuickEdit'
import type { LeitungOption } from '../lib/truppLines'
import type { Person, Trupp, TruppAuftrag, TruppFields } from '../types'
import { Segmented } from './Segmented'
import { Button } from './Button'
import { Chip } from './Chip'
import { ClearableInput } from './ClearableInput'
import { Stepper } from './Stepper'
import { useHoldRepeat } from '../lib/useHoldRepeat'
import { useTapToType } from '../lib/useTapToType'
import { pointAtField } from '../lib/pointAtField'
import { TruppTeam } from './TruppTeam'
import s from './Atemschutz.module.css'

/**
 * The phone card's mini sheets (26.09.2026, phone card slim-down — docs/planning/az-card-2026-09-26,
 * Runde 3): ONE short sheet per fact the card shows as a chip. «The card is for reading, a sheet is
 * a form»: the labels the card dropped come back in here, small and grey, one word each, and the
 * Trupp's name stands under the title so it is always clear whose sheet is open over the dimmed
 * board.
 *
 * The frame is the `.modal` head with the ✕, grown a grab bar and the push-down-to-close gesture,
 * because on a phone these ARE bottom sheets (lib/overlays · Overlay, `.miniSheet` in
 * Atemschutz.module.css); on a tablet the same frame is a centred card. The pressure picker was
 * the one sheet built otherwise (a centred card at every width) and joined them on 29.09.2026. ✕, backdrop and the swipe are «not now»: a mini sheet holds one to three
 * answers, and re-typing a Ziel costs less than a draft store for it would (the big form keeps
 * drafts — TruppForm · draftKeep — because it holds a whole crew).
 *
 * Every save goes through the ONE write path (useTruppActions · editTrupp), handed the Trupp as it
 * stands now with only this sheet's fields changed (lib/truppQuickEdit): same Verlauf row, same
 * undo step, same Rapport as the big form's save.
 */

function MiniSheet({ title, sub, ariaLabel, onClose, children, footer, className }: {
  title: ReactNode; sub?: string; ariaLabel: string; onClose: () => void; children: ReactNode; footer?: ReactNode; className?: string
}) {
  const az = appConfig.copy.atemschutz
  return (
    <Overlay open onClose={onClose} className={cx(s.modal, s.miniSheet, className)} ariaLabel={ariaLabel}>
      <SheetGrab />
      <div className={s.modalHead}>
        <h3>{title}{sub && <small className={s.miniSub}>{sub}</small>}</h3>
        <button type="button" className="ip-x" aria-label={az.cancel} onClick={onClose}><Icon id="close" /></button>
      </div>
      <div className={s.miniBody}>{children}</div>
      {footer}
    </Overlay>
  )
}

/**
 * The ONE pressure picker (24.09.2026, Übung 23.09.): three columns — 300…220, 200…120, 100…20 —
 * in steps of 20, and a tap SAVES. Used for a Druckmeldung from the phone (row and card) and for
 * the Restdruck at «Raus melden» on every width.
 *
 * ⚠️ Why a grid and not the ± stepper the card has: a Druckmeldung arrives over the radio as one
 * number while the other hand holds the handset. A stepper is five to ten taps and a «Bestätigen»;
 * this is one. 20-bar steps because nobody reads a gauge closer than that under a mask («nobody
 * counts that exact», maintainer, 24.09.) — so there is deliberately no «genau…» way out.
 * The column a value sits in is its meaning at a glance: full · half · at or below the line (red).
 * The last known value is outlined, so the eye starts where the Trupp was — which is why the hint
 * no longer says «Zuletzt 240 bar» too (29.09.2026).
 * A MiniSheet since 29.09.2026 (sweep 3 T5): it was a centred card with no grab bar, the one
 * sheet of the four built differently; now it rises from the bottom on a phone like Kanal,
 * Auftrag and Trupp, with the same head, and is the same centred card as they are on a tablet.
 */
const PRESSURE_GRID: number[][] = [[300, 280, 260, 240, 220], [200, 180, 160, 140, 120], [100, 80, 60, 40, 20]]

export function PressureSheet({ t, sub, title, hint, last, alarmBar, chosen = false, onPick, onClose, footer }: {
  /** whose reading — the head's second line (truppSheetSub) */
  t?: Trupp
  /** …or that line as given, where no Trupp exists yet (the Trupp form's own door, below) */
  sub?: string
  /** the question: «Druck», «Restdruck» at «Raus melden», the form's «Eingangsdruck» */
  title: string
  hint?: string
  /** the Trupp's current bar — its nearest grid value is outlined */
  last: number
  /** this Trupp's turn-back line (lib/atemschutz · alarmBarFor) — values at or below it are red */
  alarmBar: number
  /** `last` is the form's ANSWER, not a reading — PressureGrid · chosen */
  chosen?: boolean
  onPick: (bar: number) => void
  onClose: () => void
  /** a second way out that is not a number (the exit's «Ohne Druck raus») */
  footer?: { label: string; onClick: () => void }
}) {
  const who = t ? truppSheetSub(t) : sub
  return (
    <MiniSheet title={title} sub={who} ariaLabel={t ? `${title} · ${t.name}` : title} onClose={onClose}
      footer={footer && <SheetFoot className={s.modalFoot}><Button block onClick={footer.onClick}>{footer.label}</Button></SheetFoot>}>
      <PressureGrid value={last} alarmBar={alarmBar} onPick={onPick} chosen={chosen} ariaLabel={title} />
      {/* under the grid, like the Kanal pad's hint: what a tap does */}
      {hint && <p className={s.miniHint}>{hint}</p>}
    </MiniSheet>
  )
}

/**
 * The grid itself. Two ways to mark `value`: for a Druckmeldung it is the LAST reading — outlined, and
 * a tap saves a new one; opened from the Trupp form (`chosen`, 30.09.2026) it is the ANSWER — the one
 * picked cell wears the choice fill (`--sel`), and a tap only fills the form's draft. A value the grid
 * does not hold (a 290 recorded before 30.09.) is outlined at its step below, like a last reading,
 * and nothing is filled until a cell is tapped.
 */
function PressureGrid({ value, alarmBar, onPick, chosen = false, ariaLabel }: {
  value: number
  /** values at or below it are red (lib/atemschutz · alarmBarFor) */
  alarmBar: number
  onPick: (bar: number) => void
  /** the form's answer, not the last reading — see above */
  chosen?: boolean
  ariaLabel?: string
}) {
  const picked = chosen && PRESSURE_GRID.some((col) => col.includes(value)) ? value : null
  // DOWN to the grid, never up: a Trupp last read at 250 has not got 260 (clamped to the grid's ends)
  const near = picked == null ? Math.min(300, Math.max(20, Math.floor(value / 20) * 20)) : null
  return (
    <div className={s.pressureGrid} role="group" aria-label={ariaLabel}>
      {PRESSURE_GRID.map((col, i) => (
        <div key={i} className={s.pressureCol}>
          {col.map((bar) => (
            <button key={bar} type="button" aria-pressed={chosen ? bar === picked : undefined}
              className={cx(s.pressureCell, bar <= alarmBar && s.pressureCellLow, bar === near && s.pressureCellLast, bar === picked && s.pressureCellOn)}
              onClick={() => onPick(bar)}>
              {bar}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * «Kanal» — a pad of the station's channel range, the current one marked; ONE tap picks, writes
 * and closes (the hint under the pad says so, because the sheet has no Speichern). A range too
 * wide for a pad (lib/truppQuickEdit · KANAL_PAD_MAX) gets the ± stepper and a Speichern.
 */
export function KanalSheet({ t, onSave, onClose }: {
  t: Trupp
  /** the one write (AtemschutzView · saveQuick → editTrupp); resolves once written */
  onSave: (f: TruppFields) => Promise<boolean> | boolean
  onClose: () => void
}) {
  const pick = async (n: number) => n === t.funkkanal || await onSave(kanalSheetFields(t, n))
  return <KanalPickSheet value={t.funkkanal ?? atemschutzDoctrine().defaultFunkkanal} sub={truppSheetSub(t)} name={t.name}
    onPick={pick} onClose={onClose} />
}

/**
 * The Kanal sheet itself, for both of its doors (30.09.2026): the card's «Kanal 11» writes through
 * `KanalSheet` above; the Trupp form's «Funkkanal 11 ›» only fills its draft (`takeLabel`
 * «Übernehmen» on the stepper's foot, where a pad key cannot say it). `onPick` resolves false when
 * nothing was taken — the sheet then stays open.
 */
export function KanalPickSheet({ value, sub, name, takeLabel, onPick, onClose }: {
  value: number
  /** whose — the head's second line */
  sub?: string
  /** the Trupp's name for the sheet's accessible name */
  name?: string
  /** the stepper's foot button (default «Speichern») */
  takeLabel?: string
  onPick: (n: number) => Promise<boolean> | boolean
  onClose: () => void
}) {
  const az = appConfig.copy.atemschutz
  const dz = atemschutzDoctrine()
  const pad = kanalPad(dz.funkkanalMin, dz.funkkanalMax)
  const [typed, setTyped] = useState<number>(value)
  const pick = async (n: number) => { if (await onPick(n)) onClose() }
  return (
    <MiniSheet title={az.funkkanalUnit} sub={sub} ariaLabel={name ? `${az.funkkanalUnit} · ${name}` : az.funkkanalUnit} onClose={onClose} className={pad ? s.miniSheetPad : undefined}
      footer={pad ? undefined : (
        <SheetFoot className={s.modalFoot}>
          <button type="button" className={cx('ip-btn', s.footCancel)} onClick={onClose}>{az.cancel}</button>
          <button type="button" className="ip-btn primary" onClick={() => void pick(typed)}>{takeLabel ?? az.save}</button>
        </SheetFoot>
      )}>
      {pad ? (
        <>
          <KanalPicker value={value} onPick={(n) => void pick(n)} />
          <p className={s.miniHint}>{az.kanalSheetHint}</p>
        </>
      ) : (
        <div className={s.field}>
          <span>{az.editFieldLabels.funkkanal}</span>
          <KanalPicker value={typed} onPick={setTyped} />
        </div>
      )}
    </MiniSheet>
  )
}

/**
 * The Kanal control of the Kanal sheet: the station's channels as keys, the chosen one filled, while
 * the range fits a pad (lib/truppQuickEdit · kanalPad); above that the ± stepper, hold to repeat and
 * tap the value to type (a 1–9999 scheme is not stepped one by one — 30.09.2026, it was a bare
 * «− value +»). The pad opens ON the current channel.
 */
function KanalPicker({ value, onPick }: { value: number; onPick: (n: number) => void }) {
  const az = appConfig.copy.atemschutz
  const dz = atemschutzDoctrine()
  const pad = kanalPad(dz.funkkanalMin, dz.funkkanalMax)
  const onRef = useRef<HTMLButtonElement>(null)
  // a long pad opens ON the current channel, not at 1 (once, at mount: never under the finger)
  useEffect(() => { onRef.current?.scrollIntoView?.({ block: 'center' }) }, [])
  if (!pad) return <FunkkanalStepper value={value} onChange={onPick} />
  return (
    <div className={s.pad} role="group" aria-label={az.funkkanalUnit}>
      {pad.map((n) => (
        <button key={n} ref={n === value ? onRef : undefined} type="button" aria-pressed={n === value}
          className={cx(s.padKey, n === value && s.padKeyOn)} onClick={() => onPick(n)}>{n}</button>
      ))}
    </div>
  )
}

// The Funkkanal ± stepper — the Kanal control where the station's range is too wide for a pad:
// hold to repeat, tap the value to type an exact channel. Clamped to the configured range.
// (It was the Trupp form's own inline control; since 30.09.2026 it lives in the Kanal sheet only.)
function FunkkanalStepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const az = appConfig.copy.atemschutz
  const dz = atemschutzDoctrine()
  const clamp = (v: number) => Math.max(dz.funkkanalMin, Math.min(dz.funkkanalMax, v))
  const dec = useHoldRepeat(() => onChange(clamp(value - 1)))
  const inc = useHoldRepeat(() => onChange(clamp(value + 1)))
  const edit = useTapToType({ min: dz.funkkanalMin, max: dz.funkkanalMax, onCommit: onChange })
  return (
    <div className={cx(s.stepper, s.stepperSmall)}>
      <button type="button" className={s.stepBtn} aria-label={az.funkkanalDown} {...dec}><Icon id="minus" /></button>
      {edit.editing ? (
        <div className={s.stepVal}><input className={s.stepInput} {...edit.inputProps} /><span>{az.funkkanalUnit}</span></div>
      ) : (
        <button type="button" className={s.stepVal} onClick={() => edit.start(value)} title={appConfig.copy.stepper.typeToEnter}><b>{value}</b><span>{az.funkkanalUnit}</span></button>
      )}
      <button type="button" className={s.stepBtn} aria-label={az.funkkanalUp} {...inc}><Icon id="plus" /></button>
    </div>
  )
}

/**
 * «Auftrag» — the six tiles of the Trupp's Art (the sheet's title is their label), «Ziel» over a
 * clearable text field, «Leitung» over «keine · Ltg 1 · … · Nr. …»
 * from the hoses actually drawn, and one Speichern. The one-Leitung-one-Trupp question is the
 * board's (AtemschutzView · confirmLineTake, the same helper the form's save goes through), so
 * `onSave` resolves false when the operator said no and the sheet simply stays open.
 */
export function AuftragSheet({ t, leitungOptions, lite = false, onSave, onClose }: {
  t: Trupp
  /** the Leitungen drawn on either surface (lib/truppLines · leitungOptions) */
  leitungOptions: readonly LeitungOption[]
  /** the handed-over Tafel has no picture to read a hose number off — no Leitung row (as the form) */
  lite?: boolean
  onSave: (f: TruppFields) => Promise<boolean> | boolean
  onClose: () => void
}) {
  const az = appConfig.copy.atemschutz
  const [auftrag, setAuftrag] = useState<TruppAuftrag | null | undefined>(t.auftrag)
  const [ziel, setZiel] = useState(t.ziel ?? '')
  const [lineNo, setLineNo] = useState<number | null>(t.lineNo ?? null)
  const types = quickAuftragTypes(t)
  const save = async () => {
    if (await onSave(auftragSheetFields(t, { auftrag, ziel, lineNo }))) onClose()
  }
  return (
    <MiniSheet title={az.editFieldLabels.auftrag} sub={truppSheetSub(t)} ariaLabel={`${az.editFieldLabels.auftrag} · ${t.name}`} onClose={onClose}
      footer={(
        <SheetFoot className={s.modalFoot}>
          {/* the one footer: [danger] · Abbrechen · primary (docs/ui-conventions · editor sheets) */}
          <button type="button" className={cx('ip-btn', s.footCancel)} onClick={onClose}>{az.cancel}</button>
          <button type="button" className="ip-btn primary" onClick={() => void save()}>{az.save}</button>
        </SheetFoot>
      )}>
      {/* the same control as the form's «Art» — three tiles a row inside `.field` */}
      <div className={s.field}>
        <Segmented ariaLabel={az.editFieldLabels.auftrag} value={auftrag ?? undefined} onChange={(v) => setAuftrag(v)}
          options={types.map((a) => ({ value: a.id, label: a.label }))} />
      </div>
      <label className={s.field}>
        <span>{az.editFieldLabels.ziel}</span>
        <ClearableInput value={ziel} placeholder={az.zielPlaceholder} maxLength={60} clearLabel={az.zielClear}
          onChange={(v) => setZiel(stripUnprintable(v))} />
      </label>
      {!lite && <LeitungField label={az.editFieldLabels.lineNo} value={lineNo} options={leitungOptions} onChange={setLineNo} />}
    </MiniSheet>
  )
}

/**
 * «keine · Ltg 1 · Ltg 2 · Müller H.» — the Leitung as chips from what is actually DRAWN, the
 * selected one filled. ONE component for the Auftrag sheet and the big form (27.09.2026, slim
 * sweep item 6: the form had a «Leitung Nr.» stepper with a «Gezeichnet:» line under it), so the
 * two never disagree about what a Leitung looks like. A number another Trupp is on stays pickable
 * (corrections happen) but wears the dashed edge and says whose it is; the one-Leitung-one-Trupp
 * question is asked at the save (AtemschutzView · confirmLineTake). `children` is the form's
 * trailing «Nr. …» chip — a number nobody has drawn yet.
 */
export function LeitungChips({ value, options, onChange, ariaLabel, children }: {
  value: number | null
  /** lowest number first, the current value among them (lib/truppQuickEdit · leitungChoices) */
  options: readonly LeitungOption[]
  onChange: (n: number | null) => void
  ariaLabel?: string
  children?: ReactNode
}) {
  const az = appConfig.copy.atemschutz
  return (
    <div className={s.miniChips} role="group" aria-label={ariaLabel ?? az.editFieldLabels.lineNo}>
      <Chip selected={value == null} onClick={() => onChange(null)}>{az.lineNone}</Chip>
      {options.map((o) => (
        <Chip key={o.no} selected={value === o.no}
          className={cx(!!o.takenBy && value !== o.no && s.miniChipTaken)}
          title={o.takenBy ? fillTemplate(az.lineOptTaken, { name: o.takenBy }) : undefined}
          onClick={() => onChange(o.no)}>
          {fillTemplate(az.lineChip, { n: o.no })}{o.onPlan ? ' · P' : ''}{o.takenBy ? ` · ${abbreviateName(o.takenBy)}` : ''}
        </Chip>
      ))}
      {children}
    </div>
  )
}

/**
 * «Leitung»: the chips from what is drawn, and «Nr. …» for a number nobody has drawn yet — the
 * hose may be laid before anybody draws it. ONE field for the form and the Auftrag sheet
 * (29.09.2026, sweep 3 T12: the sheet had no «Nr. …», so a Leitung set in one door could not be
 * set in the other). «Nr. …» is a door, not a value: it opens the stepper IN ITS PLACE at the end
 * of the chip row (a filled «Nr. …» beside a filled «keine» read as two answers), and the number
 * typed lives in the stepper only – it used to stand as a chip too, ABOVE the stepper on the next
 * line, so the value and the control that set it were split across two lines (owner, 28.10.2026).
 * Open by itself while the value IS such a number (a kept draft, an edit), so the stepper never
 * hides the number it holds; a tap on a drawn chip or «keine» closes it again. `children` goes
 * under it (the form's legacy note).
 */
export function LeitungField({ label, value, options, onChange, children }: {
  label: string
  value: number | null
  /** the Leitungen drawn on either surface (lib/truppLines · leitungOptions) */
  options: readonly LeitungOption[]
  onChange: (n: number | null) => void
  children?: ReactNode
}) {
  const az = appConfig.copy.atemschutz
  const [typing, setTyping] = useState(() => value != null && !options.some((o) => o.no === value))
  // while typing, the stepper holds the typed number – no chip for it as well
  const choices = useMemo(() => leitungChoices(typing ? null : value, options), [typing, value, options])
  return (
    <div className={s.field}>
      <span>{label}</span>
      <LeitungChips value={value} options={choices} ariaLabel={label}
        onChange={(n) => { setTyping(false); onChange(n) }}>
        {typing ? (
          // compact (owner, 28.10.2026: one line on a 390px phone beside a drawn chip): no ✕ – the
          // «keine» chip at the head of this row IS the reset, and closes the stepper too. Too
          // many drawn chips and it wraps, but as ONE item (.miniChips), never apart.
          <Stepper
            value={value} min={1} max={99} placeholder="–"
            onChange={onChange}
            ariaLabel={az.lineTyped}
          />
        ) : (
          <Chip onClick={() => setTyping(true)}>{az.lineTyped}</Chip>
        )}
      </LeitungChips>
      {children}
    </div>
  )
}

/**
 * The sentence under a crew that names a person who is in another Trupp — and, where that Trupp
 * has not gone in, the one tap that takes them out of it (lib/truppQuickEdit · teamConflict). ONE
 * row for the big form and the Trupp sheet (26.09.2026): the form used to draw it inline. Two
 * buttons inside one warn field, never a button inside a button: the sentence points at the crew
 * (`onPoint`), the action moves the person.
 */
export function TeamConflictRow({ conflict, toName, onPoint, onTransfer, className }: {
  conflict: NonNullable<ReturnType<typeof teamConflict>>
  /** the Gruppenführer this crew is forming — the other Trupp's Verlauf row says where they went */
  toName: string
  onPoint?: () => void
  onTransfer?: (personId: string, toName: string) => void
  className?: string
}) {
  const az = appConfig.copy.atemschutz
  return (
    <div className={cx('form-warn', s.formWarn, className)}>
      <Icon id="warn" />
      <button type="button" className={cx('form-warn-text', s.formWarnText)} onClick={onPoint}>
        {fillTemplate(conflict.state === 'deployed' ? az.assignedConflictDeployed : az.assignedConflict, { name: conflict.name })}
      </button>
      {conflict.state === 'ready' && onTransfer && (
        <button type="button" className="form-warn-act" onClick={() => onTransfer(conflict.personId, toName)}>
          {az.assignedTransfer}
        </button>
      )}
    </div>
  )
}

/**
 * «Mannschaft» (the sheet's title since 29.09.2026; it was «Trupp 2») — the form's own crew picker (TruppTeam: chips with ✕, «Person
 * suchen …», the Gruppenführer hint), «Ausrüstung» over the station's toggles, one Speichern. The
 * same record, the same helpers as the form (lib/truppQuickEdit · crewFields / fileGuestSlots /
 * teamConflict); the Gäste typed here reach the Anwesenheit at the save, as the form's do. Only an
 * Atemschutz-Trupp is asked its Ausrüstung — a work squad takes no Retthaube in.
 */
export function TruppSheet({ t, personnel, legacyRoster, presentIds, stationIds, assignedIds, rolesById, transferState, onTransfer, onAddGuest, onSave, onClose }: {
  t: Trupp
  personnel: Person[]
  legacyRoster: string[]
  presentIds: Set<string>
  stationIds: Set<string>
  /** who is in another ACTIVE Trupp — the picker greys them, the save is held while one is in the crew */
  assignedIds: Set<string>
  rolesById: Map<string, string>
  transferState?: (personId: string) => TruppTransferState
  onTransfer?: (personId: string, toName: string) => void
  onAddGuest?: (name: string) => string | undefined
  onSave: (f: TruppFields) => Promise<boolean> | boolean
  onClose: () => void
}) {
  const az = appConfig.copy.atemschutz
  const rosterByName = useMemo(() => rosterIdByName(personnel), [personnel])
  const rosterById = useMemo(() => rosterFromList(personnel), [personnel])
  const [team, setTeam] = useState<CrewSlot[]>(() =>
    truppSlots(t, rosterByName, rosterById).map((sl) => (sl.personId ? sl : { ...sl, personId: personIdForName(rosterByName, sl.name) })))
  const [equipment, setEquipment] = useState<string[]>(t.equipment ?? [])
  const toggle = (id: string) => setEquipment(equipment.includes(id) ? equipment.filter((x) => x !== id) : [...equipment, id])
  const conflict = teamConflict(team, assignedIds, transferState, az.assignedFallbackName)
  const leaderOk = (team[0]?.name.trim().length ?? 0) > 0
  const canSave = leaderOk && !conflict
  const teamRef = useRef<HTMLDivElement>(null)
  const isPa = t.kind !== 'einfach'
  const save = async () => {
    // blocked: ring the crew, where the missing leader or the conflict is fixed (lib/pointAtField)
    if (!canSave) { pointAtField(teamRef.current); return }
    // the Gäste are filed NOW, at the save — never on a tap in the picker — and their ids ride
    // over the crew's (the form's `fileCrew`, same order of operations)
    const f = truppSheetFields(t, team, equipment, atemschutzEquipment().map((e) => e.id))
    if (await onSave({ ...f, ...fileGuestSlots(team, onAddGuest) })) onClose()
  }
  // the question, like its three siblings (T5): «Mannschaft», whose under it
  const title = az.editFieldLabels.crew
  return (
    <MiniSheet title={title} sub={truppSheetSub(t)} ariaLabel={`${title} · ${t.name}`} onClose={onClose}
      className={s.miniSheetTall}
      footer={(
        <SheetFoot className={s.modalFoot}>
          <button type="button" className={cx('ip-btn', s.footCancel)} onClick={onClose}>{az.cancel}</button>
          <button type="button" className="ip-btn primary" aria-disabled={!canSave} onClick={() => void save()}>{az.save}</button>
        </SheetFoot>
      )}>
      {/* no «Mannschaft» label over the picker: the title says it (as the Auftrag's tiles) */}
      <div ref={teamRef} className={s.field}>
        <TruppTeam value={team} onChange={setTeam} phone
          personnel={personnel} legacyRoster={legacyRoster} presentIds={presentIds} stationIds={stationIds}
          assignedIds={assignedIds} rolesById={rolesById} />
      </div>
      {conflict && <TeamConflictRow conflict={conflict} toName={team[0]?.name.trim() ?? ''} onTransfer={onTransfer}
        onPoint={() => teamRef.current?.scrollIntoView?.({ block: 'center' })} />}
      {isPa && (
        <div className={s.field}>
          <span>{az.equipmentLabel}</span>
          <div className={s.miniChips} role="group" aria-label={az.equipmentLabel}>
            {atemschutzEquipment().map((e) => {
              const on = equipment.includes(e.id)
              return (
                <Chip key={e.id} role="checkbox" selected={on} aria-pressed={undefined} aria-checked={on}
                  onClick={() => toggle(e.id)}>
                  {az.equipmentLabels[e.id] ?? e.label}
                </Chip>
              )
            })}
          </div>
        </div>
      )}
    </MiniSheet>
  )
}
