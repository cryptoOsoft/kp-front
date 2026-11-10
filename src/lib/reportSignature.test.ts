import { describe, expect, it } from 'vitest'
import { mergeWorkspace } from './mergeWorkspace'
import { buildDirectReportPayload, signedPartOf } from './reportPdfDirect'
import {
  activeSignatures, addSignature, canonicalJson, isBlank, sha256Hex,
  shortChecksum, signatureScope, signatureState, strokesPath, voidAll, type ReportSignature,
} from './reportSignature'
import type { TimelineEvent } from '../types'

const strokes = { w: 1000, h: 300, d: [[10, 200, 60, 120, 120, 210, 200, 150]] }
const sig = (over: Partial<ReportSignature> = {}): ReportSignature => ({
  id: 'g1', role: 'el', name: 'Widmer Céline', at: '2026-10-15T02:12:00.000Z', scope: 'aaa', strokes, ...over,
})

describe('reportSignature · the record', () => {
  it('keeps the newest live signature per role and skips voided ones', () => {
    const list = [
      sig({ id: 'a', at: '2026-10-15T02:00:00.000Z' }),
      sig({ id: 'b', at: '2026-10-15T02:30:00.000Z' }),
      sig({ id: 'c', at: '2026-10-15T03:00:00.000Z', voidedAt: '2026-10-15T03:10:00.000Z', voidReason: 'aendern' }),
      sig({ id: 'k', role: 'kdt', name: 'Keller Urs' }),
    ]
    const a = activeSignatures(list)
    expect(a.el?.id).toBe('b')
    expect(a.kdt?.id).toBe('k')
  })

  it('signing a role again marks the older one replaced — nothing is ever deleted', () => {
    const next = addSignature([sig({ id: 'old' })], sig({ id: 'new', at: '2026-10-15T04:00:00.000Z' }))
    expect(next).toHaveLength(2)
    expect(next[0]).toMatchObject({ id: 'old', voidReason: 'replaced', voidedAt: '2026-10-15T04:00:00.000Z' })
    expect(activeSignatures(next).el?.id).toBe('new')
  })

  it('«Ändern» voids every live signature and keeps the history', () => {
    const out = voidAll([sig(), sig({ id: 'k', role: 'kdt' }), sig({ id: 'x', voidedAt: '2026-10-14T00:00:00.000Z', voidReason: 'replaced' })], '2026-10-15T05:00:00.000Z', 'aendern')
    expect(out.map((g) => g.voidReason)).toEqual(['aendern', 'aendern', 'replaced'])
    expect(out[2].voidedAt).toBe('2026-10-14T00:00:00.000Z')
    expect(activeSignatures(out)).toEqual({})
  })

  it('is valid while the signed part hashes the same, and «ungültig» once it does not', () => {
    expect(signatureState(sig(), 'aaa')).toBe('valid')
    expect(signatureState(sig(), 'bbb')).toBe('stale')
    // not computed yet: no flash of «ungültig» while the hash is on its way
    expect(signatureState(sig(), undefined)).toBe('valid')
  })

  it('the workspace merge keeps both devices\' signatures and an earlier void', () => {
    const base = { reportSignatures: [sig()] }
    const mine = { reportSignatures: [sig({ voidedAt: '2026-10-15T05:00:00.000Z', voidReason: 'aendern' })] }
    const theirs = { reportSignatures: [sig({ voidedAt: '2026-10-15T04:00:00.000Z', voidReason: 'replaced' }), sig({ id: 'k', role: 'kdt' })] }
    const out = mergeWorkspace(base, mine, theirs) as { reportSignatures: ReportSignature[] }
    expect(out.reportSignatures.map((g) => g.id).sort()).toEqual(['g1', 'k'])
    expect(out.reportSignatures.find((g) => g.id === 'g1')?.voidedAt).toBe('2026-10-15T04:00:00.000Z')
  })
})

