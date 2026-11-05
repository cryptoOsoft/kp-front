"""Präsentationsmodus routes – start/end (editors), the live poll and the signals (everyone).

The broker and its rules live in app/presentation; this module is the HTTP door and the
authorisation, which is the part to read twice:

· `POST`/`DELETE …/presentation` start and end a presentation. `CurrentEditor`: only a
  logged-in editor presents (owner pick 05.11.2026). Not on any link allowlist.
· `GET …/presentation` (the long poll) and `POST …/presentation/signal` are open to every
  session that may read the Einsatz – the «Einsatz · lesen» view link included
  (auth/incident_link · VIEW_LINK_ALLOWED). That is safe because of what a signal CAN do: join
  or leave the room, or leave a pointer that fades in seconds. Nothing reaches the workspace,
  the Verlauf, the audit chain or the database; the one record the feature writes (the
  gestartet/beendet rows) is the server's, on start/end and on the lazy timeout.
· A `view` signal (the presenter's section) is accepted only from the presenter's own client
  id, which only an editor's start can register – a link holder never moves anybody's screen.
· A client id is bound to the session that registered it (app/presentation · Participant.owner):
  the ids are in every poll's answer, so presence, leave, pointer and view under one are only
  taken from that session – nobody points under somebody else's name.
· A link holder's name is self-chosen, so it is bounded, stripped and flagged `link` on every
  screen, and replaced by «Gast» on the public demo (strangers must not broadcast text there).
"""

import re
import unicodedata
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import live_wait
from .. import presentation as broker
from ..alarms import is_demo_deployment
from ..auth.dependencies import CurrentEditor, CurrentUser, is_link_session
from ..database import get_db
from ..incident_service import INCIDENT_NOT_FOUND, incident_closed
from ..models import Incident, User, lifecycle_open

router = APIRouter(prefix="/incidents", tags=["presentation"])

GUEST_NAME = "Gast"
_PLAN_ID = r"^[A-Za-z0-9_:.\-]{1,120}$"


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class PresentationMapView(_Strict):
    lng: float = Field(ge=-180, le=180)
    lat: float = Field(ge=-90, le=90)
    zoom: float = Field(ge=0, le=24)
    bearing: float = Field(ge=-360, le=360)


class PresentationPlanView(_Strict):
    """A plan/Tafel section: the centre in plan space (0..1), the storey and the zoom relative to
    «eingepasst» (1) – portable between screens of any size (components/useBoardView)."""

    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    floor: int = Field(ge=-20, le=200)
    scale: float = Field(ge=0.1, le=20)


class PresentationView(_Strict):
    mode: Literal["map", "plans"]
    plan_id: str | None = Field(default=None, pattern=_PLAN_ID)
    #: the Tafel page on screen (lib/tafelPages · SKIZZE or a form id)
    page: str | None = Field(default=None, pattern=_PLAN_ID)
    map: PresentationMapView | None = None
    plan: PresentationPlanView | None = None


class PresentationPointerAt(_Strict):
    """Where a pointer was tapped: a map position, or a point on one plan (plan space, 0..1)."""

    surface: Literal["map", "plan"]
    lng: float | None = Field(default=None, ge=-180, le=180)
    lat: float | None = Field(default=None, ge=-90, le=90)
    plan_id: str | None = Field(default=None, pattern=_PLAN_ID)
    page: str | None = Field(default=None, pattern=_PLAN_ID)
    x: float | None = Field(default=None, ge=0, le=1)
    y: float | None = Field(default=None, ge=0, le=1)
    floor: int | None = Field(default=None, ge=-20, le=200)


class PresentationPerson(BaseModel):
    client: str
    name: str
    #: a view-link holder – its name is self-chosen, and every screen says so
    link: bool = False


class PresentationViewMessage(BaseModel):
    seq: int
    kind: Literal["view"]
    view: PresentationView


class PresentationPointerMessage(BaseModel):
    seq: int
    kind: Literal["pointer"]
    client: str
    name: str
    link: bool
    at: PresentationPointerAt


class PresentationState(BaseModel):
    """One poll's answer – app/presentation · snapshot."""

    active: bool
    id: str | None = None
    seq: int = 0
    started_at: str | None = None
    presenter: PresentationPerson | None = None
    participants: list[PresentationPerson] = []
    view: PresentationView | None = None
    messages: list[Annotated[PresentationViewMessage | PresentationPointerMessage, Field(discriminator="kind")]] = []


class PresentationStart(_Strict):
    client: str = Field(min_length=4, max_length=64)


class PresentationSignal(_Strict):
    #: the presentation this signal is meant for – a signal for one that has ended is dropped
    presentation: str = Field(min_length=1, max_length=32)
    client: str = Field(min_length=4, max_length=64)
    kind: Literal["join", "leave", "view", "pointer"]
    #: a link holder's own name; ignored for a logged-in user (the account's name is used)
    name: str | None = Field(default=None, max_length=60)
    view: PresentationView | None = None
    at: PresentationPointerAt | None = None


async def _is_open(db: AsyncSession, incident_id: uuid.UUID) -> bool:
    row = (
        await db.execute(select(Incident.is_archived, Incident.status).where(Incident.id == incident_id))
    ).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail=INCIDENT_NOT_FOUND)
    return lifecycle_open(bool(row.is_archived), row.status)


