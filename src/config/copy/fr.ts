// French (fr, Suisse romande) — a full translation overlay deep-merged over German (./de).
//
// Fire-service domain terms follow Swiss «sapeurs-pompiers» usage: Lage → «Situation»,
// Atemschutz → «protection respiratoire» / ARI (appareil respiratoire isolant),
// Trupp → «binôme», Einsatzleiter → «chef d'intervention», Verlauf → «journal»,
// KP Front → «PC Front».
//
// The overlay is COMPLETE: every German string has a counterpart here, and
// config/copy/parity.test.ts fails if one is ever added without it. What remains German is
// German on purpose, because none of it is copy — each is a value something else matches
// against, so translating it breaks the match rather than localising anything:
//   • contextPanel.unField / contextPanel.stoffField — detail-row DATA keys the UN→substance
//     lookup matches against the (language-independent) preset fields.
//   • contextPanel.unLookupUrl — an address, not a sentence (each overlay sets its own
//     ericards.net URL: p_lang/lang pick the site language).
//   • primarySymbol.id / primarySymbol.icon — a tool id and a sprite name; a translated
//     «plus-bold» renders no icon at all.
//   • journal.reminderChips — minute values.
// Anything omitted would render the German base string (deepMerge fallback).
//
// The overlay is split per surface into ./fr/<surface>.ts, mirroring ./de/<surface>.ts.

import type { Copy, Localizable } from './index'
import { shellCopy } from './fr/shell'
import { helpCopy } from './fr/help'
import { symbolsCopy } from './fr/symbols'
import { commonCopy } from './fr/common'
import { mapCopy } from './fr/map'
import { intakeCopy } from './fr/intake'
import { drawingCopy } from './fr/drawing'
import { journalCopy } from './fr/journal'
import { atemschutzCopy } from './fr/atemschutz'
import { whiteboardCopy } from './fr/whiteboard'
import { editorsCopy } from './fr/editors'
import { sessionCopy } from './fr/session'
import { panelsCopy } from './fr/panels'
import { captureCopy } from './fr/capture'
import { linksCopy } from './fr/links'
import { buildingCopy } from './fr/building'
import { incidentCopy } from './fr/incident'
import { reportCopy } from './fr/report'
import { anwesenheitCopy } from './fr/anwesenheit'
import { materialCopy } from './fr/material'
import { objectVisitsCopy } from './fr/objectVisits'
import { karteCopy } from './fr/karte'
import { adminCopy } from './fr/admin'
import { tutorialsCopy } from './fr/tutorials'
import { tutorialRunCopy } from './fr/tutorialRun'

export const fr: Localizable<Copy> = {
  ...shellCopy,
  ...helpCopy,
  ...symbolsCopy,
  ...commonCopy,
  ...mapCopy,
  ...intakeCopy,
  ...drawingCopy,
  ...journalCopy,
  ...atemschutzCopy,
  ...whiteboardCopy,
  ...editorsCopy,
  ...sessionCopy,
  ...panelsCopy,
  ...captureCopy,
  ...linksCopy,
  ...buildingCopy,
  ...incidentCopy,
  ...reportCopy,
  ...anwesenheitCopy,
  ...materialCopy,
  ...objectVisitsCopy,
  ...karteCopy,
  ...adminCopy,
  ...tutorialsCopy,
  ...tutorialRunCopy,
}
