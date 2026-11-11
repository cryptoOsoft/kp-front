"""the Einsatz-Ablage: outbox rows and the kept Rapport-PDF copy

Revision ID: c4e8a2f6d0b1
Revises: a7c1e3f5b9d2
Create Date: 2026-11-11 12:00:00.000000

Two new tables for docs/incident-archive.md: `incident_archive_deliveries` (one outbox row per
Einsatz and destination, the Objektbesuche delivery's shape) and `incident_archive_reports`
(the newest composed Rapport-PDF per Einsatz, its bytes in storage). Both start empty and are
written only while `incidentArchive.enabled` is on; both go with their Einsatz (CASCADE).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

revision: str = "c4e8a2f6d0b1"
down_revision: str | None = "a7c1e3f5b9d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "incident_archive_deliveries",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("destination", sa.String(length=64), nullable=False),
        sa.Column("incident_id", UUID(as_uuid=True), sa.ForeignKey("incidents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("wanted", sa.Integer(), nullable=False),
        sa.Column("state", sa.String(length=16), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lease_owner", sa.Text(), nullable=True),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("failed_fingerprint", sa.Text(), nullable=True),
        sa.Column("remote_items", JSONB(), nullable=False),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("destination", "incident_id", name="uq_incident_archive_deliveries_dest_incident"),
    )
    op.create_index("ix_incident_archive_deliveries_incident_id", "incident_archive_deliveries", ["incident_id"])
    op.create_index("ix_incident_archive_deliveries_due", "incident_archive_deliveries", ["state", "next_attempt_at"])
    op.create_table(
        "incident_archive_reports",
        sa.Column(
            "incident_id",
            UUID(as_uuid=True),
            sa.ForeignKey("incidents.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("content_sha", sa.String(length=64), nullable=False),
        sa.Column("storage_key", sa.Text(), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("composed_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("incident_archive_reports")
    op.drop_index("ix_incident_archive_deliveries_due", table_name="incident_archive_deliveries")
    op.drop_index("ix_incident_archive_deliveries_incident_id", table_name="incident_archive_deliveries")
    op.drop_table("incident_archive_deliveries")
