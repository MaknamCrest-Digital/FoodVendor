from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.models import MenuItem
from app.schemas.sync import SyncEnvelope, SyncAck
from app.services.sync_service import process_event
from app.core.auth import current_user, enforce_scope
from app.models.admin import User
from sqlalchemy.exc import IntegrityError
from app.core.access import require_permission

router = APIRouter(prefix="/api/v1")

@router.get("/health")
def health():
    return {"status": "ok", "api_version": "v1", "app_release": "1.0.0", "sync_protocol": 2}

@router.get("/compatibility")
def compatibility():
    return {"api_version": "v1", "supported_sync_protocols": [1,2], "minimum_pos_version": "0.1.0", "update_policy": "optional"}

@router.get("/menu/{business_id}")
def menu(business_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    enforce_scope(user, business_id)
    return list(db.scalars(select(MenuItem).where(MenuItem.business_id == business_id)).all())

@router.post("/sync/events", response_model=SyncAck)
def sync_event(event: SyncEnvelope, db: Session = Depends(get_db), idempotency_key: str | None = Header(default=None), user: User = Depends(current_user)):
    enforce_scope(user,event.business_id,event.location_id)
    require_permission(db,user,'pos.sale.create')
    if event.payload.cashier_id is not None and event.payload.cashier_id!=user.id:raise HTTPException(403,'Sale operator does not match authenticated user')
    event.payload.cashier_id=user.id
    if not event.payload.cashier_name:event.payload.cashier_name=user.name
    # Optional for existing protocol-1 clients. The UUID event_id remains the
    # unique transaction key; a supplied header must identify that same event.
    if idempotency_key is not None and idempotency_key != event.event_id:
        raise HTTPException(409, "Idempotency-Key must match event_id")
    try:
        return process_event(db, event, user)
    except PermissionError as exc:
        db.rollback()
        raise HTTPException(403, str(exc))
    except ValueError as exc:
        db.rollback()
        raise HTTPException(409, str(exc))
    except IntegrityError:
        db.rollback()
        raise HTTPException(409,'Concurrent update; retry the same event')
    except HTTPException:
        db.rollback()
        raise
