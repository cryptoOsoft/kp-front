"""Batch E — editor-only system/maintenance status (GET /api/system).

A single read-only endpoint backing the admin "System" tab: build/version, a trivial
DB liveness probe, row counts, media-storage + disk usage, and the env-derived
integration flags (handy on the same screen).

Resilience is the contract: this endpoint must NEVER 500. Each sub-section is computed
defensively — a failing probe yields a null/error section while the rest still render.
There is no new schema class; the response is a plain dict (docs/CONFIGURATION.md is the
source of truth for the config document, not this status payload).
"""

import logging
import os
import shutil
import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import CurrentAdmin
from ..auth.pin_limiter import new_device_budget
from ..config import settings
from ..credentials import get as credential
from ..credentials import load as load_credentials
from ..database import get_db
from ..models import Incident, Personnel, ReferenceDataset, User
from ..providers import integrations as provider_integrations

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/system", tags=["system"])


def _version() -> dict:
    """Release version + build stamp.

    `release` is the tagged version this image was published as (the number in the release
    notes / the KP_FRONT_TAG a self-hoster pins). `commit` and `built_at` come from the build
    args baked into the image (`settings.build`), falling back to Railway's injected git env
    vars — they are what tells a from-source build of `main` apart from a published image of
    the same release, which both otherwise report as the same three digits. `branch` is
    Railway-only and stays null elsewhere.
    """
    return {
        **settings.build,
        "branch": os.getenv("RAILWAY_GIT_BRANCH") or None,
        "env": "production" if settings.is_production else "dev",
    }


async def _database_ok(db: AsyncSession) -> dict:
    """Trivial liveness probe; any failure → ok:false (never raises)."""
    try:
        await db.execute(text("SELECT 1"))
        return {"ok": True}
    except Exception:  # noqa: BLE001
        logger.warning("system: SELECT 1 probe failed", exc_info=True)
        return {"ok": False}


async def _count(db: AsyncSession, stmt) -> int | None:
    """Run a COUNT, returning None on failure so one bad query can't sink the section."""
    try:
        return int((await db.execute(stmt)).scalar_one())
    except Exception:  # noqa: BLE001
        logger.warning("system: count query failed", exc_info=True)
        return None


async def _counts(db: AsyncSession) -> dict:
    return {
        "incidents": await _count(db, select(func.count()).select_from(Incident)),
        "incidents_open": await _count(
            db,
            select(func.count()).select_from(Incident).where(Incident.is_archived.is_(False)),
        ),
        "personnel_active": await _count(
            db,
            select(func.count()).select_from(Personnel).where(Personnel.is_active.is_(True)),
        ),
        "users": await _count(db, select(func.count()).select_from(User)),
        "reference_datasets": await _count(db, select(func.count()).select_from(ReferenceDataset)),
    }


def _storage() -> dict:
    """Walk the media dir summing file sizes + count, plus disk total/free.

    Never reads file contents. A missing dir reports zeros for used/count but still
    tries disk_usage on the nearest existing parent so the disk bar stays meaningful.
    """
    media_dir = os.path.abspath(settings.media_storage_dir)
    used_bytes = 0
    file_count = 0
    if os.path.isdir(media_dir):
        for dirpath, _dirnames, filenames in os.walk(media_dir):
            for name in filenames:
                fp = os.path.join(dirpath, name)
                try:
                    used_bytes += os.path.getsize(fp)
                    file_count += 1
                except OSError:
                    continue  # broken symlink / vanished file — skip

    disk_total_bytes: int | None = None
    disk_free_bytes: int | None = None
    # disk_usage needs an existing path; climb to the nearest existing ancestor.
    probe = media_dir
    while probe and not os.path.exists(probe):
        parent = os.path.dirname(probe)
        if parent == probe:
            break
        probe = parent
    try:
        usage = shutil.disk_usage(probe or os.sep)
        disk_total_bytes = usage.total
        disk_free_bytes = usage.free
    except OSError:
        logger.warning("system: disk_usage failed for %s", probe, exc_info=True)

    return {
        "media_dir": media_dir,
        "used_bytes": used_bytes,
        "file_count": file_count,
        "disk_total_bytes": disk_total_bytes,
        "disk_free_bytes": disk_free_bytes,
    }


