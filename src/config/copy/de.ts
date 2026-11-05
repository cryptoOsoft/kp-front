// German (de-CH) — the canonical locale and the source of the `Copy` type.
//
// This is the full user-facing string catalogue (was inlined as `appConfig.copy`), assembled
// from one module per surface in ./de/<surface>.ts (E1, 09.10.2026: the four catalogues were the
// top merge hotspots). Every other locale (see ./en, ./fr, ./it) is a DeepPartial<Copy>
// deep-merged over this one, so a missing key anywhere falls back to the German string here.
// When you add or rename a UI string, add it to the matching ./de/<surface>.ts FIRST — German
// defines the shape all locales share — and its translations to the same-named module of each
// overlay (./en/<surface>.ts, …). A new top-level key joins an existing surface module (or a new
// one spread here AND in each overlay's assembler); parity.test.ts fails until every locale has it.
//
// Read strings LATE: `appConfig.copy` is a getter that resolves the active locale, so a
// module-level capture like `const C = appConfig.copy.journal` freezes the language at
// import time. Always read `appConfig.copy.x.y` inside the component/function body.
//
// Domain language is German (Lage, Atemschutz, Trupp, …); keep these terms accurate.

import { shellCopy } from './de/shell'
import { helpCopy } from './de/help'
import { symbolsCopy } from './de/symbols'
import { commonCopy } from './de/common'
import { mapCopy } from './de/map'
import { intakeCopy } from './de/intake'
import { drawingCopy } from './de/drawing'
import { journalCopy } from './de/journal'
import { atemschutzCopy } from './de/atemschutz'
import { whiteboardCopy } from './de/whiteboard'
import { editorsCopy } from './de/editors'
import { sessionCopy } from './de/session'
import { panelsCopy } from './de/panels'
import { captureCopy } from './de/capture'
import { linksCopy } from './de/links'
import { buildingCopy } from './de/building'
import { incidentCopy } from './de/incident'
import { reportCopy } from './de/report'
import { anwesenheitCopy } from './de/anwesenheit'
import { materialCopy } from './de/material'
import { objectVisitsCopy } from './de/objectVisits'
import { karteCopy } from './de/karte'
import { adminCopy } from './de/admin'
import { tutorialsCopy } from './de/tutorials'
import { tutorialRunCopy } from './de/tutorialRun'

export type { HelpOnly } from './de/help'

export const de = {
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
} as const

export type Copy = typeof de
