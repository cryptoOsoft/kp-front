# Präsentationsmodus

One editor presents the Einsatz; every other device on it – logged-in sessions and holders of
the «Einsatz · lesen» view link – can follow the presenter's surface and section, and everyone
joined can point. Built 05.11.2026 from mock 8B (owner picks in the feedback round of that day).
Rules that span modules live here; each module's header says what it owns.

| Where | What |
| --- | --- |
| `backend/app/presentation.py` | the in-memory broker: one presentation per Einsatz, its room, the message ring buffer, the lazy timeout |
| `backend/app/api/presentation.py` | the routes and their authorisation |
| `backend/app/auth/incident_link.py` | the two allowlist entries for the view and alarm links |
| `src/lib/presentation.ts` | the pure half: the follow state machine, rings and lines, fitting a section, edge arrows, the throttle |
| `src/lib/presentAnchor.ts` | a place in a scrolled surface that survives another screen (scroll, form-page marks) |
| `src/lib/checklistPick.ts` | the open Checkliste per Einsatz, readable and settable from outside the surface |
| `src/workspace/usePresentation.ts` | the hook: the poll, presenting, following, pointing, drawing |
| `src/lib/useZeigen.ts` | «Zeigen»: one-finger taps become rings, drags lines, two fingers still pan |
| `src/components/Presentation.tsx` | the pill, the rings and lines (Karte, plan, form page), the edge arrows, the «Präsentieren» card |

## What the operator sees

- **Start**: «Einsatz teilen» → card «Präsentieren» under the read link → «Starten». Editors
  only (`canShareLink`). A presentation already running is shown on the card and can be taken
  over («Übernehmen») – the old presenter's tablet may be the one that is gone, and «Starten»
  must never be a dead end.
- **Presenter pill** (bottom centre): «Du präsentierst · N folgen · avatars · Zeigen · Beenden».
- **Everyone else**: «<Name> präsentiert · Folgen». The pill becomes «Folgst <Name> · Zeigen · ✕».
  Following mirrors (owner picks 06.11.2026, «follow ALL of these»):
  - the **surface**: the Karte, the Plan (the open plan; on the Tafel the page), the Checklisten,
    Atemschutz, Anwesenheit, Mittel and the Rapport;
  - the **section**, fitted (owner pick «Fit + edge arrows»): the presenter sends its FREE area –
    the Karte's centre, zoom, bearing and size in px with its own detail panel left out; the
    Plan's centre and extent in board units – and a follower fits that whole area into its own
    free area (`lib/presentation · fitZoom`, `fitScale`), so a portrait phone following a laptop
    zooms out instead of cutting the sides off. Nothing changes for the presenter;
  - the **scroll** of a scrolled surface – a module, a Checkliste, a Tafel form page – and of an
    open Verlauf, as an anchor (`lib/presentAnchor`): the element at the top edge and how far into
    it, found again by the way down to it – keyed where the surface renders a key (`data-sec`,
    `data-box` on a form page, `data-ev` on a Verlauf row), else by child index – with the whole
    scroll's ratio as the fallback. Never raw px: a phone reflows the same list much taller;
  - the open **Checkliste** (`lib/checklistPick`), the open **symbol detail** (the Karte's
    selected symbol, the plan's selected object) and the **Verlauf drawer** (open or closed).
  A view names surfaces, ids and anchors only, never data: a follower opens them in its OWN copy
  of the Einsatz, so following never shows a session anything it could not already read. A plan
  this device does not have (a link sees fewer Objektpläne – `hasPlan`) is not followed; the
  follower stays where it is; a link session has no Tafel pages at all (`IncidentWorkspace ·
  useTafelPages`, `enabled: !linkScoped`), so a link follower stays on the Tafel's Skizze while
  the presenter is on a page. The Atemschutz-Link page runs no presentation at all.
- **Detaching**: a pan, pinch or wheel by hand, a scroll by hand (wheel, touch, a scroll key)
  on a scrolled surface or in the Verlauf, a surface, Checkliste, symbol or the Verlauf opened or
  closed by hand – each turns the pill into the chip «Wieder folgen»; one tap jumps back to the
  presenter's current view.
- **Zeigen**: a switch in the pill for everyone joined. On, a one-finger tap (or a click) leaves a
  named ring that fades after four seconds (`RING_MS`); a press-and-drag draws a line that
  follows the finger and fades the same way once the finger is up (owner pick 06.11.: nothing
  kept). Nothing under either is selected, placed or drawn into the Einsatz; two fingers still pan
  and zoom, on the Karte and the Plan alike (the Plan counts pointers, so the first finger is
  handed over at the second – `useZeigen · handOver`), and a second finger mid-line ends the line.
  Rings and lines stand on the Karte (lng/lat), on a plan or the Tafel's Skizze (plan space, a
  line on the storey it started on) and on a Tafel form page (anchored – a ring to the row or box
  under the finger, a line to its first point, the rest as offsets in that element's widths, so
  it scales with the reflowed row). Everyone joined sees everyone's; a view-link holder's name
  carries «· Link». Tags of rings close together are kept off each other and off the other rings
  (`lib/presentation · placeTags`: the newer ring's tag moves left, then a row down or up; the
  older keeps its place).
