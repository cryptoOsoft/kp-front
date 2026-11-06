import { appConfig } from '../config/appConfig'
import { fillTemplate, fmtSpanShort, hhmm } from '../lib/format'
import { fmtDayShort, fmtStartValue, incidentDays, isOtherDay } from '../lib/zeitplanFormat'
import { applyTimeToIso, isoOnDay, keepEndAfterStart, keepStartBeforeEnd } from '../lib/abschluss'
import { timeBlockLabels } from '../lib/timeBlockLabels'
import type { Person, PresenceInterval, Shift } from '../types'
import { TimeBlockReadOnly, TimeBlockSheet } from './TimeBlockSheet'

const clock = (iso?: string): string => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? hhmm(d) : ''
}

/**
 * Everything about ONE person's time, opened from their row (pencil, or press-and-hold on the
 * lane). Both halves live here — the availability we PLAN (editable) and the presence that
 * actually HAPPENED (read-only: it is the record, and it is ticked in the Anwesenheit list).
 *
 * Built on the SAME sheet the Anwesenheit uses, so the two never drift apart again.
 */
export function PersonShiftSheet({ person, shifts, blocks, canEdit, startedAt, conflicts, onAdd, onSetTime, onToggle, onRemove, onClose }: {
  person: Person
  shifts: Shift[]
  blocks: PresenceInterval[]
  canEdit: boolean
  /** incident alarm time — drives the day labels and the «ab Beginn» shortcut */
  startedAt: string | null
  conflicts: Set<string>
  onAdd: (p: Person) => void
  onSetTime: (id: string, patch: { from?: string; to?: string }) => void
  onToggle: (sh: Shift) => void
  onRemove: (id: string, personName: string) => void
  onClose: () => void
}) {
  const Z = appConfig.copy.zeitplan
  const A = appConfig.copy.anwesenheit
  // the days this plan touches — start to the last planned end; feeds both the day wheel and
  // the «ab Beginn» value, so the two can never name different days
  // …plus the planning horizon. Bounding this by the LAST ALREADY-PLANNED end made the wheel
  // circular: you could only plan into a day that something was already planned into.
  const planDays = incidentDays(startedAt, Math.max(
    ...shifts.map((x) => Date.parse(x.to)).filter(Number.isFinite),
    Date.parse(startedAt ?? '') || 0,
    Date.now() + appConfig.shifts.planAheadHours * 3_600_000))
  return (
    <TimeBlockSheet
      title={fillTemplate(Z.editTitle, { name: person.displayName })}
      subject={person.displayName}
      sectionTitle={Z.plannedSection}
      emptyLabel={Z.plannedNone}
      note={Z.sheetHint}
      addLabel={canEdit ? Z.addShift : undefined}
      onAdd={canEdit ? () => onAdd(person) : undefined}
      // one shift per tap, with a ✓ in the button's place for a moment (lib/useOneShot)
      addedLabel={Z.shiftAdded}
      onClose={onClose}
      labels={timeBlockLabels(Z.remove)}
      days={planDays}
      blocks={shifts.map((sh) => ({
        key: sh.id,
        from: clock(sh.from),
        to: clock(sh.to),
        // the day each end sits on — see TimeBlock.fromDay
        fromDay: sh.from ? new Date(sh.from) : undefined,
        toDay: sh.to ? new Date(sh.to) : undefined,
        warn: conflicts.has(sh.id) || Date.parse(sh.to) <= Date.parse(sh.from),
        // mirror of onTo: a von typed after the bis means the shift STARTED the previous day,
        // not that it runs backwards — a reversed shift renders as nothing at all
        onFrom: canEdit ? (v, day) => { const iso = day ? isoOnDay(day, v) : applyTimeToIso(sh.from, v, { prevDayIfAfter: sh.to }); if (iso) onSetTime(sh.id, { from: keepStartBeforeEnd(iso, sh.to) }) } : undefined,
        // a bis before the von means the shift runs past midnight, not backwards
        onTo: canEdit ? (v, day) => { const iso = day ? isoOnDay(day, v) : applyTimeToIso(sh.to, v, { nextDayIfBefore: sh.from }); if (iso) onSetTime(sh.id, { to: keepEndAfterStart(sh.from, iso) }) } : undefined,
        onRemove: canEdit ? () => onRemove(sh.id, person.displayName) : undefined,
        // ALWAYS, not only when it differs: the clock alone never says which day, and «07:00» on
        // day three of an Elementarereignis is a question. It is also what makes an overnight
        // correction visible rather than silent.
        dayLabel: fmtDayShort(new Date(sh.from)),
        toDayLabel: fmtDayShort(new Date(sh.to)),
        // see the Anwesenheit twin: first shift only, and never when it would invert the block
        onFromStart: canEdit && startedAt && shifts[0]?.id === sh.id
          && Date.parse(startedAt) < Date.parse(sh.to)
          ? () => onSetTime(sh.id, { from: startedAt }) : undefined,
        fromStartValue: startedAt ? fmtStartValue(startedAt, planDays) : undefined,
        fromIsStart: !!startedAt && sh.from === startedAt,
        // No «noch da» here, decided: a shift is PLANNED into the future and always has an end.
        // It is also what the grid needs — shiftSpan returns null without one, so an open shift
        // would draw as nothing, count zero in the Deckung and vanish from the printed sheet.
        // Only a person's presence can be open, and that lives in the Anwesenheit.
        // the head IS the state: colour, word, and the whole width as the switch
        head: {
          label: sh.confirmed ? Z.confirmed : Z.available,
          tone: sh.confirmed ? 'planned' : 'available',
          ...(canEdit ? {
            onToggle: () => onToggle(sh),
            toggleHint: fillTemplate(Z.toggleHint, { state: sh.confirmed ? Z.available : Z.confirmed }),
          } : {}),
        },
        duration: fmtSpanShort(Date.parse(sh.to) - Date.parse(sh.from)),
      }))}
      extra={
        <TimeBlockReadOnly
          title={Z.actualSection}
          blocks={blocks.map((iv) => ({
            from: clock(iv.from), to: iv.to ? clock(iv.to) : undefined,
            // the editable list above carries dates; this one sat beside it undated
            dayLabel: startedAt && isOtherDay(new Date(iv.from), new Date(startedAt)) ? fmtDayShort(new Date(iv.from)) : undefined,
          }))}
          emptyLabel={Z.actualNone}
          note={Z.actualHint}
          openLabel={A.stillHere}
        />
      }
    />
  )
}
