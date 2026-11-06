"""Präsentationsmodus – one presenter, followers and fading pointers, per Einsatz. In memory.

WHAT THIS IS
------------
An editor taps «Präsentieren · Starten» in the «Einsatz teilen» sheet. Every other device on
the Einsatz – logged-in users and holders of the «Einsatz · lesen» view link – sees a pill
«<Name> präsentiert · Folgen». A follower mirrors the presenter's surface and section (the
presenter's `view` messages), and everyone joined may point: a tap with «Zeigen» on leaves a
named ring on every joined screen that fades after a few seconds (`pointer` messages), a
press-and-drag a line that fades the same way (`stroke` messages, sent as it grows).

NOTHING HERE IS RECORD
----------------------
Pointers and views are never stored: not in the workspace, not in the Verlauf, not in the
database. They live in this module's ring buffer for a few seconds and are gone with the
process. The ONLY trace in the record is two Verlauf rows, «Präsentation gestartet» and
«Präsentation beendet» (who, when), written by the server under derived ids (`row_id`), so a
second observer of the same end cannot write it twice. That is why the view link may send
`pointer`/`join`/`leave` (api/presentation · the allowlist entries in auth/incident_link): what
it sends changes nothing anybody can read after the fade.

HOW IT TRAVELS
--------------
Nobody pays for a presentation that is not running: the workspace follow every device runs
anyway carries the marker (api/incidents · PRESENTATION_HEADER: the id, or «none») and is woken
by a start or an end (`_wake`). Only while the marker names one does a device run the
presentation follow, the same long poll as the workspace and the Verlauf (app/live_wait): it
parks a `GET …/presentation?since=<seq>&wait=1`, and a signal (`POST …/presentation/signal`)
bumps `seq` and wakes it. A pointer reaches the others in one round trip plus the wake – well under a
second – and every request still passes the link gate, so revoking the view link stops a
holder on its next poll. ⚠️ In-process, like live_wait: production runs one uvicorn worker on
one replica (docs/DEPLOYMENT.md). Across several workers a follower would not hear a presenter
on another one; the fix then is Postgres LISTEN/NOTIFY behind the same functions.

HOW IT ENDS
-----------
«Beenden» (any editor), a takeover by another editor's «Starten», the Einsatz closing
(`end_for_close`, called where the close row is written), or the presenter going quiet for
`PRESENTER_TIMEOUT_S` – observed lazily by the next poll, signal or workspace read of anybody on the Einsatz
(`expire`), stamped with the presenter's last contact. A process restart drops a running
presentation without its «beendet» row; the devices simply see none any more.
"""

# Rules for this area that span modules: docs/presentation.md.

import hashlib
import re
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from . import live_wait

#: A presenter unheard this long (no poll, no signal) has left; the presentation ends. Its
#: poll parks for 20 s at a time, so this is three missed polls – an iPad locked for a moment
#: comes back to its own presentation.
PRESENTER_TIMEOUT_S = 60.0
#: A follower unheard this long is no longer counted as joined.
PARTICIPANT_TIMEOUT_S = 45.0
#: The newest messages kept; a follower further behind gets the current view and these.
MESSAGES_KEPT = 64
#: One presentation is a room, not a broadcast list. Signed-in followers are accountable and
#: bounded by the roster: they are never refused below this safety bound.
MAX_PARTICIPANTS = 200
#: Per-client floors between two messages of a kind. The client throttles too (lib/presentation);
#: this is the server's own bound on what one device can make every other device download.
MIN_INTERVAL_S = {"view": 0.1, "pointer": 0.12, "stroke": 0.15, "join": 1.0}
#: ⚠️ LINK SESSIONS TOGETHER get a capped share of the room (adversarial review 06.11.2026). A
#: link is forwarded, and its holder chooses its client ids, so a per-client limit bounds
#: nothing: 64 made-up ids filled the room for the FU's own followers, three ate the room's
#: pointer budget, the presenter's included. So the link share is its own budget – at most
#: LINK_PARTICIPANTS of them in the room, LINK_POINTERS_PER_S pointers and LINK_CHANGES_PER_S
#: joins/leaves a second between them – and a signed-in session is never refused or dropped
#: for anything a link did.
LINK_PARTICIPANTS = 8
LINK_POINTERS_PER_S = 5
LINK_CHANGES_PER_S = 4
#: A pointer older than this is not handed out any more: it has faded on every screen (the
#: client's RING_MS is 4 s), and a tab coming back from the background must not draw the
#: minute it missed as fresh rings. A stroke counts from its last update.
POINTER_TTL_S = 4.0
#: ⚠️ STROKES (lines drawn with «Zeigen», 06.11.2026) do not go into `messages`: a line is sent
#: as it grows – the WHOLE line so far, every ≤ 250 ms (lib/presentation · STROKE_MS), so a
#: follower that missed an update still gets all of it – and its updates would flush the 64-slot
#: buffer the views and rings share. They live in their own small buffer instead, ONE entry per
#: line (an update replaces it): at most STROKES_KEPT lines, MAX_STROKE_POINTS points each (the
#: client simplifies to fit; api/presentation refuses more), so a poll's answer stays bounded in
#: bytes, not just in messages. The link share has its own budget here too.
STROKES_KEPT = 12
MAX_STROKE_POINTS = 120
LINK_STROKES_PER_S = 8

