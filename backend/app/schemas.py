"""Pydantic request/response schemas (grows per phase)."""

import logging
import math
import re
import uuid
from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    TypeAdapter,
    ValidationInfo,
    WithJsonSchema,
    field_validator,
    model_validator,
)

from .alarm_validation import CONTACT_GRACE_SEC, CONTACT_INTERVAL_MIN, TruppStatus, in_range, validate_reminder_row

logger = logging.getLogger(__name__)


# --- Auth ---------------------------------------------------------------------------
class RosterUser(BaseModel):
    """A login tile — never includes anything secret."""

    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    display_name: str
    role: str
    color: str | None = None


class LoginRequest(BaseModel):
    user_id: uuid.UUID
    pin: str = Field(min_length=4, max_length=12)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    username: str
    display_name: str
    role: str
    color: str | None = None
    last_login: datetime | None = None
    # this login works in the Führungsansicht (see models.User.el_view_default)
    el_view_default: bool = False
    # Present only on an incident-link session (auth/incident_link.py). The client reads
    # these to hide every control that would 403, so a link holder never meets a dead
    # button — a real account has neither attribute and both fall back to the defaults.
    link_scoped: bool = False
    link_incident_id: uuid.UUID | None = None
    # WHICH kind of link, because they do not offer the same app: "alarm", "view" and
    # "terminal" are read-only, "atemschutz" and "atemschutz-standing" may operate the
    # Atemschutzüberwachung of that one Einsatz and nothing else. None for a real account.
    link_kind: Literal["alarm", "view", "atemschutz", "atemschutz-standing", "terminal"] | None = None
    # When this device's login lapses unless renewed — the refresh token's expiry (auth/router ·
    # login, refresh, me). The app's «Alarm auf diesem Gerät» readiness shows it (lib/alarmReadiness).
    # None for a link session and for a /me answered off the access cookie alone.
    session_until: datetime | None = None


# --- User administration (Slice 2 — Members & access) -------------------------------
# Editor-only management of the login users. NEVER exposes pin_hash. The PIN policy
# (`settings.pin_min_length`–`pin_max_length` digits) lives in auth.security.hash_pin; the
# router re-hashes through hash_pin so a malformed PIN is rejected consistently.


class UserAdminOut(BaseModel):
    """Full admin view of a login user (incl. inactive). No secrets — never pin_hash."""

    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    username: str
    display_name: str
    role: str
    color: str | None = None
    is_active: bool
    created_at: datetime
    last_login: datetime | None = None
    el_view_default: bool = False


