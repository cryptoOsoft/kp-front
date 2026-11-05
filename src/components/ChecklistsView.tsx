import { LoadingStatus } from './ShellLoader'
import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../lib/icons'
import type { ChecklistState, ChecklistTemplate, Item, TemplateState, Tick } from '../lib/checklists'
import { allEntries, warmTemplates, matchEntries, searchEntries, templateProgress } from '../lib/checklists'
import { chapterOf, isTickable, manualGroups } from '../lib/checklists'
import { ChecklistRunner } from './ChecklistRunner'
import { useRememberedScroll } from '../lib/rememberedScroll'
import { useHistoryTrail } from '../lib/historyTrail'
import { ChecklistEntryReader } from './ChecklistReference'
import { ManualReader } from './ManualReader'
import { DevicePage } from './DeviceManuals'
import { BackRow, ListGroup } from './ListRow'
import { DeviceList, EntryRow, TemplateRow } from './ChecklistRail'
import { cx } from '../lib/cx'
import { EmptyState } from './EmptyState'
import { SearchField } from './SearchField'
import { appConfig } from '../config/appConfig'
import { fillTemplate } from '../lib/format'
import { useMediaQuery } from '../lib/useIsPhone'
import s from './Checklists.module.css'

const EMPTY_STATE: TemplateState = { ticks: {}, activeBranch: {} }

/** what the main pane shows: a tickable list, a Stichwort, a device's chapter page (id = the
 *  device name) or an Anleitung */
type Sel = { kind: 'tpl' | 'entry' | 'manual' | 'device'; id: string }
const sameSel = (a: Sel | null, b: Sel | null) => a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id)

/* The pick (which list is open, and on a narrow screen whether the chooser or the list shows),
   per Einsatz. sessionStorage so a reload of the tab keeps it too; memory as the fallback when
   storage is blocked. */
type Picked = { sel?: Sel | null; railOpen?: boolean }
const pickedMemory = new Map<string, Picked>()
const pickedKey = (k: string) => `kp.cl.picked.${k}`
function readPicked(k: string): Picked | null {
  if (pickedMemory.has(k)) return pickedMemory.get(k)!
  try {
    const raw = sessionStorage.getItem(pickedKey(k))
    return raw ? (JSON.parse(raw) as Picked) : null
  } catch { return null }
}
function writePicked(k: string, patch: Picked) {
  const next = { ...readPicked(k), ...patch }
  pickedMemory.set(k, next)
  try { sessionStorage.setItem(pickedKey(k), JSON.stringify(next)) } catch { /* memory only */ }
}

