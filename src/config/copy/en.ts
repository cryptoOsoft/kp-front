// English (en) — a full translation overlay deep-merged over German (./de).
//
// Fire-service domain terms are kept recognizable to an English-speaking commander; where a
// Swiss term has no clean English equivalent the established translation is used (Lage →
// "Situation", Atemschutz → "SCBA", Trupp → "team/crew", Verlauf → "Log").
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
// The overlay is split per surface into ./en/<surface>.ts, mirroring ./de/<surface>.ts.

import type { Copy, Localizable } from './index'
import { shellCopy } from './en/shell'
import { helpCopy } from './en/help'
import { symbolsCopy } from './en/symbols'
import { commonCopy } from './en/common'
import { mapCopy } from './en/map'
import { intakeCopy } from './en/intake'
import { drawingCopy } from './en/drawing'
import { journalCopy } from './en/journal'
import { atemschutzCopy } from './en/atemschutz'
import { whiteboardCopy } from './en/whiteboard'
import { editorsCopy } from './en/editors'
import { sessionCopy } from './en/session'
import { panelsCopy } from './en/panels'
import { captureCopy } from './en/capture'
import { linksCopy } from './en/links'
import { buildingCopy } from './en/building'
import { incidentCopy } from './en/incident'
import { reportCopy } from './en/report'
import { anwesenheitCopy } from './en/anwesenheit'
import { materialCopy } from './en/material'
import { objectVisitsCopy } from './en/objectVisits'
import { karteCopy } from './en/karte'
import { adminCopy } from './en/admin'
import { tutorialsCopy } from './en/tutorials'
import { tutorialRunCopy } from './en/tutorialRun'

export const en: Localizable<Copy> = {
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
