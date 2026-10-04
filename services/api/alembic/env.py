from logging.config import fileConfig
from sqlalchemy import create_engine, pool
from alembic import context
from app.db.session import Base, engine_options
from app.models.models import *  # noqa
from app.models.admin import *  # noqa
from app.models.access import *  # noqa
from app.core.config import settings
config=context.config
if config.config_file_name and config.get_section('loggers'): fileConfig(config.config_file_name)
target_metadata=Base.metadata

def run_migrations_offline():
    context.configure(url=settings.database_url,target_metadata=target_metadata,literal_binds=True,compare_type=True)
    with context.begin_transaction(): context.run_migrations()
def run_migrations_online():
    # settings.database_url is normalized (psycopg 3) and may contain characters
    # that configparser interpolation would mangle, so it is not written to config.
    options={key:value for key,value in engine_options().items() if not key.startswith('pool') and key!='max_overflow'}
    connectable=create_engine(settings.database_url,poolclass=pool.NullPool,**options)
    with connectable.connect() as connection:
        context.configure(connection=connection,target_metadata=target_metadata,compare_type=True)
        with context.begin_transaction(): context.run_migrations()
if context.is_offline_mode(): run_migrations_offline()
else: run_migrations_online()
