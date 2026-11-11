"""Einsatz-Ablage – the admin API, ``/api/admin/incident-archive`` (admin session only).

The status per Einsatz the Verwaltung's «Einsätze» list shows («abgelegt», «ausstehend»,
«Fehler: …») and «Erneut versuchen» / «Ablegen». Contract: docs/incident-archive.md «Admin».
"""

import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import incident_archive
from ..auth.dependencies import CurrentAdmin
from ..database import get_db
from ..models import IncidentArchiveDelivery

router = APIRouter(prefix="/admin/incident-archive", tags=["admin-incident-archive"])


class IncidentArchiveRow(BaseModel):
    """One Einsatz at one destination – what the «Ablage» column shows."""

    incidentId: str  # noqa: N815 – the contract's field names
    destination: str
    state: Literal["pending", "delivered", "failed", "paused"]
    attempts: int
    nextAttemptAt: str | None  # noqa: N815
    lastError: str | None  # noqa: N815
    deliveredAt: str | None  # noqa: N815
    #: the folders chosen for it, below the library (photos, report)
    folders: list[str]
    reportVersions: int  # noqa: N815
    filedMedia: int  # noqa: N815


class IncidentArchiveStatus(BaseModel):
    #: the Ablage is on and has an active destination
    enabled: bool
    deliveries: list[IncidentArchiveRow]


class IncidentArchiveRetried(BaseModel):
    retried: int


class RetryIn(BaseModel):
    #: one Einsatz; absent = every failed row
    incidentId: uuid.UUID | None = None  # noqa: N815 – the contract's field name


@router.get("", response_model=IncidentArchiveStatus)
async def archive_status(_admin: CurrentAdmin, db: AsyncSession = Depends(get_db)) -> IncidentArchiveStatus:
    """``{enabled, deliveries: [{incidentId, destination, state, …}]}`` – newest change first."""
    cfg = await incident_archive.archive_config(db)
    rows = (
        (
            await db.execute(
                select(IncidentArchiveDelivery).order_by(IncidentArchiveDelivery.updated_at.desc()).limit(2000)
            )
        )
        .scalars()
        .all()
    )
    return IncidentArchiveStatus(
        enabled=bool(incident_archive.active(cfg)),
        deliveries=[IncidentArchiveRow.model_validate(incident_archive.status_row(r)) for r in rows],
    )


@router.post("/retry", response_model=IncidentArchiveRetried)
async def archive_retry(
    _admin: CurrentAdmin, body: RetryIn, db: AsyncSession = Depends(get_db)
) -> IncidentArchiveRetried:
    """«Erneut versuchen» (failed → pending) – and «Ablegen» for a closed Einsatz with no row yet."""
    if not incident_archive.active(await incident_archive.archive_config(db)):
        raise HTTPException(status_code=409, detail="Einsatz-Ablage ist nicht eingeschaltet")
    return IncidentArchiveRetried(retried=await incident_archive.retry(db, body.incidentId, datetime.now(UTC)))
