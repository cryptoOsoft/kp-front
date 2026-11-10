"""join the staging head with the telemetry drop (staging integration only)

f7c1a9e3d5b2 (the staging-only join) and a7c1e3f5b9d2 (#564: drop the telemetry forwarder) both
descend from e5a7c9d1b3f6, so the staging branch has two heads after merging main on 10.11.2026.
This empty revision joins them so `alembic upgrade head` has one target. It lives on the staging
branch only.

Revision ID: c2e4a6b8d0f1
Revises: f7c1a9e3d5b2, a7c1e3f5b9d2
Create Date: 2026-11-10 10:00:00.000000
"""

from collections.abc import Sequence

revision: str = "c2e4a6b8d0f1"
down_revision: str | tuple[str, ...] | None = ("f7c1a9e3d5b2", "a7c1e3f5b9d2")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
