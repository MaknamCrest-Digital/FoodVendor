from fastapi import HTTPException
from sqlalchemy import select
from app.models.admin import AdminRecord
from app.core.access import effective_permissions,require_permission

def authorize_operation(db,user,event):
    kind=event.kind;data=event.data
    row=db.scalar(select(AdminRecord).where(AdminRecord.business_id==user.business_id,AdminRecord.location_id==user.location_id,AdminRecord.kind==kind,AdminRecord.entity_id==event.entityId))
    old=row.data if row else None
    if kind=='menu':
        if not old:require_permission(db,user,'menu.create');return
        changes={key for key,value in data.items() if old.get(key)!=value}
        price=changes&{'pricePesewas','variations','pricingType'}
        if price:require_permission(db,user,'menu.price.edit')
        if changes&{'isAvailable','active'}:require_permission(db,user,'menu.availability.edit')
        if changes-{'pricePesewas','variations','pricingType','isAvailable','active'}:require_permission(db,user,'menu.edit')
        return
    if kind=='stock':
        permission={'OPENING_STOCK':'inventory.stock.add','RESTOCK':'inventory.stock.add','RETURN':'inventory.stock.add','WASTAGE':'inventory.stock.remove','SALE':'pos.sale.create','ADJUSTMENT':'inventory.stock.adjust'}.get(data.get('type'),'inventory.stock.adjust')
        require_permission(db,user,permission);return
    if kind=='shift':
        if not old:require_permission(db,user,'shifts.open')
        elif old.get('operatorId')==user.id:require_permission(db,user,'shifts.close_own')
        else:require_permission(db,user,'shifts.close_any')
        if data.get('operatorId') not in (None,user.id) and 'shifts.close_any' not in effective_permissions(db,user):raise HTTPException(403,'Shift belongs to another operator')
        return
    if kind=='cash':
        shift=db.scalar(select(AdminRecord).where(AdminRecord.business_id==user.business_id,AdminRecord.location_id==user.location_id,AdminRecord.kind=='shift',AdminRecord.entity_id==data.get('shiftId')))
        if shift and shift.data.get('operatorId')==user.id:require_permission(db,user,'shifts.open')
        else:require_permission(db,user,'shifts.close_any')
        return
    if kind=='correction':require_permission(db,user,'sales.void' if data.get('type')=='VOID' else 'sales.refund');return
    if kind=='system':
        if event.action in {'SALE_CREATED','PRINT_COMPLETED','PRINT_FAILED','SALE_SYNCED','SYNC_FAILED'}:require_permission(db,user,'pos.sale.create')
        elif event.action=='RECEIPT_REPRINTED':require_permission(db,user,'pos.receipt.reprint')
        else:require_permission(db,user,'audit.view')
        return
    if kind=='workflow':require_permission(db,user,'orders.manage' if event.baseVersion else 'pos.sale.create');return
    mapping={'category':'menu.edit','inventory':'inventory.stock.adjust','movement':'inventory.stock.adjust','supplier':'purchases.create','purchase':'purchases.receive' if data.get('status')=='RECEIVED' else 'purchases.create','expense':'expenses.edit' if old else 'expenses.create','customer':'customers.edit' if old else 'customers.create','staff':'team.edit' if old else 'team.create','payment':'pos.sale.create','settings':'settings.general','device':'devices.manage','hold':'pos.sale.create'}
    permission=mapping.get(kind)
    if not permission:raise HTTPException(403,'Action is not permitted')
    require_permission(db,user,permission)
