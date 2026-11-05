"""Präsentationsmodus – one presenter, followers and fading pointers, per Einsatz. In memory.

WHAT THIS IS
------------
An editor taps «Präsentieren · Starten» in the «Einsatz teilen» sheet. Every other device on
the Einsatz – logged-in users and holders of the «Einsatz · lesen» view link – sees a pill
«<Name> präsentiert · Folgen». A follower mirrors the presenter's surface and section (the
presenter's `view` messages), and everyone joined may point: a tap with «Zeigen» on leaves a
named ring on every joined screen that fades after a few seconds (`pointer` messages).

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
The same long poll as the workspace and the Verlauf (app/live_wait): every device parks a
`GET …/presentation?since=<seq>&wait=1`, a signal (`POST …/presentation/signal`) bumps `seq`
and wakes them. A pointer reaches the others in one round trip plus the wake – well under a
second – and every request still passes the link gate, so revoking the view link stops a
holder on its next poll. ⚠️ In-process, like live_wait: production runs one uvicorn worker on
one replica (docs/DEPLOYMENT.md). Across several workers a follower would not hear a presenter
on another one; the fix then is Postgres LISTEN/NOTIFY behind the same functions.

HOW IT ENDS
-----------
«Beenden» (any editor), a takeover by another editor's «Starten», the Einsatz closing
(`end_for_close`, called where the close row is written), or the presenter going quiet for
`PRESENTER_TIMEOUT_S` – observed lazily by the next poll or signal of anybody on the Einsatz
(`expire`), stamped with the presenter's last contact. A process restart drops a running
presentation without its «beendet» row; the devices simply see none any more.
"""

# Rules for this area that span modules: docs/presentation.md.

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
#: One presentation is a room, not a broadcast list: beyond this, `join` is refused.
MAX_PARTICIPANTS = 64
#: Per-client floors between two messages of a kind. The client throttles too (lib/presentation);
#: this is the server's own bound on what one device can make every other device download.
MIN_INTERVAL_S = {"view": 0.1, "pointer": 0.12}

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
    last_sent: dict[tuple[str, str], float] = field(default_factory=dict)

    def touch(self, client: str | None) -> None:
        now = _now()
        if client == self.presenter.client:
            self.presenter.seen = now
        elif client and (p := self.participants.get(client)):
            p.seen = now

    def bump(self) -> None:
        """Something a poll answers changed (a message, who is in the room): wake the polls."""
        self.seq += 1
        live_wait.notify(live_wait.presentation_topic(self.incident_id))

    def push(self, message: dict) -> None:
        self.messages.append({**message, "seq": self.seq + 1})
        self.bump()


#: incident id → the presentation running on it. At most one per Einsatz.
_running: dict[uuid.UUID, Presentation] = {}


def current(incident_id: uuid.UUID) -> Presentation | None:
    return _running.get(incident_id)


def row_id(presentation_id: str, edge: str) -> str:
    """The derived Verlauf row id of a presentation's start (`s`) or end (`e`): server-owned
    `sys` namespace, one per edge – a second observer of the same timeout writes nothing."""
    return f"syspr{presentation_id}{edge}"


async def _append_edge(db: AsyncSession, p: Presentation, edge: str, at: datetime, text: str) -> None:
    from .api.journal import append_rows  # lazy – the service module must not pull the API layer at import

    row = {"id": row_id(p.id, edge), "t": "", "at": at.isoformat(), "icon": "present", "text": text}
    await append_rows(db, p.incident_id, [row])


async def start(
    db: AsyncSession, incident_id: uuid.UUID, *, client: str, name: str, now: datetime | None = None
) -> Presentation:
    """Start presenting from `client`. A presentation already running is ended first (a takeover:
    the old presenter's tablet may be gone, and «Starten» must never be a dead end at 3am).
    The same device starting again (a double tap) keeps the one it has."""
    running = _running.get(incident_id)
    if running is not None and running.presenter.client == client:
        running.presenter.seen = _now()
        return running
    await end(db, incident_id, reason="takeover")
    at = now or datetime.now(UTC)
    p = Presentation(
        id=uuid.uuid4().hex[:12],
        incident_id=incident_id,
        presenter=Participant(client=client, name=name, link=False, seen=_now()),
        started_at=at,
    )
    _running[incident_id] = p
    await _append_edge(db, p, "s", at, f"Präsentation gestartet ({name})")
    live_wait.notify(live_wait.presentation_topic(incident_id))
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
    live_wait.notify(live_wait.presentation_topic(incident_id))
    return True


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
        del p.participants[c]
    if gone:
        p.bump()
    return p


def join(p: Presentation, *, client: str, name: str, link: bool) -> bool:
    """Register a follower (or refresh its name). False when the room is full."""
    if client == p.presenter.client:
        return True
    if client not in p.participants and len(p.participants) >= MAX_PARTICIPANTS:
        return False
    known = p.participants.get(client)
    p.participants[client] = Participant(client=client, name=name, link=link, seen=_now())
    if known is None or known.name != name:
        p.bump()
    return True


def leave(p: Presentation, client: str) -> None:
    if p.participants.pop(client, None) is not None:
        p.bump()


def _throttled(p: Presentation, client: str, kind: str) -> bool:
    now = _now()
    last = p.last_sent.get((client, kind))
    if last is not None and now - last < MIN_INTERVAL_S[kind]:
        return True
    p.last_sent[(client, kind)] = now
    return False


def send_view(p: Presentation, client: str, view: dict) -> bool:
    """The presenter's surface and section. Only the presenter's client may send one."""
    if client != p.presenter.client:
        return False
    # the latest view is always handed out (a late joiner needs it), even when the message is
    # dropped by the throttle – the presenter's trailing send settles it
    p.view = view
    if not _throttled(p, client, "view"):
        p.push({"kind": "view", "view": view})
    return True


def send_pointer(p: Presentation, client: str, at: dict) -> bool:
    """A tap with «Zeigen» on. Only from somebody joined (the presenter included)."""
    who = p.presenter if client == p.presenter.client else p.participants.get(client)
    if who is None:
        return False
    if not _throttled(p, client, "pointer"):
        p.push({"kind": "pointer", "client": client, "name": who.name, "link": who.link, "at": at})
    return True


def news_for(p: Presentation | None, known_id: str, since: int) -> bool:
    """Does a poll that knows presentation `known_id` ('' = none) at `since` have anything new?
    False → it parks."""
    if p is None:
        return known_id != ""
    return p.id != known_id or p.seq > since


def snapshot(p: Presentation | None, known_id: str, since: int) -> dict:
    """What one poll answers: the presentation (or none), who is in it, the current view, and
    the messages after `since`. A poll that knew another presentation gets every message kept –
    a pointer older than its fade is ignored by the client anyway."""
    if p is None:
        return {"active": False, "seq": 0}
    fresh = [m for m in p.messages if m["seq"] > since] if p.id == known_id else list(p.messages)
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
