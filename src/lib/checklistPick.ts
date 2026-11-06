// Which Checkliste is open, per Einsatz (components/ChecklistsView · Sel), kept outside the
// surface: it unmounts whenever another tab is shown, and the pick has to outlive that (owner
// 05.10.2026: «selected checklists don't persist»). sessionStorage, so a reload of the tab keeps
// it too; memory as the fallback when storage is blocked.
//
// The Präsentationsmodus reads and drives it from outside (workspace/usePresentation): the
// presenter's pick goes out (`subscribeChecklistPick`), a follower is put on it (`showChecklist`
// – the surface opens on it when it mounts, and an open one goes there at once).

/** what the main pane shows: a tickable list, a Stichwort, a device's chapter page (id = the
 *  device name) or an Anleitung */
export type ChecklistSel = { kind: 'tpl' | 'entry' | 'manual' | 'device'; id: string }
/** the pick, and on a narrow screen whether the chooser (true) or the list shows */
export type Picked = { sel?: ChecklistSel | null; railOpen?: boolean }

const memory = new Map<string, Picked>()
const storageKey = (k: string) => `kp.cl.picked.${k}`
const listeners = new Set<() => void>()
const showers = new Map<string, (sel: ChecklistSel) => void>()

export function readPicked(k: string): Picked | null {
  const kept = memory.get(k)
  if (kept) return kept
  try {
    const raw = sessionStorage.getItem(storageKey(k))
    return raw ? (JSON.parse(raw) as Picked) : null
  } catch { return null }
}

export function writePicked(k: string, patch: Picked) {
  const before = readPicked(k)?.sel ?? null
  const next = { ...readPicked(k), ...patch }
  memory.set(k, next)
  try { sessionStorage.setItem(storageKey(k), JSON.stringify(next)) } catch { /* memory only */ }
  const after = next.sel ?? null
  if (before?.kind !== after?.kind || before?.id !== after?.id) for (const l of listeners) l()
}

/** The open Checkliste of Einsatz `k`, or null. */
export const checklistPick = (k: string): ChecklistSel | null => readPicked(k)?.sel ?? null

export function subscribeChecklistPick(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Open `sel` on Einsatz `k`: the surface opens on it (the list, not the chooser), now or when it
 *  mounts next. */
export function showChecklist(k: string, sel: ChecklistSel) {
  const at = checklistPick(k)
  if (at?.kind === sel.kind && at.id === sel.id) return
  writePicked(k, { sel, railOpen: false })
  showers.get(k)?.(sel)
}

/** The mounted surface of Einsatz `k` takes `showChecklist` requests while it stands. */
export function onChecklistShow(k: string, show: (sel: ChecklistSel) => void): () => void {
  showers.set(k, show)
  return () => { if (showers.get(k) === show) showers.delete(k) }
}