- **Edge arrows**: a ring or a line's tip outside what a screen shows (beyond the free area – a
  detail panel over it counts as not shown) stands as a small named arrow at the edge, pointing
  at it (`lib/presentation · edgeArrow`; every mark carries `data-present-mark`, its surface
  `data-present-host`, and `components/Presentation · EdgeArrows` measures one against the other
  every frame while marks live). Informational – a tap on it does nothing, so a follower is never
  detached by it.
- **The pill's place**: bottom centre. On a tablet or laptop it rises past whatever overlaps it
  sideways in that row – the bottom-left chips («Messungen», Gebäude, the page strip), an armed
  tool's pill, the selection bar, the coordinate read-out – by a measured lift (`usePillLift`, the
  phone row's `rowLift`). On a phone the chip row rises past the pill instead (it is an obstacle
  in `lib/floatRow · OBSTACLE_SEL`), and a link holder's name card takes the row's width.
- **A link holder's name**: asked once per device when they first tap «Folgen» (empty = «Gast»),
  kept in `localStorage` (`kp-front-present-name`, a device flag). The server cleans it
  (`api/presentation · clean_link_name`: NFC; every Unicode control/format/private character –
  C0, C1, bidi overrides, zero-width – and the letters that draw nothing out; at most two
  combining marks per base; 40 characters) and an empty result is «Gast». On the public demo
  every link holder is «Gast». On the presenter's row a link holder's avatar wears a chain badge,
  so a self-chosen «Führungsunterstützung» cannot pass as the FU.

## ⚠️ Nothing of it is record

Pointers, views and the room are never stored: not in the workspace (no `MERGE_POLICY` row, no
synced field), not in IndexedDB, not in the audit chain, not in any table. They live in the
server's memory for seconds. The **only** trace is two Verlauf rows the server writes,
«Präsentation gestartet (<Name>)» and «Präsentation beendet (<Name>[ – Verbindung verloren |
– Einsatz abgeschlossen])», under derived ids `syspr<id>s` / `syspr<id>e` in the server-owned
`sys` namespace (a client can never write one; the second observer of an end writes nothing).
Nothing of this is undoable because nothing of it mutates the Einsatz (`docs/undo.md`).

## How it ends

«Beenden» (any editor – `DELETE …/presentation`), a takeover, the Einsatz closing, or the presenter
going quiet. The close is caught where every close writes its row (`journal · append_system_row`
with `lifecycle="closed"` calls `presentation.end_for_close` first, so «beendet» stands before
«abgeschlossen»); a close that writes no such row is caught by the next poll, which checks the
lifecycle. The timeout is **60 s** without a poll or signal from the presenter's page
(`PRESENTER_TIMEOUT_S` – three missed 20 s polls, so an iPad locked for a moment comes back to its
own presentation); its row is stamped with the presenter's last contact. It is observed lazily, by
the next poll or signal of anybody on the Einsatz – the workspace follow's read included, which
computes the marker after the same watchdog, so a gone presenter is noticed even while nobody runs
the presentation follow. There is no background task. ⚠️ A signal
commits that expiry before it answers 409 `presentation_gone`, or the refusal would roll the
«beendet» row back with it while the presentation is already gone from memory. A follower
unheard for 45 s leaves the room (`PARTICIPANT_TIMEOUT_S`) and re-joins by itself when its poll
finds it missing. A process restart drops a running presentation without its «beendet» row.

## Transport

⚠️ **An Einsatz nobody presents costs nothing** (perf journey `idle`, 06.11.2026: a third loop on
every open Einsatz took it from 11 to 15 requests a minute). The workspace follow every device
parks anyway carries the marker: `X-Presentation` – the running presentation's id, or `none` – on
every workspace read, the 304 included (`api/incidents · PRESENTATION_HEADER`). The poll sends
the marker it holds (`presentation=`; a device that never heard sends `none`), and the server
answers at once when that is wrong – so a device opened mid-presentation hears it in its first
round, and the common case parks as before (no extra request at boot). A start or an end wakes
the parked workspace polls (`app/presentation · _wake`); measured on the real stack, an open phone
showed «… präsentiert · Folgen» 0.2 s after «Starten» and dropped it 0.3 s after «Beenden».
The client keeps the marker in `lib/presentationMarker`; its own start and end set it at once.

