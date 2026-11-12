"""Divera 24/7 intake logic: alarm classification, alarm parsing, pool upsert.

The keyword vocabulary is not a literal here. The shipped default lives in
`data/alarm_keywords.json`, vendored byte-for-byte into kp-rueck and pinned by checksum in
both — the same mechanism as `app/telemetry/`, and for the same reason: the two products may
not share a library (`RUNNING-BOTH.md`), so the copies stay copies and a test compares them.
It used to be two hand-maintained tables that nobody compared, and they had already drifted.
A station whose alarm words differ replaces the whole vocabulary from its deployment config
(`alarmKeywords`, docs/CONFIGURATION.md §1a) — see `active_vocabulary()` below.

What stays local is what is genuinely ours: the German labels (kp-front carries `type` as a
display string, not an enum) and the matcher. kp-rueck's matcher is not identical to this one
— see the JSON's `known_matcher_divergence`.

NOTE ON THIS MODULE'S NAME. `detect_type` / `infer_priority` and the vocabulary they read are
NOT Divera-specific — the generic `POST /api/alarms` intake calls them too. They live here for
history, not for a reason; only the HTTP client below is genuinely the Divera attachment.
Moving the matcher out is a separate change, and a noisier one than it looks.

Improvement over kp-rueck: an existing pool alarm whose `ts_update` advanced gets its fields
refreshed.
"""

import logging
import time
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlsplit

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from . import audit
from .alarm_keywords import SHIPPED, InvalidVocabularyError, Vocabulary, parse
from .config import settings
from .credentials import get as credential
from .database import dialect_insert
from .divera_responses import cached_catalogue, classify_answers, ensure_catalogue, parse_responses_by_alarm, resolvable
from .models import DiveraEmergency, Incident
from .push import notify_new_alarm
from .schemas import DiveraWebhookPayload

logger = logging.getLogger(__name__)

# Category key → the German string kp-front stores on the incident and shows the operator.
# This half is OURS: `incidents.type` is a display string here, the values are already in the
# database of every running station, and kp-rueck spells one of them differently
# ("BMA / Unechte Alarme"). Migrating a stored value to settle a capital letter is not worth
# it, so the disagreement is named in the JSON and the labels stay local.
#
# The ONE copy: GET /api/config serves it as `categoryLabels`, and the Einsatz wizard offers its
# values as the Kategorie picker, IN THIS ORDER (sweep B.9, 23.10.2026 – the frontend kept a
# second list nothing compared). en/fr/it translate only the option text (`intake.kategorienLabels`).
CATEGORY_LABELS: dict[str, str] = {
    "brandbekaempfung": "Brandbekämpfung",
    "strassenrettung": "Strassenrettung",
    "technische_hilfeleistung": "Technische Hilfeleistung",
    "elementarereignis": "Elementarereignis",
    "oelwehr": "Ölwehr",
    "chemiewehr": "Chemiewehr",
    "strahlenwehr": "Strahlenwehr",
    "einsatz_bahnanlagen": "Einsatz Bahnanlagen",
    "bma_unechte_alarme": "BMA / unechte Alarme",
    "gerettete_tiere": "Gerettete Tiere",
    "dienstleistungen": "Dienstleistungen",
    "diverse_einsaetze": "Diverse Einsätze",
}


def category_label(category: str) -> str:
    """German label for a shared category key, degrading to the fallback label if it is new.

    A category kp-rueck adds to the shared file before kp-front has a label for it must not
    stop this app from booting: it sits on the alarm intake path, and refusing to start is a
    far worse answer than filing one rare alarm under «Diverse Einsätze». The *loud* half of
    that trade lives in tests/test_alarm_keywords.py, which fails the build on exactly this
    condition — so the gap is caught before it ships, and survivable if it ever ships anyway.
    A deployment's OWN vocabulary cannot reach here with an unlabelled category at all: config
    validation rejects one that routes anywhere this map has no label for.
    """
    return CATEGORY_LABELS.get(category) or CATEGORY_LABELS[SHIPPED.fallback_category]


