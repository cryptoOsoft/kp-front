"""Station plan-scale calibration and georeferencing — editor-authored, persists across
incidents/devices.

A plan sheet has no inherent geo scale, so measuring on it needs a calibration factor
(`mPerU` + aspect ratio). Because a station's plans all come from the same generator with the
same layout, one calibration usually fits every plan (the `default`), with per-plan overrides
(`byPlan`) for the exceptions. This is EDITOR data (any FU can set it in the field), stored on
the deployment_config singleton in its own `plan_scales_json` column — kept out of the
admin-validated config so an admin push never wipes it.

The same document also carries the per-plan GEOREFERENCE (`georefByPlan`): the landmark
point-pairs that tie a plan sheet to the map, from which the client fits a similarity transform
and mirrors symbols in both directions (src/lib/georef.ts). It lives here because it answers the
same kind of question as the calibration — a property of the SHEET, not of an incident — and so
that a client loads and caches both in one request.

GET needs a session — any account, the deployment admin or an Einsatz-Link (viewers measure
too). It is NOT public: `georefByPlan` says where every referenced building's sheet sits, and a
plan id carries the object's id. The client keeps its last answer in IndexedDB for offline boots.
PUT is editor-only.

Both answers carry a ``version`` — an opaque token of the STORED document, which the client
sends back as ``If-Match`` on its next PUT (see ``put_plan_scales``).
"""

# **The station document is version-guarded.** `PUT /api/plan-scales` is a whole-document
# replace and now carries `If-Match` — the same content-hash token and 409 as `PUT /api/config`
# — because a lost update no longer costs a re-measurable calibration but MOVES objects. The
# client recovers by re-reading and re-applying its per-plan change on top, once. A PUT without
# the header is still accepted for one release (there is no CLI writer here, and an old build
# must not lose the ability to save a Georeferenz in the field).

import hashlib
import json
import logging
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import CurrentEditor, UserOrAdmin
from ..database import get_db
from ..models import DeploymentConfig

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/plan-scales", tags=["plan-scales"])


AspectRatio = Annotated[float, Field(gt=0.01, lt=100)]
"""A sheet's width / height. Bounded generously — anything a printer can produce fits — but not
unbounded: 0 and a pixel count are the two ways this field is realistically wrong, and either one
would put every symbol on that plan somewhere else."""


class PlanScale(BaseModel):
    """Metres per aspect-corrected normalized unit + the reference/aspect it was derived at
    (mirrors src/lib/planScale.ts PlanScale)."""

    # camelCase mirrors the JSON wire format (src/lib/planScale.ts) — keep it verbatim
    mPerU: float = Field(gt=0)  # noqa: N815
    refM: float = Field(ge=0)  # noqa: N815
    ar: float = Field(gt=0)


class PlanPoint(BaseModel):
    """A point on the plan sheet, normalized 0..1 of the document box, y down — the same space
    plan annotations are stored in (src/types.ts BoardAnno.x/y).

    Bounded generously rather than exactly: a landmark may sit a hair outside the sheet, but a
    value of 1100 is plan PIXELS, and catching that here beats storing a georeference that puts
    every symbol in the North Sea."""

    x: float = Field(ge=-1, le=2)
    y: float = Field(ge=-1, le=2)


class LngLat(BaseModel):
    """WGS84 position with named fields (mirrors src/lib/georef.ts GeoPt) — a tuple here would
    make a swapped lng/lat indistinguishable from a valid one."""

    lng: float = Field(ge=-180, le=180)
    lat: float = Field(ge=-90, le=90)


class GeorefPair(BaseModel):
    """One landmark seen on both surfaces. `kind` records how it came to be ('gesetzt' = newly
    placed, 'korrigiert' = an existing reference re-tapped, 'auto' = derived from an accepted
    automatic alignment suggestion); it carries no weight in the fit."""

    plan: PlanPoint
    lngLat: LngLat  # noqa: N815
    kind: Literal["gesetzt", "korrigiert", "auto"] | None = None


class Georef(BaseModel):
    """A plan's georeference: the landmark pairs, nothing else. The transform itself is DERIVED
    (client-side, `fitSimilarity`) and deliberately not stored — the pairs are what the operator
    placed and can correct, and a stored matrix could only ever disagree with them."""

    pairs: list[GeorefPair] = Field(default_factory=list)


