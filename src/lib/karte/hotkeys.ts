import { resolveHotkey } from '../hotkeys'

// «Karte & Objekte» — the viewer's keyboard layer (07.11.2026, owner: «the keyboard shortcuts …
// also in the peacetime mode»). The Einsatz's decoder (lib/hotkeys · resolveHotkey) is the base, so
// every key the two share means the same thing on both: K Karte · C Checkliste · 1–9 the plan
// module with that number (the selected object's) · D Messen · B Ebenen · G Mein Standort ·
// 0 Einpassen · + − zoom · ⌘ , Einstellungen · ? Hilfe. On top, only what the Einsatz has no
// surface for:
//   P Punkt setzen (P is Anwesenheit in an Einsatz, which the viewer does not have)
//   U Gefahrgut (the UN number it asks for; U is Umkreis in an Einsatz, a tool the viewer lacks)
//   / and ⌘ K the search – the web's and the apps' search key, free in both modes
// A key of the Einsatz the viewer has nothing for (A, M, R, V, L …) decodes to nothing here, so it
// is never claimed. Escape is not a shortcut and stays the surface's (KarteApp · escape).

export type KarteTool = 'pin' | 'measure' | 'erg'

/** the letter of each viewer tool – the single source the tablet rail's badges (ToolRail ·
 *  toolKey) and `resolveKarteHotkey` both read. Messen keeps the Einsatz's D. */
export const KARTE_TOOL_KEY: Record<KarteTool, string> = { pin: 'P', measure: 'D', erg: 'U' }

/** the badge for a viewer rail tile, or undefined for a tile without a key */
export function karteToolKey(id: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(KARTE_TOOL_KEY, id) ? KARTE_TOOL_KEY[id as KarteTool] : undefined
}

const TOOL_KEYS: Record<string, KarteTool> = Object.fromEntries(
  (Object.entries(KARTE_TOOL_KEY) as [KarteTool, string][]).map(([t, k]) => [k.toLowerCase(), t]),
)

export type KarteHotkey =
  | { type: 'map' } | { type: 'library' }
  | { type: 'module'; n: number }
  | { type: 'tool'; tool: KarteTool }
  | { type: 'layers' } | { type: 'search' }
  | { type: 'zoom'; dir: 'in' | 'out' } | { type: 'fit' } | { type: 'locate' }
  | { type: 'settings' } | { type: 'help' }

/** Map a keydown to the viewer's command, or null if it is none. Pure, like resolveHotkey: the
 *  caller owns the typing / dialog guards, preventDefault and what each command does where. */
export function resolveKarteHotkey(e: KeyboardEvent): KarteHotkey | null {
  const mod = e.metaKey || e.ctrlKey
  if (!e.altKey && (mod ? e.key.toLowerCase() === 'k' : e.key === '/')) return { type: 'search' }
  if (!mod && !e.altKey && e.key.length === 1 && e.key.toLowerCase() in TOOL_KEYS) return { type: 'tool', tool: TOOL_KEYS[e.key.toLowerCase()] }
  const cmd = resolveHotkey(e)
  switch (cmd?.type) {
    case 'surface': return cmd.surface === 'map' ? { type: 'map' } : cmd.surface === 'checklists' ? { type: 'library' } : null
    case 'module': return cmd
    case 'fit': return { type: 'fit' }
    case 'panel': return cmd.panel === 'layers' || cmd.panel === 'settings' || cmd.panel === 'help' ? { type: cmd.panel } : null
    case 'view':
      if (cmd.view === 'zoomIn') return { type: 'zoom', dir: 'in' }
      if (cmd.view === 'zoomOut') return { type: 'zoom', dir: 'out' }
      return cmd.view === 'locate' ? { type: 'locate' } : null
    default: return null
  }
}