# How long the resolved vocabulary is reused before the config row is read again. Same TTL,
# same reasoning as the geocoder bias (geocode._resolve_bias): an admin edit takes effect
# within a minute without a restart, and an alarm storm doesn't re-query per alarm.
_VOCAB_TTL_SECONDS = 60.0
_vocab_cache: tuple[float, Vocabulary] | None = None


def reset_vocabulary_cache() -> None:
    """Forget the cached vocabulary — for tests and for anything that just wrote the config."""
    global _vocab_cache
    _vocab_cache = None


async def active_vocabulary() -> Vocabulary:
    """The vocabulary this deployment actually classifies with. Never raises.

    `alarmKeywords` in the deployment config REPLACES the shipped default wholesale — no
    per-keyword merging, because at 3am «which keywords are running» must have one answer in
    one place (docs/CONFIGURATION.md §1a). Unset (the normal case) → the shipped file, and the
    result is character-for-character what this app has always produced.

    A stored block that no longer parses degrades to the shipped vocabulary with an ERROR in
    the log rather than taking the alarm intake down. That is not a soft acceptance of bad
    config: the loud half is at the door — `admin_config load` and `PUT /api/config` refuse an
    invalid block outright — so reaching here means the row was edited around them.
    """
    global _vocab_cache
    now = time.monotonic()
    if _vocab_cache is not None and now - _vocab_cache[0] < _VOCAB_TTL_SECONDS:
        return _vocab_cache[1]

    vocab = SHIPPED
    try:
        # Imported lazily to avoid a circular import at module load and to keep this module
        # importable in contexts without a configured DB.
        from .database import async_session_maker
        from .models import DeploymentConfig

        async with async_session_maker() as db:
            row = (await db.execute(select(DeploymentConfig).where(DeploymentConfig.id == 1))).scalar_one_or_none()
        cfg: Any = (row.config_json or {}) if row else {}
        block = cfg.get("alarmKeywords") if isinstance(cfg, dict) else None
        if block:
            try:
                vocab = parse(block)
            except InvalidVocabularyError as e:
                logger.error(
                    "deployment config alarmKeywords is invalid (%s) — classifying with the "
                    "shipped vocabulary instead. Fix it with `python -m app.admin_config load`.",
                    e,
                )
    except Exception as e:  # noqa: BLE001 — never let a config lookup break alarm intake
        logger.warning("Alarm vocabulary config lookup failed; using the shipped default: %s", e)

    _vocab_cache = (now, vocab)
    return vocab


def alarm_time(ts_create: int | None) -> datetime | None:
    """Divera's ``ts_create`` (unix seconds, UTC) as an aware datetime — the Alarmierungszeit.

    ``None`` for a missing or non-positive stamp: an incident opened from such an alarm keeps
    the server default and is marked as having no known alarm time, rather than inheriting
    epoch 0 or the moment the tablet was picked up.
    """
    if not ts_create or ts_create <= 0:
        return None
    try:
        return datetime.fromtimestamp(ts_create, tz=UTC)
    except (OverflowError, OSError, ValueError):
        logger.warning("Divera ts_create out of range: %r", ts_create)
        return None


def _einsatzart(title: str | None) -> str:
    """The part of an alarm title the keywords are matched against: up to the first comma.

    fwo-divera titles an alarm «Verunreinigung, Allschwilerstrasse» – Einsatzart, then the
    street (the Gemeinde for Nachbarhilfe) – and street names carry keywords: «Bahnhofstrasse»
    holds BAHN, «Kaibmattweg» holds BMA, every «…gasse» holds GAS. A title without a comma is
    matched whole. There is deliberately no whole-title retry when the Einsatzart matches
    nothing: that retry would hand exactly those alarms back to the street names.
    """
    return (title or "").partition(",")[0]


def detect_type(title: str, *, vocab: Vocabulary) -> str:
    """German display label for an alarm title. First keyword found in its Einsatzart wins.

    `vocab` is required rather than defaulted: a call site that forgot to resolve it would
    classify against the shipped words while the station runs its own, and nothing would say
    so. `await active_vocabulary()` is the one way to get it.
    """
    up = _einsatzart(title).upper()
    for keyword, category in vocab.keyword_to_category:
        if keyword in up:
            return category_label(category)
    return category_label(vocab.fallback_category)


