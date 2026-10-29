"""PostgreSQL migration verification on throwaway databases. Prints no credentials.

Creates temporary databases on a LOCAL PostgreSQL server (CI service container)
and drops them afterwards:

  fresh    empty database, no Supabase roles (vanilla PostgreSQL/Neon), upgraded
           to head; checks tables, version, row-level security, re-run no-op and
           ORM/migration drift.
  upgrade  Supabase-like database (anon/authenticated roles with Supabase's
           default grants) migrated to 0004 and filled with tenant data, then
           upgraded through 0005 to head; checks every existing value survived,
           businesses became ACTIVE, RLS is on, client roles lost all grants (also
           for tables created later) and cannot read or write tenant, platform or
           application records, every schema constraint rejects violations (with a
           valid write as control), and a downgrade is refused without changes.

    cd services/api
    MIGRATION_CHECK_URL=postgresql+psycopg://user:pass@localhost:5432/postgres python scripts/verify_migrations.py

The URL must be a superuser on localhost; anything else is refused so this can
never run against Supabase or another shared database.
"""
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

API_DIR = Path(__file__).resolve().parents[1]
# The ORM is imported only for its metadata; never let it read a developer .env database.
os.environ.update(ENVIRONMENT='test', DATABASE_URL='sqlite://')
os.environ.pop('MAKNAM_ENV_FILE', None)
sys.path.insert(0, str(API_DIR))

from alembic.autogenerate import compare_metadata  # noqa: E402
from alembic.config import Config  # noqa: E402
from alembic.migration import MigrationContext  # noqa: E402
from alembic.script import ScriptDirectory  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402
from sqlalchemy.exc import DBAPIError, ProgrammingError  # noqa: E402

import app.main  # noqa: E402,F401  registers every model
from app.db.session import Base  # noqa: E402

LOCAL_HOSTS = {'localhost', '127.0.0.1', '::1'}
CLIENT_ROLES = ('anon', 'authenticated')
PRE_LOCKDOWN = '0004_canonical_indexes'
LOCKDOWN = '0005_supabase_lockdown'
PLATFORM_TABLES = ('platform_admins', 'business_applications', 'platform_audit')
# SQLSTATE codes
CHECK, UNIQUE, FOREIGN_KEY, NOT_NULL, DENIED = '23514', '23505', '23503', '23502', '42501'
SCRIPTS = ScriptDirectory.from_config(Config(str(API_DIR / 'alembic.ini')))
HEAD = SCRIPTS.get_current_head()
EXPECTED_TABLES = set(Base.metadata.tables) | {'alembic_version'}

results: list[tuple[bool, str, str]] = []


def check(ok: bool, name: str, detail: str = ''):
    results.append((bool(ok), name, detail))


def alembic(url: str, *args: str):
    env = {**os.environ, 'DATABASE_URL': url, 'ENVIRONMENT': 'test'}
    run = subprocess.run([sys.executable, '-m', 'alembic', *args], cwd=API_DIR, env=env, capture_output=True, text=True)
    if run.returncode:
        raise RuntimeError(f'alembic {" ".join(args)} failed:\n{run.stderr[-3000:]}')


def public_tables(connection) -> set[str]:
    return set(connection.execute(text("select tablename from pg_tables where schemaname='public'")).scalars())


def tables_without_rls(connection) -> list[str]:
    return sorted(connection.execute(text(
        "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace "
        "where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity")).scalars())


def client_grants(connection) -> list[str]:
    rows = connection.execute(text(
        "select grantee||':'||table_name||':'||privilege_type from information_schema.role_table_grants "
        "where table_schema='public' and grantee in ('anon','authenticated')")).scalars()
    return sorted(rows)


def table_columns(connection, tables) -> dict[str, list[str]]:
    return {table: list(connection.execute(text(
        "select column_name from information_schema.columns where table_schema='public' and table_name=:t order by ordinal_position"),
        {'t': table}).scalars()) for table in sorted(tables)}


