"""Weather at an active Einsatz, observed ONCE, by the server — and the wind shift it implies.

Why server-side (24.09.2026, post-mortem of the Feueralarm-Übung on 23.09.2026, D2 item 27):
every open device polled `/api/weather` and emitted a `weather.observe` audit event per new
reading, so one reading entered the record once per device (×1–5), and not at all while every
screen was asleep. The replay reads these events to show the wind as it stood at any instant
(`src/lib/replay · stateAt`), so the record needs exactly one per reading, whoever is looking.

The scheduler now observes every ``WEATHER_OBSERVE_SECONDS`` per ACTIVE Einsatz
(`vehicle_presence.active_incidents`: open, not a Lern-Übung, started within 24 h, real
coordinate), and writes ONE event under the derived id ``wx:<incident>:<observed_at>`` in the
shape the client emitted — ``weather.observe`` with ``{"weather": WeatherData}`` — so the replay
reads it unchanged. The same reading seen again (MeteoSwiss publishes every 10 min, the job
can tick between) is the same id and writes nothing. The client's emit is gone; an older
build's copy is dropped at the ingest endpoint (`api/events · SERVER_OBSERVED_OPS`).

Wind shift (D2-c): each observation is compared with the ESTABLISHED wind. A turn of at least
``WIND_SHIFT_DEG`` at ``WIND_SHIFT_MIN_KMH`` or more, held over two consecutive observations on
the same side, from the same source and station, writes ONE Verlauf row «Wind dreht: W → NO
(286° → 66°) · Lüfter prüfen» under a derived id (``wxd-<observed_at>`` of the confirming
reading) — the devices show it once in their Meldeleiste (`src/components/WindShiftMeldung`),
timed from the row's `writtenAt`. The fold is pure over the whole series of readings, so a
restart or a second worker computes the same shift and the same id.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

#: How often the weather at an active Einsatz is observed (MeteoSwiss publishes every 10 min).
WEATHER_OBSERVE_SECONDS = 600
#: A turn at least this large is a shift…
WIND_SHIFT_DEG = 45.0
#: …if the wind blows at least this hard, before and after (a calm wind's direction is noise).
WIND_SHIFT_MIN_KMH = 10.0

OP_TYPE = "weather.observe"
EVENT_SOURCE = "weather"
SHIFT_ROW_PREFIX = "wxd-"

#: The 8-point compass in the words the app already shows (`copy.weather.cardinals`, de).
CARDINALS = ("N", "NO", "O", "SO", "S", "SW", "W", "NW")


def cardinal(deg: float) -> str:
    return CARDINALS[int(((deg % 360) + 22.5) // 45) % 8]


def turn(a: float, b: float) -> float:
    """The smaller angle between two bearings, 0–180."""
    d = abs((b - a) % 360)
    return 360 - d if d > 180 else d


def signed_turn(a: float, b: float) -> float:
    """The turn from `a` to `b`, −180 < x ≤ 180 (positive = clockwise, veering)."""
    d = (b - a) % 360
    return d - 360 if d > 180 else d


def event_id(incident_id: uuid.UUID | str, observed_at: str) -> str:
    return f"wx:{incident_id}:{observed_at}"


def shift_row_id(observed_at: str) -> str:
    # the observation's own clock, digits only: stable, sortable, and unique per reading
    return SHIFT_ROW_PREFIX + "".join(c for c in observed_at if c.isdigit())[:12]


@dataclass(frozen=True)
class Reading:
    observed_at: str
    dir_deg: float | None
    speed_kmh: float | None
    #: where it came from — MeteoSwiss station or the Open-Meteo point; readings from two
    #: sources are two instruments, and their difference is not the wind turning
    source: str | None = None
    station: str | None = None


@dataclass(frozen=True)
class Shift:
    from_deg: float
    to_deg: float
    observed_at: str

    def text(self) -> str:
        return (
            f"Wind dreht: {cardinal(self.from_deg)} → {cardinal(self.to_deg)} "
            f"({round(self.from_deg) % 360}° → {round(self.to_deg) % 360}°) · Lüfter prüfen"
        )


def _blowing(r: Reading) -> bool:
    return r.dir_deg is not None and r.speed_kmh is not None and r.speed_kmh >= WIND_SHIFT_MIN_KMH


def wind_shifts(readings: list[Reading]) -> list[Shift]:
    """Every confirmed shift in a series of readings (oldest first, one per observation).

    The ESTABLISHED direction is the first blowing reading, then whatever a shift confirmed. A
    blowing reading ≥ ``WIND_SHIFT_DEG`` away from it is a CANDIDATE; the next reading confirms
    it if it, too, blows, stands ≥ ``WIND_SHIFT_DEG`` away from the established direction AND
    on the SAME SIDE of it (veered both times, or backed both times — two readings flung to
    opposite sides are scatter, not a wind that has turned), and the shift goes to that second
    reading's direction. Anything else (back inside, or calm) drops the candidate. A slow veer
    therefore still reports once it has turned far enough, and a single gust never does.

    Only readings from ONE instrument are compared: when the source or the station changes
    (MeteoSwiss failed over to Open-Meteo, a nearer station started reporting), the comparison
    starts again from the new instrument's first reading.
    """
    out: list[Shift] = []
    established: float | None = None
    candidate: Reading | None = None
    instrument: tuple[str | None, str | None] | None = None
    for r in readings:
        if (r.source, r.station) != instrument:
            instrument, established, candidate = (r.source, r.station), None, None
        if not _blowing(r) or r.dir_deg is None:
            candidate = None
            continue
        if established is None:
            established = r.dir_deg
            continue
        if turn(established, r.dir_deg) < WIND_SHIFT_DEG:
            candidate = None
            continue
        if candidate is None or candidate.dir_deg is None:
            candidate = r
            continue
        if (signed_turn(established, candidate.dir_deg) > 0) != (signed_turn(established, r.dir_deg) > 0):
            candidate = r  # the other side: this reading is the new candidate, not a confirmation
            continue
        out.append(Shift(from_deg=established, to_deg=r.dir_deg, observed_at=r.observed_at))
        established = r.dir_deg
        candidate = None
    return out


async def _readings(db: AsyncSession, incident_id: uuid.UUID) -> list[Reading]:
    """Every distinct reading this Einsatz has recorded — the server's and, from before this
    change, the devices' (the same reading once, by `observed_at`) — oldest first."""
    from .models import IncidentEvent

    payloads = (
        await db.execute(
            select(IncidentEvent.payload_json)
            .where(IncidentEvent.incident_id == incident_id, IncidentEvent.op_type == OP_TYPE)
            .order_by(IncidentEvent.seq.asc())
        )
    ).scalars()
    seen: dict[str, Reading] = {}
    for p in payloads:
        w = (p or {}).get("weather") if isinstance(p, dict) else None
        if not isinstance(w, dict) or not isinstance(w.get("observed_at"), str):
            continue
        at = w["observed_at"]
        if at in seen:
            continue
        seen[at] = Reading(
            observed_at=at,
            dir_deg=float(w["wind_dir_deg"]) if isinstance(w.get("wind_dir_deg"), int | float) else None,
            speed_kmh=float(w["wind_speed_kmh"]) if isinstance(w.get("wind_speed_kmh"), int | float) else None,
            source=w.get("source") if isinstance(w.get("source"), str) else None,
            station=w.get("station") if isinstance(w.get("station"), str) else None,
        )
    return sorted(seen.values(), key=lambda r: _parse(r.observed_at))


