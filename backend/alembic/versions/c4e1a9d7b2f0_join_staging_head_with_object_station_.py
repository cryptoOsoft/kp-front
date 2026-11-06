"""join the staging head with the station's object corrections (staging integration only)

fd13fdfe76c3 (the staging-only join) and b2d6e8f1a3c7 (#377, the station's position/outline
corrections) both descend from a1f5b2c3d4e5, so the staging branch has two heads again. This
empty revision joins them so `alembic upgrade head` has one target. It lives on the staging
branch only.

Revision ID: c4e1a9d7b2f0
Revises: fd13fdfe76c3, b2d6e8f1a3c7
Create Date: 2026-10-17 20:30:00.000000
"""

from collections.abc import Sequence

revision: str = "c4e1a9d7b2f0"
down_revision: str | tuple[str, ...] | None = ("fd13fdfe76c3", "b2d6e8f1a3c7")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