def fingerprints(connection, columns: dict[str, list[str]]) -> dict[str, tuple[int, str]]:
    # Row count plus a hash of the given columns: proves an upgrade kept every existing
    # value even when it adds columns.
    result = {}
    for table, names in columns.items():
        row = 'row(' + ','.join(f'"{name}"' for name in names) + ')::text'
        result[table] = tuple(connection.execute(text(
            f'select count(*), coalesce(md5(string_agg(r, \'|\' order by r)), \'\') from (select {row} as r from public."{table}") s')).one())
    return result


def outcome(connection, statement: str, params: dict | None = None) -> str:
    """'accepted', or the PostgreSQL SQLSTATE that rejected the statement (inside a savepoint)."""
    savepoint = connection.begin_nested()
    try:
        connection.execute(text(statement), params or {})
        savepoint.commit()
        return 'accepted'
    except DBAPIError as error:
        savepoint.rollback()
        return getattr(error.orig, 'sqlstate', None) or type(error.orig).__name__


def version(connection) -> str | None:
    return connection.execute(text('select version_num from alembic_version')).scalar()


def verify_fresh(url: str):
    alembic(url, 'upgrade', 'head')
    engine = create_engine(url)
    with engine.connect() as connection:
        check(version(connection) == HEAD, 'fresh: alembic version is head', f'{version(connection)} (head {HEAD})')
        tables = public_tables(connection)
        check(tables == EXPECTED_TABLES, 'fresh: tables match ORM metadata',
              f'missing={sorted(EXPECTED_TABLES - tables)} unexpected={sorted(tables - EXPECTED_TABLES)}')
        missing_rls = tables_without_rls(connection)
        check(not missing_rls, f'fresh: row-level security on all {len(tables)} public tables', f'without RLS: {missing_rls}')
        drift = compare_metadata(MigrationContext.configure(connection, opts={'compare_type': True, 'compare_server_default': True}), Base.metadata)
        check(not drift, 'fresh: no drift between ORM models and migrated schema', '\n    '.join(map(str, drift)))
    engine.dispose()
    alembic(url, 'upgrade', 'head')
    engine = create_engine(url)
    with engine.connect() as connection:
        check(version(connection) == HEAD, 'fresh: re-running upgrade head is a no-op')
    engine.dispose()


