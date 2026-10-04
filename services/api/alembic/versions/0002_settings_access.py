"""Expand with tenant permissions, scoped settings and security audit."""
from alembic import op
import sqlalchemy as sa
revision='0002_settings_access'
down_revision='0001_admin'
branch_labels=None
depends_on=None

def upgrade():
    existing=set(sa.inspect(op.get_bind()).get_table_names())
    if 'permissions' not in existing:op.create_table('permissions',sa.Column('key',sa.String(100),primary_key=True))
    if 'roles' not in existing:op.create_table('roles',sa.Column('id',sa.String(36),primary_key=True),sa.Column('business_id',sa.String(36),sa.ForeignKey('businesses.id'),nullable=False),sa.Column('name',sa.String(100),nullable=False),sa.Column('template',sa.String(30),nullable=False),sa.UniqueConstraint('business_id','name',name='uq_tenant_role_name'))
    if 'role_permissions' not in existing:op.create_table('role_permissions',sa.Column('role_id',sa.String(36),sa.ForeignKey('roles.id'),primary_key=True),sa.Column('permission',sa.String(100),sa.ForeignKey('permissions.key'),primary_key=True))
    if 'user_roles' not in existing:op.create_table('user_roles',sa.Column('user_id',sa.String(36),sa.ForeignKey('users.id'),primary_key=True),sa.Column('role_id',sa.String(36),sa.ForeignKey('roles.id'),nullable=False))
    if 'user_permission_overrides' not in existing:op.create_table('user_permission_overrides',sa.Column('user_id',sa.String(36),sa.ForeignKey('users.id'),primary_key=True),sa.Column('permission',sa.String(100),sa.ForeignKey('permissions.key'),primary_key=True),sa.Column('allowed',sa.Boolean,nullable=False))
    if 'scoped_settings' not in existing:op.create_table('scoped_settings',sa.Column('key',sa.String(250),primary_key=True),sa.Column('business_id',sa.String(36),sa.ForeignKey('businesses.id'),nullable=False),sa.Column('scope',sa.String(20),nullable=False),sa.Column('scope_id',sa.String(36),nullable=False),sa.Column('section',sa.String(40),nullable=False),sa.Column('revision',sa.Integer,nullable=False),sa.Column('values',sa.JSON,nullable=False),sa.Column('updated_by',sa.String(36),sa.ForeignKey('users.id'),nullable=False),sa.Column('updated_at',sa.DateTime(timezone=True),nullable=False))
    if 'security_audit' not in existing:op.create_table('security_audit',sa.Column('id',sa.String(36),primary_key=True),sa.Column('business_id',sa.String(36),sa.ForeignKey('businesses.id'),nullable=False),sa.Column('location_id',sa.String(36),sa.ForeignKey('locations.id'),nullable=False),sa.Column('actor_id',sa.String(36),sa.ForeignKey('users.id'),nullable=False),sa.Column('action',sa.String(80),nullable=False),sa.Column('entity_id',sa.String(100),nullable=False),sa.Column('details',sa.JSON,nullable=False),sa.Column('created_at',sa.DateTime(timezone=True),nullable=False))
    for table,columns in [('roles',['business_id']),('user_roles',['role_id']),('scoped_settings',['business_id']),('security_audit',['business_id','location_id'])]:
        indexes={index['name'] for index in sa.inspect(op.get_bind()).get_indexes(table)}
        for column in columns:
            name=f'ix_{table}_{column}'
            if name not in indexes:op.create_index(name,table,[column])

def downgrade():
    raise RuntimeError('Roll back application code; retain settings, access and audit data.')
