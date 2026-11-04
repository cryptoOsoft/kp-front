// Keyboard shortcuts for working the app at a keyboard (tablet stays touch-first; this is the
// power-user layer). ONE place maps a KeyboardEvent → a semantic command; IncidentWorkspace
// dispatches it per surface (Lage map vs Plan whiteboard) so the same key does the parallel thing
// on both — Lage↔Plan parity is a review criterion. Escape (bail-out / close chrome — its own
// table, lib/hotkeyRoute · routeEscape) and Delete/Backspace (delete selection, its own listener)
// are NOT re-mapped here.
//
// Numbers address the plan MODULES by their own number (the rail already shows "1" / "2/3" as the
// module glyph — that badge IS the key): 1 → Modul 1, 2 or 3 → Modul 2/3, 4 → Modul 4, …
// The non-module surfaces carry their own letter, shown as a rail badge (SURFACE_KEY):
//   K Karte · C Checkliste · A Atemschutz · P Personal · M Material · R Rapport
// One rule, and it is guessable: the FIRST LETTER OF THE GERMAN WORD for the surface. The old
// set had grown letter by letter (H for Checkliste, W for Anwesenheit, I for Mittel) and none
// of the three could be derived from anything. Taking C/P/M displaced three tools, which moved
// to letters that follow the same rule rather than to whatever was free: Lasso → W (Wählen),
// Absperrkreis → U (Umkreis, which is what it draws), Koordinaten → X (the x/y of a coordinate).
// R used to be «Norden ausrichten» and is the Rapport's now, because the two commands are not
// comparable: resetting the rotation has a permanent control on every form factor — the compass
// (rail footer on a tablet, the floating cluster on a phone, the utility cluster on desktop) is
// always on screen, it ROTATES to the live bearing, so it announces itself precisely when the
// command is wanted, its menu opens on «Nach Norden», and MapView eases back to 0 by itself
// within a few degrees of north. The Rapport had no key at all, it is the last surface with a
// mnemonic letter free, and it is opened, left for Anwesenheit and returned to repeatedly across
// one Einsatz. So `north` keeps its button and loses its letter rather than moving to q/u/x,
// where a shortcut nobody can guess is worth less than none.
// Bare letters are also the tools/panels/view; Cmd/Ctrl is reserved for the doc-level ops
// (undo/redo/duplicate) and the OS-conventional Einstellungen (Cmd+,). The cheatsheet lives in
// appConfig.copy.help ("Tastaturkürzel") — keep the three (here, SURFACE_KEY, help) in sync.
//
// The letters are SHOWN on the rails (31.10.2026, owner: «clear, uniform and configurable»): a
// small badge on every tile of the left NavRail (SURFACE_KEY) and of the right ToolRail
// (TOOL_KEY via `railToolKey`), the same `.rail-key` look on both. One rule, in
// 04b-rail.css: shown whenever the device preference «Tastenkürzel anzeigen» (lib/prefs ·
// keyHints, default ON) is on AND the device has hover and a fine pointer – a touch-only device
// has no keyboard to read them for. They used to appear only while ⌘/Ctrl/Alt was held, and only
// on the left rail; a hint that is hidden until you already know the shortcut teaches nothing.
// Both badge sources are the SAME tables the keyboard decodes (SURFACE_KEY, TOOL_KEY), so a
// badge cannot name a letter that does nothing.

export type ToolCmd =
  | 'select' | 'lasso' | 'symbol' | 'line' | 'area' | 'circle' | 'note' | 'team' | 'measure'
export type SurfaceCmd = 'map' | 'checklists' | 'atemschutz' | 'anwesenheit' | 'mittel' | 'rapport'
export type PanelCmd = 'journal' | 'composer' | 'layers' | 'settings' | 'help'
export type ViewCmd = 'zoomIn' | 'zoomOut' | 'locate' | 'coord'

export type HotkeyCommand =
  | { type: 'module'; n: number }          // 1..9 → the plan module with that number
  | { type: 'surface'; surface: SurfaceCmd } // K/C/A/P/M/R → a non-module surface
  | { type: 'fit' }                          // 0 → einpassen / center
  | { type: 'nav'; dir: -1 | 1 }             // Cmd+[ / Cmd+] → step through the whole nav list
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'duplicate' }
  | { type: 'tool'; tool: ToolCmd }
  | { type: 'panel'; panel: PanelCmd }
  | { type: 'view'; view: ViewCmd }

/** the letter badge shown on each non-module surface in the NavRail — the single source the rail
 *  and SURFACE_KEYS below both read, so the badge always matches what the key does. */