def _client(raw: str) -> str:
    cid = broker.client_id(raw)
    if cid is None:
        raise HTTPException(status_code=422, detail="client")
    return cid


_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


async def _display_name(db: AsyncSession, user: User, wanted: str | None) -> tuple[str, bool]:
    """(name shown beside this caller's pointer, is it a link holder)."""
    if not is_link_session(user):
        return (user.display_name or user.username), False
    if await is_demo_deployment(db):
        return GUEST_NAME, True
    # control characters out, and the invisible format ones too (a right-to-left override would
    # let a name read as somebody else's)
    clean = "".join(" " if _CONTROL.match(c) else c for c in (wanted or "") if unicodedata.category(c) != "Cf")
    name = " ".join(clean.split())[:40]
    return (name or GUEST_NAME), True


@router.get("/{incident_id}/presentation")
async def read_presentation(
    incident_id: uuid.UUID,
    _user: CurrentUser,
    client: Annotated[str, Query(min_length=4, max_length=64)],
    known: Annotated[str, Query(max_length=32)] = "",
    since: Annotated[int, Query(ge=0)] = 0,
    wait: bool = False,
    db: AsyncSession = Depends(get_db),
) -> PresentationState:
    """The presentation running on this Einsatz (or `{active: false}`), who is in it, the current
    view and the messages after `since`. `known` is the presentation id the caller has (''
    for none). `wait=1` parks while there is nothing new for it, like the workspace/Verlauf
    follow (app/live_wait). The poll also counts as the caller's presence."""
    cid = _client(client)
    owner = _owner(_user)
    # Subscribe BEFORE the read, so a signal landing between read and park is not missed.
    async with live_wait.subscribe(live_wait.presentation_topic(incident_id)) as changes:
        p = await broker.expire(db, incident_id, is_open=await _is_open(db, incident_id))
        if p is not None:
            p.touch(cid, owner)
        if wait and not broker.news_for(p, known, since):
            # Hand the pooled DB connection back before parking (see app/live_wait).
            await db.commit()
            await changes.wait()
            p = broker.current(incident_id)
            if p is not None:
                p.touch(cid, owner)
    return PresentationState(**broker.snapshot(p, known, since))


@router.post("/{incident_id}/presentation")
async def start_presentation(
    incident_id: uuid.UUID,
    body: PresentationStart,
    user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> PresentationState:
    """Start presenting from this device. One running elsewhere is taken over (and ended in the
    Verlauf). A closed Einsatz is presented by nobody: 409 `incident_closed`."""
    cid = _client(body.client)
    if not await _is_open(db, incident_id):
        raise incident_closed(None)
    name, _ = await _display_name(db, user, None)
    p = await broker.start(db, incident_id, client=cid, name=name, owner=_owner(user))
    return PresentationState(**broker.snapshot(p, p.id, 0))


@router.delete("/{incident_id}/presentation", status_code=status.HTTP_204_NO_CONTENT)
async def end_presentation(
    incident_id: uuid.UUID,
    _user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """«Beenden». Any editor may end it – the presenter's tablet may be the one that is gone.
    Idempotent: nothing running is a 204 too."""
    await _is_open(db, incident_id)  # 404 for an unknown Einsatz
    await broker.end(db, incident_id, reason="ended")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{incident_id}/presentation/signal", status_code=status.HTTP_204_NO_CONTENT)
async def presentation_signal(
    incident_id: uuid.UUID,
    body: PresentationSignal,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Join, leave, the presenter's view, or a pointer. Ephemeral by construction – see the
    module docstring. 409 when the presentation it names is not the one running (ended,
    taken over): the client drops back to «no presentation» on its next poll."""
    cid = _client(body.client)
    p = await broker.expire(db, incident_id, is_open=await _is_open(db, incident_id))
    if p is None or p.id != body.presentation:
        raise HTTPException(status_code=409, detail={"code": "presentation_gone"})
    owner = _owner(user)
    p.touch(cid, owner)
    if body.kind == "join":
        name, link = await _display_name(db, user, body.name)
        refused = broker.join(p, client=cid, name=name, link=link, owner=owner)
        if refused == "taken":
            raise HTTPException(status_code=403, detail={"code": "client_taken"})
        if refused is not None:
            raise HTTPException(status_code=429, detail={"code": f"presentation_{refused}"})
    elif body.kind == "leave":
        broker.leave(p, cid, owner)
    elif body.kind == "view":
        # Only the presenter's client – registered by an editor's start – moves the room. A link
        # session never presents, so its view is refused even if it guessed the id.
        if body.view is None or is_link_session(user) or not broker.send_view(p, cid, owner, body.view.model_dump()):
            raise HTTPException(status_code=403, detail={"code": "not_presenter"})
    else:
        if body.at is None or not _pointer_complete(body.at):
            raise HTTPException(status_code=422, detail="at")
        if not broker.send_pointer(p, cid, owner, body.at.model_dump(exclude_none=True)):
            raise HTTPException(status_code=409, detail={"code": "not_joined"})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _owner(user: User) -> str:
    return broker.owner_of(user.id, is_link_session(user))


def _pointer_complete(at: PresentationPointerAt) -> bool:
    if at.surface == "map":
        return at.lng is not None and at.lat is not None
    return at.plan_id is not None and at.x is not None and at.y is not None
