import { useEffect, useState } from 'react'
import { appConfig } from '../../config/appConfig'
import { fillTemplate } from '../../lib/format'
import { Icon } from '../../lib/icons'
import { Sheet } from '../../lib/overlays'
import type { TutorialMeta } from '../../lib/tutorials/catalogue'
import { FILTERS, filterTutorials, rowState, startOrResume, type UebenFilter } from '../../lib/tutorials/offer'
import { isDone, loadProgress, PROGRESS_EVENT, type ProgressMap } from '../../lib/tutorials/progress'
import { useTutorialSession } from '../../lib/tutorials/session'
import { Chip } from '../Chip'
import { ListGroup, ListRow } from '../ListRow'
import s from './UebenSheet.module.css'

// The «Üben» sheet (owner pick S = B «Eine Liste», 05.11.2026): every tutorial this session may
// start as ONE flat list in catalogue order, a filter chip row by function above it (Alle · FU ·
// EL · AS – the device never guesses «my» track, O8), and per row the minutes, whether it opens
// a Lern-Übung, ✓ when done on this device and «Fortsetzen» where a run was interrupted. A tap
// starts (or resumes) the tutorial and closes the sheet; the runner (useTutorial) takes it from
// there. Opened from the «Üben» row of the app menu (AppMenuRows) as App's landing sheet 'ueben',
// so the Einsatz behind it stays mounted. Who may see which row, the filters and the row states
// are lib/tutorials/offer (shared with the Hilfe's «Ausprobieren»).

/** the device's progress, re-read on every write (this tab: PROGRESS_EVENT, another: storage) */
function useProgress(): ProgressMap {
  const [map, setMap] = useState(loadProgress)
  useEffect(() => {
    const reread = () => setMap(loadProgress())
    window.addEventListener(PROGRESS_EVENT, reread)
    window.addEventListener('storage', reread)
    return () => { window.removeEventListener(PROGRESS_EVENT, reread); window.removeEventListener('storage', reread) }
  }, [])
  return map
}

export function UebenSheet({ tutorials, onClose }: {
  /** what this session may start (`offeredTutorials`) – never empty where the menu row is drawn */
  tutorials: readonly TutorialMeta[]
  onClose: () => void
}) {
  const C = appConfig.copy.tutorials
  const progress = useProgress()
  const session = useTutorialSession()
  const [filter, setFilter] = useState<UebenFilter>('all')
  // a chip with nothing behind it is not drawn (a viewer has no Einsatz set); one chip is no choice
  const chips = FILTERS.map((f) => ({ f, n: filterTutorials(tutorials, f).length })).filter((c) => c.n > 0)
  const shown = filterTutorials(tutorials, filter)
  const doneN = shown.filter((t) => isDone(progress, t.id)).length
  const chipLabel = (f: UebenFilter) => (f === 'all' ? C.sheet.all : C.sheet.chips[f])
  const groupLabel = filter === 'all' ? C.sheet.all : C.tracks[filter]

  return (
    <Sheet open onClose={onClose} fit title={C.menu}>
      <p className={s.lede}>{C.sheet.lede}</p>
      {chips.length > 1 && (
        <div className={s.chips} role="group" aria-label={C.sheet.filterLabel}>
          {chips.map(({ f, n }) => (
            <Chip key={f} selected={filter === f} onClick={() => setFilter(f)}>
              {chipLabel(f)}<span className={s.count}>{n}</span>
            </Chip>
          ))}
        </div>
      )}
      <ListGroup label={groupLabel} end={fillTemplate(C.sheet.doneCount, { done: doneN, n: shown.length })}>
        {shown.map((t) => {
          const { done, resume } = rowState(t.id, progress, session)
          const tag = t.sandbox === 'none'
            ? <span className="ip-badge ip-badge-arch">{C.sheet.tagOffline}</span>
            : <span className="ip-badge ip-badge-exercise">{C.sheet.tagUebung}</span>
          return (
            <ListRow
              key={t.id}
              data-tutorial={t.id}
              lead={(
                <span className={s.mark} data-state={done ? 'done' : resume ? 'resume' : 'new'}
                  {...(done ? { role: 'img', 'aria-label': C.sheet.done } : { 'aria-hidden': true })}>
                  {done && <Icon id="check" />}
                </span>
              )}
              title={C.titles[t.id]}
              // an interrupted run says where it stands and nothing else: beside «Fortsetzen» a
              // phone row has no room for the tag too, and the run already has its Übung
              sub={resume
                ? fillTemplate(resume.running ? C.sheet.running : C.sheet.interrupted, { n: resume.step + 1 })
                : <span className={s.sub}>{tag}<span>{C.summaries[t.id]}</span></span>}
              end={resume
                ? <span className={s.resume}>{C.sheet.resume}</span>
                : fillTemplate(C.minutes, { n: t.minutes })}
              chevron={!resume}
              onClick={() => { startOrResume(t.id); onClose() }}
            />
          )
        })}
      </ListGroup>
    </Sheet>
  )
}