#: The keys every connector row carries, whether or not that connector records health.
#:
#: ⚠️ A row without them would not read as «nothing to report», it would read as «this build
#: does not know» — and a reader cannot tell those two apart. So they are always present and
#: null where unknown, the same rule `monitoring.heartbeatConfigured` is on.
_NO_HEALTH = {"lastAttempt": None, "lastSuccess": None, "lastError": None, "counts": None}


def _polling_connector(cid: str, *, configured: bool, health: dict) -> dict:
    """One row for a connector that POLLS — the four that record into `connector_states`.

    ⚠️ `state` is derived from the last outcome and nothing else: 'offline' the moment an
    attempt failed, 'online' while the last one worked, null for a connector that has never
    run. Deliberately NO staleness window here — «the last success was in June» is a judgement
    about how often this station expects the connector to fire, and the two timestamps are
    served precisely so the surface can make it. A window invented in the backend would either
    call a quiet Traccar dead or call a dead Divera fine.
    """
    state = None
    if configured:
        state = "offline" if health["lastError"] else ("online" if health["lastSuccess"] else None)
    return {"id": cid, "direction": "in", "configured": configured, "state": state, "detail": None} | health


async def _connectors(db: AsyncSession) -> list[dict]:
    """Every consumer/producer this deployment talks to, read-only — one row each for the
    admin System card. Direction is from the backend's point of view: 'in' = something
    sends/fetches data into us (webhooks, QR capture, stats pull, print agent, the Divera and
    Traccar polls), 'out' = we push/call an external service (web push, STT).

    The three POLLING connectors carry health as well as configuration: when they last tried,
    when they last actually worked, and why they did not. That pair is the point — «Divera ist
    konfiguriert» is the same sentence on a station whose key was rotated two years ago, and
    the silent death is the failure this card exists for. The provider registry above still
    answers the other question (which provider serves which domain) and is not repeated here.
    """
    from .. import connector_state
    from ..models import DeploymentConfig
    from ..push import push_enabled
    from ..traccar import traccar_client
    from .print_relay import relay_status

    await load_credentials(db)
    row = (await db.execute(select(DeploymentConfig).where(DeploymentConfig.id == 1))).scalar_one_or_none()
    health = await connector_state.states(db)

    relay = relay_status()
    return [
        _polling_connector(
            connector_state.DIVERA_ALARMS,
            # The poll key OR the webhook secret: either one on its own is a working intake.
            configured=bool(credential("divera_access_key") or credential("divera_webhook_secret")),
            health=health[connector_state.DIVERA_ALARMS],
        ),
        _polling_connector(
            connector_state.TRACCAR,
            configured=traccar_client.is_configured,
            health=health[connector_state.TRACCAR],
        ),
        _polling_connector(
            connector_state.DIVERA_PERSONNEL,
            configured=bool(credential("divera_personnel_access_key") or credential("divera_access_key")),
            health=health[connector_state.DIVERA_PERSONNEL],
        ),
        _polling_connector(
            connector_state.ROSTER_SNAPSHOT,
            configured=bool(credential("station_index_source") or credential("roster_snapshot_source")),
            health=health[connector_state.ROSTER_SNAPSHOT],
        ),
        {
            "id": "print_relay",
            "direction": "in",
            "configured": relay["configured"],
            "state": ("online" if relay["online"] else "offline") if relay["configured"] else None,
            "detail": relay["last_seen"],
            **_NO_HEALTH,
        },
        {
            "id": "capture",
            "direction": "in",
            "configured": bool(row and row.capture_secret),
            "state": None,
            "detail": None,
            **_NO_HEALTH,
        },
        {
            "id": "stats",
            "direction": "in",
            "configured": bool(row and row.stats_secret),
            "state": None,
            "detail": None,
            **_NO_HEALTH,
        },
        {
            "id": "divera_webhook",
            "direction": "in",
            "configured": bool(credential("divera_webhook_secret")),
            "state": None,
            "detail": None,
            **_NO_HEALTH,
        },
        {
            "id": "alarm_webhook",
            "direction": "in",
            "configured": bool(credential("alarm_webhook_secret")),
            "state": None,
            "detail": None,
            **_NO_HEALTH,
        },
        {
            "id": "push",
            "direction": "out",
            "configured": push_enabled(),
            "state": None,
            "detail": None,
            **_NO_HEALTH,
        },
        {
            "id": "stt",
            "direction": "out",
            "configured": bool(credential("stt_base_url")),
            "state": None,
            "detail": credential("stt_base_url") or None,
            **_NO_HEALTH,
        },
    ]