// The Checkliste surface: a left rail with the action checklists (FU, Lagerapport) and —
// directly below, not behind a tab — the searchable EL tactical Stichworte. The main pane
// renders the selection: an action checklist runs as a checkable phase list; a Stichwort
// opens its reading view (with inline diagrams). Ticking/branch are lifted to App.
export function ChecklistsView({
  checklists, canTick, incidentTitle, onTick, onTrend, problemsOnTafel, onBranch, onAction, offersAction, scrollKey = '',
}: {
  checklists: ChecklistState
  canTick: boolean
  /** a `problems` list's Tendenz under a ticked item (lib/useChecklistActions · setTrend) */
  onTrend?: (template: ChecklistTemplate, item: Item, trend: Tick['trend']) => void
  /** a page showing the Einsatz's problems is on the Tafel (lib/problemLink · hasProblems) */
  problemsOnTafel?: boolean
  /** the Einsatz title (its Stichwort) – the «Passend» group's Stichworte are matched on it */
  incidentTitle?: string
  onTick: (template: ChecklistTemplate, item: Item) => void
  onBranch: (templateId: string, phaseId: string, branchId: string) => void
  onAction: (item: Item, a: NonNullable<Item['action']>) => void
  offersAction?: (a: NonNullable<Item['action']>) => boolean
  /** whose reading positions these are — the Einsatz id; each list's scroll offset is kept
   *  under it (scrollMemory above) */
  scrollKey?: string
}) {
  const CL = appConfig.copy.checklists
  // Templates are fetched from the reference registry (offline-cached, bundled fallback) — async,
  // so start empty and fill on resolve. loadTemplates never throws, so no error branch is needed.
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([])
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let alive = true
    const apply = (t: ChecklistTemplate[]) => {
      if (alive) {
        setTemplates(t)
        setReady(true)
      }
    }
    // already loading or loaded since the Einsatz opened (lib/checklists · warmTemplates); a
    // list older than a few minutes is shown at once and replaced when its reload lands
    const { list, newer } = warmTemplates()
    void list.then(apply)
    void newer?.then(apply)
    return () => {
      alive = false
    }
  }, [])

  const actionTemplates = useMemo(() => templates.filter(isTickable), [templates])
  const referenceTemplates = useMemo(() => templates.filter((t) => t.kind === 'reference'), [templates])
  const entries = useMemo(() => allEntries(templates), [templates])
  const manuals = useMemo(() => templates.filter((t) => t.kind === 'manual'), [templates])
  // every device, unfiltered: a chapter's «k von n» and its neighbours do not change with the search
  const devices = useMemo(() => manualGroups(templates, ''), [templates])
  const autoMatches = useMemo(() => matchEntries(templates, incidentTitle), [templates, incidentTitle])

  // The picker rail collapses to a single toggle row once something is picked, so the
  // checklist/playbook text gets the full height; tapping the row reopens the list.
  //
  // ⚠️ 760px, not `useIsPhone` (600px). The rail is a FIXED 248px, so between 601 and ~730 it kept
  // its full width while the runner column shrank to ~276px — measured at 640px (iPad Split View,
  // half) six of eight task texts overflowed their box and painted over the Plan/Journal chip.
  // Phones were never the problem; the band just above them was, and the collapse mechanism that
  // fixes it already existed and simply stopped 160px short.
  const railNarrow = useMediaQuery('(max-width: 760px)')

  // selection is either an action template, a tactical entry or an Anleitung; defaults once
  // templates arrive. Kept per Einsatz across tab changes and reloads (05.10.2026, owner:
  // «selected checklists don't persist and on every tab change they disappear») — the surface
  // unmounts whenever another tab is shown, so component state alone fell back to the first list.
  // …and whether the phone showed the list or the open checklist comes back the same way.
  //
  // The levels are history entries (lib/historyTrail, owner 20.10.2026 – the native back steps up
  // one): on a phone the list (null) → the open item → a device's chapter, beside the list the
  // device → its chapter. `sel` is the item the main pane shows – also while the phone's list
  // covers it.
  const [lastSel, setLastSel] = useState<Sel | null>(() => readPicked(scrollKey)?.sel ?? null)
  const [restored] = useState(() => (railNarrow && (readPicked(scrollKey)?.railOpen ?? true) ? null : lastSel))
  const nav = useHistoryTrail<Sel | null>(restored, sameSel)
  if (nav.at && !sameSel(nav.at, lastSel)) setLastSel(nav.at)
  const sel = nav.at ?? lastSel
  const railOpen = nav.at === null
  useEffect(() => writePicked(scrollKey, { sel: lastSel, railOpen }), [scrollKey, lastSel, railOpen])
  /** the levels down to `v`, top first: a chapter under its device, on a phone everything under the list */
  const pathTo = (v: Sel): (Sel | null)[] => {
    const ch = v.kind === 'manual' ? chapterOf(devices, v.id) : null
    const deep: Sel[] = ch ? [{ kind: 'device', id: ch.group.device }, v] : [v]
    return railNarrow ? [null, ...deep] : deep
  }
  /** show `v` in the main pane – on a phone with the list open, behind it */
  const setSel = (v: Sel | null) => {
    if (!v) { setLastSel(null); if (nav.at) nav.go([null]) }
    else if (railNarrow && railOpen) setLastSel(v)
    else nav.go(pathTo(v))
  }
  const pick = (v: Sel) => nav.go(pathTo(v))
  const setRailOpen = (open: boolean) => nav.go(open || !sel ? [null] : pathTo(sel))
  // a restored item gets its levels back once the devices are known (a chapter's device); the
  // levels change with the layout (the phone's list is one of them)
  useEffect(() => {
    if (!ready) return
    if (railNarrow && railOpen) nav.go([null])
    else if (sel) nav.go(pathTo(sel))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-chained on these two only; pathTo is a fresh closure
  }, [ready, railNarrow])
  useEffect(() => {
    if (!ready) return
    // a remembered pick whose list was removed since falls back to the default, like no pick
    if (sel && [...actionTemplates, ...manuals].some((t) => t.id === sel.id)) return
    if (sel?.kind === 'entry' && entries.some((e) => e.id === sel.id)) return
    if (sel?.kind === 'device' && devices.some((g) => g.device === sel.id)) return
    if (actionTemplates[0]) setSel({ kind: 'tpl', id: actionTemplates[0].id })
    else if (entries[0]) setSel({ kind: 'entry', id: entries[0].id })
    else if (manuals[0]) setSel({ kind: 'manual', id: manuals[0].id })
    else if (sel) setSel(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setSel is a fresh closure per render
  }, [sel, ready, actionTemplates, entries, manuals, devices])

  // the list's look: the library's phone cards while the list owns a narrow surface, the rail's
  // compact rows beside the document
  const look = railNarrow ? 'card' : 'rail'

  const [query, setQuery] = useState('')
  const results = useMemo(() => searchEntries(entries, query), [entries, query])
  const matchResults = useMemo(() => searchEntries(autoMatches, query), [autoMatches, query])
  // the search at the top of the rail filters every group uniformly — action lists by title,
  // reference entries by title/keyword — so Aufgaben, Taktik and Grundlagen are peer groups.
  const q = query.trim().toLowerCase()
  const actionResults = q ? actionTemplates.filter((t) => t.title.toLowerCase().includes(q)) : actionTemplates
  // Anleitungen (kind: manual): the same search, over title, device and keywords
  const manualResults = useMemo(() => manualGroups(templates, query), [templates, query])
  const noMatches = ready && !actionResults.length && !results.length && !manualResults.length

  const activeTemplate = sel?.kind === 'tpl' ? actionTemplates.find((t) => t.id === sel.id) ?? null : null
  const activeManual = sel?.kind === 'manual' ? manuals.find((t) => t.id === sel.id) ?? null : null
  const activeEntry = sel?.kind === 'entry' ? entries.find((e) => e.id === sel.id) ?? null : null
  const activeDevice = sel?.kind === 'device' ? devices.find((g) => g.device === sel.id) ?? null : null
  const chapter = activeManual ? chapterOf(devices, activeManual.id) : null
  // the device whose row is lit: the open device, or the device of the open chapter
  const litDevice = activeDevice?.device ?? (activeManual && devices.find((g) => g.manuals.includes(activeManual))?.device)
  // the reference template that owns the open entry — drives its diagram asset URLs
  const activeEntryTemplate =
    sel?.kind === 'entry' ? templates.find((t) => (t.entries ?? []).some((e) => e.id === sel.id)) ?? null : null

  const railRef = useRememberedScroll<HTMLElement>(`${scrollKey}|rail`)
  const mainRef = useRememberedScroll<HTMLElement>(sel ? `${scrollKey}|${sel.kind}:${sel.id}` : null)

  if (ready && !templates.length) {
    return (
      <div className={s['cl-surface']}>
        <EmptyState className="empty-fill" icon="check" title={CL.none} />
      </div>
    )
  }

  const selTitle = activeTemplate?.title ?? activeManual?.title ?? activeDevice?.device ?? activeEntry?.title ?? CL.railLabel
  const activeProgress = activeTemplate ? templateProgress(activeTemplate, checklists[activeTemplate.id] ?? EMPTY_STATE) : null

  return (
    <div className={s['cl-surface']}>
      {railNarrow && !railOpen ? (
        <button className={s['cl-rail-toggle']} onClick={() => setRailOpen(true)} aria-expanded={false} aria-label={CL.showList}>
          {/* what is open, in the rail's own glyph — not a 🔍 (05.10.2026, owner: «remove the search
              icon … when having a checklist opened»): the row is the list's name and the way back
              to the chooser, and the magnifier promised a search it only reached one tap later.
              The chooser it opens still starts with the search field. A Stichwort carries its
              category chip below instead. */}
          {activeTemplate && <Icon id={activeTemplate.kind === 'rapport' ? 'history' : 'check'} />}
          {activeEntry && !activeEntry.hazardColor && <Icon id="doc" />}
          {(activeManual || activeDevice) && <Icon id="doc" />}
          <span className={s['cl-rail-toggle-title']}>{selTitle}</span>
          {/* the open list's «n/m» — here, in a row that stands anyway, instead of a progress row
              of its own under it (05.10.2026, owner: «don't need a progress indicator. Occupies
              too much space»; ChecklistRunner) */}
          {activeProgress && activeProgress.total > 0 && (
            <span className={s['cl-rail-toggle-prog']}>{activeProgress.done}/{activeProgress.total}</span>
          )}
          {/* the Stichwort's category as a word in the head (27.09.2026, owner-r2-5): it was a
              filled «BRAND» pill inside the document card, over a title the chooser had just
              shown — the card is gone on a phone (Checklists.module.css), so its two facts moved
              up here: the title is the chooser's, the category is this chip. */}
          {activeEntry?.hazardColor && (
            <span className={cx(s['cl-head-hz'], s[`hz-${activeEntry.hazardColor}`])}>
              <i className={s['cl-ref-chip']} />{CL.hazardLabels[activeEntry.hazardColor] ?? activeEntry.hazardColor}
            </span>
          )}
          <Icon id="chevron-down" />
        </button>
      ) : (
      <nav ref={railRef} className={cx(s['cl-rail'], railNarrow && railOpen && s['cl-rail-full'])} aria-label={CL.railLabel}>
        <SearchField className={s['cl-rail-search']} value={query} onChange={setQuery} placeholder={CL.searchPlaceholder} aria-label={CL.searchAria} />
        {/* every group is a peer below the search: the checkable Aufgaben, then each reference
            template (Taktik-Stichworte, Grundlagen-Infos). One scroll region. */}
        <div className={s['cl-rail-groups']}>
          {!ready && !templates.length && <div className="workspace-loading"><LoadingStatus>{appConfig.copy.loading}</LoadingStatus></div>}
          {/* the groups and rows are the Karte library's (ChecklistRail, owner 20.10.2026: «the
              landing is the reference»); this rail keeps its order – Aufgaben first, Anleitungen
              last (19.10.2026, owner: «least important during an active emergency») – and its
              ticks: a checklist's «40%» at its row's end. A device with chapters opens its page,
              a single Anleitung opens directly. */}
          {/* «Passend»: the Stichworte this Einsatz's title names, most specific first – ALL of
              them, not the best one (31.08.: «VU Strasse» is Verkehrsunfall AND E-Autobrand AND
              Ölspur; lib/checklists · matchEntries). A group like every other (owner pick 4A,
              sweep 23.10.2026): the Stichwort rows below, no red – red is for danger only. No
              match, or none left by the search → no group. */}
          {matchResults.length > 0 && (
            <ListGroup label={CL.groupMatching} look={look}>
              {matchResults.map((e) => (
                <EntryRow key={e.id} entry={e} on={!railNarrow && sel?.kind === 'entry' && sel.id === e.id}
                  onOpen={() => pick({ kind: 'entry', id: e.id })} />
              ))}
            </ListGroup>
          )}
          {actionResults.length > 0 && (
            <ListGroup label={CL.groupTasks} look={look}>
              {actionResults.map((t) => {
                const pr = templateProgress(t, checklists[t.id] ?? EMPTY_STATE)
                return (
                  <TemplateRow key={t.id} template={t} end={pr.total > 0 ? `${pr.pct}%` : null}
                    on={!railNarrow && sel?.kind === 'tpl' && sel.id === t.id} onOpen={() => pick({ kind: 'tpl', id: t.id })} />
                )
              })}
            </ListGroup>
          )}
          {referenceTemplates.map((rt) => {
            const rtResults = searchEntries(rt.entries ?? [], query)
            if (!rtResults.length) return null
            return (
              <ListGroup key={rt.id} label={rt.title} look={look}>
                {rtResults.map((e) => (
                  <EntryRow key={e.id} entry={e} on={!railNarrow && sel?.kind === 'entry' && sel.id === e.id}
                    onOpen={() => pick({ kind: 'entry', id: e.id })} />
                ))}
              </ListGroup>
            )
          })}
          {manualResults.length > 0 && (
            <ListGroup label={CL.groupManuals} look={look} bare>
              <DeviceList groups={manualResults} look={look} isOn={(g) => !railNarrow && litDevice === g.device}
                onOpen={(g) => pick(g.manuals.length > 1 ? { kind: 'device', id: g.device } : { kind: 'manual', id: g.manuals[0].id })} />
            </ListGroup>
          )}
          {noMatches && <p className="no-hits">{fillTemplate(appConfig.copy.noHits, { q: query.trim() })}</p>}
        </div>
      </nav>
      )}

      {/* #4: on a phone, while the list is open show ONLY the list (no small preview underneath).
          Opening an item collapses the list to the toggle row and gives the checklist the screen. */}
      {!(railNarrow && railOpen) && (
        <main ref={mainRef} className={s['cl-main']}>
          {activeTemplate ? (
            <ChecklistRunner
              template={activeTemplate}
              state={checklists[activeTemplate.id] ?? EMPTY_STATE}
              canTick={canTick}
              onToggle={(item) => onTick(activeTemplate, item)}
              onTrend={onTrend && ((item, trend) => onTrend(activeTemplate, item, trend))}
              problemsOnTafel={problemsOnTafel}
              onBranch={(phaseId, branchId) => onBranch(activeTemplate.id, phaseId, branchId)}
              onAction={onAction}
              offersAction={offersAction}
            />
          ) : activeManual ? (
            <>
            {/* a chapter's way back names its device («‹ TLF») – the same row as the Karte's
                Checkliste (ChecklistLibrary), owner 19.10.2026 */}
            {chapter && <BackRow className={s['cl-doc-back']} label={chapter.group.device} onClick={() => setSel({ kind: 'device', id: chapter.group.device })} />}
            <ManualReader
              manual={activeManual}
              chapter={chapter && {
                ...chapter,
                onGo: (id) => setSel({ kind: 'manual', id }),
              }}
            />
            </>
          ) : activeDevice ? (
            <DevicePage group={activeDevice} onChapter={(id) => setSel({ kind: 'manual', id })} />
          ) : (
            <ChecklistEntryReader entry={activeEntry} template={activeEntryTemplate} />
          )}
        </main>
      )}
    </div>
  )
}