def infer_priority(title: str, text: str | None = None, *, vocab: Vocabulary) -> str:
    """HIGH when a high-priority keyword is in the title's Einsatzart or the text, else LOW."""
    combined = f"{_einsatzart(title)} {text or ''}".upper()
    for keyword in vocab.high_priority_keywords:
        if keyword in combined:
            return "HIGH"
    return "LOW"


def parse_alarms_response(data: dict) -> list[DiveraWebhookPayload]:
    """Parse Divera /alarms into payloads (skipping closed/archived)."""
    out: list[DiveraWebhookPayload] = []
    if not data.get("success"):
        logger.warning("Divera API returned success=false")
        return out
    items = data.get("data", {}).get("items", {})
    if isinstance(items, dict):
        items = list(items.values())
    for item in items:
        if item.get("closed") or item.get("archived"):
            continue
        try:
            out.append(
                DiveraWebhookPayload(
                    id=int(item.get("id", 0)),
                    number=item.get("foreign_id") or item.get("number") or None,
                    title=item.get("title", ""),
                    text=item.get("text", ""),
                    address=item.get("address", ""),
                    lat=item.get("lat"),
                    lng=item.get("lng"),
                    ts_create=item.get("ts_create") or item.get("date"),
                    ts_update=item.get("ts_update"),
                )
            )
        except (ValueError, TypeError) as e:
            logger.warning("Failed to parse alarm: %s", e)
    out.sort(key=lambda a: a.ts_create or 0, reverse=True)
    return out


async def _incident_is_confirmed(db: AsyncSession, incident_id) -> bool:
    """True once an authenticated editor has actually opened the Einsatz.

    The line between «an incident exists» and «the station worked it». Nothing here may be
    overwritten by a late alerting-system edit after that point; before it, the pool row is
    just a mirror.
    """
    if incident_id is None:
        return False
    inc = await db.get(Incident, incident_id)
    return bool(inc and inc.editor_opened_at is not None)


async def upsert_emergency(db: AsyncSession, payload: DiveraWebhookPayload) -> DiveraEmergency | None:
    """Insert a new pool alarm or refresh an existing one if ts_update advanced.

    Returns the row if a *new* alarm was created, None for a known one (an update to a
    known alarm refreshes fields but is never a second alarm — dedupe by divera_id).
    """
    from .alarms import lock_alarm_identity  # lazy — alarms imports this module's classifiers

    await lock_alarm_identity(db, "divera", str(payload.id))
    values = {
        "divera_id": payload.id,
        "divera_number": payload.number,
        "title": payload.title or "(ohne Titel)",
        "text": payload.text,
        "address": payload.address,
        "lat": payload.lat,
        "lng": payload.lng,
        "ts_create": payload.ts_create,
        "ts_update": payload.ts_update,
        "raw_payload_json": payload.model_dump(),
    }
    inserted_id = (
        await db.execute(
            dialect_insert(db)(DiveraEmergency)
            .values(**values)
            .on_conflict_do_nothing(index_elements=["divera_id"])
            .returning(DiveraEmergency.id)
        )
    ).scalar_one_or_none()
    if inserted_id is not None:
        # Only the transaction that atomically claimed this Divera id may auto-open or push.
        return await db.get(DiveraEmergency, inserted_id)

    existing = (await db.execute(select(DiveraEmergency).where(DiveraEmergency.divera_id == payload.id))).scalar_one()

    # `is_taken` used to mean «a human decided to work this», which is why a taken row
    # was frozen against later Divera edits. Since alarms auto-open on arrival
    # (2026-08-02) every row is taken within seconds, and freezing on it would mean a
    # pool row could never be refreshed again — a corrected address from the dispatch
    # centre would simply never arrive. The question the guard actually wants to ask is
    # whether a person has worked the Einsatz, and `editor_opened_at` is what answers
    # that now. Until someone has, the mirror keeps mirroring.
    worked = await _incident_is_confirmed(db, existing.taken_incident_id)
    if payload.ts_update and (existing.ts_update or 0) < payload.ts_update and not worked:
        existing.title = payload.title or existing.title
        existing.text = payload.text
        existing.address = payload.address
        existing.lat = payload.lat
        existing.lng = payload.lng
        # ts_create is the alarm's birth time — an update never moves it, it only fills
        # it in for a row that arrived before the sender started sending it.
        existing.ts_create = existing.ts_create or payload.ts_create
        existing.ts_update = payload.ts_update
        existing.raw_payload_json = payload.model_dump()
    return None


