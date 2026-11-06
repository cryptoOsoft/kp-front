"""join the staging head with the restored print jobs (staging integration only)

e6b2c4d8f1a3 (the staging-only join) and e5a7c9d1b3f6 (#524: restore print_jobs) both descend
from d4f8b2e6a1c9, so the staging branch has two heads after merging main on 30.10.2026. This
empty revision joins them so `alembic upgrade head` has one target. It lives on the staging
branch only.

Revision ID: f7c1a9e3d5b2
Revises: e6b2c4d8f1a3, e5a7c9d1b3f6
Create Date: 2026-10-30 23:40:00.000000
"""

from collections.abc import Sequence

revision: str = "f7c1a9e3d5b2"
down_revision: str | tuple[str, ...] | None = ("e6b2c4d8f1a3", "e5a7c9d1b3f6")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