export const SURFACE_KEY: Record<SurfaceCmd, string> = {
  map: 'K', checklists: 'C', atemschutz: 'A', anwesenheit: 'P', mittel: 'M', rapport: 'R',
}

/** true while a text field owns focus — bare-letter shortcuts must stay inert so typing works. */
export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false
  const tag = (el as HTMLElement).tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable === true
}

// derive the lowercase-key → surface map from SURFACE_KEY so there's one source of truth
const SURFACE_KEYS: Record<string, SurfaceCmd> = Object.fromEntries(
  (Object.entries(SURFACE_KEY) as [SurfaceCmd, string][]).map(([s, k]) => [k.toLowerCase(), s]),
) as Record<string, SurfaceCmd>

/** the letter of each drawing tool – the single source the ToolRail's badges and the keyboard
 *  (TOOL_KEYS below) both read, like SURFACE_KEY for the surfaces. Exhaustive over ToolCmd. */
export const TOOL_KEY: Record<ToolCmd, string> = {
  select: 'V', lasso: 'W', symbol: 'S', line: 'L', area: 'F', circle: 'U', note: 'N', team: 'T', measure: 'D',
}

/** The Plan's rail ids that differ from the Karte's tool names (Whiteboard · BoardTool): its
 *  Auswahl is 'pan', Notiz is 'text', Trupp is 'resource'. Every other rail id IS the ToolCmd. */
const PLAN_TOOL_CMD: Record<string, ToolCmd> = { pan: 'select', text: 'note', resource: 'team' }

/** The badge letter for a ToolRail tile, or undefined when the tile has no key (a surface-specific
 *  extra, the Karte viewer's Pin/ERG). Accepts the Karte's and the Plan's rail ids alike. */
export function railToolKey(id: string): string | undefined {
  const cmd = PLAN_TOOL_CMD[id] ?? id
  return Object.prototype.hasOwnProperty.call(TOOL_KEY, cmd) ? TOOL_KEY[cmd as ToolCmd] : undefined
}

const TOOL_KEYS: Record<string, ToolCmd> = Object.fromEntries(
  (Object.entries(TOOL_KEY) as [ToolCmd, string][]).map(([t, k]) => [k.toLowerCase(), t]),
) as Record<string, ToolCmd>
const PANEL_KEYS: Record<string, PanelCmd> = {
  j: 'journal', e: 'composer', b: 'layers',
}
// (no `r: 'north'` anymore — see the header: the compass is the north control, R is the Rapport)
const VIEW_KEYS: Record<string, ViewCmd> = {
  g: 'locate', x: 'coord',
}

/**
 * Map a keydown to its command, or null if it isn't a shortcut. Pure — no DOM/state. The caller
 * owns the typing/overlay/read-only guards and preventDefault; this only decodes the key.
 */
export function resolveHotkey(e: KeyboardEvent): HotkeyCommand | null {
  const mod = e.metaKey || e.ctrlKey
  const key = e.key

  // Cmd/Ctrl combos — doc-level ops + OS conventions. Alt never participates.
  if (mod && !e.altKey) {
    const k = key.length === 1 ? key.toLowerCase() : key
    switch (k) {
      case 'z': return e.shiftKey ? { type: 'redo' } : { type: 'undo' }
      case 'y': return { type: 'redo' }
      case 'd': return { type: 'duplicate' }
      case '[': return { type: 'nav', dir: -1 }
      case ']': return { type: 'nav', dir: 1 }
      case ',': return { type: 'panel', panel: 'settings' }
      default: return null
    }
  }
  if (mod || e.altKey) return null // any other modifier combo isn't ours

  // Bare keys.
  if (key === '?') return { type: 'panel', panel: 'help' } // Shift+/ on most layouts
  if (key === '+' || key === '=') return { type: 'view', view: 'zoomIn' }
  if (key === '-' || key === '_') return { type: 'view', view: 'zoomOut' }
  if (/^[0-9]$/.test(key)) {
    if (key === '0') return { type: 'fit' }
    return { type: 'module', n: Number(key) } // 1..9 → the plan module with that number
  }
  if (key.length !== 1) return null
  const lower = key.toLowerCase()
  if (lower in SURFACE_KEYS) return { type: 'surface', surface: SURFACE_KEYS[lower] }
  if (lower in TOOL_KEYS) return { type: 'tool', tool: TOOL_KEYS[lower] }
  if (lower in PANEL_KEYS) return { type: 'panel', panel: PANEL_KEYS[lower] }
  if (lower in VIEW_KEYS) return { type: 'view', view: VIEW_KEYS[lower] }
  return null
}