async def open_emergency(db: AsyncSession, em: DiveraEmergency) -> Incident:
    """Turn a pool alarm into its incident and mark the row taken. No guards, no config.

    The single place a `DiveraEmergency` becomes an `Incident` without a human: the poller
    (via `maybe_auto_open`) and the Einsatz-Link exchange (via `alarms.open_pooled_alarm`)
    both land here, so an alarm opened down either path is byte-identical. The pool row is
    kept and marked taken — the intake history still shows every alarm that ever arrived.
    Callers own the *decision* to open (guards, dedupe); this function only executes it.
    """
    from .alarms import create_incident_from_alarm

    inc = await create_incident_from_alarm(
        db,
        source="divera",
        source_ref=str(em.divera_id),
        divera_id=em.divera_id,
        title=em.title,
        text=em.text,
        address=em.address,
        lat=float(em.lat) if em.lat is not None else None,
        lng=float(em.lng) if em.lng is not None else None,
        priority=infer_priority(em.title, em.text, vocab=await active_vocabulary()),
        # The alarm's own time, not this moment: auto-open can trail the alarm by a poll
        # interval, and the pool row may have been waiting far longer than that. (#75)
        started_at=alarm_time(em.ts_create),
        started_at_source="alarm",
    )
    em.is_taken = True
    em.taken_incident_id = inc.id
    await audit.append_event(
        db,
        incident_id=inc.id,
        op_type="divera.update",
        source="divera",
        user_id=None,
        payload={"divera_id": em.divera_id, "auto": True},
    )
    return inc


async def maybe_auto_open(db: AsyncSession, em: DiveraEmergency) -> Incident | None:
    """Open a NEW pool alarm into an incident. Unconditional — the split guard is the one no.

    An alarm becomes an Einsatz on arrival (decided 2026-08-02): a wizard between the crew
    and the Lage optimises for the record at the expense of the Einsatz, and it left every
    Einsatz-Link holder staring at «Einsatz nicht (mehr) verfügbar» until someone opened
    the alarm on a tablet. Correcting type/priority/position afterwards costs seconds.
    Incidents nobody attended are not silently counted: `editor_opened_at` stays NULL until
    an authenticated editor opens the workspace, and the stats export drops those.
    """
    # Split-dispatch guard — with the human take gone, this is now the ONLY thing standing
    # between a Nachalarm and a duplicate Einsatz. While an Einsatz is RUNNING (unarchived
    # incident started within the last few hours), a new alarm is far more likely a
    # re-dispatch of the same Einsatz (Nachalarm, reworded group SMS — 2026-07-15 Grenzweg 1)
    # than a concurrent second incident. Opening it would split the operational picture in
    # two and misroute the re-dispatch's GPS milestones (which follow `taken_incident_id`)
    # into a duplicate nobody has open. Hold it in the pool instead — the incoming-alarm
    # banner offers both open AND attach, and attach is what keeps the milestones together.
    # The 4h window matches the dispatch pipeline's active-alarm timeout; an older open
    # incident (unfinished rapport, days later) must not suppress a genuinely new alarm.
    cutoff = datetime.now(UTC) - timedelta(hours=4)
    running = (
        await db.execute(
            select(func.count())
            .select_from(Incident)
            .where(Incident.is_archived.is_(False), Incident.started_at > cutoff)
        )
    ).scalar_one()
    if running:
        logger.info(
            "Auto-open suppressed for Divera %s: %d running incident(s) — pooled for open/attach",
            em.divera_id,
            running,
        )
        return None
    return await open_emergency(db, em)


#: How long after a Divera alarm the poll keeps its fast (idle) cadence although an Einsatz now
#: runs: the crew answers «komme» / «komme nicht» in the first minutes, and at the running
#: cadence (120 s) the Anwesenheit's «Anrückend» would trail them by up to two minutes. Ten
#: minutes at 30 s instead of 120 s is ≤ 15 extra calls per alarm, from the server alone — the
#: devices still only read. After it, the running cadence applies as before.
RESPONSE_WINDOW_SECONDS = 10 * 60


