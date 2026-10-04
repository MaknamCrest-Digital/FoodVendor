"""Reduce snapshots to the authenticated user's operational and reporting scope."""
from app.core.access import effective_permissions

def visible_snapshot(db,user,events,orders):
    keys=effective_permissions(db,user)
    all_sales='sales.view_all' in keys
    own_sales=bool({'sales.view_own','pos.view','shifts.view_own'}&keys)
    visible_orders=[o for o in orders if all_sales or own_sales and o.payload.get('cashier_id')==user.id]
    ids={o.id for o in visible_orders}
    visible=[]
    for event in events:
        kind=event.kind;data=event.data
        if 'audit.view' in keys:visible.append(event);continue
        if kind in {'menu','category'} and bool({'menu.view','pos.view'}&keys):visible.append(event)
        elif kind=='stock' and bool({'inventory.view','pos.view'}&keys):visible.append(event)
        elif kind=='shift' and ('shifts.view_all' in keys or 'shifts.view_own' in keys and (data.get('operatorId')==user.id or event.actor_id==user.id)):visible.append(event)
        elif kind=='cash' and ('shifts.view_all' in keys or event.actor_id==user.id and 'shifts.view_own' in keys):visible.append(event)
        elif kind in {'payment','correction','workflow'} and data.get('orderId') in ids:visible.append(event)
        elif kind=='workflow' and bool({'orders.view','kitchen.view'}&keys):visible.append(event)
        elif kind=='expense' and 'expenses.view' in keys:visible.append(event)
        elif kind in {'purchase','supplier'} and 'purchases.view' in keys:visible.append(event)
        elif kind=='customer' and 'customers.view' in keys:visible.append(event)
        elif kind=='staff' and 'team.view' in keys:visible.append(event)
        elif kind=='device' and 'devices.view' in keys:visible.append(event)
        elif kind=='hold' and event.actor_id==user.id and 'pos.view' in keys:visible.append(event)
        elif kind=='system' and event.actor_id==user.id and data.get('orderId') in ids:visible.append(event)
    return visible,visible_orders