_CLIENT_ID = re.compile(r"^[A-Za-z0-9_-]{4,64}$")


def client_id(raw: str | None) -> str | None:
    """A device's presentation client id (`lib/ids · newId` shape), or None."""
    return raw if raw is not None and _CLIENT_ID.fullmatch(raw) else None


def _now() -> float:
    """Monotonic seconds; a function so the tests can move time."""
    return time.monotonic()


@dataclass
class Participant:
    client: str
    name: str
    #: a view-link holder – its name is self-chosen, and every screen says so
    link: bool
    seen: float
    #: the session that registered this client id (`owner_of`). Client ids are in every poll's
    #: answer, so they are no secret: every act under one – presence, leave, pointer, view – must
    #: come from the session that joined with it, or a link holder could point under the FU's
    #: name, kick a follower, or keep a vanished presenter's presentation alive by polling.
    owner: str


@dataclass
class Presentation:
    id: str
    incident_id: uuid.UUID
    presenter: Participant
    started_at: datetime
    seq: int = 0
    view: dict | None = None
    participants: dict[str, Participant] = field(default_factory=dict)
    messages: deque[dict] = field(default_factory=lambda: deque(maxlen=MESSAGES_KEPT))
    #: (client, stroke id) → the line's newest update, oldest first (STROKES_KEPT)
    strokes: dict[tuple[str, str], dict] = field(default_factory=dict)
    #: (client, kind) → when it last sent one; pruned with the client (`forget`)
    last_sent: dict[tuple[str, str], float] = field(default_factory=dict)
    #: the link share's recent pointers and room changes (one-second windows)
    link_pointers: deque[float] = field(default_factory=deque)
    link_changes: deque[float] = field(default_factory=deque)
    link_strokes: deque[float] = field(default_factory=deque)

    def forget(self, client: str) -> None:
        """A follower left (or timed out): drop it and its throttle stamps."""
        self.participants.pop(client, None)
        for key in [k for k in self.last_sent if k[0] == client]:
            del self.last_sent[key]

    def member(self, client: str, owner: str) -> Participant | None:
        """The presenter or a joined follower under `client` – only for the session that owns it."""
        who = self.presenter if client == self.presenter.client else self.participants.get(client)
        return who if who is not None and who.owner == owner else None

    def touch(self, client: str | None, owner: str) -> None:
        if client and (who := self.member(client, owner)):
            who.seen = _now()

    def bump(self) -> None:
        """Something a poll answers changed (a message, who is in the room): wake the polls."""
        self.seq += 1
        live_wait.notify(live_wait.presentation_topic(self.incident_id))

    def push(self, message: dict) -> None:
        self.messages.append({**message, "seq": self.seq + 1, "_t": _now()})
        self.bump()


#: incident id → the presentation running on it. At most one per Einsatz.
_running: dict[uuid.UUID, Presentation] = {}


def current(incident_id: uuid.UUID) -> Presentation | None:
    return _running.get(incident_id)


def owner_of(user_id: uuid.UUID | str, link_kind: str | None, link_session: str = "") -> str:
    """Who registers a client id: the account, or THIS link session – its kind and a hash of the
    session cookie's own id (every link holder is the one shared guest, auth/dependencies ·
    LINK_GUEST_ID, so the guest's id says nothing): a forwarded view link cannot leave or point
    under an id an alarm-link phone or another view-link phone registered."""
    if not link_kind:
        return f"user:{user_id}"
    ref = hashlib.sha256(link_session.encode()).hexdigest()[:16]
    return f"link:{link_kind}:{ref}"


def _within(window: deque[float], per_s: int) -> bool:
    """Take one from a one-second budget; False when it is spent."""
    now = _now()
    while window and now - window[0] > 1.0:
        window.popleft()
    if len(window) >= per_s:
        return False
    window.append(now)
    return True


def row_id(presentation_id: str, edge: str) -> str:
    """The derived Verlauf row id of a presentation's start (`s`) or end (`e`): server-owned
    `sys` namespace, one per edge – a second observer of the same timeout writes nothing."""
    return f"syspr{presentation_id}{edge}"


