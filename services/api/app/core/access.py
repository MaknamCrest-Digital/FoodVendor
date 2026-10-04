from fastapi import HTTPException
from sqlalchemy import select
from app.models.access import Permission,Role,RolePermission,UserRole,UserPermissionOverride,SecurityAudit
from app.models.admin import User
from app.models.models import Business

PERMISSIONS=set('''dashboard.view dashboard.sales_summary.view dashboard.payment_breakdown.view dashboard.expenses.view dashboard.cash_position.view dashboard.stock_alerts.view dashboard.sync_status.view dashboard.shift_status.view
pos.view pos.sale.create pos.discount.apply pos.price_override pos.receipt.reprint
sales.view_own sales.view_all sales.refund sales.void
menu.view menu.create menu.edit menu.price.edit menu.availability.edit
inventory.view inventory.stock.add inventory.stock.remove inventory.stock.adjust inventory.movements.view
purchases.view purchases.create purchases.receive expenses.view expenses.create expenses.edit customers.view customers.create customers.edit
shifts.open shifts.view_own shifts.view_all shifts.close_own shifts.close_any
reports.view reports.export team.view team.create team.edit team.deactivate roles.manage audit.view
settings.general settings.appearance settings.payments settings.receipts settings.pos settings.team_access settings.sync settings.about
orders.view orders.manage kitchen.view kitchen.manage devices.view devices.manage'''.split())
CASHIER=set('''dashboard.view dashboard.shift_status.view dashboard.sync_status.view pos.view pos.sale.create pos.receipt.reprint sales.view_own orders.view customers.view customers.create shifts.open shifts.view_own shifts.close_own settings.appearance settings.about devices.view'''.split())
TEMPLATES={'OWNER':PERMISSIONS,'MANAGER':PERMISSIONS-{'roles.manage','settings.team_access','team.deactivate'},'CASHIER':CASHIER,'STOCK / STORE':set('dashboard.view dashboard.stock_alerts.view dashboard.sync_status.view menu.view inventory.view inventory.stock.add inventory.stock.remove inventory.stock.adjust inventory.movements.view purchases.view purchases.create purchases.receive settings.appearance settings.about settings.sync'.split()),'KITCHEN':set('dashboard.view dashboard.sync_status.view kitchen.view kitchen.manage orders.view settings.appearance settings.about'.split())}

def ensure_access(db,user):
    """Add tenant templates once; never overwrite owner-customized permissions."""
    changed=False
    role_link=db.get(UserRole,user.id)
    if role_link:return
    db.scalar(select(Business).where(Business.id==user.business_id).with_for_update())
    for key in PERMISSIONS:
        if not db.get(Permission,key):db.add(Permission(key=key));changed=True
    db.flush()
    roles={r.template:r for r in db.scalars(select(Role).where(Role.business_id==user.business_id))}
    for name,keys in TEMPLATES.items():
        if name not in roles:
            role=Role(business_id=user.business_id,name=name.title(),template=name);db.add(role);db.flush();roles[name]=role
            db.add_all([RolePermission(role_id=role.id,permission=key) for key in keys]);changed=True
    # Legacy ADMINs were explicitly provisioned owners before RBAC was introduced.
    template='OWNER' if user.role in {'ADMIN','OWNER'} else user.role if user.role in TEMPLATES else 'CASHIER'
    db.add(UserRole(user_id=user.id,role_id=roles[template].id));changed=True
    if changed:db.commit()

def effective_permissions(db,user):
    ensure_access(db,user)
    link=db.get(UserRole,user.id);role=db.get(Role,link.role_id)
    if not role or role.business_id!=user.business_id:raise HTTPException(403,'Role does not belong to this business')
    keys=set(db.scalars(select(RolePermission.permission).where(RolePermission.role_id==role.id)))
    for override in db.scalars(select(UserPermissionOverride).where(UserPermissionOverride.user_id==user.id)):
        if override.allowed:keys.add(override.permission)
        else:keys.discard(override.permission)
    return keys

def require_permission(db,user,*keys):
    if not set(keys)<=effective_permissions(db,user):raise HTTPException(403,'You do not have permission for this action')

def audit(db,user,action,entity_id,details=None):
    db.add(SecurityAudit(business_id=user.business_id,location_id=user.location_id,actor_id=user.id,action=action,entity_id=entity_id,details=details or {}))

def protect_final_owner(db,business_id):
    db.flush()
    active=db.scalars(select(User).join(UserRole,UserRole.user_id==User.id).join(Role,Role.id==UserRole.role_id).where(User.business_id==business_id,User.active==True,Role.template=='OWNER')).all()
    critical={'roles.manage','settings.team_access','team.edit','team.deactivate'}
    if not any(critical<=effective_permissions(db,user) for user in active):
        raise HTTPException(409,'Keep at least one active Owner with full access administration')
