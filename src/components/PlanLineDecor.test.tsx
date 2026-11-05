// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { PlanLineDecor } from './PlanLineDecor'
import type { BoardAnno } from '../types'
import { tagSize } from '../lib/endTagSpots'

afterEach(cleanup)

// Sweep 28.10.2026 #8b (owner pick «pin to line»): the «+2» end tag sits on its line at every
// zoom. Its old nudge was in sheet units – it grew with the zoom – and a Karte line brought the
// ground point of its tag, so the tag floated off the line.
describe('PlanLineDecor — the end tag is pinned to its line', () => {
  const line: BoardAnno = { id: 'l1', kind: 'draw', pts: [[0.1, 0.5], [0.5, 0.5]], lineNo: 1, floorTag: 2, endDx: 0.3, endDy: -0.2 }
  const tagAt = (zoom: number) => {
    const sW = 1000 * zoom, sH = 800 * zoom
    const { container } = render(
      <PlanLineDecor a={line} sW={sW} sH={sH} mapY={(_f, y) => y} onSection={() => true} trupps={[]}
        planMetres={() => null} tool="pan" labelDown={vi.fn()} labelMove={vi.fn()} labelUp={vi.fn()} />,
    )
    const tag = container.querySelector('.line-end-tag')
    expect(tag?.textContent).toBe('1 · +2')
    const m = /translate\(([\d.-]+)px, ([\d.-]+)px\)/.exec((tag!.parentElement as HTMLElement).style.transform)!
    cleanup()
    return { x: Number(m[1]), y: Number(m[2]), endX: 0.5 * sW, lineY: 0.5 * sH }
  }

  // …and beside the END, its near edge 4 px short of it, so an arrowhead stays visible (hill climb r16)
  it('beside the end, a fixed 4 px short of it and 14 px above the stroke, whatever the stored nudge says', () => {
    for (const zoom of [1, 4]) {
      const t = tagAt(zoom)
      expect(t.endX - (t.x + tagSize('1 · +2').w / 2)).toBeCloseTo(4)
      expect(t.lineY - t.y).toBe(14)
    }
  })
})
