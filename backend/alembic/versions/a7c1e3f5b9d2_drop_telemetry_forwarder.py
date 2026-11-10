"""drop the telemetry forwarder's columns and outbox

Revision ID: a7c1e3f5b9d2
Revises: e5a7c9d1b3f6
Create Date: 2026-11-09 12:00:00.000000

The opt-in crash-report forwarder is removed (owner decision 09.11.2026): since the
maintainer's ingest was retired it had no destination by default and no switch in the UI.
With it go what `b3d5f7a9c1e4` added: `deployment_config.telemetry_consent`,
`deployment_config.telemetry_install_id` and the `telemetry_outbox` table. Queued payloads and
a minted install id are deleted with them. The downgrade recreates all three exactly as
`b3d5f7a9c1e4` did, empty: consent NULL (= off), no install id, no rows.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

revision: str = "a7c1e3f5b9d2"
down_revision: str | None = "e5a7c9d1b3f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index("ix_telemetry_outbox_pending", table_name="telemetry_outbox")
    op.drop_table("telemetry_outbox")
    op.drop_column("deployment_config", "telemetry_install_id")
    op.drop_column("deployment_config", "telemetry_consent")


def downgrade() -> None:
    op.add_column("deployment_config", sa.Column("telemetry_consent", sa.Text(), nullable=True))
    op.add_column("deployment_config", sa.Column("telemetry_install_id", UUID(as_uuid=True), nullable=True))
    op.create_table(
        "telemetry_outbox",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("channel", sa.String(length=16), nullable=False),
        sa.Column("payload_json", JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("last_error", sa.String(length=200), nullable=True),
    )
    op.create_index("ix_telemetry_outbox_pending", "telemetry_outbox", ["sent_at", "created_at"])
