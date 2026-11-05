import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon } from '../lib/icons'
import { SearchField } from './SearchField'
import { Button } from './Button'
import { Overlay } from '../lib/overlays'
import { scrollBehavior } from '../lib/reducedMotion'
import { appConfig } from '../config/appConfig'
import { fillTemplate } from '../lib/format'
import { atemschutzDoctrine, getDeploymentConfig } from '../lib/deploymentConfig'
import { DEFAULT_HOURS_ROUNDING } from '../lib/attendanceHours'
import { useIsPhone, useMediaQuery } from '../lib/useIsPhone'
import { helpShows } from '../lib/helpDevice'
import { pickActiveSection } from '../lib/scrollSpy'
import type { TutorialMeta } from '../lib/tutorials/catalogue'
import { helpTutorials, startOrResume } from '../lib/tutorials/offer'

// In-app capabilities/help overlay reached from the incident menu ("Funktionen &
// Hilfe"). One scrollable column of feature sections with a sticky TOC + scroll-spy
// (lib/scrollSpy: the TOC follows the reading position both ways and keeps its entry in view).
// Content is authored as data in appConfig.copy.help.sections (no markdown dependency)
// so it bundles offline; inline markup is **bold** + [[key]] keyboard chips.
// A section that maps to a tutorial carries «▶ Ausprobieren · <Titel> · n Min.» under its title
// (owner pick H = A, 05.11.2026; the map is lib/tutorials/offer · helpTutorials): a tap closes
// the help and starts the tutorial, resuming where an earlier run stopped.

/**
 * Wrap every occurrence of `q` in a plain string with <mark>. Case-insensitive and
 * literal — a search box is not a regex prompt, so the query is escaped before use.
 * Returns the string untouched when there is nothing to mark, so the common (unfiltered)
 * render allocates nothing.
 */
function mark(text: string, q: string, keyBase: string): ReactNode {
  if (!q) return text
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    // a zero-length match would spin forever; a query is trimmed but be safe
    if (m[0] === '') { re.lastIndex += 1; continue }
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(<mark key={`${keyBase}-${i++}`} className="help-hit">{m[0]}</mark>)
    last = re.lastIndex
  }
  if (!out.length) return text
  if (last < text.length) out.push(text.slice(last))
  return out
}

// Parse the lightweight inline markup of a help string into React nodes:
//   **text** → bold, [[key]] → keyboard chip, everything else → plain text.
// `q` (the active search) marks the hits in the plain runs AND inside the bold ones. The bold
// runs are the feature names — «**Atemschutz**», «**Ebenen**» — so they are precisely what
// someone searches for; skipping them left a search for "atemschutz" with almost nothing
// marked in the body. Keyboard chips stay untouched: [[Esc]] is a key, not a word.
/**
 * The station's own numbers, for the help strings that would otherwise state a default as if it
 * were the rule. «Überfällig nach ~5 Min.» was not merely generic — it was WRONG: red fires at
 * Intervall + Nachfrist, which is 6 minutes on the shipped defaults and whatever a Wehr set
 * otherwise. A help text that teaches the wrong safety threshold is worse than none.
 *
 * Read per call rather than at module load, so the boot-resolved deployment config applies.
 */
function helpVars(): Record<string, string | number> {
  const az = atemschutzDoctrine()
  const r = getDeploymentConfig().report?.hoursRounding
  return {
    contactMin: az.contactIntervalMin,
    graceSec: az.contactGraceSec,
    // what the operator actually watches for: the moment the card goes red
    overdueMin: Math.round(((az.contactIntervalMin * 60 + az.contactGraceSec) / 60) * 10) / 10,
    pressureStep: az.pressureStep,
    alarmBar: az.alarmBar,
    hoursStep: r?.stepMin ?? DEFAULT_HOURS_ROUNDING.stepMin,
    hoursGrace: r?.graceMin ?? DEFAULT_HOURS_ROUNDING.graceMin,
  }
}

function renderInline(text: string, q = ''): ReactNode[] {
  const out: ReactNode[] = []
  // the station's live numbers land before the markup is parsed, so a placeholder inside a
  // **bold** run works exactly like one outside it
  text = fillTemplate(text, helpVars())
  const re = /\*\*(.+?)\*\*|\[\[(.+?)\]\]/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(mark(text.slice(last, m.index), q, `p${i}`))
    if (m[1] !== undefined) out.push(<b key={i++}>{mark(m[1], q, `b${i}`)}</b>)
    else out.push(<span key={i++} className="help-kbd">{m[2]}</span>)
    last = re.lastIndex
  }
  if (last < text.length) out.push(mark(text.slice(last), q, `p${i}`))
  return out
}

