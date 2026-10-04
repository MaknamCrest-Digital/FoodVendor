from uuid import UUID
from fastapi import APIRouter,Depends,HTTPException
from pydantic import BaseModel,Field,ConfigDict
from sqlalchemy import select,delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.admin import User
from app.models.models import Business
from app.models.access import Role,RolePermission,UserRole,UserPermissionOverride
from app.core.auth import current_user
from app.core.access import PERMISSIONS,require_permission,effective_permissions,protect_final_owner,audit

router=APIRouter(prefix='/api/v1/team',tags=['Team and access'])

class TeamCreate(BaseModel):
    model_config=ConfigDict(extra='forbid')
    name:str=Field(min_length=1,max_length=120)
    email:str=Field(min_length=3,max_length=254)
    supabaseUserId:UUID
    roleId:str

class TeamUpdate(BaseModel):
    model_config=ConfigDict(extra='forbid')
    name:str=Field(min_length=1,max_length=120)
    roleId:str
    active:bool=True
    overrides:dict[str,str]=Field(default_factory=dict)
    supabaseUserId:UUID|None=None

class RoleUpdate(BaseModel):
    name:str=Field(min_length=1,max_length=100)
    permissions:list[str]

def tenant_role(db,user,role_id):
    row=db.get(Role,role_id)
    if not row or row.business_id!=user.business_id:raise HTTPException(403,'Role belongs to another business')
    return row

@router.get('')
def team(user:User=Depends(current_user),db:Session=Depends(get_db)):
    require_permission(db,user,'team.view')
    users=db.scalars(select(User).where(User.business_id==user.business_id,User.location_id==user.location_id)).all()
    rows=[]
    for member in users:
        permissions=sorted(effective_permissions(db,member));link=db.get(UserRole,member.id)
        rows.append({'id':member.id,'name':member.name,'email':member.email,'roleId':link.role_id,'locationId':member.location_id,'active':member.active,'supabaseUserId':member.supabase_user_id,'linked':member.supabase_user_id is not None,'lastActive':None,'permissions':permissions,'overrides':{o.permission:'ALLOW' if o.allowed else 'DENY' for o in db.scalars(select(UserPermissionOverride).where(UserPermissionOverride.user_id==member.id))}})
    roles=db.scalars(select(Role).where(Role.business_id==user.business_id)).all()
    return {'members':rows,'roles':[{'id':r.id,'name':r.name,'template':r.template,'permissions':list(db.scalars(select(RolePermission.permission).where(RolePermission.role_id==r.id)))} for r in roles],'permissions':sorted(PERMISSIONS)}

@router.post('')
def create(body:TeamCreate,user:User=Depends(current_user),db:Session=Depends(get_db)):
    require_permission(db,user,'team.create','roles.manage')
    role=tenant_role(db,user,body.roleId)
    email=body.email.strip().lower()
    if '@' not in email or ' ' in email:raise HTTPException(422,'Enter a valid email')
    member=User(name=body.name.strip(),email=email,supabase_user_id=str(body.supabaseUserId),role=role.template,business_id=user.business_id,location_id=user.location_id)
    try:
        db.add(member);db.flush();db.add(UserRole(user_id=member.id,role_id=role.id));audit(db,user,'USER_CREATED',member.id,{'roleId':role.id});db.commit()
    except IntegrityError:
        db.rollback();raise HTTPException(409,'Email or Supabase Auth user is already linked to another account')
    return {'id':member.id}

@router.put('/{member_id}')
def update(member_id:str,body:TeamUpdate,user:User=Depends(current_user),db:Session=Depends(get_db)):
    require_permission(db,user,'team.edit')
    db.scalar(select(Business).where(Business.id==user.business_id).with_for_update())
    member=db.get(User,member_id)
    if not member or member.business_id!=user.business_id or member.location_id!=user.location_id:raise HTTPException(403,'Member belongs to another business/location')
    link=db.get(UserRole,member.id);role=tenant_role(db,user,body.roleId)
    if link.role_id!=role.id or body.overrides!={o.permission:'ALLOW' if o.allowed else 'DENY' for o in db.scalars(select(UserPermissionOverride).where(UserPermissionOverride.user_id==member.id))}:require_permission(db,user,'roles.manage')
    if not body.active:require_permission(db,user,'team.deactivate')
    if set(body.overrides)-PERMISSIONS or any(v not in {'ALLOW','DENY','INHERIT'} for v in body.overrides.values()):raise HTTPException(422,'Unknown permission or override')
    identity_changed='supabaseUserId' in body.model_fields_set and member.supabase_user_id!=(str(body.supabaseUserId) if body.supabaseUserId else None)
    if identity_changed:require_permission(db,user,'roles.manage')
    old={'name':member.name,'active':member.active,'roleId':link.role_id,'linked':member.supabase_user_id is not None}
    member.name=body.name.strip();member.active=body.active;member.role=role.template;link.role_id=role.id
    if identity_changed:member.supabase_user_id=str(body.supabaseUserId) if body.supabaseUserId else None
    db.execute(delete(UserPermissionOverride).where(UserPermissionOverride.user_id==member.id))
    db.add_all([UserPermissionOverride(user_id=member.id,permission=key,allowed=value=='ALLOW') for key,value in body.overrides.items() if value!='INHERIT'])
    protect_final_owner(db,user.business_id)
    audit(db,user,'USER_ACCESS_UPDATED',member.id,{'before':old,'after':{'name':member.name,'active':member.active,'roleId':role.id,'linked':member.supabase_user_id is not None},'overrides':body.overrides})
    try:db.commit()
    except IntegrityError:
        db.rollback();raise HTTPException(409,'Supabase Auth user is already linked to another account')
    return {'status':'saved'}

@router.post('/roles')
def create_role(body:RoleUpdate,user:User=Depends(current_user),db:Session=Depends(get_db)):
    require_permission(db,user,'roles.manage')
    if set(body.permissions)-PERMISSIONS:raise HTTPException(422,'Unknown permissions')
    role=Role(business_id=user.business_id,name=body.name.strip(),template='CUSTOM');db.add(role)
    try:
        db.flush();db.add_all([RolePermission(role_id=role.id,permission=key) for key in set(body.permissions)]);audit(db,user,'ROLE_CREATED',role.id,{'permissions':body.permissions});db.commit()
    except IntegrityError:
        db.rollback();raise HTTPException(409,'Role name already exists')
    return {'id':role.id}

@router.put('/roles/{role_id}')
def update_role(role_id:str,body:RoleUpdate,user:User=Depends(current_user),db:Session=Depends(get_db)):
    require_permission(db,user,'roles.manage');db.scalar(select(Business).where(Business.id==user.business_id).with_for_update())
    role=tenant_role(db,user,role_id)
    if set(body.permissions)-PERMISSIONS:raise HTTPException(422,'Unknown permissions')
    before=list(db.scalars(select(RolePermission.permission).where(RolePermission.role_id==role.id)))
    role.name=body.name.strip();db.execute(delete(RolePermission).where(RolePermission.role_id==role.id));db.add_all([RolePermission(role_id=role.id,permission=key) for key in set(body.permissions)])
    protect_final_owner(db,user.business_id);audit(db,user,'ROLE_UPDATED',role.id,{'before':before,'after':body.permissions})
    try:db.commit()
    except IntegrityError:
        db.rollback();raise HTTPException(409,'Role name already exists')
    return {'status':'saved'}
