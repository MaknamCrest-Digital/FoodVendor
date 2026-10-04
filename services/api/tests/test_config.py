import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.db.session import engine_options

SUPABASE = 'postgresql://postgres.ref:p%40ss@aws-0-eu-west-1.pooler.supabase.com:5432/postgres'


def make(**values):
    return Settings(_env_file=None, **values)


def test_postgres_urls_use_psycopg3():
    assert make(database_url='postgres://u:p@localhost/db').database_url.startswith('postgresql+psycopg://')
    assert make(database_url=SUPABASE, environment='pilot').database_url.startswith('postgresql+psycopg://')


def test_development_refuses_cloud_database_and_cloud_refuses_sqlite():
    with pytest.raises(ValidationError):
        make(database_url=SUPABASE, environment='development')
    with pytest.raises(ValidationError):
        make(database_url='sqlite:///./x.db', environment='pilot')
    with pytest.raises(ValidationError):
        make(database_url=SUPABASE, environment='staging')


def test_cors_origins_are_explicit_in_cloud():
    assert make(database_url=SUPABASE, environment='pilot', cors_origins='https://pilot.example.com/, https://x.example.com').cors_origins == ['https://pilot.example.com', 'https://x.example.com']
    with pytest.raises(ValidationError):
        make(database_url=SUPABASE, environment='pilot', cors_origins='*')


def test_remote_postgres_requires_tls_and_pools():
    remote = engine_options(make(database_url=SUPABASE, environment='pilot').database_url)
    assert remote['connect_args']['sslmode'] == 'require' and remote['pool_pre_ping'] and remote['pool_recycle'] > 0
    assert 'prepare_threshold' not in remote['connect_args']
    transaction = engine_options(SUPABASE.replace(':5432', ':6543'))
    assert transaction['connect_args']['prepare_threshold'] is None
    assert 'sslmode' not in engine_options('postgresql+psycopg://u:p@localhost/db')['connect_args']


def test_serverless_uses_no_client_pool(monkeypatch):
    from app.core.config import settings
    from sqlalchemy.pool import NullPool
    monkeypatch.setattr(settings, 'db_null_pool', True)
    options = engine_options(SUPABASE.replace(':5432', ':6543'))
    assert options['poolclass'] is NullPool and 'pool_size' not in options
    assert options['connect_args']['prepare_threshold'] is None and options['connect_args']['sslmode'] == 'require'
