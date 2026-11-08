/*
 * *ONE page head, ONE ROW* (28.09.2026, owner: «fix the headers, especially the one from the
 * trupps, which occupies way too much vertical space … as much space for the actual content as
 * possible»). Trupps (the Atemschutz-Link board too), Anwesenheit, Material, Checkliste and
 * Rapport wear one shape at every width ≥ 360: the titles block left — the `<h2>` and AT MOST
 * one quiet line under it («✓ Gespeichert», the counts, the Checkliste's subtitle) — the tiles
 * right, the title on the tiles' centre line (r23); `--tap` + `--head-pad-y` above and below (60px on a phone, 68
 * above; Surface.module.css · `.head`, tokens · `--head-*`). What does not fit gives up WORDS,
 * MEASURED, never per breakpoint (`lib/pageHeadFit` · `usePageHeadFit`, on the top bar's
 * `climbLadder`): (1) the quiet line's time («Gespeichert um 23:21» → «Gespeichert»), (2) each
 * tile's word, lowest priority first — the glyph stays, the word is already its aria-label/title
 * so the hold-tooltip says it, a count stays with its glyph («⚠ 4»), (3) the one primary tile
 * shortens («+ Trupp anmelden» → «+ Trupp»; it keeps its word and its fill), then a head's own
 * last words (the quiet «✓ Gespeichert» keeps its ✓ — a LOUD sync state never folds; the
 * Rapport's title says the nav's «Rapport»), and only as the LAST resort (≤ 359px, a locale that
 * cannot fit) the tiles take a second row (`data-fit-wrap`). Each head states its ladder where
 * its tiles are drawn — `data-fold="<rank>"` on the part, `.fold-long` / `.fold-short` inside
 * it (`HEAD_FOLD` in AtemschutzView / AnwesenheitView, `RP_FOLD` in ReportPreflight); text that
 * must never be cut wears `data-fit-check`, and every `<h2>` is checked. A new tile takes a rank
 * in that ladder — never a `useIsPhone` word switch, never a `@media` that drops a label, never
 * a row of its own. The 27.09. «Trupps head: the title line, then the tile row under it» (a
 * 121px phone head, 190 on the 820 tablet with «+ Trupp anmelden» wrapped to a third row) is
 * superseded, and so is «icons below 1080px» on the Rapport. The one tile family stays:
 * `.headTile` (Atemschutz.module.css) / `.head-tile` (13-incident.css).
 */

import type { RefObject } from 'react'
import { climbLadder, useHeadFit } from './useHeadFit'

/**
 * The PAGE HEAD's ladder (28.09.2026, owner: «fix the headers … as much space for the actual
 * content as possible») — Trupps, Anwesenheit, Material, Checkliste and Einsatzrapport, the
 * Atemschutz-Link board included.
 *
 * A page head is ONE ROW: the titles block on the left (the <h2> and at most one quiet line
 * under it — «✓ Gespeichert», the counts), the tiles on the right, the title on their centre line. What
 * does not fit gives up WORDS, measured rather than ruled per breakpoint — the top bar's way
 * (lib/useHeadFit), on the same `climbLadder`:
 *
 *   1. the quiet line drops its time («Gespeichert um 23:21» → «Gespeichert»),
 *   2. the tiles drop their word one at a time, lowest priority first — the icon stays, the word
 *      is already the tile's aria-label/title, so the hold-tooltip still says it; a count stays
 *      with its icon («⚠ 4»),
 *   3. the one primary tile shortens («+ Trupp anmelden» → «+ Trupp»; it keeps its word and fill),
 *   4. the quiet line keeps its MARK («✓» — the sentence stays its `title`, and a LOUD state never
 *      folds: it is not a quiet line). That is the handed-over phone board's quiet state since
 *      09.09., and what buys the 390px Trupps head its one row while an alarm tile stands,
 *   5. the tiles close up: 6px apart and 8px inside a worded tile (`data-fit-tight` — the top bar's
 *      «gaps» rung; every tile stays a tap wide), which is what fits a 360px phone,
 *   6. only then — ≤ 359px, or a locale that cannot fit — the tiles take a second row (and open up
 *      again: that row has the room).
 *
 * The contract is markup, so every head states its own ladder where its tiles are drawn:
 *   - `data-fold="<rank>"` on each part that can give (the quiet line, a tile). Lower ranks give
 *     first; parts sharing a rank give together. The ranks PRESENT are the steps — a tile that is
 *     not rendered (no alarm, nothing deleted) costs no step. A part that gives twice lists two
 *     ranks (`data-fold="1 8"`: the time first, the word much later).
 *   - inside it, `.fold-long` is what shows until the part is folded and `.fold-short` what shows
 *     after; at its second rank the short goes too and the glyph stands alone (13-incident.css ·
 *     «fold»). A tile that goes icon-only has no `.fold-short`.
 *   - `data-fit-check` on text that must not be cut (a sync line, the Rapport's chip label); every
 *     <h2> in the head is checked anyway, except one marked `data-fit-free` (a title that is
 *     SUPPOSED to truncate, like the handed-over phone board's Einsatz name).
 * The head gets `data-folded="<level>"` on each folded part (how many of its ranks have come),
 * `data-fit="<step>"` on itself, `data-fit-tight` at the step before last and `data-fit-wrap` at the
 * last (Surface.module.css · the wrap).
 */