async def _append_edge(db: AsyncSession, p: Presentation, edge: str, at: datetime, text: str) -> None:
    from .api.journal import append_rows  # lazy – the service module must not pull the API layer at import

    row = {"id": row_id(p.id, edge), "t": "", "at": at.isoformat(), "icon": "present", "text": text}
    await append_rows(db, p.incident_id, [row])


async def start(
    db: AsyncSession, incident_id: uuid.UUID, *, client: str, name: str, owner: str, now: datetime | None = None
) -> Presentation:
    """Start presenting from `client`. A presentation already running is ended first (a takeover:
    the old presenter's tablet may be gone, and «Starten» must never be a dead end at 3am).
    The same device starting again (a double tap) keeps the one it has."""
    running = _running.get(incident_id)
    if running is not None and running.member(client, owner) is running.presenter:
        running.presenter.seen = _now()
        return running
    await end(db, incident_id, reason="takeover")
    at = now or datetime.now(UTC)
    p = Presentation(
        id=uuid.uuid4().hex[:12],
        incident_id=incident_id,
        presenter=Participant(client=client, name=name, link=False, seen=_now(), owner=owner),
        started_at=at,
    )
    _running[incident_id] = p
    await _append_edge(db, p, "s", at, f"Präsentation gestartet ({name})")
    _wake(incident_id)
    return p


async def end(db: AsyncSession, incident_id: uuid.UUID, *, reason: str, at: datetime | None = None) -> bool:
    """End the running presentation, if any, and write its «beendet» row. Removed from memory at
    once (so two concurrent observers cannot both end it); a rolled-back transaction loses the
    row, never the end."""
    p = _running.pop(incident_id, None)
    if p is None:
        return False
    suffix = {"timeout": " – Verbindung verloren", "close": " – Einsatz abgeschlossen"}.get(reason, "")
    await _append_edge(db, p, "e", at or datetime.now(UTC), f"Präsentation beendet ({p.presenter.name}{suffix})")
    _wake(incident_id)
    return True


def _wake(incident_id: uuid.UUID) -> None:
    """A presentation started or ended: wake its own followers AND the workspace polls, whose
    answer carries the marker (api/incidents · PRESENTATION_HEADER) – every other device learns
    of it there, within the round it is parked in."""
    live_wait.notify(live_wait.presentation_topic(incident_id))
    live_wait.notify(live_wait.workspace_topic(incident_id))


async def end_for_close(db: AsyncSession, incident_id: uuid.UUID) -> None:
    """The Einsatz is closing: end its presentation BEFORE the close row is written, so the
    Verlauf reads «beendet» then «abgeschlossen». Called from journal · append_system_row."""
    await end(db, incident_id, reason="close")


async def expire(db: AsyncSession, incident_id: uuid.UUID, *, is_open: bool) -> Presentation | None:
    """The lazy watchdog, run by every poll and signal: ends a presentation whose Einsatz is no
    longer open (a close that wrote no close row) or whose presenter went quiet, and drops
    followers who left without a word. Returns what is still running."""
    p = _running.get(incident_id)
    if p is None:
        return None
    if not is_open:
        await end(db, incident_id, reason="close")
        return None
    now = _now()
    quiet = now - p.presenter.seen
    if quiet > PRESENTER_TIMEOUT_S:
        await end(db, incident_id, reason="timeout", at=datetime.now(UTC) - timedelta(seconds=quiet))
        return None
    gone = [c for c, q in p.participants.items() if now - q.seen > PARTICIPANT_TIMEOUT_S]
    for c in gone:
        p.forget(c)
    if gone:
        p.bump()
    return p


def join(p: Presentation, *, client: str, name: str, link: bool, owner: str) -> str | None:
    """Register a follower (or refresh its name). None when it joined, else why not: «taken» (the
    client id is another session's), «full» (the room, or the link share of it), «throttled»
    (a name changing faster than once a second, or the link share's changes spent – each would
    wake every screen). A re-join under the same name only refreshes presence and wakes nobody."""
    if client == p.presenter.client:
        return None if p.presenter.owner == owner else "taken"
    known = p.participants.get(client)
    if known is not None and known.owner != owner:
        return "taken"
    if known is not None and known.name == name:
        known.seen = _now()
        return None
    if known is None:
        links = sum(1 for q in p.participants.values() if q.link)
        if (link and links >= LINK_PARTICIPANTS) or len(p.participants) - links >= MAX_PARTICIPANTS:
            return "full"
    # a refused join leaves no stamp behind (`last_sent` only holds clients in the room)
    last = p.last_sent.get((client, "join"))
    if last is not None and _now() - last < MIN_INTERVAL_S["join"]:
        return "throttled"
    if link and not _within(p.link_changes, LINK_CHANGES_PER_S):
        return "throttled"
    p.last_sent[(client, "join")] = _now()
    p.participants[client] = Participant(client=client, name=name, link=link, seen=_now(), owner=owner)
    p.bump()
    return None


