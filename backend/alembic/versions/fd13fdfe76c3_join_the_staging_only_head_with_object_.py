"""join the staging-only head with the object-visit target (staging integration only)

55a8b6624c13 (the staging-only #301/#302 join) and b7c4d2e9f1a3 (#368, object_visits target)
both descend from a1f5b2c3d4e5, so the staging branch has two heads again. This empty revision
joins them so `alembic upgrade head` has one target. It lives on the staging branch only.

Revision ID: fd13fdfe76c3
Revises: 55a8b6624c13, b7c4d2e9f1a3
Create Date: 2026-10-16 22:39:45.923152
"""

from collections.abc import Sequence

revision: str = "fd13fdfe76c3"
down_revision: str | tuple[str, ...] | None = ("55a8b6624c13", "b7c4d2e9f1a3")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