describe('reportSignature · what is signed', () => {
  it('canonical JSON does not depend on key order and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: undefined } })).toBe('{"a":{"d":[1,{"x":1,"y":2}]},"b":1}')
    expect(canonicalJson({ a: { d: [1, { x: 1, y: 2 }] }, b: 1 })).toBe(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }] } }))
  })

  it('leaves the Beilagen, the print options, the Lehren and the Kommandant default out', () => {
    const base = { incident: { title: 'Brand' }, meta: { summary: 'Küche', lehren: 'x', kommandant: 'Keller Urs' }, personal: [{ name: 'A' }] }
    const withBeilagen = { ...base, journal: [{ text: 'spät' }], messungen: [{ name: 'Keller' }], messungenLimits: 'CO A1 ab 30', generatedAt: '15.10.2026 09:00', options: { journal: true }, auswertung: {}, meta: { ...base.meta, lehren: 'anders', kommandant: 'Stv' } }
    expect(signatureScope(withBeilagen)).toBe(signatureScope(base))
    expect(signatureScope({ ...base, personal: [{ name: 'A' }, { name: 'B' }] })).not.toBe(signatureScope(base))
    expect(signatureScope({ ...base, meta: { ...base.meta, summary: 'Küche, Wohnzimmer' } })).not.toBe(signatureScope(base))
  })

  it('hashes with SHA-256 and shortens to three groups of four', async () => {
    const h = await sha256Hex('abc')
    expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(shortChecksum(h)).toBe('ba78 16bf 8f01')
  })
})

describe('reportSignature · signedPartOf (the PDF payload\'s signed part)', () => {
  const incident = {
    id: 'i1', title: 'Brand', started_at: '2026-10-15T00:47:00.000Z', is_archived: true,
    closed_at: '2026-10-15T02:06:00.000Z', last_closed_at: '2026-10-15T02:06:00.000Z',
  } as never
  const args = (over: { summary?: string; events?: TimelineEvent[]; attendance?: Record<string, unknown> } = {}) => ({
    incident,
    draft: { meta: { summary: over.summary ?? 'Küche', einsatzleiter: 'Widmer Céline' }, generatedAt: '2026-10-15T02:20:00.000Z', proof: {}, options: { journal: true, attendance: true, mittel: true } } as never,
    trupps: [], attendance: (over.attendance ?? {}) as never, events: over.events ?? [], plans: [],
    roster: [{ id: 'p1', name: 'Amrein Patrick' }, { id: 'p2', name: 'Bachmann Reto' }],
  })

  it('a late Journal row is a Nachtrag, not a change to what was signed', () => {
    const late: TimelineEvent = { id: 'r', t: '', at: '2026-10-15T03:00:00.000Z', icon: 'radio', text: 'Funk spät', kind: 'journal', receivedAfterClose: true }
    expect(signedPartOf(args({ events: [late] }))).toBe(signedPartOf(args()))
  })

  it('a changed Kurzbericht or a person added to the Anwesenheit changes it', () => {
    expect(signedPartOf(args({ summary: 'Keller' }))).not.toBe(signedPartOf(args()))
    const present = { p2: { status: 'present', in: '2026-10-15T00:55:00.000Z' } }
    expect(signedPartOf(args({ attendance: present }))).not.toBe(signedPartOf(args()))
  })

  it('the printed payload carries the signatures it was given', () => {
    const printed = [{ role: 'el' as const, name: 'Widmer Céline', placeDate: 'Oberwil, 15.10.2026', at: '15.10.2026 04:12', checksum: '3fa9 c210 7be1', strokes }]
    const out = buildDirectReportPayload({ ...args(), signatures: printed }) as { signatures: unknown[] }
    expect(out.signatures).toEqual(printed)
  })
})

describe('reportSignature · strokes', () => {
  it('draws quadratic segments through the midpoints; a single point is a dot', () => {
    expect(strokesPath({ w: 10, h: 10, d: [[0, 0, 2, 2, 4, 0]] })).toBe('M0 0Q2 2 3 1L4 0')
    expect(strokesPath({ w: 10, h: 10, d: [[5, 5]] })).toBe('M5 5h0.1')
  })

  it('nothing drawn, or only dots, is not a signature', () => {
    expect(isBlank(null)).toBe(true)
    expect(isBlank({ w: 1, h: 1, d: [[1, 1]] })).toBe(true)
    expect(isBlank(strokes)).toBe(false)
  })
})