def seed_tenant_data(connection):
    ids = {name: str(uuid4()) for name in ('b1', 'b2', 'l1', 'l2', 't1', 'u1', 'r1', 'o1', 'm1', 'a1')}
    rows = [
        ("insert into businesses (id,name,created_at) values (:b1,'Seed Tenant A',now()),(:b2,'Seed Tenant B',now())", {}),
        ("insert into locations (id,business_id,name) values (:l1,:b1,'Branch A'),(:l2,:b2,'Branch B')", {}),
        ("insert into terminals (id,business_id,location_id,name,app_version,local_schema_version,sync_protocol_version) values (:t1,:b1,:l1,'T-1','1.0.0',1,2)", {}),
        ("insert into users (id,business_id,location_id,name,email,password_hash,supabase_user_id,role,active) values (:u1,:b1,:l1,'Seed Owner','owner@seed.invalid',null,:a1,'OWNER',true)", {}),
        ("insert into login_sessions (token_hash,user_id,expires_at,revoked) values (repeat('a',64),:u1,now(),true)", {}),
        ("insert into menu_items (id,business_id,name,category,price_pesewas) values (:m1,:b1,'Pork + Yam','Pork',8500)", {}),
        ("insert into orders (id,business_id,location_id,terminal_id,receipt_no,total_pesewas,payment_method,occurred_at,payload,synced_at) values (:o1,:b1,:l1,:t1,'T-1-0001',8500,'CASH',now(),cast(:payload as json),now())",
         {'payload': json.dumps({'items': [{'id': 'i1', 'menu_item_id': 'm1', 'name': 'Pork + Yam', 'quantity': 1, 'unit_price_pesewas': 8500}], 'cashier_id': 'u1'})}),
        ("insert into sync_events (event_id,entity_id,business_id,event_type,received_at) values (:o1,:o1,:b1,'order.completed',now())", {}),
        ("insert into admin_events (id,business_id,location_id,actor_id,entity_id,kind,action,revision,data,occurred_at,received_at) values (:m1,:b1,:l1,:u1,'coke','menu','CREATED',1,cast(:data as json),now(),now())", {'data': json.dumps({'name': 'Coke', 'pricePesewas': 1500})}),
        ("insert into admin_records (key,business_id,location_id,kind,entity_id,revision,data) values (:key,:b1,:l1,'menu','coke',1,cast(:data as json))", {'key': f"{ids['b1']}:{ids['l1']}:menu:coke", 'data': json.dumps({'name': 'Coke', 'pricePesewas': 1500})}),
        ("insert into permissions (key) values ('pos.view'),('pos.sale.create')", {}),
        ("insert into roles (id,business_id,name,template) values (:r1,:b1,'Owner','OWNER')", {}),
        ("insert into role_permissions (role_id,permission) values (:r1,'pos.view'),(:r1,'pos.sale.create')", {}),
        ("insert into user_roles (user_id,role_id) values (:u1,:r1)", {}),
        ("insert into user_permission_overrides (user_id,permission,allowed) values (:u1,'pos.view',true)", {}),
        ("insert into scoped_settings (key,business_id,scope,scope_id,section,revision,\"values\",updated_by,updated_at) values (:key,:b1,'BUSINESS',:b1,'pos',1,cast(:data as json),:u1,now())", {'key': f"{ids['b1']}:BUSINESS:{ids['b1']}:pos", 'data': json.dumps({'allowNegativeStock': False})}),
        ("insert into security_audit (id,business_id,location_id,actor_id,action,entity_id,details,created_at) values (:r1,:b1,:l1,:u1,'ROLE_CREATED',:r1,cast('{}' as json),now())", {}),
    ]
    for statement, params in rows:
        connection.execute(text(statement), {**ids, **params})


def verify_upgrade(url: str):
    engine = create_engine(url)
    with engine.begin() as connection:
        # Supabase grants its client roles everything on new public tables; reproduce that.
        connection.execute(text('grant usage on schema public to anon, authenticated'))
        connection.execute(text('alter default privileges in schema public grant all on tables to anon, authenticated'))
        connection.execute(text('alter default privileges in schema public grant all on sequences to anon, authenticated'))
    engine.dispose()
    alembic(url, 'upgrade', PRE_LOCKDOWN)
    engine = create_engine(url)
    with engine.begin() as connection:
        seed_tenant_data(connection)
    with engine.connect() as connection:
        tables = public_tables(connection) - {'alembic_version'}
        check(version(connection) == PRE_LOCKDOWN, f'upgrade: starts at {PRE_LOCKDOWN}', str(version(connection)))
        check(bool(client_grants(connection)) and bool(tables_without_rls(connection)),
              'upgrade: starting database exposes tables to client roles (lockdown not yet applied)')
        seeded_columns = table_columns(connection, tables)
        before = fingerprints(connection, seeded_columns)
        empty = [table for table, (count, _) in before.items() if not count]
        check(not empty, f'upgrade: all {len(tables)} tables hold seed data', f'empty: {empty}')
    engine.dispose()
    alembic(url, 'upgrade', LOCKDOWN)
    alembic(url, 'upgrade', 'head')
    engine = create_engine(url)
    with engine.connect() as connection:
        check(version(connection) == HEAD, f'upgrade: {PRE_LOCKDOWN} -> {LOCKDOWN} -> head', f'{version(connection)} (head {HEAD})')
        after = fingerprints(connection, seeded_columns)
        changed = sorted(table for table in tables if before[table] != after[table])
        check(not changed, 'upgrade: every seeded row and value is unchanged', f'changed: {changed}')
        statuses = connection.execute(text('select status, count(*) from businesses group by status')).all()
        check(statuses == [('ACTIVE', 2)], 'upgrade: existing businesses become ACTIVE', f'{statuses}')
        missing = sorted(set(PLATFORM_TABLES) - public_tables(connection))
        check(not missing, 'upgrade: platform tables created', f'missing: {missing}')
        missing_rls = tables_without_rls(connection)
        check(not missing_rls, 'upgrade: row-level security on all public tables', f'without RLS: {missing_rls}')
        grants = client_grants(connection)
        check(not grants, 'upgrade: anon/authenticated hold no table privileges', f'{grants[:10]}')
    with engine.begin() as connection:
        # Default privileges must also stop grants on tables created by later migrations.
        connection.execute(text('create table public._migration_probe (id int)'))
        probe = [grant for grant in client_grants(connection) if ':_migration_probe:' in grant]
        connection.execute(text('drop table public._migration_probe'))
        check(not probe, 'upgrade: tables created later get no client-role grants', f'{probe}')
    verify_client_roles_denied(engine)
    verify_constraints(engine)
    with engine.connect() as connection:
        state = fingerprints(connection, table_columns(connection, public_tables(connection)))
    try:
        alembic(url, 'downgrade', LOCKDOWN)
        refused = False
    except RuntimeError as error:
        refused = 'Rollback application code' in str(error)
    with engine.connect() as connection:
        intact = version(connection) == HEAD and fingerprints(connection, table_columns(connection, public_tables(connection))) == state
    check(refused and intact, 'upgrade: downgrade below 0006 is refused and changes nothing')
    engine.dispose()


