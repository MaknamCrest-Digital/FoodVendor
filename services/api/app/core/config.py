import json
import os

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict
from sqlalchemy.engine import make_url
from typing import Annotated

ENVIRONMENTS = {'development', 'test', 'pilot', 'production'}
CLOUD_ENVIRONMENTS = {'pilot', 'production'}


def env_files():
    # .env/.env.local hold local development values. A cloud environment is
    # selected explicitly, e.g. MAKNAM_ENV_FILE=.env.pilot, so a developer
    # shell never reaches the pilot/production database by accident.
    selected = os.environ.get('MAKNAM_ENV_FILE')
    return ('.env', '.env.local', selected) if selected else ('.env', '.env.local')


class Settings(BaseSettings):
    database_url: str = "sqlite:///./food_vendor_os.db"
    environment: str = "development"
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173", "http://localhost:5174", "http://localhost", "capacitor://localhost"]
    supabase_url: str = ""
    supabase_jwt_audience: str = "authenticated"
    supabase_service_role_key: str = ""
    demo_seed_enabled: bool = False
    # Server-side pool for PostgreSQL. Supabase's session pooler limits
    # connections per project, so keep the default footprint small.
    db_pool_size: int = 5
    db_max_overflow: int = 5
    db_pool_timeout: int = 30
    db_pool_recycle: int = 1800
    db_connect_timeout: int = 10
    db_sslmode: str = "require"
    pilot_admin_email: str = "admin@adonai.test"
    pilot_admin_password: str = ""
    pilot_cashier_email: str = "cashier@adonai.test"
    pilot_cashier_password: str = ""
    model_config = SettingsConfigDict(env_file=env_files(), extra="ignore")

    @field_validator('cors_origins', mode='before')
    @classmethod
    def parse_origins(cls, value):
        # Accept a JSON array or a comma-separated list.
        if isinstance(value, str):
            text = value.strip()
            value = json.loads(text) if text.startswith('[') else [item for item in text.split(',')]
        return [origin.strip().rstrip('/') for origin in value if origin and origin.strip()]

    @field_validator('database_url')
    @classmethod
    def normalize_database_url(cls, value):
        # Supabase displays postgres:// / postgresql:// URLs; this API ships psycopg 3.
        for prefix in ('postgres://', 'postgresql://'):
            if value.startswith(prefix):
                return 'postgresql+psycopg://' + value[len(prefix):]
        return value

    @model_validator(mode='after')
    def guard_environment(self):
        if self.environment not in ENVIRONMENTS:
            raise ValueError(f'ENVIRONMENT must be one of {sorted(ENVIRONMENTS)}')
        if self.environment == 'development' and is_supabase_database(self.database_url):
            raise ValueError('Development refuses a Supabase DATABASE_URL. Use MAKNAM_ENV_FILE=.env.pilot with ENVIRONMENT=pilot.')
        if self.environment in CLOUD_ENVIRONMENTS:
            if self.database_url.startswith('sqlite'):
                raise ValueError(f'{self.environment} requires a PostgreSQL DATABASE_URL')
            if '*' in self.cors_origins:
                raise ValueError('CORS_ORIGINS must list explicit origins in a cloud environment')
        return self

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith('sqlite')


def is_supabase_database(url: str) -> bool:
    if url.startswith('sqlite'):
        return False
    host = make_url(url).host or ''
    return host.endswith('.supabase.co') or host.endswith('.supabase.com')


settings = Settings()
