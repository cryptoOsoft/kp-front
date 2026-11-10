// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TafelPendenzen } from './TafelPendenzen'
import { Cell } from './TafelFormPage'
import { clearAllDrafts } from '../lib/draftKeep'
import { BUNDLED_TEMPLATES } from '../lib/boardTemplates'
import type { LiveSection } from '../lib/boardTemplate'
import type { PendenzenPort } from '../lib/pendenzenPage'
import type { TimelineEvent } from '../types'

afterEach(() => { cleanup(); clearAllDrafts() })

const SEC = BUNDLED_TEMPLATES[0].pages.find((p) => p.id === 'pendenzen')!.sections[0] as LiveSection
const done: TimelineEvent = { id: 'j2', t: '', at: '2026-11-05T13:18:00.000Z', icon: 'check', text: 'erledigt', kind: 'reminder', reminder: { op: 'done', id: 'b' } }
const created: TimelineEvent = { id: 'j1', t: '', at: '2026-11-05T13:09:00.000Z', icon: 'type', text: 'Auftrag · Wasserbezug', kind: 'journal', reminder: { op: 'created', id: 'b', text: 'Wasserbezug melden' } }

const port = (over: Partial<PendenzenPort> = {}): PendenzenPort => ({
  timeline: [done, created], canWrite: true, author: 'EL',
  setDone: vi.fn(), edit: vi.fn(), showInVerlauf: vi.fn(),
  create: vi.fn(() => ({ rowId: 'j9', at: '2026-11-05T13:31:00.000Z' })),
  ...over,
})
const active = () => document.activeElement as HTMLTextAreaElement
const type = (text: string) => fireEvent.change(active(), { target: { value: text } })
const key = (k: string) => act(() => { fireEvent.keyDown(active(), { key: k }) })

describe('the «Aufträge / Pendenzen» page', () => {
  it('a row typed on it becomes ONE Pendenz with Was and Wer, on Enter', () => {
    const p = port()
    render(<TafelPendenzen Cell={Cell} sec={SEC} port={p} isPhone={false} pageTitle="Aufträge / Pendenzen" />)
    act(() => { screen.getByPlaceholderText('Neue Pendenz …').focus() })
    type('Gemeinde informieren'); key('Tab')
    expect(p.create).not.toHaveBeenCalled() // still in the row: Wer is next
    type('EL'); key('Enter')
    expect(p.create).toHaveBeenCalledTimes(1)
    expect(p.create).toHaveBeenCalledWith({ text: 'Gemeinde informieren', assignee: 'EL', urgent: false }, 'Aufträge / Pendenzen')
    expect(screen.getByRole('status').textContent).toMatch(/Als Pendenz im Verlauf eingetragen · \d\d:\d\d · EL/)
    expect(active().placeholder).toBe('Neue Pendenz …') // the next empty row takes the caret
  })

  // Sweep 09.11.2026, UX.13: a letter and a tap elsewhere made a Verlauf record nobody can take back
  it('a tap elsewhere files nothing: the words wait in the row, across a page switch too', () => {
    const p = port()
    const page = render(<TafelPendenzen Cell={Cell} sec={SEC} port={p} isPhone={false} pageTitle="P" />)
    act(() => { screen.getByPlaceholderText('Neue Pendenz …').focus() })
    type('Gem')
    act(() => { active().blur() })
    expect(p.create).not.toHaveBeenCalled()
    expect((screen.getByPlaceholderText('Neue Pendenz …') as HTMLTextAreaElement).value).toBe('Gem')

    page.unmount() // another Tafel page, another surface
    expect(p.create).not.toHaveBeenCalled()
    render(<TafelPendenzen Cell={Cell} sec={SEC} port={p} isPhone={false} pageTitle="P" />)
    const row = screen.getByPlaceholderText('Neue Pendenz …') as HTMLTextAreaElement
    expect(row.value).toBe('Gem')
    act(() => { row.focus() })
    key('Enter')
    expect(p.create).toHaveBeenCalledWith({ text: 'Gem', assignee: '', urgent: false }, 'P')
  })

  it('a done item stays, struck through; un-ticking its «Erledigt» takes it back', () => {
    const p = port()
    render(<TafelPendenzen Cell={Cell} sec={SEC} port={p} isPhone={false} pageTitle="P" />)
    const tick = screen.getAllByRole('checkbox', { name: /Erledigt/ })[0]
    expect(tick.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(tick)
    expect(p.setDone).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }), false)
  })

  it('a session that cannot write the Verlauf reads it: no empty row, ticks as read-outs', () => {
    render(<TafelPendenzen Cell={Cell} sec={SEC} port={port({ canWrite: false })} isPhone={false} pageTitle="P" />)
    expect(screen.queryByPlaceholderText('Neue Pendenz …')).toBeNull()
    for (const t of screen.getAllByRole('checkbox')) expect((t as HTMLButtonElement).disabled).toBe(true)
  })
})
