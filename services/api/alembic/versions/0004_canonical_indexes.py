"""Add missing indexes required by the canonical ORM schema."""
from alembic import op
import sqlalchemy as sa

revision='0004_canonical_indexes'
down_revision='0003_supabase_auth'
branch_labels=None
depends_on=None

INDEXES=(
    ('admin_events','ix_admin_events_business_id',['business_id']),
    ('admin_events','ix_admin_events_entity_id',['entity_id']),
    ('admin_events','ix_admin_events_location_id',['location_id']),
    ('admin_records','ix_admin_records_business_id',['business_id']),
    ('admin_records','ix_admin_records_location_id',['location_id']),
    ('login_sessions','ix_login_sessions_user_id',['user_id']),
    ('users','ix_users_business_id',['business_id']),
    ('users','ix_users_location_id',['location_id']),
)


def upgrade():
    inspector=sa.inspect(op.get_bind())
    for table,name,columns in INDEXES:
        existing={index['name'] for index in inspector.get_indexes(table)}
        if name not in existing:
            op.create_index(name,table,columns)
            inspector=sa.inspect(op.get_bind())


def downgrade():
    raise RuntimeError('Rollback application code; retain tenant query indexes.')

