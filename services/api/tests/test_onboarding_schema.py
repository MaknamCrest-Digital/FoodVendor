"""0006 tenant onboarding schema on SQLite (dev databases, ORM create_all and the SQLite
transfer tool). PostgreSQL, RLS and client-role checks live in scripts/verify_migrations.py."""
from datetime import datetime, timezone
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.core.access import PERMISSIONS
from app.core.config import settings
from app.db.session import Base
from app.migrate_sqlite_to_postgres import MigrationError, transfer_rows
from app.models.models import Business
from app.models.platform import BusinessApplication, PlatformAdmin, PlatformAudit

API_DIR = Path(__file__).resolve().parents[1]
PLATFORM_TABLES = {'platform_admins', 'business_applications', 'platform_audit'}


def alembic_config():
    config = Config(str(API_DIR / 'alembic.ini'))
    config.set_main_option('script_location', str(API_DIR / 'alembic'))
    return config


def test_sqlite_chain_upgrades_existing_businesses_and_refuses_downgrade(tmp_path, monkeypatch):
    url = f'sqlite:///{(tmp_path / "dev.db").as_posix()}'
    monkeypatch.setattr(settings, 'database_url', url)
    config = alembic_config()
    command.upgrade(config, '0005_supabase_lockdown')
    engine = create_engine(url)
    with engine.begin() as connection:
        connection.execute(text("insert into businesses (id,name,created_at) values ('old','Existing tenant','2026-01-01 00:00:00')"))
    command.upgrade(config, 'head')
    with engine.connect() as connection:
        assert connection.execute(text("select status,name from businesses where id='old'")).one() == ('ACTIVE', 'Existing tenant')
        assert PLATFORM_TABLES <= set(inspect(connection).get_table_names())
        assert connection.execute(text('select version_num from alembic_version')).scalar() == '0006_tenant_onboarding'
    with engine.begin() as connection, pytest.raises(IntegrityError):
        connection.execute(text("update businesses set status='DELETED' where id='old'"))
    command.upgrade(config, 'head')  # re-running is a no-op
    with pytest.raises(RuntimeError, match='Rollback application code'):
        command.downgrade(config, '0005_supabase_lockdown')
    with engine.connect() as connection:
        assert connection.execute(text("select status from businesses where id='old'")).scalar() == 'ACTIVE'
        assert connection.execute(text('select version_num from alembic_version')).scalar() == '0006_tenant_onboarding'
    engine.dispose()


@pytest.fixture
def db():
    engine = create_engine('sqlite://')
    event.listen(engine, 'connect', lambda connection, _: connection.execute('pragma foreign_keys=on'))
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    session.add(Business(id='tenant', name='Tenant'))
    session.add(PlatformAdmin(id='admin', auth_provider='supabase', auth_subject='subject-1', is_active=True))
    session.commit()
    yield session
    session.close()
    engine.dispose()


def rejected(db, row):
    db.add(row)
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
    return True


def test_orm_defaults_new_records_to_active_and_pending(db):
    assert db.get(Business, 'tenant').status == 'ACTIVE'
    application = BusinessApplication(auth_provider='supabase', auth_subject='applicant', contact_email='a@example.test', business_name='Stall')
    db.add(application)
    db.commit()
    assert application.status == 'PENDING' and application.submitted_at and application.updated_at


def test_orm_rejects_invalid_statuses_and_inconsistent_reviews(db):
    now = datetime.now(timezone.utc)
    assert rejected(db, Business(name='Bad', status='DELETED'))
    base = dict(auth_provider='supabase', auth_subject='applicant', contact_email='a@example.test', business_name='Stall')
    assert rejected(db, BusinessApplication(**base, status='ON_HOLD'))
    assert rejected(db, BusinessApplication(**base, status='APPROVED', reviewed_at=now))
    assert rejected(db, BusinessApplication(**base, status='REJECTED', reviewed_at=now, provisioned_business_id='tenant'))
    db.add(BusinessApplication(**base, status='APPROVED', reviewed_at=now, reviewed_by_platform_admin_id='admin', provisioned_business_id='tenant'))
    db.commit()
    assert rejected(db, BusinessApplication(**{**base, 'auth_subject': 'other'}, status='APPROVED', reviewed_at=now, provisioned_business_id='tenant'))
    assert rejected(db, BusinessApplication(**base, status='APPROVED', reviewed_at=now, provisioned_business_id='missing-business'))


def test_platform_admin_identity_is_unique_and_activation_explicit(db):
    assert rejected(db, PlatformAdmin(auth_provider='supabase', auth_subject='subject-1', is_active=False))
    assert rejected(db, PlatformAdmin(auth_provider='supabase', auth_subject='subject-2'))
    db.add(PlatformAdmin(auth_provider='other-provider', auth_subject='subject-1', is_active=False))
    db.commit()


def test_platform_audit_requires_an_admin_except_for_system_actions(db):
    db.add(PlatformAudit(action='SYSTEM_BOOTSTRAP', target_type='platform_admin', details={'note': 'created'}))
    db.add(PlatformAudit(platform_admin_id='admin', action='APPLICATION_APPROVED', target_type='business_application'))
    db.commit()
    assert rejected(db, PlatformAudit(action='APPLICATION_APPROVED', target_type='business_application'))
    assert rejected(db, PlatformAudit(platform_admin_id='missing', action='APPLICATION_APPROVED', target_type='business_application'))
    assert db.query(PlatformAudit).filter_by(action='SYSTEM_BOOTSTRAP').one().details == {'note': 'created'}


def test_platform_access_is_not_a_tenant_permission():
    assert not any(key.startswith('platform') for key in PERMISSIONS)


def test_transfer_accepts_older_sqlite_sources_without_platform_tables():
    source, target = create_engine('sqlite://'), create_engine('sqlite://')
    Base.metadata.create_all(target)
    Base.metadata.create_all(source, tables=[table for table in Base.metadata.sorted_tables if table.name not in PLATFORM_TABLES])
    with source.begin() as connection:
        # A pre-0006 businesses table has no status column.
        connection.exec_driver_sql('PRAGMA foreign_keys=off')
        connection.exec_driver_sql('CREATE TABLE businesses_old (id VARCHAR(36) PRIMARY KEY, name VARCHAR(120) NOT NULL, created_at DATETIME NOT NULL)')
        connection.exec_driver_sql('DROP TABLE businesses')
        connection.exec_driver_sql('ALTER TABLE businesses_old RENAME TO businesses')
        connection.exec_driver_sql("INSERT INTO businesses (id,name,created_at) VALUES ('legacy','Legacy tenant','2026-01-01 00:00:00')")
    try:
        with source.connect() as source_connection, target.begin() as target_connection:
            report = transfer_rows(source_connection, target_connection)
        assert report['businesses']['copied'] == 1
        assert all(report[table]['copied'] == 0 and report[table]['source_rows'] == 0 for table in PLATFORM_TABLES)
        with target.connect() as connection:
            assert connection.execute(text("select status from businesses where id='legacy'")).scalar() == 'ACTIVE'
    finally:
        source.dispose()
        target.dispose()


def test_transfer_still_refuses_sources_missing_tenant_tables():
    source, target = create_engine('sqlite://'), create_engine('sqlite://')
    Base.metadata.create_all(target)
    Base.metadata.create_all(source, tables=[table for table in Base.metadata.sorted_tables if table.name not in PLATFORM_TABLES | {'orders'}])
    try:
        with source.connect() as source_connection, target.begin() as target_connection, pytest.raises(MigrationError, match='orders'):
            transfer_rows(source_connection, target_connection)
    finally:
        source.dispose()
        target.dispose()