class PlanScales(BaseModel):
    """The station document: one default calibration + per-plan overrides (planId → scale), the
    per-plan georeference (planId → pairs) and the per-plan MEASURED aspect. Every field is
    optional, so a document stored before georeferencing existed still validates."""

    default: PlanScale | None = None
    byPlan: dict[str, PlanScale] = Field(default_factory=dict)  # noqa: N815
    georefByPlan: dict[str, Georef] = Field(default_factory=dict)  # noqa: N815
    # The sheet's measured width/height, written by a client that has actually rendered the bitmap
    # (src/lib/stationPlanScale.ts · noteMeasuredAspect). Deliberately NOT `PlanScale.ar`: that one
    # is half of a pair — the sheet's ground width is `ar · mPerU` — so correcting it inside a
    # stored calibration would silently rescale every measured distance on that plan. This says
    # only «the sheet is this shape», which is what the georeference fit has to be solved in.
    # Bounded to the range a sheet can plausibly have: a value of 1100 is plan PIXELS, not a ratio.
    measuredArByPlan: dict[str, AspectRatio] = Field(default_factory=dict)  # noqa: N815


class PlanScalesOut(PlanScales):
    """…as served: the document plus the token of the version it was read at. The client keeps it
    and sends it back as ``If-Match``; a body never carries it, so a client that read-modify-writes
    the served document cannot accidentally store one."""

    version: str


