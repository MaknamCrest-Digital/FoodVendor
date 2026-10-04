from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from app.core.config import settings


def engine_options(database_url: str = settings.database_url) -> dict:
    """Connection options shared by the API, Alembic and operator scripts."""
    if database_url.startswith('sqlite'):
        return {'connect_args': {'check_same_thread': False}, 'pool_pre_ping': True}
    url = make_url(database_url)
    connect_args = {'connect_timeout': settings.db_connect_timeout}
    if url.host not in (None, 'localhost', '127.0.0.1', 'db') and 'sslmode' not in url.query:
        connect_args['sslmode'] = settings.db_sslmode
    if url.port == 6543:
        # Supabase transaction pooler does not support server-side prepared statements.
        connect_args['prepare_threshold'] = None
    return {
        'connect_args': connect_args,
        'pool_pre_ping': True,
        'pool_size': settings.db_pool_size,
        'max_overflow': settings.db_max_overflow,
        'pool_timeout': settings.db_pool_timeout,
        'pool_recycle': settings.db_pool_recycle,
    }


engine = create_engine(settings.database_url, **engine_options())
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
