"""Install attribution: which ad drove an install, and what it did next.

- `installs`: one row per extension install with its first-touch UTMs,
  written by `POST /v1/attribution` from the welcome page.
- `captures.install_id`: the install that ran each check.
- `users.install_id`: the install an account came from, so purchases join back.
- `funnel_by_source` view: per utm_campaign / utm_content, installs and how
  many went on to 1+ evaluations, 3+ evaluations, and a purchase.

See `app/attribution.py`.

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-16

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Portable SQL (Postgres and SQLite). An "evaluation" is a capture: one per
#: Evaluate click, and what `GET /v1/evaluations/{id}` scores. A purchase is a
#: pack or subscription ledger row on the account the install became. NULL
#: utm_campaign / utm_content rows are organic/direct.
FUNNEL_BY_SOURCE_SQL = """
CREATE VIEW funnel_by_source AS
WITH evals AS (
    SELECT c.install_id, COUNT(*) AS n
    FROM captures c
    WHERE c.install_id IS NOT NULL
    GROUP BY c.install_id
),
buyers AS (
    SELECT DISTINCT u.install_id
    FROM users u
    JOIN credit_ledger cl ON cl.user_id = u.id
    WHERE u.install_id IS NOT NULL
      AND cl.reason IN ('pack_purchase', 'subscription_charge')
)
SELECT
    i.utm_campaign,
    i.utm_content,
    COUNT(*) AS installs,
    SUM(CASE WHEN e.n >= 1 THEN 1 ELSE 0 END) AS installs_with_1plus_evaluations,
    SUM(CASE WHEN e.n >= 3 THEN 1 ELSE 0 END) AS installs_with_3plus_evaluations,
    SUM(CASE WHEN b.install_id IS NOT NULL THEN 1 ELSE 0 END) AS installs_with_purchase
FROM installs i
LEFT JOIN evals e ON e.install_id = i.install_id
LEFT JOIN buyers b ON b.install_id = i.install_id
GROUP BY i.utm_campaign, i.utm_content
"""


def upgrade() -> None:
    op.create_table(
        "installs",
        sa.Column("install_id", sa.Uuid(as_uuid=False), primary_key=True),
        sa.Column("utm_source", sa.String(255), nullable=True),
        sa.Column("utm_medium", sa.String(255), nullable=True),
        sa.Column("utm_campaign", sa.String(255), nullable=True),
        sa.Column("utm_content", sa.String(255), nullable=True),
        sa.Column("utm_term", sa.String(255), nullable=True),
        sa.Column("landed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "installed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_installs_campaign_content", "installs", ["utm_campaign", "utm_content"])

    with op.batch_alter_table("captures") as batch:
        batch.add_column(sa.Column("install_id", sa.Uuid(as_uuid=False), nullable=True))
    op.create_index("ix_captures_install", "captures", ["install_id"])

    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("install_id", sa.Uuid(as_uuid=False), nullable=True))
    op.create_index("ix_users_install", "users", ["install_id"])

    op.execute(FUNNEL_BY_SOURCE_SQL)


def downgrade() -> None:
    op.execute("DROP VIEW IF EXISTS funnel_by_source")
    op.drop_index("ix_users_install", table_name="users")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("install_id")
    op.drop_index("ix_captures_install", table_name="captures")
    with op.batch_alter_table("captures") as batch:
        batch.drop_column("install_id")
    op.drop_index("ix_installs_campaign_content", table_name="installs")
    op.drop_table("installs")
