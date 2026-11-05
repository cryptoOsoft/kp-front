// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Popover, PopoverClose, type PopoverChange } from './Popover'

afterEach(cleanup)

describe('Popover', () => {
  it('is closed until the trigger is clicked, then shows content', () => {
    render(<Popover trigger={<button>Wetter</button>}>Details hier</Popover>)
    expect(screen.queryByText('Details hier')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Wetter' }))
    expect(screen.getByText('Details hier')).toBeTruthy()
  })

  it('sets aria-expanded on the trigger when open', () => {
    render(<Popover trigger={<button>Wetter</button>}>x</Popover>)
    const trigger = screen.getByRole('button', { name: 'Wetter' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
  })

  it('closes on Escape', () => {
    render(<Popover trigger={<button>Wetter</button>} ariaLabel="Wetter-Details">Inhalt</Popover>)
    fireEvent.click(screen.getByRole('button', { name: 'Wetter' }))
    const pop = screen.getByText('Inhalt')
    fireEvent.keyDown(pop, { key: 'Escape' })
    expect(screen.queryByText('Inhalt')).toBeNull()
  })

  it('PopoverClose dismisses and runs its onClick', () => {
    const onClick = vi.fn()
    render(
      <Popover trigger={<button>Wetter</button>}>
        <PopoverClose onClick={onClick}>Radar öffnen</PopoverClose>
      </Popover>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Wetter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Radar öffnen' }))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Radar öffnen')).toBeNull()
  })

  // anchor mode (the Wassertransport's pump bubble): opened AT an element that toggles it itself,
  // so the caller must be able to tell that element's own press from a real outside press
  it('anchor mode opens without a trigger, and names why it wants to close', () => {
    const dot = document.createElement('button')
    document.body.appendChild(dot)
    const onOpenChange = vi.fn()
    render(<Popover open anchor={dot} onOpenChange={onOpenChange} ariaLabel="Pumpe 1">Blase</Popover>)
    expect(screen.getByRole('dialog', { name: 'Pumpe 1' })).toBeTruthy()
    fireEvent.pointerDown(dot, { button: 0, pointerType: 'mouse' })
    fireEvent.mouseDown(dot)
    fireEvent.click(dot)
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.objectContaining({ reason: 'outside-press' }))
    expect((onOpenChange.mock.calls[0][1] as PopoverChange).event.target).toBe(dot)
    // controlled, and the caller ignored it: still open
    expect(screen.getByText('Blase')).toBeTruthy()
    fireEvent.keyDown(screen.getByText('Blase'), { key: 'Escape' })
    expect(onOpenChange).toHaveBeenLastCalledWith(false, expect.objectContaining({ reason: 'escape-key' }))
    dot.remove()
  })
})
