// «Karte & Objekte» — the keyboard (lib/karte/hotkeys decodes, this listens). One window listener
// for the surface's life; the handlers are read through a ref every keydown, so a key always acts
// on the current state (the Einsatz's latest-ref pattern, IncidentWorkspace · hotkeyRef).

import { useEffect, useRef } from 'react'
import { isTypingTarget } from '../../lib/hotkeys'
import { resolveKarteHotkey, type KarteHotkey } from '../../lib/karte/hotkeys'

/** One handler per command – exhaustive, so a command added to KarteHotkey fails to compile here
 *  until the surface says what it does. */
export type KarteKeyHandlers = { [K in KarteHotkey['type']]: (cmd: Extract<KarteHotkey, { type: K }>) => void }

/** `off`: something modal stands over the surface (a sheet of App's, «Auf diesem Gerät», the menu)
 *  – it owns the keyboard and the viewer stays inert, Escape included. `escape` peels one layer of
 *  the viewer's own state; it never runs for a key that left a field or closed a dialog. */
export function useKarteKeys(o: { off: boolean; escape: () => void; on: KarteKeyHandlers }) {
  const ref = useRef(o)
  useEffect(() => { ref.current = o })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { off, escape, on } = ref.current
      if (off || e.defaultPrevented) return
      // a field or a dialog owns its keys; read the TARGET for Escape (a field blurs itself on Esc
      // before this bubbles up), the focused element for the letters
      const t = e.target instanceof Element ? e.target : null
      if (t?.closest('[role="dialog"], [role="alertdialog"], [role="menu"]')) return
      if (e.key === 'Escape') { if (!isTypingTarget(t)) escape(); return }
      if (isTypingTarget(document.activeElement)) return
      const cmd = resolveKarteHotkey(e)
      if (!cmd) return
      e.preventDefault()
      // the mapped type ties each command to its own handler; TS cannot follow the pairing through
      // the union, so the call goes through the one handler signature that takes any of them
      ;(on[cmd.type] as (c: KarteHotkey) => void)(cmd)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
