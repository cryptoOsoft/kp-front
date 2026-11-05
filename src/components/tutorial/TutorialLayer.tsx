import { useEffect, useRef, useState } from 'react'
import { appConfig } from '../../config/appConfig'
import { Icon } from '../../lib/icons'
import { cx } from '../../lib/cx'
import { fillTemplate } from '../../lib/format'
import { useIsPhone } from '../../lib/useIsPhone'
import { Popover, Sheet } from '../../lib/overlays'
import { Button } from '../Button'
import { ListCard, ListRow } from '../ListRow'
import { findAnchor, type TutAnchor } from '../../lib/tutorials/anchors'
import { tutorialMeta } from '../../lib/tutorials/catalogue'
import { stepWords } from '../../lib/tutorials/steps'
import type { TutorialRun } from '../../lib/tutorials/useTutorial'
import type { WorkspaceMode } from '../../workspace/types'
import s from './Tutorial.module.css'

// The running tutorial on screen («Üben», owner picks 05.11.2026 – K = B, G = A, O1–O4):
//
//   · the PILL «Üben 3/7 · ✕» at the top – a tap opens the step list (O2), ✕ pauses (the step is
//     kept; the «Üben» sheet offers «Fortsetzen»). On a phone it stands under the top bar and the
//     pages with a head move down by its height (O4, `<html data-tut-pill>` → Surface.module.css).
//   · the SPRECHBLASE: no scrim, a pointer bubble on the control the step names (overlays ·
//     Popover in its persistent mode: no focus, no guard, close requests ignored). Dots, the
//     instruction, one hint line, «Überspringen» – or «Weiter» on a step the app cannot see. The
//     ✓ stands ~1.5 s with «Gleich: …» (O3). Without an anchor on screen it hangs under the pill.
//   · the STEP LIST (variant C as a Sheet behind the pill): ✓ / current / to come, the current
//     one with «Zeigen» (a pulsing ring on its control) and «Überspringen», «Beenden» at the foot.
//   · the DONE CARD (G = A) in place of the bubble, the Übung visible behind it: «Geschafft»,
//     the steps as a ✓ list, «Übung löschen» (filled primary + bin, O9) · «Behalten», «Weiter mit».
//
// Layering (01-tokens · --z-tutorial): over the map chrome, UNDER the Meldeleiste and the top bar
// – an alarm row always wins; on a control inside a modal (the phone's «+» sheet) the bubble rises
// over that sheet (--z-tutorial-sheet). The bubble keeps off the phone's bars and the Eintrag FAB
// (its collision padding), and every modal (composer, forms) simply covers it.

/** how often the bubble re-finds its control – rails fold, sheets open, a tile re-renders */
const ANCHOR_POLL_MS = 250

interface Placed {
  el: HTMLElement
  side: 'top' | 'bottom' | 'left' | 'right'
  offset: number
  inDialog: boolean
  padding: { top: number; right: number; bottom: number; left: number }
}

/** the top of what stands at the phone's foot – its two bars and, while one is open, a symbol's
 *  editor sheet (`.ctx`) over them – or null on a tablet */
function footTop(): number | null {
  const tops = [...document.querySelectorAll<HTMLElement>('.navrail.folded, .vrail.folded, .ctx')]
    .filter((b) => b.getClientRects().length > 0).map((b) => b.getBoundingClientRect().top)
  return tops.length ? Math.min(...tops) : null
}

/** a tablet's open symbol editor (`.ctx`) standing between a rail anchor and the bubble's side */
function editorLeftOf(r: DOMRect): number | null {
  const ctx = document.querySelector<HTMLElement>('.ctx')
  if (!ctx || ctx.getClientRects().length === 0) return null
  const c = ctx.getBoundingClientRect()
  return c.right <= r.left + 1 && c.bottom > r.top && c.top < r.bottom ? c.left : null
}

