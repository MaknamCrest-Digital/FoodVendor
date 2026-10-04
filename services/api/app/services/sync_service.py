from sqlalchemy.orm import Session
from app.models.models import SyncEvent, Order, Terminal, Location
from app.services.admin_service import apply_operation
from sqlalchemy import select
from app.schemas.sync import SyncEnvelope, SyncAck

SUPPORTED_SYNC_PROTOCOLS = {1,2}

def process_event(db: Session, event: SyncEnvelope, user=None) -> SyncAck:
    # Authentication/tenant scope is enforced by the route; validate device ownership too.
    terminal = db.get(Terminal, event.terminal_id)
    if not terminal or terminal.business_id != event.business_id or terminal.location_id != event.location_id:
        raise PermissionError("Terminal is not authorized for this tenant/location")
    if event.sync_protocol_version not in SUPPORTED_SYNC_PROTOCOLS:
        raise ValueError("Unsupported sync protocol")
    if (event.payload.stock_movements or any(i.track_stock for i in event.payload.items)) and event.sync_protocol_version!=2:
        raise ValueError('Tracked stock requires sync protocol 2')
    db.scalar(select(Location).where(Location.id==event.location_id).with_for_update())

    existing = db.get(SyncEvent, event.event_id)
    if existing:
        if existing.business_id != event.business_id or existing.entity_id != event.entity_id:
            raise PermissionError('Event ID belongs to another transaction')
        return SyncAck(event_id=event.event_id, status="already_processed", entity_id=existing.entity_id)

    if event.entity_id != event.payload.id or not event.payload.items:
        raise ValueError('Invalid sale identity/items')
    if event.payload.total_pesewas != sum(item.quantity*item.unit_price_pesewas for item in event.payload.items):
        raise ValueError('Sale total does not match item snapshots')
    tender=event.payload.amount_tendered
    if event.payload.payment_method=='CASH' and tender is not None:
        if tender<event.payload.total_pesewas or event.payload.change!=tender-event.payload.total_pesewas:raise ValueError('Cash tender/change does not match the sale')
    elif event.payload.change or tender is not None:raise ValueError('Tender/change is only valid for cash payments')
    if event.payload.shift_id:
        from app.services.admin_service import require_record
        shift=require_record(db,user,'shift',event.payload.shift_id)
        if shift.data.get('operatorId') not in (None,user.id) or shift.data.get('terminalId') not in (None,event.terminal_id):raise PermissionError('Sale shift belongs to another operator or terminal')
    tracked={}
    for item in event.payload.items:
        if item.track_stock:tracked[item.menu_item_id]=tracked.get(item.menu_item_id,0)+item.quantity
    movements=event.payload.stock_movements
    if len(movements)!=len(tracked) or len({m.data.get('menuItemId') for m in movements})!=len(movements):raise ValueError('Each tracked item requires exactly one stock movement')
    for movement in movements:
        if movement.kind!='stock' or movement.data.get('type')!='SALE' or movement.data.get('referenceId')!=event.payload.id or movement.data.get('quantityDelta')!=-tracked.get(movement.data.get('menuItemId'),0):raise ValueError('Stock movement does not match sale')
    prior = db.get(Order, event.payload.id)
    if prior and (prior.business_id != event.business_id or prior.location_id != event.location_id or prior.total_pesewas != event.payload.total_pesewas or prior.receipt_no != event.payload.receipt_no):
        raise PermissionError('Sale ID belongs to another transaction')

    # Event marker and order are committed atomically. A retry cannot duplicate the sale.
    db.add(SyncEvent(event_id=event.event_id, entity_id=event.entity_id,
                     business_id=event.business_id, event_type=event.event_type))
    if db.get(Order, event.payload.id) is None:
        db.add(Order(
            id=event.payload.id,
            business_id=event.business_id,
            location_id=event.location_id,
            terminal_id=event.terminal_id,
            receipt_no=event.payload.receipt_no,
            total_pesewas=event.payload.total_pesewas,
            payment_method=event.payload.payment_method,
            occurred_at=event.occurred_at,
            payload=event.payload.model_dump(mode='json'),
        ))
    db.flush()
    for movement in movements:
        if user is None:raise PermissionError('Authenticated stock actor required')
        apply_operation(db,user,movement,commit=False)
    db.commit()
    return SyncAck(event_id=event.event_id, status="accepted", entity_id=event.entity_id)
