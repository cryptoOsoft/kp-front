// Italian (it) — a full translation overlay deep-merged over German (./de).
//
// Swiss-Italian (Ticino) for the pompieri ticinesi. Fire-service domain terms follow Ticino
// conventions: Lage → «Situazione», Atemschutz → «autoprotezione» / ARA (autorespiratore),
// Trupp → «squadra», Einsatz → «intervento», Verlauf → «diario», Einsatzleiter → «capo
// intervento». Acronyms kept natural (ARA, PC, ADR).
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
// The overlay is split per surface into ./it/<surface>.ts, mirroring ./de/<surface>.ts.

import type { Copy, Localizable } from './index'
import { shellCopy } from './it/shell'
import { helpCopy } from './it/help'
import { symbolsCopy } from './it/symbols'
import { commonCopy } from './it/common'
import { mapCopy } from './it/map'
import { intakeCopy } from './it/intake'
import { drawingCopy } from './it/drawing'
import { journalCopy } from './it/journal'
import { atemschutzCopy } from './it/atemschutz'
import { whiteboardCopy } from './it/whiteboard'
import { editorsCopy } from './it/editors'
import { sessionCopy } from './it/session'
import { panelsCopy } from './it/panels'
import { captureCopy } from './it/capture'
import { linksCopy } from './it/links'
import { buildingCopy } from './it/building'
import { incidentCopy } from './it/incident'
import { reportCopy } from './it/report'
import { anwesenheitCopy } from './it/anwesenheit'
import { materialCopy } from './it/material'
import { objectVisitsCopy } from './it/objectVisits'
import { karteCopy } from './it/karte'
import { adminCopy } from './it/admin'
import { tutorialsCopy } from './it/tutorials'
import { tutorialRunCopy } from './it/tutorialRun'

export const it: Localizable<Copy> = {
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
