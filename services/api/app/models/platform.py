"""Platform records (0006): vendor applications, platform administrators and their audit.

Platform administrators are not tenant users. They have no business, location or
tenant role, so tenant role management can never grant platform access.
"""
from datetime import datetime
from sqlalchemy import String, Text, Boolean, DateTime, ForeignKey, JSON, CheckConstraint, UniqueConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column
from app.db.session import Base
from app.models.models import uid, now

# PENDING -> APPROVED (provisions exactly one business) or PENDING -> REJECTED.
# Both outcomes are terminal; the approval service validates transitions in a transaction.
APPLICATION_STATUSES = ('PENDING', 'APPROVED', 'REJECTED')
# Review fields must agree with the status, so an approval can never be half-recorded and
# a repeated approval finds the business already provisioned (idempotency anchor).
APPLICATION_REVIEW_STATE = (
    "(status = 'PENDING' AND reviewed_at IS NULL AND provisioned_business_id IS NULL)"
    " OR (status = 'APPROVED' AND reviewed_at IS NOT NULL AND provisioned_business_id IS NOT NULL)"
    " OR (status = 'REJECTED' AND reviewed_at IS NOT NULL AND provisioned_business_id IS NULL)"
)
# Audit rows without an administrator are reserved for SYSTEM_* actions.
AUDIT_ACTOR_RULE = "platform_admin_id IS NOT NULL OR substr(action, 1, 7) = 'SYSTEM_'"


class PlatformAdmin(Base):
    __tablename__ = 'platform_admins'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    auth_provider: Mapped[str] = mapped_column(String(32))
    auth_subject: Mapped[str] = mapped_column(String(255))
    # No default: activating a platform administrator is always explicit.
    is_active: Mapped[bool] = mapped_column(Boolean)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    __table_args__ = (UniqueConstraint('auth_provider', 'auth_subject', name='uq_platform_admins_auth_identity'),)


class BusinessApplication(Base):
    __tablename__ = 'business_applications'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    # Taken from the verified identity, never from the request body. Not unique: one
    # person may apply for several businesses.
    auth_provider: Mapped[str] = mapped_column(String(32))
    auth_subject: Mapped[str] = mapped_column(String(255))
    contact_email: Mapped[str] = mapped_column(String(254))
    contact_phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    business_name: Mapped[str] = mapped_column(String(120))
    business_category: Mapped[str | None] = mapped_column(String(80), nullable=True)
    business_address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default='PENDING', server_default='PENDING')
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_by_platform_admin_id: Mapped[str | None] = mapped_column(ForeignKey('platform_admins.id'), nullable=True)
    review_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    provisioned_business_id: Mapped[str | None] = mapped_column(ForeignKey('businesses.id'), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)
    __table_args__ = (
        CheckConstraint("status IN ('PENDING','APPROVED','REJECTED')", name='ck_business_applications_status'),
        CheckConstraint(APPLICATION_REVIEW_STATE, name='ck_business_applications_review_state'),
        UniqueConstraint('provisioned_business_id', name='uq_business_applications_provisioned_business_id'),
        Index('ix_business_applications_status_submitted_at', 'status', 'submitted_at'),
        Index('ix_business_applications_auth_identity', 'auth_provider', 'auth_subject'),
    )


class PlatformAudit(Base):
    __tablename__ = 'platform_audit'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    platform_admin_id: Mapped[str | None] = mapped_column(ForeignKey('platform_admins.id'), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(80))
    target_type: Mapped[str] = mapped_column(String(40))
    target_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # Column "metadata" (the attribute name is reserved by SQLAlchemy). Never store
    # credentials, tokens, passwords or raw auth payloads here.
    details: Mapped[dict | None] = mapped_column('metadata', JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    __table_args__ = (
        CheckConstraint(AUDIT_ACTOR_RULE, name='ck_platform_audit_actor'),
        Index('ix_platform_audit_target', 'target_type', 'target_id'),
    )
