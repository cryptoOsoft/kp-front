"""join the staging head with incidents.exercise_since_creation (staging integration only)

c4e1a9d7b2f0 (the staging-only join) and c3e7a1d9b5f2 (main's RBAC round, 22.10.2026) both
descend from b2d6e8f1a3c7, so the staging branch has two heads again after merging the 3am
round 1. This empty revision joins them so `alembic upgrade head` has one target. It lives on
the staging branch only.

Revision ID: d1a3e5c7b9f2
Revises: c4e1a9d7b2f0, c3e7a1d9b5f2
Create Date: 2026-10-23 10:30:00.000000
"""

from collections.abc import Sequence

revision: str = "d1a3e5c7b9f2"
down_revision: str | tuple[str, ...] | None = ("c4e1a9d7b2f0", "c3e7a1d9b5f2")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
