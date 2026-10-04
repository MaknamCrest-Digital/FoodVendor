"""Safely copy a migrated SQLite API database into the configured PostgreSQL API database."""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from datetime import date, datetime, time, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import DateTime, MetaData, String, and_, create_engine, inspect, select, text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.core.config import settings
from app.db.session import Base
from app.models import access, admin, models  # noqa: F401

SKIPPED_TABLES = {'alembic_version', 'login_sessions'}
SKIPPED_COLUMNS = {'users': {'password_hash'}}


class MigrationError(RuntimeError):
    pass


def _api_path() -> Path:
    return Path(__file__).resolve().parent.parent


def _alembic_config(database_url: str) -> Config:
    config = Config(str(_api_path() / 'alembic.ini'))
    config.set_main_option('script_location', str(_api_path() / 'alembic'))
    config.set_main_option('sqlalchemy.url', database_url.replace('%', '%%'))
    return config


def _source_engine(source_url: str) -> Engine:
    url = make_url(source_url)
    if not url.drivername.startswith('sqlite'):
        raise MigrationError('Source must be a SQLite database URL.')
    if url.database in (None, '', ':memory:'):
        raise MigrationError('Source must be an existing file-backed SQLite database.')
    path = Path(url.database).resolve()
    if not path.is_file():
        raise MigrationError('Source SQLite database file does not exist.')
    uri = f'{path.as_uri()}?mode=ro'
    return create_engine('sqlite+pysqlite://', creator=lambda: sqlite3.connect(uri, uri=True))


def _source_path(source_url: str) -> Path:
    return Path(make_url(source_url).database).resolve()


def _revision(connection) -> str:
    inspector = inspect(connection)
    if 'alembic_version' not in inspector.get_table_names():
        raise MigrationError('Source database has no Alembic revision; schema provenance is unknown.')
    rows = connection.execute(text('SELECT version_num FROM alembic_version')).scalars().all()
    if len(rows) != 1:
        raise MigrationError('Source database must have exactly one Alembic revision.')
    return rows[0]


def _canonical(value: Any):
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        else:
            value = value.astimezone(timezone.utc)
        return value.isoformat()
    if isinstance(value, (date, time)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, memoryview):
        return bytes(value)
    if isinstance(value, (dict, list)):
        return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
    return value


def _schema_signature(inspector, metadata: MetaData, side: str):
    actual_tables = set(inspector.get_table_names()) - {'alembic_version'}
    expected_tables = set(metadata.tables)
    if actual_tables != expected_tables:
        missing = sorted(expected_tables - actual_tables)
        extra = sorted(actual_tables - expected_tables)
        raise MigrationError(f'{side} table set differs from the canonical ORM schema; missing={missing}, extra={extra}.')

    signatures = {}
    for name, table in metadata.tables.items():
        actual_columns = {column['name']: column for column in inspector.get_columns(name)}
        expected_columns = {column.name: column for column in table.columns}
        missing = sorted(set(expected_columns) - set(actual_columns))
        extra = sorted(set(actual_columns) - set(expected_columns))
        if extra:
            raise MigrationError(f'{side}.{name} has noncanonical columns: {extra}.')
        for column_name in missing:
            expected = expected_columns[column_name]
            if not expected.nullable and expected.default is None and expected.server_default is None:
                raise MigrationError(f'{side}.{name}.{column_name} is missing a required canonical column.')

        for column_name in set(actual_columns) & set(expected_columns):
            actual = actual_columns[column_name]
            expected = expected_columns[column_name]
            if actual['type']._type_affinity is not expected.type._type_affinity:
                raise MigrationError(f'{side}.{name}.{column_name} has a type incompatible with the canonical schema.')
            if isinstance(expected.type, String) and expected.type.length:
                actual_length = getattr(actual['type'], 'length', None)
                if actual_length not in (None, expected.type.length):
                    raise MigrationError(f'{side}.{name}.{column_name} has a different string length.')
            if actual['nullable'] and not expected.nullable:
                connection = inspector.bind
                has_nulls = connection.execute(text(f'SELECT 1 FROM "{name}" WHERE "{column_name}" IS NULL LIMIT 1')).first()
                if has_nulls:
                    raise MigrationError(f'{side}.{name}.{column_name} has null values but the canonical schema requires values.')

        actual_pk = tuple(inspector.get_pk_constraint(name).get('constrained_columns') or ())
        expected_pk = tuple(column.name for column in table.primary_key.columns)
        if set(actual_pk) != set(expected_pk):
            raise MigrationError(f'{side}.{name} primary key differs from the canonical schema.')

        actual_fks = {
            (tuple(fk['constrained_columns']), fk['referred_table'], tuple(fk['referred_columns']))
            for fk in inspector.get_foreign_keys(name)
        }
        expected_fks = {
            ((foreign_key.parent.name,), foreign_key.column.table.name, (foreign_key.column.name,))
            for column in table.columns for foreign_key in column.foreign_keys
        }
        if actual_fks != expected_fks:
            raise MigrationError(f'{side}.{name} foreign-key relationships differ from the canonical schema.')

        actual_unique = {
            tuple(constraint['column_names'])
            for constraint in inspector.get_unique_constraints(name)
            if constraint.get('column_names')
        }
        actual_unique.update(
            tuple(index['column_names'])
            for index in inspector.get_indexes(name)
            if index.get('unique') and index.get('column_names')
        )
        expected_unique = {tuple(constraint.columns.keys()) for constraint in table.constraints if constraint.__class__.__name__ == 'UniqueConstraint'}
        expected_unique.update(tuple(index.expressions[0].name for index in table.indexes if index.unique and len(index.expressions) == 1))
        expected_unique = {columns for columns in expected_unique if set(columns).issubset(actual_columns)}
        if actual_unique != expected_unique:
            raise MigrationError(f'{side}.{name} unique constraints differ from the canonical schema.')

        actual_indexes = {
            tuple(index['column_names'])
            for index in inspector.get_indexes(name)
            if index.get('column_names') and not index.get('unique')
        }
        expected_indexes = {
            tuple(expression.name for expression in index.expressions)
            for index in table.indexes if not index.unique
        }
        if actual_indexes != expected_indexes:
            raise MigrationError(f'{side}.{name} indexes differ from the canonical schema.')
        signatures[name] = (actual_columns, table)
    return signatures


