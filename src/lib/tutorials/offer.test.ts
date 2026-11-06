import { describe, expect, it } from 'vitest'
import { TUTORIALS } from './catalogue'
import { filterTutorials, helpTutorials, offeredTutorials, pinnedTutorial } from './offer'

const editor = { role: 'editor' as const, linkScoped: false }
const withVisits = { objectVisits: true }

describe('offeredTutorials – who may practise what', () => {
  it('offers nothing to a link session', () => {
    expect(offeredTutorials({ role: 'editor', linkScoped: true }, withVisits)).toEqual([])
  })

  it('gives a viewer only what needs no Lern-Übung', () => {
    const ids = offeredTutorials({ role: 'viewer', linkScoped: false }, withVisits).map((t) => t.id)
    expect(ids).toEqual(['zurechtfinden', 'nachschlagen', 'objektbesuch'])
  })

  it('hides the Objektbesuch where the module is off, keeps catalogue order', () => {
    const ids = offeredTutorials({ role: 'el', linkScoped: false }, { objectVisits: false }).map((t) => t.id)
    expect(ids).not.toContain('objektbesuch')
    expect(ids).toEqual(TUTORIALS.filter((t) => t.id !== 'objektbesuch').map((t) => t.id))
  })
})

describe('filterTutorials', () => {
  it('gives a function chip its own track plus the «Für alle» ones', () => {
    const all = offeredTutorials(editor, withVisits)
    expect(filterTutorials(all, 'all')).toHaveLength(15)
    expect(filterTutorials(all, 'fu')).toHaveLength(15)
    expect(filterTutorials(all, 'el')).toHaveLength(8)
    expect(filterTutorials(all, 'as').map((t) => t.id)).toEqual(['zurechtfinden', 'trupps', 'notfall', 'nachschlagen', 'objektbesuch'])
    expect(filterTutorials(offeredTutorials(editor, { objectVisits: false }), 'fu')).toHaveLength(14)
  })
})

describe('pinnedTutorial', () => {
  const all = offeredTutorials(editor, withVisits)
  it('pins nothing without a run to finish', () => {
    expect(pinnedTutorial(all, { lageZeichnen: { doneAt: '2026-11-06T00:00:00Z' } }, null)).toBeNull()
  })
  it('pins the running one over a stored resume point, else the first interrupted one', () => {
    const progress = { planGebaeude: { step: 2 }, verlauf: { step: 1 } }
    expect(pinnedTutorial(all, progress, null)?.id).toBe('planGebaeude')
    expect(pinnedTutorial(all, progress, { id: 'verlauf', step: 3 })?.id).toBe('verlauf')
  })
})

describe('helpTutorials – the Hilfe section map', () => {
  const all = offeredTutorials(editor, withVisits)
  it('maps Atemschutz to both of its tutorials, in order', () => {
    expect(helpTutorials('atemschutz', all).map((t) => t.id)).toEqual(['trupps', 'notfall'])
  })
  it('maps nothing for a section without a tutorial, or one this session may not start', () => {
    expect(helpTutorials('verwaltung', all)).toEqual([])
    expect(helpTutorials('lage', offeredTutorials({ role: 'viewer', linkScoped: false }, withVisits))).toEqual([])
  })
})