Only while the marker names one does a device run the presentation follow, the third live long
poll beside the workspace and the Verlauf (`backend/app/live_wait`, topic `presentation`): it
parks `GET …/presentation?client=&known=&since=&wait=1`; a `POST …/presentation/signal` (join,
leave, view, pointer) bumps the presentation's `seq` and wakes it. When the marker goes, the
device drops the presentation whatever its own follow last heard. A pointer reaches the others in one round trip plus the wake – a few hundred
milliseconds; the loop's 250 ms spacing floor (`lib/pollBackoff`) is the upper bound on a burst.
Chosen over a WebSocket or SSE because every request still passes the link gate
(`enforce_link_scope`), so revoking the view link stops a holder on the next poll, and because it
needs no new infrastructure on the proxy, the service worker or the tests.

- The presenter's view is throttled to one per 150 ms, leading + trailing (`lib/presentation ·
  throttle`); the server floors it at 100 ms per client and pointers at 120 ms
  (`MIN_INTERVAL_S`). A follower eases to each view over 300 ms so a stream reads as one move,
  and puts a scroll in place over the next 1.2 s while its surface renders (a surface that
  restores its own remembered scroll on mount must not have the last word).
- ⚠️ **Lines** travel as `stroke` signals carrying the WHOLE line so far, at most one per 250 ms
  while it grows (`STROKE_MS`, trailing – the finger-up always goes) – so a follower sees it
  appear while it is drawn, and a lost update loses nothing. The client simplifies to at most
  120 points (`capPoints`, Douglas–Peucker); the server refuses more (`MAX_STROKE_POINTS`) and
  floors a client at 150 ms. Lines do NOT go into the 64-message buffer the views and rings
  share: they have their own, one entry per line (an update replaces it), at most 12 lines
  (`STROKES_KEPT`) – so a poll's answer stays bounded in bytes and a drawing never pushes a ring
  out. Link sessions together get 8 line updates a second (`LINK_STROKES_PER_S`), beside their
  pointer budget.
- The poll is the presence: a parked poll counts as «still here».
- A pointer is handed out for `POINTER_TTL_S` (4 s) and only to a poll that already knew the
  presentation: a device that just looked, or a tab back from the background, draws no stale rings.
- ⚠️ **Link sessions together get a capped share** (review 06.11.2026): a link is forwarded and
  its holder chooses client ids, so a per-client limit bounds nothing. All link sessions together:
  at most 8 in the room (`LINK_PARTICIPANTS`), 5 pointers a second (`LINK_POINTERS_PER_S`), 4
  joins/leaves a second (`LINK_CHANGES_PER_S`). A signed-in session is never refused or dropped for
  anything a link did (its own bound is the roster, `MAX_PARTICIPANTS` = 200 as a safety net). A
  refused join is said on the device («Präsentation voll …», back to «Folgen»); a pointer over
  budget is dropped. A re-join under the same name only refreshes presence and wakes nobody; a
  leaving or timed-out follower takes its throttle stamps with it.
- ⚠️ A client id is bound to the session that registered it (`Participant.owner`: the account, or
  `link:<kind>:<hash of the link session's jti>` – every link holder is the one shared guest, so
  the session cookie's own id is what tells two link phones apart). The ids are in every poll's
  answer, so presence, leave, pointer and view are only taken from the owning session – nobody
  points under the FU's name or another link phone's, and nobody keeps a gone presenter's
  presentation alive by polling with its id.
- ⚠️ **In-process.** The broker lives in the one uvicorn worker on the one replica production runs
  (`docs/DEPLOYMENT.md` – Replicas `1`; `backend/start.sh` – no `--workers`), like `live_wait`.
  On several workers a follower would not hear a presenter on another one; the fix then is
  Postgres `LISTEN/NOTIFY` behind the same functions.
- **Offline or unreachable**: the device shows no presentation (no pill, no rings), queues
  nothing, and its card says «Braucht Verbindung zum Server».
- While a presentation runs, a third held request per tab: free over HTTP/2 (every deployment),
  3 of 6 connections over plain HTTP/1.1 (`lib/api · LONG_POLL_TIMEOUT_MS`). None otherwise.

## Who may do what

| | start · end | poll | join · leave · pointer | view |
| --- | --- | --- | --- | --- |
| editor | ✓ | ✓ | ✓ | the presenter's own client only |
| `el`, viewer account | – | ✓ | ✓ | – |
| view link (`vk`), alarm, terminal and Atemschutz links | – | ✓ | ✓ | – (refused for any link session) |

The view link's allowance is deliberate and narrow – see [`roles-and-access.md`](roles-and-access.md).
`backend/tests/test_presentation.py` proves that a view link may follow and point and still writes
nothing else (journal, workspace, events, start, end, view).
