import { Icon } from '../lib/icons'
import type { ChecklistTemplate, Item, Phase, TemplateState, Tick } from '../lib/checklists'
import { isProblemTemplate, phaseItems, phaseProgress, readingPoints, templateProgress } from '../lib/checklists'
import { cx } from '../lib/cx'
import { useRef, useState } from 'react'
import { usePageHeadFit } from '../lib/pageHeadFit'
import { Segmented } from './Segmented'
import { TickRow } from './TickRow'
import { fillTemplate, formatTime } from '../lib/format'
import { appConfig } from '../config/appConfig'
import s from './Checklists.module.css'

// Ticks store a full ISO timestamp (append-only record); show only HH:MM inline. Guard
// against any legacy tick that already held a display string.
const tickTime = (t: string) => (t.includes('T') ? formatTime(new Date(t)) : t)

// Action / rapport checklist: phases → checkable items, branch toggles, per-phase
// and overall progress. Gloved-friendly: big tap targets. Ticking writes to the
// per-incident state (presence in `ticks` = checked); milestone ticks also surface
// in the Verlauf + audit trail (handled by the onTick callback in App).

const actionIcon: Record<NonNullable<Item['action']>, string> = {
  journal: 'history',
  plan: 'doc',
  draw: 'pen',
}

/** the Tafel's own glyphs (TafelFormPage · ARROW) */
const TREND_GLYPH = { up: '➚', same: '=', down: '➘' } as const

/**
 * A ticked problem's Tendenz (owner pick 7A, 05.11.2026): the Tafel's ➚ = ➘ as one Segmented under
 * the item – none picked = a problem without a trend, the picked one again clears it. The arrows
 * wear the Tafel's colours (worse red, better green) so the two surfaces read alike.
 */
function TrendRow({ item, trend, canTick, onTrend }: { item: Item; trend: Tick['trend']; canTick: boolean; onTrend: (t: Tick['trend']) => void }) {
  const CL = appConfig.copy.checklists
  const T = appConfig.copy.tafel
  const word = { up: T.trendUp, same: T.trendSame, down: T.trendDown }
  return (
    <div className={s['cl-trend']}>
      <span className={s['cl-trend-label']}>{CL.trendLabel}</span>
      <Segmented<NonNullable<Tick['trend']>>
        ariaLabel={fillTemplate(CL.trendAria, { text: item.text })}
        value={trend}
        onChange={(v) => onTrend(v === trend ? undefined : v)}
        options={(['up', 'same', 'down'] as const).map((v) => ({
          value: v, title: word[v], disabled: !canTick && trend !== v,
          label: <span className={s['cl-trend-glyph']} data-trend={v} aria-hidden="true">{TREND_GLYPH[v]}</span>,
        }))}
      />
    </div>
  )
}

function ItemRow({
  item, checked, tickInfo, canTick, onToggle, onAction, problem, onTrend,
}: {
  item: Item
  checked: boolean
  tickInfo?: Tick
  canTick: boolean
  onToggle: () => void
  onAction?: (a: NonNullable<Item['action']>) => void
  /** a `problems` list: a tick is a problem on the Tafel – `onTafel` says whether a page shows it */
  problem?: { onTafel: boolean }
  onTrend?: (t: Tick['trend']) => void
}) {
  const CL = appConfig.copy.checklists
  return (
    <div className={cx(s['cl-item'], checked && (problem ? s.problem : s.done))}>
      {/* box + text + meta are ONE target, the shared tick row (F7, 20.10.2026) */}
      <TickRow checked={checked} onToggle={onToggle} disabled={!canTick} aria-label={item.text} className={s['cl-tick']}>
        <span className={s['cl-item-body']}>
          <span className={s['cl-item-text']}>{item.text}</span>
          <span className={s['cl-item-meta']}>
            {item.when && <span className={s['cl-when']}>{item.when}</span>}
            {/* the flag WITH its word (22.09.2026): alone it was a 12px glyph whose meaning lived in a
                tooltip no tablet shows — the row now says what ticking it does */}
            {item.milestone && <span className={s['cl-milestone']} title={CL.milestoneTitle}><Icon id="flag" />{CL.milestoneTag}</span>}
            {checked && tickInfo && (
              <span className={s['cl-tickinfo']}>
                {tickTime(tickInfo.t)}{tickInfo.by && !problem ? ` · ${tickInfo.by}` : ''}
              </span>
            )}
            {/* where the tick landed: the Problemerfassung page and its box in the Erste Führung –
                or, while neither is on the Tafel, that it waits for them */}
            {checked && problem && <span className={s['cl-ontafel']}>{problem.onTafel ? CL.onTafel : CL.forTafel}</span>}
          </span>
        </span>
      </TickRow>
      {checked && problem && onTrend && <TrendRow item={item} trend={tickInfo?.trend} canTick={canTick} onTrend={onTrend} />}
      {/* the deep link is its glyph alone, a --tap square at the row's right edge (27.10.2026,
          owner pick 11A: «Zeichnen ›» took a third of a phone row and broke the text into five
          lines); the word stays its name for the reader and the tooltip */}
      {item.action && onAction && (
        <button className={s['cl-deeplink']} onClick={() => onAction(item.action!)}
          title={CL.actionLabels[item.action]} aria-label={CL.actionLabels[item.action]}>
          <Icon id={actionIcon[item.action]} />
        </button>
      )}
    </div>
  )
}

