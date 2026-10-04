from sqlalchemy import select
from sqlalchemy.orm import Session
from fastapi import HTTPException
from pydantic import ValidationError
from app.models.admin import AdminEvent, AdminRecord, User
from app.models.models import Order, Terminal
from app.schemas.admin import Operation, SCHEMAS
from app.core.auth import enforce_scope
from app.core.operation_access import authorize_operation
from app.models.access import ScopedSetting

def pos_rules(db,user):
    row=db.get(ScopedSetting,f'{user.business_id}:BUSINESS:{user.business_id}:pos')
    return row.values if row else {}

IMMUTABLE={'movement','stock','cash','correction','payment','system'}
TRANSITIONS={'NEW':{'ACCEPTED','PREPARING','CANCELLED'},'ACCEPTED':{'PREPARING','CANCELLED'},'PREPARING':{'READY'},'READY':{'COMPLETED'},'COMPLETED':set(),'CANCELLED':set()}

def record_key(user,kind,entity_id):return f'{user.business_id}:{user.location_id}:{kind}:{entity_id}'
def records(db,user,kind):return db.scalars(select(AdminRecord).where(AdminRecord.business_id==user.business_id,AdminRecord.location_id==user.location_id,AdminRecord.kind==kind)).all()
def require_record(db,user,kind,entity_id):
    row=db.get(AdminRecord,record_key(user,kind,entity_id))
    if not row:raise HTTPException(409,f'Referenced {kind} is not available in this location')
    return row
def require_order(db,user,order_id):
    row=db.scalar(select(Order).where(Order.id==order_id).with_for_update())
    if not row:raise HTTPException(409,'Sale has not synced yet')
    enforce_scope(user,row.business_id,row.location_id)
    return row

