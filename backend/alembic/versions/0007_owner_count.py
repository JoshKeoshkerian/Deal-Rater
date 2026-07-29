"""Owner count from Facebook's "About this vehicle" panel.

Target-only, like `title_status`: the search feed comps are built from does not
render it, so there is nothing to capture for a comp card.

Revision ID: 0007
Revises: 0006
Create Date: 2026-07-29

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "listing_observations", sa.Column("owner_count", sa.String(16), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("listing_observations", "owner_count")
