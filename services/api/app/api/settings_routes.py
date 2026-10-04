from fastapi import APIRouter,Depends,HTTPException
from pydantic import BaseModel,Field,ValidationError,ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.models import Business,Location,Terminal,now
from app.models.admin import User
from app.models.access import ScopedSetting
from app.core.auth import current_user,enforce_scope
from app.core.access import require_permission,audit
from app.schemas.settings import SECTIONS,SCOPES

router=APIRouter(prefix='/api/v1/settings',tags=['Scoped settings'])
SECTION_PERMISSIONS={'general':'settings.general','location':'settings.general','payments':'settings.payments','receipts':'settings.receipts','pos':'settings.pos','appearance':'settings.appearance','device':'devices.manage'}

def scope_identity(db,user,section,device_id=None):
    scope=SCOPES[section]
    if scope=='DEVICE':
        terminal=db.get(Terminal,device_id) if device_id else db.scalar(select(Terminal).where(Terminal.business_id==user.business_id,Terminal.location_id==user.location_id).order_by(Terminal.id))
        if not terminal:raise HTTPException(404,'Device not found')
        enforce_scope(user,terminal.business_id,terminal.location_id)
        return scope,terminal.id
    return scope,{'BUSINESS':user.business_id,'LOCATION':user.location_id,'USER':user.id}[scope]

def setting_key(business_id,scope,scope_id,section):return f'{business_id}:{scope}:{scope_id}:{section}'

def read_section(db,user,section,device_id=None):
    scope,scope_id=scope_identity(db,user,section,device_id)
    row=db.get(ScopedSetting,setting_key(user.business_id,scope,scope_id,section))
    defaults={}
    if section=='general':defaults={'businessName':db.get(Business,user.business_id).name}
    if section=='location':defaults={'name':db.get(Location,user.location_id).name}
    if section=='device':defaults={'name':db.get(Terminal,scope_id).name}
    values=SECTIONS[section].model_validate(row.values if row else defaults).model_dump()
    return {'scope':scope,'scopeId':scope_id,'section':section,'revision':row.revision if row else 0,'values':values}

@router.get('')
def get_settings(deviceId:str|None=None,user:User=Depends(current_user),db:Session=Depends(get_db)):
    # Authenticated users need these operational rules to sell/print offline.
    return {'businessId':user.business_id,'locationId':user.location_id,'userId':user.id,'sections':[read_section(db,user,key,deviceId) for key in SECTIONS]}

class SettingChange(BaseModel):
    model_config=ConfigDict(extra='forbid')
    revision:int=Field(ge=0)
    values:dict
    deviceId:str|None=None
    confirmCurrencyChange:bool=False

@router.put('/{section}')
def change_setting(section:str,body:SettingChange,user:User=Depends(current_user),db:Session=Depends(get_db)):
    if section not in SECTIONS:raise HTTPException(404,'Unknown settings section')
    require_permission(db,user,SECTION_PERMISSIONS[section])
    scope,scope_id=scope_identity(db,user,section,body.deviceId)
    db.scalar(select(Business).where(Business.id==user.business_id).with_for_update())
    current=read_section(db,user,section,body.deviceId)
    if body.revision!=current['revision']:raise HTTPException(409,'Settings changed elsewhere. Refresh this section before saving.')
    try:values=SECTIONS[section].model_validate(body.values).model_dump()
    except ValidationError:raise HTTPException(422,'Check the required fields and settings rules; no changes were saved.')
    if section=='device':
        for printer in values['printers']:
            if printer['businessId']!=user.business_id or printer['locationId']!=user.location_id or printer['deviceId']!=scope_id:
                raise HTTPException(422,'Printer profiles must belong to this business, location and device.')
    currency_changed=section=='general' and values['currency']!=current['values']['currency']
    if currency_changed and not body.confirmCurrencyChange:raise HTTPException(409,'Confirm currency change. Existing transaction values will not be converted.')
    key=setting_key(user.business_id,scope,scope_id,section)
    row=db.get(ScopedSetting,key)
    if row:row.values=values;row.revision+=1;row.updated_by=user.id;row.updated_at=now()
    else:db.add(ScopedSetting(key=key,business_id=user.business_id,scope=scope,scope_id=scope_id,section=section,revision=1,values=values,updated_by=user.id))
    if section=='general':db.get(Business,user.business_id).name=values['businessName']
    if section=='location':db.get(Location,user.location_id).name=values['name']
    if section=='device':db.get(Terminal,scope_id).name=values['name']
    if section!='appearance':
        action={'general':'BUSINESS_SETTINGS_UPDATED','location':'LOCATION_SETTINGS_UPDATED','payments':'PAYMENT_METHOD_SETTINGS_CHANGED','receipts':'RECEIPT_SETTINGS_CHANGED','pos':'POS_SETTINGS_CHANGED','device':'DEVICE_SETTINGS_CHANGED'}[section]
        audit(db,user,action,key,{'before':{k:v for k,v in current['values'].items() if k!='logo'},'after':{k:v for k,v in values.items() if k!='logo'}})
        if currency_changed:audit(db,user,'CURRENCY_CHANGED',key,{'before':current['values']['currency'],'after':values['currency']})
    db.commit();return read_section(db,user,section,body.deviceId)