def validate_change(db,user,kind,data,previous,entity_id):
    if previous and kind in IMMUTABLE:raise HTTPException(409,'This record is immutable')
    if kind=='category':
        if any(r.entity_id!=entity_id and r.data['name'].strip().lower()==data['name'].strip().lower() for r in records(db,user,'category')):raise HTTPException(409,'Category name already exists')
    if kind=='menu':
        if data['categoryId']:require_record(db,user,'category',data['categoryId'])
        elif not data['category']:raise HTTPException(422,'Select a category')
        balance=sum(r.data['quantityDelta'] for r in records(db,user,'stock') if r.data['menuItemId']==entity_id)
        if previous and balance and previous.get('stockUnit','Bottle')!=data['stockUnit']:raise HTTPException(409,'Count stock to zero before changing units')
    if kind=='stock':
        require_record(db,user,'menu',data['menuItemId'])
        delta=data['quantityDelta']
        if data['balanceAfter']!=data['balanceBefore']+delta:raise HTTPException(422,'Stock balances do not match movement')
        if data['type'] in {'RESTOCK','RETURN'} and delta<=0:raise HTTPException(422,'Restock and return must add stock')
        if data['type'] in {'SALE','WASTAGE'} and delta>=0:raise HTTPException(422,'Sale and wastage must reduce stock')
        movements=[r for r in records(db,user,'stock') if r.data['menuItemId']==data['menuItemId']]
        if data['type']=='OPENING_STOCK' and (delta<0 or data['balanceBefore']!=0 or any(r.data['type']=='OPENING_STOCK' for r in movements)):raise HTTPException(409,'Opening stock already recorded or invalid')
        if data['type'] in {'ADJUSTMENT','WASTAGE'} and not data['reason'].strip():raise HTTPException(422,'Stock changes require a reason')
        if sum(r.data['quantityDelta'] for r in movements)+delta<0 and not pos_rules(db,user).get('allowNegativeStock',False):raise HTTPException(409,'Stock conflict: insufficient shared stock. Local sale retained; owner reconciliation required.')
        if data['type']=='SALE':
            order=require_order(db,user,data['referenceId'])
            expected=sum(i['quantity'] for i in order.payload['items'] if i['menu_item_id']==data['menuItemId'] and i.get('track_stock'))
            if expected<=0 or delta!=-expected:raise HTTPException(409,'Stock movement does not match paid sale')
            if any(r.data['type']=='SALE' and r.data.get('referenceId')==order.id for r in movements):raise HTTPException(409,'This sale already deducted stock for this item')
    if kind=='workflow':
        order=require_order(db,user,data['orderId'])
        if entity_id!=order.id:raise HTTPException(409,'Order state must use the sale ID')
        if previous and data['status'] not in TRANSITIONS[previous['status']]:raise HTTPException(409,'Invalid order transition')
        if not previous and data['status'] not in {'NEW','COMPLETED'}:raise HTTPException(409,'Invalid initial order state')
        if data['status']=='CANCELLED':
            corrected=sum(r.data['amount'] for r in records(db,user,'correction') if r.data['orderId']==order.id)
            if corrected<order.total_pesewas:raise HTTPException(409,'Refund or void the paid sale before cancelling')
    if kind in {'payment','correction'}:
        order=require_order(db,user,data['orderId'])
        if data['paymentMethod']!=order.payment_method:raise HTTPException(409,'Payment method does not match the sale')
        if kind=='payment' and (data['amount']!=order.total_pesewas or entity_id!=order.id):raise HTTPException(409,'Payment does not match sale')
        if kind=='correction':
            corrected=sum(r.data['amount'] for r in records(db,user,'correction') if r.data['orderId']==order.id)
            remaining=order.total_pesewas-corrected
            if data['amount']>remaining:raise HTTPException(409,'Correction exceeds the remaining sale amount')
            if data['type']=='VOID' and (corrected or data['amount']!=order.total_pesewas):raise HTTPException(409,'Void must reverse the whole uncorrected sale')
    if kind=='movement':
        require_record(db,user,'inventory',data['itemId'])
        if data['quantity']==0:raise HTTPException(422,'Quantity must not be zero')
        if data['type']=='WASTAGE' and data['quantity']>=0:raise HTTPException(422,'Wastage must reduce stock')
        if data['type']=='RECEIVE' and data['quantity']<=0:raise HTTPException(422,'Receiving must add stock')
    if kind=='purchase':
        require_record(db,user,'supplier',data['supplierId'])
        for line in data['items']:require_record(db,user,'inventory',line['itemId'])
        if previous and previous['status']!='DRAFT':raise HTTPException(409,'Only draft purchases can change')
        if not previous and data['status']!='DRAFT':raise HTTPException(409,'Create a purchase draft first')
    if kind=='expense' and previous and previous['status']!='DRAFT':raise HTTPException(409,'Settled expenses are immutable')
    if kind=='expense' and data.get('fromDrawer'):
        if data['paymentMethod']!='CASH':raise HTTPException(422,'Drawer expenses must use cash')
        if data['status']=='SETTLED':
            shift=require_record(db,user,'shift',data.get('shiftId'))
            if shift.data['status']!='OPEN':raise HTTPException(409,'Drawer expenses require an open shift')
    if kind=='shift':
        if previous and previous['status']!='OPEN':raise HTTPException(409,'Closed shifts are immutable')
        if not previous:
            if data['status']!='OPEN':raise HTTPException(409,'Open a shift before closing')
            if data.get('terminalId'):
                terminal=db.get(Terminal,data['terminalId'])
                if not terminal:raise HTTPException(409,'Register this terminal first')
                enforce_scope(user,terminal.business_id,terminal.location_id)
            if any(r.data['status']=='OPEN' and (r.data.get('operatorId')==data.get('operatorId') or r.data.get('terminalId')==data.get('terminalId')) for r in records(db,user,'shift')):raise HTTPException(409,'This operator or terminal already has an open shift')
        if previous:
            if data['status']!='CLOSED' or data['countedCash'] is None or not data['closedAt']:raise HTTPException(409,'Closing requires counted cash and a closing time')
            for key in ('openingCash','openedAt','staffIds','operatorId','terminalId'):
                if data.get(key)!=previous.get(key):raise HTTPException(409,'Opening shift snapshot cannot change')
            sales=db.scalars(select(Order).where(Order.business_id==user.business_id,Order.location_id==user.location_id)).all()
            cash=sum(o.total_pesewas for o in sales if o.payload.get('shift_id')==entity_id and o.payment_method=='CASH')
            corrections=sum(r.data['amount'] for r in records(db,user,'correction') if r.data.get('shiftId')==entity_id and r.data['paymentMethod']=='CASH')
            movements=sum(r.data['amount'] for r in records(db,user,'cash') if r.data['shiftId']==entity_id)
            expected=data['openingCash']+cash-corrections+movements
            if data['expectedCash']!=expected or data['variance']!=data['countedCash']-expected:raise HTTPException(409,'Shift reconciliation differs from synced sales. Sync all terminals first.')
            if data['variance'] and pos_rules(db,user).get('requireVarianceNote',True) and not data['notes'].strip():raise HTTPException(422,'Explain the cash variance before closing')
    if kind=='cash':
        shift=require_record(db,user,'shift',data['shiftId'])
        if shift.data['status']!='OPEN':raise HTTPException(409,'Cash movements require an open shift')
        if data.get('expenseId'):
            expense=require_record(db,user,'expense',data['expenseId'])
            if not expense.data.get('fromDrawer') or expense.data['status']!='SETTLED' or expense.data.get('shiftId')!=data['shiftId'] or data['amount']!=-expense.data['amount']:raise HTTPException(409,'Drawer movement does not match expense')
            if any(r.data.get('expenseId')==data['expenseId'] for r in records(db,user,'cash')):raise HTTPException(409,'Expense already removed from drawer')
    if kind=='hold' and previous and previous['status']!='HELD':raise HTTPException(409,'This held order has already been resumed or cancelled')
    if kind=='device':
        terminal=db.get(Terminal,data['terminalId'])
        if terminal:enforce_scope(user,terminal.business_id,terminal.location_id)
        else:db.add(Terminal(id=data['terminalId'],business_id=user.business_id,location_id=user.location_id,name=data['name']))