/** The fold ranks present, ascending and distinct: one ladder step each, then the second row. */
export function foldRanks(ranks: readonly number[]): number[] {
  return [...new Set(ranks.filter((r) => Number.isFinite(r)))].sort((a, b) => a - b)
}

/** A part's own ranks, from its `data-fold` («1» or «1 8»). */
export function partRanks(attr: string | undefined): number[] {
  return (attr ?? '').split(/\s+/).filter(Boolean).map(Number).filter((r) => Number.isFinite(r))
}

/**
 * How far a part with these ranks has folded at `step` (0 = not at all, 1 = its first word gone,
 * 2 = its second …). `ranks` is the head's whole ladder (foldRanks); steps past it fold everything.
 */
export function foldLevel(ranks: readonly number[], step: number, own: readonly number[]): number {
  if (step <= 0 || !ranks.length) return 0
  const reached = ranks[Math.min(step, ranks.length) - 1]
  return own.filter((r) => r <= reached).length
}

/** Does the head NOT fit — something painting past its edge, or a title / checked text cut? */
export function pageHeadCrowded(head: HTMLElement): boolean {
  if (head.scrollWidth > head.clientWidth + 1) return true
  for (const el of head.querySelectorAll<HTMLElement>('h2:not([data-fit-free]), [data-fit-check]')) {
    if (el.offsetParent === null) continue
    if (el.scrollWidth > el.clientWidth + 1) return true
    // a checked line ellipsizes in its last span (the sync line's word, the chip's count)
    for (const c of el.querySelectorAll<HTMLElement>(':scope span')) {
      if (c.offsetParent !== null && c.clientWidth > 0 && c.scrollWidth > c.clientWidth + 1) return true
    }
  }
  return false
}

/** Fold step by step until the head fits; returns the step it stopped at (0 = nothing folded). */
export function fitPageHead(head: HTMLElement, crowded: (head: HTMLElement) => boolean = pageHeadCrowded): number {
  const parts = [...head.querySelectorAll<HTMLElement>('[data-fold]')].map((el) => ({ el, own: partRanks(el.dataset.fold) }))
  const ranks = foldRanks(parts.flatMap((p) => p.own))
  return climbLadder(ranks.length + 2, (step) => {
    for (const { el, own } of parts) {
      const level = foldLevel(ranks, step, own)
      if (level) el.dataset.folded = String(level)
      else delete el.dataset.folded
    }
    head.toggleAttribute('data-fit-tight', step === ranks.length + 1)
    head.toggleAttribute('data-fit-wrap', step > ranks.length + 1)
    head.dataset.fit = String(step)
  }, () => crowded(head))
}

/** Keep a page head fitted — on `key`, on a resize, and whenever its own width changes. */
export function usePageHeadFit(ref: RefObject<HTMLElement | null>, key: string) {
  useHeadFit(ref, key, fitPageHead, true)
}