def verify_client_roles_denied(engine):
    attempts = [(f'read {table}', f'select 1 from public."{table}" limit 1') for table in ('users', 'businesses', *PLATFORM_TABLES)]
    attempts += [
        ('insert platform_admins', "insert into public.platform_admins (id,auth_provider,auth_subject,is_active,created_at) values ('x','supabase','x',true,now())"),
        ('insert business_applications', "insert into public.business_applications (id,auth_provider,auth_subject,contact_email,business_name,submitted_at,created_at,updated_at) values ('x','supabase','x','a@b.c','x',now(),now(),now())"),
        ('update businesses status', "update public.businesses set status='SUSPENDED'"),
    ]
    for role in CLIENT_ROLES:
        refused = []
        for name, statement in attempts:
            with engine.connect() as connection:
                connection.execute(text(f'set local role {role}'))
                try:
                    connection.execute(text(statement))
                    result = 'accepted'
                except ProgrammingError as error:
                    result = getattr(error.orig, 'sqlstate', None)
                connection.rollback()
            if result != DENIED:
                refused.append(f'{name}: {result}')
        check(not refused, f'upgrade: {role} cannot read or modify tenant, platform or application records', f'{refused}')


def verify_constraints(engine):
    """Each rule is checked with a valid write (control) and the violating write. Rolled back."""
    with engine.connect() as connection:
        connection.begin()
        business = connection.execute(text("select id from businesses where name='Seed Tenant A'")).scalar_one()
        other = connection.execute(text("select id from businesses where name='Seed Tenant B'")).scalar_one()
        admin, missing = str(uuid4()), str(uuid4())
        admin_row = "insert into platform_admins (id,auth_provider,auth_subject,is_active,created_at) values (:id,'supabase',:subject,true,now())"
        application = ("insert into business_applications (id,auth_provider,auth_subject,contact_email,business_name,status,submitted_at,reviewed_at,reviewed_by_platform_admin_id,provisioned_business_id,created_at,updated_at) "
                       "values (:id,'supabase',:subject,'owner@seed.invalid','Seed Applicant',:status,now(),:reviewed,:reviewer,:business,now(),now())")
        app = lambda status='PENDING', reviewed=None, reviewer=None, business_id=None, subject='applicant': {  # noqa: E731
            'id': str(uuid4()), 'subject': subject, 'status': status, 'reviewed': reviewed, 'reviewer': reviewer, 'business': business_id}
        audit = "insert into platform_audit (id,platform_admin_id,action,target_type,target_id,metadata,created_at) values (:id,:admin,:action,'business_application',null,null,now())"
        cases = [
            ('new business defaults to ACTIVE', "insert into businesses (id,name,created_at) values (:id,'Defaulted',now())", {'id': str(uuid4())}, 'accepted'),
            ('business status SUSPENDED accepted', 'update businesses set status=\'SUSPENDED\' where id=:id', {'id': other}, 'accepted'),
            ('invalid business status rejected', 'update businesses set status=\'DELETED\' where id=:id', {'id': business}, CHECK),
            ('platform admin created', admin_row, {'id': admin, 'subject': 'platform-subject'}, 'accepted'),
            ('platform admin identity is unique', admin_row, {'id': str(uuid4()), 'subject': 'platform-subject'}, UNIQUE),
            ('platform admin activation is explicit', "insert into platform_admins (id,auth_provider,auth_subject,created_at) values (:id,'supabase','other',now())", {'id': str(uuid4())}, NOT_NULL),
            ('pending application accepted', application, app(), 'accepted'),
            ('same applicant may apply again', application, app(), 'accepted'),
            ('invalid application status rejected', application, app('ON_HOLD'), CHECK),
            ('approval requires a provisioned business', application, app('APPROVED', reviewed=datetime.now(timezone.utc), reviewer=admin), CHECK),
            ('pending application cannot carry a business', application, app('PENDING', business_id=business), CHECK),
            ('approved application provisions a business', application, app('APPROVED', reviewed=datetime.now(timezone.utc), reviewer=admin, business_id=business), 'accepted'),
            ('a business is provisioned by one application only', application, app('APPROVED', reviewed=datetime.now(timezone.utc), reviewer=admin, business_id=business, subject='someone-else'), UNIQUE),
            ('rejection cannot provision a business', application, app('REJECTED', reviewed=datetime.now(timezone.utc), reviewer=admin, business_id=other), CHECK),
            ('provisioned business must exist', application, app('APPROVED', reviewed=datetime.now(timezone.utc), reviewer=admin, business_id=missing), FOREIGN_KEY),
            ('reviewer must be a platform admin', application, app('REJECTED', reviewed=datetime.now(timezone.utc), reviewer=missing), FOREIGN_KEY),
            ('audit by platform admin accepted', audit, {'id': str(uuid4()), 'admin': admin, 'action': 'APPLICATION_APPROVED'}, 'accepted'),
            ('system audit action accepted without admin', audit, {'id': str(uuid4()), 'admin': None, 'action': 'SYSTEM_BOOTSTRAP'}, 'accepted'),
            ('non-system audit action requires an admin', audit, {'id': str(uuid4()), 'admin': None, 'action': 'APPLICATION_APPROVED'}, CHECK),
            ('audit admin must exist', audit, {'id': str(uuid4()), 'admin': missing, 'action': 'APPLICATION_APPROVED'}, FOREIGN_KEY),
        ]
        for name, statement, params, expected in cases:
            result = outcome(connection, statement, params)
            check(result == expected, f'constraint: {name}', f'expected {expected}, got {result}')
        defaulted = connection.execute(text("select status from businesses where name='Defaulted'")).scalar_one()
        check(defaulted == 'ACTIVE', 'constraint: database default status is ACTIVE', defaulted)
        verify_atomic_approval(connection, admin)
        connection.rollback()


