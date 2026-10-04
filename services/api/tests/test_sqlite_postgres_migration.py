from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine, select

from app.db.session import Base
from app.models.models import Business, Location, Terminal, Order
from app.models.admin import User
from app.migrate_sqlite_to_postgres import MigrationError, _backup_sqlite, _preflight_transfer, transfer_rows


def _source_and_target():
    source=create_engine('sqlite://')
    target=create_engine('sqlite://')
    Base.metadata.create_all(source)
    Base.metadata.create_all(target)
    with source.begin() as connection:
        connection.execute(Business.__table__.insert().values(id='demo-business',name='Fictional Demo'))
        connection.execute(Location.__table__.insert().values(id='demo-location',business_id='demo-business',name='Branch'))
        connection.execute(Terminal.__table__.insert().values(id='demo-terminal',business_id='demo-business',location_id='demo-location',name='POS-1',app_version='1.0',local_schema_version=1,sync_protocol_version=1))
        connection.execute(User.__table__.insert().values(id='demo-user',business_id='demo-business',location_id='demo-location',name='Cashier',email='cashier@example.invalid',password_hash=None,supabase_user_id='01234567-89ab-cdef-0123-456789abcdef',role='CASHIER',active=True))
        connection.execute(Order.__table__.insert().values(id='demo-order',business_id='demo-business',location_id='demo-location',terminal_id='demo-terminal',receipt_no='DEMO-1',total_pesewas=1250,payment_method='CASH',occurred_at=datetime(2026,10,4,tzinfo=timezone.utc),payload={'items':[]},synced_at=datetime(2026,10,4,tzinfo=timezone.utc)))
    return source,target


def test_transfer_copies_in_dependency_order_and_is_idempotent():
    source,target=_source_and_target()
    try:
        with source.connect() as source_connection, target.begin() as target_connection:
            first=transfer_rows(source_connection,target_connection)
        assert first['businesses']['copied']==1
        assert first['orders']['copied']==1
        with source.connect() as source_connection, target.begin() as target_connection:
            second=transfer_rows(source_connection,target_connection)
        assert sum(item['copied'] for item in second.values())==0
        assert sum(item['unchanged'] for item in second.values())==5
        with target.connect() as connection:
            assert connection.execute(select(Order.total_pesewas)).scalar_one()==1250
    finally:
        source.dispose();target.dispose()


def test_preflight_reports_prospective_rows_without_persisting_them():
    source,target=_source_and_target()
    try:
        with source.connect() as source_connection, target.connect() as target_connection:
            report=_preflight_transfer(source_connection,target_connection)
            assert report['orders']['copied']==1
            assert target_connection.execute(select(Order.id)).first() is None
    finally:
        source.dispose();target.dispose()


def test_transfer_stops_on_conflict_and_preserves_target_rows():
    source,target=_source_and_target()
    try:
        with target.begin() as connection:
            connection.execute(Business.__table__.insert().values(id='demo-business',name='Different Existing Tenant'))
        with source.connect() as source_connection, pytest.raises(MigrationError,match='Conflicting existing primary key'):
            with target.begin() as target_connection:
                transfer_rows(source_connection,target_connection)
        with target.connect() as connection:
            assert connection.execute(select(Business.name).where(Business.id=='demo-business')).scalar_one()=='Different Existing Tenant'
            assert connection.execute(select(Location.id)).first() is None
    finally:
        source.dispose();target.dispose()


def test_transfer_maps_nullable_columns_missing_from_older_sqlite_revision():
    source=create_engine('sqlite://')
    target=create_engine('sqlite://')
    Base.metadata.create_all(target)
    legacy_tables=[table for table in Base.metadata.sorted_tables if table.name!='users']
    Base.metadata.create_all(source,tables=legacy_tables)
    with source.begin() as connection:
        connection.exec_driver_sql('CREATE TABLE users (id VARCHAR(36) PRIMARY KEY, business_id VARCHAR(36) NOT NULL REFERENCES businesses(id), location_id VARCHAR(36) NOT NULL REFERENCES locations(id), name VARCHAR(120) NOT NULL, email VARCHAR(254) NOT NULL, password_hash VARCHAR(256) NOT NULL, role VARCHAR(32) NOT NULL, active BOOLEAN NOT NULL, CONSTRAINT uq_users_email UNIQUE (email))')
        connection.exec_driver_sql('CREATE INDEX ix_users_business_id ON users (business_id)')
        connection.exec_driver_sql('CREATE INDEX ix_users_location_id ON users (location_id)')
    try:
        with source.begin() as connection:
            connection.execute(Business.__table__.insert().values(id='old-business',name='Old tenant'))
            connection.execute(Location.__table__.insert().values(id='old-location',business_id='old-business',name='Branch'))
            connection.execute(Terminal.__table__.insert().values(id='old-terminal',business_id='old-business',location_id='old-location',name='POS',app_version='1',local_schema_version=1,sync_protocol_version=1))
            connection.exec_driver_sql("INSERT INTO users (id,business_id,location_id,name,email,password_hash,role,active) VALUES ('old-user','old-business','old-location','Owner','owner@example.invalid','legacy-hash','ADMIN',1)")
        with source.connect() as source_connection, target.begin() as target_connection:
            report=transfer_rows(source_connection,target_connection)
        assert report['users']['copied']==1
        with target.connect() as connection:
            row=connection.execute(select(User.__table__).where(User.id=='old-user')).mappings().one()
            assert row['supabase_user_id'] is None
            assert row['password_hash'] is None
    finally:
        source.dispose();target.dispose()


def test_sqlite_backup_is_created_without_overwriting_existing_files(tmp_path):
    source_path=tmp_path/'source.db'
    backup_path=tmp_path/'protected-backup.db'
    source=create_engine(f'sqlite:///{source_path}')
    Base.metadata.create_all(source)
    with source.begin() as connection:
        connection.execute(Business.__table__.insert().values(id='backup-tenant',name='Backup test'))
    source.dispose()
    _backup_sqlite(source_path,backup_path)
    backup=create_engine(f'sqlite:///{backup_path}')
    try:
        with backup.connect() as connection:
            assert connection.execute(select(Business.name).where(Business.id=='backup-tenant')).scalar_one()=='Backup test'
    finally:
        backup.dispose()
    with pytest.raises(MigrationError,match='already exists'):
        _backup_sqlite(source_path,backup_path)
