// Präsentationsmodus – the pure half: where this device stands in a presentation (the follow
// state machine), the fading pointer rings, the send throttle and the small naming helpers.
// The hook that runs it is workspace/usePresentation; the server's broker is
// backend/app/presentation; the rules are in docs/presentation.md.
//
// Nothing here is synced or stored: a presentation is a live way of LOOKING at the Einsatz
// together, so none of it reaches the workspace, the Verlauf or IndexedDB.

import type { Out } from './api/wire'

export type PresentationState = Out<'PresentationState'>
export type PresentedView = Out<'PresentationView'>
export type PointerAt = Out<'PresentationPointerAt'>
export type PointerMessage = Out<'PresentationPointerMessage'>
export type PresentationMessage = PresentationState['messages'][number]

// --- following ---------------------------------------------------------------------------

/**
 * This device's place in the presentation running on its Einsatz:
 *   none       – nothing running (no pill)
 *   presenting – this device presents («Du präsentierst · N folgen · Zeigen · Beenden»)
 *   invited    – somebody else presents, not joined («Bastian präsentiert · Folgen»)
 *   following  – joined and mirroring («Folgst Bastian · Zeigen · ✕»)
 *   detached   – joined, but panned or switched surface («Wieder folgen»)
 * `id` is the presentation it belongs to, so a new one (a takeover) starts over at `invited`.
 */
export interface Follow {
  kind: 'none' | 'presenting' | 'invited' | 'following' | 'detached'
  id: string | null
}

export type FollowEvent =
  /** a poll answered: what is running, and whether this device is its presenter */
  | { type: 'server'; id: string | null; mine: boolean }
  /** «Folgen» / «Wieder folgen» */
  | { type: 'follow' }
  /** ✕ on the follower pill */
  | { type: 'leave' }
  /** the follower panned, zoomed or switched surface by hand */
  | { type: 'moved' }

export const NOT_PRESENTING: Follow = { kind: 'none', id: null }

export function nextFollow(f: Follow, ev: FollowEvent): Follow {
  switch (ev.type) {
    case 'server':
      if (ev.id === null) return f.kind === 'none' ? f : NOT_PRESENTING
      if (ev.mine) return f.kind === 'presenting' && f.id === ev.id ? f : { kind: 'presenting', id: ev.id }
      // a new presentation, or this device's own was taken over: asked again, never auto-joined
      if (f.id !== ev.id || f.kind === 'presenting' || f.kind === 'none') return { kind: 'invited', id: ev.id }
      return f
    case 'follow':
      return f.kind === 'invited' || f.kind === 'detached' ? { ...f, kind: 'following' } : f
    case 'leave':
      return f.kind === 'following' || f.kind === 'detached' ? { ...f, kind: 'invited' } : f
    case 'moved':
      return f.kind === 'following' ? { ...f, kind: 'detached' } : f
  }
}

/** Joined the room (sends pointers, is counted, sees the others' rings). */
export const isJoined = (f: Follow) => f.kind === 'presenting' || f.kind === 'following' || f.kind === 'detached'

/** The surface a view names, as the workspace holds it – what a follower compares its own
 *  surface against to notice that it was switched by hand. */
export function surfaceKey(view: { mode: string; planId?: string | null; page?: string | null }): string {
  return view.mode === 'plans' ? `plans:${view.planId ?? ''}:${view.page ?? ''}` : view.mode
}

// --- pointer rings -----------------------------------------------------------------------

/** How long a ring stands before it is gone; the fade is the last part of it (CSS, 21-presentation). */
export const RING_MS = 4000
/** A person tapping fast leaves at most this many rings at once. */
const RINGS_PER_PERSON = 3

export interface Ring {
  key: string
  client: string
  name: string
  link: boolean
  at: PointerAt
  born: number
}

/** Add a pointer's ring (newest last) and drop what has faded. */
export function addRing(rings: readonly Ring[], ring: Ring, now: number): Ring[] {
  const live = liveRings(rings, now).filter((r) => r.key !== ring.key)
  const mine = live.filter((r) => r.client === ring.client)
  const drop = new Set(mine.slice(0, Math.max(0, mine.length - RINGS_PER_PERSON + 1)).map((r) => r.key))
  return [...live.filter((r) => !drop.has(r.key)), ring]
}

export function liveRings(rings: readonly Ring[], now: number): Ring[] {
  return rings.filter((r) => now - r.born < RING_MS)
}

/** The rings that belong on the Karte, or on one plan (and, on the Tafel, one page). */
export function ringsOn(rings: readonly Ring[], where: { surface: 'map' } | { surface: 'plan'; planId: string; page?: string | null }): Ring[] {
  return rings.filter((r) => r.at.surface === where.surface && (where.surface === 'map'
    || (r.at.plan_id === where.planId && (r.at.page == null || where.page == null || r.at.page === where.page))))
}

// --- sending -----------------------------------------------------------------------------

/**
 * Leading + trailing throttle for the presenter's view: the first change goes at once, then at
 * most one per `ms`, and the LAST one always goes (where the map came to rest). `cancel` drops a
 * pending trailing send (the presentation ended).
 */
export function throttle<T>(ms: number, send: (value: T) => void, now: () => number = Date.now) {
  let last = -Infinity
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: { value: T } | null = null
  const flush = () => {
    timer = null
    if (!pending) return
    const { value } = pending
    pending = null
    last = now()
    send(value)
  }
  return {
    push(value: T) {
      pending = { value }
      if (timer) return
      const wait = last + ms - now()
      if (wait <= 0) flush()
      else timer = setTimeout(flush, wait)
    },
    cancel() {
      if (timer) clearTimeout(timer)
      timer = null
      pending = null
    },
  }
}

// --- naming ------------------------------------------------------------------------------

/** «BA» for Bastian, «SM» for Sandra Meier – the avatar in the pill. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return (words[0] ?? '?').slice(0, 2).toUpperCase()
}

/** A person's ring and avatar colour (`--present-1` … `--present-6`): the presenter's is always
 *  the first (the pill's own magenta), everybody else's is stable for their client id. */
export function personTone(client: string, presenter: string | null | undefined): number {
  if (client === presenter) return 1
  let h = 0
  for (let i = 0; i < client.length; i++) h = (h * 31 + client.charCodeAt(i)) >>> 0
  return (h % 5) + 2
}
