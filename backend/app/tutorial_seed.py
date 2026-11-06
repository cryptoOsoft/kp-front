"""The «Lernen · <Modul>» Übung a tutorial runs on («Üben», 05.11.2026): its title and its scene.

`POST /api/incidents/lernen` (api/incidents · open_lern_uebung) creates the incident; this module
says what goes into it. ONE scene for every Einsatz tutorial (lead's call, Round 1): a Zimmerbrand
at the station's own `map.defaultView` centre, two Atemschutz-Trupps inside, the crew present,
three Verlauf rows, one Leitung and two symbols on the Lage. Modelled on
`demo_reset.build_demo_workspace`, but small and parameterised only by the station: its centre,
its roster (names when it has any, generic ones otherwise) and its first vehicle.

Rules the scene keeps, because the client's load gate and merge hold it to them:
- every id from `ids.new_id` (the client's `newId` shape), never a hand-rolled one;
- stamped `schemaVersion` = the client's `WORKSPACE_SCHEMA_VERSION` (src/lib/workspace.ts; a
  test pins the two), written as the legacy `entities`/`drawings` views — the loader unifies
  `objects` from them, as it does for the demo scene;
- no Plan board objects, so no kind outside `data/board_kinds.json` can ride in.
"""

import math
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .alarms import get_config_model
from .geo_util import lv95_to_wgs84
from .ids import new_id
from .models import Personnel
from .schemas import LernTutorial

#: What every Lern-Übung's title starts with — the door reuses an open Übung by it.
LERN_TITLE_PREFIX = "Lernen · "

#: id → German title (src/config/copy/de/tutorials.ts · titles, pinned by a test). The client
#: sends only the id; the title is the record's, so it is German like every Einsatz title.
TUTORIAL_TITLES: dict[LernTutorial, str] = {
    "lageZeichnen": "Karte – die Lage zeichnen",
    "planGebaeude": "Plan & Gebäude",
    "tafel": "Tafel",
    "checkliste": "Checkliste im Einsatz",
    "trupps": "Trupps",
    "notfall": "Atemschutznotfall",
    "anwesenheit": "Anwesenheit & Zeitplan",
    "material": "Material",
    "verlauf": "Verlauf",
    "rapport": "Rapport & Abschluss",
    "wiedergabe": "Wiedergabe, Offline, zweites Gerät",
}

#: The client's WORKSPACE_SCHEMA_VERSION (src/lib/workspace.ts), stamped into the seeded blob.
SEED_SCHEMA_VERSION = 3

#: Where the scene stands when the station has no map centre: the country centroid the client
#: falls back to as well (src/lib/daylight · FALLBACK_COORD).
FALLBACK_CENTRE = (8.2275, 46.8182)

#: How long the scene has been running when it opens — older than every seeded stamp below.
SCENE_ELAPSED_MIN = 15

#: Names for the Trupps when the roster has fewer than six people.
_GENERIC_CREW = ("Truppführer 1", "AdF 1", "AdF 2", "Truppführer 2", "AdF 3", "AdF 4")

_LEITUNG_BLUE = "#1f6feb"


def lern_title(tutorial: LernTutorial) -> str:
    return f"{LERN_TITLE_PREFIX}{TUTORIAL_TITLES[tutorial]}"


@dataclass(frozen=True)
class LernScene:
    """What the door writes: the Einsatzort, the workspace blob and the Verlauf rows (oldest first)."""

    lng: float
    lat: float
    started_at: datetime
    workspace: dict
    journal: list[dict]


def _iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _offset(centre: tuple[float, float], east_m: float, north_m: float) -> list[float]:
    """`centre` moved by metres — plenty exact over the few dozen metres of one scene."""
    lng, lat = centre
    return [lng + east_m / (111_320 * math.cos(math.radians(lat))), lat + north_m / 111_320]


