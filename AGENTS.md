# AGENTS.md

Guidance for agents and humans working in this repo. It holds what every change needs; each
topic's rules live in the `docs/` page named below, and a rule about ONE module lives in a
comment at the top of that module. Read the page before you change its area, and the module's
header before you change the module. Keep both current in the same change.

## What this is

KP Front is an **Einsatzführungs-app for frontline fire-service command**: a tablet-first
situation map (Lage), plan whiteboard (Plan), live documentation and offline-capable record that
replaces the physical Lagekarte at the Einsatzort. Overview: [`README.md`](README.md); every doc
with its status: [`docs/README.md`](docs/README.md); architecture and key decisions:
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## The 3am tenet (overriding UX rule)

Every feature is judged against this: the operator is an **infrequent expert, under stress,
possibly in the dark and offline, who must use this correctly at 3am after six months without
practice.** So: **recognition over recall, right defaults over configuration, nothing that
can't be undone.** In practice that means –

- Undo/redo (or confirm-with-undo) on every mutable surface.
- In-context empty states that teach what a surface is for.
- Consistent controls/gestures across surfaces – Lage ↔ Plan parity is a review criterion.
- Place-don't-configure: lean on presets and sensible defaults.
- Touch targets ≥44px (primary actions ~48–56px), interactive text ≥12.5px.
- For any generated calculation, show source, timestamp, and editable assumptions, and label
  estimates as *Planungshilfe / Schätzung*.

## Stack & commands

React 19 + TypeScript, Vite, MapLibre GL, Workbox/PWA, Vitest – **pnpm**. FastAPI + PostgreSQL +
Alembic, one service serving the frontend same-origin – **uv** ([`backend/README.md`](backend/README.md)).
`just` lists every recipe. The ones every change uses:

- `just dev` – the full local stack.
- `just test-changed` while editing; `just check` (incremental tsc) after a batch of edits;
  `just test-backend -x tests/test_<area>.py` for one backend area.
- `just ci` before pushing: lint, build, full unit suite + coverage floor, backend with migration
  drift – in parallel, for the stacks your diff can affect (`just ci-all` for everything). What
  each covers and what stays CI's: [`docs/testing/ci.md`](docs/testing/ci.md).

## Working in this repo

- **Every change goes through a branch and a fully green PR**; nothing reaches `main` red. Branch
  protection requires the seven `ci.yml` checks (frontend, backend, image + e2e, secrets, visual,
  performance, shared files). The one intended bypass is a 3am prod hotfix (`enforce_admins` is
  off for that), after `just ci` locally. What each check runs and how to read a red one:
  [`docs/testing/ci.md`](docs/testing/ci.md).
- **Sign off every commit** (`git commit -s`, DCO) with a Conventional Commits subject (git-cliff
  drafts the CHANGELOG from them) – [`CONTRIBUTING.md`](CONTRIBUTING.md).
- **The user keeps uncommitted WIP and commits in parallel**: stage only the files you changed
  (`git add <paths>`), never assume the tree is clean. New work starts in a worktree off
  `origin/main`; `just doctor` warns when a checkout is far behind, `just wt-prune [--apply]`
  clears finished worktrees.
- **Ideas that should not reach the station yet go to `staging`** (the Railway `staging`
  environment, prod's data with push and webhooks cut). Pass `--environment` to every `railway`
  command: the checkout is linked to `production`. [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) §3a.
- **Ratchets only go down, baselines move only on purpose.** ESLint warnings per rule, the
  style-debt baseline, the coverage floor, the bundle budget, the visual baselines and the
  performance baseline are never loosened to turn a check green; a deliberate change is its own
  commit with the reason. The rules per gate: [`docs/testing/ci.md`](docs/testing/ci.md),
  [`docs/testing/visual-regression.md`](docs/testing/visual-regression.md),
  [`docs/testing/perf-journeys.md`](docs/testing/perf-journeys.md).
- Every new mutating feature ships with a test (`src/lib` or pytest). Every e2e spec imports
  `test` from `e2e/helpers`, which fails on any client error or render storm ([`e2e/README.md`](e2e/README.md)).
- **A file in [`shared/MANIFEST.json`](shared/MANIFEST.json) is shared with KP Rück by copy**:
  change it in both repositories on equally named branches ([`shared/README.md`](shared/README.md)).
- Replace files in place (no `_v2` / `-new` variants). Scratch scripts are named `.x-*` (ignored
  everywhere) and never live in `site/`, which is published.
- Match the surrounding code's style, naming and comment density. Technical prose (docs, comments,
  commits) is English; user-facing text is German. Convert relative dates to absolute.
- **A new rule goes where the next editor meets it**: the module's header, or the `docs/` page of
  its topic when it spans modules. A line here only for something every change has to know.

