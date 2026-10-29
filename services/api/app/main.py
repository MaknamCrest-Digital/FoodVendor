from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import router
from app.db.session import Base, engine
from app.models.models import *  # noqa
from app.core.config import settings
from app.models.admin import User, LoginSession, AdminEvent, AdminRecord  # noqa
from app.models.access import Permission,Role,RolePermission,UserRole,UserPermissionOverride,ScopedSetting,SecurityAudit  # noqa
from app.models.platform import PlatformAdmin, BusinessApplication, PlatformAudit  # noqa
from app.api.auth_routes import router as auth_router
from app.api.admin_routes import router as admin_router
from app.api.team_routes import router as team_router
from app.api.settings_routes import router as settings_router
from app.api.health_routes import router as health_router

app = FastAPI(title="Food Vendor OS API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True, allow_methods=["GET","POST","PUT","OPTIONS"], allow_headers=["Authorization","Content-Type","Idempotency-Key"])
app.include_router(health_router)
app.include_router(router)
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(team_router)
app.include_router(settings_router)

@app.on_event("startup")
def startup():
    # Local SQLite dev convenience only. Cloud (PostgreSQL) schema changes MUST use Alembic.
    if settings.environment == 'development' and settings.is_sqlite:
        Base.metadata.create_all(bind=engine)
