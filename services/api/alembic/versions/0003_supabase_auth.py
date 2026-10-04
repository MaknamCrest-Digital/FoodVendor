"""Map local tenant users to verified Supabase Auth identities."""
from alembic import op
import sqlalchemy as sa

revision='0003_supabase_auth'
down_revision='0002_settings_access'
branch_labels=None
depends_on=None


def upgrade():
    inspector=sa.inspect(op.get_bind())
    columns={column['name']:column for column in inspector.get_columns('users')}
    unique_subject=any(
        constraint.get('column_names')==['supabase_user_id']
        for constraint in inspector.get_unique_constraints('users')
    ) or any(
        index.get('unique') and index.get('column_names')==['supabase_user_id']
        for index in inspector.get_indexes('users')
    )
    needs_nullable_password=not columns['password_hash'].get('nullable',False)
    needs_subject='supabase_user_id' not in columns
    needs_subject_unique=not unique_subject
    if needs_nullable_password or needs_subject or needs_subject_unique:
        with op.batch_alter_table('users') as batch:
            if needs_nullable_password:
                batch.alter_column('password_hash',existing_type=sa.String(256),nullable=True)
            if needs_subject:
                batch.add_column(sa.Column('supabase_user_id',sa.String(36),nullable=True))
            if needs_subject_unique:
                batch.create_unique_constraint('uq_users_supabase_user_id',['supabase_user_id'])


def downgrade():
    raise RuntimeError('Rollback application code; retain explicit identity mappings.')
