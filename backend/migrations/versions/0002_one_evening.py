"""Remove global grouping from the evening timeline."""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    for table in ("drinks", "matches"):
        op.drop_index(f"ix_{table}_stage_id", table_name=table)
        op.drop_constraint(f"{table}_stage_id_fkey", table, type_="foreignkey")
        op.drop_column(table, "stage_id")
    op.drop_table("stages")


def downgrade():
    raise RuntimeError("Revision 0002 is irreversible. Restore a verified pre-upgrade backup.")
