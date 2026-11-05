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
| `src/lib/presentation.ts` | the pure half: the follow state machine, rings, the view throttle |
| `src/workspace/usePresentation.ts` | the hook: the poll, presenting, following, pointing |
| `src/lib/useZeigen.ts` | «Zeigen»: one-finger taps become pointers, two fingers still pan |
| `src/components/Presentation.tsx` | the pill, the rings, the «Präsentieren» card |

## What the operator sees

- **Start**: «Einsatz teilen» → card «Präsentieren» under the read link → «Starten». Editors
  only (`canShareLink`). A presentation already running is shown on the card and can be taken
  over («Übernehmen») – the old presenter's tablet may be the one that is gone, and «Starten»
  must never be a dead end.
- **Presenter pill** (bottom centre): «Du präsentierst · N folgen · avatars · Zeigen · Beenden».
- **Everyone else**: «<Name> präsentiert · Folgen». Following mirrors the Karte (centre, zoom,
  bearing) or the Plan (the open plan, its centre and zoom relative to «eingepasst») and, on the
  Tafel, the page. The pill becomes «Folgst <Name> · Zeigen · ✕».
- **Detaching**: a pan, pinch or wheel by hand, or a surface switched by hand, turns the pill into
  the chip «Wieder folgen»; one tap jumps back to the presenter's current view.
- **Zeigen**: a switch in the pill for everyone joined. On, a one-finger tap (or a click) leaves a
  named ring that fades after four seconds (`RING_MS`), and nothing under it is selected, placed
  or drawn; two fingers still pan and zoom the Karte (on the Plan, two fingers pan; pinch needs
  «Zeigen» off). Everyone joined sees everyone's rings; a view-link holder's name carries «· Link».
- **A link holder's name**: asked once per device when they first tap «Folgen» (empty = «Gast»),
  kept in `localStorage` (`kp-front-present-name`, a device flag). On the public demo the server
  replaces every link holder's name by «Gast».
- **Surfaces presented**: the Karte and the Plan/Tafel. On any other surface (Atemschutz,
  Checklisten …) the presenter sends nothing and the room stays where it was.

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
the next poll or signal of anybody on the Einsatz – there is no background task. A follower
unheard for 45 s leaves the room (`PARTICIPANT_TIMEOUT_S`) and re-joins by itself when its poll
finds it missing. A process restart drops a running presentation without its «beendet» row.

## Transport

The third live long poll beside the workspace and the Verlauf (`backend/app/live_wait`, topic
`presentation`): every device on an open Einsatz parks `GET …/presentation?client=&known=&since=&wait=1`;
a `POST …/presentation/signal` (join, leave, view, pointer) bumps the presentation's `seq` and
wakes them. A pointer reaches the others in one round trip plus the wake – a few hundred
milliseconds; the loop's 250 ms spacing floor (`lib/pollBackoff`) is the upper bound on a burst.
Chosen over a WebSocket or SSE because every request still passes the link gate
(`enforce_link_scope`), so revoking the view link stops a holder on the next poll, and because it
needs no new infrastructure on the proxy, the service worker or the tests.

- The presenter's view is throttled to one per 150 ms, leading + trailing (`lib/presentation ·
  throttle`); the server floors it at 100 ms per client and pointers at 120 ms
  (`MIN_INTERVAL_S`). A follower eases to each view over 300 ms so a stream reads as one move.
- The poll is the presence: a parked poll counts as «still here».
- A pointer is handed out for `POINTER_TTL_S` (4 s) and only to a poll that already knew the
  presentation: a device that just looked, or a tab back from the background, draws no stale rings.
  A room takes at most 20 pointers a second (`ROOM_POINTERS_PER_S`), whoever sends them.
- ⚠️ A client id is bound to the session that registered it (`Participant.owner`: the account, or
  «a link session»). The ids are in every poll's answer, so presence, leave, pointer and view are
  only taken from the owning session – nobody points under the FU's name, and nobody keeps a gone
  presenter's presentation alive by polling with its id. (Link holders all share one guest
  identity, so one link holder could act under another link holder's id; both are shown «· Link».)
- ⚠️ **In-process.** The broker lives in the one uvicorn worker on the one replica production runs
  (`docs/DEPLOYMENT.md` – Replicas `1`; `backend/start.sh` – no `--workers`), like `live_wait`.
  On several workers a follower would not hear a presenter on another one; the fix then is
  Postgres `LISTEN/NOTIFY` behind the same functions.
- **Offline or unreachable**: the device shows no presentation (no pill, no rings), queues
  nothing, and its card says «Braucht Verbindung zum Server».
- A third held request per tab: free over HTTP/2 (every deployment), 3 of 6 connections over
  plain HTTP/1.1 (`lib/api · LONG_POLL_TIMEOUT_MS`).

## Who may do what

| | start · end | poll | join · leave · pointer | view |
| --- | --- | --- | --- | --- |
| editor | ✓ | ✓ | ✓ | the presenter's own client only |
| `el`, viewer account | – | ✓ | ✓ | – |
| view link (`vk`), alarm link | – | ✓ | ✓ | – (refused for any link session) |

The view link's allowance is deliberate and narrow – see [`roles-and-access.md`](roles-and-access.md).
`backend/tests/test_presentation.py` proves that a view link may follow and point and still writes
nothing else (journal, workspace, events, start, end, view).
