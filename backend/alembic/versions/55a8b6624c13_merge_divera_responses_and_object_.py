"""merge the Divera-responses and object-measures heads (staging integration only)

#301 (a1d2e3f4b5c6, divera_alarm_responses) and #302 (a1f5b2c3d4e5, object_measures) both
revise d3e6a9c2f5b8, so the staging branch, which carries both drafts, has two heads. This
empty revision joins them so `alembic upgrade head` has one target. It lives on the staging
integration branch only; main gets its own linear order when the drafts land there.

Revision ID: 55a8b6624c13
Revises: a1d2e3f4b5c6, a1f5b2c3d4e5
Create Date: 2026-10-09 14:15:48.318667
"""

from collections.abc import Sequence

revision: str = "55a8b6624c13"
down_revision: str | tuple[str, ...] | None = ("a1d2e3f4b5c6", "a1f5b2c3d4e5")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