def _backup_sqlite(source_path: Path, backup_path: Path):
    if backup_path.exists():
        raise MigrationError('Backup path already exists; choose a new backup filename.')
    if not backup_path.parent.is_dir():
        raise MigrationError('Backup directory must already exist and be access-controlled.')
    source = sqlite3.connect(f'file:{source_path.as_posix()}?mode=ro', uri=True)
    try:
        with backup_path.open('xb'):
            pass
        target = sqlite3.connect(str(backup_path))
        try:
            source.backup(target)
            target.commit()
        finally:
            target.close()
    except Exception:
        if backup_path.exists() and backup_path.stat().st_size == 0:
            backup_path.unlink()
        raise
    finally:
        source.close()


def _row_count(connection, table_name: str) -> int:
    return int(connection.execute(text(f'SELECT COUNT(*) FROM "{table_name}"')).scalar_one())


def transfer_rows(source_connection, target_connection, metadata: MetaData = Base.metadata):
    """Merge source rows without overwriting; rollback on any ambiguous collision."""
    source_inspector = inspect(source_connection)
    target_inspector = inspect(target_connection)
    _schema_signature(source_inspector, metadata, 'Source SQLite')
    _schema_signature(target_inspector, metadata, 'Target PostgreSQL')
    report = {}
    source_metadata = MetaData()
    source_metadata.reflect(bind=source_connection, only=list(metadata.tables))
    for table in metadata.sorted_tables:
        name = table.name
        source_table = source_metadata.tables[name]
        source_count = _row_count(source_connection, name)
        target_count_before = _row_count(target_connection, name)
        if name == 'login_sessions':
            report[name] = {'source_rows': source_count, 'target_rows_before': target_count_before, 'target_rows_after': target_count_before, 'copied': 0, 'unchanged': 0, 'skipped': source_count}
            continue
        copied = 0
        unchanged = 0
        primary_keys = list(table.primary_key.columns)
        if not primary_keys:
            raise MigrationError(f'{name} has no primary key and cannot be safely merged.')
        rows = source_connection.execute(select(source_table)).mappings()
        for source_row in rows:
            values = {column: value for column, value in dict(source_row).items()
                      if column not in SKIPPED_COLUMNS.get(name, set())}
            key_filter = and_(*(column == values[column.name] for column in primary_keys))
            existing = target_connection.execute(select(table).where(key_filter)).mappings().first()
            if existing is not None:
                same = all(_canonical(existing.get(column)) == _canonical(value) for column, value in values.items())
                if not same:
                    raise MigrationError(f'Conflicting existing primary key encountered in table {name}; no rows were overwritten.')
                unchanged += 1
                continue
            for column in table.columns:
                if column.name in values and isinstance(column.type, DateTime):
                    value = values[column.name]
                    if isinstance(value, datetime):
                        values[column.name] = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
                if column.name not in values:
                    if column.nullable:
                        values[column.name] = None
                    elif column.default is not None or column.server_default is not None:
                        continue
                    else:
                        raise MigrationError(f'{name}.{column.name} is required by the target but absent in the source.')
            try:
                target_connection.execute(table.insert().values(**values))
            except IntegrityError as error:
                raise MigrationError(f'Unique or foreign-key conflict while importing table {name}; transaction was rolled back.') from error
            copied += 1
        report[name] = {'source_rows': source_count, 'target_rows_before': target_count_before, 'target_rows_after': _row_count(target_connection, name), 'copied': copied, 'unchanged': unchanged, 'skipped': 0}
    return report


