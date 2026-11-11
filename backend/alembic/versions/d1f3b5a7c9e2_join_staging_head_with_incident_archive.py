"""join the staging head with the incident archive (staging integration only)

c2e4a6b8d0f1 (the staging-only join) and c4e8a2f6d0b1 (#585: Einsatz-Ablage) both descend from
a7c1e3f5b9d2, so the staging branch has two heads after merging main on 11.11.2026. This empty
revision joins them so `alembic upgrade head` has one target. It lives on the staging branch only.

Revision ID: d1f3b5a7c9e2
Revises: c2e4a6b8d0f1, c4e8a2f6d0b1
Create Date: 2026-11-11 23:00:00.000000
"""

from collections.abc import Sequence

revision: str = "d1f3b5a7c9e2"
down_revision: str | tuple[str, ...] | None = ("c2e4a6b8d0f1", "c4e8a2f6d0b1")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
