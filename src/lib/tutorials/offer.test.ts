import { describe, expect, it } from 'vitest'
import { TUTORIALS } from './catalogue'
import { filterTutorials, helpTutorials, offeredTutorials } from './offer'

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
  it('narrows a function chip to exactly its track – the «für alle» ones stay under «Alle»', () => {
    const all = offeredTutorials(editor, withVisits)
    expect(filterTutorials(all, 'all')).toHaveLength(15)
    expect(filterTutorials(all, 'fu').map((t) => t.id)).not.toContain('zurechtfinden')
    expect(filterTutorials(all, 'as').map((t) => t.id)).toEqual(['trupps', 'notfall'])
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
