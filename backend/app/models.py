"""SQLAlchemy ORM models for the whole kp-front backend.

All tables for Phases 1–7 plus the audit-trail capture substrate (sub-phase A) are
defined here so migrations stay coherent as features land. Roles are exactly three:
``editor`` (edit), ``viewer`` (read-only) and ``el`` (Einsatzleiter: reads everything,
writes only the operational record – docs/roles-and-access.md).
"""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    LargeBinary,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


#: ``Incident.status`` values that mean the Einsatz is RUNNING. See `Incident.is_open`.
#:
#: Two, not one. "offen" is the column default every intake writes; "in_arbeit" is what an
#: editor sets once somebody is working it (PATCH /incidents/{id}, and the app labels it «In
#: Arbeit» in the Einsatz list). Both are live. Treating only "offen" as running quietly
#: revoked the Einsatz-Link — and hid Standort teilen — the moment an Einsatz was marked as
#: being worked on, which is the one moment it is most obviously not over.
INCIDENT_ACTIVE_STATUSES = ("offen", "in_arbeit")

#: The column default, for the intake paths that stamp it.
INCIDENT_OPEN_STATUS = "offen"

#: `Incident.source` of a «Lernen · <Modul>» Übung, minted only by `POST /incidents/lernen`
#: (api/incidents · open_lern_uebung, «Üben» 05.11.2026). Reserved for alarm intake
#: (schemas · RESERVED_ALARM_SOURCES). ⚠️ Such an Übung is never «an Einsatz running» for the
#: station: the split-dispatch guards skip it (divera · maybe_auto_open, alarms · open_pooled_alarm),
#: or a learner practising at home would hold the next real alarm in the pool; the standing links
#: never bind to it (api/incident_link · _open_incident_rows); the GPS sweeps never write into it
#: (vehicle_presence · _open_incidents, scheduler · _vehicle_samples_sweep). Only an el's delete
#: is narrowed to it (api/incidents · delete_incident).
LERN_UEBUNG_SOURCE = "training"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = _uuid_pk()
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    pin_hash: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="viewer")
    display_name: Mapped[str] = mapped_column(Text, nullable=False, default="")
    color: Mapped[str | None] = mapped_column(String(16), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # this login works in the Führungsansicht (tactical editing locked, journal + detail
    # viewing stay live) on every device — the only switch for it since 05.10.2026, when the
    # per-device toggle left the Einstellungen. A frontend mode, not a role: the user remains a
    # full editor at the API.
    el_view_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # this login's devices get the «Neuer Objektbesuch» push when a visit is completed
    # (docs/object-visits.md · «Notification»). Chosen per account in /admin › Objektbesuche;
    # nobody by default — not every account, not every device that installed the app.
    notify_object_visits: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Bumped whenever this account's sessions must all end at once — a PIN reset, a
    # deactivation (auth/router). Every access and refresh token carries the generation it was
    # minted under and is refused once the row moves past it, so rotating the credential
    # actually removes whoever was already inside. Tokens minted before this column existed
    # carry no generation and are read as 0, which is where every row starts.
    auth_generation: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0", default=0)

    __table_args__ = (CheckConstraint("role in ('editor','viewer','el')", name="ck_users_role"),)


class RevokedToken(Base):
    """Persisted JWT blocklist: a logged-out / rotated token's ``jti`` stays revoked
    across restarts and instances until its own ``expires_at`` passes (then it's pruned).

    Generic column types only (no JSONB/postgres UUID) so the auth hot path's table is
    portable — it also stands up on SQLite for the test suite.
    """

    __tablename__ = "revoked_tokens"

    jti: Mapped[str] = mapped_column(String(64), primary_key=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    revoked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# Provenance of ``Incident.started_at``. Part VIII of the estate architecture asks for
# marking at FIELD level rather than row level: the incident is real either way, but the
# alarm-time column is only externally sourced on some of them.
#   "alarm"  — the alerting system stamped it (Divera ``ts_create``, generic intake payload)
#   "manual" — a human typed or confirmed it (Einsatz-Wizard, Einsatzdaten correction)
#   NULL     — nobody supplied one; ``started_at`` is the row's insert time (record opened)
ALARM_TIME_SOURCES = ("alarm", "manual")


class Incident(Base):
    __tablename__ = "incidents"

    id: Mapped[uuid.UUID] = _uuid_pk()
    divera_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    type: Mapped[str | None] = mapped_column(Text, nullable=True)
    priority: Mapped[str | None] = mapped_column(String(8), nullable=True)  # 'HIGH' | 'LOW'
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    lat: Mapped[float | None] = mapped_column(Numeric(10, 7), nullable=True)
    lng: Mapped[float | None] = mapped_column(Numeric(10, 7), nullable=True)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="offen")
    source: Mapped[str] = mapped_column(String(16), nullable=False)  # 'divera' | 'manual' | 'migrated' | intake slug
    # Foreign alarm id for generic (non-Divera) intake sources; dedupe key per source.
    source_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Created by an alarm without a human (auto-open / generic intake) — only such incidents
    # are eligible for the untouched-auto-archive sweep.
    # NB: plain-string server_default — `text` here is the Text column above, not sqlalchemy.text
    auto_opened: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
    # Alarmierungszeit — the moment the alarm went out, NOT the moment somebody opened the
    # record. Every surface (Rapport-PDF, Einsatzdaten-Panel, Statistik-Export) reads it as
    # the alarm time, so an intake path that leaves the server default standing is silently
    # publishing «when the tablet was picked up» under that name.
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Where started_at came from — see ALARM_TIME_SOURCES. NULL means nothing supplied an
    # alarm time and the server default stands, i.e. the value is the record-open time and
    # must NOT be read as an Alarmierungszeit. Honest null beats a plausible guess: a
    # downstream join keying on a fabricated alarm time is worse than one that skips the row.
    started_at_source: Mapped[str | None] = mapped_column(String(8), nullable=True)
    # Where the alarm came IN from, as the alerting system knew it — e.g. "alarmzentrale"
    # for a dispatch versus a member sending an SMS by hand. Both are legitimate alarms and
    # both look identical here otherwise, which is why the distinction is worth recording:
    # it is what lets a downstream consumer decide whether an Einsatz may reach a public
    # surface. A slug, never a phone number.
    #
    # WRITE-ONCE. Set on the first milestone that carries it and never overwritten, for the
    # same reason `editor_opened_at` is a latch: provenance is not an editable field, and a
    # late edit from an alerting system must not be able to rewrite where an alarm came from.
    #
    # NULL is an ordinary answer, not a missing one. An unlabelled allowlist entry, an alarm
    # the fallback relay handled during an outage (it cannot reach this app at all), and any
    # deployment whose alerting system does not send origins all produce NULL — and none of
    # them mean "not a real alarm". A consumer that treats NULL as suspicious is wrong.
    alarm_origin: Mapped[str | None] = mapped_column(String(32), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # When it was closed THIS time (D2, 25.09.2026): stamped on every close, where `closed_at`
    # keeps the first. The Einsatzende, the Einsatzdauer and the end of the Anwesenheit default
    # to this; `closed_at` only marks the Nachträge.
    last_closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Übung — orthogonal to the VKF `type` (an exercise still has a category). Exercises are
    # excluded from the stats export by default and are the ONLY incidents that may be hard-
    # deleted; real Einsätze stay append-only.
    is_exercise: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
    # Übung from its creation on and never marked real since (RBAC audit S1, 22.10.2026). THIS,
    # not `is_exercise`, is what lets an editor hard-delete without the Verwaltung: the flag is
    # an Einsatzdaten field (editor and el), so «flip to Übung, then delete» destroyed a real
    # Einsatzakte. Stamped by the create path, cleared for good the first time the incident is
    # marked real; never set again. A real Einsatz marked Übung later stays stats-excluded but
    # needs the admin session to delete (api/incidents · delete_incident).
    exercise_since_creation: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="false"
    )
    # When the Abschluss-Assistent last marked the Rapport complete. Purely a bookmark:
    # «geändert nach Abschluss» is DERIVED (updated_at advanced past it), never stored.
    report_done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Cross-visibility (QR capture ↔ KP tablet). editor_opened_at is a LATCH: stamped once on
    # the first authenticated-editor workspace read/write («the KP tablet has this incident»),
    # never advanced — no last-active tracking. capture_writes/capture_last_at count successful
    # capture-surface writes (workspace PUT / journal append) for the tablet's «QR: N Einträge».
    editor_opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    capture_writes: Mapped[int] = mapped_column(Integer, default=0, nullable=False, server_default="0")
    capture_last_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # The Rapport's view-only link (2026-09-01). A random secret that IS the link: the URL is
    # `/l/v<this>`, and clearing the column revokes it — including sessions already open.
    #
    # Deliberately per-incident and NOT the station's `incident_link_key`. That key belongs to
    # the alerting system, it is rotated as one, and every session it opens dies with the
    # Einsatz (`is_open`). This link exists for the opposite case: an Einsatz that is finished,
    # shown to a Gemeinde, a Nachbarwehr or a Versicherung, weeks later. One incident, revocable
    # on its own, outliving the incident's closure by design.
    #
    # Stored in the clear rather than hashed, and that is a requirement, not laziness: the
    # Rapport has to be able to SHOW the link again — anything else means «lost it, mint a new
    # one, tell everybody», which is how a station ends up with five live links per Einsatz.
    view_link_key: Mapped[str | None] = mapped_column(Text, nullable=True)

    # The Atemschutz link (2026-09-01) — the THIRD kind. Same shape as `view_link_key` (a random
    # secret that IS the link, URL `/l/a<this>`, cleared to revoke), opposite lifetime: it is
    # minted from a RUNNING Einsatz for somebody who is not on the FU, and it dies when the
    # Einsatz closes. What it opens is not the read-only viewer but the Atemschutzüberwachung of
    # this one Einsatz — a narrow write slice, enforced in auth/incident_link.
    atemschutz_link_key: Mapped[str | None] = mapped_column(Text, nullable=True)

    details_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    map_workspace_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    workspace_rev: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("ix_incidents_archived_started", "is_archived", "started_at"),
        # Both link keys are unique — the secret IS the credential. As unique INDEXES, the way
        # their migrations (68cbf635f90e, 40a7d00c2b37) built them; `unique=True` on the column
        # declared a unique CONSTRAINT instead, which only the tests' create_all ever had.
        Index("ix_incidents_view_link_key", "view_link_key", unique=True),
        Index("ix_incidents_atemschutz_link_key", "atemschutz_link_key", unique=True),
    )

    @property
    def is_open(self) -> bool:
        """Still running — the one definition of it.

        Several features hang off this: the Einsatz-Link is revoked, self-reported crew
        positions are dropped, a phone may no longer report into it. They were hand-written
        copies of the same condition, which is the kind of drift that ends with a link
        outliving its Einsatz.

        ``is_archived`` is the state; ``closed_at`` is deliberately NOT consulted. That column
        is a TIMESTAMP — the first Einsatzende — kept across a reopen precisely so later
        journal rows can be rendered as Nachträge (see api/incidents.patch_incident, and
        lib/reminders + lib/report on the client, which read it as a moment in time). Reading
        it as a liveness flag meant a REACTIVATED Einsatz — an operator explicitly saying «this
        is running again» — stayed dead: its links refused, Standort teilen silently absent.
        Verified against production 2026-08-05. Archiving it, or moving `status` off an active
        one, still ends it immediately.
        """
        return lifecycle_open(self.is_archived, self.status)