def build_lern_scene(
    centre: tuple[float, float], people: list[tuple[str, str]], vehicle: str, now: datetime
) -> LernScene:
    """The scene around `centre` ([lng, lat]). `people` are up to six `(person_id, display_name)`
    roster entries — they crew the two Trupps and are the ones present; missing seats get generic
    names and no person id. `vehicle` labels the one vehicle symbol. Pure."""
    started = now - timedelta(minutes=SCENE_ELAPSED_MIN)
    seats: list[tuple[str | None, str]] = [*people[:6]]
    seats += [(None, name) for name in _GENERIC_CREW[len(seats) :]]

    fire_id, vehicle_id, line_id = new_id("p"), new_id("p"), new_id("d")
    fire_at = _offset(centre, 0, 0)
    vehicle_at = _offset(centre, -30, -25)
    entities = [
        {
            "id": fire_id,
            "kind": "symbol",
            "coord": fire_at,
            "label": "Zimmerbrand 1. OG",
            "layer": "taktisch",
            "fields": {},
            "symbol": "VKF Feuer",
            "subtitle": "Brandbekämpfung",
        },
        {
            "id": vehicle_id,
            "kind": "symbol",
            "coord": vehicle_at,
            "label": vehicle,
            "layer": "taktisch",
            "fields": {},
            "symbol": "VKF Fahrzeug",
        },
    ]

    trupps: list[dict] = []
    for no, (lead, a, b), entered, auftrag in (
        (1, seats[0:3], 10, "loeschen"),
        (2, seats[3:6], 6, "retten"),
    ):
        entry, contact = now - timedelta(minutes=entered), now - timedelta(minutes=2)
        trupp = {
            "id": new_id("trupp"),
            "no": no,
            "name": lead[1],
            "members": [a[1], b[1]],
            # compacted, like the form writes it (lib/personnel · the id array's ⚠️)
            "memberPersonIds": [pid for pid, _ in (a, b) if pid],
            "auftrag": auftrag,
            "ziel": "1. OG",
            "entryPressureBar": 300,
            "entryTime": _iso(entry),
            "lastContactTime": _iso(contact),
            "lastPressureBar": 250,
            "lastPressureTime": _iso(contact),
            "lowestBar": 250,
            "status": "aktiv",
            "readings": [
                {"t": _iso(entry), "bar": 300, "kind": "entry"},
                {"t": _iso(contact), "bar": 250, "kind": "pressure"},
            ],
        }
        if lead[0]:
            trupp["leaderPersonId"] = lead[0]
        trupps.append(trupp)
    # the first Trupp works the one Leitung, both ways round (types · Trupp.lineId / Drawing.truppId)
    trupps[0] |= {"lineNo": 1, "lineId": line_id}

    drawings = [
        {
            "id": line_id,
            "kind": "line",
            "color": _LEITUNG_BLUE,
            "width": 4,
            "coords": [vehicle_at, _offset(centre, -15, -5), fire_at],
            "dashed": False,
            "lineNo": 1,
            "truppId": trupps[0]["id"],
            "startAttachment": {"target": {"id": vehicle_id, "kind": "object"}, "routing": "direct"},
        }
    ]

    attendance = {
        pid: {"status": "present", "checkedInAt": _iso(started), "displayNameSnapshot": name}
        for pid, name in seats
        if pid
    }

    journal = [
        {
            "id": new_id("e"),
            "t": "",
            "at": _iso(now - timedelta(minutes=mins)),
            "icon": "type",
            "text": text,
            "kind": "journal",
            "surface": "map",
        }
        for mins, text in (
            (SCENE_ELAPSED_MIN, f"Alarmierung Zimmerbrand 1. OG, Ausrücken {vehicle}."),
            (11, f"Eintreffen {vehicle}. Rauch aus Fenster 1. OG."),
            (10, f"Trupp 1 ({seats[0][1]}) zur Brandbekämpfung 1. OG eingesetzt."),
        )
    ]

    workspace = {
        "schemaVersion": SEED_SCHEMA_VERSION,
        "entities": entities,
        "drawings": drawings,
        "trupps": trupps,
        "attendance": attendance,
    }
    return LernScene(lng=centre[0], lat=centre[1], started_at=started, workspace=workspace, journal=journal)


async def station_lern_scene(db: AsyncSession, now: datetime) -> LernScene:
    """`build_lern_scene` for this station: its map centre, the first six active roster people
    (by name, so two Übungen of one station look alike) and its first configured vehicle."""
    cfg = await get_config_model(db)
    view = cfg.map.defaultView
    if view.center and len(view.center) == 2:
        centre = (float(view.center[0]), float(view.center[1]))
    elif view.centerLv95 and len(view.centerLv95) == 2:
        lat, lng = lv95_to_wgs84(float(view.centerLv95[0]), float(view.centerLv95[1]))
        centre = (lng, lat)
    else:
        centre = FALLBACK_CENTRE
    rows = (
        await db.execute(
            select(Personnel.id, Personnel.display_name)
            .where(Personnel.is_active.is_(True))
            .order_by(Personnel.display_name)
            .limit(6)
        )
    ).all()
    vehicle = cfg.fleet.vehicles[0].label if cfg.fleet.vehicles else "TLF"
    return build_lern_scene(centre, [(str(pid), name) for pid, name in rows], vehicle, now)
