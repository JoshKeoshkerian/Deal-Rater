"""Ground truth labels for the spec 9.1 validation set.

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-26

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TZ = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "ground_truth_labels",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("observation_id", sa.BigInteger(), nullable=False),
        sa.Column("label", sa.String(16), nullable=False),
        sa.Column("labeled_at", TZ, nullable=False),
        sa.Column("labeler", sa.String(64), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["observation_id"], ["listing_observations.id"], ondelete="CASCADE"
        ),
        sa.UniqueConstraint("observation_id", "labeler", name="uq_label_observation_labeler"),
        sa.CheckConstraint(
            "label IN ('good_deal', 'fair', 'overpriced', 'avoid')",
            name="ck_label_vocabulary",
        ),
    )
    op.create_index("ix_labels_observation", "ground_truth_labels", ["observation_id"])


def downgrade() -> None:
    op.drop_index("ix_labels_observation", table_name="ground_truth_labels")
    op.drop_table("ground_truth_labels")