class UserCreate(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    display_name: str = Field(min_length=1)
    role: Literal["editor", "viewer", "el"]
    color: str | None = None
    el_view_default: bool = False
    pin: str = Field(min_length=4, max_length=12)  # digit policy (6–12) enforced via hash_pin


class UserUpdate(BaseModel):
    """All optional — rename / recolor / role-change / (de)activate."""

    display_name: str | None = Field(default=None, min_length=1)
    color: str | None = None
    role: Literal["editor", "viewer", "el"] | None = None
    is_active: bool | None = None
    el_view_default: bool | None = None


class PinReset(BaseModel):
    pin: str = Field(min_length=4, max_length=12)  # digit policy (6–12) enforced via hash_pin


# --- Incidents ----------------------------------------------------------------------
#: ``Incident.status`` — the words an incident's lifecycle may carry. The running ones are
#: `models.INCIDENT_ACTIVE_STATUSES`; "abgeschlossen" is the one that ends it. A typo used to be
#: stored as it came, and anything not running reads as closed (`models.lifecycle_open`), so
#: «of fen» silently ended the Einsatz. Client twin: src/lib/incidentRunning.ts.
IncidentStatus = Literal["offen", "in_arbeit", "abgeschlossen"]
#: ``Incident.priority`` as the app writes it (the wizard, the intake keyword inference).
IncidentPriority = Literal["HIGH", "LOW"]

# Coordinates are strict: a JSON `true` or `"47.5"` is a client bug, not a position, and a
# lax float would have pinned the Einsatz at 1.0°. Finite and in range — NaN/±Infinity pass a
# plain float, and `lat: 91` used to be stored and drive the map.
Latitude = Annotated[float, Field(strict=True, allow_inf_nan=False, ge=-90, le=90)]
Longitude = Annotated[float, Field(strict=True, allow_inf_nan=False, ge=-180, le=180)]


class _IncidentInput(BaseModel):
    """What both the create and the patch body take. INPUT only: the read models
    (`IncidentMeta`) keep plain types so a legacy row (a «NORMAL» priority, an old status)
    still reads. The text bounds are abuse caps on unbounded TEXT columns, the same numbers as
    the alarm intake (`AlarmIn`), which writes the same columns."""

    type: str | None = Field(default=None, max_length=100)
    priority: IncidentPriority | None = None
    text: str | None = Field(default=None, max_length=10_000)
    address: str | None = Field(default=None, max_length=255)
    lat: Latitude | None = None
    lng: Longitude | None = None

    @field_validator("title", "type", "text", "address", mode="before", check_fields=False)
    @classmethod
    def _trim(cls, v: object) -> object:
        """Trim; all-whitespace is absent (None) — so a blank title meets the «required»
        refusal rather than naming an Einsatz «   ». Non-strings pass through for pydantic to
        reject, as in `AlarmIn.strip_strings`."""
        if not isinstance(v, str):
            return v
        return v.strip() or None


class IncidentCreate(_IncidentInput):
    title: str = Field(min_length=1, max_length=1000)
    started_at: datetime | None = None
    is_exercise: bool = False
    details_json: dict[str, Any] | None = None


#: IncidentPatch fields whose column is NOT NULL: omitting one leaves it alone, an explicit null
#: is a 422 (it used to reach the database as an IntegrityError, a 500). Every other field is a
#: nullable column, and null clears it. Pinned against the ORM in test_incident_metadata_validation.
INCIDENT_PATCH_REQUIRED = frozenset({"title", "started_at", "status", "is_archived", "is_exercise"})


class IncidentPatch(_IncidentInput):
    """A partial update: an omitted field is untouched (the route reads `exclude_unset`), an
    explicit null clears a nullable column. The lat/lng PAIR is checked by the route against
    the stored row, since only it knows the coordinate the body did not send."""

    title: str | None = Field(default=None, min_length=1, max_length=1000)
    # Alarmierungszeit — correctable in the Einsatzdaten panel (e.g. Divera time was off)
    started_at: datetime | None = None
    status: IncidentStatus | None = None
    is_archived: bool | None = None
    is_exercise: bool | None = None
    report_done_at: datetime | None = None

    @model_validator(mode="after")
    def _no_null_on_required(self) -> "IncidentPatch":
        nulled = sorted(k for k in self.model_fields_set & INCIDENT_PATCH_REQUIRED if getattr(self, k) is None)
        if nulled:
            raise ValueError(f"Pflichtfeld darf nicht leer sein: {', '.join(nulled)}")
        return self


class IncidentMeta(BaseModel):
    """List/metadata view — never carries the workspace blob."""

    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    divera_id: int | None = None
    title: str
    type: str | None = None
    priority: str | None = None
    address: str | None = None
    lat: float | None = None
    lng: float | None = None
    status: str
    source: str
    source_ref: str | None = None
    auto_opened: bool = False
    started_at: datetime
    closed_at: datetime | None = None
    #: the CURRENT close (models · Incident.last_closed_at) — what the Einsatzende defaults to
    last_closed_at: datetime | None = None
    is_archived: bool
    is_exercise: bool = False
    #: Übung since creation, never marked real — the only kind an editor may hard-delete
    #: (models · Incident.exercise_since_creation)
    exercise_since_creation: bool = False
    report_done_at: datetime | None = None
    # Cross-visibility: latch of the first editor open (QR side shows «KP-Tablet aktiv»),
    # and capture write count/last-write (tablet side shows «QR: N Einträge · zuletzt HH:MM»).
    editor_opened_at: datetime | None = None
    capture_writes: int = 0
    capture_last_at: datetime | None = None
    workspace_rev: int
    created_by: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime


class IncidentFull(IncidentMeta):
    text: str | None = None
    details_json: dict[str, Any] | None = None
    map_workspace_json: dict[str, Any] | None = None


#: The tutorials that run on a seeded «Lernen · <Modul>» Übung (src/lib/tutorials/catalogue ·
#: `sandbox: 'uebung'`; their titles: tutorial_seed · TUTORIAL_TITLES). T1 makes its own Übung
#: through the intake, the peace-time tutorials need none.
LernTutorial = Literal[
    "lageZeichnen",
    "planGebaeude",
    "tafel",
    "checkliste",
    "trupps",
    "notfall",
    "anwesenheit",
    "material",
    "verlauf",
    "rapport",
    "wiedergabe",
]


class LernUebungIn(BaseModel):
    """`POST /api/incidents/lernen` — only the tutorial's id; the server owns title and scene."""

    model_config = ConfigDict(extra="forbid")
    tutorial: LernTutorial


class LernUebungOut(IncidentFull):
    #: an open Lern-Übung was reused (and renamed) instead of a new one being created
    reused: bool


class WorkspaceOut(BaseModel):
    workspace: dict[str, Any] | None = None
    workspace_rev: int


#: Colours a saved drawing may carry.
#:
#: ⚠️ A colour is written into an SVG ATTRIBUTE by both renderers and by the print path
#: (src/lib/shapes.tsx), so a stored value carrying a quote used to close that attribute and open
#: an event handler in the next operator's browser (SEC-01). Everything the app writes is a hex
#: literal; the function forms and the bare CSS keywords are accepted so a hand-written or legacy
#: blob keeps rendering. Kept in step with `isSafeColor` on the client.
#:
#: ⚠️ Anchored with `\Z`, not `$`: in Python `$` also matches just before a trailing newline, so
#: `"#fff\n"` would slip through and be stored with a stray newline in an attribute value. `\Z` is
#: the true end of string. (JS `$` without the `m` flag has no such leniency, so the client twin
#: `isSafeColor` needs no counterpart change.)
_COLOR_RE = re.compile(
    r"^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\Z"
    r"|^(?:rgb|hsl)a?\([\d\s.,%/+-]*\)\Z"
    r"|^[a-z]{3,20}\Z",
    re.IGNORECASE,
)

#: …and the numbers that describe an object's artwork (client twin: lib/workspace · DRAW_NUMBERS).
_NUMERIC_DRAWING_KEYS = frozenset(
    {"aspect", "fillOpacity", "rotation", "rotation2", "sizeM", "sizeN", "strokeW", "width"}
)

#: A live-vehicle / twin glyph (`Entity.symbolSvg`) is editor-supplied free text that the client
#: writes into the DOM (src/lib/symbolRender · dangerouslySetInnerHTML), so a crafted value was a
#: stored-XSS vector (SEC-01). The browser `DOMParser` sanitiser (src/lib/sanitizeSvg) is the
#: AUTHORITATIVE gate; these do a minimal server-side NEUTRALISATION so the stored blob and the
#: server-side Rapport raster (app/kroki.py · raster_svg) never carry an executable payload and a
#: hostile glyph cannot become a render-time 500. Idempotent on legitimate markup (nothing to
#: match), so re-wrapping the server's own blob through a `WorkspacePut` does not churn it.
# ⚠️ CDATA + comments come out FIRST: they are the round-3 parser-differential the auditor named —
# a `<![CDATA[ … ]]>` survives an XML round-trip and the HTML sink then re-parses its body as live
# markup (`<title><text><![CDATA[><img onerror=…>]]>`). The client's HTML-context DOMParser is the
# authoritative gate; stripping them here keeps the stored blob and the server raster path clean.
_CDATA_RE = re.compile(r"<!\[CDATA\[.*?\]\]>", re.DOTALL | re.IGNORECASE)
_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
_SCRIPTISH_TAG_RE = re.compile(
    r"</?\s*(?:script|foreignobject|title|desc|metadata|style|animate\w*|set)\b[^>]*>", re.IGNORECASE
)
# ⚠️ Keyed on whitespace OR a slash before `on…`: `<img/onerror=…>` is a valid HTML start tag whose
# `/` separates attributes, so a whitespace-only anchor (the round-1/2 regex) missed it — the exact
# slash-attribute evasion the auditor called out.
_EVENT_ATTR_RE = re.compile(r"""[\s/]on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)""", re.IGNORECASE)
_HREF_ATTR_RE = re.compile(r"""(\s(?:xlink:)?href\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)""", re.IGNORECASE)
_JS_URI_RE = re.compile(r"javascript:", re.IGNORECASE)


def _scrub_svg(markup: str) -> str:
    """Neutralise the executable parts of an editor-supplied SVG glyph — never raise, never reject.

    Not a parser: it strips CDATA sections and comments (the parser-differential traps), the
    behaviour-carrying / integration tags (`script`, `foreignObject`, `title`, `desc`, `metadata`,
    `style`, `animate*`, `set`), the `on*=` event handlers (whitespace- OR slash-separated), the
    `javascript:` scheme, and any `href`/`xlink:href` that is not a `#fragment` or a `data:image/…`
    raster. The client's HTML-context DOMParser sanitiser is what actually decides what renders;
    this only has to make sure nothing dangerous is persisted or handed to the raster path.
    """

    def _href(m: re.Match[str]) -> str:
        value = m.group(2).strip("\"'").strip().lower()
        if value.startswith(("#", "data:image/")):
            return m.group(0)
        return ""  # external / local / javascript: reference — drop the whole attribute

    text = _COMMENT_RE.sub("", markup)
    text = _CDATA_RE.sub("", text)
    text = _SCRIPTISH_TAG_RE.sub("", text)
    text = _EVENT_ATTR_RE.sub("", text)
    text = _HREF_ATTR_RE.sub(_href, text)
    return _JS_URI_RE.sub("", text)


def _scrub_drawing_props(workspace: dict[str, Any]) -> None:
    """Strip every drawing property that no client of this app could have written.

    Neutralise, never reject: a 422 on a whole workspace stops the incident syncing on every
    tablet, and a hostile colour (or glyph) has no meaning to lose — the object keeps its geometry,
    its clocks and its history, and simply renders in the default ink. Because the capture and
    Atemschutz saves re-wrap the server's own blob into a `WorkspacePut`, this also cleans data
    that was stored before the gate existed.

    Iterative on purpose: the blob is caller-supplied JSON, and recursing into a deliberately
    deep one would turn a bad request into a 500.
    """
    stack: list[Any] = [workspace]
    while stack:
        node = stack.pop()
        if isinstance(node, dict):
            colour = node.get("color")
            if isinstance(colour, str) and not _COLOR_RE.match(colour):
                del node["color"]
            svg = node.get("symbolSvg")
            if isinstance(svg, str):
                cleaned = _scrub_svg(svg)
                if cleaned != svg:
                    node["symbolSvg"] = cleaned
            for key in _NUMERIC_DRAWING_KEYS & node.keys():
                value = node[key]
                if value is None:
                    continue
                # bool is an int in Python, and `fill-opacity="True"` is not a number.
                # ⚠️ math.isfinite raises OverflowError on an int too large to convert to float
                # (a JSON body may carry 10**400) — the round-1 validator called it unguarded and
                # so turned that body into a 500, the very thing this function's docstring forbids.
                try:
                    unusable = (
                        isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
                    )
                except OverflowError:
                    unusable = True
                if unusable:
                    del node[key]
            stack.extend(node.values())
        elif isinstance(node, list):
            stack.extend(node)


class WorkspacePut(BaseModel):
    workspace: dict[str, Any]
    base_rev: int
    #: When the newest edit in this save was MADE (the client's server-aligned clock) — a closed
    #: Einsatz takes a save made before its close (incident_service · `happened_after_close`).
    #: Absent (an older client) → judged by arrival.
    edited_at: datetime | None = None

    @model_validator(mode="after")
    def _validate_workspace(self) -> "WorkspacePut":
        _scrub_drawing_props(self.workspace)
        # Alarm validation needs the current stored workspace to distinguish unchanged
        # malformed legacy records from new invalid data; apply_workspace_put owns it.
        return self


#: A wide-open workspace holds hundreds of objects; the Atemschutz roster of one Einsatz is a
#: handful of Trupps. The cap is a bad-client guard, not a doctrine limit.
MAX_TRUPPS = 200


#: A stored Trupp as the contract DESCRIBES it: an open object whose `status` is a TruppStatus
#: (alarm_validation · TruppStatus, the one list of its words).
#: ⚠️ Schema only — the rows are validated by `validate_alarm_workspace` in apply_workspace_put,
#: against the stored list: a new or changed row with an unknown status is refused, an unchanged
#: legacy row still rides, so one old record cannot lock an offline tablet out of its saves.
_TruppDoc = Annotated[
    dict[str, Any],
    WithJsonSchema(
        {
            "type": "object",
            "properties": {"status": TypeAdapter(TruppStatus).json_schema()},
            "additionalProperties": True,
        }
    ),
]


class TruppsPut(BaseModel):
    """The Atemschutz SLICE of the workspace — the only write shape an Atemschutz link has.

    Deliberately not a `WorkspacePut` with a narrower validator: the caller never sends the
    rest of the document, so a stale copy cannot erase anything outside `trupps`. `base_rev`
    is the same optimistic-concurrency token as the full PUT and produces the same 409.
    """

    trupps: list[_TruppDoc]
    base_rev: int
    #: see WorkspacePut.edited_at
    edited_at: datetime | None = None
    #: The saving build's workspace schema version (since 30.10.2026). Absent → an older build,
    #: taken as workspace_kinds · UNVERSIONED_SLICE_VERSION; refused onto a newer stored blob.
    schemaVersion: int | None = None

    @model_validator(mode="after")
    def _validate_trupps(self) -> "TruppsPut":
        if len(self.trupps) > MAX_TRUPPS:
            raise ValueError(f"Zu viele Trupps (max. {MAX_TRUPPS})")
        for t in self.trupps:
            tid = t.get("id")
            if not isinstance(tid, str) or not tid.strip():
                raise ValueError("Jeder Trupp braucht eine nichtleere String-id")
        return self


class ViewLinkOut(BaseModel):
    """The Rapport's view-only link. `token` is what goes in the URL (`/l/<token>`) — the
    client builds the full address from its own origin, so nothing here has to be told what
    the deployment is reachable under. None whenever `enabled` is False."""

    enabled: bool
    token: str | None = None


# --- Audit events -------------------------------------------------------------------
class EventIn(BaseModel):
    client_id: str | None = Field(default=None, min_length=1, max_length=128)
    # bounded like the column (models · IncidentEvent.op_type String(32)) — an oversized
    # value must be a 422 at the door, not a DB error mid-batch
    op_type: str = Field(min_length=1, max_length=32)
    payload: dict[str, Any] | None = None
    occurred_at: datetime | None = None

    @model_validator(mode="after")
    def _cap_payload(self) -> "EventIn":
        import json as _json

        # same per-row bound as a Verlauf row (JournalAppendIn): the chain is append-only,
        # and an unbounded payload would make the audit log blob storage
        if self.payload is not None and len(_json.dumps(self.payload)) > 32_768:
            raise ValueError("Ereignis-Payload zu gross (max. 32 KB)")
        return self


class EventBatchIn(BaseModel):
    events: list[EventIn]


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    seq: int
    occurred_at: datetime
    recorded_at: datetime
    source: str
    user_id: uuid.UUID | None = None
    op_type: str
    payload_json: dict[str, Any] | None = None
    prev_hash: str | None = None
    hash: str


# --- Journal (Verlauf) store ----------------------------------------------------------
# Journal rows are stored verbatim and the client renders their media references as raw
# hrefs (photo chips, Beilagen-Downloads) — so the append path is where a smuggled
# javascript:/data: URL has to die. Whitespace and control characters are stripped BEFORE
# the check: browsers strip them when resolving a scheme, which is exactly what
# `java\tscript:` relies on. Ingest only — legacy stored rows are read back untouched.
_URL_JUNK = re.compile(r"[\x00-\x20\x7f]")


def _is_safe_row_url(value: object) -> bool:
    """Only the app's own media store or an absolute https URL may enter a row.

    `/api/media/` is a single leading slash by construction, so a protocol-relative `//host`
    fails the prefix; anything else (http:, data:, javascript:, backslash tricks) fails both.
    """
    if not isinstance(value, str):
        return False
    url = _URL_JUNK.sub("", value)
    return url.startswith("/api/media/") or url.lower().startswith("https://")


def _validate_row_urls(row: dict, rid: str) -> None:
    """Reject a row whose media references are not safe URLs (see _is_safe_row_url).

    The empty string is NOT a URL here: it is the client's append-only clear marker
    (journalStore · appendPatch sends '' because JSON.stringify drops undefined).
    """
    urls: list[object] = []
    photos = row.get("photoUrls")
    if isinstance(photos, list):
        urls += photos
    elif photos not in (None, ""):
        raise ValueError(f"Journalzeile {rid!r}: photoUrls muss eine Liste sein")
    files = row.get("files")
    if isinstance(files, list):
        urls += [f.get("url") if isinstance(f, dict) else f for f in files]
    elif files not in (None, ""):
        raise ValueError(f"Journalzeile {rid!r}: files muss eine Liste sein")
    urls += [row[k] for k in ("photoUrl", "audioUrl") if row.get(k) not in (None, "")]
    if not all(_is_safe_row_url(u) for u in urls):
        raise ValueError(f"Journalzeile {rid!r} enthält eine unzulässige URL")


class JournalAppendIn(BaseModel):
    """Batch of Verlauf rows (frontend TimelineEvent dicts, stored verbatim). The row's
    own `id` is the idempotency key; a 32 KB per-row cap keeps a bad client from turning
    the journal into blob storage (photos/audio go through /media, never in rows); media
    references must be safe URLs (`_validate_row_urls`) because they render as raw hrefs."""

    entries: list[dict[str, Any]]

    @model_validator(mode="after")
    def _validate_rows(self) -> "JournalAppendIn":
        import json as _json

        for e in self.entries:
            validate_reminder_row(e)
            rid = e.get("id")
            if not isinstance(rid, str) or not rid.strip():
                raise ValueError("Jede Journalzeile braucht eine nichtleere String-id")
            # The alarm clock trusts server boundary rows, including their legacy `sys…`
            # spelling. Neither a client row nor a correction may impersonate/change one.
            # Shared by the ordinary journal and the PIN-less capture endpoint.
            target = e.get("patchOf")
            if "lifecycle" in e or rid.startswith("sys") or (isinstance(target, str) and target.startswith("sys")):
                raise ValueError("Systemzeilen des Einsatzverlaufs dürfen nicht vom Gerät geschrieben werden")
            if len(_json.dumps(e)) > 32_768:
                raise ValueError(f"Journalzeile {rid!r} zu gross (max. 32 KB)")
            _validate_row_urls(e, rid)
        return self


class JournalEntryOut(BaseModel):
    seq: int
    row: dict[str, Any]


class JournalPage(BaseModel):
    entries: list[JournalEntryOut]
    latest_seq: int


# --- Replay (audit-trail sub-phase B) -----------------------------------------------
class SnapshotOut(BaseModel):
    """The nearest workspace snapshot <= a requested instant — the fold anchor."""

    found: bool
    occurred_at: datetime | None = None
    seq_at: int | None = None
    workspace: dict[str, Any] | None = None


class VehicleSampleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    device_id: int
    ts: datetime
    lat: float
    lng: float
    course: float | None = None
    speed: float | None = None


# --- Divera ------------------------------------------------------------------------
class DiveraWebhookPayload(BaseModel):
    id: int
    number: str | None = None
    title: str = ""
    text: str | None = None
    address: str | None = None
    lat: float | None = None
    lng: float | None = None
    ts_create: int | None = None
    ts_update: int | None = None

    @field_validator("lat", "lng")
    @classmethod
    def _zero_is_no_coordinate(cls, v: float | None) -> float | None:
        # Divera sends lat/lng 0/0 for alarms without a location ("Einrücken ins Magazin").
        # Stored verbatim, 0/0 became a real coordinate downstream — the map centred on Null
        # Island and the weather picked the nearest Swiss station to the Gulf of Guinea
        # (Grosser St. Bernhard). Zero means absent; NULL lets the address geocoder run.
        return None if v is not None and abs(v) < 1e-6 else v


class DiveraEmergencyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    divera_id: int
    divera_number: str | None = None
    title: str
    text: str | None = None
    address: str | None = None
    lat: float | None = None
    lng: float | None = None
    received_at: datetime
    is_taken: bool
    taken_incident_id: uuid.UUID | None = None


class DiveraTakeBody(BaseModel):
    """Optional EL corrections applied when taking a pool alarm into an incident.

    All fields optional: an empty body takes the alarm verbatim (backwards-compatible),
    any field present overrides the mirrored Divera value. The wizard sends the reviewed
    fields so a wrong address/keyword/pin is fixed before the incident is born.
    """

    title: str | None = None
    type: str | None = None
    priority: str | None = None
    text: str | None = None
    address: str | None = None
    lat: float | None = None
    lng: float | None = None


# --- Generic alarm intake -------------------------------------------------------------
# Slugs a generic sender may not claim. This is the UNION of what KP Front and KP Rück each
# use internally, not just Front's own three ("manual", "migrated", "divera") — a station
# running both feeds one dispatch system into both apps, and a slug accepted here but
# rejected there would be a trap that only shows up on the second integration. Reserving a
# name Front doesn't use costs nothing; it was never a valid external sender name anyway.
# Keep in sync with kp-rueck's app/schemas/alarms.py. See docs/RUNNING-BOTH.md.
#
# "feld" was missing until 2026-08-19, so the comment above claimed a union this set did not
# hold: a sender calling itself `feld` was accepted here and rejected there. Both sides
# asserted the union in prose and neither compared it — which is why the set is now pinned by
# `docs/alarm-intake-conformance.json` and a CI job instead.
RESERVED_ALARM_SOURCES = {"divera", "feld", "intake", "manual", "migrated", "operator", "training"}


class AlarmIn(BaseModel):
    """Generic alarm-intake payload (`POST /api/alarms`) for non-Divera alerting systems.

    `source` names the sender (a short slug, one per upstream system); `source_id` is the
    sender's alarm id — together they dedupe, so a retried webhook returns the existing
    incident instead of duplicating it. `type`/`priority` fall back to the same keyword
    inference the Divera path uses.
    """

    source: str = Field(default="webhook", min_length=1, max_length=16, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    # OPTIONAL, deliberately — it was required here and optional in KP Rück, so the same
    # relay could not feed both apps: one answered 422 where the other accepted the alarm.
    # Without it there is nothing to dedupe on, so a redelivery creates a second incident;
    # that is the sender's trade to make, and it is the same trade KP Rück offers.
    source_id: str | None = Field(default=None, min_length=1, max_length=128)
    # Bounded: these flow into the incident, push notifications and the printed Rapport.
    # Title is NOT 255 — the conformance corpus pins «title longer than 255 → accept» as a
    # recorded divergence from KP Rück, so tightening to 255 is a coordinated corpus change,
    # not a one-sided edit. 1000 still stops megabyte-scale garbage. Text is real dispatch
    # prose and legitimately long, so its cap is generous.
    title: str = Field(min_length=1, max_length=1000)
    text: str | None = Field(default=None, max_length=10_000)
    address: str | None = Field(default=None, max_length=255)
    lat: float | None = None
    lng: float | None = None
    type: str | None = None
    priority: Literal["HIGH", "LOW"] | None = None
    started_at: datetime | None = None
    # Accepted so one payload validates against both apps. KP Rück shows this in its alarm
    # pool ("E-123"); an Einsatz here has no such field, so it is ACCEPTED AND IGNORED rather
    # than rejected. Said out loud because a silently dropped field is worse than a 422.
    number: str | None = Field(default=None, max_length=50)

    @field_validator("title", "text", "address", "source_id", "number", mode="before")
    @classmethod
    def strip_strings(cls, v: object) -> object:
        """Trim, and treat an all-whitespace value as absent — as KP Rück already did.

        Found on 2026-08-19 by the shared conformance corpus, on its first run against this
        side: `{"title": "   "}` satisfied `min_length=1` here and opened an Einsatz with a
        blank title, while KP Rück refused the same body. Three spaces are not a title, and a
        dispatch system that sends them wants to hear about it rather than have the operator
        find a nameless incident on the board.

        Non-strings pass through UNTOUCHED so pydantic still rejects them. Collapsing them here
        as well would make `{"address": 0}` a silently absent field instead of a 422 — the
        exact trade `number` two fields up says out loud is the wrong one.
        """
        if not isinstance(v, str):
            return v
        return v.strip() or None


class AlarmOut(BaseModel):
    incident_id: uuid.UUID
    created: bool


# --- FireHub (Tercero) adapter ------------------------------------------------------------
# FireHub has no public REST API for our use case, but it fires a station-configured webhook
# on the "Einsatzstart" and "Einsatzende" triggers. That is enough for KP Front: a start
# auto-opens an incident (the same thing every intake path does since 2026-08-02), an end
# stamps the Einsatzende on that incident's Rapport. The payload is a fixed nested shape (as
# of 2026-08), mapped onto the provider-neutral AlarmIn above. See docs/ALARM-INTEGRATIONS.md.


class FireHubOperation(BaseModel):
    """The ``operation`` object of a FireHub webhook.

    Field names mirror FireHub's camelCase JSON via aliases. ``extra="ignore"`` so fields
    FireHub may add later (full address, PLZ/Ort, coordinates) never break intake before we
    map them.
    """

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    # ``opsID`` is STABLE and never changes — it is our idempotency and start↔end linking key
    # (source_ref). ``opsNumber`` is display-only and VOLATILE: Tercero confirmed it can change
    # when operations are merged or past ones are backfilled, so nothing may key off it.
    ops_id: int = Field(alias="opsID")
    ops_number: int | None = Field(default=None, alias="opsNumber")
    category: str | None = None
    title: str = Field(min_length=1, max_length=255)
    street: str | None = None
    # Tercero is adding ``city`` globally (a payload-wide change, not per-webhook). Optional
    # because it ships slightly after this adapter — older payloads omit it — so the address is
    # composed from street + city, degrading to street-only during the rollout window.
    city: str | None = None
    created: datetime | None = None
    # NOT sent by FireHub today (no coordinates). Declared as optional so the day Tercero adds
    # them they flow straight through; until then they stay None and the map pin is geocoded
    # downstream from the address (or left unplaced).
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)


class FireHubTrigger(BaseModel):
    """The ``trigger`` object: which lifecycle event fired the webhook (``start``/``end``)."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    type: str | None = None
    action: str = Field(min_length=1)
    tech_name: str | None = Field(default=None, alias="techName")


class FireHubWebhook(BaseModel):
    """A FireHub Einsatzstart/Einsatzende webhook payload (``POST /api/firehub/webhook``)."""

    model_config = ConfigDict(extra="ignore")

    operation: FireHubOperation
    status: str | None = None
    trigger: FireHubTrigger

    def to_alarm(self) -> "AlarmIn":
        """Map onto the provider-neutral alarm the intake pipeline consumes.

        The address is composed from ``street`` + ``city`` (the field Tercero is adding), and
        degrades to street-only while that field is still rolling out. ``category`` ("firealarm")
        is deliberately not carried into ``text`` or ``type``: it is an English slug, and the
        German title ("Oberwil: Feueralarm") already carries the keyword our type inference
        reads. ``number`` (opsNumber) is set for cross-app parity with KP Rück's pool reference,
        but KP Front's intake accepts-and-ignores it (an Einsatz here has no such field).
        """
        op = self.operation
        address = ", ".join(part for part in (op.street, op.city) if part) or None
        return AlarmIn(
            source="firehub",
            source_id=str(op.ops_id),
            title=op.title,
            address=address,
            lat=op.lat,
            lng=op.lng,
            number=str(op.ops_number) if op.ops_number is not None else None,
            started_at=op.created,
        )


class MilestoneGroup(BaseModel):
    """One alarmed group: id matches `alarms.groups[].id` in the deployment config."""

    id: str = Field(min_length=1, max_length=32)
    alarmedAt: datetime


class MilestoneVehicle(BaseModel):
    """Per-vehicle timeline milestones: id matches `fleet.vehicles[].id` (Traccar name)."""

    id: str = Field(min_length=1, max_length=32)
    ausgerueckt: datetime | None = None
    vorOrt: datetime | None = None
    zurueck: datetime | None = None


class MilestonesIn(BaseModel):
    """`POST /api/alarms/milestones` — alarm/vehicle timeline enrichment from the alarm
    pipeline (e.g. fwo-divera's Traccar state machine). Targets an existing incident by
    `divera_id` OR by the generic-intake `(source, source_id)` pair; 404 while it doesn't
    exist yet (senders retry). Idempotent per-key upsert; operator-edited entries
    (`manual: true` in the workspace) are never overwritten."""

    divera_id: int | None = None
    source: str | None = Field(default=None, min_length=1, max_length=16)
    source_id: str | None = Field(default=None, min_length=1, max_length=128)
    groups: list[MilestoneGroup] = Field(default_factory=list)
    vehicles: list[MilestoneVehicle] = Field(default_factory=list)
    #: Where the alarm came IN from, as the alerting system knew it — a slug like
    #: ``"alarmzentrale"``, never a phone number. Recorded write-once on the incident
    #: (``Incident.alarm_origin``); omitting it is normal and means «unknown», not «no».
    #: Same charset rule as ``AlarmIn.source``: a short lowercase identifier.
    origin: str | None = Field(default=None, min_length=1, max_length=32, pattern=r"^[a-z0-9][a-z0-9_-]*$")


class MilestonesOut(BaseModel):
    incident_id: uuid.UUID
    applied: int  # how many values were actually new/changed (0 = pure replay)


# --- Geocoder ----------------------------------------------------------------------
class GeoHit(BaseModel):
    label: str
    lat: float
    lng: float


# --- Objects + reference data -------------------------------------------------------
class ObjectIn(BaseModel):
    name: str
    address: str | None = None
    lat: float | None = None
    lng: float | None = None
    source_note: str | None = None


class ObjectRefIn(BaseModel):
    """An outside system's id for an object (``{"source": "fwo-schlue", "id": "…"}``)."""

    source: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9._-]{0,63}$")
    id: str = Field(min_length=1, max_length=300)


class ObjectUpsertIn(ObjectIn):
    """``PUT /api/objects/{id}`` — ``ObjectIn`` plus the OPTIONAL fields the manifest push
    (``admin_objects push``) carries: the station key the plan pull matches on, where the object's
    documents are filed, its outside ids and its Modul-1 notes. All are written only when SENT, so
    a caller that does not know them (the admin's object mask) never clears them; ``refs`` are
    added, never removed."""

    #: ``ObjectSite.source_key`` — the key the scheduled Planspeicher-Abgleich matches on
    #: (plans.py · pull_plans). Written only when SENT, with ``admin_objects load``'s semantics:
    #: the value replaces whatever the object had (null clears it). The browser mask never sends
    #: it, so editing an object there keeps the key. A key another object holds is a 409.
    source_key: str | None = Field(default=None, max_length=300)
    filing_folder: str | None = Field(default=None, max_length=300)
    refs: list[ObjectRefIn] | None = Field(default=None, max_length=50)
    #: The object's Sofortmassnahmen and Bemerkungen (free text, one per line) and where they
    #: came from. Written
    #: only when SENT, like ``filing_folder``: a push from a manifest that has no such key must
    #: not wipe what Verwaltung typed. Sent as null or "" clears them.
    measures: str | None = Field(default=None, max_length=4000)
    remarks: str | None = Field(default=None, max_length=4000)
    measures_source: str | None = Field(default=None, max_length=300)


class ObjectOut(ObjectIn):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    #: The plan-library folder this object's documents are filed under (Objektbesuche delivery).
    filing_folder: str | None = None
    #: The station's own key for this object – deliberately absent from ``ObjectIn``, so the
    #: browser cannot set it; only ``admin_objects`` (``load`` directly, ``push`` through
    #: ``ObjectUpsertIn``) and the plan pipelines write it. It is
    #: the object's provenance: a key means «loaded by the pipeline», no key means «typed in
    #: the browser», and the scheduled Planspeicher-Abgleich matches on nothing else
    #: (plans.py · pull_plans), so an object without one is one it never touches.
    source_key: str | None = None
    #: Sofortmassnahmen / Bemerkungen (one per line) + their source — see ``ObjectSite.measures``.
    measures: str | None = None
    remarks: str | None = None
    measures_source: str | None = None
    #: the town when it is not the home town («Therwil») — see ``ObjectSite.locality``
    locality: str | None = None
    #: ``'station'`` = the station corrected the position in /admin; no import overwrites it
    position_source: str | None = None
    position_set_at: datetime | None = None
    #: the station's outline choice: NULL = automatic, ``building``, ``none``
    outline: str | None = None
    updated_at: datetime


class ObjectPositionIn(BaseModel):
    """``PUT /api/objects/{id}/position`` — «Lage korrigieren» in /admin. The pin, how the map
    outlines the object, and (when the station picked it from the register) its address + town."""

    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    outline: Literal["auto", "building", "none"] = "auto"
    #: replaces the stored address only when SENT (picked from the register)
    address: str | None = Field(default=None, max_length=300)
    #: the town; written when sent (null/"" clears it). The home town is never stored.
    locality: str | None = Field(default=None, max_length=120)


class ObjectPositionEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    action: str
    actor: str | None = None
    before: dict[str, Any]
    after: dict[str, Any]
    created_at: datetime


class PlaceHitOut(BaseModel):
    """One register address for the «Lage korrigieren» picker."""

    label: str
    street: str
    town: str | None = None
    home: bool = False
    lat: float
    lng: float


class ReferenceDatasetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    object_id: uuid.UUID | None = None
    module: str | None = None
    kind: str
    title: str | None = None
    source_type: str
    source_note: str | None = None
    content_type: str | None = None
    size_bytes: int | None = None
    feature_count: int | None = None
    current_version: int
    fetch_url: str | None = None
    updated_at: datetime


class ObjectWithPlans(ObjectOut):
    plans: list[ReferenceDatasetOut] = []
    distance_m: float | None = None
    # True when the incident's address matched this object's address (objects_near_incident);
    # False when it was surfaced by proximity alone – the plan rail warns then, because a plan of
    # the neighbour looks exactly like a plan of the building on fire. None outside that endpoint.
    address_match: bool | None = None


class BuildingSystemOut(BaseModel):
    """One heating or hot-water system: what makes the heat, from what (app/building_facts)."""

    #: heat_pump, solar_thermal, boiler, stove, chp, electric_storage, electric_direct,
    #: heat_exchanger, electric_boiler – None when the register names no generator
    generator: str | None = None
    #: an energy key (see BuildingGwrOut.heating); None when the register names none
    energy: str | None = None
    #: the generator serves several buildings – it may stand in another one
    shared: bool = False


class BuildingFloorFlatsOut(BaseModel):
    """The existing flats whose entrance is on one storey."""

    #: 0 = Parterre, 1 = 1. Stock, -1 = 1. Untergeschoss
    level: int
    flats: int
    #: of those, Maisonettes (spanning more than one storey)
    maisonettes: int = 0


class BuildingGwrOut(BaseModel):
    """GWR facts about the building — keys and numbers; the words are the app's copy."""

    #: the register's export date for this entry («GWR Stand …»)
    stand: date | None = None
    floors: int | None = None
    flats: int | None = None
    year: int | None = None
    #: «1919–1945» / «≤1918» / «≥2016» when the exact year is unknown
    period: str | None = None
    #: energy keys (gas, oil, wood, district, air, geothermal, water, electricity, solar,
    #: waste_heat, unknown, other) of the first and second heat generator
    heating: list[str] = Field(default_factory=list)
    #: when the heating entry was last updated — it can be years old
    heating_date: date | None = None
    hot_water: list[str] = Field(default_factory=list)
    #: True = a Zivilschutzraum is registered; None = none registered (never drawn)
    shelter: bool | None = None
    #: only when the building is NOT simply «bestehend» (planned, under_construction, …)
    status: str | None = None
    #: the Gebäudeklasse as a key (single_family, multi_family, home, school, hospital, …)
    building_class: str | None = None
    #: heating systems 1 and 2 with their generator; «kein Wärmeerzeuger» is left out
    heaters: list[BuildingSystemOut] = Field(default_factory=list)
    #: hot-water systems 1 and 2, the same way
    water_heaters: list[BuildingSystemOut] = Field(default_factory=list)
    #: existing flats per storey, lowest first; empty when not every flat names its storey
    flats_by_floor: list[BuildingFloorFlatsOut] = Field(default_factory=list)
    #: the Zimmer range of the existing flats
    rooms_min: int | None = None
    rooms_max: int | None = None


class BuildingPlantOut(BaseModel):
    """One registered electricity production plant on the building (BFE)."""

    kind: Literal["pv", "other"]
    #: the register's own category label in the requested language («Photovoltaik»)
    label: str | None = None
    power_kw: float | None = None
    since: date | None = None


class BuildingObjectOut(BaseModel):
    """The Einsatzobjekt the card speaks for — the plan rail's object (api/objects ·
    ranked_objects_near), or the one the operator picked."""

    id: uuid.UUID
    name: str
    #: False = surfaced by proximity alone; the card says «in der Nähe» then
    address_match: bool = False
    distance_m: float | None = None
    measures: str | None = None
    remarks: str | None = None
    measures_source: str | None = None
    updated_at: datetime | None = None


class BuildingVisitOut(BaseModel):
    """The object's last completed Objektbesuch."""

    id: str
    visited_at: datetime | None = None
    #: Mängel recorded on that visit
    findings: int = 0


class BuildingOut(BaseModel):
    """``GET /api/incidents/{id}/building`` — the Gebäude card (app/building_facts).

    Every half is optional and fails on its own: ``gwr_status``/``pv_status`` say whether the
    register could be ASKED (``error``) as opposed to having nothing to say (``none``/``ok`` with
    an empty list). ``registers`` says why they were not asked at all.
    """

    registers: Literal["on", "off", "outside_ch", "no_location"]
    egid: str | None = None
    #: the register's address of the matched building («Hauptstrasse 10, 4104 Oberwil»)
    address: str | None = None
    gwr: BuildingGwrOut | None = None
    gwr_status: Literal["ok", "none", "error", "skipped"] = "skipped"
    plants: list[BuildingPlantOut] = Field(default_factory=list)
    pv_status: Literal["ok", "error", "skipped"] = "skipped"
    #: when the registers were asked (the server caches an answer for a day)
    registers_fetched_at: datetime | None = None
    object: BuildingObjectOut | None = None
    visit: BuildingVisitOut | None = None


class ReferencePlanOut(BaseModel):
    """One Modul-PDF of a station object, as «Karte & Objekte» lists it (api/station_reference)."""

    id: str
    #: the module key («modul1», «modul23») — the client's NavRail derives its monogram from it
    module: str | None = None
    #: the short code the panel prints («1», «2/3»)
    code: str
    title: str
    #: pages of the current revision when already known (a written tile manifest), else None
    pages: int | None = None
    #: True = the current revision carries a published, approved map fit («auf der Karte»)
    georef: bool = False
    #: the current revision — what ``/api/reference/{id}?v=`` opens
    version: int
    updated_at: datetime | None = Field(default=None, serialization_alias="updatedAt")


class ReferenceFloorOut(BaseModel):
    """One Geschoss of an object's floor pack: the signed order index and the station's name, if
    it gave one. The words («EG», «1. OG») are the client's copy (lib/whiteboard · floorLabel)."""

    index: int
    name: str | None = None


class ReferenceLastVisitOut(BaseModel):
    """The object's last completed Objektbesuch."""

    id: str
    #: the checklist's title; None for «Ohne Checkliste»
    checklist: str | None = None
    date: datetime | None = None
    #: Mängel recorded on that visit
    defects: int = 0


class ReferenceObjectOut(BaseModel):
    """One station object for the reference viewer — an Einsatzobjekt or a plan-less object."""

    model_config = ConfigDict(populate_by_name=True)

    id: uuid.UUID
    name: str
    #: ``depot`` (key box) is retired (review round 3, 17.10.2026) and never sent
    kind: Literal["einsatzobjekt", "objekt"]
    #: where it is, for every object where that is knowable (docs/karte-objekte.md · address): the
    #: station's address; else the name when it IS a street + number; else the register's
    #: address at the pin. None only when none of the three exists.
    address: str | None = None
    #: the town, ONLY when it is not the home town («Therwil»); the client prints «address, locality»
    locality: str | None = None
    lat: float | None = None
    lng: float | None = None
    #: the station's outline choice: ``auto`` (the footprint rule, else the OSM building at the
    #: point), ``building`` (only the building at the pin), ``none`` (no outline at all — the
    #: viewer must not fall back to OSM either)
    outline: Literal["auto", "building", "none"] = "auto"
    #: other names the object is known by (the station's plan-library folder, …) — search reads them
    aliases: list[str] = Field(default_factory=list)
    plans: list[ReferencePlanOut] = Field(default_factory=list)
    floors: list[ReferenceFloorOut] = Field(default_factory=list)
    #: the building's EGID when the station data names it; None today (no source carries one)
    egid: str | None = None
    #: the object's buildings as ONE GeoJSON MultiPolygon, the building its point lies in first —
    #: derived from the use area / parcel / cadastral survey (app/object_footprints); None = the
    #: client falls back to the OSM building its point lies in
    footprint: dict[str, Any] | None = None
    #: the survey's structures (AV Einzelobjekte — underground garages, shelters) of the addresses an
    #: object's name covers that have no surface building, one MultiPolygon; None = none known
    underground: dict[str, Any] | None = None
    #: Sofortmassnahmen / Bemerkungen off the Modul-1 sheet and where they came from
    measures: str | None = None
    remarks: str | None = None
    measures_source: str | None = Field(default=None, serialization_alias="measuresSource")
    updated_at: datetime | None = Field(default=None, serialization_alias="updatedAt")
    last_visit: ReferenceLastVisitOut | None = Field(default=None, serialization_alias="lastVisit")


class ReferenceObjectsOut(BaseModel):
    """``GET /api/reference/objects`` — every station object, for «Karte & Objekte»."""

    objects: list[ReferenceObjectOut] = Field(default_factory=list)
    generated_at: datetime = Field(serialization_alias="generatedAt")


class PlanSourcesOut(BaseModel):
    """Which scheduled pulls can put a Modul-PDF into this deployment – not what they DID.

    The last run's outcome lives on Verwaltung › System (the SharePoint card); this answers the
    one question the Objektpläne page cannot answer from its own data: does an automatic pull
    exist at all. That is what turns «von Hand erstellt» from a label into a warning, and it is
    why both flags are false-when-unknown rather than optional.
    """

    #: The PLANS_S3_* snapshot store. Env-only and boot-gated (scheduler.py), and it matches
    #: objects on ``source_key`` – so it never sees an object created in the browser.
    bucket: bool
    #: The SharePoint connector, and only when it has a ``plans`` folder. It matches on the
    #: uuid5 of the folder name, i.e. the same derivation the Objekt-Maske uses for its key.
    sharepoint: bool


# --- Personnel (Mannschaft) ---------------------------------------------------------
class PersonnelExternalIdentityOut(BaseModel):
    provider: str
    external_id: str
    synced_at: datetime


class PersonnelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    divera_id: int | None = None
    external_identities: list[PersonnelExternalIdentityOut] = Field(default_factory=list)
    display_name: str
    first_name: str | None = None
    last_name: str | None = None
    rank: str | None = None
    is_active: bool
    updated_at: datetime


class PersonnelCreate(BaseModel):
    """Manually add a crew member. ``divera_id`` is normally null (hand entry); a bare
    name is enough."""

    display_name: str = Field(min_length=1)
    divera_id: int | None = None
    rank: str | None = None


class PersonnelUpdate(BaseModel):
    """All optional — rename / (de)activate / set rank."""

    display_name: str | None = Field(default=None, min_length=1)
    first_name: str | None = None
    last_name: str | None = None
    rank: str | None = None
    is_active: bool | None = None


class RosterRankOption(BaseModel):
    """One rank the station's list knows, as the mapping sheet offers it."""

    key: str
    label: str
    abbr: str | None = None


class RosterUnknownRank(BaseModel):
    """One rank VALUE from the file that the station's list does not cover.

    Counted by value, never by row: three people spelled «Sdt» are one decision, not three
    warnings. A 40-person import with one unfamiliar rank must ask once, not forty times —
    that is what makes the mapping step usable instead of a wall of warnings to click past."""

    value: str
    count: int
    #: a few of the affected names, so the operator can see who this is about
    people: list[str] = Field(default_factory=list)
    #: rank key whose spelling is closest — a proposal for the picker, never applied by itself
    suggestion: str | None = None


class RosterImportPreview(BaseModel):
    """What a CSV import WOULD do. Nothing is written to produce this."""

    #: rows that carry a usable name — the number of people the import would touch
    total: int
    skipped: int
    errors: list[str] = Field(default_factory=list)
    unknown_ranks: list[RosterUnknownRank] = Field(default_factory=list)
    known_ranks: list[RosterRankOption] = Field(default_factory=list)
    #: False while the station is still running on the shipped Swiss default list — the case in
    #: which adopting a rank also materialises that default (app/personnel.adopt_ranks)
    has_own_ranks: bool = False


class RosterRankDecision(BaseModel):
    """What to do with ONE unknown rank value: put it on a known rank, adopt it as a new one,
    or import those people without a Dienstgrad. There is no fourth option and no default —
    an undecided value stops the import before anything is written."""

    value: str
    action: Literal["map", "adopt", "skip"]
    #: target rank key, required for ``map`` and ignored otherwise
    rank: str | None = None


class RosterImportResult(BaseModel):
    imported: int
    skipped: int
    errors: list[str] = Field(default_factory=list)
    #: rank keys written into ``roster.ranks`` by this import (empty unless something was adopted)
    adopted_ranks: list[str] = Field(default_factory=list)


class PersonnelSyncPreview(BaseModel):
    """Read-only diff of Divera members vs the personnel table (no writes applied)."""

    new: list[dict[str, Any]] = []
    updated: list[dict[str, Any]] = []
    unchanged: list[dict[str, Any]] = []
    stale: list[dict[str, Any]] = []


class PersonnelSyncExecuteBody(BaseModel):
    # default false: stale members stay active (and assignable) until explicitly confirmed
    deactivate_stale: bool = False


class PersonnelSyncResult(BaseModel):
    created: int
    updated: int
    reactivated: int
    unchanged: int
    deactivated: int
    stale: int


# --- Deployment config (Phase 1.A — per-station settings) ---------------------------
# Mirrors docs/CONFIGURATION.md §1. EVERY field is optional with a sensible default so
# an empty `{}` validates and the app runs as a generic empty station. camelCase field
# names match the frontend contract (appConfig.ts / types.ts); we keep them verbatim
# rather than aliasing because the document round-trips as-is to the client.


class IdentityAssets(BaseModel):
    model_config = ConfigDict(extra="ignore")
    logo: str | None = None
    #: Letterhead of the printed Einsatzrapport; falls back to `logo` when unset.
    #: ⚠️ A slot missing HERE is silently dropped — `extra="ignore"` means the upload succeeds,
    #: the blob is stored, and the URL vanishes on the way back out through this projection.
    reportLogo: str | None = None
    iconPng192: str | None = None
    iconPng512: str | None = None
    favicon: str | None = None


#: What `identity.accentColor` may be. The NARROWEST consumer sets the format: the PWA
#: manifest's `theme_color` is hex-only (webmanifest.py · _HEX_COLOR — an unparseable one makes
#: some Chromium versions reject the whole manifest), and the same string is also painted as the
#: CSS `--accent` on the login screen and the splash and printed on the Rapport letterhead. So
#: hex, in the four forms CSS knows. The leading `#` is optional on the way IN — a value pasted
#: out of a design tool often has none — and always present on the way out, so what is stored is
#: exactly what the manifest trusts.
_ACCENT_HEX = re.compile(r"^#?(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
_ACCENT_ERROR = "Akzentfarbe muss ein Hex-Farbwert sein, z. B. #e8392b (leer = Standardfarbe)"


#: `identity.shortName`: the station's short label on the Karte's menu button (owner, review
#: round 5: «a new short name like "fwo" that others can configure»). The button shares a 44 px
#: bar with the search on a 390 px phone, so the cap is what fits there beside the mark and the ▾.
SHORT_NAME_MAX = 8
_SHORT_NAME_ERROR = f"Kurzname darf höchstens {SHORT_NAME_MAX} Zeichen haben, z. B. «FWO» (leer = Menü-Symbol)"


class IdentityConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")
    appName: str | None = None
    #: the menu button's label at the top left of «Karte & Objekte»; unset → a neutral menu symbol
    shortName: str | None = Field(default=None, max_length=SHORT_NAME_MAX)
    locale: str | None = None

    @field_validator("shortName", mode="before")
    @classmethod
    def _short_name_fits(cls, v: Any, info: ValidationInfo) -> str | None:
        """Trim, «» → unset, and refuse a label longer than the button holds — in German, with
        the rule in the message (it reaches the Verwaltung and `admin_config load`). A STORED
        value longer than the cap (a row written by hand, or before a lower cap) is cut, never
        refused: refusing would empty the whole document on read (see `_accent_is_a_colour`)."""
        if v is None:
            return None
        if not isinstance(v, str):
            raise ValueError(_SHORT_NAME_ERROR)
        text = " ".join(v.split())
        if not text:
            return None
        if len(text) > SHORT_NAME_MAX:
            if (info.context or {}).get("stored"):
                logger.warning("identity.shortName %r is longer than %d — serving it cut", text, SHORT_NAME_MAX)
                return text[:SHORT_NAME_MAX].rstrip()
            raise ValueError(_SHORT_NAME_ERROR)
        return text

    accentColor: str | None = None

    @field_validator("accentColor", mode="before")
    @classmethod
    def _accent_is_a_colour(cls, v: Any, info: ValidationInfo) -> str | None:
        """Refuse an accent colour that is not a colour — and never let a STORED one brick the
        document it sits in.

        Until now this field was free text: «nicht-eine-farbe» was answered with 200 and
        «Gespeichert», the swatch went black, and the value went on to the login screen, the
        splash and the Rapport letterhead (the manifest was the one consumer that already
        checked, so it silently served the build-time colour instead).

        ⚠️ A document that is ALREADY IN THE DATABASE is read through this same model, so a
        refusal there would be far worse than the bad colour: `get_config` falls back to an
        EMPTY config when validation fails, which would drop the station's fleet, roster and
        doctrine off the login screen over one field. Stored documents are therefore validated
        with `context={"stored": True}` (see `load_stored_config`), where an unusable colour is
        dropped to `None` instead — the app falls back to its built-in brand red, and Verwaltung
        shows the field empty and SAVABLE rather than 422-ing every later edit on every page.
        """
        if v is None:
            return None
        if not isinstance(v, str):
            raise ValueError(_ACCENT_ERROR)
        text = v.strip()
        if not text:
            return None  # a cleared field is «unset», never the empty string
        if _ACCENT_HEX.match(text):
            return "#" + text.lstrip("#").lower()
        if (info.context or {}).get("stored"):
            logger.warning("identity.accentColor %r is not a hex colour — serving it unset", text)
            return None
        raise ValueError(_ACCENT_ERROR)

    assets: IdentityAssets = Field(default_factory=IdentityAssets)
    helpIntro: str | None = None
    # Station Kommandant (display name) — pre-fills the Kommandant signature line on the
    # Einsatzrapport; purely informational, grants no role/permission.
    kommandant: str | None = None
    # Demo deployments: render a persistent "DEMO" ribbon everywhere and an optional note
    # (e.g. login credentials / reset cadence). Off/empty for real stations. The client shows
    # demoNote only while demoMode is true (lib/deploymentConfig · demoNote), so switching demo
    # mode off also retires the «PIN 000000 für alle» line without anyone having to clear it.
    demoMode: bool | None = None
    demoNote: str | None = None


class MapDefaultView(BaseModel):
    model_config = ConfigDict(extra="ignore")
    center: list[float] | None = None  # [lon, lat] WGS84
    centerLv95: list[float] | None = None  # [easting, northing] EPSG:2056
    zoom: float | None = None

    @model_validator(mode="after")
    def _one_crs(self) -> "MapDefaultView":
        # Invalid CRS pair: exactly one origin form may be set, never both.
        if self.center is not None and self.centerLv95 is not None:
            raise ValueError("map.defaultView: set either 'center' (WGS84) or 'centerLv95' (LV95), not both")
        return self


class MapGeocoder(BaseModel):
    model_config = ConfigDict(extra="ignore")
    defaultLocality: str | None = None
    bboxLv95: str | None = None


class MapExternalLink(BaseModel):
    # A station-supplied deep link to an external map portal, built per-incident. The
    # urlTemplate may use {E}/{N} (LV95 easting/northing) and {lng}/{lat} (WGS84).
    model_config = ConfigDict(extra="ignore")
    label: str | None = None
    urlTemplate: str | None = None


class ObjectCategoryMatch(BaseModel):
    """When an object belongs to a category: every condition NAMED holds (none named = always)."""

    model_config = ConfigDict(extra="ignore")
    #: the object's kind is one of these. ``depot`` is RETIRED (review round 3, 17.10.2026: there
    #: are no key-box objects any more): still accepted so an existing config stays valid, it
    #: never matches — a rule naming only ``depot`` matches nothing (lib/karte/categories)
    kinds: list[Literal["einsatzobjekt", "objekt", "depot"]] | None = None
    #: one of the object's plan modules matches one of these globs (``modul5-pv*``, ``modul6``)
    modules: list[Annotated[str, Field(min_length=1, max_length=60)]] | None = Field(default=None, max_length=30)


class ObjectCategoryConfig(BaseModel):
    """One colour rule for «Karte & Objekte» (src/lib/karte/categories.ts). Ordered, first match
    wins; an object no rule matches keeps the default look (ink, grey without plans)."""

    model_config = ConfigDict(extra="ignore")
    id: str = Field(min_length=1, max_length=40, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    #: one string, or one per language (``{"de": "Photovoltaik", "fr": "Photovoltaïque"}``)
    label: str | dict[Literal["de", "fr", "it", "en"], str]
    #: ``#rrggbb``, or ``ink``: the default look's colour (the theme's ``--obj-plans`` — near-white
    #: at night, near-black by day), for a category that only wants its own Ebenen row
    color: str = Field(pattern=r"^(#[0-9a-fA-F]{6}|ink)$")
    match: ObjectCategoryMatch = Field(default_factory=ObjectCategoryMatch)


class MapServiceArea(BaseModel):
    """The brigade's Einsatzgebiet as its municipalities (BFS numbers), for what the backend reads
    over the station's area (app/underground). Empty = the municipality at ``defaultView``."""

    model_config = ConfigDict(extra="ignore")
    municipalities: list[int] = Field(default_factory=list, max_length=50)


class MapConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")
    defaultView: MapDefaultView = Field(default_factory=MapDefaultView)
    geocoder: MapGeocoder = Field(default_factory=MapGeocoder)
    externalLinks: list[MapExternalLink] = Field(default_factory=list)
    # «Karte & Objekte»: the station's object colours (docs/karte-objekte.md · Categories). Empty
    # = the default look for every object (ink, grey without plans).
    objectCategories: list[ObjectCategoryConfig] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def _unique_category_ids(self) -> "MapConfig":
        ids = [c.id for c in self.objectCategories]
        dupes = sorted({i for i in ids if ids.count(i) > 1})
        if dupes:
            raise ValueError(f"map.objectCategories: id(s) {dupes} used twice")
        return self

    # The Gebäude card's federal-register half (app/building_facts: GWR + BFE, both Swiss). Unset
    # = on wherever the Einsatzort lies in Switzerland; false = never ask them (a station that does
    # not want it, or one outside CH that wants to say so). The Objekt's Sofortmassnahmen are the
    # station's own data and show either way.
    buildingRegister: bool | None = None
    # The Einsatzgebiet (review round 4, 17.10.2026): the municipalities whose underground buildings
    # «Unterirdische Bauten» draws, plus the surroundings of every station object. Unset = the
    # municipality the station's map centre (`defaultView`) lies in.
    serviceArea: MapServiceArea = Field(default_factory=MapServiceArea)


class ReferenceLayerConfig(BaseModel):
    """A station-supplied reference layer (raster WMS/WMTS or vector GeoJSON).

    Permissive (extra=ignore) but enforces the kind→payload invariant: raster layers
    must carry `tiles`, geojson layers must carry `geojson`. Malformed entries reject.
    """

    model_config = ConfigDict(extra="ignore")
    id: str | None = None
    group: str | None = None
    label: str | None = None
    icon: str | None = None
    kind: Literal["wms", "wmts", "geojson"] | None = None
    tiles: list[str] | None = None
    geojson: str | None = None
    vectorKind: str | None = None
    symbol: str | None = None
    color: str | None = None
    nightColor: str | None = None
    opacity: float | None = None
    maxzoom: float | None = None
    attribution: str | None = None
    # Einsatz categories (German `kategorien` values, e.g. "Brandbekämpfung") that switch
    # this layer visible when an incident of that category is created / re-categorized.
    autoActivate: list[str] | None = None

    @model_validator(mode="after")
    def _kind_payload(self) -> "ReferenceLayerConfig":
        if self.kind in ("wms", "wmts") and not self.tiles:
            raise ValueError(f"referenceLayer {self.id!r}: raster layer ({self.kind}) requires 'tiles'")
        if self.kind == "geojson" and not self.geojson:
            raise ValueError(f"referenceLayer {self.id!r}: geojson layer requires 'geojson'")
        return self


class FleetPartner(BaseModel):
    model_config = ConfigDict(extra="ignore")
    feuerwehr: list[str] = Field(default_factory=list)
    sanitaet: list[str] = Field(default_factory=list)
    polizei: list[str] = Field(default_factory=list)
    chemiewehr: list[str] = Field(default_factory=list)
    zivilschutz: list[str] = Field(default_factory=list)


class FleetAttributeList(BaseModel):
    """A data-driven suggestion list for one symbol field (``field == 'title'`` targets the
    title input; any other key targets that detail row). Replaces the fixed vehicle/Lüfter/…
    lists below so a deployment can attach a list to any symbol field."""

    model_config = ConfigDict(extra="ignore")
    symbol: str
    field: str
    options: list[str] = Field(default_factory=list)


class FleetVehicle(BaseModel):
    """One station vehicle for the Alarmierungs-/Ausrückzeiten grid (rapport form, paper
    Erfassungsblatt, milestone webhook matching, stats export). `id` should equal the
    sender's device name (Traccar convention, e.g. 'tlf') — matching is a plain string
    compare. Empty `fleet.vehicles` (default) hides every vehicle-times surface."""

    model_config = ConfigDict(extra="ignore")
    id: str = Field(min_length=1)
    label: str = Field(min_length=1)
    winfapAlias: str | None = None


class FleetConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")
    vehicles: list[FleetVehicle] = Field(default_factory=list)
    attributeLists: list[FleetAttributeList] = Field(default_factory=list)
    #: «Herkunft» (05.11.2026): where a vehicle that is not the own Feuerwehr comes from
    #: (Stützpunkt, Zivilschutz, Wache Nord …). ONE suggestion list for every vehicle symbol and
    #: every live GPS vehicle; free typing stays possible, empty = no suggestions. Edited at
    #: /admin › Fahrzeuge & Symbole and as Kategorie «Herkunft» on the workbook's
    #: Partnerorganisationen sheet.
    origins: list[str] = Field(default_factory=list)
    # Legacy fixed lists — still accepted/echoed so existing stored configs round-trip; the
    # admin editor migrates them into attributeLists on first edit.
    vehicleTypes: list[str] = Field(default_factory=list)
    luefterTypes: list[str] = Field(default_factory=list)
    kleinloeschTypes: list[str] = Field(default_factory=list)
    partner: FleetPartner = Field(default_factory=FleetPartner)


class EquipmentItem(BaseModel):
    """One entry of ``doctrine.equipment`` — the id a Trupp stores, the label people read."""

    model_config = ConfigDict(extra="ignore")
    id: str = Field(min_length=1, max_length=40)
    label: str = Field(min_length=1, max_length=40)


#: The upper bound of ``doctrine.nearbyObjectWarnM`` – beyond it the nearest object is no
#: candidate for the Einsatzort at all.
NEARBY_OBJECT_WARN_MAX_M = 500


class DoctrineConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")
    defaultFunkkanal: int | None = None
    #: Default channel for a Trupp OHNE Atemschutz; unset = same as ``defaultFunkkanal``.
    defaultFunkkanalEinfach: int | None = None
    funkkanalMin: int | None = None
    funkkanalMax: int | None = None
    # Zero is a deliberate public-demo escape hatch. DeploymentConfigIn rejects it for
    # ordinary station configs; positive station thresholds stay within the same safety range
    # as the Rückzug line.
    #
    # ⚠️ The range is enforced in `_pressure_lines_stay_in_range` below, NOT as `Field(le=…)`.
    # A field constraint runs before every model validator, so it would fire even under
    # `context={"stored": True}` — and both numbers were UNBOUNDED in earlier releases, so a
    # row written back then can hold anything. A stored 320 would then take the WHOLE document
    # down and `get_config` would serve the station an empty config (no name, fleet or roster)
    # over one doctrine number. Exactly the case `load_stored_config` exists to prevent.
    alarmBar: int | None = None
    #: The lower Alarmdruck applied while a Trupp is on Rückzug. Bounded like ``cylinderLiters``
    #: below, because on this field an empty-looking value is not «off»: ``app/push.py`` only
    #: alarms while ``line > 0``, and the frontend reads ``alarmBarRueckzug ?? alarmBar``, where
    #: ``0 ?? x`` is ``0`` — so a stored zero silently removes the Rückzug alarm on BOTH paths
    #: instead of falling back to ``alarmBar``. To switch the lower line off, set it EQUAL to
    #: ``alarmBar`` (src/lib/atemschutz.ts documents that as the way back to the old behaviour).
    alarmBarRueckzug: int | None = None
    contactIntervalMin: int | None = None
    contactGraceSec: int | None = None
    defaultPressureBar: int | None = None
    #: The lowest Eingangsdruck the Trupp form takes without asking once (24.09.2026): below it,
    #: registering, re-entering on a new cylinder or correcting asks «180 bar ist für einen Eintritt
    #: tief (Station: ab 270)» with the value on the confirm button. ``0`` switches the question
    #: off; unset is the shipped 270. No upper bound on purpose. A frontend-only question — the
    #: server never refuses a reading over it (a low entry is sometimes simply true).
    entryPressureMin: int | None = None
    pressureStep: int | None = None
    pressureMax: int | None = None
    #: The two numbers behind the Atemschutz air estimate («noch ≈ 246 bar»): the cylinder's
    #: volume in litres and the litres/min a working AdF is reckoned to breathe. The frontend has
    #: read these from the deployment config all along — but ``extra="ignore"`` meant the backend
    #: silently DROPPED them on save, so the estimate looked like a station setting and was in
    #: fact the shipped 7 L / 50 L·min⁻¹ everywhere. A 9-litre cylinder is an ordinary thing for a
    #: Wehr to own, and the estimate is what an Überwacher plans a relief against.
    cylinderLiters: float | None = Field(default=None, gt=0, le=30)
    estConsumptionLPerMin: float | None = Field(default=None, gt=0, le=200)
    # Station colour per Atemschutz-Auftrag (auftrag id → CSS colour), e.g. {"loeschen": "#e8392b"}.
    # The colour a Trupp with that order STARTS in; it stays overridable per Trupp. Absent/empty
    # keeps the automatic behaviour (every Trupp a different colour from the palette).
    auftragColors: dict[str, str] | None = None
    # The station's Ausrüstung list for a Trupp — short labels, as they print on the card and the
    # Rapport («Retthaube», «WBK»). Absent/empty keeps the shipped default (src/config/appConfig.ts ·
    # atemschutz.equipment). Declared here because ``extra="ignore"`` would otherwise drop it on save.
    equipment: list[EquipmentItem] | None = None
    #: Modul-Pläne (sweep E.6, 23.10.2026): the «nächstes Objekt, nicht die Einsatzadresse»
    #: warning shows only when the nearest object lies farther than this from the Einsatzort, in
    #: metres. It fired at «0 m entfernt» for an Einsatz addressed by the object's own name.
    #: 0 warns on every address mismatch (the old rule). The bounds are published in the schema
    #: (the /admin field reads them) but enforced in `_nearby_warning_in_range`, so a stored
    #: value outside them degrades instead of failing the whole document.
    nearbyObjectWarnM: int = Field(default=25, json_schema_extra={"minimum": 0, "maximum": NEARBY_OBJECT_WARN_MAX_M})
    #: The hose Ø (owner 05.11.2026, src/lib/hydraulics · hoseDefaults): what a Leitung that stores
    #: none reads as – a plain Linie is a 40 mm Druckleitung – and what a Wassertransport in Messen
    #: starts on, a 75 mm Transportleitung. Unset = those shipped values. The relay one never takes
    #: 40: the 40 mm friction table ends at 500 l/min, below a relay's usual flows. The keys are
    #: the frontend's `HoseSize` («2x75» = the identical double line).
    defaultLineHose: Literal["40", "55", "75", "2x75", "110"] | None = None
    defaultRelayHose: Literal["55", "75", "2x75", "110"] | None = None

    @model_validator(mode="after")
    def _nearby_warning_in_range(self, info: ValidationInfo) -> "DoctrineConfig":
        """0–500 m; a stored value outside drops to the default (see `_pressure_lines_stay_in_range`
        for why stored documents degrade instead of failing)."""
        if not (0 <= self.nearbyObjectWarnM <= NEARBY_OBJECT_WARN_MAX_M):
            if not (info.context or {}).get("stored"):
                raise ValueError(
                    f"doctrine.nearbyObjectWarnM ({self.nearbyObjectWarnM}) must be between 0 and "
                    f"{NEARBY_OBJECT_WARN_MAX_M}"
                )
            logger.warning("doctrine.nearbyObjectWarnM %r is out of range — serving 25 m", self.nearbyObjectWarnM)
            self.nearbyObjectWarnM = 25
        return self

    @model_validator(mode="after")
    def _pressure_lines_stay_in_range(self, info: ValidationInfo) -> "DoctrineConfig":
        """Keep both Alarmdruck lines inside the range the app can actually alarm on.

        `alarmBar` accepts 0 (the public-demo «off», which DeploymentConfigIn then refuses for
        ordinary stations); `alarmBarRueckzug` does not, because on that field a zero is not
        «unset» but a silently removed alarm — see its comment above. Both cap at the 300 bar a
        cylinder is filled to.

        ⚠️ Written as a validator rather than `Field(ge=…, le=…)` on purpose: a STORED document
        is read through this same model, and a field constraint cannot see
        `context={"stored": True}`. A row from before these bounds existed is therefore dropped
        to its unset default and logged, not refused — losing a station's whole configuration
        over one out-of-range number is not a proportionate answer (`load_stored_config`).
        """
        stored = bool((info.context or {}).get("stored"))
        if self.alarmBar is not None and not (0 <= self.alarmBar <= 300):
            if not stored:
                raise ValueError(f"doctrine.alarmBar ({self.alarmBar}) must be between 0 and 300")
            logger.warning("doctrine.alarmBar %r is out of range — serving the station defaults", self.alarmBar)
            self.alarmBar = None
            self.alarmBarRueckzug = None
        if self.alarmBarRueckzug is not None and not (0 < self.alarmBarRueckzug <= 300):
            if not stored:
                raise ValueError(f"doctrine.alarmBarRueckzug ({self.alarmBarRueckzug}) must be between 1 and 300")
            logger.warning(
                "doctrine.alarmBarRueckzug %r is out of range — serving the shipped Rückzug line",
                self.alarmBarRueckzug,
            )
            self.alarmBarRueckzug = None
        # The Eingangsdruck minimum only decides whether the form ASKS, so 0 («never ask») is a
        # legitimate station choice here, unlike on the two alarm lines. Same stored-vs-fresh
        # split as above: a hand-edited file row out of range degrades to the shipped value.
        if self.entryPressureMin is not None and not (0 <= self.entryPressureMin <= 300):
            if not stored:
                raise ValueError(f"doctrine.entryPressureMin ({self.entryPressureMin}) must be between 0 and 300")
            logger.warning(
                "doctrine.entryPressureMin %r is out of range — serving the shipped minimum",
                self.entryPressureMin,
            )
            self.entryPressureMin = None
        # The contact clock (audit F02): 0 or 1e308 used to pass, one alarming at once on the
        # push path and the other never. Out of range degrades to the shipped value when stored.
        for key, bounds in (("contactIntervalMin", CONTACT_INTERVAL_MIN), ("contactGraceSec", CONTACT_GRACE_SEC)):
            value = getattr(self, key)
            if value is not None and not in_range(value, bounds):
                if not stored:
                    raise ValueError(f"doctrine.{key} ({value}) must be between {bounds[0]} and {bounds[1]}")
                logger.warning("doctrine.%s %r is out of range — serving the shipped value", key, value)
                setattr(self, key, None)
        return self

    @model_validator(mode="after")
    def _rueckzug_line_stays_below_the_bare_alarm(self, info: ValidationInfo) -> "DoctrineConfig":
        """The Rückzug line is the QUIETER of the two and must stay at or below the bare Alarmdruck.

        Its whole point (src/lib/atemschutz.ts) is that a Trupp already ordered out must not have
        the card scream for the entire walk back — it speaks up again only lower down, where the
        crew is genuinely late getting out. Set above `alarmBar` it inverts that: the retreating
        Trupp would alarm earlier than one still working.

        ⚠️ A STORED pair in that order is CLAMPED, not refused — this rule postdates rows that
        were written without it, and the same reasoning as `_pressure_lines_stay_in_range`
        applies: an inverted pair costs the station one doctrine number, refusing costs it the
        whole configuration."""
        if (
            self.alarmBar is not None
            and self.alarmBar > 0
            and self.alarmBarRueckzug is not None
            and self.alarmBarRueckzug > self.alarmBar
        ):
            if (info.context or {}).get("stored"):
                logger.warning(
                    "doctrine.alarmBarRueckzug %r exceeds alarmBar %r — clamping to the bare alarm",
                    self.alarmBarRueckzug,
                    self.alarmBar,
                )
                self.alarmBarRueckzug = self.alarmBar
                return self
            raise ValueError(
                f"doctrine.alarmBarRueckzug ({self.alarmBarRueckzug}) must not exceed "
                f"doctrine.alarmBar ({self.alarmBar}) — the Rückzug line alarms earlier, not later"
            )
        return self


class AlarmGroup(BaseModel):
    """One station alarm group for the Alarmierungs-/Ausrückzeiten grid. `id` must match
    what the milestone sender uses; `tagespikett` marks the day-duty group."""

    model_config = ConfigDict(extra="ignore")
    id: str = Field(min_length=1)
    label: str = Field(min_length=1)
    color: str | None = None  # display hint on paper/form ('Rot', 'Grün', …)
    winfapAlias: str | None = None
    tagespikett: bool = False


class AlarmsConfig(BaseModel):
    """Alarm handling: auto-open incidents from incoming alarms + auto-archive of untouched
    auto-opened ones."""

    model_config = ConfigDict(extra="ignore")
    # DEPRECATED 2026-08-02, accepted and ignored. Auto-open is no longer a setting: every
    # alarm opens its Einsatz on arrival, on every path. The flag defaulted to off, so any
    # station that had not opted in left every Einsatz-Link holder on «Einsatz nicht (mehr)
    # verfügbar» until an editor took the alarm on a tablet — a config default is the wrong
    # place for that decision. What the filters bought (test alarms, Nachbarhilfe and BMA
    # runs not becoming counted Einsätze) is now bought by `Incident.editor_opened_at`
    # instead, which measures whether anyone ATTENDED rather than guessing from the keyword.
    # Kept in the schema so existing config files and the admin round-trip keep validating;
    # they will be dropped in the next MAJOR.
    autoOpen: bool = False
    autoOpenPriorities: list[Literal["HIGH", "LOW"]] | None = None
    autoOpenKeywords: list[str] | None = None
    autoArchiveDays: int = Field(default=7, ge=0)  # 0 = sweep off
    # …and the OTHER way an Einsatz stays open forever: one that WAS worked on and then simply
    # never closed. Archiving is a deliberate act nobody performs unless they know they have to,
    # so the open list grows by one row per Einsatz until somebody tidies up. Its own, much
    # longer clock — this one sweeps real work, so it must sit far past any chance of the Einsatz
    # still being in use. Archived WITHOUT stamping report_done_at: the Rapport was never
    # finished and the record must not claim it was. Reversible like every archive. 0 = off.
    staleIncidentDays: int = Field(default=30, ge=0)
    # …and an Übung closes itself much sooner (owner, 27.10.2026): a drill is over when nobody
    # has changed anything for this many hours, and leaving it open kept it in every device's
    # list and on the Erfassungs-Poster. Ernstfälle are never on this clock. Counted from the
    # last HUMAN change (vehicle_presence · last_activity), reversible like every archive. 0 = off.
    exerciseAutoCloseHours: int = Field(default=12, ge=0)
    # How long after an incident opened the station capture link (Erfassungs-Poster QR)
    # may still reach it once its Rapport is done. Incidents WITHOUT a completed Rapport
    # (and not archived) stay reachable regardless of age — the poster shows the open
    # backlog (decided 2026-07-11); the window only ages out finished ones.
    captureWindowHours: int = Field(default=12, ge=1, le=168)
    # Outbound webhooks: every URL gets a POST when an incident is created (any path —
    # manual, Divera take, auto-open, generic intake). Fail-open: delivery is retried,
    # logged, and NEVER blocks intake. Example receiver: a kp-rueck QR-slip adapter.
    webhooks: list[str] = Field(default_factory=list)
    # Station alarm groups for the Alarmierungs-/Ausrückzeiten grid (rapport form, paper
    # Erfassungsblatt, milestone webhook, stats export). Empty (default) hides the grid
    # everywhere — a vanilla deployment is unchanged.
    groups: list[AlarmGroup] = Field(default_factory=list)


class AlarmKeywordGroup(BaseModel):
    """One reader-facing grouping of high-priority keywords. `group`/`note` are documentation
    — priority inference is an any-match, so the grouping carries no meaning at runtime."""

    model_config = ConfigDict(extra="ignore")
    group: str | None = None
    note: str | None = None
    keywords: list[str] = Field(default_factory=list)


class AlarmHighPriorityKeywords(BaseModel):
    model_config = ConfigDict(extra="ignore")
    groups: list[AlarmKeywordGroup] = Field(default_factory=list)


class AlarmKeywordCategories(BaseModel):
    """`pairs` is ordered: the first keyword found in an uppercased title wins."""

    model_config = ConfigDict(extra="ignore")
    pairs: list[tuple[str, str]] = Field(default_factory=list)


class AlarmMatcherDivergence(BaseModel):
    """Documentation of the kp-front/kp-rueck matcher difference; carried so a station can copy
    the shipped file verbatim. kp-front's matcher does not read it."""

    model_config = ConfigDict(extra="ignore")
    kp_rueck_word_bounded: list[str] = Field(default_factory=list)


class AlarmKeywordsConfig(BaseModel):
    """A station's own alarm vocabulary — it REPLACES the shipped one wholesale.

    The shape is `backend/app/data/alarm_keywords.json` verbatim, so a station starts by
    copying that file (the documented way to add a single keyword) and pastes it under
    `alarmKeywords`. Hence the snake_case field names in here, unlike the rest of this
    document: they are the file's key names, not new ones. `_readme` and `schema` are accepted
    and dropped — they document the shipped file, not this deployment's row.

    Validity is decided ONCE, by `alarm_keywords.parse()`, the same rule the shipped file
    passes at import. There is no second schema to keep in step. On top of it, one kp-front
    rule the shared file cannot state: every category must be one this app has a German label
    for, because a vocabulary routing to an unknown category would file those alarms under
    «Diverse Einsätze» and never say why.
    """

    model_config = ConfigDict(extra="ignore")
    schema_version: int
    keyword_to_category: AlarmKeywordCategories
    fallback_category: str
    high_priority_keywords: AlarmHighPriorityKeywords = Field(default_factory=AlarmHighPriorityKeywords)
    known_matcher_divergence: AlarmMatcherDivergence = Field(default_factory=AlarmMatcherDivergence)

    @model_validator(mode="after")
    def _must_parse_and_stay_labelled(self) -> "AlarmKeywordsConfig":
        # Imported here, not at module scope: both modules import this one.
        from .alarm_keywords import InvalidVocabularyError, parse

        try:
            vocab = parse(self.model_dump(mode="json"))
        except InvalidVocabularyError as e:
            raise ValueError(str(e)) from e

        from .divera import CATEGORY_LABELS

        unknown = sorted(vocab.category_keys - set(CATEGORY_LABELS))
        if unknown:
            raise ValueError(
                f"routes to categories this app has no label for: {unknown}. "
                f"Known categories: {sorted(CATEGORY_LABELS)}"
            )
        return self


class AlarmVocabularyStatus(BaseModel):
    """Which vocabulary is running, on the public GET — so «what classifies our alarms» is
    answerable with one request instead of a database session."""

    model_config = ConfigDict(extra="ignore")
    source: Literal["shipped", "deployment"] = "shipped"
    schemaVersion: int = 1
    titleKeywords: int = 0
    highPriorityKeywords: int = 0
    fallbackCategory: str = ""


class JournalConfig(BaseModel):
    """Journal composer configuration: the station's Textbausteine (quick phrases) —
    tappable chips that pre-fill the entry text. Empty = the app's national defaults."""

    model_config = ConfigDict(extra="ignore")
    quickPhrases: list[str] = Field(default_factory=list)


class ReportConfig(BaseModel):
    """Einsatzrapport form presets. `partnerOrgs` feeds the Partnerorganisationen
    checkbox row (paper Erfassungsblatt + rapport form quick-pick); free-text entries
    remain possible everywhere. Empty = no preset row."""

    model_config = ConfigDict(extra="ignore")
    partnerOrgs: list[str] = Field(default_factory=list)
    #: Send the Rapport to the STATION PRINTER with its pages in reverse order.
    #:
    #: A printer that ejects face-up delivers a stack that is back-to-front, so the rapport has
    #: to be re-sorted by hand every time — which is exactly the moment nobody has. Reversing the
    #: document fixes the stack. Only the relay path is affected; a downloaded PDF is always in
    #: reading order, because that one is read on a screen.
    #:
    #: Default on: the relay is deliberately configured per station (PRINT_AGENT_SECRET), so
    #: whoever switches the printer on can switch this off if theirs ejects face-down.
    reversePrintOrder: bool = True
    #: How the SECOND Einsatzstunden figure on the rapport is rounded (the one in brackets).
    #:
    #: The first figure is the raw sum — what actually happened, never rounded. The second is
    #: each person's time rounded UP to the next ``stepMin`` block, but only once ``graceMin``
    #: past the previous one, then summed. With the default 30 / 5: 0:05 counts as 0:00, 0:06 as
    #: 0:30, 0:35 as 0:30, 0:36 as 1:00. The grace is what stops a crew that stayed three minutes
    #: over the half hour from being counted a whole block for it.
    #:
    #: Rounding is per PERSON and then summed — rounding the total instead would give the same
    #: Einsatz a different answer depending on how many people came. Set ``stepMin: 60`` for a
    #: station that counts whole hours. See ``docs/CONFIGURATION.md`` §1b.
    hoursRounding: "HoursRoundingConfig" = Field(default_factory=lambda: HoursRoundingConfig())
    #: How short a break between two recorded presence blocks still counts as ONE stretch on
    #: the Personalblatt, in minutes.
    #:
    #: Somebody ticked «gegangen» and «wieder anwesend» a minute later did not go home —
    #: that is a corrected mis-tap, or the QR poster and the tablet recording the same arrival
    #: from two sides. Printed as recorded it came out as two lines under one name
    #: («22:11 – 22:58» over «22:59 – 23:20»), which reads as a break that never happened.
    #:
    #: The record keeps both blocks either way; only the Rapport merges them, and the
    #: Einsatzstunden follow the same merge so the two halves of the sheet agree. ``0`` prints
    #: every block exactly as recorded. A station number, not a per-incident one: whether a
    #: ten-minute gap is «a break» or «two deployments» has to mean the same on every sheet
    #: the Wehr files. See ``docs/CONFIGURATION.md`` §1b.
    attendanceMergeGapMin: int = Field(default=15, ge=0, le=240)
    #: The station's OWN paperwork, as links on the Rapport ("Formulare & Links").
    #:
    #: Every Wehr has forms that live outside this app and still have to be filled in after an
    #: Einsatz — a Getränke-Abrechnung for the Gemeinde, a Schadenmeldung for the Versicherung,
    #: an internal Google-Form. They are station-specific by nature, so they are configuration:
    #: a deployment that sets none has no such section on its Rapport at all. Ticking one off
    #: is per-incident and lives in the workspace blob, not here. See
    #: ``docs/CONFIGURATION.md`` §1d and the frontend's ``src/lib/reportLinks.ts``.
    #:
    #: ⚠️ NOT optional. Verwaltung PUTs the whole document, so accepting ``None`` here would be
    #: the difference between "this station has no forms" and a 422 that wedges every later
    #: config edit in that tab. An empty list is how "none" is said.
    links: list["ReportLinkConfig"] = Field(default_factory=list, max_length=30)


class ReportLinkConfig(BaseModel):
    """One row of ``ReportConfig.links``.

    ``url`` may carry ``{platzhalter}`` tokens (``{stichwort}``, ``{ort}``, ``{datum}``,
    ``{alarmzeit}``, ``{einsatzende}``, ``{einsatzleiter}``, ``{kontaktperson}``,
    ``{kurzbericht}``, ``{wehr}``), which the app substitutes URL-encoded when the link is
    opened. That is how a Google Form arrives with Anlass and Datum already in it — see
    "Link zum Vorausfüllen abrufen" in Google Forms, which yields ``?usp=pp_url&entry.<id>=…``.

    The backend does not resolve or fetch these; it stores them.

    ⚠️ ``url`` is constrained to http(s) HERE as well, not only in the app. The frontend gate
    (``deploymentConfig · reportLinks``) protects the one consumer that exists today; a
    ``javascript:`` URL accepted into the stored document would be waiting for the next one.
    """

    model_config = ConfigDict(extra="ignore")
    #: stable id — an incident's tick state is filed under it
    id: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=120)
    url: str = Field(min_length=1, max_length=2048)
    #: when this has to be filled in ("nur bei Gebäudeschaden, innert 48 h")
    note: str | None = Field(default=None, max_length=200)

    @field_validator("id", "title", "url")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        """⚠️ Stripped, and blank-after-stripping is empty. ``min_length=1`` alone accepts a
        single space, while the app drops the row on ``.trim()`` — which is the worst of both:
        stored, shown as configured in Verwaltung, and absent from every Rapport."""
        if not v.strip():
            raise ValueError("must not be blank")
        return v.strip()

    @field_validator("url")
    @classmethod
    def _http_only(cls, v: str) -> str:
        """Reject anything the app would refuse to open anyway — with an explanation, rather
        than storing a row that silently never appears on a Rapport."""
        if not re.match(r"^https?://", v, re.IGNORECASE):
            raise ValueError("url must start with http:// or https://")
        return v


class HoursRoundingConfig(BaseModel):
    """The Sold convention this station counts Einsatzstunden by — see ``ReportConfig``."""

    model_config = ConfigDict(extra="ignore")
    #: block size in minutes (30 = half hours, 60 = whole hours)
    stepMin: int = Field(default=30, ge=1, le=480)
    #: minutes past a block that still count as that block, not the next one
    graceMin: int = Field(default=5, ge=0, le=479)


class RankConfig(BaseModel):
    """One Dienstgrad in the station's ordered rank list. Position in ``roster.ranks`` is
    the seniority order (most senior first). ``tier`` drives the "nur Offiziere" picker
    filter and the Anwesenheit grouping; ``abbr`` is the short badge shown in lists."""

    model_config = ConfigDict(extra="ignore")
    key: str
    label: str
    abbr: str | None = None
    tier: Literal["officer", "nco", "crew"] = "crew"


class RosterConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")
    # "snapshot" = a roster file somebody else publishes, to the contract in
    # docs/CONFIGURATION.md §4c (schema: docs/roster-snapshot.schema.json). Like the other two
    # values this is a LABEL, not a switch: what actually reads a snapshot is the
    # `roster_snapshot_source` credential (app/roster_snapshot_sync.py) — set it and the file
    # is polled, leave it empty and nothing is fetched, whatever this says. CSV and hand entry
    # keep working on every value.
    source: Literal["manual", "divera", "snapshot"] | None = None
    # Ordered rank list (most senior first). Empty → the frontend falls back to its in-code
    # Swiss default (see src/lib/rank.ts). Ranks reference these keys.
    ranks: list[RankConfig] = Field(default_factory=list)
    # How a crew member's name reads, station-wide: "Müller Hans" (default — what Divera
    # delivers and how a Feuerwehr calls people) or "Hans Müller". One order for the whole
    # deployment, applied when a name is SERVED, not when it is stored: a station can flip
    # this and every list, Trupp card and Rapport changes with the next request.
    nameOrder: Literal["last-first", "first-last"] = "last-first"
    # How much the nightly Mannschaft sync is allowed to do on its own (Divera only; every
    # other source ignores it). Until this existed the sync was manual-only, so a station's
    # roster was as current as the last time somebody remembered to press the button:
    #   "safe" (default) — joins, renames and Dienstgrad changes are applied; a member who
    #     LEFT is counted and reported («N Abgänge warten») but never deactivated, because
    #     a disappearance is as often a broken feed as a resignation.
    #   "full"           — also deactivates the stale ones. Never a deletion: `is_active`
    #     goes false, and every past Einsatz keeps its names.
    #   "off"            — nothing unattended; «Mannschaft synchronisieren» still works.
    autoSync: Literal["off", "safe", "full"] = "safe"
    # What each Divera Rückmelde-Status MEANS for the Anwesenheit's «Anrückend» block (Divera
    # only; see docs/divera-connector.md «Rückmeldungen»). Keyed by the status id («13») or its
    # name («Komme nicht», case- and accent-insensitive; an id beats a name). Unset statuses are
    # read off their name — «nicht»/«abwesend» → not_coming, «komme»/«N min» → coming, else other,
    # which is not shown — so most stations never set this. Only for an Einheit whose words the
    # default misreads. Applies to answers the poll stores from then on.
    diveraResponses: dict[str, Literal["coming", "not_coming", "other"]] = Field(default_factory=dict)
    # How often the roster snapshot is polled (minutes), when a source is configured. A roster
    # changes a few times a month; «Jetzt abrufen» on System › Verbindungen covers the urgent one.
    snapshotIntervalMin: int = Field(default=60, ge=5, le=1440)
    # A complete snapshot that would deactivate MORE than this share of the active people in one
    # run is held for a human (nothing written, a warning on System › Verbindungen). 0 = never
    # deactivate unattended, 100 = no cap. See app/roster_snapshot_ingest.py.
    snapshotMaxDeactivatePct: int = Field(default=20, ge=0, le=100)


class MittelStockEntry(BaseModel):
    """How many of a material are normally carried at one source (the standard load-out)."""

    model_config = ConfigDict(extra="ignore")
    source: str  # matches a MittelSource.id
    qty: int


class MittelItem(BaseModel):
    """One station-catalogue material: id + label + default unit (Stk/l/Sack/m/Flasche …),
    an optional grouping `category`, and an optional per-source `stock` (nominal load-out +
    where it lives → drives the used/available readout and the Bestand overview)."""

    model_config = ConfigDict(extra="ignore")
    id: str
    label: str
    unit: str | None = None
    category: str | None = None
    stock: list[MittelStockEntry] = Field(default_factory=list)
    # tactical-symbol pack name → placing that symbol offers logging this material
    symbol: str | None = None
    # …and WHICH variant of that symbol, keyed on the symbol's own fields: {"Typ": "Exhauster"}.
    # One symbol is routinely several materials (Lüfter / Grosslüfter / Exhauster share one pack
    # name and are told apart by the Typ a station already configures in fleet.attributeLists).
    # A LIST of clauses is an OR — "Typ = Exhauster ODER Luftrichtung = saugen", because a Lüfter
    # switched to saugen is an Exhauster whether or not anybody also set its Typ. The pseudo-field
    # "Luftrichtung" reads the airflow flag.
    # ⚠️ `extra="ignore"` above means an unknown key is dropped SILENTLY on load, so this field
    # has to exist here or the whole mapping vanishes between the file and the app — the same way
    # the demo's doctrine block did.
    when: dict[str, str] | list[dict[str, str]] | None = None
    # Counted off the Atemschutz-Tafel instead of a symbol: "person" = one per crew member of
    # every live AS-Trupp (Atemschutzgerät), "trupp" = one per live AS-Trupp.
    perAtemschutz: Literal["person", "trupp"] | None = None
    # An Ausrüstung id (doctrine.equipment / Trupp.equipment · retthaube/wbk/multiwarn …): one per
    # live Trupp of any kind that carries it in. Both file/CLI only, like `when` — and declared
    # here for the same reason: `extra="ignore"` would drop them on the next save.
    equipment: str | None = None
    # consumable (Nachschub list) vs. equipment (Retablierung status zurück/vor Ort/defekt)
    verbrauchbar: bool = False


class MittelSource(BaseModel):
    """One source a material can be drawn from (vehicle / depot / …)."""

    model_config = ConfigDict(extra="ignore")
    id: str
    label: str


class MittelConfig(BaseModel):
    """Station-wide material-use config: the Mittel catalogue, the optional source list, and
    common unit suggestions for custom («Anderes Mittel») entries. All optional → the app falls
    back to its national defaults (empty catalogue, free-typed materials)."""

    model_config = ConfigDict(extra="ignore")
    catalogue: list[MittelItem] = Field(default_factory=list)
    sources: list[MittelSource] = Field(default_factory=list)
    units: list[str] = Field(default_factory=list)


class ModuleConfig(BaseModel):
    """One Objektplan module — drives BOTH the app's plan tile and the import parsing, so a
    station configures its module set / labels / parsing in one place.

    Display: ``code`` is the short tile label ('M1', '2/3', 'Wasser'), plus title/subtitle/
    orientation/order/icon. Parsing: ``match`` is a regex tested (case-insensitive) against a
    source PDF's filename stem — the first module whose ``match`` hits claims the file.
    ``combinedWith`` marks a combined sheet that also fills other slots (modul2-3 → modul2 +
    modul3). ``family`` marks a generative module whose ``match`` has a capture group for a
    sub-slot — "Modul 5 - Wasser" → ``modul5-wasser`` labelled "Wasser".

    ``alignment`` says how this module's sheets get onto the Karte: ``auto`` — the server
    proposes a fit for the admin to approve on Objektpläne (the field sets points by hand until
    then); ``manual`` — reference points by hand only (admin wall or field); ``none`` — the sheet is
    never laid on the map. Unset = ``auto`` for modul1/modul2/modul2-3, ``none`` otherwise
    (``module_alignment`` in plan_alignment_compute is the one resolver).
    """

    model_config = ConfigDict(extra="ignore")
    id: str
    code: str | None = None
    title: str | None = None
    subtitle: str | None = None
    orientation: Literal["portrait", "landscape"] = "landscape"
    order: int = 0
    icon: str | None = None
    match: str | None = None  # filename regex for the importer; None = display-only / data-driven
    combinedWith: list[str] | None = None
    family: bool = False
    viewer: bool = False  # render as a plain PDF viewer (no drawing); on a family applies to all sub-slots
    alignment: Literal["auto", "manual", "none"] | None = None
    #: hide this module's tile in an Einsatz whose object HAS a floor pack (the Gebäude stack
    #: then shows its pages): a station-wide presentation rule, decided 14.09.2026. Default off –
    #: the original sheet keeps sections, legend and title block the stack does not show.
    hideWhenGebaeude: bool = False


#: The four kinds of station data the SharePoint connector can pull. One entry per area at
#: most — see :class:`SharePointConfig`.
SharePointArea = Literal["plans", "geodata", "checklists", "workbook"]

#: Length caps enforced HERE rather than by the database. Nothing about these strings reaches
#: a `String(n)` column, and SQLite (the test database) would not enforce one anyway — but a
#: site URL or path of unbounded length is a request this deployment would build and send, so
#: it is refused where it is typed.
_SHAREPOINT_URL_MAX = 400
_SHAREPOINT_PATH_MAX = 400
_SHAREPOINT_DRIVE_ID_MAX = 200
_SHAREPOINT_IGNORE_MAX = 50
_SHAREPOINT_IGNORE_NAME_MAX = 120


class SharePointSource(BaseModel):
    """One area's folder in SharePoint — where to look, for what kind of data.

    Every field but ``area`` is about ADDRESSING, and the addressing is per source on purpose:
    a station that keeps its Objektpläne on the Kommando site and its Geodaten in a different
    library configures two entries with two ``siteUrl``s. Nothing here requires a common root,
    and an area a station does not have is simply not listed.

    Point at the site with ``siteUrl`` (the address out of a browser's URL bar,
    ``https://contoso.sharepoint.com/sites/feuerwehr``) and this deployment resolves it to the
    document library itself; give ``driveId`` instead when a tenant admin has handed over the
    library id directly. ``library`` picks a non-default document library by its display name.
    ``path`` is the folder INSIDE that library — the per-area naming convention from
    docs/sharepoint-connector.md applies below it, never above it.

    ``ignore`` names the sub-folders the pull walks past — the category folders every grown
    document library has («Grosspläne», «Archiv»), which are not Einsatzobjekte and must never
    become one.
    """

    model_config = ConfigDict(extra="ignore")
    area: SharePointArea
    siteUrl: str | None = None
    driveId: str | None = None
    #: Display name of the document library, when it is not the site's default one.
    library: str | None = None
    #: Folder inside the library; empty = its root. Stored without leading/trailing slashes.
    path: str = ""
    #: Folder NAMES directly under ``path`` that the pull skips outright, compared without
    #: regard to case or Unicode spelling. Plain names, deliberately NOT globs: an operator
    #: copies what SharePoint shows them, while a pattern that quietly matches one folder more
    #: than it was meant to is the accident this list exists to prevent.
    ignore: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _addressable(self) -> "SharePointSource":
        site = (self.siteUrl or "").strip()
        drive = (self.driveId or "").strip()
        if bool(site) == bool(drive):
            raise ValueError(f"sharepoint source {self.area!r}: give exactly one of 'siteUrl' or 'driveId'")
        if site:
            if not site.startswith("https://"):
                raise ValueError(f"sharepoint source {self.area!r}: 'siteUrl' must start with https://")
            if len(site) > _SHAREPOINT_URL_MAX:
                raise ValueError(f"sharepoint source {self.area!r}: 'siteUrl' is longer than {_SHAREPOINT_URL_MAX}")
        if drive and len(drive) > _SHAREPOINT_DRIVE_ID_MAX:
            raise ValueError(f"sharepoint source {self.area!r}: 'driveId' is longer than {_SHAREPOINT_DRIVE_ID_MAX}")
        # A path is a folder inside the library, never a way out of it. `..` is refused rather
        # than resolved: this string is pasted into a Graph URL, and «resolve it politely» is
        # how a traversal becomes a feature.
        path = (self.path or "").replace("\\", "/").strip().strip("/")
        if len(path) > _SHAREPOINT_PATH_MAX:
            raise ValueError(f"sharepoint source {self.area!r}: 'path' is longer than {_SHAREPOINT_PATH_MAX}")
        if any(part in ("..", ".") for part in path.split("/") if part) or path.startswith(("http://", "https://")):
            raise ValueError(f"sharepoint source {self.area!r}: 'path' must be a plain folder path inside the library")
        self.path = path
        self.siteUrl = site or None
        self.driveId = drive or None
        self.library = (self.library or "").strip() or None
        # Stored as the operator typed them (minus surrounding whitespace), so the list they
        # read back is the list they see in SharePoint. The tolerant comparison — case, NFC —
        # happens where the comparison happens, in sharepoint_sync.
        ignore = [name.strip() for name in self.ignore if name and name.strip()]
        if len(ignore) > _SHAREPOINT_IGNORE_MAX:
            raise ValueError(
                f"sharepoint source {self.area!r}: 'ignore' lists more than {_SHAREPOINT_IGNORE_MAX} names"
            )
        for name in ignore:
            if len(name) > _SHAREPOINT_IGNORE_NAME_MAX:
                raise ValueError(
                    f"sharepoint source {self.area!r}: ignored name {name!r} is longer than "
                    f"{_SHAREPOINT_IGNORE_NAME_MAX} characters"
                )
            if "/" in name or "\\" in name:
                raise ValueError(
                    f"sharepoint source {self.area!r}: 'ignore' takes folder NAMES, not paths — "
                    f"{name!r} contains a slash. Name the folder as it appears directly under 'path'."
                )
        self.ignore = ignore
        return self


class SharePointConfig(BaseModel):
    """Where this deployment pulls station data from, and how often. Read-only, pull-only.

    ⚠️ NO CREDENTIAL LIVES HERE. ``GET /api/config`` is public and the Sicherung round-trip
    replaces this document wholesale; the tenant/client id and the client secret are in the
    encrypted credential store (app/credentials · the ``sharepoint`` group). What stays in the
    document is the part an operator wants to read back, diff and version: which folders.
    """

    model_config = ConfigDict(extra="ignore")
    #: Poll cadence. Clamped by the worker to at least one minute; a station that wants the
    #: pull off empties `sources` (or clears the credentials) rather than setting a huge number.
    intervalMinutes: int = Field(default=60, ge=1, le=10080)
    sources: list[SharePointSource] = Field(default_factory=list)

    @model_validator(mode="after")
    def _one_source_per_area(self) -> "SharePointConfig":
        seen: set[str] = set()
        for s in self.sources:
            if s.area in seen:
                raise ValueError(
                    f"sharepoint: area {s.area!r} is configured twice. One folder per area — the "
                    "refuse-to-empty guard reads a listing as the complete statement of what that "
                    "area holds, and two half-statements cannot be told from one broken one."
                )
            seen.add(s.area)
        return self


#: The roles that may be named in ``objectVisits.captureRoles``.
ObjectVisitRole = Literal["editor", "el", "viewer"]
_DEFAULT_CAPTURE_ROLES: tuple[ObjectVisitRole, ...] = ("editor", "el")

_OV_DEST_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
_OV_FIELD_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")


class ObjectVisitProposalField(BaseModel):
    """One entry of the Korrekturvorschlag field list. The id is opaque to KP Front — the
    organizer maps it to its own master data (docs/object-visits.md)."""

    model_config = ConfigDict(extra="ignore")
    id: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=120)

    @field_validator("id")
    @classmethod
    def _plain_id(cls, v: str) -> str:
        if not _OV_FIELD_ID_RE.match(v):
            raise ValueError("objectVisits.proposalFields: 'id' must be letters, digits, '.', '_' or '-'")
        return v


class ObjectVisitDestination(BaseModel):
    """Where the server files a copy of every visit (docs/object-visits.md «Delivery»).

    ⚠️ NO CREDENTIAL HERE — this document is served by the public ``GET /api/config``. The
    writer's app registration lives in the encrypted credential group ``sharepoint_export``.
    """

    model_config = ConfigDict(extra="ignore")
    id: str = Field(min_length=1, max_length=64)
    kind: Literal["sharepoint"] = "sharepoint"
    enabled: bool = True
    timing: Literal["every-sync", "completed"] = "every-sync"
    siteUrl: str = Field(min_length=1, max_length=_SHAREPOINT_URL_MAX)
    #: Display name of the document library, when it is not the site's default one.
    library: str | None = Field(default=None, max_length=200)
    #: Folder inside the library that holds the object folders; empty = the library root.
    root: str = Field(default="", max_length=_SHAREPOINT_PATH_MAX)
    objectFolder: str = Field(default="{object.folder}", min_length=1, max_length=200)
    visitFolder: str = Field(default="Objektbesuche/{date} {checklist} ({short})", min_length=1, max_length=200)
    #: Where a visit at a PLACE (no catalogue object) is filed, below ``root`` and instead of
    #: objectFolder/visitFolder: one general folder, no year subdivision (16.10.2026).
    locationFolder: str = Field(
        default="Allgemeine Meldungen/{date} {checklist} ({short})", min_length=1, max_length=200
    )

    @model_validator(mode="after")
    def _addressable(self) -> "ObjectVisitDestination":
        if not _OV_DEST_ID_RE.match(self.id):
            raise ValueError(
                f"objectVisits destination {self.id!r}: 'id' must be lower-case letters, digits, '-' or '_'"
            )
        site = self.siteUrl.strip()
        if not site.startswith("https://"):
            raise ValueError(f"objectVisits destination {self.id!r}: 'siteUrl' must start with https://")
        self.siteUrl = site
        root = (self.root or "").replace("\\", "/").strip().strip("/")
        if any(part in ("..", ".") for part in root.split("/") if part):
            raise ValueError(f"objectVisits destination {self.id!r}: 'root' must be a plain folder path")
        self.root = root
        self.library = (self.library or "").strip() or None
        for name in ("objectFolder", "visitFolder", "locationFolder"):
            value = getattr(self, name).replace("\\", "/").strip().strip("/")
            if not value or any(part.strip() in ("..", ".") for part in value.split("/")):
                raise ValueError(f"objectVisits destination {self.id!r}: '{name}' must be a plain folder pattern")
            setattr(self, name, value)
        return self


class ObjectVisitsConfig(BaseModel):
    """The optional Objektbesuche module (docs/object-visits.md). Off unless switched on."""

    model_config = ConfigDict(extra="ignore")
    enabled: bool = False
    captureRoles: list[ObjectVisitRole] = Field(default_factory=lambda: list(_DEFAULT_CAPTURE_ROLES))
    #: Hours after the COMPLETION during which a completed visit may still be corrected; after
    #: that it is view-only (owner, 20.10.2026 — a plan stayed open for over a week). ``0`` locks
    #: it the moment it is completed, ``null`` never locks it. The server enforces it
    #: (``object_visits.locked_at``); the app only draws what the server says.
    lockAfterHours: int | None = Field(default=24, ge=0, le=8760)
    proposalFields: list[ObjectVisitProposalField] = Field(default_factory=list, max_length=50)
    destinations: list[ObjectVisitDestination] = Field(default_factory=list, max_length=5)

    @model_validator(mode="after")
    def _unique_ids(self) -> "ObjectVisitsConfig":
        for what, ids in (
            ("destination", [d.id for d in self.destinations]),
            ("proposal field", [f.id for f in self.proposalFields]),
        ):
            dupes = sorted({i for i in ids if ids.count(i) > 1})
            if dupes:
                raise ValueError(f"objectVisits: {what} id(s) {dupes} used twice")
        self.captureRoles = list(dict.fromkeys(self.captureRoles))
        return self


class AccessConfig(BaseModel):
    """How much of the record each account reads (docs/roles-and-access.md)."""

    model_config = ConfigDict(extra="ignore")
    #: Days after its LAST close during which a `viewer` account (the «Fahrer» tile) still reads
    #: an Einsatz; older ones do not exist for it. ``0`` = only the running ones. Server-enforced
    #: (auth/viewer_scope); `editor` and `el` always read everything.
    viewerHistoryDays: int = Field(default=7, ge=0, le=3650)


class SetupConfig(BaseModel):
    """Which rows of the «Einrichtung» card this station ticked off by hand.

    The card derives every row from the document itself, but some rows can never become true
    that way — a station happy with the built-in vehicles never writes ``fleet.vehicles``, so
    that row would nag forever. A hand tick is the escape hatch, and it belongs in the document
    rather than on the device: «erledigt» is a statement about the Wehr, and the next admin on
    the next tablet has to see it.
    """

    model_config = ConfigDict(extra="ignore")
    #: Row keys (``fleet``, ``users``, …). Unknown keys are kept, not rejected: the card's row
    #: set changes with the product, and a tick for a row this version no longer shows must
    #: survive a downgrade rather than be silently dropped.
    acknowledged: list[str] = Field(default_factory=list)


class DeploymentConfigIn(BaseModel):
    """The full config document an admin PUTs. All sections optional → `{}` is valid.

    The input `integrations` block (ON/OFF intent) is accepted but IGNORED for the GET
    projection: integration availability is derived from env-configured secrets, not the
    document (see ConfigIntegrations / config_projection in the router).
    """

    model_config = ConfigDict(extra="ignore")
    identity: IdentityConfig = Field(default_factory=IdentityConfig)
    map: MapConfig = Field(default_factory=MapConfig)
    referenceLayers: list[ReferenceLayerConfig] = Field(default_factory=list)
    modules: list[ModuleConfig] = Field(default_factory=list)
    fleet: FleetConfig = Field(default_factory=FleetConfig)
    doctrine: DoctrineConfig = Field(default_factory=DoctrineConfig)
    roster: RosterConfig = Field(default_factory=RosterConfig)
    mittel: MittelConfig = Field(default_factory=MittelConfig)
    journal: JournalConfig = Field(default_factory=lambda: JournalConfig())
    alarms: AlarmsConfig = Field(default_factory=AlarmsConfig)
    # Unset (the normal case) = the vocabulary shipped in app/data/alarm_keywords.json. Set =
    # that file replaced wholesale for this deployment; there is no merging (§1 of
    # docs/CONFIGURATION.md says why, and says to copy the shipped file to add one keyword).
    alarmKeywords: AlarmKeywordsConfig | None = None
    report: ReportConfig = Field(default_factory=ReportConfig)
    # ⚠️ Declared HERE or it does not survive a save: every model in this document is
    # `extra="ignore"`, so an undeclared section is dropped on the next round-trip and the
    # station's folders vanish the first time anybody presses save in /admin.
    sharepoint: SharePointConfig = Field(default_factory=SharePointConfig)
    # Same reason as sharepoint above: declared here or the hand ticks on the «Einrichtung»
    # card are dropped on the next save (see SetupConfig).
    setup: SetupConfig = Field(default_factory=SetupConfig)
    # The optional Objektbesuche module — declared here for the same reason as the two above.
    objectVisits: ObjectVisitsConfig = Field(default_factory=ObjectVisitsConfig)
    # The viewer's window onto past Einsätze — declared here for the same reason as the above.
    access: AccessConfig = Field(default_factory=AccessConfig)
    # Accepted on input but not authoritative (kept loose; not echoed from the document).
    # Future asset-upload slice: validate that identity.assets.* reference existing entries in
    # asset storage. Skipped while assets are still provisioned outside this document.

    @model_validator(mode="after")
    def _zero_alarmdruck_is_demo_only(self, info: ValidationInfo) -> "DeploymentConfigIn":
        if self.doctrine.alarmBar == 0 and self.identity.demoMode is not True:
            if (info.context or {}).get("stored"):
                logger.warning("doctrine.alarmBar is 0 outside demo mode — serving the station defaults")
                self.doctrine.alarmBar = None
                self.doctrine.alarmBarRueckzug = None
                return self
            raise ValueError("doctrine.alarmBar may be 0 only when identity.demoMode is true")
        return self


class ProviderCapability(BaseModel):
    provider: str | None = None
    configured: bool = False
    capabilities: list[str] = Field(default_factory=list)


class ProviderRegistration(BaseModel):
    """One provider this build knows about, whether or not this station uses it.

    The list is what makes personnel/alarms/vehicles a *choice* rather than a vendor: a
    station reads it to see what it could point at. ``implemented`` is false for a provider
    whose contract is published but whose ingestion is not built yet — an entry that is
    discoverable and honest about being inert, rather than a registry that quietly implies
    everything listed works.
    """

    provider: str
    domain: Literal["personnel", "alarms", "vehicles"]
    configured: bool
    active: bool
    capabilities: list[str] = Field(default_factory=list)
    implemented: bool = True


class ConfigIntegrations(BaseModel):
    """Env-derived integration availability (the GET projection's `integrations`).

    These are FACTS about the deployment's secrets, NOT the document's on/off intent —
    hence the `*Configured` naming. The frontend should read these to decide whether to
    surface Divera/Traccar features. (docs/CONFIGURATION.md §1 names the document's intent
    fields `diveraEnabled`/`traccarEnabled`; the GET output deliberately uses
    `diveraConfigured`/`traccarConfigured` to signal env-derived truth.)
    """

    diveraConfigured: bool = False
    traccarConfigured: bool = False
    # STT engine reachable (env stt_base_url set) — gates the player's Transkribieren button
    sttConfigured: bool = False
    # CARTO Basemaps client key. Public by design: MapLibre sends it as `?key=` on tile URLs.
    cartoBasemapKey: str | None = None
    # «Mit Microsoft anmelden» is set up (auth/microsoft · enabled) — gates the login screen's
    # button, so a station without it never sees the door.
    microsoftLoginConfigured: bool = False
    personnel: ProviderCapability = Field(default_factory=ProviderCapability)
    alarms: ProviderCapability = Field(default_factory=ProviderCapability)
    vehicles: ProviderCapability = Field(default_factory=ProviderCapability)
    providers: list[ProviderRegistration] = Field(default_factory=list)


class ConfigHistoryEntry(BaseModel):
    """One kept previous configuration, for the «Letzte Änderungen» list in Verwaltung.

    Deliberately NOT the document itself: the list is read to answer «what happened to our
    config», and shipping a full config per row would make that a scroll through hundreds of
    lines of JSON. What identifies the damage is `emptied` — sections that had content before
    this write and none after — which is the shape every one of these incidents has taken.
    """

    model_config = ConfigDict(extra="ignore")
    id: int
    replacedAt: datetime
    #: which path did the replacing — `api` (Verwaltung/HTTP), `cli`, `branding`, `geodata`,
    #: `roster` (a rank adopted during a CSV import)
    source: str | None = None
    #: the admin behind it, resolved to a display name. NULL for a CLI push — and «api, nobody»
    #: is itself the signature of an unattended writer, which is worth being able to see.
    replacedBy: str | None = None
    #: what the write that replaced this document actually CHANGED, diffed against its successor
    #: one level deep (config_history · changed_sections) — the same depth rule as `emptied`.
    #: ⚠️ NOT «sections present in the kept document», which is what it used to carry: every
    #: writer replaces the WHOLE document, so that printed the identical nine names on every row
    #: and «Letzte Änderungen» became 26 entries nobody could tell apart — on the list a station
    #: is sent to (docs/SETUP.md §3) when a config write has gone wrong.
    sections: list[str] = Field(default_factory=list)
    #: what the write that replaced it left EMPTY (config_history · emptied_sections)
    emptied: list[str] = Field(default_factory=list)


class DeploymentConfigOut(DeploymentConfigIn):
    """GET/PUT response projection: the validated document PLUS env-derived integration
    flags. NEVER includes updated_by or server secrets. `cartoBasemapKey` is the one deliberate
    browser credential: CARTO requires it in every raster tile URL.
    """

    integrations: ConfigIntegrations = Field(default_factory=ConfigIntegrations)
    # Derived from the document, not stored: a one-glance answer to "shipped or ours?" that
    # does not require reading (or understanding) the whole `alarmKeywords` block above.
    alarmVocabulary: AlarmVocabularyStatus = Field(default_factory=AlarmVocabularyStatus)
    # The Einsatz Kategorien, category key → the German label stored on `incidents.type`, in the
    # wizard's picker order. Derived (app/divera · CATEGORY_LABELS), never stored – the one copy.
    categoryLabels: dict[str, str] = Field(default_factory=dict)
    # Opaque version token of the stored document — hand it back on the next PUT and a write
    # against a document somebody else has since changed is refused (409) instead of silently
    # winning. See app/api/config · put_config. NOT part of the document; `DeploymentConfigIn`
    # ignores extras, so echoing this response straight back as a body is harmless.
    version: str | None = None
    # Advisory notes about the document that was just written: keys the schema DROPPED
    # («identitiy — did you mean identity?») and reference layers whose source cannot resolve.
    # A warning is not a refusal — the write happened — but until now the only feedback a
    # misspelled section got over the API was a 200. Empty on GET, which never submits anything.
    warnings: list[str] = Field(default_factory=list)


class ConfigValidationResult(BaseModel):
    """What ``POST /api/config/validate`` answers: everything a PUT would say, without writing.

    The dry-run an agent needs and only a workstation had (``admin_config validate`` / ``diff``).
    ``valid`` is about the SCHEMA; the other fields are about the consequences — the sections a
    write would empty (which `?force=true` is the answer to), the sections it would change, and
    the ``version`` to send back as ``If-Match`` so the follow-up PUT is not a blind one.
    """

    valid: bool
    #: `field.path: message [type]` lines — empty when `valid`.
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    #: Populated sections this document would leave empty — a PUT refuses these with 409.
    emptiedSections: list[str] = Field(default_factory=list)
    #: Sections that would differ from the stored document. Empty = this write is a no-op.
    changedSections: list[str] = Field(default_factory=list)
    version: str | None = None


def load_stored_config(raw: Any) -> DeploymentConfigIn:
    """Validate a config document that is ALREADY IN THE DATABASE.

    Same model as the PUT body, one difference: a stored value that today's rules would REFUSE
    must not take the whole document down with it. A field that has grown a rule since the row
    was written (`identity.accentColor`, or a station-level zero Alarmdruck) is dropped to its
    unset default and logged, instead of
    raising — because every reader of the stored row falls back to an EMPTY config when
    validation fails, and losing a station's fleet, roster and doctrine is not a proportionate
    answer to one bad colour.

    ⚠️ Use this for every read of the singleton row. A fresh WRITE (`PUT /api/config`, an
    `admin_config load`) validates strictly through `DeploymentConfigIn` itself — that is where
    a value is still being chosen, and where refusing it costs nothing but a corrected keystroke.
    """
    return DeploymentConfigIn.model_validate(raw, context={"stored": True})