def _parse(raw: str) -> datetime:
    """Sort key for an `observed_at`. Open-Meteo's is naive (read as UTC, which it is asked
    for); an unparseable one sorts first rather than breaking the fold."""
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return datetime.min.replace(tzinfo=UTC)
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


async def observe_weather(db: AsyncSession, now: datetime) -> int:
    """One tick: one reading per active Einsatz, and the wind-shift row it confirms.
    Returns the number of records written. The caller commits."""
    from . import audit
    from .api.journal import append_rows
    from .models import IncidentEvent
    from .vehicle_presence import active_incidents
    from .weather import weather_client

    written = 0
    # id order, like the presence sweep — both hold incident row locks until their commit
    for inc in await active_incidents(db, now):
        # `fresh`: past the 10-min request cache — a reading already 10 min old in the cache,
        # behind MeteoSwiss' own publishing lag, would reach the Verlauf 20–30 min late
        data = await weather_client.get_weather(inc.lat, inc.lng, fresh=True)
        if data is None or not data.observed_at:
            continue
        cid = event_id(inc.id, data.observed_at)
        # the same reading again (the provider has not published a new one) — nothing new.
        # Checked BEFORE the append: the payload of one reading can still differ in its
        # best-effort enrichment (the WMO code), and append_event would call that a conflict.
        exists = (
            await db.execute(
                select(IncidentEvent.id).where(IncidentEvent.incident_id == inc.id, IncidentEvent.client_id == cid)
            )
        ).first()
        if exists is not None:
            continue
        await audit.append_event(
            db,
            incident_id=inc.id,
            op_type=OP_TYPE,
            source=EVENT_SOURCE,
            payload={"weather": data.model_dump()},
            # the moment it was observed BY US, like the client's emit — the replay folds events
            # in seq order and breaks at the first one past its cursor, so an occurred_at older
            # than its neighbours would hide it
            occurred_at=now,
            client_id=cid,
        )
        written += 1
        shifts = wind_shifts(await _readings(db, inc.id))
        last = shifts[-1] if shifts else None
        if last is not None and last.observed_at == data.observed_at:
            row = {
                "id": shift_row_id(last.observed_at),
                "t": "",
                "at": _parse(last.observed_at).isoformat(),
                # when the row was WRITTEN — the Meldeleiste times its «is this news» from here,
                # not from `at` (the reading's own time, often 20–30 min old on arrival)
                "writtenAt": now.isoformat(),
                "icon": "wind",
                "text": last.text(),
            }
            if await append_rows(db, inc.id, [row]):
                written += 1
                logger.info("Wind shift at %s: %s", inc.id, last.text())
    return written