async def response_window_open(db: AsyncSession, now: datetime) -> bool:
    """A Divera alarm went out within :data:`RESPONSE_WINDOW_SECONDS` — answers are arriving."""
    cutoff = int(now.timestamp()) - RESPONSE_WINDOW_SECONDS
    n = (
        await db.execute(select(func.count()).select_from(DiveraEmergency).where(DiveraEmergency.ts_create >= cutoff))
    ).scalar_one()
    return bool(n)


async def prune_responses(db: AsyncSession, now: datetime) -> int:
    """Clear stored Rückmeldungen nobody may read any more. Returns rows cleared.

    The answers say who said they would come to THIS Einsatz, and exist for that one purpose. So they go once the Einsatz is no longer open (closed, archived, or
    the incident deleted and the link nulled), and in any case
    :data:`divera_responses.RESPONSES_RETENTION_SECONDS` after the alarm (PRIVACY.md). The pool
    row itself — the alarm — stays: that is the intake history, and it is not personal.
    """
    from sqlalchemy import null, or_, update

    from .divera_responses import RESPONSES_RETENTION_SECONDS
    from .models import INCIDENT_ACTIVE_STATUSES

    cutoff_ts = int(now.timestamp()) - RESPONSES_RETENTION_SECONDS
    cutoff_dt = now - timedelta(seconds=RESPONSES_RETENTION_SECONDS)
    open_incidents = select(Incident.id).where(
        Incident.is_archived.is_(False), Incident.status.in_(INCIDENT_ACTIVE_STATUSES)
    )
    result = await db.execute(
        update(DiveraEmergency)
        .where(
            DiveraEmergency.responses_json.is_not(None),
            or_(
                DiveraEmergency.ts_create < cutoff_ts,
                DiveraEmergency.ts_create.is_(None) & (DiveraEmergency.received_at < cutoff_dt),
                DiveraEmergency.taken_incident_id.is_(None) & DiveraEmergency.is_taken.is_(True),
                DiveraEmergency.taken_incident_id.is_not(None)
                & DiveraEmergency.taken_incident_id.not_in(open_incidents),
            ),
        )
        # null(), not None: a JSON column renders a Python None as the JSON value 'null'
        .values(responses_json=null(), responses_at=None)
        .execution_options(synchronize_session=False)
    )
    # an UPDATE's result is a CursorResult; the plain Result type mypy sees has no rowcount
    return int(getattr(result, "rowcount", 0) or 0)


class DiveraApiError(Exception):
    """A Divera call failed, described WITHOUT the request URL.

    ⚠️ THE REASON THIS TYPE EXISTS. Divera authenticates with the key in the QUERY STRING
    (``?accesskey=…``); it takes it no other way, so the URL of every call this app makes to
    Divera *is* a secret. ``httpx.Response.raise_for_status`` renders that URL into its message:

        Client error '401 Unauthorized' for url '…/api/alarms?accesskey=<the key in plain text>'

    which went two places it must not. It reached any ``editor`` — a role BELOW the one the
    credential surface refuses — through the 502 body of ``POST /api/personnel/sync/preview``,
    and it reached the container log through ``scheduler._poll_divera``'s ``logger.exception``.
    Both matter more since the key became browser-settable: ``app/api/credentials`` promises an
    admin that a stored secret can never be read back, and ``app/credentials`` is built so that
    a stolen database dump yields nothing — a promise a log file undoes for free.

    So no Divera response is ever passed to ``raise_for_status``. :func:`check_response` is the
    single door, and it keeps the one thing worth keeping: the status code.
    """

    #: the HTTP status Divera answered with (None where the failure was not an answer)
    status_code: int | None = None


def check_response(response: httpx.Response) -> None:
    """``response.raise_for_status()`` minus the credential-bearing URL.

    Every outbound Divera call goes through this — see :class:`DiveraApiError` for why. The
    status code is the whole diagnosis anyway: 401/403 means the key is wrong or its scope
    changed, 429 means we are polling too hard, 5xx means Divera is having a day.
    """
    if response.is_success:
        return
    err = DiveraApiError(f"Divera antwortete mit HTTP {response.status_code}")
    # the code alone, as data — the scheduler backs off on 429 (scheduler · _poll_divera)
    err.status_code = response.status_code
    raise err


