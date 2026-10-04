"""Liveness and database readiness. Never return hosts, users or error text."""
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.config import settings
from app.db.session import engine

router = APIRouter(tags=['Health'])


def database_status() -> str:
    try:
        with engine.connect() as connection:
            connection.execute(text('select 1'))
        return 'connected'
    except Exception:
        return 'unavailable'


@router.get('/health')
def health():
    return {'status': 'ok', 'environment': settings.environment}


@router.get('/health/db')
@router.get('/api/v1/health/db')
def health_db():
    database = database_status()
    body = {'status': 'ok' if database == 'connected' else 'degraded', 'environment': settings.environment, 'database': database}
    return JSONResponse(body, status_code=200 if database == 'connected' else 503)
