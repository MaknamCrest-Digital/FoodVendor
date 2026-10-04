"""Add authenticated owners and operational journal to the existing foundation."""
from alembic import op
import sqlalchemy as sa

revision='0001_admin'
down_revision='0000_foundation'
branch_labels=None
depends_on=None

def upgrade():
    existing=set(sa.inspect(op.get_bind()).get_table_names())
    if 'users' not in existing:
        op.create_table('users',sa.Column('id',sa.String(36),primary_key=True),sa.Column('business_id',sa.String(36),sa.ForeignKey('businesses.id'),nullable=False),sa.Column('location_id',sa.String(36),sa.ForeignKey('locations.id'),nullable=False),sa.Column('name',sa.String(120),nullable=False),sa.Column('email',sa.String(254),unique=True,nullable=False),sa.Column('password_hash',sa.String(256),nullable=False),sa.Column('role',sa.String(32),nullable=False),sa.Column('active',sa.Boolean,nullable=False))
    if 'login_sessions' not in existing:
        op.create_table('login_sessions',sa.Column('token_hash',sa.String(64),primary_key=True),sa.Column('user_id',sa.String(36),sa.ForeignKey('users.id'),nullable=False),sa.Column('expires_at',sa.DateTime(timezone=True),nullable=False),sa.Column('revoked',sa.Boolean,nullable=False))
    if 'admin_events' not in existing:
        op.create_table('admin_events',sa.Column('id',sa.String(36),primary_key=True),sa.Column('business_id',sa.String(36),sa.ForeignKey('businesses.id'),nullable=False),sa.Column('location_id',sa.String(36),sa.ForeignKey('locations.id'),nullable=False),sa.Column('actor_id',sa.String(36),sa.ForeignKey('users.id'),nullable=False),sa.Column('entity_id',sa.String(100),nullable=False),sa.Column('kind',sa.String(32),nullable=False),sa.Column('action',sa.String(40),nullable=False),sa.Column('revision',sa.Integer,nullable=False),sa.Column('data',sa.JSON,nullable=False),sa.Column('occurred_at',sa.DateTime(timezone=True),nullable=False),sa.Column('received_at',sa.DateTime(timezone=True),nullable=False),sa.UniqueConstraint('business_id','location_id','kind','entity_id','revision',name='uq_admin_entity_revision'))
    if 'admin_records' not in existing:
        op.create_table('admin_records',sa.Column('key',sa.String(250),primary_key=True),sa.Column('business_id',sa.String(36),nullable=False),sa.Column('location_id',sa.String(36),nullable=False),sa.Column('kind',sa.String(32),nullable=False),sa.Column('entity_id',sa.String(100),nullable=False),sa.Column('revision',sa.Integer,nullable=False),sa.Column('data',sa.JSON,nullable=False))

def downgrade():
    raise RuntimeError('Rollback application code; retain operational and financial history.')