/** where the bubble goes for the first anchor on screen (or the pill), read off the live layout */
function place(anchors: readonly TutAnchor[], fallback: HTMLElement | null, phone: boolean): Placed | null {
  const el = anchors.map((a) => findAnchor(a)).find((e) => e && e.getClientRects().length > 0) ?? fallback
  if (!el) return null
  const r = el.getBoundingClientRect()
  const W = window.innerWidth, H = window.innerHeight
  const side = el === fallback ? 'bottom' : r.top > H * 0.6 ? 'top' : r.bottom < 120 ? 'bottom' : r.left > W / 2 ? 'left' : 'right'
  const bars = phone ? footTop() : null
  // an anchor in the LOWER of the two phone bars (or under an editor sheet): the bubble clears
  // what stands above it too; on a tablet it stands left of an open symbol editor, never on it
  const ctxLeft = !phone && side === 'left' ? editorLeftOf(r) : null
  // …and under the phone's top bar it hangs below the pill, which stands in that lane
  const pill = phone && fallback && el !== fallback ? fallback.getBoundingClientRect() : null
  const offset = side === 'top' && bars !== null && r.top > bars + 1 ? r.top - bars + 10
    : ctxLeft !== null ? r.left - ctxLeft + 10
    : side === 'bottom' && pill && r.bottom < pill.bottom ? pill.bottom - r.bottom + 10 : 10
  const fab = phone ? document.querySelector('.fab-entry')?.getBoundingClientRect() : undefined
  return {
    el, side, offset,
    inDialog: !!el.closest('[role="dialog"]'),
    padding: {
      top: 8, left: 8,
      right: fab && side === 'top' ? W - fab.left + 8 : 8,
      bottom: bars !== null && side !== 'top' ? H - bars + 8 : 8,
    },
  }
}

const samePlace = (a: Placed | null, b: Placed | null) =>
  a === b || (!!a && !!b && a.el === b.el && a.side === b.side && a.offset === b.offset && a.inDialog === b.inDialog
    && a.padding.right === b.padding.right && a.padding.bottom === b.padding.bottom)

/** a z-index token as the number the Popover wants */
function zToken(name: string, fallback: number): number {
  const v = parseInt(getComputedStyle(document.documentElement).getPropertyValue(name), 10)
  return Number.isFinite(v) ? v : fallback
}

