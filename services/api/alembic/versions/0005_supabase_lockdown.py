"""Close Supabase's public REST (PostgREST) path to API tables.

Supabase grants the `anon`/`authenticated` roles access to new tables in the
`public` schema, and the publishable key that uses those roles ships in the POS
bundle. All business access must go through FastAPI, which connects as the
table owner and is unaffected. Enables RLS with no policies (deny) and revokes
the grants, including for tables created by later migrations. No data changes.
"""
from alembic import op
import sqlalchemy as sa

revision='0005_supabase_lockdown'
down_revision='0004_canonical_indexes'
branch_labels=None
depends_on=None

CLIENT_ROLES=('anon','authenticated')


def upgrade():
    bind=op.get_bind()
    if bind.dialect.name!='postgresql':
        return
    present=[role for role in CLIENT_ROLES if bind.execute(sa.text('select 1 from pg_roles where rolname=:r'),{'r':role}).scalar()]
    tables=bind.execute(sa.text("select tablename from pg_tables where schemaname='public'")).scalars().all()
    for table in tables:
        op.execute(f'alter table public."{table}" enable row level security')
    if present:
        roles=', '.join(present)
        op.execute(f'revoke all on all tables in schema public from {roles}')
        op.execute(f'revoke all on all sequences in schema public from {roles}')
        op.execute(f'alter default privileges in schema public revoke all on tables from {roles}')
        op.execute(f'alter default privileges in schema public revoke all on sequences from {roles}')


def downgrade():
    raise RuntimeError('Do not re-expose API tables to Supabase client roles.')