def _version(doc: object) -> str:
    """The version token of the stored document: a hash of its CONTENT.

    ⚠️ The same choice — and the same reasoning — as ``api/config._version``: a timestamp is
    stored to the second by SQLite and is transaction-start time in Postgres, so two saves inside
    one second are indistinguishable and the check passes exactly when a conflict is most likely.
    A hash needs no column, no migration and no clock, and it gives the right answer to the other
    case too: a second editor storing an IDENTICAL document is not a conflict, because nothing the
    caller holds is out of date.

    ⚠️ Taken over the RAW stored blob, not the tolerantly-parsed projection, so that GET and PUT
    compare the same thing. A document with one malformed entry is served without it, the client
    PUTs what it was served, and the write is still accepted — the token says «this is the row you
    read», which it is.
    """
    return hashlib.sha256(json.dumps(doc or {}, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:16]


def _entries[M: BaseModel](raw: object, model: type[M], field: str) -> dict[str, M]:
    """Validate a planId → entry map one entry at a time, keeping every entry that parses."""
    if not isinstance(raw, dict):
        if raw is not None:
            logger.warning("plan_scales_json: %s is not an object (%s); dropping it", field, type(raw).__name__)
        return {}
    out: dict[str, M] = {}
    for plan_id, value in raw.items():
        try:
            out[str(plan_id)] = model.model_validate(value)
        except ValidationError:
            logger.warning("plan_scales_json: dropping malformed %s entry %r", field, plan_id, exc_info=True)
    return out


def _ratios(raw: object) -> dict[str, float]:
    """…the same entry-wise tolerance for the plain-number map: one plan holding a 0 (or a pixel
    count) must not cost every other plan its measured shape."""
    if not isinstance(raw, dict):
        if raw is not None:
            logger.warning("plan_scales_json: measuredArByPlan is not an object (%s); dropping it", type(raw).__name__)
        return {}
    out: dict[str, float] = {}
    for plan_id, value in raw.items():
        if isinstance(value, (int, float)) and not isinstance(value, bool) and 0.01 < value < 100:
            out[str(plan_id)] = float(value)
        else:
            logger.warning("plan_scales_json: dropping implausible measuredArByPlan entry %r=%r", plan_id, value)
    return out


def _read_tolerantly(raw: object) -> PlanScales:
    """Parse the stored document entry by entry and drop ONLY what fails.

    Whole-document validation was fine while this held nothing but scales the app itself wrote.
    Georeferences changed that: the pairs are landmarks an operator taps, so one out-of-range
    value — or one plan still holding a pre-format entry — is a realistic single-plan defect. With
    all-or-nothing validation that one entry blanks the calibration of EVERY plan station-wide,
    at 3am, with the reason visible only in the server log. So a partially-valid document still
    serves each good entry, and the bad one is named in the log.
    """
    if not isinstance(raw, dict):
        logger.warning("plan_scales_json is not an object (%s); serving empty", type(raw).__name__)
        return PlanScales()
    default: PlanScale | None = None
    if raw.get("default") is not None:
        try:
            default = PlanScale.model_validate(raw["default"])
        except ValidationError:
            logger.warning("plan_scales_json: dropping malformed 'default' scale", exc_info=True)
    return PlanScales(
        default=default,
        byPlan=_entries(raw.get("byPlan"), PlanScale, "byPlan"),
        georefByPlan=_entries(raw.get("georefByPlan"), Georef, "georefByPlan"),
        measuredArByPlan=_ratios(raw.get("measuredArByPlan")),
    )


async def _row(db: AsyncSession) -> DeploymentConfig | None:
    return (await db.execute(select(DeploymentConfig).where(DeploymentConfig.id == 1))).scalar_one_or_none()


@router.get("", response_model=PlanScalesOut)
async def get_plan_scales(_caller: UserOrAdmin, db: AsyncSession = Depends(get_db)) -> PlanScalesOut:
    """Any session (viewers measure on plans too), never an anonymous caller — see the module
    docstring. Never raises on the stored document: whatever in the stored blob does not validate is dropped entry-wise, the rest
    is served — with the `version` the caller sends back as `If-Match` when it writes."""
    row = await _row(db)
    raw = row.plan_scales_json if (row and row.plan_scales_json) else {}
    return PlanScalesOut(**_read_tolerantly(raw).model_dump(), version=_version(raw))


@router.put("", response_model=PlanScalesOut)
async def put_plan_scales(
    body: PlanScales,
    _editor: CurrentEditor,
    db: AsyncSession = Depends(get_db),
    if_match: str | None = Header(default=None, alias="If-Match"),
) -> PlanScalesOut:
    """Editor-only. REPLACES the whole document — scales and georeferences alike — so the client
    must read-modify-write (src/lib/stationPlanScale.ts does; a body built from scratch drops the
    half it doesn't know about). Creates the singleton row if the station has no config row yet.

    ⚠️ ``If-Match`` carries the ``version`` the caller last read, and a stale one is refused with
    409 — the same guard, the same token and the same status as ``PUT /api/config`` (api/config ·
    put_config), because it is the same hazard: a full-document replace where the last writer wins.
    It became a REAL one with the unified tactical object. Until then a lost update cost a
    calibration somebody could re-measure; now the georeference is BAKED into every symbol standing
    on that sheet, so an overwritten reference silently moves objects on the Karte — and the
    Verlauf row that says so is written by the device that did the overwriting, not by the one
    whose correction was lost.

    ⚠️ A PUT WITHOUT the header is still accepted, deliberately, and this is where we differ from
    ``/api/config`` — which makes it mandatory for browsers on the grounds that the tab doing the
    damage is by definition an old one. The trade is the other way round here. There is no CLI
    writer to protect (this endpoint has exactly one client, src/lib/stationPlanScale.ts), the
    damage a stale write does is one sheet's calibration rather than the station's whole
    configuration, and refusing an old build would mean a Georeferenz that cannot be saved at all
    in the field, on a device the operator cannot reload mid-Einsatz. So the window stays open for
    one release: every answer carries the `version`, the current client sends it back, and the
    header can be made mandatory once no build without it is in use.

    ⚠️ …and that condition is OBSERVED rather than assumed. Every headerless PUT logs one INFO
    line, so «is any build without it still writing» is a question the deployment's own log
    answers. An empty result over a release cycle is the go-ahead to make the header mandatory
    here (and to drop this paragraph); a line a week says an old tablet is still in the field, and
    closing the window would take its Georeferenz away.
    """
    row = await _row(db)
    stored_version = _version(row.plan_scales_json if row else None)
    if if_match is None:
        logger.info("plan-scales PUT without If-Match — a client older than the concurrency guard is still writing")
    elif if_match.strip('"') != stored_version:
        raise HTTPException(
            status_code=409,
            detail="Die Plan-Kalibrierung wurde inzwischen an anderer Stelle geändert.",
            headers={"ETag": stored_version},
        )
    doc = body.model_dump(mode="json")
    if row is None:
        row = DeploymentConfig(id=1, plan_scales_json=doc)
        db.add(row)
    else:
        row.plan_scales_json = doc
    await db.commit()
    return PlanScalesOut(**body.model_dump(), version=_version(doc))
