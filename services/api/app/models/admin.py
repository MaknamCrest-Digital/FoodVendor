from datetime import datetime
from sqlalchemy import String, Integer, DateTime, ForeignKey, JSON, Boolean, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.session import Base
from app.models.models import uid, now


class User(Base):
    __tablename__ = 'users'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    business_id: Mapped[str] = mapped_column(ForeignKey('businesses.id'), index=True)
    location_id: Mapped[str] = mapped_column(ForeignKey('locations.id'), index=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(254), unique=True)
    password_hash: Mapped[str | None] = mapped_column(String(256), nullable=True)
    supabase_user_id: Mapped[str | None] = mapped_column(String(36), unique=True, nullable=True)
    role: Mapped[str] = mapped_column(String(32), default='ADMIN')
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class LoginSession(Base):
    __tablename__ = 'login_sessions'
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id'), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)


class AdminEvent(Base):
    __tablename__ = 'admin_events'
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    business_id: Mapped[str] = mapped_column(ForeignKey('businesses.id'), index=True)
    location_id: Mapped[str] = mapped_column(ForeignKey('locations.id'), index=True)
    actor_id: Mapped[str] = mapped_column(ForeignKey('users.id'))
    entity_id: Mapped[str] = mapped_column(String(100), index=True)
    kind: Mapped[str] = mapped_column(String(32))
    action: Mapped[str] = mapped_column(String(40))
    revision: Mapped[int] = mapped_column(Integer)
    data: Mapped[dict] = mapped_column(JSON)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    __table_args__ = (UniqueConstraint('business_id','location_id','kind','entity_id','revision',name='uq_admin_entity_revision'),)


class AdminRecord(Base):
    __tablename__ = 'admin_records'
    key: Mapped[str] = mapped_column(String(250), primary_key=True)
    business_id: Mapped[str] = mapped_column(String(36), index=True)
    location_id: Mapped[str] = mapped_column(String(36), index=True)
    kind: Mapped[str] = mapped_column(String(32))
    entity_id: Mapped[str] = mapped_column(String(100))
    revision: Mapped[int] = mapped_column(Integer)
    data: Mapped[dict] = mapped_column(JSON)