async def fetch_and_upsert(db: AsyncSession) -> int:
    """Poll Divera /alarms once and upsert into the pool. Returns new-alarm count."""
    if not credential("divera_access_key"):
        return 0
    url = f"{settings.divera_api_url}/alarms"
    # SSRF defence-in-depth: divera_api_url is config-driven (not user input), but pin it to
    # https so a mis-set value can't be aimed at an internal endpoint with our access key.
    if urlsplit(url).scheme != "https":
        logger.warning("Divera API URL is not https; skipping fetch")
        return 0
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(url, params={"accesskey": credential("divera_access_key")})
        check_response(r)
        data = r.json()
    # The Rückmeldungen ride in this same response. Their status NAMES come from /pull/all, and
    # that fetch (≤ once per 6 h) happens HERE — before the upserts take their per-alarm locks,
    # never while holding them.
    responses = parse_responses_by_alarm(data)
    used = {sid for answers in responses.values() for sid in answers.values()}
    catalogue = await ensure_catalogue(used) if used else cached_catalogue()
    new = 0
    for alarm in parse_alarms_response(data)[: settings.divera_poll_max_alarms]:
        em = await upsert_emergency(db, alarm)
        if em is not None:
            new += 1
            inc = await maybe_auto_open(db, em)
            await notify_new_alarm(
                db,
                tag=f"divera-{alarm.id}",
                title=alarm.title,
                address=alarm.address,
                target=None if inc else "divera",
            )
    await store_responses(db, responses, catalogue)
    return new


async def person_by_ucr(db: AsyncSession) -> dict[str, str]:
    """Divera user id → our personnel id, through the ``divera`` external identity the Mannschaft
    sync stores (and the deprecated ``personnel.divera_id`` for rows older than that table)."""
    from .models import Personnel, PersonnelExternalIdentity

    rows = await db.execute(
        select(PersonnelExternalIdentity.external_id, PersonnelExternalIdentity.personnel_id).where(
            PersonnelExternalIdentity.provider == "divera"
        )
    )
    out = {str(ext): str(pid) for ext, pid in rows.all()}
    legacy = await db.execute(select(Personnel.divera_id, Personnel.id).where(Personnel.divera_id.is_not(None)))
    for ucr, pid in legacy.all():
        out.setdefault(str(ucr), str(pid))
    return out


async def store_responses(db: AsyncSession, responses: dict[int, dict[str, str]], catalogue: dict | None) -> int:
    """Record each known alarm's yes/no (app/divera_responses). Returns rows changed.

    Only alarms already in the pool are touched — an answer to an alarm this station never took
    in has nowhere to be shown. A poll that saw nothing new writes nothing. An answer whose status
    nobody can classify yet (the names list not loaded) leaves what was stored before. Never
    raises: the answers are a convenience on top of the alarm intake, and must not be able to
    fail it.
    """
    if not responses:
        return 0
    from .personnel import load_divera_response_kinds

    try:
        # a SAVEPOINT: a failure here rolls back the answers only, never the alarms upserted above
        async with db.begin_nested():
            rows = (
                (await db.execute(select(DiveraEmergency).where(DiveraEmergency.divera_id.in_(list(responses)))))
                .scalars()
                .all()
            )
            if not rows:
                return 0
            overrides = await load_divera_response_kinds(db)
            roster = await person_by_ucr(db)
            now = datetime.now(UTC)
            changed = 0
            for em in rows:
                answers = responses[em.divera_id]
                if em.responses_json is not None and not resolvable(answers, catalogue, overrides):
                    continue
                blob = classify_answers(answers, catalogue, overrides, roster)
                if blob == em.responses_json:
                    continue
                em.responses_json = blob
                em.responses_at = now
                changed += 1
        return changed
    except Exception:  # noqa: BLE001 — see the docstring
        logger.warning("Storing Divera Rückmeldungen failed", exc_info=True)
        return 0
