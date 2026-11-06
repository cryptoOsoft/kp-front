// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pollWorkspaceSince } from './api/workspace'
import { presentationMarker, resetPresentationMarkers, setPresentationMarker } from './presentationMarker'

function answer(marker: string | null) {
  const headers = new Headers({ 'X-Incident-Open': '1' })
  if (marker !== null) headers.set('X-Presentation', marker)
  return new Response(null, { status: 304, headers })
}

describe('the workspace follow carries the presentation marker', () => {
  afterEach(() => { resetPresentationMarkers(); vi.unstubAllGlobals() })

  it('asks with what it holds – «none» when it never heard – and keeps what the server says', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => answer('p1'))
    vi.stubGlobal('fetch', fetch)
    await pollWorkspaceSince('inc-1', 3, { wait: true })
    expect(String(fetch.mock.calls[0][0])).toContain('presentation=none')
    expect(presentationMarker('inc-1')).toBe('p1')

    fetch.mockImplementation(async () => answer('none'))
    await pollWorkspaceSince('inc-1', 3, { wait: true })
    expect(String(fetch.mock.calls[1][0])).toContain('presentation=p1')
    expect(presentationMarker('inc-1')).toBeNull()
  })

  it('an answer without the header (an older backend) changes nothing', async () => {
    setPresentationMarker('inc-1', 'p1')
    vi.stubGlobal('fetch', vi.fn(async () => answer(null)))
    await pollWorkspaceSince('inc-1', 3, { wait: true })
    expect(presentationMarker('inc-1')).toBe('p1')
  })
})