function PhaseBlock({
  phase, state, canTick, onToggle, onBranch, onAction, offersAction, problem, onTrend,
}: {
  phase: Phase
  state: TemplateState
  canTick: boolean
  problem?: { onTafel: boolean }
  onTrend?: (item: Item, t: Tick['trend']) => void
  onToggle: (item: Item) => void
  onBranch: (phaseId: string, branchId: string) => void
  onAction: (item: Item, a: NonNullable<Item['action']>) => void
  offersAction?: (a: NonNullable<Item['action']>) => boolean
}) {
  const CL = appConfig.copy.checklists
  const activeBranch = state.activeBranch?.[phase.id]
  const items = phaseItems(phase, activeBranch)
  const pr = phaseProgress(phase, state)
  const ticks = state.ticks ?? {}
  return (
    <section className={s['cl-phase']}>
      <header className={s['cl-phase-head']}>
        <div className={s['cl-phase-titles']}>
          <h3>{phase.title}</h3>
          {phase.role && <span className={s['cl-role']}>{phase.role}</span>}
        </div>
        <span className={s['cl-phase-count']}>{pr.done}/{pr.total}</span>
      </header>
      {phase.note && <p className={s['cl-note']}>{phase.note}</p>}

      {phase.branches?.length ? (
        <Segmented
          ariaLabel={CL.variantLabel}
          value={activeBranch}
          onChange={(id) => onBranch(phase.id, id)}
          options={phase.branches.map((b) => ({
            value: b.id,
            label: b.title,
            disabled: !canTick && activeBranch !== b.id,
          }))}
        />
      ) : null}

      <div className={s['cl-items']}>
        {items.map((it) => (
          <ItemRow
            key={it.id}
            item={it}
            checked={!!ticks[it.id]}
            tickInfo={ticks[it.id]}
            canTick={canTick}
            onToggle={() => onToggle(it)}
            onAction={it.action && offersAction?.(it.action) === false ? undefined : (a) => onAction(it, a)}
            problem={problem}
            onTrend={onTrend && ((t) => onTrend(it, t))}
          />
        ))}
        {!items.length && phase.branches?.length && (
          <p className={s['cl-empty-hint']}>{CL.pickVariant}</p>
        )}
      </div>
    </section>
  )
}