// Everything in a section that a search should be able to hit: its heading plus every block's
// text, with the inline markup stripped — searching «Ebenen» has to match «**Ebenen**», and a
// keyboard chip's [[Esc]] has to match «esc».
type HelpSection = (typeof appConfig.copy.help.sections)[number]
function sectionHaystack(s: HelpSection, intro: string): string {
  const parts: string[] = [s.title]
  for (const b of s.blocks) {
    if (b.kind === 'intro') parts.push(intro)
    else if (b.kind === 'list') parts.push(...b.items)
    else if ('text' in b) parts.push(b.text)
  }
  return parts.join(' ').replace(/\*\*|\[\[|\]\]|\u00AD/g, '').toLowerCase()
}

/** «▶ Ausprobieren · Trupps · 6 Min. ›» – one per tutorial the section maps to, none otherwise */
function TryButtons({ sectionId, offered, onClose }: { sectionId: string; offered: readonly TutorialMeta[]; onClose: () => void }) {
  const C = appConfig.copy.tutorials
  const list = helpTutorials(sectionId, offered)
  if (!list.length) return null
  return (
    <div className="help-try">
      {list.map((t) => (
        <Button key={t.id} icon={<Icon id="play" />} onClick={() => { onClose(); startOrResume(t.id) }}>
          <b>{C.help.try}</b>
          <span className="help-try-what">{fillTemplate(C.help.what, { title: C.titles[t.id], minutes: fillTemplate(C.minutes, { n: t.minutes }) })}</span>
          <Icon id="chevron" className="help-try-chev" />
        </Button>
      ))}
    </div>
  )
}