## Before you change …

Each line is a trigger: when your change touches the first part, read the page first. ⚠️ marks the
rules that break silently.

- **UI text or a word on a screen** → [`docs/copy-and-wording.md`](docs/copy-and-wording.md): every
  string lives in `appConfig.copy.*`, added to German `src/config/copy/de/<surface>.ts` first,
  translated in en/fr/it; which word a screen uses.
- **CSS, a colour, a button, a sheet, an overlay, a gesture** → [`docs/ui-conventions.md`](docs/ui-conventions.md):
  tokens and scales (never a frozen `rgba()` of the accent), the numbered `src/styles/` cascade,
  one corner and one button family, overlays only through `src/lib/overlays/`, editor sheets, the
  touch vocabulary. Phone layout: [`docs/phone-layout.md`](docs/phone-layout.md).
  A row, back row, toggle, chip, search or empty line is a `src/components` piece (`ListRow`, `BackRow`,
  `Segmented`, `Chip`, `SearchField`, `EmptyState` …); a new local class for one names in a comment
  the piece it could not use, and why (`controlDebt.test.ts` counts raw toggles, selects, searches).
- **A tool, symbol or object on the Lage or the Plan** → [`docs/tactical-objects.md`](docs/tactical-objects.md):
  Lage ↔ Plan parity, the shared editors, the generated symbol pack (edit `tools/gen_symbols.py`,
  never the JSON).
- **Anything that mutates** → [`docs/undo.md`](docs/undo.md): one undo timeline for the Einsatz, the
  three ways to join it, what is deliberately not undoable.
- **Synced state, storage, ids, the Verlauf, the record** → [`docs/sync-and-offline.md`](docs/sync-and-offline.md):
  - ⚠️ a new synced field needs a `MERGE_POLICY` row (`mergeWorkspace.ts`);
  - ⚠️ every minted id comes from `newId(prefix)` (`src/lib/ids.ts`), never `crypto.randomUUID()`;
  - ⚠️ a board object kind a build does not draw is a passenger, never dropped (a new kind bumps
    `WORKSPACE_SCHEMA_VERSION` and joins `backend/app/data/board_kinds.json`);
  - operational state in IndexedDB, «saved» means every queue acknowledged, records append-only,
    the server observes. What reaches the Verlauf: [`docs/verlauf-coverage.md`](docs/verlauf-coverage.md).
- **Divera answers / presence** → [`docs/divera-connector.md`](docs/divera-connector.md) › Rückmeldungen
  (⚠️ an answer is never presence).
- **Timers, alerts, push** → `src/lib/alarm.ts` header and `backend/app/push.py`.
- **A setting, station data, geodata, coordinates** → [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md):
  device pref vs station doctrine (`/admin` only) vs per-incident; station data is never bundled;
  WGS84 `[lng, lat]` wherever the map renders; credentials via `app.credentials.get`.
- **Roles, links, admin** → [`docs/roles-and-access.md`](docs/roles-and-access.md).
- **The Präsentationsmodus** (presenting, following, «Zeigen» pointers) → [`docs/presentation.md`](docs/presentation.md):
  ⚠️ nothing of it is record or synced; the view link may signal, never write.
- **Plans, Gebäude, alignments, tiles** → [`docs/plans-and-buildings.md`](docs/plans-and-buildings.md).
- **«Karte & Objekte»** (the station viewer and home outside an Einsatz: objects, outlines, the
  phone sheets and keyboard on iOS) → [`docs/karte-objekte.md`](docs/karte-objekte.md).
- **Atemschutz** → [`docs/atemschutz-board.md`](docs/atemschutz-board.md) · **Rapport** → [`docs/rapport.md`](docs/rapport.md)
  · **Tafel pages** → [`docs/board-templates.md`](docs/board-templates.md) · **Objektbesuche** →
  [`docs/object-visits.md`](docs/object-visits.md) · **Einsatz-Ablage** (closed Einsätze into SharePoint) →
  [`docs/incident-archive.md`](docs/incident-archive.md) · **Trupp names** → [`docs/trupp-naming.md`](docs/trupp-naming.md).
- **Large incidents, performance** → [`docs/testing/fat-incident.md`](docs/testing/fat-incident.md),
  [`docs/testing/perf-journeys.md`](docs/testing/perf-journeys.md) · **field crash reports** →
  [`docs/SOURCEMAPS.md`](docs/SOURCEMAPS.md).
- **A release** → [`CONTRIBUTING.md`](CONTRIBUTING.md) › Releases · **operating a station** (not
  changing code) → [`docs/AGENT-RUNBOOK.md`](docs/AGENT-RUNBOOK.md).