const surfaceName = (m: WorkspaceMode) => (m === 'map' ? appConfig.copy.navRail.map : appConfig.copy.modes[m])
const minutes = (ms: number) => { const t = Math.round(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` }

/** the progress dots: `at` done · the current one wide (none during the ✓) · to come */
function Dots({ n, at, label, current = true }: { n: number; at: number; label: string; current?: boolean }) {
  return (
    <div className={s.dots}>
      {Array.from({ length: n }, (_, i) => <span key={i} className={cx(s.dot, i < at && s.dotDone, current && i === at && s.dotNow)} />)}
      <span className={s.dotsOf}>{label}</span>
    </div>
  )
}

/** a short ring around the control «Zeigen» named – no scrim, gone by itself */
function Ring({ el, onEnd }: { el: HTMLElement; onEnd: () => void }) {
  const r = el.getBoundingClientRect()
  useEffect(() => { const t = setTimeout(onEnd, 1800); return () => clearTimeout(t) }, [onEnd])
  return <span className={s.ring} aria-hidden style={{ left: r.left - 4, top: r.top - 4, width: r.width + 8, height: r.height + 8 }} />
}

export function TutorialLayer({ run }: { run: TutorialRun }) {
  const C = appConfig.copy.tutorialRun
  const phone = useIsPhone()
  const pillRef = useRef<HTMLDivElement>(null)
  const [listOpen, setListOpen] = useState(false)
  const [ring, setRing] = useState<HTMLElement | null>(null)
  const [placed, setPlaced] = useState<Placed | null>(null)
  const title = appConfig.copy.tutorials.titles[run.id]
  const total = run.steps.length
  const bubbleOn = run.phase !== 'end' && !listOpen

  // the page heads move down by the pill's height on a phone (O4)
  useEffect(() => {
    const root = document.documentElement
    root.dataset.tutPill = ''
    return () => { delete root.dataset.tutPill }
  }, [])

  // re-find the control on an interval: the rail folds, a sheet opens over it, a tile re-renders
  const anchorKey = run.anchors.join(' ')
  useEffect(() => {
    if (!bubbleOn) return
    const anchors = anchorKey ? (anchorKey.split(' ') as TutAnchor[]) : []
    const look = () => {
      const next = place(anchors, pillRef.current, phone)
      setPlaced((prev) => (samePlace(prev, next) ? prev : next))
    }
    look()
    const t = setInterval(look, ANCHOR_POLL_MS)
    window.addEventListener('resize', look)
    return () => { clearInterval(t); window.removeEventListener('resize', look) }
  }, [anchorKey, bubbleOn, phone])

  const cur = run.steps[run.step]
  const words = cur ? stepWords(run.id, cur.id) : null
  const tickedWords = run.ticked !== null ? stepWords(run.id, run.steps[run.ticked].id) : null
  const nextWords = run.ticked !== null && run.steps[run.ticked + 1] ? stepWords(run.id, run.steps[run.ticked + 1].id) : null
  const pillN = Math.min(run.step + 1, total)

  const bubble = bubbleOn && placed && words && (
    <Popover
      open anchor={placed.el} side={placed.side} align="center" sideOffset={placed.offset}
      collisionPadding={placed.padding} guard={false} takeFocus={false}
      zIndex={placed.inDialog ? zToken('--z-tutorial-sheet', 86) : zToken('--z-tutorial', 52)}
      popupClassName={s.bubble} arrowClassName={s.arrow} ariaLabel={title}
    >
      {run.phase === 'tick' && tickedWords ? (
        <div className={s.tick} role="status">
          <div className={s.tickHead}><span className={s.tickMark}><Icon id="check" /></span>{tickedWords.done}</div>
          {nextWords && <div className={s.hint}>{fillTemplate(C.soon, { step: nextWords.title })}</div>}
          <Dots n={total} at={(run.ticked ?? 0) + 1} current={false} label={fillTemplate(C.stepOf, { n: String((run.ticked ?? 0) + 1), m: String(total) })} />
        </div>
      ) : (
        <>
          <Dots n={total} at={run.step} label={fillTemplate(C.stepOf, { n: String(pillN), m: String(total) })} />
          {run.away ? (
            <>
              <div className={s.instr}>{fillTemplate(C.goTo, { surface: surfaceName(run.away) })}</div>
              <div className={s.hint}>{phone ? C.goToHint : C.goToHintRail}</div>
            </>
          ) : (
            <>
              <div className={s.instr}>{words.instruction}</div>
              <div className={s.hint}>{(phone && words.hintPhone) || words.hint}</div>
            </>
          )}
          <div className={s.acts}>
            {cur.done === 'manual'
              ? <Button variant="primary" onClick={run.confirm}>{C.next}</Button>
              : <Button variant="quiet" onClick={run.skip}><Icon id="skipfwd" />{C.skip}</Button>}
          </div>
        </>
      )}
    </Popover>
  )

  return (
    <>
      {run.phase !== 'end' && (
        <div ref={pillRef} className={s.pill}>
          <button type="button" className={s.pillOpen} onClick={() => setListOpen(true)} aria-haspopup="dialog"
            aria-label={`${fillTemplate(C.pill, { n: String(pillN), m: String(total) })} · ${C.pillOpen}`}>
            <span className={s.pillGlyph}><Icon id="learn" /></span>
            {fillTemplate(C.pill, { n: String(pillN), m: String(total) })}
          </button>
          <span className={s.pillSep} aria-hidden />
          <button type="button" className={s.pillX} onClick={run.pause} aria-label={C.pause} title={C.pause}><Icon id="close" /></button>
        </div>
      )}
      {bubble}
      {ring && <Ring el={ring} onEnd={() => setRing(null)} />}
      <Sheet open={listOpen} onClose={() => setListOpen(false)} fit
        title={<span className={s.listHead}><span className={s.listEyebrow}>{fillTemplate(C.pill, { n: String(pillN), m: String(total) })}</span>{title}</span>}
        footer={<Button onClick={() => { setListOpen(false); run.quit() }}>{C.quit}</Button>}>
        <ListCard className={s.list}>
          {run.steps.map((st, i) => {
            const w = stepWords(run.id, st.id)
            const done = i < run.step && !run.skipped.includes(i)
            const lead = <span className={cx(s.num, done && s.numDone, i === run.step && s.numNow)}>{done ? <Icon id="check" /> : i + 1}</span>
            const tag = st.done === 'manual' ? ` · ${C.manualTag}` : run.skipped.includes(i) ? ` · ${C.skippedTag}` : ''
            if (i !== run.step) {
              return <ListRow key={st.id} lead={lead} title={`${w.title}${tag}`} chevron={false}
                className={cx(done && s.rowDone)} onClick={() => { run.goTo(i); setListOpen(false) }} />
            }
            return (
              <ListRow key={st.id} lead={lead} title={w.title} className={s.rowNow} aria-current="step">
                <span className={s.rowHint}>{(phone && w.hintPhone) || w.hint}</span>
                <span className={s.rowActs}>
                  <Button onClick={() => {
                    setListOpen(false)
                    const el = run.anchors.map((a) => findAnchor(a)).find((e) => e && e.getClientRects().length > 0)
                    if (el) setRing(el)
                  }}><Icon id="locate" />{C.show}</Button>
                  {st.done === 'manual'
                    ? <Button variant="primary" onClick={() => { setListOpen(false); run.confirm() }}>{C.next}</Button>
                    : <Button variant="quiet" onClick={() => { setListOpen(false); run.skip() }}><Icon id="skipfwd" />{C.skip}</Button>}
                </span>
              </ListRow>
            )
          })}
        </ListCard>
      </Sheet>
      {run.phase === 'end' && <DoneCard run={run} title={title} />}
    </>
  )
}

/** G = A: the card in place of the bubble, the Übung behind it */
function DoneCard({ run, title }: { run: TutorialRun; title: string }) {
  const C = appConfig.copy.tutorialRun
  const D = C.done
  const [busy, setBusy] = useState(false)
  const doneSteps = run.steps.filter((_, i) => !run.skipped.includes(i) && (!run.endedEarly || i < run.step))
  const next = run.nextTutorial
  return (
    <section className={s.done} role="dialog" aria-modal="false" aria-label={fillTemplate(run.endedEarly ? D.ended : D.title, { title })}>
      <div className={s.doneHead}>
        <span className={cx(s.doneMark, run.endedEarly && s.doneMarkEnded)}><Icon id={run.endedEarly ? 'flag' : 'check'} /></span>
        <div className={s.doneText}>
          <h2 className={s.doneTitle}>{fillTemplate(run.endedEarly ? D.ended : D.title, { title })}</h2>
          {run.elapsedMs > 0 && (
            <div className={s.doneSub}>{fillTemplate(D.sub, { n: String(doneSteps.length), m: String(run.steps.length), t: minutes(run.elapsedMs) })}</div>
          )}
        </div>
        <button type="button" className="ip-x" onClick={run.close} aria-label={D.close} title={D.close}><Icon id="close" /></button>
      </div>
      {!run.endedEarly && (
        <ul className={s.doneList}>
          {run.steps.map((st, i) => (
            <li key={st.id} className={cx(run.skipped.includes(i) && s.doneSkipped)}>
              <Icon id={run.skipped.includes(i) ? 'skipfwd' : 'check'} />{stepWords(run.id, st.id).title}
            </li>
          ))}
        </ul>
      )}
      {run.lern ? (
        <>
          <p className={s.doneNote}>{fillTemplate(D.uebungNote, { incident: run.incidentTitle })}</p>
          <div className={s.doneActs}>
            <Button variant="primary" size="lg" className={s.doneDelete} disabled={busy}
              onClick={() => { setBusy(true); void run.deleteUebung().finally(() => setBusy(false)) }}>
              <Icon id="trash" />{D.delete}
            </Button>
            <Button size="lg" onClick={run.close}>{D.keep}</Button>
          </div>
        </>
      ) : (
        <div className={s.doneActs}><Button size="lg" block onClick={run.close}>{D.close}</Button></div>
      )}
      {next && (
        <ListRow className={s.doneNext} lead={<Icon id="learn" />}
          title={`${D.continueWith}: ${appConfig.copy.tutorials.titles[next]}`}
          end={fillTemplate(appConfig.copy.tutorials.minutes, { n: String(tutorialMeta(next).minutes) })}
          onClick={run.continueWith} />
      )}
    </section>
  )
}