export function ChecklistRunner({
  template, state, canTick, onToggle, onBranch, onAction, offersAction, onTrend, problemsOnTafel = false,
}: {
  template: ChecklistTemplate
  state: TemplateState
  canTick: boolean
  /** a `problems` list's Tendenz under a ticked item (lib/useChecklistActions · setTrend) */
  onTrend?: (item: Item, t: Tick['trend']) => void
  /** a page that shows the Einsatz's problems is on the Tafel (lib/problemLink) */
  problemsOnTafel?: boolean
  onToggle: (item: Item) => void
  onBranch: (phaseId: string, branchId: string) => void
  onAction: (item: Item, a: NonNullable<Item['action']>) => void
  /** false ⇒ the item's deep link is not drawn: a door this session cannot go through (the
   *  «Zeichnen» link on a tactically locked device lands on a Karte that disarms the tool) */
  offersAction?: (a: NonNullable<Item['action']>) => boolean
}) {
  const CL = appConfig.copy.checklists
  const overall = templateProgress(template, state)
  // ONE ROW, like every page head (28.09.2026 — it stood 150px on the 820 tablet: a 21px title, a
  // subtitle wrapping to two lines, then «0%», the bar and «0/8 erledigt» stacked in a column of
  // their own). The title and its one quiet line left, the progress right on one line; what does
  // not fit gives up words (lib/pageHeadFit): the subtitle, whole (never cut mid-word, 30.09.2026),
  // then «erledigt».
  const headRef = useRef<HTMLElement>(null)
  usePageHeadFit(headRef, `${template.id}|${overall.done}|${overall.total}`)
  return (
    <div className={s['cl-runner']}>
      <header ref={headRef} className={s['cl-runner-head']}>
        <div className={s['cl-runner-titles']}>
          <h2>{template.title}</h2>
          {/* the quiet line: ONE line, said WHOLE or not at all (30.09.2026 — «Aktions-Checkliste
              Führ…» on the 820 tablet, «…Fü…» on the phone, is a word and a half that names
              nothing). It is checked text and the ladder's FIRST fold, as every head's quiet line
              is: the title above says which list it is either way. Whole in `title`. The phone
              shows none of the titles: its chooser row names the list and this row is the
              progress alone (Checklists.module.css). */}
          {template.subtitle && (
            <p title={template.subtitle} data-fit-check data-fold={1}><span className="fold-long">{template.subtitle}</span></p>
          )}
        </div>
        {/* «n/m erledigt» and nothing more (05.10.2026, owner: «the checklists don't need a progress
            indicator. Occupies too much space»). The bar is gone — here and under every phase,
            where the head's «n/m» already said it — and so is the «%» (30.09.2026: «0/8
            erledigt» already says it). The words sit in the head row the title needs anyway;
            on a narrow screen they move into the chooser row (ChecklistsView) and this row
            goes. */}
        <div className={s['cl-overall']}>
          <span className={s['cl-overall-sub']} data-fold={2}>
            {overall.done}/{overall.total}<span className="fold-long"> {CL.done}</span>
          </span>
        </div>
      </header>
      {(template.phases ?? []).map((p) => (
        <PhaseBlock
          key={p.id}
          phase={p}
          state={state}
          canTick={canTick}
          onToggle={onToggle}
          onBranch={onBranch}
          onAction={onAction}
          offersAction={offersAction}
          problem={isProblemTemplate(template) ? { onTafel: problemsOnTafel } : undefined}
          onTrend={isProblemTemplate(template) ? onTrend : undefined}
        />
      ))}
      <footer className={s['cl-runner-foot']}>{template.source}</footer>
    </div>
  )
}

/**
 * The same list to READ, outside an Einsatz (19.10.2026, owner pick: «Checklisten zum Lesen» on
 * the Karte's Checkliste surface – ChecklistLibrary). The runner's look, but numbers where the
 * boxes are, one quiet line saying where ticking happens, and no deep-link chips (there is no
 * Einsatz whose Plan or Verlauf they could open). A phase's variants (ohne / mit C-FU) can be
 * flipped to read either – a view choice in component state, nothing is stored.
 */
export function ChecklistReader({ template }: { template: ChecklistTemplate }) {
  const CL = appConfig.copy.checklists
  const [picked, setPicked] = useState<Record<string, string>>({})
  const branchOf = (p: Phase) => picked[p.id] ?? p.branches?.[0]?.id
  const points = readingPoints(template, picked)
  return (
    <div className={s['cl-runner']}>
      <header className={s['cl-runner-head']}>
        <div className={s['cl-runner-titles']}>
          <h2>{template.title}</h2>
          {template.subtitle && <p title={template.subtitle}>{template.subtitle}</p>}
        </div>
        <div className={s['cl-overall']}><span className={s['cl-overall-sub']}>{fillTemplate(CL.points, { n: points })}</span></div>
      </header>
      <p className={s['cl-ro-note']}><Icon id="eye" />{CL.readOnly}</p>
      {(template.phases ?? []).map((p) => (
        <section key={p.id} className={s['cl-phase']}>
          <header className={s['cl-phase-head']}>
            <div className={s['cl-phase-titles']}>
              <h3>{p.title}</h3>
              {p.role && <span className={s['cl-role']}>{p.role}</span>}
            </div>
          </header>
          {p.note && <p className={s['cl-note']}>{p.note}</p>}
          {p.branches?.length ? (
            <Segmented
              ariaLabel={CL.variantLabel}
              value={branchOf(p)}
              onChange={(id) => setPicked((v) => ({ ...v, [p.id]: id }))}
              options={p.branches.map((b) => ({ value: b.id, label: b.title }))}
            />
          ) : null}
          <ol className={s['cl-items']}>
            {phaseItems(p, branchOf(p)).map((it, i) => (
              <li key={it.id} className={s['cl-item']}>
                <span className={s['cl-num']} aria-hidden="true">{i + 1}</span>
                <div className={s['cl-item-body']}>
                  <div className={s['cl-item-text']}>{it.text}</div>
                  {it.when && <div className={s['cl-item-meta']}><span className={s['cl-when']}>{it.when}</span></div>}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
      <footer className={s['cl-runner-foot']}>{template.source}</footer>
    </div>
  )
}
