import { useEffect, useRef } from 'react'
import { apiGetRaw } from './api'
import { visibleInterval } from './visibleInterval'

export interface FeedPollOpts<T> {
  /** Path on the deployment's API — apiGetRaw prepends the origin, so the path alone goes in.
   *  A changed path restarts the poll (that is how the crew feed follows the open incident). */
  path: string
  /** Cadence in ms. */
  pollMs: number
  /** false parks the feed: no request goes out and a running timer is torn down. Default true. */
  enabled?: boolean
  /**
   * Statuses that mean "this feed will never answer HERE" — an unconfigured deployment (503), a
   * route an older backend doesn't have (404), a session that may not look (403). The timer stops
   * for good rather than heartbeating an answer that cannot change by asking again: an
   * unconfigured deployment then costs one request per app load instead of one per cadence.
   * Keep it a module-level constant in the caller — it is an effect dependency.
   */
  deadStatuses: readonly number[]
  /** Asked on every cadence tick: true lets the tick pass without a request. That is how a feed
   *  with nothing to show asks more rarely without its timer being rebuilt (a changed `pollMs`
   *  restarts the poll, and a restart begins with a round). Omit to ask on every tick. */
  skipRound?: () => boolean
  /** The parsed body of a round that succeeded. Never called after teardown. */
  onData: (data: T) => void
  /** A round that failed (network, timeout, non-2xx that isn't dead). Omit to fail silently —
   *  a decorative feed whose absence is already surfaced elsewhere should not shout twice. */
  onError?: (err: unknown) => void
}

/**
 * The read-only feed poll the live layers run on: fetch on a cadence, hand the body to the
 * caller, stop for good on a status that says the feed isn't there.
 *
 * The three live feeds (Fahrzeuge, Standorte, Fahrzeugspuren) are all the same shape — derived
 * fully from the backend each round, never editable, never part of the persisted document — and
 * had copy-pasted the same alive/busy/stop skeleton. What actually differs between them is the
 * mapping into entities and their own change-signature dedupe, and that stays in each hook.
 *
 * One round at a time: on a half-open field link a round can take the full 20 s apiGetRaw bound,
 * and a tick that ignored that would stack a new pending request every cadence.
 *
 * Paused while the page is hidden, with a round at once on the way back (lib/visibleInterval):
 * every consumer of these feeds is the screen.
 */
export function useFeedPoll<T>({ path, pollMs, enabled = true, deadStatuses, skipRound, onData, onError }: FeedPollOpts<T>): void {
  // The callbacks are rebuilt on every render of the calling hook. Reading them through refs is
  // what keeps that from tearing the poll down and re-issuing a round on each of those renders.
  const onDataRef = useRef(onData)
  const onErrorRef = useRef(onError)
  const skipRoundRef = useRef(skipRound)
  useEffect(() => { onDataRef.current = onData; onErrorRef.current = onError; skipRoundRef.current = skipRound })

  useEffect(() => {
    if (!enabled) return
    let alive = true
    let busy = false
    let cancel: (() => void) | null = null
    // for good: a dead status also drops the visibility listener, so a return to the page does
    // not ask again either
    const stop = () => {
      cancel?.()
      cancel = null
    }

    const poll = async () => {
      if (busy || skipRoundRef.current?.()) return
      busy = true
      try {
        const res = await apiGetRaw(path) // bounded (20 s); non-2xx comes back as a Response
        if (deadStatuses.includes(res.status)) {
          stop()
          return
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as T
        if (!alive) return
        onDataRef.current(data)
      } catch (e) {
        if (!alive) return
        onErrorRef.current?.(e)
      } finally {
        busy = false
      }
    }

    cancel = visibleInterval(() => void poll(), pollMs)
    return () => {
      alive = false
      stop()
    }
  }, [path, pollMs, enabled, deadStatuses])
}