def apply_operation(db:Session,user:User,event:Operation,commit=True):
    enforce_scope(user,event.businessId,event.locationId)
    if event.actorId!=user.id:raise HTTPException(403,'Event actor does not match authenticated user')
    authorize_operation(db,user,event)
    existing=db.get(AdminEvent,event.id)
    if existing:
        enforce_scope(user,existing.business_id,existing.location_id)
        if existing.entity_id!=event.entityId or existing.kind!=event.kind or existing.data!=event.data:raise HTTPException(409,'Event ID reused with different content')
        return {'id':event.id,'status':'already_processed'}
    schema=SCHEMAS.get(event.kind)
    if not schema:raise HTTPException(422,'Unknown record type')
    try:data=schema.model_validate(event.data).model_dump(mode='json')
    except ValidationError as exc:raise HTTPException(422,str(exc)) from exc
    # Lock the authenticated location to serialize multi-terminal state changes.
    from app.models.models import Location
    db.scalar(select(Location).where(Location.id==user.location_id).with_for_update())
    key=record_key(user,event.kind,event.entityId)
    row=db.get(AdminRecord,key)
    revision=row.revision if row else 0
    if revision!=event.baseVersion:raise HTTPException(409,'Record changed on another terminal; refresh before editing')
    validate_change(db,user,event.kind,data,row.data if row else None,event.entityId)
    db.add(AdminEvent(id=event.id,business_id=user.business_id,location_id=user.location_id,actor_id=user.id,entity_id=event.entityId,kind=event.kind,action=event.action,revision=revision+1,data=event.data,occurred_at=event.occurredAt))
    if row:row.data=data;row.revision=revision+1
    else:db.add(AdminRecord(key=key,business_id=user.business_id,location_id=user.location_id,kind=event.kind,entity_id=event.entityId,revision=revision+1,data=data))
    if commit:db.commit()
    else:db.flush()
    return {'id':event.id,'status':'accepted'}