def verify_atomic_approval(connection, admin: str):
    """PENDING -> APPROVED: the business and every review field change in one transaction."""
    pending = str(uuid4())
    connection.execute(text("insert into business_applications (id,auth_provider,auth_subject,contact_email,business_name,submitted_at,created_at,updated_at) "
                            "values (:id,'supabase','atomic-applicant','a@seed.invalid','Atomic Stall',now(),now(),now())"), {'id': pending})
    half = outcome(connection, "update business_applications set status='APPROVED' where id=:id", {'id': pending})
    check(half == CHECK, 'approval: status alone cannot change without review fields and business', f'got {half}')
    business = str(uuid4())
    transaction = connection.begin_nested()
    try:
        connection.execute(text("insert into businesses (id,name,created_at) values (:id,'Atomic Stall',now())"), {'id': business})
        connection.execute(text("update business_applications set status='APPROVED', reviewed_at=now(), reviewed_by_platform_admin_id=:admin, "
                                "review_notes='approved', provisioned_business_id=:business, updated_at=now() where id=:id and status='PENDING'"),
                           {'admin': admin, 'business': business, 'id': pending})
        transaction.commit()
        result = 'accepted'
    except DBAPIError as error:
        transaction.rollback()
        result = getattr(error.orig, 'sqlstate', None)
    row = connection.execute(text('select status, provisioned_business_id, reviewed_by_platform_admin_id, reviewed_at is not null '
                                  'from business_applications where id=:id'), {'id': pending}).one()
    check(result == 'accepted' and tuple(row) == ('APPROVED', business, admin, True),
          'approval: business and review fields commit atomically with PENDING -> APPROVED', f'{result} {tuple(row)}')
    again = connection.execute(text("update business_applications set status='APPROVED' where id=:id and status='PENDING'"), {'id': pending}).rowcount
    check(again == 0, 'approval: a repeated approval matches no PENDING row (idempotent)', f'rows {again}')


