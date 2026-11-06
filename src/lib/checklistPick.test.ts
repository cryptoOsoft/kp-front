// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { checklistPick, onChecklistShow, readPicked, showChecklist, subscribeChecklistPick, writePicked } from './checklistPick'

describe('the open Checkliste, driven from outside', () => {
  it('a presenter\'s pick is heard; a follower is put on it with the list open', () => {
    const heard = vi.fn()
    const off = subscribeChecklistPick(heard)
    writePicked('inc-a', { sel: { kind: 'tpl', id: 'fu' }, railOpen: true })
    writePicked('inc-a', { railOpen: false }) // the same pick: no news
    expect(heard).toHaveBeenCalledTimes(1)
    off()

    const shown = vi.fn()
    const stop = onChecklistShow('inc-b', shown)
    showChecklist('inc-b', { kind: 'entry', id: 'brand' })
    expect(shown).toHaveBeenCalledWith({ kind: 'entry', id: 'brand' })
    expect(checklistPick('inc-b')).toEqual({ kind: 'entry', id: 'brand' })
    expect(readPicked('inc-b')?.railOpen).toBe(false)
    stop()
    // not mounted: stored, so the surface opens on it next time
    showChecklist('inc-b', { kind: 'tpl', id: 'lage' })
    expect(shown).toHaveBeenCalledTimes(1)
    expect(checklistPick('inc-b')).toEqual({ kind: 'tpl', id: 'lage' })
  })
})
