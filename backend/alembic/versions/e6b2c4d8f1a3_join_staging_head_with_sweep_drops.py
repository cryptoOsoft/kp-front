"""join the staging head with the sweep round's drops (staging integration only)

d1a3e5c7b9f2 (the staging-only join) and d4f8b2e6a1c9 (sweep round 1: drop incident_notes and
reference_datasets.fetch_interval) both descend from c3e7a1d9b5f2, so the staging branch has two
heads after merging feat/sweep-review1. This empty revision joins them so `alembic upgrade head`
has one target. It lives on the staging branch only.

Revision ID: e6b2c4d8f1a3
Revises: d1a3e5c7b9f2, d4f8b2e6a1c9
Create Date: 2026-10-23 19:00:00.000000
"""

from collections.abc import Sequence

revision: str = "e6b2c4d8f1a3"
down_revision: str | tuple[str, ...] | None = ("d1a3e5c7b9f2", "d4f8b2e6a1c9")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