def leave(p: Presentation, client: str, owner: str) -> None:
    """Out of the room. A link session's leave beyond its change budget still leaves – it just
    wakes nobody; the next change carries it to the screens."""
    known = p.participants.get(client)
    if known is None or known.owner != owner:
        return
    p.forget(client)
    if not known.link or _within(p.link_changes, LINK_CHANGES_PER_S):
        p.bump()


def _throttled(p: Presentation, client: str, kind: str) -> bool:
    now = _now()
    last = p.last_sent.get((client, kind))
    if last is not None and now - last < MIN_INTERVAL_S[kind]:
        return True
    p.last_sent[(client, kind)] = now
    return False


def send_view(p: Presentation, client: str, owner: str, view: dict) -> bool:
    """The presenter's surface and section. Only the presenter's client, from its own session."""
    if p.member(client, owner) is not p.presenter:
        return False
    # the latest view is always handed out (a late joiner needs it), even when the message is
    # dropped by the throttle – the presenter's trailing send settles it
    p.view = view
    if not _throttled(p, client, "view"):
        p.push({"kind": "view", "view": view})
    return True


def send_pointer(p: Presentation, client: str, owner: str, at: dict) -> bool:
    """A tap with «Zeigen» on. Only from somebody joined (the presenter included), from the session
    that joined. Beyond the per-client floor – and, for a link session, the link share's budget –
    a pointer is dropped, not refused (the client must not retry a pointer). A signed-in
    session's pointer never counts against the links' budget, nor theirs against it."""
    who = p.member(client, owner)
    if who is None:
        return False
    if not _throttled(p, client, "pointer") and (not who.link or _within(p.link_pointers, LINK_POINTERS_PER_S)):
        p.push({"kind": "pointer", "client": client, "name": who.name, "link": who.link, "at": at})
    return True


def send_stroke(p: Presentation, client: str, owner: str, stroke: dict) -> bool:
    """A line drawn with «Zeigen», the whole of it so far. Like a pointer: only from somebody
    joined, from its own session; beyond the per-client floor or the link share's budget the
    update is dropped (the next one carries every point anyway). It replaces the line's previous
    update in the stroke buffer, so a line costs one entry however long it is drawn."""
    who = p.member(client, owner)
    if who is None:
        return False
    if _throttled(p, client, "stroke") or (who.link and not _within(p.link_strokes, LINK_STROKES_PER_S)):
        return True
    key = (client, stroke["id"])
    p.strokes.pop(key, None)
    p.strokes[key] = {
        "kind": "stroke",
        "client": client,
        "name": who.name,
        "link": who.link,
        "stroke": stroke,
        "seq": p.seq + 1,
        "_t": _now(),
    }
    while len(p.strokes) > STROKES_KEPT:
        del p.strokes[next(iter(p.strokes))]
    p.bump()
    return True


def news_for(p: Presentation | None, known_id: str, since: int) -> bool:
    """Does a poll that knows presentation `known_id` ('' = none) at `since` have anything new?
    False → it parks."""
    if p is None:
        return known_id != ""
    return p.id != known_id or p.seq > since


def snapshot(p: Presentation | None, known_id: str, since: int) -> dict:
    """What one poll answers: the presentation (or none), who is in it, the current view, and
    the messages after `since` – none for a poll that did not know this presentation yet (it
    gets the current view, and a pointer from before it looked is not news), and no pointer
    older than POINTER_TTL_S."""
    if p is None:
        return {"active": False, "seq": 0}
    now = _now()
    fresh = sorted(
        (
            {k: v for k, v in m.items() if k != "_t"}
            for m in [*p.messages, *p.strokes.values()]
            if p.id == known_id and m["seq"] > since and (m["kind"] == "view" or now - m["_t"] < POINTER_TTL_S)
        ),
        key=lambda m: m["seq"],
    )
    return {
        "active": True,
        "id": p.id,
        "seq": p.seq,
        "started_at": p.started_at.isoformat(),
        "presenter": {"client": p.presenter.client, "name": p.presenter.name},
        "participants": [{"client": q.client, "name": q.name, "link": q.link} for q in p.participants.values()],
        "view": p.view,
        "messages": fresh,
    }


def reset() -> None:
    """Forget every presentation – the tests' clean slate."""
    _running.clear()