def main() -> int:
    raw = os.environ.get('MIGRATION_CHECK_URL', '')
    if not raw:
        print('Set MIGRATION_CHECK_URL to a superuser URL on a local PostgreSQL server.')
        return 2
    admin_url = make_url(raw)
    if admin_url.get_backend_name() != 'postgresql' or admin_url.host not in LOCAL_HOSTS:
        print('Refusing: MIGRATION_CHECK_URL must be PostgreSQL on localhost (throwaway CI database only).')
        return 2
    admin = create_engine(admin_url.set(drivername='postgresql+psycopg'), isolation_level='AUTOCOMMIT')
    with admin.connect() as connection:
        server = connection.execute(text('show server_version')).scalar()
        if not connection.execute(text('select rolsuper from pg_roles where rolname=current_user')).scalar():
            print('Refusing: MIGRATION_CHECK_URL must connect as a superuser of the throwaway server.')
            return 2
    print(f'Maknam POS migration verification  (PostgreSQL {server}, head {HEAD})')
    created_roles = []
    databases = {name: f'maknam_migration_{name}_{uuid4().hex[:8]}' for name in ('fresh', 'upgrade')}
    try:
        with admin.connect() as connection:
            for name in databases.values():
                connection.execute(text(f'create database "{name}"'))
        url = lambda name: admin_url.set(drivername='postgresql+psycopg', database=name).render_as_string(hide_password=False)  # noqa: E731
        verify_fresh(url(databases['fresh']))
        with admin.connect() as connection:
            for role in CLIENT_ROLES:
                if not connection.execute(text('select 1 from pg_roles where rolname=:r'), {'r': role}).scalar():
                    connection.execute(text(f'create role {role} nologin'))
                    created_roles.append(role)
        verify_upgrade(url(databases['upgrade']))
    except Exception as error:
        check(False, 'migration run completed', f'{type(error).__name__}: {error}')
    finally:
        with admin.connect() as connection:
            for name in databases.values():
                connection.execute(text(f'drop database if exists "{name}" with (force)'))
            for role in created_roles:
                connection.execute(text(f'drop role if exists {role}'))
        admin.dispose()
    for ok, name, detail in results:
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f'\n    {detail}' if detail and not ok else ''))
    failed = sum(1 for ok, _, _ in results if not ok)
    print(f'{len(results) - failed} passed, {failed} failed')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