def _preflight_transfer(source_connection, target_connection):
    transaction = target_connection.begin()
    try:
        return transfer_rows(source_connection, target_connection)
    finally:
        transaction.rollback()


def run(source_url: str, apply: bool = False, backup_path: str | None = None, confirm_target: str | None = None):
    target_url = settings.database_url
    target = make_url(target_url)
    if target.drivername not in {'postgresql', 'postgresql+psycopg'}:
        raise MigrationError('Configured DATABASE_URL is not PostgreSQL; no data was changed.')
    if target.database != confirm_target:
        raise MigrationError('Pass --confirm-target matching the PostgreSQL database name to acknowledge the destination.')
    if not apply and backup_path:
        raise MigrationError('--backup-path is only valid with --apply.')
    if apply and not backup_path:
        raise MigrationError('--backup-path is required with --apply.')

    config = _alembic_config(target_url)
    heads = set(ScriptDirectory.from_config(config).get_heads())
    source_engine = _source_engine(source_url)
    target_engine = create_engine(target_url, pool_pre_ping=True)
    try:
        with source_engine.connect() as source_connection:
            source_revision = _revision(source_connection)
            if ScriptDirectory.from_config(config).get_revision(source_revision) is None:
                raise MigrationError(f'Source Alembic revision {source_revision} is not present in this code version.')
            source_connection.rollback()
            with target_engine.connect() as target_connection:
                target_transaction = target_connection.begin()
                try:
                    target_inspector = inspect(target_connection)
                    if 'alembic_version' not in target_inspector.get_table_names():
                        raise MigrationError('Target PostgreSQL has no Alembic revision; apply migrations before data import.')
                    target_revisions = set(target_connection.execute(text('SELECT version_num FROM alembic_version')).scalars().all())
                    if target_revisions != heads:
                        raise MigrationError('Target PostgreSQL is not at the current Alembic head; apply migrations before data import.')
                    report = transfer_rows(source_connection, target_connection)
                finally:
                    target_transaction.rollback()
        total = {
            'source_rows': sum(row['source_rows'] for row in report.values()),
            'copied': sum(row['copied'] for row in report.values()),
            'unchanged': sum(row['unchanged'] for row in report.values()),
            'skipped': sum(row['skipped'] for row in report.values()),
        }
        if apply:
            _backup_sqlite(_source_path(source_url), Path(backup_path).resolve())
            with source_engine.connect() as source_connection:
                source_connection.exec_driver_sql('BEGIN')
                with target_engine.begin() as target_connection:
                    report = transfer_rows(source_connection, target_connection)
            total = {
                'source_rows': sum(row['source_rows'] for row in report.values()),
                'copied': sum(row['copied'] for row in report.values()),
                'unchanged': sum(row['unchanged'] for row in report.values()),
                'skipped': sum(row['skipped'] for row in report.values()),
            }
        return {
            'mode': 'apply' if apply else 'dry-run',
            'source_revision': source_revision,
            'target_database': target.database,
            'tables': report,
            'totals': total,
            'backup': str(Path(backup_path).resolve()) if apply else None,
        }
    except SQLAlchemyError as error:
        raise MigrationError(f'Database operation failed ({type(error).__name__}); credentials and record values were not logged.') from error
    finally:
        source_engine.dispose()
        target_engine.dispose()


def main():
    parser = argparse.ArgumentParser(description='Preflight or safely merge a SQLite API database into the configured PostgreSQL database.')
    parser.add_argument('--source', required=True, help='File-backed SQLite SQLAlchemy URL, e.g. sqlite:///./maknam_local.db')
    parser.add_argument('--apply', action='store_true', help='Write after preflight; default is read-only dry-run.')
    parser.add_argument('--confirm-target', help='Must match the PostgreSQL database name from the server-side DATABASE_URL.')
    parser.add_argument('--backup-path', help='New protected destination for a SQLite online backup; mandatory with --apply.')
    args = parser.parse_args()
    try:
        result = run(args.source, apply=args.apply, backup_path=args.backup_path, confirm_target=args.confirm_target)
    except MigrationError as error:
        print(f'Migration stopped safely: {error}', file=sys.stderr)
        raise SystemExit(2) from error
    print(json.dumps(result, indent=2))
    if not args.apply:
        print('Dry-run only: no database records were changed.')


if __name__ == '__main__':
    main()
