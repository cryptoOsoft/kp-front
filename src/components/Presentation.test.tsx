// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { appConfig } from '../config/appConfig'
import type { Follow, PresentationState } from '../lib/presentation'
import type { Presentation } from '../workspace/usePresentation'
import { PresentationPill } from './Presentation'

const state: PresentationState = {
  active: true, id: 'p1', seq: 3, started_at: '2026-11-05T20:00:00Z',
  presenter: { client: 'pc1', name: 'Bastian', link: false },
  participants: [], view: null, messages: [],
}

function pill(kind: Follow['kind'], over: Partial<Presentation> = {}) {
  const p = {
    available: true, canStart: false, follow: { kind, id: 'p1' }, state, zeigen: false, mapRings: [], board: undefined,
    isLink: false, start: vi.fn(), end: vi.fn(), followNow: vi.fn(), leave: vi.fn(), toggleZeigen: vi.fn(), ...over,
  } satisfies Presentation
  render(<PresentationPill p={p} />)
  return p
}

describe('the presentation pill', () => {
  afterEach(() => { cleanup(); localStorage.clear() })
  const C = () => appConfig.copy.presentation

  it('asks a link holder for a name once, then follows under it', () => {
    const p = pill('invited', { isLink: true })
    fireEvent.click(screen.getByRole('button', { name: new RegExp(C().follow) }))
    expect(p.followNow).not.toHaveBeenCalled()
    fireEvent.change(screen.getByPlaceholderText(C().namePlaceholder), { target: { value: 'Sandra Meier' } })
    fireEvent.click(screen.getByRole('button', { name: new RegExp(C().follow) }))
    expect(p.followNow).toHaveBeenCalledWith('Sandra Meier')
  })

  it('a logged-in follower is not asked', () => {
    const p = pill('invited')
    fireEvent.click(screen.getByRole('button', { name: new RegExp(C().follow) }))
    expect(p.followNow).toHaveBeenCalledWith()
  })

  it('a detached follower gets one chip back to the presenter, nothing else', () => {
    const p = pill('detached')
    const back = screen.getByRole('button', { name: new RegExp(C().followAgain) })
    expect(screen.getAllByRole('button')).toHaveLength(1)
    fireEvent.click(back)
    expect(p.followNow).toHaveBeenCalled()
  })

  it('offline or nothing running: no pill at all', () => {
    pill('invited', { available: false })
    expect(screen.queryByRole('region')).toBeNull()
  })
})
