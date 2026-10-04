from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.access import audit, effective_permissions
from app.core.auth import current_user
from app.db.session import get_db
from app.models.admin import User
from app.models.access import UserRole, Role
from app.models.models import Business, Location, Terminal
from sqlalchemy import select

router=APIRouter(prefix='/api/v1/auth', tags=['Authentication'])


def profile(user: User, db: Session):
    role_link=db.get(UserRole,user.id)
    role=db.get(Role,role_link.role_id) if role_link else None
    business=db.get(Business,user.business_id)
    location=db.get(Location,user.location_id)
    terminal=db.scalar(select(Terminal).where(Terminal.business_id==user.business_id,Terminal.location_id==user.location_id).order_by(Terminal.id))
    if not business or not location:
        raise HTTPException(500,'The linked account has invalid business or location configuration')
    return {'id':user.id,'businessId':user.business_id,'locationId':user.location_id,'name':user.name,'email':user.email,'role':user.role,'roleId':role.id if role else None,'roleName':role.name if role else None,'permissions':sorted(effective_permissions(db,user)),'businessName':business.name,'locationName':location.name,'terminalId':terminal.id if terminal else None,'terminalName':terminal.name if terminal else None}


@router.get('/me')
def me(user:User=Depends(current_user),db:Session=Depends(get_db)):
    return profile(user,db)


class AccountChange(BaseModel):
    model_config=ConfigDict(extra='forbid')
    name:str=Field(min_length=1,max_length=120)


@router.put('/account')
def account(body:AccountChange,user:User=Depends(current_user),db:Session=Depends(get_db)):
    name=body.name.strip()
    if not name:
        raise HTTPException(422,'Enter a valid name')
    if user.name!=name:
        user.name=name
        audit(db,user,'ACCOUNT_UPDATED',user.id)
        db.commit()
    return profile(user,db)