export function HelpOverlay({ onClose, tutorials = [] }: {
  onClose: () => void
  /** what this session may practise (lib/tutorials/offer · offeredTutorials); none = no «Ausprobieren» */
  tutorials?: readonly TutorialMeta[]
}) {
  const C = appConfig.copy.help
  const phone = useIsPhone()
  // a finger and nothing else = no keyboard to speak of. ⚠️ Two plain queries rather than one
  // with a nested `not (…)`, which older WebKit does not parse; and where there is no matchMedia
  // at all (jsdom) both read false, i.e. a desk — the shortcuts are never silently missing there.
  const coarse = useMediaQuery('(pointer: coarse)')
  const anyFine = useMediaQuery('(any-pointer: fine)')
  const allSections = useMemo(() => {
    const d = { phone, finePointer: anyFine || !coarse }
    return C.sections
      .filter((sec) => helpShows(sec.only, d))
      .map((sec) => ({ ...sec, blocks: sec.blocks.filter((b) => b.kind === 'intro' || helpShows(b.only, d)) }))
  }, [C.sections, phone, coarse, anyFine])
  const intro = getDeploymentConfig().identity?.helpIntro ?? C.introFallback
  const [query, setQuery] = useState('')
  // The help is long and gets opened WITH a question, not to be read. The filter narrows the
  // TOC and the sections themselves — on a phone the TOC is hidden (see .help-toc in app.css),
  // so filtering the content is the entire search there.
  const haystacks = useMemo(
    () => new Map(allSections.map((s) => [s.id, sectionHaystack(s, intro)])),
    [allSections, intro],
  )
  const q = query.trim().toLowerCase()
  const sections = useMemo(
    () => (q ? allSections.filter((s) => haystacks.get(s.id)?.includes(q)) : allSections),
    [allSections, haystacks, q],
  )
  const [active, setActive] = useState(allSections[0].id)
  // ⚠️ STATE, not a ref: the <Overlay> mounts its popup after this component's first effects run,
  // so a ref read there is still null – and an effect keyed on [sections] alone never ran again.
  // That is why the old observer spy never fired at all (found 30.10.2026).
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const tocRef = useRef<HTMLElement>(null)
  // A TOC tap owns the highlight until the scroll it started has settled: the smooth scroll passes
  // every section in between, and at the bottom the picker would name the LAST section, not a
  // short tail section that was tapped. Each scroll event while pinned pushes the end on. Event
  // timestamps on both sides (one clock, and no impure call in a handler made during render).
  const pinnedUntil = useRef(0)

  // No Esc listener here: the <Overlay> this renders into already closes on Escape. The duplicate
  // window listener fired onClose a second time on the same key press.

  // scroll-spy (30.10.2026) — on every scroll, at most once a frame, the picker names the section
  // the reader is in (lib/scrollSpy). It replaced an IntersectionObserver band that never
  // re-activated the section above on the way up and never reached the short last sections.
  useEffect(() => {
    const root = scrollEl
    if (!root) return
    let frame = 0
    const pick = () => {
      frame = 0
      const rootTop = root.getBoundingClientRect().top
      const tops = sections.map((s) => (document.getElementById(`help-${s.id}`)?.getBoundingClientRect().top ?? Infinity) - rootTop)
      const i = pickActiveSection({ tops, scrollTop: root.scrollTop, viewHeight: root.clientHeight, scrollHeight: root.scrollHeight })
      if (i >= 0) setActive(sections[i].id)
    }
    const onScroll = (ev: Event) => {
      if (ev.timeStamp < pinnedUntil.current) { pinnedUntil.current = ev.timeStamp + 200; return }
      if (!frame) frame = requestAnimationFrame(pick)
    }
    // once up front, so a filtered set never keeps an entry it no longer lists
    frame = requestAnimationFrame(pick)
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => { root.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame) }
  }, [sections, scrollEl])

  // …and the TOC keeps that entry in view (the `block: 'nearest'` rule). By hand on the TOC alone:
  // `scrollIntoView` also moves every scrolling ancestor, and Chromium cancels the content's
  // running smooth scroll when another one starts. On a phone the TOC is hidden – nothing moves.
  useEffect(() => {
    const toc = tocRef.current
    const item = toc?.querySelector('.help-toc-i.on')
    if (!toc || !item) return
    const t = toc.getBoundingClientRect()
    const r = item.getBoundingClientRect()
    const pad = 8
    if (r.top < t.top + pad) toc.scrollTop += r.top - t.top - pad
    else if (r.bottom > t.bottom - pad) toc.scrollTop += r.bottom - t.bottom + pad
  }, [active])

  // a narrowed result set starts at ITS top — otherwise the scroller keeps the offset of the
  // unfiltered list and the first hit sits somewhere above the fold. In the handler, not an effect
  // on the query: an effect also fired when the scroller mounted.
  const search = (v: string) => {
    setQuery(v)
    scrollEl?.scrollTo({ top: 0 })
  }

  // a tap highlights its entry AT ONCE, and keeps it while the scroll it starts runs
  const go = (id: string, at: number) => {
    setActive(id)
    pinnedUntil.current = at + 200
    document.getElementById(`help-${id}`)?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
  }

  return (
    <Overlay open onClose={onClose} className="help-modal" backdropClassName="help-scrim" ariaLabel={C.title}>
        <div className="help-head">
          <span className="help-head-ic"><Icon id="info" /></span>
          {/* title only — the old tagline («… auch um 3 Uhr morgens …») described the app to
              someone who is already inside it, and cost a line of a phone's help header */}
          <div className="help-head-tt">
            <h2>{C.title}</h2>
          </div>
          <button className="ip-x" onClick={onClose} aria-label={C.close}><Icon id="close" /></button>
        </div>
        {/* the search lives in the HEADER, not above the TOC: the TOC is hidden on a phone,
            and that is exactly where someone is standing with one question and no patience */}
        <div className="help-search">
          <SearchField value={query} onChange={search} placeholder={C.search} aria-label={C.search}
            autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="search" />
        </div>
        <div className="help-body">
          <nav className="help-toc" ref={tocRef}>
            {/* no heading over an empty list — a lone «Inhalt» label reads like a failed render */}
            {sections.length > 0 && <div className="help-toc-h">{C.contents}</div>}
            {sections.map((s) => (
              <button key={s.id} className={`help-toc-i${active === s.id ? ' on' : ''}`} onClick={(ev) => go(s.id, ev.timeStamp)}>
                <Icon id={s.icon} /><span className="help-toc-t">{mark(s.title, q, `t${s.id}`)}</span>
              </button>
            ))}
          </nav>
          <div className="help-content" ref={setScrollEl}>
            {sections.length === 0 && (
              <div className="help-empty">
                {/* the verdict first, the way out under it — not the other way round. The verdict is
                    the app's one «no hits» line (`.no-hits`, 29.09.2026) */}
                <p className="no-hits">{fillTemplate(appConfig.copy.noHits, { q: query.trim() })}</p>
                <p className="help-empty-hint">{C.searchHint}</p>
              </div>
            )}
            {sections.map((s) => (
              <section key={s.id} id={`help-${s.id}`} className="help-sec">
                <h3><Icon id={s.icon} />{mark(s.title, q, 'h')}</h3>
                <TryButtons sectionId={s.id} offered={tutorials} onClose={onClose} />
                {s.blocks.map((b, i) => {
                  switch (b.kind) {
                    case 'intro':
                      return <p key={i} className="help-lead">{mark(intro, q, `i${i}`)}</p>
                    case 'lead':
                      return <p key={i} className="help-lead">{renderInline(b.text, q)}</p>
                    case 'sub':
                      return <p key={i} className="help-sub">{renderInline(b.text, q)}</p>
                    case 'note':
                      return <div key={i} className="help-note"><Icon id="info" /><span>{renderInline(b.text, q)}</span></div>
                    case 'list':
                      return (
                        <ul key={i} className="help-list">
                          {b.items.map((it, j) => <li key={j}>{renderInline(it, q)}</li>)}
                        </ul>
                      )
                    default:
                      return null
                  }
                })}
              </section>
            ))}
          </div>
        </div>
    </Overlay>
  )
}
