from datetime import datetime
from sqlalchemy import String,ForeignKey,Boolean,Integer,JSON,DateTime,UniqueConstraint
from sqlalchemy.orm import Mapped,mapped_column
from app.db.session import Base
from app.models.models import uid,now

class Permission(Base):
    __tablename__='permissions'
    key:Mapped[str]=mapped_column(String(100),primary_key=True)

class Role(Base):
    __tablename__='roles'
    id:Mapped[str]=mapped_column(String(36),primary_key=True,default=uid)
    business_id:Mapped[str]=mapped_column(ForeignKey('businesses.id'),index=True)
    name:Mapped[str]=mapped_column(String(100))
    template:Mapped[str]=mapped_column(String(30),default='CUSTOM')
    __table_args__=(UniqueConstraint('business_id','name',name='uq_tenant_role_name'),)

class RolePermission(Base):
    __tablename__='role_permissions'
    role_id:Mapped[str]=mapped_column(ForeignKey('roles.id'),primary_key=True)
    permission:Mapped[str]=mapped_column(ForeignKey('permissions.key'),primary_key=True)

class UserRole(Base):
    __tablename__='user_roles'
    user_id:Mapped[str]=mapped_column(ForeignKey('users.id'),primary_key=True)
    role_id:Mapped[str]=mapped_column(ForeignKey('roles.id'),index=True)

class UserPermissionOverride(Base):
    __tablename__='user_permission_overrides'
    user_id:Mapped[str]=mapped_column(ForeignKey('users.id'),primary_key=True)
    permission:Mapped[str]=mapped_column(ForeignKey('permissions.key'),primary_key=True)
    allowed:Mapped[bool]=mapped_column(Boolean)

class ScopedSetting(Base):
    __tablename__='scoped_settings'
    key:Mapped[str]=mapped_column(String(250),primary_key=True)
    business_id:Mapped[str]=mapped_column(ForeignKey('businesses.id'),index=True)
    scope:Mapped[str]=mapped_column(String(20))
    scope_id:Mapped[str]=mapped_column(String(36))
    section:Mapped[str]=mapped_column(String(40))
    revision:Mapped[int]=mapped_column(Integer,default=1)
    values:Mapped[dict]=mapped_column(JSON)
    updated_by:Mapped[str]=mapped_column(ForeignKey('users.id'))
    updated_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),default=now)

class SecurityAudit(Base):
    __tablename__='security_audit'
    id:Mapped[str]=mapped_column(String(36),primary_key=True,default=uid)
    business_id:Mapped[str]=mapped_column(ForeignKey('businesses.id'),index=True)
    location_id:Mapped[str]=mapped_column(ForeignKey('locations.id'),index=True)
    actor_id:Mapped[str]=mapped_column(ForeignKey('users.id'))
    action:Mapped[str]=mapped_column(String(80))
    entity_id:Mapped[str]=mapped_column(String(100))
    details:Mapped[dict]=mapped_column(JSON,default=dict)
    created_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),default=now)
