"""Vendor onboarding foundation: business lifecycle, applications, platform admins, audit.

businesses.status: existing tenants become ACTIVE. Transitions, enforced later by the
platform service (not by this schema): ACTIVE <-> SUSPENDED; ACTIVE or SUSPENDED ->
CLOSED, which is terminal.

business_applications.status: PENDING -> APPROVED (provisions exactly one business) or
PENDING -> REJECTED; both are terminal. The review-state CHECK keeps review fields
consistent with the status, and the unique provisioned_business_id lets a repeated
approval find the business it already created.

New tables get row-level security with no policies and lose client-role grants, as
0005 did for every earlier table. No existing data or tenant policy changes.
"""
from alembic import op
import sqlalchemy as sa

revision='0006_tenant_onboarding'
down_revision='0005_supabase_lockdown'
branch_labels=None
depends_on=None

CLIENT_ROLES=('anon','authenticated')
NEW_TABLES=('platform_admins','business_applications','platform_audit')
REVIEW_STATE=("(status = 'PENDING' AND reviewed_at IS NULL AND provisioned_business_id IS NULL)"
              " OR (status = 'APPROVED' AND reviewed_at IS NOT NULL AND provisioned_business_id IS NOT NULL)"
              " OR (status = 'REJECTED' AND reviewed_at IS NOT NULL AND provisioned_business_id IS NULL)")


def _index_if_missing(table, name, columns):
    if name not in {index['name'] for index in sa.inspect(op.get_bind()).get_indexes(table)}:
        op.create_index(name,table,columns)


def upgrade():
    bind=op.get_bind()
    inspector=sa.inspect(bind)
    columns={column['name'] for column in inspector.get_columns('businesses')}
    checks={check['name'] for check in inspector.get_check_constraints('businesses')}
    if 'status' not in columns or 'ck_businesses_status' not in checks:
        with op.batch_alter_table('businesses') as batch:
            if 'status' not in columns:
                batch.add_column(sa.Column('status',sa.String(20),nullable=False,server_default='ACTIVE'))
            if 'ck_businesses_status' not in checks:
                batch.create_check_constraint('ck_businesses_status',"status IN ('ACTIVE','SUSPENDED','CLOSED')")

    existing=set(inspector.get_table_names())
    if 'platform_admins' not in existing:
        op.create_table('platform_admins',
            sa.Column('id',sa.String(36),primary_key=True),
            sa.Column('auth_provider',sa.String(32),nullable=False),
            sa.Column('auth_subject',sa.String(255),nullable=False),
            sa.Column('is_active',sa.Boolean,nullable=False),
            sa.Column('created_at',sa.DateTime(timezone=True),nullable=False),
            sa.UniqueConstraint('auth_provider','auth_subject',name='uq_platform_admins_auth_identity'))
    if 'business_applications' not in existing:
        op.create_table('business_applications',
            sa.Column('id',sa.String(36),primary_key=True),
            sa.Column('auth_provider',sa.String(32),nullable=False),
            sa.Column('auth_subject',sa.String(255),nullable=False),
            sa.Column('contact_email',sa.String(254),nullable=False),
            sa.Column('contact_phone',sa.String(40),nullable=True),
            sa.Column('business_name',sa.String(120),nullable=False),
            sa.Column('business_category',sa.String(80),nullable=True),
            sa.Column('business_address',sa.String(255),nullable=True),
            sa.Column('status',sa.String(20),nullable=False,server_default='PENDING'),
            sa.Column('submitted_at',sa.DateTime(timezone=True),nullable=False),
            sa.Column('reviewed_at',sa.DateTime(timezone=True),nullable=True),
            sa.Column('reviewed_by_platform_admin_id',sa.String(36),sa.ForeignKey('platform_admins.id'),nullable=True),
            sa.Column('review_notes',sa.Text,nullable=True),
            sa.Column('provisioned_business_id',sa.String(36),sa.ForeignKey('businesses.id'),nullable=True),
            sa.Column('created_at',sa.DateTime(timezone=True),nullable=False),
            sa.Column('updated_at',sa.DateTime(timezone=True),nullable=False),
            sa.CheckConstraint("status IN ('PENDING','APPROVED','REJECTED')",name='ck_business_applications_status'),
            sa.CheckConstraint(REVIEW_STATE,name='ck_business_applications_review_state'),
            sa.UniqueConstraint('provisioned_business_id',name='uq_business_applications_provisioned_business_id'))
    if 'platform_audit' not in existing:
        op.create_table('platform_audit',
            sa.Column('id',sa.String(36),primary_key=True),
            sa.Column('platform_admin_id',sa.String(36),sa.ForeignKey('platform_admins.id'),nullable=True),
            sa.Column('action',sa.String(80),nullable=False),
            sa.Column('target_type',sa.String(40),nullable=False),
            sa.Column('target_id',sa.String(36),nullable=True),
            sa.Column('metadata',sa.JSON,nullable=True),
            sa.Column('created_at',sa.DateTime(timezone=True),nullable=False),
            sa.CheckConstraint("platform_admin_id IS NOT NULL OR substr(action, 1, 7) = 'SYSTEM_'",name='ck_platform_audit_actor'))
    for table,name,index_columns in (
        ('business_applications','ix_business_applications_status_submitted_at',['status','submitted_at']),
        ('business_applications','ix_business_applications_auth_identity',['auth_provider','auth_subject']),
        ('platform_audit','ix_platform_audit_platform_admin_id',['platform_admin_id']),
        ('platform_audit','ix_platform_audit_created_at',['created_at']),
        ('platform_audit','ix_platform_audit_target',['target_type','target_id']),
    ):
        _index_if_missing(table,name,index_columns)

    if bind.dialect.name!='postgresql':
        return
    for table in NEW_TABLES:
        op.execute(f'alter table public."{table}" enable row level security')
    # 0005's default privileges cover tables made by the same role; revoke explicitly too.
    present=[role for role in CLIENT_ROLES if bind.execute(sa.text('select 1 from pg_roles where rolname=:r'),{'r':role}).scalar()]
    if present:
        tables=', '.join(f'public."{table}"' for table in NEW_TABLES)
        op.execute(f'revoke all on table {tables} from {", ".join(present)}')


def downgrade():
    raise RuntimeError('Rollback application code; retain business lifecycle, applications, platform admins and audit records.')