#: The «Einrichtung» rows, in the order the card shows them. Ids are a CONTRACT with
#: src/admin/SetupChecklist.tsx — an id changed on one side is a row that silently stops
#: ticking on the other.
SETUP_ROWS = ("name", "map", "logo", "users", "personnel", "fleet", "geocoder", "sharepoint", "monitoring")


def _pair(value: object) -> bool:
    """A map centre as either CRS stores it: exactly two numbers, and not a bool."""
    return (
        isinstance(value, list)
        and len(value) == 2
        and all(isinstance(n, int | float) and not isinstance(n, bool) for n in value)
    )


async def _setup(db: AsyncSession, counts: dict | None) -> dict:
    """What a fresh instance still needs — derived HERE rather than in the browser.

    The «Einrichtung» card has always computed these nine predicates client-side out of
    `/api/config` + `/api/system` + `/api/sharepoint/status`. Deriving them server-side makes the
    same answer available to anything that is not that card — a deployment check, the CLI, an
    operator asking «is this station set up» without opening a browser — and it puts the rule in
    one place, where the two copies cannot drift.

    Three things are deliberately separate in the output, because folding them loses information:

    * ``done`` is what the station's own data SAYS. Derived, never hand-set.
    * ``acknowledged`` is the hand ticks (``setup.acknowledged`` in the config document). The
      escape hatch for a row whose fact this product cannot observe — a Wehr happy with the
      built-in vehicle catalogue never writes ``fleet.vehicles``, so «Fahrzeuge» could otherwise
      never tick.
    * ``complete`` folds the two, and is the question «does this card still have anything to
      say»: false while any row is neither done nor acknowledged.

    ⚠️ Each predicate mirrors SetupChecklist.tsx exactly, including the parts that look wrong
    until you read why: ``users`` wants MORE than one (a fresh deployment always has the one
    seeded account, so «> 0» would tick on day zero), ``map`` accepts a centre in EITHER CRS
    (they are mutually exclusive, and LV95 is the Swiss default this product is built for), and
    ``geocoder`` is done on EITHER field (the locality alone already keeps the search at home).
    """
    from ..models import DeploymentConfig
    from ..sharepoint_sync import sharepoint_status

    row = (await db.execute(select(DeploymentConfig).where(DeploymentConfig.id == 1))).scalar_one_or_none()
    cfg = (row.config_json if row else None) or {}
    identity = cfg.get("identity") or {}
    map_cfg = cfg.get("map") or {}
    view = map_cfg.get("defaultView") or {}
    geocoder = map_cfg.get("geocoder") or {}
    users = (counts or {}).get("users") or 0
    personnel_active = (counts or {}).get("personnel_active") or 0
    try:
        sharepoint_configured = bool((await sharepoint_status(db)).get("configured"))
    except Exception:  # noqa: BLE001 — one unreadable connector must not sink the whole card
        logger.warning("system: SharePoint setup row failed", exc_info=True)
        sharepoint_configured = False

    done = {
        "name": bool((identity.get("appName") or "").strip()),
        "map": _pair(view.get("center")) or _pair(view.get("centerLv95")),
        "logo": bool((identity.get("assets") or {}).get("logo")),
        "users": users > 1,
        "personnel": personnel_active > 0,
        "fleet": len((cfg.get("fleet") or {}).get("vehicles") or []) > 0,
        "geocoder": bool((geocoder.get("defaultLocality") or "").strip())
        or bool((geocoder.get("bboxLv95") or "").strip()),
        "sharepoint": sharepoint_configured,
        "monitoring": bool(credential("healthcheck_ping_url").strip()),
    }
    acknowledged = [k for k in ((cfg.get("setup") or {}).get("acknowledged") or []) if isinstance(k, str)]
    return {
        "rows": [{"id": key, "done": done[key]} for key in SETUP_ROWS],
        "acknowledged": acknowledged,
        "complete": all(done[key] or key in acknowledged for key in SETUP_ROWS),
    }


