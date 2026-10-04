from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from app.db.session import get_db
from app.core.auth import current_user
from app.models.admin import User, AdminEvent
from app.models.models import Order
from app.schemas.admin import Operation
from app.services.admin_service import apply_operation
from app.core.snapshot_access import visible_snapshot
from app.core.access import require_permission
from app.models.access import SecurityAudit

router=APIRouter(prefix='/api/v1/admin',tags=['Admin operations'])

@router.get('/security-audit')
def security_audit(user:User=Depends(current_user),db:Session=Depends(get_db)):
    require_permission(db,user,'audit.view')
    rows=db.scalars(select(SecurityAudit).where(SecurityAudit.business_id==user.business_id,SecurityAudit.location_id==user.location_id).order_by(SecurityAudit.created_at.desc()).limit(1000)).all()
    return [{'id':r.id,'actorId':r.actor_id,'action':r.action,'entityId':r.entity_id,'occurredAt':r.created_at.isoformat(),'details':r.details} for r in rows]

@router.post('/events')
def push(event:Operation,user:User=Depends(current_user),db:Session=Depends(get_db),idempotency_key:str|None=Header(default=None)):
    if idempotency_key!=event.id:raise HTTPException(409,'Idempotency-Key must match event ID')
    try:return apply_operation(db,user,event)
    except IntegrityError:
        db.rollback()
        raise HTTPException(409,'Concurrent update; retry after refreshing')

@router.get('/snapshot')
def snapshot(user:User=Depends(current_user),db:Session=Depends(get_db)):
    events=db.scalars(select(AdminEvent).where(AdminEvent.business_id==user.business_id,AdminEvent.location_id==user.location_id).order_by(AdminEvent.received_at,AdminEvent.id)).all()
    orders=db.scalars(select(Order).where(Order.business_id==user.business_id,Order.location_id==user.location_id)).all()
    events,orders=visible_snapshot(db,user,events,orders)
    return {'events':[{'id':e.id,'businessId':e.business_id,'locationId':e.location_id,'actorId':e.actor_id,'entityId':e.entity_id,'kind':e.kind,'action':e.action,'baseVersion':e.revision-1,'occurredAt':e.occurred_at.isoformat(),'data':e.data} for e in events],
        'orders':[{'id':o.id,'receiptNo':o.receipt_no,'businessId':o.business_id,'locationId':o.location_id,'terminalId':o.terminal_id,'totalPesewas':o.total_pesewas,'paymentMethod':o.payment_method,'occurredAt':o.occurred_at.isoformat(),'syncStatus':'SYNCED','cashierId':o.payload.get('cashier_id'),'cashierName':o.payload.get('cashier_name',''),'currency':o.payload.get('currency','GHS'),'amountTendered':o.payload.get('amount_tendered'),'change':o.payload.get('change',0),'paymentReference':o.payload.get('payment_reference',''),'receiptSnapshot':o.payload.get('receipt_snapshot',{}),'orderType':o.payload.get('order_type','TAKEAWAY'),'notes':o.payload.get('notes',''),'customerId':o.payload.get('customer_id'),'shiftId':o.payload.get('shift_id'),'stockMovements':o.payload.get('stock_movements',[]),'items':[{'id':i['id'],'menuItemId':i['menu_item_id'],'name':i['name'],'quantity':i['quantity'],'unitPricePesewas':i['unit_price_pesewas'],'requiresKitchen':i.get('requires_kitchen',False),'trackStock':i.get('track_stock',False),'variationId':i.get('variation_id'),'variationName':i.get('variation_name')} for i in o.payload['items']]} for o in orders]}
