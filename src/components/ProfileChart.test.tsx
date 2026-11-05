// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ProfileChart, ProfileStats } from './ProfileChart'
import { useChartCursor } from '../lib/chartCursor'
import { fmtDistance, pathLengthM } from '../lib/geo'
import type { ProfileResult } from '../lib/profile'
import type { LngLat } from '../types'

afterEach(cleanup)

// ~1.5 km east–west, climbing evenly from 300 to 400 m
const path: LngLat[] = [[7.55, 47.5], [7.57, 47.5]]
const profile: ProfileResult = { points: [{ dist: 0, alt: 300 }, { dist: 1500, alt: 400 }], min: 300, max: 400, gain: 100, loss: 0, start: 300, end: 400 }

/** what the map's ChartCursorMarker reads */
function MapSpot() {
  const spot = useChartCursor()
  return <i data-testid="spot">{spot ? Math.round(spot.m) : ''}</i>
}

// The plain Höhenprofil reads out like the Wassertransport's chart: distance and height at the
// pointer, and the same spot on the map.
describe('ProfileChart · read-out', () => {
  it('a hovering mouse reads distance and height mid-chart, and the spot reaches the map; leaving clears both', () => {
    const { container } = render(<><ProfileChart p={profile} path={path} /><MapSpot /></>)
    const plot = container.querySelector('svg')!.parentElement!
    plot.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 84, right: 300, bottom: 84, x: 0, y: 0, toJSON: () => ({}) })
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.pointerMove(plot, { pointerType: 'mouse', clientX: 150 })
    const half = pathLengthM(path) / 2
    // the plot's middle (its padding is symmetric): half the path, half the climb
    expect(screen.getByRole('status').textContent).toBe(`${fmtDistance(half)}350 m ü.M.`)
    expect(screen.getByTestId('spot').textContent).toBe(String(Math.round(half)))
    fireEvent.pointerLeave(plot, { pointerType: 'mouse' })
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByTestId('spot').textContent).toBe('')
  })
})

describe('ProfileStats', () => {
  it('a route that only climbs reads «0 m» Abstieg, not «−0 m»', () => {
    render(<ProfileStats p={profile} />)
    expect(screen.getByText('+100 m')).toBeTruthy()
    expect(screen.getByText('0 m')).toBeTruthy()
    expect(screen.queryByText('−0 m')).toBeNull()
  })
})