async def _login_locks(db: AsyncSession) -> list[dict]:
    """The live new-device locks, by name. A claimed id that is no account is left out: anyone
    can make the limiter track an invented one."""
    locked = new_device_budget.locked()
    if not locked:
        return []
    ids = [uuid.UUID(account) for account in locked]  # the login body's id is a validated UUID
    users = (await db.execute(select(User.id, User.display_name).where(User.id.in_(ids)))).all()
    return [
        {"userId": str(user_id), "displayName": name, "minutesLeft": max(1, round(locked[str(user_id)] / 60))}
        for user_id, name in users
    ]


@router.get("")
async def get_system(
    _admin: CurrentAdmin,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Admin-only maintenance/status snapshot. Resilient: each section is guarded
    so a partial failure returns that section as null/error and the rest fine.
    """
    try:
        version = _version()
    except Exception:  # noqa: BLE001
        logger.warning("system: version section failed", exc_info=True)
        version = None

    database = await _database_ok(db)

    try:
        counts = await _counts(db)
    except Exception:  # noqa: BLE001
        logger.warning("system: counts section failed", exc_info=True)
        counts = None

    try:
        storage = _storage()
    except Exception:  # noqa: BLE001
        logger.warning("system: storage section failed", exc_info=True)
        storage = None

    try:
        await load_credentials(db)
        integrations = provider_integrations().model_dump()
    except Exception:  # noqa: BLE001
        logger.warning("system: integrations section failed", exc_info=True)
        integrations = None

    try:
        connectors = await _connectors(db)
    except Exception:  # noqa: BLE001
        logger.warning("system: connectors section failed", exc_info=True)
        connectors = None

    try:
        setup = await _setup(db, counts)
    except Exception:  # noqa: BLE001
        logger.warning("system: setup section failed", exc_info=True)
        setup = None

    return {
        "version": version,
        "database": database,
        "counts": counts,
        "storage": storage,
        "integrations": integrations,
        "connectors": connectors,
        # The «Einrichtung» predicates, derived server-side — see `_setup`. On this endpoint
        # rather than on a route of its own because every fact it needs is already fetched here
        # and the card that reads it is already on this page: a second admin endpoint would be a
        # second round-trip for a copy of the same snapshot.
        "setup": setup,
        # Whether this deployment can tell anybody it has died. A BOOLEAN, never the URL: the
        # ping address is a write endpoint for the monitor, and anyone holding it can keep the
        # monitor believing a dead station is alive — so it stays write-only even though the
        # admin UI can now SET it (Anbindungen · Monitor). See scheduler · _heartbeat.
        "monitoring": {"heartbeatConfigured": bool(credential("healthcheck_ping_url").strip())},
        # Accounts whose PIN somebody is guessing at: new devices are refused for them right now
        # (auth/pin_limiter · NewDeviceBudget). Empty on every ordinary day.
        "loginLocks": await _login_locks(db),
    }
