"""baseline — represents the schema as it exists after main.py's
self-contained startup migrations have run.

Intentionally a no-op: existing deployments already have all the
tables / columns / indexes the legacy startup migrations create, so
this revision marks the starting point without re-applying anything.

Going forward, EVERY schema change must be a new Alembic revision
generated via:

    python -m alembic revision -m "short description"

then filled out with explicit op.add_column / op.create_table / etc.
calls and a paired downgrade() that reverses them. Production deploys
run `alembic upgrade head` before starting the FastAPI app; rollback
via `alembic downgrade -1`.

Revision ID: e02e5aa439f1
Revises:
Create Date: 2026-05-17
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e02e5aa439f1'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op — main.py's startup migrations already created
    everything required for this baseline."""
    pass


def downgrade() -> None:
    """No-op — baseline cannot be 'downgraded' further; would have
    to drop the entire schema. Refuse silently rather than nuke."""
    pass