def lifecycle_open(is_archived: bool, status: str) -> bool:
    """`Incident.is_open` from the two columns alone — for a route that reads the lifecycle
    without loading the row (the workspace long-poll, the closed-Einsatz refusal in
    incident_service · `incident_lifecycle`). One condition, so the two can never drift."""
    return not is_archived and status in INCIDENT_ACTIVE_STATUSES


# Partial-unique: only one incident per Divera alarm, but many manual incidents have
# NULL divera_id. Defined outside the class so `text` is the SQL helper, not the column.
Index(
    "ix_incidents_divera_id_unique",
    Incident.divera_id,
    unique=True,
    postgresql_where=text("divera_id IS NOT NULL"),
)

# Same idea for generic intake sources: one incident per (source, source_ref) so a retried
# webhook can't duplicate an Einsatz; manual incidents have NULL source_ref.
Index(
    "ix_incidents_source_ref_unique",
    Incident.source,
    Incident.source_ref,
    unique=True,
    postgresql_where=text("source_ref IS NOT NULL"),
)


# Legacy sub-API: the /incidents/{id}/people and /notes routes (and their schemas) were
# removed 2026-08-24 — nothing called them any more. The two tables below are RETAINED
# pending an archive-vs-drop decision: incident data is a legal record.
class IncidentPerson(Base):
    __tablename__ = "incident_people"

    id: Mapped[uuid.UUID] = _uuid_pk()
    incident_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("incidents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str | None] = mapped_column(Text, nullable=True)
    name: Mapped[str | None] = mapped_column(Text, nullable=True)
    contact: Mapped[str | None] = mapped_column(Text, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class DiveraEmergency(Base):
    __tablename__ = "divera_emergencies"

    id: Mapped[uuid.UUID] = _uuid_pk()
    divera_id: Mapped[int] = mapped_column(Integer, unique=True, nullable=False, index=True)
    divera_number: Mapped[str | None] = mapped_column(Text, nullable=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    lat: Mapped[float | None] = mapped_column(Numeric(10, 7), nullable=True)
    lng: Mapped[float | None] = mapped_column(Numeric(10, 7), nullable=True)
    raw_payload_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Divera's own creation stamp for the alarm (unix seconds) — the ALARM time, as opposed
    # to ``received_at`` (when we heard about it) and ``ts_update`` (last edit upstream).
    # It is what an incident opened from this alarm inherits as its Alarmierungszeit.
    ts_create: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    ts_update: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    is_taken: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    taken_incident_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("incidents.id", ondelete="SET NULL"), nullable=True
    )
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    # The alarm's Rückmeldungen as the poll last saw them (app/divera_responses · with_catalogue):
    # who answered which status, who was addressed, how many read it. Personal data, so it lives
    # here behind a logged-in read and never in the workspace blob, the export or a link.
    responses_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    responses_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Personnel(Base):
    """Brigade crew member (Mannschaft), synced from Divera — the predefined people who
    get marked present and assigned into Atemschutz-Trupps. Distinct from ``User`` (the
    handful of operators who log into KP Front). ``divera_id`` is the stable key; the
    display name is a snapshot that may change when Divera names are edited.
    """

    __tablename__ = "personnel"

    id: Mapped[uuid.UUID] = _uuid_pk()
    divera_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    first_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Rank key referencing the per-station roster.ranks config list (e.g. "hptm"); NULL = no
    # rank. Imported from Divera/CSV, never hard-coded — labels/order/tier live in config.
    rank: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


# Partial-unique: one row per Divera member, but manually-added crew carry NULL divera_id.
Index(
    "ix_personnel_divera_id_unique",
    Personnel.divera_id,
    unique=True,
    postgresql_where=text("divera_id IS NOT NULL"),
)


class PersonnelExternalIdentity(Base):
    """Opaque provider identity attached to a canonical local personnel record."""

    __tablename__ = "personnel_external_identities"
    __table_args__ = (
        UniqueConstraint("provider", "external_id", name="uq_personnel_external_provider_id"),
        UniqueConstraint("personnel_id", "provider", name="uq_personnel_external_person_provider"),
        Index("ix_personnel_external_personnel_id", "personnel_id"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    personnel_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("personnel.id", ondelete="CASCADE"), nullable=False)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    external_id: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Media(Base):
    __tablename__ = "media"

    id: Mapped[uuid.UUID] = _uuid_pk()
    incident_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("incidents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # 'photo' | 'audio' | 'file'
    storage_key: Mapped[str] = mapped_column(Text, nullable=False)
    content_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SttJob(Base):
    """Speech-to-text job for one audio recording.

    ``segments`` are DRAFTS — working data, not record: each carries a per-segment
    ``status`` ('open' | 'confirmed' | 'dismissed'); confirming appends an ordinary journal
    row client-side and stamps the created row id back onto the segment. One job per media
    (a re-run replaces the previous result)."""

    __tablename__ = "stt_jobs"

    id: Mapped[uuid.UUID] = _uuid_pk()
    media_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("media.id", ondelete="CASCADE"), nullable=False, unique=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="queued")  # queued|running|done|failed
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    segments: Mapped[list | None] = mapped_column(JSONB, nullable=True)  # [{start,end,text,status,rowId?}]
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PrintJob(Base):
    """Queued Einsatzrapport-PDF for the station print relay.

    The backend composes the PDF at enqueue time; the on-site agent polls, claims the
    oldest ``queued`` row, prints it, and reports back. Rows are transient — the paper is
    the artefact — and are swept after ``PRINT_JOB_RETENTION_DAYS`` (scheduler.py)."""

    __tablename__ = "print_jobs"

    id: Mapped[uuid.UUID] = _uuid_pk()
    incident_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("incidents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # 'report' | 'capture_report'
    filename: Mapped[str] = mapped_column(Text, nullable=False)
    pdf: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    # True only when the document renders the (coloured) Kroki — everything else prints
    # monochrome at the agent (toner/ink discipline; decided 2026-07-18)
    color: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="queued"
    )  # queued|printing|done|failed|cancelled
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    requested_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ObjectSite(Base):
    """Einsatzobjekt — a pre-planned site carrying its own module plans."""

    __tablename__ = "objects"

    id: Mapped[uuid.UUID] = _uuid_pk()
    name: Mapped[str] = mapped_column(Text, nullable=False)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    lat: Mapped[float | None] = mapped_column(Numeric(10, 7), nullable=True)
    lng: Mapped[float | None] = mapped_column(Numeric(10, 7), nullable=True)
    #: The station's own stable key for this object — whatever its pipeline calls the thing
    #: (a folder name, an Objekt-Nr, a row id). Optional and opaque: this app never parses it.
    #:
    #: It exists so an external producer can say "this plan belongs to that object" WITHOUT
    #: either side re-deriving the other's UUID. Before it, the scheduled plan pull compared
    #: the publisher's own object UUID against ours; the two id spaces overlap by zero, so it
    #: skipped every plan as unknown and fetched nothing — silently, because skipping is the
    #: safe branch. A station whose importer sets this gets a pull that matches; one that
    #: does not keeps uploading by hand, unaffected.
    source_key: Mapped[str | None] = mapped_column(Text, nullable=True, unique=True, index=True)
    source_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: The folder this object's documents are FILED under in the station's plan library
    #: («Hauptstrasse 24 - Gemeindeverwaltung»), verbatim. Read by the Objektbesuche delivery
    #: (`{object.folder}`, docs/object-visits.md) so a visit lands next to the plans. Set by the
    #: SharePoint pull and the manifest import (`folder`), backfilled from `source_note` where
    #: that names the folder; NULL = unknown, and `object_visits.object_folder` derives one.
    filing_folder: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: The object's «Sofortmassnahmen» as the station wrote them down — free text, one measure
    #: per line («Gashaupthahn im Keller schliessen»). OPTIONAL and MANUAL: the only copy most
    #: stations have is printed on the Modul-1 PDF, and parsing that is station-specific work
    #: done outside this repo, then loaded with `admin_objects` (manifest key `measures`) or
    #: typed in Verwaltung › Objektpläne. Shown on the Einsatz's Gebäude card (building_facts).
    measures: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: The sheet's other box, «Bemerkungen» («Hohe Brandlast im Keller», «PV-Anlage auf dem
    #: Dach»), same shape and same doors as `measures`. On the Oberwil sheets this is where most
    #: of the writing is (52 of 122 Modul-1 sheets, against 2 with Sofortmassnahmen, 09.10.2026).
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Where `measures` and `remarks` came from, in the station's words («Modul 1, Stand
    #: 03.2024») — the card prints it beside them, because a measure without a source reads as a fact.
    measures_source: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: The town when it is not the home town («Therwil» for «Erlenstrasse 60»), as the register
    #: or the station named it. NULL = the home town, or not known; the catalogue then serves
    #: the town at the pin (app/object_footprints · place_at). Shown after the address.
    locality: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: ``'station'`` once the station corrected the position in /admin («Lage korrigieren»,
    #: api/objects · set_position). ⚠️ Such a position is never overwritten — not by
    #: ``PUT /api/objects/{id}`` (admin_objects push), ``admin_objects load``, the SharePoint pull
    #: or an organizer: they all keep the station's lat/lng/locality. NULL = whatever imported it.
    position_source: Mapped[str | None] = mapped_column(String(16), nullable=True)
    position_set_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: How the map outlines the object: NULL = automatic (use area / parcel / building, see
    #: app/object_footprints), ``'building'`` = only the building at the pin, ``'none'`` = no
    #: outline at all (not even the viewer's OSM fallback). Set with the position correction.
    outline: Mapped[str | None] = mapped_column(String(16), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ObjectPositionEvent(Base):
    """Append-only history of the station's position/outline corrections of one object
    (``set`` / ``undo``), with what the object said before and after."""

    __tablename__ = "object_position_events"
    __table_args__ = (Index("ix_object_position_events_object_id", "object_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    object_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("objects.id", ondelete="CASCADE"), nullable=False)
    action: Mapped[str] = mapped_column(String(24), nullable=False)
    #: who: the account's display name, or «Verwaltung» for the admin-secret session
    actor: Mapped[str | None] = mapped_column(Text, nullable=True)
    before: Mapped[dict] = mapped_column(JSONB, nullable=False)
    after: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ObjectRef(Base):
    """An outside system's id for one Einsatzobjekt (``fwo-schlue:<uuid>``, ``firegis:<gid>``).

    Opaque to this app: it only ever looks a ref up, never parses one. Unique per
    ``(source, external_id)`` — one outside id names one object here; an object may carry many.
    """

    __tablename__ = "object_refs"
    __table_args__ = (UniqueConstraint("source", "external_id", name="uq_object_refs_source_external"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    object_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("objects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source: Mapped[str] = mapped_column(String(64), nullable=False)
    external_id: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class VisitProgramme(Base):
    """Reusable organizer routes; publication materializes dated VisitLists atomically."""

    __tablename__ = "visit_programmes"
    ref: Mapped[str] = mapped_column(Text, primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    routes: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    years: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)


class VisitList(Base):
    """A read-only work list an organizer pushed (``PUT /api/integrations/visit-lists/{ref}``).

    ``items`` keeps the organizer's ORDER and its refs as sent — an unresolved ref is kept and
    reported, so an object loaded later joins the list without the organizer pushing again.
    """

    __tablename__ = "visit_lists"

    ref: Mapped[str] = mapped_column(Text, primary_key=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    closes_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    scheduled_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    #: [{"source": …, "id": …}] in the organizer's order
    items: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class ObjectVisit(Base):
    """One Objektbesuch at its CURRENT state (docs/object-visits.md).

    The id is the client's (``ov…``, minted on the device before anything is sent). ``doc`` is
    the latest accepted document; every accepted version is also an immutable
    :class:`ObjectVisitRevision`. ``seq`` orders the organizer's change feed and is bumped
    whenever the revision, the readiness or a delivery state changes (``object_visits.bump_seq``).
    """

    __tablename__ = "object_visits"
    __table_args__ = (Index("ix_object_visits_object_visited", "object_id", "visited_at"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    #: SET NULL, not CASCADE: a visit is a record of what somebody saw, and deleting an
    #: Einsatzobjekt (a duplicate merge, a demo reset) must not take that record with it. The
    #: document keeps the object's name and address as they were.
    object_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("objects.id", ondelete="SET NULL"), nullable=True, index=True
    )
    work_ref: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    #: What the visit is AT (docs/object-visits.md «The target»): ``object`` — a catalogue object
    #: (``object_id``) — or ``location``: a pin or an address with no object at all.
    target_kind: Mapped[str] = mapped_column(String(16), nullable=False, default="object", server_default="object")
    #: Where it was, WGS84: the place of a location visit, the object's position (as recorded on
    #: the visit, else the catalogue's at the time of writing) for an object visit; null when unknown.
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    lifecycle: Mapped[str] = mapped_column(String(16), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    ready: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    doc: Mapped[dict] = mapped_column(JSONB, nullable=False)
    visited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    findings: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_by_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    updated_by_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    seq: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, index=True)


class ObjectVisitRevision(Base):
    """One accepted version of a visit document — immutable once written.

    ``op_id`` is the client's write-operation id: a PUT whose response was lost is sent again
    with the same one and answered with ``response``, the stored first answer, even when newer
    revisions exist by then. ``ready`` flips once every photo the revision references is stored.
    """

    __tablename__ = "object_visit_revisions"
    __table_args__ = (UniqueConstraint("visit_id", "op_id", name="uq_object_visit_revisions_op"),)

    visit_id: Mapped[str] = mapped_column(Text, ForeignKey("object_visits.id", ondelete="CASCADE"), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, primary_key=True)
    op_id: Mapped[str] = mapped_column(Text, nullable=False)
    lifecycle: Mapped[str] = mapped_column(String(16), nullable=False)
    doc: Mapped[dict] = mapped_column(JSONB, nullable=False)
    ready: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    response: Mapped[dict] = mapped_column(JSONB, nullable=False)
    accepted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    accepted_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    accepted_by_name: Mapped[str | None] = mapped_column(Text, nullable=True)


class ObjectVisitAttachment(Base):
    """A photo's ORIGINAL bytes for one visit, stored once under a fresh key and never replaced.

    Keyed by the client's attachment id within the visit; ``sha256`` is what makes a repeated
    upload idempotent and a different body under the same id a conflict. Thumbnails are derived
    (``<storage_key>.thumb.jpg``) and may be regenerated.
    """

    __tablename__ = "object_visit_attachments"

    visit_id: Mapped[str] = mapped_column(Text, ForeignKey("object_visits.id", ondelete="CASCADE"), primary_key=True)
    att_id: Mapped[str] = mapped_column(Text, primary_key=True)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    content_type: Mapped[str] = mapped_column(Text, nullable=False)
    storage_key: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ObjectVisitSeq(Base):
    """The change feed's counter — ONE row, bumped inside the writing transaction.

    ⚠️ A row, not a bare Postgres SEQUENCE, on purpose: a sequence hands its numbers out in CALL
    order but they become visible in COMMIT order, so an organizer polling ``after=<seq>`` could
    read 6 before 5 committed and never see 5. Updating this row holds its lock until the writer
    commits, so numbers become visible in the order they were handed out. Every writer bumps it
    LAST, after its own row locks, so the lock order is always visit → delivery → this row.
    """

    __tablename__ = "object_visit_seq"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    value: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)


class ObjectVisitDelivery(Base):
    """The outbox row for one visit to one destination (docs/object-visits.md «Delivery»).

    ``wanted_revision`` is the newest eligible ready revision, ``delivered_revision`` the newest
    one filed remotely — advanced by compare-and-swap only. ``remote_items`` maps attachment ids
    to the drive items written for them (``_folder`` and ``_removed`` are bookkeeping keys).
    """

    __tablename__ = "object_visit_deliveries"
    __table_args__ = (
        UniqueConstraint("destination", "visit_id", name="uq_object_visit_deliveries_dest_visit"),
        Index("ix_object_visit_deliveries_due", "state", "next_attempt_at"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    destination: Mapped[str] = mapped_column(String(64), nullable=False)
    visit_id: Mapped[str] = mapped_column(
        Text, ForeignKey("object_visits.id", ondelete="CASCADE"), nullable=False, index=True
    )
    wanted_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    delivered_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    #: pending | delivered | failed | paused
    state: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lease_owner: Mapped[str | None] = mapped_column(Text, nullable=True)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: what the destination config + credentials looked like when the row went `failed` — a
    #: change to either is one of the three things that put it back to `pending`
    failed_fingerprint: Mapped[str | None] = mapped_column(Text, nullable=True)
    remote_folder_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    remote_items: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ObjectVisitDeliveryLog(Base):
    """Append-only: what each delivery attempt did. Never updated, never pruned."""

    __tablename__ = "object_visit_delivery_log"

    id: Mapped[uuid.UUID] = _uuid_pk()
    delivery_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("object_visit_deliveries.id", ondelete="CASCADE"), nullable=False, index=True
    )
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    #: claimed | delivered | retry | failed | paused | resumed | superseded | retry_requested
    event: Mapped[str] = mapped_column(String(32), nullable=False)
    revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)


class ReferenceDataset(Base):
    __tablename__ = "reference_datasets"

    id: Mapped[str] = mapped_column(Text, primary_key=True)  # 'symbols:tactical', 'geo:hydrant', 'plan:<obj>:modul1'
    object_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("objects.id", ondelete="CASCADE"), nullable=True)
    module: Mapped[str | None] = mapped_column(String(16), nullable=True)  # 'modul1'…'modul6'
    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # 'pdf' | 'geojson' | 'symbols'
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_type: Mapped[str] = mapped_column(String(16), nullable=False, default="uploaded")
    source_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    storage_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    feature_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    current_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    fetch_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Checksum the SOURCE declared for the bytes currently stored here (sha256 hex, lowercase).
    # Set by the snapshot pull (app/plans.py) so a scheduled run can tell "unchanged" from
    # "changed" without downloading anything. NULL for hand-uploaded datasets — the upload path
    # has no upstream checksum to record, and NULL simply means "compare nothing, fetch it".
    source_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)


class PlanRevision(Base):
    """One immutable version of a plan PDF: exact bytes an incident may pin and re-download.

    ``ReferenceDataset.current_version`` names the newest one; older rows keep their storage
    key so a replacement never takes a bound sheet away from a running Einsatz.
    """

    __tablename__ = "plan_revisions"

    dataset_id: Mapped[str] = mapped_column(
        Text, ForeignKey("reference_datasets.id", ondelete="RESTRICT"), primary_key=True
    )
    version: Mapped[int] = mapped_column(Integer, primary_key=True)
    storage_key: Mapped[str] = mapped_column(Text, nullable=False)
    #: sha256 of the stored bytes — written at store time; the alignment worker backfills a
    #: legacy row's digest the first time it renders the original.
    content_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    content_type: Mapped[str] = mapped_column(Text, nullable=False, default="application/pdf")
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class PlanAlignment(Base):
    """One durable alignment job/proposal per (plan revision, page) — never auto-published.

    ``status`` walks pending → processing → ready/needs_review/no_match/failed/unavailable/
    unsupported, and ``approved`` is set only through ``plan_approval.approve_fit`` – by an
    admin's «Freigeben», or by the import of a plan that states its own fit in ``§GEO`` markers.
    ``edit_version`` is the CAS token every mutation (worker completion included) must present.
    """

    __tablename__ = "plan_alignments"
    __table_args__ = (
        ForeignKeyConstraint(["dataset_id", "plan_version"], ["plan_revisions.dataset_id", "plan_revisions.version"]),
        UniqueConstraint("dataset_id", "plan_version", "page"),
        Index("ix_plan_alignments_status", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    dataset_id: Mapped[str] = mapped_column(Text, nullable=False)
    plan_version: Mapped[int] = mapped_column(Integer, nullable=False)
    page: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="pending")
    edit_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    pairs: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    aspect: Mapped[float | None] = mapped_column(Float, nullable=True)
    scale_m_per_u: Mapped[float | None] = mapped_column(Float, nullable=True)
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    coverage: Mapped[float | None] = mapped_column(Float, nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: the exact reference geometry (WGS84 rings) the proposal was fitted against — what the
    #: review map draws, so the admin judges the fit against what the fit actually saw.
    reference_rings: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    reference_source: Mapped[str | None] = mapped_column(Text, nullable=True)
    reference_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: What this revision's own ``§`` markers said, written by every marker run of the worker
    #: (16.09.2026): ``{"warnings": [MarkerWarning …], "storeys_found", "storeys_written",
    #: "geo_pairs"}``. NULL = this sheet carries no markers at all. It is a REPORT, not state:
    #: nothing reads it back to decide anything, it is overwritten whole on the next run of this
    #: revision, and it is deliberately outside ``plan_approval.snapshot`` — an export getting
    #: better or worse is not an admin decision and writes no history row.
    marker_notes: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PlanPageFloor(Base):
    """One floor of the building on a plan revision (decided 14.09.2026, regions 14.09. evening).

    A revision with any row here is a *floor pack*: each row is a Geschoss with a stable signed
    ``floor_index`` (0 = reference level, +1 above, -1 below), an optional operator name
    («Hauptebene»), and WHERE it is drawn: a ``page``, and – on an A0/A1 sheet that carries
    several floors – a ``clip`` rectangle on that page (normalized [x0, y0, x1, y1]) and a
    ``join``: this floor's drawing meets ANOTHER floor's drawing at one point pair – ``at`` on this
    one, ``there`` on floor ``to`` (the staircase on both, say) – which is what lines the drawings
    up on each other, chained floor by floor from the reference; the pack's one map fit is
    measured in page coordinates and applies through the joins. No clip = the whole page.
    A storey may be drawn in SEVERAL pieces (``part``, 16.09.2026) – two wings of one 1. OG on one
    sheet – and then every piece is a row with its own region and its own join.
    The index is vertical ORDER, never height above terrain. Rows are keyed by the exact
    revision, so an incident that pinned version N keeps N's floors after the station replaces
    the PDF; ``plans.store_plan`` copies them onto a replacement only when the page counts still
    match.
    """

    __tablename__ = "plan_page_floors"
    __table_args__ = (
        ForeignKeyConstraint(["dataset_id", "plan_version"], ["plan_revisions.dataset_id", "plan_revisions.version"]),
    )

    dataset_id: Mapped[str] = mapped_column(Text, primary_key=True)
    plan_version: Mapped[int] = mapped_column(Integer, primary_key=True)
    floor_index: Mapped[int] = mapped_column(Integer, primary_key=True)
    #: which DRAWING of that storey this row is (16.09.2026): a large building's 1. OG may exist
    #: as two separate drawings for its two wings, and each is a row of its own with its own
    #: ``clip`` and its own ``join``. 0 = the storey's first (and, for almost every pack, only)
    #: drawing, which is why it is part of the key rather than a new table.
    part: Mapped[int] = mapped_column(Integer, primary_key=True, nullable=False, default=0, server_default="0")
    page: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    floor_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    clip: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    #: {"to": <floor_index>, "part": <part, 0 when absent>, "at": [x, y], "there": [x, y]} –
    #: normalized page coordinates
    join: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    #: what the PDF's own ``§`` markers proposed for this floor, when they proposed it:
    #: ``{"version", "name", "clip", "join"}`` (app/plan_markers.py). It is the baseline the row
    #: is compared against, so a re-export can follow the markers where they moved and keep the
    #: admin's own name/region/join where they differ. NULL = nobody's markers made this row.
    marker: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class PlanAlignmentEvent(Base):
    """Append-only history of admin decisions on one alignment (approve/withdraw/retry)."""

    __tablename__ = "plan_alignment_events"
    __table_args__ = (Index("ix_plan_alignment_events_alignment_id", "alignment_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    alignment_id: Mapped[int] = mapped_column(Integer, ForeignKey("plan_alignments.id"), nullable=False)
    action: Mapped[str] = mapped_column(String(24), nullable=False)
    edit_version: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# --- Multi-station deployment config (Phase 1.A) ------------------------------------


class DeploymentConfig(Base):
    """Singleton row (id=1) holding the per-station deployment config document.

    ``config_json`` is the admin-edited JSON described in docs/CONFIGURATION.md §1
    (identity/map/referenceLayers/fleet/symbols/doctrine/roster). It is validated
    through the Pydantic schema in schemas.py before persistence.

    ⚠️ NO SECRET EVER GOES IN ``config_json``. ``GET /api/config`` is public and the Sicherung
    export/import round-trip replaces the whole document, so a secret in there would be both a
    leak and one bad import away from deletion. The station-level ones are columns below;
    integration credentials (Divera, Traccar, VAPID, STT, the webhooks, the monitor) live in
    ``integration_credentials``, encrypted — see app/credentials.py.
    """

    __tablename__ = "deployment_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    config_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Editor-authored (NOT admin) station plan document: {default, byPlan, georefByPlan} — the
    # plan-scale calibration plus the per-plan georeference landmark pairs (app/api/plan_scales.py).
    # Kept OUT of config_json so an admin config push never wipes it and it isn't schema-validated
    # as config. Persists once-off plan work across incidents/devices — see docs/CONFIGURATION.md.
    # ⚠️ The flip side of being outside config_json: this column has NO history and NO backup.
    # `admin_config history|restore` only ever covers config_json, so a PUT here (a whole-document
    # replace) overwrites the previous calibration/georeference irrecoverably.
    plan_scales_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Station-level capture secret (the Erfassungs-Poster QR). NOT part of config_json —
    # GET /api/config is public and must never leak it. NULL = capture disabled (fail-closed);
    # rotating replaces it, invalidating every printed poster at once.
    capture_secret: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Statistics-export token (read-only GET /api/stats/*, consumer e.g. fwo-stats).
    # Same rules as capture_secret: never in config_json, NULL = disabled (fail-closed).
    stats_secret: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Minting key for incident view links (app/auth/incident_link.py): the alerting system
    # holds a copy and signs the link token it puts into an alert, offline. Deliberately NOT
    # settings.SECRET_KEY — that one peppers PINs and mints admin sessions, so anyone holding
    # it could issue themselves deployment-admin access. Same rules as the two above: never in
    # config_json, NULL = disabled (fail-closed); rotating invalidates every link already sent.
    incident_link_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Standing links (2026-09-09) — station-level secrets that ARE a URL, like the per-incident
    # view/atemschutz keys but on the deployment: they bind to «whichever Einsatz is open»,
    # resolved at exchange time (app/api/incident_link.py). Same rules as every secret column
    # here: never in config_json, NULL = disabled (fail-closed), rotating invalidates the
    # printed QR / enrolled devices AND every session already open.
    #   terminal_link_key      — the Stations-Terminal enrollment (read-only, kf-scope)
    #   atemschutz_standing_key — the laminated Atemschutz QR (the ak write slice)
    terminal_link_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    atemschutz_standing_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    # --- Telemetry (opt-in, see app/telemetry/) --------------------------------------
    # Consent for the BACKGROUND channel only: 'off' (or NULL) | 'errors'. NULL is the
    # column default and the value every existing and every fresh install starts at, which
    # is what makes "off unless switched on" a property of the schema rather than of some
    # code path remembering to check. Out of config_json deliberately: an admin config push
    # from the CLI must not be able to turn telemetry on as a side effect of editing the
    # roster, and a consent decision should not be something you can accidentally `load`.
    telemetry_consent: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Random per-install id, minted on first use of either channel — NOT at boot, so an
    # instance that never opts in never even generates one. Not derived from the hostname,
    # the config or the DB: it identifies reports as same-origin and nothing else, and
    # regenerating it (admin UI) is how a station makes its past reports unlinkable.
    telemetry_install_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)


class DeploymentConfigHistory(Base):
    """The config document AS IT WAS, kept before each write that replaced it.

    ⚠️ Every writer of ``deployment_config.config_json`` replaces the WHOLE document, so one
    writer holding an outdated copy costs a station its Dienstgrade, its Atemschutz-Doktrin, its
    Partnerorganisationen and its Fahrzeuge in a single silent write. The demo lost its config
    three times in four days, each time through a different path, each time diagnosed only
    because somebody happened to look.

    The guards in front of those paths stay (a browser must send the version it read; the CLI
    refuses to empty a populated section without ``--force``) — but each of them protects a route
    somebody thought of, and the record here is that enumerating them keeps coming up short. This
    table protects nothing and covers everything: it is what makes a bad write UNDOABLE, whatever
    wrote it. A station has no seed file to rebuild from — the demo's reset is the only reason
    those three occurrences were recoverable at all — so for a real Wehr this is the whole safety
    net. See ``admin_config history|restore``.
    """

    __tablename__ = "deployment_config_history"
    __table_args__ = (Index("ix_config_history_replaced_at", "replaced_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    #: the document as it stood BEFORE the write, not a diff — a diff needs an intact base to
    #: mean anything, and the case this exists for is exactly the one where there isn't one
    config_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    replaced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    #: which path did the replacing — `api` (Verwaltung / HTTP), `cli` (admin_config load),
    #: `branding` (a logo upload), `geodata` (a reference-layer push). The one question that was
    #: unanswerable after the fact: nobody could say whether it had been a browser or a terminal.
    source: Mapped[str | None] = mapped_column(String(16), nullable=True)
    #: the admin driving the UI; NULL for a CLI push, which has no user behind it
    replaced_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)


# --- Audit-trail capture substrate (sub-phase A) ------------------------------------


class IncidentEvent(Base):
    """Append-only, hash-chained operational event for an incident."""

    __tablename__ = "incident_events"

    id: Mapped[uuid.UUID] = _uuid_pk()
    client_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    incident_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("incidents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    seq: Mapped[int] = mapped_column(BigInteger, nullable=False)  # monotonic per incident
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    source: Mapped[str] = mapped_column(String(16), nullable=False)  # client|status|divera|units|gps
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    op_type: Mapped[str] = mapped_column(String(32), nullable=False)
    payload_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    prev_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    hash: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (
        UniqueConstraint("incident_id", "seq", name="uq_incident_events_seq"),
        Index("uq_incident_events_client_id", "incident_id", "client_id", unique=True),
        # «Der Einsatz-Link wurde erstellt» is recorded ONCE per Einsatz, and this is what makes
        # that true rather than the check-then-append that reads for it (api/incidents ·
        # create_einsatz_link). The endpoint mints on sheet-open, so a React StrictMode double
        # mount fires two of them at once — and the incident-row lock the appender takes is a
        # no-op on SQLite, so in dev both read «no row yet» and both wrote one into the hash
        # chain. A partial unique index is the one guard that holds on every engine.
        Index(
            "uq_incident_events_einsatz_link",
            "incident_id",
            unique=True,
            postgresql_where=text("source = 'einsatz-link'"),
            sqlite_where=text("source = 'einsatz-link'"),
        ),
    )


class PushSubscription(Base):
    """One browser's Web-Push endpoint (killed-app alarm delivery). Endpoint is the natural
    key — re-subscribing upserts; a 404/410 from the push service deletes the row."""

    __tablename__ = "push_subscriptions"

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    endpoint: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    p256dh: Mapped[str] = mapped_column(Text, nullable=False)
    auth: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class JournalEntry(Base):
    """One Verlauf row as a first-class append-only record.

    The Verlauf used to ride inside the workspace blob, making the one unbounded domain
    re-sync wholesale on every edit. Rows are now appended here once and never rewritten:
    the client-generated row id (`'t'+Date.now()`…) is the idempotency key, `seq` is the
    per-incident monotonic read cursor, and `row_json` carries the TimelineEvent verbatim
    (the frontend owns its shape). Distinct from IncidentEvent: that is the hash-chained
    AUDIT record of committed domain actions; this is the operational journal store.
    """

    __tablename__ = "journal_entries"

    id: Mapped[uuid.UUID] = _uuid_pk()
    incident_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("incidents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    client_id: Mapped[str] = mapped_column(Text, nullable=False)
    seq: Mapped[int] = mapped_column(BigInteger, nullable=False)
    row_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("incident_id", "client_id", name="uq_journal_client_id"),
        UniqueConstraint("incident_id", "seq", name="uq_journal_seq"),
    )


class WorkspaceSnapshot(Base):
    """Versioned blob = fold checkpoint for replay."""

    __tablename__ = "workspace_snapshots"

    id: Mapped[uuid.UUID] = _uuid_pk()
    incident_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("incidents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    seq_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    storage_key: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class VehicleSample(Base):
    """GPS history sample tied to an incident window (outside the hash chain)."""

    __tablename__ = "vehicle_samples"

    id: Mapped[uuid.UUID] = _uuid_pk()
    incident_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("incidents.id", ondelete="CASCADE"), nullable=False)
    device_id: Mapped[int] = mapped_column(Integer, nullable=False)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    lat: Mapped[float] = mapped_column(Numeric(10, 7), nullable=False)
    lng: Mapped[float] = mapped_column(Numeric(10, 7), nullable=False)
    course: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    speed: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)

    __table_args__ = (Index("ix_vehicle_samples_incident_device_ts", "incident_id", "device_id", "ts"),)


class PersonPosition(Base):
    """Where one person currently is, self-reported from their own phone.

    Deliberately NOT a history table — unlike ``VehicleSample`` above there is one row per
    person per incident, overwritten on every update. The feature answers "where is the crew
    working right now" (someone on a Wassertransport is kilometres away *on purpose*, and the
    FU wants to see that), not "where has this person been", and a track of a named human's
    movements is a record this app has no reason to keep.

    Everything about the row is ephemeral: it is deleted when the Einsatz is closed, swept
    when it goes untouched, and cascades with the incident. It is outside the hash chain, does
    not appear in Verlauf, and never reaches the Rapport.

    ``person_id`` is a *claim*: the sharer picked their own name out of the roster on their
    phone. ``device_id`` is what makes that claim traceable to one device, so a second phone
    claiming the same person is detectable rather than silently overwriting.
    """

    __tablename__ = "person_positions"

    id: Mapped[uuid.UUID] = _uuid_pk()
    incident_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("incidents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    person_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("personnel.id", ondelete="CASCADE"), nullable=False)
    #: Opaque random id generated on the sharing device (never a fingerprint of it).
    device_id: Mapped[str] = mapped_column(Text, nullable=False)
    #: Name snapshot, same reasoning as AttendanceEntry.displayNameSnapshot — the map keeps
    #: reading right after a roster rename mid-Einsatz.
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    lat: Mapped[float] = mapped_column(Numeric(10, 7), nullable=False)
    lng: Mapped[float] = mapped_column(Numeric(10, 7), nullable=False)
    accuracy_m: Mapped[float | None] = mapped_column(Numeric(8, 1), nullable=True)
    #: The device's own fix time — what the operator reads as "vor 3 min".
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (UniqueConstraint("incident_id", "person_id", name="uq_person_positions_incident_person"),)


# --- Telemetry outbox -----------------------------------------------------------------


class TelemetryOutbox(Base):
    """One already-sanitised payload waiting to go upstream.

    A queue rather than a direct POST, for three reasons that all come from where this app
    runs: the instance may be offline for a day, the ingest may be down, and — the one that
    actually decides it — the operator has to be able to SEE what is queued before and after
    it goes. A fire-and-forget POST is unauditable by construction; a table is `SELECT`able
    by the deployer with psql, which is the strongest transparency claim available.

    ``payload_json`` is the finished event, post-scrub. Nothing is sanitised on the way OUT
    of this table, so what a deployer reads here is byte-for-byte what left the building.
    """

    __tablename__ = "telemetry_outbox"

    id: Mapped[uuid.UUID] = _uuid_pk()
    # 'error' (background, needs consent) | 'report' (manual, the send button is the consent)
    channel: Mapped[str] = mapped_column(String(16), nullable=False)
    payload_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # NULL = still queued. Set once the ingest has 200'd; rows are swept after a few days.
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    # Why the last attempt failed, for the admin screen. Never the response body — an error
    # from someone else's server is not something we want to store verbatim.
    last_error: Mapped[str | None] = mapped_column(String(200), nullable=True)

    __table_args__ = (Index("ix_telemetry_outbox_pending", "sent_at", "created_at"),)


# --- Integration credentials (browser-settable, encrypted at rest) ---------------------


class IntegrationCredential(Base):
    """One integration credential a station set from the browser, encrypted at rest.

    ⚠️ Its own table rather than a field of ``deployment_config.config_json``, and that is
    the load-bearing part. ``GET /api/config`` is PUBLIC — the login screen brands itself
    before anybody logs in — and the Sicherung export/import round-trip replaces that whole
    document. A credential inside it would make the export a leak and the import a
    credential-deletion button. The three station secrets that came before this
    (``capture_secret``, ``stats_secret``, ``incident_link_key``) are columns for exactly
    that reason; there are sixteen of these and they each carry their own «changed when, by
    whom», so they get a table instead.

    ``value_encrypted`` is ``version ‖ nonce ‖ AES-256-GCM(value, aad=name)`` under a key
    HKDF-derived from ``SECRET_KEY``, which stays in ``.env`` (see app/credentials.py). So a
    database dump on its own — the nightly backup, the pre-migration safety dump, a laptop
    with a restore on it — carries no usable credential.

    ⚠️ Which also means rotating ``SECRET_KEY`` makes every row here unreadable, the same way
    it invalidates every PIN. That is reported as «unlesbar, bitte neu setzen», never as «nicht
    konfiguriert» — an operator who is told a credential is missing goes and looks for a
    setting they already made.
    """

    __tablename__ = "integration_credentials"

    #: The ``Settings`` attribute name (``divera_access_key``, …). One string is the DB key,
    #: the env-variable name (upper-cased) and the settings attribute, so they cannot drift.
    name: Mapped[str] = mapped_column(String(64), primary_key=True)
    value_encrypted: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    #: The admin who set it, where a person was behind it; NULL for a CLI/automated write.
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)


class IntegrationCredentialAudit(Base):
    """That a credential changed, when, and by whom — never the value, not even encrypted.

    Config writes keep the previous document so a bad one is undoable. A credential must NOT
    work that way: keeping old values would mean a leaked ``SECRET_KEY`` exposes every
    credential this station has ever held, not just its current ones. So this table records
    the event and nothing else, and «undo» is «set it again», which for a credential is the
    only honest undo anyway — the far end has to be told either way.
    """

    __tablename__ = "integration_credential_audit"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    #: 'set' (first time) | 'rotated' (replaced an existing value) | 'cleared'
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    #: which path did it — 'api' (Verwaltung) today; kept for the same reason
    #: ``deployment_config_history.source`` exists: «browser or terminal» was unanswerable.
    source: Mapped[str | None] = mapped_column(String(16), nullable=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)


# --- SharePoint pull connector (one row per area) ---------------------------------------


class SharePointSyncState(Base):
    """What the SharePoint pull knows about ONE area — its resume point and its last report.

    One row per area (``plans`` / ``geodata`` / ``checklists`` / ``workbook``) because the areas
    are configured independently and fail independently: a station whose Geodaten folder was
    renamed must still get its Objektpläne, and the System page has to be able to say which of
    the four is the one that stopped.

    Three things live here and nothing else does — the imported DATA is in
    ``reference_datasets``/``objects``/``deployment_config`` like every hand-uploaded record,
    because the connector is a transport and not a second store:

    * **the resume point** — ``delta_token`` (Graph's ``@odata.deltaLink``), plus the resolved
      drive/folder ids so a poll that changes nothing costs one request.
    * **what we have** — ``files`` maps each file's path inside the source folder to the eTag
      that was imported from it. It is what makes «nothing changed» free and it is what makes
      «gone from the source» knowable at all.
    * **what happened** — the last run's status and counts, for the admin System card. Silent
      death is the failure this connector is most likely to have (an expired client secret,
      two years in), so the report is part of the feature rather than a log line.

    ⚠️ ``missing`` is a NOTE, never an action. A file that disappears from SharePoint is listed
    here and its record is left exactly as it is: the far likelier cause of a vanished file is
    somebody reorganising a folder — or a listing that failed halfway — than a decision that
    the crew should no longer have that plan.
    """

    __tablename__ = "sharepoint_sync_state"

    #: 'plans' | 'geodata' | 'checklists' | 'workbook' (schemas · SharePointArea)
    area: Mapped[str] = mapped_column(String(16), primary_key=True)
    #: Graph's opaque deltaLink for this folder — the change feed's resume point. NULL after a
    #: reconfiguration or a 410 Gone, which simply means the next run walks everything.
    delta_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Resolved once and cached: the library and the folder inside it the config points at.
    drive_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    item_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: The `siteUrl|driveId + library + path` this row was resolved FOR. A config edit that
    #: changes the folder must not resume against the old one's delta token.
    source_fingerprint: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: {path inside the source folder: eTag imported from it}
    files: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    #: [{"path": …, "since": ISO-8601}] — present in `files`, absent from the last listing.
    missing: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    #: 'ok' | 'unchanged' | 'refused' | 'unreachable' | 'auth_failed' | 'error' | 'needs_review'
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="ok")
    #: One operator-readable line for the failing states. Never carries a credential.
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    imported: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    skipped: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: The one the System card leads with: a green tick that is four weeks old is a red state.
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


# --- Connector health (one row per polling connector) -----------------------------------


class ConnectorState(Base):
    """When a connector last TRIED, when it last actually WORKED, and why it did not.

    SharePoint has carried its own state since it shipped (``SharePointSyncState`` above); the
    other three connectors carried nothing at all, so ``GET /api/system`` could say «Divera ist
    konfiguriert» and nothing else — which is the same sentence on a station whose key was
    rotated two years ago. This table is the missing half, and it keeps the honesty rule that
    one already states: ``last_attempt_at`` and ``last_success_at`` are SEPARATE facts, because
    a green tick left standing through a week of auth failures is the silent death this surface
    exists to prevent. A reader that shows only «zuletzt geprüft» shows a lie.

    One row per connector, created on the first tick that has something to report:

    * ``divera_alarms`` — the alarm intake. BOTH paths write it: the 120 s poll and an
      authenticated webhook delivery, because the webhook is the primary intake and a station
      whose webhook is healthy must not be told the connector is stale just because its poll
      key is not the one being used.
    * ``traccar`` — the vehicle feed, written by the 30 s sample sweep. Its writes are
      THROTTLED (see ``app/connector_state.py``): a row rewritten twice a minute forever is
      churn, and the question this row answers («is it still working») does not change that
      fast. A transition — the first failure after successes, or the first success after a
      failure — is never throttled.
    * ``divera_personnel`` — the Mannschaft sync, written by the nightly autosync AND by a hand
      -triggered ``POST /api/personnel/sync/execute``, so «zuletzt synchronisiert» is truthful
      whoever pressed it.

    * ``roster_snapshot`` — the roster-snapshot poll (app/roster_snapshot_sync.py), written by
      the scheduled tick and by «Jetzt abrufen».

    ``detail`` carries the connector-specific numbers the UI shows beside the timestamps (the
    personnel sync's added/updated/deactivated, and the stale members a 'safe' level leaves
    outstanding). It is a report, never a resume point — with ONE exception: the roster
    snapshot reads its ``lastGood`` back (which file the roster reflects, so an older copy is
    refused and an unchanged one skipped). A lost row costs that connector one idempotent
    re-apply; every other connector loses a line on a status card and nothing else.
    """

    __tablename__ = "connector_states"

    #: 'divera_alarms' | 'traccar' | 'divera_personnel' | 'roster_snapshot' (app/connector_state.py)
    name: Mapped[str] = mapped_column(String(32), primary_key=True)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: NEVER touched by a failed run, and never by a run that fetched nothing.
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: One operator-readable line, cleared by the next success. Never carries a credential —
    #: see ``connector_state.safe_error``, which is why this is not ``str(exc)``.
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Connector-specific counts for the status card. No schema — a report, not a contract.
    detail: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


# --- Visit statistics (public demo + landing page; OFF unless VISIT_STATS=true) ---------


class VisitStat(Base):
    """One counter per day, kind and key. The record — everything else is scaffolding.

    Aggregates only, by construction: there is no row-per-hit table anywhere in this design,
    so «who visited» is not a question this schema can answer even to whoever holds the
    database. ``hits`` is every request that matched a bucket; ``uniques`` counts each
    :class:`VisitHash` the first time it appears on that day and never again.

    ⚠️ Nothing writes here unless ``VISIT_STATS=true``, which only the public demo sets. A
    station's deployment runs this same code with the flag off and the table stays empty —
    see app/visits.py for why that gate is a hard requirement rather than a preference.
    """

    __tablename__ = "visit_stats"

    #: Calendar day in UTC. Not a timestamp: an hour-resolution counter would start being a
    #: pattern about one person on a day the demo had three visitors.
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    #: 'page' (landing page, per language) | 'referrer' (which host linked here, host only)
    #: | 'demo' (the demo's app shell) | 'feature' (a coarse usage bucket)
    kind: Mapped[str] = mapped_column(String(16), primary_key=True)
    #: The bucket inside the kind — a language code, a hostname, 'app', 'lage', …
    #: Always from a closed allowlist, except 'referrer' whose keys are clamped hostnames.
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    hits: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    uniques: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))


class VisitHash(Base):
    """That some visitor already counted towards ``uniques`` for this day/kind/key.

    The hash is ``HMAC(SECRET_KEY, "visit-salt" + YYYY-MM-DD)`` over IP + User-Agent — a salt
    that rotates at midnight and is never stored. So two rows from consecutive days cannot be
    told to be the same visitor, by us or by anyone with the database: yesterday's salt no
    longer exists anywhere. That is the whole reason this is a hash table and not a visitor
    table, and it is why no cookie, no localStorage and no consent banner is involved.

    Swept after ``RETAIN_DAYS`` (app/visits.py) — the rows are inert well before that, since
    a hash can only ever be matched within its own day. :class:`VisitStat` is the record.
    """

    __tablename__ = "visit_hashes"

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    kind: Mapped[str] = mapped_column(String(16), primary_key=True)
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    #: hex SHA-256, truncated to 32 chars — enough to dedup a day's visitors, and short
    #: enough that the table stays a counter's scratch space rather than an identifier store.
    visitor: Mapped[str] = mapped_column(String(32), primary_key=True)
